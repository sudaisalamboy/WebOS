import fs from 'node:fs'
import { buildCameraScript, type CameraConfig, DEFAULT_CONFIG } from '@/lib/camera-inject'

// Re-export DEFAULT_CONFIG for convenience
export { DEFAULT_CONFIG }

const CONFIG_FILE = './.camera-config.json'
const ENABLED_FILE = './.camera-enabled'

export function saveCameraConfig(config: CameraConfig, enabled: boolean): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
    if (enabled) fs.writeFileSync(ENABLED_FILE, '1')
    else { try { fs.unlinkSync(ENABLED_FILE) } catch { } }
  } catch (e) { }
}

export function loadCameraConfig(): CameraConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch { return null }
}

export function isCameraEnabled(): boolean {
  try { return fs.existsSync(ENABLED_FILE) } catch { return false }
}

export function setCameraEnabled(enabled: boolean): void {
  try {
    if (enabled) fs.writeFileSync(ENABLED_FILE, '1')
    else { try { fs.unlinkSync(ENABLED_FILE) } catch { } }
  } catch (e) { }
}

export function getCameraInjectScript(): string | null {
  if (!isCameraEnabled()) return null
  const config = loadCameraConfig()
  if (!config) return null
  return buildCameraScript(config)
}
