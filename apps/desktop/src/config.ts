export interface ShellConfig {
  /** The port of the daemon that the app uses. The app starts a daemon there if none answers. */
  daemon_port: number
  /** The page that the window opens on. */
  start_url: string
  /** The origin of the window. Links to other places open in the browser. */
  origin: string
  /**
   * The directory in the app data of the platform that holds the storage of the
   * shell, or null for the default of Electron.
   */
  profile: string | null
}

const DEFAULT_DAEMON_PORT = 7777

/**
 * A development shell gets its own profile. Electron holds its single-instance
 * lock for each profile. If the shell shared a profile with an installed yart,
 * the shell would give control to the installed app and quit. The profile also
 * keeps the seen state and the drafts of the two apps apart.
 */
const DEV_PROFILE = 'yart-dev'

export const readConfig = (env: NodeJS.ProcessEnv): ShellConfig => {
  const daemon_port =
    env.YART_DAEMON_PORT === undefined ? DEFAULT_DAEMON_PORT : Number(env.YART_DAEMON_PORT)
  if (!Number.isInteger(daemon_port) || daemon_port < 1 || daemon_port > 65535) {
    throw new Error(`Invalid YART_DAEMON_PORT: ${env.YART_DAEMON_PORT}`)
  }
  // The name of the web UI, as `uiUrl` of the daemon gives it. The cookie of the
  // person belongs to this name only, not to each web server on `127.0.0.1`.
  const start_url = env.YART_START_URL ?? `http://yart-${daemon_port}.localhost:${daemon_port}/`
  return {
    daemon_port,
    start_url,
    origin: new URL(start_url).origin,
    profile: env.YART_DEV === '1' ? DEV_PROFILE : null,
  }
}
