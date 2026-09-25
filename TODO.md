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

- **A notification that the agent has answered** now works: a dot in the list, a
  count in the tab title and a dot on the favicon, cleared by opening the
  review. Seen-ness is kept in the browser, keyed on `agentActivity` rather than
  on a timestamp so that writing a comment does not mark a review unread to the
  person who wrote it.
- **Live updates** are done for the list, which is polled every ten seconds so
  the signal arrives without the window being focused. The open review page is
  not: it still refetches on focus only, so a comment answered while you are
  reading the diff appears when you come back to the window rather than at once.
  Server-sent events would cover both and would let the poll go; worth doing
  when the page being stale in front of you starts to bite.
- **Tabs themselves**, once there is something worth switching between.
- **Replying to a submission** now works: a submission carries its own comments,
  answered from the UI or with the `reply_to_verdict` tool.
- **What counts as answered** is settled: a thread is answered when the agent
  spoke last or resolved it, and a review reports `idle`, `in_progress` or
  `ready`. What remains is surfacing it outside the page — the dot below.
- **Tabs across worktrees** now work at the storage level: reviews are kept in
  the repository's shared git directory, so every worktree sees one list and
  each review records which worktree it belongs to.

## 3. Pending reviews: what is left

Comments can now be held for a pending review and sent with the verdict in one
write, and a directory in the tree folds away with its counts. Recorded here is
only what those left open.

- **Drafts live in one browser.** They are per person and per device, as
  decided for seen-ness, so a draft written on one machine is not on another,
  and clearing site data loses them. Fine for a local tool; worth revisiting if
  yart is ever used by more than one person against one daemon.
- **A stale draft can only be dropped.** A held line comment goes stale when its
  own file changes, and the only way on is to drop it. Carrying it across with
  the same line map threads use when a review advances would keep most of them,
  and is the obvious next step if dropping them starts to cost real comments.
- **The open review page still does not poll.** A reply from the agent appears
  when the window regains focus, not while you are reading. This is the
  remaining half of live updates in item 2, and it shows up here too: the tab
  title can count a review as unseen while that same review is open, because
  the list has polled and the page has not.

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

## Finding: a new tool cannot be used by the session that built it

MCP servers hand over their tool list when the client connects, and that happens
once, at session start. A tool added partway through a session does not appear
in it, however many times the server restarts underneath.

Hit while building `reply_to_verdict`: the agent that wrote the tool, and was
best placed to try it against a real verdict, could not call it. The work-around
is to call the HTTP route the tool wraps, which verifies the behaviour but not
the binding — so the binding is only ever exercised by the next session.

Two consequences worth keeping in mind.

Every MCP tool this project grows is unusable for the remainder of the sitting
that adds it. That is not a reason to avoid adding them, but it does mean a tool
should not be the only way to reach something new: keeping the HTTP route the
plain interface and the tool a thin wrapper is what made this recoverable, and
is worth preserving as a rule rather than an accident.

It also puts a floor under how much an agent can test its own MCP work. The tool
suite in `packages/mcp` runs against a real daemon and does cover the tool
itself, which is the thing standing in for a live session — so those tests earn
their keep here in a way that is easy to underrate when writing them.

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
