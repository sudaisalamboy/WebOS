/**
 * Camera Extension — Background Service Worker
 * 
 * On startup: immediately fetch config from API
 * Then polls every 3 seconds for updates
 * Stores config (with base64 data URL) in chrome.storage.local
 */

const DEFAULT_CONFIG = {
  enabled: false,
  sourceType: 'test-pattern',
  sourceUrl: '',
  zoom: 1.0,
  panX: 0,
  panY: 0,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  mirror: false,
  flip: false,
  grayscale: false,
  sepia: false,
  invert: false,
  width: 640,
  height: 480,
  fps: 15,
};

async function syncConfig() {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/camera-inject/extension-config', {
      cache: 'no-store',
    });
    if (response.ok) {
      const data = await response.json();
      if (data.config) {
        await chrome.storage.local.set({ cameraConfig: data.config });
        console.log('[CameraExtension] Config synced:', data.config.sourceType, 'enabled:', data.config.enabled);
        return data.config;
      }
    }
  } catch (e) {
    // API might be down — keep existing config
  }
  return null;
}

chrome.runtime.onInstalled.addListener(async () => {
  await syncConfig();
  console.log('[CameraExtension] Installed — config synced');
});

// Also sync on startup (when Chrome launches)
chrome.runtime.onStartup.addListener(async () => {
  await syncConfig();
  console.log('[CameraExtension] Startup — config synced');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CONFIG') {
    chrome.storage.local.get('cameraConfig').then(result => {
      sendResponse(result.cameraConfig || DEFAULT_CONFIG);
    });
    return true;
  }
  if (message.type === 'UPDATE_CONFIG') {
    chrome.storage.local.set({ cameraConfig: { ...DEFAULT_CONFIG, ...message.config } }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === 'DISABLE') {
    chrome.storage.local.set({ cameraConfig: { ...DEFAULT_CONFIG, enabled: false } }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === 'SYNC_NOW') {
    syncConfig().then(config => {
      sendResponse(config || DEFAULT_CONFIG);
    });
    return true;
  }
});

// Poll for config updates every 3 seconds
setInterval(syncConfig, 3000);

// Also sync immediately on load
syncConfig();

console.log('[CameraExtension] Background started');
