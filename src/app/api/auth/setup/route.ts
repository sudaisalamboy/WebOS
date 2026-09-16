import { NextRequest, NextResponse } from 'next/server'
import {
  setPassword,
  isPasswordSet,
  createSessionToken,
  getSessionId,
  SESSION_COOKIE_NAME,
} from '@/lib/auth-server'
import { setupEncryption, unlockEncryption } from '@/lib/crypto-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SetupBody {
  password?: string
}

/**
 * POST /api/auth/setup
 * First-time password setup. Fails if password is already set.
 * Returns a session token on success.
 */
export async function POST(req: NextRequest) {
  // Block setup if password already exists
  if (isPasswordSet()) {
    return NextResponse.json(
      { error: 'Password is already set. Use /api/auth/change instead.' },
      { status: 409 }
    )
  }

  let body: SetupBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const password = body.password
  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'password is required' }, { status: 400 })
  }

  try {
    await setPassword(password)
    // Also set up the encryption salt + verification token using this password
    setupEncryption(password)
    const token = createSessionToken()
    const sid = getSessionId(token)!
    // Cache the encryption key for this session
    unlockEncryption(sid, password)
    const res = NextResponse.json({
      ok: true,
      message: 'Password set. You are now logged in.',
      authenticated: true,
      encrypted: true,
      token, // also send in body so client can store in localStorage
    })
    // Set HTTP-only cookie (also accessible by middleware)
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60, // 24 hours
      path: '/',
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
