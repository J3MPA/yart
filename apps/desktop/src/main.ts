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

// Do this before the app takes the lock, because the lock belongs to the profile.
if (config.profile !== null) {
  app.setPath('userData', join(app.getPath('appData'), config.profile))
}

// The app belongs to no repository. Thus the daemon that it starts has no
// default repository. A packaged app has its own bundled daemon, with the layout
// of the workspace.
const daemon = new DaemonClient({
  port: config.daemon_port,
  repo_path: null,
  daemon_cli: app.isPackaged
    ? join(app.getAppPath(), 'packages', 'daemon', 'dist', 'cli.mjs')
    : undefined,
})

let window: BrowserWindow | null = null
let started = false
/** A review that a link asked for before a window existed to show it. */
let pending_review: string | null = null
/**
 * The notifications on the screen. The app keeps them, because Electron removes
 * a notification that nothing refers to. Such a notification does not tell of a
 * click.
 */
const notifications = new Set<Notification>()

const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url))

const openOutside = (url: string) => {
  const { protocol } = new URL(url)
  if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url)
}

const reviewUrl = (review_id: string): string =>
  new URL(`/reviews/${review_id}`, config.origin).href

/**
 * Loads a page through a one-time sign-in link. The link gives the window the
 * cookie of the person. Only that cookie can give a verdict as the person.
 */
const loadSignedIn = async (target: BrowserWindow, url: string): Promise<void> => {
  const signed = await daemon.signInUrl(url).catch(() => url)
  await target.loadURL(signed)
}

const createWindow = (url: string = config.start_url) => {
  const created = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'yart',
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Electron's option name
    webPreferences: { preload: PRELOAD },
  })

  // The window shows only yart. A link to a different site in a review opens in
  // the browser. It does not make this window a browser.
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

  void loadSignedIn(created, url)
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
  void loadSignedIn(window, reviewUrl(review_id))
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

const openLink = (link: string) => {
  const review_id = reviewIdFromLink(link)
  if (review_id !== null) showReview(review_id)
}

/** Only the page of yart can set the badge or show a notification. */
const fromYart = (event: IpcMainEvent): boolean => event.senderFrame?.origin === config.origin

ipcMain.on('unseen-changed', (event, value: unknown) => {
  const count = parseCount(value)
  if (!fromYart(event) || count === null) return
  app.setBadgeCount(count)
})

// The daemon makes a new secret when it starts again. Then the page asks for a
// new sign-in, and the window loads the same page through a new link.
// At most one time in some seconds. If a sign-in fails, the page asks again
// after the load, and the window must not load in a loop.
let last_sign_in = 0
const SIGN_IN_INTERVAL_MS = 5000
ipcMain.on('sign-in', (event) => {
  if (!fromYart(event) || window === null) return
  if (Date.now() - last_sign_in < SIGN_IN_INTERVAL_MS) return
  last_sign_in = Date.now()
  void loadSignedIn(window, event.senderFrame?.url ?? config.start_url)
})

ipcMain.on('notify', (event, value: unknown) => {
  const notice = parseNotice(value)
  if (!fromYart(event) || notice === null || !Notification.isSupported()) return
  const notification = new Notification({
    title: notice.title,
    body: 'The review waits on you. It is your turn.',
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

// Register this before all other things. On macOS, a link that starts the app
// comes before the app is ready.
app.on('open-url', (event, link) => {
  event.preventDefault()
  openLink(link)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Only an installed app claims the scheme. A development shell would take the
  // links for the installed app.
  if (config.profile === null) app.setAsDefaultProtocolClient(SCHEME)

  // macOS sends a link through open-url. Other platforms start a second copy, with
  // the link in its arguments.
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
