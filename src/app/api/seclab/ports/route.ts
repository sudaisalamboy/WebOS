import { NextRequest, NextResponse } from 'next/server'
import net from 'node:net'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Top ~30 common ports to scan
const COMMON_PORTS: { port: number; service: string; risk: string }[] = [
  { port: 21, service: 'FTP', risk: 'File transfer. Use SFTP/FTPS instead.' },
  { port: 22, service: 'SSH', risk: 'Secure shell. Restrict by IP, use key auth.' },
  { port: 23, service: 'Telnet', risk: 'INSECURE. Disable immediately — sends data in plaintext.' },
  { port: 25, service: 'SMTP', risk: 'Mail. Restrict to internal, require auth.' },
  { port: 53, service: 'DNS', risk: 'Domain name service. Do not expose recursors publicly.' },
  { port: 80, service: 'HTTP', risk: 'Web. Redirect to HTTPS.' },
  { port: 110, service: 'POP3', risk: 'Mail retrieval. Use POP3S (995) instead.' },
  { port: 111, service: 'RPC', risk: 'INSECURE. Disable if not needed.' },
  { port: 135, service: 'MS-RPC', risk: 'Windows RPC. Block externally.' },
  { port: 139, service: 'NetBIOS', risk: 'INSECURE. SMB v1 — disable.' },
  { port: 143, service: 'IMAP', risk: 'Mail. Use IMAPS (993) instead.' },
  { port: 161, service: 'SNMP', risk: 'INSECURE. Use v3 + restrict by IP.' },
  { port: 389, service: 'LDAP', risk: 'Directory. Use LDAPS (636) instead.' },
  { port: 443, service: 'HTTPS', risk: 'Secure web. Good.' },
  { port: 445, service: 'SMB', risk: 'Windows file sharing. NEVER expose to internet.' },
  { port: 465, service: 'SMTPS', risk: 'Secure SMTP submission.' },
  { port: 514, service: 'Syslog', risk: 'Logs (often UDP, insecure).' },
  { port: 587, service: 'SMTP Submission', risk: 'Mail submission (TLS).' },
  { port: 636, service: 'LDAPS', risk: 'Secure LDAP.' },
  { port: 873, service: 'Rsync', risk: 'File sync. Restrict by IP, require auth.' },
  { port: 993, service: 'IMAPS', risk: 'Secure IMAP.' },
  { port: 995, service: 'POP3S', risk: 'Secure POP3.' },
  { port: 1433, service: 'MSSQL', risk: 'MS SQL Server. NEVER expose to internet.' },
  { port: 1521, service: 'Oracle DB', risk: 'Oracle. NEVER expose to internet.' },
  { port: 2049, service: 'NFS', risk: 'Network file system. NEVER expose to internet.' },
  { port: 2375, service: 'Docker (unencrypted)', risk: 'CRITICAL: Unauthenticated Docker API. Disable immediately.' },
  { port: 2376, service: 'Docker (TLS)', risk: 'Docker API with TLS. Still recommend firewall.' },
  { port: 3306, service: 'MySQL', risk: 'MySQL. NEVER expose to internet.' },
  { port: 3389, service: 'RDP', risk: 'Remote Desktop. Restrict by IP, require NLA + strong passwords.' },
  { port: 5432, service: 'PostgreSQL', risk: 'Postgres. NEVER expose to internet.' },
  { port: 5900, service: 'VNC', risk: 'INSECURE. Use VPN + strong auth.' },
  { port: 6379, service: 'Redis', risk: 'CRITICAL if exposed without auth. NEVER expose to internet.' },
  { port: 8080, service: 'HTTP-alt', risk: 'Alt HTTP. Often admin panels — restrict access.' },
  { port: 8443, service: 'HTTPS-alt', risk: 'Alt HTTPS.' },
  { port: 9000, service: 'PHP-FPM / SonarQube', risk: 'Often admin/dev ports — restrict access.' },
  { port: 9090, service: 'Prometheus / Cockpit', risk: 'Metrics/admin — restrict by IP.' },
  { port: 27017, service: 'MongoDB', risk: 'CRITICAL: Often unauthenticated. NEVER expose to internet.' },
]

function probePort(host: string, port: number, timeoutMs = 3000): Promise<{ open: boolean; banner?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(timeoutMs)
    let banner: string | undefined

    socket.on('connect', () => {
      // For some services, sending a probe gets a banner
      // For HTTP-ish ports, send a minimal HTTP request
      if ([80, 8080, 8443, 443, 9000, 9090].includes(port)) {
        socket.write('HEAD / HTTP/1.0\r\nHost: ' + host + '\r\n\r\n')
      }
      // Wait briefly for banner
      setTimeout(() => {
        socket.destroy()
        resolve({ open: true, banner })
      }, 800)
    })

    socket.on('data', (data: Buffer) => {
      const text = data.toString('utf8').split(/[\r\n]+/)[0].trim()
      if (text && !banner) banner = text.slice(0, 200)
    })

    socket.on('error', () => {
      socket.destroy()
      resolve({ open: false })
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve({ open: false })
    })

    socket.connect(port, host)
  })
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const host = req.nextUrl.searchParams.get('host')
  const portsParam = req.nextUrl.searchParams.get('ports') // comma-separated or "top" or "all"
  const timeoutMs = parseInt(req.nextUrl.searchParams.get('timeout') ?? '3000', 10)

  if (!host) {
    return NextResponse.json({ error: 'host query param required' }, { status: 400 })
  }
  const cleanHost = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].trim()

  // Resolve custom port list
  let portsToScan: { port: number; service: string; risk: string }[]
  if (portsParam && portsParam !== 'top' && portsParam !== 'all') {
    const customPorts = portsParam.split(',').map((p) => parseInt(p.trim(), 10)).filter((p) => p > 0 && p <= 65535)
    portsToScan = customPorts.map((p) => ({
      port: p,
      service: COMMON_PORTS.find((c) => c.port === p)?.service ?? 'Unknown',
      risk: COMMON_PORTS.find((c) => c.port === p)?.risk ?? 'Unknown service',
    }))
  } else {
    portsToScan = COMMON_PORTS
  }

  // Limit max ports to avoid abuse
  if (portsToScan.length > 50) {
    return NextResponse.json({ error: 'Max 50 ports per scan' }, { status: 400 })
  }

  try {
    // Scan all ports in parallel
    const results = await Promise.all(
      portsToScan.map(async (p) => {
        const probe = await probePort(cleanHost, p.port, timeoutMs)
        return {
          port: p.port,
          service: p.service,
          risk: p.risk,
          open: probe.open,
          banner: probe.banner,
        }
      })
    )

    const openPorts = results.filter((r) => r.open)
    const closedPorts = results.filter((r) => !r.open)

    // Risk assessment
    const criticalPorts = openPorts.filter((r) =>
      /CRITICAL|NEVER expose|INSECURE|disable immediately/i.test(r.risk)
    )
    const warningPorts = openPorts.filter(
      (r) => !/CRITICAL|NEVER expose|INSECURE|disable immediately/i.test(r.risk) && /restrict|block|disable/i.test(r.risk)
    )

    return NextResponse.json({
      host: cleanHost,
      totalScanned: results.length,
      openCount: openPorts.length,
      closedCount: closedPorts.length,
      openPorts,
      closedPorts: closedPorts.map((p) => p.port),
      summary: {
        critical: criticalPorts.length,
        warnings: warningPorts.length,
        info: openPorts.length - criticalPorts.length - warningPorts.length,
      },
      message:
        openPorts.length === 0
          ? 'No open ports found among common ports scanned. (Firewall may be filtering or service is down.)'
          : criticalPorts.length > 0
          ? `${criticalPorts.length} CRITICAL open port(s) detected — fix immediately!`
          : warningPorts.length > 0
          ? `${warningPorts.length} open port(s) need attention.`
          : `${openPorts.length} open port(s) — all appear to be standard services.`,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, host: cleanHost }, { status: 502 })
  }
}
