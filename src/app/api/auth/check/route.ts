import { NextRequest, NextResponse } from 'next/server'
import { isPasswordSet, verifySessionToken, extractSessionToken } from '@/lib/auth-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/check
 * Returns:
 *   { passwordSet: bool, authenticated: bool }
 *
 * This is the ONLY auth endpoint that doesn't require authentication —
 * the login screen needs to know whether to show "Setup" or "Login" mode.
 */
export async function GET(req: NextRequest) {
  const passwordSet = isPasswordSet()
  const token = extractSessionToken(req)
  const authenticated = passwordSet && verifySessionToken(token)

  return NextResponse.json({
    passwordSet,
    authenticated,
  })
}
