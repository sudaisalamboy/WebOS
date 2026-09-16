'use client'

import { useRef, useState, useEffect, ReactNode } from 'react'
import { X, Minus, Square, Copy as CopyIcon } from 'lucide-react'
import { useDesktopStore, WindowState } from '@/lib/desktop-store'
import { cn } from '@/lib/utils'

interface WindowProps {
  win: WindowState
  children: ReactNode
}

export function OsWindow({ win, children }: WindowProps) {
  const { focusWindow, closeWindow, minimizeWindow, toggleMaximize, moveWindow, resizeWindow, activeId } = useDesktopStore()
  const isActive = activeId === win.id
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeState = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  function onTitleMouseDown(e: React.MouseEvent) {
    if (win.maximized) return
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    focusWindow(win.id)
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: win.x, origY: win.y }
    setDragging(true)
  }

  useEffect(() => {
    if (!dragging) return
    function onMove(e: MouseEvent) {
      const s = dragState.current
      if (!s) return
      const dx = e.clientX - s.startX
      const dy = e.clientY - s.startY
      const newX = Math.max(0, Math.min(window.innerWidth - 100, s.origX + dx))
      const newY = Math.max(0, Math.min(window.innerHeight - 100, s.origY + dy))
      moveWindow(win.id, newX, newY)
    }
    function onUp() {
      dragState.current = null
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, win.id, moveWindow])

  const [resizing, setResizing] = useState(false)
  function onResizeMouseDown(e: React.MouseEvent) {
    if (win.maximized) return
    e.preventDefault()
    e.stopPropagation()
    focusWindow(win.id)
    resizeState.current = { startX: e.clientX, startY: e.clientY, origW: win.width, origH: win.height }
    setResizing(true)
  }
  useEffect(() => {
    if (!resizing) return
    function onMove(e: MouseEvent) {
      const s = resizeState.current
      if (!s) return
      const w = Math.max(320, s.origW + (e.clientX - s.startX))
      const h = Math.max(220, s.origH + (e.clientY - s.startY))
      resizeWindow(win.id, w, h)
    }
    function onUp() {
      resizeState.current = null
      setResizing(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing, win.id, resizeWindow])

  if (win.minimized) return null

  const style: React.CSSProperties = win.maximized
    ? { left: 0, top: 0, width: '100vw', height: 'calc(100vh - 48px)', zIndex: win.zIndex }
    : { left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.zIndex }

  return (
    <div
      className={cn(
        'absolute flex flex-col overflow-hidden rounded-lg border bg-card shadow-2xl',
        isActive ? 'border-emerald-500/40 shadow-emerald-500/5' : 'border-border/60'
      )}
      style={style}
      onMouseDown={() => !isActive && focusWindow(win.id)}
    >
      <div
        className={cn(
          'flex h-9 shrink-0 items-center justify-between gap-2 px-2 select-none cursor-grab active:cursor-grabbing',
          isActive ? 'bg-muted/60' : 'bg-muted/30'
        )}
        onMouseDown={onTitleMouseDown}
        onDoubleClick={() => toggleMaximize(win.id)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm leading-none">{win.icon}</span>
          <span className="text-xs font-medium truncate">{win.title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); minimizeWindow(win.id) }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-foreground/10 transition"
            aria-label="Minimize"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); toggleMaximize(win.id) }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-foreground/10 transition"
            aria-label="Maximize"
          >
            {win.maximized ? <CopyIcon className="h-3 w-3" /> : <Square className="h-3 w-3" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); closeWindow(win.id) }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-rose-500 hover:text-white transition"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-background relative">
        {children}
      </div>

      {!win.maximized && (
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute right-0 bottom-0 h-4 w-4 cursor-se-resize z-50"
          aria-hidden
        >
          <svg viewBox="0 0 16 16" className="h-full w-full text-muted-foreground/40">
            <path d="M 11 5 L 5 11 M 13 7 L 7 13 M 15 9 L 9 15" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        </div>
      )}
    </div>
  )
}
