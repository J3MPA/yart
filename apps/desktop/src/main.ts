import { join } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { DaemonClient } from '@yart/mcp/daemon-client'
import { readConfig } from './config.ts'

const config = readConfig(process.env)

// Before the lock is taken: the lock belongs to the profile.
if (config.profile !== null) {
  app.setPath('userData', join(app.getPath('appData'), config.profile))
}

// The app belongs to no repository, so the daemon it starts has no default one.
const daemon = new DaemonClient({ port: config.daemon_port, repo_path: null })

let window: BrowserWindow | null = null

const openOutside = (url: string) => {
  const { protocol } = new URL(url)
  if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url)
}

const createWindow = () => {
  const created = new BrowserWindow({ width: 1280, height: 860, title: 'yart' })

  // The window shows yart and nothing else: a link to another site in a review
  // opens in the browser rather than turning this window into one.
  created.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  created.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === config.origin) return
    event.preventDefault()
    openOutside(url)
  })
  created.on('closed', () => {
    window = null
  })

  void created.loadURL(config.start_url)
  window = created
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window === null) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.on('activate', () => {
    if (window === null) createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  const start = async () => {
    try {
      await daemon.ensureRunning()
    } catch (cause) {
      dialog.showErrorBox(
        'yart could not start',
        cause instanceof Error ? cause.message : String(cause),
      )
      app.quit()
      return
    }
    createWindow()
  }

  void app.whenReady().then(start)
}
