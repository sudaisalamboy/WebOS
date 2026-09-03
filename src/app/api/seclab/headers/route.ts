import { NextRequest, NextResponse } from 'next/server'
import https from 'node:https'
import http from 'node:http'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface HeaderCheck {
  name: string
  present: boolean
  value: string | null
  severity: 'good' | 'warn' | 'bad' | 'info'
  recommendation?: string
}

function analyzeSecurityHeaders(headers: Record<string, string>): HeaderCheck[] {
  const checks: HeaderCheck[] = []
  const get = (name: string) =>
    headers[name.toLowerCase()] ?? headers[name] ?? null

  // 1. Content-Security-Policy
  const csp = get('content-security-policy')
  checks.push({
    name: 'Content-Security-Policy',
    present: !!csp,
    value: csp,
    severity: csp ? 'good' : 'bad',
    recommendation: csp
      ? undefined
      : "Missing CSP. Add a strict Content-Security-Policy header to prevent XSS, data injection, and other attacks. Example: default-src 'self'; script-src 'self'",
  })

  // 2. Strict-Transport-Security
  const hsts = get('strict-transport-security')
  checks.push({
    name: 'Strict-Transport-Security (HSTS)',
    present: !!hsts,
    value: hsts,
    severity: hsts ? 'good' : 'warn',
    recommendation: hsts
      ? undefined
      : 'Missing HSTS. Force HTTPS for at least 1 year: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
  })

  // 3. X-Frame-Options
  const xfo = get('x-frame-options')
  checks.push({
    name: 'X-Frame-Options',
    present: !!xfo,
    value: xfo,
    severity: xfo ? 'good' : 'warn',
    recommendation: xfo
      ? undefined
      : 'Missing X-Frame-Options. Prevents clickjacking: X-Frame-Options: DENY (or SAMEORIGIN). Modern equivalent: CSP frame-ancestors directive.',
  })

  // 4. X-Content-Type-Options
  const xcto = get('x-content-type-options')
  checks.push({
    name: 'X-Content-Type-Options',
    present: !!xcto,
    value: xcto,
    severity: xcto === 'nosniff' ? 'good' : 'warn',
    recommendation:
      xcto === 'nosniff'
        ? undefined
        : 'Set to "nosniff" to prevent MIME-type sniffing attacks: X-Content-Type-Options: nosniff',
  })

  // 5. Referrer-Policy
  const referrer = get('referrer-policy')
  checks.push({
    name: 'Referrer-Policy',
    present: !!referrer,
    value: referrer,
    severity: referrer ? 'good' : 'warn',
    recommendation: referrer
      ? undefined
      : "Missing Referrer-Policy. Control referrer info leakage: Referrer-Policy: strict-origin-when-cross-origin",
  })

  // 6. Permissions-Policy
  const permissions = get('permissions-policy')
  checks.push({
    name: 'Permissions-Policy',
    present: !!permissions,
    value: permissions,
    severity: permissions ? 'good' : 'info',
    recommendation: permissions
      ? undefined
      : 'Optional: Restrict browser features (camera, microphone, geolocation, etc.): Permissions-Policy: camera=(), microphone=(), geolocation=()',
  })

  // 7. X-XSS-Protection (deprecated but check)
  const xss = get('x-xss-protection')
  checks.push({
    name: 'X-XSS-Protection',
    present: !!xss,
    value: xss,
    severity: xss ? 'info' : 'info',
    recommendation:
      'This header is deprecated and replaced by CSP. If set, use "0" to disable the buggy auditor, or just rely on CSP.',
  })

  // 8. Cross-Origin headers
  const coop = get('cross-origin-opener-policy')
  const coep = get('cross-origin-embedder-policy')
  const corp = get('cross-origin-resource-policy')
  checks.push({
    name: 'Cross-Origin-Opener-Policy',
    present: !!coop,
    value: coop,
    severity: coop ? 'good' : 'info',
    recommendation: coop
      ? undefined
      : "Optional: Isolate browsing context: Cross-Origin-Opener-Policy: same-origin",
  })
  checks.push({
    name: 'Cross-Origin-Embedder-Policy',
    present: !!coep,
    value: coep,
    severity: coep ? 'good' : 'info',
    recommendation: coep
      ? undefined
      : "Optional: Enable cross-origin isolation: Cross-Origin-Embedder-Policy: require-corp",
  })
  checks.push({
    name: 'Cross-Origin-Resource-Policy',
    present: !!corp,
    value: corp,
    severity: corp ? 'good' : 'info',
    recommendation: corp
      ? undefined
      : "Optional: Restrict resource loading: Cross-Origin-Resource-Policy: same-origin",
  })

  // 9. Server header (info leak)
  const server = get('server')
  checks.push({
    name: 'Server',
    present: !!server,
    value: server,
    severity: server ? 'warn' : 'good',
    recommendation: server
      ? `Server header reveals software/version ("${server}"). Consider removing or obfuscating to reduce fingerprinting.`
      : undefined,
  })

  // 10. X-Powered-By (info leak)
  const xpb = get('x-powered-by')
  checks.push({
    name: 'X-Powered-By',
    present: !!xpb,
    value: xpb,
    severity: xpb ? 'warn' : 'good',
    recommendation: xpb
      ? `X-Powered-By reveals tech stack ("${xpb}"). Disable in your framework (Express: app.disable('x-powered-by'), Next.js: removed by default).`
      : undefined,
  })

  return checks
}

function fetchUrl(url: string, timeoutMs = 12000): Promise<{
  status: number
  statusText: string
  headers: Record<string, string>
  finalUrl: string
  redirectChain: string[]
}> {
  return new Promise((resolve, reject) => {
    const redirectChain: string[] = []
    const lib = url.startsWith('https:') ? https : http

    const doRequest = (targetUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }

      const req = lib.get(
        targetUrl,
        {
          timeout: timeoutMs,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SecLab/1.0; Security Research)',
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          },
          // Don't validate cert so we can still grade the headers
          rejectUnauthorized: false,
        } as https.RequestOptions,
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
            const next = new URL(res.headers.location, targetUrl).href
            redirectChain.push(next)
            res.resume()
            doRequest(next, redirectCount + 1)
            return
          }

          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') headers[k.toLowerCase()] = v
            else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ')
          }
          // Drain the body
          res.resume()
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers,
            finalUrl: targetUrl,
            redirectChain,
          })
        }
      )
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Request timed out'))
      })
    }
    doRequest(url)
  })
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const urlParam = req.nextUrl.searchParams.get('url')
  if (!urlParam) {
    return NextResponse.json({ error: 'url query param required' }, { status: 400 })
  }

  let target = urlParam.trim()
  if (!/^https?:\/\//i.test(target)) {
    target = 'https://' + target
  }

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 })
  }

  try {
    const result = await fetchUrl(parsed.href)
    const securityChecks = analyzeSecurityHeaders(result.headers)

    // Calculate security score (0-100)
    const good = securityChecks.filter((c) => c.severity === 'good').length
    const warn = securityChecks.filter((c) => c.severity === 'warn').length
    const bad = securityChecks.filter((c) => c.severity === 'bad').length
    const total = securityChecks.length
    const score = Math.round(((good * 1 + (total - warn - bad - good) * 0.5) / total) * 100)

    return NextResponse.json({
      url: result.finalUrl,
      originalUrl: parsed.href,
      status: result.status,
      statusText: result.statusText,
      redirectChain: result.redirectChain,
      allHeaders: result.headers,
      securityChecks,
      score,
      summary: {
        good,
        warn,
        bad,
        total,
      },
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: (err as Error).message,
        url: parsed.href,
        hint: 'Make sure the URL is reachable and uses http or https',
      },
      { status: 502 }
    )
  }
}
