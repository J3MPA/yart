import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  latestSubmission,
  reviewerRounds,
  submissionAuthor,
  type Review,
  type ReviewSubmission,
  type Settings,
} from '@yart/core'
import { findGitCommonDir, runGit } from './git.ts'

/** The line that marks a pre-commit hook as the hook of yart. */
export const HOOK_MARKER = '# yart pre-commit hook'

/**
 * The hook that `yart hook install` writes. It calls `yart` from PATH. If yart
 * is not there, the hook stops the commit, because the person asked for each
 * commit to get a review.
 */
export const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}: an AI reviewer reviews the staged changes before each commit.
# Remove it with: yart hook uninstall. Skip it one time with: git commit --no-verify
if ! command -v yart >/dev/null 2>&1; then
  echo "yart: the yart command is not on PATH, thus the commit stops. Use git commit --no-verify to skip the review." >&2
  exit 1
fi
exec yart hook pre-commit
`

/** How long the hook waits for a verdict before it stops the commit. */
export const DEFAULT_HOOK_TIMEOUT_MS = 10 * 60 * 1000

/** The tree of an empty repository, which git knows without a write. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export class HookError extends Error {}

const exists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

/** The path of the pre-commit hook. It obeys `core.hooksPath`. */
export const hookPath = async (repo_path: string): Promise<string> => {
  const path = (await runGit(repo_path, ['rev-parse', '--git-path', 'hooks/pre-commit'])).trim()
  return isAbsolute(path) ? path : join(repo_path, path)
}

/**
 * Writes the pre-commit hook. It refuses to replace a hook that yart did not
 * write, because that hook is the work of a person or of a different tool.
 */
export const installHook = async (repo_path: string): Promise<string> => {
  const path = await hookPath(repo_path)
  if (await exists(path)) {
    const current = await readFile(path, 'utf8')
    if (!current.includes(HOOK_MARKER)) {
      throw new HookError(
        `${path} already exists, and yart did not write it. yart does not replace it. ` +
          'Add "yart hook pre-commit" to that hook, or remove the hook and run this again.',
      )
    }
  }
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, HOOK_SCRIPT, 'utf8')
  await chmod(path, 0o755)
  return path
}

/** Removes the pre-commit hook, but only if yart wrote it. Returns true if it removed it. */
export const uninstallHook = async (repo_path: string): Promise<boolean> => {
  const path = await hookPath(repo_path)
  if (!(await exists(path))) return false
  if (!(await readFile(path, 'utf8')).includes(HOOK_MARKER)) return false
  await unlink(path)
  return true
}

/** The review of each branch that the hook opened, so that the next commit moves it. */
interface HookState {
  branches: Record<string, string>
}

const statePath = async (repo_path: string): Promise<string> =>
  join(await findGitCommonDir(repo_path), 'yart', 'hook.json')

const readState = async (repo_path: string): Promise<HookState> => {
  try {
    const parsed = JSON.parse(await readFile(await statePath(repo_path), 'utf8')) as HookState
    return { branches: typeof parsed.branches === 'object' ? parsed.branches : {} }
  } catch {
    return { branches: {} }
  }
}

const writeState = async (repo_path: string, state: HookState): Promise<void> => {
  const path = await statePath(repo_path)
  await mkdir(join(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export interface PreCommitOptions {
  repo_path: string
  /** The port of the daemon. */
  port: number
  timeout_ms?: number
  poll_ms?: number
  /** Where the hook writes its messages. Git shows the output of a hook to the person. */
  write: (line: string) => void
  /** Starts a daemon when none answers. Tests leave it out, and start their own. */
  startDaemon?: () => void
}

const git = async (repo_path: string, args: readonly string[]): Promise<string> =>
  (await runGit(repo_path, args)).trim()

/** HEAD as a commit sha, or the empty tree before the first commit. */
const headOrEmpty = async (repo_path: string): Promise<string> => {
  try {
    return await git(repo_path, ['rev-parse', '--verify', 'HEAD'])
  } catch {
    return EMPTY_TREE
  }
}

/** The verdict of a reviewer on the current head of the review, after `since` verdicts. */
const verdictOnHead = (review: Review, since: number): ReviewSubmission | null => {
  const verdict = latestSubmission(review)
  if (verdict === null || review.submissions.length <= since) return null
  if (submissionAuthor(verdict) !== 'reviewer' || verdict.head_sha !== review.head_sha) return null
  return verdict
}

/**
 * Reviews the staged changes before a commit, and tells git if the commit can
 * continue. Returns the exit code of the hook: 0 lets the commit continue, 1
 * stops it.
 *
 * The staged changes become a tree with `git write-tree`. The daemon reviews
 * that tree against HEAD. When a commit stopped before on this branch, and HEAD
 * did not move, the hook moves that review to the new tree. Thus the comments
 * of the reviewer follow the fixes. The hook then runs the reviewer command and
 * waits for a verdict on exactly this tree.
 */
export const preCommit = async (options: PreCommitOptions): Promise<number> => {
  const {
    repo_path,
    port,
    timeout_ms = DEFAULT_HOOK_TIMEOUT_MS,
    poll_ms = 1000,
    write,
    startDaemon,
  } = options
  const base_url = `http://localhost:${port}`
  const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${base_url}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json' },
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new HookError(body?.error ?? `${path} failed with ${response.status}`)
    }
    return (await response.json()) as T
  }

  let settings: Settings
  try {
    settings = await api<Settings>('/api/settings')
  } catch {
    if (startDaemon === undefined) throw new HookError(`No yart daemon answers on ${base_url}.`)
    startDaemon()
    settings = await (async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await delay(200)
        try {
          return await api<Settings>('/api/settings')
        } catch {
          // The daemon does not answer yet.
        }
      }
      throw new HookError(`The yart daemon did not start on ${base_url}.`)
    })()
  }

  const command = settings.reviewer_command
  if (command === null) return 0

  const head = await headOrEmpty(repo_path)
  const tree = await git(repo_path, ['write-tree'])
  const head_tree =
    head === EMPTY_TREE ? EMPTY_TREE : await git(repo_path, ['rev-parse', `${head}^{tree}`])
  if (tree === head_tree) return 0

  const branch = await git(repo_path, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'HEAD')
  const state = await readState(repo_path)
  const remembered = state.branches[branch]

  let review: Review | null = null
  if (remembered !== undefined) {
    const found = await api<Review>(`/api/reviews/${remembered}`).catch(() => null)
    if (found !== null && found.base_sha === head && found.archived_at === null) {
      review =
        found.head_sha === tree
          ? found
          : await api<Review>(`/api/reviews/${found.id}/advance`, {
              method: 'POST',
              body: JSON.stringify({ head: tree }),
            })
    }
  }
  review ??= await api<Review>('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({
      base: head,
      head: tree,
      repo_path,
      title: `Staged changes on ${branch}`,
    }),
  })
  state.branches[branch] = review.id
  await writeState(repo_path, state)

  const url = `${base_url}/reviews/${review.id}`
  const outcome = (verdict: ReviewSubmission, current: Review): number => {
    const name = verdict.author_name ?? 'the reviewer'
    if (verdict.verdict !== 'changes_requested') {
      write(`yart: ${name} approved the staged changes. The commit continues.`)
      return 0
    }
    write(`yart: ${name} requested changes, thus the commit stops.`)
    if (verdict.body !== null) write(`  ${verdict.body}`)
    for (const thread of current.threads.filter((candidate) => candidate.status === 'open')) {
      const anchor = thread.anchor ?? thread.origin
      const last = thread.comments[thread.comments.length - 1]
      write(`  ${anchor.path}:${anchor.line}  ${last?.body ?? ''}`)
    }
    write(`  ${url}`)
    if (reviewerRounds(current) >= settings.ai_review_rounds) {
      write('The reviewer has no more rounds. The review is yours to complete.')
    } else {
      write('Make the fixes, stage them and commit again. The next commit moves this review.')
    }
    return 1
  }

  const existing = verdictOnHead(review, 0)
  if (existing !== null) return outcome(existing, review)

  if (reviewerRounds(review) >= settings.ai_review_rounds) {
    write(`yart: the reviewer has no more rounds on this review, thus the commit stops.`)
    write(`The review is yours to complete: ${url}`)
    return 1
  }

  write(`yart: an AI reviewer reviews the staged changes (${url}).`)
  const since = review.submissions.length
  /* eslint-disable @typescript-eslint/naming-convention -- environment variable names */
  const env = {
    ...process.env,
    YART_REVIEW_ID: review.id,
    YART_REVIEW_URL: url,
    YART_REPO: repo_path,
    YART_REVIEWER_MODEL: settings.reviewer_model ?? '',
    YART_REVIEWER_EFFORT: settings.reviewer_effort ?? '',
    YART_REVIEWER_INSTRUCTIONS: settings.reviewer_instructions ?? '',
  }
  /* eslint-enable @typescript-eslint/naming-convention */
  const child: ChildProcess = spawn('/bin/sh', ['-c', command], {
    cwd: repo_path,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => write(chunk.toString().trimEnd()))
  child.stderr?.on('data', (chunk: Buffer) => write(chunk.toString().trimEnd()))
  // An object, because the callback sets the value, and the type checker does
  // not see that change in a plain variable.
  const command_state: { exit_code: number | null } = { exit_code: null }
  child.on('exit', (code) => {
    command_state.exit_code = code ?? 1
  })

  const deadline = Date.now() + timeout_ms
  try {
    while (Date.now() < deadline) {
      const current = await api<Review>(`/api/reviews/${review.id}`)
      const verdict = verdictOnHead(current, since)
      if (verdict !== null) return outcome(verdict, current)
      const { exit_code } = command_state
      if (exit_code !== null && exit_code !== 0) {
        write(
          `yart: the reviewer command failed with exit code ${exit_code}, thus the commit stops.`,
        )
        return 1
      }
      await delay(poll_ms)
    }
    write(
      `yart: no verdict came in ${Math.round(timeout_ms / 60000)} minutes, thus the commit stops. ` +
        'Use git commit --no-verify to skip the review.',
    )
    return 1
  } finally {
    if (command_state.exit_code === null) child.kill('SIGTERM')
  }
}
