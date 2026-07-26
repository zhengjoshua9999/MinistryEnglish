from collections.abc import Iterator
from functools import lru_cache

from faster_whisper import WhisperModel
from sqlalchemy.orm import Session

from app import config
from app.models import GlossaryTerm
from app.services.segmentation import SENTENCE_ENDERS, segment_words

MAX_PROMPT_CHARS = 220
CHUNK_DURATION_SEC = 300  # 每约 5 分钟内容落库一次、更新一次进度


@lru_cache(maxsize=1)
def get_model() -> WhisperModel:
    return WhisperModel(
        config.WHISPER_MODEL,
        device=config.WHISPER_DEVICE,
        compute_type=config.WHISPER_COMPUTE_TYPE,
    )


def build_glossary_prompt(db: Session) -> str:
    terms = [t.term for t in db.query(GlossaryTerm).all()]
    if not terms:
        return ""
    prompt = "Vocabulary: " + ", ".join(terms)
    return prompt[:MAX_PROMPT_CHARS]


def transcribe_chunks(path: str, db: Session, total_duration_sec: float) -> Iterator[tuple[list[dict], float]]:
    """流式转写：整段音频仍然是 Whisper 一次连续解码（VAD 内部处理停顿，不会在句子中间硬切），
    但按"攒够约 5 分钟 + 落在一个句子边界上"为一批，逐批 yield (sentences, progress)。
    不物理切分音频文件——切分点很容易砸在一句话中间，伤转写质量；这里只是把已经转好的词流
    按句子边界分批交给调用方落库，边转边报进度。
    """
    model = get_model()
    initial_prompt = build_glossary_prompt(db)

    segments, _info = model.transcribe(
        path,
        word_timestamps=True,
        initial_prompt=initial_prompt or None,
        vad_filter=True,
        # condition_on_previous_text=True（默认值）在长音频上是 Whisper 一个廣为人知的坑：
        # 前面片段的文本会被喂回去当解码上下文，遇到长句、停顿、口音变化时容易把模型带进
        # "复读循环"——同一句话被连续吐出好几遍。关掉之后每个片段独立解码，配合下面两个
        # 参数直接在解码层面抑制重复，比事后再去猜哪条是重复的可靠。
        condition_on_previous_text=False,
        repetition_penalty=1.1,
        no_repeat_ngram_size=3,
    )

    pending_words: list[dict] = []
    chunk_start = 0.0

    def flush() -> list[dict]:
        sentences = segment_words(pending_words)
        pending_words.clear()
        return sentences

    for seg in segments:
        for w in seg.words or []:
            word = {"word": w.word, "start": w.start, "end": w.end}
            pending_words.append(word)
            is_boundary = word["word"].strip().endswith(SENTENCE_ENDERS)
            accumulated = word["end"] - chunk_start
            if pending_words and accumulated >= CHUNK_DURATION_SEC and is_boundary:
                sentences = flush()
                chunk_start = word["end"]
                progress = min(1.0, word["end"] / total_duration_sec) if total_duration_sec else 0.0
                yield sentences, progress

    if pending_words:
        yield flush(), 1.0
