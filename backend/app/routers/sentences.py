from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Sentence
from app.schemas import SentenceOut

router = APIRouter(tags=["sentences"])


@router.get("/sentences/{sentence_id}", response_model=SentenceOut)
def get_sentence(sentence_id: int, db: Session = Depends(get_db)):
    s = db.get(Sentence, sentence_id)
    if not s:
        raise HTTPException(404, "找不到该句子")
    return s
