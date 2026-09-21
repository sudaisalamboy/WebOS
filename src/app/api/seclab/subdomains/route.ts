import { NextRequest, NextResponse } from 'next/server'
import https from 'node:https'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Passive subdomain finder via Certificate Transparency logs (crt.sh).
 * No active scanning — purely queries public CT log databases.
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const domain = req.nextUrl.searchParams.get('domain')
  const includeExpired = req.nextUrl.searchParams.get('includeExpired') === 'true'

  if (!domain) {
    return NextResponse.json({ error: 'domain query param required' }, { status: 400 })
  }
  const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0].trim()

  try {
    const url = `https://crt.sh/?q=%25.${encodeURIComponent(cleanDomain)}&output=json`

    const data = await new Promise<string>((resolve, reject) => {
      const r = https.get(
        url,
        {
          timeout: 25000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SecLab/1.0; Security Research)',
            'Accept': 'application/json',
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
          res.on('error', reject)
        }
      )
      r.on('error', reject)
      r.on('timeout', () => {
        r.destroy()
        reject(new Error('crt.sh request timed out (try again — CT logs can be slow)'))
      })
    })

    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return NextResponse.json(
        { error: 'crt.sh returned non-JSON response', raw: data.slice(0, 500), domain: cleanDomain },
        { status: 502 }
      )
    }

    type CtRecord = {
      issuer_ca_id?: number
      issuer_name?: string
      common_name?: string
      name_value?: string
      id?: number
      entry_timestamp?: string
      not_before?: string
      not_after?: string
      serial_number?: string
    }
    const records = parsed as CtRecord[]

    // Extract unique subdomains from name_value (which may have multiple lines)
    const subdomains = new Map<string, { firstSeen: string; lastSeen: string; count: number; expired: boolean }>()
    for (const r of records) {
      if (!r.name_value) continue
      for (let name of r.name_value.split('\n')) {
        name = name.trim().toLowerCase().replace(/^\*\./, '') // strip wildcard
        if (!name || !name.endsWith(cleanDomain)) continue
        const existing = subdomains.get(name)
        const expired = r.not_after ? new Date(r.not_after) < new Date() : false
        if (!includeExpired && expired) continue
        if (existing) {
          existing.count++
          existing.firstSeen = r.not_before && r.not_before < existing.firstSeen ? r.not_before : existing.firstSeen
          existing.lastSeen = r.not_after && r.not_after > existing.lastSeen ? r.not_after : existing.lastSeen
          existing.expired = existing.expired && expired
        } else {
          subdomains.set(name, {
            firstSeen: r.not_before ?? '',
            lastSeen: r.not_after ?? '',
            count: 1,
            expired,
          })
        }
      }
    }

    const subdomainList = Array.from(subdomains.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({
      domain: cleanDomain,
      source: 'crt.sh (Certificate Transparency logs)',
      total: subdomainList.length,
      subdomains: subdomainList,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, domain: cleanDomain },
      { status: 502 }
    )
  }
}
