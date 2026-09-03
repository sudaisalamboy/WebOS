import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'

export const runtime = 'nodejs'

// Sandboxed root: all file operations are confined to this directory.
export const SANDBOX_ROOT = path.resolve(process.cwd(), 'user-files')

/**
 * Resolve a user-supplied path and ensure it stays inside the sandbox.
 * Throws 403 if the resolved path escapes the sandbox.
 */
export function safeResolve(userPath: string | undefined | null): string {
  const base = userPath && userPath.length > 0 ? userPath : '/'
  // Normalize relative to sandbox root
  const resolved = path.resolve(SANDBOX_ROOT, base.replace(/^[/\\]+/, ''))
  if (resolved !== SANDBOX_ROOT && !resolved.startsWith(SANDBOX_ROOT + path.sep)) {
    throw new SecurityError('Path escapes sandbox')
  }
  return resolved
}

export class SecurityError extends Error {
  status = 403
}

export interface FsEntry {
  name: string
  path: string // path relative to sandbox root, always starts with '/'
  isDir: boolean
  size: number
  modified: number
  ext: string
}

export async function listDir(relPath: string): Promise<FsEntry[]> {
  const abs = safeResolve(relPath)
  if (!existsSync(abs)) throw new NotFoundError('Directory not found')
  const entries = await fs.readdir(abs, { withFileTypes: true })
  const result: FsEntry[] = []
  for (const e of entries) {
    const full = path.join(abs, e.name)
    const stat = await fs.stat(full)
    result.push({
      name: e.name,
      path: '/' + path.relative(SANDBOX_ROOT, full).split(path.sep).join('/'),
      isDir: e.isDirectory(),
      size: stat.size,
      modified: stat.mtimeMs,
      ext: e.isFile() ? path.extname(e.name).slice(1).toLowerCase() : '',
    })
  }
  return result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export class NotFoundError extends Error {
  status = 404
}

export function jsonError(err: unknown, status?: number) {
  const e = err as { message?: string; status?: number }
  const code = status ?? e.status ?? 500
  return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: code })
}
