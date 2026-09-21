'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Bot, Send, X, Loader2, Square, Copy, Check, Eye, ChevronLeft, ChevronRight } from 'lucide-react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  steps?: { step: number; thought: string; action: string; params: Record<string, unknown>; result: string }[]
  screenshots?: string[]  // full-page screenshots the AI took during this turn
}

/** Does this string look like HTML or markdown (has tags we render)? */
function looksLikeHtml(s: string): boolean {
  return /<(h1|h2|h3|b|strong|ul|ol|li|p|br|div)\b/i.test(s) || /^#{1,3}\s/m.test(s) || /\*\*[^*]+\*\*/.test(s)
}

/** Convert markdown (## headings, **bold**, - lists) to HTML, then sanitize.
 *  The LLM sometimes returns markdown instead of HTML — handle both. */
function markdownToHtml(md: string): string {
  let html = md
  // Headings: ## Title -> <h2>Title</h2>, ### -> <h3>, # -> <h1>
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
  // Bold: **text** -> <strong>text</strong>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // Italic: *text* -> <em>text</em> (but not inside ** **)
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  // Bullet lists: - item or * item -> <li>item</li> (wrap consecutive in <ul>)
  html = html.replace(/(?:^[\-\*]\s+(.+)$\n?)+/gm, (match) => {
    const items = match.trim().split('\n').map(l => l.replace(/^[\-\*]\s+/, '').trim())
    return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>'
  })
  // Numbered lists: 1. item -> <li>item</li>
  html = html.replace(/(?:^\d+\.\s+(.+)$\n?)+/gm, (match) => {
    const items = match.trim().split('\n').map(l => l.replace(/^\d+\.\s+/, '').trim())
    return '<ol>' + items.map(i => `<li>${i}</li>`).join('') + '</ol>'
  })
  // Paragraphs: wrap loose text lines (not already in tags) in <p>
  html = html.split('\n\n').map(block => {
    const trimmed = block.trim()
    if (!trimmed) return ''
    if (/^<(h\d|ul|ol|li|p|div|br)/.test(trimmed)) return trimmed
    return '<p>' + trimmed.replace(/\n/g, '<br>') + '</p>'
  }).join('\n')
  return html
}

/** Strip any <script>/<style>/event handlers so the assistant's HTML is safe
 *  to inject via dangerouslySetInnerHTML. Only allows formatting tags. */
function sanitizeHtml(html: string): string {
  // If it looks like markdown, convert first
  const isMarkdown = /^#{1,3}\s/m.test(html) || /\*\*[^*]+\*\*/.test(html)
  if (isMarkdown && !/<(h1|h2|h3|ul|ol|li|p)\b/i.test(html)) {
    html = markdownToHtml(html)
  }
  return html
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, '')
    .replace(/src\s*=\s*"javascript:[^"]*"/gi, '')
}

/**
 * Floating AI Assistant — a small chat button fixed to the bottom-right corner
 * of the screen, always available (no need to open the app window). Click to
 * expand into a compact chat panel. Reuses the /api/assistant/chat SSE stream.
 */
export function AssistantFAB() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: "Hi! I can see and control the Remote Chrome browser. Tell me what to do — click, type, scroll, run console commands, play videos, etc.",
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [copiedMsg, setCopiedMsg] = useState<number | null>(null)
  // Canvas viewer: shows the full-page screenshot the AI is looking at, full length
  const [canvasImgs, setCanvasImgs] = useState<string[]>([])
  const [canvasIdx, setCanvasIdx] = useState(0)
  const [canvasOpen, setCanvasOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // AbortController for the in-flight assistant request — lets the user kill
  // the assistant's work mid-loop (Stop button).
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, status, busy, open])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  /** Kill the assistant's current work: aborts the fetch, which closes the
   * SSE stream and the server stops the agentic loop. */
  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setBusy(false)
    setStatus(null)
    // Mark the in-progress assistant message as stopped
    setMessages((m) => {
      const copy = [...m]
      const last = copy[copy.length - 1]
      if (last && last.role === 'assistant' && !last.content) {
        last.content = '⏹ Stopped by user.'
      }
      return copy
    })
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    setStatus('Starting…')

    const userMsg: ChatMessage = { role: 'user', content: text }
    const assistantMsg: ChatMessage = { role: 'assistant', content: '', steps: [] }
    setMessages((m) => [...m, userMsg, assistantMsg])
    const history = messages.map((m) => ({ role: m.role, content: m.content }))

    // Fresh AbortController for this request so the Stop button can cancel it
    const ac = new AbortController()
    abortRef.current = ac

    try {
      const resp = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
        signal: ac.signal,
      })
      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => resp.statusText)
        setMessages((m) => {
          const copy = [...m]
          copy[copy.length - 1] = { role: 'assistant', content: `Error: ${errText}` }
          return copy
        })
        return
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const events = buf.split('\n\n')
        buf = events.pop() ?? ''
        for (const ev of events) {
          const line = ev.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const parsed = JSON.parse(line.slice(6)) as { type: string; data: unknown }
            if (parsed.type === 'status') {
              setStatus(String(parsed.data))
            } else if (parsed.type === 'screenshot') {
              // Capture the full-page screenshot the AI took — shown in the
              // canvas viewer so the user sees what the AI sees.
              const d = parsed.data as { image: string; step?: number }
              assistantMsg.screenshots = [...(assistantMsg.screenshots ?? []), d.image]
              setMessages((m) => {
                const copy = [...m]
                copy[copy.length - 1] = { ...assistantMsg }
                return copy
              })
              setStatus('AI is looking at the page…')
            } else if (parsed.type === 'step') {
              const d = parsed.data as ChatMessage['steps'][0]
              assistantMsg.steps = [...(assistantMsg.steps ?? []), d]
              if (d.action === 'done') assistantMsg.content = d.result
              setMessages((m) => {
                const copy = [...m]
                copy[copy.length - 1] = { ...assistantMsg }
                return copy
              })
              setStatus(d.action === 'done' ? null : `Step ${d.step}: ${d.action}…`)
            } else if (parsed.type === 'done') {
              const d = parsed.data as { message: string }
              assistantMsg.content = d.message
              setMessages((m) => {
                const copy = [...m]
                copy[copy.length - 1] = { ...assistantMsg }
                return copy
              })
              setStatus(null)
            } else if (parsed.type === 'error') {
              assistantMsg.content = `⚠️ ${String(parsed.data)}`
              setMessages((m) => {
                const copy = [...m]
                copy[copy.length - 1] = { ...assistantMsg }
                return copy
              })
              setStatus(null)
            }
          } catch {}
        }
      }
    } catch (err) {
      // AbortError is expected when the user clicks Stop — don't show it as an error
      const e = err as Error
      if (e.name === 'AbortError') return
      setMessages((m) => {
        const copy = [...m]
        copy[copy.length - 1] = { role: 'assistant', content: `Connection error: ${e.message}` }
        return copy
      })
    } finally {
      abortRef.current = null
      setBusy(false)
      setStatus(null)
    }
  }, [input, busy, messages])

  return (
    <>
      {/* Floating button — bottom right, always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'fixed bottom-5 right-5 z-[10000] flex h-12 w-12 items-center justify-center rounded-full shadow-2xl transition-all',
          'bg-gradient-to-br from-emerald-500 to-cyan-500 hover:scale-110 active:scale-95',
          open && 'rotate-90'
        )}
        title="AI Assistant"
        aria-label="AI Assistant"
      >
        {open ? <X className="h-5 w-5 text-white" /> : <Bot className="h-6 w-6 text-white" />}
        {busy && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
        )}
      </button>

      {/* Compact chat panel — slides up when open */}
      {open && (
        <div className="fixed bottom-20 right-5 z-[10000] w-[360px] max-w-[calc(100vw-2.5rem)] h-[460px] max-h-[calc(100vh-7rem)] flex flex-col rounded-xl border border-zinc-700/80 bg-zinc-950/95 backdrop-blur-md shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
            <Bot className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-semibold">AI Assistant</span>
            {busy && <Loader2 className="h-3 w-3 animate-spin text-emerald-400 ml-auto" />}
            {!busy && status && <span className="text-[9px] text-zinc-500 ml-auto truncate max-w-[180px]">{status}</span>}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5 text-xs select-text">
            {messages.map((m, i) => (
              <div key={i} className={cn('flex flex-col gap-1', m.role === 'user' ? 'items-end' : 'items-start')}>
                <div className={cn(
                  'group relative max-w-[90%] rounded-lg px-2.5 py-1.5 text-[11px] break-words select-text',
                  m.role === 'user' ? 'bg-emerald-500 text-white whitespace-pre-wrap' : 'bg-zinc-800 text-zinc-100'
                )}>
                  {m.role === 'assistant' && m.content && looksLikeHtml(m.content) ? (
                    <div className="assistant-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.content) }} />
                  ) : (
                    m.content || (m.steps && m.steps.length === 0 ? '…' : '')
                  )}
                  {/* Copy button — appears on hover */}
                  {m.content && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(m.content)
                        setCopiedMsg(i)
                        setTimeout(() => setCopiedMsg(null), 1500)
                      }}
                      title="Copy message"
                      className={cn(
                        'absolute -top-2 right-1 opacity-0 group-hover:opacity-100 transition rounded p-0.5 bg-zinc-700 hover:bg-zinc-600',
                        m.role === 'user' ? 'text-white' : 'text-zinc-300'
                      )}
                    >
                      {copiedMsg === i ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    </button>
                  )}
                </div>
                {/* Compact action steps */}
                {m.steps && m.steps.length > 0 && (
                  <div className="w-full space-y-0.5">
                    {m.steps.filter(s => s.action !== 'done').slice(-4).map((s, j) => (
                      <div key={j} className="text-[9px] text-zinc-500 pl-1 flex items-center gap-1">
                        <span className="font-mono">#{s.step}</span>
                        <span className="text-sky-400">{s.action}</span>
                        <span className="truncate">{(s.result || '').slice(0, 40)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Screenshot thumbnails — blurred by default, unblur on hover
                    (privacy: don't show what the AI sees unless user wants to). */}
                {m.screenshots && m.screenshots.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {m.screenshots.map((src, si) => (
                      <button
                        key={si}
                        onClick={() => { setCanvasImgs(m.screenshots!); setCanvasIdx(si); setCanvasOpen(true) }}
                        onMouseEnter={(e) => { const img = e.currentTarget.querySelector('img'); if (img) img.style.filter = 'none'; const h = e.currentTarget.querySelector('.hover-hint'); if (h) (h as HTMLElement).style.opacity = '0'; }}
                        onMouseLeave={(e) => { const img = e.currentTarget.querySelector('img'); if (img) img.style.filter = 'blur(6px)'; const h = e.currentTarget.querySelector('.hover-hint'); if (h) (h as HTMLElement).style.opacity = '1'; }}
                        className="group/thumb relative rounded border border-zinc-700 hover:border-emerald-500 transition overflow-hidden"
                        title={`Screenshot ${si + 1} — hover to reveal, click to view full page`}
                      >
                        <img
                          src={src}
                          alt={`AI view ${si + 1}`}
                          className="h-12 w-auto object-cover transition-[filter] duration-300"
                          style={{ filter: 'blur(6px)' }}
                        />
                        <span className="absolute bottom-0 left-0 bg-black/70 text-white text-[8px] px-1">{si + 1}</span>
                        <span className="hover-hint absolute inset-0 flex items-center justify-center text-[7px] text-white pointer-events-none transition-opacity duration-300" style={{ opacity: 1 }}>
                          <span className="bg-black/60 rounded px-1 py-0.5">Hover</span>
                        </span>
                      </button>
                    ))}
                    <button
                      onClick={() => { setCanvasImgs(m.screenshots!); setCanvasIdx(0); setCanvasOpen(true) }}
                      className="flex items-center gap-1 text-[9px] text-emerald-400 hover:text-emerald-300 px-1.5 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 transition"
                    >
                      <Eye className="h-3 w-3" />
                      View All
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="flex items-center gap-1.5 px-2.5 py-2 border-t border-zinc-800 bg-zinc-900/80 shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Ask the assistant…"
              disabled={busy}
              className="flex-1 bg-zinc-800/60 rounded-md text-[11px] px-2.5 py-1.5 outline-none placeholder:text-zinc-600 disabled:opacity-50 border border-transparent focus:border-emerald-500/40"
            />
            {busy ? (
              // Stop button — kills the in-flight assistant work (AbortController)
              <button
                onClick={stop}
                title="Stop the assistant"
                className="flex items-center justify-center h-7 w-7 rounded-md bg-rose-500 hover:bg-rose-400 text-white transition shrink-0"
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="flex items-center justify-center h-7 w-7 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white transition shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Full-page Canvas Viewer — shows the AI's screenshot at FULL LENGTH,
          scrollable, with prev/next navigation. This is the "canvas" the user
          asked for: not just the small chat panel, but the entire webpage the
          AI is looking at, full size. */}
      {canvasOpen && canvasImgs.length > 0 && (
        <div
          className="fixed inset-0 z-[10001] bg-black/90 flex flex-col"
          onClick={() => setCanvasOpen(false)}
        >
          {/* Canvas header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-900/90 border-b border-zinc-800 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Eye className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-semibold text-zinc-200">AI Canvas — what the AI sees</span>
            <span className="text-[10px] text-zinc-500">{canvasIdx + 1} / {canvasImgs.length}</span>
            <div className="ml-auto flex items-center gap-1.5">
              {canvasIdx > 0 && (
                <button onClick={() => setCanvasIdx(canvasIdx - 1)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400">
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              {canvasIdx < canvasImgs.length - 1 && (
                <button onClick={() => setCanvasIdx(canvasIdx + 1)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400">
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => setCanvasOpen(false)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {/* Full-page image — scrollable, full length, centered */}
          <div className="flex-1 overflow-auto flex items-start justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <img
              src={canvasImgs[canvasIdx]}
              alt={`AI screenshot ${canvasIdx + 1}`}
              className="max-w-full h-auto rounded-lg shadow-2xl"
              style={{ imageRendering: 'auto' }}
            />
          </div>
        </div>
      )}
    </>
  )
}
