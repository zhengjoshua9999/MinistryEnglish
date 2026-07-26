export interface MediaFile {
  id: number
  filename: string
  original_name: string
  duration_sec: number
  status: 'uploaded' | 'transcribing' | 'ready' | 'error'
  progress: number
  error_message: string
  created_at: string
}

export interface Sentence {
  id: number
  media_id: number
  idx: number
  start_ms: number
  end_ms: number
  text_raw: string
  text_polished: string
}

export interface WordScore {
  word: string
  accuracy: number
  error_type: string
}

export interface PracticeAttempt {
  id: number
  sentence_id: number
  audio_path: string
  scored: boolean
  accuracy: number
  fluency: number
  completeness: number
  pron_score: number
  word_scores_json: string
  created_at: string
  weak_word_suggestions: string[]
}

export interface DailyActivity {
  period: string
  label: string
  study_seconds: number
  dictation_count: number
  shadow_count: number
  new_word_count: number
}

export type StatsGranularity = 'day' | 'week' | 'month'

export interface VocabWord {
  id: number
  word: string
  media_id: number
  sentence_id: number
  context_text: string
  definition: string
  translation: string
  pos: string
  context_audio_path: string
  us_audio_path: string
  uk_audio_path: string
  status: 'new' | 'reviewing' | 'mastered'
  created_at: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listMedia: () => request<MediaFile[]>('/api/media'),
  getMedia: (id: number) => request<MediaFile>(`/api/media/${id}`),
  deleteMedia: (id: number) => request(`/api/media/${id}`, { method: 'DELETE' }),

  uploadMedia: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<MediaFile>('/api/media/upload', { method: 'POST', body: form })
  },

  getSentences: (mediaId: number) => request<Sentence[]>(`/api/media/${mediaId}/sentences`),

  submitRecording: (sentenceId: number, blob: Blob) => {
    const form = new FormData()
    form.append('file', blob, 'recording.webm')
    return request<PracticeAttempt>(`/api/sentences/${sentenceId}/practice`, {
      method: 'POST',
      body: form,
    })
  },
  scoreAttempt: (attemptId: number) =>
    request<PracticeAttempt>(`/api/practice/${attemptId}/score`, { method: 'POST' }),
  getPracticeHistory: (sentenceId: number) =>
    request<PracticeAttempt[]>(`/api/sentences/${sentenceId}/practice`),

  listVocab: (status?: string) =>
    request<VocabWord[]>(`/api/vocab${status ? `?status=${status}` : ''}`),
  markWord: (word: string, sentenceId: number) =>
    request<VocabWord>('/api/vocab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, sentence_id: sentenceId }),
    }),
  updateVocabStatus: (id: number, status: string) =>
    request<VocabWord>(`/api/vocab/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
  deleteVocab: (id: number) => request(`/api/vocab/${id}`, { method: 'DELETE' }),

  getStats: (granularity: StatsGranularity) =>
    request<DailyActivity[]>(`/api/stats?granularity=${granularity}`),
  checkDictation: (sentenceId: number) =>
    request(`/api/sentences/${sentenceId}/dictation-check`, { method: 'POST' }),
  reportStudyTime: (seconds: number) =>
    request('/api/stats/study-time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds }),
    }),
  reportStudyTimeBeacon: (seconds: number) => {
    const blob = new Blob([JSON.stringify({ seconds })], { type: 'application/json' })
    navigator.sendBeacon('/api/stats/study-time', blob)
  },
}

export function mediaFileUrl(m: MediaFile): string {
  return `/media/${m.filename}`
}

export function audioClipUrl(name: string): string {
  return `/audio_clips/${name}`
}

export function recordingUrl(name: string): string {
  return `/recordings/${name}`
}
