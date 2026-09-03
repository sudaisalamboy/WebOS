'use client'

import { create } from 'zustand'
import { io, Socket } from 'socket.io-client'

// NOTE: connect via the gateway using XTransformPort. NEVER use localhost:3003 directly.
const VPS_PORT = 3003

export interface CpuCore {
  name: string
  usage: number
}
export interface ProcessRow {
  pid: number
  name: string
  user: string
  cpu: number
  mem: number
  command: string
}
export interface DiskInfo {
  mount: string
  fs: string
  total: number
  used: number
  readRate: number
  writeRate: number
}
export interface NetInterface {
  name: string
  rxRate: number
  txRate: number
  rxTotal: number
  txTotal: number
}
export interface VpsStats {
  ts: number
  hostname: string
  os: string
  kernel: string
  arch: string
  uptime: number
  loadAvg: [number, number, number]
  cpu: {
    model: string
    cores: number
    totalUsage: number
    perCore: CpuCore[]
    temp: number
  }
  memory: {
    total: number
    used: number
    cached: number
    available: number
    swapTotal: number
    swapUsed: number
  }
  disks: DiskInfo[]
  network: NetInterface[]
  processes: ProcessRow[]
}

interface HistoryPoint {
  ts: number
  cpu: number
  cpuPerCore: number[]
  memUsed: number
  memCached: number
  memAvail: number
  swapUsed: number
  netRx: number
  netTx: number
}

interface VpsState {
  connected: boolean
  lastError: string | null
  stats: VpsStats | null
  history: HistoryPoint[] // capped at 60 (≈2 min at 2s interval)
  connect: () => () => void
}

const HISTORY_MAX = 60

let socket: Socket | null = null
let connectCount = 0

export const useVpsStore = create<VpsState>((set, get) => ({
  connected: false,
  lastError: null,
  stats: null,
  history: [],
  connect: () => {
    connectCount++
    if (connectCount === 1 && !socket) {
      socket = io(`/?XTransformPort=${VPS_PORT}`, {
        path: '/',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      })

      socket.on('connect', () => {
        set({ connected: true, lastError: null })
      })

      socket.on('disconnect', () => {
        set({ connected: false })
      })

      socket.on('connect_error', (err: Error) => {
        set({ connected: false, lastError: err.message })
      })

      socket.on('vps:stats', (stats: VpsStats) => {
        const prev = get().history
        const perCore = stats.cpu.perCore.map((c) => c.usage)
        const netRx = stats.network.reduce((s, n) => s + n.rxRate, 0)
        const netTx = stats.network.reduce((s, n) => s + n.txRate, 0)
        const point: HistoryPoint = {
          ts: stats.ts,
          cpu: stats.cpu.totalUsage,
          cpuPerCore: perCore,
          memUsed: stats.memory.used,
          memCached: stats.memory.cached,
          memAvail: stats.memory.available,
          swapUsed: stats.memory.swapUsed,
          netRx,
          netTx,
        }
        const next = [...prev, point]
        if (next.length > HISTORY_MAX) next.shift()
        set({ stats, history: next })
      })
    }

    return () => {
      connectCount = Math.max(0, connectCount - 1)
      if (connectCount === 0 && socket) {
        socket.disconnect()
        socket = null
      }
    }
  },
}))

// --- formatting helpers -----------------------------------------------------
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatRate(mbps: number): string {
  if (mbps >= 1024) return `${(mbps / 1024).toFixed(2)} GB/s`
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`
  return `${(mbps * 1024).toFixed(0)} KB/s`
}

export function formatGB(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`
  return `${gb.toFixed(1)} GB`
}
