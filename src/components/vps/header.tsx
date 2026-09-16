'use client'

import { Activity, Moon, Sun, Server, RefreshCw } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useVpsStore, formatUptime } from '@/lib/vps-store'

export function VpsHeader() {
  const { setTheme } = useTheme()
  const connected = useVpsStore((s) => s.connected)
  const stats = useVpsStore((s) => s.stats)

  return (
    <header className="border-b border-border/60 bg-card/40 backdrop-blur-md sticky top-0 z-30">
      <div className="flex flex-wrap items-center gap-4 px-4 sm:px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <Server className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
                {stats?.hostname ?? 'vps-prod-01'}
              </h1>
              <Badge
                variant="outline"
                className={
                  connected
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }
              >
                <span className="relative flex h-2 w-2 mr-1.5">
                  {connected && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex h-2 w-2 rounded-full ${
                      connected ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                </span>
                {connected ? 'Online' : 'Connecting'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {stats ? `${stats.os} · ${stats.kernel}` : 'Loading system info...'}
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {stats && (
            <div className="hidden md:flex items-center gap-4 mr-1 text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Uptime <span className="text-foreground font-medium">{formatUptime(stats.uptime)}</span></span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Activity className="h-3.5 w-3.5" />
                <span>Load <span className="text-foreground font-medium">{stats.loadAvg.join(' · ')}</span></span>
              </div>
            </div>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const isDark = document.documentElement.classList.contains('dark')
              setTheme(isDark ? 'light' : 'dark')
            }}
            aria-label="Toggle theme"
            className="h-9 w-9"
          >
            <Sun className="h-4 w-4 hidden dark:block" />
            <Moon className="h-4 w-4 dark:hidden" />
          </Button>
        </div>
      </div>
    </header>
  )
}
