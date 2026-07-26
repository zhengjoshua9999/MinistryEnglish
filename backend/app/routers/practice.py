import json
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app import config
from app.database import get_db
from app.models import PracticeAttempt, Sentence, VocabWord, WeakWordCount
from app.schemas import PracticeAttemptOut
from app.services import audio_utils, stats_service
from app.services.azure_service import assess_pronunciation

router = APIRouter(tags=["practice"])

RECORDINGS_DIR = config.RECORDINGS_DIR

WEAK_ACCURACY_THRESHOLD = 60
WEAK_REPEAT_THRESHOLD = 2


def _record_weak_words_and_get_suggestions(db: Session, attempt: PracticeAttempt) -> list[str]:
    """这次评分里准确度低于阈值的词，计数 +1（计数独立于 PracticeAttempt 存在，录音被
    替换/删除不影响已经攒下的计数）。计数达到阈值、且还没进生词本的，建议加入。"""
    weak_words = {
        w["word"].lower()
        for w in json.loads(attempt.word_scores_json or "[]")
        if w.get("word") and w.get("accuracy", 100) < WEAK_ACCURACY_THRESHOLD
    }
    if not weak_words:
        return []

    already_in_vocab = {row[0] for row in db.query(VocabWord.word_norm).all()}

    suggestions = []
    for word in weak_words:
        stat = db.get(WeakWordCount, word)
        if stat is None:
            stat = WeakWordCount(word_norm=word, count=0)
            db.add(stat)
        stat.count += 1
        if stat.count >= WEAK_REPEAT_THRESHOLD and word not in already_in_vocab:
            suggestions.append(word)
    db.commit()

    return sorted(suggestions)


@router.post("/sentences/{sentence_id}/practice", response_model=PracticeAttemptOut)
def submit_recording(sentence_id: int, file: UploadFile, db: Session = Depends(get_db)):
    """只保存跟读录音，方便回放比对——不调用 Azure，评分是单独一步（见 /practice/{id}/score）。
    每句只保留最新一次录音：先删掉这句之前的记录和音频文件，再写入新的。"""
    sentence = db.get(Sentence, sentence_id)
    if not sentence:
        raise HTTPException(404, "找不到该句子")

    previous = db.query(PracticeAttempt).filter(PracticeAttempt.sentence_id == sentence_id).all()
    # 同一句今天已经录过（哪怕后来被替换掉了），今天就不再重复计数——"复读句数"数的是
    # 覆盖了多少不同的句子，不是按了多少次录音按钮。
    already_shadowed_today = any(old.created_at.date() == datetime.utcnow().date() for old in previous)
    for old in previous:
        (RECORDINGS_DIR / old.audio_path).unlink(missing_ok=True)
        db.delete(old)

    token = uuid.uuid4().hex
    raw_path = RECORDINGS_DIR / f"{token}-raw{Path(file.filename).suffix or '.webm'}"
    raw_path.write_bytes(file.file.read())

    wav_path = RECORDINGS_DIR / f"{token}.wav"
    try:
        audio_utils.extract_audio_wav(str(raw_path), str(wav_path))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"录音处理失败：{e}") from e
    finally:
        raw_path.unlink(missing_ok=True)

    attempt = PracticeAttempt(sentence_id=sentence_id, audio_path=wav_path.name, scored=False)
    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    if not already_shadowed_today:
        stats_service.bump(db, shadow_count=1)  # 今天第一次录这句才计数，跟是否评分无关
    return attempt


@router.post("/practice/{attempt_id}/score", response_model=PracticeAttemptOut)
def score_recording(attempt_id: int, db: Session = Depends(get_db)):
    """对已保存的录音单独触发一次 Azure 发音评估，跟读和评分分开，评分才消耗 Azure 额度。"""
    attempt = db.get(PracticeAttempt, attempt_id)
    if not attempt:
        raise HTTPException(404, "找不到该条录音")

    sentence = db.get(Sentence, attempt.sentence_id)
    reference_text = sentence.text_polished or sentence.text_raw
    wav_path = RECORDINGS_DIR / attempt.audio_path

    try:
        result = assess_pronunciation(str(wav_path), reference_text)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"评分失败：{e}") from e

    if result is None:
        raise HTTPException(400, "未配置 Azure 密钥，无法评分")

    attempt.scored = True
    attempt.accuracy = result.get("accuracy", 0)
    attempt.fluency = result.get("fluency", 0)
    attempt.completeness = result.get("completeness", 0)
    attempt.pron_score = result.get("pron_score", 0)
    attempt.word_scores_json = json.dumps(result.get("words", []), ensure_ascii=False)
    db.commit()
    db.refresh(attempt)

    out = PracticeAttemptOut.model_validate(attempt)
    out.weak_word_suggestions = _record_weak_words_and_get_suggestions(db, attempt)
    return out


@router.get("/sentences/{sentence_id}/practice", response_model=list[PracticeAttemptOut])
def practice_history(sentence_id: int, db: Session = Depends(get_db)):
    return (
        db.query(PracticeAttempt)
        .filter(PracticeAttempt.sentence_id == sentence_id)
        .order_by(PracticeAttempt.created_at.desc())
        .all()
    )
