# TODO

Planned work, roughly in the order it should happen.

Findings recorded here were verified rather than assumed, so they do not have to
be rediscovered when the work starts.

## 1. An installable desktop app

yart has two kinds of people using it, and today it only serves the first:

- **Developing yart.** Clone it, `pnpm install`, and `pnpm dev:actual` runs the
  daemon and Vite against yart's own branch with hot reload. This stays as it is.
- **Using yart.** One command installs it, one updates it, one removes it, and
  nothing about the workspace, pnpm or Node is visible. This is what is missing.

The user path is a desktop app, installed with `curl` from GitHub Releases. The
reason for an app is control over the window: one window that a new review is
shown in, rather than a browser tab opened per review, plus a dock badge and a
notification when the agent answers. The reason for `curl` is covered under
install below.

**Done: one daemon for every repository.** Requests name their repository, the
daemon keeps a service per repository and remembers them in `~/.yart`, and the
MCP server refuses an older daemon that would review the wrong one. The finding
that led to it, kept for the record:

**A daemon served one repository.** Its repository is fixed by `--repo` at start, and nothing in a
request names another. The MCP server reuses whatever daemon answers on 7777,
without checking which repository it serves. So with yart registered for every
project, a review asked for in repository B while a daemon started in
repository A is still running is a review of A's working tree — with no error.
That is a live bug today, found by reading the code rather than by hitting it,
and an installed app with one daemon would hit it constantly.

What was done about it:

- Requests that create a review name the repository they are for, and the MCP
  server sends the one it was started in.
- The daemon keeps one `ReviewService` per repository, created on first use and
  keyed by the shared git directory so that worktrees still share one list.
- It keeps a small registry of repositories it has seen, so the review list can
  span all of them and a review id can be found without knowing its repository.
- `/health` reports the daemon's version, so a client can tell when the daemon
  it found is older than itself — which after an update it will be.

**Done: the prototype.** A throwaway Electron 44 build, served from a local web
server and fetched both with `curl` and with a browser — what decides Gatekeeper
is which program downloads the zip, not where it is hosted. Every question it
was built to answer has an answer, and none rules the plan out:

1. **An ad-hoc signed app installed with `curl` opens with no prompt.** Zipped
   with `ditto`, fetched with `curl`, unpacked into `~/Applications`: the app
   carries no `com.apple.quarantine` attribute and launches straight away on
   Apple Silicon, macOS 26.4.
2. **The same zip downloaded in a browser is blocked.** Chrome marks the
   download, the mark carries over to the unpacked app, and opening it gives
   "Apple could not verify “yart” is free of malware" with only _Done_ and
   _Move to Bin_. This is what the install instructions have to warn about.
3. **The dock badge works, but is off by default.** With only the notification
   banner allowed, `app.setBadgeCount` returns true and `app.dock.getBadge()`
   reads it back while the dock shows nothing. Turning on _Badge application
   icon_ under the app's notification settings makes it appear. Nothing reports
   the badge as hidden, so the app has to ask for it or point the user at the
   setting.
4. **Notifications arrive, but not reliably as banners.** No permission prompt
   was ever shown. A freshly built app's first notifications were refused with
   "Notifications are not allowed for this application" while it ran from a
   temporary directory; the same build in `~/Applications` delivered them.
   Delivered ones sometimes showed as a banner and sometimes went only to
   Notification Center, with every setting for the app on and the app in the
   background. The cause is not found — a Focus mode or screen sharing holding
   banners back is the first thing to rule out — and needs settling while
   building the app, since a notification nobody sees does not do its job.
5. **`yart://reviews/<id>` works both ways.** With the app running, `open-url`
   navigates the existing window and no second process starts; with it not
   running, the link launches it and the URL arrives before `ready`, so it has
   to be held until the window exists. `open -g` delivers a link without
   bringing the app forward, which is what a badge or background update wants.
6. **The daemon and MCP server run on Electron's Node.** Bundled with esbuild and
   started with `ELECTRON_RUN_AS_NODE=1` on the app's own binary, both run
   straight from inside `app.asar`, the daemon spawns `git` to build a diff, and
   the MCP server answers `list_reviews` over stdio.
7. **What it costs.** The app is 289 MB on disk and 127 MB zipped, per
   architecture. esbuild takes about 50 ms, `electron-packager` about 2.4 s and
   signing 0.3 s.

Found on the way, and needed by the steps below:

- `electron-packager`'s output fails `codesign --verify` as it comes: the
  binary is only linker-signed and the bundle's resources are unsealed. It has
  to be re-signed with `codesign --force --deep --sign -` after packaging.
- The daemon finds its UI (`../../../apps/web/dist`) and its version
  (`../package.json`) relative to `import.meta.url`, which bundling moves. The
  prototype passed `ui_dir` in; the real bundle needs both to be options, or
  paths that hold in the app's layout. Inside the app, `../package.json` is the
  app's own, so the version reported is the app's version.

**Developer mode.** The developer and the user can be the same person on the same
machine, so the two must not reach each other's daemon.

- `pnpm dev:actual` uses its own port and only ever reuses a daemon from the same
  checkout. Today it reuses anything on 7777, which with an installed yart
  would be serving the installed version's code.
- `pnpm dev:desktop` runs the Electron shell against the Vite dev server, so the
  shell can be worked on with the UI still hot-reloading.
- Which `yart-mcp` an agent talks to is decided by the MCP registration. A
  project-scoped registration in the yart repository pointing at the clone would
  let the installed one stay registered for everything else — if a project
  scope does win over a user scope of the same name. Unverified.

**The app.** A new `apps/desktop`.

- One window, loading the UI the daemon serves. A second launch focuses it rather
  than opening another.
- `yart://reviews/<id>` links. `start_review` opens one when the app is installed
  and falls back to the browser when it is not.
- The app starts the daemon if none is running, with the same reuse rules the MCP
  server uses, so either can come up first.
- The dock badge carries the unseen count the UI already computes, and a review
  turning `your turn` raises a notification.
- The app carries the command line tools inside it. `yart` and `yart-mcp` are
  small scripts that run the bundled JavaScript on Electron's Node, so a user
  needs neither Node nor npm.
- Seen state and drafts live in the app's own storage, separate from any
  browser's. Moving between the two starts them afresh; worth saying in the docs.

**Build and release.**

- The daemon and MCP entry points are bundled to JavaScript with esbuild. That
  retires `--experimental-strip-types` for everyone but developers.
- One zip per architecture, Apple Silicon and Intel, each ad-hoc signed, each
  with a SHA-256 checksum beside it. A zip rather than a disk image: a disk image
  is made for dragging an app into place by hand, and is awkward to script.
- A GitHub Actions workflow on a `v*` tag builds on macOS runners and publishes
  the release, with `install.sh` and `uninstall.sh` as assets of it so each
  script is the one that matches its release.

**Install, update, uninstall.** Nothing needs `sudo`; everything lives in the
user's own directories.

- `curl -fsSL https://github.com/J3MPA/yart/releases/latest/download/install.sh | sh`
  detects the architecture, downloads the zip and its checksum, verifies it,
  and puts the app in `~/Applications` and the two commands in `~/.local/bin`.
  It says so if that directory is not on `PATH`, and prints the `claude mcp add`
  command with an absolute path, because Claude starts MCP servers with its own
  environment and may not share the shell's `PATH`.
- Installing over an existing install replaces it, so the install script is
  also the update. `yart up` runs it for the latest release, then restarts the
  daemon and the app so neither keeps running the old code.
- `uninstall.sh`, and `yart uninstall` which runs it, stops the app and the
  daemon, removes the app, and removes the two commands only if they still point
  into it. It prints the `claude mcp remove` command. It keeps the app's own
  data — seen state and drafts — unless given `--purge`, since a draft is
  something a person wrote. It never touches reviews: those live in each
  repository's `.git/yart`, belong to that repository, and the script says where.
  Running it twice is harmless.

Why `curl` and not a download link or Homebrew: macOS only checks an app with
Gatekeeper when the file has been marked as quarantined, and browsers mark what
they download while `curl` does not. So an app installed with `curl` needs only
the free, local ad-hoc signature to open, where one downloaded in a browser
would need a paid Developer ID and notarization. That is a long-standing
behaviour many installers rely on, but it is a convention rather than a promise
from Apple. Homebrew's main repository now refuses casks that fail Gatekeeper;
a tap of our own could still carry the app later, on top of the same release.

**Order of work.**

1. ~~One daemon for every repository.~~ Done.
2. ~~The prototype, and its findings written down here.~~ Done.
3. Developer mode: its own port, and `pnpm dev:desktop`.
4. The app.
5. Bundling, packaging, and the release workflow.
6. The install, update and uninstall scripts.
7. The README split into using yart and developing it.

Left out on purpose: Linux and Windows, though Electron would carry both —
`install.sh` refuses anything but macOS for now. And the Claude Code plugin,
which would sit on top of this rather than replace it: a plugin could register
the MCP server pointing at the installed `yart-mcp`, and carry the slash command
and the review-on-stop hook from the finding below.

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

## 4. Pending reviews: what is left

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
  remaining half of live updates in item 3, and it shows up here too: the tab
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

## Smaller things

- The daemon checks nothing about who is asking. Requiring JSON on writes stops
  a web page from making it act, but a page that rebinds its own hostname to
  `127.0.0.1` can make same-origin requests and read the answers, including
  file contents. Checking that the `Host` header is `localhost` or `127.0.0.1`
  would close that. Worth doing before yart is installed by anyone else, since
  the daemon now reaches every repository it has served.

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
