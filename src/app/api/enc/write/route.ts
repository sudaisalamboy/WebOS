import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionId } from '@/lib/auth-server'
import { isSessionUnlocked, writeEncryptedFile } from '@/lib/crypto-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface WriteBody {
  name?: string
  content?: string
}

/**
 * POST /api/enc/write
 * Encrypt the plaintext content + store as ciphertext.
 *
 * The ciphertext is stored on disk in /home/z/my-project/.enc-files/<name>.enc
 * Even if someone reads that file, they only see encrypted bytes (no key).
 */
export async function POST(req: NextRequest) {
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

  let body: WriteBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { name, content } = body
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
  }

  try {
    writeEncryptedFile(sid, name, content)
    return NextResponse.json({
      ok: true,
      message: 'Encrypted + stored',
      name,
      ciphertextSize: content.length + 28, // IV(12) + tag(16) = 28 overhead
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
