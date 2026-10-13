# Contributing to VisualProof

## Requirements

VisualProof is to be distributed as an npm package, `visualproof`, whose `visualproof` command
runs the server. The package holds compiled JavaScript: Node does not run TypeScript from
`node_modules`. To run, it needs:

- Node ≥ 23.6;
- elan, which installs each project's Lean toolchain. The project must have been built with
  `lake build`: VisualProof never builds it;
- Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`), which reads the library's PDFs;
- optionally XeLaTeX, which typesets the exported document.

## Working from a checkout

A checkout needs the same. There is no build step: Node runs the TypeScript in `src/` as it is,
and the page is bundled when the server starts, into the cache directory.

```bash
npm install
npm run typecheck
npm test                    # the whole suite, on the fixture's own toolchain
npm run test:toolchains     # the whole suite once per toolchain of test/toolchains.json
node src/server/main.ts serve <a built Lean project>     # then open http://127.0.0.1:4173/
```

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
