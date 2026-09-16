'use client'

import { useState, useCallback } from 'react'
import {
  Shield, Globe, Server, Lock, Network, FolderSearch, Code2,
  Search, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Info,
  ChevronRight, ExternalLink, Clock, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type TabId = 'headers' | 'ssl' | 'tech' | 'dns' | 'subdomains' | 'ports' | 'dirs' | 'endpoints' | 'whois'

interface TabDef {
  id: TabId
  label: string
  icon: React.ReactNode
  apiPath: string
  inputLabel: string
  inputPlaceholder: string
  param: 'url' | 'host' | 'domain'
  desc: string
}

const TABS: TabDef[] = [
  { id: 'headers', label: 'HTTP Headers', icon: <Server className="h-4 w-4" />, apiPath: '/api/seclab/headers', inputLabel: 'Target URL', inputPlaceholder: 'example.com or https://example.com', param: 'url', desc: 'Fetch HTTP response headers + grade security headers (CSP, HSTS, XFO, etc.)' },
  { id: 'ssl', label: 'SSL/TLS', icon: <Lock className="h-4 w-4" />, apiPath: '/api/seclab/ssl', inputLabel: 'Hostname', inputPlaceholder: 'example.com', param: 'host', desc: 'Analyze SSL/TLS certificate, chain, cipher strength, protocols' },
  { id: 'tech', label: 'Tech Stack', icon: <Code2 className="h-4 w-4" />, apiPath: '/api/seclab/tech', inputLabel: 'Target URL', inputPlaceholder: 'example.com', param: 'url', desc: 'Detect web framework, server, CMS, analytics, libraries (Wappalyzer-style)' },
  { id: 'dns', label: 'DNS Lookup', icon: <Network className="h-4 w-4" />, apiPath: '/api/seclab/dns', inputLabel: 'Domain', inputPlaceholder: 'example.com', param: 'domain', desc: 'Resolve A, AAAA, CNAME, NS, MX, TXT, SOA, SRV records' },
  { id: 'subdomains', label: 'Subdomains', icon: <FolderSearch className="h-4 w-4" />, apiPath: '/api/seclab/subdomains', inputLabel: 'Domain', inputPlaceholder: 'example.com', param: 'domain', desc: 'Passive subdomain enumeration via Certificate Transparency logs (crt.sh)' },
  { id: 'ports', label: 'Port Scan', icon: <Zap className="h-4 w-4" />, apiPath: '/api/seclab/ports', inputLabel: 'Host', inputPlaceholder: 'example.com or 1.2.3.4', param: 'host', desc: 'Scan top 30 common TCP ports (FTP, SSH, HTTP, HTTPS, DBs, etc.)' },
  { id: 'dirs', label: 'Path Scan', icon: <FolderSearch className="h-4 w-4" />, apiPath: '/api/seclab/dirs', inputLabel: 'Target URL', inputPlaceholder: 'https://example.com', param: 'url', desc: 'Enumerate common sensitive paths (.git, .env, admin panels, backups, etc.)' },
  { id: 'endpoints', label: 'JS Endpoints', icon: <Search className="h-4 w-4" />, apiPath: '/api/seclab/endpoints', inputLabel: 'Target URL', inputPlaceholder: 'https://example.com', param: 'url', desc: 'Extract API endpoints, fetch URLs, and routes from page JavaScript' },
  { id: 'whois', label: 'WHOIS', icon: <Globe className="h-4 w-4" />, apiPath: '/api/seclab/whois', inputLabel: 'Domain', inputPlaceholder: 'example.com', param: 'domain', desc: 'Lookup domain registration, registrar, name servers, expiry' },
]

export function SecurityLabApp() {
  const [tab, setTab] = useState<TabId>('headers')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  const activeTab = TABS.find((t) => t.id === tab)!

  const run = useCallback(async () => {
    if (!input.trim()) {
      setError('Enter a target first')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const url = `${activeTab.apiPath}?${activeTab.param}=${encodeURIComponent(input.trim())}`
      const res = await fetch(url, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`)
      } else {
        setResult(data)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [input, activeTab])

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="border-b border-emerald-500/20 px-5 py-3 bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <Shield className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Security Lab</h1>
            <p className="text-xs text-zinc-400">
              Recon & vulnerability scanning — only use on sites you own or have permission to test
            </p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-800 bg-zinc-900/30 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id)
              setResult(null)
              setError(null)
            }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition whitespace-nowrap',
              tab === t.id
                ? 'border-emerald-500 text-emerald-300 bg-emerald-500/5'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Input area */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/20">
        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 block">
          {activeTab.inputLabel}
        </label>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder={activeTab.inputPlaceholder}
            className="flex-1 rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-500/60 font-mono"
          />
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-zinc-950 font-medium px-4 py-2 text-sm transition"
          >
            {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {loading ? 'Scanning...' : 'Run'}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 mt-2">{activeTab.desc}</p>
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-12 text-zinc-500">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Running scan... (may take 10-30s)</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-start gap-2 rounded-md bg-rose-500/15 text-rose-300 px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-medium">Scan failed</div>
              <div className="text-xs text-rose-400/80 mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {!loading && !error && !result && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500 text-center">
            <Shield className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm font-medium">Enter a target above and click Run</p>
            <p className="text-xs mt-1 text-zinc-600">All scans run server-side through WebOS</p>
          </div>
        )}

        {!loading && !error && result && (
          <ResultRenderer tab={tab} data={result} />
        )}
      </div>
    </div>
  )
}

function ResultRenderer({ tab, data }: { tab: TabId; data: unknown }) {
  switch (tab) {
    case 'headers': return <HeadersResult data={data as Record<string, unknown>} />
    case 'ssl': return <SslResult data={data as Record<string, unknown>} />
    case 'tech': return <TechResult data={data as Record<string, unknown>} />
    case 'dns': return <DnsResult data={data as Record<string, unknown>} />
    case 'subdomains': return <SubdomainsResult data={data as Record<string, unknown>} />
    case 'ports': return <PortsResult data={data as Record<string, unknown>} />
    case 'dirs': return <DirsResult data={data as Record<string, unknown>} />
    case 'endpoints': return <EndpointsResult data={data as Record<string, unknown>} />
    case 'whois': return <WhoisResult data={data as Record<string, unknown>} />
    default: return null
  }
}

// === Result components ===

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case 'good': return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
    case 'warn': return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
    case 'bad': return <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
    default: return <Info className="h-4 w-4 text-sky-400 shrink-0" />
  }
}

function ScoreBadge({ score, label = 'Score' }: { score: number; label?: string }) {
  const color = score >= 80 ? 'text-emerald-400 bg-emerald-500/15 ring-emerald-500/30'
    : score >= 50 ? 'text-amber-400 bg-amber-500/15 ring-amber-500/30'
    : 'text-rose-400 bg-rose-500/15 ring-rose-500/30'
  return (
    <div className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold ring-1', color)}>
      <Shield className="h-3.5 w-3.5" />
      {label}: {score}/100
    </div>
  )
}

function HeadersResult({ data }: { data: Record<string, unknown> }) {
  const checks = (data.securityChecks ?? []) as Array<Record<string, unknown>>
  const allHeaders = (data.allHeaders ?? {}) as Record<string, string>
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <ScoreBadge score={data.score as number} />
        <span className="text-xs text-zinc-400">
          HTTP <span className="text-zinc-200 font-mono">{data.status}</span> · {checks.length} checks
        </span>
        <div className="flex gap-2 text-xs">
          <span className="text-emerald-400">✓ {(data.summary as Record<string, number>)?.good} good</span>
          <span className="text-amber-400">⚠ {(data.summary as Record<string, number>)?.warn} warn</span>
          <span className="text-rose-400">✗ {(data.summary as Record<string, number>)?.bad} bad</span>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Security Headers</h3>
        <div className="space-y-1.5">
          {checks.map((c, i) => (
            <div key={i} className="rounded-md bg-zinc-900/60 border border-zinc-800 p-2.5">
              <div className="flex items-center gap-2">
                <SeverityIcon severity={c.severity as string} />
                <span className="text-sm font-medium flex-1">{c.name}</span>
                <span className={cn(
                  'text-[10px] uppercase px-1.5 py-0.5 rounded',
                  c.severity === 'good' ? 'bg-emerald-500/15 text-emerald-400' :
                  c.severity === 'warn' ? 'bg-amber-500/15 text-amber-400' :
                  c.severity === 'bad' ? 'bg-rose-500/15 text-rose-400' :
                  'bg-sky-500/15 text-sky-400'
                )}>
                  {c.present ? 'present' : 'missing'}
                </span>
              </div>
              {c.value && (
                <div className="mt-1.5 text-xs font-mono text-zinc-400 bg-zinc-950/50 rounded px-2 py-1 break-all">
                  {c.value.slice(0, 200)}{(c.value as string).length > 200 ? '...' : ''}
                </div>
              )}
              {c.recommendation && (
                <div className="mt-1.5 text-xs text-amber-300/80 flex items-start gap-1.5">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>{c.recommendation}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">All Response Headers</h3>
        <pre className="text-xs font-mono bg-zinc-950/60 border border-zinc-800 rounded p-2 max-h-64 overflow-y-auto">
          {Object.entries(allHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}
        </pre>
      </div>
    </div>
  )
}

function SslResult({ data }: { data: Record<string, unknown> }) {
  const issues = (data.issues ?? []) as Array<{ severity: string; message: string }>
  const cert = (data.cert ?? null) as Record<string, unknown> | null
  const cipher = (data.cipher ?? null) as Record<string, unknown> | null
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <ScoreBadge score={data.score as number} />
        <span className="text-xs text-zinc-400">
          {data.host}:{data.port as number} · {data.protocol as string}
        </span>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Issues</h3>
        <div className="space-y-1.5">
          {issues.map((i, idx) => (
            <div key={idx} className="flex items-start gap-2 text-sm">
              <SeverityIcon severity={i.severity} />
              <span className="text-zinc-300">{i.message}</span>
            </div>
          ))}
        </div>
      </div>

      {cert && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Certificate</h3>
          <div className="rounded-md bg-zinc-900/60 border border-zinc-800 p-3 space-y-1.5 text-xs">
            <Field label="Subject CN" value={(cert.subject as Record<string, string>)?.CN} />
            <Field label="Subject O" value={(cert.subject as Record<string, string>)?.O} />
            <Field label="Issuer" value={(cert.issuer as Record<string, string>)?.O ?? (cert.issuer as Record<string, string>)?.CN} />
            <Field label="Valid From" value={cert.validFrom as string} />
            <Field label="Valid To" value={cert.validTo as string} />
            <Field label="Days Until Expiry" value={cert.daysUntilExpiry as number} />
            <Field label="Serial" value={cert.serialNumber as string} />
            <Field label="Fingerprint" value={cert.fingerprint as string} mono />
            <div>
              <div className="text-zinc-500 mb-1">SAN (Subject Alt Names):</div>
              <div className="font-mono text-zinc-300 space-y-0.5">
                {((cert.san as string[]) ?? []).map((s, i) => (
                  <div key={i}>• {s}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {cipher && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Cipher</h3>
          <div className="rounded-md bg-zinc-900/60 border border-zinc-800 p-3 space-y-1.5 text-xs">
            <Field label="Name" value={cipher.name as string} mono />
            <Field label="Version" value={cipher.version as string} />
            <Field label="ALPN" value={(data.alpnProtocol as string) ?? 'none'} />
          </div>
        </div>
      )}
    </div>
  )
}

function TechResult({ data }: { data: Record<string, unknown> }) {
  const techs = (data.technologies ?? []) as Array<Record<string, unknown>>
  const byCategory = techs.reduce<Record<string, Array<Record<string, unknown>>>>((acc, t) => {
    const cat = t.category as string
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(t)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm">
          <span className="font-bold text-zinc-200">{techs.length}</span> technologies detected
        </span>
        <span className="text-xs text-zinc-500">HTTP {data.status as number}</span>
      </div>

      {techs.length === 0 ? (
        <div className="text-sm text-zinc-500">No technologies detected. The site may block bots or use minimal stack.</div>
      ) : (
        <div className="space-y-3">
          {Object.entries(byCategory).map(([cat, items]) => (
            <div key={cat}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-1.5">{cat}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {items.map((t, i) => (
                  <div key={i} className="rounded-md bg-zinc-900/60 border border-zinc-800 p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-200">{t.name as string}</span>
                      {t.version && (
                        <span className="text-[10px] font-mono text-zinc-500">v{t.version as string}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-1">{t.evidence as string}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DnsResult({ data }: { data: Record<string, unknown> }) {
  const records = (data.records ?? {}) as Record<string, unknown>
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">{data.domain as string}</span>
        {data.ip && (
          <span className="text-xs text-zinc-400">
            Resolves to <span className="text-emerald-400 font-mono">{data.ip as string}</span>
          </span>
        )}
      </div>

      <div className="space-y-3">
        {Object.entries(records).map(([type, value]) => (
          <div key={type}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-1.5">{type} Record</h3>
            {Array.isArray(value) ? (
              value.length === 0 ? (
                <div className="text-xs text-zinc-500">No records</div>
              ) : (
                <div className="space-y-1">
                  {value.map((v, i) => (
                    <div key={i} className="rounded bg-zinc-900/60 border border-zinc-800 px-2 py-1 text-xs font-mono text-zinc-300 break-all">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="rounded bg-zinc-900/60 border border-zinc-800 px-2 py-1 text-xs font-mono text-zinc-300">
                {JSON.stringify(value, null, 2)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SubdomainsResult({ data }: { data: Record<string, unknown> }) {
  const subdomains = (data.subdomains ?? []) as Array<Record<string, unknown>>
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm">
          <span className="font-bold text-zinc-200">{data.total as number}</span> subdomains found
        </span>
        <span className="text-xs text-zinc-500">Source: {data.source as string}</span>
      </div>

      {subdomains.length === 0 ? (
        <div className="text-sm text-zinc-500">No subdomains found via CT logs.</div>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {subdomains.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded bg-zinc-900/60 border border-zinc-800 px-2.5 py-1.5 text-xs">
              <Globe className="h-3 w-3 text-emerald-400 shrink-0" />
              <span className="font-mono text-zinc-200 flex-1 truncate">{s.name as string}</span>
              {s.expired && <span className="text-[10px] text-rose-400">expired</span>}
              <span className="text-[10px] text-zinc-500">{s.count as number} cert(s)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PortsResult({ data }: { data: Record<string, unknown> }) {
  const openPorts = (data.openPorts ?? []) as Array<Record<string, unknown>>
  const summary = (data.summary ?? {}) as Record<string, number>
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm">
          <span className="font-bold text-emerald-400">{data.openCount as number} open</span>
          <span className="text-zinc-500 mx-1">·</span>
          <span className="text-zinc-400">{data.closedCount as number} closed/filtered</span>
        </span>
        {summary.critical > 0 && (
          <span className="text-xs text-rose-400 font-semibold">⚠ {summary.critical} critical</span>
        )}
      </div>

      <div className="rounded-md bg-zinc-900/60 border border-zinc-800 p-3 text-xs text-zinc-300">
        {data.message as string}
      </div>

      {openPorts.length === 0 ? (
        <div className="text-sm text-zinc-500">No open ports found.</div>
      ) : (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Open Ports</h3>
          <div className="space-y-1.5">
            {openPorts.map((p, i) => (
              <div key={i} className={cn(
                'rounded-md border p-2.5',
                /CRITICAL|NEVER expose|INSECURE|disable immediately/i.test(p.risk as string)
                  ? 'bg-rose-500/10 border-rose-500/30'
                  : /restrict|block|disable/i.test(p.risk as string)
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-zinc-900/60 border-zinc-800'
              )}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-bold text-zinc-200">{p.port as number}</span>
                  <span className="text-xs text-emerald-400 font-medium">{p.service as string}</span>
                </div>
                <div className="text-[11px] text-zinc-400 mt-1">{p.risk as string}</div>
                {p.banner && (
                  <div className="text-[10px] font-mono text-zinc-500 mt-1 bg-zinc-950/60 rounded px-1.5 py-0.5">
                    Banner: {p.banner as string}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DirsResult({ data }: { data: Record<string, unknown> }) {
  const results = (data.results ?? []) as Array<Record<string, unknown>>
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm">
          <span className="font-bold text-zinc-200">{data.found as number}</span> paths found
        </span>
        <span className="text-xs text-zinc-500">of {data.totalChecked as number} checked</span>
      </div>

      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {results.map((r, i) => (
          <div key={i} className={cn(
            'rounded-md border p-2',
            r.severity === 'bad' ? 'bg-rose-500/10 border-rose-500/30' :
            r.severity === 'warn' ? 'bg-amber-500/10 border-amber-500/30' :
            'bg-zinc-900/60 border-zinc-800'
          )}>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-zinc-200 flex-1 truncate">{r.path as string}</code>
              <span className="text-[10px] font-mono font-bold text-zinc-400">HTTP {r.status as number}</span>
              {r.length && <span className="text-[10px] text-zinc-500">{r.length as number}B</span>}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">{r.note as string}</div>
            {r.location && (
              <div className="text-[10px] text-zinc-500 mt-0.5">→ {r.location as string}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function EndpointsResult({ data }: { data: Record<string, unknown> }) {
  const endpoints = (data.endpoints ?? []) as Array<Record<string, unknown>>
  const summary = (data.summary ?? {}) as Record<string, number>
  const externalScripts = (data.externalScripts ?? []) as string[]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm">
          <span className="font-bold text-zinc-200">{endpoints.length}</span> endpoints found
        </span>
        <span className="text-xs text-zinc-500">
          from {data.scriptsAnalyzed as number} scripts
        </span>
      </div>

      {summary.byType && (
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(summary.byType).map(([type, count]) => (
            <span key={type} className="rounded bg-emerald-500/15 text-emerald-300 px-2 py-1">
              {type}: {count}
            </span>
          ))}
        </div>
      )}

      {externalScripts.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">External Scripts Analyzed</h3>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {externalScripts.map((s, i) => (
              <div key={i} className="text-xs font-mono text-zinc-500 truncate">• {s}</div>
            ))}
          </div>
        </div>
      )}

      {endpoints.length === 0 ? (
        <div className="text-sm text-zinc-500">No endpoints found. Site may have no JS or use strict CSP.</div>
      ) : (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Extracted Endpoints</h3>
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {endpoints.map((e, i) => (
              <div key={i} className="rounded bg-zinc-900/60 border border-zinc-800 px-2 py-1.5 text-xs">
                <div className="flex items-center gap-2">
                  {e.method && (
                    <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded">
                      {e.method as string}
                    </span>
                  )}
                  <span className="text-[10px] text-zinc-500 uppercase">{e.type as string}</span>
                  <code className="font-mono text-zinc-200 flex-1 truncate">{e.url as string}</code>
                </div>
                <div className="text-[10px] text-zinc-600 mt-0.5">Source: {e.source as string}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function WhoisResult({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">{data.domain as string}</span>
        <span className="text-xs text-zinc-500">Source: {data.source as string}</span>
      </div>

      <div className="rounded-md bg-zinc-900/60 border border-zinc-800 p-3 space-y-1.5 text-xs">
        <Field label="Registrar" value={data.registrar as string} />
        <Field label="Created" value={data.creationDate as string} />
        <Field label="Updated" value={data.updatedDate as string} />
        <Field label="Expires" value={data.expiryDate as string} />
        {data.daysUntilExpiry !== null && (
          <Field
            label="Days Until Expiry"
            value={data.daysUntilExpiry as number}
            customColor={
              (data.daysUntilExpiry as number) < 0 ? 'text-rose-400' :
              (data.daysUntilExpiry as number) < 30 ? 'text-amber-400' : 'text-emerald-400'
            }
          />
        )}
        <Field label="Registrant Org" value={data.registrantOrg as string} />
        <Field label="Registrant Country" value={data.registrantCountry as string} />
        <Field label="Abuse Email" value={data.abuseEmail as string} />
        <Field label="Abuse Phone" value={data.abusePhone as string} />
        {Array.isArray(data.nameServers) && (data.nameServers as string[]).length > 0 && (
          <div>
            <div className="text-zinc-500 mb-1">Name Servers:</div>
            <div className="font-mono text-zinc-300 space-y-0.5">
              {(data.nameServers as string[]).map((ns, i) => (
                <div key={i}>• {ns}</div>
              ))}
            </div>
          </div>
        )}
        {Array.isArray(data.status) && (data.status as string[]).length > 0 && (
          <div>
            <div className="text-zinc-500 mb-1">Status:</div>
            <div className="font-mono text-zinc-300 space-y-0.5">
              {(data.status as string[]).map((s, i) => (
                <div key={i}>• {s}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      <details>
        <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400">Raw WHOIS response</summary>
        <pre className="mt-2 text-[11px] font-mono bg-zinc-950/60 border border-zinc-800 rounded p-2 max-h-64 overflow-y-auto text-zinc-400 whitespace-pre-wrap">
          {data.raw as string}
        </pre>
      </details>
    </div>
  )
}

function Field({
  label,
  value,
  mono = false,
  customColor,
}: {
  label: string
  value: string | number | null | undefined
  mono?: boolean
  customColor?: string
}) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex gap-3">
      <span className="text-zinc-500 min-w-[140px]">{label}:</span>
      <span className={cn(
        'text-zinc-200 flex-1 break-all',
        mono && 'font-mono',
        customColor
      )}>
        {String(value)}
      </span>
    </div>
  )
}
