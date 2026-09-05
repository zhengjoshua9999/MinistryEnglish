from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app import config
from app.database import get_db
from app.models import Book, BookChapter, BookParagraph, ReadingGroup, ReadingProgress
from app.schemas import (
    BookChapterOut,
    BookChapterSummary,
    BookOut,
    BookParagraphOut,
    BookParagraphUpdate,
    ChapterContentOut,
    ReadingDetailOut,
    ReadingDirectoryOut,
    ReadingGroupOut,
    ReadingGroupUpdate,
    ReadingProgressIn,
)
from app.services import stats_service
from app.services.reading_alignment import align_chapter
from app.services.reading_parser import ParsedChapter, parse_source

router = APIRouter(tags=["reading"])
BOOKS_DIR = config.DATA_DIR / "books"
BOOKS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_name(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    return f"{uuid.uuid4().hex}{suffix}"


async def _save_upload(upload: UploadFile, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            output.write(chunk)
    await upload.close()


def _group_out(group: ReadingGroup) -> ReadingGroupOut:
    return ReadingGroupOut(
        id=group.id,
        book_id=group.book_id,
        chapter_id=group.chapter_id,
        idx=group.idx,
        english_ids=json.loads(group.english_ids_json or "[]"),
        chinese_ids=json.loads(group.chinese_ids_json or "[]"),
        alignment_type=group.alignment_type,
        confidence=group.confidence,
        status=group.status,
        note=group.note,
    )


def _detail(book: Book, db: Session) -> ReadingDetailOut:
    chapters = (
        db.query(BookChapter)
        .options(joinedload(BookChapter.paragraphs))
        .filter(BookChapter.book_id == book.id)
        .order_by(BookChapter.idx)
        .all()
    )
    groups = db.query(ReadingGroup).filter(ReadingGroup.book_id == book.id).order_by(ReadingGroup.idx).all()
    progress = db.query(ReadingProgress).filter(ReadingProgress.book_id == book.id).first()
    chapter_out = [BookChapterOut.model_validate(chapter) for chapter in chapters]
    return ReadingDetailOut(
        book=BookOut.model_validate(book),
        chapters=chapter_out,
        groups=[_group_out(group) for group in groups],
        progress=(
            {"chapter_id": progress.chapter_id, "group_idx": progress.group_idx}
            if progress
            else None
        ),
    )


def _parse_book(book: Book, english_path: Path, chinese_path: Path, db: Session) -> None:
    en_title, english_chapters = parse_source(english_path, "en", book.english_original_name)
    _, chinese_chapters = parse_source(chinese_path, "zh", book.chinese_original_name)
    if not any(chapter.paragraphs for chapter in english_chapters):
        raise ValueError("英文 PDF 没有提取到文本层内容；扫描版 PDF 暂不支持")
    if not any(chapter.paragraphs for chapter in chinese_chapters):
        raise ValueError("中文文件没有提取到正文段落")
    book.title = en_title or book.title
    chapter_count = max(len(english_chapters), len(chinese_chapters))

    for chapter_idx in range(chapter_count):
        en_chapter = english_chapters[chapter_idx] if chapter_idx < len(english_chapters) else ParsedChapter("")
        zh_chapter = chinese_chapters[chapter_idx] if chapter_idx < len(chinese_chapters) else ParsedChapter("")
        title = en_chapter.title or zh_chapter.title or f"Chapter {chapter_idx + 1}"
        chapter = BookChapter(book_id=book.id, idx=chapter_idx, title=title)
        db.add(chapter)
        db.flush()
        en_rows: list[BookParagraph] = []
        zh_rows: list[BookParagraph] = []
        for idx, paragraph in enumerate(en_chapter.paragraphs):
            row = BookParagraph(chapter_id=chapter.id, language="en", idx=idx, text=paragraph.text, kind=paragraph.kind)
            db.add(row)
            en_rows.append(row)
        for idx, paragraph in enumerate(zh_chapter.paragraphs):
            row = BookParagraph(chapter_id=chapter.id, language="zh", idx=idx, text=paragraph.text, kind=paragraph.kind)
            db.add(row)
            zh_rows.append(row)
        db.flush()
        alignments = align_chapter([row.text for row in en_rows], [row.text for row in zh_rows])
        for group_idx, alignment in enumerate(alignments):
            en_ids = [en_rows[index].id for index in alignment["english_indices"]]
            zh_ids = [zh_rows[index].id for index in alignment["chinese_indices"]]
            db.add(
                ReadingGroup(
                    book_id=book.id,
                    chapter_id=chapter.id,
                    idx=group_idx,
                    english_ids_json=json.dumps(en_ids),
                    chinese_ids_json=json.dumps(zh_ids),
                    alignment_type=alignment["alignment_type"],
                    confidence=alignment["confidence"],
                    status="pending_review",
                )
            )
    book.status = "review"
    book.error_message = ""
    db.commit()


@router.post("/books/upload", response_model=BookOut)
async def upload_book(
    english_file: UploadFile = File(...),
    chinese_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    english_name = english_file.filename or "english.pdf"
    chinese_name = chinese_file.filename or "chinese.epub"
    if Path(english_name).suffix.lower() != ".pdf":
        raise HTTPException(400, "英文文件必须是可复制文本的 PDF")
    if Path(chinese_name).suffix.lower() not in {".epub", ".docx"}:
        raise HTTPException(400, "中文文件必须是 EPUB 或 DOCX")
    book = Book(
        title=Path(english_name).stem,
        english_filename=_safe_name(english_name),
        chinese_filename=_safe_name(chinese_name),
        english_original_name=english_name,
        chinese_original_name=chinese_name,
        status="processing",
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    english_path = BOOKS_DIR / book.english_filename
    chinese_path = BOOKS_DIR / book.chinese_filename
    try:
        await _save_upload(english_file, english_path)
        await _save_upload(chinese_file, chinese_path)
        _parse_book(book, english_path, chinese_path, db)
    except Exception as exc:
        db.rollback()
        book = db.get(Book, book.id)
        book.status = "error"
        book.error_message = str(exc)[:2000]
        db.commit()
    return book


@router.get("/books", response_model=list[BookOut])
def list_books(db: Session = Depends(get_db)):
    return db.query(Book).order_by(Book.created_at.desc()).all()


@router.delete("/books/{book_id}")
def delete_book(book_id: int, db: Session = Depends(get_db)):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "找不到该书籍")
    if book.status == "processing":
        # 解析在请求里同步进行，但解析期间这行已经提交可见——跟转写中的媒体文件一样，
        # 这时候删会跟正在写入的那次解析撞车。
        raise HTTPException(409, "该书籍正在解析中，请等待处理完成后再删除")

    # BookChapter/BookParagraph/ReadingGroup 靠 ORM cascade 跟着 Book 一起删；
    # ReadingProgress 没建 relationship，手动清理。VocabWord 是学习成果，保留，
    # book_paragraph_id 会跟着悬空——跟删媒体文件时 VocabWord.media_id 悬空是同一个处理方式。
    db.query(ReadingProgress).filter(ReadingProgress.book_id == book_id).delete()

    (BOOKS_DIR / book.english_filename).unlink(missing_ok=True)
    (BOOKS_DIR / book.chinese_filename).unlink(missing_ok=True)

    db.delete(book)
    db.commit()
    return {"ok": True}


@router.get("/books/{book_id}/review", response_model=ReadingDetailOut)
def get_review(book_id: int, db: Session = Depends(get_db)):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "找不到该书籍")
    return _detail(book, db)


@router.get("/books/{book_id}/reading", response_model=ReadingDirectoryOut)
def get_reading(book_id: int, db: Session = Depends(get_db)):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "找不到该书籍")
    if book.status != "published":
        raise HTTPException(409, "这本书尚未完成校对发布")
    chapters = (
        db.query(BookChapter)
        .filter(BookChapter.book_id == book.id)
        .order_by(BookChapter.idx)
        .all()
    )
    progress = db.query(ReadingProgress).filter(ReadingProgress.book_id == book.id).first()
    return ReadingDirectoryOut(
        book=BookOut.model_validate(book),
        chapters=[BookChapterSummary.model_validate(chapter) for chapter in chapters],
        progress=(
            {"chapter_id": progress.chapter_id, "group_idx": progress.group_idx}
            if progress
            else None
        ),
    )


@router.get("/books/{book_id}/chapters/{chapter_id}", response_model=ChapterContentOut)
def get_chapter(book_id: int, chapter_id: int, db: Session = Depends(get_db)):
    if not db.get(Book, book_id):
        raise HTTPException(404, "找不到该书籍")
    chapter = db.get(BookChapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(404, "找不到该章节")
    paragraphs = (
        db.query(BookParagraph)
        .filter(BookParagraph.chapter_id == chapter_id)
        .order_by(BookParagraph.idx)
        .all()
    )
    groups = (
        db.query(ReadingGroup)
        .filter(ReadingGroup.chapter_id == chapter_id)
        .order_by(ReadingGroup.idx)
        .all()
    )
    return ChapterContentOut(
        chapter=BookChapterSummary.model_validate(chapter),
        paragraphs=[BookParagraphOut.model_validate(paragraph) for paragraph in paragraphs],
        groups=[_group_out(group) for group in groups],
    )


@router.patch("/reading-groups/{group_id}", response_model=ReadingGroupOut)
def update_group(group_id: int, payload: ReadingGroupUpdate, db: Session = Depends(get_db)):
    group = db.get(ReadingGroup, group_id)
    if not group:
        raise HTTPException(404, "找不到该对齐段落")
    chapter = db.get(BookChapter, group.chapter_id)
    paragraphs = db.query(BookParagraph).filter(BookParagraph.chapter_id == chapter.id).all()
    valid_en = {row.id for row in paragraphs if row.language == "en"}
    valid_zh = {row.id for row in paragraphs if row.language == "zh"}
    if any(item not in valid_en for item in payload.english_ids) or any(item not in valid_zh for item in payload.chinese_ids):
        raise HTTPException(400, "对齐段落必须属于同一章节")
    if not payload.english_ids and not payload.chinese_ids:
        raise HTTPException(400, "对齐段落不能为空")
    group.english_ids_json = json.dumps(payload.english_ids)
    group.chinese_ids_json = json.dumps(payload.chinese_ids)
    en_count, zh_count = len(payload.english_ids), len(payload.chinese_ids)
    group.alignment_type = "one_to_one" if (en_count, zh_count) == (1, 1) else "one_to_many" if en_count == 1 else "many_to_one" if zh_count == 1 else "manual"
    group.status = payload.status if payload.status in {"pending_review", "confirmed"} else group.status
    group.note = payload.note if payload.note is not None else group.note
    db.commit()
    db.refresh(group)
    return _group_out(group)


@router.patch("/book-paragraphs/{paragraph_id}", response_model=BookParagraphOut)
def update_paragraph(paragraph_id: int, payload: BookParagraphUpdate, db: Session = Depends(get_db)):
    paragraph = db.get(BookParagraph, paragraph_id)
    if not paragraph:
        raise HTTPException(404, "找不到该书籍段落")
    paragraph.text = payload.text.strip()
    if payload.kind:
        paragraph.kind = payload.kind
    db.commit()
    db.refresh(paragraph)
    return paragraph


@router.post("/books/{book_id}/publish", response_model=BookOut)
def publish_book(book_id: int, db: Session = Depends(get_db)):
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "找不到该书籍")
    pending = db.query(ReadingGroup).filter(ReadingGroup.book_id == book_id, ReadingGroup.status != "confirmed").count()
    if pending:
        raise HTTPException(400, f"还有 {pending} 个对齐段落未确认")
    book.status = "published"
    db.commit()
    db.refresh(book)
    return book


@router.post("/books/{book_id}/progress")
def save_progress(book_id: int, payload: ReadingProgressIn, db: Session = Depends(get_db)):
    if not db.get(Book, book_id):
        raise HTTPException(404, "找不到该书籍")
    # 数据完整性：章节必须属于这本书，group_idx 必须在该章节内真实存在
    chapter = db.get(BookChapter, payload.chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(400, "该章节不属于这本书")
    group_exists = db.query(ReadingGroup.id).filter(
        ReadingGroup.chapter_id == payload.chapter_id,
        ReadingGroup.idx == payload.group_idx,
    ).first()
    if not group_exists:
        raise HTTPException(400, "该段落不存在")
    progress = db.query(ReadingProgress).filter(ReadingProgress.book_id == book_id).first()
    if progress is None:
        progress = ReadingProgress(book_id=book_id, chapter_id=payload.chapter_id, group_idx=payload.group_idx, study_seconds=0)
        db.add(progress)
    else:
        progress.chapter_id = payload.chapter_id
        progress.group_idx = payload.group_idx
        progress.updated_at = datetime.utcnow()
    delta = min(payload.study_seconds, 3600)
    # 老数据 study_seconds 可能是 NULL，兜底成 0 再累加
    progress.study_seconds = (progress.study_seconds or 0) + delta
    db.commit()
    if delta:
        stats_service.bump(db, study_seconds=delta)
    return {"ok": True, "chapter_id": progress.chapter_id, "group_idx": progress.group_idx}
