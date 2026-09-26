export interface ShellConfig {
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

const DEFAULT_START_URL = 'http://localhost:7777/'

/**
 * A development shell gets a profile of its own. Electron's single-instance
 * lock is held per profile, so sharing one with an installed yart would make
 * the development shell hand itself over to the installed app and quit. It
 * also keeps the two apps' seen state and drafts apart.
 */
const DEV_PROFILE = 'yart-dev'

export const readConfig = (env: NodeJS.ProcessEnv): ShellConfig => {
  const start_url = env.YART_START_URL ?? DEFAULT_START_URL
  return {
    start_url,
    origin: new URL(start_url).origin,
    profile: env.YART_DEV === '1' ? DEV_PROFILE : null,
  }
}
