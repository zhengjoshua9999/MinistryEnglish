from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Sentence
from app.schemas import SentenceCorrections, SentenceOut, SentenceUpdate

router = APIRouter(tags=["sentences"])


@router.get("/sentences/{sentence_id}", response_model=SentenceOut)
def get_sentence(sentence_id: int, db: Session = Depends(get_db)):
    s = db.get(Sentence, sentence_id)
    if not s:
        raise HTTPException(404, "找不到该句子")
    return s


@router.patch("/sentences/{sentence_id}", response_model=SentenceOut)
def update_sentence(sentence_id: int, payload: SentenceUpdate, db: Session = Depends(get_db)):
    """手动修正 ASR 识别错的字幕文本。只改 text_polished（听写对比/字幕导出用这个）——
    text_raw 保留 Whisper 原始输出，留个底方便看出改了什么。"""
    s = db.get(Sentence, sentence_id)
    if not s:
        raise HTTPException(404, "找不到该句子")
    s.text_polished = payload.text_polished.strip()
    db.commit()
    db.refresh(s)
    return s


@router.post("/sentences/correct", response_model=list[SentenceOut])
def correct_sentences(payload: SentenceCorrections, db: Session = Depends(get_db)):
    """批量修正 ASR 识别错的字幕：一次提交多条 {id, text}，统一写入 text_polished。
    供外部脚本 / 后续 AI 校对流程使用；text_raw 仍保留 Whisper 原始输出。"""
    if not payload.corrections:
        return []
    out: list[Sentence] = []
    seen: set[int] = set()
    for c in payload.corrections:
        if c.id in seen:
            continue
        seen.add(c.id)
        s = db.get(Sentence, c.id)
        if not s:
            raise HTTPException(404, f"找不到句子 {c.id}")
        s.text_polished = c.text.strip()
        out.append(s)
    db.commit()
    for s in out:
        db.refresh(s)
    return out
