import { NextResponse } from 'next/server'
import net from 'node:net'
import fs from 'node:fs'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CONTROL_HOST = '127.0.0.1'
const CONTROL_PORT = 9051
const COOKIE_PATH = '/home/z/my-project/tor/data/control_auth_cookie'

/** Connect to the Tor control port, authenticate with the cookie, send NEWNYM. */
function sendNewNym(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let cookie: Buffer
    try {
      cookie = fs.readFileSync(COOKIE_PATH)
    } catch {
      resolve({ ok: false, message: 'control_auth_cookie not found' })
      return
    }

    const sock = new net.Socket()
    sock.setTimeout(5000)
    let buffer = ''
    let authed = false
    let nymed = false

    sock.connect(CONTROL_PORT, CONTROL_HOST, () => {
      // Send AUTHENTICATE with hex cookie
      sock.write(`AUTHENTICATE ${cookie.toString('hex')}\r\n`)
    })

    sock.on('data', (data) => {
      buffer += data.toString('utf8')

      if (!authed && buffer.includes('250 OK')) {
        authed = true
        buffer = ''
        sock.write('SIGNAL NEWNYM\r\n')
        return
      }

      if (authed && !nymed && buffer.includes('250')) {
        nymed = true
        sock.write('QUIT\r\n')
        sock.end()
        resolve({ ok: true, message: 'New identity requested — circuits will rebuild in a few seconds' })
        return
      }

      // Look for error responses (5xx)
      if (/\b5\d\d\b/.test(buffer)) {
        sock.end()
        resolve({ ok: false, message: `Tor control error: ${buffer.trim()}` })
        return
      }
    })

    sock.on('timeout', () => {
      sock.destroy()
      resolve({ ok: false, message: 'control port timeout' })
    })
    sock.on('error', (err) => {
      resolve({ ok: false, message: err.message })
    })
  })
}

export async function POST() {
  const result = await sendNewNym()
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
