'use client'

import { useState, useEffect, useCallback } from 'react'
import { Camera, Trash2, RefreshCw, Download, Globe, AlertTriangle, CheckCircle2, Image as ImageIcon, Clock, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Screenshot {
  name: string
  path: string
  size: number
  modified: number
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString()
}

export function ScreenshotApp() {
  const [url, setUrl] = useState('')
  const [fullPage, setFullPage] = useState(false)
  const [dark, setDark] = useState(false)
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1080)
  const [capturing, setCapturing] = useState(false)
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/screenshot/list', { cache: 'no-store' })
      const data = await res.json()
      setScreenshots(data.screenshots ?? [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function capture() {
    if (!url.trim()) {
      setError('Enter a URL')
      return
    }
    setCapturing(true)
    setError(null)
    setInfo(null)
    try {
      const res = await fetch('/api/screenshot/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, fullPage, dark, width, height }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setInfo(`Screenshot saved: ${data.filename} (${formatSize(data.size)})`)
      setUrl('')
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCapturing(false)
    }
  }

  async function deleteShot(name: string) {
    if (!confirm(`Delete "${name}"?`)) return
    try {
      await fetch('/api/fs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `/Pictures/${name}` }),
      })
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="border-b border-cyan-500/20 px-5 py-3 bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/15 ring-1 ring-cyan-500/30">
            <Camera className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Screenshot Capture</h1>
            <p className="text-xs text-zinc-400">Enter any website URL → get a screenshot saved to Pictures</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Capture form */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 block">
              Website URL
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && capture()}
                  placeholder="example.com or https://example.com"
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-700 pl-10 pr-3 py-2.5 text-sm outline-none focus:border-cyan-500/60"
                />
              </div>
              <button
                onClick={capture}
                disabled={capturing}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 text-white font-medium px-5 py-2.5 text-sm transition"
              >
                {capturing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                {capturing ? 'Capturing...' : 'Capture'}
              </button>
            </div>
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] uppercase text-zinc-500 mb-1 block">Width</label>
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value) || 1920)}
                className="w-full rounded-md bg-zinc-950 border border-zinc-700 px-2 py-1.5 text-xs outline-none focus:border-cyan-500/60"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-zinc-500 mb-1 block">Height</label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(parseInt(e.target.value) || 1080)}
                className="w-full rounded-md bg-zinc-950 border border-zinc-700 px-2 py-1.5 text-xs outline-none focus:border-cyan-500/60"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-zinc-500 mb-1 block">Full Page</label>
              <button
                onClick={() => setFullPage(v => !v)}
                className={cn(
                  'w-full rounded-md px-2 py-1.5 text-xs font-medium transition',
                  fullPage ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40' : 'bg-zinc-800 text-zinc-400'
                )}
              >
                {fullPage ? 'ON' : 'OFF'}
              </button>
            </div>
            <div>
              <label className="text-[10px] uppercase text-zinc-500 mb-1 block">Dark Mode</label>
              <button
                onClick={() => setDark(v => !v)}
                className={cn(
                  'w-full rounded-md px-2 py-1.5 text-xs font-medium transition',
                  dark ? 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40' : 'bg-zinc-800 text-zinc-400'
                )}
              >
                {dark ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-rose-500/15 text-rose-300 px-3 py-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">×</button>
          </div>
        )}
        {info && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/15 text-emerald-300 px-3 py-2 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{info}</span>
          </div>
        )}

        {/* Screenshots gallery */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Saved Screenshots ({screenshots.length})
            </h2>
            <button
              onClick={refresh}
              className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-xs"
            >
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="text-center text-xs text-zinc-500 py-8">Loading...</div>
          ) : screenshots.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-700 px-4 py-12 text-center">
              <ImageIcon className="h-10 w-10 mx-auto mb-2 text-zinc-700" />
              <p className="text-xs text-zinc-500">No screenshots yet. Enter a URL above and click Capture.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {screenshots.map((s) => (
                <div key={s.name} className="rounded-lg border border-zinc-800 bg-zinc-900/60 overflow-hidden group">
                  <div className="relative">
                    <img
                      src={`/api/fs/read?path=${encodeURIComponent(s.path)}`}
                      alt={s.name}
                      className="w-full h-40 object-cover object-top"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <a
                        href={`/api/fs/read?path=${encodeURIComponent(s.path)}`}
                        download={s.name}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500 text-white hover:bg-cyan-400 transition"
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => deleteShot(s.name)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500 text-white hover:bg-rose-400 transition"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="p-2.5">
                    <div className="text-xs font-medium truncate">{s.name}</div>
                    <div className="text-[10px] text-zinc-500 flex items-center gap-2 mt-0.5">
                      <span>{formatSize(s.size)}</span>
                      <span>·</span>
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDate(s.modified).split(',')[0]}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
