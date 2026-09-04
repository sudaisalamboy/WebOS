#!/usr/bin/env node
/**
 * CDP driver for Remote Chrome — drives the browser at localhost:9222.
 * Usage: node cdp_driver.js <command> [args]
 *   node cdp_driver.js navigate <url>
 *   node cdp_driver.js eval "<js>"
 *   node cdp_driver.js eval-file <path>
 *   node cdp_driver.js screenshot <path>
 *   node cdp_driver.js current-url
 *   node cdp_driver.js ping
 *
 * Output: JSON to stdout.
 */
import WebSocket from 'ws'
import http from 'node:http'
import fs from 'node:fs'

const CDP_HTTP = 'http://127.0.0.1:9222'

function getTabWsUrl() {
  return new Promise((resolve, reject) => {
    http.get(`${CDP_HTTP}/json`, { timeout: 5000 }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          const tabs = JSON.parse(body)
          const page = tabs.find((t) => t.type === 'page')
          if (page) resolve(page.webSocketDebuggerUrl)
          else reject(new Error('no page tab'))
        } catch (e) { reject(e) }
      })
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')))
  })
}

function sendCdp(wsUrl, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { origin: 'http://127.0.0.1:9222' })
    const timeout = setTimeout(() => {
      try { ws.close() } catch {}
      reject(new Error(`CDP timeout (${timeoutMs}ms): ${method}`))
    }, timeoutMs)
    let msgId = Math.floor(Math.random() * 1e6) + 1
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.id === msgId) {
          clearTimeout(timeout)
          ws.close()
          if (msg.error) reject(new Error(JSON.stringify(msg.error)))
          else resolve(msg.result || {})
        }
      } catch {}
    })
    ws.on('error', (e) => {
      clearTimeout(timeout)
      reject(new Error(`WS error: ${e.message}`))
    })
  })
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  if (!cmd) {
    console.error('Usage: cdp_driver.js <command> [args]')
    process.exit(1)
  }

  try {
    const wsUrl = await getTabWsUrl()

    if (cmd === 'ping') {
      console.log(JSON.stringify({ ok: true, ws: wsUrl.slice(0, 60) }))
      return
    }

    if (cmd === 'navigate') {
      const url = args[0]
      await sendCdp(wsUrl, 'Page.enable')
      await sendCdp(wsUrl, 'Page.navigate', { url })
      console.log(JSON.stringify({ ok: true, url }))
      return
    }

    if (cmd === 'eval' || cmd === 'eval-file') {
      const expression = cmd === 'eval'
        ? args[0]
        : fs.readFileSync(args[0], 'utf8')
      const result = await sendCdp(wsUrl, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      }, 20000)
      const value = result.result?.value
      const exc = result.exceptionDetails
      if (exc) {
        console.log(JSON.stringify({ ok: false, error: (exc.exception?.description || exc.text || '').slice(0, 500) }))
      } else {
        console.log(JSON.stringify({ ok: true, value }))
      }
      return
    }

    if (cmd === 'screenshot') {
      const path = args[0]
      const result = await sendCdp(wsUrl, 'Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path, Buffer.from(result.data, 'base64'))
      console.log(JSON.stringify({ ok: true, path }))
      return
    }

    if (cmd === 'current-url') {
      const result = await sendCdp(wsUrl, 'Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      })
      console.log(JSON.stringify({ ok: true, url: result.result?.value }))
      return
    }

    console.error(`Unknown command: ${cmd}`)
    process.exit(1)
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }))
    process.exit(1)
  }
}

main()
