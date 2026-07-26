import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type DailyActivity, type StatsGranularity } from '../api'
import './StatsChart.css'

type SeriesKey = 'study_seconds' | 'dictation_count' | 'shadow_count' | 'new_word_count'

const SERIES: { key: SeriesKey; label: string; unit: string; color: string; toValue: (r: DailyActivity) => number }[] = [
  { key: 'study_seconds', label: '学习分钟', unit: '分钟', color: 'var(--series-1)', toValue: (r) => Math.round(r.study_seconds / 60) },
  { key: 'dictation_count', label: '听写句数', unit: '句', color: 'var(--series-2)', toValue: (r) => r.dictation_count },
  { key: 'shadow_count', label: '复读句数', unit: '句', color: 'var(--series-3)', toValue: (r) => r.shadow_count },
  { key: 'new_word_count', label: '新增生词', unit: '个', color: 'var(--series-4)', toValue: (r) => r.new_word_count },
]
const ALL_KEYS = SERIES.map((s) => s.key)

const GRANULARITY_TABS: { value: StatsGranularity; label: string }[] = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
]

const W = 720
const H = 260
const PAD = { top: 16, right: 16, bottom: 28, left: 34 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
const DBLCLICK_WINDOW_MS = 220

function xFor(i: number, n: number): number {
  if (n <= 1) return PAD.left + PLOT_W / 2
  return PAD.left + (PLOT_W * i) / (n - 1)
}

function yFor(fraction: number): number {
  const clamped = Math.max(0, Math.min(1, fraction))
  return PAD.top + PLOT_H * (1 - clamped)
}

export default function StatsChart() {
  const [granularity, setGranularity] = useState<StatsGranularity>('day')
  const [rows, setRows] = useState<DailyActivity[]>([])
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart')
  const [visible, setVisible] = useState<Set<SeriesKey>>(new Set(ALL_KEYS))
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const clickTimers = useRef<Partial<Record<SeriesKey, ReturnType<typeof setTimeout>>>>({})
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    api.getStats(granularity).then(setRows)
  }, [granularity])

  // API 返回新→旧；图表按时间正序读（左边过去，右边现在）
  const chrono = useMemo(() => [...rows].reverse(), [rows])
  const n = chrono.length
  const isolated = visible.size === 1 ? [...visible][0] : null
  const allZero = chrono.every((r) => SERIES.every((s) => s.toValue(r) === 0))

  const seriesData = useMemo(
    () =>
      SERIES.map((s) => {
        const values = chrono.map((r) => s.toValue(r))
        const max = Math.max(...values, 0)
        return { ...s, values, max, indexed: values.map((v) => (max > 0 ? (v / max) * 100 : 0)) }
      }),
    [chrono],
  )

  const isolatedSeries = isolated ? seriesData.find((s) => s.key === isolated)! : null

  const toggleSeries = (key: SeriesKey) => {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next.size === 0 ? new Set(ALL_KEYS) : next
    })
  }

  const isolateOrRestore = (key: SeriesKey) => {
    setVisible((prev) => (prev.size === 1 && prev.has(key) ? new Set(ALL_KEYS) : new Set([key])))
  }

  const onLegendClick = (key: SeriesKey) => {
    if (clickTimers.current[key]) return
    clickTimers.current[key] = setTimeout(() => {
      toggleSeries(key)
      delete clickTimers.current[key]
    }, DBLCLICK_WINDOW_MS)
  }

  const onLegendDoubleClick = (key: SeriesKey) => {
    const timer = clickTimers.current[key]
    if (timer) {
      clearTimeout(timer)
      delete clickTimers.current[key]
    }
    isolateOrRestore(key)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || n === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * W
    let nearest = 0
    let best = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xFor(i, n) - relX)
      if (d < best) {
        best = d
        nearest = i
      }
    }
    setHoverIndex(nearest)
  }

  return (
    <section className="stats-section">
      <div className="stats-header">
        <h2>学习统计</h2>
        <div className="stats-controls">
          <div className="granularity-tabs">
            {GRANULARITY_TABS.map((t) => (
              <button
                key={t.value}
                className={granularity === t.value ? 'active' : ''}
                onClick={() => setGranularity(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="granularity-tabs">
            <button className={viewMode === 'chart' ? 'active' : ''} onClick={() => setViewMode('chart')}>
              图表
            </button>
            <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>
              表格
            </button>
          </div>
        </div>
      </div>

      {allZero ? (
        <p className="stats-empty">还没有学习记录，跟读、听写或标记生词之后这里会有数据。</p>
      ) : viewMode === 'table' ? (
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>学习分钟</th>
                <th>听写句数</th>
                <th>复读句数</th>
                <th>新增生词</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period}>
                  <td>{r.label}</td>
                  <td>{Math.round(r.study_seconds / 60)}</td>
                  <td>{r.dictation_count}</td>
                  <td>{r.shadow_count}</td>
                  <td>{r.new_word_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="stat-tiles">
            {seriesData.map((s) => (
              <div key={s.key} className="stat-tile">
                <span className="stat-tile-dot" style={{ background: s.color }} />
                <span className="stat-tile-label">{s.label}总计</span>
                <span className="stat-tile-value">
                  {s.values.reduce((a, b) => a + b, 0)}
                  <span className="stat-tile-unit">{s.unit}</span>
                </span>
              </div>
            ))}
          </div>

          <p className="chart-caption">
            {isolatedSeries
              ? `${isolatedSeries.label}（${isolatedSeries.unit}），再次双击图例恢复全部`
              : '相对走势：每条线按自己的区间峰值换算成百分比，悬停查看当期真实数值'}
          </p>

          <div className="legend-row">
            {SERIES.map((s) => (
              <button
                key={s.key}
                className={`legend-item ${visible.has(s.key) ? '' : 'off'}`}
                onClick={() => onLegendClick(s.key)}
                onDoubleClick={() => onLegendDoubleClick(s.key)}
              >
                <span className="legend-swatch" style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>

          <div className="chart-wrap">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="chart-svg"
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHoverIndex(null)}
            >
              {[0, 0.5, 1].map((f) => (
                <line key={f} x1={PAD.left} x2={W - PAD.right} y1={yFor(f)} y2={yFor(f)} className="gridline" />
              ))}

              <text x={PAD.left - 6} y={yFor(1) + 3} className="axis-label" textAnchor="end">
                {isolatedSeries ? isolatedSeries.max : 100}
              </text>
              <text x={PAD.left - 6} y={yFor(0) + 3} className="axis-label" textAnchor="end">
                0
              </text>

              {chrono.map((r, i) => {
                if (n > 10 && i % 2 === 1 && i !== n - 1) return null
                return (
                  <text key={r.period} x={xFor(i, n)} y={H - 8} className="axis-label" textAnchor="middle">
                    {r.label}
                  </text>
                )
              })}

              {hoverIndex !== null && (
                <line
                  x1={xFor(hoverIndex, n)}
                  x2={xFor(hoverIndex, n)}
                  y1={PAD.top}
                  y2={H - PAD.bottom}
                  className="crosshair"
                />
              )}

              {seriesData
                .filter((s) => visible.has(s.key))
                .map((s) => {
                  const useReal = isolatedSeries?.key === s.key
                  const scaleMax = useReal ? s.max || 1 : 100
                  const values = useReal ? s.values : s.indexed
                  const points = values.map((v, i) => [xFor(i, n), yFor(v / scaleMax)] as const)
                  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ')
                  return (
                    <g key={s.key}>
                      <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      {points.map(([x, y], i) => (
                        <circle key={i} cx={x} cy={y} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                      ))}
                    </g>
                  )
                })}
            </svg>

            {hoverIndex !== null && chrono[hoverIndex] && (
              <div
                className="chart-tooltip"
                style={{ left: `${Math.min(92, Math.max(8, (xFor(hoverIndex, n) / W) * 100))}%` }}
              >
                <div className="chart-tooltip-period">{chrono[hoverIndex].label}</div>
                {seriesData
                  .filter((s) => visible.has(s.key))
                  .map((s) => (
                    <div key={s.key} className="chart-tooltip-row">
                      <span className="chart-tooltip-key" style={{ background: s.color }} />
                      <span className="chart-tooltip-label">{s.label}</span>
                      <span className="chart-tooltip-value">
                        {s.values[hoverIndex]}
                        {s.unit}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
