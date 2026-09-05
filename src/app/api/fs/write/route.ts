import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { safeResolve, jsonError, SANDBOX_ROOT } from '@/lib/fs-server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  try {
    const body = await req.json()
    const { path: relPath, content, createDirs = true } = body
    if (!relPath) return jsonError(new Error('path required'), 400)
    const abs = safeResolve(relPath)
    if (createDirs) {
      await fs.mkdir(path.dirname(abs), { recursive: true })
    }
    await fs.writeFile(abs, content ?? '', 'utf8')
    return NextResponse.json({
      path: '/' + path.relative(SANDBOX_ROOT, abs).split(path.sep).join('/'),
      size: (content ?? '').length,
    })
  } catch (err) {
    return jsonError(err)
  }
}
