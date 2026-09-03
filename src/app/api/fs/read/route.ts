import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import { safeResolve, jsonError } from '@/lib/fs-server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const p = req.nextUrl.searchParams.get('path') ?? '/'
  try {
    const abs = safeResolve(p)
    const data = await fs.readFile(abs, 'utf8')
    return NextResponse.json({ path: p, content: data })
  } catch (err) {
    return jsonError(err)
  }
}
