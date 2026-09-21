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
