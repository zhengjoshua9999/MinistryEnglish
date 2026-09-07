from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import DB_PATH

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def migrate_vocab_schedule():
    """为旧安装补齐学习排程字段。

    这是当前应用的轻量、幂等迁移入口。新词保持 due_at=NULL，避免把「待首次
    学习」混进「到期复习」；已经被旧版四档实现复习过的词则保留原到期时间。
    """
    inspector = inspect(engine)
    if "vocab_word" not in inspector.get_table_names():
        return
    activity_cols = {c["name"] for c in inspector.get_columns("daily_activity")}
    with engine.begin() as conn:
        if "vocab_learned_count" not in activity_cols:
            conn.execute(text("ALTER TABLE daily_activity ADD COLUMN vocab_learned_count INTEGER NOT NULL DEFAULT 0"))
        if "vocab_review_count" not in activity_cols:
            conn.execute(text("ALTER TABLE daily_activity ADD COLUMN vocab_review_count INTEGER NOT NULL DEFAULT 0"))

    cols = {c["name"] for c in inspector.get_columns("vocab_word")}
    additions = {
        "reps": "INTEGER NOT NULL DEFAULT 0",
        "lapses": "INTEGER NOT NULL DEFAULT 0",
        "ease": "FLOAT NOT NULL DEFAULT 2.5",
        "interval_days": "FLOAT NOT NULL DEFAULT 0",
        "memory_stage": "INTEGER NOT NULL DEFAULT 0",
        "known_streak": "INTEGER NOT NULL DEFAULT 0",
        "due_at": "DATETIME",
        "first_learned_at": "DATETIME",
        "last_reviewed_at": "DATETIME",
        "last_rating": "VARCHAR",
        "suspended_at": "DATETIME",
    }
    with engine.begin() as conn:
        for name, ddl in additions.items():
            if name not in cols:
                conn.execute(text(f"ALTER TABLE vocab_word ADD COLUMN {name} {ddl}"))
        # 上一版迁移曾把所有新词的 due_at 写成当前时间，这里恢复正确语义。
        conn.execute(text("UPDATE vocab_word SET due_at = NULL WHERE last_reviewed_at IS NULL AND status = 'new'"))
        # 旧版没有逐次复习日志和每日学习统计；在首次迁移时从最后一次旧版记录做一次
        # 最佳努力的回填。随后 first_learned_at 会被写入，因此重复启动不会重复累计。
        legacy_counts = conn.execute(text("""
            SELECT date(last_reviewed_at) AS date,
                   SUM(CASE WHEN COALESCE(reps, 0) <= 1 THEN 1 ELSE 0 END) AS learned,
                   SUM(CASE WHEN COALESCE(reps, 0) > 1 THEN 1 ELSE 0 END) AS reviewed
            FROM vocab_word
            WHERE last_reviewed_at IS NOT NULL AND first_learned_at IS NULL
            GROUP BY date(last_reviewed_at)
        """)).mappings()
        for row in legacy_counts:
            conn.execute(text("""
                INSERT INTO daily_activity
                  (date, study_seconds, dictation_count, shadow_count, new_word_count,
                   vocab_learned_count, vocab_review_count)
                VALUES (:date, 0, 0, 0, 0, :learned, :reviewed)
                ON CONFLICT(date) DO UPDATE SET
                    vocab_learned_count = vocab_learned_count + excluded.vocab_learned_count,
                    vocab_review_count = vocab_review_count + excluded.vocab_review_count
            """), {"date": row["date"], "learned": row["learned"], "reviewed": row["reviewed"]})
        # 兼容旧的手动状态：已掌握词从 60 天阶段开始，次日做一次校准；
        # 手动标为复习中的词立即进入到期队列。
        conn.execute(text("""
            UPDATE vocab_word
            SET memory_stage = 6,
                known_streak = 3,
                first_learned_at = COALESCE(first_learned_at, created_at),
                due_at = datetime('now', '+1 day')
            WHERE last_reviewed_at IS NULL AND status = 'mastered' AND first_learned_at IS NULL
        """))
        conn.execute(text("""
            UPDATE vocab_word
            SET memory_stage = CASE WHEN memory_stage = 0 THEN 1 ELSE memory_stage END,
                first_learned_at = COALESCE(first_learned_at, created_at),
                due_at = COALESCE(due_at, datetime('now'))
            WHERE last_reviewed_at IS NULL AND status = 'reviewing'
        """))
        # 已经用旧版 SM-2 评价过的词映射到最接近的阶段。
        conn.execute(text("""
            UPDATE vocab_word
            SET first_learned_at = COALESCE(first_learned_at, last_reviewed_at),
                memory_stage = CASE
                    WHEN interval_days >= 120 THEN 7
                    WHEN interval_days >= 60 THEN 6
                    WHEN interval_days >= 30 THEN 5
                    WHEN interval_days >= 15 THEN 4
                    WHEN interval_days >= 7 THEN 3
                    WHEN interval_days >= 3 THEN 2
                    WHEN interval_days >= 1 THEN 1
                    ELSE 0 END,
                known_streak = CASE WHEN reps > 3 THEN 3 ELSE reps END
            WHERE last_reviewed_at IS NOT NULL AND first_learned_at IS NULL
        """))
        conn.execute(text("""
            UPDATE vocab_word
            SET status = CASE
                WHEN memory_stage >= 6 AND known_streak >= 3 THEN 'mastered'
                ELSE 'reviewing' END
            WHERE last_reviewed_at IS NOT NULL
        """))
