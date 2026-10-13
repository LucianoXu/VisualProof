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

## Lean versions

The supported toolchains are those of `test/toolchains.json`: the last six or so stable releases,
and whatever the showcase project needs (v4.28.0 at least).

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
  whose CI passed. Nobody pushes to `main` directly.
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
- Releasing, by the owner: update `CHANGELOG.md` (the owner's own file), the version in
  `package.json` and `CITATION.cff`, merge, then tag `main` and push the tag. Publishing to npm
  from the tag, with provenance, and the GitHub release from the changelog are to be set up in CI
  before the first release.
- AI agents work on branches: they never push to `main`, tag, or publish.
