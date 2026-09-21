# TODO

Planned work, roughly in the order it should happen.

Findings recorded here were verified rather than assumed, so they do not have to
be rediscovered when the work starts.

## 1. Review work before it is committed

Today a review can only cover commits, so an agent has to commit before its work
can be looked at. That inverts the natural order: the moment you want to review
is before the commit exists.

The two halves are not equally hard.

**Staged changes are nearly free.** `git diff --raw --cached HEAD` reports real
blob hashes, and those blobs are in the object database already, so hunks, line
maps and anchoring all work unchanged. This needs a way to name the index as one
side of a review, and `--cached` on the diff call.

**Unstaged changes need the content hashed first.** Git reports the new side as
all zeroes, because nothing has hashed the working copy yet — and `blobOrNull`
would read that as a deleted file. Writing the blobs with `git hash-object -w`
would work, but they would be unreferenced and eventually collected, so a thread
could have the blob under it disappear. That needs a deliberate answer before it
is built.

## 2. File tree and collapsed context

Reviewing a 28-file change is currently one long blind scroll.

- A sidebar of changed files, with open-thread counts and added/removed totals
- Click to jump to a file
- Collapse long runs of unchanged lines, expandable in place

No model changes; this is all UI.

## 3. Diff any two revisions, including trees

Reviews are limited to commits, so ad-hoc comparisons are not possible.

`git diff --raw` already works tree-to-tree, and everything downstream — hunks,
line maps, anchoring — operates on blobs and does not care. The only blocker is
`resolveRev`, which forces `^{commit}` and so rejects a tree with _expected
commit type, but the object dereferences to tree type_.

One semantic decision has to be made: a tree has no "next commit", so a
tree-based review cannot `advance`. It is a static comparison rather than a loop.
Either reject `advance_review` for those reviews, or define advancing as
re-pointing at a named tree.

## 4. Concurrent reviews: naming, tabs, and approval

The goal: work in several chats at once, see that an agent has answered comments
in one of them, switch to it, resolve, and approve the diff — a local pull
request.

Two pieces of this are done:

- **Reviews are named.** A review carries a `title`, defaulting to the head
  commit's subject, with `start_review` able to override it. The list shows that
  plus the branch, an abbreviated range, a file count and how long ago it was
  opened.
- **Reviews have a verdict.** Submitting takes `commented`, `approved` or
  `changes_requested` plus an optional summary, recorded against the head it was
  passed on so advancing reopens the review. `await_review` leads with it,
  because it decides what the agent does next.

What remains:

- **A changed-since-last-seen signal**, or "an agent answered" never surfaces.
  Needs per-review last-seen state.
- **Live updates.** The UI only refetches when the window regains focus. For a
  tab to change while you are looking elsewhere, the daemon has to push (SSE) or
  the list has to be polled.
- **Tabs themselves**, once there is something worth switching between.
- **Replying to a submission.** A summary left with a verdict is currently
  write-only: the agent can read it, but there is nowhere to answer it. Line
  comments have threads; submissions do not.
- **Tabs across worktrees** now work at the storage level: reviews are kept in
  the repository's shared git directory, so every worktree sees one list and
  each review records which worktree it belongs to.

## Smaller things

- The daemon has no crash recovery, no log file, and exits if its port is taken.
- `GET /api/reviews/:id/diff` returns every file with no cap. Fine for
  agent-sized changes; a large refactor will feel it.
- Split view is unimplemented — the state exists, but only the unified layout
  renders.
- No syntax highlighting in the diff.
- typescript-eslint resolves TypeScript 6 while every package compiles with
  TypeScript 7, so type-aware lint rules are evaluated against different
  inference than the compiler uses. Nothing is broken today, and installing
  TypeScript 7 at the workspace root makes typescript-eslint refuse to run.
