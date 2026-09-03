'use client'

import { useState, useEffect, useCallback } from 'react'
import { FsEntry, fsList, fsRead, fsWrite, fsDelete, basename } from '@/lib/fs-client'
import { Plus, Trash2, RefreshCw, Save, FileText } from 'lucide-react'
import { formatBytes, formatDate } from '@/lib/fs-client'
import { cn } from '@/lib/utils'
import { FILE_DRAG_MIME } from '@/components/desktop/file-icon'

const NOTES_DIR = '/Documents'

export function NotesApp() {
  const [notes, setNotes] = useState<FsEntry[]>([])
  const [active, setActive] = useState<FsEntry | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const list = await fsList(NOTES_DIR)
      // Only show files (not directories)
      const filtered = list.filter((e) => !e.isDir)
      setNotes(filtered)
      if (filtered.length > 0 && !active) {
        setActive(filtered[0])
        const c = await fsRead(filtered[0].path)
        setContent(c)
        setDirty(false)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [active])

  useEffect(() => { refresh() }, [refresh])

  async function selectNote(n: FsEntry) {
    if (dirty && active) {
      if (!confirm('Discard unsaved changes?')) return
    }
    setActive(n)
    try {
      const c = await fsRead(n.path)
      setContent(c)
      setDirty(false)
    } catch (e) {
      setContent(`// Failed to load: ${(e as Error).message}`)
    }
  }

  async function save() {
    if (!active) return
    try {
      await fsWrite(active.path, content)
      setDirty(false)
      refresh()
    } catch (e) {
      alert(`Save failed: ${(e as Error).message}`)
    }
  }

  async function createNote() {
    const name = newName.trim()
    if (!name) return
    const path = `${NOTES_DIR}/${name.includes('.') ? name : name + '.txt'}`.replace(/\/+/g, '/')
    try {
      await fsWrite(path, '')
      setNewName('')
      setCreating(false)
      await refresh()
      // Select the new one
      const list = await fsList(NOTES_DIR)
      const created = list.find((e) => e.path === path)
      if (created) {
        setActive(created)
        setContent('')
        setDirty(false)
      }
    } catch (e) {
      alert(`Create failed: ${(e as Error).message}`)
    }
  }

  async function deleteNote(n: FsEntry) {
    if (!confirm(`Delete "${n.name}"?`)) return
    try {
      await fsDelete(n.path)
      if (active?.path === n.path) {
        setActive(null)
        setContent('')
      }
      refresh()
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`)
    }
  }

  function onContentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value)
    setDirty(true)
  }

  // Ctrl+S to save
  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      save()
    }
  }

  return (
    <div
      className="flex h-full w-full bg-background"
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(FILE_DRAG_MIME) || e.dataTransfer.types.includes('text/plain')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={async (e) => {
        e.preventDefault()
        const path = e.dataTransfer.getData(FILE_DRAG_MIME) || e.dataTransfer.getData('text/plain')
        if (!path) return
        try {
          const content = await fsRead(path)
          const entry: FsEntry = {
            name: basename(path),
            path,
            isDir: false,
            size: content.length,
            modified: Date.now(),
            ext: path.split('.').pop() ?? '',
          }
          setActive(entry)
          setContent(content)
          setDirty(false)
        } catch (err) {
          alert(`Open failed: ${(err as Error).message}`)
        }
      }}
    >
      {/* Sidebar */}
      <aside className="w-56 sm:w-64 shrink-0 border-r border-border/60 flex flex-col bg-muted/20">
        <div className="flex items-center justify-between gap-2 p-2 border-b border-border/40">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Notes</span>
          <div className="flex gap-0.5">
            <button
              onClick={() => setCreating((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-foreground/10"
              title="New note"
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
                if (e.key === 'Enter') createNote()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              placeholder="note-name.txt"
              className="w-full rounded border border-emerald-500/60 bg-background px-2 py-1 text-xs outline-none"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-3 text-xs text-muted-foreground">Loading…</div>
          ) : notes.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No notes yet. Click + to create one.</div>
          ) : (
            notes.map((n) => (
              <div
                key={n.path}
                onClick={() => selectNote(n)}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 cursor-pointer border-l-2 transition',
                  active?.path === n.path
                    ? 'bg-emerald-500/10 border-emerald-500'
                    : 'border-transparent hover:bg-foreground/5'
                )}
              >
                <FileText className={cn('h-4 w-4 shrink-0', active?.path === n.path ? 'text-emerald-500' : 'text-muted-foreground')} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{n.name}</div>
                  <div className="text-[10px] text-muted-foreground">{formatBytes(n.size)} · {formatDate(n.modified).split(',')[0]}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteNote(n) }}
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
      <main className="flex-1 flex flex-col">
        {active ? (
          <>
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/40 bg-muted/10">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="text-sm font-medium truncate">{active.name}</span>
                {dirty && <span className="text-xs text-amber-500">● unsaved</span>}
              </div>
              <button
                onClick={save}
                disabled={!dirty}
                className="flex h-7 items-center gap-1.5 rounded-md px-3 text-xs bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </button>
            </div>
            <textarea
              value={content}
              onChange={onContentChange}
              spellCheck={false}
              className="flex-1 w-full resize-none bg-background p-4 font-mono text-sm outline-none leading-relaxed"
              placeholder="Start typing… (Ctrl+S to save)"
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Select a note or create a new one</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
