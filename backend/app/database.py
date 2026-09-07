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
    """给旧安装的 vocab_word 补上间隔重复（SRS）排程字段；同时让已有词立即到期，避免被淹没。"""
    inspector = inspect(engine)
    if "vocab_word" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("vocab_word")}
    additions = {
        "reps": "INTEGER NOT NULL DEFAULT 0",
        "lapses": "INTEGER NOT NULL DEFAULT 0",
        "ease": "FLOAT NOT NULL DEFAULT 2.5",
        "interval_days": "FLOAT NOT NULL DEFAULT 0",
        "due_at": "DATETIME",
        "last_reviewed_at": "DATETIME",
    }
    with engine.begin() as conn:
        for name, ddl in additions.items():
            if name not in cols:
                conn.execute(text(f"ALTER TABLE vocab_word ADD COLUMN {name} {ddl}"))
        conn.execute(text("UPDATE vocab_word SET due_at = COALESCE(due_at, datetime('now'))"))
