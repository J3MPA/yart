# TODO

Planned work, roughly in the order it should happen.

Findings recorded here were verified rather than assumed, so they do not have to
be rediscovered when the work starts.

## 1. Diff any two arbitrary points

A review can now be opened over any commit or tree, including a bare tree hash,
so ad-hoc comparisons are possible through the API. What is missing is a way to
ask for one: the UI offers no way to pick two revisions, and the MCP tools take
them but nothing suggests the possibility.

## 2. Concurrent reviews: naming, tabs, and approval

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

- **A notification that the agent has answered.** This is the piece that makes
  working in several chats worthwhile, and it is the one to build first: without
  it there is nothing to switch to a tab _for_. A dot on the review in the list,
  and something visible from outside the page — the document title, or the
  favicon — so it can be noticed while attention is elsewhere.

  What counts as answered needs deciding: a reply on a thread, a thread resolved,
  the review advanced onto new work, or any of them. Whichever it is, the signal
  should clear once the review has been looked at.

  Seen-ness is per person and per device rather than a property of the review, so
  it belongs in the browser rather than beside the review on disk — which also
  keeps an agent from being able to mark its own work as read.

- **Live updates.** The dot only appears on a refresh today, because the UI
  refetches when the window regains focus and not otherwise. For it to appear
  while you are looking elsewhere the daemon has to push, over server-sent
  events, or the list has to be polled.
- **Tabs themselves**, once there is something worth switching between.
- **Replying to a submission.** A summary left with a verdict is currently
  write-only: the agent can read it, but there is nowhere to answer it. Line
  comments have threads; submissions do not.
- **Tabs across worktrees** now work at the storage level: reviews are kept in
  the repository's shared git directory, so every worktree sees one list and
  each review records which worktree it belongs to.

## Finding: agents use the tools, but do not reach for them

Established by running the MCP server against real sessions rather than by
reasoning about it.

**The tools work and are discoverable.** Told "I want to review the code", an
agent with no instructions about yart found `start_review`, gave it a title of
its own, waited on `await_review`, replied to a comment, and called
`advance_review` after fixing. The whole loop, in order, unprompted.

**Agents do not open a review on their own.** Finishing a change and deciding
that someone should look at it is a judgement they have no reason to make, and
no amount of wording in a tool description appears to change that. Stating the
intent is what triggers it.

**A conflicting instruction makes the tool invisible.** Two runs failed before
this was understood, and neither was the model's fault: a line in the user's
global `CLAUDE.md` named a different review mechanism, and the model obeyed the
more specific instruction it already had. Nothing surfaced the conflict — the
tools were connected and healthy the whole time. Worth remembering that when an
agent ignores a tool, the first thing to look for is a competing instruction,
not a weak description.

The lever for proactive review is a `Stop` hook rather than better descriptions:
a turn ends with a dirty tree, a review opens, no judgement involved. Deferred
for now — saying "I want to review the code" works, and a hook that fires on
every dirty turn would need care not to be noisy. If it is built, it should
advance an existing review rather than open a second, do nothing when no files
changed, and would mean `yart` growing a subcommand for hooks to call.

## Syntax highlighting

Wanted, and not simply a matter of dropping a library in.

The constraint is that highlighting has to survive the per-line structure. Every
diff row is a line with its own gutters and its own comment anchor, so the
markup a highlighter produces must stay inside a line: anything that opens a
span on one line and closes it on another will either break the rows or leak
styling across them. Shiki can emit per-line output for this; the simpler
highlighters generally assume they own a whole block.

Two further things to settle. What gets highlighted is the file, not the diff —
the `+` and `-` markers are ours and must not be fed to a grammar that will try
to read them as source. And the theme has to come from the design tokens in both
colour schemes, rather than importing a highlighter's own theme, or the diff will
stop looking like the rest of the interface.

Weight is worth watching: grammars and themes are large, and this is a local tool
that should stay quick to start. Loading a grammar only for the languages a
review actually contains would be the way to keep it honest.

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

- Deleting a review is confirmed by a second click inside the overflow menu.
  That is cheap and reversible up to the second click, but it is thin for an
  action that discards every comment on a review with no undo. A modal would
  carry more weight and, more usefully, would have room to say what is about to
  be lost — the review's title and how many comment threads go with it — which
  the menu cannot.

- The daemon has no crash recovery, no log file, and exits if its port is taken.
- `GET /api/reviews/:id/diff` returns every file with no cap. Fine for
  agent-sized changes; a large refactor will feel it.
- Split view is unimplemented — the state exists, but only the unified layout
  renders. `hide_unchanged` in the same slice is unused too: collapsing is now
  per run, expanded from the band rather than from a global switch, and a switch
  that opened every run at once would pull every file's full text over the wire.
- `GET /api/reviews/:id/diff` now reads each text file's head blob as well as
  diffing it, to report the file's length — without which nothing can say
  whether a file continues past its last hunk. Two git invocations per file
  instead of one.
- typescript-eslint resolves TypeScript 6 while every package compiles with
  TypeScript 7, so type-aware lint rules are evaluated against different
  inference than the compiler uses. Nothing is broken today, and installing
  TypeScript 7 at the workspace root makes typescript-eslint refuse to run.
