'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { FsEntry, fsList, fsRead, fsWrite, fsMkdir, fsDelete, fsRename, fsCopy, fsMove, dirname, basename, joinPath, extname } from '@/lib/fs-client'
import { useDesktopStore } from '@/lib/desktop-store'
import { FILE_DRAG_MIME } from '@/components/desktop/file-icon'
import { cn } from '@/lib/utils'

interface Line {
  type: 'input' | 'output' | 'error' | 'system'
  text: string
  cwd?: string
}

const HELP_TEXT = `Available commands:
  ls [path]            list directory
  cd <path>            change directory
  pwd                  print working directory
  cat <file>           print file content
  echo <text>          print text (supports > file and >> file)
  mkdir <dir>          create directory
  touch <file>         create empty file
  rm <path>            remove file or directory (recursive)
  mv <src> <dst>       move or rename
  cp <src> <dst>       copy file or directory
  edit <file>          open file in Text Editor
  open <app>           open an app: terminal, browser, notes, files, vps
  tree [path]          show directory tree (max depth 3)
  clear                clear the screen
  help                 show this help
  whoami               print user
  date                 print date
  exit                 close terminal`

export function TerminalApp() {
  const [cwd, setCwd] = useState('/')
  const [lines, setLines] = useState<Line[]>([
    { type: 'system', text: 'WebOS Terminal v1.0 — type "help" for commands. Drop a file to auto-run.' },
  ])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [dragOver, setDragOver] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { openApp, closeWindow } = useDesktopStore()

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines])

  const push = useCallback((line: Line) => setLines((prev) => [...prev, line]), [])

  function resolvePath(arg: string): string {
    if (!arg) return cwd
    if (arg.startsWith('/')) return arg
    return joinPath(cwd, arg)
  }

  async function runCommand(raw: string) {
    const trimmed = raw.trim()
    push({ type: 'input', text: raw, cwd })

    if (!trimmed) return

    setHistory((prev) => [...prev, trimmed])
    setHistoryIdx(-1)

    // Handle output redirection (echo > file, echo >> file)
    const redirMatch = trimmed.match(/^(.+?)\s*(>>|>)\s*(\S+)$/)
    let cmd = trimmed
    let redir: { mode: '>' | '>>'; file: string } | null = null
    if (redirMatch) {
      cmd = redirMatch[1]
      redir = { mode: redirMatch[2] as '>' | '>>', file: redirMatch[3] }
    }

    const [name, ...args] = cmd.split(/\s+/)
    const out: string[] = []
    const err: string[] = []

    try {
      switch (name) {
        case 'help':
          out.push(HELP_TEXT)
          break
        case 'pwd':
          out.push(cwd)
          break
        case 'whoami':
          out.push('webos-user')
          break
        case 'date':
          out.push(new Date().toString())
          break
        case 'clear':
          setLines([])
          return
        case 'exit':
          closeWindow(useDesktopStore.getState().windows.find((w) => w.appId === 'terminal')?.id ?? '')
          return
        case 'ls': {
          const target = resolvePath(args[0] ?? '')
          const entries = await fsList(target)
          if (entries.length === 0) {
            // empty dir, no output
          } else {
            out.push(
              entries
                .map((e) => (e.isDir ? `${e.name}/` : e.name))
                .join('   ')
            )
          }
          break
        }
        case 'cd': {
          const target = resolvePath(args[0] ?? '/')
          // Validate it's a directory
          const parent = dirname(target)
          const entries = await fsList(parent)
          const found = entries.find((e) => e.path === target)
          if (!found) err.push(`cd: no such directory: ${args[0]}`)
          else if (!found.isDir) err.push(`cd: not a directory: ${args[0]}`)
          else setCwd(target)
          break
        }
        case 'cat': {
          if (!args[0]) { err.push('cat: missing file operand'); break }
          const target = resolvePath(args[0])
          const content = await fsRead(target)
          out.push(content)
          break
        }
        case 'echo': {
          const text = args.join(' ')
          if (redir) {
            const target = resolvePath(redir.file)
            let prev = ''
            if (redir.mode === '>>') {
              try { prev = await fsRead(target) + '\n' } catch { /* ignore */ }
            }
            await fsWrite(target, prev + text + '\n')
          } else {
            out.push(text)
          }
          break
        }
        case 'mkdir': {
          if (!args[0]) { err.push('mkdir: missing operand'); break }
          await fsMkdir(resolvePath(args[0]))
          break
        }
        case 'touch': {
          if (!args[0]) { err.push('touch: missing operand'); break }
          await fsWrite(resolvePath(args[0]), '')
          break
        }
        case 'rm': {
          if (!args[0]) { err.push('rm: missing operand'); break }
          // Support -rf flags (ignored, we always recurse)
          const target = args.find((a) => !a.startsWith('-'))
          if (!target) { err.push('rm: missing operand'); break }
          await fsDelete(resolvePath(target))
          break
        }
        case 'mv': {
          if (args.length < 2) { err.push('mv: missing operand'); break }
          await fsMove(resolvePath(args[0]), resolvePath(args[1]))
          break
        }
        case 'cp': {
          if (args.length < 2) { err.push('cp: missing operand'); break }
          await fsCopy(resolvePath(args[0]), resolvePath(args[1]))
          break
        }
        case 'rename': {
          if (args.length < 2) { err.push('rename: missing operand'); break }
          await fsRename(resolvePath(args[0]), resolvePath(args[1]))
          break
        }
        case 'edit': {
          if (!args[0]) { err.push('edit: missing file operand'); break }
          const target = resolvePath(args[0])
          openApp('text-editor', { payload: { path: target }, title: `Edit · ${basename(target)}` })
          out.push(`opening ${target} in Text Editor`)
          break
        }
        case 'open': {
          const app = args[0]
          const valid: Record<string, AppId> = {
            terminal: 'terminal', browser: 'browser', notes: 'notes',
            files: 'file-explorer', explorer: 'file-explorer', vps: 'vps-dashboard',
          }
          if (!app || !valid[app]) {
            err.push(`open: unknown app "${app ?? ''}". Valid: ${Object.keys(valid).join(', ')}`)
          } else {
            openApp(valid[app])
            out.push(`opening ${app}`)
          }
          break
        }
        case 'tree': {
          const target = resolvePath(args[0] ?? '')
          out.push(target)
          const tree = await buildTree(target, 3)
          out.push(tree)
          break
        }
        default:
          err.push(`command not found: ${name} (try "help")`)
      }
    } catch (e) {
      err.push((e as Error).message)
    }

    out.forEach((t) => push({ type: 'output', text: t }))
    err.forEach((t) => push({ type: 'error', text: t }))
  }

  async function buildTree(p: string, depth: number, prefix = ''): Promise<string> {
    if (depth <= 0) return ''
    try {
      const entries = await fsList(p)
      const lines: string[] = []
      entries.forEach((e, i) => {
        const isLast = i === entries.length - 1
        lines.push(`${prefix}${isLast ? '└── ' : '├── '}${e.name}${e.isDir ? '/' : ''}`)
      })
      // recurse into dirs
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        if (e.isDir) {
          const isLast = i === entries.length - 1
          const sub = await buildTree(e.path, depth - 1, prefix + (isLast ? '    ' : '│   '))
          if (sub) lines.push(sub)
        }
      }
      return lines.join('\n')
    } catch {
      return ''
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const cmd = input
      setInput('')
      runCommand(cmd)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1)
      setHistoryIdx(newIdx)
      setInput(history[newIdx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx === -1) return
      const newIdx = historyIdx + 1
      if (newIdx >= history.length) {
        setHistoryIdx(-1)
        setInput('')
      } else {
        setHistoryIdx(newIdx)
        setInput(history[newIdx])
      }
    } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      setLines([])
    } else if (e.key === 'Tab') {
      e.preventDefault()
      // Simple tab completion
      tabComplete()
    }
  }

  async function tabComplete() {
    const parts = input.split(/\s+/)
    const last = parts[parts.length - 1] ?? ''
    // Find candidates in cwd or specified dir
    const slashIdx = last.lastIndexOf('/')
    const dir = slashIdx >= 0 ? resolvePath(last.slice(0, slashIdx)) : cwd
    const prefix = slashIdx >= 0 ? last.slice(slashIdx + 1) : last
    try {
      const entries = await fsList(dir)
      const matches = entries.filter((e) => e.name.startsWith(prefix))
      if (matches.length === 1) {
        const m = matches[0]
        const completed = (slashIdx >= 0 ? last.slice(0, slashIdx + 1) : '') + m.name + (m.isDir ? '/' : '')
        parts[parts.length - 1] = completed
        setInput(parts.join(' '))
      } else if (matches.length > 1) {
        push({ type: 'output', text: matches.map((m) => m.name + (m.isDir ? '/' : '')).join('   ') })
      }
    } catch {
      // ignore
    }
  }

  // Drag-and-drop: drop a file → auto-run based on extension
  function onTerminalDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(FILE_DRAG_MIME) || e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDragOver(true)
    }
  }

  function onTerminalDragLeave(e: React.DragEvent) {
    if (e.currentTarget === e.target) setDragOver(false)
  }

  async function onTerminalDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const path = e.dataTransfer.getData(FILE_DRAG_MIME) || e.dataTransfer.getData('text/plain')
    if (!path) return
    await runDroppedFile(path)
  }

  /**
   * Auto-run a file based on its extension.
   *  - .js files → evaluate in a sandboxed Function and print output/errors
   *  - .json files → parse and pretty-print
   *  - directories → ls
   *  - other text files (.txt, .md, .log, .sh, .py, .ts, etc.) → cat
   *  - unknown → cat (server returns raw bytes-as-utf8)
   */
  async function runDroppedFile(path: string) {
    const name = basename(path)
    const ext = extname(path)

    push({ type: 'system', text: `📂 Dropped: ${path}` })

    try {
      // Directory → ls
      const parentDir = dirname(path)
      const entries = await fsList(parentDir)
      const entry = entries.find((e) => e.path === path)

      if (entry?.isDir) {
        await runCommand(`ls ${path}`)
        return
      }

      // Read file content
      const content = await fsRead(path)

      if (ext === 'js') {
        // Execute JS in a sandboxed Function with console redirected to a buffer
        push({ type: 'input', text: `node ${path}`, cwd })
        push({ type: 'output', text: `→ executing ${name}…` })
        const logs: string[] = []
        const fakeConsole = {
          log: (...args: unknown[]) => logs.push(args.map(formatValue).join(' ')),
          info: (...args: unknown[]) => logs.push(args.map(formatValue).join(' ')),
          warn: (...args: unknown[]) => logs.push(args.map(formatValue).join(' ')),
          error: (...args: unknown[]) => logs.push(args.map(formatValue).join(' ')),
        }
        try {
          // Wrap in async function to allow await
          const fn = new Function('console', `"use strict";\n${content}`)
          const result = fn(fakeConsole)
          if (result instanceof Promise) await result
          if (logs.length > 0) {
            logs.forEach((l) => push({ type: 'output', text: l }))
          } else {
            push({ type: 'output', text: '✓ (no output)' })
          }
        } catch (err) {
          push({ type: 'error', text: String((err as Error)?.stack ?? err) })
        }
        return
      }

      if (ext === 'json') {
        push({ type: 'input', text: `cat ${path} | json`, cwd })
        try {
          const parsed = JSON.parse(content)
          push({ type: 'output', text: JSON.stringify(parsed, null, 2) })
        } catch (err) {
          push({ type: 'error', text: `Invalid JSON: ${(err as Error).message}` })
          push({ type: 'output', text: content })
        }
        return
      }

      // Default: cat the file
      await runCommand(`cat ${path}`)
    } catch (err) {
      push({ type: 'error', text: `Failed to run ${path}: ${(err as Error).message}` })
    }
  }

  function formatValue(v: unknown): string {
    if (typeof v === 'string') return v
    if (v === null) return 'null'
    if (v === undefined) return 'undefined'
    if (typeof v === 'object') {
      try { return JSON.stringify(v) } catch { return String(v) }
    }
    return String(v)
  }

  return (
    <div
      className={cn(
        'relative flex h-full w-full flex-col bg-zinc-950 text-zinc-100 font-mono text-xs sm:text-sm transition-colors',
        dragOver && 'bg-emerald-950/40 ring-2 ring-inset ring-emerald-500/50'
      )}
      onClick={() => inputRef.current?.focus()}
      onDragOver={onTerminalDragOver}
      onDragLeave={onTerminalDragLeave}
      onDrop={onTerminalDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl border-2 border-dashed border-emerald-500/70 bg-emerald-500/15 px-10 py-6 text-center backdrop-blur-sm">
            <div className="text-3xl mb-1">⚡</div>
            <div className="text-emerald-200 font-semibold">Drop to run</div>
            <div className="text-emerald-300/70 text-xs mt-1">.js executes · .json pretty-prints · folders list · others cat</div>
          </div>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">
            {line.type === 'input' ? (
              <div>
                <span className="text-emerald-400">webos-user@webos</span>
                <span className="text-zinc-500">:</span>
                <span className="text-sky-400">{line.cwd}</span>
                <span className="text-zinc-500">$ </span>
                <span className="text-zinc-100">{line.text}</span>
              </div>
            ) : line.type === 'error' ? (
              <span className="text-rose-400">{line.text}</span>
            ) : line.type === 'system' ? (
              <span className="text-amber-400">{line.text}</span>
            ) : (
              <span className="text-zinc-200">{line.text}</span>
            )}
          </div>
        ))}
        <div className="flex items-center">
          <span className="text-emerald-400">webos-user@webos</span>
          <span className="text-zinc-500">:</span>
          <span className="text-sky-400">{cwd}</span>
          <span className="text-zinc-500">$&nbsp;</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            className="flex-1 bg-transparent outline-none text-zinc-100 caret-emerald-400"
          />
        </div>
      </div>
    </div>
  )
}
