import { setTimeout as delay } from 'node:timers/promises'
import { daemonUrl, healthProof, makeChallenge, readToken, sameSecret } from './auth.ts'

const TOKEN_RETRIES = 5
const TOKEN_RETRY_MS = 100

export interface DaemonHealth {
  repo_path: string | null
  version?: string
  code_dir?: string
}

/**
 * What answers on the port of the daemon.
 *
 * - `none`: no process answers.
 * - `foreign`: a process answers, but it cannot prove that it knows the token.
 *   It can be a yart daemon from before the token, or a different program.
 * - `yart`: the daemon that wrote the token file answers.
 */
export type Probe =
  { state: 'none' } | { state: 'foreign' } | { state: 'yart'; health: DaemonHealth; token: string }

/**
 * Finds out what answers on a port. The client sends a random challenge, and
 * the daemon answers with a proof that only the holder of the token can make.
 * The client does not send the token to a process before that process proves
 * that it is the daemon.
 */
export const probeDaemon = async (port: number, state_dir: string): Promise<Probe> => {
  const challenge = makeChallenge()
  let response: Response
  try {
    response = await fetch(`${daemonUrl(port)}/health?challenge=${challenge}`)
  } catch {
    return { state: 'none' }
  }
  const body = (await response.json().catch(() => null)) as
    (DaemonHealth & { proof?: unknown }) | null
  if (!response.ok || body === null || typeof body.proof !== 'string') return { state: 'foreign' }
  const proof = body.proof
  const proven = async (): Promise<string | null> => {
    const token = await readToken(state_dir, port)
    return token !== null && sameSecret(proof, healthProof(token, challenge)) ? token : null
  }
  // A new daemon writes its token file just after it starts to listen. Thus a
  // client that comes in that short time reads the old file, or no file.
  let token = await proven()
  for (let attempt = 0; token === null && attempt < TOKEN_RETRIES; attempt += 1) {
    await delay(TOKEN_RETRY_MS)
    token = await proven()
  }
  if (token === null) return { state: 'foreign' }
  return {
    state: 'yart',
    health: { repo_path: body.repo_path, version: body.version, code_dir: body.code_dir },
    token,
  }
}

/** The text for a process on the port that is not the daemon of this yart. */
export const foreignMessage = (port: number): string =>
  `A process answers on port ${port}, but it cannot prove that it is the yart daemon. ` +
  'It can be a yart daemon from an older version, or a different program. ' +
  `Stop it with: lsof -ti tcp:${port} | xargs kill`

export const authHeaders = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
})
