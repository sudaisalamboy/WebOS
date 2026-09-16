import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionId } from '@/lib/auth-server'
import { isSessionUnlocked, deleteEncryptedFile } from '@/lib/crypto-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DeleteBody {
  name?: string
}

/** POST /api/enc/delete — delete an encrypted file by name. */
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

  let body: DeleteBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { name } = body
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  try {
    deleteEncryptedFile(name)
    return NextResponse.json({ ok: true, message: 'Deleted', name })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
