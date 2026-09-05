import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPLOAD_DIR = '/home/z/my-project/upload/vnc-uploads'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp',
}

/**
 * GET /api/vnc/serve/[...path]
 *
 * Serves uploaded media files (images, videos) for the camera extension.
 * NO AUTH REQUIRED — the Chrome extension's Image/Video elements need to load
 * these without cookies, so we can't require auth.
 *
 * CORS is enabled so any website (webcamtests.com, etc.) can load the media.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params
  const fileName = path.basename(segments.join('/'))
  const filePath = path.join(UPLOAD_DIR, fileName)

  if (!fs.existsSync(filePath)) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const ext = path.extname(fileName).toLowerCase()
  const mime = MIME[ext] || 'application/octet-stream'
  const data = fs.readFileSync(filePath)

  return new NextResponse(data, {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(data.length),
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  })
}
