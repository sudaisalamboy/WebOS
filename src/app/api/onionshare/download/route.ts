import { NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Returns either:
 *   ?format=script  → a self-contained bash install script (default, ~2 KB)
 *   ?format=tar     → a tar.gz of the venv + tor binary + scripts (~200 MB)
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const format = url.searchParams.get('format') ?? 'script'

  if (format === 'script') {
    const script = [
      '#!/bin/bash',
      '# OnionShare installer — downloads & installs OnionShare CLI + Tor',
      '# Run on any Linux x86_64 machine with bash + python3',
      'set -e',
      '',
      'INSTALL_DIR="${1:-$HOME/onionshare}"',
      'echo "Installing OnionShare to: $INSTALL_DIR"',
      'mkdir -p "$INSTALL_DIR"',
      'cd "$INSTALL_DIR"',
      '',
      '# 1. Create venv',
      'echo "\\xe2\\x86\\x92 Creating Python venv..."',
      'python3 -m venv venv',
      'source venv/bin/activate',
      '',
      '# 2. Install onionshare-cli',
      'echo "\\xe2\\x86\\x92 Installing onionshare-cli (may take a minute)..."',
      'pip install --upgrade pip',
      'pip install onionshare-cli',
      '',
      '# 3. Download Tor Browser Bundle (to get the tor binary)',
      'echo "\\xe2\\x86\\x92 Downloading Tor Browser Bundle..."',
      'curl -L --max-time 600 -o tor-browser.tar.xz \\',
      '  "https://dist.torproject.org/torbrowser/15.0.16/tor-browser-linux-x86_64-15.0.16.tar.xz"',
      'tar xf tor-browser.tar.xz',
      'rm tor-browser.tar.xz',
      '',
      '# 4. Symlink tor binary into venv bin',
      'ln -sf "$INSTALL_DIR/tor-browser/Browser/TorBrowser/Tor/tor" venv/bin/tor',
      'ln -sf "$INSTALL_DIR/tor-browser/Browser/TorBrowser/Tor/tor-gencert" venv/bin/tor-gencert',
      '',
      '# 5. Create launcher script',
      'cat > start-onionshare.sh <<\'EOF_LAUNCHER\'',
      '#!/bin/bash',
      'DIR="$(cd "$(dirname "$0")" && pwd)"',
      'source "$DIR/venv/bin/activate"',
      'export PATH="$DIR/venv/bin:$PATH"',
      'exec onionshare-cli "$@"',
      'EOF_LAUNCHER',
      'chmod +x start-onionshare.sh',
      '',
      'echo ""',
      'echo "\\xe2\\x9c\\x85 Done! OnionShare installed at: $INSTALL_DIR"',
      'echo ""',
      'echo "Usage:"',
      'echo "  $INSTALL_DIR/start-onionshare.sh /path/to/file.txt        # Share a file"',
      'echo "  $INSTALL_DIR/start-onionshare.sh --receive                # Receive files"',
      'echo "  $INSTALL_DIR/start-onionshare.sh --website /path/to/dir   # Host a website"',
      'echo ""',
      'echo "First run will bootstrap Tor (takes 30-60s). You\'ll get a .onion URL."',
      '',
    ].join('\n')

    return new Response(script, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-sh',
        'Content-Disposition': 'attachment; filename="install-onionshare.sh"',
        'Cache-Control': 'no-store',
      },
    })
  }

  if (format === 'tar') {
    const tar = spawn(
      'tar',
      [
        '-czf', '-',
        '-C', '/home/z/my-project',
        'onionshare/venv',
        'onionshare/bin',
        'scripts/start-onionshare.sh',
        'tor/tor-browser/Browser/TorBrowser/Tor',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    const stream = new ReadableStream({
      start(controller) {
        tar.stdout.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk))
        })
        tar.stdout.on('end', () => controller.close())
        tar.on('error', (err) => controller.error(err))
        tar.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            controller.error(new Error('tar exited with code ' + code))
          }
        })
      },
      cancel() {
        tar.kill('SIGTERM')
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': 'attachment; filename="onionshare-bundle.tar.gz"',
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json(
    { error: 'invalid format. Use ?format=script or ?format=tar' },
    { status: 400 }
  )
}
