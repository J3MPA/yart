# TODO

This file lists the planned work, in the approximate order to do it.

We examined each finding in this file. We did not assume it. Thus you do not have
to find it again when the work starts.

## 1. An installable desktop app

Two groups of people use yart. Before this work, yart served only the first
group:

- **People who develop yart.** They clone it and run `pnpm install`. Then
  `pnpm dev:actual` runs the daemon and Vite against the branch of yart, with hot
  reload. This stays the same.
- **People who use yart.** One command installs it, one command updates it and
  one command removes it. They do not see the workspace, pnpm or Node. This was
  missing.

For users, yart is a desktop app that they install with `curl` from GitHub
Releases. The app gives control of the window. A new review shows in one window,
and does not open a new browser tab. The app also gives a dock badge and a
notification when the agent answers. The section on the install gives the
reason for `curl`.

**Done: one daemon for all repositories.** Each request names its repository.
The daemon keeps one service for each repository and records them in `~/.yart`.
The MCP server refuses an older daemon that would review the wrong repository.
This is the finding that caused the change, kept as a record:

**A daemon served one repository.** `--repo` set its repository at the start,
and no request could name a different one. The MCP server used the daemon that
answered on 7777, and did not examine which repository it served. Thus this problem
occurred when yart was registered for all projects. You asked for a review in
repository B while a daemon from repository A still ran. You then got a
review of the working tree of A, with no error. We found this bug when we read
the code. An installed app with one daemon would cause it all the time.

These are the changes that we made:

- A request that makes a review names its repository. The MCP server sends the
  repository that it started in.
- The daemon keeps one `ReviewService` for each repository. It makes the service
  on the first use. The key is the shared git directory, thus all worktrees
  still share one list.
- The daemon keeps a small registry of the repositories that it served. Thus the
  list of reviews can show all of them, and the daemon can find a review by its
  id alone.
- `/health` gives the version of the daemon. Thus a client can see that the
  daemon is older than the client. After an update, this is always true.

**Done: the prototype.** We made a test build with Electron 44 that we did not
keep. A local web server served it, and we got it with `curl` and with a browser.
The program that downloads the zip decides what Gatekeeper does. The host of the
zip does not. We got an answer to each question, and no answer stops the plan:

1. **An app with an ad-hoc signature that `curl` installs opens with no prompt.**
   We made the zip with `ditto`, got it with `curl`, and unpacked it into
   `~/Applications`. The app has no `com.apple.quarantine` attribute. It opens
   at once on Apple Silicon, macOS 26.4.
2. **macOS blocks the same zip from a browser.** Chrome marks the download, and
   the mark goes to the unpacked app. When you open the app, macOS shows "Apple
   could not verify “yart” is free of malware", with only _Done_ and _Move to
   Bin_. The install instructions must warn about this.
3. **The dock badge works, but it is off at first.** When only the notification
   banner is on, `app.setBadgeCount` returns true and `app.dock.getBadge()`
   reads the count. But the dock shows nothing. The badge shows when you turn on
   _Badge application icon_ in the notification settings of the app. Nothing
   tells the app that the badge is hidden. Thus the app must ask for it, or tell
   the user about the setting.
4. **Notifications come, but not always as banners.** macOS never showed a
   permission prompt. The first notifications of a new build failed with
   "Notifications are not allowed for this application" when the build ran from
   a temporary directory. The same build in `~/Applications` sent them. Some
   notifications showed as a banner. Others went only to Notification Center,
   with all settings of the app on and the app in the background. We did not
   find the cause. Examine a Focus mode or screen sharing first. A notification
   that nobody sees does not do its work.
5. **`yart://reviews/<id>` works in the two cases.** When the app runs, `open-url`
   moves the window to the review, and no second process starts. When the app
   does not run, the link starts it. The URL comes before `ready`, thus the app
   must keep it until the window exists. `open -g` sends a link and does not
   bring the app to the front. A badge or an update in the background needs
   this.
6. **The daemon and the MCP server run on the Node of Electron.** esbuild bundles
   them, and `ELECTRON_RUN_AS_NODE=1` starts them on the binary of the app. The
   two run from inside `app.asar`. The daemon starts `git` to make a diff. The
   MCP server answers `list_reviews` over stdio.
7. **The cost.** For each architecture, the app is 289 MB on the disk and 127 MB
   in a zip. esbuild takes approximately 50 ms, `electron-packager`
   approximately 2.4 s, and the signature 0.3 s.

We also found these things, and the steps below need them:

- The output of `electron-packager` fails `codesign --verify`. The binary has
  only a signature from the linker, and the resources of the bundle are not
  sealed. You must sign it again with `codesign --force --deep --sign -` after
  you package it.
- The daemon finds its UI (`../../../apps/web/dist`) and its version
  (`../package.json`) relative to `import.meta.url`. A bundle moves these files.
  The prototype gave `ui_dir` to the daemon. The real bundle needs options for
  the two, or paths that are correct in the layout of the app. In the app,
  `../package.json` is the file of the app. Thus the daemon gives the version of
  the app.

**Developer mode.** The developer and the user can be the same person on the same
computer. Thus the two must not use the daemon of the other.

- ~~`pnpm dev:actual` uses its own port, and uses a daemon again only from the
  same checkout.~~ Done: port 7778. `/health` tells where the code of a daemon
  runs from.
- ~~`pnpm dev:desktop` runs the Electron shell against the Vite dev server.~~
  Done: `apps/desktop` started as a simple shell. It has one window on its own
  profile, and the session stops when you quit it. Electron 44 runs its
  TypeScript main process directly. Thus the development does not need a build
  step for it.
- ~~The MCP registration decides which `yart-mcp` an agent uses.~~ Settled. When
  servers have the same name, Claude Code starts exactly one. Local scope wins
  over project scope, and project scope wins over user scope. We examined this
  with a test server under one name in the three scopes, on Claude Code 2.1.29.
  We recorded which copy started. Thus the installed yart stays registered in
  user scope. A developer registers the clone in local scope from inside it,
  with the port of the development daemon:

  ```sh
  claude mcp add -s local yart -- node --experimental-strip-types \
    "$PWD/packages/mcp/src/cli.ts" --port 7778
  ```

  We use local scope, not a `.mcp.json` in the repository. That file would give
  the path of one person to all people who clone the repository.

**The app.** A new `apps/desktop`.

- One window shows the UI that the daemon serves. A second start of the app
  brings this window to the front, and does not open a second window.
- ~~`yart://reviews/<id>` links. `start_review` opens one when the app is
  installed, and opens the browser when it is not.~~ Done, and we tried it on a
  packaged build. A link starts the app on the review. When the app runs, a link
  moves the window to a different review, and no second copy starts.
  `start_review` tries the link only for the daemon on 7777. If `open` fails,
  `start_review` decides that the app is not installed. macOS does not attach a
  scheme to an app in a temporary directory. It also does not send the
  notifications of such an app. The two work from `~/Applications`.
- ~~The app starts the daemon if no daemon runs, with the same rules as the MCP
  server. Thus either one can start first.~~ Done. The app uses the client of
  the MCP server, on `YART_DAEMON_PORT` or 7777. The daemon that it starts
  belongs to no repository. As with the MCP server, the daemon continues after
  the app stops.
- ~~The dock badge shows the unseen count that the UI calculates. A review that
  becomes `your turn` causes a notification.~~ Done. A preload bridge sends the
  count, and each review that becomes unseen, from the page to the app. The app
  examines the two before it acts. We saw this work from start to end on a build
  with an ad-hoc signature in `~/Applications`. The first notification showed a
  banner with no permission prompt, with the app in the background. The
  unreliable banners of the prototype did not occur again. The README says these
  things for users:
  - For a new app, the badge is off, also when its banners show. You must turn
    on _Badge application icon_ in the notification settings of the app. The
    app shows in that list only after its first notification.
  - The app keeps its own seen state. A review counts as unseen only after you
    opened it in the app. Thus a new install shows no count and sends nothing
    until you open reviews in it.

  Not tried: a click on a notification. It must open its review, as a link does.

- ~~The app has the command line tools in it. `yart` and `yart-mcp` are small
  scripts that run the bundled JavaScript on the Node of Electron. Thus a user
  needs no Node and no npm.~~ Done, in `Contents/Resources/bin`. The scripts
  find their own link. Thus the install can put links to them in
  `~/.local/bin`. `yart-mcp` gives the bundled daemon to the MCP server with
  `YART_DAEMON_CLI`.
- ~~Seen state and drafts are in the storage of the app, apart from each
  browser. When you change from one to the other, they start again. The docs
  must say this.~~ Done: the README says it.

**Build and release.**

- ~~esbuild bundles the entry points of the daemon and the MCP server to
  JavaScript.~~ Done, with the main process of the app, by
  `pnpm package:desktop`.
- ~~One zip for each architecture, Apple Silicon and Intel. Each has an ad-hoc
  signature and a SHA-256 checksum next to it.~~ Done: 122 MB for Apple Silicon
  and 128 MB for Intel. Each takes approximately 15 seconds on an M-series Mac,
  and that Mac builds the two. We use a zip, not a disk image. A disk image is
  for a person who moves an app into place by hand. It is difficult to use in a
  script.
- ~~A GitHub Actions workflow on a `v*` tag builds on macOS runners and
  publishes the release. `install.sh` and `uninstall.sh` are assets of the
  release, thus each script matches its release.~~ Done. One Apple Silicon
  runner packages the two architectures in less than a minute and a half. A
  version with a suffix, such as `v0.2.0-beta.1`, becomes a pre-release that
  people can see and install. "latest" never points to it.

**Install, update, uninstall.** Nothing needs `sudo`. All files are in the
directories of the user.

**Done**, in `apps/desktop/install`, as the list below tells. We tried it from
start to end with `HOME` set to a temporary directory. A local web server served
the release, and `YART_RELEASE_URL` pointed the scripts at it. We tried these
cases:

- a new install
- an update over it, which stopped the old daemon
- a bad checksum, which did not change the installed app
- `yart up`, and `yart up --pre` against the real releases
- `yart uninstall`, which kept the drafts
- a second uninstall
- `--purge`
- a `yart` link that was not a link to the app, which stayed

The owner installed `v0.1.0-beta.1` from GitHub into the real `~/Applications`
with the public command. Not tried: an update that opens the app again when it
ran before.

**The repository is public.** A ruleset on `main` requires a pull request, the
`gate` check and the approval of the code owner. The release workflow publishes
pre-releases. It does not make drafts. The installer of each release installs
that release, because "latest" on GitHub ignores pre-releases.

**Each `yart.app` on a disk claims `yart://`.** macOS registers the apps that it
finds, also copies in the Bin and the build output in `apps/desktop/out`. Thus,
on a computer that builds yart, a link can go to a wrong copy. The install
script registers the installed app. This should make it the app that links go
to, but we did not examine this.

- `curl -fsSL https://github.com/J3MPA/yart/releases/latest/download/install.sh | sh`
  finds the architecture and downloads the zip and its checksum. It examines the
  checksum. It puts the app in `~/Applications` and the two commands in
  `~/.local/bin`. If that directory is not on `PATH`, it tells you. It shows the
  `claude mcp add` command with a full path. Claude starts MCP servers with its
  own environment, which can be without the `PATH` of the shell.
- An install over an existing install replaces it. Thus the install script is
  also the update. `yart up` runs it for the latest release. Then it starts the
  daemon and the app again, thus neither one continues to run the old code.
- `uninstall.sh`, and `yart uninstall` that runs it, stops the app and the
  daemon and removes the app. It removes the two commands only if they still
  point into the app. It shows the `claude mcp remove` command. It keeps the
  data of the app, the seen state and the drafts, unless you give `--purge`.
  A draft is the work of a person. It never touches reviews. They are in the
  `.git/yart` of each repository, and they belong to that repository. The
  script tells where they are. A second run of the script causes no problem.

The reason for `curl`, not a download link or Homebrew: macOS examines an app
with Gatekeeper only when the file has a quarantine mark. Browsers mark their
downloads, and `curl` does not. Thus an app that `curl` installs needs only the
free, local ad-hoc signature to open. An app from a browser would need a paid
Developer ID and notarization. Many installers use this behavior, and it is
old. But it is a convention, not a promise from Apple. The main repository of
Homebrew now refuses casks that fail Gatekeeper. A tap of our own could carry
the app later, on top of the same release.

**Order of work.**

1. ~~One daemon for all repositories.~~ Done.
2. ~~The prototype, and its findings in this file.~~ Done.
3. ~~Developer mode: its own port, and `pnpm dev:desktop`.~~ Done.
4. ~~The app.~~ Done, but a click on a notification is not tried.
5. ~~Bundles, packages and the release workflow.~~ Done.
6. ~~The install, update and uninstall scripts.~~ Done.
7. ~~A README with one part for users and one part for developers.~~ Done.

Not included on purpose: Linux and Windows. Electron could carry the two, but
`install.sh` refuses all systems other than macOS for now. Also not included:
the Claude Code plugin. A plugin would go on top of this work, and would not
replace it. A plugin could register the MCP server with the installed
`yart-mcp`. It could also carry the slash command and the hook from the finding
below that opens a review when a turn stops.

## AI reviewers

The request: an AI agent must also be able to review code. One agent writes the
code, and an AI reviews it. The two agents go back and forth. At the end, you
review the result, with the comments of the AI and the answers to them. Some
people also want a commit hook to start that loop. Then a commit completes only
when it passes AI review.

**Done: the reviewer role.** A comment can come from `human`, from `agent`, or
from `reviewer`. A `reviewer` is an AI reviewer with an optional `author_name`.
A verdict records if the person or a reviewer gave it. The daemon examines the
authors. A reviewer can give a verdict with the comments that it held. The agent
under review cannot give a verdict. Only the approval of the person starts the
clean-up that the settings set. The comments and verdicts of a reviewer count as
activity. Thus the person sees that an AI review moves.

The work that remains, in order:

1. ~~**The tools of the reviewer.**~~ Done: `get_diff`, `submit_verdict` and
   `await_author`. `await_author` returns when the author moves the review or
   replies. A reply alone can mean that the author disagrees. A round limit,
   three by default, is on the Settings page. The daemon makes sure of the
   limit, and the two agents get a message when the reviewer reaches it.
   `get_reviewer_settings` gives the model, effort and instructions of the
   person to the process that starts the reviewer. Only a launcher that accepts
   an effort uses it. The subagents of Claude Code accept a model, but not an
   effort.
2. ~~**The final review of the person.**~~ Done. When an AI reviewer gave a
   verdict, a "Review history" panel shows the conversation verdict by verdict.
   The comments of a reviewer go with the verdict that they came with. The
   replies of the agent go with the verdict that they answer. The approval of
   the AI is one step, and the verdict of the person comes after it.
3. ~~**The commit hook.**~~ Done. `yart hook install`, `uninstall` and
   `pre-commit`, with the command in the settings, as the README tells. We tried
   it with real commits: a request for changes stopped the commit, the next
   commit moved the same review and the approval let it continue, and
   `--no-verify` skipped it. Not done: the snapshot tree of a stopped commit is
   not pinned with a ref. After the fix, nothing refers to its blobs, and
   garbage collection can remove them after two weeks. The plan was this:
   `yart hook pre-commit` reviews the staged changes.
   `git write-tree` makes a tree from them, and a review can already use a tree.
   The hook runs a reviewer from a command that the person sets. On approval, it
   lets the commit continue. On a request for changes, it stops the commit and
   keeps the review open for the author agent. The next commit moves the same
   review. The hook is optional, because it blocks the commit while a model
   runs. `--no-verify` skips it. `yart hook install` sets it up.
4. ~~**A reviewer that comes with yart.**~~ Done: `yart reviewer install` writes
   `.claude/agents/yart-reviewer.md`, or with `--user` into `~/.claude/agents`.
   The subagent can only read files and use the reviewer tools, and gives one
   verdict for each run. Not verified: that Claude Code lists it in `/agents`.
   The plan was this: a Claude Code subagent definition with
   its own instructions. Thus an agent that must have its work reviewed starts a
   reviewer that it did not brief itself. This agrees with the plugin idea in the
   finding about agents that do not use the tools on their own.

The person decides how a reviewer runs. It can be a subagent that the author
agent starts, a second session that the person opens, or the hook. All use the
same tools. None needs an MCP server that sends messages to an agent. Claude Code
does not have that function. Each side waits in a tool call while the other side
works. The hook gets the verdict when it waits for it.

## 2. Diff any two points

You can now open a review over any commit or tree, also over a bare tree hash.
Thus the API can compare any two points. What is missing is a way to ask for it.
The UI cannot select two revisions. The MCP tools accept them, but nothing tells
the agent about it.

## 3. Concurrent reviews: names, tabs and approval

The goal: you work in many chats at the same time. You see that an agent answered
comments in one chat. You go to it, resolve the comments and approve the diff.
This is a local pull request.

Two parts of this are done:

- **Reviews have names.** A review has a `title`. By default, it is the subject
  of the head commit, and `start_review` can give a different title. The list
  shows the title, the branch, a short range, a count of files and the age of
  the review.
- **Reviews have a verdict.** A submission takes `commented`, `approved` or
  `changes_requested`, and an optional summary. The daemon records the verdict
  against the head that it was for. Thus a move of the review opens it again.
  `await_review` shows the verdict first, because it decides what the agent does
  next.

What remains:

- **A notification that the agent answered** now works. The list shows a dot,
  the tab title shows a count, and the favicon shows a dot. When you open the
  review, they go away. The browser keeps the seen state. The key is
  `agentActivity`, not a time. Thus your own comment does not mark the review as
  unread for you.
- **Live updates** are done for the list. yart polls the list every ten seconds,
  thus the signal comes when the window does not have focus. The open review
  page does not poll. It gets new data only when it gets focus. Thus a comment
  that the agent answers while you read the diff shows when you come back to the
  window, not at once. Server-sent events would solve the two problems, and the
  poll could go. Do this when a page that is not current starts to cause
  problems.
- **Tabs**, when there is a reason to change between reviews.
- **Replies to a submission** now work. A submission has its own comments. You
  answer them in the UI, and the agent answers them with the `reply_to_verdict`
  tool.
- **What counts as an answer** is settled. A thread has an answer when the agent
  wrote the last comment in it or resolved it. A review shows `idle`,
  `in_progress` or `ready`. What remains is to show this outside the page: the
  dot below.
- **Tabs across worktrees** now work at the level of the storage. The daemon
  keeps reviews in the shared git directory of the repository. Thus each worktree
  sees one list, and each review records its worktree.

## 4. Pending reviews: what remains

You can now hold comments for a pending review, and send them with the verdict in
one write. You can also fold a directory in the tree, and it keeps its counts.
This section records only the problems that these changes did not solve.

- **Drafts are in one browser.** They are for each person and each device, as is
  the seen state. Thus a draft from one computer is not on a different computer,
  and when you clear the data of the site, the drafts go. This is correct for a
  local tool. Examine it again if more than one person uses one daemon.
- **You can only remove a stale draft.** A held comment on a line becomes stale
  when its file changes. Then you can only remove it. The line map that moves
  threads when a review moves could also move most drafts. This is the next
  step if people lose real comments when they remove them.
- **The open review page still does not poll.** A reply from the agent shows when
  the window gets focus, not while you read. This is the other half of live
  updates in item 3. It also causes a problem here. The tab title can count a
  review as unseen while that review is open, because the list polled and the
  page did not.

## Finding: agents use the tools, but do not start them on their own

We found this when we ran the MCP server in real sessions. We did not only think
about it.

**The tools work, and agents find them.** We told an agent "I want to review the
code". It had no instructions about yart. It found `start_review` and gave the
review a title of its own. It waited with `await_review`, replied to a comment,
and called `advance_review` after its fix. It did the full loop in the correct
order, with no help.

**Agents do not open a review on their own.** An agent has no reason to finish a
change and decide that someone must look at it. A different text in a tool
description does not seem to change that. A clear request from the person
starts it.

**A conflicting instruction makes the tool invisible.** Two runs failed before we
understood this, and the model did not cause the failures. A line in the global
`CLAUDE.md` of the user named a different review method. The model obeyed the
more specific instruction that it already had. Nothing showed the conflict. The
tools were connected and healthy all the time. When an agent ignores a tool, look
first for a conflicting instruction. Do not look first for a weak description.

To make agents start reviews on their own, a `Stop` hook is better than better
descriptions. A turn stops with a changed tree, and a review opens. No judgment
is necessary. We do not do this now. "I want to review the code" works, and a
hook on each turn with changes must not be noisy. If we make it, it must move an
existing review and not open a second review. It must do nothing when no files
changed. `yart` would also need a subcommand for hooks to call.

## Finding: the session that made a new tool cannot use it

An MCP server gives its list of tools when the client connects. This occurs one
time, when the session starts. A tool that you add during a session does not show
in that session. A restart of the server does not change this.

We found this when we made `reply_to_verdict`. The agent that wrote the tool, and
that was the best agent to try it on a real verdict, could not call it. The
workaround is to call the HTTP route of the tool. This examines the behavior,
but not the binding. Thus only the next session uses the binding.

Two results of this are important.

Each new MCP tool of this project is not available for the rest of the session
that adds it. This is not a reason to add no tools. But a tool must not be the
only way to get to a new function. The HTTP route is the simple interface, and
the tool is a thin wrapper. This made the problem easy to solve. Keep this as a
rule.

It also limits how much an agent can test its own MCP work. The tests of the
tools in `packages/mcp` run against a real daemon and test the tool itself. These
tests take the place of a real session. Thus they are more important here than
they seem when you write them.

## Syntax highlights

**Done.** Shiki reads the two sides of each open file in full. Each row takes the
tokens of its line. A removed line takes them from the base, and all other lines
from the head. The colors are CSS variables in `tokens.css`, for the two themes.
The highlighter and each grammar load only when a review needs them. yart reads
a file without an extension from its `#!` line. A row whose tokens do not spell
out its text exactly shows as plain text. The main bundle of the page becomes
31 kB larger, because of the list of languages. The rest comes on first use.

What remains:

- ~~**Color files when they come near the screen.**~~ Done. yart gets and colors
  a file when it comes within approximately two screens of the viewport. On a
  review of 69 files, the page gets 4 files when it loads, not 69. It gets the
  rest when you scroll to them.
- **Watch the size of the page.** Tokens increase the elements on each line. A
  review of 69 files had 76,781 elements, and 33,131 of them were tokens. To fold
  a directory still took approximately 25 ms, as before. Look first at a review
  that is much larger than that.

The reasons for the design, kept as a record:

The highlights had to keep the structure of one row for each line. Each row of
the diff is one line, with its own gutters and its own comment anchor. Thus the
markup of a highlighter must stay inside one line. Some markup opens a span on
one line and closes it on a different line. Such markup breaks the rows, or puts
a style on the wrong lines. Shiki can give output for each line. Simple highlighters
usually expect a full block.

Two more decisions were necessary. yart highlights the file, not the diff. The
`+` and `-` markers are ours, and a grammar must not read them as source. Also,
the colors come from the design tokens in the two themes, not from a theme of
the highlighter. Without this, the diff would look different from the rest of
the interface.

The size is important. Grammars and themes are large, and a local tool must
start quickly. yart loads a grammar only for the languages in a review.

## Inline suggestions

A comment on a line can contain a suggestion: the new text for that line, or
for a range of lines. The UI shows the suggestion as a small diff in the
comment. The agent reads the suggestion over MCP and applies it. The person and
an AI reviewer can both write suggestions. GitHub writes a suggestion as a
fenced block with the name `suggestion`. yart can use the same format.

## Smaller things

- The daemon has no recovery after a crash and no log file. It stops if its port
  is in use.
- `GET /api/reviews/:id/diff` returns all files, with no limit. This is
  sufficient for changes of the size that agents make. A large refactor will be
  slow.
- Split view does not exist. The state exists, but only the unified layout shows.
  `hide_unchanged` in the same slice is also not used. Each run now opens on its
  own, from its band, not from one switch. A switch that opened all runs at the
  same time would get the full text of all files.
- `GET /api/reviews/:id/diff` now reads the head blob of each text file, and also
  makes the diff, to give the length of the file. Without the length, nothing
  can tell if a file continues after its last hunk. This is two git commands for
  each file, not one.
- typescript-eslint uses TypeScript 6, but all packages compile with TypeScript 7. Thus lint rules that use types see different inference than the compiler.
  Nothing is broken now. When TypeScript 7 is installed at the root of the
  workspace, typescript-eslint does not run.
