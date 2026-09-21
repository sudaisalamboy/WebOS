import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, isPasswordSet, SESSION_COOKIE_NAME } from '@/lib/auth-server'

/**
 * Helper for API routes — returns null if authenticated, or a 401 NextResponse if not.
 *
 * Usage:
 *   export async function GET(req: NextRequest) {
 *     const authError = requireAuth(req)
 *     if (authError) return authError
 *     // ... route logic
 *   }
 *
 * Special case: if no password is set yet (first-time setup), allow everything.
 */
export function requireAuth(req: NextRequest): NextResponse | null {
  // If no password is set yet, allow everything (first-time setup mode)
  if (!isPasswordSet()) return null

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (verifySessionToken(token)) return null

  return NextResponse.json(
    { error: 'Not authenticated. Please log in.', needsAuth: true },
    { status: 401 }
  )
}
