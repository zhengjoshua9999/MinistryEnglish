import type { PracticeAttempt, WordScore } from '../api'
import './ScorePanel.css'

function tier(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 80) return 'good'
  if (score >= 60) return 'warn'
  return 'bad'
}

export default function ScorePanel({ attempt }: { attempt: PracticeAttempt }) {
  const words: WordScore[] = JSON.parse(attempt.word_scores_json || '[]')

  return (
    <div className="score-panel">
      <div className="score-metrics">
        <Metric label="综合" value={attempt.pron_score} />
        <Metric label="准确度" value={attempt.accuracy} />
        <Metric label="流利度" value={attempt.fluency} />
        <Metric label="完整度" value={attempt.completeness} />
      </div>
      {words.length > 0 && (
        <p className="score-words">
          {words.map((w, i) => (
            <span key={i} className={`score-word tier-${tier(w.accuracy)}`}>
              {w.word}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={`metric tier-${tier(value)}`}>
      <span className="metric-value">{Math.round(value)}</span>
      <span className="metric-label">{label}</span>
    </div>
  )
}
