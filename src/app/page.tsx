'use client'

import { useEffect, useState, useCallback } from 'react'
import { Desktop } from '@/components/desktop/desktop'
import { WindowManager } from '@/components/desktop/window-manager'
import { Taskbar } from '@/components/desktop/taskbar'
import { LoginScreen } from '@/components/desktop/login-screen'
import { useDesktopStore } from '@/lib/desktop-store'
import { clearSessionToken } from '@/lib/auth-client'

export default function Home() {
  const openApp = useDesktopStore((s) => s.openApp)
  const [authenticated, setAuthenticated] = useState(false)
  const [checking, setChecking] = useState(true)

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/check', { cache: 'no-store' })
      const data = await res.json()
      setAuthenticated(!!data.authenticated)
    } catch {
      setAuthenticated(false)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  useEffect(() => {
    if (!authenticated) return
    const opened = sessionStorage.getItem('webos-booted')
    if (!opened) {
      sessionStorage.setItem('webos-booted', '1')
      openApp('about')
      setTimeout(() => openApp('file-explorer', { payload: { path: '/' } }), 250)
    }
  }, [authenticated, openApp])

  useEffect(() => {
    function onLogout() {
      clearSessionToken()
      setAuthenticated(false)
    }
    window.addEventListener('webos:logout', onLogout)
    return () => window.removeEventListener('webos:logout', onLogout)
  }, [])

  if (checking || !authenticated) {
    return <LoginScreen onAuthenticated={() => setAuthenticated(true)} />
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-zinc-950 text-foreground select-none">
      <Desktop />
      <WindowManager />
      <Taskbar />
    </div>
  )
}
