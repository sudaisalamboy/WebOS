import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionId } from '@/lib/auth-server'
import { isSessionUnlocked, readEncryptedFile } from '@/lib/crypto-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/enc/read?name=filename
 *
 * Decrypt + return the plaintext content of an encrypted file.
 * Decryption happens in-memory using the session's cached encryption key.
 * Plaintext is sent only to the authenticated, unlocked session.
 */
export async function GET(req: NextRequest) {
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

  const name = req.nextUrl.searchParams.get('name')
  if (!name) {
    return NextResponse.json({ error: 'name query param required' }, { status: 400 })
  }

  try {
    const content = readEncryptedFile(sid, name)
    return NextResponse.json({ name, content })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 })
  }
}
