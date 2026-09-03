import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Access the in-memory shares map from the create route
async function getShares() {
  const createModule = await import('../create/route')
  return (createModule as unknown as { _shares: Map<string, unknown> })._shares
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const id = req.nextUrl.searchParams.get('id')
  const shares = await getShares()
  if (!shares) {
    return NextResponse.json({ shares: [] })
  }

  if (id) {
    const share = shares.get(id)
    if (!share) {
      return NextResponse.json({ error: 'share not found' }, { status: 404 })
    }
    // Return the share (without the process object, which isn't serializable)
    const { process: _process, ...rest } = share as Record<string, unknown>
    return NextResponse.json({ share: rest })
  }

  // List all shares (without process objects)
  const list = Array.from(shares.values()).map((s) => {
    const { process: _process, ...rest } = s as Record<string, unknown>
    return rest
  })
  return NextResponse.json({ shares: list })
}
