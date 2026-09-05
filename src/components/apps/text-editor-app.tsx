'use client'

import { useState, useEffect, useCallback } from 'react'
import { fsRead, fsWrite, basename, dirname, extname } from '@/lib/fs-client'
import { FILE_DRAG_MIME } from '@/components/desktop/file-icon'
import { Save, FileText, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  path?: string
}

export function TextEditorApp({ path }: Props) {
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState(path ?? '')

  const load = useCallback(async () => {
    if (!currentPath) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const text = await fsRead(currentPath)
      setContent(text)
      setOriginal(text)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [currentPath])

  useEffect(() => { load() }, [load])
  useEffect(() => { setCurrentPath(path ?? '') }, [path])

  const dirty = content !== original

  async function save() {
    if (!dirty || !currentPath) return
    setSaving(true)
    try {
      await fsWrite(currentPath, content)
      setOriginal(content)
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      save()
    }
  }

  const ext = extname(currentPath)
  const lineCount = content.split('\n').length
  const charCount = content.length

  return (
    <div
      className="flex h-full w-full flex-col bg-background"
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
        setCurrentPath(path)
        // load() will fire via the useEffect when currentPath changes
        try {
          const text = await fsRead(path)
          setContent(text)
          setOriginal(text)
          setError(null)
        } catch (err) {
          setError((err as Error).message)
        }
      }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/40 bg-muted/10">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className={cn('h-4 w-4 shrink-0', ext ? 'text-emerald-500' : 'text-muted-foreground')} />
          <span className="text-sm font-medium truncate">
            {currentPath ? basename(currentPath) : 'Untitled'}
          </span>
          {dirty && <span className="text-xs text-amber-500">● unsaved</span>}
        </div>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="flex h-7 items-center gap-1.5 rounded-md px-3 text-xs bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 text-rose-500 text-xs border-b border-rose-500/20">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Path bar */}
      {currentPath && (
        <div className="px-3 py-1 text-[11px] text-muted-foreground border-b border-border/40 bg-muted/5">
          {currentPath}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          autoFocus
          placeholder="Type here… (Ctrl+S to save)"
          className="flex-1 w-full resize-none bg-background p-4 font-mono text-sm outline-none leading-relaxed"
        />
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-border/40 bg-muted/20 text-[11px] text-muted-foreground">
        <span>{ext ? `.${ext}` : 'plain'}</span>
        <span>{lineCount} lines · {charCount} chars</span>
      </div>
    </div>
  )
}
