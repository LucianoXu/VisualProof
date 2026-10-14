# VisualProof Key Declarations and Export Spec

A target's review set can run to hundreds of declarations (TCBSpec.md), too many to work through or
print with collaborators. Key declarations are the part read and printed first: a target's key
document is its Key view, `key(T)`, exported.

## Key declarations

1. **A key declaration of a target** is a member of its review set that matters for understanding the
   formalization (the central definitions, the structures they are built on, the main theorem).
   People and agents at level full (AgentSpec decision 9) mark them **per target**; a declaration can
   be key for several targets; the target itself is always key. Marks are events of the review's logs
   (ReviewSpec decision 5) under the marker's name, like targets.
2. *Withdrawn:* explanations. A declaration's docstring says what it is.
3. **Support and the key graph.** For a target T with key set K, a non-key member x is *supported by*
   k ∈ K when x is reachable from k through non-key members (along the edges the TCB follows); k's
   *support* is all such x. The *key graph* has an edge k₁ → k₂ when k₂ is reachable from k₁ through
   non-key members. Every member is supported by some key declaration, since T reaches all of them.
4. **Key declarations are read first** (nothing walks a review for the reader: ReviewSpec, "Reviewing
   a target"): the review list shows them alone (◆ Key), agents get them first (`key=first`), each in
   review order. Progress has two levels: key (approved of K) and all. They are marked on the canvas,
   and the query language has `key(T)`.

## Export

Numbers missing below are withdrawn decisions.

5. **Export** sits beside Share and opens a window for the view on show: which view and what its
   document holds (declarations, sections, what is outside the project), the settings, the title and
   author line it will print, Generate, then the downloads and the export's notes.
6. **Typeset with XeLaTeX** (an optional dependency) from a document model of VisualProof's own: a
   builder makes the model from the graph, a view and the sources; a renderer turns it into LaTeX.
   Another renderer can be added without touching the builder.
7. **The style is a settings interface** (documented options with defaults), and the LaTeX uses
   semantic macros defined in a style file a user can replace or extend. No colour scheme, line
   numbers, context, dependency figure or appendix exists to set: none is printed. Settings are the
   style; what is printed is the view's (decision 12).
8. **What it holds.** A sober document fit for print: plain typography, no progress bars, badges,
   coloured chips, tinted or decorative boxes. No dependency graph, no appendix, and nothing of the
   review (status, opinion, approval, comment, progress), in the document or its model.
   - **The head card**: the project, the build's fingerprint (commit and branch where known), the
     toolchain, the trusted boundary, and a count of what the view holds from outside the project,
     which is not printed ("Also on this view: 300 declarations from outside the project (Mathlib 203,
     Init 97), not printed"). No time of making. Then, by default, a two-column table of contents.
     The body follows on the same page; a section's head is kept with what follows it.
   - **A declaration**: a plain heading (short name, full name, kind, place), its docstring as prose,
     then its Lean code highlighted in the page's colours, without line numbers or context. **A
     definition's content is always printed and a proof never is**: a theorem is cut after its
     statement; proofs inside a definition are cut where the usage pass found them in the text
     printed, else found by reading the text (implementation notes). The document does not say how a
     definition was read; the export's notes do.
   - **Notes are the document's prose**: the project's notes the view shows (AttachmentSpec decision
     17) and the view's own, with simple Markdown (bold, italics, code, line breaks); a backticked
     full name links to where the document prints it, with its page. No author. **Images and PDF
     clips a note carries are figures** where the note is (an image at its own size, a clip at the
     size the paper prints it; neither wider than the text nor taller than half a page; captioned
     with the file's title and a clip's page, numbered with the references); a whole PDF is a
     reference (decision 17). A note that only carries a file prints as that file, not as prose
     repeating its title.
9. **No Markdown export.**
10. Withdrawn: what a document holds is its view's, never chosen per export.
11. **Agents can export**: they read a view's document model and typeset it as the page does, naming
    the view by id. Any level may (exporting only reads); an agent has at most one job in progress.
    The MCP server's tools include export.
12. **The view is the specification.** The document holds exactly the project declarations the view's
    board holds, whatever is folded, and the notes it shows; outside declarations are only counted.
    The board also decides the order (decision 13). A target's key document is its Key view exported,
    the full review set a view scoped to it (`review ★T`, ViewSpec decision 15), a curated set any
    view.
13. **The board is the outline of the document.**
    - **Sections** are the board's clusters (its clustering, hidden levels taken out: ViewSpec
      decision 24) that hold a printed declaration, nested by depth: three numbered levels, then a
      paragraph-level heading for every deeper one. A cluster with a single child cluster and no
      declarations of its own merges into it (`A.B`).
    - **Board order, bottom first; no dependency order.** Within a section, its sub-clusters (by
      circle centre), declarations (by point) and notes (by icon) come lowest first on the view's
      board, ties left to right; so do the top-level sections and the start (what sits in no cluster,
      before the first section). Notes attached to a declaration follow it. The layout puts what is
      used more lower (CanvasSpec, "Dependency order"), so the default reads foundations first;
      dragging on the board reorders the document. A section's own items that come after one of its
      subsections are headed again by its title, "continued".
    - **Where things are** is the view's arrangement under its clustering, at rest: layout memory,
      pins, hidden levels, nothing folded. A note on the ring is read where it points on the innermost
      ring (the angle it was let go at, else that of what it is about; nowhere: the top, ties in the
      order written). A note in a cluster holding nothing printed goes to the nearest enclosing
      section, else the start; one on an outside declaration goes where its icon is.
    - **The same rule everywhere**: the page's Export, an agent's, a past build's document, the Time
      Machine's preview.
    - **The server reads the board a page draws**, laying it out by the page's rules from the memory,
      pins and hidden levels pages hand over: a view no page has laid out for its current set (never
      opened, a new build, a rescoping, a review a scope reads) is laid out from its memory as the
      next page will, the export's notes saying so, nothing handed over. What is a reader's alone
      does not count: folds, visitors, the zoom, easing, a drag not yet let go. Two exports of the
      same view at the same moment are the same document, whoever asks.
14. **The title is the view's title**, as named. An unnamed view takes its short title (ViewSpec
    decision 25) capitalised ("Keys of Hilbert91"), a leading namespace in full ("Namespace CaseI"),
    unless it begins with a declaration's name, which stays as Lean writes it; an unnamed past view's
    ends with its build ("TCB of ns CaseI @ Oct 9 22:27"). Only renaming the view changes it (the
    Project and Review views keep their names; a duplicate can be named).
15. **The author line is the people who left a trace on the view**, in order of first trace, once each.
    A trace: making the view; renaming, rescoping or laying it out afresh, or adding or taking out
    project notes (its timeline view events); a pin on it still kept; writing or editing a note on it
    or an item it shows (on the Project, every project note); and **reviewing what it prints** (an
    opinion, approval or comment on a project declaration it holds at its build, a key mark on one, its
    target mark). People only: an agent is no author; a private reader's arranging adds nothing
    (CollabSpec decision 8), their review counts under their name; an invitee by personal link appears
    under the name they go by now (CollabSpec decision 9). With no named trace the line is **empty**,
    never the project's name.
16. **A view of a past build makes that build's document** (texts: HistorySpec decisions 20–23):
    - its declarations are those its scope holds on the past graph (HistorySpec decision 17), in the
      sections and order of that build's board;
    - each text is the one that build compiled, its proofs found by reading it (the usage pass reads
      the latest build only); a declaration whose text then is not kept prints its statement then with
      a short note, never the latest text;
    - texts matched by their places (HistorySpec decisions 21 and 22) are counted once on the head
      card, not marked one by one (on a backfilled build the mark would sit on most declarations);
    - the head card gives that build's time (server time, with zone), commit ("edited" for uncommitted
      edits), toolchain and how its texts were had;
    - in the Time Machine, Export prints what the board shows, the view at the build browsed (the
      preview, HistorySpec decision 19's notes).
17. **References**: a declaration's links to places in library files print under it ("Reference:
    Theorem 3 [title, p. 12]"), a cluster's under its section heading, in the order made. The files
    they and the printed notes cite are listed at the end under "References", numbered as first cited,
    each with its title, what it is, where it came from (the address fetched, or the upload name) and
    the start of its hash. A link explains, it does not judge: it is not review. A past view prints
    the links of what its board holds, a declaration renamed since under its name then.
18. **The linear form** (SPEC.md, "Export"; the owner's words of 2026-10-13: the cluster hierarchy
    indented, strictly on one vertical line; dragging in it changes the document's order, and the
    ordinary board shows the change; the owner's decisions of 2026-10-14: first at the top, the rest
    as drafted).
    - **What it is**: the board drawn as the document's outline (decision 13). Every circle's centre
      and every point lies on one vertical line, in document order, **first at the top**, as a
      document reads. Circles still mean containment (CanvasSpec decision 3): a section's circle
      holds its members, stacked along the line, and each level of nesting is one more circle
      around them — the indentation. Only what the document prints is drawn: the sections (hidden
      levels taken out, a single-child chain merged, `A.B`), the project declarations and the notes;
      outside declarations are left out, as the document only counts them. Nothing is folded in it.
    - **Labels** at the right of the line: a section's number and title ("2.1 CaseI") beside its
      circle, a declaration's name beside its point; the colours are the scheme's (Kind or Status).
      Edges, where shown (⋯), are arcs on the left of the line, unbundled: an arc diagram.
    - **When**: while the Export window is open the board on show is drawn so, easing from its
      arrangement and back when the window closes; and at will, from ⋯ (*Linear form*, key `o`). It
      is the reader's own way of drawing the board, followed as the tool is (CollabSpec decision 4);
      the board itself is unchanged by it.
    - **Dragging** a declaration, a note or a section along the line moves it among its siblings,
      never out of its section (the clustering decides membership). Let go, it moves the document:
      on the board it is pinned in its cluster at a height between its new neighbours', as a drag
      there would pin it, for everyone on the view, and the document's order (bottom first on the
      board) follows. Undone as a pin is. The rest of the section keeps its places.
    - **Who may**: whoever may arrange the board (not a snapshot, a read-only reader, a past
      build's preview); the others see the form and cannot drag.
19. **Artwork** (SPEC.md, "Export"; the owner's words of 2026-10-13: PNG and SVG, the canvas's size
    chosen and rendered at high resolution; a highlighted frame in the middle with shade around it,
    the canvas dragged under it to choose what is drawn; the colours, the items and the targets
    adjustable; the owner's decision of 2026-10-14: as drafted).
    - **Where**: the Export window's second tab, *Artwork*, beside *Document*. Choosing it closes the
      window into the framing mode; Esc or Done leaves it, the board as it was.
    - **The frame**: fixed in the middle of the screen, its aspect the size chosen; outside it the
      screen is shaded. The reader pans and zooms the board under it (drag, wheel, the keys), and
      what lies in the frame is what is drawn, at the size chosen.
    - **The size**: presets (1920 × 1080, 3840 × 2160, 4096 × 4096, A3 and A2 at 300 dpi, portrait or
      landscape) or width and height in pixels, at most 16,384 on a side. A preview scale shows what
      a label's size will be in the image.
    - **The appearance**, in a small panel beside the frame, shown live: the colour scheme (Kind or
      Status) and the theme (light, dark), the background (the theme's, white, or transparent for
      PNG and SVG); labels (all, clusters only, none); edges (all, the selection's, none) and proof
      edges; items — notes and attachments — shown or not; targets — their star and name marked,
      shown as any declaration, or highlighted with the rest faded. The selection and what is lit
      count as the reader sees them, or not at all.
    - **The output**: PNG, drawn by the page off screen at the full size (in tiles where the size
      passes what the graphics card draws at once); SVG, vector — circles, points, labels as text,
      edges as paths. Made in the browser, from what the page holds: nothing is asked of the server,
      so a read-only reader and a snapshot of the page can make one too. The file is named after the
      view and the build ("TCB of Hilbert91 @ Oct 14 12:38.png").
    - **What is kept**: the reader's own choices, in their browser; nothing is shared or recorded.
      Agents have no artwork (the page draws it).

## Implementation notes

### Key declarations

- **Events**: `key {target, name, on, by, at}` in the writer's log (an agent's marked `agent`); the
  replay keeps per target the first mark standing. Old `explain` lines (decision 2) are skipped
  without being reported as unreadable. The server binds a mark only where the target is one and the
  name a member of its review set, never the target itself; unmarking needs nothing of the graph. A
  mark on what has left the review is kept and counts for nothing until it is back.
- **The key graph**: one walk from each key declaration over statement and body edges through the
  review set, stopping at key declarations (the review queue's set and edges). To keep "every member
  is supported" true, a project declaration in the TCB that is not a member (trusted) is passed
  through as a non-key member, and a non-standard axiom reached through proofs alone is the target's
  support (`viaProof`).
- `key(T, …)` counts each target as a closure in QUERY_LIMITS.

### Export

- **The model** (shared/doc/model.ts, `DOC_VERSION` 10) is plain JSON: settings; `view`; the head card
  (`title`, `author` as printed, "" for nobody, commit and branch from a read-only `git rev-parse`
  taking no lock, `past`, `outside` per library, largest first, …); `items` in board order (the
  start's declarations and notes, then sections `{id, key, title, level, papers?, items}`); `count`;
  `references` (`{n, sha, title, type, pages?, url?, name?}`). A declaration entry: name, kind,
  place, `doc` (parsed Markdown; `$…$` stays text), its code as tokenized lines (shared/lexer.ts),
  `notes`, `papers` (`{label, page?, ref}`), and how proofs were left out (`proofElided`,
  `proofsCut`, `textCut: "edited"|"unread"|"past"`, `from`). A note entry: anchor, kind
  (`project`|`view`), prose blocks (null where it only names its file; inline kinds add `br` and
  `decl`), `figures` (`{ref, file, page?, region?, size?}`, size in points) and `papers`.
  **Invariant**: nothing of the review (read only as the scope reads it, and for trusted prefixes),
  nothing of who wrote a note, no time of making: the same document is the same JSON and the same
  `.tex`.
- **Plan and order** (shared/doc/sections.ts, order.ts): a merged section keeps every merged cluster's
  key (notes placed in them print there); one below the fourth level is titled by its path from the
  paragraph-level section above (`Proof.Invariant`). Heights are read to a tenth of a unit, as the
  layout rounds them, so a lattice row is level; a section's place is its circle's centre. Nothing
  reads an edge. A view holding no project declaration, or more than `MAX_DOC_DECLS` (2,000), is
  answered 400 and Generate is disabled: narrow it first.
- **The board on the server** (server/boardspots.ts) is laid out by the page's own code, pins applied
  by the page's pure scene (web/src/scene.ts) and notes placed as the page places them.
- **Notes**: a code span naming a printed declaration, or a name its command generated, is a link.
  A note whose one file's title (or a name it was added under) is its whole text has no text. A clip
  of a PDF the server has, or an image it can draw, is a figure; anything else (whole PDF, undrawable
  image, missing bytes) a reference.
- **Figures** are files in `figures/` beside the `.tex`, named by what they are drawn from
  (`fig-<sha>.png|.jpg`, `clip-<sha>-p<page>-<region ×10⁴>-w<px>.png`), so the `.tex` names the
  document whole. A clip is rendered at 300 dpi of its printed width. WebP, GIF (first frame) and
  16-bit PNG are converted to 8-bit PNG by ImageMagick (bounded in time and memory), because XeLaTeX
  reads neither WebP nor GIF and xdvipdfmx draws a 16-bit PNG with transparency blank; without
  ImageMagick such an image prints as a reference, and the export's notes say so.
- **The author line** is computed per request (shared/doc/authors.ts). The maker counts once the view
  is kept (an unkept view is only its query, ViewSpec decision 6); a pin counts under both
  clusterings; a note deleted since still counts (deleting is no trace); a carry by VisualProof is no
  one's; what the server did as `VisualProof` and what an agent did are left out. An invitee is named
  by their link's current name, else the review's logs, else the trace. Ties keep the order gathered,
  the maker first. A maker's record from before makers were marked is taken for an agent's where that
  name acted on the view as an agent. The timeline keeps 90 days and 5,000 events, so older renames and
  re-layouts are forgotten; maker, pins and notes stay with the view.
- **A theorem's proof** (shared/doc/proof.ts): the usage pass does not record where a value starts,
  so a theorem is cut at its value found with the tokenizer: the first `:=` outside every bracket that
  no `let`/`have` in the statement claims, a line starting with `|` holding `=>`, or a `where`;
  comments, docstrings, strings and attributes are never searched. A `by` outside brackets before any
  of these means the reading went wrong: nothing is cut, and the graph's statement prints instead
  (`from: "statement"`), so a proof never prints for want of finding where it starts.
- **Proofs inside definitions** are cut for `def`, `abbrev`, `instance` and `opaque`; a structure's,
  class's, inductive's or notation's text prints as written (a `by` in a field default is data). Where
  the usage pass read the text served now (its record for the declaration under the text's hash), its
  proof spans are used (TCBSpec, "Proof spans"): `by` blocks whose goal is a proposition, the tactics
  of `decreasing_by` (the keyword stays), term-mode proofs written in the text. Kept on purpose: a
  `by` block whose goal is data, and a single name standing for a proof (`h`, `bot_le`) unless it is a
  whole value after `:=` (`left_inv _ := rfl` is cut). Each cut is `…` (an `elided` token):
  `field := by decide` reads `field := …`; a multi-line block is `…` on its first line, the rest of
  its last line joining it.
- **Reading the text instead** (`textCut` `edited`, `unread` or `past`: the file changed since it was
  compiled, the pass off, running, failed or without a record, or a past build): every `by` block of
  the value (none in the signature) and the tactics of `decreasing_by`; `termination_by` stays, a `by`
  in it is cut. A block runs, at its own bracket depth, until its bracket closes, a comma in that
  bracket, `termination_by`, `decreasing_by`, `where` or `deriving`, a `then` or `else` of no `if`
  inside it, or a line starting no further right than the block's own (Lean's layout read so as to cut
  too much rather than print a proof; tactics starting further left decide by their column). Comments,
  strings and quotations are never cut into. Accepted limits: a data-building `by` block is cut with
  what it nests; a proof written as a term prints. The export's notes name the definitions read this
  way, and the declarations printed from the graph's statement.
- **The docstring** prints once, as prose, and is left out of the code.
- **A past build**: the build is the view's own (the one it is kept at, else the latest) unless the
  request names one (`version`: a snapshot id; `null`, `0` or the latest's id for the latest), as the
  page does for a preview. The server builds the past graph with the page's code (shared/pastgraph.ts)
  and reads the review there as the board does. `head.past` is `{snapshot, at, when, approx?, places,
  notKept}`, counted over what is printed; `head.commit` and `head.toolchain` are the snapshot's. A
  snapshot whose texts are still being backfilled (HistorySpec decision 22) is answered 503 with
  `Retry-After: 5`.
- **The settings** (shared/doc/settings.ts; any subset may be sent; unknown fields and out-of-range
  values are refused):

  | setting | default | meaning |
  |---|---|---|
  | `paper` | `"a4"` | `a4` or `letter` |
  | `margin` | `22` | whole millimetres on every side, 10–40 |
  | `fontSize` | `11` | the text's size: 10, 11 or 12 pt |
  | `codeSize` | `8.5` | the code's size, 6–12 pt, rounded to a half |
  | `contents` | `true` | the table of contents, two columns after the head card |

  Retired settings (`scheme`, `lineNumbers`, `context`, `figure`, `supportIndex`, `title`, `author`)
  are accepted and ignored, so that older pages and agents still export. The page keeps its settings
  in the browser.
- **The LaTeX renderer** (shared/doc/latex.ts) writes semantic macros and environments only, and
  escapes everything that comes from people, agents or source text: prose, names and headings through
  `escapeLatex` (the ten special characters spelt out, control characters dropped, `--` and
  backquotes kept literal, symbols the text font lacks set in JuliaMono by `\vpSym`); code through
  `escapeVerbatim` inside fvextra `Verbatim` with `commandchars=\\\{\}` (`\ { }` become `\vpBS`,
  `\vpLB`, `\vpRB`). The contents list every declaration where at most `CONTENTS_DECLS` (60) print,
  else the sections of the first three levels. The code's colours come from shared/palette.ts, which
  mirrors the page's light theme (a test checks it against web/style.css). Anchors are `vp:` and the id
  spelt safe: a declaration's its name, a section's `section:` and the cluster's key, which no name is.
- **Customising the style**: the `.tex` is content; `assets/latex/visualproof.sty` (v9) is the look.
  Its header lists every macro and environment a `.tex` calls, with their (already escaped)
  arguments; a test checks that every macro a document calls is listed. To change the look, download
  the LaTeX sources (the zip) and edit `visualproof.sty`, or load your own package after it in
  `doc.tex` and `\renewcommand` what you want (e.g. `\vpTkKeyword`, or `\setmainfont{…}`); run
  `xelatex doc.tex` twice. Fonts: Libertinus Serif and Sans from TeX Live (Latin Modern where missing)
  for text; JuliaMono v0.63.2 (SIL OFL, `assets/fonts/`) for code, loaded with fontspec from `fonts/`
  beside the document, so the zip typesets anywhere.
- **Typesetting** (server/export.ts): without XeLaTeX, starting a job answers 503. It runs as `xelatex
  -no-shell-escape -halt-on-error -interaction=nonstopmode` in a temporary directory under
  `<cache>/export/` (with a `fonts` link to the bundled fonts), stdin closed, `openin_any=p`,
  `openout_any=p` and `shell_escape=f` in its environment, killed when its runs together pass 120 s,
  rerun while the log asks (at most three runs). Figures are written into `figures/` only under names
  the renderer gives; one that cannot be made is a white pixel, named in the job's notes. The
  temporary directory always goes; the last 20 documents (PDF, `.tex`, `.sty`, figures, the job's
  notes) stay in `<cache>/export/cache/<hash>/`, a job known by a hash of its `.tex` and the style
  file. Two documents typeset at a time.
- **Requests** (docs/agent-api/export.md): a job is answered at once (202 running, 200 done or cached); a
  file while running or failed is 409 with `Retry-After: 2`. `view` is a view id, read as the server
  keeps it at the request; 404 where it is not there. The withdrawn fields `targets`, `preset` and
  `content` are answered 400 with a hint (a target's Key view, a view of its review set). An agent
  (by token, else name; none: 401) has one job running at most: another request meanwhile is 429 with
  `Retry-After: 5` on either route; a cached document does not count; two simultaneous requests make
  one job. The MCP tool `export_file` saves to the new file `saveTo` names (absolute, never over an
  existing file) rather than handing the model a PDF; a request relaying `saveTo` for a PDF or zip
  (an MCP server before 0.3.0) is told to update.
