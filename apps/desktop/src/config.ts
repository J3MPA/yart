export interface ShellConfig {
  /** The port of the daemon the app uses, starting one there if none answers. */
  daemon_port: number
  /** The page the window opens on. */
  start_url: string
  /** The origin the window stays on; links anywhere else open in the browser. */
  origin: string
  /**
   * The directory under the platform's app data that holds the shell's own
   * storage, or null to keep Electron's default.
   */
  profile: string | null
}

const DEFAULT_DAEMON_PORT = 7777

/**
 * A development shell gets a profile of its own. Electron's single-instance
 * lock is held per profile, so sharing one with an installed yart would make
 * the development shell hand itself over to the installed app and quit. It
 * also keeps the two apps' seen state and drafts apart.
 */
const DEV_PROFILE = 'yart-dev'

export const readConfig = (env: NodeJS.ProcessEnv): ShellConfig => {
  const daemon_port =
    env.YART_DAEMON_PORT === undefined ? DEFAULT_DAEMON_PORT : Number(env.YART_DAEMON_PORT)
  if (!Number.isInteger(daemon_port) || daemon_port < 1 || daemon_port > 65535) {
    throw new Error(`Invalid YART_DAEMON_PORT: ${env.YART_DAEMON_PORT}`)
  }
  const start_url = env.YART_START_URL ?? `http://localhost:${daemon_port}/`
  return {
    daemon_port,
    start_url,
    origin: new URL(start_url).origin,
    profile: env.YART_DEV === '1' ? DEV_PROFILE : null,
  }
}
