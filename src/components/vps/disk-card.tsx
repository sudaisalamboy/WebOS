'use client'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { useVpsStore, formatGB } from '@/lib/vps-store'
import { HardDrive, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'

export function DiskCard() {
  const stats = useVpsStore((s) => s.stats)
  if (!stats) {
    return (
      <Card className="col-span-1 gap-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Disks</CardTitle>
          <CardDescription className="text-xs">Loading...</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">No data yet.</CardContent>
      </Card>
    )
  }

  return (
    <Card className="col-span-1 gap-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">Disks</CardTitle>
            <CardDescription className="text-xs">{stats.disks.length} mounts</CardDescription>
          </div>
          <HardDrive className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">
        {stats.disks.map((d) => {
          const pct = (d.used / d.total) * 100
          const color = pct > 85 ? 'bg-rose-500' : pct > 65 ? 'bg-amber-500' : 'bg-emerald-500'
          return (
            <div key={d.mount}>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <code className="font-mono text-foreground">{d.mount}</code>
                  <span className="text-muted-foreground truncate">{d.fs}</span>
                </div>
                <span className="tabular-nums text-muted-foreground">
                  {formatGB(d.used)} / {formatGB(d.total)}
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>{pct.toFixed(1)}% used</span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="flex items-center gap-1">
                    <ArrowDownToLine className="h-3 w-3 text-emerald-500" />
                    {d.readRate.toFixed(1)} MB/s
                  </span>
                  <span className="flex items-center gap-1">
                    <ArrowUpFromLine className="h-3 w-3 text-sky-500" />
                    {d.writeRate.toFixed(1)} MB/s
                  </span>
                </span>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
