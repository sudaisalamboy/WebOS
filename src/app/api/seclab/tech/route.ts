import { NextRequest, NextResponse } from 'next/server'
import https from 'node:https'
import http from 'node:http'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

interface DetectedTech {
  name: string
  category: string
  version?: string
  confidence: 'high' | 'medium' | 'low'
  evidence: string
}

interface Rule {
  name: string
  category: string
  headers?: Record<string, RegExp>
  html?: RegExp[]
  cookies?: RegExp[]
  scripts?: RegExp[]
}

// Simplified Wappalyzer-style detection rules
const RULES: Rule[] = [
  // CDN / Hosting
  { name: 'Cloudflare', category: 'CDN', headers: { server: /cloudflare/i }, cookies: [/__cfduid|cf_clearance/i] },
  { name: 'Vercel', category: 'Hosting', headers: { server: /vercel/i }, cookies: [/_vercel/i] },
  { name: 'Netlify', category: 'Hosting', headers: { server: /netlify/i }, cookies: [/netlify/i] },
  { name: 'GitHub Pages', category: 'Hosting', headers: { server: /github\.io/i } },
  { name: 'Amazon CloudFront', category: 'CDN', headers: { 'x-amz-cf-id': /.+/ } },
  { name: 'Fastly', category: 'CDN', headers: { 'x-served-by': /cache-/i, 'x-fastly': /.+/i } },
  { name: 'Akamai', category: 'CDN', headers: { 'x-akamai-transformed': /.+/ } },

  // Web servers
  { name: 'Nginx', category: 'Web Server', headers: { server: /nginx\/?([\d.]+)?/i } },
  { name: 'Apache', category: 'Web Server', headers: { server: /apache\/?([\d.]+)?/i } },
  { name: 'Microsoft IIS', category: 'Web Server', headers: { server: /microsoft-iis\/?([\d.]+)?/i } },
  { name: 'LiteSpeed', category: 'Web Server', headers: { server: /litespeed/i } },
  { name: 'Caddy', category: 'Web Server', headers: { server: /caddy/i } },

  // Languages / Runtimes
  { name: 'PHP', category: 'Language', headers: { 'x-powered-by': /php\/?([\d.]+)?/i } },
  { name: 'ASP.NET', category: 'Framework', headers: { 'x-powered-by': /asp\.net/i, 'x-aspnet-version': /.+/i } },
  { name: 'Express', category: 'Framework', headers: { 'x-powered-by': /express/i } },
  { name: 'Next.js', category: 'Framework', html: [/__next/i, /_next\/static/i] },
  { name: 'Nuxt.js', category: 'Framework', html: [/_nuxt\//i, /__nuxt/i] },
  { name: 'Gatsby', category: 'Framework', html: [/gatsby-/i] },
  { name: 'SvelteKit', category: 'Framework', html: [/svelte-kit/i] },
  { name: 'Remix', category: 'Framework', html: [/__remix/i] },
  { name: 'Django', category: 'Framework', cookies: [/csrftoken|sessionid/i] },
  { name: 'Ruby on Rails', category: 'Framework', cookies: [/_rails_session|_session_id/i] },
  { name: 'Laravel', category: 'Framework', cookies: [/laravel_session/i] },
  { name: 'Spring Boot', category: 'Framework', headers: { 'x-application-context': /.+/i } },

  // CMS
  { name: 'WordPress', category: 'CMS', html: [/wp-content|wp-includes|name=["']generator["']\s+content=["']WordPress/i] },
  { name: 'Drupal', category: 'CMS', headers: { 'x-generator': /drupal/i }, html: [/drupal\.js|sites\/all|sites\/default/i] },
  { name: 'Joomla', category: 'CMS', html: [/joomla|\/media\/jui\//i] },
  { name: 'Ghost', category: 'CMS', headers: { 'x-ghost-cache-status': /.+/i } },
  { name: 'Shopify', category: 'E-commerce', headers: { 'x-shopify-stage': /.+/i, 'x-shopid': /.+/i } },
  { name: 'Magento', category: 'E-commerce', cookies: [/x-magento-vary/i] },

  // Analytics
  { name: 'Google Analytics', category: 'Analytics', html: [/google-analytics\.com|gtag\(|ga\(/i] },
  { name: 'Google Tag Manager', category: 'Analytics', html: [/googletagmanager\.com|GTM-/i] },
  { name: 'Plausible', category: 'Analytics', html: [/plausible\.io/i] },
  { name: 'Mixpanel', category: 'Analytics', html: [/mixpanel\.com/i] },
  { name: 'Hotjar', category: 'Analytics', html: [/hotjar\.com/i] },
  { name: 'Segment', category: 'Analytics', html: [/analytics\.snplow\.net|cdn\.segment\.com/i] },

  // Frontend frameworks
  { name: 'React', category: 'JS Framework', html: [/react(-dom)?(\.production|\.development)?\.min\.js|data-reactroot/i] },
  { name: 'Vue.js', category: 'JS Framework', html: [/vue(\.runtime)?(\.min)?\.js|data-v-[a-f0-9]+/i] },
  { name: 'Angular', category: 'JS Framework', html: [/ng-version|@angular|ng-app/i] },
  { name: 'Svelte', category: 'JS Framework', html: [/svelte-[a-z0-9]+/i] },
  { name: 'jQuery', category: 'JS Library', html: [/jquery(-\d+)?(\.\d+)*(\.min)?\.js/i] },
  { name: 'Bootstrap', category: 'CSS Framework', html: [/bootstrap(\.min)?\.css|bootstrap\.bundle/i] },
  { name: 'Tailwind CSS', category: 'CSS Framework', html: [/tailwind/i] },
  { name: 'Bulma', category: 'CSS Framework', html: [/bulma(\.min)?\.css/i] },

  // Fonts / UI
  { name: 'Google Fonts', category: 'Fonts', html: [/fonts\.googleapis\.com/i] },
  { name: 'Font Awesome', category: 'Icons', html: [/fontawesome|font-awesome/i] },

  // Auth
  { name: 'Auth0', category: 'Auth', headers: { 'x-auth0-requestid': /.+/i } },
  { name: 'Cloudflare Access', category: 'Auth', headers: { 'cf-access-jwt-assertion': /.+/i } },
  { name: 'Keycloak', category: 'Auth', headers: { 'x-uaa-endpoint': /.+/i } },

  // APM / Monitoring
  { name: 'Sentry', category: 'Monitoring', html: [/sentry-cdn|sentry\.io|@sentry\//i] },
  { name: 'Datadog', category: 'Monitoring', headers: { 'x-datadog-trace-id': /.+/i } },
  { name: 'New Relic', category: 'Monitoring', headers: { 'x-newrelic-app-data': /.+/i } },
]

function fetchHtml(url: string, timeoutMs = 12000): Promise<{
  status: number
  headers: Record<string, string>
  body: string
  cookies: string[]
}> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(
      url,
      {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SecLab/1.0; Security Research)',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
        rejectUnauthorized: false,
      } as https.RequestOptions,
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') headers[k.toLowerCase()] = v
            else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ')
          }
          const setCookie = res.headers['set-cookie'] ?? []
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body,
            cookies: setCookie,
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

  try {
    const result = await fetchHtml(target)
    const detected: DetectedTech[] = []

    for (const rule of RULES) {
      let matched = false
      let evidence = ''
      let version: string | undefined

      // Check headers
      if (rule.headers) {
        for (const [hname, hregex] of Object.entries(rule.headers)) {
          const hval = result.headers[hname.toLowerCase()]
          if (hval && hregex.test(hval)) {
            matched = true
            evidence = `${hname}: ${hval}`
            const m = hval.match(hregex)
            if (m && m[1]) version = m[1]
            break
          }
        }
      }

      // Check HTML
      if (!matched && rule.html) {
        for (const hregex of rule.html) {
          const m = result.body.match(hregex)
          if (m) {
            matched = true
            evidence = `HTML match: ${m[0].slice(0, 80)}`
            break
          }
        }
      }

      // Check cookies
      if (!matched && rule.cookies) {
        for (const cregex of rule.cookies) {
          for (const cookie of result.cookies) {
            if (cregex.test(cookie)) {
              matched = true
              evidence = `Cookie: ${cookie.split('=')[0]}`
              break
            }
          }
          if (matched) break
        }
      }

      if (matched) {
        detected.push({
          name: rule.name,
          category: rule.category,
          version,
          confidence: rule.headers ? 'high' : rule.cookies ? 'high' : 'medium',
          evidence,
        })
      }
    }

    return NextResponse.json({
      url: target,
      status: result.status,
      technologies: detected,
      summary: {
        total: detected.length,
        byCategory: detected.reduce<Record<string, number>>((acc, t) => {
          acc[t.category] = (acc[t.category] ?? 0) + 1
          return acc
        }, {}),
      },
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, url: target }, { status: 502 })
  }
}
