'use client'

import { useState, useEffect } from 'react'
import { useDesktopStore, AppId } from '@/lib/desktop-store'
import { cn } from '@/lib/utils'
import { Terminal, Globe, StickyNote, FolderOpen, Activity, Info, Search, Shield, Share2, Lock, Camera, Crosshair, Monitor, Video } from 'lucide-react'

const APPS: { id: AppId; name: string; icon: React.ReactNode; color: string }[] = [
  { id: 'terminal', name: 'Terminal', icon: <Terminal className="h-5 w-5" />, color: 'text-slate-300' },
  { id: 'browser', name: 'Browser', icon: <Globe className="h-5 w-5" />, color: 'text-sky-400' },
  { id: 'tor-browser', name: 'Tor Browser', icon: <Shield className="h-5 w-5" />, color: 'text-violet-400' },
  { id: 'tor-suite', name: 'TorSuite Pro', icon: <Crosshair className="h-5 w-5" />, color: 'text-cyan-400' },
  { id: 'remote-chrome', name: 'Remote Chrome', icon: <Monitor className="h-5 w-5" />, color: 'text-emerald-400' },
  { id: 'camera-inject', name: 'Camera Inject', icon: <Video className="h-5 w-5" />, color: 'text-fuchsia-400' },
  { id: 'onionshare', name: 'OnionShare', icon: <Share2 className="h-5 w-5" />, color: 'text-emerald-400' },
  { id: 'security-lab', name: 'Security Lab', icon: <Shield className="h-5 w-5" />, color: 'text-rose-400' },
  { id: 'screenshot', name: 'Screenshot', icon: <Camera className="h-5 w-5" />, color: 'text-cyan-400' },
  { id: 'encrypted-notes', name: 'Encrypted Notes', icon: <Lock className="h-5 w-5" />, color: 'text-amber-400' },
  { id: 'notes', name: 'Notes', icon: <StickyNote className="h-5 w-5" />, color: 'text-amber-400' },
  { id: 'file-explorer', name: 'File Explorer', icon: <FolderOpen className="h-5 w-5" />, color: 'text-orange-400' },
  { id: 'vps-dashboard', name: 'VPS Dashboard', icon: <Activity className="h-5 w-5" />, color: 'text-violet-400' },
  { id: 'about', name: 'About WebOS', icon: <Info className="h-5 w-5" />, color: 'text-foreground/70' },
]

export function Taskbar() {
  const [startOpen, setStartOpen] = useState(false)
  // Render null on the server, then start ticking on the client to avoid
  // hydration mismatch (server time vs. client time differ by a few ms).
  const [now, setNow] = useState<Date | null>(null)
  const { windows, openApp, focusWindow, minimizeWindow, activeId } = useDesktopStore()

  useEffect(() => {
    // Initial tick is deferred to a microtask so it doesn't run synchronously
    // in the effect body (avoids the set-state-in-effect lint rule).
    queueMicrotask(() => setNow(new Date()))
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Close start menu when clicking outside
  useEffect(() => {
    if (!startOpen) return
    function onDocClick(e: MouseEvent) {
      const t = e.target as HTMLElement
      if (!t.closest('[data-start-menu]') && !t.closest('[data-start-btn]')) {
        setStartOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [startOpen])

  return (
    <>
      {startOpen && (
        <div
          data-start-menu
          className="fixed bottom-14 left-3 z-[10000] w-80 rounded-xl border border-border bg-popover/95 backdrop-blur-md shadow-2xl p-3"
        >
          <div className="flex items-center gap-2 px-2 pb-3 border-b border-border/60 mb-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search apps…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="grid grid-cols-3 gap-1">
            {APPS.map((app) => (
              <button
                key={app.id}
                onClick={() => {
                  openApp(app.id)
                  setStartOpen(false)
                }}
                className="flex flex-col items-center gap-1.5 rounded-lg p-3 hover:bg-foreground/5 transition group"
              >
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg bg-foreground/5 group-hover:scale-110 transition', app.color)}>
                  {app.icon}
                </div>
                <span className="text-xs text-foreground/80 text-center leading-tight">{app.name}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-border/60 text-xs text-muted-foreground text-center">
            WebOS · sandboxed user-files
          </div>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 h-12 z-[9999] flex items-center gap-1 px-2 border-t border-border/60 bg-card/80 backdrop-blur-md">
        <button
          data-start-btn
          onClick={() => setStartOpen((v) => !v)}
          className={cn(
            'flex h-9 items-center gap-2 rounded-lg px-3 transition',
            startOpen ? 'bg-foreground/10' : 'hover:bg-foreground/5'
          )}
          aria-label="Start"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-emerald-400 to-sky-500 text-white text-xs font-bold">
            W
          </div>
          <span className="text-sm font-medium hidden sm:inline">Start</span>
        </button>

        <div className="h-6 w-px bg-border/60 mx-1" />

        {/* Pinned apps */}
        <div className="flex items-center gap-0.5">
          {APPS.slice(0, 7).map((app) => (
            <button
              key={app.id}
              onClick={() => openApp(app.id)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg hover:bg-foreground/5 transition',
                app.color
              )}
              title={app.name}
              aria-label={app.name}
            >
              {app.icon}
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-border/60 mx-1" />

        {/* Running windows */}
        <div className="flex items-center gap-0.5 flex-1 overflow-x-auto">
          {windows.map((w) => (
            <button
              key={w.id}
              onClick={() => {
                if (activeId === w.id && !w.minimized) {
                  minimizeWindow(w.id)
                } else {
                  focusWindow(w.id)
                }
              }}
              className={cn(
                'flex h-9 max-w-44 items-center gap-1.5 rounded-lg px-2.5 text-xs transition shrink-0',
                activeId === w.id && !w.minimized
                  ? 'bg-emerald-500/15 ring-1 ring-emerald-500/40 text-foreground'
                  : 'bg-foreground/5 hover:bg-foreground/10 text-foreground/70'
              )}
              title={w.title}
            >
              <span className="text-sm leading-none">{w.icon}</span>
              <span className="truncate hidden md:inline">{w.title}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 text-xs tabular-nums text-foreground/80" suppressHydrationWarning>
          <span className="hidden sm:inline">
            {now ? now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '\u00A0'}
          </span>
          <span>
            {now ? now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '\u00A0'}
          </span>
        </div>

        <button
          onClick={async () => {
            if (!confirm('Lock WebOS? You will need to enter your password to come back.')) return
            try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
            window.dispatchEvent(new CustomEvent('webos:logout'))
          }}
          title="Lock / Logout"
          className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-rose-500/15 text-rose-400 transition"
        >
          <Lock className="h-4 w-4" />
        </button>
      </div>
    </>
  )
}
