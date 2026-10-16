# VisualProof

<p align="center">
  <a href="https://github.com/math-inc/Sphere-Packing-Lean"><img src="docs/images/artwork-sphere-packing.webp" width="19%" alt="Sphere Packing"></a>
  <a href="https://github.com/leanprover-community/flt-regular"><img src="docs/images/artwork-flt-regular.webp" width="19%" alt="FLT Regular"></a>
  <a href="https://github.com/AlexKontorovich/PrimeNumberTheoremAnd"><img src="docs/images/artwork-prime-numbers.webp" width="19%" alt="Prime Numbers"></a>
  <a href="https://github.com/openai/NavierStokesAndEuler"><img src="docs/images/artwork-navier-stokes.webp" width="19%" alt="Navier–Stokes"></a>
  <a href="https://github.com/cedar-policy/cedar-spec"><img src="docs/images/artwork-cedar.webp" width="19%" alt="Cedar"></a>
</p>
<p align="center"><sub>Five Lean codebases, drawn by <code>visualproof artwork</code>.</sub></p>

[![VisualProof on flt-regular, from the live demo: the TCB of flt_regular, its key declarations approved, an approval recorded at a meeting, the review plan pinned beside it](docs/images/board.webp)](https://visualproof-demo.yingte.io)

<p align="center"><b>Live demo: <a href="https://visualproof-demo.yingte.io">https://visualproof-demo.yingte.io</a></b><br><sub>flt-regular in the middle of a review by three people and an AI assistant, read-only</sub></p>

## Try it

Set up in your Lean codebase with agent prompt:
```text
Set up VisualProof (https://github.com/LucianoXu/VisualProof) for my Lean project, and give me the address to open.
```

Set up manually:
```bash
npm install --global visualproof
cd my-lean-project && lake build
visualproof serve .
```

It needs Node, elan and Poppler ([Requirements](#requirements)).

## See what a Lean theorem actually rests on

Lean checks that a proof is correct. It cannot check that the theorem says what you mean: that the
definitions in its statement mean what their names suggest. VisualProof shows exactly which
definitions those are, so that people, and AI agents, can read them, review them together, and
keep a record of the review.

On [flt-regular](https://github.com/leanprover-community/flt-regular), Fermat's Last Theorem for
regular primes. Of the project's
273 declarations, two light up besides the theorem, `IsRegularPrime` and `IsRegularNumber`: with
the Mathlib definitions they use, they are what you need to read to believe what it says.

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
- **A picture of the board**, PNG or SVG up to poster size: from the page, from an agent's link, or
  without a browser (`visualproof artwork <project> --recipe recipe.json`).

## Requirements

- Node 22.18 or later in 22, or 24.2 or later.
- [elan](https://github.com/leanprover/elan), which installs each project's Lean toolchain. Lean
  v4.28.0 to v4.35.0 are supported.
- Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`).
- Optionally XeLaTeX, for the printed document.

The project must have been built with `lake build`: VisualProof only reads what the build left,
and never builds it.

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
are JuliaMono; those in `src/assets/webfonts/`, which artworks are drawn in, are Source Sans 3,
Source Serif 4, Jost, Noto Sans and Noto Sans Math. All are under the SIL Open Font License, whose
text is beside them. If you use VisualProof in your work, please cite it
([CITATION.cff](CITATION.cff)).
