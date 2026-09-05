import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { getSession } from '@/lib/live-browser'
import { decodeHtmlSource } from '@/lib/source-decoder'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * GET /api/tor/live/source?id=...&mode=raw|decoded|findings
 *
 * Returns the rendered HTML source of the current page in the live session,
 * along with a full decode of any encoded/obfuscated content found inside it.
 *
 * Modes:
 *   raw       → just the raw rendered HTML (post-JS execution)
 *   decoded   → the fully-decoded HTML (entities, hex, unicode all expanded)
 *   findings  → { findings, stats } — list of every decoded snippet found
 *   all       → { raw, decoded, findings, stats } (default; can be large)
 *
 * The HTML is fetched via Playwright's page.content() — this returns the
 * CURRENT DOM as a serialized string, so dynamically-injected scripts,
 * lazy-loaded content, and post-hydration state are all included.
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const mode = (req.nextUrl.searchParams.get('mode') ?? 'all') as 'raw' | 'decoded' | 'findings' | 'all'

  const session = getSession(id)
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 })
  if (!session.ready) return NextResponse.json({ error: 'session not ready' }, { status: 503 })

  try {
    // Get the CURRENT rendered HTML (post-JS execution, includes dynamic content)
    const raw = await session.page.content()

    if (mode === 'raw') {
      return new NextResponse(raw, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
    }

    // Decode
    const result = decodeHtmlSource(raw)

    if (mode === 'decoded') {
      return new NextResponse(result.decoded, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
    }

    if (mode === 'findings') {
      return NextResponse.json({
        url: session.currentUrl,
        title: await session.page.title().catch(() => ''),
        stats: result.stats,
        findings: result.findings,
        rawLength: raw.length,
      })
    }

    // mode === 'all' — return everything as JSON
    return NextResponse.json({
      url: session.currentUrl,
      title: await session.page.title().catch(() => ''),
      raw: raw,
      decoded: result.decoded,
      rawLength: raw.length,
      decodedLength: result.decoded.length,
      stats: result.stats,
      findings: result.findings,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 }
    )
  }
}
