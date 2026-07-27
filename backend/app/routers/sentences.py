from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Sentence
from app.schemas import SentenceOut, SentenceUpdate

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
