from datetime import datetime, timedelta
from typing import Optional

RATINGS = ("known", "fuzzy", "unknown")
STAGE_INTERVALS = (
    timedelta(minutes=10),
    timedelta(days=1),
    timedelta(days=3),
    timedelta(days=7),
    timedelta(days=15),
    timedelta(days=30),
    timedelta(days=60),
    timedelta(days=120),
)


def apply_review(word, rating: str, now: Optional[datetime] = None) -> None:
    """按阶段间隔和三档自评更新排程；所有时间均为 naive UTC。"""
    if rating not in RATINGS:
        raise ValueError(f"bad rating: {rating}")
    now = now or datetime.utcnow()
    stage = max(0, min(int(word.memory_stage or 0), len(STAGE_INTERVALS) - 1))

    if word.first_learned_at is None:
        word.first_learned_at = now

    if rating == "known":
        stage = min(stage + 1, len(STAGE_INTERVALS) - 1)
        word.known_streak = (word.known_streak or 0) + 1
        interval = STAGE_INTERVALS[stage]
    elif rating == "fuzzy":
        word.known_streak = 0
        base = STAGE_INTERVALS[stage]
        interval = timedelta(minutes=10) if stage == 0 else max(timedelta(days=1), base / 2)
    else:
        word.lapses = (word.lapses or 0) + 1
        word.known_streak = 0
        stage = 0
        interval = STAGE_INTERVALS[0]

    word.memory_stage = stage
    word.reps = (word.reps or 0) + 1
    word.interval_days = interval.total_seconds() / 86400
    word.last_reviewed_at = now
    word.last_rating = rating
    word.due_at = now + interval
    word.status = "mastered" if stage >= 6 and word.known_streak >= 3 else "reviewing"


def derive_card(word, weak_count: int = 0) -> dict:
    return {
        "id": word.id,
        "word": word.word,
        "pos": word.pos,
        "definition": word.definition,
        "translation": word.translation,
        "context_text": word.context_text,
        "context_audio_path": word.context_audio_path,
        "us_audio_path": word.us_audio_path,
        "uk_audio_path": word.uk_audio_path,
        "status": word.status,
        "pronunciation_weak": bool(weak_count and weak_count > 0),
        "weak_count": weak_count or 0,
        "memory_stage": word.memory_stage,
        "interval_days": word.interval_days,
        "due_at": word.due_at.isoformat() if word.due_at else None,
    }
