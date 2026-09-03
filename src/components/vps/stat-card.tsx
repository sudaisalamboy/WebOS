'use client'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: string
  sub?: string
  icon: ReactNode
  accent: 'emerald' | 'sky' | 'violet' | 'amber' | 'rose'
  progress?: number // 0..100, optional
  spark?: number[] // optional sparkline data
  children?: ReactNode
}

const ACCENT_RING: Record<StatCardProps['accent'], string> = {
  emerald: 'bg-emerald-500/15 ring-emerald-500/30 text-emerald-500',
  sky: 'bg-sky-500/15 ring-sky-500/30 text-sky-500',
  violet: 'bg-violet-500/15 ring-violet-500/30 text-violet-500',
  amber: 'bg-amber-500/15 ring-amber-500/30 text-amber-500',
  rose: 'bg-rose-500/15 ring-rose-500/30 text-rose-500',
}

const ACCENT_BAR: Record<StatCardProps['accent'], string> = {
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
}

const ACCENT_STROKE: Record<StatCardProps['accent'], string> = {
  emerald: '#10b981',
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  amber: '#f59e0b',
  rose: '#f43f5e',
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) {
    return <div className="h-10" aria-hidden />
  }
  const w = 100
  const h = 36
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 4) - 2
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const areaPath = `M 0,${h} L ${points.replaceAll(' ', ' L ')} L ${w},${h} Z`
  const linePath = `M ${points.replaceAll(' ', ' L ')}`
  const gradId = `spark-${color.replace('#', '')}`
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-10 w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function StatCard({ label, value, sub, icon, accent, progress, spark, children }: StatCardProps) {
  return (
    <Card className="relative overflow-hidden p-4 sm:p-5 gap-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums truncate">{value}</p>
          {sub && <p className="mt-1 text-xs text-muted-foreground truncate">{sub}</p>}
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1', ACCENT_RING[accent])}>
          {icon}
        </div>
      </div>

      {spark && spark.length > 1 && (
        <div className="mt-3 -mx-1">
          <Sparkline data={spark} color={ACCENT_STROKE[accent]} />
        </div>
      )}

      {typeof progress === 'number' && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all duration-500', ACCENT_BAR[accent])}
            style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
          />
        </div>
      )}

      {children}
    </Card>
  )
}
