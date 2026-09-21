'use client'

import { useState, useRef, useEffect } from 'react'
import { useDesktopStore } from '@/lib/desktop-store'
import { FsEntry, fsDelete, fsRename, fsCopy, fsMove, dirname, basename, changeExtension, extname } from '@/lib/fs-client'
import { cn } from '@/lib/utils'
import {
  Folder, FileText, FileCode, FileJson, FileImage, FileMusic,
  File, Pencil, Trash2, Scissors, Copy, ClipboardPaste, Edit3,
} from 'lucide-react'

export const FILE_DRAG_MIME = 'application/x-webos-filepath'

interface FileIconProps {
  entry: FsEntry
  onRefresh: () => void
  onOpenFile?: (entry: FsEntry) => void
}

const ICON_MAP: Record<string, typeof File> = {
  txt: FileText,
  md: FileText,
  log: FileText,
  js: FileCode,
  ts: FileCode,
  tsx: FileCode,
  jsx: FileCode,
  py: FileCode,
  sh: FileCode,
  json: FileJson,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  svg: FileImage,
  mp3: FileMusic,
  wav: FileMusic,
}

function iconFor(entry: FsEntry) {
  if (entry.isDir) return Folder
  return ICON_MAP[entry.ext] ?? File
}

export function FileIcon({ entry, onRefresh, onOpenFile }: FileIconProps) {
  const { openApp, setSelectedPath, selectedPath, clipboard, setClipboard } = useDesktopStore()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [editingExt, setEditingExt] = useState(false)
  const [name, setName] = useState(entry.name)
  const [ext, setExt] = useState(extname(entry.name))
  const [dragOver, setDragOver] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isSelected = selectedPath === entry.path

  function onDragStart(e: React.DragEvent) {
    e.stopPropagation()
    e.dataTransfer.setData(FILE_DRAG_MIME, entry.path)
    e.dataTransfer.setData('text/plain', entry.path)
    e.dataTransfer.effectAllowed = 'move'
    setIsDragging(true)
  }

  function onDragEnd() {
    setIsDragging(false)
  }

  // Folders accept drops (move file into this folder)
  function onDragOverFolder(e: React.DragEvent) {
    if (!entry.isDir) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }

  function onDragLeaveFolder() {
    setDragOver(false)
  }

  async function onDropOnFolder(e: React.DragEvent) {
    if (!entry.isDir) return
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const srcPath = e.dataTransfer.getData(FILE_DRAG_MIME) || e.dataTransfer.getData('text/plain')
    if (!srcPath || srcPath === entry.path) return
    // Don't allow dropping a folder into itself or its descendant
    if (srcPath === entry.path || entry.path.startsWith(srcPath + '/')) {
      alert("Can't move a folder into itself or its descendant.")
      return
    }
    const srcName = basename(srcPath)
    const dest = `${entry.path}/${srcName}`.replace(/\/+/g, '/')
    try {
      await fsMove(srcPath, dest)
      onRefresh()
    } catch (err) {
      alert(`Move failed: ${(err as Error).message}`)
    }
  }

  function open() {
    if (entry.isDir) {
      openApp('file-explorer', { payload: { path: entry.path } })
    } else {
      // For text/code files open the editor, images open in browser, others in editor too.
      if (onOpenFile) {
        onOpenFile(entry)
      } else {
        openApp('text-editor', { payload: { path: entry.path }, title: `Edit · ${entry.name}` })
      }
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    e.stopPropagation()
    open()
  }

  function onClick(e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedPath(entry.path)
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setSelectedPath(entry.path)
    setMenu({ x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    if (!menu) return
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menu])

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [renaming])

  async function doRename() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === entry.name) {
      setRenaming(false)
      return
    }
    try {
      const target = `${dirname(entry.path)}/${trimmed}`.replace(/\/+/g, '/')
      await fsRename(entry.path, target)
      onRefresh()
    } catch (e) {
      alert(`Rename failed: ${(e as Error).message}`)
    }
    setRenaming(false)
  }

  async function doEditExt() {
    const cleanExt = ext.replace(/^\./, '').trim()
    const newPath = changeExtension(entry.path, cleanExt)
    if (newPath === entry.path) {
      setEditingExt(false)
      return
    }
    try {
      await fsRename(entry.path, newPath)
      onRefresh()
    } catch (e) {
      alert(`Extension change failed: ${(e as Error).message}`)
    }
    setEditingExt(false)
  }

  async function doDelete() {
    if (!confirm(`Delete "${entry.name}"? This cannot be undone.`)) return
    try {
      await fsDelete(entry.path)
      onRefresh()
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`)
    }
    setMenu(null)
  }

  async function doCopy() {
    setClipboard({ op: 'copy', path: entry.path })
    setMenu(null)
  }

  async function doCut() {
    setClipboard({ op: 'cut', path: entry.path })
    setMenu(null)
  }

  async function doPasteHere() {
    // Paste into this directory (if it's a folder) or next to this file
    const targetDir = entry.isDir ? entry.path : dirname(entry.path)
    if (!clipboard) return
    const srcName = basename(clipboard.path)
    const dest = `${targetDir}/${srcName}`.replace(/\/+/g, '/')
    try {
      if (clipboard.op === 'copy') {
        await fsCopy(clipboard.path, dest)
      } else {
        await fsMove(clipboard.path, dest)
        setClipboard(null)
      }
      onRefresh()
    } catch (e) {
      alert(`Paste failed: ${(e as Error).message}`)
    }
    setMenu(null)
  }

  const Icon = iconFor(entry) as React.ComponentType<{ className?: string }>

  return (
    <>
      <div
        className={cn(
          'group relative flex w-24 flex-col items-center gap-1 rounded-lg p-2 cursor-pointer transition',
          isSelected ? 'bg-emerald-500/15 ring-1 ring-emerald-500/40' : 'hover:bg-foreground/5',
          isDragging && 'opacity-40',
          dragOver && entry.isDir && 'bg-emerald-500/25 ring-2 ring-emerald-500 scale-105'
        )}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOverFolder}
        onDragLeave={onDragLeaveFolder}
        onDrop={onDropOnFolder}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <div className="flex h-12 w-12 items-center justify-center">
          <Icon className={cn('h-10 w-10', entry.isDir ? 'text-amber-500' : 'text-sky-500')} />
        </div>
        {renaming ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={doRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doRename()
              if (e.key === 'Escape') { setRenaming(false); setName(entry.name) }
            }}
            className="w-full rounded border border-emerald-500 bg-background px-1 py-0.5 text-center text-xs"
            onClick={(e) => e.stopPropagation()}
          />
        ) : editingExt ? (
          <input
            value={ext}
            onChange={(e) => setExt(e.target.value)}
            onBlur={doEditExt}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doEditExt()
              if (e.key === 'Escape') { setEditingExt(false); setExt(extname(entry.name)) }
            }}
            placeholder="ext"
            className="w-full rounded border border-emerald-500 bg-background px-1 py-0.5 text-center text-xs"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="line-clamp-2 w-full text-center text-xs text-foreground/90 break-all leading-tight">
            {entry.name}
          </span>
        )}
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-44 rounded-md border border-border bg-popover p-1 shadow-xl text-sm"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuItem icon={<Folder className="h-3.5 w-3.5" />} onClick={() => { open(); setMenu(null) }}>
            Open
          </MenuItem>
          <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setRenaming(true); setMenu(null) }}>
            Rename
          </MenuItem>
          {!entry.isDir && (
            <MenuItem icon={<Edit3 className="h-3.5 w-3.5" />} onClick={() => { setEditingExt(true); setMenu(null) }}>
              Edit extension
            </MenuItem>
          )}
          <MenuItem icon={<Copy className="h-3.5 w-3.5" />} onClick={doCopy}>
            Copy
          </MenuItem>
          <MenuItem icon={<Scissors className="h-3.5 w-3.5" />} onClick={doCut}>
            Cut
          </MenuItem>
          {clipboard && (
            <MenuItem icon={<ClipboardPaste className="h-3.5 w-3.5" />} onClick={doPasteHere}>
              Paste here
            </MenuItem>
          )}
          <div className="my-1 h-px bg-border" />
          <MenuItem icon={<Trash2 className="h-3.5 w-3.5 text-rose-500" />} onClick={doDelete} danger>
            Delete
          </MenuItem>
        </div>
      )}
    </>
  )
}

function MenuItem({
  children,
  icon,
  onClick,
  danger,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition',
        danger ? 'text-rose-500 hover:bg-rose-500/10' : 'hover:bg-foreground/5'
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}
