import { NextRequest, NextResponse } from 'next/server'
import https from 'node:https'
import http from 'node:http'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 45

interface ScriptInfo {
  src: string
  inlineSize: number
  external: boolean
}

interface ExtractedEndpoint {
  url: string
  type: 'api' | 'relative' | 'absolute' | 'websocket'
  method?: string
  source: string
}

function fetchUrl(url: string, timeoutMs = 15000): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(
      url,
      {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SecLab/1.0; Security Research)',
          'Accept': '*/*',
        },
        rejectUnauthorized: false,
      } as https.RequestOptions,
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          chunks.push(c)
          if (chunks.reduce((a, b) => a + b.length, 0) > 5 * 1024 * 1024) {
            res.destroy()
          }
        })
        res.on('end', () => {
          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') headers[k.toLowerCase()] = v
            else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ')
          }
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
  })
}

/** Extract all <script src="..."> and inline script contents from HTML */
function extractScripts(html: string): { scripts: ScriptInfo[]; inlineContents: string[] } {
  const scripts: ScriptInfo[] = []
  const inlineContents: string[] = []

  // Match <script src="..."> OR <script>...</script>
  const scriptRegex = /<script\b([^>]*)>([^<]*)<\/script>|<script\b([^>]*)\/?>/gi
  let m
  while ((m = scriptRegex.exec(html)) !== null) {
    const attrs = (m[1] ?? m[3] ?? '').trim()
    const inlineContent = m[2] ?? ''
    const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
    if (srcMatch) {
      scripts.push({ src: srcMatch[1], inlineSize: 0, external: true })
    } else if (inlineContent.trim()) {
      scripts.push({ src: '(inline)', inlineSize: inlineContent.length, external: false })
      inlineContents.push(inlineContent)
    }
  }

  return { scripts, inlineContents }
}

/** Find API endpoints, paths, and URLs in JavaScript source */
function extractEndpointsFromJs(js: string, baseUrl: string, scriptName: string): ExtractedEndpoint[] {
  const endpoints: ExtractedEndpoint[] = []
  const seen = new Set<string>()

  const addEndpoint = (url: string, type: ExtractedEndpoint['type'], method?: string) => {
    const key = `${url}|${method ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    endpoints.push({ url, type, method, source: scriptName })
  }

  // 1. fetch('url', { method: 'POST' })  OR  fetch("url")
  const fetchRegex = /fetch\s*\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*\{[^}]*?method\s*:\s*['"`]([A-Z]+)['"`][^}]*?\})?/gi
  let m
  while ((m = fetchRegex.exec(js)) !== null) {
    addEndpoint(m[1], m[1].startsWith('http') ? 'api' : m[1].startsWith('/') ? 'relative' : 'absolute', m[2])
  }

  // 2. axios.get/post/put/delete/patch('url')
  const axiosRegex = /axios\.(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi
  while ((m = axiosRegex.exec(js)) !== null) {
    const method = m[1].toUpperCase()
    addEndpoint(m[2], m[2].startsWith('http') ? 'api' : m[2].startsWith('/') ? 'relative' : 'absolute', method)
  }

  // 3. $.ajax / $.get / $.post
  const jqueryRegex = /\$\.(ajax|get|post)\s*\(\s*['"`]([^'"`]+)['"`]/gi
  while ((m = jqueryRegex.exec(js)) !== null) {
    const method = m[1] === 'post' ? 'POST' : m[1] === 'get' ? 'GET' : 'ANY'
    addEndpoint(m[2], m[2].startsWith('http') ? 'api' : m[2].startsWith('/') ? 'relative' : 'absolute', method)
  }

  // 4. XMLHttpRequest.open('GET', 'url')
  const xhrRegex = /\.open\s*\(\s*['"`]([A-Z]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi
  while ((m = xhrRegex.exec(js)) !== null) {
    addEndpoint(m[2], m[2].startsWith('http') ? 'api' : m[2].startsWith('/') ? 'relative' : 'absolute', m[1])
  }

  // 5. WebSocket URLs
  const wsRegex = /new\s+WebSocket\s*\(\s*['"`](wss?:[^'"`]+)['"`]/gi
  while ((m = wsRegex.exec(js)) !== null) {
    addEndpoint(m[1], 'websocket')
  }

  // 6. Generic API paths: '/api/...' or '/v1/...'
  const apiPathRegex = /['"`](\/(?:api|v\d|graphql|rest|backend)\/[a-zA-Z0-9_\-\/{}$:.]+)['"`]/gi
  while ((m = apiPathRegex.exec(js)) !== null) {
    addEndpoint(m[1], 'api')
  }

  // 7. URL strings starting with http:// or https://
  const httpUrlRegex = /['"`](https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;%=]+)['"`]/gi
  while ((m = httpUrlRegex.exec(js)) !== null) {
    // Skip non-API URLs like google fonts, CDNs
    if (/fonts\.googleapis|google-analytics|googletagmanager|facebook\.com|cloudflare|jsdelivr|unpkg|cdnjs/i.test(m[1])) continue
    addEndpoint(m[1], 'absolute')
  }

  // 8. Relative paths: '/something/path'
  const relativePathRegex = /['"`](\/[a-zA-Z0-9_\-\/{}$:.]{3,}?)['"`]/gi
  while ((m = relativePathRegex.exec(js)) !== null) {
    // Skip CSS/asset-like extensions
    if (/\.(css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|map)$/i.test(m[1])) continue
    addEndpoint(m[1], 'relative')
  }

  return endpoints
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
    // 1. Fetch the main HTML page
    const htmlResult = await fetchUrl(parsed.href)
    if (htmlResult.status >= 400) {
      return NextResponse.json({ error: `Got HTTP ${htmlResult.status} from ${parsed.href}` }, { status: 502 })
    }

    // 2. Extract script tags
    const { scripts, inlineContents } = extractScripts(htmlResult.body)

    // 3. Fetch external scripts (limit to 10 to avoid hammering)
    const externalScripts = scripts.filter((s) => s.external).slice(0, 10)
    const scriptContents: { name: string; content: string }[] = []

    // Inline scripts first
    for (let i = 0; i < inlineContents.length; i++) {
      scriptContents.push({ name: `inline-${i + 1}`, content: inlineContents[i] })
    }

    // External scripts in parallel
    const externalResults = await Promise.all(
      externalScripts.map(async (s) => {
        try {
          const scriptUrl = new URL(s.src, parsed.href).href
          const r = await fetchUrl(scriptUrl, 10000)
          return { name: s.src, content: r.body }
        } catch (err) {
          return { name: s.src, content: `// fetch error: ${(err as Error).message}` }
        }
      })
    )
    scriptContents.push(...externalResults)

    // 4. Extract endpoints from each script
    const allEndpoints: ExtractedEndpoint[] = []
    for (const { name, content } of scriptContents) {
      const endpoints = extractEndpointsFromJs(content, parsed.href, name)
      allEndpoints.push(...endpoints)
    }

    // Dedupe endpoints (across all scripts)
    const seen = new Set<string>()
    const unique = allEndpoints.filter((e) => {
      const key = `${e.url}|${e.method ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Group by type
    const byType: Record<string, ExtractedEndpoint[]> = {}
    for (const e of unique) {
      if (!byType[e.type]) byType[e.type] = []
      byType[e.type].push(e)
    }

    return NextResponse.json({
      url: parsed.href,
      scriptsFound: scripts.length,
      scriptsAnalyzed: scriptContents.length,
      externalScripts: externalScripts.map((s) => s.src),
      endpoints: unique.sort((a, b) => a.type.localeCompare(b.type) || a.url.localeCompare(b.url)),
      summary: {
        total: unique.length,
        byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])),
      },
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, url: parsed.href }, { status: 502 })
  }
}
