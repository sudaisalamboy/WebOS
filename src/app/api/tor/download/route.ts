import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUNDLE_PATH = '/home/z/my-project/tor/tor-browser.tar.xz'
const BUNDLE_FILENAME = 'tor-browser-linux-x86_64-15.0.16.tar.xz'

export async function GET(_req: NextRequest) {
  try {
    if (!fs.existsSync(BUNDLE_PATH)) {
      return new Response(JSON.stringify({ error: 'Bundle not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const stat = fs.statSync(BUNDLE_PATH)
    const stream = fs.createReadStream(BUNDLE_PATH)

    // Convert Node stream to Web ReadableStream for Response
    const webStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk))
        })
        stream.on('end', () => controller.close())
        stream.on('error', (err) => controller.error(err))
      },
      cancel() {
        stream.destroy()
      },
    })

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-xz',
        'Content-Length': stat.size.toString(),
        'Content-Disposition': `attachment; filename="${BUNDLE_FILENAME}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// Allow large file response
export const maxDuration = 300
