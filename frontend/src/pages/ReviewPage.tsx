import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, audioClipUrl, type StudyCard } from '../api'
import './ReviewPage.css'

const RATINGS = [
  { key: 'again', label: '忘了', tone: 'rate-again' },
  { key: 'hard', label: '困难', tone: 'rate-hard' },
  { key: 'good', label: '一般', tone: 'rate-good' },
  { key: 'easy', label: '轻松', tone: 'rate-good2' },
] as const

export default function ReviewPage() {
  const [params, setParams] = useSearchParams()
  const mode: 'new' | 'due' = params.get('mode') === 'new' ? 'new' : 'due'

  const [cards, setCards] = useState<StudyCard[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [counts, setCounts] = useState({ new: 0, due: 0 })

  const reviewedRef = useRef(0)
  const playerRef = useRef<HTMLAudioElement | null>(null)

  const play = (url: string) => {
    if (!playerRef.current) playerRef.current = new Audio()
    const p = playerRef.current
    p.pause()
    p.src = url
    p.currentTime = 0
    p.play().catch(() => {})
  }

  const load = useCallback((kind: 'new' | 'due') => {
    setLoading(true)
    setDone(false)
    setIndex(0)
    setRevealed(false)
    reviewedRef.current = 0
    Promise.all([api.studyQueue(kind, 20), api.studySummary()])
      .then(([q, s]) => {
        setCards(q)
        setCounts({ new: s.new, due: s.due })
        setLoading(false)
      })
      .catch((e) => {
        setLoading(false)
        alert(e.message)
      })
  }, [])

  useEffect(() => {
    load(mode)
  }, [mode, load])

  const current = cards[index]

  const rate = useCallback(
    async (rating: string) => {
      if (!current || submitting) return
      setSubmitting(true)
      try {
        await api.reviewWord(current.id, rating)
        reviewedRef.current += 1
        if (rating === 'again') {
          const next = cards.slice()
          next.splice(index, 1)
          next.push(current)
          setCards(next)
        }
        const nextIndex = index + 1
        if (nextIndex >= cards.length) setDone(true)
        else setIndex(nextIndex)
        setRevealed(false)
      } finally {
        setSubmitting(false)
      }
    },
    [current, submitting, cards, index]
  )

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!current) return
      if (e.key === ' ') {
        e.preventDefault()
        setRevealed((r) => !r)
        return
      }
      if (!revealed) return
      const i = ['1', '2', '3', '4'].indexOf(e.key)
      if (i >= 0) rate(RATINGS[i].key)
    },
    [current, revealed, rate]
  )

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  const switchMode = (kind: 'new' | 'due') => setParams({ mode: kind })

  if (loading) {
    return (
      <div className="review-page">
        <p className="loading">加载中…</p>
      </div>
    )
  }

  return (
    <div className="review-page">
      <div className="review-header">
        <h1>{mode === 'new' ? '学习新词' : '复习'}</h1>
        <div className="review-modes">
          <button className={mode === 'new' ? 'active' : ''} onClick={() => switchMode('new')}>
            学习 ({counts.new})
          </button>
          <button className={mode === 'due' ? 'active' : ''} onClick={() => switchMode('due')}>
            复习 ({counts.due})
          </button>
        </div>
      </div>

      {done ? (
        <div className="review-done">
          <p>本轮完成，共复习 {reviewedRef.current} 个词。</p>
          <button onClick={() => load(mode)}>再来一轮</button>
        </div>
      ) : cards.length === 0 ? (
        <p className="empty">{mode === 'new' ? '没有待学的新词。' : '没有到期的复习词，先休息一下。'}</p>
      ) : (
        <>
          <div className="review-progress">
            第 {index + 1} / {cards.length} 张
          </div>
          <div className="flashcard">
            <div className="flashcard-top">
              <span className="flashcard-word">{current.word}</span>
              {current.weak && <span className="flashcard-weak">弱词 · 多练</span>}
            </div>
            <div className="flashcard-audio">
              {current.us_audio_path && (
                <button onClick={() => play(audioClipUrl(current.us_audio_path))}>▶ 美式</button>
              )}
              {current.uk_audio_path && (
                <button onClick={() => play(audioClipUrl(current.uk_audio_path))}>▶ 英式</button>
              )}
            </div>
            {!revealed ? (
              <button className="flashcard-reveal" onClick={() => setRevealed(true)}>
                显示答案
              </button>
            ) : (
              <div className="flashcard-answer">
                {current.definition && <p className="flashcard-def">{current.definition}</p>}
                {current.translation && <p className="flashcard-trans">{current.translation}</p>}
                {current.context_text && <p className="flashcard-ctx">{current.context_text}</p>}
                {current.context_audio_path && (
                  <button onClick={() => play(audioClipUrl(current.context_audio_path))}>▶ 原声例句</button>
                )}
              </div>
            )}
          </div>
          {revealed && (
            <div className="flashcard-ratings">
              {RATINGS.map((r) => (
                <button key={r.key} className={r.tone} disabled={submitting} onClick={() => rate(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <p className="review-keys">空格 翻面 · 1–4 评分 · 忘记的词该轮会再出现</p>
        </>
      )}
    </div>
  )
}
