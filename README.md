<div align="center">

<img src="apps/web/public/logo.svg" width="88" alt="yart" />

# yart

**Y**et **A**nother **R**eview **T**ool — local, GitHub-style code review for
AI-generated diffs, with inline comments that loop back to your agent over MCP.

[![CI](https://github.com/J3MPA/yart/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/J3MPA/yart/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/J3MPA/yart?sort=semver&label=release)](https://github.com/J3MPA/yart/releases/latest)
[![Latest pre-release](https://img.shields.io/github/v/release/J3MPA/yart?include_prereleases&sort=semver&label=pre-release)](https://github.com/J3MPA/yart/releases)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey)](#using-yart)
[![License: MIT](https://img.shields.io/github/license/J3MPA/yart)](LICENSE)

[Quick start](#quick-start) · [Using yart](#using-yart) ·
[Developing yart](#developing-yart) · [How it works](#how-it-works)

</div>

## Quick start

```sh
# Install the app and its two commands (during the beta, see Installing below)
curl -fsSL https://github.com/J3MPA/yart/releases/latest/download/install.sh | sh

# Let Claude Code use it
claude mcp add -s user yart -- ~/.local/bin/yart-mcp
```

Then tell your agent you want to review its changes. A review opens in the yart
window; comment on lines, submit, and the agent answers, fixes, and asks you to
look again — with every comment following the line it was on.

## Why

Coding agents produce large diffs quickly. Reviewing them in terminal scrollback or
a flat `git diff` is painful: there is no file tree, no hunk navigation, and nowhere
to say "this line, specifically, is wrong."

Local diff viewers solve the reading half of that problem and then stop at a
**Copy prompt** button. yart closes the loop. Your comments travel back to the agent
as structured data over the Model Context Protocol, so the agent can act on them,
reply to them, and mark threads resolved — without anything being pushed to GitHub.

|                           | Copy-paste diff viewers | yart                            |
| ------------------------- | ----------------------- | ------------------------------- |
| Who starts the review     | You, manually           | The agent, via a tool call      |
| How comments travel       | Prose blob, pasted      | Structured `{file, line, side}` |
| Agent can reply / resolve | No                      | Yes                             |
| State across rounds       | None                    | Threads persist                 |

The last row is the point. Review is a _loop_ — change, review, comment, fix,
re-review showing only what is still open — and a clipboard has no memory.

## Features

- **Reviews your agent opens and answers.** The agent starts a review with a
  tool call, waits for your verdict, replies on each comment, resolves what it
  fixed, and moves the review onto its new commits.
- **Comments that survive change.** Each comment is anchored to the content it
  was written on, so it follows its line through edits and is marked outdated
  only when that line is gone.
- **A diff made for reading.** A file tree, collapsed context that opens in
  place, syntax highlighting, files marked reviewed, and comments held for one
  submission with a verdict.
- **Knowing when to look.** A notification and a dock badge when the agent has
  answered, and a sign of how far it has got.
- **Every repository, one place.** One daemon serves them all, with reviews kept
  in each repository's own `.git`, so nothing appears in `git status`.
- **A desktop app**, installed, updated and removed with one command each, and
  needing neither Node nor npm.

Planned: exporting a review to the clipboard, for agents that do not speak MCP.

## How it works

```mermaid
flowchart LR
    CC["Claude Code"]
    CD["Claude Desktop"]
    MCP["MCP server<br/>@yart/mcp"]
    DAEMON["Review daemon<br/>@yart/daemon"]
    UI["Review UI<br/>apps/web"]
    HUMAN(["You"])
    GIT[("git")]
    STORE[("reviews<br/>.git/yart")]

    CC -- stdio --> MCP
    CD -- stdio --> MCP
    MCP -- HTTP --> DAEMON
    HUMAN --> UI
    UI -- "HTTP /api" --> DAEMON
    DAEMON -. serves .-> UI
    DAEMON -- "diff, blobs" --> GIT
    DAEMON -- threads --> STORE
```

The daemon is a separate, long-lived process from the MCP server. MCP servers live
and die with their client, while a review has to outlast a session and be shared by
more than one agent at once — so the state belongs in a process neither client owns.
Both agents talk to the same daemon, and the first tool call starts one if none is
listening.

### The loop

Review is a loop rather than a single pass, which is the whole reason the anchoring
model exists:

```mermaid
sequenceDiagram
    actor You
    participant Agent
    participant MCP as MCP server
    participant Daemon

    Agent->>MCP: start_review(base)
    MCP->>Daemon: POST /api/reviews
    Daemon-->>Agent: review id and URL

    You->>Daemon: comment on a line
    You->>Daemon: submit review

    Agent->>MCP: await_review(id)
    MCP->>Daemon: poll until submitted
    Daemon-->>Agent: open comments, with context

    Note over Agent: changes the code and commits

    Agent->>MCP: advance_review(id)
    MCP->>Daemon: POST /advance
    Daemon->>Daemon: re-anchor every thread
    Daemon-->>Agent: what shifted, what went outdated
```

## Using yart

yart runs on macOS, as an app carrying the two commands an agent and a terminal
need. Installing it needs neither Node, npm nor `sudo`.

> yart is in beta. Until the first stable release, the command below finds
> nothing to install: install the newest
> [pre-release](https://github.com/J3MPA/yart/releases) from its own URL, as
> shown after it.

### Installing

```sh
curl -fsSL https://github.com/J3MPA/yart/releases/latest/download/install.sh | sh
```

That puts `yart.app` in `~/Applications` and links `yart` and `yart-mcp` into
`~/.local/bin`, and says so if that directory is not on your `PATH`.

A pre-release, such as a beta, is installed from its own release rather than
the latest — the installer attached to each release installs that release:

```sh
curl -fsSL https://github.com/J3MPA/yart/releases/download/v0.1.0-beta.1/install.sh | sh
```

Install with `curl` rather than by downloading the zip in a browser. A browser
marks what it downloads as quarantined, and macOS then refuses to open the app
("Apple could not verify yart is free of malware"), because it carries a free
ad-hoc signature rather than a paid, notarized one. `curl` does not mark it.

### Connecting your agent

```sh
claude mcp add -s user yart -- ~/.local/bin/yart-mcp
```

The path is absolute because Claude Code starts MCP servers with its own
environment, which may not include your shell's `PATH`. Claude Desktop and other
clients are covered under [Registering it](#registering-it).

Then ask for a review — saying you want to review the code is enough. An agent
will not open one on its own, since deciding a change is ready to look at is not
a judgement it has a reason to make.

### Reviewing

A new review opens in the yart window. Comment on any line, hold comments to send
with a verdict, mark files reviewed as you go, and submit: the agent reads your
comments, answers them, and advances the review onto its fixes, with every
comment following the line it was on. The window lists reviews from every
repository yart has served.

The same reviews are at `http://localhost:7777` in a browser. The app and a
browser keep their own seen state and drafts, so moving between them starts
those afresh.

### Cleaning up approved reviews

**Settings**, linked from the review list, choose what happens to a review once
you approve it: keep it, archive it, or delete it. Keeping is the default. It
happens a minute after the approval, so that an agent waiting on the review
reads your verdict first, and not at all if you reopen the review in that
minute. The choice is kept by the daemon in `~/.yart/settings.json`, so it
applies in the app and in any browser alike.

Reviews can also be archived or deleted in bulk: tick them in the list and use
the actions above it.

### Notifications and the dock badge

When the agent answers on a review, yart raises a notification and its dock icon
counts the reviews waiting for you. Only reviews already opened in the app count,
since one never opened has nothing to have changed since.

The badge starts off. Turn on **Badge application icon** under System Settings →
Notifications → yart, which lists yart once it has sent its first notification.

### Updating

```sh
yart up
```

Installs the latest release over the current one, stopping and restarting yart
around it. Agent sessions already running keep the old `yart-mcp` until they
restart.

### Uninstalling

```sh
yart uninstall
```

Stops yart and removes the app and its two commands. Seen state and drafts are
kept unless you pass `--purge`, since a draft is something you wrote. Reviews are
never touched: they live in each repository's `.git/yart`. It prints the
`claude mcp remove` command to finish with.

## Developing yart

Requires Node 20+ and pnpm.

```sh
pnpm install
pnpm build      # the daemon serves the built UI, so build it first
```

### Using a clone as your yart

```sh
pnpm --filter @yart/daemon link --global
pnpm --filter @yart/mcp link --global
```

That puts `yart` and `yart-mcp` on your `PATH`, so any repository can be reviewed
by running `yart` inside it — no paths, no flags:

```sh
cd ~/some-other-project
yart            # http://localhost:7777
```

There is no build step for the commands themselves: their entry points are
TypeScript with a `#!/usr/bin/env -S node --experimental-strip-types` shebang, so
Node strips the types as it loads them.

Undo with `pnpm uninstall --global @yart/daemon @yart/mcp`.

Alongside an installed yart, leave that one registered with Claude Code and
register the clone in local scope from inside it, pointed at the development
daemon. Local scope wins over user scope for a server of the same name, so
agents in this repository talk to the clone and every other project keeps the
installed yart:

```sh
claude mcp add -s local yart -- node --experimental-strip-types \
  "$PWD/packages/mcp/src/cli.ts" --port 7778
```

### Running it

Open `http://localhost:7777`, or let an agent open a review for you with the
`start_review` tool. The daemon takes `--port` and `--repo`, and stores reviews
under the repository's git directory so nothing appears in `git status`. Linked
worktrees share one store, so a review opened in any worktree is visible from
all of them and records which one it belongs to.

### Developing against yart's own diff

```sh
pnpm dev:actual
```

Starts the daemon and Vite, opens a review over whatever this branch changed
against its merge base with `main`, and prints the URL. Pass a revision to review
against something else.

It develops against a real diff rather than a fixture, because a fixture only
ever exercises the shapes it happens to contain — the repository's own history
supplies renames, deletions, binary files and long hunks for free. Re-running on
the same branch advances the existing review instead of opening another, so
comments left earlier follow your new commits and the re-anchoring is exercised
every time you iterate.

Its daemon listens on 7778, leaving 7777 to the yart you use, so developing
yart never talks to a daemon running some other version of its code. A daemon
already on 7778 is reused only when it runs this checkout's code, which it
reports on `/health`; one from another checkout is an error, and so is a Vite
already holding 5173.

```sh
pnpm dev:desktop
```

The same, but the review opens in the desktop shell from `apps/desktop` rather
than in a browser, with the UI still hot-reloading inside it. The shell keeps
its storage in a `yart-dev` profile, apart from an installed yart's, and
quitting it ends the session. Changes to the shell's own main process need a
restart.

For UI work without a review, `pnpm dev` runs Vite alone on 5173 with `/api`
proxied to the daemon on 7777.

Other scripts:

```sh
pnpm build      # typecheck, then production build
pnpm typecheck  # types only
pnpm lint       # ESLint, including the naming conventions
pnpm format     # Prettier
pnpm test       # unit tests
pnpm package:desktop [--arch arm64|x64] [--version <version>]
```

### Packaging and releasing

`package:desktop` builds `yart.app` into `apps/desktop/out`, ad-hoc signed,
with a zip and its SHA-256 checksum beside it. The daemon, the MCP server and
the app are bundled with esbuild into a copy of the workspace's layout, so the
daemon finds its UI and version where it would in the workspace. The app carries
`yart` and `yart-mcp` in `Contents/Resources/bin`, which run the bundles on the
app's own Node.

Pushing a `v*` tag runs `.github/workflows/release.yml`, which packages both
architectures on one Apple Silicon runner and publishes a release with the zips,
their checksums and the install scripts. A version with a suffix, such as
`v0.2.0-beta.1`, is published as a pre-release: visible and installable from its
own URL, but never what "latest" points at.

### Project layout

```
apps/
  desktop/          Electron app, its packaging, and the commands it carries
  web/              React UI
    src/
      app/          Redux store and typed hooks
      features/     Feature slices and components
      styles/       Design tokens and reset
packages/
  core/             Domain model — anchoring, threads (no I/O)
  daemon/           Git adapter, review store, HTTP API, CLI
  mcp/              MCP server — the agent's side of the loop
```

### Conventions

Naming is a project requirement rather than a preference, and is enforced by
ESLint: variables and properties are `snake_case`, functions are `camelCase`,
types are `PascalCase`, constants are `UPPER_SNAKE_CASE`, and files and
directories are `kebab-case`. Callables are const arrows rather than `function`
declarations, and Prettier owns formatting (no semicolons, single quotes, 100
columns). Properties stay
`snake_case` on serialized types too, so the JSON that travels over MCP matches
the source. The full rules and their exceptions are in
[`AGENTS.md`](AGENTS.md).

## Comment anchoring

Review is a loop, so a comment has to survive the code changing underneath it.
The model that makes that possible lives in `packages/core`.

A comment anchors to **`(blob_sha, line)`**, not `(path, line)`. Paths move and
line numbers shift, but a git blob's content is immutable, so a blob hash plus a
line number always denotes the same text. Each thread keeps three things:

- `origin` — where it was created. Immutable, the audit record.
- `context` — the commented line plus its neighbours, captured at creation. The
  only thing that survives if the anchor dies.
- `anchor` — where it points now, or `null` once the line is gone.

When the agent pushes a new revision, every thread is re-anchored against it and
lands in one of three states:

| State      | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| `current`  | Same file, same line as at creation                  |
| `shifted`  | The line survives, but moved or the file was renamed |
| `outdated` | The line is gone; only `context` remains             |

State is _derived_ from `origin` versus `anchor` on every pass rather than
accumulated, so a bug in one round cannot poison later ones.

```mermaid
stateDiagram-v2
    [*] --> current: comment created
    current --> shifted: line moved, or file renamed
    shifted --> current: line moved back
    current --> outdated: line rewritten or deleted
    shifted --> outdated: line rewritten or deleted

    note right of outdated
        Terminal. Re-anchoring never revives
        a thread, because any match would be
        a guess. The captured context is all
        that survives.
    end note
```

Two deliberate judgment calls:

- **A rewritten line outdates its thread.** A line diff reports a modification
  as a deletion plus an insertion, so the anchor does not survive. This is
  correct — the comment referred to text that no longer exists — and doubles as
  a useful "the agent probably addressed this" signal.
- **Whitespace-only changes do not.** Line mapping ignores leading and trailing
  whitespace by default, because agents reformat constantly and a reindent that
  outdated every thread in a file would make review unusable. Set
  `ignore_whitespace: false` to opt out.

`reanchorThread` takes the line mapping as an _input_ rather than computing it,
so the model is a pure lookup and does not care where the diff came from. A
mapping can be built from text with `buildLineMap` (which uses
[`diff`](https://github.com/kpdecker/jsdiff)), or later from `git diff` output —
swapping one for the other does not touch the anchoring logic.

## The daemon

`packages/daemon` is the long-lived process the UI and the MCP server both talk
to. It is deliberately separate from the MCP server: MCP servers live and die
with their client, while a review has to outlast a session and be shared by more
than one agent at once.

**One daemon serves every repository.** A request that opens a review names the
repository it is for, and the MCP server sends the one it was started in. It
used to be otherwise — a daemon was fixed to the repository it started in, and
every client reused whichever daemon was listening, so an agent in one project
could be handed a review of another's working tree without any error. The
daemon keeps one service per repository, keyed by the shared git directory so
that a repository's worktrees share one list, and remembers the repositories it
has served in `~/.yart` (or `YART_HOME`) so that a review in any of them can be
found by id after a restart. A request that names no repository gets the one
the daemon was started in, which keeps an agent on an older yart working. One
started outside any repository, as the desktop app starts it, has no such
default, and a request that names none is refused.

After an update, the daemon still running is the old one. The MCP server checks
`/health`, which now carries a version, and refuses an older daemon that serves
a different repository, with a message saying to stop it, rather than review
the wrong one.

**Writes must be JSON.** A web page on any site can send a "simple" cross-origin
POST to `localhost` without the browser asking first, and although it cannot
read the answer, the daemon would still act on it — in any repository a page
could name. Requiring `application/json` on every POST and PATCH makes such a
request one a browser must ask permission for, and the daemon never grants it.

**Only this machine can reach it.** The daemon listens on `127.0.0.1` rather
than on every interface, so nothing else on the network can reach it — and it
can read any file in any repository it has served.

It owns three things.

**A git adapter.** Revision ranges, changed files with the blob on each side,
rename detection, and blob contents. It also builds line maps from `git diff
--unified=0`, reading only hunk headers: everything outside a hunk is unchanged
and maps across with a running offset, everything inside is replaced and maps
nowhere. Using git rather than diffing text in process is faster and, more
importantly, means the tool that produced the blob hashes is the one comparing
them, so two implementations cannot disagree about what changed.

**Review state**, persisted as JSON under `.git/yart/reviews/`. Per-repository,
invisible to `git status`, and in a directory yart will never be asked to show.

**An HTTP API.**

| Route                                         | Purpose                             |
| --------------------------------------------- | ----------------------------------- |
| `POST /api/reviews`                           | Open a review in a named repository |
| `GET /api/reviews` · `GET /api/reviews/:id`   | List, or fetch one                  |
| `GET /api/reviews/:id/file?path=`             | Both sides of a file, for rendering |
| `POST /api/reviews/:id/threads`               | Comment on a line                   |
| `POST /api/reviews/:id/threads/:tid/comments` | Reply in a thread                   |
| `PATCH /api/reviews/:id/threads/:tid`         | Open or resolve a thread            |
| `POST /api/reviews/:id/submit`                | Hand the review back                |
| `POST /api/reviews/:id/advance`               | Move to a new head, re-anchoring    |

`advance` is where the loop closes: it diffs the old head against the new one,
builds a line map per changed file, and re-anchors every thread, so the next
round shows what is still open rather than starting over.

## The review UI

`apps/web` is what a human actually uses. The daemon serves it, so there is one
address for both the API and the pages, and a deep link to a review works
because unknown paths fall back to `index.html`.

The diff is rendered unified, with a gutter per side: a line has a number in the
base, in the head, or in both, and a comment attaches to whichever side the row
actually exists on — a removed line is addressed in the base, an added or
context line in the head. Hovering a row reveals a control to comment on it, and
threads open inline beneath the line they belong to.

**Hunks come from the daemon, not from diffing in the browser.** The temptation
is to send both file contents and diff them client-side, but then the rendered
diff and the anchors are computed by two different implementations, and when
they disagree a comment lands on the wrong line. The daemon parses `git diff`
and sends hunks with a line number already on each side.

Comments whose line no longer exists cannot sit anywhere in the diff, so the
file header lists them instead, above the hunks, with the text they were written
against. They are the record of a conversation and dropping them would be worse
than showing them out of place.

A sidebar lists the changed files as a tree, folding directory chains that hold
nothing but one child, with each file's added and removed totals and a count of
the threads still open on it. Clicking one brings it into view, and the file
being read is marked as you scroll, measured from the sections themselves so
that opening a run of context mid-page cannot put the mark out of step. Paths
are not safe as URL fragments, so the tree scrolls rather than links.

**Unchanged lines are recovered from the head blob, not from a wider diff.**
git describes only what changed, so everything between two hunks is absent from
the diff entirely. Rather than asking git for more context than anyone will
read, each run of hidden lines is drawn as a band where the `@@` header used to
be — carrying the enclosing function git named for the hunk below — and opening
one fetches the file's full text once and slices the lines out of it. Twenty at
a time from either end, or all of them when few enough remain. A line revealed
this way is an ordinary row and can be commented on like any other. Knowing
whether a file continues past its last hunk takes the file's length, which is
why the diff carries `head_line_count`.

## Drafting a review

A review is drafted, not dictated: a comment written on file 3 is often
withdrawn by the time file 20 explains it. So each comment form offers two
actions, as on GitHub. **Start a review** (or **Add to review** once one has
started) holds the comment; **Comment now** sends it on its own. Holding is the
primary action and the one Cmd+Enter takes, because it is the common case.

Held comments are drawn in place as Pending, and can be edited or dropped. They
live in the browser, per person and per device, and never reach the daemon
until the review is submitted — so an agent calling `get_review` cannot see a
comment its author has not sent. Submitting sends them all with the verdict in
one request, and the daemon writes them in one go or not at all: half a review,
some comments posted and the verdict not, would leave the agent reading
something its author had not finished.

**A held line comment is tied to its file, not to the review.** Its line number
was counted in one version of one file, so it records that file's blob and stays
good through any number of rounds that leave the file alone. If the file does
change, the comment is shown as stale in the submit panel, kept out of the diff,
and has to be dropped before submitting — drawing it at its old line number
would put it beside code it was never about. Replies are never stale, because
threads are re-anchored when a review moves. The daemon checks the same thing,
and also refuses a submission made against a head that is no longer current,
since a verdict passed on it says nothing about code the reviewer has not seen.

## Marking files reviewed

Each file has a **Reviewed** checkbox. Ticking it collapses the file and marks it
in the tree, whose header counts how many are done. File headers stick to the
top of the window, so the box is in reach at the end of a long file, where the
decision is made. A file can also be collapsed by hand without being reviewed.

**A reviewed mark is kept against the file's blob,** so if the agent changes the
file afterwards it stops counting as reviewed on its own and opens up again. A
tick that outlived the code it was given for would say something untrue.

Directories in the tree fold away too, and a folded directory keeps the added,
removed and open-thread counts of everything it hides. Folding a directory does
not hide its diffs: the tree is an index, not a filter.

## Answering a verdict

A verdict is the one thing in a review that used to have nothing to say back to
it. Line comments have threads; a summary left with `approved` or
`changes_requested` was write-only, so an agent that had already done the thing
being asked for, or disagreed with it, had to answer in whatever chat window it
happened to be in — which is the conversation leaving the tool.

A submission now carries its own comments. It is not anchored to a line, so this
is a plain list rather than a `Thread`, and it is addressed by submission id
rather than always landing on the latest: a review that has been round several
times has several verdicts, and a reply belongs to the one it answers.

## Knowing when to look again

Once a review is handed back, the question is not whether the agent is working
but whether it has finished. yart reports three states, derived rather than
stored:

| State         | What it means                                                    |
| ------------- | ---------------------------------------------------------------- |
| `idle`        | Nothing has happened since the verdict                           |
| `in_progress` | Answers or changes have appeared, but comments are still waiting |
| `ready`       | Nothing is waiting on the agent; worth opening again             |

A thread counts as answered when the agent spoke last, or when it was resolved.
Turning on who spoke last matters: a human replying to the agent's answer puts
the thread back in the agent's court, and a count that did not notice would
report the same work as finished twice.

`ready` deliberately does not require the code to have changed. An agent that
answers every comment by explaining why it disagrees has finished its turn just
as much as one that rewrote the file, and both need a person to look. Changes
with nothing answered are `in_progress`, not `ready` — moving the code is not an
invitation to re-read it while the questions are still open.

In the list this is one label, not two. The verdict and the agent's progress are
the same fact read at different moments — a verdict is given, then the agent
responds to it — so a review reads `open`, then its verdict, then `agent working`,
then `your turn`. Once the agent has moved, whose turn it is matters more than
what you decided, and the verdict is at the top of the page you are about to
open. How many comments have been answered is in the label's tooltip.

The unseen dot below answers a different question and does not replace this.
The dot means something is new since you looked; the label means whose turn it
is. They come apart when the agent has answered one comment of three — new, but
not yet your turn — and when you have glanced at a finished review and moved on,
which clears the dot but leaves the review waiting on you.

## Noticing that the agent has answered

The point of a local review tool is to work on something else while the agent
responds, and that only pays if you find out when it has. The list shows a dot
on a review that has moved since you last looked, the tab title carries a count,
and the favicon grows a dot — both of the last two because neither is enough
alone: a pinned tab shows no title, and a tab among twenty shows a favicon too
small to read a number on.

**Seen-ness is per person and per device, so it lives in the browser** and never
reaches the daemon. That also means an agent cannot mark its own work as read.
Storage can be absent or throw in a private window, so a failure degrades to
showing no dot rather than to a blank page.

**What is compared is not a timestamp.** `updated_at` moves when anyone touches
a review, so writing a comment would mark the review unread to the person who
wrote it. `agentActivity` counts what the agent has said and done — replies,
resolves and rounds — as one number that only grows, and a review is unseen when
that number is larger than it was when you last had the review open. Counting
rather than hashing means a stale marker can only under-report: the worst case
is a missed dot, never a dot that will not clear.

A review you have never opened shows no dot. There is no "since" to measure
from, and a list where everything shouts says nothing.

**The list is polled rather than refetched on focus.** The rest of the app
refetches when the window regains focus, which cannot deliver this signal: a
page nobody is looking at never regains focus. Ten seconds against a daemon on
localhost costs nothing, and browsers throttle timers in hidden tabs anyway,
which is exactly the case this is for.

## Reviewing uncommitted work

A review does not need a commit. By default `start_review` reviews the working
tree as it stands, including files git is not yet tracking, which is the state
an agent is in the moment it finishes and says it is ready.

That works by writing the working tree into a git tree object through a
throwaway index, so the caller's staging area is untouched, and pinning it under
`refs/yart/reviews/<id>`. Every file then has a real blob hash for comments to
anchor to, garbage collection cannot reap it, and the snapshot is immutable — so
comments stay where they were put while the files underneath keep changing.

Advancing such a review takes a new snapshot rather than a newer revision, so
the whole loop runs without anything being committed: comment, edit, advance,
and the comments follow their lines or go outdated.

## The MCP server

`packages/mcp` is how an agent drives a review. It is a shim: it holds no state
and makes no decisions, it translates MCP tool calls into daemon HTTP requests.

The first tool call starts a daemon if none is listening, so an agent does not
have to ask anyone to run one first. The daemon is spawned detached, because an
MCP server dies with its client and a review has to outlive that.

| Tool               | What the agent does with it                                 |
| ------------------ | ----------------------------------------------------------- |
| `start_review`     | Open a review after making changes; returns an id and a URL |
| `await_review`     | Block until the human submits, then read their comments     |
| `get_review`       | Read current state without blocking                         |
| `list_reviews`     | List reviews in this repository                             |
| `reply_to_thread`  | Explain a change, or push back on a comment                 |
| `reply_to_verdict` | Answer the summary left with the verdict                    |
| `resolve_thread`   | Mark a comment addressed                                    |
| `advance_review`   | Re-anchor every comment onto new commits                    |

**A new review opens in the yart app**, or in your browser when the app is not
installed — only for the daemon on 7777, since a link names a review but not
the daemon serving it. The one step of the loop that needs a
person is the person looking, and relying on an agent to relay a URL is how that
step gets skipped — it did, repeatedly, before this existed. An empty review
opens nothing, since there would be nothing to read. Set `YART_NO_BROWSER=1`
where a window would be wrong: a container, a remote shell, or a second screen
you did not ask to have taken over.

Comments come back rendered as text rather than JSON, because the consumer is a
model deciding what to edit and a comment is easier to act on next to the code
it points at:

```
[ce53cb3a-…] a.txt:3  (moved from a.txt:2)
      alpha
  >   TARGET
      gamma
  human: this name is unclear
  agent: renamed it
```

`await_review` returns instead of hanging when its timeout passes, handing back
whatever has been written so far — a timeout is not a failure, and the agent can
simply call it again.

### Registering it

With Claude Code, see [Connecting your agent](#connecting-your-agent).

With Claude Desktop, add to its MCP configuration, with the absolute path to
`yart-mcp` (for an installed yart, `~/.local/bin/yart-mcp` with your home
directory written out):

```json
{
  "mcpServers": {
    "yart": {
      "command": "/Users/you/.local/bin/yart-mcp",
      "args": ["--repo", "/absolute/path/to/the/repository"]
    }
  }
}
```

Both connect to the same daemon, which is the point of keeping it a separate
process.

## Design system

yart does not use a component library. Every value the UI renders resolves to a
token in [`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css), and
components are styled with CSS Modules referencing those tokens rather than raw
literals. The palette is deliberately warm — ink on paper — instead of the cool
slate-and-blue that most developer tooling defaults to.

## License

MIT © Jens Karlsson
