import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  api,
  mediaFileUrl,
  recordingUrl,
  type MediaFile,
  type PracticeAttempt,
  type Sentence,
} from '../api'
import { matchedWordIndices } from '../diff'
import { loadPracticeState, savePracticeState } from '../practiceState'
import ScorePanel from '../components/ScorePanel'
import './PracticePage.css'

const SPEEDS = [0.75, 0.85, 1, 1.1]
const LOOP_OPTIONS: { label: string; value: number }[] = [
  { label: '不循环', value: 1 },
  { label: '循环 3 次', value: 3 },
  { label: '循环 5 次', value: 5 },
  { label: '循环 10 次', value: 10 },
  { label: '无限循环', value: Infinity },
]

const STUDY_TIME_FLUSH_MS = 20000

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^a-z'-]/g, '')
}

function wordTokens(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => !/^\s*$/.test(t))
}

export default function PracticePage() {
  const { mediaId } = useParams()
  const id = Number(mediaId)

  const [media, setMedia] = useState<MediaFile | null>(null)
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [currentMs, setCurrentMs] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [speed, setSpeed] = useState(1)
  const [loopTarget, setLoopTarget] = useState(1)
  const [isRecording, setIsRecording] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [scoringIds, setScoringIds] = useState<Set<number>>(new Set())
  const [attemptBySentence, setAttemptBySentence] = useState<Record<number, PracticeAttempt | undefined>>({})
  const [markedWords, setMarkedWords] = useState<Set<string>>(new Set())
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set())
  const [dictationText, setDictationText] = useState<Record<number, string>>({})
  const [dictationLogged, setDictationLogged] = useState<Set<number>>(new Set())
  const [isPlaying, setIsPlaying] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const audioRef = useRef<HTMLAudioElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const loopRemainingRef = useRef(0)
  const studySecRef = useRef(0)
  const playStartRef = useRef<number | null>(null)
  const pendingPlaybackTimeRef = useRef<number | null>(null)

  // 加载完之前存的状态才允许开始自动保存——否则这次挂载自己的初始默认值会在
  // 恢复完成前被存进去，把上一轮真实存的数据覆盖掉（开发模式下 StrictMode 会把
  // 每次挂载的 effect 多跑一轮"挂载→清理→再挂载"，这个时序坑在那种情况下特别容易踩中）。
  const [hasRestored, setHasRestored] = useState(false)

  useEffect(() => {
    setHasRestored(false)
    api.getMedia(id).then(setMedia)
    api.getSentences(id).then((list) => {
      setSentences(list)
      const persisted = loadPracticeState(id)
      const validIds = new Set(list.map((s) => s.id))

      if (persisted) {
        setHiddenIds(new Set(persisted.hiddenIds.filter((sid) => validIds.has(sid))))
        setDictationText(persisted.dictationText)
        setDictationLogged(new Set(persisted.dictationLogged.filter((sid) => validIds.has(sid))))
        setSpeed(persisted.speed)
        setLoopTarget(persisted.loopTarget)
        pendingPlaybackTimeRef.current = persisted.playbackTime || null
        if (persisted.selectedId && validIds.has(persisted.selectedId)) {
          setSelectedId(persisted.selectedId)
          loadAttempt(persisted.selectedId)
        }
      } else {
        setHiddenIds(new Set(list.map((s) => s.id))) // 默认隐藏全部文本，听力模式是默认状态
      }
      setHasRestored(true)
    })
  }, [id])

  const persistState = useCallback(() => {
    if (!hasRestored) return
    savePracticeState(id, {
      selectedId,
      speed,
      loopTarget,
      hiddenIds: [...hiddenIds],
      dictationText,
      dictationLogged: [...dictationLogged],
      playbackTime: audioRef.current?.currentTime ?? 0,
    })
  }, [id, hasRestored, selectedId, speed, loopTarget, hiddenIds, dictationText, dictationLogged])

  // 离开跟读页（切到生词本、上传页……）前，只要上面这些字段有变化就随手存一次，
  // 不必等到卸载那一刻才存一次性的——见上面注释，卸载时机在开发模式下并不可靠。
  useEffect(() => {
    persistState()
  }, [persistState])

  useEffect(() => {
    api.listVocab().then((list) => {
      setMarkedWords(new Set(list.filter((v) => v.media_id === id).map((v) => normalize(v.word))))
    })
  }, [id])

  const selected = sentences.find((s) => s.id === selectedId) || null

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  // 学习分钟：只统计这个主播放器真正处于播放状态的墙钟时间，跟变速无关。
  const flushStudyTime = useCallback((useBeacon: boolean) => {
    if (playStartRef.current !== null) {
      studySecRef.current += (Date.now() - playStartRef.current) / 1000
      playStartRef.current = Date.now()
    }
    const seconds = Math.round(studySecRef.current)
    if (seconds > 0) {
      studySecRef.current = 0
      if (useBeacon) api.reportStudyTimeBeacon(seconds)
      else api.reportStudyTime(seconds).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      flushStudyTime(false)
      persistState() // 长时间连续播放、没有别的状态变化时，顺带把播放进度也存一下
    }, STUDY_TIME_FLUSH_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushStudyTime(true)
        persistState()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onVisibilityChange)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onVisibilityChange)
      flushStudyTime(true)
    }
  }, [flushStudyTime, persistState])

  const onAudioPlay = () => {
    playStartRef.current = Date.now()
    setIsPlaying(true)
  }
  const onAudioPause = () => {
    if (playStartRef.current !== null) {
      studySecRef.current += (Date.now() - playStartRef.current) / 1000
      playStartRef.current = null
    }
    setIsPlaying(false)
    persistState() // 顺手把这次暂停时的播放进度存一下，不用等其他字段变化才触发
  }

  const onTimeUpdate = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const ms = audio.currentTime * 1000
    setCurrentMs(ms)
    if (selected && ms >= selected.end_ms) {
      if (loopRemainingRef.current > 1) {
        loopRemainingRef.current -= 1
        audio.currentTime = selected.start_ms / 1000
        audio.play()
      } else if (loopRemainingRef.current === 1) {
        loopRemainingRef.current = 0
        audio.pause()
      }
    }
  }, [selected])

  const loadAttempt = (sentenceId: number) => {
    api.getPracticeHistory(sentenceId).then((list) => {
      setAttemptBySentence((prev) => ({ ...prev, [sentenceId]: list[0] }))
    })
  }

  const playSentence = (s: Sentence, loops: number) => {
    setSelectedId(s.id)
    if (!(s.id in attemptBySentence)) loadAttempt(s.id)
    loopRemainingRef.current = loops
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = s.start_ms / 1000
    audio.playbackRate = speed
    audio.play()
  }

  const currentSentence = sentences.find((s) => currentMs >= s.start_ms && currentMs < s.end_ms)

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream)
    chunksRef.current = []
    recorder.ondataavailable = (e) => chunksRef.current.push(e.data)
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      if (!selected) return
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      setSubmitting(true)
      try {
        const attempt = await api.submitRecording(selected.id, blob)
        setAttemptBySentence((prev) => ({ ...prev, [selected.id]: attempt }))
      } catch (e) {
        alert(`录音保存失败：${(e as Error).message}`)
      } finally {
        setSubmitting(false)
      }
    }
    mediaRecorderRef.current = recorder
    recorder.start()
    setIsRecording(true)
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }

  const scoreAttempt = async (attempt: PracticeAttempt) => {
    setScoringIds((prev) => new Set(prev).add(attempt.id))
    try {
      const scored = await api.scoreAttempt(attempt.id)
      setAttemptBySentence((prev) => ({ ...prev, [attempt.sentence_id]: scored }))

      for (const word of scored.weak_word_suggestions) {
        const shouldAdd = confirm(`"${word}" 好像总读不准，要不要加入生词本？`)
        if (!shouldAdd) continue
        try {
          await api.markWord(word, attempt.sentence_id)
          setMarkedWords((prev) => new Set(prev).add(normalize(word)))
        } catch (e) {
          alert(`标记失败：${(e as Error).message}`)
        }
      }
    } catch (e) {
      alert(`评分失败：${(e as Error).message}`)
    } finally {
      setScoringIds((prev) => {
        const next = new Set(prev)
        next.delete(attempt.id)
        return next
      })
    }
  }

  const markWord = async (rawWord: string, sentence: Sentence) => {
    const word = rawWord.replace(/[^a-zA-Z'-]/g, '')
    if (!word || markedWords.has(normalize(word))) return
    try {
      await api.markWord(word, sentence.id)
      setMarkedWords((prev) => new Set(prev).add(normalize(word)))
    } catch (e) {
      alert(`标记失败：${(e as Error).message}`)
    }
  }

  const logDictationIfNeeded = (s: Sentence) => {
    if (dictationLogged.has(s.id)) return
    if (!(dictationText[s.id] || '').trim()) return
    setDictationLogged((prev) => new Set(prev).add(s.id))
    api.checkDictation(s.id).catch(() => {})
  }

  const toggleHidden = (s: Sentence) => {
    const wasHidden = hiddenIds.has(s.id)
    setHiddenIds((prev) => {
      const next = new Set(prev)
      if (next.has(s.id)) next.delete(s.id)
      else next.add(s.id)
      return next
    })
    if (wasHidden) logDictationIfNeeded(s)
  }

  const startEdit = (s: Sentence) => {
    setEditingId(s.id)
    setEditDraft(s.text_polished || s.text_raw)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft('')
  }

  const saveEdit = async (s: Sentence) => {
    const text = editDraft.trim()
    if (!text) return
    try {
      const updated = await api.updateSentenceText(s.id, text)
      setSentences((prev) => prev.map((row) => (row.id === s.id ? updated : row)))
      setEditingId(null)
      setEditDraft('')
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`)
    }
  }

  const allHidden = sentences.length > 0 && sentences.every((s) => hiddenIds.has(s.id))
  const toggleHideAll = () => {
    if (allHidden) sentences.forEach(logDictationIfNeeded)
    setHiddenIds(allHidden ? new Set() : new Set(sentences.map((s) => s.id)))
  }

  if (!media) return <p className="loading">加载中…</p>

  return (
    <div className="practice-page">
      <h1>{media.original_name}</h1>
      <p className="hint">点击句首 ▶ 跟读该句；双击句中任意单词，标记为生词。</p>

      <audio
        ref={audioRef}
        src={mediaFileUrl(media)}
        controls
        onTimeUpdate={onTimeUpdate}
        onPlay={onAudioPlay}
        onPause={onAudioPause}
        onEnded={onAudioPause}
        onLoadedMetadata={() => {
          if (pendingPlaybackTimeRef.current !== null && audioRef.current) {
            audioRef.current.currentTime = pendingPlaybackTimeRef.current
            pendingPlaybackTimeRef.current = null
          }
        }}
        className="player"
      />

      <div className="toolbar">
        <div className="speed-group">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <select value={loopTarget} onChange={(e) => setLoopTarget(Number(e.target.value))}>
            {LOOP_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="hide-all-btn" onClick={toggleHideAll}>
            {allHidden ? '👁 显示全部文本' : '🙈 隐藏全部文本（听力模式）'}
          </button>
        </div>
      </div>

      <ul className="sentence-list">
        {sentences.map((s) => {
          const isCurrent = currentSentence?.id === s.id
          const isSelected = selectedId === s.id
          const isHidden = hiddenIds.has(s.id)
          const text = s.text_polished || s.text_raw
          const attempt = attemptBySentence[s.id]
          const typed = dictationText[s.id] || ''
          const matched = typed.trim() ? matchedWordIndices(wordTokens(text), wordTokens(typed)) : null

          let wordIdx = -1

          return (
            <li key={s.id} className={`sentence-row ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}`}>
              <span className={`sentence-num ${isCurrent ? 'current' : ''}`}>{s.idx + 1}</span>
              <button
                className="sentence-play"
                onClick={() => (isCurrent && isPlaying ? audioRef.current?.pause() : playSentence(s, loopTarget))}
                aria-label={isCurrent && isPlaying ? '暂停' : '跟读该句'}
              >
                {isCurrent && isPlaying ? '⏸' : '▶'}
              </button>
              <div className="sentence-body">
                <textarea
                  className="dictation-input"
                  placeholder="输入你听到的内容…"
                  value={typed}
                  onChange={(e) => setDictationText((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  rows={1}
                />

                <div className="sentence-text-row">
                  {isHidden ? (
                    <button className="text-placeholder" onClick={() => toggleHidden(s)}>
                      显示原句对比
                    </button>
                  ) : editingId === s.id ? (
                    <div className="sentence-edit">
                      <textarea
                        className="sentence-edit-input"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={2}
                        autoFocus
                      />
                      <div className="sentence-edit-actions">
                        <button className="edit-save" onClick={() => saveEdit(s)}>
                          保存
                        </button>
                        <button className="edit-cancel" onClick={cancelEdit}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="sentence-text">
                      {text.split(/(\s+)/).map((token, i) => {
                        if (/^\s+$/.test(token)) return token
                        wordIdx++
                        const idx = wordIdx
                        const diffClass = matched ? (matched.has(idx) ? 'diff-hit' : 'diff-miss') : ''
                        return (
                          <span
                            key={i}
                            className={`word ${diffClass} ${markedWords.has(normalize(token)) ? 'marked' : ''}`}
                            onDoubleClick={() => markWord(token, s)}
                          >
                            {token}
                          </span>
                        )
                      })}
                    </p>
                  )}
                  {!isHidden && editingId !== s.id && (
                    <button className="edit-toggle" onClick={() => startEdit(s)} aria-label="编辑字幕文本">
                      ✎
                    </button>
                  )}
                  <button className="reveal-toggle" onClick={() => toggleHidden(s)} aria-label="切换文本显示">
                    {isHidden ? '👁' : '🙈'}
                  </button>
                </div>

                {isSelected && (
                  <div className="record-controls">
                    {isRecording ? (
                      <button className="record-btn recording" onClick={stopRecording}>
                        ⏹ 停止录音
                      </button>
                    ) : (
                      <button className="record-btn" onClick={startRecording} disabled={submitting}>
                        {submitting ? '保存中…' : '🎙 跟读录音'}
                      </button>
                    )}
                  </div>
                )}

                {isSelected && attempt && (
                  <div className="attempt-row">
                    <div className="attempt-top">
                      <audio controls src={recordingUrl(attempt.audio_path)} className="attempt-audio" />
                      {!attempt.scored && (
                        <button
                          className="score-btn"
                          onClick={() => scoreAttempt(attempt)}
                          disabled={scoringIds.has(attempt.id)}
                        >
                          {scoringIds.has(attempt.id) ? '评分中…' : '⭐ 评分'}
                        </button>
                      )}
                    </div>
                    {attempt.scored && <ScorePanel attempt={attempt} />}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
