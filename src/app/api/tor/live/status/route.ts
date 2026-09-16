import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { getSession, listSessions } from '@/lib/live-browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/tor/live/status?id=...
 *   Returns the state of a single session: { ready, url, title, idleSec }
 *
 * GET /api/tor/live/status  (no id)
 *   Returns a list of all active sessions.
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const id = req.nextUrl.searchParams.get('id')

  if (id) {
    const session = getSession(id)
    if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 })

    return NextResponse.json({
      id: session.id,
      ready: session.ready,
      url: session.currentUrl,
      title: await session.page.title().catch(() => ''),
      createdAt: session.createdAt,
      idleSec: Math.floor((Date.now() - session.lastActivity) / 1000),
    })
  }

  return NextResponse.json({ sessions: listSessions() })
}
