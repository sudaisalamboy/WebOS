'use client'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { useVpsStore } from '@/lib/vps-store'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const CORE_COLORS = [
  '#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b',
  '#f43f5e', '#14b8a6', '#a855f7', '#84cc16',
]

export function CpuChart() {
  const history = useVpsStore((s) => s.history)
  const stats = useVpsStore((s) => s.stats)
  const cores = stats?.cpu.cores ?? 0

  const data = history.map((p, i) => {
    const row: Record<string, number | string> = { idx: i, t: p.ts }
    p.cpuPerCore.forEach((u, ci) => {
      row[`core${ci}`] = Number(u.toFixed(1))
    })
    return row
  })

  return (
    <Card className="col-span-1 lg:col-span-2 gap-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
            <CardDescription className="text-xs">
              {stats ? `${stats.cpu.model} · ${cores} cores` : 'Loading...'}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">
              {stats ? `${stats.cpu.totalUsage.toFixed(1)}%` : '—'}
            </div>
            <div className="text-xs text-muted-foreground">{stats ? `${stats.cpu.temp.toFixed(0)}°C` : ''}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pl-0">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <defs>
                {Array.from({ length: cores }).map((_, i) => (
                  <linearGradient key={i} id={`cpu-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CORE_COLORS[i % CORE_COLORS.length]} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={CORE_COLORS[i % CORE_COLORS.length]} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" vertical={false} />
              <XAxis
                dataKey="idx"
                tick={false}
                tickLine={false}
                axisLine={false}
                domain={['dataMin', 'dataMax']}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: 'currentColor' }}
                tickLine={false}
                axisLine={false}
                width={32}
                unit="%"
                className="text-muted-foreground"
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelFormatter={() => ''}
                formatter={(value: number, name: string) => {
                  const idx = Number(name.replace('core', ''))
                  return [`${value}%`, `Core ${idx}`]
                }}
              />
              {Array.from({ length: cores }).map((_, i) => (
                <Area
                  key={i}
                  type="monotone"
                  dataKey={`core${i}`}
                  stroke={CORE_COLORS[i % CORE_COLORS.length]}
                  strokeWidth={1.5}
                  fill={`url(#cpu-grad-${i})`}
                  isAnimationActive={false}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pt-2">
          {Array.from({ length: cores }).map((_, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: CORE_COLORS[i % CORE_COLORS.length] }}
              />
              Core {i}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
