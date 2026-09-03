/**
 * YouTube URL handler — converts any YouTube URL into an embeddable iframe URL.
 *
 * Why: youtube.com/ and youtube.com/watch?v= send `X-Frame-Options: SAMEORIGIN`,
 * so they can't be embedded in iframes directly. But youtube.com/embed/<videoId>
 * doesn't send that header, so it CAN be embedded.
 *
 * Also handles: youtu.be short links, playlists, search, channel URLs.
 */

export interface YouTubeConversion {
  isYouTube: boolean
  embeddableUrl: string | null  // null = can't be embedded, fall back to opening in new tab
  reason?: string
  kind: 'video' | 'playlist' | 'search' | 'channel' | 'live' | 'home' | 'unknown'
}

export function convertYouTubeUrl(rawUrl: string): YouTubeConversion {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { isYouTube: false, embeddableUrl: null, kind: 'unknown' }
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const isYT = host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be'

  if (!isYT) {
    return { isYouTube: false, embeddableUrl: null, kind: 'unknown' }
  }

  // youtu.be/<videoId>  →  youtube.com/embed/<videoId>
  if (host === 'youtu.be') {
    const videoId = url.pathname.slice(1).split('/')[0]
    if (videoId) {
      const params = new URLSearchParams()
      const t = url.searchParams.get('t') || url.searchParams.get('start')
      if (t) params.set('start', parseTime(t).toString())
      const qs = params.toString()
      return {
        isYouTube: true,
        embeddableUrl: `https://www.youtube.com/embed/${videoId}${qs ? '?' + qs : ''}`,
        kind: 'video',
      }
    }
  }

  // youtube.com/watch?v=<videoId>
  if (url.pathname === '/watch') {
    const videoId = url.searchParams.get('v')
    if (videoId) {
      const params = new URLSearchParams()
      const t = url.searchParams.get('t') || url.searchParams.get('start')
      if (t) params.set('start', parseTime(t).toString())
      const list = url.searchParams.get('list')
      if (list) params.set('list', list)
      const qs = params.toString()
      return {
        isYouTube: true,
        embeddableUrl: `https://www.youtube.com/embed/${videoId}${qs ? '?' + qs : ''}`,
        kind: 'video',
      }
    }
  }

  // youtube.com/embed/<videoId>  (already embeddable)
  if (url.pathname.startsWith('/embed/')) {
    return { isYouTube: true, embeddableUrl: url.href, kind: 'video' }
  }

  // youtube.com/playlist?list=<playlistId>
  if (url.pathname === '/playlist') {
    const list = url.searchParams.get('list')
    if (list) {
      return {
        isYouTube: true,
        embeddableUrl: `https://www.youtube.com/embed/videoseries?list=${list}`,
        kind: 'playlist',
      }
    }
  }

  // youtube.com/results?search_query=<query>
  if (url.pathname === '/results') {
    const q = url.searchParams.get('search_query')
    if (q) {
      // We can't embed search results directly. Open in new tab.
      return {
        isYouTube: true,
        embeddableUrl: null,
        kind: 'search',
        reason: 'YouTube search results cannot be embedded. Open in new tab.',
      }
    }
  }

  // youtube.com/@channel  or  /channel/UC...  or  /user/name  or  /c/name
  if (/^\/(@[\w.-]+|channel\/[\w-]+|user\/[\w.-]+|c\/[\w.-]+)$/.test(url.pathname)) {
    return {
      isYouTube: true,
      embeddableUrl: null,
      kind: 'channel',
      reason: 'YouTube channel pages cannot be embedded. Open in new tab.',
    }
  }

  // youtube.com/live/<videoId>
  if (url.pathname.startsWith('/live/')) {
    const videoId = url.pathname.slice('/live/'.length).split('/')[0]
    if (videoId) {
      return {
        isYouTube: true,
        embeddableUrl: `https://www.youtube.com/embed/${videoId}`,
        kind: 'live',
      }
    }
  }

  // youtube.com/shorts/<videoId>
  if (url.pathname.startsWith('/shorts/')) {
    const videoId = url.pathname.slice('/shorts/'.length).split('/')[0]
    if (videoId) {
      return {
        isYouTube: true,
        embeddableUrl: `https://www.youtube.com/embed/${videoId}`,
        kind: 'video',
      }
    }
  }

  // youtube.com/ (home page)
  if (url.pathname === '/' || url.pathname === '') {
    return {
      isYouTube: true,
      embeddableUrl: null,
      kind: 'home',
      reason: 'YouTube homepage cannot be embedded. Open in new tab or use search.',
    }
  }

  // Unknown YouTube URL — try opening in new tab
  return {
    isYouTube: true,
    embeddableUrl: null,
    kind: 'unknown',
    reason: 'This YouTube URL cannot be embedded. Open in new tab.',
  }
}

/** Parse YouTube time formats: 1m30s, 90, 1:30, 90s → seconds */
function parseTime(t: string): number {
  if (/^\d+$/.test(t)) return parseInt(t, 10)
  const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/)
  if (m) {
    const h = parseInt(m[1] ?? '0', 10)
    const min = parseInt(m[2] ?? '0', 10)
    const s = parseInt(m[3] ?? '0', 10)
    return h * 3600 + min * 60 + s
  }
  // 1:30 format
  if (/^\d+:\d+$/.test(t)) {
    const [min, sec] = t.split(':').map((n) => parseInt(n, 10))
    return min * 60 + sec
  }
  return 0
}
