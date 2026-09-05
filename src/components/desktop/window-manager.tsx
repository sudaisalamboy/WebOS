'use client'

import { useDesktopStore } from '@/lib/desktop-store'
import { OsWindow } from './os-window'
import { TerminalApp } from '@/components/apps/terminal-app'
import { BrowserApp } from '@/components/apps/browser-app'
import { NotesApp } from '@/components/apps/notes-app'
import { FileExplorerApp } from '@/components/apps/file-explorer-app'
import { TextEditorApp } from '@/components/apps/text-editor-app'
import { VpsDashboardApp } from '@/components/apps/vps-dashboard-app'
import { TorBrowserApp } from '@/components/apps/tor-browser-app'
import { TorSuiteApp } from '@/components/apps/tor-suite-app'
import { RemoteChromeApp } from '@/components/apps/remote-chrome-app'
import { OnionShareApp } from '@/components/apps/onionshare-app'
import { SecurityLabApp } from '@/components/apps/security-lab-app'
import { EncryptedNotesApp } from '@/components/apps/encrypted-notes-app'
import { ScreenshotApp } from '@/components/apps/screenshot-app'
import { CameraInjectApp } from '@/components/apps/camera-inject-app'
import { AboutApp } from '@/components/apps/about-app'

export function WindowManager() {
  const windows = useDesktopStore((s) => s.windows)

  return (
    <>
      {windows.map((w) => (
        <OsWindow key={w.id} win={w}>
          {renderApp(w.appId, w.payload)}
        </OsWindow>
      ))}
    </>
  )
}

function renderApp(appId: string, payload?: Record<string, unknown>) {
  switch (appId) {
    case 'terminal':
      return <TerminalApp />
    case 'browser':
      return <BrowserApp />
    case 'notes':
      return <NotesApp />
    case 'file-explorer':
      return <FileExplorerApp initialPath={(payload?.path as string) ?? '/'} />
    case 'text-editor':
      return <TextEditorApp path={payload?.path as string | undefined} />
    case 'vps-dashboard':
      return <VpsDashboardApp />
    case 'tor-browser':
      return <TorBrowserApp />
    case 'tor-suite':
      return <TorSuiteApp />
    case 'remote-chrome':
      return <RemoteChromeApp />
    case 'onionshare':
      return <OnionShareApp />
    case 'security-lab':
      return <SecurityLabApp />
    case 'screenshot':
      return <ScreenshotApp />
    case 'camera-inject':
      return <CameraInjectApp />
    case 'encrypted-notes':
      return <EncryptedNotesApp />
    case 'about':
      return <AboutApp />
    default:
      return <div className="p-4 text-sm text-muted-foreground">Unknown app: {appId}</div>
  }
}
