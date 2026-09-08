import { useEffect, useRef, useState } from 'react'
import { api, audioClipUrl, type StudySettings, type StudySummary, type VocabWord } from '../api'
import { legacyStudyCounts } from '../legacyStudyStats'
import ReviewPage from './ReviewPage'
import './VocabPage.css'

const STATUS_LABEL: Record<VocabWord['status'], string> = {
  new: '新标记',
  reviewing: '复习中',
  mastered: '已掌握',
}

const DEFAULT_SETTINGS: StudySettings = {
  new_group_size: 5,
  review_group_size: 10,
  daily_new_limit: 20,
  autoplay_audio: true,
  preferred_audio: 'us',
  show_context_during_recall: true,
}

const LEGACY_SETTINGS_KEY = 'ministry-english:vocab-study-settings:v1'

function readLegacySettings(): StudySettings | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY) || 'null')
    if (!value || typeof value !== 'object') return null
    const candidate = value as Partial<StudySettings>
    if (typeof candidate.new_group_size !== 'number' || typeof candidate.review_group_size !== 'number' || typeof candidate.daily_new_limit !== 'number') return null
    if (candidate.preferred_audio !== 'us' && candidate.preferred_audio !== 'uk' && candidate.preferred_audio !== 'context') return null
    if (typeof candidate.autoplay_audio !== 'boolean' || typeof candidate.show_context_during_recall !== 'boolean') return null
    return candidate as StudySettings
  } catch {
    return null
  }
}

function saveLegacySettings(settings: StudySettings) {
  try { localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(settings)) } catch { /* 受限存储时仍允许正常学习 */ }
}

function isMissingSettingsEndpoint(error: unknown): boolean {
  return error instanceof Error && /(?:404|405).*?(?:not found|method not allowed)/i.test(error.message)
}

function todayLocalIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export default function VocabPage() {
  const [words, setWords] = useState<VocabWord[]>([])
  const [filter, setFilter] = useState<string>('')
  const [summary, setSummary] = useState<StudySummary | null>(null)
  const [view, setView] = useState<'browse' | 'review'>('browse')
  const [reviewKind, setReviewKind] = useState<'new' | 'due'>('due')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<StudySettings>(DEFAULT_SETTINGS)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState('')
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

  const refresh = () => {
    api.listVocab(filter || undefined).then(setWords)
    api.studySummary().then((data) => setSummary((previous) => {
      // 桌面应用更新时，前端静态文件可能先于后台进程重启。旧摘要没有
      // settings 时，保留刚由 PATCH 成功返回的设置，不能回退成默认值。
      const settings = data.settings ?? previous?.settings ?? readLegacySettings() ?? DEFAULT_SETTINGS
      const learnedLocally = legacyStudyCounts(todayLocalIso(), 'day').learned
      return {
        ...data,
        settings,
        available_new: data.available_new ?? Math.min(data.new, Math.max(0, settings.daily_new_limit - learnedLocally)),
        active_session_id: data.active_session_id ?? null,
      }
    })).catch(() => setSummary(null))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  if (view === 'review') {
    return (
      <ReviewPage
        initialMode={reviewKind}
        settings={summary?.settings ?? DEFAULT_SETTINGS}
        onExit={() => {
          setView('browse')
          refresh()
        }}
      />
    )
  }

  const openSettings = () => {
    setSettingsDraft(summary?.settings ?? DEFAULT_SETTINGS)
    setSettingsError('')
    setSettingsOpen(true)
  }

  const saveSettings = async () => {
    if (savingSettings) return
    setSavingSettings(true)
    setSettingsError('')
    try {
      // 以 PATCH 的返回值为准立即刷新界面；不能只等待后续摘要请求，后者在
      // 后端尚未更新或网络竞态时会把刚保存的值又显示回默认设置。
      const saved = await api.updateStudySettings(settingsDraft)
      setSettingsDraft(saved)
      setSummary((previous) => previous ? { ...previous, settings: saved } : previous)
      setSettingsOpen(false)
      refresh()
    } catch (error) {
      // 兼容尚未重启的旧版桌面后端：它没有 PATCH settings 接口。学习页的
      // 旧队列会直接读取这里传入的 settings，因此本机保存仍能立刻生效。
      if (isMissingSettingsEndpoint(error)) {
        saveLegacySettings(settingsDraft)
        setSummary((previous) => previous ? { ...previous, settings: settingsDraft } : previous)
        setSettingsOpen(false)
        return
      }
      setSettingsError(error instanceof Error ? `保存失败：${error.message}` : '保存失败，请重试')
    } finally {
      setSavingSettings(false)
    }
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
          <p className="lede">把遇见的词，变成真正会用的词。</p>
        </div>
        <button className="vocab-settings-open" onClick={openSettings}>学习设置</button>
      </div>

      <section className="study-dashboard">
        <div className="study-dashboard-copy">
          <div>
            <span>今日任务</span>
            <h2>{summary?.due ?? 0} 个待复习 · {summary?.available_new ?? 0} 个可新学</h2>
            <p>先完成到期复习，再开始今天的新词。</p>
          </div>
          <button
            className="start-today"
            disabled={!summary || (!summary.due && !summary.available_new)}
            onClick={() => { setReviewKind(summary?.due ? 'due' : 'new'); setView('review') }}
          >
            {summary && !summary.due && !summary.available_new ? '今日已完成' : '开始今日任务'}
          </button>
        </div>
        <div className="study-launch-grid">
          <button onClick={() => { setReviewKind('new'); setView('review') }} disabled={!summary?.available_new}>
            <span>学习新词</span>
            <strong>{summary?.available_new ?? 0}</strong>
            <small>每组 {summary?.settings?.new_group_size ?? 5} 个</small>
          </button>
          <button onClick={() => { setReviewKind('due'); setView('review') }} disabled={!summary?.due}>
            <span>到期复习</span>
            <strong>{summary?.due ?? 0}</strong>
            <small>每组 {summary?.settings?.review_group_size ?? 10} 个</small>
          </button>
        </div>
        <div className="study-stats">
          <span>新词 <strong>{summary?.new ?? 0}</strong></span>
          <span>学习中 <strong>{summary?.reviewing ?? 0}</strong></span>
          <span>已掌握 <strong>{summary?.mastered ?? 0}</strong></span>
        </div>
      </section>

      <div className="vocab-toolbar">
        <h2>全部单词 <span>{summary?.total ?? words.length}</span></h2>
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

      {settingsOpen && (
        <div className="settings-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="study-settings" role="dialog" aria-modal="true" aria-labelledby="study-settings-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="study-settings-header">
              <div><h2 id="study-settings-title">学习设置</h2><p>设置只影响之后开始的新组。</p></div>
              <button onClick={() => setSettingsOpen(false)} aria-label="关闭">×</button>
            </div>
            <label>每组学习新词<input type="number" min="5" max="50" value={settingsDraft.new_group_size} onChange={(e) => setSettingsDraft({ ...settingsDraft, new_group_size: Number(e.target.value) })} /></label>
            <label>每组复习单词<input type="number" min="5" max="100" value={settingsDraft.review_group_size} onChange={(e) => setSettingsDraft({ ...settingsDraft, review_group_size: Number(e.target.value) })} /></label>
            <label>每日新词上限<input type="number" min="0" max="200" value={settingsDraft.daily_new_limit} onChange={(e) => setSettingsDraft({ ...settingsDraft, daily_new_limit: Number(e.target.value) })} /></label>
            <label>首选发音<select value={settingsDraft.preferred_audio} onChange={(e) => setSettingsDraft({ ...settingsDraft, preferred_audio: e.target.value as StudySettings['preferred_audio'] })}><option value="us">美式</option><option value="uk">英式</option><option value="context">原声</option></select></label>
            <label className="settings-check"><input type="checkbox" checked={settingsDraft.autoplay_audio} onChange={(e) => setSettingsDraft({ ...settingsDraft, autoplay_audio: e.target.checked })} />自动播放发音</label>
            <label className="settings-check"><input type="checkbox" checked={settingsDraft.show_context_during_recall} onChange={(e) => setSettingsDraft({ ...settingsDraft, show_context_during_recall: e.target.checked })} />回忆时显示挖空原句</label>
            {settingsError && <p className="settings-error" role="alert">{settingsError}</p>}
            <div className="study-settings-footer"><button disabled={savingSettings} onClick={() => setSettingsDraft(DEFAULT_SETTINGS)}>恢复默认</button><button className="primary" disabled={savingSettings} onClick={saveSettings}>{savingSettings ? '保存中…' : '保存'}</button></div>
          </section>
        </div>
      )}

      {words.length === 0 ? (
        <p className="empty">还没有标记生词。在跟读练习页双击单词即可加入这里。</p>
      ) : (
        <div className="vocab-grid">
          {words.map((w) => (
            <div key={w.id} className="vocab-card">
              <div className="vocab-card-top">
                <span className="vocab-headword">
                  <span className="vocab-word">{w.word}</span>
                  {w.pos && <span className="vocab-pos">{w.pos}</span>}
                </span>
                <span className={`status-dot status-${w.status}`}>
                  {STATUS_LABEL[w.status]}
                </span>
              </div>
              {w.definition && <p className="vocab-def">{w.definition}</p>}
              {w.translation && <p className="vocab-trans">{w.translation}</p>}
              <p className="vocab-example">{w.context_text}</p>
              {w.source_media_name && <p className="vocab-source">来源：{w.source_media_name}</p>}
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
