'use client'

import { SESSION_TOKEN_HEADER, LOCAL_STORAGE_KEY } from './auth-shared'

/** Save session token to localStorage. */
export function saveSessionToken(token: string): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, token)
  } catch {
    // localStorage may be unavailable (private mode) — fall back to in-memory
    ;(window as unknown as { __webos_session?: string }).__webos_session = token
  }
}

/** Get session token from localStorage (or in-memory fallback). */
export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY)
  } catch {
    return (window as unknown as { __webos_session?: string }).__webos_session ?? null
  }
}

/** Clear session token (logout). */
export function clearSessionToken(): void {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY)
  } catch {
    delete (window as unknown as { __webos_session?: string }).__webos_session
  }
}

/**
 * Authenticated fetch — automatically attaches the session token as a header.
 * Use this everywhere instead of plain fetch() so protected API routes work.
 *
 * Note: for same-origin requests, the httpOnly cookie is also sent automatically,
 * so this header is technically redundant — but kept for client-side state checks.
 */
export async function authFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const token = getSessionToken()
  const headers = new Headers(init?.headers)
  if (token) {
    headers.set(SESSION_TOKEN_HEADER, token)
  }
  return fetch(input, { ...init, headers })
}
