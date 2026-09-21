'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Save, Check, Loader2, StickyNote } from 'lucide-react'

/**
 * Notes app — a simple notepad that auto-saves to the server (SQLite via
 * Prisma). The AI assistant reads this note every agentic loop, so users
 * can write bug reports / requests here and the assistant will act on them.
 */
export function NotesApp() {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Load the note on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/notes', { cache: 'no-store' })
        if (r.ok) {
          const d = await r.json()
          if (cancelled) return
          setContent(d.content || '')
          setSavedContent(d.content || '')
          setUpdatedAt(d.updatedAt || null)
        }
      } catch {}
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  const save = useCallback(async (text: string) => {
    setSaving(true)
    try {
      const r = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      })
      if (r.ok) {
        const d = await r.json()
        setSavedContent(text)
        setUpdatedAt(d.updatedAt || null)
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1200)
      }
    } catch {}
    finally { setSaving(false) }
  }, [])

  // Auto-save with debounce (1.2s after last keystroke)
  const onChange = (val: string) => {
    setContent(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (val !== savedContent) save(val)
    }, 1200)
  }

  const dirty = content !== savedContent

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-950 text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-foreground">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-zinc-900/60 shrink-0">
        <StickyNote className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-semibold">Notes</span>
        <span className="text-[10px] text-zinc-500">auto-saves · the AI assistant reads this every turn</span>
        <div className="ml-auto flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
          {savedFlash && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
          {dirty && !saving && <span className="text-[10px] text-amber-400">unsaved…</span>}
          {!dirty && !savedFlash && updatedAt && (
            <span className="text-[10px] text-zinc-600">
              {new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => save(content)}
            disabled={!dirty || saving}
            className="flex items-center gap-1 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white px-2 py-1 text-[10px] font-bold transition"
          >
            <Save className="h-3 w-3" />
            Save
          </button>
        </div>
      </div>

      {/* Editor */}
      <textarea
        ref={taRef}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          "Write anything here — notes, ideas, bug reports for the AI assistant…\n\n" +
          "The assistant reads this note every turn and will act on any bugs or requests you write here.\n\n" +
          "e.g. \"Bug: the terminal disconnects when I type fast\" or \"Please make the search box bigger\""
        }
        className="flex-1 w-full resize-none bg-transparent p-4 text-sm font-mono outline-none placeholder:text-zinc-700 leading-relaxed"
        spellCheck={false}
      />
    </div>
  )
}
