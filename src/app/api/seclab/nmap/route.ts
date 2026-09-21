import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const execFileAsync = promisify(execFile)

const NMAP_BIN = '/home/z/my-project/tools/nmap/usr/bin/nmap'
const LD_PATH = '/home/z/my-project/tools/nmap/usr/lib/x86_64-linux-gnu'
const NMAPDIR = '/home/z/my-project/tools/nmap/usr/share/nmap'

type RiskLevel = 1 | 2 | 3 | 4 | 5

const RISK_PROFILES: Record<RiskLevel, { args: string[]; desc: string }> = {
  1: { args: ['-sT', '-T2', '--max-retries', '1', '-Pn'], desc: 'TCP connect scan (safest, no root)' },
  2: { args: ['-sT', '-sV', '-T3', '--max-retries', '1', '-Pn'], desc: 'Service detection (no root)' },
  3: { args: ['-sT', '-sV', '-T4', '--max-retries', '1', '-Pn', '--top-ports', '100'], desc: 'Top 100 ports + service (no root)' },
  4: { args: ['-sT', '-sV', '-T4', '--max-retries', '1', '-Pn', '--top-ports', '1000'], desc: 'Top 1000 ports aggressive (no root)' },
  5: { args: ['-sT', '-sV', '-A', '-T4', '--max-retries', '1', '-Pn', '-p-', '--max-rate', '100'], desc: 'Full scan all ports + OS + scripts (no root)' },
}

export async function POST(req: NextRequest) {
  let body: { host?: string; risk?: number; ports?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const host = body.host?.trim()
  if (!host) return NextResponse.json({ error: 'host required' }, { status: 400 })

  const risk = Math.min(Math.max(body.risk ?? 3, 1), 5) as RiskLevel
  const profile = RISK_PROFILES[risk]

  const args = [...profile.args]
  if (body.ports) args.push('-p', body.ports)
  args.push(host)

  try {
    const { stdout, stderr } = await execFileAsync(NMAP_BIN, args, {
      timeout: 90000,
      maxBuffer: 1024 * 1024 * 5,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: LD_PATH,
        NMAPDIR: NMAPDIR,
      },
    })

    // Parse nmap output for open ports
    const openPorts: { port: number; protocol: string; service: string; version: string }[] = []
    const lines = stdout.split('\n')
    for (const line of lines) {
      const m = line.match(/^(\d+)\/(tcp|udp)\s+(\w+)\s+(.*)$/)
      if (m) {
        openPorts.push({
          port: parseInt(m[1]),
          protocol: m[2],
          service: m[3],
          version: m[4].trim(),
        })
      }
    }

    return NextResponse.json({
      ok: true,
      host,
      risk,
      riskDesc: profile.desc,
      rawOutput: stdout,
      openPorts,
      openCount: openPorts.length,
    })
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string }
    return NextResponse.json({
      error: e.message,
      rawOutput: e.stdout ?? '',
      host,
      risk,
    }, { status: 502 })
  }
}
