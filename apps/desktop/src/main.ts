import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  shell,
  type IpcMainEvent,
} from 'electron'
import { DaemonClient } from '@yart/mcp/daemon-client'
import { readConfig } from './config.ts'
import { reviewIdFromLink, SCHEME } from './links.ts'
import { parseCount, parseNotice } from './signals.ts'

const config = readConfig(process.env)

// Before the lock is taken: the lock belongs to the profile.
if (config.profile !== null) {
  app.setPath('userData', join(app.getPath('appData'), config.profile))
}

// The app belongs to no repository, so the daemon it starts has no default one.
// Packaged, it carries its own bundled daemon laid out as the workspace is.
const daemon = new DaemonClient({
  port: config.daemon_port,
  repo_path: null,
  daemon_cli: app.isPackaged
    ? join(app.getAppPath(), 'packages', 'daemon', 'dist', 'cli.mjs')
    : undefined,
})

let window: BrowserWindow | null = null
let started = false
/** A review asked for before there was a window to show it in. */
let pending_review: string | null = null
/**
 * Notifications on screen. Held because Electron lets go of one that nothing
 * references, and a notification collected that way no longer reports a click.
 */
const notifications = new Set<Notification>()

const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url))

const openOutside = (url: string) => {
  const { protocol } = new URL(url)
  if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url)
}

const reviewUrl = (review_id: string): string =>
  new URL(`/reviews/${review_id}`, config.origin).href

const createWindow = (url: string = config.start_url) => {
  const created = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'yart',
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Electron's option name
    webPreferences: { preload: PRELOAD },
  })

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

  void created.loadURL(url)
  window = created
}

const showReview = (review_id: string) => {
  if (!started) {
    pending_review = review_id
    return
  }
  if (window === null) {
    createWindow(reviewUrl(review_id))
    return
  }
  void window.loadURL(reviewUrl(review_id))
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

const openLink = (link: string) => {
  const review_id = reviewIdFromLink(link)
  if (review_id !== null) showReview(review_id)
}

/** Only yart's own page may set the badge or raise a notification. */
const fromYart = (event: IpcMainEvent): boolean => event.senderFrame?.origin === config.origin

ipcMain.on('unseen-changed', (event, value: unknown) => {
  const count = parseCount(value)
  if (!fromYart(event) || count === null) return
  app.setBadgeCount(count)
})

ipcMain.on('notify', (event, value: unknown) => {
  const notice = parseNotice(value)
  if (!fromYart(event) || notice === null || !Notification.isSupported()) return
  const notification = new Notification({
    title: notice.title,
    body: 'The agent has answered. Your turn.',
  })
  const release = () => notifications.delete(notification)
  notification.on('click', () => {
    release()
    showReview(notice.review_id)
  })
  notification.on('close', release)
  notifications.add(notification)
  notification.show()
})

// Registered before anything else: on macOS a link that launches the app
// arrives before it is ready.
app.on('open-url', (event, link) => {
  event.preventDefault()
  openLink(link)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Only an installed app claims the scheme: a development shell doing so would
  // take links meant for the installed one.
  if (config.profile === null) app.setAsDefaultProtocolClient(SCHEME)

  // Where macOS delivers a link through open-url, other platforms start a
  // second copy with the link among its arguments.
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith(`${SCHEME}://`))
    if (link !== undefined) {
      openLink(link)
      return
    }
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
    started = true
    createWindow(pending_review === null ? config.start_url : reviewUrl(pending_review))
    pending_review = null
  }

  void app.whenReady().then(start)
}
