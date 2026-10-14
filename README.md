# VisualProof

**See what a Lean theorem actually rests on.**

Lean checks that a proof is correct. It cannot check that the theorem says what you mean: that the
definitions in its statement mean what their names suggest. VisualProof shows exactly which
definitions those are, so that people, and AI agents, can read them, review them together, and
keep a record of the review.

<!-- A screenshot or a short video of the board goes here. -->

## What it does

- **The declaration graph** of a built Lean project, clustered by namespace or by file, and updated
  live as you rebuild.
- **The TCB of any theorem**: the definitions its statement rests on, followed through their bodies,
  instances and notation, and the axioms behind its proof. What lies only inside proofs is left
  out, since Lean has checked it.
- **A review together**: approve or comment on each declaration, mark targets and their key
  declarations, leave notes, link papers to declarations, and see what changed since an opinion was
  given. Everyone on the page sees it live.
- **AI agents as reviewers**, through a JSON API and an MCP server. They read, advise and annotate
  under their own names, and their opinions stay advice.
- **History**: every build is kept, and a past board can be browsed.
- **A printed document** of what a view holds: definitions in full, proofs left out, typeset with
  XeLaTeX.

## Requirements

- Node 22.18 or later in 22, or 24.2 or later.
- [elan](https://github.com/leanprover/elan), which installs each project's Lean toolchain. Lean
  v4.28.0 to v4.35.0 are supported.
- Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`).
- Optionally XeLaTeX, for the printed document.

The project must have been built with `lake build`: VisualProof only reads what the build left,
and never builds it.

## Try it

VisualProof is not on npm yet: install its `visualproof` command from a checkout, which packs it
as npm would. Here it is on [flt-regular](https://github.com/leanprover-community/flt-regular),
Fermat's Last Theorem for regular primes, built on Mathlib:

```bash
git clone https://github.com/LucianoXu/VisualProof
(cd VisualProof && npm install && npm pack && npm install --global ./visualproof-*.tgz)

git clone https://github.com/leanprover-community/flt-regular
(cd flt-regular && git checkout bd81b78ba6 && lake exe cache get && lake build)

visualproof doctor flt-regular     # what is missing, if anything, and what to do
visualproof serve flt-regular
```

Open http://127.0.0.1:4173/. Choose the *Rests on* tool (`2`), find `flt_regular` with the search
(`/`), and click it on the board. Of the project's 297 declarations, two light up besides the
theorem: `IsRegularPrime` and `IsRegularNumber`. With the Mathlib definitions they use, they are
what you need to read to believe what the theorem says.

## Where it keeps things

It writes nothing into the project, and nothing into its own checkout. It keeps everything in two
places:

- **The site folder** (`--site <dir>`) holds the review and what the running site accumulates: the
  history of builds, the library, views, notes, the timeline, agents' tokens. By default it is
  `~/.local/share/visualproof/sites/<project>-<hash>/` (on macOS, under
  `~/Library/Application Support/visualproof/`). It cannot be derived again and holds secrets, so
  back it up and keep it out of git.
- **The cache** (`--cache <dir>`) holds what a rebuild makes again. By default it is
  `~/.cache/visualproof/` (on macOS, `~/Library/Caches/visualproof/`).

## Reviewing with others

By default the server listens on this machine only. To let others in:

```bash
visualproof serve flt-regular --host 0.0.0.0 --access-key-file ~/visualproof.key
```

Whoever you give the link `http://<host>:4173/k/<key>` gets in; the key is what the file holds,
and one is made if there is none. **Share** invites a person with a link of their own, shows the
project with a read-only link (nothing changes, nobody sees the reader), or gives an AI agent a
token and a prompt. To put a project online for anyone, read-only, add `--public`. The server
speaks plain HTTP: beyond a trusted network, put a TLS proxy in front. [SECURITY.md](SECURITY.md) says what the server trusts and what it exposes.

## Documentation

- [The manual](docs/MANUAL.md): every part of the page, the review, views, history, the printed
  document, collaboration, and how the TCB is computed.
- [The agents' API](docs/agent-api/README.md), which the server also serves to agents, topic by topic.
- [SPEC/](SPEC/): the specification, and the design decisions behind each part.
- [CONTRIBUTING.md](CONTRIBUTING.md), for working on VisualProof itself.

## License and citation

VisualProof is licensed under Apache-2.0 ([LICENSE](LICENSE)). The fonts in `src/assets/fonts/`
are JuliaMono, under the SIL Open Font License. If you use VisualProof in your work, please cite
it ([CITATION.cff](CITATION.cff)).
