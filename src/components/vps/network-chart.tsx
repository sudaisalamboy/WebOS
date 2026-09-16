'use client'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { useVpsStore, formatRate, formatGB } from '@/lib/vps-store'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export function NetworkChart() {
  const history = useVpsStore((s) => s.history)
  const stats = useVpsStore((s) => s.stats)

  const data = history.map((p, i) => ({
    idx: i,
    t: p.ts,
    rx: Number(p.netRx.toFixed(2)),
    tx: Number(p.netTx.toFixed(2)),
  }))

  const totalRx = stats?.network.reduce((s, n) => s + n.rxTotal, 0) ?? 0
  const totalTx = stats?.network.reduce((s, n) => s + n.txTotal, 0) ?? 0

  return (
    <Card className="col-span-1 lg:col-span-2 gap-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">Network I/O</CardTitle>
            <CardDescription className="text-xs">
              {stats ? `${stats.network.length} interfaces` : 'Loading...'}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums text-emerald-500">
              ↓ {stats ? formatRate(stats.network.reduce((s, n) => s + n.rxRate, 0)) : '—'}
            </div>
            <div className="text-sm font-semibold tabular-nums text-sky-500">
              ↑ {stats ? formatRate(stats.network.reduce((s, n) => s + n.txRate, 0)) : '—'}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pl-0">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="net-rx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="net-tx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" vertical={false} />
              <XAxis dataKey="idx" tick={false} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: 'currentColor' }}
                tickLine={false}
                axisLine={false}
                width={42}
                className="text-muted-foreground"
                tickFormatter={(v) => `${v}M`}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelFormatter={() => ''}
                formatter={(value: number, name: string) => [formatRate(value), name === 'rx' ? '↓ RX' : '↑ TX']}
              />
              <Area type="monotone" dataKey="rx" stroke="#10b981" strokeWidth={1.8} fill="url(#net-rx)" isAnimationActive={false} dot={false} />
              <Area type="monotone" dataKey="tx" stroke="#0ea5e9" strokeWidth={1.8} fill="url(#net-tx)" isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> ↓ RX ({formatGB(totalRx)} total)</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-sky-500" /> ↑ TX ({formatGB(totalTx)} total)</span>
        </div>
      </CardContent>
    </Card>
  )
}
