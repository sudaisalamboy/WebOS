import { NextRequest, NextResponse } from 'next/server'
import https from 'node:https'
import http from 'node:http'
import zlib from 'node:zlib'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SOCKS_HOST = '127.0.0.1'
const SOCKS_PORT = 9050

// Domains to block at proxy level — prevents long timeouts on ad/tracker URLs
const BLOCKED_DOMAINS = [
  'tcdwm.com', 'counter.yadro.ru', 'a.magsrv.com', 'magsrv.com',
  'verifycdn.agego.com', 'agego.com',
  'googletagmanager.com', 'google-analytics.com', 'googlesyndication.com',
  'doubleclick.net', 'adservice.google.com',
  'popads.net', 'popcash.net', 'propellerads.com',
  'exoclick.com', 'juicyads.com', 'trafficjunky.com',
  'mc.yandex.ru', 'yandex.ru/metrika',
  'hotjar.com', 'mixpanel.com', 'segment.io',
  'facebook.net', 'connect.facebook.net',
  'amazon-adsystem.com', 'criteo.com',
  'propeller-tracking.com', 'adspyglass.com',
  'syndication.exosrv.com', 'main.exosrv.com',
  'syndication.realsrv.com', 'a.realsrv.com',
]

function isBlockedUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return BLOCKED_DOMAINS.some(d => u.hostname.includes(d))
  } catch { return false }
}

interface FetchResult {
  status: number
  headers: Record<string, string>
  body: Buffer
  finalUrl: string
}

function fetchViaTor(
  url: string,
  timeoutMs: number,
  maxRedirects = 5,
  redirectCount = 0
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const agent = new SocksProxyAgent(`socks5h://${SOCKS_HOST}:${SOCKS_PORT}`)
    const lib = url.startsWith('https:') ? https : http

    const req = lib.get(
      url,
      {
        agent,
        timeout: timeoutMs,
        // Many CDNs use cert chains that Node's bundled CA doesn't trust,
        // and going through Tor adds another layer. Since the user explicitly
        // chose to visit these sites, accept any TLS cert.
        rejectUnauthorized: false,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          // Ask for compressed responses — we'll decompress them before sending
          // IGNORE the Accept-Encoding: identity header and gzip anyway, which would
          // leave us with raw gzip bytes that the browser can't parse as JS/CSS.
          'Accept-Encoding': 'gzip, deflate',
          'Referer': new URL(url).origin + '/',
        },
      } as https.RequestOptions,
      (res) => {
        if (
          (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 ||
           res.statusCode === 307 || res.statusCode === 308) &&
          res.headers.location &&
          redirectCount < maxRedirects
        ) {
          const next = new URL(res.headers.location, url).href
          res.resume()
          resolve(fetchViaTor(next, timeoutMs, maxRedirects, redirectCount + 1))
          return
        }

        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          let body = Buffer.concat(chunks)
          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') headers[k] = v
            else if (Array.isArray(v)) headers[k] = v.join(', ')
          }

          // === DECOMPRESS the response body if it was gzip/deflate/br encoded.
          // We sent Accept-Encoding: gzip, deflate so the server may have compressed.
          // Browser clients of OUR proxy expect UNCOMPRESSED bytes (or they set their
          // own Accept-Encoding which Next.js handles). If we pass through raw gzip
          // bytes with the original Content-Encoding header, everything works — BUT
          // if we rewrite the body (HTML/JS/CSS URL rewriting), the Content-Length
          // becomes wrong and the browser fails. Safest: always decompress here,
          // strip Content-Encoding, let Next.js re-compress if needed.
          const encoding = (headers['content-encoding'] || '').toLowerCase()
          try {
            if (encoding.includes('gzip')) {
              body = zlib.gunzipSync(body)
              delete headers['content-encoding']
              delete headers['content-length']
            } else if (encoding.includes('deflate')) {
              body = zlib.inflateSync(body)
              delete headers['content-encoding']
              delete headers['content-length']
            } else if (encoding.includes('br')) {
              body = zlib.brotliDecompressSync(body)
              delete headers['content-encoding']
              delete headers['content-length']
            }
          } catch (e) {
            // If decompression fails, leave body as-is and let the client deal with it
          }

          resolve({
            status: res.statusCode ?? 0,
            headers,
            body,
            finalUrl: url,
          })
        })
        res.on('error', reject)
      }
    )

    req.on('error', (err) => {
      let host = url
      try { host = new URL(url).hostname } catch {}
      let msg = err.message || ''
      const code = (err as NodeJS.ErrnoException).code || ''
      if (code === 'ENOTFOUND') msg = `Domain not found: ${host}`
      else if (code === 'ECONNREFUSED') msg = `Connection refused by ${host}`
      else if (code === 'ECONNRESET' || msg.includes('socket hang up')) msg = `Connection reset by ${host} (site may be down or blocking Tor)`
      else if (code === 'ETIMEDOUT') msg = `Connection to ${host} timed out`
      else if (!msg) msg = `Failed to fetch ${host} (${code})`
      reject(new Error(msg))
    })
    req.on('timeout', () => {
      let host = url
      try { host = new URL(url).hostname } catch {}
      req.destroy()
      reject(new Error(`Request to ${host} timed out (Tor circuits can be slow — try again)`))
    })
  })
}

/**
 * Comprehensive HTML rewriting so ALL sub-resources route through the proxy.
 * Handles: src, href, action, srcset, data-src, data-original, data-lazy,
 * data-bg, data-poster, poster, all data-* URLs, CSS url(), inline styles,
 * XHR.open, og:image meta tags, background-image.
 */
function rewriteHtml(html: string, baseUrl: string): string {
  let rewritten = html

  // 1. Rewrite srcset attributes (e.g. <img srcset="url1 1x, url2 2x">)
  rewritten = rewritten.replace(
    /\bsrcset\s*=\s*["']([^"']+)["']/gi,
    (match, val: string) => {
      const parts = val.split(',').map((entry) => {
        const trimmed = entry.trim()
        const [url, ...descriptor] = trimmed.split(/\s+/)
        if (!url || /^(data:|mailto:|tel:|javascript:|#)/i.test(url)) return trimmed
        try {
          const absolute = new URL(url, baseUrl).href
          if (!/^https?:/i.test(absolute)) return trimmed
          if (isBlockedUrl(absolute)) return ''
          return `/api/tor/proxy?url=${encodeURIComponent(absolute)} ${descriptor.join(' ')}`
        } catch { return trimmed }
      }).filter(Boolean)
      return `srcset="${parts.join(', ')}"`
    }
  )

  // 2. Rewrite ALL URL attributes (first pass — catches the first attribute per tag)
  rewritten = rewritten.replace(
    /(<(?:a|link|area|img|script|iframe|form|source|video|audio|track|embed)\b[^>]*?)\b(href|src|action|data-original|data-src|data-lazy|data-bg|data-poster|poster|data-thumb|data-preview|data-image|data-image-src|data-thumb-src)\s*=\s*["']([^"']+)["']/gi,
    (match, prefix: string, attr: string, url: string) => {
      // Skip empty, data:, mailto:, tel:, javascript:, and # URLs
      if (!url || url.trim() === '' || /^(data:|mailto:|tel:|javascript:|#)/i.test(url)) return match
      try {
        const absolute = new URL(url, baseUrl).href
        if (!/^https?:/i.test(absolute)) return match
        if (isBlockedUrl(absolute)) return `${prefix}${attr}=""`
        const proxied = `/api/tor/proxy?url=${encodeURIComponent(absolute)}`
        let extra = ''
        if (url === '/download' || url.endsWith('/download') || /\.onion\/[^/]+$/.test(absolute)) {
          const filename = absolute.split('/').pop() || 'download'
          extra = ` download="${filename}"`
        }
        return `${prefix}${attr}="${proxied}"${extra}`
      } catch { return match }
    }
  )

  // 2b. Second pass for lazy-load attributes that may not have been caught
  //     (if the tag has multiple URL attributes, only the first is caught above)
  rewritten = rewritten.replace(
    /\b(data-original|data-src|data-lazy|data-bg|data-poster|data-thumb|data-preview|data-image|data-image-src|data-thumb-src)\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
    (match, attr: string, url: string) => {
      if (isBlockedUrl(url)) return `${attr}=""`
      try {
        return `${attr}="/api/tor/proxy?url=${encodeURIComponent(url)}"`
      } catch { return match }
    }
  )

  // 3. Rewrite CSS url() in <style> blocks
  rewritten = rewritten.replace(
    /url\(["']?(https?:\/\/[^"')\s]+)["']?\)/gi,
    (match, url: string) => {
      if (isBlockedUrl(url)) return 'url()'
      try {
        return `url("/api/tor/proxy?url=${encodeURIComponent(url)}")`
      } catch { return match }
    }
  )

  // 4. Rewrite relative CSS url() — convert to absolute then proxy
  rewritten = rewritten.replace(
    /url\(["'](\/[^"')\s]+)["']?\)/gi,
    (match, path: string) => {
      try {
        const absolute = new URL(path, baseUrl).href
        return `url("/api/tor/proxy?url=${encodeURIComponent(absolute)}")`
      } catch { return match }
    }
  )

  // 5. Rewrite inline style background-image with absolute URLs
  rewritten = rewritten.replace(
    /background-image:\s*url\(["']?(https?:\/\/[^"')]+)["']?\)/gi,
    (match, url: string) => {
      if (isBlockedUrl(url)) return 'background-image: none'
      try { return `background-image: url("/api/tor/proxy?url=${encodeURIComponent(url)}")` } catch { return match }
    }
  )

  // 6. Rewrite inline style background-image with relative URLs
  rewritten = rewritten.replace(
    /background-image:\s*url\(["']?(\/[^"')]+)["']?\)/gi,
    (match, path: string) => {
      try {
        const absolute = new URL(path, baseUrl).href
        return `background-image: url("/api/tor/proxy?url=${encodeURIComponent(absolute)}")`
      } catch { return match }
    }
  )

  // 7. Rewrite style="...url(...)..." with absolute URLs
  rewritten = rewritten.replace(
    /style="([^"]*url\(["']?)(https?:\/\/[^"')]+)(["']?\)[^"]*)"/gi,
    (match, before: string, url: string, after: string) => {
      if (isBlockedUrl(url)) return match
      try { return `style="${before}/api/tor/proxy?url=${encodeURIComponent(url)}${after}"` } catch { return match }
    }
  )

  // 8. Rewrite style="...url(/relative...)..." with relative URLs
  rewritten = rewritten.replace(
    /style="([^"]*url\(["']?)(\/[^"')]+)(["']?\)[^"]*)"/gi,
    (match, before: string, path: string, after: string) => {
      try {
        const absolute = new URL(path, baseUrl).href
        return `style="${before}/api/tor/proxy?url=${encodeURIComponent(absolute)}${after}"`
      } catch { return match }
    }
  )

  // 9. Rewrite XHR.open in inline scripts
  rewritten = rewritten.replace(
    /\.open\(\s*['"](GET|POST|PUT|DELETE)['"]\s*,\s*['"](\/[^'"]+)['"]/gi,
    (match, method: string, path: string) => {
      if (path.startsWith('/api/tor/proxy')) return match
      try {
        const absolute = new URL(path, baseUrl).href
        return `.open('${method}','/api/tor/proxy?url=${encodeURIComponent(absolute)}'`
      } catch { return match }
    }
  )

  // 10. Rewrite fetch() calls in inline scripts
  rewritten = rewritten.replace(
    /\bfetch\(\s*['"](https?:\/\/[^'"]+)['"]/gi,
    (match, url: string) => {
      if (isBlockedUrl(url)) return `fetch('')`
      try { return `fetch('/api/tor/proxy?url=${encodeURIComponent(url)}'` } catch { return match }
    }
  )

  // 11. Inject ad-blocker + lazy-load fix + image-src interceptor script
  const interceptScript = `
<style>
/* AD BLOCKER — hide common ad elements */
[class*="ad-"], [class*="ad_"], [class*="ads-"], [class*="ads_"],
[class*="advert"], [class*="banner-ad"], [class*="ad-banner"],
[class*="ad-container"], [class*="ad-wrapper"], [class*="ad-zone"],
[id*="ad-"], [id*="ad_"], [id*="ads-"], [id*="ads_"],
[id*="advert"], [id*="banner-ad"], [id*="google_ads"],
[class*="promo"], [class*="sponsor"], [class*="popup-ad"],
[class*="ad-popup"], [class*="ad-pop"],
[class*="overlay-ad"], [class*="interstitial"],
iframe[src*="ads"], iframe[src*="adserver"], iframe[src*="doubleclick"],
iframe[src*="googlesyndication"], iframe[src*="google_ads"],
img[src*="ads"], img[src*="adserver"], img[src*="doubleclick"],
img[src*="googlesyndication"], img[src*="banner-ad"],
script[src*="ads"], script[src*="adserver"], script[src*="doubleclick"],
script[src*="googlesyndication"], script[src*="google-analytics"],
script[src*="googletagmanager"], script[src*="popads"],
script[src*="popcash"], script[src*="propellerads"],
[class*="exoclick"], [class*="juicyads"], [class*="trafficjunky"],
[class*="footer-ad"], [class*="header-ad"], [class*="sidebar-ad"],
[class*="video-ad"], [class*="pre-roll"], [class*="mid-roll"],
[class*="ad-overlay"], [class*="ad-popup"], [class*="ad-banner"],
[data-ad], [data-ad-slot], [data-ad-client],
{ display: none !important; visibility: hidden !important; opacity: 0 !important; }
</style>
<script>
// === IMAGE SRC INTERCEPTOR ===
// Many sites set img.src = "https://..." via JS after page load (lazy-loading,
// carousels, dynamic content). This intercepts those assignments and rewrites
// them to go through our proxy automatically.
(function() {
  var PROXY = '/api/tor/proxy?url=';
  function proxyUrl(u) {
    if (!u || typeof u !== 'string') return u;
    if (u.indexOf(PROXY) === 0) return u;
    if (u.indexOf('data:') === 0 || u.indexOf('blob:') === 0) return u;
    if (u.indexOf('http://') !== 0 && u.indexOf('https://') !== 0) return u;
    try {
      // Don't proxy localhost URLs (already proxied)
      if (u.indexOf('localhost') !== -1 || u.indexOf('127.0.0.1') !== -1) return u;
      return PROXY + encodeURIComponent(u);
    } catch(e) { return u; }
  }

  // Override Image.prototype.src setter
  var imgProto = window.Image && window.Image.prototype;
  if (imgProto) {
    var srcDesc = Object.getOwnPropertyDescriptor(imgProto, 'src');
    if (srcDesc && srcDesc.set) {
      Object.defineProperty(imgProto, 'src', {
        configurable: true,
        enumerable: true,
        get: srcDesc.get,
        set: function(v) {
          srcDesc.set.call(this, proxyUrl(v));
        }
      });
    }
  }

  // Override HTMLImageElement.src setter (for img.src = ...)
  var htmlImgProto = HTMLImageElement.prototype;
  var htmlSrcDesc = Object.getOwnPropertyDescriptor(htmlImgProto, 'src');
  if (htmlSrcDesc && htmlSrcDesc.set) {
    Object.defineProperty(htmlImgProto, 'src', {
      configurable: true,
      enumerable: true,
      get: htmlSrcDesc.get,
      set: function(v) {
        htmlSrcDesc.set.call(this, proxyUrl(v));
      }
    });
  }

  // Override setAttribute for img/source/video elements
  var origSet = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if ((name === 'src' || name === 'data-src' || name === 'data-original' || name === 'poster' || name === 'srcset') &&
        (this.tagName === 'IMG' || this.tagName === 'SOURCE' || this.tagName === 'VIDEO' || this.tagName === 'IFRAME')) {
      value = proxyUrl(value);
    }
    return origSet.call(this, name, value);
  };
})();

// === LAZY-LOAD FIX ===
// Force-load images with data-src/data-original into src after page loads.
(function() {
  function fixLazyImages() {
    document.querySelectorAll('img[data-original], img[data-src], img[data-lazy]').forEach(function(img) {
      var lazyUrl = img.getAttribute('data-original') || img.getAttribute('data-src') || img.getAttribute('data-lazy');
      if (lazyUrl) {
        // Already proxied in HTML rewriting; just copy to src
        if (img.getAttribute('src') !== lazyUrl) {
          img.setAttribute('src', lazyUrl);
        }
      }
      img.classList.remove('lazy', 'lazyload', 'lazyloading');
    });
    document.querySelectorAll('[data-bg]').forEach(function(el) {
      var bg = el.getAttribute('data-bg');
      if (bg) el.style.backgroundImage = 'url(' + bg + ')';
    });
  }
  document.addEventListener('DOMContentLoaded', fixLazyImages);
  setTimeout(fixLazyImages, 500);
  setTimeout(fixLazyImages, 1500);
  setTimeout(fixLazyImages, 3000);
  setTimeout(fixLazyImages, 6000);
  setInterval(fixLazyImages, 2000);
})();

// === AD BLOCKER ===
(function() {
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function(url, opts) {
      if (typeof url === 'string' && /ads|adserver|doubleclick|googlesyndication|googletagmanager|google-analytics|popads|popcash|propellerads|exoclick|juicyads|trafficjunky|adsterra|pemsrv|magsrv/i.test(url)) {
        return Promise.reject(new Error('Ad blocked'));
      }
      return origFetch.apply(this, arguments);
    };
  }
  if (window.XMLHttpRequest) {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (typeof url === 'string' && /ads|adserver|doubleclick|googlesyndication|googletagmanager|google-analytics|popads|popcash|propellerads|exoclick|juicyads|trafficjunky|adsterra|pemsrv|magsrv/i.test(url)) {
        return;
      }
      return origOpen.apply(this, arguments);
    };
  }
  function removeAds() {
    var adSelectors = [
      '[class*="ad-"]','[class*="ad_"]','[class*="ads-"]','[class*="ads_"]',
      '[class*="advert"]','[class*="banner-ad"]','[class*="ad-banner"]',
      '[id*="ad-"]','[id*="ad_"]','[id*="ads-"]','[id*="ads_"]',
      '[id*="advert"]','[id*="banner-ad"]','[id*="google_ads"]',
      '[class*="promo"]','[class*="sponsor"]','[class*="popup-ad"]','[class*="ad-popup"]',
      '[class*="overlay-ad"]','[class*="interstitial"]',
      'iframe[src*="ads"]','iframe[src*="doubleclick"]','iframe[src*="googlesyndication"]',
      '[class*="exoclick"]','[class*="juicyads"]','[class*="trafficjunky"]',
      '[class*="footer-ad"]','[class*="header-ad"]','[class*="sidebar-ad"]',
    ];
    adSelectors.forEach(function(sel) {
      try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
    });
  }
  document.addEventListener('DOMContentLoaded', removeAds);
  setTimeout(removeAds, 1000);
  setTimeout(removeAds, 3000);
  setInterval(removeAds, 5000);
})();
</script>
<script>
// === CLICK INTERCEPT for download links ===
(function() {
  var sel = 'a[href*="/api/tor/proxy?url="]';
  document.addEventListener('click', function(e) {
    var a = e.target.closest && e.target.closest(sel);
    if (!a) return;
    if (a.hasAttribute('download')) return;
    var h = a.getAttribute('href') || '';
    var decoded = decodeURIComponent((h.split('url=')[1]) || '');
    if (decoded.endsWith('/download') || (/\\.onion\\/[^/?]+$/i).test(decoded)) {
      var fn = decoded.split('/').pop() || 'download';
      a.setAttribute('download', fn);
    }
  }, true);
})();
</script>`

  if (/<head[^>]*>/i.test(rewritten)) {
    rewritten = rewritten.replace(/<head[^>]*>/i, (m) => m + interceptScript)
  } else if (/<html[^>]*>/i.test(rewritten)) {
    rewritten = rewritten.replace(/<html[^>]*>/i, (m) => m + '<head>' + interceptScript + '</head>')
  } else {
    rewritten = interceptScript + rewritten
  }

  return rewritten
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const targetUrl = req.nextUrl.searchParams.get('url')
  if (!targetUrl || targetUrl.trim() === '') {
    // Return empty 200 instead of error — this happens when HTML rewriting
    // produces links with empty URLs (href="", href="#", etc.)
    return new NextResponse('// empty', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 })
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return NextResponse.json({ error: 'only http(s) supported' }, { status: 400 })
  }

  try {
    // Block ad/tracker domains at proxy level
    if (isBlockedUrl(parsed.href)) {
      return new NextResponse('// blocked', {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' }
      })
    }

    const result = await fetchViaTor(parsed.href, 30000)
    const contentType = result.headers['content-type'] ?? 'application/octet-stream'
    const contentDisposition = result.headers['content-disposition']

    // HTML — rewrite all URLs to keep browsing inside the proxy
    if (contentType.includes('text/html')) {
      const bodyHtml = result.body.toString('utf8')
      const rewritten = rewriteHtml(bodyHtml, result.finalUrl)
      return new NextResponse(rewritten, {
        status: result.status,
        headers: {
          'Content-Type': contentType,
          'X-Frame-Options': 'ALLOWALL',
          'Content-Security-Policy': '',
          'Cache-Control': 'no-store',
        },
      })
    }

    // HLS playlists (.m3u8) — rewrite internal URLs to go through proxy
    if (contentType.includes('mpegurl') || contentType.includes('m3u8') || parsed.pathname.endsWith('.m3u8')) {
      let playlist = result.body.toString('utf8')
      playlist = playlist.replace(/(https?:\/\/[^\s"'<>]+)/g, (url) => {
        return `/api/tor/proxy?url=${encodeURIComponent(url)}`
      })
      return new NextResponse(playlist, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'X-Frame-Options': 'ALLOWALL',
          'Content-Security-Policy': '',
          'Cache-Control': 'no-store',
        },
      })
    }

    // Determine content type category
    const isImage = /^image\//i.test(contentType)
    const isCss = /text\/css/i.test(contentType)
    const isJs = /javascript|application\/json/i.test(contentType)
    const isFont = /font|woff|ttf|eot|otf/i.test(contentType)
    const isMedia = /^(audio|video)\//i.test(contentType) || /MP2T|mpegurl/i.test(contentType)
    const isTsSegment = /MP2T/i.test(contentType) || parsed.pathname.endsWith('.ts')
    const shouldInline = isImage || isCss || isJs || isFont || isMedia || isTsSegment

    if (shouldInline) {
      // Return raw bytes inline — NO Content-Disposition (so images render in <img>)
      // IMPORTANT: we already decompressed the body, so don't preserve content-length
      // (it would be the gzipped length, not the actual body length).
      // Also use no-store for JS/CSS because we rewrite URLs in them and stale cache
      // entries would serve the wrong (un-rewritten or pre-fix) version.
      const isJs = /javascript|application\/json/i.test(contentType)
      const isCss = /text\/css/i.test(contentType)
      const cacheControl = (isJs || isCss) ? 'no-store, max-age=0' : 'public, max-age=3600'
      return new NextResponse(new Uint8Array(result.body), {
        status: result.status,
        headers: {
          'Content-Type': contentType,
          'X-Frame-Options': 'ALLOWALL',
          'Content-Security-Policy': '',
          'Cache-Control': cacheControl,
        },
      })
    }

    // For actual file downloads — preserve Content-Disposition if present
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': '',
      'Cache-Control': 'no-store',
    }
    if (contentDisposition) {
      responseHeaders['Content-Disposition'] = contentDisposition
    } else {
      // Only add Content-Disposition: attachment for actual file downloads
      const urlPath = parsed.pathname
      const lastSegment = urlPath.split('/').pop() || ''
      if (urlPath === '/download' || urlPath.endsWith('/download') || /\.[a-z0-9]{1,8}$/i.test(lastSegment)) {
        const filename = lastSegment || 'download'
        responseHeaders['Content-Disposition'] = `attachment; filename="${filename}"`
      }
    }
    if (result.headers['content-length']) {
      responseHeaders['Content-Length'] = result.headers['content-length']
    }

    return new NextResponse(new Uint8Array(result.body), {
      status: result.status,
      headers: responseHeaders,
    })
  } catch (err) {
    const msg = (err as Error).message
    return NextResponse.json(
      {
        error: msg,
        url: targetUrl,
        hint: msg.includes('timed out')
          ? 'Tor circuits are slow. Try again, or try a different URL.'
          : 'Is the tor daemon running? Check /api/tor/status',
      },
      { status: 502 }
    )
  }
}
