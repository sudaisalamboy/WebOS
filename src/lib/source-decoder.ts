/**
 * Real-time HTML source decoder.
 *
 * Takes the rendered HTML from a live Playwright session (so it includes
 * dynamically-injected content) and decodes every common encoding we might
 * find "hidden" inside it:
 *
 *   - URL encoding (% sequences, + for space)
 *   - HTML entities (&amp; &#x27; &lt; etc.)
 *   - Base64 (data: URIs, atob() calls, JSON blobs)
 *   - Hex escapes (\x41)
 *   - Unicode escapes (\u0041)
 *   - JS string concatenation chains ("a" + "b" + "c")
 *   - CSS url(...) with encoded content
 *   - data: URIs (text/html, image/svg, application/json)
 *   - Inline JSON in <script type="application/json"> and <script id="...">
 *   - eval() / Function() / setAttribute("on...") payloads
 *
 * Returns:
 *   {
 *     raw,             // original rendered HTML
 *     decoded,         // fully decoded HTML (best effort)
 *     findings: [      // list of interesting decoded snippets found
 *       { type, original, decoded, location }
 *     ],
 *     stats: { scripts, base64Blobs, evals, dataUris, encodedUrls }
 *   }
 */

export interface DecodedFinding {
  type: 'base64' | 'url-encoded' | 'html-entity' | 'hex-escape' | 'unicode-escape' |
        'eval' | 'data-uri' | 'json-blob' | 'css-url' | 'concat-chain' | 'inline-handler'
  original: string    // the raw match (truncated to 200 chars)
  decoded: string     // the decoded value (truncated to 500 chars)
  location: string    // context — where in the HTML it was found
}

export interface DecodeResult {
  raw: string
  decoded: string
  findings: DecodedFinding[]
  stats: {
    scripts: number
    inlineHandlers: number
    base64Blobs: number
    evals: number
    dataUris: number
    encodedUrls: number
    jsonBlobs: number
    cssUrls: number
  }
}

const MAX_FINDINGS = 200  // cap to avoid runaway memory on huge pages
const MAX_ORIG = 200
const MAX_DEC = 500

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + `…(${s.length}b)`
}

/** URL-decode a string. Tolerant of bad encoding. */
function urlDecode(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch {}
  try { return unescape(s) } catch {}
  return s
}

/** HTML entity decode using DOMParser-style logic without a DOM. */
function htmlEntityDecode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')  // last to avoid double-decoding
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
}

/** Base64-decode (returns original on failure). Returns text if printable. */
function base64Decode(s: string): string | null {
  // Strip whitespace, pad to multiple of 4
  const cleaned = s.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned) || cleaned.length < 8) return null
  try {
    const buf = Buffer.from(cleaned, 'base64')
    // Only return if it's mostly printable text
    const text = buf.toString('utf8')
    const printable = text.split('').filter(c => c.charCodeAt(0) >= 32 || '\n\r\t'.includes(c)).length
    if (printable / text.length > 0.8 && text.length > 0) return text
    // Otherwise return hex preview
    return `[binary ${buf.length} bytes] hex: ${buf.toString('hex').slice(0, 100)}…`
  } catch { return null }
}

/** Hex escape decode: \x41 → A */
function hexDecode(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** Unicode escape decode: \u0041 → A */
function unicodeDecode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** Main decode function — runs all decoders in sequence on the input. */
export function decodeHtmlSource(raw: string): DecodeResult {
  const findings: DecodedFinding[] = []
  const stats = {
    scripts: 0,
    inlineHandlers: 0,
    base64Blobs: 0,
    evals: 0,
    dataUris: 0,
    encodedUrls: 0,
    jsonBlobs: 0,
    cssUrls: 0,
  }

  // === 1. Count <script> tags ===
  stats.scripts = (raw.match(/<script\b/gi) || []).length

  // === 2. Find inline event handlers (onclick, onload, onerror, etc.) ===
  const handlerRe = /\son[a-z]+\s*=\s*"([^"]{10,})"/gi
  let m: RegExpExecArray | null
  while ((m = handlerRe.exec(raw)) && findings.length < MAX_FINDINGS) {
    const original = m[1]
    const decoded = hexDecode(unicodeDecode(htmlEntityDecode(original)))
    if (decoded !== original) {
      stats.inlineHandlers++
      findings.push({
        type: 'inline-handler',
        original: truncate(original, MAX_ORIG),
        decoded: truncate(decoded, MAX_DEC),
        location: 'inline event handler',
      })
    }
  }

  // === 3. Find eval() / Function() / new Function() calls ===
  const evalRe = /\b(?:eval|Function)\s*\(\s*(['"`])([^'"`]{10,})\1/gi
  while ((m = evalRe.exec(raw)) && findings.length < MAX_FINDINGS) {
    stats.evals++
    const original = m[2]
    let decoded = original
    // Try base64-decoding first (common obfuscation)
    const b64 = base64Decode(original)
    if (b64 && b64.length > 5) decoded = b64
    decoded = hexDecode(unicodeDecode(decoded))
    findings.push({
      type: 'eval',
      original: truncate(original, MAX_ORIG),
      decoded: truncate(decoded, MAX_DEC),
      location: 'eval/Function call',
    })
  }

  // === 4. Find data: URIs (base64-encoded blobs) ===
  const dataUriRe = /data:([a-z]+\/[a-z+.-]+)?(?:;charset=[^;]+)?;base64,([A-Za-z0-9+/=]{20,})/gi
  while ((m = dataUriRe.exec(raw)) && findings.length < MAX_FINDINGS) {
    stats.dataUris++
    const mime = m[1] || 'unknown'
    const b64 = m[2]
    const decoded = base64Decode(b64) || '[undecodable]'
    findings.push({
      type: 'data-uri',
      original: truncate(`data:${mime};base64,${b64}`, MAX_ORIG),
      decoded: truncate(decoded, MAX_DEC),
      location: `data: URI (${mime})`,
    })
  }

  // === 5. Find standalone Base64 blobs (length > 40, looks like base64) ===
  // Skip ones already inside data: URIs (matched above)
  const b64Re = /["'`]([A-Za-z0-9+/]{40,}={0,2})["'`]/g
  const seenB64 = new Set<string>()
  while ((m = b64Re.exec(raw)) && findings.length < MAX_FINDINGS) {
    const b64 = m[1]
    if (seenB64.has(b64)) continue
    seenB64.add(b64)
    const decoded = base64Decode(b64)
    if (decoded && decoded.length > 5 && !decoded.startsWith('[binary')) {
      stats.base64Blobs++
      findings.push({
        type: 'base64',
        original: truncate(b64, MAX_ORIG),
        decoded: truncate(decoded, MAX_DEC),
        location: 'quoted string',
      })
    }
  }

  // === 6. Find URL-encoded strings (long ones with many %xx) ===
  const urlEncRe = /["'`]((?:%[0-9a-fA-F]{2}|[A-Za-z0-9\-._~!$&'()*+,;=:@/?]){30,})["'`]/g
  while ((m = urlEncRe.exec(raw)) && findings.length < MAX_FINDINGS) {
    const original = m[1]
    // Only count if it has at least 5 % sequences
    const pctCount = (original.match(/%[0-9a-fA-F]{2}/g) || []).length
    if (pctCount < 5) continue
    const decoded = urlDecode(original)
    if (decoded !== original) {
      stats.encodedUrls++
      findings.push({
        type: 'url-encoded',
        original: truncate(original, MAX_ORIG),
        decoded: truncate(decoded, MAX_DEC),
        location: 'URL-encoded string',
      })
    }
  }

  // === 7. Find hex-escape sequences (\x41 \x42 ...) ===
  const hexRe = /["'`]((?:\\x[0-9a-fA-F]{2}){5,})["'`]/g
  while ((m = hexRe.exec(raw)) && findings.length < MAX_FINDINGS) {
    const original = m[1]
    const decoded = hexDecode(original)
    stats.encodedUrls++
    findings.push({
      type: 'hex-escape',
      original: truncate(original, MAX_ORIG),
      decoded: truncate(decoded, MAX_DEC),
      location: 'hex-escaped string',
    })
  }

  // === 8. Find unicode-escape sequences (\u0041 \u0042 ...) ===
  const uniRe = /["'`]((?:\\u[0-9a-fA-F]{4}){3,})["'`]/g
  while ((m = uniRe.exec(raw)) && findings.length < MAX_FINDINGS) {
    const original = m[1]
    const decoded = unicodeDecode(original)
    findings.push({
      type: 'unicode-escape',
      original: truncate(original, MAX_ORIG),
      decoded: truncate(decoded, MAX_DEC),
      location: 'unicode-escaped string',
    })
  }

  // === 9. Find <script type="application/json"> blobs ===
  const jsonScriptRe = /<script[^>]*type=["']application\/(?:json|ld\+json)["'][^>]*>([\s\S]*?)<\/script>/gi
  while ((m = jsonScriptRe.exec(raw)) && findings.length < MAX_FINDINGS) {
    const original = m[1].trim()
    if (original.length < 20) continue
    stats.jsonBlobs++
    try {
      const parsed = JSON.parse(original)
      findings.push({
        type: 'json-blob',
        original: truncate(original, MAX_ORIG),
        decoded: truncate(JSON.stringify(parsed, null, 2), MAX_DEC),
        location: '<script type="application/json">',
      })
    } catch {
      findings.push({
        type: 'json-blob',
        original: truncate(original, MAX_ORIG),
        decoded: '[invalid JSON] ' + truncate(original, MAX_DEC),
        location: '<script type="application/json">',
      })
    }
  }

  // === 10. Find CSS url(...) with content ===
  const cssUrlRe = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi
  while ((m = cssUrlRe.exec(raw)) && findings.length < MAX_FINDINGS) {
    const url = m[2]
    if (url.startsWith('data:')) continue  // already counted in data URIs
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) continue
    stats.cssUrls++
    // Don't add as a finding — too noisy. Just count.
  }

  // === 11. Build fully-decoded version ===
  // Apply all decoders in sequence to produce a "best effort" decoded view
  let decoded = raw
  // Decode HTML entities first
  decoded = htmlEntityDecode(decoded)
  // Decode hex and unicode escapes in JS strings
  decoded = decoded
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => {
      const ch = String.fromCharCode(parseInt(h, 16))
      // Don't replace if it would break the JS syntax (e.g. quotes)
      if (ch === '"' || ch === "'" || ch === '\\') return '\\' + ch
      return ch
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))

  return {
    raw,
    decoded,
    findings: findings.slice(0, MAX_FINDINGS),
    stats,
  }
}
