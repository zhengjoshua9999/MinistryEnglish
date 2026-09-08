from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.database import get_db
from app.models import (
    DailyActivity,
    MediaFile,
    Sentence,
    VocabReviewLog,
    VocabStudySession,
    VocabStudySettings,
    VocabWord,
    WeakWordCount,
)
from app.schemas import (
    ReviewIn,
    ReviewResultOut,
    StudyCardOut,
    StudySessionCreate,
    StudySessionOut,
    StudySettingsOut,
    StudySettingsUpdate,
    StudySummaryOut,
    VocabStatusUpdate,
    VocabWordCreate,
    VocabWordOut,
)
from app.services import audio_utils, deepseek_service, srs, stats_service
from app.services.azure_service import synthesize_uk, synthesize_us

router = APIRouter(tags=["vocab"])


def _slug(word: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", word.strip().lower()).strip("-") or "word"


def _wav_path_for_media(media: MediaFile) -> str:
    from pathlib import Path

    return str((config.MEDIA_DIR / media.filename).with_suffix(".16k.wav"))


def _ensure_standard_audio(word: str) -> tuple[str, str]:
    """Standard US/UK pronunciation, cached per word text so repeat marks don't re-synthesize."""
    slug = _slug(word)
    us_path = config.AUDIO_CLIPS_DIR / f"us-{slug}.mp3"
    uk_path = config.AUDIO_CLIPS_DIR / f"uk-{slug}.mp3"

    if not us_path.exists():
        try:
            audio = synthesize_us(word)
            if audio:
                us_path.write_bytes(audio)
        except Exception:
            pass  # 网络抖动等问题不应阻断整个标记生词流程
    if not uk_path.exists():
        try:
            audio = synthesize_uk(word)
            if audio:
                uk_path.write_bytes(audio)
        except Exception:
            pass

    return (
        us_path.name if us_path.exists() else "",
        uk_path.name if uk_path.exists() else "",
    )


@router.post("/vocab", response_model=VocabWordOut)
def mark_word(payload: VocabWordCreate, db: Session = Depends(get_db)):
    word_norm = payload.word.strip().lower()

    if not payload.sentence_id:
        raise HTTPException(400, "需要提供音频句子")

    existing = db.query(VocabWord).filter(VocabWord.word_norm == word_norm).first()
    if existing:
        return existing

    source_type = "media"
    sentence = db.get(Sentence, payload.sentence_id)
    if not sentence:
        raise HTTPException(404, "找不到该句子")
    media = db.get(MediaFile, sentence.media_id)
    context_text = payload.context_text or sentence.text_polished or sentence.text_raw
    context_audio_name = ""
    try:
        wav_path = _wav_path_for_media(media)
        slug = _slug(payload.word)
        clip_name = f"ctx-{sentence.id}-{slug}.wav"
        clip_path = config.AUDIO_CLIPS_DIR / clip_name
        audio_utils.clip_wav(wav_path, str(clip_path), sentence.start_ms, sentence.end_ms)
        context_audio_name = clip_name
    except Exception:
        context_audio_name = ""

    definition = deepseek_service.define_word(payload.word, context_text)
    us_name, uk_name = _ensure_standard_audio(payload.word)

    vocab = VocabWord(
        word=payload.word,
        word_norm=word_norm,
        media_id=media.id if media else None,
        sentence_id=sentence.id,
        source_type=source_type,
        context_text=context_text,
        definition=definition["definition"],
        translation=definition["translation"],
        pos=definition["pos"],
        context_audio_path=context_audio_name,
        us_audio_path=us_name,
        uk_audio_path=uk_name,
        status="new",
    )
    db.add(vocab)
    try:
        db.commit()
    except IntegrityError:
        # 两次标记请求前后脚并发到达时，查重的那步可能被穿透——唯一约束兜底，
        # 谁先落库谁算数，后到的这次直接回退去读已经写进去的那条。
        db.rollback()
        existing = db.query(VocabWord).filter(VocabWord.word_norm == word_norm).first()
        if existing:
            return existing
        raise
    db.refresh(vocab)

    stats_service.bump(db, new_word_count=1)  # 走到这里才是真的新建了一条，命中查重/并发回退的都不算
    return vocab


@router.get("/vocab", response_model=list[VocabWordOut])
def list_vocab(status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(VocabWord)
    if status:
        q = q.filter(VocabWord.status == status)
    return q.order_by(VocabWord.created_at.desc()).all()


@router.patch("/vocab/{vocab_id}/status", response_model=VocabWordOut)
def update_status(vocab_id: int, payload: VocabStatusUpdate, db: Session = Depends(get_db)):
    vocab = db.get(VocabWord, vocab_id)
    if not vocab:
        raise HTTPException(404, "找不到该生词")
    now = datetime.utcnow()
    if payload.status == "new":
        vocab.status = "new"
        vocab.memory_stage = 0
        vocab.known_streak = 0
        vocab.due_at = None
        vocab.first_learned_at = None
        vocab.last_reviewed_at = None
        vocab.last_rating = None
    elif payload.status == "reviewing":
        vocab.status = "reviewing"
        vocab.memory_stage = max(1, vocab.memory_stage)
        vocab.first_learned_at = vocab.first_learned_at or now
        vocab.due_at = now
    elif payload.status == "mastered":
        vocab.status = "mastered"
        vocab.memory_stage = 6
        vocab.known_streak = 3
        vocab.first_learned_at = vocab.first_learned_at or now
        vocab.due_at = now + timedelta(days=60)
    else:
        raise HTTPException(400, "无效状态")
    db.commit()
    db.refresh(vocab)
    return vocab


@router.delete("/vocab/{vocab_id}")
def delete_vocab(vocab_id: int, db: Session = Depends(get_db)):
    vocab = db.get(VocabWord, vocab_id)
    if not vocab:
        raise HTTPException(404, "找不到该生词")
    db.query(VocabReviewLog).filter(VocabReviewLog.vocab_id == vocab_id).delete()
    db.delete(vocab)
    db.commit()
    return {"ok": True}


@router.get("/vocab/export/wordlist.txt")
def export_wordlist(db: Session = Depends(get_db)):
    """纯词表：一行一词，过滤掉多词术语，供导入不背单词等只认单词的词典 App。"""
    words = [v.word.strip() for v in db.query(VocabWord).all()]
    single_words = sorted({w for w in words if w and " " not in w})
    return PlainTextResponse("\n".join(single_words), media_type="text/plain")


@router.get("/vocab/export/anki.txt")
def export_anki(db: Session = Depends(get_db)):
    """Anki 制表符分隔导入格式：词 / 释义+翻译 / 原句例句 / 音频引用。
    音频文件需手动拷贝进 Anki 的 collection.media 目录，[sound:xxx] 才能生效。"""
    lines = ["#separator:tab", "#html:true"]
    for v in db.query(VocabWord).all():
        meaning = f"{v.definition}<br>{v.translation}".strip("<br>")
        example = v.context_text
        sound_tags = "".join(
            f"[sound:{name}]" for name in (v.context_audio_path, v.us_audio_path, v.uk_audio_path) if name
        )
        row = "\t".join([v.word, meaning, example, sound_tags])
        lines.append(row)
    return PlainTextResponse("\n".join(lines), media_type="text/plain")


# ---------- 学习 / 复习（阶段式间隔重复） ----------


def _settings(db: Session) -> VocabStudySettings:
    settings = db.get(VocabStudySettings, 1)
    if settings is None:
        settings = VocabStudySettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _settings_out(settings: VocabStudySettings) -> StudySettingsOut:
    return StudySettingsOut(
        new_group_size=settings.new_group_size,
        review_group_size=settings.review_group_size,
        daily_new_limit=settings.daily_new_limit,
        autoplay_audio=settings.autoplay_audio,
        preferred_audio=settings.preferred_audio,
        show_context_during_recall=settings.show_context_during_recall,
    )


def _active_session(db: Session, mode: Optional[str] = None) -> Optional[VocabStudySession]:
    q = db.query(VocabStudySession).filter(VocabStudySession.completed_at.is_(None))
    if mode:
        q = q.filter(VocabStudySession.mode == mode)
    return q.order_by(VocabStudySession.updated_at.desc()).first()


@router.get("/vocab/study/summary", response_model=StudySummaryOut)
def study_summary(db: Session = Depends(get_db)):
    counts = dict(db.query(VocabWord.status, func.count(VocabWord.id)).group_by(VocabWord.status).all())
    now = datetime.utcnow()
    due = (
        db.query(VocabWord)
        .filter(
            VocabWord.first_learned_at.isnot(None),
            VocabWord.suspended_at.is_(None),
            VocabWord.due_at.isnot(None),
            VocabWord.due_at <= now,
        )
        .count()
    )
    settings = _settings(db)
    today = db.get(DailyActivity, date.today().isoformat())
    learned_today = today.vocab_learned_count if today else 0
    new_count = (
        db.query(VocabWord)
        .filter(VocabWord.first_learned_at.is_(None), VocabWord.status == "new", VocabWord.suspended_at.is_(None))
        .count()
    )
    active = _active_session(db)
    return StudySummaryOut(
        new=new_count,
        available_new=min(new_count, max(0, settings.daily_new_limit - learned_today)),
        due=due,
        reviewing=counts.get("reviewing", 0),
        mastered=counts.get("mastered", 0),
        total=db.query(VocabWord).count(),
        settings=_settings_out(settings),
        active_session_id=active.id if active else None,
    )


@router.get("/vocab/study/settings", response_model=StudySettingsOut)
def get_study_settings(db: Session = Depends(get_db)):
    return _settings_out(_settings(db))


@router.patch("/vocab/study/settings", response_model=StudySettingsOut)
def update_study_settings(payload: StudySettingsUpdate, db: Session = Depends(get_db)):
    settings = _settings(db)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    return _settings_out(settings)


@router.get("/vocab/study/queue", response_model=list[StudyCardOut])
def study_queue(kind: str = "due", limit: Optional[int] = None, db: Session = Depends(get_db)):
    """兼容旧前端的只读队列；新前端使用可恢复的 sessions 接口。"""
    now = datetime.utcnow()
    settings = _settings(db)
    effective_limit = limit or (settings.new_group_size if kind == "new" else settings.review_group_size)
    q = (
        db.query(VocabWord, func.coalesce(WeakWordCount.count, 0).label("wc"))
        .outerjoin(WeakWordCount, VocabWord.word_norm == WeakWordCount.word_norm)
    )
    if kind == "new":
        q = q.filter(
            VocabWord.first_learned_at.is_(None),
            VocabWord.status == "new",
            VocabWord.suspended_at.is_(None),
        )
        q = q.order_by(VocabWord.created_at.asc())
    else:
        q = q.filter(
            VocabWord.first_learned_at.isnot(None),
            VocabWord.suspended_at.is_(None),
            VocabWord.due_at.isnot(None),
            VocabWord.due_at <= now,
        )
        q = q.order_by(
            VocabWord.due_at.asc(),
            VocabWord.lapses.desc(),
            func.coalesce(WeakWordCount.count, 0).desc(),
            VocabWord.last_reviewed_at.asc(),
        )
    rows = q.limit(max(1, min(effective_limit, 200))).all()
    return [srs.derive_card(w, wc) for w, wc in rows]


@router.post("/vocab/{vocab_id}/review", response_model=ReviewResultOut)
def review_word(vocab_id: int, payload: ReviewIn, db: Session = Depends(get_db)):
    v = db.get(VocabWord, vocab_id)
    if not v:
        raise HTTPException(404, "找不到该生词")
    if payload.rating not in srs.RATINGS:
        raise HTTPException(400, f"无效评分：{payload.rating}")
    srs.apply_review(v, payload.rating)
    db.commit()
    db.refresh(v)
    return ReviewResultOut(
        id=v.id,
        status=v.status,
        reps=v.reps,
        lapses=v.lapses,
        memory_stage=v.memory_stage,
        known_streak=v.known_streak,
        interval_days=v.interval_days,
        due_at=v.due_at.isoformat() if v.due_at else None,
    )


def _session_out(session: VocabStudySession, db: Session) -> StudySessionOut:
    queue = json.loads(session.queue_json)
    # 被删除或暂缓的卡片直接跳过，避免恢复旧会话时卡死。
    current_card = None
    start_index = session.current_index
    while session.current_index < len(queue):
        entry = queue[session.current_index]
        word = db.get(VocabWord, entry["vocab_id"])
        if word and word.suspended_at is None:
            weak = db.get(WeakWordCount, word.word_norm)
            current_card = StudyCardOut(**srs.derive_card(word, weak.count if weak else 0))
            break
        session.current_index += 1

    completed = session.current_index >= len(queue)
    if completed and session.completed_at is None:
        session.completed_at = datetime.utcnow()
        db.commit()
    elif session.current_index != start_index:
        db.commit()
    ratings = json.loads(session.rating_counts_json)
    unique_total = session.initial_count or len(queue)
    unique_done = sum(ratings.values()) if isinstance(ratings, dict) else 0
    return StudySessionOut(
        id=session.id,
        mode=session.mode,
        current_card=current_card,
        current_number=min(session.current_index + 1, len(queue)),
        total=len(queue),
        unique_total=unique_total,
        unique_done=unique_done,
        repeat_count=max(0, len(queue) - unique_total),
        completed=completed,
        ratings=ratings,
    )


@router.post("/vocab/study/sessions", response_model=StudySessionOut)
def create_study_session(payload: StudySessionCreate, db: Session = Depends(get_db)):
    existing = _active_session(db, payload.mode)
    if existing:
        return _session_out(existing, db)

    settings = _settings(db)
    limit = settings.new_group_size if payload.mode == "new" else settings.review_group_size
    if payload.mode == "new":
        today = db.get(DailyActivity, date.today().isoformat())
        learned_today = today.vocab_learned_count if today else 0
        limit = min(limit, max(0, settings.daily_new_limit - learned_today))

    cards = study_queue(payload.mode, limit=max(1, limit), db=db) if limit > 0 else []
    queue = [{"vocab_id": card["id"], "formal": True, "repeat_count": 0} for card in cards]
    now = datetime.utcnow()
    session = VocabStudySession(
        id=str(uuid.uuid4()),
        mode=payload.mode,
        queue_json=json.dumps(queue),
        initial_count=len(queue),
        completed_at=now if not queue else None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_out(session, db)


@router.get("/vocab/study/sessions/{session_id}", response_model=StudySessionOut)
def get_study_session(session_id: str, db: Session = Depends(get_db)):
    session = db.get(VocabStudySession, session_id)
    if not session:
        raise HTTPException(404, "找不到学习会话")
    return _session_out(session, db)


@router.get("/vocab/study/sessions/{session_id}/words")
def get_session_words(session_id: str, db: Session = Depends(get_db)):
    """返回该会话队列里的单词（去重），附上复习后的排程状态，供拼写测试与小结使用。"""
    session = db.get(VocabStudySession, session_id)
    if not session:
        raise HTTPException(404, "找不到学习会话")
    queue = json.loads(session.queue_json)
    seen: set[int] = set()
    out = []
    for entry in queue:
        vid = entry["vocab_id"]
        if vid in seen:
            continue
        seen.add(vid)
        w = db.get(VocabWord, vid)
        if w:
            out.append(
                {
                    "word": w.word,
                    "pos": w.pos,
                    "definition": w.definition,
                    "translation": w.translation,
                    "status": w.status,
                    "memory_stage": w.memory_stage,
                    "interval_days": w.interval_days,
                    "due_at": w.due_at.isoformat() if w.due_at else None,
                    "lapses": w.lapses,
                    "reps": w.reps,
                }
            )
    return out


@router.post("/vocab/study/sessions/{session_id}/reviews", response_model=StudySessionOut)
def review_session_word(session_id: str, payload: ReviewIn, db: Session = Depends(get_db)):
    session = db.get(VocabStudySession, session_id)
    if not session or session.completed_at is not None:
        raise HTTPException(404, "找不到进行中的学习会话")
    queue = json.loads(session.queue_json)
    if session.current_index >= len(queue):
        raise HTTPException(409, "本组已经完成")
    entry = queue[session.current_index]
    word = db.get(VocabWord, entry["vocab_id"])
    if not word or (payload.vocab_id is not None and word.id != payload.vocab_id):
        raise HTTPException(409, "当前单词已发生变化，请重新载入")

    repeat_count = int(entry.get("repeat_count", 0))
    if entry.get("formal", True):
        stage_before = word.memory_stage
        due_before = word.due_at
        was_new = word.first_learned_at is None
        reviewed_at = datetime.utcnow()
        srs.apply_review(word, payload.rating, reviewed_at)
        db.add(VocabReviewLog(
            vocab_id=word.id,
            session_id=session.id,
            mode=session.mode,
            rating=payload.rating,
            stage_before=stage_before,
            stage_after=word.memory_stage,
            due_before=due_before,
            due_after=word.due_at,
            response_ms=payload.response_ms,
            reviewed_at=reviewed_at,
        ))
        counts = json.loads(session.rating_counts_json)
        counts[payload.rating] = counts.get(payload.rating, 0) + 1
        session.rating_counts_json = json.dumps(counts)
        stats_service.bump(
            db,
            commit=False,
            **({"vocab_learned_count": 1} if was_new else {"vocab_review_count": 1}),
        )

    if payload.rating in ("fuzzy", "unknown") and repeat_count < (2 if payload.rating == "unknown" else 1):
        insert_at = min(session.current_index + 4, len(queue))
        queue.insert(insert_at, {
            "vocab_id": word.id,
            "formal": False,
            "repeat_count": repeat_count + 1,
        })

    session.current_index += 1
    session.queue_json = json.dumps(queue)
    session.updated_at = datetime.utcnow()
    if session.current_index >= len(queue):
        session.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(session)
    return _session_out(session, db)
