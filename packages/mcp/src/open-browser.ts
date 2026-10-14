import { spawn } from 'node:child_process'
import { DEFAULT_PORT } from './daemon-client.ts'

/**
 * Opens a URL in the default browser of the computer.
 *
 * The launcher is detached, and its output goes nowhere. On some platforms, the
 * launcher continues after this process stops. Its output would go into the
 * stdio channel that the MCP protocol uses.
 */
const LAUNCHERS: Record<string, { command: string; args: readonly string[] }> = {
  darwin: { command: 'open', args: [] },
  win32: { command: 'cmd', args: ['/c', 'start', ''] },
}

const LINUX_LAUNCHER = { command: 'xdg-open', args: [] as readonly string[] }

export type BrowserOpener = (url: string) => void

/**
 * The environment for a launcher. The `yart-mcp` of the desktop app runs on the
 * Electron of the app with `ELECTRON_RUN_AS_NODE`. If `open` gives that variable
 * to yart.app, the app starts as plain Node and stops with no window.
 */
export const launcherEnv = (
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> => {
  const clean = { ...env }
  delete clean.ELECTRON_RUN_AS_NODE
  return clean
}

export const openInBrowser: BrowserOpener = (url) => {
  const launcher = LAUNCHERS[process.platform] ?? LINUX_LAUNCHER
  try {
    const child = spawn(launcher.command, [...launcher.args, url], {
      detached: true,
      stdio: 'ignore',
      env: launcherEnv(),
    })
    // A computer with no browser, or with no launcher on PATH, must not make the
    // tool call fail. The URL is in the response in all cases.
    child.on('error', () => undefined)
    child.unref()
  } catch {
    // The same reason as above, for the synchronous errors of spawn.
  }
}

/** The link of the desktop app to a review, from the address of the review on the daemon. */
export const appLink = (url: string): string => `yart:/${new URL(url).pathname}`

/**
 * Opens a review in the desktop app when it is installed. Otherwise opens it in
 * the browser.
 *
 * This applies only to the daemon on the default port, which the installed app
 * uses. A link names a review, but not a daemon. Without this rule, a review of
 * a development daemon would open in the installed app, with different code.
 * It also applies only on macOS, as the app does. `open` fails when no app claims
 * the scheme. That failure tells if the app is installed.
 */
export const openReview = (url: string, port: number, fallback: BrowserOpener = openInBrowser) => {
  if (process.platform !== 'darwin' || port !== DEFAULT_PORT) {
    fallback(url)
    return
  }
  let fell_back = false
  const fallBack = () => {
    if (fell_back) return
    fell_back = true
    fallback(url)
  }
  try {
    const child = spawn('open', [appLink(url)], { stdio: 'ignore', env: launcherEnv() })
    child.on('error', fallBack)
    child.on('exit', (code) => {
      if (code !== 0) fallBack()
    })
  } catch {
    fallBack()
  }
}

/**
 * Tells if a new review must open a window.
 *
 * It is on by default. The person who looks is the one step of the loop that
 * needs a person. When an agent must give a URL to the person, that step does not
 * occur. `YART_NO_BROWSER` turns it off where a browser is not correct. For
 * example: a container, a remote shell, or a second screen.
 */
export const browserOpeningEnabled = (
  env: Record<string, string | undefined> = process.env,
): boolean => {
  const flag = env.YART_NO_BROWSER
  return flag === undefined || flag === '' || flag === '0' || flag.toLowerCase() === 'false'
}
