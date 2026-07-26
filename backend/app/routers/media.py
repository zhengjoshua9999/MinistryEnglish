import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app import config
from app.database import SessionLocal, get_db
from app.models import MediaFile, Sentence
from app.schemas import MediaFileOut, SentenceOut
from app.services import audio_utils, deepseek_service, subtitles, whisper_service

router = APIRouter(tags=["media"])

SUPPORTED_EXTS = {".mp3", ".wav", ".m4a", ".mp4", ".mov", ".mkv", ".aac", ".flac"}


def _run_transcription(media_id: int, src_path: str):
    """Runs in a background thread: extract audio -> Whisper（分段流式）-> DeepSeek 润色 -> 分批落库。
    每转完约 5 分钟内容（且落在句子边界上）就写一批句子、更新一次进度，而不是等全篇转完再一次性写入——
    长讲道也能看到进度条走动，中途要是出错，前面已经落库的句子也不会丢。"""
    db = SessionLocal()
    try:
        media = db.get(MediaFile, media_id)
        media.status = "transcribing"
        media.progress = 0.0
        db.commit()

        wav_path = str(Path(src_path).with_suffix(".16k.wav"))
        audio_utils.extract_audio_wav(src_path, wav_path)
        media.duration_sec = audio_utils.probe_duration_sec(wav_path)
        db.commit()

        idx = 0
        last_text_norm = None  # 兜底去重：即便解码层参数没能完全防住，连续复读的整句也不落库
        for raw_sentences, progress in whisper_service.transcribe_chunks(wav_path, db, media.duration_sec):
            polished_texts = deepseek_service.polish_sentences([s["text"] for s in raw_sentences])
            for s, polished in zip(raw_sentences, polished_texts):
                text_norm = " ".join(s["text"].split()).lower()
                if text_norm and text_norm == last_text_norm:
                    continue
                db.add(
                    Sentence(
                        media_id=media_id,
                        idx=idx,
                        start_ms=s["start_ms"],
                        end_ms=s["end_ms"],
                        text_raw=s["text"],
                        text_polished=polished,
                    )
                )
                idx += 1
                last_text_norm = text_norm
            media.progress = progress
            db.commit()

        media.status = "ready"
        media.progress = 1.0
        db.commit()
    except Exception as e:  # noqa: BLE001
        media = db.get(MediaFile, media_id)
        media.status = "error"
        media.error_message = str(e)[:500]
        db.commit()
    finally:
        db.close()


@router.post("/media/upload", response_model=MediaFileOut)
def upload_media(background_tasks: BackgroundTasks, file: UploadFile, db: Session = Depends(get_db)):
    ext = Path(file.filename).suffix.lower()
    if ext not in SUPPORTED_EXTS:
        raise HTTPException(400, f"不支持的文件类型：{ext}")

    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = config.MEDIA_DIR / stored_name
    with open(dest_path, "wb") as f:
        f.write(file.file.read())

    media = MediaFile(filename=stored_name, original_name=file.filename, status="uploaded")
    db.add(media)
    db.commit()
    db.refresh(media)

    background_tasks.add_task(_run_transcription, media.id, str(dest_path))

    return media


@router.get("/media", response_model=list[MediaFileOut])
def list_media(db: Session = Depends(get_db)):
    return db.query(MediaFile).order_by(MediaFile.created_at.desc()).all()


@router.get("/media/{media_id}", response_model=MediaFileOut)
def get_media(media_id: int, db: Session = Depends(get_db)):
    media = db.get(MediaFile, media_id)
    if not media:
        raise HTTPException(404, "找不到该媒体文件")
    return media


@router.get("/media/{media_id}/sentences", response_model=list[SentenceOut])
def get_sentences(media_id: int, db: Session = Depends(get_db)):
    return db.query(Sentence).filter(Sentence.media_id == media_id).order_by(Sentence.idx).all()


def _sentence_dicts(media_id: int, db: Session) -> list[dict]:
    rows = db.query(Sentence).filter(Sentence.media_id == media_id).order_by(Sentence.idx).all()
    return [
        {"start_ms": r.start_ms, "end_ms": r.end_ms, "text_raw": r.text_raw, "text_polished": r.text_polished}
        for r in rows
    ]


@router.get("/media/{media_id}/subtitles.srt")
def get_srt(media_id: int, db: Session = Depends(get_db)):
    return PlainTextResponse(subtitles.to_srt(_sentence_dicts(media_id, db)), media_type="text/plain")


@router.get("/media/{media_id}/subtitles.vtt")
def get_vtt(media_id: int, db: Session = Depends(get_db)):
    return PlainTextResponse(subtitles.to_vtt(_sentence_dicts(media_id, db)), media_type="text/vtt")


@router.delete("/media/{media_id}")
def delete_media(media_id: int, db: Session = Depends(get_db)):
    media = db.get(MediaFile, media_id)
    if not media:
        raise HTTPException(404, "找不到该媒体文件")
    src = config.MEDIA_DIR / media.filename
    src.unlink(missing_ok=True)
    src.with_suffix(".16k.wav").unlink(missing_ok=True)
    db.delete(media)
    db.commit()
    return {"ok": True}
