from datetime import datetime
from typing import Optional

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Category(Base):
    """媒体文件的分类，纯逻辑分组——文件本身还是放在 data/media/ 下用 UUID 命名，
    不对应真实的磁盘子目录，改分类名字、删分类都不需要挪文件。"""

    __tablename__ = "category"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class MediaFile(Base):
    __tablename__ = "media_file"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String)
    original_name: Mapped[str] = mapped_column(String)
    duration_sec: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String, default="uploaded")  # uploaded/transcribing/ready/error
    progress: Mapped[float] = mapped_column(Float, default=0.0)  # 0~1，转写进度条读这个
    error_message: Mapped[str] = mapped_column(String, default="")
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("category.id"), default=None)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    sentences: Mapped[list["Sentence"]] = relationship(back_populates="media", cascade="all, delete-orphan")


class Sentence(Base):
    __tablename__ = "sentence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    media_id: Mapped[int] = mapped_column(ForeignKey("media_file.id"))
    idx: Mapped[int] = mapped_column(Integer)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    text_raw: Mapped[str] = mapped_column(Text)
    text_polished: Mapped[str] = mapped_column(Text, default="")

    media: Mapped["MediaFile"] = relationship(back_populates="sentences")


class GlossaryTerm(Base):
    __tablename__ = "glossary_term"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    term: Mapped[str] = mapped_column(String, unique=True)
    note: Mapped[str] = mapped_column(String, default="")


class PracticeAttempt(Base):
    __tablename__ = "practice_attempt"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sentence_id: Mapped[int] = mapped_column(ForeignKey("sentence.id"))
    audio_path: Mapped[str] = mapped_column(String)
    scored: Mapped[bool] = mapped_column(default=False)
    accuracy: Mapped[float] = mapped_column(Float, default=0.0)
    fluency: Mapped[float] = mapped_column(Float, default=0.0)
    completeness: Mapped[float] = mapped_column(Float, default=0.0)
    pron_score: Mapped[float] = mapped_column(Float, default=0.0)
    word_scores_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class WeakWordCount(Base):
    """跟读录音只保留最后一条，PracticeAttempt 历史会被覆盖删除，不能靠回扫历史录音来判断
    "这个词是不是老读不准"。这张表是独立于录音记录之外、持续累加的计数器：每次评分只要
    这个词准确度低于阈值，不管是哪一句、录音后来有没有被替换掉，计数只增不减。"""

    __tablename__ = "weak_word_count"

    word_norm: Mapped[str] = mapped_column(String, primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)


class DailyActivity(Base):
    """按天累加的活动日志，供首页统计表读取。不从 practice_attempt / vocab_word 现算——
    删掉一个生词、替换一条录音都不该让历史某天的统计数字跟着回退，统计记的是"那天发生过"，
    不是"现在还留着"。日 / 周 / 月视图都是查询时在这张表上现算汇总，不另外维护周表月表。"""

    __tablename__ = "daily_activity"

    date: Mapped[str] = mapped_column(String, primary_key=True)  # "YYYY-MM-DD"
    study_seconds: Mapped[int] = mapped_column(Integer, default=0)
    dictation_count: Mapped[int] = mapped_column(Integer, default=0)
    shadow_count: Mapped[int] = mapped_column(Integer, default=0)
    new_word_count: Mapped[int] = mapped_column(Integer, default=0)


class VocabWord(Base):
    __tablename__ = "vocab_word"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    word: Mapped[str] = mapped_column(String)
    word_norm: Mapped[str] = mapped_column(String, unique=True)
    media_id: Mapped[Optional[int]] = mapped_column(ForeignKey("media_file.id"), nullable=True)
    sentence_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sentence.id"), nullable=True)
    source_type: Mapped[str] = mapped_column(String, default="media")  # media/book
    book_paragraph_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("book_paragraph.id"), default=None, nullable=True
    )
    context_text: Mapped[str] = mapped_column(Text, default="")
    definition: Mapped[str] = mapped_column(Text, default="")
    translation: Mapped[str] = mapped_column(String, default="")
    pos: Mapped[str] = mapped_column(String, default="")  # 这个词在标记时那句话里的词性，如 "n." "v."
    context_audio_path: Mapped[str] = mapped_column(String, default="")
    us_audio_path: Mapped[str] = mapped_column(String, default="")
    uk_audio_path: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="new")  # new/reviewing/mastered
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class Book(Base):
    __tablename__ = "book"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String)
    english_filename: Mapped[str] = mapped_column(String)
    chinese_filename: Mapped[str] = mapped_column(String)
    english_original_name: Mapped[str] = mapped_column(String)
    chinese_original_name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="review")  # review/published/error
    error_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    chapters: Mapped[list["BookChapter"]] = relationship(
        back_populates="book", cascade="all, delete-orphan", order_by="BookChapter.idx"
    )
    groups: Mapped[list["ReadingGroup"]] = relationship(
        back_populates="book", cascade="all, delete-orphan", order_by="ReadingGroup.idx"
    )


class BookChapter(Base):
    __tablename__ = "book_chapter"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("book.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String)

    book: Mapped["Book"] = relationship(back_populates="chapters")
    paragraphs: Mapped[list["BookParagraph"]] = relationship(
        back_populates="chapter", cascade="all, delete-orphan", order_by="BookParagraph.idx"
    )


class BookParagraph(Base):
    __tablename__ = "book_paragraph"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("book_chapter.id"), index=True)
    language: Mapped[str] = mapped_column(String)  # en/zh
    idx: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String, default="paragraph")  # paragraph/heading/note/ignored

    chapter: Mapped["BookChapter"] = relationship(back_populates="paragraphs")


class ReadingGroup(Base):
    __tablename__ = "reading_group"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("book.id"), index=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("book_chapter.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    english_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    chinese_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    alignment_type: Mapped[str] = mapped_column(String, default="one_to_one")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String, default="pending_review")
    note: Mapped[str] = mapped_column(Text, default="")

    book: Mapped["Book"] = relationship(back_populates="groups")


class ReadingProgress(Base):
    __tablename__ = "reading_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 一本书只保留一条阅读进度；unique 自带索引，无需再 index=True
    book_id: Mapped[int] = mapped_column(ForeignKey("book.id"), unique=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("book_chapter.id"))
    group_idx: Mapped[int] = mapped_column(Integer, default=0)
    study_seconds: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
