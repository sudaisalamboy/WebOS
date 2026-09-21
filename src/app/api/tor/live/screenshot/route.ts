import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { getSession } from '@/lib/live-browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * GET /api/tor/live/screenshot?id=...&w=1280&h=800&full=false
 *
 * Returns a JPEG screenshot of the current page state for the given session.
 * - `w` / `h`: viewport override (default 1280×800)
 * - `full`: if "true", captures the full scrollable page (not just viewport)
 *
 * Response: image/jpeg (binary)
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const session = getSession(id)
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 })

  if (!session.ready) {
    return NextResponse.json({ error: 'session not ready — still loading', ready: false }, { status: 503 })
  }

  const w = parseInt(req.nextUrl.searchParams.get('w') ?? '1280', 10)
  const h = parseInt(req.nextUrl.searchParams.get('h') ?? '800', 10)
  const full = req.nextUrl.searchParams.get('full') === 'true'

  try {
    // Wait a brief moment for any pending DOM updates to settle
    await session.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {})

    const buf = await session.page.screenshot({
      type: 'jpeg',
      quality: 70,
      fullPage: full,
      // Don't override viewport here — use the session's set viewport
    })

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, max-age=0',
        'X-Frame-Options': 'ALLOWALL',
        'Content-Security-Policy': '',
        // Include current URL + title as headers so the client can update its URL bar
        'X-Current-Url': encodeURIComponent(session.currentUrl),
        'X-Page-Title': encodeURIComponent(await session.page.title().catch(() => '') || ''),
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 }
    )
  }
}
