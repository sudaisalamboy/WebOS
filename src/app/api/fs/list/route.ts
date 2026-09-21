import { NextRequest, NextResponse } from 'next/server'
import { listDir, jsonError } from '@/lib/fs-server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const p = req.nextUrl.searchParams.get('path') ?? '/'
  try {
    const entries = await listDir(p)
    return NextResponse.json({ path: p, entries })
  } catch (err) {
    return jsonError(err)
  }
}
