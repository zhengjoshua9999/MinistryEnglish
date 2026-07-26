from datetime import date, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import DailyActivity

GRANULARITIES = ("day", "week", "month")


def bump(db: Session, **fields: int) -> None:
    """今天这行 +1（或 +N），行不存在就先建。两个请求前后脚都想建今天这行时，
    数据库主键冲突兜底：谁先落库谁算数，后到的直接回退去更新已经建好的那行。"""
    today = date.today().isoformat()
    row = db.get(DailyActivity, today)
    if row is None:
        row = DailyActivity(date=today)
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            row = db.get(DailyActivity, today)

    for field, amount in fields.items():
        setattr(row, field, getattr(row, field) + amount)
    db.commit()


def _bucket_start(d: date, granularity: str) -> date:
    if granularity == "day":
        return d
    if granularity == "week":
        return d - timedelta(days=d.weekday())  # 周一
    if granularity == "month":
        return d.replace(day=1)
    raise ValueError(f"bad granularity: {granularity}")


def _bucket_key(d: date, granularity: str) -> str:
    start = _bucket_start(d, granularity)
    return start.strftime("%Y-%m") if granularity == "month" else start.isoformat()


def _label(start: date, granularity: str) -> str:
    if granularity == "day":
        return start.strftime("%m-%d")
    if granularity == "week":
        end = start + timedelta(days=6)
        return f"{start.strftime('%m-%d')}~{end.strftime('%m-%d')}"
    return start.strftime("%Y-%m")


def _recent_bucket_starts(granularity: str, limit: int) -> list[date]:
    today = date.today()
    if granularity == "day":
        return [today - timedelta(days=i) for i in range(limit)]
    if granularity == "week":
        this_monday = today - timedelta(days=today.weekday())
        return [this_monday - timedelta(weeks=i) for i in range(limit)]
    if granularity == "month":
        starts = []
        y, m = today.year, today.month
        for _ in range(limit):
            starts.append(date(y, m, 1))
            m -= 1
            if m == 0:
                m, y = 12, y - 1
        return starts
    raise ValueError(f"bad granularity: {granularity}")


def query_stats(db: Session, granularity: str, limit: int) -> list[dict]:
    if granularity not in GRANULARITIES:
        raise ValueError(f"bad granularity: {granularity}")

    bucket_starts = _recent_bucket_starts(granularity, limit)
    earliest = min(bucket_starts)

    rows = db.query(DailyActivity).filter(DailyActivity.date >= earliest.isoformat()).all()

    sums: dict[str, dict[str, int]] = {}
    for row in rows:
        d = date.fromisoformat(row.date)
        key = _bucket_key(d, granularity)
        bucket = sums.setdefault(key, {"study_seconds": 0, "dictation_count": 0, "shadow_count": 0, "new_word_count": 0})
        bucket["study_seconds"] += row.study_seconds
        bucket["dictation_count"] += row.dictation_count
        bucket["shadow_count"] += row.shadow_count
        bucket["new_word_count"] += row.new_word_count

    out = []
    for start in bucket_starts:
        key = _bucket_key(start, granularity)
        totals = sums.get(key, {"study_seconds": 0, "dictation_count": 0, "shadow_count": 0, "new_word_count": 0})
        out.append({"period": key, "label": _label(start, granularity), **totals})
    return out
