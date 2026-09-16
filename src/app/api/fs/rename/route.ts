import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { safeResolve, jsonError, SANDBOX_ROOT } from '@/lib/fs-server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'

// Rename OR move (same operation on POSIX).
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  try {
    const body = await req.json()
    const { from, to } = body
    if (!from || !to) return jsonError(new Error('from and to required'), 400)

    const fromAbs = safeResolve(from)
    const toAbs = safeResolve(to)

    // Ensure parent dir of destination exists
    await fs.mkdir(path.dirname(toAbs), { recursive: true })

    // If destination already exists and is a directory, place source inside it
    let target = toAbs
    try {
      const stat = await fs.stat(toAbs)
      if (stat.isDirectory()) {
        target = path.join(toAbs, path.basename(fromAbs))
      }
    } catch {
      // destination doesn't exist, that's fine
    }

    await fs.rename(fromAbs, target)
    return NextResponse.json({
      from,
      to: '/' + path.relative(SANDBOX_ROOT, target).split(path.sep).join('/'),
      moved: true,
    })
  } catch (err) {
    return jsonError(err)
  }
}
