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
  vocab_learned_count: number
  vocab_review_count: number
}

export type StatsGranularity = 'day' | 'week' | 'month'

export interface VocabWord {
  id: number
  word: string
  media_id: number | null
  sentence_id: number | null
  source_type: string
  source_media_name: string | null
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

export interface StudyCard {
  id: number
  word: string
  pos: string
  definition: string
  translation: string
  context_text: string
  context_audio_path: string
  us_audio_path: string
  uk_audio_path: string
  status: string
  pronunciation_weak: boolean
  weak_count: number
  memory_stage: number
  interval_days: number
  due_at: string | null
}

export interface StudySummary {
  new: number
  available_new: number
  due: number
  reviewing: number
  mastered: number
  total: number
  settings: StudySettings
  active_session_id: string | null
}

export interface StudySettings {
  new_group_size: number
  review_group_size: number
  daily_new_limit: number
  autoplay_audio: boolean
  preferred_audio: 'us' | 'uk' | 'context'
  show_context_during_recall: boolean
}

export interface StudySession {
  id: string
  mode: 'new' | 'due'
  current_card: StudyCard | null
  current_number: number
  total: number
  unique_total: number
  unique_done: number
  repeat_count: number
  completed: boolean
  ratings: Record<'known' | 'fuzzy' | 'unknown', number>
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
  studySummary: () => request<StudySummary>('/api/vocab/study/summary'),
  getStudySettings: () => request<StudySettings>('/api/vocab/study/settings'),
  updateStudySettings: (settings: Partial<StudySettings>) =>
    request<StudySettings>('/api/vocab/study/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),
  createStudySession: (mode: 'new' | 'due') =>
    request<StudySession>('/api/vocab/study/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }),
  legacyStudyQueue: (kind: 'new' | 'due', limit: number) =>
    request<StudyCard[]>(`/api/vocab/study/queue?kind=${kind}&limit=${limit}`),
  legacyReviewWord: (id: number, rating: 'again' | 'hard' | 'good') =>
    request(`/api/vocab/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    }),
  getStudySession: (id: string) => request<StudySession>(`/api/vocab/study/sessions/${id}`),
  getSessionWords: (id: string) =>
    request<
      {
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
      }[]
    >(`/api/vocab/study/sessions/${id}/words`),
  reviewSessionWord: (sessionId: string, vocabId: number, rating: 'known' | 'fuzzy' | 'unknown', responseMs?: number) =>
    request<StudySession>(`/api/vocab/study/sessions/${sessionId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vocab_id: vocabId, rating, response_ms: responseMs }),
    }),
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
