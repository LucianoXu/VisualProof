# Contributing to VisualProof

## Requirements

VisualProof is to be distributed as an npm package, `visualproof`, whose `visualproof` command
runs the server. The package holds compiled JavaScript: Node does not run TypeScript from
`node_modules`. To run, it needs:

- Node 22.18 or later in 22, or 24.2 or later (the versions that run TypeScript as it is and
  have `import.meta.main`);
- elan, which installs each project's Lean toolchain. The project must have been built with
  `lake build`: VisualProof never builds it — but a branch it follows (`serve <git URL>`,
  SPEC/DeploySpec.md), which it builds itself, in its own clone, and which needs git;
- Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`), which reads the library's PDFs;
- optionally XeLaTeX, which typesets the exported document.

## Working from a checkout

A checkout needs the same. Working needs no build step: Node runs the TypeScript in `src/` as it
is, and the page is bundled when the server starts, into the cache directory.

```bash
npm install
npm run typecheck
npm test                    # the whole suite, on the fixture's own toolchain
npm run test:toolchains     # the tests the toolchain can change, on the oldest and the newest
                            # toolchain of test/toolchains.json (-- --all: on every one)
npm run test:updates        # the update path end to end, against a registry of its own
npm run test:e2e -- --showcase <flt-regular checkout>   # a smoke run in a real browser
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
- `test/engines.test.ts` lays the fixture and the flt-regular showcase out in Chromium, and in
  Firefox and WebKit where Playwright has them, and checks that every engine gives Node's layout to
  the last bit. It needs Playwright (as below, "Real projects"), and skips without it.
- Tests write only into the system's temporary directory, never into the repository, your site
  folders or your cache.
- To try a change on a real project, point `--site` and `--cache` at scratch folders, so that
  nothing is written into a real site's review and history.
- `scripts/e2e/harness.mjs` is a small library for trying a change in a real browser, as a
  scenario does: a server of this checkout on a built project — the flt-regular showcase with its
  site copied in, or another on a new site — on a free port, with or without a key, `--public`,
  `--public-url` (`serve`); the people it lets in, each in a browser context of its own (`guest`
  with a name, `invited` by a personal link, `reader` by a read-only link, `visitor` of a public
  site); agents' tokens at a level and the agents' API asked with them (`server.agent`); pages in
  light or dark, on a desktop or a phone, the board waited for; screenshots numbered in the order
  they are taken (`camera`). Each server's site, key, log and PID are in a new folder under the
  system's temporary folder, its cache in one kept there between runs (or a folder you give, which
  it writes: never in the repository or VisualProof's homes), and it is stopped by that PID.
  `npm run test:e2e -- --showcase <flt-regular checkout> [--cache dir] [--port n] [--headed]` runs
  `scripts/e2e/smoke.mjs`: two people, an agent, a message, a screenshot of each page in each
  theme, a read-only reader, a phone, a public site; copy it to start a scenario of your own. It
  needs Playwright (as below, "Real projects"), and is not part of `npm test`.

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

`visualproof artwork` (ExportSpec decision 21) draws with fonts the package ships as TrueType
(`src/assets/webfonts/ttf/`) and measures text by their advance widths
(`src/assets/webfonts/metrics.json`). Both are made from the page's WOFF2 files by
`scripts/artfonts.py`, which needs Python 3 with fontTools (`python3 -m venv .venv && .venv/bin/pip
install fonttools brotli`, outside the repository): run it again whenever the page's fonts change, and
commit what it writes. The PNG is drawn by resvg's WebAssembly build (`@resvg/resvg-wasm`).

`node scripts/artwork-batch.mjs <batch.json> [--out <dir>] [--headed]` makes pictures of many
boards in one go (ExportSpec decision 20): per job, a server, its key (or key file), an artwork
recipe and a name; the file's head comment says its format. It needs Playwright, which the package
does not depend on: `npm install --no-save playwright && npx playwright install chromium` (or point
`VP_CHROMIUM` at a Chromium of your own).

`node scripts/docs-figures.mjs <flt-regular checkout> [--cache dir] [--only name]` makes the
documentation's figures again (`docs/images/tcb-view-*.webp`, in the README and the manual's
Concepts): each is a recipe the script holds, drawn by this checkout's `visualproof artwork` from a
copy of the flt-regular showcase's site, on the build it serves (`showcase/flt-regular/setup.sh`),
then written as WebP by ImageMagick. The same build, site and recipes make the same files.

`node scripts/readme-figures.mjs --sphere-packing <dir> --flt-regular <dir> --prime-numbers <dir>
--navier-stokes <dir> --cedar <dir> --showcase <dir> [--cache dir] [--only name,…]` makes the
README's pictures again. The five posters (`docs/images/artwork-*.webp`) are each a recipe the
script holds, drawn by this checkout's `visualproof artwork` without a site from a project of the
table above, built at its commit (`--cedar` is cedar-spec's checkout, whose `cedar-lean` is drawn),
then 640 pixels wide, and at its full size (`artwork-*-full.webp`), which the README's poster opens.
The board (`docs/images/board.webp`) is the flt-regular showcase served by this
checkout on a copy of its site (`--showcase`, its build at `b8a5f23`), Alice's page in the middle of
the review taken in a headless Chromium, 1440 × 900 at twice the pixels; its dates are the page's,
on the real clock. Only the pictures asked for need their checkouts; the board needs Playwright, as
above, and every picture ImageMagick. The same builds, recipes and ImageMagick make the same files.

The tips' films (GuideSpec) are made by
`npm run tips:record -- --sphere <dir> --showcase <dir> --film <dir> [--cache <dir>] [<id>…]`: each
storyboard (`scripts/tips/storyboards/`) played on a server of this checkout, in a headless Chromium
whose clock moves a frame at a time, light theme, Kind palette. The tour is one film in thirteen
chapters of a review on Sphere-Packing-Lean (`--sphere`, built, on a site made empty for it),
2560×1600 at 30 frames a second, with captions. The film itself is not kept in the repository: it
is written to `--film` (`tour.mp4` and its `tour.mp4.sha256`) and published as a release's asset.
The repository keeps `src/assets/tips/tour.json` (the film's name, digest, size and length, its
chapters and its captions, of which the server makes the WebVTT), its poster `tour.webp` and
each chapter's key frame `tour-<chapter>.webp`. Its agent's lines are requests to the agents' API
the recorder makes, and the paper it adds is `scripts/tips/review-notes.tex`, typeset then by
XeLaTeX. The phone's gestures are one clip kept here, on the flt-regular showcase (`--showcase`, at
`b8a5f23`, `showcase/flt-regular/setup.sh`). It needs Playwright as above, XeLaTeX and Poppler;
`--cache` keeps the extractions between runs. Without ids named, it makes all of them.

A film is recorded chapter by chapter, by several processes at once (`--jobs <n>`; by default one
for four of the machine's threads and 4 GB of its free memory, eight at most here): each has a
server on a site of its own and a Chromium of its own, plays the storyboard from its start without
taking frames up to its chapters — the page doing all it does when they are taken, the board's
drawing apart — then takes those, each encoded from a key frame of its own. The film is the
chapters' samples one after another, nothing encoded again (`scripts/tips/film.mjs`). A chapter
recorded so is the same chapter as recorded in sequence: frames are taken at the page's own pixels
through Playwright (a capture at another scale lays the page out again, and a pixel it rounds
otherwise stays), and most chapters compared were the same to the pixel. Two recordings, of a
chapter alone or in sequence, are the same to within a few pixels a few levels apart, but for the
agent's token and where the page waits for the machine (Lean's language server, an agent's answer,
a download saved), a few frames earlier or later; the file's head comment says the rest.

- `--chapters <c>,…` records those chapters alone and splices them into the film that was: `--film`
  must hold the film `tour.json` pins. The other chapters are kept to the byte, those after a chapter
  of another length moved, with their captions; only the recorded chapters' stills are written.
  A storyboard change records its chapters only.
- `--preview` makes a quick film for writing a storyboard, at half the size and 15 frames a second,
  beside the film (`tour.preview.mp4`, `tour.preview/` with its data and stills), never into the
  repository: never for a release, its timings are not the film's. `--chapters` works on it too.
- `--frames <dir>` keeps every frame taken as a JPEG (`<dir>/tour/<chapter>/`, and by its number in
  the film in `<dir>/tour/`, for the trailer and contact sheets); `TIPS_PROFILE=1` says where each
  process's time went.

On this machine (an i9-13900, 32 threads, 62 GB; 2026-10-21) the whole tour took 27 minutes in one
process before; now 8½ with eight (24½ in one), one chapter recorded again 3 to 4 minutes, and a
preview 3 minutes for the whole tour, 1½ for a chapter. `test/tipsclips.test.ts` checks every storyboard against
the page without a browser, the tour's chapters, captions and stills, and the taking apart and
joining of films.

## Lean versions

The supported toolchains are those of `test/toolchains.json`: the last six or so stable releases,
and whatever the showcase project needs (v4.34.0-rc2), with v4.28.0 as the floor.

- `npm run test:toolchains` runs the tests whose answers can depend on the toolchain once per
  toolchain: the test files that import `test/fixturecopy.ts`, which build the fixture with the
  toolchain under test (`VP_TOOLCHAIN`): the extraction and its golden, the usage pass, the build
  status, Lean's hovers, a branch followed and built, among others. The rest of the suite runs no
  Lean and answers the same on every toolchain; `npm test` runs it once, and `test/matrix.test.ts`
  keeps both true. Locally it runs the oldest and the newest toolchain, at once: every difference
  Lean has made so far (`known-differences.json`, the tests that ask `leanAtLeast`) shows on one
  of them. `-- --all` runs every one, two at a time (`-- --jobs N`: N), and `-- v4.31.0` that one
  alone.
- A change to the extractor (`src/extractor/`), or to how the server runs Lean
  (`server/extract.ts`, `server/usage.ts`, `server/status.ts`, `server/hover.ts`,
  `server/children.ts`, and `server/deploy.ts`, which builds a branch the server follows), passes
  `npm run test:toolchains` locally, and CI runs those tests on every toolchain before it is
  merged: on every pull request, and every week (`toolchains.yml`; its `toolchains` check stands
  for every toolchain's, and `main` requires it). The suite (`test.yml`) runs once per pull request
  and once on `main` as a merge lands, which is what a release then checks. The newest Lean
  release and release candidate run every week only: news of the next release, not a pull
  request's failure.
- A change to how the server follows its releases (`server/updates.ts`, `server/supervise.ts`,
  `web/src/reload.ts`, the stopping in `server/main.ts`) passes `npm run test:updates`: the package
  built as 8.0.0, its patch 8.0.1 and a broken 8.0.2, published to a registry the script serves on
  this machine; 8.0.0 installed from it, the patch taken with a page open on it (which reloads where
  it was, with Playwright installed as above), the broken one set aside. `VISUALPROOF_UPDATE_TEST_MS`
  shortens the server's waits for it, and is honoured only where npm's registry
  (`npm_config_registry`) is a loopback address, as the script's is.
- `test/fixture/` is a small Lean project whose answers are known. `test/compat.test.ts` compares
  each toolchain's extraction of it with `test/golden/fixture-graph.json`. The golden changes only
  on purpose (`npm run golden:update`, on the fixture's own toolchain); a difference Lean itself
  makes on some toolchains is listed in `test/golden/known-differences.json`, with its toolchains
  and its reason.

## Branches and releases

- `main` is always releasable: work goes on a short-lived branch and comes in by a pull request
  whose CI passed. Nobody pushes to `main` directly, and GitHub holds to it: `main` takes pull
  requests alone, once the test workflow's checks and the toolchains' (`toolchains`) pass,
  administrators included, and is never force-pushed or deleted.
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
- **A patch release changes none of these.** Servers take a patch of the minor they run by
  themselves, unattended (`--updates auto`, SPEC/UpdateSpec.md), so a patch is fixes alone: no option
  gone or changed, no new form of the site, no change to the agents' API — and no change of the Node
  versions it runs on (`engines`). Anything else waits for the next minor, which servers only tell of.
  A patch found broken is withdrawn by the owner with `npm deprecate visualproof@<version> "<why>"`:
  servers neither take nor tell of a deprecated release (one that took it already sets it aside only
  if it fails), and the next patch replaces it.
- Before a release, the documentation's figures and the README's pictures are made again where the
  board's drawing, the page or the showcase changed (`node scripts/docs-figures.mjs` and
  `node scripts/readme-figures.mjs`, "Real projects" above), and committed.
- Before a release, the tips' films are recorded again when a part of the page they show changed
  (`npm run tips:record -- <id>…`, or the tour's chapters that changed with `--chapters`, above), so
  that what they show is what the page does.
- Releasing, by the owner: one pull request carries the release — its work, the `CHANGELOG.md`
  section (the owner's own file, a `## ` heading naming the version) and the version in
  `package.json`, `package-lock.json` and `CITATION.cff` — rather than a stack of them and a release
  commit after; merge it, then tag `main` and push the tag. `.github/workflows/release.yml` takes it
  from there: it checks that the tag, the files and the changelog agree and that the tag is on
  `main`, that main's required checks passed on the tagged commit as it landed (else it runs the
  suite itself, and a commit whose checks failed is never released), publishes to npm with
  provenance (a release candidate under `next`), and makes the GitHub release from the changelog's
  section. It publishes in the `npm` environment of the repository, which only `v*` tags may use and
  whose runs the owner approves, by npm's trusted publishing: npm takes no token for `visualproof`.
  The trusted publisher (workflow `release.yml`, environment `npm`) is set up on npmjs.com, and
  expires unless a release publishes through it within 48 hours, so it is set up just before one.
- AI agents work on branches: they never push to `main`, tag, or publish.
