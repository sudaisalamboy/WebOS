import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionId } from '@/lib/auth-server'
import { isSessionUnlocked, listEncryptedFiles, isEncryptionSetup } from '@/lib/crypto-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/enc/list
 *
 * List encrypted files. Returns METADATA ONLY (name, ciphertext size, modified time).
 * Does NOT decrypt any content.
 *
 * This is the "form-only view" — even if someone gets server access without the password,
 * they can only see file names and sizes, never the plaintext content.
 *
 * Requires:
 *   - Valid session token (in cookie)
 *   - Encryption unlocked for this session (i.e. user has logged in with correct password)
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

  const files = listEncryptedFiles()
  return NextResponse.json({
    files,
    total: files.length,
    encryptionSetup: isEncryptionSetup(),
  })
}
