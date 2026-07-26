export interface PersistedPracticeState {
  selectedId: number | null
  speed: number
  loopTarget: number
  hiddenIds: number[]
  dictationText: Record<number, string>
  dictationLogged: number[]
  playbackTime: number
}

const KEY_PREFIX = 'practice-state-'

// sessionStorage, not localStorage: state should survive navigating away and
// back within the same tab, but not pile up forever once the tab closes.

export function loadPracticeState(mediaId: number): PersistedPracticeState | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + mediaId)
    return raw ? (JSON.parse(raw) as PersistedPracticeState) : null
  } catch {
    return null
  }
}

export function savePracticeState(mediaId: number, state: PersistedPracticeState): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + mediaId, JSON.stringify(state))
  } catch {
    // sessionStorage full or unavailable (e.g. private browsing) — not critical, skip
  }
}
