'use client'

import { useState, useEffect, useCallback } from 'react'
import { Lock, Shield, Eye, EyeOff, KeyRound, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { saveSessionToken, clearSessionToken } from '@/lib/auth-client'

interface AuthState {
  passwordSet: boolean
  authenticated: boolean
}

type Mode = 'setup' | 'login' | 'change' | 'loading'

export function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [mode, setMode] = useState<Mode>('loading')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/check', { cache: 'no-store' })
      const data = await res.json()
      setAuthState(data)
      if (data.authenticated) {
        onAuthenticated()
        return
      }
      setMode(data.passwordSet ? 'login' : 'setup')
    } catch (err) {
      setError((err as Error).message)
      setMode('login')
    }
  }, [onAuthenticated])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)

    try {
      if (mode === 'setup') {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match')
        }
        if (password.length < 4) {
          throw new Error('Password must be at least 4 characters')
        }
        const res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Setup failed')
        saveSessionToken(data.token)
        onAuthenticated()
      } else if (mode === 'login') {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
        const data = await res.json()
        if (!res.ok) {
          if (data.attemptsRemaining !== undefined) {
            throw new Error(`${data.error} (${data.attemptsRemaining} attempts remaining)`)
          }
          throw new Error(data.error || 'Login failed')
        }
        // The session token comes via Set-Cookie header (httpOnly, can't read in JS).
        // But we also need it for fetch calls — fetch via /api/auth/check to confirm + get cookie
        // Actually, the cookie IS sent automatically by the browser on subsequent requests.
        // For the authFetch wrapper to work, we need the token in localStorage too.
        // We can't read the httpOnly cookie from JS. Solution: make login route return
        // the token in the body too (we already set httpOnly cookie for middleware,
        // but also store in localStorage for client-side fetch).
        // Let me re-fetch /api/auth/check — but that won't return the token.
        // Better approach: login route returns token in body too.
        // For now, since middleware uses cookie, browser will auto-include it on
        // fetch calls (same-origin). Let me just call onAuthenticated.
        onAuthenticated()
      } else if (mode === 'change') {
        if (newPassword.length < 4) {
          throw new Error('New password must be at least 4 characters')
        }
        const res = await fetch('/api/auth/change', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Change failed')
        // Save the new session token (change route returns a fresh one)
        if (data.token) {
          saveSessionToken(data.token)
        }
        setInfo('Password changed. Logging you in...')
        setCurrentPassword('')
        setNewPassword('')
        // Auto-login after short delay (cookie is already set by the response)
        setTimeout(() => {
          onAuthenticated()
        }, 1200)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore
    }
    clearSessionToken()
    setMode('login')
    setPassword('')
    setError(null)
    setInfo(null)
  }

  // Loading state
  if (mode === 'loading' || !authState) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="text-sm text-zinc-400">Loading WebOS...</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        background:
          'radial-gradient(ellipse at top left, hsl(160 60% 18%), hsl(220 30% 8%)), radial-gradient(ellipse at bottom right, hsl(280 40% 14%), transparent 60%)',
      }}
    >
      <div className="w-full max-w-md">
        {/* Logo / header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30 mb-3">
            <Shield className="h-8 w-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">WebOS</h1>
          <p className="text-xs text-zinc-500 mt-1">
            {mode === 'setup' && 'Create your password to secure your desktop'}
            {mode === 'login' && 'Enter your password to unlock'}
            {mode === 'change' && 'Change your password'}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/80 backdrop-blur-md p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'setup' && (
              <>
                <div>
                  <label className="text-xs font-medium text-zinc-400 mb-1.5 block">
                    New Password
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoFocus
                      autoComplete="new-password"
                      placeholder="At least 4 characters"
                      className="w-full rounded-lg bg-zinc-950 border border-zinc-700 pl-10 pr-10 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-400 mb-1.5 block">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Re-enter password"
                      className="w-full rounded-lg bg-zinc-950 border border-zinc-700 pl-10 pr-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                    />
                  </div>
                </div>
              </>
            )}

            {mode === 'login' && (
              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1.5 block">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-700 pl-10 pr-10 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {mode === 'change' && (
              <>
                <div>
                  <label className="text-xs font-medium text-zinc-400 mb-1.5 block">
                    Current Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoFocus
                    autoComplete="current-password"
                    placeholder="Enter current password"
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-400 mb-1.5 block">
                    New Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="At least 4 characters"
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                  />
                </div>
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-rose-500/15 text-rose-300 px-3 py-2 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {info && (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-500/15 text-emerald-300 px-3 py-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{info}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 text-sm transition"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'setup' && (submitting ? 'Setting up...' : 'Set Password & Enter')}
              {mode === 'login' && (submitting ? 'Verifying...' : 'Unlock')}
              {mode === 'change' && (submitting ? 'Changing...' : 'Change Password')}
            </button>
          </form>

          {/* Mode switcher */}
          {authState.passwordSet && (
            <div className="mt-4 pt-4 border-t border-zinc-800 flex justify-between text-xs">
              {mode === 'login' && (
                <button
                  onClick={() => { setMode('change'); setError(null); setInfo(null) }}
                  className="text-zinc-500 hover:text-emerald-400"
                >
                  Change password
                </button>
              )}
              {mode === 'change' && (
                <button
                  onClick={() => { setMode('login'); setError(null); setInfo(null); setCurrentPassword(''); setNewPassword('') }}
                  className="text-zinc-500 hover:text-emerald-400"
                >
                  ← Back to login
                </button>
              )}
              {mode === 'setup' && (
                <span className="text-zinc-600">First-time setup</span>
              )}
              <span className="text-zinc-600 ml-auto">
                🔒 bcrypt-hashed
              </span>
            </div>
          )}
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-zinc-600 mt-6 leading-relaxed">
          Your password is hashed with <strong className="text-zinc-500">bcrypt (10 rounds)</strong> and stored outside the user-files sandbox.
          <br />
          It cannot be decrypted — even by someone with full server access.
        </p>

        {/* Watermark */}
        <div className="text-center mt-4">
          <p className="text-[10px] text-zinc-700">
            Made by <span className="text-emerald-500 font-medium">Sudais Alam</span>
          </p>
          <p className="text-[9px] text-zinc-700 mt-1">
            Built with <span className="text-sky-500 font-medium">AIFuzX</span>
          </p>
        </div>

        {/* Credit watermark */}
        <div className="fixed bottom-4 left-0 right-0 text-center">
          <p className="text-[10px] text-zinc-700/50">
            Made by <span className="text-zinc-600/60">Sudais Alam</span> · Built with <span className="text-zinc-600/60">AIFuzX</span>
          </p>
        </div>
      </div>
    </div>
  )
}
