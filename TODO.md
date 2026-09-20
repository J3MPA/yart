# TODO

Planned work, roughly in the order it should happen.

Findings recorded here were verified rather than assumed, so they do not have to
be rediscovered when the work starts.

## 1. Make it installable

`yart` and `yart-mcp` only run from this checkout. Both packages declare `bin`
entries pointing at `.ts` files with a plain `#!/usr/bin/env node` shebang, so a
global install dies on the first type annotation — Node will not strip types
without the flag.

- Either `#!/usr/bin/env -S node --experimental-strip-types`, or a build step
- A global link, so the commands work from any repository and default to the
  current one

Until this lands, using yart on another project means running the daemon from
here with `--repo`, and registering the MCP server with absolute paths.

## 2. Support git worktrees

**This is a bug, and it blocks concurrent reviews.** `ReviewStore` builds its
path as `<repo>/.git/yart/reviews`, which assumes `.git` is a directory. In a
linked worktree it is a file pointing elsewhere, so the daemon fails outright:

```
mkdir: ../wt-a/.git: Not a directory
```

Use `git rev-parse --git-common-dir` instead of joining `.git`. That also settles
a design question for free: the common dir is shared by every worktree of a
repository, so reviews become one list regardless of which worktree you are in —
which is what the tab work below wants anyway.

This matters because two agents editing the same working tree will clobber each
other. Genuinely concurrent work means one worktree per session.

## 3. Review work before it is committed

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

## 4. File tree and collapsed context

Reviewing a 28-file change is currently one long blind scroll.

- A sidebar of changed files, with open-thread counts and added/removed totals
- Click to jump to a file
- Collapse long runs of unchanged lines, expandable in place

No model changes; this is all UI.

## 5. Diff any two revisions, including trees

Reviews are limited to commits, so ad-hoc comparisons are not possible.

`git diff --raw` already works tree-to-tree, and everything downstream — hunks,
line maps, anchoring — operates on blobs and does not care. The only blocker is
`resolveRev`, which forces `^{commit}` and so rejects a tree with _expected
commit type, but the object dereferences to tree type_.

One semantic decision has to be made: a tree has no "next commit", so a
tree-based review cannot `advance`. It is a static comparison rather than a loop.
Either reject `advance_review` for those reviews, or define advancing as
re-pointing at a named tree.

## 6. Concurrent reviews: naming, tabs, and approval

The goal: work in several chats at once, see that an agent has answered comments
in one of them, switch to it, resolve, and approve the diff — a local pull
request.

This is the largest item and decomposes into five pieces, only one of which is
UI:

- **Reviews need names.** A review is currently a UUID and a revision range,
  which is useless as a tab label. Probably a `label` argument on `start_review`.
- **A changed-since-last-seen signal**, or "an agent answered" never surfaces.
  Needs per-review last-seen state.
- **Live updates.** The UI only refetches when the window regains focus. For a
  tab to change while you are looking elsewhere, the daemon has to push (SSE) or
  the list has to be polled.
- **An `approved` state.** A review is currently only `open` or `submitted`,
  which is a handoff rather than an outcome. Approval should also be readable by
  the agent, so it knows the work is accepted.
- **Worktree support**, which is item 2 above and must come first.

## Smaller things

- The daemon has no crash recovery, no log file, and exits if its port is taken.
- `GET /api/reviews/:id/diff` returns every file with no cap. Fine for
  agent-sized changes; a large refactor will feel it.
- Split view is unimplemented — the state exists, but only the unified layout
  renders.
- No syntax highlighting in the diff.
- No way to delete a review from the UI.
- typescript-eslint resolves TypeScript 6 while every package compiles with
  TypeScript 7, so type-aware lint rules are evaluated against different
  inference than the compiler uses. Nothing is broken today, and installing
  TypeScript 7 at the workspace root makes typescript-eslint refuse to run.
