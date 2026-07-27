import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Category, type MediaFile } from '../api'
import { formatDateTime } from '../format'
import './UploadPage.css'

const STATUS_LABEL: Record<MediaFile['status'], string> = {
  uploaded: '排队中',
  transcribing: '转写中…',
  ready: '已就绪',
  error: '出错了',
}

// 'all' = 全部；'none' = 未分类；数字 = 具体分类 id
type CategoryFilter = 'all' | 'none' | number

export default function UploadPage() {
  const [items, setItems] = useState<MediaFile[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    setItems(await api.listMedia())
  }, [])

  const refreshCategories = useCallback(async () => {
    setCategories(await api.listCategories())
  }, [])

  useEffect(() => {
    refresh()
    refreshCategories()
  }, [refresh, refreshCategories])

  useEffect(() => {
    const hasPending = items.some((m) => m.status === 'uploaded' || m.status === 'transcribing')
    if (!hasPending) return
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [items, refresh])

  const visibleItems = items.filter((m) => {
    if (activeCategory === 'all') return true
    if (activeCategory === 'none') return m.category_id === null
    return m.category_id === activeCategory
  })

  const doUpload = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        await api.uploadMedia(file, typeof activeCategory === 'number' ? activeCategory : undefined)
        await refresh()
      } catch (e) {
        alert(`上传失败：${(e as Error).message}`)
      } finally {
        setUploading(false)
      }
    },
    [refresh, activeCategory],
  )

  const addCategory = async () => {
    const name = prompt('新建分类名称：')?.trim()
    if (!name) return
    try {
      const category = await api.createCategory(name)
      await refreshCategories()
      setActiveCategory(category.id)
    } catch (e) {
      alert(`新建分类失败：${(e as Error).message}`)
    }
  }

  const renameCategory = async (c: Category) => {
    const name = prompt('重命名分类：', c.name)?.trim()
    if (!name || name === c.name) return
    try {
      await api.renameCategory(c.id, name)
      await refreshCategories()
    } catch (e) {
      alert(`重命名失败：${(e as Error).message}`)
    }
  }

  const removeCategory = async (c: Category) => {
    if (!confirm(`删除分类"${c.name}"？分类下的信息不会被删除，会归到"未分类"。`)) return
    await api.deleteCategory(c.id)
    if (activeCategory === c.id) setActiveCategory('all')
    await Promise.all([refreshCategories(), refresh()])
  }

  const changeItemCategory = async (m: MediaFile, categoryId: number | null) => {
    const updated = await api.setMediaCategory(m.id, categoryId)
    setItems((prev) => prev.map((it) => (it.id === m.id ? updated : it)))
  }

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) doUpload(file)
    },
    [doUpload],
  )

  const onDelete = async (id: number) => {
    if (!confirm('确定删除这条信息及其字幕吗？')) return
    await api.deleteMedia(id)
    refresh()
  }

  return (
    <div className="upload-page">
      <h1>上传信息音视频</h1>
      <p className="lede">拖进一段水流职事的英文信息音频或视频，自动转写、断句，生成字幕。</p>

      <div className="category-tabs">
        <button className={activeCategory === 'all' ? 'active' : ''} onClick={() => setActiveCategory('all')}>
          全部
        </button>
        <button className={activeCategory === 'none' ? 'active' : ''} onClick={() => setActiveCategory('none')}>
          未分类
        </button>
        {categories.map((c) => (
          <span key={c.id} className={`category-tab ${activeCategory === c.id ? 'active' : ''}`}>
            <button onClick={() => setActiveCategory(c.id)}>{c.name}</button>
            <button className="category-tab-edit" onClick={() => renameCategory(c)} aria-label="重命名分类">
              ✎
            </button>
            <button className="category-tab-remove" onClick={() => removeCategory(c)} aria-label="删除分类">
              ×
            </button>
          </span>
        ))}
        <button className="category-tab-add" onClick={addCategory}>
          + 新建分类
        </button>
      </div>

      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) doUpload(file)
            e.target.value = ''
          }}
        />
        <span className="dropzone-title">{uploading ? '上传中…' : '拖拽文件到这里，或点击选择'}</span>
        <span className="dropzone-hint">支持 mp3 / wav / m4a / mp4 / mov 等常见格式</span>
      </div>

      {visibleItems.length > 0 && (
        <ul className="media-list">
          {visibleItems.map((m) => (
            <li key={m.id} className="media-row">
              <div className="media-row-top">
                <button
                  className="media-main"
                  disabled={m.status !== 'ready'}
                  onClick={() => navigate(`/practice/${m.id}`)}
                >
                  <span className="media-info">
                    <span className="media-name">{m.original_name}</span>
                    <span className="media-time">{formatDateTime(m.created_at)} 上传</span>
                  </span>
                  <span className={`status-pill status-${m.status}`}>
                    {STATUS_LABEL[m.status]}
                    {m.status === 'transcribing' && ` ${Math.round(m.progress * 100)}%`}
                  </span>
                </button>
                <select
                  className="media-category-select"
                  value={m.category_id ?? ''}
                  onChange={(e) => changeItemCategory(m, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">未分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button className="media-delete" onClick={() => onDelete(m.id)} aria-label="删除">
                  ×
                </button>
              </div>
              {m.status === 'transcribing' && (
                <div className="progress-track" aria-hidden="true">
                  <div className="progress-fill" style={{ width: `${Math.max(4, m.progress * 100)}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && visibleItems.length === 0 && <p className="empty-filtered">这个分类下还没有信息。</p>}
    </div>
  )
}
