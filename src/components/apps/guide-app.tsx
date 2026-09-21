'use client'

import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  Search,
  BookOpen,
  ChevronRight,
  FileText,
  Tag,
  ArrowLeft,
  Library,
  ShieldCheck,
  Flame,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  GUIDE_ARTICLES,
  CATEGORIES,
  searchArticles,
  getCategoryCounts,
  type GuideArticle,
} from '@/lib/guide-data'

const DIFFICULTY_STYLES: Record<GuideArticle['difficulty'], string> = {
  Beginner: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  Intermediate: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  Advanced: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
}

const DIFFICULTY_ICON: Record<GuideArticle['difficulty'], React.ReactNode> = {
  Beginner: <ShieldCheck className="h-3 w-3" />,
  Intermediate: <Zap className="h-3 w-3" />,
  Advanced: <Flame className="h-3 w-3" />,
}

export function GuideApp() {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [activeArticle, setActiveArticle] = useState<GuideArticle | null>(null)

  const counts = useMemo(() => getCategoryCounts(), [])

  const filtered = useMemo(() => {
    const searched = searchArticles(query)
    if (activeCategory) {
      return searched.filter((a) => a.category === activeCategory)
    }
    return searched
  }, [query, activeCategory])

  function selectArticle(a: GuideArticle) {
    setActiveArticle(a)
  }

  function back() {
    setActiveArticle(null)
  }

  function clearFilters() {
    setActiveCategory(null)
    setQuery('')
  }

  return (
    <div className="flex h-full w-full bg-zinc-950 text-zinc-100 font-sans">
      {/* Left sidebar — categories */}
      <aside className="w-48 sm:w-56 shrink-0 border-r border-zinc-800/80 bg-zinc-900/40 flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/80">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-500/15 ring-1 ring-cyan-500/30">
            <Library className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Sec Guide</span>
            <span className="text-[10px] text-zinc-500">{GUIDE_ARTICLES.length} articles</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 pr-1 custom-scroll">
          <button
            onClick={() => setActiveCategory(null)}
            className={cn(
              'flex w-full items-center justify-between px-4 py-2 text-xs transition group',
              activeCategory === null
                ? 'bg-cyan-500/10 text-cyan-300 border-l-2 border-cyan-400'
                : 'text-zinc-400 hover:bg-zinc-800/60 border-l-2 border-transparent',
            )}
          >
            <span className="flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5" />
              All Articles
            </span>
            <span className="text-[10px] text-zinc-500 tabular-nums">{GUIDE_ARTICLES.length}</span>
          </button>

          <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Categories
          </div>

          {CATEGORIES.map((cat) => {
            const count = counts[cat] ?? 0
            const isActive = activeCategory === cat
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(isActive ? null : cat)}
                className={cn(
                  'flex w-full items-center justify-between px-4 py-2 text-xs transition group',
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-300 border-l-2 border-cyan-400'
                    : 'text-zinc-400 hover:bg-zinc-800/60 border-l-2 border-transparent',
                )}
              >
                <span className="truncate text-left flex-1 mr-2">{cat}</span>
                <span
                  className={cn(
                    'text-[10px] tabular-nums rounded-full px-1.5 py-0.5',
                    isActive ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-500',
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800/80 text-[10px] text-zinc-600 leading-relaxed">
          Knowledge base for offensive & defensive security. Educational use only.
        </div>
      </aside>

      {/* Middle column — search + list */}
      <section
        className={cn(
          'w-64 sm:w-72 shrink-0 border-r border-zinc-800/80 bg-zinc-950/60 flex flex-col',
          activeArticle && 'hidden lg:flex',
        )}
      >
        <div className="p-3 border-b border-zinc-800/80">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 focus-within:border-cyan-500/60 focus-within:ring-1 focus-within:ring-cyan-500/30 transition">
            <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search articles, tags, content…"
              className="w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-600 outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition"
              >
                clear
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
            <span>
              {filtered.length} result{filtered.length === 1 ? '' : 's'}
              {activeCategory ? ` · ${activeCategory}` : ''}
            </span>
            {(query || activeCategory) && (
              <button onClick={clearFilters} className="text-cyan-400 hover:text-cyan-300 transition">
                reset
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scroll">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-zinc-600">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No articles match your search.
            </div>
          ) : (
            filtered.map((a) => (
              <button
                key={a.id}
                onClick={() => selectArticle(a)}
                className={cn(
                  'group w-full text-left px-4 py-3 border-l-2 transition border-b border-zinc-900/60',
                  activeArticle?.id === a.id
                    ? 'bg-cyan-500/10 border-cyan-400'
                    : 'border-transparent hover:bg-zinc-900/60',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                      DIFFICULTY_STYLES[a.difficulty],
                    )}
                  >
                    {DIFFICULTY_ICON[a.difficulty]}
                    {a.difficulty}
                  </span>
                  <span className="text-[10px] text-zinc-600 truncate">{a.category}</span>
                </div>
                <div className="text-sm font-medium text-zinc-100 group-hover:text-cyan-300 transition flex items-center gap-1">
                  {a.title}
                  <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition text-cyan-400" />
                </div>
                <div className="mt-1 text-[11px] text-zinc-500 leading-snug line-clamp-2">{a.summary}</div>
                <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                  {a.tags.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-500 group-hover:bg-zinc-700/80 transition"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* Right column — article view */}
      <section
        className={cn(
          'flex-1 flex flex-col bg-zinc-950 min-w-0',
          !activeArticle && 'hidden lg:flex',
        )}
      >
        {!activeArticle ? (
          <EmptyState />
        ) : (
          <>
            <header className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800/80 bg-zinc-900/40">
              <button
                onClick={back}
                className="lg:hidden flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-cyan-300 transition"
                title="Back to list"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <FileText className="h-4 w-4 text-cyan-400 shrink-0 hidden sm:block" />
              <div className="min-w-0 flex-1">
                <h1 className="text-sm font-semibold text-zinc-100 truncate">{activeArticle.title}</h1>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-500">
                  <span>{activeArticle.category}</span>
                  <span className="text-zinc-700">·</span>
                  <span>{estimateReadTime(activeArticle.content)} min read</span>
                </div>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
                  DIFFICULTY_STYLES[activeArticle.difficulty],
                )}
              >
                {DIFFICULTY_ICON[activeArticle.difficulty]}
                {activeArticle.difficulty}
              </span>
            </header>

            <div className="flex-1 overflow-y-auto custom-scroll">
              <article className="prose-guide max-w-3xl mx-auto px-5 sm:px-8 py-6">
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => (
                      <h1 className="text-xl font-bold text-zinc-50 mt-2 mb-4 leading-tight border-b border-zinc-800 pb-3">
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-base font-semibold text-cyan-300 mt-7 mb-2.5 flex items-center gap-2">
                        <span className="inline-block h-3 w-1 bg-cyan-400/70 rounded-sm" />
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-sm font-semibold text-zinc-200 mt-5 mb-2 uppercase tracking-wide">
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => (
                      <p className="text-sm leading-relaxed text-zinc-300 mb-3">{children}</p>
                    ),
                    ul: ({ children }) => (
                      <ul className="text-sm text-zinc-300 mb-3 ml-5 list-disc space-y-1 marker:text-cyan-500/60">
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="text-sm text-zinc-300 mb-3 ml-5 list-decimal space-y-1 marker:text-cyan-400">
                        {children}
                      </ol>
                    ),
                    li: ({ children }) => <li className="leading-relaxed pl-1">{children}</li>,
                    strong: ({ children }) => (
                      <strong className="font-semibold text-zinc-100">{children}</strong>
                    ),
                    em: ({ children }) => <em className="text-zinc-400 italic">{children}</em>,
                    code: ({ children }) => (
                      <code className="font-mono text-[12px] bg-zinc-800/80 text-cyan-300 px-1.5 py-0.5 rounded">
                        {children}
                      </code>
                    ),
                    pre: ({ children }) => (
                      <pre className="bg-zinc-900 border border-zinc-800 rounded-md p-3 my-3 overflow-x-auto text-[12px] leading-relaxed">
                        {children}
                      </pre>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-2 border-cyan-500/60 pl-3 py-1 my-3 text-sm text-zinc-400 italic bg-cyan-500/5">
                        {children}
                      </blockquote>
                    ),
                    a: ({ children, href }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 underline decoration-cyan-500/40 hover:decoration-cyan-300 transition"
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {activeArticle.content}
                </ReactMarkdown>

                {/* Tags footer */}
                <div className="mt-8 pt-4 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
                  <Tag className="h-3.5 w-3.5 text-zinc-600" />
                  {activeArticle.tags.map((t) => (
                    <button
                      key={t}
                      onClick={() => setQuery(t)}
                      className="text-[11px] px-2 py-1 rounded bg-zinc-800/80 text-zinc-400 hover:bg-cyan-500/15 hover:text-cyan-300 transition"
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              </article>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
      <div className="relative mb-5">
        <div className="absolute inset-0 blur-2xl bg-cyan-500/20 rounded-full" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/20 to-zinc-800 ring-1 ring-cyan-500/30">
          <BookOpen className="h-10 w-10 text-cyan-400" />
        </div>
      </div>
      <h2 className="text-base font-semibold text-zinc-100">Security Knowledge Base</h2>
      <p className="mt-2 text-xs text-zinc-500 max-w-sm leading-relaxed">
        A curated reference of offensive and defensive security topics. Select an article from the list, or use the search bar to find content by title, tag, or keyword.
      </p>
      <div className="mt-6 grid grid-cols-3 gap-3 w-full max-w-md text-[10px] text-zinc-500">
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
          <div className="text-cyan-400 font-semibold text-sm">{GUIDE_ARTICLES.length}</div>
          <div className="mt-0.5">articles</div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
          <div className="text-cyan-400 font-semibold text-sm">{CATEGORIES.length}</div>
          <div className="mt-0.5">categories</div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
          <div className="text-cyan-400 font-semibold text-sm">{countTags()}</div>
          <div className="mt-0.5">unique tags</div>
        </div>
      </div>
    </div>
  )
}

function countTags(): number {
  const set = new Set<string>()
  for (const a of GUIDE_ARTICLES) {
    for (const t of a.tags) set.add(t)
  }
  return set.size
}

function estimateReadTime(content: string): number {
  const words = content.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 200))
}
