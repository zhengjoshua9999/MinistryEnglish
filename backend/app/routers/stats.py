from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Sentence
from app.schemas import DailyActivityOut, StudyTimeIn
from app.services import stats_service

router = APIRouter(tags=["stats"])

MAX_HEARTBEAT_SECONDS = 3600  # 单次上报的安全上限，防止异常客户端报出离谱的数字

DEFAULT_LIMIT = {"day": 14, "week": 8, "month": 6}
MAX_LIMIT = 366  # 一年的天数，week/month 场景下这个上限更是绰绰有余


@router.get("/stats", response_model=list[DailyActivityOut])
def get_stats(
    granularity: Literal["day", "week", "month"] = "day",
    limit: Optional[int] = Query(None, ge=1, le=MAX_LIMIT),
    db: Session = Depends(get_db),
):
    return stats_service.query_stats(db, granularity, limit or DEFAULT_LIMIT[granularity])


@router.post("/stats/study-time")
def report_study_time(payload: StudyTimeIn, db: Session = Depends(get_db)):
    seconds = max(0, min(payload.seconds, MAX_HEARTBEAT_SECONDS))
    if seconds:
        stats_service.bump(db, study_seconds=seconds)
    return {"ok": True}


@router.post("/sentences/{sentence_id}/dictation-check")
def dictation_check(sentence_id: int, db: Session = Depends(get_db)):
    sentence = db.get(Sentence, sentence_id)
    if not sentence:
        raise HTTPException(404, "找不到该句子")
    stats_service.bump(db, dictation_count=1)
    return {"ok": True}
