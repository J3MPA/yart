import type { FileDiff, Thread } from '@yart/core'

export interface FileSummary {
  added: number
  removed: number
  /** The threads that still wait for a resolution, also threads whose line is gone. */
  open_threads: number
  total_threads: number
}

/**
 * Tells if a thread belongs to a file.
 *
 * The check uses where the thread points now, or else where it started. When a
 * line is gone, the anchor is null, and the origin is the only record of the
 * file of the conversation. The diff shows threads in the same way. Thus the
 * count of the sidebar and the content of the file cannot disagree.
 */
export const threadIsOn = (thread: Thread, path: string): boolean =>
  thread.anchor === null ? thread.origin.path === path : thread.anchor.path === path

export const summarizeFile = (file: FileDiff, threads: readonly Thread[]): FileSummary => {
  let added = 0
  let removed = 0
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'added') added += 1
      else if (line.kind === 'removed') removed += 1
    }
  }

  const on_file = threads.filter((thread) => threadIsOn(thread, file.path))

  return {
    added,
    removed,
    open_threads: on_file.filter((thread) => thread.status === 'open').length,
    total_threads: on_file.length,
  }
}

/** The summary of each file. The key is the head path. */
export const summarizeFiles = (
  files: readonly FileDiff[],
  threads: readonly Thread[],
): Map<string, FileSummary> =>
  new Map(files.map((file) => [file.path, summarizeFile(file, threads)]))

/**
 * The summaries of many files added together, for a folded directory in the
 * tree.
 *
 * Without its counts, a folded directory would give less scroll but no
 * information. The row is still there, but nothing on it tells if it hides two
 * added lines or a thread that waits for an answer.
 */
export const sumSummaries = (summaries: Iterable<FileSummary>): FileSummary => {
  const total: FileSummary = { added: 0, removed: 0, open_threads: 0, total_threads: 0 }
  for (const summary of summaries) {
    total.added += summary.added
    total.removed += summary.removed
    total.open_threads += summary.open_threads
    total.total_threads += summary.total_threads
  }
  return total
}
