from datetime import datetime

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MediaFile(Base):
    __tablename__ = "media_file"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String)
    original_name: Mapped[str] = mapped_column(String)
    duration_sec: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String, default="uploaded")  # uploaded/transcribing/ready/error
    progress: Mapped[float] = mapped_column(Float, default=0.0)  # 0~1，转写进度条读这个
    error_message: Mapped[str] = mapped_column(String, default="")
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
    media_id: Mapped[int] = mapped_column(ForeignKey("media_file.id"))
    sentence_id: Mapped[int] = mapped_column(ForeignKey("sentence.id"))
    context_text: Mapped[str] = mapped_column(Text, default="")
    definition: Mapped[str] = mapped_column(Text, default="")
    translation: Mapped[str] = mapped_column(String, default="")
    context_audio_path: Mapped[str] = mapped_column(String, default="")
    us_audio_path: Mapped[str] = mapped_column(String, default="")
    uk_audio_path: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="new")  # new/reviewing/mastered
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
