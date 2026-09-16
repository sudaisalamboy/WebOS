import { NextRequest, NextResponse } from 'next/server'
import tls from 'node:tls'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

interface CertInfo {
  subject: Record<string, string> | null
  issuer: Record<string, string> | null
  validFrom: string | null
  validTo: string | null
  serialNumber: string | null
  fingerprint: string | null
  san: string[]
  daysUntilExpiry: number | null
  isExpired: boolean
  isExpiringSoon: boolean // < 30 days
}

function parseCert(cert: tls.PeerCertificate): CertInfo {
  const validFrom = cert.valid_from ? new Date(cert.valid_from) : null
  const validTo = cert.valid_to ? new Date(cert.valid_to) : null
  let daysUntilExpiry: number | null = null
  if (validTo) {
    daysUntilExpiry = Math.floor((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  }

  // Extract SANs (Subject Alternative Names)
  let san: string[] = []
  const sanAny = cert.subjectaltname as unknown
  if (typeof sanAny === 'string') {
    san = (sanAny as string)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  return {
    subject: cert.subject ?? null,
    issuer: cert.issuer ?? null,
    validFrom: cert.valid_from ?? null,
    validTo: cert.valid_to ?? null,
    serialNumber: cert.serialNumber ?? null,
    fingerprint: cert.fingerprint ?? null,
    san,
    daysUntilExpiry,
    isExpired: daysUntilExpiry !== null && daysUntilExpiry < 0,
    isExpiringSoon: daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry < 30,
  }
}

function probeTls(host: string, port: number, timeoutMs = 8000): Promise<{
  protocol: string
  cipher: tls.CipherInfo | null
  cert: CertInfo | null
  alpnProtocol: string | null
}> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false, // we want to grade even invalid certs
      },
      () => {
        const protocol = socket.getProtocol() ?? 'unknown'
        const cipher = socket.getCipher() ?? null
        const alpnProtocol = socket.alpnProtocol
        const peerCert = socket.getPeerCertificate()
        const cert = peerCert && Object.keys(peerCert).length > 0 ? parseCert(peerCert) : null
        socket.end()
        resolve({ protocol, cipher, cert, alpnProtocol })
      }
    )
    socket.setTimeout(timeoutMs)
    socket.on('error', reject)
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error(`TLS connection timed out to ${host}:${port}`))
    })
  })
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const host = req.nextUrl.searchParams.get('host')
  const port = parseInt(req.nextUrl.searchParams.get('port') ?? '443', 10)
  if (!host) {
    return NextResponse.json({ error: 'host query param required' }, { status: 400 })
  }

  try {
    const result = await probeTls(host, port)

    // Security assessments
    const issues: { severity: 'good' | 'warn' | 'bad' | 'info'; message: string }[] = []

    if (!result.cert) {
      issues.push({ severity: 'bad', message: 'No certificate presented by server' })
    } else {
      if (result.cert.isExpired) {
        issues.push({
          severity: 'bad',
          message: `Certificate EXPIRED ${Math.abs(result.cert.daysUntilExpiry ?? 0)} days ago`,
        })
      } else if (result.cert.isExpiringSoon) {
        issues.push({
          severity: 'warn',
          message: `Certificate expires in ${result.cert.daysUntilExpiry} days — renew soon`,
        })
      } else {
        issues.push({
          severity: 'good',
          message: `Certificate valid for ${result.cert.daysUntilExpiry} more days`,
        })
      }

      // Check if cert covers the hostname via SAN
      const coversHost = result.cert.san.some((s) => {
        const hostname = s.replace(/^DNS:/, '').trim()
        if (hostname === host) return true
        if (hostname.startsWith('*.')) {
          const base = hostname.slice(2)
          return host.endsWith(base) && host.split('.').length === base.split('.').length + 1
        }
        return false
      })
      if (coversHost) {
        issues.push({ severity: 'good', message: `Certificate covers ${host} via SAN` })
      } else {
        issues.push({ severity: 'bad', message: `Certificate does NOT cover ${host} — hostname mismatch` })
      }

      // Check issuer (letsencrypt vs self-signed)
      const issuerOrg = result.cert.issuer?.O ?? result.cert.issuer?.CN ?? 'Unknown'
      if (/let'?s encrypt|digicert|sectigo|globalsign|godaddy|comodo|certum|google trust/i.test(issuerOrg)) {
        issues.push({ severity: 'good', message: `Issued by trusted CA: ${issuerOrg}` })
      } else {
        issues.push({
          severity: 'warn',
          message: `Issued by "${issuerOrg}" — verify this is a trusted CA (or self-signed)`,
        })
      }
    }

    // TLS protocol version
    if (result.protocol === 'TLSv1.3') {
      issues.push({ severity: 'good', message: 'Using TLSv1.3 (latest, most secure)' })
    } else if (result.protocol === 'TLSv1.2') {
      issues.push({ severity: 'good', message: 'Using TLSv1.2 (acceptable)' })
    } else if (result.protocol && /TLSv1[._]0|TLSv1[._]1|SSL/i.test(result.protocol)) {
      issues.push({
        severity: 'bad',
        message: `Using deprecated/insecure protocol: ${result.protocol}. Disable and require TLSv1.2+`,
      })
    } else {
      issues.push({ severity: 'info', message: `Protocol: ${result.protocol}` })
    }

    // ALPN (HTTP/2)
    if (result.alpnProtocol === 'h2') {
      issues.push({ severity: 'good', message: 'HTTP/2 enabled via ALPN' })
    } else if (result.alpnProtocol === 'http/1.1') {
      issues.push({ severity: 'info', message: 'HTTP/1.1 only (consider enabling HTTP/2)' })
    } else {
      issues.push({ severity: 'info', message: `ALPN: ${result.alpnProtocol ?? 'none'}` })
    }

    // Cipher strength
    if (result.cipher) {
      const isAead = /GCM|CCM|ChaCha20/i.test(result.cipher.name)
      const isPfs = /ECDHE|DHE/i.test(result.cipher.name)
      if (isAead && isPfs) {
        issues.push({
          severity: 'good',
          message: `Strong cipher: ${result.cipher.name} (AEAD + PFS)`,
        })
      } else if (isAead || isPfs) {
        issues.push({
          severity: 'warn',
          message: `Acceptable cipher: ${result.cipher.name} (${isAead ? 'AEAD' : 'no AEAD'}, ${isPfs ? 'PFS' : 'no PFS'})`,
        })
      } else {
        issues.push({
          severity: 'bad',
          message: `Weak cipher: ${result.cipher.name} — prefer AEAD + PFS ciphers`,
        })
      }
    }

    return NextResponse.json({
      host,
      port,
      ...result,
      issues,
      score: Math.round(
        (issues.filter((i) => i.severity === 'good').length / Math.max(issues.length, 1)) * 100
      ),
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: (err as Error).message,
        host,
        port,
        hint: 'Make sure the host supports HTTPS on the specified port',
      },
      { status: 502 }
    )
  }
}
