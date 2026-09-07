from datetime import datetime, timedelta
from typing import Optional

MASTERED_DAYS = 30.0
MAX_INTERVAL_DAYS = 365.0
RATINGS = ("again", "hard", "good", "easy")


def apply_review(word, rating: str, now: Optional[datetime] = None) -> None:
    """SM-2 简化版：按 Again/Hard/Good/Easy 更新 ease/interval/due_at，并推导 status。"""
    now = now or datetime.utcnow()
    prev = word.interval_days or 0.0

    if rating == "again":
        word.lapses += 1
        word.reps = 0
        word.ease = max(1.3, word.ease - 0.2)
        word.interval_days = 1.0
    elif rating == "hard":
        word.reps += 1
        word.ease = max(1.3, word.ease - 0.15)
        word.interval_days = max(1.0, round(prev * 1.2, 1)) if prev else 1.0
    elif rating == "good":
        word.reps += 1
        word.interval_days = round(prev * word.ease, 1) if prev else 1.0
    elif rating == "easy":
        word.reps += 1
        word.ease += 0.15
        word.interval_days = round(prev * word.ease * 1.3, 1) if prev else 1.0
    else:
        raise ValueError(f"bad rating: {rating}")

    word.interval_days = min(word.interval_days, MAX_INTERVAL_DAYS)
    word.last_reviewed_at = now
    word.due_at = now + timedelta(days=word.interval_days)
    word.status = "mastered" if word.interval_days >= MASTERED_DAYS else "reviewing"


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
        "weak": bool(weak_count and weak_count > 0),
        "weak_count": weak_count or 0,
        "interval_days": word.interval_days,
        "due_at": word.due_at.isoformat() if word.due_at else None,
    }
