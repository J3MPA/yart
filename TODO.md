# TODO

Planned work, roughly in the order it should happen.

Findings recorded here were verified rather than assumed, so they do not have to
be rediscovered when the work starts.

## 1. File tree and collapsed context

Reviewing a 28-file change is currently one long blind scroll.

- A sidebar of changed files, with open-thread counts and added/removed totals
- Click to jump to a file
- Collapse long runs of unchanged lines, expandable in place

No model changes; this is all UI.

## 2. Diff any two arbitrary points

A review can now be opened over any commit or tree, including a bare tree hash,
so ad-hoc comparisons are possible through the API. What is missing is a way to
ask for one: the UI offers no way to pick two revisions, and the MCP tools take
them but nothing suggests the possibility.

## 3. Concurrent reviews: naming, tabs, and approval

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

## Discovery: how this gets distributed

Not a task yet. Today the commands are linked from a clone, which works for
whoever wrote them and nobody else. Two channels look plausible and they are not
alternatives — the second would sit on top of the first.

**An npm package.** The tool itself: the daemon, the UI, and the MCP server, for
anyone and any agent. Questions to answer before committing to it:

- A single published package rather than the four in this workspace, since
  `workspace:*` dependencies cannot be published and a consumer should not see
  the split.
- A real build. `--experimental-strip-types` is reasonable for a clone and not
  something to ask of a stranger, so entry points would be bundled to JavaScript.
- `apps/web/dist` has to ship, or the daemon serves its "not built" page.
- The name. `yart` is parked on npm at a couple of downloads a week, so this
  would be scoped.

**A Claude Code plugin.** The integration, for the audience most likely to want
it. `claude plugin install` in place of the `claude mcp add` step, with the
plugin declaring the MCP server itself. Plugins appear to carry slash commands
and hooks as well, which would make two things from the original sketch
shippable: a `/review` command, and a hook that opens a review when an agent
finishes a turn against a dirty tree — so review becomes part of the turn rather
than something to remember.

What is actually unknown: the plugin manifest format, whether it can declare an
MCP server and a hook, and how a marketplace is published. The CLI exists and
takes marketplaces; nothing beyond that has been checked. Read the documentation
before planning around it.

Worth deciding what the tool is for first. Distribution is cheap to add and hard
to take back, and nobody has used this but its author.

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
