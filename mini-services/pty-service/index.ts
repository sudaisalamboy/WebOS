/**
 * PTY WebSocket service — spawns a real bash shell in a pseudo-terminal
 * and pipes its I/O over a WebSocket so xterm.js can render it.
 *
 * Port: 3003 (fixed)
 * Path: / (Caddy routes via XTransformPort=3003)
 *
 * Architecture:
 *   - We spawn a Python helper script that uses os.fork() + pty.fork()
 *     to create a real PTY running /bin/bash.
 *   - We pipe the PTY master fd ↔ the WebSocket.
 *   - Resize messages from xterm.js are handled ({"type":"resize","cols":80,"rows":24}).
 *
 * Security: the shell starts in /home/z/my-project/user-files (the WebOS
 * sandbox root). It's not a chroot jail — users CAN cd out — but the
 * terminal is gated behind WebOS auth, so only the logged-in owner can
 * use it.
 */
import { WebSocketServer } from 'ws'
import { spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'

const PORT = 3003
const SANDBOX_ROOT = '/home/z/my-project/user-files'

// Ensure sandbox root exists
if (!existsSync(SANDBOX_ROOT)) {
  mkdirSync(SANDBOX_ROOT, { recursive: true })
}

const wss = new WebSocketServer({ port: PORT, path: '/' }, () => {
  console.log(`PTY WebSocket service listening on port ${PORT}`)
})

wss.on('connection', (ws, req) => {
  console.log(`[+] New PTY connection from ${req.socket.remoteAddress}`)

  // Spawn the Python PTY helper — it handles fork() + exec(bash)
  // and stays alive as long as the shell is running.
  const helper = spawn('python3', ['-u', '/home/z/my-project/mini-services/pty-service/pty_helper.py'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Make the shell start in the WebOS sandbox root
      HOME: process.env.HOME || '/home/z',
      TERM: 'xterm-256color',
      SHELL: '/bin/bash',
      // PS1 prompt
      PS1: '\\[\\033[01;32m\\]webos-user@webos\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ ',
      // Disable history expansion to avoid surprises
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    },
  })

  let shellPid: number | null = null

  // Read the first line from helper's stderr — it's the PID of the shell
  helper.stderr.setEncoding('utf8')
  helper.stderr.on('data', (data: string) => {
    const lines = data.split('\n').filter(Boolean)
    for (const line of lines) {
      if (line.startsWith('PID:')) {
        shellPid = parseInt(line.slice(4).trim(), 10)
        console.log(`    Shell PID: ${shellPid}`)
      } else if (line.startsWith('ERR:')) {
        console.error(`    Helper error: ${line.slice(4)}`)
        ws.send(`\r\n\x1b[31m[PTY error: ${line.slice(4)}]\x1b[0m\r\n`)
      } else {
        console.error(`    Helper stderr: ${line}`)
      }
    }
  })

  // Pipe helper stdout → WebSocket (terminal output from bash/vim/etc.)
  helper.stdout.on('data', (data: Buffer) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data)
    }
  })

  // Pipe WebSocket → helper stdin (keyboard input from xterm.js)
  ws.on('message', (msg: Buffer | string) => {
    let data: Buffer
    if (typeof msg === 'string') {
      data = Buffer.from(msg)
    } else {
      data = msg as Buffer
    }

    // Check if it's a JSON control message (resize)
    const str = data.toString('utf8')
    if (str.startsWith('{') && str.includes('"type"')) {
      try {
        const ctrl = JSON.parse(str)
        if (ctrl.type === 'resize' && shellPid) {
          // Send SIGWINCH won't work without the pty fd; instead write
          // the TIOCSWINSZ ioctl via the helper. Send as a control message.
          // Actually our helper uses pty.fork which makes the child the
          // session leader. We can send a resize command to the helper.
          helper.stdin.write(`\x00RESIZE:${ctrl.cols}x${ctrl.rows}\x00`)
          return
        }
        if (ctrl.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
          return
        }
      } catch {
        // Not JSON — treat as raw input
      }
    }

    // Raw keyboard input → PTY
    if (helper.stdin.writable) {
      helper.stdin.write(data)
    }
  })

  ws.on('close', () => {
    console.log(`[-] PTY connection closed`)
    // Kill the shell process + helper
    try {
      if (shellPid) process.kill(shellPid, 'SIGHUP')
    } catch {}
    try { helper.kill('SIGTERM') } catch {}
    try { helper.kill('SIGKILL') } catch {}
  })

  ws.on('error', (err) => {
    console.error(`[!] WebSocket error: ${err.message}`)
    try { helper.kill('SIGKILL') } catch {}
  })

  helper.on('exit', (code, signal) => {
    console.log(`    Helper exited (code=${code}, signal=${signal})`)
    if (ws.readyState === ws.OPEN) {
      ws.send(`\r\n\x1b[33m[Session ended]\x1b[0m\r\n`)
      ws.close()
    }
  })
})

wss.on('error', (err) => {
  console.error(`[!] Server error: ${err.message}`)
})

// Graceful shutdown
const shutdown = (sig: string) => {
  console.log(`\nReceived ${sig}, shutting down...`)
  wss.clients.forEach((ws) => {
    try { ws.send(`\r\n\x1b[31m[Server shutting down]\x1b[0m\r\n`); ws.close() } catch {}
  })
  wss.close(() => process.exit(0))
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
