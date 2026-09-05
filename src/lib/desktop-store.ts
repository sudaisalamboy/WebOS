'use client'

import { create } from 'zustand'

export type AppId =
  | 'terminal'
  | 'browser'
  | 'notes'
  | 'file-explorer'
  | 'text-editor'
  | 'vps-dashboard'
  | 'about'
  | 'tor-browser'
  | 'tor-suite'
  | 'remote-chrome'
  | 'onionshare'
  | 'security-lab'
  | 'encrypted-notes'
  | 'screenshot'
  | 'camera-inject'

export interface WindowState {
  id: string // unique instance id
  appId: AppId
  title: string
  icon: string // emoji or short label
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
  maximized: boolean
  // Optional payload, e.g. file path to open
  payload?: Record<string, unknown>
  // Saved bounds before maximize
  savedBounds?: { x: number; y: number; width: number; height: number }
}

interface DesktopState {
  windows: WindowState[]
  zCounter: number
  activeId: string | null
  clipboard: { op: 'copy' | 'cut'; path: string } | null
  // selection on desktop
  selectedPath: string | null

  openApp: (appId: AppId, opts?: Partial<WindowState>) => string
  closeWindow: (id: string) => void
  focusWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  toggleMaximize: (id: string) => void
  moveWindow: (id: string, x: number, y: number) => void
  resizeWindow: (id: string, w: number, h: number) => void
  updateWindow: (id: string, patch: Partial<WindowState>) => void

  setClipboard: (c: { op: 'copy' | 'cut'; path: string } | null) => void
  setSelectedPath: (p: string | null) => void
}

const APP_DEFAULTS: Record<AppId, Omit<WindowState, 'id' | 'zIndex' | 'minimized' | 'maximized'>> = {
  terminal: {
    appId: 'terminal',
    title: 'Terminal',
    icon: '▖',
    x: 80, y: 80, width: 680, height: 420,
  },
  browser: {
    appId: 'browser',
    title: 'Browser',
    icon: '🌐',
    x: 140, y: 100, width: 980, height: 640,
  },
  notes: {
    appId: 'notes',
    title: 'Notes',
    icon: '📝',
    x: 200, y: 120, width: 720, height: 520,
  },
  'file-explorer': {
    appId: 'file-explorer',
    title: 'File Explorer',
    icon: '📁',
    x: 100, y: 90, width: 820, height: 540,
  },
  'text-editor': {
    appId: 'text-editor',
    title: 'Text Editor',
    icon: '📄',
    x: 160, y: 110, width: 700, height: 520,
  },
  'vps-dashboard': {
    appId: 'vps-dashboard',
    title: 'VPS Dashboard',
    icon: '📊',
    x: 120, y: 80, width: 1100, height: 720,
  },
  about: {
    appId: 'about',
    title: 'About WebOS',
    icon: 'ℹ️',
    x: 280, y: 160, width: 480, height: 360,
  },
  'tor-browser': {
    appId: 'tor-browser',
    title: 'Tor Browser',
    icon: '🧅',
    x: 100, y: 80, width: 1100, height: 700,
  },
  'tor-suite': {
    appId: 'tor-suite',
    title: 'TorSuite Pro',
    icon: '🎯',
    x: 60, y: 50, width: 1280, height: 780,
  },
  'remote-chrome': {
    appId: 'remote-chrome',
    title: 'Remote Chrome',
    icon: '🖥️',
    x: 200, y: 100, width: 720, height: 640,
  },
  onionshare: {
    appId: 'onionshare',
    title: 'OnionShare',
    icon: '🧄',
    x: 120, y: 100, width: 880, height: 640,
  },
  'security-lab': {
    appId: 'security-lab',
    title: 'Security Lab',
    icon: '🛡️',
    x: 80, y: 60, width: 1200, height: 760,
  },
  'encrypted-notes': {
    appId: 'encrypted-notes',
    title: 'Encrypted Notes',
    icon: '🔐',
    x: 150, y: 100, width: 880, height: 560,
  },
  screenshot: {
    appId: 'screenshot',
    title: 'Screenshot',
    icon: '📷',
    x: 130, y: 90, width: 900, height: 640,
  },
  'camera-inject': {
    appId: 'camera-inject',
    title: 'Camera Inject',
    icon: '🎥',
    x: 120, y: 80, width: 520, height: 720,
  },
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

export const useDesktopStore = create<DesktopState>((set, get) => ({
  windows: [],
  zCounter: 10,
  activeId: null,
  clipboard: null,
  selectedPath: null,

  openApp: (appId, opts) => {
    const id = uid()
    const base = APP_DEFAULTS[appId]
    const z = get().zCounter + 1
    // Cascade new windows a bit so they don't perfectly overlap
    const offset = (get().windows.length % 6) * 24
    const win: WindowState = {
      ...base,
      id,
      zIndex: z,
      minimized: false,
      maximized: false,
      x: base.x + offset,
      y: base.y + offset,
      ...opts,
    }
    set((s) => ({
      windows: [...s.windows, win],
      zCounter: z,
      activeId: id,
    }))
    return id
  },

  closeWindow: (id) => {
    set((s) => ({
      windows: s.windows.filter((w) => w.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }))
  },

  focusWindow: (id) => {
    set((s) => {
      const z = s.zCounter + 1
      return {
        zCounter: z,
        activeId: id,
        windows: s.windows.map((w) =>
          w.id === id ? { ...w, zIndex: z, minimized: false } : w
        ),
      }
    })
  },

  minimizeWindow: (id) => {
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, minimized: true } : w
      ),
      activeId: s.activeId === id ? null : s.activeId,
    }))
  },

  toggleMaximize: (id) => {
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w
        if (w.maximized && w.savedBounds) {
          return { ...w, ...w.savedBounds, maximized: false, savedBounds: undefined }
        }
        return {
          ...w,
          maximized: true,
          savedBounds: { x: w.x, y: w.y, width: w.width, height: w.height },
        }
      }),
    }))
  },

  moveWindow: (id, x, y) => {
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, x, y } : w)),
    }))
  },

  resizeWindow: (id, w, h) => {
    set((s) => ({
      windows: s.windows.map((win) =>
        win.id === id ? { ...win, width: w, height: h } : win
      ),
    }))
  },

  updateWindow: (id, patch) => {
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }))
  },

  setClipboard: (c) => set({ clipboard: c }),
  setSelectedPath: (p) => set({ selectedPath: p }),
}))
