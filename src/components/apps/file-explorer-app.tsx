'use client'

import { useState, useEffect, useCallback } from 'react'
import { FsEntry, fsList, fsRead, fsWrite, fsMkdir, fsDelete, fsRename, fsCopy, fsMove, dirname, basename, changeExtension, extname, formatBytes, formatDate } from '@/lib/fs-client'
import { useDesktopStore } from '@/lib/desktop-store'
import { FILE_DRAG_MIME } from '@/components/desktop/file-icon'
import { cn } from '@/lib/utils'
import {
  Folder, FileText, FileCode, FileJson, FileImage, FileMusic, File,
  ChevronRight, ArrowLeft, ArrowRight, ArrowUp, RefreshCw, Plus, FolderPlus,
  Trash2, Pencil, Scissors, Copy, ClipboardPaste, Edit3, Home,
} from 'lucide-react'

const QUICK_LINKS = [
  { name: 'Home', path: '/' },
  { name: 'Desktop', path: '/Desktop' },
  { name: 'Documents', path: '/Documents' },
  { name: 'Pictures', path: '/Pictures' },
  { name: 'Downloads', path: '/Downloads' },
  { name: 'Music', path: '/Music' },
]

const ICON_MAP: Record<string, typeof File> = {
  txt: FileText, md: FileText, log: FileText,
  js: FileCode, ts: FileCode, tsx: FileCode, jsx: FileCode, py: FileCode, sh: FileCode,
  json: FileJson,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage, svg: FileImage,
  mp3: FileMusic, wav: FileMusic,
}

function iconFor(entry: FsEntry) {
  if (entry.isDir) return Folder
  return ICON_MAP[entry.ext] ?? File
}

interface Props {
  initialPath?: string
}

export function FileExplorerApp({ initialPath = '/' }: Props) {
  const [path, setPath] = useState(initialPath)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [history, setHistory] = useState<string[]>([initialPath])
  const [historyIdx, setHistoryIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [editingExt, setEditingExt] = useState<string | null>(null)
  const [extVal, setExtVal] = useState('')
  const [creating, setCreating] = useState<null | 'file' | 'folder'>(null)
  const [createVal, setCreateVal] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null)
  const { clipboard, setClipboard, openApp } = useDesktopStore()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fsList(path)
      setEntries(list)
    } catch (e) {
      setError((e as Error).message)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => { refresh() }, [refresh])

  function navigate(to: string) {
    if (to === path) return
    const newHistory = [...history.slice(0, historyIdx + 1), to]
    setHistory(newHistory)
    setHistoryIdx(newHistory.length - 1)
    setPath(to)
    setSelected(null)
  }

  function back() {
    if (historyIdx === 0) return
    const newIdx = historyIdx - 1
    setHistoryIdx(newIdx)
    setPath(history[newIdx])
    setSelected(null)
  }
  function forward() {
    if (historyIdx === history.length - 1) return
    const newIdx = historyIdx + 1
    setHistoryIdx(newIdx)
    setPath(history[newIdx])
    setSelected(null)
  }
  function up() {
    if (path === '/') return
    navigate(dirname(path))
  }

  function openEntry(entry: FsEntry) {
    if (entry.isDir) {
      navigate(entry.path)
    } else {
      openApp('text-editor', { payload: { path: entry.path }, title: `Edit · ${entry.name}` })
    }
  }

  async function doRename(entry: FsEntry) {
    const trimmed = renameVal.trim()
    if (!trimmed || trimmed === entry.name) {
      setRenaming(null)
      return
    }
    try {
      const target = `${dirname(entry.path)}/${trimmed}`.replace(/\/+/g, '/')
      await fsRename(entry.path, target)
      refresh()
    } catch (e) {
      alert(`Rename failed: ${(e as Error).message}`)
    }
    setRenaming(null)
  }

  async function doEditExt(entry: FsEntry) {
    const cleanExt = extVal.replace(/^\./, '').trim()
    const target = changeExtension(entry.path, cleanExt)
    if (target === entry.path) {
      setEditingExt(null)
      return
    }
    try {
      await fsRename(entry.path, target)
      refresh()
    } catch (e) {
      alert(`Extension change failed: ${(e as Error).message}`)
    }
    setEditingExt(null)
  }

  async function doDelete(entry: FsEntry) {
    if (!confirm(`Delete "${entry.name}"?`)) return
    try {
      await fsDelete(entry.path)
      refresh()
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`)
    }
  }

  async function doCopy(entry: FsEntry) {
    setClipboard({ op: 'copy', path: entry.path })
  }
  async function doCut(entry: FsEntry) {
    setClipboard({ op: 'cut', path: entry.path })
  }
  async function doPaste() {
    if (!clipboard) return
    const srcName = basename(clipboard.path)
    const dest = `${path}/${srcName}`.replace(/\/+/g, '/')
    try {
      if (clipboard.op === 'copy') {
        await fsCopy(clipboard.path, dest)
      } else {
        await fsMove(clipboard.path, dest)
        setClipboard(null)
      }
      refresh()
    } catch (e) {
      alert(`Paste failed: ${(e as Error).message}`)
    }
  }

  async function doCreate() {
    const name = createVal.trim()
    if (!name) { setCreating(null); return }
    const fullPath = `${path}/${name}`.replace(/\/+/g, '/')
    try {
      if (creating === 'folder') {
        await fsMkdir(fullPath)
      } else {
        await fsWrite(fullPath, '')
      }
      setCreating(null)
      setCreateVal('')
      refresh()
    } catch (e) {
      alert(`Create failed: ${(e as Error).message}`)
    }
  }

  const breadcrumbs = path === '/' ? [''] : path.split('/').filter(Boolean)

  return (
    <div className="flex h-full w-full bg-background">
      {/* Sidebar */}
      <aside className="w-44 sm:w-52 shrink-0 border-r border-border/60 flex flex-col bg-muted/20">
        <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/40">
          Quick Access
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {QUICK_LINKS.map((q) => (
            <button
              key={q.path}
              onClick={() => navigate(q.path)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition',
                path === q.path ? 'bg-emerald-500/15 text-foreground' : 'hover:bg-foreground/5 text-foreground/80'
              )}
            >
              <Home className="h-4 w-4 text-emerald-500" />
              <span className="truncate">{q.name}</span>
            </button>
          ))}
        </div>
        {clipboard && (
          <div className="border-t border-border/40 p-2">
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Clipboard
            </div>
            <div className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs">
              <span className="text-amber-500">{clipboard.op === 'copy' ? 'Copy' : 'Cut'}</span>
              <span className="truncate flex-1">{basename(clipboard.path)}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/60 bg-muted/20">
          <button onClick={back} disabled={historyIdx === 0} className="flex h-7 w-7 items-center justify-center rounded hover:bg-foreground/10 disabled:opacity-30 disabled:cursor-not-allowed">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button onClick={forward} disabled={historyIdx === history.length - 1} className="flex h-7 w-7 items-center justify-center rounded hover:bg-foreground/10 disabled:opacity-30 disabled:cursor-not-allowed">
            <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={up} disabled={path === '/'} className="flex h-7 w-7 items-center justify-center rounded hover:bg-foreground/10 disabled:opacity-30 disabled:cursor-not-allowed">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button onClick={refresh} className="flex h-7 w-7 items-center justify-center rounded hover:bg-foreground/10">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <div className="h-5 w-px bg-border/60 mx-1" />
          <button onClick={() => setCreating('folder')} className="flex h-7 items-center gap-1.5 rounded px-2 text-xs hover:bg-foreground/10">
            <FolderPlus className="h-3.5 w-3.5" /> Folder
          </button>
          <button onClick={() => setCreating('file')} className="flex h-7 items-center gap-1.5 rounded px-2 text-xs hover:bg-foreground/10">
            <Plus className="h-3.5 w-3.5" /> File
          </button>
          <div className="h-5 w-px bg-border/60 mx-1" />
          {clipboard && (
            <button onClick={doPaste} className="flex h-7 items-center gap-1.5 rounded px-2 text-xs bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25">
              <ClipboardPaste className="h-3.5 w-3.5" /> Paste
            </button>
          )}
          {selected && !renaming && !editingExt && (
            <>
              <button
                onClick={() => {
                  const e = entries.find((x) => x.path === selected)
                  if (e) { setRenaming(e.path); setRenameVal(e.name) }
                }}
                className="flex h-7 items-center gap-1.5 rounded px-2 text-xs hover:bg-foreground/10"
              >
                <Pencil className="h-3.5 w-3.5" /> Rename
              </button>
              <button
                onClick={() => {
                  const e = entries.find((x) => x.path === selected)
                  if (e && !e.isDir) { setEditingExt(e.path); setExtVal(extname(e.name)) }
                }}
                className="flex h-7 items-center gap-1.5 rounded px-2 text-xs hover:bg-foreground/10"
              >
                <Edit3 className="h-3.5 w-3.5" /> Ext
              </button>
              <button
                onClick={() => {
                  const e = entries.find((x) => x.path === selected)
                  if (e) doCopy(e)
                }}
                className="flex h-7 items-center gap-1.5 rounded px-2 text-xs hover:bg-foreground/10"
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
              <button
                onClick={() => {
                  const e = entries.find((x) => x.path === selected)
                  if (e) doCut(e)
                }}
                className="flex h-7 items-center gap-1.5 rounded px-2 text-xs hover:bg-foreground/10"
              >
                <Scissors className="h-3.5 w-3.5" /> Cut
              </button>
              <button
                onClick={() => {
                  const e = entries.find((x) => x.path === selected)
                  if (e) doDelete(e)
                }}
                className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-rose-500 hover:bg-rose-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </>
          )}
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/40 text-xs text-muted-foreground overflow-x-auto">
          <button onClick={() => navigate('/')} className="hover:text-foreground">/</button>
          {breadcrumbs.map((b, i) => {
            const p = '/' + breadcrumbs.slice(0, i + 1).join('/')
            return (
              <span key={p} className="flex items-center gap-1 shrink-0">
                <ChevronRight className="h-3 w-3" />
                <button onClick={() => navigate(p)} className="hover:text-foreground">{b}</button>
              </span>
            )
          })}
        </div>

        {/* File grid */}
        <div
          className={cn(
            'relative flex-1 overflow-y-auto p-3 transition-colors',
            dragOver && 'bg-emerald-500/10 ring-2 ring-inset ring-emerald-500/40'
          )}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(FILE_DRAG_MIME) || e.dataTransfer.types.includes('text/plain')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDragOver(true)
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragOver(false)
          }}
          onDrop={async (e) => {
            e.preventDefault()
            setDragOver(false)
            const srcPath = e.dataTransfer.getData(FILE_DRAG_MIME) || e.dataTransfer.getData('text/plain')
            if (!srcPath) return
            const srcName = basename(srcPath)
            // Don't allow dropping a path into itself or moving current dir into a descendant
            if (srcPath === path || path.startsWith(srcPath + '/')) {
              alert("Can't move a folder into itself or its descendant.")
              return
            }
            const dest = `${path}/${srcName}`.replace(/\/+/g, '/')
            // If source is already at destination, no-op
            if (srcPath === dest) return
            try {
              await fsMove(srcPath, dest)
              refresh()
            } catch (err) {
              alert(`Move failed: ${(err as Error).message}`)
            }
          }}
        >
          {dragOver && (
            <div className="absolute inset-2 z-30 flex items-center justify-center pointer-events-none rounded-lg border-2 border-dashed border-emerald-500/60 bg-emerald-500/10 backdrop-blur-sm">
              <div className="text-center">
                <div className="text-3xl mb-1">📥</div>
                <div className="text-emerald-300 font-medium">Drop to move into {path}</div>
              </div>
            </div>
          )}
          {creating && (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2">
              {creating === 'folder' ? <FolderPlus className="h-4 w-4 text-emerald-500" /> : <Plus className="h-4 w-4 text-emerald-500" />}
              <input
                autoFocus
                value={createVal}
                onChange={(e) => setCreateVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doCreate()
                  if (e.key === 'Escape') { setCreating(null); setCreateVal('') }
                }}
                placeholder={creating === 'folder' ? 'folder-name' : 'file-name.ext'}
                className="flex-1 bg-transparent text-sm outline-none"
              />
            </div>
          )}

          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="text-sm text-rose-500">{error}</div>
          ) : entries.length === 0 ? (
            <div className="text-sm text-muted-foreground">This folder is empty.</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
              {entries.map((entry) => {
                const Icon = iconFor(entry) as React.ComponentType<{ className?: string }>
                const isSelected = selected === entry.path
                const isDragTarget = dragTargetPath === entry.path && entry.isDir
                return (
                  <div
                    key={entry.path}
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation()
                      e.dataTransfer.setData(FILE_DRAG_MIME, entry.path)
                      e.dataTransfer.setData('text/plain', entry.path)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      if (!entry.isDir) return
                      e.preventDefault()
                      e.stopPropagation()
                      e.dataTransfer.dropEffect = 'move'
                      setDragTargetPath(entry.path)
                    }}
                    onDragLeave={() => {
                      if (dragTargetPath === entry.path) setDragTargetPath(null)
                    }}
                    onDrop={async (e) => {
                      if (!entry.isDir) return
                      e.preventDefault()
                      e.stopPropagation()
                      setDragTargetPath(null)
                      const srcPath = e.dataTransfer.getData(FILE_DRAG_MIME) || e.dataTransfer.getData('text/plain')
                      if (!srcPath || srcPath === entry.path) return
                      if (entry.path.startsWith(srcPath + '/')) {
                        alert("Can't move a folder into its descendant.")
                        return
                      }
                      const srcName = basename(srcPath)
                      const dest = `${entry.path}/${srcName}`.replace(/\/+/g, '/')
                      if (srcPath === dest) return
                      try {
                        await fsMove(srcPath, dest)
                        refresh()
                      } catch (err) {
                        alert(`Move failed: ${(err as Error).message}`)
                      }
                    }}
                    onClick={() => setSelected(entry.path)}
                    onDoubleClick={() => openEntry(entry)}
                    className={cn(
                      'group flex flex-col items-center gap-1 rounded-lg p-2 cursor-pointer transition',
                      isSelected ? 'bg-emerald-500/15 ring-1 ring-emerald-500/40' : 'hover:bg-foreground/5',
                      isDragTarget && 'bg-emerald-500/25 ring-2 ring-emerald-500 scale-105'
                    )}
                  >
                    <Icon className={cn('h-10 w-10', entry.isDir ? 'text-amber-500' : 'text-sky-500')} />
                    {renaming === entry.path ? (
                      <input
                        autoFocus
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onBlur={() => doRename(entry)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') doRename(entry)
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded border border-emerald-500 bg-background px-1 py-0.5 text-center text-xs"
                      />
                    ) : editingExt === entry.path ? (
                      <input
                        autoFocus
                        value={extVal}
                        onChange={(e) => setExtVal(e.target.value)}
                        onBlur={() => doEditExt(entry)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') doEditExt(entry)
                          if (e.key === 'Escape') setEditingExt(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="ext"
                        className="w-full rounded border border-emerald-500 bg-background px-1 py-0.5 text-center text-xs"
                      />
                    ) : (
                      <div className="text-center w-full">
                        <div className="text-xs truncate w-full" title={entry.name}>{entry.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {entry.isDir ? 'Folder' : formatBytes(entry.size)}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between px-3 py-1 border-t border-border/40 bg-muted/20 text-[11px] text-muted-foreground">
          <span>{entries.length} item{entries.length === 1 ? '' : 's'}</span>
          {selected && (
            <span className="text-foreground/70">
              {(() => {
                const e = entries.find((x) => x.path === selected)
                return e ? `${e.isDir ? 'Folder' : 'File'} · ${formatBytes(e.size)} · ${formatDate(e.modified)}` : ''
              })()}
            </span>
          )}
        </div>
      </main>
    </div>
  )
}
