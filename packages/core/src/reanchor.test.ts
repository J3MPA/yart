import { describe, expect, it } from 'vitest';
import { buildLineMap, type LineMapOptions } from './line-map';
import { deriveAnchorState, reanchorThread, reanchorThreads } from './reanchor';
import { createThread } from './thread';
import type { Comment, FileResolution, LineAnchor, Thread } from './types';

const COMMENT: Comment = {
  id: 'c1',
  author: 'human',
  body: 'this looks wrong',
  created_at: '2026-09-20T12:00:00.000Z',
};

const ORIGINAL = 'alpha\nbeta\ngamma\ndelta\n';
const INDENTED = 'if (x) {\nf();\n}\n';

function threadAt(line: number, content = ORIGINAL, overrides: Partial<LineAnchor> = {}): Thread {
  return createThread({
    id: 't1',
    anchor: { path: 'src/a.ts', blob_sha: 'blob-old', line, side: 'head', ...overrides },
    content,
    comment: COMMENT,
  });
}

/** Builds a `modified` resolution by diffing `before` against `after`. */
function modified(
  after: string,
  {
    before = ORIGINAL,
    path = 'src/a.ts',
    blob_sha = 'blob-new',
    options,
  }: { before?: string; path?: string; blob_sha?: string; options?: LineMapOptions } = {},
): FileResolution {
  return { kind: 'modified', path, blob_sha, line_map: buildLineMap(before, after, options) };
}

const DELETED: FileResolution = { kind: 'deleted' };

describe('deriveAnchorState', () => {
  const origin: LineAnchor = { path: 'a.ts', blob_sha: 'b1', line: 5, side: 'head' };

  it('is outdated when there is no anchor', () => {
    expect(deriveAnchorState(origin, null)).toBe('outdated');
  });

  it('is current when path and line both match the origin', () => {
    expect(deriveAnchorState(origin, { ...origin, blob_sha: 'b2' })).toBe('current');
  });

  it('is shifted when the line moved', () => {
    expect(deriveAnchorState(origin, { ...origin, line: 9 })).toBe('shifted');
  });

  it('is shifted when the file was renamed', () => {
    expect(deriveAnchorState(origin, { ...origin, path: 'b.ts' })).toBe('shifted');
  });
});

describe('createThread', () => {
  it('starts with origin and anchor in sync', () => {
    const thread = threadAt(2);
    expect(thread.anchor).toEqual(thread.origin);
    expect(thread.anchor_state).toBe('current');
    expect(thread.status).toBe('open');
  });

  it('captures the commented line', () => {
    expect(threadAt(2).context.line).toBe('beta');
  });
});

describe('reanchorThread', () => {
  it('keeps an untouched line current', () => {
    const next = reanchorThread(threadAt(2), modified(ORIGINAL));
    expect(next.anchor_state).toBe('current');
    expect(next.anchor?.line).toBe(2);
  });

  it('adopts the new blob sha even when the line does not move', () => {
    expect(reanchorThread(threadAt(2), modified(ORIGINAL)).anchor?.blob_sha).toBe('blob-new');
  });

  it('shifts a line pushed down by an insertion above it', () => {
    const next = reanchorThread(threadAt(2), modified('inserted\nalpha\nbeta\ngamma\ndelta\n'));
    expect(next.anchor_state).toBe('shifted');
    expect(next.anchor?.line).toBe(3);
  });

  it('shifts a line pulled up by a deletion above it', () => {
    const next = reanchorThread(threadAt(3), modified('beta\ngamma\ndelta\n'));
    expect(next.anchor?.line).toBe(2);
  });

  it('outdates a thread whose line was deleted', () => {
    const next = reanchorThread(threadAt(2), modified('alpha\ngamma\ndelta\n'));
    expect(next.anchor_state).toBe('outdated');
    expect(next.anchor).toBeNull();
  });

  it('outdates a thread whose line was rewritten', () => {
    const next = reanchorThread(threadAt(2), modified('alpha\nBETA REWRITTEN\ngamma\ndelta\n'));
    expect(next.anchor_state).toBe('outdated');
  });

  it('outdates a thread whose file was deleted', () => {
    expect(reanchorThread(threadAt(2), DELETED).anchor_state).toBe('outdated');
  });

  it('follows a rename of an otherwise unchanged file', () => {
    const next = reanchorThread(threadAt(2), { kind: 'unchanged', path: 'src/renamed.ts' });
    expect(next.anchor_state).toBe('shifted');
    expect(next.anchor?.path).toBe('src/renamed.ts');
    expect(next.anchor?.line).toBe(2);
  });

  it('keeps the blob sha when the file is unchanged', () => {
    const next = reanchorThread(threadAt(2), { kind: 'unchanged', path: 'src/a.ts' });
    expect(next.anchor?.blob_sha).toBe('blob-old');
    expect(next.anchor_state).toBe('current');
  });

  it('follows a rename that also moves the line', () => {
    const next = reanchorThread(
      threadAt(2),
      modified('inserted\nalpha\nbeta\ngamma\ndelta\n', { path: 'src/renamed.ts' }),
    );
    expect(next.anchor).toMatchObject({ path: 'src/renamed.ts', line: 3 });
  });

  it('preserves captured context and comments when outdating', () => {
    const next = reanchorThread(threadAt(2), DELETED);
    expect(next.context.line).toBe('beta');
    expect(next.comments).toEqual([COMMENT]);
  });

  it('leaves an already-outdated thread untouched rather than guessing', () => {
    const outdated = reanchorThread(threadAt(2), DELETED);
    expect(reanchorThread(outdated, modified(ORIGINAL))).toBe(outdated);
  });

  it('never mutates the thread it is given', () => {
    const thread = threadAt(2);
    const before = JSON.stringify(thread);
    reanchorThread(thread, modified('alpha\ngamma\ndelta\n'));
    expect(JSON.stringify(thread)).toBe(before);
  });

  it('survives a reformat of the anchored line by default', () => {
    const next = reanchorThread(
      threadAt(2, INDENTED),
      modified('if (x) {\n    f();\n}\n', { before: INDENTED }),
    );
    expect(next.anchor_state).toBe('current');
  });

  it('outdates a reformatted line when whitespace is significant', () => {
    const next = reanchorThread(
      threadAt(2, INDENTED),
      modified('if (x) {\n    f();\n}\n', {
        before: INDENTED,
        options: { ignore_whitespace: false },
      }),
    );
    expect(next.anchor_state).toBe('outdated');
  });
});

describe('reanchorThreads', () => {
  const twoThreads = () => [
    { ...threadAt(2), id: 't-beta' },
    { ...threadAt(4), id: 't-delta' },
  ];

  it('re-anchors several threads sharing one file', () => {
    const resolutions = new Map<string, FileResolution>([
      ['blob-old', modified('inserted\nalpha\nbeta\ngamma\ndelta\n')],
    ]);
    const [beta, delta] = reanchorThreads(twoThreads(), resolutions);
    expect(beta?.anchor?.line).toBe(3);
    expect(delta?.anchor?.line).toBe(5);
  });

  it('outdates only the thread whose line died', () => {
    const resolutions = new Map<string, FileResolution>([
      ['blob-old', modified('alpha\ngamma\ndelta\n')],
    ]);
    const [beta, delta] = reanchorThreads(twoThreads(), resolutions);
    expect(beta?.anchor_state).toBe('outdated');
    expect(delta?.anchor_state).toBe('shifted');
    expect(delta?.anchor?.line).toBe(3);
  });

  it('passes through threads whose blob is not in the resolution map', () => {
    const thread = threadAt(2);
    expect(reanchorThreads([thread], new Map())[0]).toBe(thread);
  });

  it('handles threads across different files independently', () => {
    const a = { ...threadAt(2), id: 't-a' };
    const b = {
      ...threadAt(2, ORIGINAL, { blob_sha: 'blob-other', path: 'src/b.ts' }),
      id: 't-b',
    };
    const resolutions = new Map<string, FileResolution>([
      ['blob-old', modified('inserted\nalpha\nbeta\ngamma\ndelta\n')],
      ['blob-other', DELETED],
    ]);
    const [ra, rb] = reanchorThreads([a, b], resolutions);
    expect(ra?.anchor?.line).toBe(3);
    expect(rb?.anchor_state).toBe('outdated');
  });

  it('returns results in the order given', () => {
    const threads = [
      { ...threadAt(4), id: 'first' },
      { ...threadAt(2), id: 'second' },
    ];
    const resolutions = new Map<string, FileResolution>([['blob-old', modified(ORIGINAL)]]);
    expect(reanchorThreads(threads, resolutions).map((t) => t.id)).toEqual(['first', 'second']);
  });
});
