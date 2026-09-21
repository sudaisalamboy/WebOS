'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Bot, Send, Eye, MousePointerClick, Type, Scroll, Code2, Globe, X, Play, Loader2, RotateCcw } from 'lucide-react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  steps?: StepRecord[]
  screenshots?: string[]  // data URLs collected during this turn
}

interface StepRecord {
  step: number
  thought: string
  action: string
  params: Record<string, unknown>
  result: string
}

const ACTION_ICONS: Record<string, typeof MousePointerClick> = {
  click: MousePointerClick,
  type: Type,
  press_key: Type,
  scroll: Scroll,
  navigate: Globe,
  eval_js: Code2,
  close_tab: X,
  new_tab: Globe,
  done: Play,
}

export function AssistantApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: "Hi! I'm your AI browser assistant. I can see and control the Remote Chrome browser — I can click, type, scroll, navigate, run JavaScript (like an F12 console), play/pause videos, and manage tabs.\n\nFirst open the Remote Chrome app and click Start, then tell me what to do. e.g. \"go to wikipedia and search for quantum computing\" or \"play the video on the page\".",
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, status, busy])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    setStatus('Starting…')

    const userMsg: ChatMessage = { role: 'user', content: text }
    const assistantMsg: ChatMessage = { role: 'assistant', content: '', steps: [], screenshots: [] }
    setMessages((m) => [...m, userMsg, assistantMsg])

    // build history for the LLM (text only)
    const history = messages.map((m) => ({ role: m.role, content: m.content }))

    try {
      const resp = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
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
          const json = line.slice(6)
          try {
            const parsed = JSON.parse(json) as { type: string; data: unknown }
            handleEvent(parsed, assistantMsg, (updated) => {
              setMessages((m) => {
                const copy = [...m]
                copy[copy.length - 1] = updated
                return copy
              })
            })
          } catch {}
        }
      }
    } catch (err) {
      setMessages((m) => {
        const copy = [...m]
        copy[copy.length - 1] = { role: 'assistant', content: `Connection error: ${(err as Error).message}` }
        return copy
      })
    } finally {
      setBusy(false)
      setStatus(null)
    }
  }, [input, busy, messages])

  function handleEvent(
    ev: { type: string; data: unknown },
    msg: ChatMessage,
    update: (m: ChatMessage) => void,
  ) {
    if (ev.type === 'status') {
      setStatus(String(ev.data))
    } else if (ev.type === 'screenshot') {
      const d = ev.data as { image: string }
      msg.screenshots = [...(msg.screenshots ?? []), d.image]
      update({ ...msg })
      setStatus('Looking at the page…')
    } else if (ev.type === 'step') {
      const d = ev.data as StepRecord
      msg.steps = [...(msg.steps ?? []), d]
      if (d.action === 'done') {
        msg.content = d.result
      }
      update({ ...msg })
      setStatus(`Step ${d.step}: ${d.action}…`)
    } else if (ev.type === 'done') {
      const d = ev.data as { message: string }
      msg.content = d.message
      update({ ...msg })
      setStatus(null)
    } else if (ev.type === 'error') {
      msg.content = `⚠️ ${String(ev.data)}`
      update({ ...msg })
      setStatus(null)
    }
  }

  const quickPrompts = [
    'Take a screenshot and tell me what page is open',
    'Scroll down the page',
    'Play the video if there is one',
    'Run document.title in the console',
  ]

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-foreground">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-zinc-900/60 shrink-0">
        <Bot className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-semibold">AI Browser Assistant</span>
        <span className="text-[10px] text-zinc-500 ml-1">controls Remote Chrome via CDP</span>
        {busy && <Loader2 className="h-3 w-3 animate-spin text-emerald-400 ml-auto" />}
        {status && !busy && <span className="text-[10px] text-zinc-500 ml-auto truncate">{status}</span>}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} />
        ))}
        {busy && status && (
          <div className="flex items-center gap-2 text-xs text-zinc-400 pl-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {status}
          </div>
        )}
      </div>

      {/* Quick prompts */}
      <div className="px-3 py-2 border-t border-border/60 bg-zinc-900/40 flex gap-1.5 overflow-x-auto shrink-0">
        {quickPrompts.map((q) => (
          <button
            key={q}
            onClick={() => !busy && setInput(q)}
            disabled={busy}
            className="shrink-0 text-[10px] px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 transition"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-3 border-t border-border/60 bg-zinc-900/60 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Tell the assistant what to do in Chrome…"
          disabled={busy}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="flex items-center gap-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 text-xs font-bold transition"
        >
          <Send className="h-3.5 w-3.5" />
          Send
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={cn('flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
      <div className={cn(
        'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
        isUser
          ? 'bg-emerald-500 text-white'
          : 'bg-zinc-800 text-zinc-100'
      )}>
        {msg.content || (msg.steps && msg.steps.length === 0 ? '…' : '')}
      </div>

      {/* Screenshots the assistant took */}
      {msg.screenshots && msg.screenshots.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-w-[90%]">
          {msg.screenshots.map((src, i) => (
            <ScreenshotThumb key={i} src={src} index={i} />
          ))}
        </div>
      )}

      {/* Action steps */}
      {msg.steps && msg.steps.length > 0 && (
        <div className="w-full max-w-[95%] space-y-1">
          {msg.steps.map((s, i) => (
            <StepRow key={i} step={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function ScreenshotThumb({ src, index }: { src: string; index: number }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative group rounded-md overflow-hidden border border-zinc-700 hover:border-emerald-500 transition"
        title={`Screenshot ${index + 1} — hover to reveal, click to enlarge`}
      >
        {/* Blurred by default; unblurs on hover for privacy */}
        <img
          src={src}
          alt={`screenshot ${index + 1}`}
          className="h-16 w-auto object-cover transition-[filter] duration-300"
          style={{ filter: hovered ? 'none' : 'blur(8px)' }}
        />
        <span className="absolute bottom-0 left-0 bg-black/70 text-white text-[9px] px-1">
          #{index + 1}
        </span>
        {/* "Blurred" / "Hover to reveal" hint badge */}
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-white pointer-events-none transition-opacity duration-300',
            hovered ? 'opacity-0' : 'opacity-100'
          )}
        >
          <span className="bg-black/60 rounded px-1.5 py-0.5">Hover to reveal</span>
        </span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[10001] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <img src={src} alt="screenshot large" className="max-w-full max-h-full rounded shadow-2xl" />
        </div>
      )}
    </>
  )
}

function StepRow({ step }: { step: StepRecord }) {
  const Icon = ACTION_ICONS[step.action] ?? Code2
  const isDone = step.action === 'done'
  return (
    <div className={cn(
      'flex items-start gap-2 rounded-md px-2 py-1.5 text-[11px] border',
      isDone
        ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-200'
        : 'bg-zinc-900/60 border-zinc-800 text-zinc-300'
    )}>
      <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', isDone ? 'text-emerald-400' : 'text-sky-400')} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500">#{step.step}</span>
          <span className="font-semibold text-zinc-200">{step.action}</span>
        </div>
        {step.thought && <div className="text-zinc-400 text-[10px] italic">{step.thought}</div>}
        {step.result && !isDone && (
          <div className="font-mono text-[10px] text-zinc-500 mt-0.5 truncate">{step.result}</div>
        )}
      </div>
    </div>
  )
}
