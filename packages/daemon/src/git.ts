import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ChangeStatus, LineMap } from '@yart/core'

const execFileAsync = promisify(execFile)

/**
 * git shows a missing blob as all zeroes. This occurs on one side of an addition
 * or a deletion. The check looks at the shape, not at a fixed width. Thus it
 * works for each hash length that a repository uses.
 */
const NULL_BLOB = /^0+$/

/** The output can be large for a wide range. 64 MB is much more than any real diff. */
const MAX_BUFFER = 64 * 1024 * 1024

export type { ChangeStatus } from '@yart/core'

export interface ChangedFile {
  status: ChangeStatus
  /** The path in the head revision, or the old path when the file was deleted. */
  path: string
  /** Only for renames and copies. */
  old_path: string | null
  /** The blob in the base revision, or `null` when the file was added. */
  base_blob_sha: string | null
  /** The blob in the head revision, or `null` when the file was deleted. */
  head_blob_sha: string | null
}

export class GitError extends Error {
  readonly args: readonly string[]

  constructor(message: string, args: readonly string[]) {
    super(message)
    this.name = 'GitError'
    this.args = args
  }
}

export const runGit = async (repo_path: string, args: readonly string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd: repo_path,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Node's option name
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    })
    return stdout
  } catch (cause) {
    const stderr = (cause as { stderr?: string }).stderr?.trim()
    throw new GitError(stderr || `git ${args.join(' ')} failed`, args)
  }
}

/** The type of object that a revision names. */
export const objectType = async (repo_path: string, sha: string): Promise<string> =>
  (await runGit(repo_path, ['cat-file', '-t', sha])).trim()

/**
 * Finds the sha of the commit or the tree that a revision names.
 *
 * This function tries a commit first. Thus a branch or a tag gives the commit
 * that it points to, not a tag object. It also accepts a bare tree. `git diff`
 * compares trees correctly, and a snapshot of uncommitted work is a tree with
 * no commit.
 *
 * For a revision that it cannot find, git says "Needed a single revision". This
 * does not say which revision. Thus the message gets the name again, because
 * the caller can be an agent that must correct it.
 */
export const resolveRev = async (repo_path: string, rev: string): Promise<string> => {
  const as_commit = await runGit(repo_path, ['rev-parse', '--verify', `${rev}^{commit}`]).catch(
    () => null,
  )
  if (as_commit !== null) return as_commit.trim()

  const as_object = await runGit(repo_path, ['rev-parse', '--verify', rev]).catch(() => null)
  if (as_object === null) {
    throw new GitError(`Cannot resolve revision "${rev}"`, ['rev-parse', rev])
  }

  const sha = as_object.trim()
  const type = await objectType(repo_path, sha)
  if (type !== 'tree') {
    throw new GitError(`Revision "${rev}" is a ${type}; a review needs a commit or a tree`, [
      'rev-parse',
      rev,
    ])
  }
  return sha
}

/** Tells if anything is different from HEAD, also files that git does not track. */
export const isWorkingTreeDirty = async (repo_path: string): Promise<boolean> =>
  (await runGit(repo_path, ['status', '--porcelain'])).trim() !== ''

/**
 * Writes the working tree into a tree object, and returns its hash. This
 * includes uncommitted edits and untracked files.
 *
 * It uses a temporary index. Thus the staging area of the caller does not
 * change. Without it, `git add` would stage all files for the caller.
 *
 * The content goes into the object store of git. Thus each blob has a real
 * hash, and a comment is attached to that hash. A snapshot also never changes.
 * Thus comments stay in place while the files under them change.
 */
export const snapshotWorkingTree = async (repo_path: string): Promise<string> => {
  const index_path = join(await mkdtemp(join(tmpdir(), 'yart-index-')), 'index')
  try {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- git's variable name
    const env = { ...process.env, GIT_INDEX_FILE: index_path }
    await execFileAsync('git', ['read-tree', 'HEAD'], { cwd: repo_path, env, encoding: 'utf8' })
    await execFileAsync('git', ['add', '-A'], { cwd: repo_path, env, encoding: 'utf8' })
    const { stdout } = await execFileAsync('git', ['write-tree'], {
      cwd: repo_path,
      env,
      encoding: 'utf8',
    })
    return stdout.trim()
  } finally {
    await rm(dirname(index_path), { recursive: true, force: true })
  }
}

/** The namespace of the refs that keep the snapshots of a review from garbage collection. */
const reviewRef = (review_id: string) => `refs/yart/reviews/${review_id}`

/**
 * Keeps a snapshot reachable.
 *
 * No ref points to a tree from `write-tree`. Thus garbage collection can remove
 * it and its blobs. Then comments would point to hashes that do not exist. A
 * ref keeps the tree until the review is deleted.
 */
export const pinSnapshot = async (
  repo_path: string,
  review_id: string,
  tree_sha: string,
): Promise<void> => {
  await runGit(repo_path, ['update-ref', reviewRef(review_id), tree_sha])
}

export const unpinSnapshot = async (repo_path: string, review_id: string): Promise<void> => {
  try {
    await runGit(repo_path, ['update-ref', '-d', reviewRef(review_id)])
  } catch {
    // The ref is already gone. That is the state that we want.
  }
}

/**
 * The full path to the shared git directory of the repository.
 *
 * In a linked worktree, `.git` is a file that points to a different place. A
 * path under it fails. This function gives the same directory from each
 * worktree of a repository. Thus the reviews are one list, not one list for
 * each worktree.
 *
 * The result is relative to `repo_path`, because git gives a relative path from
 * the main worktree and a full path from a linked worktree. The function also
 * makes the path canonical. Thus different paths to the same repository give
 * the same text. Examples are a symlink, such as /var on macOS, or a worktree.
 */
export const findGitCommonDir = async (repo_path: string): Promise<string> => {
  const out = await runGit(repo_path, ['rev-parse', '--git-common-dir'])
  return realpath(resolve(repo_path, out.trim()))
}

/** The full path to the root of the repository that contains `cwd`. */
export const findRepoRoot = async (cwd: string): Promise<string> => {
  const out = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  return out.trim()
}

const toStatus = (code: string): ChangeStatus => {
  switch (code[0]) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    default:
      return 'modified'
  }
}

const blobOrNull = (sha: string): string | null => {
  return NULL_BLOB.test(sha) ? null : sha
}

/**
 * Lists what changed between two revisions, with the blob on each side.
 *
 * It uses `--raw -z`, because that gives the blob hashes directly. To find them
 * from the paths later would need one process for each file. It would also lose
 * the identity of a file that moved.
 */
export const listChangedFiles = async (
  repo_path: string,
  base: string,
  head: string,
): Promise<ChangedFile[]> => {
  const out = await runGit(repo_path, [
    'diff',
    '--raw',
    '-z',
    // By default, `--raw` makes hashes seven characters long. That is not
    // sufficient to identify a blob reliably.
    '--abbrev=40',
    '--find-renames',
    '--no-color',
    base,
    head,
  ])

  const fields = out.split('\0')
  const files: ChangedFile[] = []

  let index = 0
  while (index < fields.length) {
    const meta = fields[index]
    if (meta === undefined || !meta.startsWith(':')) {
      index += 1
      continue
    }

    // ":<old_mode> <new_mode> <old_sha> <new_sha> <status>"
    const parts = meta.slice(1).split(' ')
    const old_sha = parts[2]
    const new_sha = parts[3]
    const code = parts[4]
    if (old_sha === undefined || new_sha === undefined || code === undefined) {
      index += 1
      continue
    }

    const status = toStatus(code)
    const moved = status === 'renamed' || status === 'copied'
    const first_path = fields[index + 1]
    const second_path = moved ? fields[index + 2] : undefined

    if (first_path === undefined || (moved && second_path === undefined)) break

    files.push({
      status,
      path: moved ? (second_path as string) : first_path,
      old_path: moved ? first_path : null,
      base_blob_sha: blobOrNull(old_sha),
      head_blob_sha: blobOrNull(new_sha),
    })

    index += moved ? 3 : 2
  }

  return files
}

/** The subject line of a commit, or null when the revision is not a commit. */
export const commitSubject = async (repo_path: string, rev: string): Promise<string | null> => {
  try {
    const out = await runGit(repo_path, ['log', '-1', '--format=%s', rev])
    const subject = out.trim()
    return subject === '' ? null : subject
  } catch {
    return null
  }
}

/** The branch whose tip is this revision, if exactly one branch is. */
export const branchAt = async (repo_path: string, rev: string): Promise<string | null> => {
  try {
    const out = await runGit(repo_path, ['branch', '--points-at', rev, '--format=%(refname:short)'])
    const names = out
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => name !== '')
    return names.length === 1 ? (names[0] as string) : null
  } catch {
    return null
  }
}

/** Reads the content of a blob by its hash. */
export const readBlob = async (repo_path: string, blob_sha: string): Promise<string> => {
  return runGit(repo_path, ['cat-file', 'blob', blob_sha])
}

/** Counts lines as `splitLines` does. A newline at the end closes the last line. */
const countLines = (content: string): number => {
  if (content === '') return 0
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content
  return trimmed.split('\n').length
}

interface Hunk {
  old_start: number
  old_count: number
  new_start: number
  new_count: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export const parseHunkHeaders = (diff_output: string): Hunk[] => {
  const hunks: Hunk[] = []
  for (const raw_line of diff_output.split('\n')) {
    const match = HUNK_HEADER.exec(raw_line)
    if (match === null) continue
    hunks.push({
      old_start: Number(match[1]),
      old_count: match[2] === undefined ? 1 : Number(match[2]),
      new_start: Number(match[3]),
      new_count: match[4] === undefined ? 1 : Number(match[4]),
    })
  }
  return hunks
}

/**
 * Makes a line map from hunk headers.
 *
 * Only the headers are necessary. A line outside a hunk did not change, and maps
 * across with an offset. A line inside a hunk changed, and maps to no line. For
 * this reason, the request asks for the diff with no context.
 *
 * A count of zero marks an addition only, or a deletion only. The start then
 * names the line *before* the change, not the first line of the change. That
 * line did not change, thus it must map across.
 */
export const lineMapFromHunks = (hunks: readonly Hunk[], old_total: number): LineMap => {
  const map = new Map<number, number>()
  let old_line = 1
  let new_line = 1

  for (const hunk of hunks) {
    const unchanged_until = hunk.old_count === 0 ? hunk.old_start : hunk.old_start - 1
    while (old_line <= unchanged_until) {
      map.set(old_line, new_line)
      old_line += 1
      new_line += 1
    }
    old_line = hunk.old_count === 0 ? hunk.old_start + 1 : hunk.old_start + hunk.old_count
    new_line = hunk.new_count === 0 ? hunk.new_start + 1 : hunk.new_start + hunk.new_count
  }

  while (old_line <= old_total) {
    map.set(old_line, new_line)
    old_line += 1
    new_line += 1
  }

  return map
}

export interface GitLineMapOptions {
  /** The same default as the text diff: a new indent must not make all threads outdated. */
  ignore_whitespace?: boolean
}

/**
 * Makes a line map between two blobs with git itself.
 *
 * This is better than a text diff in the process. git is faster. Also, the tool
 * that made the shas compares them. Thus two different implementations cannot
 * disagree about what changed.
 */
export const buildLineMapFromGit = async (
  repo_path: string,
  base_blob_sha: string,
  head_blob_sha: string,
  options: GitLineMapOptions = {},
): Promise<LineMap> => {
  const { ignore_whitespace = true } = options

  const args = ['diff', '--no-color', '--unified=0']
  if (ignore_whitespace) args.push('--ignore-all-space')
  args.push(base_blob_sha, head_blob_sha)

  const [diff_output, base_content] = await Promise.all([
    runGit(repo_path, args),
    readBlob(repo_path, base_blob_sha),
  ])

  return lineMapFromHunks(parseHunkHeaders(diff_output), countLines(base_content))
}
