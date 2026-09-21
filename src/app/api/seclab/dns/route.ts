import { NextRequest, NextResponse } from 'next/server'
import dns from 'node:dns'
import { promisify } from 'node:util'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

const resolveAny = promisify(dns.resolveAny)
const resolve = promisify(dns.resolve)
const resolveTxt = promisify(dns.resolveTxt)
const resolveMx = promisify(dns.resolveMx)
const resolveSrv = promisify(dns.resolveSrv)
const lookup = promisify(dns.lookup)

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'NS', 'MX', 'TXT', 'SOA', 'PTR', 'SRV'] as const

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const domain = req.nextUrl.searchParams.get('domain')
  const type = (req.nextUrl.searchParams.get('type') ?? 'all').toUpperCase()

  if (!domain) {
    return NextResponse.json({ error: 'domain query param required' }, { status: 400 })
  }

  // Strip protocol/path if user pasted a URL
  const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0].trim()

  const results: Record<string, unknown> = { domain: cleanDomain, records: {} }

  try {
    if (type === 'ALL') {
      // Resolve all record types in parallel
      const entries = await Promise.allSettled(
        RECORD_TYPES.map(async (rt) => {
          try {
            switch (rt) {
              case 'A': return [rt, await resolve(cleanDomain, 'A')]
              case 'AAAA': return [rt, await resolve(cleanDomain, 'AAAA')]
              case 'CNAME': return [rt, await resolve(cleanDomain, 'CNAME')]
              case 'NS': return [rt, await resolve(cleanDomain, 'NS')]
              case 'MX': return [rt, await resolveMx(cleanDomain)]
              case 'TXT': return [rt, (await resolveTxt(cleanDomain)).map((arr) => arr.join(''))]
              case 'SOA': return [rt, await resolve(cleanDomain, 'SOA')]
              case 'PTR': return [rt, await resolve(cleanDomain, 'PTR')]
              case 'SRV': return [rt, await resolveSrv(cleanDomain)]
            }
          } catch (err) {
            return [rt, { error: (err as Error).message }]
          }
        })
      )

      for (const entry of entries) {
        if (entry.status === 'fulfilled' && entry.value) {
          const [rt, value] = entry.value as [string, unknown]
          results.records[rt] = value
        }
      }
    } else {
      // Single record type
      let value: unknown
      try {
        switch (type) {
          case 'A': value = await resolve(cleanDomain, 'A'); break
          case 'AAAA': value = await resolve(cleanDomain, 'AAAA'); break
          case 'CNAME': value = await resolve(cleanDomain, 'CNAME'); break
          case 'NS': value = await resolve(cleanDomain, 'NS'); break
          case 'MX': value = await resolveMx(cleanDomain); break
          case 'TXT': value = (await resolveTxt(cleanDomain)).map((arr) => arr.join('')); break
          case 'SOA': value = await resolve(cleanDomain, 'SOA'); break
          case 'SRV': value = await resolveSrv(cleanDomain); break
          case 'PTR': value = await resolve(cleanDomain, 'PTR'); break
          default: return NextResponse.json({ error: `unsupported record type: ${type}` }, { status: 400 })
        }
        results.records[type] = value
      } catch (err) {
        results.records[type] = { error: (err as Error).message }
      }
    }

    // Also include a basic IP lookup
    try {
      const ip = await lookup(cleanDomain)
      results.ip = ip.address
      results.family = ip.family
    } catch (err) {
      results.ip = null
      results.ipError = (err as Error).message
    }

    return NextResponse.json(results)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, domain: cleanDomain },
      { status: 502 }
    )
  }
}
