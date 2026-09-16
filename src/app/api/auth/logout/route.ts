import { NextRequest, NextResponse } from 'next/server'
import {
  verifySessionToken,
  extractSessionToken,
  getSessionId,
  SESSION_COOKIE_NAME,
} from '@/lib/auth-server'
import { lockSession } from '@/lib/crypto-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout
 * Clears the session cookie AND wipes the in-memory encryption key for this session.
 * The encryption key is gone — ciphertext files remain but can't be decrypted
 * until the user logs in again with the correct password.
 */
export async function POST(req: NextRequest) {
  // Verify caller is currently authenticated
  const token = extractSessionToken(req)
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 })
  }
  // Wipe the encryption key from memory
  const sid = getSessionId(token)
  if (sid) {
    lockSession(sid)
  }
  const res = NextResponse.json({ ok: true, message: 'Logged out. Encryption key wiped from memory.' })
  res.cookies.delete(SESSION_COOKIE_NAME)
  return res
}
