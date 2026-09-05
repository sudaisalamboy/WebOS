import { NextRequest, NextResponse } from 'next/server'
import {
  changePassword,
  isPasswordSet,
  createSessionToken,
  SESSION_COOKIE_NAME,
} from '@/lib/auth-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ChangeBody {
  currentPassword?: string
  newPassword?: string
}

/**
 * POST /api/auth/change
 *
 * Change password — requires the CURRENT password to be correct.
 * Does NOT require an active session token (because the user may be on the
 * login screen wanting to change password before logging in).
 *
 * The current password check is the security gate here — if you know the
 * current password, you're authorized to change it.
 *
 * After change: server secret rotates (all other sessions invalidated),
 * and a fresh session token is issued to the caller.
 */
export async function POST(req: NextRequest) {
  if (!isPasswordSet()) {
    return NextResponse.json(
      { error: 'No password set. Use /api/auth/setup instead.' },
      { status: 400 }
    )
  }

  let body: ChangeBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { currentPassword, newPassword } = body
  if (!currentPassword || typeof currentPassword !== 'string') {
    return NextResponse.json({ error: 'currentPassword is required' }, { status: 400 })
  }
  if (!newPassword || typeof newPassword !== 'string') {
    return NextResponse.json({ error: 'newPassword is required' }, { status: 400 })
  }

  try {
    // changePassword() internally calls verifyPassword(currentPlaintext)
    // — this is the security gate. If currentPassword is wrong, it throws.
    await changePassword(currentPassword, newPassword)

    // Issue a fresh session token (old ones are now invalid because secret rotated).
    // Caller is now logged in with the new password.
    const newToken = createSessionToken()
    const res = NextResponse.json({
      ok: true,
      message: 'Password changed. All other sessions have been logged out.',
      authenticated: true,
      token: newToken,
    })
    res.cookies.set(SESSION_COOKIE_NAME, newToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60,
      path: '/',
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
