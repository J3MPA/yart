import type { FileDiff, Thread } from '@yart/core'

export interface FileSummary {
  added: number
  removed: number
  /** Threads still awaiting a resolution, including ones whose line is gone. */
  open_threads: number
  total_threads: number
}

/**
 * Whether a thread belongs to a file.
 *
 * Matched on where the thread points now, falling back to where it started:
 * once a line is gone the anchor is null, and the origin is the only record of
 * which file the conversation was about. This mirrors where the diff renders
 * them, so the sidebar's count and the file's contents cannot disagree.
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

/** Every file's summary, keyed by head path. */
export const summarizeFiles = (
  files: readonly FileDiff[],
  threads: readonly Thread[],
): Map<string, FileSummary> =>
  new Map(files.map((file) => [file.path, summarizeFile(file, threads)]))

/**
 * Several files' summaries added together, for a directory folded in the tree.
 *
 * A folded directory that dropped its counts would trade scrolling for
 * blindness: the row is still there, but nothing on it says whether what it
 * hides is two added lines or a thread waiting on an answer.
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
