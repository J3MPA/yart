import { readFileSync } from 'node:fs'

/**
 * The version of yart, from the `package.json` next to the code. In the app,
 * that file has the version of the release. The value is read one time at the
 * start, because a process that runs does not change its version.
 *
 * It is "unknown" when the file is missing, because a version is not a reason
 * to stop.
 */
export const VERSION = ((): string => {
  try {
    const parsed = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      version?: unknown
    }
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
})()
