import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Book } from '../api'
import './ReadingPage.css'

const statusLabel: Record<Book['status'], string> = {
  processing: '解析中…',
  review: '待校对',
  published: '可阅读',
  error: '解析失败',
}

export default function ReadingHomePage() {
  const [books, setBooks] = useState<Book[]>([])
  const [uploading, setUploading] = useState(false)
  const englishRef = useRef<HTMLInputElement>(null)
  const chineseRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const refresh = useCallback(() => api.listBooks().then(setBooks), [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const remove = async (book: Book) => {
    if (!confirm(`确定删除《${book.title}》吗？原文件和对齐数据都会删掉，已标记的生词会保留。`)) return
    try {
      await api.deleteBook(book.id)
      await refresh()
    } catch (e) {
      alert(`删除失败：${(e as Error).message}`)
    }
  }

  const upload = async () => {
    const english = englishRef.current?.files?.[0]
    const chinese = chineseRef.current?.files?.[0]
    if (!english || !chinese) {
      alert('请选择英文 PDF 和中文 EPUB/DOCX')
      return
    }
    setUploading(true)
    try {
      await api.uploadBook(english, chinese)
      if (englishRef.current) englishRef.current.value = ''
      if (chineseRef.current) chineseRef.current.value = ''
      await refresh()
    } catch (e) {
      alert(`上传失败：${(e as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="reading-home">
      <div className="reading-heading">
        <div>
          <h1>阅读中心</h1>
          <p className="lede">上传同一本书的英文 PDF 与中文 EPUB/DOCX，校对后开始双语阅读。</p>
        </div>
      </div>

      <section className="book-upload-card">
        <label>
          <span>英文版（PDF）</span>
          <input ref={englishRef} type="file" accept=".pdf,application/pdf" />
        </label>
        <label>
          <span>中文版（EPUB / DOCX）</span>
          <input ref={chineseRef} type="file" accept=".epub,.docx" />
        </label>
        <button className="primary-button" disabled={uploading} onClick={upload}>
          {uploading ? '解析中…' : '上传并解析'}
        </button>
        <p className="book-upload-note">英文 PDF 必须有可复制的文本层；扫描图片暂不支持。</p>
      </section>

      <div className="book-list">
        {books.length === 0 && <p className="empty">还没有阅读材料。</p>}
        {books.map((book) => (
          <article key={book.id} className="book-card">
            <div>
              <h2>{book.title}</h2>
              <p className="book-files">{book.english_original_name} · {book.chinese_original_name}</p>
              {book.error_message && <p className="book-error">{book.error_message}</p>}
            </div>
            <div className="book-card-actions">
              <span className={`book-status status-${book.status}`}>{statusLabel[book.status]}</span>
              {book.status === 'review' && (
                <button onClick={() => navigate(`/reading/review/${book.id}`)}>开始校对</button>
              )}
              {book.status === 'published' && (
                <button onClick={() => navigate(`/reading/${book.id}`)}>打开阅读</button>
              )}
              <button className="book-delete" onClick={() => remove(book)} aria-label="删除">
                ×
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
