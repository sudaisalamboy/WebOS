'use client'

export function AboutApp() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 bg-background text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-sky-500 text-white text-2xl font-bold shadow-lg">
        W
      </div>
      <div>
        <h1 className="text-xl font-bold">WebOS</h1>
        <p className="text-xs text-muted-foreground mt-1">v1.0 · Browser-based desktop environment</p>
      </div>
      <div className="text-xs text-muted-foreground max-w-sm leading-relaxed space-y-1.5">
        <p>A sandboxed desktop environment running entirely in your browser.</p>
        <p>All files live in <code className="font-mono text-foreground/80">/user-files/</code> on the server.</p>
        <p>Built with Next.js 16, socket.io, shadcn/ui, and framer-motion.</p>
      </div>
      <div className="mt-4 pt-4 border-t border-border/50">
        <p className="text-xs font-medium text-foreground">
          Made by <span className="text-emerald-500">Sudais Alam</span>
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">
          Built with <span className="text-sky-500">AIFuzX</span>
        </p>
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground/60">
        Right-click files for context menu · Drag window titles to move · Drag bottom-right to resize
      </div>
      <div className="mt-6 pt-4 border-t border-border/50 text-[10px] text-muted-foreground/50">
        <p className="font-medium text-foreground/70">Credits</p>
        <p className="mt-1">Made by <span className="text-foreground/70">Sudais Alam</span></p>
        <p>Built with <span className="text-foreground/70">AIFuzX</span></p>
      </div>
    </div>
  )
}
