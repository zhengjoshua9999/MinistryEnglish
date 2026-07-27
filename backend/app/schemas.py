from datetime import datetime
from typing import Optional

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
    sentence_id: int


class VocabWordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    word: str
    media_id: int
    sentence_id: int
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
