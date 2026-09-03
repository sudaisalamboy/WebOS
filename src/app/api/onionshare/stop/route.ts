import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getShares() {
  const createModule = await import('../create/route')
  return (createModule as unknown as { _shares: Map<string, unknown> })._shares
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  let body: { id?: string } = {}
  try { body = await req.json() } catch { /* allow empty */ }
  const id = body.id ?? new URL(req.url).searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const shares = await getShares()
  const share = shares?.get(id) as
    | { id: string; process?: { kill: (sig?: string) => void } | null; status: string }
    | undefined

  if (!share) {
    return NextResponse.json({ error: 'share not found' }, { status: 404 })
  }

  try {
    if (share.process) {
      share.process.kill('SIGTERM')
      // Give it a moment then SIGKILL if still alive
      setTimeout(() => {
        try { share.process?.kill('SIGKILL') } catch { /* already dead */ }
      }, 2000)
    }
    share.status = 'stopped'
    shares?.delete(id)
    return NextResponse.json({ ok: true, message: 'Share stopped' })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
