import { useEffect, useRef, useState } from 'react'
import { api, audioClipUrl, type VocabWord } from '../api'
import './VocabPage.css'

const STATUS_LABEL: Record<VocabWord['status'], string> = {
  new: '新标记',
  reviewing: '复习中',
  mastered: '已掌握',
}

export default function VocabPage() {
  const [words, setWords] = useState<VocabWord[]>([])
  const [filter, setFilter] = useState<string>('')
  // 全页共享一个音频实例：不管连点同一个发音按钮，还是在原声/美式/英式之间来回点，
  // 任何时刻最多一路声音在响，后点的直接打断前一个，不会叠在一起播。
  const playerRef = useRef<HTMLAudioElement | null>(null)

  const play = (url: string) => {
    if (!playerRef.current) playerRef.current = new Audio()
    const player = playerRef.current
    player.pause()
    player.src = url
    player.currentTime = 0
    player.play().catch(() => {})
  }

  const refresh = () => api.listVocab(filter || undefined).then(setWords)

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const cycleStatus = async (w: VocabWord) => {
    const next: VocabWord['status'] = w.status === 'new' ? 'reviewing' : w.status === 'reviewing' ? 'mastered' : 'new'
    await api.updateVocabStatus(w.id, next)
    refresh()
  }

  const remove = async (w: VocabWord) => {
    await api.deleteVocab(w.id)
    refresh()
  }

  return (
    <div className="vocab-page">
      <div className="vocab-header">
        <div>
          <h1>生词本</h1>
          <p className="lede">{words.length} 个生词</p>
        </div>
        <div className="vocab-actions">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">全部</option>
            <option value="new">新标记</option>
            <option value="reviewing">复习中</option>
            <option value="mastered">已掌握</option>
          </select>
          <a className="export-link" href="/api/vocab/export/wordlist.txt" download>
            导出词表 (.txt)
          </a>
          <a className="export-link" href="/api/vocab/export/anki.txt" download>
            导出 Anki
          </a>
        </div>
      </div>

      {words.length === 0 ? (
        <p className="empty">还没有标记生词。在跟读练习页或双语阅读页双击单词即可加入这里。</p>
      ) : (
        <div className="vocab-grid">
          {words.map((w) => (
            <div key={w.id} className="vocab-card">
              <div className="vocab-card-top">
                <span className="vocab-headword">
                  <span className="vocab-word">{w.word}</span>
                  {w.pos && <span className="vocab-pos">{w.pos}</span>}
                </span>
                <button className={`status-dot status-${w.status}`} onClick={() => cycleStatus(w)} title="点击切换状态">
                  {STATUS_LABEL[w.status]}
                </button>
              </div>
              {w.definition && <p className="vocab-def">{w.definition}</p>}
              {w.translation && <p className="vocab-trans">{w.translation}</p>}
              <p className="vocab-example">{w.context_text}</p>
              {w.source_type === 'book' && <p className="vocab-source">来源：书籍阅读（不生成音频）</p>}
              <div className="vocab-audio-row">
                {w.context_audio_path && (
                  <button onClick={() => play(audioClipUrl(w.context_audio_path))}>▶ 原声</button>
                )}
                {w.us_audio_path && <button onClick={() => play(audioClipUrl(w.us_audio_path))}>▶ 美式</button>}
                {w.uk_audio_path && <button onClick={() => play(audioClipUrl(w.uk_audio_path))}>▶ 英式</button>}
              </div>
              <button className="vocab-delete" onClick={() => remove(w)}>
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
