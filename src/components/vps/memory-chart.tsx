'use client'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { useVpsStore, formatGB } from '@/lib/vps-store'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export function MemoryChart() {
  const history = useVpsStore((s) => s.history)
  const stats = useVpsStore((s) => s.stats)
  const total = stats?.memory.total ?? 16

  const data = history.map((p, i) => ({
    idx: i,
    t: p.ts,
    used: Number(p.memUsed.toFixed(2)),
    cached: Number(p.memCached.toFixed(2)),
    avail: Number(p.memAvail.toFixed(2)),
  }))

  return (
    <Card className="col-span-1 lg:col-span-2 gap-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">Memory</CardTitle>
            <CardDescription className="text-xs">
              {stats ? `${formatGB(stats.memory.used)} / ${formatGB(total)} used` : 'Loading...'}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">
              {stats ? `${((stats.memory.used / total) * 100).toFixed(1)}%` : '—'}
            </div>
            <div className="text-xs text-muted-foreground">
              Swap {stats ? `${((stats.memory.swapUsed / Math.max(0.001, stats.memory.swapTotal)) * 100).toFixed(0)}%` : ''}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pl-0">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="mem-used" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="mem-cached" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="mem-avail" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" vertical={false} />
              <XAxis dataKey="idx" tick={false} tickLine={false} axisLine={false} />
              <YAxis
                domain={[0, total]}
                tick={{ fontSize: 11, fill: 'currentColor' }}
                tickLine={false}
                axisLine={false}
                width={36}
                className="text-muted-foreground"
                tickFormatter={(v) => `${v}G`}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelFormatter={() => ''}
                formatter={(value: number, name: string) => [`${value} GB`, name[0].toUpperCase() + name.slice(1)]}
              />
              <Area type="monotone" dataKey="used" stackId="1" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#mem-used)" isAnimationActive={false} dot={false} />
              <Area type="monotone" dataKey="cached" stackId="1" stroke="#0ea5e9" strokeWidth={1.5} fill="url(#mem-cached)" isAnimationActive={false} dot={false} />
              <Area type="monotone" dataKey="avail" stackId="1" stroke="#10b981" strokeWidth={1.5} fill="url(#mem-avail)" isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-violet-500" /> Used</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-sky-500" /> Cached</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Available</span>
        </div>
      </CardContent>
    </Card>
  )
}
