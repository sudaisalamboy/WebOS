'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, RefreshCw, Save, FileText, Lock, AlertTriangle, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EncFile {
  name: string
  ciphertextSize: number
  modified: number
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString()
}

export function EncryptedNotesApp() {
  const [files, setFiles] = useState<EncFile[]>([])
  const [active, setActive] = useState<EncFile | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/enc/list', { cache: 'no-store' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setFiles(data.files ?? [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function openFile(f: EncFile) {
    setError(null)
    setInfo(null)
    try {
      const res = await fetch(`/api/enc/read?name=${encodeURIComponent(f.name)}`, { cache: 'no-store' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setActive(f)
      setContent(data.content)
      setOriginal(data.content)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function save() {
    if (!active) return
    if (content === original) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/enc/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: active.name, content }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setOriginal(content)
      setInfo('Saved & encrypted')
      setTimeout(() => setInfo(null), 1500)
      await refresh()
      // Re-fetch the updated metadata for the active file
      const updated = (await fetch('/api/enc/list', { cache: 'no-store' }).then((r) => r.json())).files?.find(
        (f: EncFile) => f.name === active.name
      )
      if (updated) setActive(updated)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function createFile() {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/enc/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: '' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setNewName('')
      setCreating(false)
      await refresh()
      // Open the new file
      const newFile = (await fetch('/api/enc/list', { cache: 'no-store' }).then((r) => r.json())).files?.find(
        (f: EncFile) => f.name === name
      )
      if (newFile) await openFile(newFile)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteFile(f: EncFile) {
    if (!confirm(`Delete "${f.name}"? The ciphertext will be permanently removed.`)) return
    setError(null)
    try {
      const res = await fetch('/api/enc/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      if (active?.name === f.name) {
        setActive(null)
        setContent('')
        setOriginal('')
      }
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const dirty = content !== original

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      save()
    }
  }

  return (
    <div className="flex h-full w-full bg-background" onKeyDown={onKeyDown}>
      {/* Sidebar */}
      <aside className="w-56 sm:w-64 shrink-0 border-r border-border/60 flex flex-col bg-muted/20">
        <div className="flex items-center justify-between gap-2 p-2 border-b border-border/40">
          <div className="flex items-center gap-1.5 px-1">
            <Shield className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Encrypted
            </span>
          </div>
          <div className="flex gap-0.5">
            <button
              onClick={() => setCreating((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-foreground/10"
              title="New encrypted file"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={refresh}
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-foreground/10"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {creating && (
          <div className="p-2 border-b border-border/40 bg-emerald-500/5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFile()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              placeholder="new-file.txt"
              className="w-full rounded border border-emerald-500/60 bg-background px-2 py-1 text-xs outline-none"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-3 text-xs text-muted-foreground">Loading…</div>
          ) : files.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">
              No encrypted files. Click + to create one.
            </div>
          ) : (
            files.map((f) => (
              <div
                key={f.name}
                onClick={() => openFile(f)}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 cursor-pointer border-l-2 transition',
                  active?.name === f.name
                    ? 'bg-emerald-500/10 border-emerald-500'
                    : 'border-transparent hover:bg-foreground/5'
                )}
              >
                <Lock className={cn('h-3.5 w-3.5 shrink-0', active?.name === f.name ? 'text-emerald-500' : 'text-muted-foreground')} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{f.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatSize(f.ciphertextSize)} · {formatDate(f.modified).split(',')[0]}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteFile(f) }}
                  className="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded hover:bg-rose-500 hover:text-white transition"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Editor */}
      <main className="flex-1 flex flex-col min-w-0">
        {active ? (
          <>
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/40 bg-muted/10">
              <div className="flex items-center gap-2 min-w-0">
                <Lock className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="text-sm font-medium truncate">{active.name}</span>
                {dirty && <span className="text-xs text-amber-500">● unsaved</span>}
              </div>
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="flex h-7 items-center gap-1.5 rounded-md px-3 text-xs bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </button>
            </div>
            {info && (
              <div className="px-3 py-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs border-b border-emerald-500/20">
                {info}
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/15 text-rose-500 text-xs border-b border-rose-500/20">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">×</button>
              </div>
            )}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              autoFocus
              placeholder="Type here… (Ctrl+S to save. Content is encrypted with AES-256-GCM before being written to disk.)"
              className="flex-1 w-full resize-none bg-background p-4 font-mono text-sm outline-none leading-relaxed"
            />
            <div className="flex items-center justify-between px-3 py-1 border-t border-border/40 bg-muted/20 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Shield className="h-3 w-3 text-emerald-500" />
                AES-256-GCM encrypted at rest · key in-memory only
              </span>
              <span>{content.length} chars plaintext · {active.ciphertextSize} bytes ciphertext on disk</span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            <div className="text-center max-w-md">
              <Lock className="h-12 w-12 mx-auto mb-3 text-emerald-500/50" />
              <h3 className="font-semibold text-foreground mb-1">Encrypted Storage</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Files here are encrypted with AES-256-GCM. The encryption key is derived
                from your password (PBKDF2, 600k iterations) and kept in-memory only
                while you're logged in.
              </p>
              <p className="text-xs text-muted-foreground">
                On disk: only ciphertext. Even a server admin can only see file names + sizes,
                <strong className="text-foreground"> never the plaintext content</strong>.
              </p>
              <p className="text-[11px] text-muted-foreground mt-3">
                Select a file from the sidebar, or click + to create a new one.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
