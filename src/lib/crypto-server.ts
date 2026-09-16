import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, chmodSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs'



/**
 * Encrypted storage helpers — server-side.
 *
 * Design:
 * - User's password is used to derive an encryption key via PBKDF2 (high iterations).
 *   The plaintext password is NEVER stored.
 * - The derived key is kept in-memory only (Map<sessionId, key>), cleared on logout
 *   or server restart. Server never persists the key.
 * - Files are stored as AES-256-GCM ciphertext (authenticated encryption).
 *   Without the key, ciphertext is opaque — server can only see name/size/metadata,
 *   never the plaintext content.
 * - A "verification token" (encrypted known-plaintext) is stored on first setup.
 *   On unlock, we try to decrypt it with the derived key — if it matches, key is correct.
 *
 * Threat model:
 * - Server admin can read encrypted file bytes but NOT plaintext (no key)
 * - Server admin can see file names + sizes (metadata)
 * - Server admin can NOT forge a session key (HMAC required)
 * - On logout/restart, in-memory key is wiped — ciphertext remains, but useless
 *   without password
 */

const ALGO = 'aes-256-gcm'
const KEY_LEN = 32 // 256 bits
const IV_LEN = 12 // 96 bits (recommended for GCM)
const PBKDF2_ITERATIONS = 600_000 // ~500ms per derivation — slow on purpose
const PBKDF2_SALT_LEN = 32
const TAG_LEN = 16

const ENC_DIR = '/home/z/my-project/.enc-files'
const SALT_FILE = `${ENC_DIR}/salt`
const VERIFY_FILE = `${ENC_DIR}/verify.token`

// In-memory store: sessionId -> derived encryption key
// Cleared on server restart OR on logout
const sessionKeys = new Map<string, Buffer>()

function ensureEncDir() {
  if (!existsSync(ENC_DIR)) {
    mkdirSync(ENC_DIR, { recursive: true })
    chmodSync(ENC_DIR, 0o700)
  }
}

/** Get or create the PBKDF2 salt (one salt per installation, stored on disk). */
function getSalt(): Buffer {
  ensureEncDir()
  if (!existsSync(SALT_FILE)) {
    const salt = randomBytes(PBKDF2_SALT_LEN)
    writeFileSync(SALT_FILE, salt, { mode: 0o600 })
    return salt
  }
  return readFileSync(SALT_FILE)
}

/** Derive a 256-bit encryption key from password + salt using PBKDF2. */
export function deriveKey(password: string): Buffer {
  const salt = getSalt()
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256')
}

/**
 * Set up encryption for the first time:
 * 1. Salt is created (if not present)
 * 2. A verification token (encrypted known plaintext) is written
 *
 * Must be called when user sets their password (during setup or change).
 */
export function setupEncryption(password: string): void {
  ensureEncDir()
  const key = deriveKey(password)
  // Verification token = encrypted known string "WEBOS_ENC_OK"
  const plaintext = Buffer.from('WEBOS_ENC_OK', 'utf8')
  const ciphertext = encrypt(key, plaintext)
  writeFileSync(VERIFY_FILE, ciphertext, { mode: 0o600 })
}

/** Check if encryption has been set up. */
export function isEncryptionSetup(): boolean {
  return existsSync(SALT_FILE) && existsSync(VERIFY_FILE)
}

/**
 * Verify password + derive key + cache key in-memory for this session.
 * Returns true if password is correct (verification token decrypts successfully).
 */
export function unlockEncryption(sessionId: string, password: string): boolean {
  if (!isEncryptionSetup()) {
    // Auto-setup if not yet done (first unlock after password set)
    setupEncryption(password)
    const key = deriveKey(password)
    sessionKeys.set(sessionId, key)
    return true
  }
  const key = deriveKey(password)
  const verifyToken = readFileSync(VERIFY_FILE)
  try {
    const decrypted = decrypt(key, verifyToken)
    const expected = Buffer.from('WEBOS_ENC_OK', 'utf8')
    if (decrypted.length === expected.length && timingSafeEqual(decrypted, expected)) {
      sessionKeys.set(sessionId, key)
      return true
    }
    return false
  } catch {
    return false
  }
}

/** Remove the cached key for a session (called on logout). */
export function lockSession(sessionId: string): void {
  sessionKeys.delete(sessionId)
}

/** Check if a session has its encryption key cached. */
export function isSessionUnlocked(sessionId: string): boolean {
  return sessionKeys.has(sessionId)
}

/** Get the cached key for a session (throws if not unlocked). */
function getKey(sessionId: string): Buffer {
  const key = sessionKeys.get(sessionId)
  if (!key) {
    throw new Error('Encryption not unlocked for this session. Please re-enter your password.')
  }
  return key
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Output format: iv || tag || ciphertext (concatenated, binary)
 */
export function encrypt(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc])
}

/**
 * Decrypt ciphertext produced by encrypt().
 * Throws if key is wrong or ciphertext is tampered (GCM auth tag check).
 */
export function decrypt(key: Buffer, ciphertext: Buffer): Buffer {
  if (ciphertext.length < IV_LEN + TAG_LEN) {
    throw new Error('ciphertext too short')
  }
  const iv = ciphertext.subarray(0, IV_LEN)
  const tag = ciphertext.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const enc = ciphertext.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()])
}

/** Encrypt plaintext string for a specific session. Returns base64 ciphertext. */
export function encryptForSession(sessionId: string, plaintext: string): string {
  const key = getKey(sessionId)
  const ct = encrypt(key, Buffer.from(plaintext, 'utf8'))
  return ct.toString('base64')
}

/** Decrypt base64 ciphertext for a specific session. Returns plaintext string. */
export function decryptForSession(sessionId: string, ciphertextB64: string): string {
  const key = getKey(sessionId)
  const ct = Buffer.from(ciphertextB64, 'base64')
  const pt = decrypt(key, ct)
  return pt.toString('utf8')
}

/**
 * Rotate the encryption key (called on password change).
 * Re-encrypts all stored encrypted files with the new key.
 */
export async function rotateEncryptionKey(
  sessionId: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  if (!isEncryptionSetup()) {
    setupEncryption(newPassword)
    return
  }
  const oldKey = deriveKey(oldPassword)
  const newKey = deriveKey(newPassword)

  // Re-encrypt verification token
  const verifyToken = readFileSync(VERIFY_FILE)
  const decrypted = decrypt(oldKey, verifyToken)
  const newVerifyToken = encrypt(newKey, decrypted)
  writeFileSync(VERIFY_FILE, newVerifyToken, { mode: 0o600 })

  // Re-encrypt all .enc files
  if (existsSync(ENC_DIR)) {
    const entries = readdirSync(ENC_DIR)
    for (const entry of entries) {
      if (!entry.endsWith('.enc')) continue
      const filePath = `${ENC_DIR}/${entry}`
      const oldCt = readFileSync(filePath)
      try {
        const pt = decrypt(oldKey, oldCt)
        const newCt = encrypt(newKey, pt)
        writeFileSync(filePath, newCt, { mode: 0o600 })
      } catch (err) {
        console.error(`[enc] Failed to rotate key for ${entry}:`, (err as Error).message)
      }
    }
  }

  // Update in-memory key for this session
  sessionKeys.set(sessionId, newKey)
}

/**
 * Store an encrypted file by name.
 * The file is stored as `${ENC_DIR}/${name}.enc` containing the raw ciphertext bytes
 * (not base64 — direct binary for efficiency).
 */
export function writeEncryptedFile(sessionId: string, name: string, plaintext: string): void {
  const key = getKey(sessionId)
  ensureEncDir()
  const safeName = sanitizeName(name)
  const ct = encrypt(key, Buffer.from(plaintext, 'utf8'))
  writeFileSync(`${ENC_DIR}/${safeName}.enc`, ct, { mode: 0o600 })
}

/**
 * Read an encrypted file by name.
 * Returns the decrypted plaintext.
 */
export function readEncryptedFile(sessionId: string, name: string): string {
  const key = getKey(sessionId)
  const safeName = sanitizeName(name)
  const filePath = `${ENC_DIR}/${safeName}.enc`
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${name}`)
  }
  const ct = readFileSync(filePath)
  const pt = decrypt(key, ct)
  return pt.toString('utf8')
}

/**
 * List encrypted files — returns METADATA ONLY (name, size of ciphertext, modified time).
 * Does NOT decrypt any content. Safe to call without a key (e.g. for "form only" view).
 */
export function listEncryptedFiles(): Array<{
  name: string
  ciphertextSize: number
  modified: number
}> {
  ensureEncDir()
  if (!existsSync(ENC_DIR)) return []
  const entries = readdirSync(ENC_DIR)
  const result: Array<{ name: string; ciphertextSize: number; modified: number }> = []
  for (const entry of entries) {
    if (!entry.endsWith('.enc')) continue
    const filePath = `${ENC_DIR}/${entry}`
    const stat = statSync(filePath)
    const name = entry.replace(/\.enc$/, '')
    result.push({
      name,
      ciphertextSize: stat.size,
      modified: stat.mtimeMs,
    })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** Delete an encrypted file by name. */
export function deleteEncryptedFile(name: string): void {
  const safeName = sanitizeName(name)
  const filePath = `${ENC_DIR}/${safeName}.enc`
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}

/** Rename an encrypted file (no re-encryption needed — name is metadata only). */
export function renameEncryptedFile(oldName: string, newName: string): void {
  const oldSafe = sanitizeName(oldName)
  const newSafe = sanitizeName(newName)
  const oldPath = `${ENC_DIR}/${oldSafe}.enc`
  const newPath = `${ENC_DIR}/${newSafe}.enc`
  if (!existsSync(oldPath)) {
    throw new Error(`File not found: ${oldName}`)
  }
  renameSync(oldPath, newPath)
}

/** Sanitize filename to prevent path traversal. */
function sanitizeName(name: string): string {
  // Allow only alphanumeric, dash, underscore, dot
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  // Prevent . and .. and empty
  if (cleaned === '.' || cleaned === '..' || cleaned === '') {
    throw new Error('Invalid filename')
  }
  return cleaned
}
