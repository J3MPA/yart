import type { AnchorState, FileResolution, LineAnchor, Thread } from './types.ts'

/**
 * Calculates the anchor state from where a thread is now and where it started.
 * The state never adds up across rounds. Thus a line that moves away and back is
 * `current` again. An error in one round cannot cause errors in later rounds.
 */
export const deriveAnchorState = (origin: LineAnchor, anchor: LineAnchor | null): AnchorState => {
  if (anchor === null) return 'outdated'
  if (anchor.path === origin.path && anchor.line === origin.line) return 'current'
  return 'shifted'
}

const outdate = (thread: Thread): Thread => {
  return { ...thread, anchor: null, anchor_state: 'outdated' }
}

const moveTo = (thread: Thread, anchor: LineAnchor): Thread => {
  return { ...thread, anchor, anchor_state: deriveAnchorState(thread.origin, anchor) }
}

/**
 * Moves the anchor of a thread to a later revision of its file.
 *
 * This function only looks up lines. The caller gives the line map. Thus the
 * function does not depend on how the diff was made.
 *
 * An outdated thread stays outdated. When the line of a thread is already gone,
 * this function returns the thread with no change. It does not try to find a
 * new match, because each match would be a guess.
 */
export const reanchorThread = (thread: Thread, resolution: FileResolution): Thread => {
  const { anchor } = thread
  if (anchor === null) return thread

  if (resolution.kind === 'deleted') return outdate(thread)

  if (resolution.kind === 'unchanged') {
    return moveTo(thread, { ...anchor, path: resolution.path })
  }

  const line = resolution.line_map.get(anchor.line)
  if (line === undefined) return outdate(thread)

  return moveTo(thread, {
    path: resolution.path,
    blob_sha: resolution.blob_sha,
    line,
    side: anchor.side,
  })
}

/**
 * Attaches many threads again at the same time. The key is the blob of each
 * anchor.
 *
 * A thread whose blob is not in `resolutions` comes back with no change. The
 * caller decides what an unknown blob means. To make such threads outdated with
 * no warning would destroy comments, and the cause could be an error in the
 * lookup.
 */
export const reanchorThreads = (
  threads: readonly Thread[],
  resolutions: ReadonlyMap<string, FileResolution>,
): Thread[] => {
  return threads.map((thread) => {
    if (thread.anchor === null) return thread
    const resolution = resolutions.get(thread.anchor.blob_sha)
    return resolution === undefined ? thread : reanchorThread(thread, resolution)
  })
}
