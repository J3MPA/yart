import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The daemon and its clients authenticate each other with a token.
 *
 * Loopback TCP does not check the user account of a peer. Thus each process on
 * this computer, of each user, can connect to the daemon. The daemon makes a
 * random token when it starts, and keeps it in a file that only the user can
 * read. Each `/api` request must send it. A client also uses it to make sure
 * that the process on the port is the daemon, and not a different process.
 */

/** The one address of the daemon. A name such as `localhost` can go to `::1` first. */
export const LOOPBACK = '127.0.0.1'

export const daemonUrl = (port: number): string => `http://${LOOPBACK}:${port}`

export const makeToken = (): string => randomBytes(32).toString('base64url')

/** The file of the token of the daemon on a port. Daemons on different ports can share a home. */
export const tokenPath = (state_dir: string, port: number): string =>
  join(state_dir, `daemon-${port}.token`)

/**
 * Writes the token, readable only by the user. It writes a temporary file
 * first, thus a client never reads half of a token.
 */
export const writeToken = async (state_dir: string, port: number, token: string) => {
  await mkdir(state_dir, { recursive: true, mode: 0o700 })
  const path = tokenPath(state_dir, port)
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${token}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

export class UnsafeFileError extends Error {}

/**
 * Refuses a file that a different user owns, or that a different user can
 * write. Such a file can come from a different user, not from yart.
 */
export const checkOwnFile = async (path: string, private_read = false): Promise<void> => {
  const info = await stat(path)
  const uid = process.getuid?.()
  if (uid !== undefined && info.uid !== uid) {
    throw new UnsafeFileError(`${path} belongs to a different user.`)
  }
  const forbidden = private_read ? 0o077 : 0o022
  if ((info.mode & forbidden) !== 0) {
    throw new UnsafeFileError(`Other users can ${private_read ? 'read' : 'write'} ${path}.`)
  }
}

/** The token of the daemon on a port, or null when there is no token file. */
export const readToken = async (state_dir: string, port: number): Promise<string | null> => {
  const path = tokenPath(state_dir, port)
  try {
    await checkOwnFile(path, true)
    const token = (await readFile(path, 'utf8')).trim()
    return token === '' ? null : token
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw cause
  }
}

/** Compares two secrets in a time that does not depend on where they differ. */
export const sameSecret = (given: string, expected: string): boolean => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The answer of the daemon to a challenge on `/health`. Only a process that
 * knows the token can make it. The client does not send the token for this.
 */
export const healthProof = (token: string, challenge: string): string =>
  createHmac('sha256', token).update(`yart-health:${challenge}`).digest('hex')

export const makeChallenge = (): string => randomBytes(16).toString('hex')
