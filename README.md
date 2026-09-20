# yart

> **Y**et **A**nother **R**eview **T**ool

Local, GitHub-style code review for AI-generated diffs — inline comments loop back
to your agent over MCP.

## Why

Coding agents produce large diffs quickly. Reviewing them in terminal scrollback or
a flat `git diff` is painful: there is no file tree, no hunk navigation, and nowhere
to say "this line, specifically, is wrong."

Local diff viewers solve the reading half of that problem and then stop at a
**Copy prompt** button. yart closes the loop. Your comments travel back to the agent
as structured data over the Model Context Protocol, so the agent can act on them,
reply to them, and mark threads resolved — without anything being pushed to GitHub.

|                          | Copy-paste diff viewers    | yart                            |
| ------------------------ | -------------------------- | ------------------------------- |
| Who starts the review    | You, manually              | The agent, via a tool call      |
| How comments travel      | Prose blob, pasted         | Structured `{file, line, side}` |
| Agent can reply / resolve | No                         | Yes                             |
| State across rounds      | None                       | Threads persist                 |

The last row is the point. Review is a *loop* — change, review, comment, fix,
re-review showing only what is still open — and a clipboard has no memory.

## How it will work

```
Claude Code ─┐
             ├─ MCP shim (stdio) ─→ HTTP ─→ review daemon ─→ browser UI
Claude App ──┘                                    ↑
                                              you, commenting
```

The daemon is a separate long-lived process from the MCP shim. MCP servers live and
die with their client; the review UI needs to outlast a session and be shared by
more than one agent at a time.

Planned tool surface:

| Tool                | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `start_review`      | Open a review over a diff range, return its URL          |
| `await_review`      | Block until the review is submitted, return the comments |
| `get_review`        | Non-blocking read of current comments                    |
| `resolve_comment`   | Agent marks a thread addressed, with a note              |

## Status

Early — the scaffold is in place, the product is not.

- [x] pnpm workspace, React + TypeScript + Redux Toolkit
- [x] Design token foundation
- [x] Comment anchoring model
- [ ] Diff parsing and rendering
- [ ] Thread storage and review rounds
- [ ] Review daemon
- [ ] MCP server
- [ ] Clipboard export (fallback for non-MCP agents)

## Getting started

Requires Node 20+ and pnpm.

```sh
pnpm install
pnpm dev        # http://localhost:7777
```

Other scripts:

```sh
pnpm build      # typecheck, then production build
pnpm typecheck  # types only
pnpm lint       # ESLint, including the naming conventions
pnpm test       # unit tests
```

## Project layout

```
apps/
  web/              React UI
    src/
      app/          Redux store and typed hooks
      features/     Feature slices and components
      styles/       Design tokens and reset
packages/
  core/             Domain model — anchoring, threads (no I/O)
                    (reserved: daemon, MCP server)
```

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

| State      | Meaning                                                 |
| ---------- | ------------------------------------------------------- |
| `current`  | Same file, same line as at creation                     |
| `shifted`  | The line survives, but moved or the file was renamed    |
| `outdated` | The line is gone; only `context` remains                |

State is *derived* from `origin` versus `anchor` on every pass rather than
accumulated, so a bug in one round cannot poison later ones.

Two deliberate judgment calls:

- **A rewritten line outdates its thread.** A line diff reports a modification
  as a deletion plus an insertion, so the anchor does not survive. This is
  correct — the comment referred to text that no longer exists — and doubles as
  a useful "the agent probably addressed this" signal.
- **Whitespace-only changes do not.** Line mapping ignores leading and trailing
  whitespace by default, because agents reformat constantly and a reindent that
  outdated every thread in a file would make review unusable. Set
  `ignore_whitespace: false` to opt out.

`reanchorThread` takes the line mapping as an *input* rather than computing it,
so the model is a pure lookup and does not care where the diff came from. A
mapping can be built from text with `buildLineMap` (which uses
[`diff`](https://github.com/kpdecker/jsdiff)), or later from `git diff` output —
swapping one for the other does not touch the anchoring logic.

## Conventions

Naming is a project requirement rather than a preference, and is enforced by
ESLint: variables and properties are `snake_case`, functions are `camelCase`,
types are `PascalCase`, constants are `UPPER_SNAKE_CASE`, and files and
directories are `kebab-case`. Properties stay
`snake_case` on serialized types too, so the JSON that travels over MCP matches
the source. The full rules and their exceptions are in
[`AGENTS.md`](AGENTS.md).

## Design system

yart does not use a component library. Every value the UI renders resolves to a
token in [`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css), and
components are styled with CSS Modules referencing those tokens rather than raw
literals. The palette is deliberately warm — ink on paper — instead of the cool
slate-and-blue that most developer tooling defaults to.

## License

MIT © Jens Karlsson
