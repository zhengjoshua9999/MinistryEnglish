"""DeepSeek is text-only — it never touches audio. Two jobs here:
1. Polish Whisper's raw sentence punctuation/casing (never reword/paraphrase).
2. Give a word a contextual definition + Chinese translation for the vocab book.
Both are no-ops if DEEPSEEK_API_KEY isn't set — callers fall back to the raw
Whisper text / an empty definition, they never crash on a missing key.
"""

import json
import time

import requests

from app import config

CHUNK_SIZE = 20
TIMEOUT = 60
RETRIES = 2  # 这个环境网络偶发抖动（SSL 连接中断），重试一次能明显降低误判为"不可用"的概率

POLISH_SYSTEM_PROMPT = """你是英文讲道稿的校对员，处理的是"水流职事"（Watchman Nee / Witness Lee ministry）讲道的 Whisper 语音识别原始文本。
严格规则：
- 只允许修正标点符号、大小写、明显的转写错字；
- 禁止改写、意译、替换词汇，禁止增删实质内容；
- 如果一句话被错误断开或错误合并，可以合并/拆分，但不能改变原有词序和用词；
- 遇到神学专有表达（如 the divine dispensing、the organic Body、economy of God 等）和人名（Watchman Nee、Witness Lee），保持原样，不要"纠正"成别的词。
输入是一个 JSON 数组，每个元素是一句待润色文本。按同样的顺序和数量，输出一个 JSON 数组（键名 "sentences"），只包含润色后的文本，不要输出任何解释。"""

DEFINE_SYSTEM_PROMPT = """你是英语教学助理，需要结合给定的原句语境给出一个单词的解释。这是"水流职事"（Watchman Nee / Witness Lee ministry）讲道内容，
注意有些词在这个语境下是神学专用含义（例如 dispensing 在这里是"分赐"而不是"配药"），要按语境给出准确释义，而不是给通用词典的第一个义项。
词性也要按这个词在给定原句里实际的语法角色判断，不是这个词全部可能的词性——同一个词在别的句子里词性可能不一样。
输出 JSON 对象，包含三个键："definition"（简洁的英文释义，20 词以内）、"translation"（对应中文）、"pos"（词性缩写，只能是以下之一：n. v. adj. adv. prep. conj. pron. art. interj.），不要输出其他内容。"""

VALID_POS = {"n.", "v.", "adj.", "adv.", "prep.", "conj.", "pron.", "art.", "interj."}


def _chat(system_prompt: str, user_content: str) -> dict:
    last_error = None
    for attempt in range(RETRIES + 1):
        try:
            resp = requests.post(
                f"{config.DEEPSEEK_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {config.DEEPSEEK_API_KEY}"},
                json={
                    "model": config.DEEPSEEK_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0,
                },
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            return json.loads(content)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            last_error = e
            if attempt < RETRIES:
                time.sleep(1)
    raise last_error


def polish_sentences(texts: list[str]) -> list[str]:
    if not config.DEEPSEEK_ENABLED or not texts:
        return list(texts)

    polished: list[str] = []
    for i in range(0, len(texts), CHUNK_SIZE):
        chunk = texts[i : i + CHUNK_SIZE]
        try:
            result = _chat(POLISH_SYSTEM_PROMPT, json.dumps(chunk, ensure_ascii=False))
            chunk_out = result.get("sentences", [])
            if len(chunk_out) != len(chunk):
                polished.extend(chunk)
            else:
                polished.extend(chunk_out)
        except Exception:
            # DeepSeek 不可用时，直接回退到 Whisper 原始文本，不影响主流程
            polished.extend(chunk)
    return polished


def define_word(word: str, context_sentence: str) -> dict:
    if not config.DEEPSEEK_ENABLED:
        return {"definition": "", "translation": "", "pos": ""}
    try:
        user_content = json.dumps({"word": word, "context": context_sentence}, ensure_ascii=False)
        result = _chat(DEFINE_SYSTEM_PROMPT, user_content)
        pos = result.get("pos", "").strip().lower()
        return {
            "definition": result.get("definition", ""),
            "translation": result.get("translation", ""),
            "pos": pos if pos in VALID_POS else "",
        }
    except Exception:
        return {"definition": "", "translation": "", "pos": ""}
