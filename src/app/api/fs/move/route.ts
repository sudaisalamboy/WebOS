import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { safeResolve, jsonError, SANDBOX_ROOT } from '@/lib/fs-server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'

// Move = rename across dirs. Same as /rename but kept as separate endpoint for clarity.
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  try {
    const body = await req.json()
    const { from, to } = body
    if (!from || !to) return jsonError(new Error('from and to required'), 400)

    const fromAbs = safeResolve(from)
    const toAbs = safeResolve(to)

    await fs.mkdir(path.dirname(toAbs), { recursive: true })

    let target = toAbs
    try {
      const stat = await fs.stat(toAbs)
      if (stat.isDirectory()) {
        target = path.join(toAbs, path.basename(fromAbs))
      }
    } catch {
      // ok
    }

    // Try rename first (fast, same-filesystem). Fall back to copy+delete.
    try {
      await fs.rename(fromAbs, target)
    } catch {
      await fs.cp(fromAbs, target, { recursive: true })
      await fs.rm(fromAbs, { recursive: true, force: true })
    }

    return NextResponse.json({
      from,
      to: '/' + path.relative(SANDBOX_ROOT, target).split(path.sep).join('/'),
      moved: true,
    })
  } catch (err) {
    return jsonError(err)
  }
}
