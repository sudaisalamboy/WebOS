/**
 * Client-side filesystem helpers — thin wrappers around /api/fs/*.
 * All paths are relative to the user-files sandbox root and start with '/'.
 */

export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modified: number
  ext: string
}

export async function fsList(p: string): Promise<FsEntry[]> {
  const res = await fetch(`/api/fs/list?path=${encodeURIComponent(p)}`)
  if (!res.ok) throw new Error((await res.json()).error ?? 'list failed')
  const data = await res.json()
  return data.entries as FsEntry[]
}

export async function fsRead(p: string): Promise<string> {
  const res = await fetch(`/api/fs/read?path=${encodeURIComponent(p)}`)
  if (!res.ok) throw new Error((await res.json()).error ?? 'read failed')
  const data = await res.json()
  return data.content as string
}

export async function fsWrite(p: string, content: string): Promise<void> {
  const res = await fetch('/api/fs/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p, content }),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? 'write failed')
}

export async function fsMkdir(p: string): Promise<void> {
  const res = await fetch('/api/fs/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? 'mkdir failed')
}

export async function fsDelete(p: string): Promise<void> {
  const res = await fetch('/api/fs/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? 'delete failed')
}

export async function fsRename(from: string, to: string): Promise<void> {
  const res = await fetch('/api/fs/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? 'rename failed')
}

export async function fsCopy(from: string, to: string): Promise<void> {
  const res = await fetch('/api/fs/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? 'copy failed')
}

export async function fsMove(from: string, to: string): Promise<void> {
  const res = await fetch('/api/fs/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? 'move failed')
}

// Path helpers
export function joinPath(...parts: string[]): string {
  const joined = parts.join('/').replace(/\/+/g, '/')
  if (joined === '/') return '/'
  return joined.replace(/\/$/, '')
}

export function dirname(p: string): string {
  if (p === '/' || p === '') return '/'
  const parts = p.split('/').filter(Boolean)
  parts.pop()
  return parts.length === 0 ? '/' : '/' + parts.join('/')
}

export function basename(p: string): string {
  if (p === '/') return '/'
  const parts = p.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

export function extname(p: string): string {
  const b = basename(p)
  const dot = b.lastIndexOf('.')
  if (dot <= 0) return ''
  return b.slice(dot + 1).toLowerCase()
}

export function changeExtension(p: string, newExt: string): string {
  const dir = dirname(p)
  const b = basename(p)
  const dot = b.lastIndexOf('.')
  const stem = dot > 0 ? b.slice(0, dot) : b
  const cleanExt = newExt.replace(/^\./, '').trim()
  return joinPath(dir, cleanExt ? `${stem}.${cleanExt}` : stem)
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString()
}
