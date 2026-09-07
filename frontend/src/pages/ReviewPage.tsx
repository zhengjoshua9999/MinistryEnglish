import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, audioClipUrl, type StudyCard, type StudySession, type StudySettings } from '../api'
import { recordLegacyStudy } from '../legacyStudyStats'
import './ReviewPage.css'

type Rating = 'known' | 'fuzzy' | 'unknown'
type LegacyEntry = { card: StudyCard; formal: boolean; repeatCount: number }

const RATINGS: { key: Rating; label: string; hint: string; tone: string }[] = [
  { key: 'known', label: '认识', hint: '立即想起', tone: 'rate-known' },
  { key: 'fuzzy', label: '模糊', hint: '想起一部分', tone: 'rate-fuzzy' },
  { key: 'unknown', label: '不认识', hint: '没有想起', tone: 'rate-unknown' },
]

const LEGACY_RATING: Record<Rating, 'again' | 'hard' | 'good'> = {
  known: 'good',
  fuzzy: 'hard',
  unknown: 'again',
}

function legacySession(mode: 'new' | 'due', queue: LegacyEntry[], index: number, ratings?: StudySession['ratings']): StudySession {
  return {
    id: 'legacy',
    mode,
    current_card: queue[index]?.card ?? null,
    current_number: Math.min(index + 1, queue.length),
    total: queue.length,
    completed: index >= queue.length && queue.length > 0,
    ratings: ratings ?? { known: 0, fuzzy: 0, unknown: 0 },
  }
}

function blankWord(context: string, word: string): string {
  if (!context || !word) return context
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return context.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '________')
}

function preferredAudio(card: StudyCard, settings: StudySettings): string {
  const paths = { us: card.us_audio_path, uk: card.uk_audio_path, context: card.context_audio_path }
  return paths[settings.preferred_audio] || card.us_audio_path || card.uk_audio_path || card.context_audio_path
}

const norm = (s: string) => s.trim().toLowerCase()

interface SpellWord {
  word: string
  pos: string
  definition: string
  translation: string
}

interface SpellState {
  words: SpellWord[]
  idx: number
  input: string
  wrong: SpellWord[]
  reveal: boolean
  correct: number
}

interface SessionWord {
  word: string
  pos: string
  definition: string
  translation: string
  status?: string
  memory_stage?: number
  interval_days?: number
  due_at?: string | null
  lapses?: number
  reps?: number
}

const reviewLabel = (w: SessionWord): string => {
  if (w.status === 'mastered') return '复习完成'
  if (!w.due_at) return '待安排'
  const days = Math.max(0, Math.ceil((new Date(w.due_at).getTime() - Date.now()) / 86400000))
  return days <= 0 ? '今天复习' : `${days}天后复习`
}

export default function ReviewPage({
  initialMode = 'due',
  settings,
  onExit,
}: {
  initialMode?: 'new' | 'due'
  settings: StudySettings
  onExit: () => void
}) {
  const [mode, setMode] = useState<'new' | 'due'>(initialMode)
  const [session, setSession] = useState<StudySession | null>(null)
  const [queuedSession, setQueuedSession] = useState<StudySession | null>(null)
  const [answerCard, setAnswerCard] = useState<StudyCard | null>(null)
  const [pendingRating, setPendingRating] = useState<Rating | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const recallStartedAt = useRef(Date.now())
  const playerRef = useRef<HTMLAudioElement | null>(null)
  const legacyQueueRef = useRef<LegacyEntry[]>([])
  const legacyIndexRef = useRef(0)
  // 拼写测试（一组闪卡完成后）
  const [spell, setSpell] = useState<SpellState | null>(null)
  const [noSpelling, setNoSpelling] = useState(() => localStorage.getItem('vocabNoSpellingInReview') === '1')
  // 小结列表
  const [showSummary, setShowSummary] = useState(false)
  const [summaryWords, setSummaryWords] = useState<SessionWord[]>([])
  const [remain, setRemain] = useState(0)

  const startSpelling = useCallback(async (sessionId: string, skipInteractive: boolean) => {
    const words = await api.getSessionWords(sessionId)
    setSpell({
      words,
      idx: skipInteractive ? words.length : 0,
      input: '',
      wrong: [],
      reveal: false,
      correct: 0,
    })
  }, [])

  // 会话完成 -> 自动进入拼写测试（除非勾了“复习时不再拼写”）
  useEffect(() => {
    if (!session?.completed || spell) return
    startSpelling(session.id, noSpelling).catch(() => {})
  }, [session, spell, noSpelling, startSpelling])

  const play = useCallback((path: string) => {
    if (!path) return
    if (!playerRef.current) playerRef.current = new Audio()
    const player = playerRef.current
    player.pause()
    player.src = audioClipUrl(path)
    player.currentTime = 0
    player.play().catch(() => {})
  }, [])

  const load = useCallback((kind: 'new' | 'due') => {
    setLoading(true)
    setError('')
    setAnswerCard(null)
    setQueuedSession(null)
    setPendingRating(null)
    api.createStudySession(kind)
      .then((next) => {
        setSession(next)
        recallStartedAt.current = Date.now()
      })
      .catch(async (e: Error) => {
        if (!/404|405|not found|method not allowed/i.test(e.message)) throw e
        const limit = kind === 'new' ? settings.new_group_size : settings.review_group_size
        const cards = await api.legacyStudyQueue(kind, limit)
        legacyQueueRef.current = cards.map((card) => {
          const legacyCard = card as StudyCard & { weak?: boolean }
          return {
            card: { ...card, pronunciation_weak: card.pronunciation_weak ?? Boolean(legacyCard.weak) },
            formal: true,
            repeatCount: 0,
          }
        })
        legacyIndexRef.current = 0
        setSession(legacySession(kind, legacyQueueRef.current, 0))
        recallStartedAt.current = Date.now()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [settings.new_group_size, settings.review_group_size])

  useEffect(() => load(mode), [mode, load])

  const current = session?.current_card ?? null
  const shownCard = answerCard ?? current
  const contextPrompt = useMemo(
    () => shownCard && settings.show_context_during_recall ? blankWord(shownCard.context_text, shownCard.word) : '',
    [shownCard, settings.show_context_during_recall],
  )

  useEffect(() => {
    if (!current || answerCard || !settings.autoplay_audio) return
    play(preferredAudio(current, settings))
  }, [current, answerCard, settings, play])

  const submitRating = useCallback(async (rating: Rating) => {
    if (!session || !current || submitting) return
    const ratedCard = current
    setPendingRating(rating)
    setAnswerCard(ratedCard)
    setSubmitting(true)
    setError('')
    try {
      if (session.id === 'legacy') {
        const queue = [...legacyQueueRef.current]
        const index = legacyIndexRef.current
        const entry = queue[index]
        if (!entry || entry.card.id !== ratedCard.id) throw new Error('当前单词已发生变化，请重新载入')
        if (entry.formal) {
          await api.legacyReviewWord(ratedCard.id, LEGACY_RATING[rating])
          recordLegacyStudy(mode)
        }

        const repeatLimit = rating === 'unknown' ? 2 : rating === 'fuzzy' ? 1 : 0
        if (entry.repeatCount < repeatLimit) {
          queue.splice(Math.min(index + 4, queue.length), 0, {
            card: ratedCard,
            formal: false,
            repeatCount: entry.repeatCount + 1,
          })
        }
        const ratings = { ...session.ratings }
        if (entry.formal) ratings[rating] += 1
        legacyQueueRef.current = queue
        legacyIndexRef.current = index + 1
        setQueuedSession(legacySession(mode, queue, index + 1, ratings))
        return
      }
      const next = await api.reviewSessionWord(
        session.id,
        ratedCard.id,
        rating,
        Date.now() - recallStartedAt.current,
      )
      setQueuedSession(next)
    } catch (e) {
      // 响应在网络中断时可能丢失；先读取服务端会话，避免盲目重试造成重复评价。
      try {
        const serverSession = await api.getStudySession(session.id)
        if (serverSession.completed || serverSession.current_card?.id !== ratedCard.id) {
          setQueuedSession(serverSession)
        } else {
          setError(e instanceof Error ? e.message : '保存失败，请重试')
        }
      } catch {
        setError(e instanceof Error ? e.message : '保存失败，请重试')
      }
    } finally {
      setSubmitting(false)
    }
  }, [session, current, submitting, mode])

  const chooseRating = useCallback((rating: Rating) => {
    if (!current || submitting) return
    submitRating(rating)
  }, [current, submitRating, submitting])

  const nextCard = useCallback(() => {
    if (!queuedSession || submitting) return
    setSession(queuedSession)
    setQueuedSession(null)
    setAnswerCard(null)
    setPendingRating(null)
    recallStartedAt.current = Date.now()
  }, [queuedSession, submitting])

  const checkSpell = useCallback(() => {
    setSpell((s) => {
      if (!s) return s
      const w = s.words[s.idx]
      if (!w) return s
      if (s.reveal) {
        const next = s.idx + 1
        return { ...s, idx: next, input: '', reveal: false }
      }
      if (norm(s.input) === norm(w.word)) {
        const next = s.idx + 1
        return { ...s, idx: next, input: '', reveal: false, correct: s.correct + 1 }
      }
      return { ...s, wrong: s.wrong.some((x) => x.word === w.word) ? s.wrong : [...s.wrong, w], reveal: true }
    })
  }, [])

  const reinforceSpell = useCallback(() => {
    setSpell((s) => {
      if (!s || !s.wrong.length) return s
      return { words: s.wrong, idx: 0, input: '', wrong: [], reveal: false, correct: 0 }
    })
  }, [])

  const openSummary = useCallback(() => {
    if (!session) return
    api.getSessionWords(session.id).then(setSummaryWords).catch(() => {})
    api
      .studySummary()
      .then((s) => setRemain(s.total - s.mastered))
      .catch(() => setRemain(0))
    setShowSummary(true)
  }, [session])

  const continueSummary = useCallback(() => {
    setShowSummary(false)
    load(mode)
  }, [load, mode])

  const onKey = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.matches('input, select, textarea')) return
    if (event.key === 'Escape') {
      onExit()
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      if (shownCard) play(preferredAudio(shownCard, settings))
      return
    }
    if (answerCard && event.key === 'Enter') {
      event.preventDefault()
      if (queuedSession) nextCard()
      else if (pendingRating) submitRating(pendingRating)
      return
    }
    if (!answerCard) {
      const index = ['1', '2', '3'].indexOf(event.key)
      if (index >= 0) chooseRating(RATINGS[index].key)
    }
  }, [answerCard, chooseRating, nextCard, onExit, pendingRating, play, queuedSession, settings, shownCard, submitRating])

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  if (showSummary) {
    return (
      <div className="review-page">
        <header className="review-header">
          <button className="review-back" onClick={onExit} aria-label="退出学习">‹</button>
          <div className="review-progress">小结</div>
          <span />
        </header>
        <div className="summary-banner">💡 快速回顾本组单词吧~</div>
        <ul className="summary-list">
          {summaryWords.map((w) => (
            <li key={w.word} className="summary-item">
              <span className="summary-word">{w.word}</span>
              <span className={`summary-status ${w.status === 'mastered' ? 'done' : ''}`}>{reviewLabel(w)}</span>
            </li>
          ))}
        </ul>
        <div className="summary-footer">
          <p>
            已复习 <strong>{summaryWords.length}</strong> 词，还剩 <strong>{remain}</strong> 词
          </p>
          <button className="continue-btn" onClick={continueSummary}>
            继续复习
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="review-overlay">
      <main className="review-page">
        <header className="review-header">
          <button className="review-back" onClick={onExit} aria-label="退出学习">‹</button>
          <div className="review-progress">
            {session && session.total > 0 ? `${session.current_number} / ${session.total}` : mode === 'new' ? '学习' : '复习'}
          </div>
          <div className="review-modes" aria-label="切换学习模式">
            <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>新学</button>
            <button className={mode === 'due' ? 'active' : ''} onClick={() => setMode('due')}>复习</button>
          </div>
        </header>

        {loading ? (
          <p className="review-state">正在准备本组单词…</p>
        ) : error && !shownCard ? (
          <div className="review-state"><p>{error}</p><button onClick={() => load(mode)}>重新载入</button></div>
        ) : session && session.total === 0 ? (
          <section className="review-state">
            <h1>{mode === 'new' ? '今天的新词已经学完' : '现在没有到期单词'}</h1>
            <p>{mode === 'new' ? '可以去复习已经学过的词。' : '记忆也需要休息，稍后再来。'}</p>
            <button onClick={onExit}>返回生词本</button>
          </section>
        ) : session?.completed ? (
          spell && spell.idx < spell.words.length ? (
            <section className="spell-card">
              <p className="spell-progress">
                {spell.idx + 1} / {spell.words.length}
              </p>
              <div className="spell-prompt">
                {spell.words[spell.idx].pos && <span className="spell-pos">{spell.words[spell.idx].pos}</span>}
                <span>{spell.words[spell.idx].translation || spell.words[spell.idx].definition}</span>
              </div>
              <input
                className="spell-input"
                value={spell.input}
                onChange={(e) => setSpell((s) => (s ? { ...s, input: e.target.value } : s))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    checkSpell()
                  }
                }}
                placeholder="输入你听到/看到的单词…"
                autoFocus
                autoComplete="off"
                disabled={spell.reveal}
              />
              {spell.reveal && <p className="spell-answer">正确答案：{spell.words[spell.idx].word}</p>}
              <button className="primary" disabled={!spell.reveal && !spell.input.trim()} onClick={checkSpell}>
                {spell.reveal ? '下一题' : '检查'}
              </button>
            </section>
          ) : (
            <section className="review-done">
              <span className="review-done-mark">😎</span>
              <h1>本组单词辨识完成</h1>
              <p className="spell-result">
                {spell ? (spell.wrong.length ? `错 ${spell.wrong.length} 个` : '全对！') : '已跳过拼写'} · 共{' '}
                {spell?.words.length ?? session.total} 个
              </p>
              <div className="review-done-actions">
                <button className="primary" disabled={!spell?.wrong.length} onClick={reinforceSpell}>
                  强化拼写
                </button>
                <button onClick={openSummary}>小结</button>
              </div>
              <label className="no-spelling-toggle">
                <input
                  type="checkbox"
                  checked={noSpelling}
                  onChange={(e) => {
                    setNoSpelling(e.target.checked)
                    localStorage.setItem('vocabNoSpellingInReview', e.target.checked ? '1' : '0')
                  }}
                />
                复习时不再拼写（下次直接进小结）
              </label>
            </section>
          )
        ) : !shownCard ? null : (
          <>
            <section className={`flashcard ${answerCard ? 'is-revealed' : ''}`}>
              <div className="flashcard-heading">
                <h1>{shownCard.word}</h1>
                <button className="audio-main" onClick={() => play(preferredAudio(shownCard, settings))} aria-label="播放首选发音">⌁</button>
              </div>
              {shownCard.pronunciation_weak && <span className="flashcard-weak">发音待加强</span>}

              {!answerCard ? (
                <>
                  {contextPrompt && <p className="flashcard-prompt">{contextPrompt}</p>}
                  <p className="recall-hint">先在心里说出词义，再选择记忆程度</p>
                </>
              ) : (
                <div className="flashcard-answer">
                  <p className="flashcard-meaning">
                    {shownCard.pos && <span>{shownCard.pos}</span>}
                    {shownCard.translation || '暂无中文释义'}
                  </p>
                  {shownCard.definition && <p className="flashcard-def">{shownCard.definition}</p>}
                  {shownCard.context_text && (
                    <div className="example-card">
                      <p>{shownCard.context_text}</p>
                      {shownCard.context_audio_path && (
                        <button onClick={() => play(shownCard.context_audio_path)} aria-label="播放原声例句">▶ 原声</button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            {!answerCard ? (
              <div className="flashcard-ratings">
                {RATINGS.map((rating, index) => (
                  <button key={rating.key} className={rating.tone} onClick={() => chooseRating(rating.key)}>
                    <strong>{rating.label}</strong><span>{rating.hint} · {index + 1}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="answer-actions">
                <div className="rating-correction">
                  <span>本次：</span>
                  <strong>{RATINGS.find((rating) => rating.key === pendingRating)?.label}</strong>
                </div>
                <button
                  className="next-card"
                  disabled={submitting}
                  onClick={() => queuedSession ? nextCard() : pendingRating && submitRating(pendingRating)}
                >
                  {submitting ? '保存中…' : queuedSession ? '下一词' : '重试保存'}
                </button>
              </div>
            )}
            {error && <p className="review-error">{error}</p>}
            <p className="review-keys">空格播放发音 · 1–3 选择 · 回车下一词 · Esc 退出</p>
          </>
        )}
      </main>
    </div>
  )
}
