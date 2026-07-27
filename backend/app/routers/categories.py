from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Category, MediaFile
from app.schemas import CategoryCreate, CategoryOut, CategoryUpdate

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.query(Category).order_by(Category.name).all()


@router.post("/categories", response_model=CategoryOut)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "分类名不能为空")

    existing = db.query(Category).filter(Category.name == name).first()
    if existing:
        return existing

    category = Category(name=name)
    db.add(category)
    try:
        db.commit()
    except IntegrityError:
        # 两个新建请求前后脚撞上同一个名字，谁先落库谁算数
        db.rollback()
        existing = db.query(Category).filter(Category.name == name).first()
        if existing:
            return existing
        raise
    db.refresh(category)
    return category


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def rename_category(category_id: int, payload: CategoryUpdate, db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(404, "找不到该分类")
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "分类名不能为空")

    category.name = name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "已经有同名分类了")
    db.refresh(category)
    return category


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(404, "找不到该分类")
    # 分类下的媒体不删，归回"未分类"（category_id 置空）
    db.query(MediaFile).filter(MediaFile.category_id == category_id).update({"category_id": None})
    db.delete(category)
    db.commit()
    return {"ok": True}
