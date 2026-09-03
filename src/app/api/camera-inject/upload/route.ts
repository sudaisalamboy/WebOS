import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UPLOAD_DIR = '/home/z/my-project/upload/vnc-uploads'

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const action = body.action || 'upload'
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

  if (action === 'delete') {
    const safeName = path.basename(body.filename || '')
    const filePath = path.join(UPLOAD_DIR, safeName)
    if (!fs.existsSync(filePath)) return NextResponse.json({ error: 'file not found' }, { status: 404 })
    try { fs.unlinkSync(filePath); return NextResponse.json({ ok: true, deleted: safeName }) }
    catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 500 }) }
  }

  const safeName = path.basename(body.filename || '')
  const data = body.data
  if (!safeName || !data) return NextResponse.json({ error: 'filename and data required' }, { status: 400 })

  try {
    const buffer = Buffer.from(data, 'base64')
    fs.writeFileSync(path.join(UPLOAD_DIR, safeName), buffer)
    const stat = fs.statSync(path.join(UPLOAD_DIR, safeName))
    const ext = path.extname(safeName).toLowerCase()
    const type = ['.mp4', '.webm', '.ogg', '.mov', '.mkv'].includes(ext) ? 'video' :
                ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext) ? 'image' : 'file'
    return NextResponse.json({ ok: true, filename: safeName, size: stat.size, type, url: `/api/vnc/serve/${encodeURIComponent(safeName)}` })
  } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 500 }) }
}
