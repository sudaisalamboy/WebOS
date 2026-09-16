'use client'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { useVpsStore, formatUptime, formatGB } from '@/lib/vps-store'
import { Cpu, MemoryStick, Network, Clock, Globe, HardDrive, Activity } from 'lucide-react'

function Row({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-muted-foreground/70">{icon}</span>
        {label}
      </div>
      <span className="text-xs font-medium text-right truncate max-w-[60%]">{value}</span>
    </div>
  )
}

export function SystemInfo() {
  const stats = useVpsStore((s) => s.stats)

  return (
    <Card className="col-span-1 gap-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">System Info</CardTitle>
        <CardDescription className="text-xs">Host metadata</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border/50">
        <Row label="Hostname" value={stats?.hostname ?? '—'} icon={<Globe className="h-3.5 w-3.5" />} />
        <Row label="OS" value={stats?.os ?? '—'} icon={<HardDrive className="h-3.5 w-3.5" />} />
        <Row label="Kernel" value={stats?.kernel ?? '—'} icon={<Cpu className="h-3.5 w-3.5" />} />
        <Row label="Architecture" value={stats?.arch ?? '—'} icon={<Cpu className="h-3.5 w-3.5" />} />
        <Row label="Uptime" value={stats ? formatUptime(stats.uptime) : '—'} icon={<Clock className="h-3.5 w-3.5" />} />
        <Row
          label="Load Avg"
          value={stats ? stats.loadAvg.map((l) => l.toFixed(2)).join(' · ') : '—'}
          icon={<Activity className="h-3.5 w-3.5" />}
        />
        <Row label="CPU" value={stats ? `${stats.cpu.cores} cores` : '—'} icon={<Cpu className="h-3.5 w-3.5" />} />
        <Row
          label="Memory"
          value={stats ? `${formatGB(stats.memory.used)} / ${formatGB(stats.memory.total)}` : '—'}
          icon={<MemoryStick className="h-3.5 w-3.5" />}
        />
        <Row
          label="Swap"
          value={stats ? `${formatGB(stats.memory.swapUsed)} / ${formatGB(stats.memory.swapTotal)}` : '—'}
          icon={<MemoryStick className="h-3.5 w-3.5" />}
        />
        <Row
          label="Interfaces"
          value={stats ? stats.network.map((n) => n.name).join(', ') : '—'}
          icon={<Network className="h-3.5 w-3.5" />}
        />
      </CardContent>
    </Card>
  )
}
