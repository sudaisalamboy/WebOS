import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const execFileAsync = promisify(execFile)

function parseWhois(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  let currentKey = ''

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('%') || trimmed.startsWith('#')) continue

    // Match "Key: Value" or "Key........Value"
    const m = trimmed.match(/^([a-zA-Z][a-zA-Z\s\-_]+?):\s*(.+)$/)
    if (m) {
      const key = m[1].trim().toLowerCase().replace(/\s+/g, '_')
      const value = m[2].trim()
      if (result[key]) {
        result[key] += '\n' + value
      } else {
        result[key] = value
      }
      currentKey = key
    } else if (currentKey && trimmed) {
      // Continuation of previous value
      result[currentKey] += '\n' + trimmed
    }
  }
  return result
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const domain = req.nextUrl.searchParams.get('domain')
  if (!domain) {
    return NextResponse.json({ error: 'domain query param required' }, { status: 400 })
  }
  const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0].trim()

  try {
    // Try whois command first (most reliable)
    let rawWhois = ''
    let usedServer = ''
    try {
      // Use absolute path because whois isn't on default PATH in this env
      const whoisBin = '/home/z/my-project/seclab-tools/root/usr/bin/whois'
      const { stdout } = await execFileAsync(whoisBin, [cleanDomain], { timeout: 20000 })
      rawWhois = stdout
      // Extract the whois server from the output
      const serverMatch = stdout.match(/whois:\s*(\S+)/i)
      if (serverMatch) usedServer = serverMatch[1]
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      rawWhois = e.stderr ?? e.message ?? 'whois command failed'
    }

    // Fallback: if whois didn't return anything useful, try fetching from a public API
    if (!rawWhois || rawWhois.length < 100) {
      try {
        const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(cleanDomain)}`, {
          signal: AbortSignal.timeout(15000),
          headers: { 'Accept': 'application/rdap+json' },
        })
        if (res.ok) {
          const data = await res.json()
          return NextResponse.json({
            domain: cleanDomain,
            source: 'rdap.org (RDAP)',
            parsed: data,
            raw: JSON.stringify(data, null, 2),
          })
        }
      } catch {
        // ignore — fall through to returning whois output
      }
    }

    const parsed = parseWhois(rawWhois)

    // Extract key fields with common variations
    const registrar = parsed.registrar ?? parsed.registration_service_provider ?? null
    const creationDate = parsed.creation_date ?? parsed.created ?? parsed.registered ?? null
    const expiryDate = parsed.registry_expiry_date ?? parsed.expiry_date ?? parsed.paid_till ?? null
    const updatedDate = parsed.updated_date ?? parsed.last_updated ?? null
    const nameServers = (parsed.name_server ?? parsed.nserver ?? '')
      .split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    const status = (parsed.domain_status ?? parsed.status ?? parsed.epp_status ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const registrantOrg = parsed.registrant_organization ?? parsed.org ?? null
    const registrantCountry = parsed.registrant_country ?? parsed.country ?? null
    const abuseEmail = parsed.registrar_abuse_contact_email ?? parsed.abuse_email ?? null
    const abusePhone = parsed.registrar_abuse_contact_phone ?? parsed.abuse_phone ?? null

    // Calculate days until expiry
    let daysUntilExpiry: number | null = null
    if (expiryDate) {
      const d = new Date(expiryDate.split('\n')[0])
      if (!isNaN(d.getTime())) {
        daysUntilExpiry = Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      }
    }

    return NextResponse.json({
      domain: cleanDomain,
      source: usedServer ? `whois (${usedServer})` : 'whois',
      registrar,
      creationDate,
      expiryDate,
      daysUntilExpiry,
      updatedDate,
      nameServers,
      status,
      registrantOrg,
      registrantCountry,
      abuseEmail,
      abusePhone,
      parsed,
      raw: rawWhois,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, domain: cleanDomain },
      { status: 502 }
    )
  }
}
