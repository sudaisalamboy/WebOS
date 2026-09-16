import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { getSession, navigateSession } from '@/lib/live-browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/tor/live/action
 * Body: { sessionId, type, ...payload }
 *
 * Action types:
 *   navigate  : { url }
 *   click     : { x, y }            // coordinates relative to viewport (top-left origin)
 *   clickEl   : { selector }        // CSS selector (fallback if coords don't hit)
 *   scroll    : { dx, dy }          // scroll by delta
 *   scrollTo  : { x, y }            // scroll to absolute position
 *   type      : { text }            // type text into focused element
 *   press     : { key }             // press a key (e.g. "Enter", "Tab", "Escape")
 *   back      : {}                  // browser back
 *   forward   : {}                  // browser forward
 *   reload    : {}                  // reload page
 *   hover     : { x, y }
 *
 * Returns: { ok, url?, title?, error? }
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { sessionId, type } = body
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  if (!type) return NextResponse.json({ error: 'type required' }, { status: 400 })

  // Navigate is handled separately because it creates a new page state
  if (type === 'navigate') {
    const result = await navigateSession(sessionId, body.url ?? '')
    return NextResponse.json(result, { status: result.ok ? 200 : 502 })
  }

  const session = getSession(sessionId)
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 })

  const page = session.page
  session.lastActivity = Date.now()

  try {
    switch (type) {
      case 'click': {
        const x = Number(body.x), y = Number(body.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return NextResponse.json({ error: 'x and y required' }, { status: 400 })
        }
        // Use click with force to bypass any overlays; also do a real mouse move
        await page.mouse.move(x, y)
        await page.mouse.click(x, y, { delay: 50 })
        break
      }

      case 'clickEl': {
        if (!body.selector) return NextResponse.json({ error: 'selector required' }, { status: 400 })
        await page.click(body.selector, { timeout: 5000 }).catch(e => {
          throw new Error(`click failed: ${e.message}`)
        })
        break
      }

      case 'scroll': {
        const dx = Number(body.dx) || 0, dy = Number(body.dy) || 0
        await page.mouse.wheel(dx, dy)
        break
      }

      case 'scrollTo': {
        const x = Number(body.x) || 0, y = Number(body.y) || 0
        await page.evaluate(([x, y]) => window.scrollTo(x, y), [x, y])
        break
      }

      case 'type': {
        if (!body.text) return NextResponse.json({ error: 'text required' }, { status: 400 })
        await page.keyboard.type(body.text, { delay: 10 })
        break
      }

      case 'press': {
        if (!body.key) return NextResponse.json({ error: 'key required' }, { status: 400 })
        await page.keyboard.press(body.key)
        break
      }

      case 'hover': {
        const x = Number(body.x), y = Number(body.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return NextResponse.json({ error: 'x and y required' }, { status: 400 })
        }
        await page.mouse.move(x, y)
        break
      }

      case 'back': {
        await page.goBack({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {})
        break
      }

      case 'forward': {
        await page.goForward({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {})
        break
      }

      case 'reload': {
        await page.reload({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {})
        break
      }

      default:
        return NextResponse.json({ error: `unknown action type: ${type}` }, { status: 400 })
    }

    // Brief settle wait so screenshots show the result of the action
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})

    return NextResponse.json({
      ok: true,
      url: page.url(),
      title: await page.title().catch(() => ''),
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message, url: page.url() },
      { status: 502 }
    )
  }
}
