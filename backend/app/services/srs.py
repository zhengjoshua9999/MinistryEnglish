from datetime import datetime, timedelta
from typing import Optional

RATINGS = ("known", "fuzzy", "unknown")
# 各阶段复习间隔（天），按本地自然日对齐：首学第二天统一复习，之后按此递增。
STAGE_INTERVALS_DAYS = (1, 2, 3, 7, 14, 30)
MASTER_STAGE = len(STAGE_INTERVALS_DAYS) - 1
MIN_INTERVAL_DAYS = 1


def day_start(reference: Optional[datetime] = None) -> datetime:
    """本地自然日的起点（当天 00:00）。"""
    reference = reference or datetime.now()
    return reference.replace(hour=0, minute=0, second=0, microsecond=0)


def due_at_for(reference: datetime, interval_days: int) -> datetime:
    """以 reference 所在自然日的 00:00 为基准，加上间隔天数，得到某天 00:00（本地）。"""
    return day_start(reference) + timedelta(days=interval_days)


def apply_review(word, rating: str, now: Optional[datetime] = None) -> None:
    """按本地自然日 + 整天间隔更新排程。

    新词首学：无论评分，统一安排到「次日」复习（due 对齐到第二天 00:00）；
    之后的复习按 known/fuzzy/unknown 递增整天间隔，绝不安排当天/按小时复习。
    """
    if rating not in RATINGS:
        raise ValueError(f"bad rating: {rating}")
    now = now or datetime.now()
    stage = max(0, min(int(word.memory_stage or 0), MASTER_STAGE))

    first = word.first_learned_at is None
    if first:
        word.first_learned_at = now

    if first:
        # 首学：一律第二天复习，按评分只影响初始阶段与强弱标记。
        if rating == "known":
            word.memory_stage = 1
            word.known_streak = 1
        elif rating == "unknown":
            word.memory_stage = 0
            word.known_streak = 0
            word.lapses = (word.lapses or 0) + 1
        else:  # fuzzy
            word.memory_stage = 0
            word.known_streak = 0
        interval_days = MIN_INTERVAL_DAYS
    else:
        if rating == "known":
            stage = min(stage + 1, MASTER_STAGE)
            word.known_streak = (word.known_streak or 0) + 1
            interval_days = STAGE_INTERVALS_DAYS[stage]
        elif rating == "fuzzy":
            word.known_streak = 0
            interval_days = max(MIN_INTERVAL_DAYS, STAGE_INTERVALS_DAYS[stage] // 2)
        else:
            word.lapses = (word.lapses or 0) + 1
            word.known_streak = 0
            stage = 0
            interval_days = MIN_INTERVAL_DAYS
        word.memory_stage = stage

    word.reps = (word.reps or 0) + 1
    word.last_reviewed_at = now
    word.last_rating = rating
    word.interval_days = float(interval_days)
    word.due_at = due_at_for(now, interval_days)
    word.status = "mastered" if word.memory_stage >= MASTER_STAGE and word.known_streak >= 3 else "reviewing"


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
