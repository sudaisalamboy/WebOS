'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Monitor, Wifi, Radio, Server, Play, Square, RotateCw,
  Activity, Terminal, ChevronDown, ChevronRight, AlertCircle,
  CheckCircle2, Loader2, Cpu, Globe
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ServiceStatus {
  xvfb: boolean
  chrome: boolean
  x11vnc: boolean
  websockify: boolean
}

interface LogEntry {
  ts: number
  level: 'info' | 'success' | 'error' | 'warn'
  msg: string
}

interface ServiceInfo {
  id: string
  name: string
  desc: string
  port: string
  icon: React.ReactNode
  color: string
}

const SERVICES: ServiceInfo[] = [
  { id: 'xvfb', name: 'Xvfb', desc: 'Virtual display :99 (1280×800)', port: 'display', icon: <Monitor className="h-4 w-4" />, color: 'text-sky-400' },
  { id: 'chrome', name: 'Chrome', desc: 'Playwright Chromium (CDP :9222)', port: '9222', icon: <Globe className="h-4 w-4" />, color: 'text-emerald-400' },
  { id: 'x11vnc', name: 'x11vnc', desc: 'VNC server (RFB :5900)', port: '5900', icon: <Radio className="h-4 w-4" />, color: 'text-violet-400' },
  { id: 'websockify', name: 'websockify', desc: 'WebSocket bridge (HTTP :6080)', port: '6080', icon: <Wifi className="h-4 w-4" />, color: 'text-amber-400' },
]

export function ChromeDebuggerApp() {
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [serviceLogs, setServiceLogs] = useState<Record<string, string>>({})
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [chromeTabs, setChromeTabs] = useState<any[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((level: LogEntry['level'], msg: string) => {
    setLogs(prev => [...prev.slice(-200), { ts: Date.now(), level, msg }])
  }, [])

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/vnc/service', { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        setStatus(d.services)
      }
    } catch {}
    setLoading(false)
  }, [])

  // Poll status every 5 seconds
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [refresh])

  // Fetch Chrome CDP tabs
  useEffect(() => {
    const fetchTabs = async () => {
      try {
        const r = await fetch('/api/vnc/current-url', { cache: 'no-store' })
        if (r.ok) {
          const d = await r.json()
          // Also try the CDP /json/list endpoint
          try {
            const tabsResp = await fetch('http://127.0.0.1:9222/json', { cache: 'no-store' })
            if (tabsResp.ok) {
              const tabs = await tabsResp.json()
              setChromeTabs(tabs.filter((t: any) => t.type === 'page'))
            }
          } catch {}
        }
      } catch {}
    }
    fetchTabs()
    const id = setInterval(fetchTabs, 10000)
    return () => clearInterval(id)
  }, [status?.chrome])

  // Auto-scroll logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollTop = logEndRef.current.scrollHeight
    }
  }, [logs])

  async function doAction(action: 'start' | 'stop' | 'restart', service: string) {
    const key = `${action}:${service}`
    setActionLoading(key)
    addLog('info', `${action} → ${service}…`)
    try {
      const r = await fetch('/api/vnc/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, service }),
      })
      const d = await r.json()
      if (d.ok) {
        addLog('success', `${service}: ${action} ✓ (status: ${JSON.stringify(d.status)})`)
      } else {
        addLog('error', `${service}: ${action} ✗ — ${d.result?.error || d.error || 'failed'}`)
      }
      if (d.status) setStatus(d.status)

      // Fetch log tail for this service
      try {
        const logR = await fetch(`/api/vnc/service?name=${service}&lines=15`, { cache: 'no-store' })
        if (logR.ok) {
          const logD = await logR.json()
          setServiceLogs(prev => ({ ...prev, [service]: logD.log || '' }))
        }
      } catch {}
    } catch (err) {
      addLog('error', `${service}: ${action} exception — ${(err as Error).message}`)
    } finally {
      setActionLoading(null)
    }
  }

  async function fetchLog(service: string) {
    try {
      const r = await fetch(`/api/vnc/service?name=${service}&lines=30`, { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        setServiceLogs(prev => ({ ...prev, [service]: d.log || '(empty log)' }))
        setExpandedLog(expandedLog === service ? null : service)
      }
    } catch {}
  }

  const allRunning = status?.xvfb && status?.chrome && status?.x11vnc && status?.websockify
  const runningCount = status ? [status.xvfb, status.chrome, status.x11vnc, status.websockify].filter(Boolean).length : 0

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-amber-900/20 to-emerald-900/20 shrink-0">
        <Cpu className="h-5 w-5 text-amber-400" />
        <h1 className="text-base font-bold">Chrome Debugger</h1>
        <span className="text-[10px] text-zinc-500 ml-1">Remote Chrome Service Monitor</span>
        <div className={cn(
          'ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold',
          allRunning ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-zinc-800 text-zinc-500'
        )}>
          <span className={cn(
            'h-1.5 w-1.5 rounded-full',
            allRunning ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'
          )} />
          {loading ? 'LOADING…' : allRunning ? 'ALL ONLINE' : `${runningCount}/4 ONLINE`}
        </div>
        {/* Quick actions */}
        <button
          onClick={() => doAction('start', 'all')}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white px-3 py-1.5 text-[10px] font-bold transition"
        >
          {actionLoading === 'start:all' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Start All
        </button>
        <button
          onClick={() => doAction('restart', 'all')}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 rounded-md bg-amber-500/80 hover:bg-amber-500 disabled:opacity-40 text-white px-3 py-1.5 text-[10px] font-bold transition"
        >
          {actionLoading === 'restart:all' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
          Restart All
        </button>
        <button
          onClick={() => doAction('stop', 'all')}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 rounded-md bg-rose-500/80 hover:bg-rose-500 disabled:opacity-40 text-white px-3 py-1.5 text-[10px] font-bold transition"
        >
          {actionLoading === 'stop:all' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
          Stop All
        </button>
      </div>

      {/* Service cards */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 shrink-0">
        {SERVICES.map(svc => {
          const isRunning = (status as any)?.[svc.id] ?? false
          const isActing = actionLoading && (actionLoading.includes(svc.id) || actionLoading.includes('all'))
          return (
            <div
              key={svc.id}
              className={cn(
                'rounded-lg border p-4 transition',
                isRunning
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-zinc-800 bg-zinc-900/50'
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg shrink-0',
                  isRunning ? 'bg-emerald-500/15' : 'bg-zinc-800'
                )}>
                  {svc.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{svc.name}</span>
                    <span className={cn(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded',
                      isRunning ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                    )}>
                      :{svc.port}
                    </span>
                    {isRunning ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 ml-auto" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-zinc-600 ml-auto" />
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{svc.desc}</div>
                  <div className="text-[10px] mt-0.5">
                    <span className={isRunning ? 'text-emerald-400 font-bold' : 'text-zinc-600'}>
                      {isRunning ? '● RUNNING' : '○ STOPPED'}
                    </span>
                  </div>
                </div>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-1.5 mt-3">
                <button
                  onClick={() => doAction('start', svc.id)}
                  disabled={isActing !== null || isRunning}
                  className="flex items-center gap-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-30 text-emerald-400 px-2.5 py-1 text-[9px] font-bold transition"
                >
                  {actionLoading === `start:${svc.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Start
                </button>
                <button
                  onClick={() => doAction('stop', svc.id)}
                  disabled={isActing !== null || !isRunning}
                  className="flex items-center gap-1 rounded bg-rose-500/20 hover:bg-rose-500/30 disabled:opacity-30 text-rose-400 px-2.5 py-1 text-[9px] font-bold transition"
                >
                  {actionLoading === `stop:${svc.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                  Stop
                </button>
                <button
                  onClick={() => doAction('restart', svc.id)}
                  disabled={isActing !== null}
                  className="flex items-center gap-1 rounded bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-30 text-amber-400 px-2.5 py-1 text-[9px] font-bold transition"
                >
                  {actionLoading === `restart:${svc.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                  Restart
                </button>
                <button
                  onClick={() => fetchLog(svc.id)}
                  className="flex items-center gap-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 px-2.5 py-1 text-[9px] font-bold transition ml-auto"
                >
                  <Terminal className="h-3 w-3" />
                  Log
                  {expandedLog === svc.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
              </div>
              {/* Log preview */}
              {expandedLog === svc.id && serviceLogs[svc.id] !== undefined && (
                <div className="mt-2 rounded bg-zinc-950 border border-zinc-800 p-2 max-h-32 overflow-y-auto">
                  <pre className="text-[9px] text-zinc-400 whitespace-pre-wrap font-mono">{serviceLogs[svc.id] || '(empty log)'}</pre>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Chrome CDP tabs */}
      {chromeTabs.length > 0 && (
        <div className="px-4 pb-2 shrink-0">
          <div className="text-[10px] font-bold uppercase text-zinc-500 mb-1.5 flex items-center gap-1">
            <Globe className="h-3 w-3" /> Chrome Tabs (CDP :9222)
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {chromeTabs.map((tab, i) => (
              <div key={i} className="flex-none rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 max-w-56">
                <div className="text-[10px] font-bold text-zinc-300 truncate">{tab.title || '(no title)'}</div>
                <div className="text-[9px] text-zinc-600 truncate">{tab.url}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity log */}
      <div className="flex-1 flex flex-col min-h-0 px-4 pb-4">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] font-bold uppercase text-zinc-500 flex items-center gap-1">
            <Activity className="h-3 w-3" /> Activity Log
          </div>
          <button
            onClick={() => setLogs([])}
            className="text-[9px] text-zinc-600 hover:text-zinc-400"
          >
            clear
          </button>
        </div>
        <div
          ref={logEndRef}
          className="flex-1 overflow-y-auto rounded-md bg-zinc-950 border border-zinc-800 p-2 space-y-0.5 min-h-0"
        >
          {logs.length === 0 ? (
            <div className="text-[10px] text-zinc-600 italic text-center py-4">
              No activity yet. Use the buttons above to start/stop/restart services.
            </div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="flex gap-2 text-[10px] font-mono">
                <span className="text-zinc-600 shrink-0">
                  {new Date(log.ts).toLocaleTimeString()}
                </span>
                <span className={cn(
                  'shrink-0',
                  log.level === 'success' ? 'text-emerald-400' :
                  log.level === 'error' ? 'text-rose-400' :
                  log.level === 'warn' ? 'text-amber-400' :
                  'text-sky-400'
                )}>
                  {log.level === 'success' ? '✓' : log.level === 'error' ? '✗' : log.level === 'warn' ? '⚠' : '→'}
                </span>
                <span className={cn(
                  'break-all',
                  log.level === 'success' ? 'text-emerald-300' :
                  log.level === 'error' ? 'text-rose-300' :
                  log.level === 'warn' ? 'text-amber-300' :
                  'text-zinc-300'
                )}>
                  {log.msg}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
