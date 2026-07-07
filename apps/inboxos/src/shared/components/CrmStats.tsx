import type { ReactNode } from 'react'

type StatTone = 'purple' | 'blue' | 'orange'
type TrendTone = 'positive' | 'negative' | 'neutral'

const iconTone: Record<StatTone, string> = {
  purple: 'crm-stat-icon-purple',
  blue: 'crm-stat-icon-blue',
  orange: 'crm-stat-icon-orange',
}

const trendTone: Record<TrendTone, string> = {
  positive: 'crm-stat-trend-positive',
  negative: 'crm-stat-trend-negative',
  neutral: 'text-[var(--crm-text-muted)]',
}

export function StatCard({
  title,
  value,
  trend,
  icon,
  tone = 'purple',
  trendTone: trendStyle = 'neutral',
}: {
  title: string
  value: string
  trend: string
  icon: ReactNode
  tone?: StatTone
  trendTone?: TrendTone
}) {
  return (
    <div className="crm-stat-card">
      <div className={`crm-stat-icon ${iconTone[tone]}`}>{icon as never}</div>
      <div className="min-w-0">
        <p className="crm-stat-title">{title}</p>
        <p className="crm-stat-value">{value}</p>
        <p className={`crm-stat-trend ${trendTone[trendStyle]}`}>{trend}</p>
      </div>
    </div>
  )
}

export function StatsRow({ children }: { children: ReactNode }) {
  return <div className="crm-stats-row">{children as never}</div>
}
