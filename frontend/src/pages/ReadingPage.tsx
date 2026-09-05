import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type BookParagraph, type ChapterContent, type ReadingDirectory, type ReadingGroup } from '../api'
import './ReadingPage.css'

function selectedParagraphs(paragraphs: BookParagraph[], group: ReadingGroup, language: 'en' | 'zh') {
  const ids = language === 'en' ? group.english_ids : group.chinese_ids
  const byId = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]))
  return ids.map((id) => byId.get(id)).filter(Boolean) as BookParagraph[]
}

type ColumnKey = 'en' | 'zh' | 'single'

interface ColumnCache {
  list: HTMLElement[]
  byIdx: Map<number, HTMLElement>
}

const EMPTY_CACHE = (): ColumnCache => ({ list: [], byIdx: new Map() })

/**
 * 返回当前滚到栏顶的那个对齐组。元素按 idx 升序排列、`getBoundingClientRect().top`
 * 随 idx 单调递增，所以二分即可 —— 长章节不用每个滚动事件都扫一遍全文。
 */
function topGroupIndex(container: HTMLElement, list: HTMLElement[]): { idx: number; index: number } | null {
  if (!list.length) return null
  const top = container.getBoundingClientRect().top
  let lo = 0
  let hi = list.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].getBoundingClientRect().top <= top + 1) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return { idx: Number(list[ans].dataset.groupIdx), index: ans }
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export default function ReadingPage() {
  const { bookId } = useParams()
  const [directory, setDirectory] = useState<ReadingDirectory | null>(null)
  const [chapterContent, setChapterContent] = useState<ChapterContent | null>(null)
  const [chapterId, setChapterId] = useState<number | null>(null)
  const [activeGroup, setActiveGroup] = useState<number | null>(null)
  const [showChinese, setShowChinese] = useState(true)
  const [fontSize, setFontSize] = useState(18)
  const [lineHeight, setLineHeight] = useState(1.8)
  const enColumn = useRef<HTMLDivElement>(null)
  const zhColumn = useRef<HTMLDivElement>(null)
  const singleColumn = useRef<HTMLDivElement>(null)
  const activeGroupRef = useRef<number | null>(null)
  const cacheRef = useRef<Record<ColumnKey, ColumnCache>>({ en: EMPTY_CACHE(), zh: EMPTY_CACHE(), single: EMPTY_CACHE() })
  /** 标记「哪一栏的下一次滚动是程序回填」，用于吞掉同步滚动的回声，避免两栏互抢 */
  const syncingRef = useRef<ColumnKey | null>(null)
  const rafRef = useRef<number | null>(null)
  const id = Number(bookId)
  const isMobile = useMediaQuery('(max-width: 760px)')

  // 第一步：拉目录（书 + 章节目录 + 进度），不含段落
  useEffect(() => {
    api.getBookReading(id).then((dir) => {
      setDirectory(dir)
      const initialChapter = dir.progress?.chapter_id || dir.chapters[0]?.id || null
      setChapterId(initialChapter)
      setActiveGroup(dir.progress?.group_idx ?? 0)
    }).catch((e) => alert(e.message))
  }, [id])

  // 第二步：按需拉当前章节的段落与对齐组
  useEffect(() => {
    if (chapterId == null) return
    let cancelled = false
    setChapterContent(null)
    api.getBookChapter(id, chapterId).then((content) => {
      if (!cancelled) setChapterContent(content)
    }).catch((e) => { if (!cancelled) alert(e.message) })
    return () => { cancelled = true }
  }, [id, chapterId])

  const chapter = directory?.chapters.find((item) => item.id === chapterId) || directory?.chapters[0]
  const activeChapterId = chapter?.id ?? null
  const paragraphs = chapterContent?.paragraphs ?? []
  const groups = useMemo(
    () => chapterContent?.groups.filter((group) => group.chapter_id === chapterId).sort((a, b) => a.idx - b.idx) || [],
    [chapterContent, chapterId],
  )

  // 计时器只依赖书籍/章节，当前段落放 ref —— 滚动换段不能重启计时器
  useEffect(() => {
    activeGroupRef.current = activeGroup
  }, [activeGroup])

  // 缓存每栏的组元素：章节内容 / 显示模式变化时重建，字号行距变化只重排、元素引用不变
  useLayoutEffect(() => {
    const build = (column: HTMLDivElement | null): ColumnCache => {
      const list = Array.from(column?.querySelectorAll<HTMLElement>('[data-group-idx]') ?? [])
      return { list, byIdx: new Map(list.map((el) => [Number(el.dataset.groupIdx), el])) }
    }
    cacheRef.current = { en: build(enColumn.current), zh: build(zhColumn.current), single: build(singleColumn.current) }
  }, [chapterContent, isMobile, showChinese])

  /** 唯一定位入口：把某个组滚到各自栏顶。点击、恢复进度、切章、显隐中文都走这里 */
  const scrollToGroup = useCallback((idx: number) => {
    const keys: ColumnKey[] = isMobile ? ['single'] : ['en', 'zh']
    for (const key of keys) {
      const el = cacheRef.current[key].byIdx.get(idx)
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
    }
  }, [isMobile])

  /** 滚动同步：以「源栏」为准，把另一栏的同名组对齐到同一垂直位置。 */
  const handleScroll = useCallback((which: 'en' | 'zh') => {
    // 这次滚动是我们自己回填的，吞掉，避免反向再同步
    if (syncingRef.current === which) {
      syncingRef.current = null
      return
    }
    const lead = which === 'en' ? enColumn.current : zhColumn.current
    const follow = which === 'en' ? zhColumn.current : enColumn.current
    if (!lead || !follow) return
    const leadList = cacheRef.current[which].list
    const followList = cacheRef.current[which === 'en' ? 'zh' : 'en'].list
    const hit = topGroupIndex(lead, leadList)
    if (!hit || hit.index >= followList.length) return
    setActiveGroup(hit.idx)
    const delta =
      leadList[hit.index].getBoundingClientRect().top - lead.getBoundingClientRect().top -
      (followList[hit.index].getBoundingClientRect().top - follow.getBoundingClientRect().top)
    if (Math.abs(delta) < 1) return
    syncingRef.current = which === 'en' ? 'zh' : 'en'
    follow.scrollTop += delta
  }, [])

  // rAF 节流，一帧最多同步一次
  const onScroll = useCallback((which: 'en' | 'zh') => () => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      handleScroll(which)
    })
  }, [handleScroll])

  // 章节切换时立即落盘（含首次进入恢复的定位）
  useEffect(() => {
    if (activeChapterId != null) {
      api.saveReadingProgress(id, activeChapterId, activeGroupRef.current ?? 0).catch(() => {})
    }
  }, [id, activeChapterId])

  // 段内滚动换段时防抖落盘，避免每滚一段就发一个请求
  useEffect(() => {
    if (activeGroup == null || activeChapterId == null) return
    const timer = window.setTimeout(() => {
      api.saveReadingProgress(id, activeChapterId, activeGroup).catch(() => {})
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [id, activeChapterId, activeGroup])

  // 阅读时长计时：只随书籍/章节重建，位置从 ref 读
  useEffect(() => {
    if (activeChapterId == null) return
    const timer = window.setInterval(() => {
      if (activeGroupRef.current != null) {
        api.saveReadingProgress(id, activeChapterId, activeGroupRef.current, 15).catch(() => {})
      }
    }, 15000)
    return () => window.clearInterval(timer)
  }, [id, activeChapterId])

  // 移动端单栏由页面整体滚动，没有内部滚动事件；用 IntersectionObserver 判当前组
  useEffect(() => {
    if (!isMobile || !singleColumn.current) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveGroup(Number((entry.target as HTMLElement).dataset.groupIdx))
        }
      }
    }, { root: null, rootMargin: '-10% 0px -80% 0px', threshold: 0 })
    singleColumn.current.querySelectorAll<HTMLElement>('[data-group-idx]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [isMobile, chapterContent, showChinese])

  // 章节内容渲染完成后定位：首次进恢复进度，切章回到组顶，显隐中文后对齐另一栏
  useEffect(() => {
    if (!chapterContent || !chapter) return
    const raf = requestAnimationFrame(() => scrollToGroup(activeGroupRef.current ?? 0))
    return () => cancelAnimationFrame(raf)
    // activeGroup 走 ref，不列入依赖，否则每次换段都会重滚
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterContent, chapter?.id, isMobile, showChinese, scrollToGroup])

  const onGroupClick = useCallback((idx: number) => {
    setActiveGroup(idx)
    scrollToGroup(idx)
  }, [scrollToGroup])

  const markWord = async (event: React.MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection()?.toString().trim().replace(/[^A-Za-z'-]/g, '')
    const paragraphElement = (event.target as HTMLElement).closest<HTMLElement>('[data-paragraph-id]')
    const paragraphId = Number(paragraphElement?.dataset.paragraphId)
    if (!selection || !paragraphId) return
    try {
      await api.markBookWord(selection, paragraphId, paragraphElement?.textContent || undefined)
      alert(`已加入生词本：${selection}`)
    } catch (e) { alert(`标记失败：${(e as Error).message}`) }
  }

  const renderGroup = (group: ReadingGroup, mode: 'en' | 'zh' | 'single') => {
    const className = `reading-group${activeGroup === group.idx ? ' active' : ''}`
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onGroupClick(group.idx)
      }
    }
    const groupAttrs = {
      'data-group-idx': group.idx,
      className,
      tabIndex: 0,
      role: 'button' as const,
      'aria-current': activeGroup === group.idx ? ('true' as const) : undefined,
      onClick: () => onGroupClick(group.idx),
      onKeyDown,
    }
    if (mode === 'en') {
      return (
        <div key={group.id} {...groupAttrs}>
          {selectedParagraphs(paragraphs, group, 'en').map((p) => <p key={p.id} data-paragraph-id={p.id}>{p.text}</p>)}
        </div>
      )
    }
    if (mode === 'zh') {
      return (
        <div key={group.id} {...groupAttrs}>
          {selectedParagraphs(paragraphs, group, 'zh').map((p) => <p key={p.id} data-paragraph-id={p.id}>{p.text}</p>)}
        </div>
      )
    }
    // 移动端单栏：英文段 → 对应中文段，逐组交错，而不是整章英文后再整章中文
    return (
      <div key={group.id} {...groupAttrs}>
        {selectedParagraphs(paragraphs, group, 'en').map((p) => <p key={p.id} data-paragraph-id={p.id} className="reading-p-en">{p.text}</p>)}
        {showChinese && selectedParagraphs(paragraphs, group, 'zh').map((p) => <p key={p.id} data-paragraph-id={p.id} className="reading-p-zh">{p.text}</p>)}
      </div>
    )
  }

  if (!directory || !chapter) return <p>正在加载阅读内容…</p>

  return (
    <div className="reading-page" style={{ '--reading-size': `${fontSize}px`, '--reading-leading': lineHeight } as React.CSSProperties}>
      <div className="reading-toolbar">
        <div><Link to="/reading">← 阅读中心</Link><h1>{directory.book.title}</h1></div>
        <div className="reading-controls">
          <select value={chapter.id} onChange={(e) => { setChapterId(Number(e.target.value)); setActiveGroup(0) }}>
            {directory.chapters.map((item) => <option key={item.id} value={item.id}>{item.idx + 1}. {item.title}</option>)}
          </select>
          <label>字号 <input type="range" min="15" max="25" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} /></label>
          <label>行距 <input type="range" min="1.4" max="2.4" step="0.1" value={lineHeight} onChange={(e) => setLineHeight(Number(e.target.value))} /></label>
          <button onClick={() => setShowChinese((value) => !value)}>{showChinese ? '隐藏中文' : '显示中文'}</button>
        </div>
      </div>
      <h2 className="reading-chapter-title">{chapter.title}</h2>
      {isMobile ? (
        <div className="reading-columns reading-columns-single">
          <div ref={singleColumn} className="reading-column" onDoubleClick={markWord}>
            {groups.map((group) => renderGroup(group, 'single'))}
          </div>
        </div>
      ) : (
        <div className={`reading-columns ${showChinese ? '' : 'english-only'}`}>
          <div ref={enColumn} className="reading-column" onScroll={onScroll('en')} onDoubleClick={markWord}>
            {groups.map((group) => renderGroup(group, 'en'))}
          </div>
          {showChinese && (
            <div ref={zhColumn} className="reading-column" onScroll={onScroll('zh')} onDoubleClick={markWord}>
              {groups.map((group) => renderGroup(group, 'zh'))}
            </div>
          )}
        </div>
      )}
      <p className="reading-tip">双击英文单词即可加入生词本；点击任一段落会在两栏间定位。</p>
    </div>
  )
}
