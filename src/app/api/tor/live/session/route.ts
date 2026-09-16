import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { createSession } from '@/lib/live-browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/tor/live/session
 * Body: { url?: string }
 *
 * Creates a new headless Chromium session (with Tor SOCKS5 proxy).
 * If `url` is provided, navigation starts in the background — poll
 * /api/tor/live/status?id=... to see when it's ready.
 *
 * Returns: { sessionId: string, ok: true }
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let body: { url?: string } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  try {
    const session = await createSession(body.url)
    return NextResponse.json({
      sessionId: session.id,
      ok: true,
      message: body.url
        ? 'Session created, navigating in background. Poll /api/tor/live/status for readiness.'
        : 'Session created. POST a URL to /api/tor/live/action to navigate.',
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 }
    )
  }
}

/**
 * DELETE /api/tor/live/session?id=...
 * Closes + cleans up a session.
 */
export async function DELETE(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { closeSession } = await import('@/lib/live-browser')
  await closeSession(id)
  return NextResponse.json({ ok: true })
}
