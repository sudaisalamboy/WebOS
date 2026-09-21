import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import { safeResolve, jsonError } from '@/lib/fs-server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  try {
    const body = await req.json()
    const { path: relPath } = body
    if (!relPath) return jsonError(new Error('path required'), 400)
    const abs = safeResolve(relPath)
    await fs.mkdir(abs, { recursive: true })
    return NextResponse.json({ path: relPath, created: true })
  } catch (err) {
    return jsonError(err)
  }
}
