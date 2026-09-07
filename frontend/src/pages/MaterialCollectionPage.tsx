import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type Category, type MediaFile } from '../api'
import { formatDateTime } from '../format'
import './MaterialCollectionPage.css'

const statusLabel: Record<MediaFile['status'], string> = { uploaded: '等待处理', transcribing: '正在转写', ready: '开始学习', error: '处理失败' }

export default function MaterialCollectionPage() {
  const { collectionId = '' } = useParams()
  const [items, setItems] = useState<MediaFile[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const navigate = useNavigate()
  const refresh = useCallback(async () => {
    const [media, groups] = await Promise.all([api.listMedia(), api.listCategories()])
    setItems(media)
    setCategories(groups)
  }, [])
  useEffect(() => { refresh() }, [refresh])
  const collection = useMemo(() => {
    if (collectionId === 'unfiled') return { name: '未分类资料', items: items.filter((item) => item.category_id === null) }
    const category = categories.find((item) => item.id === Number(collectionId))
    return { name: category?.name || '资料', items: items.filter((item) => item.category_id === category?.id) }
  }, [categories, collectionId, items])

  return <div className="collection-page">
    <Link to="/" className="collection-back">‹ 返回学习中心</Link>
    <header><p>资料目录</p><h1>{collection.name}</h1><span>{collection.items.length} 段音视频</span></header>
    <div className="collection-list">
      {collection.items.map((item, index) => <article className="collection-item" key={item.id}>
        <span className="collection-index">{String(index + 1).padStart(2, '0')}</span>
        <div><h2>{item.original_name}</h2><p>{formatDateTime(item.created_at)} 上传</p></div>
        <button disabled={item.status !== 'ready'} onClick={() => navigate(`/practice/${item.id}`)}>{statusLabel[item.status]} <b>↗</b></button>
        {item.status === 'transcribing' && <div className="collection-progress"><i style={{ width: `${Math.max(6, item.progress * 100)}%` }} /></div>}
      </article>)}
    </div>
  </div>
}
