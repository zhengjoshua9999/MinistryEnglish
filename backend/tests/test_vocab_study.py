import unittest
from datetime import datetime, timedelta

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app import database
from app.database import Base
from app.models import DailyActivity, VocabReviewLog, VocabWord
from app.routers.vocab import create_study_session, review_session_word
from app.schemas import ReviewIn, StudySessionCreate
from app.services import srs


def word(name: str) -> VocabWord:
    return VocabWord(word=name, word_norm=name, status="new")


class SchedulingTests(unittest.TestCase):
    def test_three_rating_schedule(self):
        now = datetime(2026, 9, 7, 4, 0)
        item = word("life")

        srs.apply_review(item, "known", now)
        self.assertEqual(item.memory_stage, 1)
        self.assertEqual(item.due_at, now + timedelta(days=1))
        self.assertEqual(item.status, "reviewing")

        srs.apply_review(item, "fuzzy", now)
        self.assertEqual(item.memory_stage, 1)
        self.assertEqual(item.due_at, now + timedelta(days=1))
        self.assertEqual(item.known_streak, 0)

        srs.apply_review(item, "unknown", now)
        self.assertEqual(item.memory_stage, 0)
        self.assertEqual(item.due_at, now + timedelta(minutes=10))
        self.assertEqual(item.lapses, 1)

    def test_mastered_requires_stage_and_streak(self):
        item = word("dispensing")
        item.memory_stage = 5
        item.known_streak = 2
        srs.apply_review(item, "known", datetime(2026, 9, 7))
        self.assertEqual(item.memory_stage, 6)
        self.assertEqual(item.known_streak, 3)
        self.assertEqual(item.status, "mastered")


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add_all([word(f"word-{index}") for index in range(6)])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_default_new_group_is_five_and_unknown_reappears(self):
        session = create_study_session(StudySessionCreate(mode="new"), self.db)
        self.assertEqual(session.total, 5)
        self.assertIsNotNone(session.current_card)

        current = session.current_card
        result = review_session_word(
            session.id,
            ReviewIn(vocab_id=current.id, rating="unknown", response_ms=900),
            self.db,
        )
        self.assertEqual(result.total, 6)
        self.assertEqual(self.db.query(VocabReviewLog).count(), 1)
        activity = self.db.query(DailyActivity).one()
        self.assertEqual(activity.vocab_learned_count, 1)
        self.assertEqual(activity.vocab_review_count, 0)

    def test_default_review_group_is_ten_and_active_session_resumes(self):
        now = datetime.utcnow()
        due_words = []
        for index in range(12):
            item = word(f"due-{index}")
            item.status = "reviewing"
            item.first_learned_at = now - timedelta(days=2)
            item.last_reviewed_at = now - timedelta(days=2)
            item.due_at = now - timedelta(days=1)
            due_words.append(item)
        self.db.add_all(due_words)
        self.db.commit()

        first = create_study_session(StudySessionCreate(mode="due"), self.db)
        resumed = create_study_session(StudySessionCreate(mode="due"), self.db)
        self.assertEqual(first.total, 10)
        self.assertEqual(resumed.id, first.id)
        self.assertEqual(resumed.current_card.id, first.current_card.id)


class MigrationTests(unittest.TestCase):
    def test_old_new_words_do_not_become_due_reviews(self):
        old_engine = create_engine("sqlite:///:memory:")
        with old_engine.begin() as connection:
            connection.execute(text("CREATE TABLE vocab_word (id INTEGER PRIMARY KEY, status VARCHAR, created_at DATETIME)"))
            connection.execute(text("CREATE TABLE daily_activity (date VARCHAR PRIMARY KEY)"))
            connection.execute(text("INSERT INTO vocab_word VALUES (1, 'new', '2026-09-01 00:00:00')"))
            connection.execute(text("INSERT INTO vocab_word VALUES (2, 'mastered', '2026-09-01 00:00:00')"))

        original_engine = database.engine
        database.engine = old_engine
        try:
            database.migrate_vocab_schedule()
        finally:
            database.engine = original_engine

        columns = {column["name"] for column in inspect(old_engine).get_columns("vocab_word")}
        self.assertIn("memory_stage", columns)
        with old_engine.connect() as connection:
            new_due = connection.execute(text("SELECT due_at FROM vocab_word WHERE id = 1")).scalar()
            mastered = connection.execute(text("SELECT memory_stage, due_at FROM vocab_word WHERE id = 2")).one()
        self.assertIsNone(new_due)
        self.assertEqual(mastered.memory_stage, 6)
        self.assertIsNotNone(mastered.due_at)

        first_due = mastered.due_at
        database.engine = old_engine
        try:
            database.migrate_vocab_schedule()
        finally:
            database.engine = original_engine
        with old_engine.connect() as connection:
            second_due = connection.execute(text("SELECT due_at FROM vocab_word WHERE id = 2")).scalar()
        self.assertEqual(second_due, first_due)
        old_engine.dispose()

    def test_legacy_reviews_backfill_daily_vocab_counts_once(self):
        old_engine = create_engine("sqlite:///:memory:")
        with old_engine.begin() as connection:
            connection.execute(text("CREATE TABLE vocab_word (id INTEGER PRIMARY KEY, status VARCHAR, created_at DATETIME, reps INTEGER, last_reviewed_at DATETIME)"))
            connection.execute(text("CREATE TABLE daily_activity (date VARCHAR PRIMARY KEY)"))
            connection.execute(text("INSERT INTO vocab_word VALUES (1, 'reviewing', '2026-09-01', 1, '2026-09-07 08:00:00')"))
            connection.execute(text("INSERT INTO vocab_word VALUES (2, 'reviewing', '2026-09-01', 2, '2026-09-07 08:00:00')"))

        original_engine = database.engine
        database.engine = old_engine
        try:
            database.migrate_vocab_schedule()
            database.migrate_vocab_schedule()
        finally:
            database.engine = original_engine

        with old_engine.connect() as connection:
            activity = connection.execute(text("SELECT vocab_learned_count, vocab_review_count FROM daily_activity WHERE date = '2026-09-07'")).one()
        self.assertEqual(tuple(activity), (1, 1))
        old_engine.dispose()


if __name__ == "__main__":
    unittest.main()
