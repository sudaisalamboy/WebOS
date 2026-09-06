'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Monitor, Wifi, Radio, Server, Play, Square, RotateCw,
  Activity, Terminal, ChevronDown, ChevronRight, AlertCircle,
  CheckCircle2, Loader2, Cpu, Globe, Copy, ClipboardCheck
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
  service?: string
}

interface ServiceInfo {
  id: string
  name: string
  desc: string
  port: string
  icon: React.ReactNode
  color: string
  dependsOn?: string  // service that must run before this one
}

const SERVICES: ServiceInfo[] = [
  { id: 'xvfb', name: 'Xvfb', desc: 'Virtual display :99 (1280×800)', port: 'display', icon: <Monitor className="h-4 w-4" />, color: 'text-sky-400' },
  { id: 'chrome', name: 'Chrome', desc: 'Playwright Chromium (CDP :9222)', port: '9222', icon: <Globe className="h-4 w-4" />, color: 'text-emerald-400', dependsOn: 'xvfb' },
  { id: 'x11vnc', name: 'x11vnc', desc: 'VNC server (RFB :5900)', port: '5900', icon: <Radio className="h-4 w-4" />, color: 'text-violet-400', dependsOn: 'xvfb' },
  { id: 'websockify', name: 'websockify', desc: 'WebSocket bridge (HTTP :6080)', port: '6080', icon: <Wifi className="h-4 w-4" />, color: 'text-amber-400', dependsOn: 'x11vnc' },
]

// Last known status before an action — used to detect when a service that
// was running stops, or vice versa.
const previousStatusRef: ServiceStatus = { xvfb: false, chrome: false, x11vnc: false, websockify: false }

export function ChromeDebuggerApp() {
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [serviceLogs, setServiceLogs] = useState<Record<string, string>>({})
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [copiedLog, setCopiedLog] = useState<string | null>(null)
  const [chromeTabs, setChromeTabs] = useState<any[]>([])
  const [lastActionResult, setLastActionResult] = useState<Record<string, { ok: boolean; error?: string }>>({})
  const logEndRef = useRef<HTMLDivElement>(null)
  const autoExpandRef = useRef<string | null>(null)

  const addLog = useCallback((level: LogEntry['level'], msg: string, service?: string) => {
    setLogs(prev => [...prev.slice(-300), { ts: Date.now(), level, msg, service }])
  }, [])

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/vnc/service', { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        const newStatus = d.services as ServiceStatus
        // Detect transitions (running → stopped, stopped → running)
        const prev = previousStatusRef
        const newS = newStatus
        for (const id of ['xvfb', 'chrome', 'x11vnc', 'websockify'] as const) {
          if (prev[id] && !newS[id]) {
            // Stopped unexpectedly (during action loading this is expected)
            if (!actionLoading) {
              addLog('warn', `${id} transitioned from RUNNING → STOPPED`, id)
            }
          } else if (!prev[id] && newS[id] && !actionLoading) {
            // Just came up on its own (after action)
            addLog('success', `${id} is now RUNNING`, id)
          }
        }
        Object.assign(previousStatusRef, newS)
        setStatus(newS)
      }
    } catch {}
    setLoading(false)
  }, [actionLoading, addLog])

  // Poll status every 3 seconds
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [refresh])

  // Fetch Chrome CDP tabs
  useEffect(() => {
    const fetchTabs = async () => {
      try {
        const tabsResp = await fetch('http://127.0.0.1:9222/json', { cache: 'no-store' })
        if (tabsResp.ok) {
          const tabs = await tabsResp.json()
          setChromeTabs(tabs.filter((t: any) => t.type === 'page'))
        } else {
          setChromeTabs([])
        }
      } catch {
        setChromeTabs([])
      }
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

  // Auto-expand the log panel of the service we just acted on
  useEffect(() => {
    if (autoExpandRef.current && status) {
      const svc = autoExpandRef.current
      autoExpandRef.current = null
      // Wait a moment, then fetch + expand the log
      setTimeout(() => fetchLog(svc, true), 500)
    }
  }, [actionLoading, status])

  async function fetchLog(service: string, autoExpand = false) {
    try {
      const r = await fetch(`/api/vnc/service?name=${service}&lines=30`, { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        setServiceLogs(prev => ({ ...prev, [service]: d.log || '(empty log file)' }))
        if (autoExpand) {
          setExpandedLog(service)
        } else {
          setExpandedLog(expandedLog === service ? null : service)
        }
      }
    } catch (err) {
      addLog('error', `Failed to fetch log for ${service}: ${(err as Error).message}`)
    }
  }

  async function doAction(action: 'start' | 'stop' | 'restart', service: string) {
    const key = `${action}:${service}`
    setActionLoading(key)
    addLog('info', `${action.toUpperCase()} → ${service}…`, service)
    setLastActionResult(prev => ({ ...prev, [service]: { ok: false, error: undefined } }))

    try {
      const r = await fetch('/api/vnc/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, service }),
      })
      const d = await r.json()

      if (d.ok) {
        addLog('success', `${service}: ${action} ✓ — now ${d.status?.[service] ? 'RUNNING' : 'still STOPPED'}`, service)
        setLastActionResult(prev => ({ ...prev, [service]: { ok: true } }))
      } else {
        const errorMsg = d.result?.error || d.error || 'failed'
        addLog('error', `${service}: ${action} ✗ — ${errorMsg}`, service)
        setLastActionResult(prev => ({ ...prev, [service]: { ok: false, error: errorMsg } }))
      }
      if (d.status) setStatus(d.status)

      // Auto-fetch + expand the log so the user can see what happened
      autoExpandRef.current = service
      await fetchLog(service, true)
    } catch (err) {
      addLog('error', `${service}: ${action} exception — ${(err as Error).message}`, service)
      setLastActionResult(prev => ({ ...prev, [service]: { ok: false, error: (err as Error).message } }))
    } finally {
      setActionLoading(null)
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedLog(label)
      setTimeout(() => setCopiedLog(null), 2000)
    }).catch(() => {
      // Fallback — create a textarea, select, copy
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); setCopiedLog(label); setTimeout(() => setCopiedLog(null), 2000) } catch {}
      document.body.removeChild(ta)
    })
  }

  // Parse the service log for the last meaningful error line
  function getLastError(log: string | undefined): string | null {
    if (!log) return null
    const lines = log.split('\n').filter(l => l.trim())
    // Look for common error patterns in Chrome/VNC logs
    const errorLines = lines.filter(l =>
      /error|failed|exception|cannot|missing|unable|fatal/i.test(l) &&
      !/no error/i.test(l)
    )
    return errorLines.length > 0 ? errorLines[errorLines.length - 1] : null
  }

  const allRunning = status?.xvfb && status?.chrome && status?.x11vnc && status?.websockify
  const runningCount = status ? [status.xvfb, status.chrome, status.x11vnc, status.websockify].filter(Boolean).length : 0

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100 overflow-hidden select-none">
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

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Service cards */}
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SERVICES.map(svc => {
            const isRunning = (status as any)?.[svc.id] ?? false
            const isActing = actionLoading && (actionLoading.includes(svc.id) || actionLoading.includes('all'))
            const actionResult = lastActionResult[svc.id]
            const lastError = getLastError(serviceLogs[svc.id])
            const dependsOnRunning = svc.dependsOn ? (status as any)?.[svc.dependsOn] : true
            const showDependencyWarn = !isRunning && !dependsOnRunning && !isActing
            return (
              <div
                key={svc.id}
                className={cn(
                  'rounded-lg border p-3 transition',
                  isRunning
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : actionResult && !actionResult.ok
                      ? 'border-rose-500/40 bg-rose-500/5'
                      : 'border-zinc-800 bg-zinc-900/50'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg shrink-0',
                    isRunning ? 'bg-emerald-500/15' : actionResult && !actionResult.ok ? 'bg-rose-500/15' : 'bg-zinc-800'
                  )}>
                    {isActing ? <Loader2 className={cn('h-4 w-4 animate-spin', svc.color)} /> : svc.icon}
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
                      ) : actionResult && !actionResult.ok ? (
                        <AlertCircle className="h-3.5 w-3.5 text-rose-400 ml-auto" />
                      ) : (
                        <div className="h-3.5 w-3.5 rounded-full border border-zinc-600 ml-auto" />
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{svc.desc}</div>
                    <div className="text-[10px] mt-1 flex items-center gap-2">
                      <span className={isRunning ? 'text-emerald-400 font-bold' : 'text-zinc-600'}>
                        {isRunning ? '● RUNNING' : '○ STOPPED'}
                      </span>
                      {showDependencyWarn && (
                        <span className="text-amber-400 text-[9px] flex items-center gap-0.5">
                          <AlertCircle className="h-2.5 w-2.5" />
                          needs {svc.dependsOn} first
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {/* Last error (if any) */}
                {actionResult && !actionResult.ok && actionResult.error && (
                  <div className="mt-2 rounded bg-rose-500/10 border border-rose-500/20 px-2 py-1.5 text-[10px] text-rose-300 flex items-start gap-1.5">
                    <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-bold">Failed: {actionResult.error}</div>
                      {lastError && (
                        <div className="text-rose-400/80 mt-0.5 font-mono text-[9px] break-all">
                          Log: {lastError.slice(0, 120)}{lastError.length > 120 ? '…' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
                    className={cn(
                      'flex items-center gap-1 rounded px-2.5 py-1 text-[9px] font-bold transition ml-auto',
                      expandedLog === svc.id
                        ? 'bg-zinc-700 text-zinc-200'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                    )}
                  >
                    <Terminal className="h-3 w-3" />
                    Log
                    {expandedLog === svc.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                </div>
                {/* Log panel — selectable/copyable */}
                {expandedLog === svc.id && (
                  <div className="mt-2 rounded bg-zinc-950 border border-zinc-800 overflow-hidden">
                    <div className="flex items-center justify-between px-2 py-1 bg-zinc-900/50 border-b border-zinc-800">
                      <span className="text-[9px] text-zinc-500 font-mono">{svc.id}.log (last 30 lines)</span>
                      <button
                        onClick={() => copyToClipboard(serviceLogs[svc.id] || '', svc.id)}
                        className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-zinc-300 transition"
                      >
                        {copiedLog === svc.id ? (
                          <><ClipboardCheck className="h-3 w-3 text-emerald-400" /> <span className="text-emerald-400">Copied</span></>
                        ) : (
                          <><Copy className="h-3 w-3" /> Copy</>
                        )}
                      </button>
                    </div>
                    <pre
                      className="text-[9px] text-zinc-400 whitespace-pre-wrap font-mono p-2 max-h-40 overflow-y-auto select-text cursor-text"
                      onMouseDown={(e) => e.stopPropagation()}
                    >{serviceLogs[svc.id] !== undefined ? serviceLogs[svc.id] : 'Loading…'}</pre>
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
        <div className="px-4 pb-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] font-bold uppercase text-zinc-500 flex items-center gap-1">
              <Activity className="h-3 w-3" /> Activity Log
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copyToClipboard(logs.map(l => `[${new Date(l.ts).toLocaleTimeString()}] ${l.level.toUpperCase()} ${l.msg}`).join('\n'), 'activity')}
                className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-zinc-300 transition rounded px-1.5 py-0.5 hover:bg-zinc-800"
              >
                {copiedLog === 'activity' ? (
                  <><ClipboardCheck className="h-3 w-3 text-emerald-400" /> <span className="text-emerald-400">Copied</span></>
                ) : (
                  <><Copy className="h-3 w-3" /> Copy</>
                )}
              </button>
              <button
                onClick={() => setLogs([])}
                className="text-[9px] text-zinc-500 hover:text-rose-400 transition rounded px-1.5 py-0.5 hover:bg-zinc-800"
              >
                Clear
              </button>
            </div>
          </div>
          <div
            ref={logEndRef}
            className="rounded-md bg-zinc-950 border border-zinc-800 p-2 space-y-0.5 max-h-64 overflow-y-auto"
          >
            {logs.length === 0 ? (
              <div className="text-[10px] text-zinc-600 italic text-center py-4 select-none">
                No activity yet. Click <span className="text-emerald-400 font-bold">Start</span>, <span className="text-rose-400 font-bold">Stop</span>, or <span className="text-amber-400 font-bold">Restart</span> on any service above.
              </div>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  className="flex gap-2 text-[10px] font-mono items-start select-text cursor-text"
                  onMouseDown={(e) => e.stopPropagation()}
                >
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
                  {log.service && (
                    <span className={cn(
                      'shrink-0 text-[9px] font-bold px-1 rounded',
                      log.service === 'xvfb' ? 'bg-sky-500/15 text-sky-400' :
                      log.service === 'chrome' ? 'bg-emerald-500/15 text-emerald-400' :
                      log.service === 'x11vnc' ? 'bg-violet-500/15 text-violet-400' :
                      log.service === 'websockify' ? 'bg-amber-500/15 text-amber-400' :
                      'bg-zinc-700 text-zinc-400'
                    )}>
                      {log.service}
                    </span>
                  )}
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
    </div>
  )
}
