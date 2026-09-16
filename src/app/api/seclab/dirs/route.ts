import { NextRequest, NextResponse } from 'next/server'
import https from 'node:https'
import http from 'node:http'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Common sensitive paths/files to check
const COMMON_PATHS = [
  // Admin panels
  '/admin', '/admin/', '/admin/login', '/administrator', '/wp-admin', '/wp-admin/',
  '/admin.php', '/admin.html', '/manager', '/manager/html', '/cpanel', '/phpmyadmin',
  '/adminer.php', '/adminer', '/solr', '/solr/admin',

  // Backup files
  '/backup', '/backup.zip', '/backup.tar.gz', '/backup.sql', '/db.sql', '/database.sql',
  '/.env', '/.env.local', '/.env.production', '/.env.backup',
  '/config.php', '/config.json', '/config.yml', '/config.yaml', '/config.ini',
  '/.git', '/.git/config', '/.git/HEAD', '/.gitignore', '/.svn', '/.hg',
  '/.htaccess', '/.htpasswd', '/web.config',

  // WP / CMS specific
  '/wp-config.php', '/wp-config.php.bak', '/wp-content/uploads', '/wp-content/plugins',
  '/xmlrpc.php', '/wp-login.php', '/wp-json', '/wp-json/wp/v2/users',
  '/?author=1', '/?author=2',
  '/readme.html', '/license.txt',

  // Files
  '/robots.txt', '/sitemap.xml', '/sitemap.txt', '/humans.txt', '/security.txt',
  '/.well-known/security.txt', '/server-status', '/server-info',
  '/phpinfo.php', '/info.php', '/test.php',
  '/composer.json', '/composer.lock', '/package.json', '/package-lock.json',
  '/yarn.lock', '/Gemfile.lock', '/pom.xml', '/requirements.txt',

  // Source / repo leaks
  '/.DS_Store', '/Thumbs.db', '/.idea', '/.vscode', '/.gitlab-ci.yml',
  '/Dockerfile', '/docker-compose.yml', '/docker-compose.yaml',
  '/Makefile', '/Jenkinsfile', '/.travis.yml', '/.circleci/config.yml',

  // API endpoints
  '/api', '/api/v1', '/api/v2', '/api/users', '/api/health', '/api/status',
  '/api/swagger.json', '/api-docs', '/swagger', '/swagger-ui', '/graphql',
  '/graphiql',

  // Common file leaks
  '/log', '/logs', '/debug', '/debug.log', '/error.log', '/access.log',
  '/uploads', '/upload', '/files', '/downloads',
  '/tmp', '/temp', '/cache',
  '/node_modules', '/vendor', '/dist', '/build',

  // Framework-specific
  '/_next/data', '/_nuxt', '/__next', '/__remix',
  '/login', '/signin', '/register', '/signup',
  '/forgot-password', '/reset-password',
  '/dashboard', '/settings', '/profile',
  '/cart', '/checkout', '/account',
]

function checkPath(baseUrl: string, path: string, timeoutMs = 5000): Promise<{
  status: number
  statusText: string
  length: number
  location?: string
  contentType?: string
}> {
  return new Promise((resolve) => {
    const fullUrl = baseUrl.replace(/\/+$/, '') + path
    const lib = fullUrl.startsWith('https:') ? https : http

    const req = lib.get(
      fullUrl,
      {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SecLab/1.0; Security Research)',
          'Accept': '*/*',
        },
        rejectUnauthorized: false,
      } as https.RequestOptions,
      (res) => {
        // For HEAD-style checks, we just need status + headers
        // Read minimal body to get content-length
        let length = 0
        res.on('data', (c: Buffer) => {
          length += c.length
          // Stop reading after 64KB to avoid downloading huge files
          if (length > 65536) {
            res.destroy()
            resolve({
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? '',
              length,
              location: res.headers.location,
              contentType: res.headers['content-type'],
            })
          }
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            length,
            location: res.headers.location,
            contentType: res.headers['content-type'],
          })
        })
        res.on('error', () => {
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            length,
            location: res.headers.location,
            contentType: res.headers['content-type'],
          })
        })
      }
    )
    req.on('error', () => resolve({ status: 0, statusText: 'error', length: 0 }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, statusText: 'timeout', length: 0 })
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

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 })
  }
  const baseUrl = parsed.origin

  try {
    // Check all paths in parallel (but limit concurrency to ~10)
    const batchSize = 10
    const results: {
      path: string
      status: number
      statusText: string
      length: number
      location?: string
      contentType?: string
      severity: 'info' | 'warn' | 'bad'
      note: string
    }[] = []

    for (let i = 0; i < COMMON_PATHS.length; i += batchSize) {
      const batch = COMMON_PATHS.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(async (path) => {
          const r = await checkPath(baseUrl, path)
          let severity: 'info' | 'warn' | 'bad' = 'info'
          let note = ''
          if (r.status === 200) {
            if (/\.git|\.env|\.svn|\.htaccess|backup|\.sql|config\.php|wp-config|composer\.|package\.json|Dockerfile|docker-compose/i.test(path)) {
              severity = 'bad'
              note = 'Sensitive file exposed!'
            } else if (/admin|wp-admin|phpmyadmin|adminer|cpanel/i.test(path)) {
              severity = 'warn'
              note = 'Admin panel accessible — ensure strong auth + IP restriction'
            } else if (/api|graphql|swagger/i.test(path)) {
              severity = 'info'
              note = 'API endpoint discovered'
            } else {
              note = 'File/page exists'
            }
          } else if (r.status === 401 || r.status === 403) {
            note = 'Exists but protected (good)'
            severity = 'info'
          } else if (r.status >= 300 && r.status < 400) {
            note = `Redirects to ${r.location}`
            severity = 'info'
          } else if (r.status === 404) {
            note = 'Not found'
          } else if (r.status === 0) {
            note = 'Error/timeout'
          } else {
            note = `HTTP ${r.status}`
          }
          return { path, ...r, severity, note }
        })
      )
      results.push(...batchResults)
    }

    // Filter to interesting results (200, 401, 403, redirects) for cleaner display
    const interesting = results.filter(
      (r) => r.status !== 0 && r.status !== 404
    )

    return NextResponse.json({
      url: baseUrl,
      totalChecked: COMMON_PATHS.length,
      found: interesting.length,
      results: interesting.sort((a, b) => {
        // Sort: bad first, then warn, then info
        const sev = { bad: 0, warn: 1, info: 2 }
        return sev[a.severity] - sev[b.severity] || a.path.localeCompare(b.path)
      }),
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, url: baseUrl }, { status: 502 })
  }
}
