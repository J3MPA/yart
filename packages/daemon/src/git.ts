import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LineMap } from '@yart/core';

const execFileAsync = promisify(execFile);

/**
 * Git reports an absent blob — one side of an add or delete — as all zeroes.
 * Matched by shape rather than by a fixed width so the check holds whatever
 * hash length the repository uses.
 */
const NULL_BLOB = /^0+$/;

/** Output can be large for a wide range; 64 MB is well past any real diff. */
const MAX_BUFFER = 64 * 1024 * 1024;

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface ChangedFile {
  status: ChangeStatus;
  /** Path in the head revision, or the deleted path when the file is gone. */
  path: string;
  /** Present only for renames and copies. */
  old_path: string | null;
  /** Blob in the base revision; `null` when the file was added. */
  base_blob_sha: string | null;
  /** Blob in the head revision; `null` when the file was deleted. */
  head_blob_sha: string | null;
}

export class GitError extends Error {
  readonly args: readonly string[];

  constructor(message: string, args: readonly string[]) {
    super(message);
    this.name = 'GitError';
    this.args = args;
  }
}

export const runGit = async (repo_path: string, args: readonly string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd: repo_path,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Node's option name
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    });
    return stdout;
  } catch (cause) {
    const stderr = (cause as { stderr?: string }).stderr?.trim();
    throw new GitError(stderr || `git ${args.join(' ')} failed`, args);
  }
};

/** Resolves a revision to its full commit sha. */
export const resolveRev = async (repo_path: string, rev: string): Promise<string> => {
  const out = await runGit(repo_path, ['rev-parse', '--verify', `${rev}^{commit}`]);
  return out.trim();
};

/** Absolute path to the repository root containing `cwd`. */
export const findRepoRoot = async (cwd: string): Promise<string> => {
  const out = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  return out.trim();
};

const toStatus = (code: string): ChangeStatus => {
  switch (code[0]) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'modified';
  }
};

const blobOrNull = (sha: string): string | null => {
  return NULL_BLOB.test(sha) ? null : sha;
};

/**
 * Lists what changed between two revisions, with the blob on each side.
 *
 * Uses `--raw -z` because it reports blob hashes directly: resolving them from
 * paths afterwards would be one process per file and would lose the identity of
 * a file that moved.
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
    // `--raw` abbreviates hashes to seven characters by default, which is not
    // enough to address a blob reliably.
    '--abbrev=40',
    '--find-renames',
    '--no-color',
    base,
    head,
  ]);

  const fields = out.split('\0');
  const files: ChangedFile[] = [];

  let index = 0;
  while (index < fields.length) {
    const meta = fields[index];
    if (meta === undefined || !meta.startsWith(':')) {
      index += 1;
      continue;
    }

    // ":<old_mode> <new_mode> <old_sha> <new_sha> <status>"
    const parts = meta.slice(1).split(' ');
    const old_sha = parts[2];
    const new_sha = parts[3];
    const code = parts[4];
    if (old_sha === undefined || new_sha === undefined || code === undefined) {
      index += 1;
      continue;
    }

    const status = toStatus(code);
    const moved = status === 'renamed' || status === 'copied';
    const first_path = fields[index + 1];
    const second_path = moved ? fields[index + 2] : undefined;

    if (first_path === undefined || (moved && second_path === undefined)) break;

    files.push({
      status,
      path: moved ? (second_path as string) : first_path,
      old_path: moved ? first_path : null,
      base_blob_sha: blobOrNull(old_sha),
      head_blob_sha: blobOrNull(new_sha),
    });

    index += moved ? 3 : 2;
  }

  return files;
};

/** Reads a blob's contents by hash. */
export const readBlob = async (repo_path: string, blob_sha: string): Promise<string> => {
  return runGit(repo_path, ['cat-file', 'blob', blob_sha]);
};

/** Counts lines the way `splitLines` does, treating a trailing newline as a terminator. */
const countLines = (content: string): number => {
  if (content === '') return 0;
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return trimmed.split('\n').length;
};

interface Hunk {
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export const parseHunkHeaders = (diff_output: string): Hunk[] => {
  const hunks: Hunk[] = [];
  for (const raw_line of diff_output.split('\n')) {
    const match = HUNK_HEADER.exec(raw_line);
    if (match === null) continue;
    hunks.push({
      old_start: Number(match[1]),
      old_count: match[2] === undefined ? 1 : Number(match[2]),
      new_start: Number(match[3]),
      new_count: match[4] === undefined ? 1 : Number(match[4]),
    });
  }
  return hunks;
};

/**
 * Turns hunk headers into a line map.
 *
 * Only the headers are needed: everything outside a hunk is unchanged and maps
 * across with a running offset, and everything inside one is replaced and maps
 * nowhere. That is why the diff is requested with zero context.
 *
 * A count of zero marks a pure insertion or deletion, where the start names the
 * line the change sits *after* rather than the first line it covers — so that
 * line is still unchanged and must be carried across.
 */
export const lineMapFromHunks = (hunks: readonly Hunk[], old_total: number): LineMap => {
  const map = new Map<number, number>();
  let old_line = 1;
  let new_line = 1;

  for (const hunk of hunks) {
    const unchanged_until = hunk.old_count === 0 ? hunk.old_start : hunk.old_start - 1;
    while (old_line <= unchanged_until) {
      map.set(old_line, new_line);
      old_line += 1;
      new_line += 1;
    }
    old_line = hunk.old_count === 0 ? hunk.old_start + 1 : hunk.old_start + hunk.old_count;
    new_line = hunk.new_count === 0 ? hunk.new_start + 1 : hunk.new_start + hunk.new_count;
  }

  while (old_line <= old_total) {
    map.set(old_line, new_line);
    old_line += 1;
    new_line += 1;
  }

  return map;
};

export interface GitLineMapOptions {
  /** Mirrors the text-diff default: a reindent should not outdate every thread. */
  ignore_whitespace?: boolean;
}

/**
 * Builds a line map between two blobs using git itself.
 *
 * Preferred over diffing the text in process: git is faster, and asking the
 * same tool that produced the shas to compare them avoids two implementations
 * disagreeing about what changed.
 */
export const buildLineMapFromGit = async (
  repo_path: string,
  base_blob_sha: string,
  head_blob_sha: string,
  options: GitLineMapOptions = {},
): Promise<LineMap> => {
  const { ignore_whitespace = true } = options;

  const args = ['diff', '--no-color', '--unified=0'];
  if (ignore_whitespace) args.push('--ignore-all-space');
  args.push(base_blob_sha, head_blob_sha);

  const [diff_output, base_content] = await Promise.all([
    runGit(repo_path, args),
    readBlob(repo_path, base_blob_sha),
  ]);

  return lineMapFromHunks(parseHunkHeaders(diff_output), countLines(base_content));
};
