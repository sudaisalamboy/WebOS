'use client'

import { useState, useEffect, useCallback } from 'react'
import { Upload, Download, Globe, Copy, Trash2, RefreshCw, FolderOpen, FileText, Check, AlertTriangle, ExternalLink, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FsEntry, fsList, basename, dirname, formatBytes } from '@/lib/fs-client'

interface Share {
  id: string
  mode: 'share' | 'receive' | 'website'
  files: string[]
  onionUrl: string | null
  privateKey: string | null
  status: 'starting' | 'running' | 'stopped' | 'error'
  startedAt: number
  pid: number | null
  outputLog: string[]
}

type Tab = 'share' | 'receive' | 'website'

export function OnionShareApp() {
  const [tab, setTab] = useState<Tab>('share')
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [filePickerPath, setFilePickerPath] = useState('/')

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/onionshare/list', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setShares(data.shares ?? [])
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 3000)  // poll every 3s for URL changes
    return () => clearInterval(id)
  }, [refresh])

  async function createShare() {
    setError(null)
    if (tab !== 'receive' && selectedFiles.length === 0) {
      setError('Select at least one file to share')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/onionshare/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: tab,
          files: selectedFiles.map((p) => `/home/z/my-project/user-files${p}`),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create share')
      } else {
        setSelectedFiles([])
        await refresh()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function stopShare(id: string) {
    if (!confirm('Stop this share? The .onion URL will stop working.')) return
    try {
      await fetch('/api/onionshare/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function copyUrl(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      setError('Failed to copy to clipboard')
    }
  }

  // File picker helpers
  const [pickerEntries, setPickerEntries] = useState<FsEntry[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)

  async function openPicker() {
    setFilePickerOpen(true)
    setFilePickerPath('/')
    await loadPickerDir('/')
  }

  async function loadPickerDir(p: string) {
    setPickerLoading(true)
    try {
      const list = await fsList(p)
      setPickerEntries(list)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPickerLoading(false)
    }
  }

  function pickerNavigate(p: string) {
    setFilePickerPath(p)
    loadPickerDir(p)
  }

  function toggleSelectFile(path: string) {
    setSelectedFiles((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'share', label: 'Share Files', icon: <Upload className="h-4 w-4" />, desc: 'Let others download files from you' },
    { id: 'receive', label: 'Receive Files', icon: <Download className="h-4 w-4" />, desc: 'Let others upload files to you' },
    { id: 'website', label: 'Host Website', icon: <Globe className="h-4 w-4" />, desc: 'Host a static website on Tor' },
  ]

  return (
    <div className="flex h-full w-full flex-col bg-gradient-to-br from-zinc-950 via-zinc-900 to-violet-950/30 text-zinc-100">
      {/* Header */}
      <div className="border-b border-violet-500/20 px-5 py-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="text-3xl">🧄</div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">OnionShare</h1>
            <p className="text-xs text-zinc-400">Share files anonymously via Tor onion services</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Mode tabs */}
        <div>
          <div className="flex gap-1 p-1 bg-zinc-900/60 rounded-lg border border-zinc-800">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition',
                  tab === t.id
                    ? 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/40'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                )}
              >
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-2 text-center">{tabs.find((t) => t.id === tab)?.desc}</p>
        </div>

        {/* File picker / selection */}
        {tab !== 'receive' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Files to share ({selectedFiles.length})
              </label>
              <button
                onClick={openPicker}
                className="flex items-center gap-1.5 rounded-md bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30 px-2.5 py-1 text-xs hover:bg-violet-500/25"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse
              </button>
            </div>
            {selectedFiles.length === 0 ? (
              <div className="rounded-md border border-dashed border-zinc-700 px-4 py-6 text-center text-xs text-zinc-500">
                No files selected. Click "Browse" to pick files from your user-files.
              </div>
            ) : (
              <div className="space-y-1">
                {selectedFiles.map((f) => (
                  <div key={f} className="flex items-center gap-2 rounded-md bg-zinc-900/60 px-3 py-1.5 text-xs">
                    <FileText className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                    <span className="truncate flex-1">{f}</span>
                    <button
                      onClick={() => toggleSelectFile(f)}
                      className="text-zinc-500 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Create button */}
        <button
          onClick={createShare}
          disabled={creating || (tab !== 'receive' && selectedFiles.length === 0)}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 text-sm transition"
        >
          {creating ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Starting OnionShare (bootstrapping Tor)…
            </>
          ) : (
            <>
              <Globe className="h-4 w-4" />
              {tab === 'receive' ? 'Start Receive Mode' : tab === 'website' ? 'Start Hosting Website' : 'Start Sharing Files'}
            </>
          )}
        </button>
        <p className="text-[11px] text-zinc-500 text-center">
          First share takes 30–60s (Tor needs to bootstrap + publish the hidden service).
        </p>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-rose-500/15 text-rose-300 px-3 py-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">×</button>
          </div>
        )}

        {/* Active shares */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Active Shares</h2>
            <button
              onClick={refresh}
              className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-xs"
            >
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
          {shares.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-700 px-4 py-8 text-center text-xs text-zinc-500">
              No active shares. Create one above to get a .onion URL.
            </div>
          ) : (
            <div className="space-y-3">
              {shares.map((s) => (
                <ShareCard
                  key={s.id}
                  share={s}
                  onStop={() => stopShare(s.id)}
                  onCopyUrl={() => s.onionUrl && copyUrl(s.id, s.onionUrl)}
                  copied={copiedId === s.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Download bundle / install script */}
        <div className="mt-6 pt-4 border-t border-zinc-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
            Install OnionShare on another machine
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <a
              href="/api/onionshare/download?format=script"
              download="install-onionshare.sh"
              className="flex items-center gap-2 rounded-md bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 px-3 py-2 text-xs transition"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">Install Script</div>
                <div className="text-[10px] text-emerald-400/70">Bash installer (~2 KB)</div>
              </div>
            </a>
            <a
              href="/api/onionshare/download?format=tar"
              download="onionshare-bundle.tar.gz"
              className="flex items-center gap-2 rounded-md bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 px-3 py-2 text-xs transition"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">Full Bundle</div>
                <div className="text-[10px] text-emerald-400/70">tar.gz with venv + Tor (~200 MB)</div>
              </div>
            </a>
          </div>
        </div>
      </div>

      {/* File picker modal */}
      {filePickerOpen && (
        <div
          className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setFilePickerOpen(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-zinc-800">
              <div className="text-sm font-semibold">Select files to share</div>
              <button onClick={() => setFilePickerOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                ×
              </button>
            </div>
            <div className="flex items-center gap-1 px-3 py-2 text-xs border-b border-zinc-800 overflow-x-auto">
              <button onClick={() => pickerNavigate('/')} className="text-violet-400 hover:underline">/</button>
              {filePickerPath.split('/').filter(Boolean).map((seg, i, arr) => {
                const p = '/' + arr.slice(0, i + 1).join('/')
                return (
                  <span key={p} className="flex items-center gap-1 shrink-0">
                    <span className="text-zinc-600">/</span>
                    <button onClick={() => pickerNavigate(p)} className="text-zinc-300 hover:text-violet-300">{seg}</button>
                  </span>
                )
              })}
            </div>
            <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
              {pickerLoading ? (
                <div className="text-center text-xs text-zinc-500 py-4">Loading…</div>
              ) : (
                pickerEntries.map((e) => (
                  <button
                    key={e.path}
                    onClick={() => e.isDir ? pickerNavigate(e.path) : toggleSelectFile(e.path)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-zinc-800/50 transition',
                      !e.isDir && selectedFiles.includes(e.path) && 'bg-violet-500/15 ring-1 ring-violet-500/30'
                    )}
                  >
                    {e.isDir ? (
                      <FolderOpen className="h-4 w-4 text-amber-400 shrink-0" />
                    ) : (
                      <FileText className="h-4 w-4 text-sky-400 shrink-0" />
                    )}
                    <span className="truncate flex-1 text-left">{e.name}</span>
                    {!e.isDir && (
                      <span className="text-zinc-500 shrink-0">{formatBytes(e.size)}</span>
                    )}
                    {!e.isDir && selectedFiles.includes(e.path) && (
                      <Check className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
            <div className="flex items-center justify-between p-3 border-t border-zinc-800 text-xs">
              <span className="text-zinc-400">{selectedFiles.length} file(s) selected</span>
              <button
                onClick={() => setFilePickerOpen(false)}
                className="rounded bg-violet-500 hover:bg-violet-400 text-white px-3 py-1.5 font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ShareCard({
  share,
  onStop,
  onCopyUrl,
  copied,
}: {
  share: Share
  onStop: () => void
  onCopyUrl: () => void
  copied: boolean
}) {
  const uptime = Math.floor((Date.now() - share.startedAt) / 1000)
  const uptimeStr = uptime < 60 ? `${uptime}s` : `${Math.floor(uptime / 60)}m ${uptime % 60}s`

  return (
    <div className="rounded-lg border border-violet-500/20 bg-zinc-900/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className={cn(
            'h-2 w-2 rounded-full',
            share.status === 'running' ? 'bg-emerald-500 animate-pulse' : share.status === 'starting' ? 'bg-amber-500 animate-pulse' : 'bg-zinc-600'
          )} />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {share.mode}
          </span>
          <span className="text-[10px] text-zinc-500 flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {uptimeStr}
          </span>
        </div>
        <button
          onClick={onStop}
          className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 rounded transition"
        >
          <Trash2 className="h-3 w-3" />
          Stop
        </button>
      </div>

      <div className="p-3 space-y-2">
        {share.onionUrl ? (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Onion URL</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-emerald-400 bg-zinc-950/60 rounded px-2 py-1.5 truncate font-mono">
                {share.onionUrl}
              </code>
              <button
                onClick={onCopyUrl}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded shrink-0',
                  copied ? 'bg-emerald-500 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                )}
                title="Copy URL"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-zinc-500 mt-1">
              Open this URL in <strong className="text-zinc-300">Tor Browser</strong> to access the share.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>
              {share.status === 'starting'
                ? 'Starting Tor and publishing hidden service…'
                : share.status === 'error'
                ? 'Failed to start'
                : 'Working…'}
            </span>
          </div>
        )}

        {/* Files (for share/website modes) */}
        {share.files.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Files</div>
            <div className="space-y-0.5">
              {share.files.slice(0, 3).map((f) => {
                const name = basename(f.replace('/home/z/my-project/user-files', ''))
                return (
                  <div key={f} className="text-xs text-zinc-400 truncate flex items-center gap-1.5">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">{name}</span>
                  </div>
                )
              })}
              {share.files.length > 3 && (
                <div className="text-[10px] text-zinc-500">+ {share.files.length - 3} more</div>
              )}
            </div>
          </div>
        )}

        {/* Last log line (debug) */}
        {share.outputLog.length > 0 && share.status !== 'running' && (
          <details className="text-[10px] text-zinc-500">
            <summary className="cursor-pointer hover:text-zinc-400">Recent log ({share.outputLog.length} lines)</summary>
            <pre className="mt-1 max-h-32 overflow-y-auto bg-zinc-950/60 rounded p-2 font-mono">
              {share.outputLog.slice(-10).join('\n')}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
