import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Category, type MediaFile } from '../api'
import './StudyCenterPage.css'

type Collection = { id: string; name: string; items: MediaFile[] }

export default function StudyCenterPage() {
  const [items, setItems] = useState<MediaFile[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    const [media, groups] = await Promise.all([api.listMedia(), api.listCategories()])
    setItems(media)
    setCategories(groups)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const collections = useMemo<Collection[]>(() => {
    const categorized = categories.map((category) => ({
      id: String(category.id), name: category.name, items: items.filter((item) => item.category_id === category.id),
    }))
    const unfiled = items.filter((item) => item.category_id === null)
    return [
      ...categorized,
      ...(unfiled.length ? [{ id: 'unfiled', name: '未分类资料', items: unfiled }] : []),
    ]
  }, [categories, items])

  return (
    <div className="study-center-page">
      <header className="center-heading">
        <div>
          <p className="eyebrow">你的英语资料库</p>
          <h1>学习中心</h1>
          <p className="center-summary">{collections.length} 本资料 · {items.length} 段音视频</p>
        </div>
        <Link to="/upload" className="center-upload-link">上传材料 <span>↗</span></Link>
      </header>

      {collections.length === 0 ? (
        <section className="center-empty">
          <span>⌁</span>
          <h2>书架还是空的</h2>
          <p>上传一段英文音频或视频，转写完成后就可以从这里开始学习。</p>
          <Link to="/upload">上传第一份材料</Link>
        </section>
      ) : (
        <section className="book-shelf" aria-label="已上传资料">
          <div className="shelf-heading"><h2>我的资料</h2><span>点击一本资料，选择其中一段开始学习</span></div>
          <div className="book-grid">
            {collections.map((collection, index) => {
              const ready = collection.items.filter((item) => item.status === 'ready').length
              const working = collection.items.some((item) => item.status === 'uploaded' || item.status === 'transcribing')
              return <button className={`collection-book tone-${index % 4}`} key={collection.id} onClick={() => navigate(`/materials/${collection.id}`)}>
                <span className="book-year">资料 {String(index + 1).padStart(2, '0')}</span>
                <h3>{collection.name}</h3>
                <span className="book-count">{collection.items.length} 段音视频 · {ready} 段可学</span>
                <span className="book-open">打开 <b>↗</b></span>
                {working && <span className="book-working">正在处理</span>}
              </button>
            })}
          </div>
        </section>
      )}
    </div>
  )
}
