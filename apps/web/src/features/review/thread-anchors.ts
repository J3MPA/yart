import type { DiffSide, Thread } from '@yart/core'

/**
 * Identifies the row that a thread shows under.
 *
 * A diff row has a line number on each side, and a thread is attached to one of
 * them. Thus the side must be part of the key. Line 4 of the base and line 4 of
 * the head are different places.
 */
export const anchorKey = (path: string, side: DiffSide, line: number): string =>
  `${side}\u0000${path}\u0000${line}`

/** The threads that still point to a line, grouped by their row. */
export const groupThreadsByAnchor = (threads: readonly Thread[]): Map<string, Thread[]> => {
  const grouped = new Map<string, Thread[]>()
  for (const thread of threads) {
    if (thread.anchor === null) continue
    const key = anchorKey(thread.anchor.path, thread.anchor.side, thread.anchor.line)
    const existing = grouped.get(key)
    if (existing === undefined) grouped.set(key, [thread])
    else existing.push(thread)
  }
  return grouped
}

/**
 * The threads whose line is gone.
 *
 * They have no place in the diff. Thus the file header shows them. To remove
 * them would delete the conversation with no warning.
 */
export const outdatedThreads = (threads: readonly Thread[]): Thread[] =>
  threads.filter((thread) => thread.anchor === null)

/** The outdated threads of one file, found by where each thread started. */
export const outdatedThreadsForPath = (threads: readonly Thread[], path: string): Thread[] =>
  outdatedThreads(threads).filter((thread) => thread.origin.path === path)

export const countOpen = (threads: readonly Thread[]): number =>
  threads.filter((thread) => thread.status === 'open').length
