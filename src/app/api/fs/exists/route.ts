import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { safeResolve, jsonError } from '@/lib/fs-server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const p = req.nextUrl.searchParams.get('path') ?? '/'
  try {
    const abs = safeResolve(p)
    const exists = existsSync(abs)
    let stat = null
    if (exists) {
      const s = await fs.stat(abs)
      stat = {
        isDir: s.isDirectory(),
        isFile: s.isFile(),
        size: s.size,
        modified: s.mtimeMs,
      }
    }
    return NextResponse.json({ path: p, exists, stat })
  } catch (err) {
    return jsonError(err)
  }
}
