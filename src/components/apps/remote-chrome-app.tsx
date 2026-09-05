'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Monitor, Play, Square, RefreshCw, ExternalLink, Activity,
  ArrowLeft, ArrowRight, Search, X, Camera, Shield, Terminal, Copy,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface VncStatus {
  running: boolean
  allReady: boolean
  components: { xvfb: boolean; chrome: boolean; x11vnc: boolean; websockify: boolean }
  url: string | null
  password: string
  display: string
}

interface LogEntry { ts: number; level: 'info' | 'success' | 'error' | 'warn'; msg: string }

export function RemoteChromeApp() {
  const [status, setStatus] = useState<VncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showVnc, setShowVnc] = useState(false)
  const [navUrl, setNavUrl] = useState('')
  const [navLoading, setNavLoading] = useState(false)
  const [navMessage, setNavMessage] = useState<string | null>(null)
  const [contentFocused, setContentFocused] = useState(false)
  const [blurEnabled, setBlurEnabled] = useState(true)

  // Camera log panel
  const [showLogPanel, setShowLogPanel] = useState(true)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [cameraStatus, setCameraStatus] = useState<any>(null)
  const [realFps, setRealFps] = useState<number | null>(null)

  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLog = useCallback((level: LogEntry['level'], msg: string) => {
    setLogs(p => [...p.slice(-150), { ts: Date.now(), level, msg }])
  }, [])

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/vnc/status', { cache: 'no-store' })
      if (r.ok) { const d = await r.json(); setStatus(d) }
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [refresh])

  // Poll camera status + real FPS when VNC is open
  useEffect(() => {
    if (!showVnc) {
      if (logPollRef.current) { clearInterval(logPollRef.current); logPollRef.current = null }
      return
    }

    const poll = async () => {
      try {
        const r = await fetch('/api/camera-inject', { cache: 'no-store' })
        if (r.ok) {
          const d = await r.json()
          setCameraStatus(d.status?.vnc)
          
          // Check real FPS from Chrome tab
          if (d.status?.vnc?.cameraActive) {
            try {
              const tabsResp = await fetch('http://127.0.0.1:9222/json', { cache: 'no-store' })
              if (tabsResp.ok) {
                const tabs = await tabsResp.json()
                const pageTab = tabs.find((t: any) => t.type === 'page')
                if (pageTab?.webSocketDebuggerUrl) {
                  // Can't easily get FPS from server side without CDP WS
                  // Show configured FPS instead
                  setRealFps(d.status?.vnc?.settings?.fps || 15)
                }
              }
            } catch {}
          } else {
            setRealFps(null)
          }
        }
      } catch {}
    }

    poll()
    logPollRef.current = setInterval(poll, 5000)
    return () => { if (logPollRef.current) clearInterval(logPollRef.current) }
  }, [showVnc])

  async function start() {
    setActionLoading(true)
    setMessage('Starting Remote Chrome…')
    addLog('info', 'Starting Remote Chrome (Xvfb + Chrome + x11vnc + websockify)...')
    try {
      const r = await fetch('/api/vnc/start', { method: 'POST' })
      const d = await r.json()
      if (d.ok) {
        setMessage(d.alreadyRunning ? 'Already running.' : 'Started!')
        addLog('success', d.alreadyRunning ? 'Remote Chrome already running' : 'Remote Chrome started')
        await refresh()
        setShowVnc(true)
        // Auto-inject anti-detect + camera
        addLog('info', 'Auto-injecting anti-detect script...')
        try {
          await fetch('/api/vnc/anti-detect', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'enable' }),
          })
          addLog('success', 'Anti-detect script injected')
        } catch (e) { addLog('error', `Anti-detect failed: ${(e as Error).message}`) }
      } else {
        setMessage(`Failed: ${d.error || 'unknown'}`)
        addLog('error', `Start failed: ${d.error || 'unknown'}`)
      }
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`)
      addLog('error', `Start error: ${(err as Error).message}`)
    } finally {
      setActionLoading(false)
      setTimeout(() => setMessage(null), 5000)
    }
  }

  async function stop() {
    setActionLoading(true)
    setMessage('Stopping…')
    addLog('info', 'Stopping Remote Chrome...')
    try {
      const r = await fetch('/api/vnc/stop', { method: 'POST' })
      const d = await r.json()
      addLog(d.ok ? 'success' : 'error', d.ok ? 'Stopped' : `Stop failed: ${d.error}`)
      setMessage(d.ok ? 'Stopped.' : `Failed: ${d.error}`)
      await refresh()
    } catch (err) { addLog('error', `Stop error: ${(err as Error).message}`) }
    finally { setActionLoading(false); setTimeout(() => setMessage(null), 4000) }
  }

  async function navigate(url?: string) {
    const target = (url ?? navUrl).trim()
    if (!target) return
    setNavLoading(true)
    addLog('info', `Navigating to: ${target}`)
    try {
      const r = await fetch('/api/vnc/navigate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      })
      const d = await r.json()
      if (d.ok) {
        setNavUrl(d.url)
        setNavMessage(`→ ${d.url}`)
        addLog('success', `Navigated to ${d.url}`)
        addLog('info', `Camera: ${d.camera} | Perms: ${d.permissions}`)
        if (d.camera === 'injected') addLog('success', 'Virtual camera active on this page')
        else addLog('warn', 'Camera NOT injected — enable in Camera Inject app')
      } else {
        setNavMessage(`Failed: ${d.error}`)
        addLog('error', `Navigate failed: ${d.error}`)
      }
    } catch (err) {
      setNavMessage(`Error: ${(err as Error).message}`)
      addLog('error', `Navigate error: ${(err as Error).message}`)
    } finally {
      setNavLoading(false)
      setTimeout(() => setNavMessage(null), 4000)
    }
  }

  async function control(action: string) {
    addLog('info', `Control: ${action}`)
    setNavLoading(true)
    try {
      await fetch('/api/vnc/control', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
    } catch {}
    finally { setNavLoading(false) }
  }

  async function grantCamera() {
    addLog('info', '🔴 Button: Allow Camera pressed')
    setNavMessage('Granting camera permission...')
    try {
      addLog('info', '→ Granting videoCapture + audioCapture permissions...')
      const r1 = await fetch('/api/vnc/permission', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: ['videoCapture', 'audioCapture'] }),
      })
      const t1 = await r1.text()
      let d1: any
      try { d1 = JSON.parse(t1) } catch {
        if (r1.status === 401 || t1.includes('Not authenticated')) {
          addLog('error', 'Session expired — reload page and log in')
          setNavMessage('❌ Session expired — reload page')
          return
        }
        addLog('error', `Permission API error: ${r1.status}`)
        d1 = { ok: false, error: `HTTP ${r1.status}` }
      }
      addLog(d1.ok ? 'success' : 'error', `Permissions: ${d1.ok ? `${d1.tabsGranted} tab(s) granted` : d1.error}`)

      addLog('info', '→ Injecting virtual camera...')
      const r2 = await fetch('/api/camera-inject', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inject', targets: ['vnc'], config: { sourceType: 'test-pattern' } }),
      })
      const t2 = await r2.text()
      let d2: any
      try { d2 = JSON.parse(t2) } catch {
        if (r2.status === 401 || t2.includes('Not authenticated')) {
          addLog('error', 'Session expired — reload page and log in')
          setNavMessage('❌ Session expired — reload page')
          return
        }
        addLog('error', `Camera API error: ${r2.status}`)
        d2 = { ok: false, error: `HTTP ${r2.status}` }
      }
      addLog(d2.ok ? 'success' : 'error', `Camera inject: ${d2.ok ? 'success' : d2.message || d2.error}`)

      addLog('info', '→ Reloading page (so scripts run before page JS)...')
      await fetch('/api/vnc/control', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reload' }),
      })

      setNavMessage('✅ Camera allowed + page reloaded')
      addLog('success', '✅ Camera ALLOWED — page reloaded — websites will see virtual camera')
    } catch (err) {
      setNavMessage(`Error: ${(err as Error).message}`)
      addLog('error', `Camera grant error: ${(err as Error).message}`)
    }
    setTimeout(() => setNavMessage(null), 5000)
  }

  const running = status?.allReady ?? false
  const components = status?.components
  const vncUrl = `/remote-chrome.html?path=websockify%3FXTransformPort%3D6080`

  // === VNC View ===
  if (showVnc && running) {
    return (
      <div className="flex h-full w-full flex-col bg-zinc-950 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-800 bg-zinc-900 shrink-0">
          <button onClick={() => control('back')} disabled={navLoading} className="flex h-7 w-7 items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 disabled:opacity-30"><ArrowLeft className="h-4 w-4" /></button>
          <button onClick={() => control('forward')} disabled={navLoading} className="flex h-7 w-7 items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 disabled:opacity-30"><ArrowRight className="h-4 w-4" /></button>
          <button onClick={() => control('reload')} disabled={navLoading} className="flex h-7 w-7 items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 disabled:opacity-30"><RefreshCw className={cn('h-4 w-4', navLoading && 'animate-spin')} /></button>

          <div className="flex flex-1 items-center gap-1.5 mx-1 rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1">
            <Search className="h-3 w-3 text-zinc-500 shrink-0" />
            <input value={navUrl} onChange={(e) => setNavUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') navigate() }} placeholder="Type URL or search…" className="flex-1 bg-transparent text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 min-w-0" />
            {navLoading && <div className="h-2.5 w-2.5 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin shrink-0" />}
          </div>

          <button onClick={() => navigate()} disabled={navLoading || !navUrl.trim()} className="flex h-7 items-center gap-1 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:opacity-30 text-white px-3 text-[10px] font-bold"><Play className="h-3 w-3" /> Go</button>

          {/* Allow Camera — always visible */}
          <button onClick={grantCamera} title="Grant camera permission + inject virtual camera" className="flex h-7 items-center gap-1 rounded-md px-2 text-[9px] font-bold transition shrink-0 bg-fuchsia-500 text-white hover:bg-fuchsia-400 ring-1 ring-fuchsia-400/50 animate-pulse"><Camera className="h-3 w-3" /> Allow Camera</button>

          {/* Log panel toggle */}
          <button onClick={() => setShowLogPanel(!showLogPanel)} className={cn('flex h-7 items-center gap-1 rounded-md px-2 text-[9px] font-bold transition shrink-0', showLogPanel ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-400')}><Terminal className="h-3 w-3" /> Logs</button>

          <button onClick={() => window.open(vncUrl, '_blank')} className="flex h-7 items-center gap-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 text-[10px] font-bold ml-1"><ExternalLink className="h-3 w-3" /></button>
          <button onClick={() => setShowVnc(false)} className="flex h-7 items-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 text-[10px] font-bold">←</button>
        </div>

        {/* Nav message */}
        {navMessage && <div className="px-3 py-1 bg-cyan-500/10 border-b border-cyan-500/20 text-cyan-300 text-[10px] font-mono truncate">{navMessage}</div>}

        {/* Quick links */}
        <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 bg-zinc-900/50 overflow-x-auto shrink-0">
          <span className="text-[9px] text-zinc-600 uppercase font-bold shrink-0">Quick:</span>
          {[
            { name: 'DuckDuckGo', url: 'https://duckduckgo.com' },
            { name: 'YouTube', url: 'https://www.youtube.com' },
            { name: 'Webcam Test', url: 'https://webcamtests.com' },
          ].map((q) => (
            <button key={q.url} onClick={() => { setNavUrl(q.url); navigate(q.url) }} disabled={navLoading} className="flex h-6 items-center rounded px-2 text-[9px] font-bold bg-zinc-800 hover:bg-cyan-500/20 hover:text-cyan-400 text-zinc-400 shrink-0">{q.name}</button>
          ))}
        </div>

        {/* Main: noVNC + Log panel */}
        <div className="flex-1 flex overflow-hidden">
          {/* noVNC iframe */}
          <div className={cn('relative bg-black', showLogPanel && 'flex-none')} style={{ width: showLogPanel ? 'calc(100% - 320px)' : '100%' }} onMouseEnter={() => setContentFocused(true)} onMouseLeave={() => setContentFocused(false)}>
            {!contentFocused && blurEnabled && <div className="absolute inset-0 z-50 pointer-events-none" style={{ backdropFilter: 'blur(40px)', background: 'rgba(9,9,11,0.7)' }} />}
            {blurEnabled && <button onClick={() => setBlurEnabled(v => !v)} className={cn('absolute top-2 right-2 z-50 flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold transition', contentFocused ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500')}>{contentFocused ? '🔓 Blur ON' : '🔒 Blur ON'}</button>}
            {!blurEnabled && <button onClick={() => setBlurEnabled(true)} className="absolute top-2 right-2 z-50 flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold bg-zinc-800 text-zinc-500">🔒 Blur OFF</button>}
            <iframe src={vncUrl} title="Remote Chrome" className="h-full w-full border-0" style={{ background: '#000', filter: blurEnabled ? (contentFocused ? 'none' : 'blur(60px) brightness(0.6)') : 'none', transition: 'filter 0.3s ease' }} allow="camera; microphone; fullscreen" />
          </div>

          {/* Camera Log Panel (right side) */}
          {showLogPanel && (
            <div className="w-80 border-l border-zinc-800 bg-zinc-950 flex flex-col">
              {/* Camera status header */}
              <div className={cn('border-b border-zinc-800 p-2.5', cameraStatus?.cameraActive ? 'bg-emerald-500/10' : 'bg-zinc-900')}>
                <div className="flex items-center gap-2">
                  <div className={cn('h-2.5 w-2.5 rounded-full', cameraStatus?.cameraActive ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600')} />
                  <span className={cn('text-[11px] font-bold', cameraStatus?.cameraActive ? 'text-emerald-400' : 'text-zinc-500')}>
                    {cameraStatus?.cameraActive ? 'CAMERA LIVE' : 'CAMERA OFF'}
                  </span>
                  <span className="ml-auto text-[9px] text-zinc-600">{cameraStatus?.tabs || 0} tab(s)</span>
                </div>
                {/* Real FPS display */}
                <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                  <div>
                    <span className="text-zinc-600">FPS: </span>
                    <span className={cn('font-bold', cameraStatus?.cameraActive ? 'text-emerald-400' : 'text-zinc-600')}>{realFps || '—'}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">Source: </span>
                    <span className="text-cyan-400 font-bold">{cameraStatus?.settings?.sourceType || 'none'}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">Zoom: </span>
                    <span className="text-cyan-400 font-bold">{cameraStatus?.settings?.zoom?.toFixed(1) || '1.0'}×</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[10px]">
                  <div>
                    <span className="text-zinc-600">Res: </span>
                    <span className="text-zinc-400 font-bold">{cameraStatus?.settings?.width || 640}×{cameraStatus?.settings?.height || 480}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">AntiDetect: </span>
                    <span className={cn('font-bold', cameraStatus?.settings ? 'text-emerald-400' : 'text-zinc-600')}>{cameraStatus?.settings ? 'ON' : 'OFF'}</span>
                  </div>
                </div>
              </div>

              {/* Console */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-800 bg-zinc-900">
                  <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-[10px] font-bold">Camera Logs</span>
                  <span className="text-[8px] text-zinc-600">{logs.length}</span>
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => { const text = logs.map(l => `[${new Date(l.ts).toLocaleTimeString()}] [${l.level.toUpperCase()}] ${l.msg}`).join('\n'); navigator.clipboard.writeText(text).then(() => addLog('success', `Copied ${logs.length} logs`), () => addLog('error', 'Copy failed')) }} disabled={logs.length === 0} className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-cyan-400 disabled:opacity-30"><Copy className="h-2.5 w-2.5" /> Copy</button>
                    <button onClick={() => setLogs([])} className="text-[8px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-600 hover:text-rose-400">clr</button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 font-mono text-[9px]">
                  {logs.length === 0 ? (
                    <div className="text-zinc-700 text-center py-4">No logs yet.<br />Click "Allow Camera" to start.</div>
                  ) : (
                    logs.slice().reverse().map((l, i) => (
                      <div key={i} className="leading-tight hover:bg-zinc-900/50 rounded px-1 py-0.5">
                        <span className="text-zinc-700">{new Date(l.ts).toLocaleTimeString().slice(0, 8)}</span>{' '}
                        <span className={cn('font-bold', l.level === 'error' ? 'text-rose-400' : l.level === 'warn' ? 'text-amber-400' : l.level === 'success' ? 'text-emerald-400' : 'text-cyan-400')}>[{l.level.toUpperCase()}]</span>{' '}
                        <span className="text-zinc-400">{l.msg}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Quick actions */}
              <div className="border-t border-zinc-800 p-2 space-y-1">
                <button onClick={grantCamera} className="w-full py-1.5 rounded bg-fuchsia-500 hover:bg-fuchsia-400 text-white text-[10px] font-bold flex items-center justify-center gap-1"><Camera className="h-3 w-3" /> Allow Camera</button>
                <div className="flex gap-1">
                  <button onClick={() => control('scroll-down')} className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[9px] font-bold">↓ Scroll</button>
                  <button onClick={() => control('scroll-up')} className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[9px] font-bold">↑ Scroll</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // === Status View ===
  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-violet-900/30 to-cyan-900/30">
        <Monitor className="h-5 w-5 text-cyan-400" />
        <h1 className="text-base font-bold">Remote Chrome</h1>
        <span className="text-[10px] text-zinc-500 ml-1">noVNC + Tor</span>
        <div className={cn('ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold', running ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-500')}>
          <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600')} />
          {loading ? 'CHECKING…' : running ? 'RUNNING' : 'STOPPED'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-start gap-3">
            <div className="text-3xl">🖥️</div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold mb-1">Real Chrome Browser via noVNC</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">Real Chromium on virtual display, routed through Tor. Camera support, anti-detect, virtual camera injection.</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">Tor-routed</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">1366×768</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">Anti-Detect</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300">Virtual Camera</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase text-zinc-500 mb-2 flex items-center gap-1"><Activity className="h-3 w-3" /> Components</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { name: 'Xvfb', desc: 'Virtual display :99', icon: Monitor, alive: components?.xvfb },
              { name: 'Chrome', desc: 'Tor-routed browser', icon: Monitor, alive: components?.chrome },
              { name: 'x11vnc', desc: 'VNC server :5900', icon: Activity, alive: components?.x11vnc },
              { name: 'websockify', desc: 'WebSocket :6080', icon: Shield, alive: components?.websockify },
            ].map((c) => (
              <div key={c.name} className={cn('rounded-md border p-2.5 flex items-center gap-2.5', c.alive ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/50')}>
                <c.icon className={cn('h-4 w-4', c.alive ? 'text-emerald-400' : 'text-zinc-600')} />
                <div className="flex-1 min-w-0"><div className="text-xs font-bold">{c.name}</div><div className="text-[10px] text-zinc-500 truncate">{c.desc}</div></div>
                <div className={cn('h-2 w-2 rounded-full', c.alive ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700')} />
              </div>
            ))}
          </div>
        </div>

        {message && <div className={cn('rounded-md px-3 py-2 text-xs border', message.startsWith('Error') || message.startsWith('Failed') ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300')}>{message}</div>}
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800 bg-zinc-900/80">
        <button onClick={start} disabled={actionLoading} className="flex items-center gap-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white px-4 py-2 text-xs font-bold transition">{actionLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{running ? 'Restart' : 'Start'}</button>
        <button onClick={stop} disabled={actionLoading || !running} className="flex items-center gap-1.5 rounded-md bg-rose-500/80 hover:bg-rose-500 disabled:opacity-40 text-white px-4 py-2 text-xs font-bold transition"><Square className="h-3.5 w-3.5" /> Stop</button>
        <button onClick={refresh} disabled={actionLoading} className="flex items-center gap-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-2 text-xs font-bold transition"><RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh</button>
        {running && <button onClick={() => setShowVnc(true)} className="ml-auto flex items-center gap-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2 text-xs font-bold transition"><ExternalLink className="h-3.5 w-3.5" /> Open Browser</button>}
      </div>
    </div>
  )
}
