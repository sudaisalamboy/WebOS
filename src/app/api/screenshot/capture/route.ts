import { NextRequest, NextResponse } from 'next/server'
import puppeteer from 'puppeteer-core'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHROME_PATHS = [
  '/home/z/.agent-browser/browsers/chrome-149.0.7827.115/chrome',
  '/home/z/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
  '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
]

function findChrome(): string {
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p
  }
  throw new Error('Chrome not found')
}

const PICTURES_DIR = '/home/z/my-project/user-files/Pictures'

interface ScreenshotBody {
  url?: string
  width?: number
  height?: number
  fullPage?: boolean
  format?: 'png' | 'jpeg'
  wait?: number
  dark?: boolean
}

export async function POST(req: NextRequest) {
  let body: ScreenshotBody
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const url = body.url?.trim()
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  let targetUrl = url
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl

  try { new URL(targetUrl) } catch {
    return NextResponse.json({ error: 'invalid URL' }, { status: 400 })
  }

  const width = Math.min(Math.max(body.width ?? 1920, 320), 4096)
  const height = Math.min(Math.max(body.height ?? 1080, 240), 4096)
  const fullPage = body.fullPage ?? false
  const format = body.format ?? 'png'
  const waitMs = Math.min(Math.max(body.wait ?? 2000, 0), 15000)
  const dark = body.dark ?? false

  try {
    mkdirSync(PICTURES_DIR, { recursive: true })
    const browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run',`--window-size=${width},${height}`],
    })
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])

    await page.setRequestInterception(true)
    page.on('request', (r) => { ['font','media'].includes(r.resourceType()) ? r.abort() : r.continue() })

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs))

    const hostname = (() => { try { return new URL(targetUrl).hostname.replace(/^www\./,'') } catch { return 'screenshot' } })()
    const timestamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)
    const filename = `${hostname}-${timestamp}.${format}`
    const filepath = path.join(PICTURES_DIR, filename)

    const screenshot = await page.screenshot({ type: format as 'png'|'jpeg', fullPage })
    writeFileSync(filepath, screenshot)
    await browser.close()

    return NextResponse.json({ ok: true, url: targetUrl, filename, path: `/Pictures/${filename}`, size: screenshot.length, width, height, fullPage })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, url: targetUrl }, { status: 502 })
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  const fullPage = req.nextUrl.searchParams.get('full') === 'true'
  const width = parseInt(req.nextUrl.searchParams.get('w') ?? '1920')
  const height = parseInt(req.nextUrl.searchParams.get('h') ?? '1080')
  const format = (req.nextUrl.searchParams.get('format') ?? 'png') as 'png' | 'jpeg'
  const dark = req.nextUrl.searchParams.get('dark') === 'true'
  return POST(new NextRequest(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, fullPage, width, height, format, dark }) }))
}
