import { spawn } from 'node:child_process'

/**
 * Opens a URL in whatever the machine treats as its browser.
 *
 * Detached and with its streams ignored, because the launcher outlives this
 * process on some platforms and anything it prints would land in the stdio
 * channel the MCP protocol is speaking over.
 */
const LAUNCHERS: Record<string, { command: string; args: readonly string[] }> = {
  darwin: { command: 'open', args: [] },
  win32: { command: 'cmd', args: ['/c', 'start', ''] },
}

const LINUX_LAUNCHER = { command: 'xdg-open', args: [] as readonly string[] }

export type BrowserOpener = (url: string) => void

export const openInBrowser: BrowserOpener = (url) => {
  const launcher = LAUNCHERS[process.platform] ?? LINUX_LAUNCHER
  try {
    const child = spawn(launcher.command, [...launcher.args, url], {
      detached: true,
      stdio: 'ignore',
    })
    // A machine with no browser, or no launcher on PATH, must not take the
    // tool call down with it: the URL is in the response either way.
    child.on('error', () => undefined)
    child.unref()
  } catch {
    // Same reasoning as above, for the synchronous failures spawn can throw.
  }
}

/**
 * Whether a new review should open a window.
 *
 * On by default: a review nobody opens is the one step of the loop that needs a
 * person, and asking an agent to relay a URL is how that step gets skipped.
 * `YART_NO_BROWSER` turns it off for anyone running yart somewhere a browser
 * would be wrong — a container, a remote shell, a second screen they did not
 * ask to be taken over.
 */
export const browserOpeningEnabled = (
  env: Record<string, string | undefined> = process.env,
): boolean => {
  const flag = env.YART_NO_BROWSER
  return flag === undefined || flag === '' || flag === '0' || flag.toLowerCase() === 'false'
}
