# Exported documents

A view's document, read as JSON or typeset as a PDF; and a picture of the board ([Artwork](#artwork)).
Any level: it only reads. MCP: `export` (`model`, `typeset`, `job`, `file`, `artwork`).

## What it holds

- **The view is the specification**: each project declaration on its board (folded or not), with
  docstring and Lean code (definitions whole, no proofs), in sections from the board's clusters
  (its clustering, minus hidden levels).
- **The board is the outline**: by height on the board, the lowest first, ties left to right, not
  by dependency. Pins reorder it (`views/arrange` `pins`, [views](views.md)).
- **Notes are its prose**: one attached to a declaration after it (`notes` on its entry), one in a
  cluster in that section, one on the ring or canvas at the start; images and clips as figures,
  whole PDFs as references; declarations it names in backticks linked; library links too
  ([library](library.md)).
- Not printed: what is outside the project (the head card counts it), dependency graph, appendix,
  **the review** (status, opinions, progress).

## What to export

Name the **view** (`GET /api/agent/views`; the Project is `project`); **settings**, **version**
optional. Key document: `POST /api/agent/views/open {"scope": "key(<target>)"}`, then export
the view it answers. Review set: a view on
`tcb(T) except trusted or (uses(T) and kind(axiom) and nonstandard)`. Curated: any view
(`views/create`, scope it, `views/arrange` `hide` to flatten sections). 400: no project declaration,
or over 2,000 (narrow it).

## Settings

`paper` (`a4`, `letter`), `margin` (mm, 10–40), `fontSize` (10, 11, 12), `codeSize` (6–12, in
halves), `contents` (default true: a two-column table of contents after the head card —
sections, and declarations if the document is short). A JSON object: URL-encoded in a GET, as it
is in a POST.
Unknown: 400. Retired, taken and ignored: `scheme`, `lineNumbers`, `context`, `figure`,
`supportIndex`, `title`, `author`. Asked until 2026-10-09, now 400 with a hint how to ask now:
`targets`, `preset`, `content` (there is no outline any more).

## Past builds

`version`: a snapshot id ([history](history.md)); `null` or `0` the latest; omitted, the view's own
build (where kept, else the latest). Prints what the scope holds on that build's graph, in its
cluster structure, with the text it compiled.

- `head.past` (null on the latest): `{snapshot, at, when, approx?, places, notKept}`: `when` in
  words (server time); `places`: declarations matched by places alone (hash not kept); `notKept`:
  with no text kept.
- `head.commit` (`dirty`: uncommitted edits; `guessed`: from its time), `head.toolchain`: that
  build's.
- No text kept: the statement then (`code.notKept: true`, `from: "statement"`), a note under it in
  the PDF. By places: `code.places: true`.

503 with `Retry-After` while the server, at its start, still seeks the texts of builds kept before
it kept texts.

## Title and author

In `head`, the view's:

- `title`: as named; one made from the scope is capitalised ("keys of Hilbert91" → "Keys of
  Hilbert91", "ns CaseI" → "Namespace CaseI"), not one starting with a declaration's name; an
  unnamed past-build view's ends with the build ("… @ Oct 9 22:27"). Change: `views/rename`.
- `author`: who left a trace, in order of first ("Alice", "Alice and Bob", "Alice, Bob and
  Caroline"; "" for none): made it (once kept), renamed, rescoped, laid it out afresh or kept it at
  a past build, dropped a pin it still has, wrote or edited a note on it or a project note it
  shows, or reviewed what it prints (opinion, key or target mark on a declaration it holds at its
  build). **Agents are never authors**, at any level, nor are private readers' nameless changes;
  people invited by a personal link appear as called now.

## `GET /api/agent/export?view=&settings=&version=`

The model, `version` 11: the PDF's content as JSON.

```json
{ "version": 11, "settings": { "paper": "a4", "margin": 22, "fontSize": 11, "codeSize": 8.5, "contents": true },
  "view": { "id": "vus09c41", "scope": "key(Hilbert91)", … }, "head": { "title": "Keys of Hilbert91", "author": "Bob and Alice", … },
  "items": [ { "t": "decl", "decl": { "name": "Hilbert91", "code": { "proofElided": true, "from": "source", "lines": [ [ [ "keyword", "theorem" ], … ], … ] }, … } },
             { "t": "section", "section": { "key": "systemOfUnits", "level": 1, "items": [ … ], … } } ],
  "count": { "declarations": 4, "sections": 1, "notes": 0 }, "references": [] }
```

- Also: `head` `project`, `roots`, `fingerprint`, `commit`, `toolchain`, `past`, `trusted`
  (`prefixes`, `standardAxioms`), `outside` (`count`, `by`: what is not printed); `decl` `id`,
  `short`, `kind`, `module`, `file`, `line`, `doc`; section `id`, `title`; `view` `title`,
  `clustering`, `hidden`. An outside declaration key for a target is printed, from its package's
  source: `external: true`, `package` (`Lean` for the core) where its source was found, `file` in
  the package.
- Top-level `items`: the unheaded start (no cluster, or a hidden top level); a section's: its
  declarations, notes and sections, in board order. `level`: 1–3 numbered, 4+ paragraph-level.
- `doc`: null or `[{"t": "p", "inl": [{"t": "text", "s": "…"}]}]`. Code: lines of `[kind, text]`,
  kinds `keyword`, `type`, `ident`, `comment`, `doc`, `string`, `number`, `attr`, `op`, `sorry`,
  `text`, `elided` (a proof left out); no line numbers.
- Proofs: a theorem's cut after its statement (`proofElided`), a definition's shown `…`
  (`proofsCut`: how many), where the usage pass found them. Where it has not read the text
  (`textCut`: `edited`, file changed since compiled; `unread`, pass off, running or failed on the
  module; `past`, a past build's; `outside`, from outside the project), reading the text finds them: every `by` block of the value,
  `decreasing_by`'s tactics; it also cuts a `by` block building data, and keeps a proof written as
  a term.

## `POST /api/agent/export {view, settings, version?}` — typeset

Typesets with XeLaTeX, as the page does. Answers at once: 202 with `job` and `next` (the request to
poll) while running; 200 with `files` if done (the same document is the same job; the last 20
kept). 503: no XeLaTeX.

```json
{ "job": { "id": "18b04f9a…", "state": "running", "at": "…" }, "next": "GET /api/agent/export/job?id=18b04f9a…" }
```

**One job of yours at a time** (by token, else name): another meanwhile is **429**,
`Retry-After: 5`, with the job it waits for. A cached document costs nothing and does not count.

## `GET /api/agent/export/job?id=` and `/export/file?id=&what=`

- `job`: `{job: {id, state: running|done|failed, at, pages?, ms?, runs?, cached?, error?, log?,
  notes?}, next?, files?: {pdf, tex, sty, zip}}`. `notes`, beyond the document: definitions whose
  proofs were found by reading text, and why; those printed from the graph's statement; for a past
  build, texts matched by places and not kept, by name. Failed: `error`, the end of XeLaTeX's log.
  404: never asked for, or gone from the cache.
- `file`, an attachment: the PDF (`what=pdf`, default), its `.tex`, `visualproof.sty`, or a zip to
  typeset it again (`.tex`, style file, fonts). **409** with `Retry-After: 2` while running, 409 if
  failed, 404 if unknown or gone from the cache. E.g.
  `curl -fsSK ~/.visualproof/curl.cfg "$VP/api/agent/export/file?id=<id>" -o doc.pdf`.

## Artwork

`POST /api/agent/artwork {recipe, save?}`: a link that opens the board as a picture in the artwork mode, as a **recipe** says, in words that
hold on any project (one recipe, the same kind of picture of every codebase). The page that
opens it draws the picture and, with `save` (`png`, `svg`, `png,svg`), saves the files there once
the board is still; nothing comes back to the server. The link holds no key (a script enters with
it: `scripts/artwork-batch.mjs` in VisualProof's repository).

```json
{ "recipe": { "size": "a2", "orientation": "portrait", "theme": "light", "border": true,
    "names": { "clusters": 1 }, "targets": ["Lib.mainTheorem"],
    "selection": { "name": "Lib.mainTheorem", "mode": "tcb" }, "keys": false, "notes": false,
    "source": true, "title": "Lib", "subtitle": "One line about the work" }, "save": "png,svg" }
```

Every field is optional; left out, as a new artwork has it.

- `size`: `hd`, `4k` (default), `square`, `a3`, `a2` (300 dpi), or `{w, h}`; `orientation`;
  `style` (`board`, `cells`, `stars`); `theme` (`light`, `dark`), `transparent`; `colouring`
  (`kind`, `status`); `border`; `title`, `subtitle` (null: the project's own; `""`: none),
  `titleSize`, `footSize` (hundredths of the height); `source` (git source and commit).
- `names`: `board`, `clusters`, `none`, or a rule `{clusters, minShare, targets, decls, omit,
  from}`: `clusters` a depth (0: the top level) or keys; a depth names the outside world and the
  clusters holding at least `minShare` of the project (default 0.01), each written only where it
  covers no name already written (`ruled`), never over another; keys, `decls` (full names) and
  `targets` (default true: the marked targets' names) written wherever they fall; `omit` keys or
  names; `from` `none` (default) or `board`.
- `targets`: `all` (default), `none`, `faded`, or a list of targets marked alone. `keys`, `notes`:
  default true. `edges`: `all` (under a selection, the rest faint), `selection`, `none`.
- `selection`: `{name, mode}` (`mode` as `POST view`'s, or `refs`, what it uses directly; default
  `tcb`), lit while `lit` (default true). `view`: a view's id; left out, the Project.

Answer: `{ok, link, length, size, names: {clusters, decls, ruled}, targets, selection, left, note}`;
`left`: names or targets beyond what an artwork carries, left out. Saving both files, the page says
the browser may ask to allow several downloads. 400: a field unknown or wrong; 404: a name, target,
cluster or view the recipe names that the board has not (`problems`; a target of the review the
graph no longer has is left out unsaid).

