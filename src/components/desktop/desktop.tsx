'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileIcon, FILE_DRAG_MIME } from './file-icon'
import { FsEntry, fsList, fsMove, basename } from '@/lib/fs-client'
import { useDesktopStore } from '@/lib/desktop-store'
import { cn } from '@/lib/utils'

const DESKTOP_PATH = '/Desktop'

export function Desktop() {
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const { setSelectedPath, clipboard, openApp } = useDesktopStore()

  const refresh = useCallback(async () => {
    try {
      const list = await fsList(DESKTOP_PATH)
      setEntries(list)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  }, [refresh])

  function onDesktopClick() {
    setSelectedPath(null)
  }

  // Drag-and-drop: drop a file from anywhere → move to /Desktop
  function onDragOver(e: React.DragEvent) {
    // Only highlight if a file is being dragged (has our MIME type or text/plain)
    if (e.dataTransfer.types.includes(FILE_DRAG_MIME) || e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOver(true)
    }
  }

  function onDragLeave(e: React.DragEvent) {
    // Only clear when leaving the desktop container itself, not when entering a child
    if (e.currentTarget === e.target) {
      setDragOver(false)
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const srcPath = e.dataTransfer.getData(FILE_DRAG_MIME) || e.dataTransfer.getData('text/plain')
    if (!srcPath) return
    const srcName = basename(srcPath)
    // If file is already in /Desktop, no-op
    if (srcPath === `${DESKTOP_PATH}/${srcName}` || srcPath === DESKTOP_PATH) return
    const dest = `${DESKTOP_PATH}/${srcName}`.replace(/\/+/g, '/')
    // Don't move Desktop into itself
    if (srcPath === DESKTOP_PATH) return
    try {
      await fsMove(srcPath, dest)
      refresh()
    } catch (err) {
      alert(`Move to Desktop failed: ${(err as Error).message}`)
    }
  }

  async function onPasteOnDesktop() {
    if (!clipboard) return
    const srcName = clipboard.path.split('/').filter(Boolean).pop()
    if (!srcName) return
    const dest = `${DESKTOP_PATH}/${srcName}`.replace(/\/+/g, '/')
    try {
      if (clipboard.op === 'copy') {
        await fetch('/api/fs/copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: clipboard.path, to: dest }),
        })
      } else {
        await fsMove(clipboard.path, dest)
        useDesktopStore.setState({ clipboard: null })
      }
      refresh()
    } catch (e) {
      alert(`Paste failed: ${(e as Error).message}`)
    }
  }

  return (
    <div
      className={cn(
        'absolute inset-0 overflow-hidden transition-colors',
        dragOver && 'bg-emerald-500/5 ring-4 ring-emerald-500/30 ring-inset'
      )}
      onClick={onDesktopClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault()
          if (clipboard) onPasteOnDesktop()
        }
      }}
    >
      {/* Wallpaper gradient */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse at top left, hsl(160 60% 18%), hsl(220 30% 8%)), radial-gradient(ellipse at bottom right, hsl(280 40% 14%), transparent 60%)',
        }}
        aria-hidden
      />

      {dragOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl border-2 border-dashed border-emerald-500/60 bg-emerald-500/10 px-12 py-8 text-center backdrop-blur-sm">
            <div className="text-4xl mb-2">📥</div>
            <div className="text-emerald-300 font-medium text-lg">Drop to move to Desktop</div>
            <div className="text-emerald-400/70 text-xs mt-1">Release mouse button to drop here</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap content-start gap-1 p-4">
        {loading ? (
          <div className="text-muted-foreground text-sm">Loading desktop…</div>
        ) : error ? (
          <div className="text-rose-500 text-sm">{error}</div>
        ) : entries.length === 0 ? (
          <div className="text-muted-foreground/70 text-sm">Desktop is empty</div>
        ) : (
          entries.map((e) => (
            <FileIcon
              key={e.path}
              entry={e}
              onRefresh={refresh}
              onOpenFile={(entry) => {
                openApp('text-editor', {
                  payload: { path: entry.path },
                  title: `Edit · ${entry.name}`,
                })
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}
