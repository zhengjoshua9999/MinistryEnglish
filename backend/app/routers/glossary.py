from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import GlossaryTerm
from app.schemas import GlossaryTermIn, GlossaryTermOut

router = APIRouter(tags=["glossary"])


@router.get("/glossary", response_model=list[GlossaryTermOut])
def list_terms(db: Session = Depends(get_db)):
    return db.query(GlossaryTerm).order_by(GlossaryTerm.term).all()


@router.post("/glossary", response_model=GlossaryTermOut)
def add_term(payload: GlossaryTermIn, db: Session = Depends(get_db)):
    if db.query(GlossaryTerm).filter(GlossaryTerm.term == payload.term).first():
        raise HTTPException(400, "该术语已存在")
    term = GlossaryTerm(term=payload.term, note=payload.note)
    db.add(term)
    db.commit()
    db.refresh(term)
    return term


@router.delete("/glossary/{term_id}")
def delete_term(term_id: int, db: Session = Depends(get_db)):
    term = db.get(GlossaryTerm, term_id)
    if not term:
        raise HTTPException(404, "找不到该术语")
    db.delete(term)
    db.commit()
    return {"ok": True}
