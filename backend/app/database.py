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


def migrate_schema():
    """Small idempotent migration for installs created before the reading module.

    SQLite cannot change a column from NOT NULL to nullable in place, so the
    existing vocab table is rebuilt once when necessary. Existing rows are
    copied verbatim and keep their media source.
    """
    inspector = inspect(engine)
    if "vocab_word" not in inspector.get_table_names():
        return

    columns = {column["name"]: column for column in inspector.get_columns("vocab_word")}
    needs_rebuild = (
        "source_type" not in columns
        or "book_paragraph_id" not in columns
        or columns.get("media_id", {}).get("nullable") is False
        or columns.get("sentence_id", {}).get("nullable") is False
    )
    if not needs_rebuild:
        return

    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=OFF"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS vocab_word_new (
                id INTEGER PRIMARY KEY,
                word VARCHAR NOT NULL,
                word_norm VARCHAR NOT NULL UNIQUE,
                media_id INTEGER NULL REFERENCES media_file(id),
                sentence_id INTEGER NULL REFERENCES sentence(id),
                source_type VARCHAR NOT NULL DEFAULT 'media',
                book_paragraph_id INTEGER NULL REFERENCES book_paragraph(id),
                context_text TEXT NOT NULL DEFAULT '',
                definition TEXT NOT NULL DEFAULT '',
                translation VARCHAR NOT NULL DEFAULT '',
                pos VARCHAR NOT NULL DEFAULT '',
                context_audio_path VARCHAR NOT NULL DEFAULT '',
                us_audio_path VARCHAR NOT NULL DEFAULT '',
                uk_audio_path VARCHAR NOT NULL DEFAULT '',
                status VARCHAR NOT NULL DEFAULT 'new',
                created_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            INSERT OR IGNORE INTO vocab_word_new
              (id, word, word_norm, media_id, sentence_id, source_type,
               context_text, definition, translation, pos, context_audio_path,
               us_audio_path, uk_audio_path, status, created_at)
            SELECT id, word, word_norm, media_id, sentence_id, 'media',
              context_text, definition, translation, pos, context_audio_path,
              us_audio_path, uk_audio_path, status, created_at
            FROM vocab_word
        """))
        conn.execute(text("DROP TABLE vocab_word"))
        conn.execute(text("ALTER TABLE vocab_word_new RENAME TO vocab_word"))
        conn.execute(text("PRAGMA foreign_keys=ON"))


def migrate_reading_progress():
    """确保 reading_progress 一本书只有一条记录。

    旧安装里保存端点用 .first() 却没有唯一约束，可能攒出多条同书进度。
    这里重建表、给 book_id 加 UNIQUE，每个书只保留最新一条。
    """
    inspector = inspect(engine)
    if "reading_progress" not in inspector.get_table_names():
        return
    unique_constraints = inspector.get_unique_constraints("reading_progress")
    if any("book_id" in (constraint.get("column_names") or []) for constraint in unique_constraints):
        return

    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=OFF"))
        conn.execute(text("""
            CREATE TABLE reading_progress_new (
                id INTEGER PRIMARY KEY,
                book_id INTEGER NOT NULL UNIQUE REFERENCES book(id),
                chapter_id INTEGER NOT NULL REFERENCES book_chapter(id),
                group_idx INTEGER NOT NULL DEFAULT 0,
                study_seconds INTEGER NOT NULL DEFAULT 0,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            INSERT INTO reading_progress_new
              (id, book_id, chapter_id, group_idx, study_seconds, updated_at)
            SELECT id, book_id, chapter_id, group_idx, study_seconds, updated_at
            FROM reading_progress
            WHERE id IN (SELECT MAX(id) FROM reading_progress GROUP BY book_id)
        """))
        conn.execute(text("DROP TABLE reading_progress"))
        conn.execute(text("ALTER TABLE reading_progress_new RENAME TO reading_progress"))
        conn.execute(text("PRAGMA foreign_keys=ON"))
