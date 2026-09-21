import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { loadCameraConfig, isCameraEnabled, DEFAULT_CONFIG } from '@/lib/camera-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPLOAD_DIR = '/home/z/my-project/upload/vnc-uploads'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp',
}

export async function GET() {
  const enabled = isCameraEnabled()
  const config = loadCameraConfig() || DEFAULT_CONFIG

  let sourceUrl = config.sourceUrl
  if (sourceUrl && sourceUrl.includes('/api/vnc/serve/')) {
    try {
      const fileName = decodeURIComponent(sourceUrl.split('/api/vnc/serve/')[1] || '')
      const filePath = path.join(UPLOAD_DIR, fileName)
      if (fs.existsSync(filePath)) {
        const ext = path.extname(fileName).toLowerCase()
        const mime = MIME[ext] || 'application/octet-stream'
        const data = fs.readFileSync(filePath)
        const base64 = data.toString('base64')
        sourceUrl = `data:${mime};base64,${base64}`
      }
    } catch (e) {}
  }

  return NextResponse.json({
    config: { ...config, enabled, sourceUrl },
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store',
    },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  })
}
