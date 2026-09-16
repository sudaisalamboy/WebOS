import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionId } from '@/lib/auth-server'
import { isSessionUnlocked, renameEncryptedFile } from '@/lib/crypto-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RenameBody {
  from?: string
  to?: string
}

/** POST /api/enc/rename — rename an encrypted file (no re-encryption needed). */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const sid = getSessionId(token)
  if (!sid || !isSessionUnlocked(sid)) {
    return NextResponse.json(
      { error: 'Encryption not unlocked. Please log in with your password.' },
      { status: 403 }
    )
  }

  let body: RenameBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { from, to } = body
  if (!from || typeof from !== 'string') {
    return NextResponse.json({ error: 'from is required' }, { status: 400 })
  }
  if (!to || typeof to !== 'string') {
    return NextResponse.json({ error: 'to is required' }, { status: 400 })
  }

  try {
    renameEncryptedFile(from, to)
    return NextResponse.json({ ok: true, message: 'Renamed', from, to })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
