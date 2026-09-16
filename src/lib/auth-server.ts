import bcrypt from 'bcryptjs'
import { randomBytes, createHmac } from 'node:crypto'
import path from 'node:path'
import { existsSync, mkdirSync, chmodSync, writeFileSync, readFileSync } from 'node:fs'
import { SESSION_COOKIE_NAME, SESSION_TOKEN_HEADER } from './auth-shared'



// Re-export for backwards compatibility (routes that imported these from auth-server)
export { SESSION_COOKIE_NAME, SESSION_TOKEN_HEADER }

/**
 * WebOS Authentication — server-side helpers.
 *
 * Design:
 * - Password is hashed with bcrypt (10 rounds) — one-way hash, CANNOT be decrypted.
 *   Even if the hash file is stolen, attackers must brute-force (which is slow
 *   by design — ~100ms per guess with 10 rounds).
 * - The bcrypt hash + a per-installation HMAC secret are stored OUTSIDE the
 *   user-files sandbox (so they can't be accessed via the File Explorer).
 * - Sessions use HMAC-signed tokens (stateless, no DB needed). Tokens contain
 *   an expiry + a random session id, signed with the server secret.
 * - Tokens are NOT stored anywhere — verification is purely signature + expiry.
 *   This means we can't revoke individual tokens (logout just clears the cookie),
 *   but for a single-user OS this is acceptable. Use short expiry (24h) + rotate
 *   the server secret to invalidate all sessions if needed.
 */

const AUTH_DIR = '/home/z/my-project/.auth'
const HASH_FILE = path.join(AUTH_DIR, 'password.hash')
const SECRET_FILE = path.join(AUTH_DIR, 'server.secret')
const SALT_ROUNDS = 10
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

function ensureAuthDir() {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true })
    // chmod 700 — only owner can read/write
    chmodSync(AUTH_DIR, 0o700)
  }
}

/** Get or create the per-installation HMAC secret (used to sign session tokens). */
function getServerSecret(): string {
  ensureAuthDir()
  if (!existsSync(SECRET_FILE)) {
    const secret = randomBytes(64).toString('hex')
    writeFileSync(SECRET_FILE, secret, { mode: 0o600 })
    return secret
  }
  return readFileSync(SECRET_FILE, 'utf8').trim()
}

/** Check if a password has been set up. */
export function isPasswordSet(): boolean {
  return existsSync(HASH_FILE) && readFileSync(HASH_FILE, 'utf8').trim().length > 0
}

/** Set the password (first time only — fails if already set, use changePassword instead). */
export async function setPassword(plaintext: string): Promise<void> {
  if (plaintext.length < 4) {
    throw new Error('Password must be at least 4 characters')
  }
  if (plaintext.length > 1024) {
    throw new Error('Password too long (max 1024 characters)')
  }
  ensureAuthDir()
  if (isPasswordSet()) {
    throw new Error('Password is already set. Use changePassword instead.')
  }
  // bcrypt hash — this is what gets stored. Cannot be reversed.
  const hash = await bcrypt.hash(plaintext, SALT_ROUNDS)
  writeFileSync(HASH_FILE, hash, { mode: 0o600 })
}

/** Verify a plaintext password against the stored hash. */
export async function verifyPassword(plaintext: string): Promise<boolean> {
  if (!isPasswordSet()) return false
  const hash = readFileSync(HASH_FILE, 'utf8').trim()
  try {
    return await bcrypt.compare(plaintext, hash)
  } catch {
    return false
  }
}

/** Change the password — requires the current password to be correct. */
export async function changePassword(
  currentPlaintext: string,
  newPlaintext: string
): Promise<void> {
  if (newPlaintext.length < 4) {
    throw new Error('New password must be at least 4 characters')
  }
  if (newPlaintext.length > 1024) {
    throw new Error('New password too long (max 1024 characters)')
  }
  if (!(await verifyPassword(currentPlaintext))) {
    throw new Error('Current password is incorrect')
  }
  ensureAuthDir()
  const hash = await bcrypt.hash(newPlaintext, SALT_ROUNDS)
  writeFileSync(HASH_FILE, hash, { mode: 0o600 })
  // Rotate server secret to invalidate all existing sessions
  const newSecret = randomBytes(64).toString('hex')
  writeFileSync(SECRET_FILE, newSecret, { mode: 0o600 })
}

/** Session token format: base64url(payload).base64url(signature) */
interface SessionPayload {
  sid: string // random session id
  iat: number // issued at (ms)
  exp: number // expiry (ms)
}

/** Create a new signed session token (called after successful login). */
export function createSessionToken(): string {
  const secret = getServerSecret()
  const now = Date.now()
  const payload: SessionPayload = {
    sid: randomBytes(16).toString('hex'),
    iat: now,
    exp: now + SESSION_EXPIRY_MS,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

/**
 * Extract the session ID (sid) from a valid session token.
 * Returns null if token is invalid or expired.
 * Used to look up the session's encryption key in the crypto module.
 */
export function getSessionId(token: string | undefined | null): string | null {
  if (!verifySessionToken(token)) return null
  try {
    const parts = token.split('.')
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as SessionPayload
    return payload.sid ?? null
  } catch {
    return null
  }
}

/** Verify a session token's signature + expiry. Returns true if valid. */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, sig] = parts
  if (!payloadB64 || !sig) return false

  const secret = getServerSecret()
  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url')

  // Constant-time comparison to prevent timing attacks
  if (sig.length !== expectedSig.length) return false
  let diff = 0
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i)
  }
  if (diff !== 0) return false

  // Check expiry
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPayload
    if (typeof payload.exp !== 'number') return false
    if (Date.now() > payload.exp) return false
    return true
  } catch {
    return false
  }
}

/** Force-invalidate ALL sessions by rotating the server secret. */
export function invalidateAllSessions(): void {
  ensureAuthDir()
  const newSecret = randomBytes(64).toString('hex')
  writeFileSync(SECRET_FILE, newSecret, { mode: 0o600 })
}

/** Get session token from request — checks cookie first, then header (for fetch calls). */
export function extractSessionToken(req: Request): string | null {
  // Check cookie
  const cookieHeader = req.headers.get('cookie') ?? ''
  const cookieMatch = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))
  if (cookieMatch) return cookieMatch[1]

  // Check custom header (used by fetch from client-side)
  const headerVal = req.headers.get(SESSION_TOKEN_HEADER)
  if (headerVal) return headerVal

  return null
}
