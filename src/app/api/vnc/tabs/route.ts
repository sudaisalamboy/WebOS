import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { getTabs } from '@/lib/chrome-cdp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const tabs = await getTabs()
  return NextResponse.json({ ok: true, tabs })
}
