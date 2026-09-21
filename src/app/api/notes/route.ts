import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NOTE_ID = 'main'

/**
 * GET /api/notes — returns the shared note pad content.
 * Creates the row on first request (empty content).
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let note = await db.note.findUnique({ where: { id: NOTE_ID } })
  if (!note) {
    note = await db.note.create({ data: { id: NOTE_ID, content: '' } })
  }
  return NextResponse.json({ ok: true, content: note.content, updatedAt: note.updatedAt })
}

/**
 * POST /api/notes — saves the note content (full replace).
 * Body: { content: string }
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let body: { content?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const content = body.content ?? ''
  if (content.length > 100_000) {
    return NextResponse.json({ error: 'note too large (max 100KB)' }, { status: 413 })
  }

  const note = await db.note.upsert({
    where: { id: NOTE_ID },
    create: { id: NOTE_ID, content },
    update: { content },
  })
  return NextResponse.json({ ok: true, content: note.content, updatedAt: note.updatedAt })
}
