import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAC_FILE = '/home/z/my-project/tor/config/proxy.pac'

/**
 * GET /api/vnc/mode
 * Returns the current proxy mode:
 *   - "media-direct" — media files bypass Tor (fast video), browsing via Tor
 *   - "full-tor" — everything via Tor (maximum anonymity, slow video)
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  try {
    const pac = require('fs').readFileSync(PAC_FILE, 'utf8')
    // Check if the PAC file currently routes media to DIRECT
    const isMediaDirect = pac.includes('return "DIRECT"')
    return NextResponse.json({
      mode: isMediaDirect ? 'media-direct' : 'full-tor',
      description: isMediaDirect
        ? 'Media files (.mp4, .m3u8, .mp3) and media CDNs bypass Tor for fast video. Browsing still anonymous via Tor.'
        : 'All traffic via Tor (maximum anonymity, video will be slow)',
    })
  } catch {
    return NextResponse.json({ mode: 'unknown', error: 'PAC file not found' })
  }
}

/**
 * POST /api/vnc/mode
 * Body: { mode: 'media-direct' | 'full-tor' }
 *
 * Switches the proxy mode by rewriting the PAC file.
 * Takes effect on the NEXT Chrome restart (call /api/vnc/restart to apply immediately).
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let body: { mode?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const mode = body.mode
  if (mode !== 'media-direct' && mode !== 'full-tor') {
    return NextResponse.json({ error: 'mode must be "media-direct" or "full-tor"' }, { status: 400 })
  }

  const fs = require('fs')
  let pac: string

  if (mode === 'media-direct') {
    pac = `// PAC script: media=direct (fast), browsing=Tor (anonymous)
function FindProxyForURL(url, host) {
  // Media file extensions → DIRECT
  if (/\\.(mp4|webm|mkv|avi|mov|m4v|ogv|mp3|ogg|m4a|wav|aac|flac|m3u8|ts|mpd)(\\?|$)/i.test(url)) {
    return "DIRECT";
  }
  // Known media CDNs → DIRECT
  var mediaDomains = [
    "xvideos-cdn.com", "thumb-cdn77.xvideos-cdn.com", "thumbs-gcore.xvideos-cdn.com",
    "static-okxxx.xvideos-cdn.com", "cdn-static.xvideos-cdn.com",
    "okxxx1.com", "static.okxxx1.com", "ok.porn", "static.ok.porn",
    "hw-cdn2.ang-content.com", "ang-content.com",
    "bkcdn.net", "privatehost.com", "nvms12.cdn.privatehost.com",
    "project1content.com", "images-assets.project1content.com",
    "googlevideo.com", "ytimg.com", "cdnjs.cloudflare.com", "jsdelivr.net",
    "unpkg.com",
  ];
  for (var i = 0; i < mediaDomains.length; i++) {
    if (dnsDomainIs(host, mediaDomains[i]) || host.indexOf(mediaDomains[i]) !== -1) {
      return "DIRECT";
    }
  }
  // Everything else → Tor
  return "SOCKS5 127.0.0.1:9050; SOCKS 127.0.0.1:9050";
}`
  } else {
    pac = `// PAC script: ALL traffic via Tor (maximum anonymity)
function FindProxyForURL(url, host) {
  return "SOCKS5 127.0.0.1:9050; SOCKS 127.0.0.1:9050";
}`
  }

  try {
    fs.writeFileSync(PAC_FILE, pac)
    return NextResponse.json({
      ok: true,
      mode,
      message: mode === 'media-direct'
        ? 'Media files will bypass Tor for fast video. Restart Chrome to apply.'
        : 'All traffic will go through Tor. Restart Chrome to apply.',
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
