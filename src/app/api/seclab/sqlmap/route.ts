import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const execFileAsync = promisify(execFile)
const SQLMAP_PATH = '/home/z/my-project/tools/sqlmap/usr/share/sqlmap/sqlmap.py'

type RiskLevel = 1 | 2 | 3 | 4 | 5

const RISK_PROFILES: Record<RiskLevel, { args: string[]; desc: string }> = {
  1: { args: ['--level=1', '--risk=1', '--batch', '--smart'], desc: 'Basic detection (safest)' },
  2: { args: ['--level=2', '--risk=1', '--batch', '--smart'], desc: 'Extended payloads' },
  3: { args: ['--level=3', '--risk=2', '--batch', '--smart'], desc: 'Standard scan' },
  4: { args: ['--level=4', '--risk=3', '--batch'], desc: 'Aggressive — time-based + boolean' },
  5: { args: ['--level=5', '--risk=3', '--batch', '--dump'], desc: 'Full scan + data dump' },
}

export async function POST(req: NextRequest) {
  let body: { url?: string; risk?: number; data?: string; cookie?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const targetUrl = body.url?.trim()
  if (!targetUrl) return NextResponse.json({ error: 'url required' }, { status: 400 })

  const risk = Math.min(Math.max(body.risk ?? 3, 1), 5) as RiskLevel
  const profile = RISK_PROFILES[risk]

  const args = ['-u', targetUrl, ...profile.args]
  if (body.data) args.push('--data', body.data)
  if (body.cookie) args.push('--cookie', body.cookie)

  try {
    const { stdout, stderr } = await execFileAsync('python3', args, {
      timeout: 90000,
      maxBuffer: 1024 * 1024 * 10,
      env: process.env,
    })

    // Parse sqlmap output for vulnerabilities
    const vulns: string[] = []
    const databases: string[] = []
    const tables: string[] = []

    for (const line of stdout.split('\n')) {
      if (/injectable|vulnerable|SQL injection/i.test(line)) vulns.push(line.trim())
      if (/available databases/i.test(line)) {
        const m = line.match(/\[([^\]]+)\]/)
        if (m) databases.push(m[1])
      }
      if (/Database:.*Table/i.test(line)) tables.push(line.trim())
    }

    return NextResponse.json({
      ok: true,
      url: targetUrl,
      risk,
      riskDesc: profile.desc,
      rawOutput: stdout.slice(0, 20000),
      vulnerabilities: vulns,
      databases,
      tables,
      isVulnerable: vulns.length > 0,
    })
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string }
    return NextResponse.json({
      error: e.message,
      rawOutput: (e.stdout ?? '').slice(0, 10000),
      url: targetUrl,
      risk,
    }, { status: 502 })
  }
}
