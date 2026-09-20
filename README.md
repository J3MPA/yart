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
- [ ] Diff parsing and rendering
- [ ] Comment threads and anchoring
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
```

## Project layout

```
apps/
  web/              React UI
    src/
      app/          Redux store and typed hooks
      features/     Feature slices and components
      styles/       Design tokens and reset
packages/           (reserved: daemon, MCP server, shared types)
```

## Design system

yart does not use a component library. Every value the UI renders resolves to a
token in [`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css), and
components are styled with CSS Modules referencing those tokens rather than raw
literals. The palette is deliberately warm — ink on paper — instead of the cool
slate-and-blue that most developer tooling defaults to.

## License

MIT © Jens Karlsson
