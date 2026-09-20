# yart

## Naming conventions

These are a project requirement and are enforced by ESLint
(`@typescript-eslint/naming-convention`). They are not stylistic preferences.

| Kind                                  | Case               | Example                  |
| ------------------------------------- | ------------------ | ------------------------ |
| Variables, function parameters        | `snake_case`       | `line_map`, `blob_sha`   |
| Object, interface and type properties | `snake_case`       | `anchor_state`           |
| Functions, methods, action creators   | `camelCase`        | `reanchorThread`         |
| Type aliases, interfaces, enums       | `PascalCase`       | `LineAnchor`             |
| Singletons                            | `PascalCase`       | `Store`                  |
| Constants                             | `UPPER_SNAKE_CASE` | `DEFAULT_CONTEXT_RADIUS` |
| Files and directories                 | `kebab-case`       | `line-map.ts`            |

Properties are `snake_case` including on serialized types: `Thread` and `Comment`
travel over MCP as JSON and are written to disk, so the wire format matches the
source.

### Exceptions

- **React components** are `PascalCase`. JSX resolves lowercase tags as HTML
  elements, so this is required by the framework rather than chosen. The file
  holding one is still `kebab-case`: `app.tsx` exports `App`.
- **Root configuration files** keep the names their tooling expects —
  `README.md`, `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `package.json`,
  `tsconfig.base.json`,
  `eslint.config.mjs`.
- **React hooks** are `camelCase` with a `use` prefix, as functions.
- **Third-party API shapes** keep their own casing. When passing an options
  object to an external library, use its spelling and disable the rule on that
  line with a comment saying why.
- **CSS class names** are `snake_case`, since CSS Modules exposes them as
  JavaScript properties.

## Code style

- Callables are declared as const arrows: `const doThing = () => {}`. The
  `function` keyword is not used, and ESLint enforces this.

  The reason is readability, not speed. A hoisted declaration can be called
  above the line that defines it, so a reader cannot assume a name is already
  defined and has to hold open the possibility that it appears later. Requiring
  definition before use makes every file read procedurally, top to bottom, with
  no forward references to track. It does not avoid any runtime work: scope
  instantiation creates bindings for `const` and `function` alike, and only the
  initialization differs.

  Class and object method shorthand is unaffected, since neither is a hoisting
  question and arrows would change `this`.

- Formatting is Prettier's and is not a matter of taste: no semicolons, single
  quotes, 100 columns. `pnpm format` applies it and `pnpm format:check` verifies
  it. Prettier owns layout; ESLint owns naming and the rules above, and the two
  do not overlap.
- American English throughout: code, comments, commit messages, documentation.
- Only add a comment when it carries information the code does not: a non-obvious
  constraint, a subtle invariant, the reason behind a workaround. Do not restate
  what the code already says.

## Git

- Conventional commits, all lowercase: `type: description` or `type(scope): description`.
- Never commit without the author reviewing the diff first.
