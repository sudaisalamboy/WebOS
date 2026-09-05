import { NextRequest, NextResponse } from 'next/server'
import {
  verifyPassword,
  isPasswordSet,
  createSessionToken,
  getSessionId,
  SESSION_COOKIE_NAME,
} from '@/lib/auth-server'
import { unlockEncryption } from '@/lib/crypto-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface LoginBody {
  password?: string
}

// Rate limiting — block brute force attempts
const attempts = new Map<string, { count: number; lastAttempt: number }>()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 60 * 1000 // 1 minute
const LOCKOUT_MS = 5 * 60 * 1000 // 5 minute lockout after exceeding

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (entry) {
    if (entry.count >= MAX_ATTEMPTS) {
      const elapsed = now - entry.lastAttempt
      if (elapsed < LOCKOUT_MS) {
        return { allowed: false, retryAfter: Math.ceil((LOCKOUT_MS - elapsed) / 1000) }
      }
      // Reset window
      attempts.delete(ip)
    }
  }
  return { allowed: true }
}

function recordFailedAttempt(ip: string) {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (entry && now - entry.lastAttempt < WINDOW_MS) {
    entry.count++
    entry.lastAttempt = now
  } else {
    attempts.set(ip, { count: 1, lastAttempt: now })
  }
}

function clearAttempts(ip: string) {
  attempts.delete(ip)
}

/**
 * POST /api/auth/login
 * Verify password + return session token on success.
 */
export async function POST(req: NextRequest) {
  if (!isPasswordSet()) {
    return NextResponse.json(
      { error: 'No password set. Use /api/auth/setup first.' },
      { status: 400 }
    )
  }

  // Rate limit by client IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
  const rl = checkRateLimit(ip)
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many failed attempts. Try again in ${rl.retryAfter}s.`,
        retryAfter: rl.retryAfter,
      },
      { status: 429 }
    )
  }

  let body: LoginBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const password = body.password
  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'password is required' }, { status: 400 })
  }

  // Verify (this is the slow bcrypt.compare call — ~100ms)
  const valid = await verifyPassword(password)
  if (!valid) {
    recordFailedAttempt(ip)
    const entry = attempts.get(ip)
    const remaining = MAX_ATTEMPTS - (entry?.count ?? 0)
    return NextResponse.json(
      {
        error: 'Incorrect password',
        attemptsRemaining: Math.max(0, remaining),
      },
      { status: 401 }
    )
  }

  clearAttempts(ip)
  const token = createSessionToken()
  const sid = getSessionId(token)!

  // Derive encryption key from password + cache it for this session
  // (in-memory only — cleared on logout or server restart)
  const encUnlocked = unlockEncryption(sid, password)
  if (!encUnlocked) {
    // Shouldn't happen since password just verified, but defensive check
    return NextResponse.json(
      { error: 'Password verified but encryption unlock failed. Please try again.' },
      { status: 500 }
    )
  }

  const res = NextResponse.json({
    ok: true,
    authenticated: true,
    encrypted: true,
    token, // also send in body so client can store in localStorage
    credits: {
      madeBy: 'Sudais Alam',
      builtWith: 'AIFuzX'
    }
  })
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60, // 24 hours
    path: '/',
  })
  return res
}
