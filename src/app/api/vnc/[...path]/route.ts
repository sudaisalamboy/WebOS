import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NOVNC_DIR = '/home/z/my-project/tools/novnc'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
}

/**
 * GET /api/vnc/[...path]
 *
 * Serves noVNC static files (HTML, JS, CSS) from the noVNC directory.
 * This is needed because ES module imports don't carry the ?XTransformPort
 * query param that Caddy uses for routing — so /core/rfb.js would go to
 * Next.js (404) instead of websockify (which serves noVNC files).
 *
 * By serving the files through Next.js, all relative imports resolve
 * correctly to /api/vnc/core/rfb.js etc.
 *
 * The WebSocket connection itself still goes through Caddy with
 * ?XTransformPort=6080 (configured in the noVNC URL).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  // NOTE: No auth check here — these are just static JS/CSS library files
  // (noVNC's rfb.js, crypto modules, etc.) with no sensitive data.
  // Auth would block ES module imports when the noVNC page is loaded in an
  // iframe or new tab where the auth cookie might not be present.
  // The VNC connection itself is secured by x11vnc's -nopw + localhost-only binding.

  const { path: pathParts } = await params
  const filePath = path.join(NOVNC_DIR, ...pathParts)

  // Security: ensure the resolved path is within NOVNC_DIR
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(NOVNC_DIR)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    const stat = fs.statSync(resolved)
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'not a file' }, { status: 404 })
    }

    const ext = path.extname(resolved).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    const body = fs.readFileSync(resolved)

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'ALLOWALL',
        'Content-Security-Policy': '',
      },
    })
  } catch {
    return NextResponse.json({ error: 'file not found' }, { status: 404 })
  }
}
