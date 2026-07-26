from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.database import get_db
from app.models import MediaFile, Sentence, VocabWord
from app.schemas import VocabStatusUpdate, VocabWordCreate, VocabWordOut
from app.services import audio_utils, deepseek_service, stats_service
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

    existing = db.query(VocabWord).filter(VocabWord.word_norm == word_norm).first()
    if existing:
        return existing

    sentence = db.get(Sentence, payload.sentence_id)
    if not sentence:
        raise HTTPException(404, "找不到该句子")
    media = db.get(MediaFile, sentence.media_id)

    context_text = sentence.text_polished or sentence.text_raw

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
        media_id=sentence.media_id,
        sentence_id=sentence.id,
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
    vocab.status = payload.status
    db.commit()
    db.refresh(vocab)
    return vocab


@router.delete("/vocab/{vocab_id}")
def delete_vocab(vocab_id: int, db: Session = Depends(get_db)):
    vocab = db.get(VocabWord, vocab_id)
    if not vocab:
        raise HTTPException(404, "找不到该生词")
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
