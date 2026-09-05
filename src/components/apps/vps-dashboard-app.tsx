'use client'

import { useEffect, useRef } from 'react'
import { useVpsStore, formatRate, formatGB } from '@/lib/vps-store'
import { StatCard } from '@/components/vps/stat-card'
import { CpuChart } from '@/components/vps/cpu-chart'
import { MemoryChart } from '@/components/vps/memory-chart'
import { NetworkChart } from '@/components/vps/network-chart'
import { DiskCard } from '@/components/vps/disk-card'
import { SystemInfo } from '@/components/vps/system-info'
import { ProcessesTable } from '@/components/vps/processes-table'
import { Cpu, MemoryStick, HardDrive, Network } from 'lucide-react'

/**
 * The VPS Dashboard rendered as an embeddable app (no own page-level chrome).
 * The OS window provides the title bar.
 */
export function VpsDashboardApp() {
  const connect = useVpsStore((s) => s.connect)
  const stats = useVpsStore((s) => s.stats)
  const history = useVpsStore((s) => s.history)
  const disconnectRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    disconnectRef.current = connect()
    return () => {
      disconnectRef.current?.()
    }
  }, [connect])

  const cpuSpark = history.map((p) => p.cpu).slice(-30)
  const memSpark = history.map((p) => (p.memUsed / (stats?.memory.total ?? 16)) * 100).slice(-30)
  const diskPct = stats
    ? (stats.disks.reduce((s, d) => s + d.used, 0) / stats.disks.reduce((s, d) => s + d.total, 0)) * 100
    : 0
  const netSpark = history.map((p) => p.netRx + p.netTx).slice(-30)

  const cpuPct = stats?.cpu.totalUsage ?? 0
  const memPct = stats ? (stats.memory.used / stats.memory.total) * 100 : 0
  const netRate = stats ? stats.network.reduce((s, n) => s + n.rxRate + n.txRate, 0) : 0

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-3">
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <StatCard
            label="CPU"
            value={stats ? `${cpuPct.toFixed(1)}%` : '—'}
            sub={stats ? `${stats.cpu.cores} cores · ${stats.cpu.temp.toFixed(0)}°C` : 'Loading…'}
            icon={<Cpu className="h-5 w-5" />}
            accent={cpuPct > 80 ? 'rose' : cpuPct > 60 ? 'amber' : 'emerald'}
            spark={cpuSpark}
          />
          <StatCard
            label="Memory"
            value={stats ? `${memPct.toFixed(1)}%` : '—'}
            sub={stats ? `${formatGB(stats.memory.used)} / ${formatGB(stats.memory.total)}` : 'Loading…'}
            icon={<MemoryStick className="h-5 w-5" />}
            accent={memPct > 80 ? 'rose' : memPct > 60 ? 'amber' : 'violet'}
            spark={memSpark}
          />
          <StatCard
            label="Disk"
            value={stats ? `${diskPct.toFixed(1)}%` : '—'}
            sub={stats ? `${formatGB(stats.disks.reduce((s, d) => s + d.used, 0))} used` : 'Loading…'}
            icon={<HardDrive className="h-5 w-5" />}
            accent={diskPct > 85 ? 'rose' : diskPct > 65 ? 'amber' : 'sky'}
            progress={diskPct}
          />
          <StatCard
            label="Network"
            value={stats ? formatRate(netRate) : '—'}
            sub={stats ? `${stats.network.length} ifaces` : 'Loading…'}
            icon={<Network className="h-5 w-5" />}
            accent="emerald"
            spark={netSpark}
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
          <CpuChart />
          <MemoryChart />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
          <NetworkChart />
          <DiskCard />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-3">
          <SystemInfo />
          <ProcessesTable />
        </section>
      </div>
    </div>
  )
}
