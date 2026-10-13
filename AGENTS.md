# VisualProof

A web tool that shows a Lean codebase's declaration graph and the TCB of its theorems, which enables group collaboration and keeps an audit record.

This repository only contains the tool itself and the help documentation, not the website.
`README.md` is for people using it, `CONTRIBUTING.md` for people developing it (requirements,
commands, tests, Lean versions), and `SECURITY.md` says what it trusts and what it exposes.

## Layout

The tool is in `src/`; paths of code in its comments and in `SPEC/` are relative to it.

- `src/extractor/` — the Lean programs that turn a built project into graph JSON (`Extract.lean`) and
  find the notation and context each command is written in (`Usage.lean`).
- `src/server/` — the Node server: runs the extractor, lays out the graph, serves the page.
- `src/shared/` — code the server and the page both run (`shared/doc/`: the exported document).
- `src/web/` — the viewer.
- `src/mcp/` — VisualProof's MCP server, which agents run on their own machine.
- `src/assets/` — the exported document's style file and fonts.
- `test/` — the tests (`npm test`); `test/fixture/` is a small Lean project whose TCBs are known,
  `test/golden/` its extraction as every supported toolchain must give it.
- `SPEC/` — the specification and the decisions.
- `docs/` — the documentation.
- `scripts/` — scripts for development.
- `.github/` — CI.

## Invariants

- It never builds the codebase it shows, and writes nothing into it nor into this repository. What
  it writes goes in the site folder (`--site`: the review and what the site accumulates) and the
  cache (`--cache`).
- Lean's language server (hovers, and the agents' `describe` and `print`; `server/hover.ts`) is
  `lean --server` with the project's `LEAN_PATH`:
  - started in the project's `lean-server/` folder of the cache, which holds no lakefile, so it
    never runs `lake setup-file` and never builds the project;
  - its scratch file there, `Describe.lean`, only ever receives a name that passes `isDeclName`:
    anything else would be Lean source, and would run;
  - nothing is sent to it before its answer to `initialize` and the `initialized` notification
    (`start()`): a request sent earlier makes it exit.
- A change to the extractor or to how the server runs Lean passes `npm run test:toolchains`
  (`CONTRIBUTING.md`, Lean versions).
- A change to access, fetching by URL, uploads or how Lean is run keeps `SECURITY.md` true.
- `docs/agent-api/` is served to agents (`GET /api/agent/docs`, each topic as
  `GET /api/agent/docs/<topic>`; the topics are listed in `server/agentdocs.ts`): a change to the
  agents' API or to the MCP server's tools updates it in the same change, within the budgets
  `test/agentapi.test.ts` keeps (the entry, each topic, the tools list).

## General Guidelines

- Comments and documentation in files must be in English. But the chat in sessions should use the same language as the user.
- **NEVER** modify human-maintained files without permission.
- `SPEC/` is the ground truth: `SPEC/SPEC.md` is the owner's specification, the other `*Spec.md`
  files the decisions, which code comments cite by name ("ViewSpec decision 29"). Do not edit
  them without being asked; propose changes.
- Tests and scratch work go in the system's temporary directory, never in the repository. On a real
  project, point `--site` and `--cache` at scratch folders, so that a test never writes into a real
  site's review and history.
