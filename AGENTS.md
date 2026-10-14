# yart

## Naming conventions

These conventions are a project requirement. They are not a matter of style.
ESLint makes sure that the code obeys them (`@typescript-eslint/naming-convention`).

| Kind                                  | Case               | Example                  |
| ------------------------------------- | ------------------ | ------------------------ |
| Variables, function parameters        | `snake_case`       | `line_map`, `blob_sha`   |
| Object, interface and type properties | `snake_case`       | `anchor_state`           |
| Functions, methods, action creators   | `camelCase`        | `reanchorThread`         |
| Type aliases, interfaces, enums       | `PascalCase`       | `LineAnchor`             |
| Singletons                            | `PascalCase`       | `Store`                  |
| Constants                             | `UPPER_SNAKE_CASE` | `DEFAULT_CONTEXT_RADIUS` |
| Files and directories                 | `kebab-case`       | `line-map.ts`            |

Properties use `snake_case`, also on serialized types. `Thread` and `Comment` go
over MCP as JSON, and yart writes them to the disk. Thus the format on the wire
is the same as the format in the source.

### Exceptions

- **React components** use `PascalCase`. JSX reads a tag that starts with a
  lowercase letter as an HTML element, thus the framework makes this necessary.
  The file that holds a component uses `kebab-case`. For example, `app.tsx`
  exports `App`.
- **Root configuration files** keep the names that their tools expect:
  `README.md`, `LICENSE`, `TODO.md`, `AGENTS.md`, `CLAUDE.md`, `package.json`,
  `tsconfig.base.json` and `eslint.config.mjs`.
- **React hooks** are functions. They use `camelCase` with the prefix `use`.
- **Third-party API shapes** keep their own case. When you give an options
  object to an external library, use the spelling of the library. Then disable
  the rule on that line, and write a comment that gives the reason.
- **CSS class names** use `snake_case`, because CSS Modules makes them
  JavaScript properties.

## Code style

- Declare each callable as a const arrow: `const doThing = () => {}`. Do not
  use the keyword `function`. ESLint makes sure of this.

  The reason is that the code is easier to read. The reason is not speed.
  JavaScript lets code call a hoisted declaration above the line that defines
  it. Thus a reader cannot know that a name has a definition before the line
  that uses it. When each name has a definition before its first use, you can
  read each file from the top to the bottom. This rule does not decrease the
  work at run time. `const` and `function` both make bindings when the scope
  starts, and only the initialization is different.

  This rule does not apply to class methods or to object method shorthand.
  Hoisting is not a problem for them, and an arrow function changes `this`.

- Prettier sets the format: no semicolons, single quotes, and 100 columns at
  most. `pnpm format` applies the format, and `pnpm format:check` makes sure
  that all files have it. Prettier controls the layout. ESLint controls the
  names and the rules above. The two sets of rules do not overlap.
- Use American English in the code, comments, commit messages and
  documentation.
- Add a comment only when it gives information that the code does not give.
  For example: a constraint that is not clear, a condition that must always be
  true, or the reason for a workaround. Do not write again what the code says.

## Documentation and comments

Write all documentation and code comments in ASD-STE100 Simplified Technical
English (STE). STE makes text clear to all readers, also to readers whose first
language is not English. Obey these rules:

- Use one word for one meaning. Use the same word for the same thing each time.
- Use technical names as they are: code, file names, commands and product
  names.
- Write instructions in sentences of 20 words or fewer. Write descriptions in
  sentences of 25 words or fewer.
- Write one instruction in each sentence. Use the imperative: "Run the tests",
  not "The tests should be run".
- Use the active voice. Say who or what does the action.
- Use only the simple tenses: present, past and future.
- Do not use words that end in -ing as nouns or adjectives, except in technical
  names.
- Keep the articles "a", "an" and "the".
- Give each paragraph one topic, in six sentences or fewer.
- Use a list for a sequence of steps or a set of items.
- Do not use slang, idioms or figures of speech.

This project applies the writing rules of STE. It does not yet examine each word
against the STE dictionary. Write all new text in STE. The existing text
changes to STE in steps.

## Git

- Use conventional commits in lowercase: `type: description` or
  `type(scope): description`.
- Do not commit before the author examines the diff.
