import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type BookChapter, type BookParagraph, type ReadingDetail, type ReadingGroup } from '../api'
import './ReadingPage.css'

function paragraphMap(chapter: BookChapter) {
  return new Map(chapter.paragraphs.map((paragraph) => [paragraph.id, paragraph]))
}

function GroupEditor({ group, chapter, onChange }: { group: ReadingGroup; chapter: BookChapter; onChange: () => void }) {
  const [englishIds, setEnglishIds] = useState(group.english_ids)
  const [chineseIds, setChineseIds] = useState(group.chinese_ids)
  const [saving, setSaving] = useState(false)
  const paragraphs = paragraphMap(chapter)
  const english = chapter.paragraphs.filter((paragraph) => paragraph.language === 'en')
  const chinese = chapter.paragraphs.filter((paragraph) => paragraph.language === 'zh')

  useEffect(() => {
    setEnglishIds(group.english_ids)
    setChineseIds(group.chinese_ids)
  }, [group.english_ids, group.chinese_ids])

  const saveText = async (paragraph: BookParagraph, text: string) => {
    if (text.trim() && text !== paragraph.text) await api.updateBookParagraph(paragraph.id, text)
  }

  const saveGroup = async (status?: string) => {
    setSaving(true)
    try {
      await api.updateReadingGroup(group.id, englishIds, chineseIds, status)
      onChange()
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const renderText = (ids: number[]) => ids.map((id) => paragraphs.get(id)).filter(Boolean) as BookParagraph[]

  return (
    <article className={`review-group ${group.status === 'confirmed' ? 'confirmed' : ''}`}>
      <div className="review-group-head">
        <span>#{group.idx + 1} · 置信度 {Math.round(group.confidence * 100)}%</span>
        <span className="review-group-status">{group.status === 'confirmed' ? '已确认' : '待确认'}</span>
      </div>
      <div className="review-columns">
        <div>
          {renderText(englishIds).map((paragraph) => (
            <textarea key={paragraph.id} defaultValue={paragraph.text} onBlur={(e) => saveText(paragraph, e.target.value)} />
          ))}
          {englishIds.length === 0 && <p className="review-empty">未匹配英文段落</p>}
          <select multiple value={englishIds.map(String)} onChange={(e) => setEnglishIds(Array.from(e.target.selectedOptions, (option) => Number(option.value)))}>
            {english.map((paragraph) => <option key={paragraph.id} value={paragraph.id}>{paragraph.idx + 1}. {paragraph.text.slice(0, 90)}</option>)}
          </select>
        </div>
        <div>
          {renderText(chineseIds).map((paragraph) => (
            <textarea key={paragraph.id} defaultValue={paragraph.text} onBlur={(e) => saveText(paragraph, e.target.value)} />
          ))}
          {chineseIds.length === 0 && <p className="review-empty">未匹配中文段落</p>}
          <select multiple value={chineseIds.map(String)} onChange={(e) => setChineseIds(Array.from(e.target.selectedOptions, (option) => Number(option.value)))}>
            {chinese.map((paragraph) => <option key={paragraph.id} value={paragraph.id}>{paragraph.idx + 1}. {paragraph.text.slice(0, 90)}</option>)}
          </select>
        </div>
      </div>
      <div className="review-group-actions">
        <button onClick={() => saveGroup()} disabled={saving}>保存匹配</button>
        <button className="confirm-button" onClick={() => saveGroup('confirmed')} disabled={saving || (!englishIds.length && !chineseIds.length)}>
          {group.status === 'confirmed' ? '重新确认' : '确认这一段'}
        </button>
      </div>
    </article>
  )
}

export default function ReadingReviewPage() {
  const { bookId } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<ReadingDetail | null>(null)
  const id = Number(bookId)

  const refresh = useCallback(() => api.getBookReview(id).then(setDetail).catch((e) => alert(e.message)), [id])
  useEffect(() => { refresh() }, [refresh])

  const groupsByChapter = useMemo(() => {
    const map = new Map<number, ReadingGroup[]>()
    detail?.groups.forEach((group) => map.set(group.chapter_id, [...(map.get(group.chapter_id) || []), group]))
    map.forEach((groups) => groups.sort((a, b) => a.confidence - b.confidence))
    return map
  }, [detail])

  if (!detail) return <p>正在加载校对内容…</p>
  const pending = detail.groups.filter((group) => group.status !== 'confirmed').length
  const publish = async () => {
    try {
      await api.publishBook(id)
      navigate(`/reading/${id}`)
    } catch (e) {
      alert(`发布失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="review-page">
      <div className="reading-toolbar">
        <div><Link to="/reading">← 阅读中心</Link><h1>{detail.book.title} · 校对</h1></div>
        <button className="primary-button" disabled={pending > 0} onClick={publish}>{pending ? `还有 ${pending} 段待确认` : '发布阅读材料'}</button>
      </div>
      <p className="review-intro">低置信度段落优先显示。可以直接编辑文本，也可以在下方多选段落来合并、拆分或重新匹配。</p>
      {detail.chapters.map((chapter) => (
        <section key={chapter.id} className="review-chapter">
          <h2>{chapter.idx + 1}. {chapter.title}</h2>
          {(groupsByChapter.get(chapter.id) || []).map((group) => <GroupEditor key={group.id} group={group} chapter={chapter} onChange={refresh} />)}
        </section>
      ))}
    </div>
  )
}
