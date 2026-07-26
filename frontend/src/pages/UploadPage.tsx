import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type MediaFile } from '../api'
import { formatDateTime } from '../format'
import './UploadPage.css'

const STATUS_LABEL: Record<MediaFile['status'], string> = {
  uploaded: '排队中',
  transcribing: '转写中…',
  ready: '已就绪',
  error: '出错了',
}

export default function UploadPage() {
  const [items, setItems] = useState<MediaFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    setItems(await api.listMedia())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const hasPending = items.some((m) => m.status === 'uploaded' || m.status === 'transcribing')
    if (!hasPending) return
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [items, refresh])

  const doUpload = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        await api.uploadMedia(file)
        await refresh()
      } catch (e) {
        alert(`上传失败：${(e as Error).message}`)
      } finally {
        setUploading(false)
      }
    },
    [refresh],
  )

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

      {items.length > 0 && (
        <ul className="media-list">
          {items.map((m) => (
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
    </div>
  )
}
