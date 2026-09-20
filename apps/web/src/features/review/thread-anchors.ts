import type { DiffSide, Thread } from '@yart/core'

/**
 * Identifies the row a thread hangs under.
 *
 * A diff row carries a line number on each side, and a thread anchors to one of
 * them, so the side has to be part of the key: line 4 of the base and line 4 of
 * the head are different places.
 */
export const anchorKey = (path: string, side: DiffSide, line: number): string =>
  `${side}\u0000${path}\u0000${line}`

/** Threads that still resolve to a line, grouped by the row they belong under. */
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
 * Threads whose line is gone.
 *
 * They have nowhere to sit in the diff, so the file header lists them instead —
 * dropping them would silently discard the conversation.
 */
export const outdatedThreads = (threads: readonly Thread[]): Thread[] =>
  threads.filter((thread) => thread.anchor === null)

/** Outdated threads for one file, matched on where the thread started. */
export const outdatedThreadsForPath = (threads: readonly Thread[], path: string): Thread[] =>
  outdatedThreads(threads).filter((thread) => thread.origin.path === path)

export const countOpen = (threads: readonly Thread[]): number =>
  threads.filter((thread) => thread.status === 'open').length
