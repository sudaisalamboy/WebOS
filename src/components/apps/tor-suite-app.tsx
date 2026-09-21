'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Shield, Globe, Lock, Send, Database, Search, Terminal,
  ArrowLeft, ArrowRight, RefreshCw, Activity,
  Trash2, Zap, Code2, Bug, Network, Server, Fingerprint,
  KeyRound, Cookie, FileCode, Link2, Hash, Binary, Route,
  ScanLine, Eye, Crosshair, Radar, Webhook, ShieldAlert,
  FileSearch, Layers, Wifi, Cpu, AlertTriangle, FileText, Copy, Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { convertYouTubeUrl } from '@/lib/youtube'

interface NetReq { id: string; method: string; url: string; status: number | null; size: number | null; duration: number | null; headers: Record<string,string> | null; body: string | null; error: string | null; cookies: string[] }
interface LogEntry { ts: number; level: 'info'|'warn'|'error'|'success'; src: string; msg: string }
interface SavedCookie { name: string; value: string; domain: string; savedAt: number }

type RightTab = 'logs' | 'request' | 'tool' | 'source'
type ToolCat = 'recon' | 'network' | 'testing' | 'exploit' | 'mini'

const TOOLS = [
  // RECON (5)
  { id: 'ip-lookup', cat: 'recon', name: 'IP Lookup', icon: Globe, short: 'IP', needsUrl: false },
  { id: 'dns', cat: 'recon', name: 'DNS Records', icon: Network, short: 'DNS', needsUrl: true },
  { id: 'whois', cat: 'recon', name: 'WHOIS', icon: Fingerprint, short: 'WHO', needsUrl: true },
  { id: 'subdomains', cat: 'recon', name: 'Subdomains', icon: Server, short: 'SUB', needsUrl: true },
  { id: 'tech-detect', cat: 'recon', name: 'Tech Stack', icon: Code2, short: 'TECH', needsUrl: true },
  // NETWORK (5)
  { id: 'headers', cat: 'network', name: 'Headers', icon: Server, short: 'HDR', needsUrl: true },
  { id: 'ssl', cat: 'network', name: 'SSL/TLS', icon: Lock, short: 'SSL', needsUrl: true },
  { id: 'nmap', cat: 'network', name: 'Nmap Scan', icon: ScanLine, short: 'NMAP', needsUrl: true, hasRisk: true },
  { id: 'traceroute', cat: 'network', name: 'Redirect', icon: Route, short: 'RDR', needsUrl: true },
  { id: 'speed', cat: 'network', name: 'Speed', icon: Zap, short: 'SPD', needsUrl: true },
  // TESTING (5)
  { id: 'api-tester', cat: 'testing', name: 'API Test', icon: Send, short: 'API', needsUrl: true },
  { id: 'sqli', cat: 'testing', name: 'SQLi Quick', icon: Database, short: 'SQL', needsUrl: true },
  { id: 'sqlmap', cat: 'testing', name: 'SQLMap', icon: Database, short: 'SMAP', needsUrl: true, hasRisk: true },
  { id: 'xss', cat: 'testing', name: 'XSS Scan', icon: Bug, short: 'XSS', needsUrl: true },
  { id: 'dirs', cat: 'testing', name: 'Dir Scan', icon: Search, short: 'DIR', needsUrl: true },
  // EXPLOIT (4)
  { id: 'js-extract', cat: 'exploit', name: 'JS Extract', icon: FileCode, short: 'JS', needsUrl: true },
  { id: 'ports', cat: 'exploit', name: 'Quick Ports', icon: Crosshair, short: 'PRT', needsUrl: true },
  { id: 'crawler', cat: 'exploit', name: 'Crawler', icon: Radar, short: 'CRL', needsUrl: true },
  { id: 'webhook', cat: 'exploit', name: 'Webhook', icon: Webhook, short: 'WHK', needsUrl: true },
  // MINI (5)
  { id: 'cookies', cat: 'mini', name: 'Cookies', icon: Cookie, short: 'CKE', needsUrl: false },
  { id: 'jwt', cat: 'mini', name: 'JWT', icon: KeyRound, short: 'JWT', needsUrl: false },
  { id: 'hash', cat: 'mini', name: 'Hash ID', icon: Hash, short: 'HSH', needsUrl: false },
  { id: 'base64', cat: 'mini', name: 'Base64', icon: Binary, short: 'B64', needsUrl: false },
  { id: 'urlencode', cat: 'mini', name: 'URL Enc', icon: Link2, short: 'URL', needsUrl: false },
] as const

type ToolId = typeof TOOLS[number]['id']
type ToolDef = typeof TOOLS[number]

const CAT_COLORS: Record<ToolCat, string> = {
  recon: 'text-cyan-400', network: 'text-violet-400', testing: 'text-rose-400', exploit: 'text-orange-400', mini: 'text-amber-400',
}
const CAT_LABELS: Record<ToolCat, string> = {
  recon: 'REC', network: 'NET', testing: 'TST', exploit: 'EXP', mini: 'MIN',
}

const RISK_NAMES = ['Safe', 'Low', 'Medium', 'High', 'Aggressive']
const RISK_COLORS = ['text-emerald-400', 'text-emerald-400', 'text-amber-400', 'text-orange-400', 'text-rose-400']

export function TorSuiteApp() {
  const [url, setUrl] = useState('')
  const [inputUrl, setInputUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [requests, setRequests] = useState<NetReq[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [selectedReq, setSelectedReq] = useState<NetReq | null>(null)
  const [rightTab, setRightTab] = useState<RightTab>('logs')
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)
  const [torReady, setTorReady] = useState(false)
  const [exitIp, setExitIp] = useState<string | null>(null)
  const [cookies, setCookies] = useState<SavedCookie[]>([])
  const [autoSaveCookies, setAutoSaveCookies] = useState(false)
  const [contentFocused, setContentFocused] = useState(false)
  const [blurEnabled, setBlurEnabled] = useState(true)
  const [riskLevel, setRiskLevel] = useState(3)
  const reqIdCounter = useRef(0)
  const [toolOutput, setToolOutput] = useState('')
  const [toolRunning, setToolRunning] = useState(false)
  const [apiMethod, setApiMethod] = useState('GET')
  const [apiBody, setApiBody] = useState('')
  const [jwtInput, setJwtInput] = useState('')
  const [b64Input, setB64Input] = useState('')
  const [urlEncInput, setUrlEncInput] = useState('')
  const [hashInput, setHashInput] = useState('')
  // === Live Browser + Source Decoder state ===
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)
  const [liveReady, setLiveReady] = useState(false)
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [sourceMode, setSourceMode] = useState<'raw' | 'decoded' | 'findings'>('findings')
  const [sourceRaw, setSourceRaw] = useState('')
  const [sourceDecoded, setSourceDecoded] = useState('')
  const [sourceFindings, setSourceFindings] = useState<any[]>([])
  const [sourceStats, setSourceStats] = useState<any>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const livePollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLog = useCallback((level: LogEntry['level'], src: string, msg: string) => {
    setLogs(p => [...p.slice(-200), { ts: Date.now(), level, src, msg }])
  }, [])

  const addRequest = useCallback((req: Omit<NetReq,'id'>) => {
    const id = `r${++reqIdCounter.current}`
    setRequests(p => [...p.slice(-80), { ...req, id }])
    return id
  }, [])

  useEffect(() => {
    async function check() {
      try {
        const r = await fetch('/api/tor/status', { cache: 'no-store' })
        const d = await r.json()
        setTorReady(d.ready); setExitIp(d.exitIp)
        if (d.ready) addLog('success','tor',`Connected · IP: ${d.exitIp}`)
      } catch {}
    }
    check(); const id = setInterval(check, 15000); return () => clearInterval(id)
  }, [addLog])

  function navigate(to: string) {
    let t = to.trim(); if (!t) return
    if (!/^https?:\/\//i.test(t)) {
      if (/\s/.test(t)) t = `https://duckduckgo.com/?q=${encodeURIComponent(t)}`
      else if (t.includes('.')) t = `https://${t}`
      else t = `https://${t}.com`
    }
    const yt = convertYouTubeUrl(t)
    if (yt.isYouTube && yt.embeddableUrl) t = yt.embeddableUrl
    setUrl(t); setInputUrl(t); setLoading(true)
    addLog('info','browser',`→ ${t}`)
    proxyFetch(t)
  }

  function proxyFetch(targetUrl: string) {
    const id = addRequest({ method:'GET', url:targetUrl, status:null, size:null, duration:null, headers:null, body:null, error:null, cookies:[] })
    const start = Date.now()
    fetch(`/api/tor/proxy?url=${encodeURIComponent(targetUrl)}`)
      .then(async res => {
        const dur = Date.now()-start
        const sz = parseInt(res.headers.get('content-length') ?? '0')
        const hd: Record<string,string> = {}; res.headers.forEach((v,k)=>{hd[k]=v})
        const sc = res.headers.get('set-cookie') ?? ''
        const fc: string[] = sc ? sc.split('\n') : []
        if (autoSaveCookies && fc.length > 0) {
          fc.forEach(c => { const p = c.split(';')[0].split('='); if (p.length>=2) setCookies(prev=>[...prev,{name:p[0].trim(),value:p.slice(1).join('=').trim(),domain:new URL(targetUrl).hostname,savedAt:Date.now()}]) })
          addLog('success','cookie',`Auto-saved ${fc.length}`)
        }
        setRequests(p=>p.map(r=>r.id===id?{...r,status:res.status,size:sz,duration:dur,headers:hd,cookies:fc}:r))
        addLog(res.status>=400?'warn':'success','proxy',`← ${res.status} · ${dur}ms`)
        if ((res.headers.get('content-type') ?? '').includes('text')) { const b=await res.text(); setRequests(p=>p.map(r=>r.id===id?{...r,body:b.slice(0,50000)}:r)) }
      })
      .catch(err => { setRequests(p=>p.map(r=>r.id===id?{...r,error:err.message,duration:Date.now()-start}:r)); addLog('error','proxy',`✗ ${err.message}`) })
  }

  function getCurrentTarget(): string {
    if (!url) return ''
    try { return new URL(url).hostname } catch { return url }
  }

  function openTool(t: ToolId) {
    setActiveTool(t); setRightTab('tool'); setToolOutput('')
  }

  function cutCookies() {
    if (!cookies.length) return
    navigator.clipboard.writeText(cookies.map(c => `${c.name}=${c.value}`).join('; '))
    addLog('success','cookie',`Cut ${cookies.length}`)
    setCookies([])
  }

  async function runTool(tool: ToolId) {
    const target = getCurrentTarget()
    const tdef = TOOLS.find(x => x.id === tool)!
    if (!target && tdef.needsUrl) { setToolOutput('No site open. Navigate to a website first.'); return }
    setToolRunning(true); setToolOutput(`Running ${tdef.name} on ${target || 'input'}...`)
    addLog('info', tool, `${tdef.name} on ${target || 'input'}`)

    try {
      switch (tool) {
        case 'ip-lookup': {
          const r = await fetch(`/api/tor/proxy?url=${encodeURIComponent('https://check.torproject.org/api/ip')}`)
          const d = await r.json()
          setToolOutput(`Exit IP: ${d.IP}\nIs Tor: ${d.IsTor}\n\nAll traffic appears from this IP.`); break
        }
        case 'dns': {
          const r = await fetch(`/api/seclab/dns?domain=${encodeURIComponent(target)}&type=ALL`)
          setToolOutput(JSON.stringify((await r.json()).records, null, 2)); break
        }
        case 'whois': {
          const r = await fetch(`/api/seclab/whois?domain=${encodeURIComponent(target)}`)
          const d = await r.json()
          setToolOutput(`Registrar: ${d.registrar}\nCreated: ${d.creationDate}\nExpires: ${d.expiryDate} (${d.daysUntilExpiry}d)\n\nNS:\n${(d.nameServers??[]).join('\n')}`); break
        }
        case 'subdomains': {
          const r = await fetch(`/api/seclab/subdomains?domain=${encodeURIComponent(target)}`)
          const d = await r.json()
          setToolOutput(`Found ${d.total}:\n\n${(d.subdomains??[]).map((s:any)=>s.name).join('\n')}`); break
        }
        case 'tech-detect': {
          const r = await fetch(`/api/seclab/tech?url=${encodeURIComponent(target)}`)
          const d = await r.json()
          setToolOutput(`${d.technologies?.length||0} detected:\n\n${(d.technologies??[]).map((t:any)=>`${t.name}${t.version?' v'+t.version:''} [${t.category}]`).join('\n')}`); break
        }
        case 'headers': {
          const r = await fetch(`/api/seclab/headers?url=${encodeURIComponent(url)}`)
          const d = await r.json()
          setToolOutput(`Score: ${d.score}/100\n\n${(d.securityChecks??[]).map((c:any)=>`${c.severity==='good'?'✓':'⚠'} ${c.name}: ${c.present?'present':'MISSING'}`).join('\n')}`); break
        }
        case 'ssl': {
          const r = await fetch(`/api/seclab/ssl?host=${encodeURIComponent(target)}`)
          const d = await r.json()
          setToolOutput(`Protocol: ${d.protocol}\nScore: ${d.score}\n\n${(d.issues??[]).map((i:any)=>`${i.severity}: ${i.message}`).join('\n')}`); break
        }
        case 'nmap': {
          setToolOutput(`Running nmap (risk ${riskLevel}/5 — ${RISK_NAMES[riskLevel-1]})...\nThis may take 30-90 seconds.\n`)
          const r = await fetch('/api/seclab/nmap', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ host: target, risk: riskLevel })
          })
          const d = await r.json()
          if (d.ok) {
            setToolOutput(`Nmap ${d.risk}/5 — ${d.riskDesc}\n\nOpen: ${d.openCount} ports\n\n${(d.openPorts??[]).map((p:any)=>`${p.port}/${p.protocol} ${p.service} ${p.version||''}`).join('\n')}\n\n--- RAW ---\n${(d.rawOutput||'').slice(0,3000)}`)
          } else {
            setToolOutput(`Error: ${d.error}\n\nRaw:\n${(d.rawOutput||'').slice(0,2000)}`)
          }
          break
        }
        case 'traceroute': {
          const r = await fetch(`/api/tor/proxy?url=${encodeURIComponent(url)}`)
          setToolOutput(`Status: ${r.status}\nURL: ${r.url}\n\nHeaders:\n${Array.from(r.headers.entries()).map(([k,v])=>`${k}: ${v}`).join('\n')}`); break
        }
        case 'speed': {
          const s = Date.now()
          const r = await fetch(`/api/tor/proxy?url=${encodeURIComponent(url)}`)
          const d = Date.now()-s; const sz = parseInt(r.headers.get('content-length') ?? '0')
          setToolOutput(`Time: ${d}ms\nSize: ${sz}B\nSpeed: ${sz>0?(sz/d*1000/1024).toFixed(1):'?'} KB/s\nStatus: ${r.status}`); break
        }
        case 'api-tester': {
          const r = await fetch(`/api/tor/proxy?url=${encodeURIComponent(url)}`, { method: apiMethod==='GET'?'GET':'POST' })
          const b = await r.text()
          setToolOutput(`${r.status} ${r.statusText}\nType: ${r.headers.get('content-type')}\nSize: ${b.length}\n\n${b.slice(0,5000)}`); break
        }
        case 'sqli': {
          const payloads = [`'`, `' OR '1'='1`, `' UNION SELECT NULL--`, `" OR ""="`]
          const results: string[] = []
          for (const p of payloads) {
            const tu = url.includes('?') ? `${url}&t=${encodeURIComponent(p)}` : `${url}?t=${encodeURIComponent(p)}`
            const r = await fetch(`/api/tor/proxy?url=${encodeURIComponent(tu)}`)
            const b = await r.text()
            const m = ['sql','mysql','syntax error','ORA-','sqlite'].find(i => b.toLowerCase().includes(i))
            results.push(m ? `⚠ VULN "${p}" (${m})` : `✓ clean "${p}"`)
            setToolOutput(results.join('\n'))
          }
          break
        }
        case 'sqlmap': {
          setToolOutput(`Running sqlmap (risk ${riskLevel}/5 — ${RISK_NAMES[riskLevel-1]})...\nThis may take 1-3 minutes.\n`)
          const r = await fetch('/api/seclab/sqlmap', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ url, risk: riskLevel })
          })
          const d = await r.json()
          if (d.isVulnerable) {
            setToolOutput(`⚠ VULNERABLE TO SQL INJECTION!\n\nRisk: ${d.risk}/5 — ${d.riskDesc}\n\nVulnerabilities:\n${(d.vulnerabilities||[]).join('\n')}\n\nDatabases:\n${(d.databases||[]).join(', ')}\n\n--- RAW ---\n${(d.rawOutput||'').slice(0,3000)}`)
          } else {
            setToolOutput(`Not vulnerable (risk ${d.risk}/5 — ${d.riskDesc})\n\n--- RAW ---\n${(d.rawOutput||'').slice(0,3000)}`)
          }
          break
        }
        case 'xss': {
          const payloads = [`<script>alert(1)</script>`, `"><img src=x onerror=alert(1)>`]
          const results: string[] = []
          for (const p of payloads) {
            const tu = url.includes('?') ? `${url}&q=${encodeURIComponent(p)}` : `${url}?q=${encodeURIComponent(p)}`
            const r = await fetch(`/api/tor/proxy?url=${encodeURIComponent(tu)}`)
            const b = await r.text()
            results.push(b.includes(p) ? `⚠ REFLECTED: ${p.slice(0,30)}` : `✓ not reflected`)
            setToolOutput(results.join('\n'))
          }
          break
        }
        case 'dirs': {
          const paths = ['/admin','/api','/login','/.env','/config','/backup','/wp-admin','/phpmyadmin','/robots.txt','/.git/config','/server-status','/phpinfo.php']
          const found: string[] = []
          for (const p of paths) {
            const r = await fetch(`/api/tor/proxy?url=${encodeURIComponent(url+p)}`)
            if (r.status !== 404) { found.push(`${r.status} ${p}`); setToolOutput(`Found:\n${found.join('\n')}`) }
          }
          setToolOutput(`Found ${found.length}:\n${found.join('\n')}`); break
        }
        case 'js-extract': {
          const r = await fetch(`/api/seclab/endpoints?url=${encodeURIComponent(url)}`)
          const d = await r.json()
          setToolOutput(`${d.endpoints?.length||0} endpoints:\n\n${(d.endpoints??[]).map((e:any)=>`${e.method||'GET'} ${e.url}`).join('\n')}`); break
        }
        case 'ports': {
          const r = await fetch(`/api/seclab/ports?host=${encodeURIComponent(target)}`)
          const d = await r.json()
          setToolOutput(`Open: ${d.openCount}\n\n${(d.openPorts??[]).map((p:any)=>`${p.port} ${p.service}`).join('\n')}`); break
        }
        case 'crawler': {
          const r = await fetch(`/api/seclab/endpoints?url=${encodeURIComponent(url)}`)
          const d = await r.json()
          setToolOutput(`Crawled ${d.scriptsFound||0} scripts\nFound ${d.endpoints?.length||0} URLs\n\nExternal scripts:\n${(d.externalScripts||[]).slice(0,10).join('\n')}\n\nEndpoints:\n${(d.endpoints||[]).slice(0,20).map((e:any)=>e.url).join('\n')}`); break
        }
        case 'webhook': {
          setToolOutput(`Webhook interceptor active.\n\nAll requests from the browser are logged in the Network panel.\nClick any request → Inspect tab → see full headers + body.\n\nCookies: ${cookies.length} saved\nAuto-save: ${autoSaveCookies ? 'ON' : 'OFF'}`); break
        }
        case 'cookies': setToolOutput(`Saved: ${cookies.length}\n\n${cookies.map(c=>`${c.name}=${c.value.slice(0,30)}... [${c.domain}]`).join('\n')}`); break
        case 'jwt': { try { const p = jwtInput.split('.'); setToolOutput(`Header:\n${JSON.stringify(JSON.parse(atob(p[0])),null,2)}\n\nPayload:\n${JSON.stringify(JSON.parse(atob(p[1])),null,2)}`) } catch { setToolOutput('Invalid JWT') } break }
        case 'hash': { const h = hashInput.trim(); const types: string[] = []; if (/^[a-f0-9]{32}$/i.test(h)) types.push('MD5'); if (/^[a-f0-9]{40}$/i.test(h)) types.push('SHA-1'); if (/^[a-f0-9]{64}$/i.test(h)) types.push('SHA-256'); if (/^\$2[aby]\$/i.test(h)) types.push('bcrypt'); setToolOutput(types.length ? `Type: ${types.join(', ')}\nLength: ${h.length}` : 'Unknown'); break }
        case 'base64': { try { setToolOutput(`Decoded:\n${atob(b64Input)}`) } catch { try { setToolOutput(`Encoded:\n${btoa(b64Input)}`) } catch { setToolOutput('Invalid') } } break }
        case 'urlencode': setToolOutput(`Encoded: ${encodeURIComponent(urlEncInput)}\n\nDecoded: ${decodeURIComponent(urlEncInput)}`); break
      }
      addLog('success', tool, 'Done')
    } catch (err) { setToolOutput(`Error: ${(err as Error).message}`); addLog('error', tool, (err as Error).message) }
    finally { setToolRunning(false) }
  }

  // === LIVE BROWSER + SOURCE DECODER ===
  // Spawns a headless Chromium (routed through Tor SOCKS5) and streams screenshots
  // back to the user. Real browser = real rendering = no proxy/rewrite issues.
  // Also fetches the rendered HTML source and decodes any encoded content.

  async function startLiveSession(targetUrl?: string) {
    setLiveLoading(true); setLiveError(null); setLiveReady(false)
    try {
      // Create session
      const r = await fetch('/api/tor/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl ?? url }),
      })
      const d = await r.json()
      if (!d.sessionId) throw new Error(d.error || 'no sessionId')
      setLiveSessionId(d.sessionId)
      addLog('info', 'live', `Session ${d.sessionId.slice(0, 12)}… created`)

      // Poll for readiness — also stored in ref so cleanup can stop it
      const sid = d.sessionId
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        try {
          const sr = await fetch(`/api/tor/live/status?id=${sid}`)
          if (!sr.ok) return
          const sd = await sr.json()
          if (sd.ready) {
            clearInterval(poll); livePollRef.current = null
            setLiveReady(true); setLiveLoading(false)
            addLog('success', 'live', `Ready · ${sd.url}`)
            // Auto-fetch source on first ready
            fetchSource(sid)
          } else if (attempts > 30) {
            // 30 attempts × 1s = 30s — give up
            clearInterval(poll); livePollRef.current = null
            setLiveLoading(false); setLiveError('Session took too long to become ready')
            addLog('error', 'live', 'Ready timeout')
          }
        } catch (e) {
          // network error — keep trying
        }
      }, 1000)
      livePollRef.current = poll

      // Also do an immediate check (in case session was ready before poll started)
      const sr0 = await fetch(`/api/tor/live/status?id=${sid}`)
      if (sr0.ok) {
        const sd0 = await sr0.json()
        if (sd0.ready) {
          clearInterval(poll); livePollRef.current = null
          setLiveReady(true); setLiveLoading(false)
          addLog('success', 'live', `Ready · ${sd0.url}`)
          fetchSource(sid)
        }
      }
    } catch (err) {
      setLiveError((err as Error).message); setLiveLoading(false)
      addLog('error', 'live', (err as Error).message)
    }
  }

  async function fetchSource(sid?: string) {
    const id = sid ?? liveSessionId
    if (!id) return
    setSourceLoading(true)
    try {
      // Fetch all (raw + decoded + findings) in one call
      const r = await fetch(`/api/tor/live/source?id=${id}&mode=all`)
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setSourceRaw(d.raw || '')
      setSourceDecoded(d.decoded || '')
      setSourceFindings(d.findings || [])
      setSourceStats(d.stats || null)
      addLog('success', 'source', `${d.findings?.length || 0} findings · raw ${(d.rawLength/1024).toFixed(1)}KB`)
    } catch (err) {
      addLog('error', 'source', (err as Error).message)
    } finally {
      setSourceLoading(false)
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(
      () => addLog('success', 'source', 'Copied to clipboard'),
      () => addLog('error', 'source', 'Clipboard write failed'),
    )
  }

  function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // Track the current live session id in a ref so the unmount-only cleanup can read it
  const liveSessionIdRef = useRef<string | null>(null)
  useEffect(() => { liveSessionIdRef.current = liveSessionId }, [liveSessionId])

  // Cleanup ONLY on unmount (empty dep array = runs once on mount, returns cleanup that runs once on unmount)
  useEffect(() => {
    return () => {
      if (livePollRef.current) clearInterval(livePollRef.current)
      const sid = liveSessionIdRef.current
      if (sid) {
        fetch(`/api/tor/live/session?id=${sid}`, { method: 'DELETE' }).catch(() => {})
      }
    }
  }, [])

  const proxySrc = url ? (url.startsWith('https://www.youtube.com/embed/') ? url : `/api/tor/proxy?url=${encodeURIComponent(url)}`) : null
  const activeToolDef = TOOLS.find(t => t.id === activeTool)
  const currentHost = getCurrentTarget()

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100 text-xs">
      {/* COMPACT TOP BAR */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
        <button className="p-1 rounded hover:bg-zinc-800 text-zinc-400"><ArrowLeft className="h-3 w-3"/></button>
        <button className="p-1 rounded hover:bg-zinc-800 text-zinc-400"><ArrowRight className="h-3 w-3"/></button>
        <button onClick={() => { if (url) { setLoading(true); proxyFetch(url) } }} className="p-1 rounded hover:bg-zinc-800 text-zinc-400"><RefreshCw className={cn('h-3 w-3',loading&&'animate-spin')}/></button>
        <div className="flex flex-1 items-center gap-1.5 mx-1 rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-0.5">
          <Lock className="h-2.5 w-2.5 text-emerald-500 shrink-0"/>
          <input value={inputUrl} onChange={e=>setInputUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&navigate(inputUrl)}
            placeholder="URL..." className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-zinc-600"/>
          {loading&&<div className="h-2 w-2 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin"/>}
        </div>
        <button onClick={()=>setRightTab('logs')} className={cn('p-1 rounded',rightTab==='logs'?'bg-cyan-500/20 text-cyan-400':'hover:bg-zinc-800 text-zinc-400')}><Terminal className="h-3 w-3"/></button>
        <button onClick={()=>setRightTab('request')} className={cn('p-1 rounded',rightTab==='request'?'bg-cyan-500/20 text-cyan-400':'hover:bg-zinc-800 text-zinc-400')}><Eye className="h-3 w-3"/></button>
      </div>

      {/* MAIN */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: HORIZONTAL SCROLL TOOL DOCK */}
        <div className="shrink-0 border-r border-zinc-800 bg-zinc-900/60 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            {(['recon','network','testing','exploit','mini'] as ToolCat[]).map(cat => (
              <div key={cat} className="border-b border-zinc-800/50 pb-1">
                <div className="text-[7px] text-zinc-700 text-center font-bold uppercase pt-1.5 pb-0.5">{CAT_LABELS[cat]}</div>
                {TOOLS.filter(t => t.cat === cat).map(t => (
                  <button key={t.id} onClick={()=>openTool(t.id)} title={t.name}
                    className={cn('w-11 flex flex-col items-center gap-0.5 py-1.5 transition',
                      activeTool===t.id && rightTab==='tool' ? 'bg-cyan-500/15 border-l-2 border-l-cyan-500' : 'hover:bg-zinc-800/50 border-l-2 border-l-transparent')}>
                    <t.icon className={cn('h-3.5 w-3.5', activeTool===t.id && rightTab==='tool' ? 'text-cyan-400' : CAT_COLORS[cat])}/>
                    <span className="text-[6px] text-zinc-600">{t.short}</span>
                    {'hasRisk' in t && t.hasRisk && <span className="text-[5px] text-rose-500">R{riskLevel}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* NETWORK */}
        <div className="w-36 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/30">
          <div className="flex items-center justify-between px-2 py-1 border-b border-zinc-800">
            <span className="text-[9px] font-bold uppercase text-zinc-500 flex items-center gap-1"><Activity className="h-3 w-3"/>{requests.length}</span>
            <button onClick={()=>setRequests([])} className="text-zinc-600 hover:text-rose-400"><Trash2 className="h-3 w-3"/></button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {requests.slice().reverse().map(r=>(
              <div key={r.id} onClick={()=>{setSelectedReq(r);setRightTab('request')}}
                className={cn('px-1.5 py-1 border-b border-zinc-800/30 cursor-pointer hover:bg-zinc-800/40',selectedReq?.id===r.id&&'bg-cyan-500/10')}>
                <div className="flex items-center gap-1">
                  <span className={cn('text-[8px] font-bold',r.status>=400?'text-rose-400':r.status>=300?'text-amber-400':'text-emerald-400')}>{r.status??'...'}</span>
                  {r.cookies.length>0&&<Cookie className="h-2.5 w-2.5 text-amber-400"/>}
                  <span className="text-[8px] text-zinc-600 ml-auto">{r.duration?`${r.duration}ms`:''}</span>
                </div>
                <div className="text-[8px] text-zinc-500 truncate">{r.url.replace(/^https?:\/\//,'').slice(0,22)}</div>
              </div>
            ))}
          </div>
          <div className="border-t border-zinc-800 p-1">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[8px] font-bold text-amber-400 flex items-center gap-0.5"><Cookie className="h-2.5 w-2.5"/>{cookies.length}</span>
              <div className="flex gap-0.5">
                <button onClick={()=>setAutoSaveCookies(v=>!v)} className={cn('text-[7px] px-1 py-0.5 rounded',autoSaveCookies?'bg-emerald-500/20 text-emerald-400':'bg-zinc-800 text-zinc-600')}>AUTO</button>
                <button onClick={cutCookies} className="text-[7px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">CUT</button>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER: Browser with blur */}
        <div
          className="flex-1 flex flex-col bg-white relative overflow-hidden"
          onMouseEnter={() => setContentFocused(true)}
          onMouseLeave={() => setContentFocused(false)}
        >
          {/* Blur overlay — shown when mouse is NOT over content AND blur is enabled */}
          {!contentFocused && proxySrc && blurEnabled && (
            <div className="absolute inset-0 z-50 pointer-events-none" style={{backdropFilter:'blur(40px) saturate(0)',background:'rgba(9,9,11,0.7)'}}/>
          )}
          {/* Blur toggle button — always visible */}
          {proxySrc && (
            <button
              onClick={() => setBlurEnabled(v => !v)}
              className={cn('absolute top-2 right-2 z-50 flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold transition',
                blurEnabled ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
              )}
              title={blurEnabled ? 'Blur ON — click to disable' : 'Blur OFF — click to enable'}
            >
              {blurEnabled ? '🔓 Blur ON' : '🔒 Blur OFF'}
            </button>
          )}
          {!torReady ? (
            <div className="flex-1 flex items-center justify-center bg-zinc-950 text-zinc-600">
              <div className="text-center"><Shield className="h-10 w-10 mx-auto mb-2 text-zinc-700"/><p className="text-xs">Tor not connected</p></div>
            </div>
          ) : proxySrc ? (
            <iframe key={proxySrc} src={proxySrc} title="Tor" className="h-full w-full border-0"
              style={{
                overflow:'auto',
                overscrollBehavior:'contain',
                pointerEvents:'auto',
                filter: blurEnabled ? (contentFocused ? 'none' : 'blur(60px) saturate(0) brightness(0.6)') : 'none',
                transition: 'filter 0.3s ease',
              }}
              scrolling="yes" tabIndex={0} sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={()=>{setLoading(false);addLog('success','browser','Loaded')}}/>
          ) : (
            <div className="flex-1 flex items-center justify-center" style={{background:'radial-gradient(ellipse at top,#0f172a,#020617)'}}>
              <div className="text-center max-w-sm">
                <div className="text-4xl mb-2">🛡️</div>
                <h1 className="text-xl font-bold text-zinc-100">TorSuite Pro</h1>
                <p className="text-[11px] text-zinc-500 mt-1 mb-4">24 tools · Nmap + SQLMap · Blur privacy</p>
                <input onKeyDown={e=>e.key==='Enter'&&navigate((e.target as HTMLInputElement).value)} placeholder="URL..."
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-100 outline-none focus:border-cyan-500"/>
                <p className="text-[10px] text-zinc-600 mt-3">Open a site → click tool on left → auto-runs on that site</p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="w-72 shrink-0 border-l border-zinc-800 flex flex-col bg-zinc-900/30">
          <div className="flex border-b border-zinc-800 shrink-0">
            {[
              {id:'logs'as const,label:'Logs',icon:Terminal},
              {id:'request'as const,label:'Inspect',icon:Eye},
              {id:'tool'as const,label:activeToolDef?.short||'Tool',icon:activeToolDef?.icon||Bug},
              {id:'source'as const,label:'Source',icon:FileText},
            ].map(t=>(
              <button key={t.id} onClick={()=>setRightTab(t.id)}
                className={cn('flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] font-bold uppercase',rightTab===t.id?'bg-zinc-800 text-cyan-400 border-b-2 border-cyan-500':'text-zinc-600 hover:text-zinc-400')}>
                <t.icon className="h-3 w-3"/> {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {rightTab==='logs' && (
              <div className="p-1.5 space-y-0.5">
                <div className="flex justify-between mb-1"><span className="text-[8px] text-zinc-600">{logs.length}</span><button onClick={()=>setLogs([])} className="text-[8px] text-zinc-600 hover:text-rose-400">clr</button></div>
                {logs.slice().reverse().map((l,i)=>(<div key={i} className="text-[9px] font-mono leading-tight"><span className="text-zinc-700">{new Date(l.ts).toLocaleTimeString().slice(0,8)}</span>{' '}<span className={cn('font-bold',l.level==='error'?'text-rose-400':l.level==='warn'?'text-amber-400':l.level==='success'?'text-emerald-400':'text-cyan-400')}>[{l.src}]</span>{' '}<span className="text-zinc-400">{l.msg}</span></div>))}
              </div>
            )}
            {rightTab==='request' && (
              <div className="p-2 space-y-2">
                {selectedReq ? (<>
                  <div className="text-[9px] text-zinc-500 uppercase font-bold">URL</div>
                  <div className="text-[10px] font-mono text-cyan-400 break-all bg-zinc-950 rounded p-1.5">{selectedReq.url}</div>
                  <div className="text-[10px]">{selectedReq.status??'...'} · {selectedReq.duration??'?'}ms · {selectedReq.size??'?'}B</div>
                  {selectedReq.cookies.length>0 && (<><div className="text-[9px] text-amber-400 uppercase font-bold">Cookies</div><pre className="text-[9px] font-mono text-amber-400 bg-zinc-950 rounded p-1.5 max-h-20 overflow-y-auto">{selectedReq.cookies.join('\n')}</pre><button onClick={()=>{selectedReq.cookies.forEach(c=>{const p=c.split(';')[0].split('=');setCookies(prev=>[...prev,{name:p[0]?.trim()||'',value:p.slice(1).join('=').trim(),domain:new URL(selectedReq.url).hostname,savedAt:Date.now()}])})}} className="w-full py-1 text-[10px] font-bold rounded bg-amber-500/20 text-amber-400">Save</button></>)}
                  {selectedReq.headers && (<><div className="text-[9px] text-zinc-500 uppercase font-bold mt-2">Headers</div><pre className="text-[9px] font-mono text-zinc-400 bg-zinc-950 rounded p-1.5 max-h-24 overflow-y-auto">{Object.entries(selectedReq.headers).map(([k,v])=>`${k}: ${v}`).join('\n')}</pre></>)}
                  {selectedReq.body && (<><div className="text-[9px] text-zinc-500 uppercase font-bold mt-2">Body</div><pre className="text-[9px] font-mono text-zinc-400 bg-zinc-950 rounded p-1.5 max-h-32 overflow-y-auto">{selectedReq.body.slice(0,2000)}</pre></>)}
                </>) : <div className="text-[10px] text-zinc-600 text-center py-8">Click a request</div>}
              </div>
            )}
            {rightTab==='tool' && activeToolDef && (
              <div className="p-2 space-y-2">
                <div className="flex items-center gap-2 pb-1 border-b border-zinc-800">
                  <activeToolDef.icon className={cn('h-4 w-4',CAT_COLORS[activeToolDef.cat])}/>
                  <span className="text-[11px] font-bold">{activeToolDef.name}</span>
                  {'hasRisk' in activeToolDef && activeToolDef.hasRisk && (
                    <div className="flex gap-0.5 ml-auto">
                      {[1,2,3,4,5].map(r=>(
                        <button key={r} onClick={()=>setRiskLevel(r)} className={cn('w-4 h-4 rounded text-[8px] font-bold flex items-center justify-center',riskLevel===r?'bg-rose-500 text-white':'bg-zinc-800 text-zinc-600')}>{r}</button>
                      ))}
                    </div>
                  )}
                </div>
                {activeToolDef.needsUrl && (
                  <div className="rounded bg-cyan-500/10 border border-cyan-500/20 px-2 py-1 text-[10px]"><span className="text-zinc-500">Target: </span><span className="text-cyan-400 font-mono">{currentHost||'No site open'}</span></div>
                )}
                {activeTool==='jwt' && <textarea value={jwtInput} onChange={e=>setJwtInput(e.target.value)} placeholder="JWT..." className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[10px] font-mono outline-none h-12 resize-none"/>}
                {activeTool==='base64' && <textarea value={b64Input} onChange={e=>setB64Input(e.target.value)} placeholder="Text..." className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[10px] font-mono outline-none h-12 resize-none"/>}
                {activeTool==='urlencode' && <textarea value={urlEncInput} onChange={e=>setUrlEncInput(e.target.value)} placeholder="URL..." className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[10px] font-mono outline-none h-12 resize-none"/>}
                {activeTool==='hash' && <textarea value={hashInput} onChange={e=>setHashInput(e.target.value)} placeholder="Hash..." className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[10px] font-mono outline-none h-12 resize-none"/>}
                {activeTool==='api-tester' && (<><div className="flex gap-1">{['GET','POST','PUT','DELETE'].map(m=><button key={m} onClick={()=>setApiMethod(m)} className={cn('flex-1 py-1 text-[9px] font-bold rounded',apiMethod===m?'bg-emerald-500/20 text-emerald-400':'bg-zinc-800 text-zinc-500')}>{m}</button>)}</div>{apiMethod!=='GET'&&<textarea value={apiBody} onChange={e=>setApiBody(e.target.value)} placeholder="Body" className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[10px] outline-none h-10 resize-none"/>}</>)}
                {activeTool==='cookies' && (<div className="text-[10px] text-zinc-400"><p>Saved: {cookies.length}</p>{cookies.map((c,i)=>(<div key={i} className="font-mono text-[9px] truncate">{c.name}={c.value.slice(0,25)}... [{c.domain}]</div>))}<div className="flex gap-1 mt-2"><button onClick={cutCookies} className="px-2 py-1 text-[9px] rounded bg-amber-500/20 text-amber-400">Cut</button><button onClick={()=>setCookies([])} className="px-2 py-1 text-[9px] rounded bg-rose-500/20 text-rose-400">Clr</button></div></div>)}
                {activeTool!=='cookies' && activeTool!=='webhook' && (
                  <button onClick={()=>runTool(activeTool!)} disabled={toolRunning||(activeToolDef.needsUrl&&!url)}
                    className="w-full py-1.5 text-[10px] font-bold rounded bg-cyan-500 text-white hover:bg-cyan-400 disabled:opacity-40">
                    {toolRunning?<RefreshCw className="h-3 w-3 inline animate-spin"/>:<Zap className="h-3 w-3 inline"/>} {activeToolDef.needsUrl?`Run on ${currentHost||'...'}`:'Run'}
                  </button>
                )}
                {activeToolDef.hasRisk && <div className="text-[8px] text-zinc-600 text-center">Risk {riskLevel}/5 — <span className={RISK_COLORS[riskLevel-1]}>{RISK_NAMES[riskLevel-1]}</span></div>}
                {toolOutput && <pre className="text-[9px] font-mono text-zinc-300 bg-zinc-950 rounded p-2 max-h-64 overflow-y-auto whitespace-pre-wrap">{toolOutput}</pre>}
              </div>
            )}
            {rightTab==='source' && (
              <div className="p-2 space-y-2 flex flex-col" style={{minHeight:'100%'}}>
                <div className="flex items-center gap-2 pb-1 border-b border-zinc-800">
                  <FileText className="h-4 w-4 text-cyan-400"/>
                  <span className="text-[11px] font-bold">Source Decoder</span>
                  <span className="ml-auto text-[8px] text-zinc-600">{sourceStats ? `${sourceStats.scripts||0} scripts · ${sourceFindings.length} findings` : ''}</span>
                </div>

                {/* Live session status */}
                {!liveSessionId ? (
                  <div className="space-y-2">
                    <div className="text-[10px] text-zinc-400 leading-relaxed">
                      Spawns a real headless Chromium (Tor-routed) to render the current page,
                      then decodes every URL-encoded / HTML-entity / Base64 / hex / unicode
                      escape / data URI / JSON blob it finds.
                    </div>
                    <button
                      onClick={() => startLiveSession(url)}
                      disabled={!url || liveLoading}
                      className="w-full py-1.5 text-[10px] font-bold rounded bg-cyan-500 text-white hover:bg-cyan-400 disabled:opacity-40">
                      {liveLoading ? <RefreshCw className="h-3 w-3 inline animate-spin"/> : <Zap className="h-3 w-3 inline"/>} Open Live + Decode Source
                    </button>
                    {!url && <div className="text-[9px] text-amber-400 text-center">Navigate to a URL first</div>}
                    {liveError && <div className="text-[9px] text-rose-400 text-center">{liveError}</div>}
                  </div>
                ) : (
                  <>
                    {/* Session status bar */}
                    <div className="flex items-center gap-1.5 text-[9px] rounded bg-zinc-950 px-2 py-1">
                      <span className={cn('h-1.5 w-1.5 rounded-full', liveReady ? 'bg-emerald-500 animate-pulse' : liveLoading ? 'bg-amber-500 animate-pulse' : 'bg-rose-500')} />
                      <span className="text-zinc-400">{liveLoading ? 'Loading…' : liveReady ? 'Live' : 'Idle'}</span>
                      <span className="text-zinc-700 truncate">{liveSessionId.slice(0, 14)}…</span>
                      <button onClick={() => fetchSource()} disabled={sourceLoading || !liveReady}
                        className="ml-auto text-cyan-400 hover:text-cyan-300 disabled:opacity-30">
                        {sourceLoading ? <RefreshCw className="h-3 w-3 animate-spin"/> : <RefreshCw className="h-3 w-3"/>}
                      </button>
                    </div>

                    {/* Mode tabs */}
                    <div className="flex gap-1">
                      {(['findings','raw','decoded'] as const).map(m => (
                        <button key={m} onClick={() => setSourceMode(m)}
                          className={cn('flex-1 py-1 text-[9px] font-bold rounded', sourceMode===m ? 'bg-cyan-500/20 text-cyan-400' : 'bg-zinc-800 text-zinc-500')}>
                          {m==='findings' ? `${sourceFindings.length} Findings` : m==='raw' ? 'Raw' : 'Decoded'}
                        </button>
                      ))}
                    </div>

                    {/* Stats summary */}
                    {sourceStats && sourceMode==='findings' && (
                      <div className="grid grid-cols-2 gap-1 text-[8px]">
                        <div className="bg-zinc-950 rounded px-1.5 py-1"><span className="text-zinc-600">scripts:</span> <span className="text-cyan-400 font-bold">{sourceStats.scripts||0}</span></div>
                        <div className="bg-zinc-950 rounded px-1.5 py-1"><span className="text-zinc-600">handlers:</span> <span className="text-amber-400 font-bold">{sourceStats.inlineHandlers||0}</span></div>
                        <div className="bg-zinc-950 rounded px-1.5 py-1"><span className="text-zinc-600">base64:</span> <span className="text-emerald-400 font-bold">{sourceStats.base64Blobs||0}</span></div>
                        <div className="bg-zinc-950 rounded px-1.5 py-1"><span className="text-zinc-600">evals:</span> <span className="text-rose-400 font-bold">{sourceStats.evals||0}</span></div>
                        <div className="bg-zinc-950 rounded px-1.5 py-1"><span className="text-zinc-600">dataURI:</span> <span className="text-emerald-400 font-bold">{sourceStats.dataUris||0}</span></div>
                        <div className="bg-zinc-950 rounded px-1.5 py-1"><span className="text-zinc-600">urlEnc:</span> <span className="text-amber-400 font-bold">{sourceStats.encodedUrls||0}</span></div>
                        <div className="bg-zinc-950 rounded px-1.5 py-1"><span className="text-zinc-600">JSON:</span> <span className="text-cyan-400 font-bold">{sourceStats.jsonBlobs||0}</span></div>
                        <div className="bg-zinc-950 rounded px-1.5 py-1"><span className="text-zinc-600">cssUrl:</span> <span className="text-zinc-500 font-bold">{sourceStats.cssUrls||0}</span></div>
                      </div>
                    )}

                    {/* Findings list */}
                    {sourceMode==='findings' && (
                      <div className="space-y-1.5 flex-1 overflow-y-auto">
                        {sourceFindings.length === 0 && (
                          <div className="text-[10px] text-zinc-600 text-center py-4">No encoded content found</div>
                        )}
                        {sourceFindings.map((f, i) => (
                          <div key={i} className="rounded bg-zinc-950 border border-zinc-800 p-1.5">
                            <div className="flex items-center gap-1 mb-1">
                              <span className={cn('text-[8px] font-bold px-1 rounded',
                                f.type==='base64' ? 'bg-emerald-500/20 text-emerald-400' :
                                f.type==='eval' ? 'bg-rose-500/20 text-rose-400' :
                                f.type==='data-uri' ? 'bg-emerald-500/20 text-emerald-400' :
                                f.type==='json-blob' ? 'bg-cyan-500/20 text-cyan-400' :
                                f.type==='inline-handler' ? 'bg-amber-500/20 text-amber-400' :
                                'bg-zinc-700 text-zinc-300'
                              )}>{f.type}</span>
                              <span className="text-[8px] text-zinc-600">{f.location}</span>
                              <button onClick={() => copyToClipboard(f.decoded)} title="Copy decoded"
                                className="ml-auto text-zinc-600 hover:text-cyan-400"><Copy className="h-2.5 w-2.5"/></button>
                            </div>
                            <div className="text-[8px] font-mono text-zinc-500 break-all bg-zinc-900 rounded px-1 py-0.5 mb-1">{f.original}</div>
                            <pre className="text-[9px] font-mono text-cyan-300 bg-zinc-900 rounded px-1 py-0.5 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{f.decoded}</pre>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Raw HTML */}
                    {sourceMode==='raw' && (
                      <div className="flex flex-col flex-1">
                        <div className="flex gap-1 mb-1">
                          <button onClick={() => copyToClipboard(sourceRaw)} className="px-2 py-0.5 text-[8px] rounded bg-zinc-800 text-zinc-400 hover:text-cyan-400 flex items-center gap-1"><Copy className="h-2.5 w-2.5"/> Copy</button>
                          <button onClick={() => downloadText('source-raw.html', sourceRaw)} className="px-2 py-0.5 text-[8px] rounded bg-zinc-800 text-zinc-400 hover:text-cyan-400 flex items-center gap-1"><Download className="h-2.5 w-2.5"/> Save</button>
                          <span className="ml-auto text-[8px] text-zinc-600">{(sourceRaw.length/1024).toFixed(1)}KB</span>
                        </div>
                        <pre className="text-[8px] font-mono text-zinc-400 bg-zinc-950 rounded p-1.5 flex-1 overflow-auto whitespace-pre-wrap break-all">{sourceRaw.slice(0, 30000)}{sourceRaw.length > 30000 && '\n…(truncated)'}</pre>
                      </div>
                    )}

                    {/* Decoded HTML */}
                    {sourceMode==='decoded' && (
                      <div className="flex flex-col flex-1">
                        <div className="flex gap-1 mb-1">
                          <button onClick={() => copyToClipboard(sourceDecoded)} className="px-2 py-0.5 text-[8px] rounded bg-zinc-800 text-zinc-400 hover:text-cyan-400 flex items-center gap-1"><Copy className="h-2.5 w-2.5"/> Copy</button>
                          <button onClick={() => downloadText('source-decoded.html', sourceDecoded)} className="px-2 py-0.5 text-[8px] rounded bg-zinc-800 text-zinc-400 hover:text-cyan-400 flex items-center gap-1"><Download className="h-2.5 w-2.5"/> Save</button>
                          <span className="ml-auto text-[8px] text-zinc-600">{(sourceDecoded.length/1024).toFixed(1)}KB</span>
                        </div>
                        <pre className="text-[8px] font-mono text-emerald-300 bg-zinc-950 rounded p-1.5 flex-1 overflow-auto whitespace-pre-wrap break-all">{sourceDecoded.slice(0, 30000)}{sourceDecoded.length > 30000 && '\n…(truncated)'}</pre>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* STATUS */}
      <div className="flex items-center gap-2 px-2 py-0.5 border-t border-zinc-800 bg-zinc-900/80 text-[9px] text-zinc-500 shrink-0">
        <span className="flex items-center gap-1"><span className={cn('h-1.5 w-1.5 rounded-full',torReady?'bg-emerald-500 animate-pulse':'bg-rose-500')}/>{torReady?'Tor':'OFF'}</span>
        {exitIp&&<span>{exitIp}</span>}
        <span>R:{requests.length}</span>
        <span>🍪:{cookies.length}</span>
        {autoSaveCookies&&<span className="text-emerald-400">AUTO</span>}
        {url&&<span className="text-cyan-500 truncate max-w-32">{currentHost}</span>}
        <span className="ml-auto text-zinc-700">24 tools · Click left dock → auto-runs</span>
      </div>
    </div>
  )
}
