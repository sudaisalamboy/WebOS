import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { safeResolve, jsonError, SANDBOX_ROOT } from '@/lib/fs-server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'

async function copyRecursive(src: string, dest: string) {
  const stat = await fs.stat(src)
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true })
    const entries = await fs.readdir(src, { withFileTypes: true })
    for (const e of entries) {
      await copyRecursive(path.join(src, e.name), path.join(dest, e.name))
    }
  } else {
    await fs.copyFile(src, dest)
  }
}

// Copy a file or directory. If `to` is an existing directory, copy `from` inside it.
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  try {
    const body = await req.json()
    const { from, to } = body
    if (!from || !to) return jsonError(new Error('from and to required'), 400)

    const fromAbs = safeResolve(from)
    const toAbs = safeResolve(to)

    let target = toAbs
    try {
      const stat = await fs.stat(toAbs)
      if (stat.isDirectory()) {
        target = path.join(toAbs, path.basename(fromAbs))
      }
    } catch {
      // doesn't exist, ok
    }

    await copyRecursive(fromAbs, target)
    return NextResponse.json({
      from,
      to: '/' + path.relative(SANDBOX_ROOT, target).split(path.sep).join('/'),
      copied: true,
    })
  } catch (err) {
    return jsonError(err)
  }
}
