export interface MediaFile {
  id: number
  filename: string
  original_name: string
  duration_sec: number
  status: 'uploaded' | 'transcribing' | 'ready' | 'error'
  progress: number
  error_message: string
  category_id: number | null
  created_at: string
}

export interface Category {
  id: number
  name: string
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
  listMedia: (categoryId?: number) =>
    request<MediaFile[]>(`/api/media${categoryId ? `?category_id=${categoryId}` : ''}`),
  getMedia: (id: number) => request<MediaFile>(`/api/media/${id}`),
  deleteMedia: (id: number) => request(`/api/media/${id}`, { method: 'DELETE' }),
  setMediaCategory: (id: number, categoryId: number | null) =>
    request<MediaFile>(`/api/media/${id}/category`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId }),
    }),

  uploadMedia: (file: File, categoryId?: number | null) => {
    const form = new FormData()
    form.append('file', file)
    if (categoryId) form.append('category_id', String(categoryId))
    return request<MediaFile>('/api/media/upload', { method: 'POST', body: form })
  },

  listCategories: () => request<Category[]>('/api/categories'),
  createCategory: (name: string) =>
    request<Category>('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  renameCategory: (id: number, name: string) =>
    request<Category>(`/api/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  deleteCategory: (id: number) => request(`/api/categories/${id}`, { method: 'DELETE' }),

  getSentences: (mediaId: number) => request<Sentence[]>(`/api/media/${mediaId}/sentences`),
  updateSentenceText: (sentenceId: number, textPolished: string) =>
    request<Sentence>(`/api/sentences/${sentenceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text_polished: textPolished }),
    }),

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
