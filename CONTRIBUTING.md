# Contributing to VisualProof

## Requirements

VisualProof is to be distributed as an npm package, `visualproof`, whose `visualproof` command
runs the server. The package holds compiled JavaScript: Node does not run TypeScript from
`node_modules`. To run, it needs:

- Node 22.18 or later in 22, or 24.2 or later (the versions that run TypeScript as it is and
  have `import.meta.main`);
- elan, which installs each project's Lean toolchain. The project must have been built with
  `lake build`: VisualProof never builds it;
- Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`), which reads the library's PDFs;
- optionally XeLaTeX, which typesets the exported document.

## Working from a checkout

A checkout needs the same. Working needs no build step: Node runs the TypeScript in `src/` as it
is, and the page is bundled when the server starts, into the cache directory.

```bash
npm install
npm run typecheck
npm test                    # the whole suite, on the fixture's own toolchain
npm run test:toolchains     # the whole suite once per toolchain of test/toolchains.json
node src/server/main.ts serve <a built Lean project>     # then open http://127.0.0.1:4173/
```

The package is built (`npm run build`, scripts/build.mjs, which `npm pack` runs) into `dist/`:
the server compiled to JavaScript, laid out as `src/` is, and the page bundled beside it.
`test/package.test.ts` builds it into a temporary folder and runs it; CI also packs it, installs
it into a prefix of its own and serves the fixture with it. `npm install --global` straight from
a git URL does not work: npm leaves a link to a deleted folder for a package that is built before
it is packed. Pack it, then install the file.

## Tests

- Tests that need `lake` or XeLaTeX skip without them. Install elan: without `lake`, the tests of
  the extraction, the usage pass, the build status and Lean's hovers all skip.
- Tests write only into the system's temporary directory, never into the repository, your site
  folders or your cache.
- To try a change on a real project, point `--site` and `--cache` at scratch folders, so that
  nothing is written into a real site's review and history.

## Real projects

`node scripts/scale.mjs <built Lean project>...` serves each project with a site and caches of its
own in a temporary folder, cold then warm, and measures it: the time to the graph and to the end
of the usage pass, the most memory the server and its workers held, Lean's first answer, the
largest TCB among its theorems (or `--target`), its review set (`--export` typesets it), a
snapshot's graph. `--bin visualproof` measures an installed package instead of the checkout. The
manual's figures come from it, on these projects, each built at its commit:

| project | commit | Lean | what it is |
|---|---|---|---|
| [flt-regular](https://github.com/leanprover-community/flt-regular) | `bd81b78ba6` | v4.33.0-rc2 | the README's: 27 modules on Mathlib |
| [PrimeNumberTheoremAnd](https://github.com/AlexKontorovich/PrimeNumberTheoremAnd) | `c39a751132` | v4.34.0 | larger, on Mathlib |
| [cedar-spec](https://github.com/cedar-policy/cedar-spec)'s `cedar-lean` | `38d5204868` | v4.31.0 | without Mathlib; a `lakefile.lean` |
| [Sphere-Packing-Lean](https://github.com/math-inc/Sphere-Packing-Lean) | `1e98fb4` | v4.28.0 | 829 modules on Mathlib; the showcase until 2026-10-14 |
| [NavierStokesAndEuler](https://github.com/openai/NavierStokesAndEuler) | `f9e8bc5` | v4.34.0-rc2 | the showcase: 2,657 modules on Mathlib, read with `--root NavierStokes --root Euler` |

A project on Mathlib is built with `lake exe cache get && lake build`.

## Lean versions

The supported toolchains are those of `test/toolchains.json`: the last six or so stable releases,
and whatever the showcase project needs (v4.34.0-rc2), with v4.28.0 as the floor.

- A change to the extractor (`src/extractor/`), or to how the server runs Lean
  (`server/extract.ts`, `server/usage.ts`, `server/status.ts`, `server/hover.ts`), passes
  `npm run test:toolchains` on all of them.
- `test/fixture/` is a small Lean project whose answers are known. `test/compat.test.ts` compares
  each toolchain's extraction of it with `test/golden/fixture-graph.json`. The golden changes only
  on purpose (`npm run golden:update`, on the fixture's own toolchain); a difference Lean itself
  makes on some toolchains is listed in `test/golden/known-differences.json`, with its toolchains
  and its reason.

## Branches and releases

- `main` is always releasable: work goes on a short-lived branch and comes in by a pull request
  whose CI passed. Nobody pushes to `main` directly, and GitHub holds to it: `main` takes pull
  requests alone, once the test workflow's checks pass, administrators included, and is never
  force-pushed or deleted.
- A release is a tag on `main`, `vX.Y.Z`; a release candidate is `vX.Y.Z-rc.N`, published under
  npm's `next` tag, so that `npm install visualproof` never gets it. There is no long-lived
  release branch: a `release/X.Y` branch is made from its tag only if an older release must be
  patched, and fixes otherwise go into the next release only (SECURITY.md).
- Versions follow semantic versioning, 0.x until 1.0 (a minor version may break what is public
  until then). What is public, and so breaks only with the version saying so:
  - the command line: its commands and options;
  - the site folder (`--site`): the review's logs and what a site accumulates. A version that
    changes its form reads the old one, or moves it over, so that no review is lost;
  - the agents' API and the MCP server's tools (`docs/agent-api/`).
- Releasing, by the owner: update `CHANGELOG.md` (the owner's own file, a `## ` heading naming the
  version), the version in `package.json` and `CITATION.cff`, merge, then tag `main` and push the
  tag. `.github/workflows/release.yml` takes it from there: it checks that the tag, both files and
  the changelog agree and that the tag is on `main`, runs the suite, publishes to npm with
  provenance (a release candidate under `next`), and makes the GitHub release from the changelog's
  section. It publishes in the `npm` environment of the repository, which only `v*` tags may use and
  whose runs the owner approves, by npm's trusted publishing: npm takes no token for `visualproof`.
  The trusted publisher (workflow `release.yml`, environment `npm`) is set up on npmjs.com, and
  expires unless a release publishes through it within 48 hours, so it is set up just before one.
- AI agents work on branches: they never push to `main`, tag, or publish.
