'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Camera, Upload, Film, Image as ImageIcon, Video, Trash2, Play, Square,
  ZoomIn, Gauge, RefreshCw, Shield, Monitor, Globe, Check, X,
  AlertTriangle, Send, RotateCcw, Settings, Terminal, Activity, Wifi, Copy,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface MediaFile { name: string; size: number; type: 'video' | 'image' | 'file' }
interface LogEntry { ts: number; level: 'info' | 'success' | 'error' | 'warn'; msg: string }

export function CameraInjectApp() {
  const [files, setFiles] = useState<MediaFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [sourceType, setSourceType] = useState<SourceType>('test-pattern')
  const [uploadLoading, setUploadLoading] = useState(false)

  const [zoom, setZoom] = useState(1.0)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [stretchX, setStretchX] = useState(1.0)
  const [stretchY, setStretchY] = useState(1.0)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [saturation, setSaturation] = useState(100)
  const [hue, setHue] = useState(0)
  const [mirror, setMirror] = useState(false)
  const [flip, setFlip] = useState(false)
  const [grayscale, setGrayscale] = useState(false)
  const [sepia, setSepia] = useState(false)
  const [invert, setInvert] = useState(false)

  const [injecting, setInjecting] = useState(false)
  const [status, setStatus] = useState<any>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [targetVnc, setTargetVnc] = useState(true)
  const [targetTorSuite, setTargetTorSuite] = useState(true)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [liveStats, setLiveStats] = useState<any>(null)
  const [pulseBeat, setPulseBeat] = useState(0)

  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statsTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pulseTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  type SourceType = 'test-pattern' | 'video' | 'image'

  const addLog = useCallback((level: LogEntry['level'], msg: string) => {
    setLogs(p => [...p.slice(-100), { ts: Date.now(), level, msg }])
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/camera-inject', { cache: 'no-store' })
      if (!r.ok) return
      const text = await r.text()
      if (!text) return
      const d = JSON.parse(text)
      if (d.status) { setStatus(d.status); setFiles(d.status.files || []) }
    } catch {}
  }, [])

  // Initial load
  useEffect(() => {
    addLog('info', 'Camera Inject started')
    fetchStatus()
    const id = setInterval(fetchStatus, 10000)
    return () => clearInterval(id)
  }, [fetchStatus, addLog])

  // Live stats polling (every 3s when camera is active)
  useEffect(() => {
    if (status?.vnc?.cameraActive) {
      statsTimer.current = setInterval(async () => {
        try {
          const r = await fetch('/api/camera-inject', { cache: 'no-store' })
          if (r.ok) {
            const text = await r.text()
            try { const d = JSON.parse(text); if (d.status?.vnc) setLiveStats(d.status.vnc) } catch {}
          }
        } catch {}
      }, 3000)
      return () => { if (statsTimer.current) clearInterval(statsTimer.current) }
    } else {
      setLiveStats(null)
    }
  }, [status?.vnc?.cameraActive])

  // Pulse animation
  useEffect(() => {
    pulseTimer.current = setInterval(() => setPulseBeat(p => (p + 1) % 100), 50)
    return () => { if (pulseTimer.current) clearInterval(pulseTimer.current) }
  }, [])

  async function uploadFile(file: File) {
    setUploadLoading(true)
    setMessage(`Uploading ${file.name}...`)
    addLog('info', `Uploading ${file.name}...`)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1]
          const r = await fetch('/api/camera-inject/upload', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'upload', filename: file.name, data: base64 }),
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const d = await r.json()
          if (d.ok) {
            setMessage(`✅ Uploaded ${file.name} (${(d.size / 1024).toFixed(1)}KB)`)
            addLog('success', `Uploaded ${file.name} (${(d.size / 1024).toFixed(1)}KB)`)
            await fetchStatus()
            setSelectedFile(d.filename)
            setSourceType(d.type)
          } else { setMessage(`❌ ${d.error}`); addLog('error', `Upload failed: ${d.error}`) }
        } catch (err) { setMessage(`Error: ${(err as Error).message}`); addLog('error', `Upload error: ${(err as Error).message}`) }
        finally { setUploadLoading(false); setTimeout(() => setMessage(null), 4000) }
      }
      reader.onerror = () => { setMessage('Error: Failed to read file'); addLog('error', 'FileReader error'); setUploadLoading(false) }
      reader.readAsDataURL(file)
    } catch (err) { setMessage(`Error: ${(err as Error).message}`); addLog('error', `(err as Error).message`); setUploadLoading(false) }
  }

  async function deleteFile(name: string) {
    addLog('info', `🗑️ Button: Delete file "${name}"`)
    try {
      await fetch('/api/camera-inject/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', filename: name }) })
      if (selectedFile === name) { setSelectedFile(null); setSourceType('test-pattern') }
      await fetchStatus()
      addLog('success', `Deleted: ${name}`)
    } catch (err) { addLog('error', `Delete failed: ${(err as Error).message}`) }
  }

  function selectSource(name: string) {
    const file = files.find(f => f.name === name)
    if (!file) return
    setSelectedFile(name)
    setSourceType(file.type === 'video' ? 'video' : 'image')
    addLog('info', `📁 Button: Select source → ${name} (${file.type})`)
  }

  function buildConfig() {
    const cfg: any = { sourceType, zoom, panX, panY, stretchX, stretchY, brightness, contrast, saturation, hue, mirror, flip, grayscale, sepia, invert }
    if (selectedFile && sourceType !== 'test-pattern') cfg.sourceFile = selectedFile
    return cfg
  }

  async function injectAll() {
    setInjecting(true)
    setMessage('Injecting camera...')
    addLog('info', '🔴 Button: INJECT TO ALL TARGETS pressed')
    addLog('info', `├─ Source: ${sourceType}${selectedFile ? ' (' + selectedFile + ')' : ''}`)
    addLog('info', `├─ Zoom: ${zoom}×, PanX: ${panX}, PanY: ${panY}`)
    addLog('info', `├─ Filters: B${brightness} C${contrast} S${saturation} H${hue}${mirror ? ' Mirror' : ''}${flip ? ' Flip' : ''}${grayscale ? ' Gray' : ''}${sepia ? ' Sepia' : ''}${invert ? ' Invert' : ''}`)
    addLog('info', `└─ Targets: ${[targetVnc ? 'VNC' : null, targetTorSuite ? 'TorSuite' : null].filter(Boolean).join(', ')}`)
    try {
      const targets: string[] = []
      if (targetVnc) targets.push('vnc')
      if (targetTorSuite) targets.push('tor-suite')
      if (targets.length === 0) { setMessage('❌ Select at least one target'); addLog('error', 'No targets selected — aborting'); setInjecting(false); return }

      addLog('info', `→ Sending inject request to ${targets.length} target(s)...`)
      const r = await fetch('/api/camera-inject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inject', targets, config: buildConfig() }) })
      
      // Safe JSON parsing — handle 401/auth errors gracefully
      const text = await r.text()
      let d: any
      try { d = JSON.parse(text) } catch {
        if (r.status === 401 || text.includes('Not authenticated')) {
          addLog('error', 'Session expired — please reload the page and log in again')
          setMessage('❌ Session expired — reload page')
        } else {
          addLog('error', `Server returned ${r.status}: ${text.slice(0, 100)}`)
          setMessage(`❌ Server error (${r.status})`)
        }
        setInjecting(false)
        setTimeout(() => setMessage(null), 5000)
        return
      }

      if (d.needsAuth) {
        addLog('error', 'Session expired — please reload the page and log in again')
        setMessage('❌ Session expired — reload page')
        setInjecting(false)
        setTimeout(() => setMessage(null), 5000)
        return
      }

      if (d.ok) {
        setMessage(`✅ ${d.message}`)
        addLog('success', `✅ ${d.message}`)
        if (d.results?.vnc?.tabsInjected) addLog('success', `├─ VNC: ${d.results.vnc.tabsInjected} tab(s) injected successfully`)
        if (d.results?.vnc?.error) addLog('error', `├─ VNC error: ${d.results.vnc.error}`)
        if (d.results?.torSuite?.ok) addLog('success', `└─ Tor Suite: ready`)
        addLog('info', `Effect: Camera now streaming to browser — websites will see virtual camera`)
      } else {
        setMessage(`⚠️ ${d.message}`)
        addLog('warn', `⚠️ ${d.message}`)
        if (d.results?.vnc?.error) addLog('error', `└─ VNC: ${d.results.vnc.error}`)
      }
      await fetchStatus()
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`)
      addLog('error', `Injection error: ${(err as Error).message}`)
    } finally {
      setInjecting(false)
      setTimeout(() => setMessage(null), 6000)
    }
  }

  async function patchLive() {
    const targets: string[] = []
    if (targetVnc) targets.push('vnc')
    if (targetTorSuite) targets.push('tor-suite')
    if (targets.length === 0) return
    try { await fetch('/api/camera-inject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'patch', targets, config: buildConfig() }) }) } catch {}
  }

  function schedulePatch() {
    if (patchTimer.current) clearTimeout(patchTimer.current)
    patchTimer.current = setTimeout(() => patchLive(), 250)
  }

  async function disableAll() {
    setInjecting(true)
    setMessage('Disabling camera...')
    addLog('info', '⏹️ Button: Disable Camera pressed')
    try {
      const targets: string[] = []
      if (targetVnc) targets.push('vnc')
      if (targetTorSuite) targets.push('tor-suite')
      addLog('info', `→ Disabling on: ${targets.join(', ')}`)
      await fetch('/api/camera-inject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disable', targets }) })
      setMessage('✅ Camera disabled')
      addLog('success', '✅ Camera disabled on all targets')
      addLog('info', `Effect: Websites will no longer see virtual camera — getUserMedia returns real device or fails`)
      await fetchStatus()
    } catch (err) { setMessage(`Error: ${(err as Error).message}`); addLog('error', `Disable error: ${(err as Error).message}`) }
    finally { setInjecting(false); setTimeout(() => setMessage(null), 4000) }
  }

  function resetSettings() {
    addLog('info', '🔄 Button: Reset Settings pressed')
    addLog('info', `├─ Zoom: ${zoom}× → 1.00×`)
    addLog('info', `├─ Pan: ${panX},${panY} → 0,0`)
    addLog('info', `└─ Filters: all reset to defaults`)
    setZoom(1.0); setPanX(0); setPanY(0); setBrightness(100); setContrast(100); setSaturation(100); setHue(0)
    setMirror(false); setFlip(false); setGrayscale(false); setSepia(false); setInvert(false)
    schedulePatch()
    addLog('success', 'Settings reset — live patch sent')
  }

  const previewUrl = selectedFile ? `/api/vnc/serve/${encodeURIComponent(selectedFile)}` : null
  const previewFilter = [`brightness(${brightness}%)`, `contrast(${contrast}%)`, `saturate(${saturation}%)`, `hue-rotate(${hue}deg)`, grayscale ? 'grayscale(100%)' : '', sepia ? 'sepia(100%)' : '', invert ? 'invert(100%)' : ''].filter(Boolean).join(' ')
  const previewTransform = `scale(${zoom}) translate(${-panX * 50 * (1 - 1/zoom)}%, ${-panY * 50 * (1 - 1/zoom)}%)${mirror ? ' scaleX(-1)' : ''}${flip ? ' scaleY(-1)' : ''} scale(${stretchX}, ${stretchY})`

  const isLive = status?.vnc?.cameraActive
  const pulseSize = isLive ? 8 + Math.sin(pulseBeat / 100 * Math.PI * 2) * 3 : 4

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-fuchsia-900/30 to-cyan-900/30 shrink-0">
        <Camera className="h-5 w-5 text-fuchsia-400" />
        <h1 className="text-base font-bold">Camera Inject</h1>
        <span className="text-[10px] text-zinc-500 ml-1">Unified Virtual Camera</span>
        <button onClick={fetchStatus} className="ml-auto p-1.5 rounded hover:bg-zinc-800 text-zinc-400"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* === LIVE STATUS BAR === */}
        <div className={cn('rounded-lg border p-3 flex items-center gap-3 transition',
          isLive ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-zinc-800 bg-zinc-900/40')}>
          {/* Pulsing dot */}
          <div className="relative flex items-center justify-center w-12 h-12 shrink-0">
            {isLive && (
              <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" style={{ animationDuration: '1.5s' }} />
            )}
            <div className={cn('rounded-full transition-all',
              isLive ? 'bg-emerald-500' : 'bg-zinc-600')}
              style={{ width: `${pulseSize * 2}px`, height: `${pulseSize * 2}px` }} />
          </div>
          <div className="flex-1">
            <div className={cn('text-sm font-bold', isLive ? 'text-emerald-400' : 'text-zinc-400')}>
              {isLive ? '● CAMERA LIVE' : '○ CAMERA OFFLINE'}
            </div>
            <div className="text-[10px] text-zinc-500">
              {isLive
                ? `Streaming to ${status?.vnc?.tabs || 0} tab(s) · ${liveStats?.settings?.sourceType || sourceType}`
                : 'Click INJECT TO ALL TARGETS to start'}
            </div>
          </div>
          {/* Stats */}
          {isLive && liveStats && (
            <div className="flex gap-3 text-[10px]">
              <div className="text-center">
                <div className="text-emerald-400 font-bold">{liveStats.settings?.fps || 15}</div>
                <div className="text-zinc-600">FPS</div>
              </div>
              <div className="text-center">
                <div className="text-emerald-400 font-bold">{liveStats.settings?.width || 640}×{liveStats.settings?.height || 480}</div>
                <div className="text-zinc-600">RES</div>
              </div>
              <div className="text-center">
                <div className="text-emerald-400 font-bold">{(liveStats.settings?.zoom || 1).toFixed(1)}×</div>
                <div className="text-zinc-600">ZOOM</div>
              </div>
            </div>
          )}
        </div>

        {/* === PREVIEW === */}
        <div className="rounded-lg border border-fuchsia-500/30 bg-zinc-900/60 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Camera className="h-4 w-4 text-fuchsia-400" />
            <span className="text-sm font-bold text-fuchsia-400">Camera Preview</span>
            <span className="ml-auto text-[10px] text-zinc-500">{sourceType} · {zoom.toFixed(2)}×</span>
          </div>
          <div className="relative aspect-video w-full bg-black rounded overflow-hidden border border-zinc-800">
            {previewUrl && sourceType !== 'test-pattern' ? (
              sourceType === 'video' ? (
                <video src={previewUrl} muted loop playsInline autoPlay
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ filter: previewFilter, transform: previewTransform, transformOrigin: 'center' }}
                  onError={() => {}} ref={(el) => { if (el) el.play().catch(() => {}) }}
                />
              ) : (
                <img src={previewUrl} alt="preview" className="absolute inset-0 w-full h-full object-cover"
                  style={{ filter: previewFilter, transform: previewTransform, transformOrigin: 'center' }} onError={() => {}} />
              )
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                {/* Animated test pattern */}
                <div className="absolute inset-0 flex">
                  {['#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#ffffff'].map((c, i) => (
                    <div key={i} className="flex-1" style={{ background: c, opacity: 0.3 + Math.sin(pulseBeat / 100 * Math.PI * 2 + i) * 0.2 }} />
                  ))}
                </div>
                <div className="relative text-center z-10">
                  <Camera className="h-12 w-12 text-fuchsia-500/80 mx-auto mb-2" />
                  <div className="text-xs text-white font-bold">VIRTUAL CAMERA</div>
                  <div className="text-[10px] text-zinc-300">Test Pattern · {new Date().toLocaleTimeString()}</div>
                </div>
                {/* Moving dot */}
                <div className="absolute w-8 h-8 rounded-full bg-white/60"
                  style={{
                    left: `${50 + Math.sin(pulseBeat / 100 * Math.PI * 2) * 40}%`,
                    top: `${50 + Math.cos(pulseBeat / 100 * Math.PI * 2) * 40}%`,
                    transform: 'translate(-50%, -50%)',
                    transition: 'all 0.05s linear',
                  }} />
              </div>
            )}
            <div className="absolute top-2 left-2 text-[10px] font-bold bg-black/70 text-fuchsia-400 px-2 py-0.5 rounded">
              {zoom.toFixed(2)}× {mirror ? '↔' : ''}{flip ? '↕' : ''}
            </div>
            <div className={cn('absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1',
              isLive ? 'bg-emerald-500/80 text-white' : 'bg-zinc-800 text-zinc-500')}>
              {isLive && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
              {isLive ? 'LIVE' : 'OFF'}
            </div>
          </div>
        </div>

        {/* === SOURCE === */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Film className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-bold">Camera Source</span>
            <label className="ml-auto flex items-center gap-1 rounded bg-fuchsia-500/20 text-fuchsia-400 hover:bg-fuchsia-500/30 px-2.5 py-1 text-[10px] font-bold cursor-pointer">
              <Upload className="h-3 w-3" /> {uploadLoading ? 'Uploading...' : 'Upload'}
              <input type="file" className="hidden" accept="image/*,video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f) }} />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button onClick={() => { setSelectedFile(null); setSourceType('test-pattern') }}
              className={cn('flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] font-bold transition',
                sourceType === 'test-pattern' ? 'bg-fuchsia-500/20 text-fuchsia-400 ring-1 ring-fuchsia-500/30' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700')}>
              <Camera className="h-3 w-3" /> Test Pattern
            </button>
            {files.map((f) => (
              <button key={f.name} onClick={() => selectSource(f.name)}
                className={cn('flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] font-bold transition max-w-[180px]',
                  selectedFile === f.name ? 'bg-fuchsia-500/20 text-fuchsia-400 ring-1 ring-fuchsia-500/30' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700')}
                title={f.name}>
                {f.type === 'video' ? <Video className="h-3 w-3 shrink-0" /> : <ImageIcon className="h-3 w-3 shrink-0" />}
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
          {files.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              {files.map((f) => (
                <div key={f.name} className="rounded bg-zinc-950 border border-zinc-800 p-1.5 flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    {f.type === 'image' ? <ImageIcon className="h-3 w-3 text-emerald-400 shrink-0" /> : <Video className="h-3 w-3 text-violet-400 shrink-0" />}
                    <span className="text-[9px] text-zinc-400 truncate flex-1">{f.name}</span>
                    <button onClick={() => deleteFile(f.name)} className="text-zinc-600 hover:text-rose-400"><Trash2 className="h-2.5 w-2.5" /></button>
                  </div>
                  <div className="text-[8px] text-zinc-600">{(f.size / 1024).toFixed(1)}KB</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* === ZOOM & PAN === */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <ZoomIn className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-bold">Zoom & Crop</span>
            <button onClick={resetSettings} className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500 hover:text-cyan-400"><RotateCcw className="h-3 w-3" /> Reset</button>
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-zinc-500 mb-1"><span>Zoom (crop)</span><span className="text-cyan-400 font-bold">{zoom.toFixed(2)}×</span></div>
            <input type="range" min={1} max={5} step={0.05} value={zoom} onChange={(e) => { setZoom(parseFloat(e.target.value)); schedulePatch() }} className="w-full accent-fuchsia-500" />
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-zinc-500 mb-1"><span>Pan X</span><span className="text-cyan-400 font-bold">{panX.toFixed(2)}</span></div>
            <input type="range" min={-1} max={1} step={0.05} value={panX} onChange={(e) => { setPanX(parseFloat(e.target.value)); schedulePatch() }} className="w-full accent-cyan-500" />
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-zinc-500 mb-1"><span>Pan Y</span><span className="text-cyan-400 font-bold">{panY.toFixed(2)}</span></div>
            <input type="range" min={-1} max={1} step={0.05} value={panY} onChange={(e) => { setPanY(parseFloat(e.target.value)); schedulePatch() }} className="w-full accent-cyan-500" />
          </div>
          {/* Stretch X (thin/fat) */}
          <div>
            <div className="flex justify-between text-[10px] text-zinc-500 mb-1"><span>Stretch X (thin ↔ fat)</span><span className="text-fuchsia-400 font-bold">{stretchX.toFixed(2)}×</span></div>
            <input type="range" min={0.3} max={3} step={0.05} value={stretchX} onChange={(e) => { setStretchX(parseFloat(e.target.value)); schedulePatch() }} className="w-full accent-fuchsia-500" />
          </div>
          {/* Stretch Y (short/tall) */}
          <div>
            <div className="flex justify-between text-[10px] text-zinc-500 mb-1"><span>Stretch Y (short ↔ tall)</span><span className="text-fuchsia-400 font-bold">{stretchY.toFixed(2)}×</span></div>
            <input type="range" min={0.3} max={3} step={0.05} value={stretchY} onChange={(e) => { setStretchY(parseFloat(e.target.value)); schedulePatch() }} className="w-full accent-fuchsia-500" />
          </div>
        </div>

        {/* === FILTERS === */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
          <div className="flex items-center gap-2 mb-1"><Gauge className="h-4 w-4 text-violet-400" /><span className="text-sm font-bold">Color & Filters</span></div>
          {[
            { label: 'Brightness', val: brightness, set: setBrightness, min: 0, max: 200, color: 'accent-amber-500' },
            { label: 'Contrast', val: contrast, set: setContrast, min: 0, max: 200, color: 'accent-violet-500' },
            { label: 'Saturation', val: saturation, set: setSaturation, min: 0, max: 200, color: 'accent-rose-500' },
            { label: 'Hue Rotate', val: hue, set: setHue, min: -180, max: 180, color: 'accent-emerald-500' },
          ].map((s) => (
            <div key={s.label}>
              <div className="flex justify-between text-[10px] text-zinc-500 mb-0.5"><span>{s.label}</span><span className="text-zinc-400 font-bold">{s.val}</span></div>
              <input type="range" min={s.min} max={s.max} step={1} value={s.val} onChange={(e) => { s.set(parseInt(e.target.value)); schedulePatch() }} className={cn('w-full', s.color)} />
            </div>
          ))}
          <div className="grid grid-cols-5 gap-1 pt-1">
            {[
              { label: 'Mirror', val: mirror, set: (v: boolean) => { setMirror(v); addLog('info', `🔀 Button: Mirror ${v ? 'ON' : 'OFF'}`); schedulePatch() }, icon: '↔' },
              { label: 'Flip', val: flip, set: (v: boolean) => { setFlip(v); addLog('info', `🔀 Button: Flip ${v ? 'ON' : 'OFF'}`); schedulePatch() }, icon: '↕' },
              { label: 'Gray', val: grayscale, set: (v: boolean) => { setGrayscale(v); addLog('info', `🎨 Button: Grayscale ${v ? 'ON' : 'OFF'}`); schedulePatch() }, icon: '◐' },
              { label: 'Sepia', val: sepia, set: (v: boolean) => { setSepia(v); addLog('info', `🎨 Button: Sepia ${v ? 'ON' : 'OFF'}`); schedulePatch() }, icon: '🟤' },
              { label: 'Invert', val: invert, set: (v: boolean) => { setInvert(v); addLog('info', `🎨 Button: Invert ${v ? 'ON' : 'OFF'}`); schedulePatch() }, icon: '◑' },
            ].map((t) => (
              <button key={t.label} onClick={() => t.set(!t.val)}
                className={cn('flex flex-col items-center gap-0.5 rounded py-1.5 text-[9px] font-bold transition',
                  t.val ? 'bg-fuchsia-500/20 text-fuchsia-400 ring-1 ring-fuchsia-500/30' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700')}>
                <span className="text-sm">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* === TARGETS === */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex items-center gap-2 mb-2"><Send className="h-4 w-4 text-emerald-400" /><span className="text-sm font-bold">Injection Targets</span></div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setTargetVnc(!targetVnc); addLog('info', `🎯 Button: Remote Chrome target ${!targetVnc ? 'ON' : 'OFF'}`) }}
              className={cn('rounded-md border p-2.5 flex flex-col items-start gap-1 transition',
                targetVnc ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700')}>
              <div className="flex items-center gap-1.5 w-full">
                <Monitor className={cn('h-4 w-4', targetVnc ? 'text-cyan-400' : 'text-zinc-600')} />
                <span className={cn('text-xs font-bold', targetVnc ? 'text-cyan-400' : 'text-zinc-500')}>Remote Chrome</span>
                {targetVnc && <Check className="h-3 w-3 text-cyan-400 ml-auto" />}
              </div>
              <div className="text-[9px] text-zinc-600">{status?.vnc?.running ? `${status.vnc.tabs} tab(s) · ${status.vnc.cameraActive ? '● Active' : '○ Off'}` : 'Not running'}</div>
            </button>
            <button onClick={() => { setTargetTorSuite(!targetTorSuite); addLog('info', `🎯 Button: Tor Suite target ${!targetTorSuite ? 'ON' : 'OFF'}`) }}
              className={cn('rounded-md border p-2.5 flex flex-col items-start gap-1 transition',
                targetTorSuite ? 'border-violet-500/50 bg-violet-500/10' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700')}>
              <div className="flex items-center gap-1.5 w-full">
                <Globe className={cn('h-4 w-4', targetTorSuite ? 'text-violet-400' : 'text-zinc-600')} />
                <span className={cn('text-xs font-bold', targetTorSuite ? 'text-violet-400' : 'text-zinc-500')}>Tor Suite</span>
                {targetTorSuite && <Check className="h-3 w-3 text-violet-400 ml-auto" />}
              </div>
              <div className="text-[9px] text-zinc-600">{status?.torSuite?.sessions ? `${status.torSuite.sessions} session(s)` : 'No sessions'}</div>
            </button>
          </div>
        </div>

        {/* === INJECT BUTTONS === */}
        <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 space-y-2">
          <button onClick={injectAll} disabled={injecting || (!targetVnc && !targetTorSuite)}
            className="w-full py-3 rounded-md bg-fuchsia-500 hover:bg-fuchsia-400 disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-2">
            {injecting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {injecting ? 'Injecting...' : 'INJECT TO ALL TARGETS'}
          </button>
          <button onClick={disableAll} disabled={injecting}
            className="w-full py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-xs font-bold flex items-center justify-center gap-2">
            <Square className="h-3 w-3" /> Disable Camera
          </button>
        </div>

        {/* === CONSOLE === */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-bold">Console</span>
            <span className="text-[9px] text-zinc-600">{logs.length} entries</span>
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => {
                  const text = logs.map(l => `[${new Date(l.ts).toLocaleTimeString()}] [${l.level.toUpperCase()}] ${l.msg}`).join('\n')
                  navigator.clipboard.writeText(text).then(
                    () => addLog('success', `Copied ${logs.length} log entries to clipboard`),
                    () => addLog('error', 'Clipboard write failed')
                  )
                }}
                disabled={logs.length === 0}
                className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-cyan-400 hover:bg-zinc-700 disabled:opacity-30 transition"
                title="Copy all logs to clipboard"
              >
                <Copy className="h-2.5 w-2.5" /> Copy
              </button>
              <button onClick={() => setLogs([])} className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-600 hover:text-rose-400 hover:bg-zinc-700 transition">clear</button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5 font-mono text-[10px]">
            {logs.length === 0 ? (
              <div className="text-zinc-700 text-center py-4">No logs yet. Click INJECT to start.</div>
            ) : (
              logs.slice().reverse().map((l, i) => (
                <div key={i} className="leading-tight hover:bg-zinc-900/50 rounded px-1">
                  <span className="text-zinc-700">{new Date(l.ts).toLocaleTimeString().slice(0, 8)}</span>{' '}
                  <span className={cn('font-bold',
                    l.level === 'error' ? 'text-rose-400' :
                    l.level === 'warn' ? 'text-amber-400' :
                    l.level === 'success' ? 'text-emerald-400' : 'text-cyan-400')}>
                    [{l.level.toUpperCase()}]
                  </span>{' '}
                  <span className="text-zinc-400">{l.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {message && (
          <div className={cn('rounded-md px-3 py-2 text-xs border',
            message.startsWith('Error') || message.startsWith('❌') ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' :
            message.startsWith('⚠️') ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-300')}>
            {message}
          </div>
        )}
      </div>
    </div>
  )
}
