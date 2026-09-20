import type { AnchorState, FileResolution, LineAnchor, Thread } from './types.ts';

/**
 * Anchor state is derived from where a thread sits now versus where it started,
 * never accumulated across rounds — so a line that moves away and back reads as
 * `current` again, and a bug in one round cannot poison later ones.
 */
export const deriveAnchorState = (
  origin: LineAnchor,
  anchor: LineAnchor | null,
): AnchorState => {
  if (anchor === null) return 'outdated';
  if (anchor.path === origin.path && anchor.line === origin.line) return 'current';
  return 'shifted';
};

const outdate = (thread: Thread): Thread => {
  return { ...thread, anchor: null, anchor_state: 'outdated' };
};

const moveTo = (thread: Thread, anchor: LineAnchor): Thread => {
  return { ...thread, anchor, anchor_state: deriveAnchorState(thread.origin, anchor) };
};

/**
 * Moves a thread's anchor onto a later revision of its file.
 *
 * Pure lookup: the caller supplies the line mapping, so this stays independent
 * of how the diff was computed.
 *
 * Outdating is permanent — a thread whose line has already been lost is
 * returned untouched rather than speculatively re-matched, since any such match
 * would be a guess.
 */
export const reanchorThread = (thread: Thread, resolution: FileResolution): Thread => {
  const { anchor } = thread;
  if (anchor === null) return thread;

  if (resolution.kind === 'deleted') return outdate(thread);

  if (resolution.kind === 'unchanged') {
    return moveTo(thread, { ...anchor, path: resolution.path });
  }

  const line = resolution.line_map.get(anchor.line);
  if (line === undefined) return outdate(thread);

  return moveTo(thread, {
    path: resolution.path,
    blob_sha: resolution.blob_sha,
    line,
    side: anchor.side,
  });
};

/**
 * Re-anchors many threads at once, keyed by the blob each is anchored to.
 *
 * Threads whose blob is absent from `resolutions` are passed through untouched:
 * the caller decides what an unknown blob means, since silently outdating them
 * would destroy comments over what may be a lookup bug.
 */
export const reanchorThreads = (
  threads: readonly Thread[],
  resolutions: ReadonlyMap<string, FileResolution>,
): Thread[] => {
  return threads.map((thread) => {
    if (thread.anchor === null) return thread;
    const resolution = resolutions.get(thread.anchor.blob_sha);
    return resolution === undefined ? thread : reanchorThread(thread, resolution);
  });
};
