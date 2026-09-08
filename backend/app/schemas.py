from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class CategoryUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class MediaFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    original_name: str
    duration_sec: float
    status: str
    progress: float
    error_message: str
    category_id: Optional[int] = None
    created_at: datetime


class MediaCategoryUpdate(BaseModel):
    category_id: Optional[int] = None


class SentenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    media_id: int
    idx: int
    start_ms: int
    end_ms: int
    text_raw: str
    text_polished: str


class SentenceUpdate(BaseModel):
    text_polished: str = Field(min_length=1, max_length=2000)


class SentenceCorrection(BaseModel):
    id: int
    text: str


class SentenceCorrections(BaseModel):
    corrections: list[SentenceCorrection] = Field(default_factory=list)


class PracticeAttemptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sentence_id: int
    audio_path: str
    scored: bool
    accuracy: float
    fluency: float
    completeness: float
    pron_score: float
    word_scores_json: str
    created_at: datetime
    weak_word_suggestions: list[str] = Field(default_factory=list)


class VocabWordCreate(BaseModel):
    word: str
    sentence_id: Optional[int] = None
    context_text: Optional[str] = None


class VocabWordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    word: str
    media_id: Optional[int] = None
    sentence_id: Optional[int] = None
    source_type: str
    context_text: str
    definition: str
    translation: str
    pos: str
    context_audio_path: str
    us_audio_path: str
    uk_audio_path: str
    status: str
    created_at: datetime


class VocabStatusUpdate(BaseModel):
    status: str


class StudyCardOut(BaseModel):
    id: int
    word: str
    pos: str = ""
    definition: str = ""
    translation: str = ""
    context_text: str = ""
    context_audio_path: str = ""
    us_audio_path: str = ""
    uk_audio_path: str = ""
    status: str = "new"
    pronunciation_weak: bool = False
    weak_count: int = 0
    memory_stage: int = 0
    interval_days: float = 0.0
    due_at: Optional[str] = None


class StudySettingsOut(BaseModel):
    new_group_size: int
    review_group_size: int
    daily_new_limit: int
    autoplay_audio: bool
    preferred_audio: str
    show_context_during_recall: bool


class StudySettingsUpdate(BaseModel):
    new_group_size: Optional[int] = Field(None, ge=5, le=50)
    review_group_size: Optional[int] = Field(None, ge=5, le=100)
    daily_new_limit: Optional[int] = Field(None, ge=0, le=200)
    autoplay_audio: Optional[bool] = None
    preferred_audio: Optional[Literal["us", "uk", "context"]] = None
    show_context_during_recall: Optional[bool] = None


class StudySummaryOut(BaseModel):
    new: int
    available_new: int
    due: int
    reviewing: int
    mastered: int
    total: int
    settings: StudySettingsOut
    active_session_id: Optional[str] = None


class ReviewIn(BaseModel):
    vocab_id: Optional[int] = None
    rating: Literal["known", "fuzzy", "unknown"]
    response_ms: Optional[int] = Field(None, ge=0, le=3_600_000)


class ReviewResultOut(BaseModel):
    id: int
    status: str
    reps: int
    lapses: int
    memory_stage: int
    known_streak: int
    interval_days: float
    due_at: Optional[str] = None


class StudySessionCreate(BaseModel):
    mode: Literal["new", "due"]


class StudySessionOut(BaseModel):
    id: str
    mode: str
    current_card: Optional[StudyCardOut] = None
    current_number: int
    total: int
    unique_total: int
    unique_done: int
    repeat_count: int
    completed: bool
    ratings: dict[str, int]


class GlossaryTermIn(BaseModel):
    term: str
    note: str = ""


class GlossaryTermOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    term: str
    note: str


class StudyTimeIn(BaseModel):
    seconds: int


class DailyActivityOut(BaseModel):
    period: str
    label: str
    study_seconds: int
    dictation_count: int
    shadow_count: int
    new_word_count: int
    vocab_learned_count: int
    vocab_review_count: int
