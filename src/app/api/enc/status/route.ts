import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionId } from '@/lib/auth-server'
import { isSessionUnlocked, isEncryptionSetup } from '@/lib/crypto-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/enc/status
 * Check if encryption is set up + if this session has its key unlocked.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const authenticated = verifySessionToken(token)
  const sid = authenticated ? getSessionId(token) : null
  const unlocked = !!(sid && isSessionUnlocked(sid))

  return NextResponse.json({
    encryptionSetup: isEncryptionSetup(),
    authenticated,
    unlocked, // true = encryption key is in memory, can decrypt/encrypt
  })
}
