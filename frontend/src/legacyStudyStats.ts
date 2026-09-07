import type { StatsGranularity } from './api'

type DailyCounts = { learned: number; reviewed: number }
type StoredCounts = Record<string, DailyCounts>

const STORAGE_KEY = 'ministry-english:legacy-vocab-stats:v1'

function localDate(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function read(): StoredCounts {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed as StoredCounts : {}
  } catch {
    return {}
  }
}

/** 旧后端没有学习统计字段时，先在浏览器端保留本次学习的计数。 */
export function recordLegacyStudy(mode: 'new' | 'due'): void {
  try {
    const counts = read()
    const date = localDate()
    const current = counts[date] || { learned: 0, reviewed: 0 }
    if (mode === 'new') current.learned += 1
    else current.reviewed += 1
    counts[date] = current
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counts))
  } catch {
    // 隐私模式或受限存储不应阻断正常学习。
  }
}

function weekContains(period: string, date: string): boolean {
  const start = new Date(`${period}T00:00:00`)
  const target = new Date(`${date}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime())) return false
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return target >= start && target <= end
}

export function legacyStudyCounts(period: string, granularity: StatsGranularity): DailyCounts {
  return Object.entries(read()).reduce<DailyCounts>((total, [date, counts]) => {
    const matches = granularity === 'day'
      ? date === period
      : granularity === 'week'
        ? weekContains(period, date)
        : date.startsWith(`${period}-`)
    if (matches) {
      total.learned += Number.isFinite(counts.learned) ? counts.learned : 0
      total.reviewed += Number.isFinite(counts.reviewed) ? counts.reviewed : 0
    }
    return total
  }, { learned: 0, reviewed: 0 })
}
