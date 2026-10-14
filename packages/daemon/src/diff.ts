import { parseHunkHeader, splitLines } from '@yart/core'
import type { DiffHunk, FileDiff, ReviewFile } from '@yart/core'
import { runGit, readBlob } from './git.ts'

/** The lines of unchanged context that git adds on each side of a change. */
export const DEFAULT_CONTEXT_LINES = 3

/**
 * Reads the unified diff of git into hunks, with a line number on each side.
 *
 * Each line has the two numbers, because a comment is attached to one side. The
 * renderer must know the gutter of each row, and must not calculate offsets
 * again.
 */
export const parseUnifiedDiff = (diff_output: string): DiffHunk[] => {
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let base_line = 0
  let head_line = 0

  for (const raw of diff_output.split('\n')) {
    const range = parseHunkHeader(raw)
    if (range !== null) {
      current = { header: raw, lines: [] }
      hunks.push(current)
      base_line = range.base_start
      head_line = range.head_start
      continue
    }
    if (current === null) continue

    // "\ No newline at end of file" is a note about the line above. It is not a line.
    if (raw.startsWith('\\')) continue

    const marker = raw[0]
    const text = raw.slice(1)

    if (marker === ' ') {
      current.lines.push({ kind: 'context', base_line, head_line, text })
      base_line += 1
      head_line += 1
    } else if (marker === '-') {
      current.lines.push({ kind: 'removed', base_line, head_line: null, text })
      base_line += 1
    } else if (marker === '+') {
      current.lines.push({ kind: 'added', base_line: null, head_line, text })
      head_line += 1
    }
    // All other lines are header lines that git gives before the first hunk.
  }

  return hunks
}

/** All lines of a file that has no file on the other side. */
const wholeFileHunk = (content: string, kind: 'added' | 'removed'): DiffHunk[] => {
  const lines = splitLines(content)
  if (lines.length === 0) return []
  return [
    {
      header: kind === 'added' ? `@@ -0,0 +1,${lines.length} @@` : `@@ -1,${lines.length} +0,0 @@`,
      lines: lines.map((text, index) => ({
        kind,
        base_line: kind === 'removed' ? index + 1 : null,
        head_line: kind === 'added' ? index + 1 : null,
        text,
      })),
    },
  ]
}

export interface FileDiffOptions {
  context_lines?: number
}

/**
 * Makes the diff for one file of a review.
 *
 * For an added file or a deleted file, this function uses the one blob that
 * exists. `git diff` compares two blobs, and there is no second blob.
 */
export const buildFileDiff = async (
  repo_path: string,
  file: ReviewFile,
  options: FileDiffOptions = {},
): Promise<FileDiff> => {
  const { context_lines = DEFAULT_CONTEXT_LINES } = options

  if (file.base_blob_sha === null && file.head_blob_sha === null) {
    return { ...file, hunks: [], is_binary: false, head_line_count: null }
  }

  if (file.base_blob_sha === null) {
    const content = await readBlob(repo_path, file.head_blob_sha as string)
    return {
      ...file,
      hunks: wholeFileHunk(content, 'added'),
      is_binary: false,
      head_line_count: splitLines(content).length,
    }
  }

  if (file.head_blob_sha === null) {
    const content = await readBlob(repo_path, file.base_blob_sha)
    return {
      ...file,
      hunks: wholeFileHunk(content, 'removed'),
      is_binary: false,
      head_line_count: null,
    }
  }

  const output = await runGit(repo_path, [
    'diff',
    '--no-color',
    `--unified=${context_lines}`,
    file.base_blob_sha,
    file.head_blob_sha,
  ])

  if (/^Binary files .* differ$/m.test(output)) {
    return { ...file, hunks: [], is_binary: true, head_line_count: null }
  }

  // Read the file only after the diff, and only when it is text. A binary blob
  // would go into memory as a string, for a length that nothing can use. git
  // shows only what changed. Thus the length of the file is the one thing that
  // the diff cannot tell about the lines after the last hunk.
  const head_content = await readBlob(repo_path, file.head_blob_sha)

  return {
    ...file,
    hunks: parseUnifiedDiff(output),
    is_binary: false,
    head_line_count: splitLines(head_content).length,
  }
}

export const buildReviewDiff = async (
  repo_path: string,
  files: readonly ReviewFile[],
  options?: FileDiffOptions,
): Promise<FileDiff[]> => Promise.all(files.map((file) => buildFileDiff(repo_path, file, options)))
