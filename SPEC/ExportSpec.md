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
    as drafted; and that evening: many items on one line mean little, so sections fold, those of
    more than ten items folded at first; the zoom goes as far out as the board's; sections are
    dragged to order them; edges in the board's two colours).
    - **What it is**: the board drawn as the document's outline (decision 13). Every circle's centre
      and every point lies on one vertical line, in document order, **first at the top**, as a
      document reads. Circles still mean containment (CanvasSpec decision 3): a section's circle
      holds its members, stacked along the line, and each level of nesting is one more circle
      around them — the indentation. Only what the document prints is drawn: the sections (hidden
      levels taken out, a single-child chain merged, `A.B`), the project declarations and the notes;
      outside declarations are left out, as the document only counts them.
    - **Folding**: a section folds (its ▸, or a double click on its heading) into one row, its
      title and how many declarations it holds; the edges of what it holds end at that row, once per
      pair of rows. A section of more than ten items starts folded; the sections the selection is in
      open when the form does. What the document starts with, under no heading, has a heading of its
      own in the form, *In no section*, which folds the same (it is no section of the document, and
      is neither moved nor selected). What is folded is the reader's own, kept for the session, and
      changes nothing of the board or the document.
    - **Labels** at the right of the line: a section's number and title ("2.1 CaseI") beside its
      circle, a declaration's name beside its point; the colours are the scheme's (Kind or Status).
      Edges, where shown (⋯), are arcs on the left of the line, unbundled: an arc diagram, each
      orange at the end that uses and blue at the end used, as the board's (CanvasSpec, "Edges"),
      and lit as the board lights its own: between two lit declarations, of what the tool follows
      (no proof's under TCB); under Keys, the key graph's links, dashed.
    - **Zoom**: the wheel zooms about the pointer, as far either way as the board's; zoomed out,
      the sections' titles stay where there is room for them. A drag on empty room pans.
    - **What the pointer is on** (the owner's words of 2026-10-14: predictable): the row whose
      point and name it is over — from the line to the name's end, a folded section's count, an
      open note's card — lit while it is; it is what a click selects, a drag takes and the right
      click opens the menu on. Elsewhere nothing is lit: a drag pans, the right click is the
      board's.
    - **The menu** (the owner's words of 2026-10-14: most of the board's, by the right click):
      the board's menu (ViewSpec decision 21) on what the row at the pointer's height is — a
      declaration, a section's cluster, a note — or the board's own on none. Fold folds the section
      here, Fit fits the line; Hide this level hides it on the board, which the form follows. A note
      written from it (Add a note here, for this view) goes where the document reads it right after
      the row — a section's, first in it — its editor where the menu was.
    - **Notes**: a click opens a note or closes it — its own state, shared, as on the board — and
      open, its text is set in lines in its row's place. A note is dragged as any row; one attached
      to a declaration moves with it, and dragged on its own and let go anywhere but right after it,
      is attached no more: a note of the section, where it was let go.
    - **When**: while the Export window is open the board on show is drawn so, easing from its
      arrangement and back when the window closes; and at will, from ⋯ (*Linear form*, key `o`). It
      is the reader's own way of drawing the board, followed as the tool is (CollabSpec decision 4);
      the board itself is unchanged by it.
    - **Dragging** a declaration, a note or a section along the line, by its point or its label,
      moves it among its siblings, never out of its section (the clustering decides membership).
      The board's lock does not apply: grabbing a row is the intent, and empty room pans. As on
      the board, what is dragged follows the pointer, off the line too, and its siblings ease aside
      to make room where it would go; near the top or the bottom the line scrolls. Let go, it
      settles on the line and moves the document (the owner's decision of 2026-10-14), by the
      least change to the board that gives exactly the order dropped (bottom first on the board),
      tried in turn and checked as the board will draw it — a drop is brought inside its parent
      and the rest make way, which can undo an order:
      1. each row between where it was and where it went takes the place on the board the row at
         its index had: nothing else moves, and rows of a size never land on one another;
      2. the dragged row alone between its new neighbours, as a drag there would pin it;
      3. the rows between stacked in their new order down the height they took, each where it is
         across: what a large circle needs among small ones.
      Pins for everyone on the view; notes moved in their cluster. Where none gives the order (no
      room on the board), nothing moves and the reader is told so. Undone as pins are.
    - **Who may**: whoever may arrange the board (not a snapshot, a read-only reader, a past
      build's preview); the others see the form and cannot drag.
19. **Artwork** (SPEC.md, "Export"; the owner's words of 2026-10-13: PNG and SVG, the canvas's size
    chosen and rendered at high resolution; a highlighted frame in the middle with shade around it,
    the canvas dragged under it to choose what is drawn; the colours, the items and the targets
    adjustable; the owner's decisions of 2026-10-14: as drafted; then, that evening: no picture
    drawn apart from the board — the board itself, drawn with the artwork's settings, is the
    picture, whether it moves or is still, and everything done on the board works under the frame;
    the artwork followed and shared; SVG the same content as the PNG, within the frame; the owner's
    decisions of 2026-10-15: names over everything on a fading halo, on the board too; the size in
    either orientation; "Generated by VisualProof" at the bottom left and, optionally, the git
    source and commit at the bottom right; the background in the theme, transparent its only other
    choice; no "all names"; that evening, as many targets' stars and diamonds cover the picture:
    targets and names by selection, each ticked in a list, and the key marks a switch of their own;
    then, names by selection kept as what differs from As shown: the names hidden and those shown
    besides; that night, after a page of styles drawn from a real project: clusters' names along
    their circles, adopted; two styles besides the board's, cells and a starfield; a title at the top
    left, the project's name over what it holds, both to be changed, its size too; one or two open
    fonts shipped with the package; then, of the bar only Share and Search while the mode is on; the
    panel in sections, the title's controls and the source's switch set in the shade beside the
    frame where they act; a thin border round the picture, as a choice; then, after a page of title
    faces on the board: the title in spaced capitals of Jost, the same in every style, and the
    top-level clusters' names in it too; then, proof edges no more, in the artwork as on the board;
    the mode coming and going as smoothly as the linear form; a title too wide for the picture made
    smaller until it fits).
    - **Where**: the Export window's second tab, *Artwork*, beside *Document*. Choosing it closes the
      window into the artwork mode; Esc or Done leaves it, the board drawn as before. Both ease over
      480 ms, as the linear form does: coming, the frame closes in from the whole screen as the shade
      round it deepens, the board glides into it, the panel slides in and the other panels fade, the
      board takes the artwork's look in a short dip to its ground, and the title and the strips
      beside the frame appear once it is still; leaving, the same backwards. While it is on,
      of the bar only Share and Search can be used; the rest is greyed and out of reach, by the pointer
      and the keyboard, and of the page's keys only those that act on the board are heard (Search,
      the tool, the zoom, the outside world, the levels, the lock).
    - **The panel** at the right is in sections: *Picture* (the size, its orientation, the border),
      *Look* (the style, the theme, the colouring), *Names*, *Targets and keys*, *Edges and the rest*;
      Done, Save SVG and Save PNG stay in view at its foot. What is set where it acts sits in the
      shade beside the frame: the title, its line and its size above its top left, the source's
      switch below its bottom right.
    - **The board is the picture**: while the artwork mode is on, the board itself is drawn with the
      panel's settings, moving or still; nothing is drawn in its place. Everything done on the
      board works as ever under the frame — pan, zoom, select, drag, the menu, notes.
    - **The frame**: a viewfinder fixed in the middle of the room the panel leaves, its aspect the
      size chosen; outside it the screen is shaded. What lies in it is the picture.
    - **The size**: presets (HD 1920 × 1080, 4K 3840 × 2160, square 4096 × 4096, A3 and A2 at 300 dpi)
      in either orientation, landscape or portrait, or width and height in pixels, at most 16,384 on
      a side. What a name's size will be in the image is said beside it.
    - **The style**: *As the board*; *Cells* — on a dark field lit towards its middle, each top-level
      namespace a territory of its own hue, the outermost circles glowing round their rims and filled
      from a light at their top left, the next ones fainter, the deeper only their rims; the points
      glowing; the edges from one territory's hue to the other's; *Starfield* — a night sky with a
      dust of faint stars, each declaration a star as bright as it is used (its colour the scheme's
      towards white, a glow round it), each cluster a constellation (lines joining its seven stars
      used most, as short as join them all), the outermost two levels' bounds dotted, the edges a
      faint starlight. The cells and the starfield are dark: on their own ground, or transparent.
    - **Names in an artwork**: a cluster's name runs along the top of its circle where it fits there,
      a top-level one in spaced capitals of Jost (the title's face), the others in italics; under a
      folded cluster's disc, and inside the top of a circle too small for the arc, straight. The rest
      in Source Sans 3; the starfield's in Source Serif 4, its declarations' names in italics. Each on
      its halo of the style's ground.
    - **The title**: at the top left, the project's name over a line of what it holds ("7,851
      declarations · 4 targets"), both the reader's to change (empty for none) or to have the
      project's own again; its size from 3 to 16 hundredths of the picture's height, and smaller
      where it would not fit across the picture within its margins — the line under it as much
      smaller with it, and smaller alone where it is the one too wide. In every style
      the title is set the same: spaced capitals of Jost, a display face beside Source Sans 3, as the
      top-level clusters' names are; the line under it in the style's own face. The styles differ in
      colour and weight alone: the board's in the theme's ink, the cells' in a pale light, the
      starfield's lighter, in a pale gold, its line in serif italics. Opening the mode fits the board
      below it.
    - **The appearance**, in a small panel at the right, applied to the board at once: the theme —
      light, dark, or transparent in the light or the dark theme's colours (for a light page or a dark
      one; a dark style's own ground or transparent); the colour scheme (Kind or Status); names (as the board shows them — a lit declaration's
      where the board would give it a card, which an artwork has not —, the clusters' and the
      targets' only, none, or by selection); edges (all, the selection's, none);
      notes shown or not; targets — their star and name marked, drawn as any declaration, alone with
      the rest faded, or by selection; the key declarations' diamonds (*Key marks*), on or off. The
      selection and what is lit count as the reader sees them, or not at all.
    - **Targets by selection**: a list of every target of the review, each ticked to have its star
      and its name marked; one unticked is drawn as any declaration. Choosing it ticks them all; All
      and None tick or untick every one. With the key marks on, only the keys of the targets ticked
      have their diamonds.
    - **Names by selection**: the reader chooses which names the picture writes, from *As shown*:
      the names the reader hides are left out, their room left empty so that no other name takes it,
      and the names they show besides are written wherever they fall, even over another, each on its
      halo, a target's marked as the targets say. A list of the names the frame holds — the clusters'
      the board would write there, then the declarations', nearest the middle first — shows ticked
      those written now, under a filter; ticking one shows it, unticking one hides it. *As shown*
      starts again from As shown, *None* from no name at all (then only the names shown are
      written); with a filter, *All these* and *None of these* tick or untick every name it holds. On
      the board, the menu of a declaration or a cluster shows its name in the artwork, or hides it.
      What is kept is what differs from As shown — the names hidden and those shown, by what each
      names (a cluster's key, a declaration's full name) — so that panning and zooming bring As
      shown's names with them, and a few names hidden or added are a few names carried to those
      following and in a link (each list as much as a heartbeat has room for; the reader is told
      where a choice does not fit).
    - **The border**: where asked, a thin line round the whole picture, a little within its edge
      (0.6 % of its shorter side in, 0.12 % wide), in the style's quiet colour. Outside it nothing of
      the board is drawn: the band between it and the edge is the picture's ground alone — the
      theme's, the style's, or nothing where the picture is transparent.
    - **The foot**: "Generated by VisualProof" at the bottom left, VisualProof in its wordmark; and,
      where the reader asks and the project is a git repository, its source (the remote's host and
      path) and the commit the build on show was read from at the bottom right, a line higher where
      the frame is too narrow for both. Small, in the theme's quiet text colour, on a halo; the frame
      shows it where the file will have it.
    - **Followed and shared**: the artwork — that it is on, its settings, its frame — is part of
      what those following see (CollabSpec decision 4), as the linear form is: a follower's board is
      drawn with the leader's artwork. Share's *Exactly what I see* carries it. The reader's last
      settings are kept in their browser as the start of their next artwork.
    - **The output**: PNG — the board's own drawing (its renderer, its names and notes) made again
      off screen at the size chosen, in tiles where the size passes what the graphics card draws at
      once: the frame's view, more pixels. SVG — the same content, within the frame, as vectors
      (circles, points, names as text, edges as paths), the names those the board shows, as close as
      vectors draw what the renderer draws. Made in the browser, from what the page holds: nothing
      is asked of the server, so a read-only reader and a snapshot of the page can make one too.
      The file is named after the view and the build ("TCB of Hilbert91 @ Oct 14 12:38.png").
    - Agents have no artwork (the page draws it).

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

### The linear form

- **The outline** (`GET /api/export/outline?view=&version=`, shared/doc/outline.ts) is the document's
  plan in its board order without the text: sections `{key, keys, title, number, level, items}`
  (`number` as the PDF numbers it, null at the paragraph level), declarations `{name, notes?}` (the
  attached notes after it), notes `{id, kind, words}` (the first line, Markdown marks out, at most 60
  characters). Served whether or not the server typesets, to read-only readers too; a view too
  large to print has one.
- **The page** (web/src/linear.ts) draws it on its own layer over the board (`#linear`): a row of 22
  pixels (at its zoom 1) per declaration and note, a section's span its heading's row, its rows and 8
  more; its circle the span's diameter, centred on the line; the line at 40% of the room the panels
  and the Export window leave. Labels are drawn from a row of 11 pixels; the arcs, where there are
  more than 6,000, only those of what is lit. The board fades as the line comes (480 ms), each thing
  eased from where the board draws it; the board's camera, folds and visitors are untouched.
- **A drop** (canvas `orderSpot` → shared/doc/order.ts `spotBetween`, from the board at rest as the
  server reads it): between two neighbours across, at the middle of their heights, its own `x`; level
  (within a unit), between them on their row; first, below the one after it, clear of it; last,
  above. A declaration or a section is pinned there (scene `pinAt`; a section that stands for a chain
  of circles is read by its innermost and moved by its outermost), a note moved there in its cluster
  (sticky `moveInto`, keeping what it is attached to). The outline is drawn so at once and asked
  for again 350 ms after the board last changed (a pin, a note, a remote change, another layout).
- **Followed** as `linear` (CollabSpec, "Surfaces"): presence says whether the form is shown; a
  follower's page shows it or puts it away as the other's does, and keeps it so once following ends,
  as any part (CollabSpec decision 4).

### Artwork

- **The mode** (web/src/artframe.ts): `#art`, the frame, with a shadow of the screen's size round it
  for the shade, the pointer passing through it to the board; `#art-panel` at the right, 300 pixels
  wide. The frame is the size's shape, as large as the room the panel leaves allows; opening fits the
  board in it (canvas `fitCam`), and Done or Esc takes the camera back. A snapshot's Export button
  opens the mode at once.
- **Coming and going** (artframe `start`, `end`): 480 ms, the linear form's pace. `body.art-moving`
  holds the transitions while it lasts: the frame's position and size (from the whole screen in, to
  it out) and its shade (`#art.art-away` clears it), the panel's slide (`.art-away`), the put-away
  panels' fade; the camera glides with the frame, on its easing (canvas `glideTo`, `--art-ease`).
  `body.art-dip` fades the board, its labels, cards, notes and the style's ground for 180 ms, the look
  changing under it (`drawLook`); the title, the foot and the strips beside the frame are hidden
  while it moves. Each step has a turn: a newer one (leaving before the mode has come, a followed
  reader's arriving) cancels the older's waits. A frame that changes its shape — the size, the
  orientation, the window — eases the same way, the camera keeping what it held.
- **The board drawn with the settings** (web/src/main.ts, `drawLook`): `body.framing` puts the panels
  and the legend away; the theme is set on `<html>` (`applyTheme` restores the reader's); the colouring
  and the edges are the canvas's (`setScheme`, `setEdges`), the reader's own kept under them;
  `body[data-art-bg]` paints a checkerboard for transparent; `body.art-nonotes` hides the notes. The
  canvas's `setArt` sets the rest: names (as the board writes them, with the lit declarations' where
  the board would give them cards, as many as its cards — 40, 90 or 180 by the zoom —, nearest the
  middle first; the clusters' and the targets'; none; or by selection, below), edges (the overview
  only with all, the selection's unless none), targets (stars and marked names, or none, or the
  chosen ones'), keys' diamonds on or off — by selection, those whose targets (`setKeys`, each key
  with the targets it is key for) include one chosen. Targets alone: what is lit is the targets,
  nothing else; the selection off: nothing lit, the reader's selection kept. Nothing of the reader's
  own is drawn: no cards, no hover, no visitors, no initials, no lead to the panel.
- **By selection** (artframe `chooseNames`, `choose`): `namesFrom` (As shown or none),
  `hiddenNames` and `shownNames` hold what each name names, `c:<cluster key>` or `d:<full name>`
  (collab `artNameId`); `shownTargets` the targets' full names; `keys` the switch. The board writes
  the names shown first, with no check for room (a cluster's where the board writes it, above a
  circle too small to hold it), then As shown's, a hidden one taking its room and writing nothing;
  what it wrote is recorded (canvas `writtenNames`), and the list ticks that. Ticking a name unhides
  it and, where the board does not write it now, shows it; unticking one unshows it, or hides it
  where As shown writes it. The list (canvas `artNames`; artwork `nameRows`, at most 2,000 lines, the
  rest narrowed to by the filter) is read again when the board has been still 300 ms, at least every
  second while it moves. The lists are kept within what a heartbeat carries (collab
  `ART_NAMES_BYTES`, 4,500 bytes of JSON each list of names, `ART_TARGETS_BYTES`, 2,500: a heartbeat
  is at most 16 KB), checked by `cleanNames` wherever they are read; what does not fit is left out
  and said. A
  page from before them chose none, and its key marks are as its targets drew them. The filter is the
  reader's own (CollabSpec, "Surfaces"); a line ticked, All, None and the menu's item end following.
  The heartbeat reads its answer, so that the browser lets the request kept alive go.
- **Followed** as `artwork` (CollabSpec, "Surfaces"): presence carries the settings and the frame's
  `region` — the middle of the board's world it holds, its width and height (`ArtworkView`,
  shared/collab.ts, checked by `cleanArtwork`); null where the mode is off. A follower's frame holds
  the same region at its own screen's size (artframe `follow`); its settings are not kept as the
  follower's. A share link's snapshot carries it the same way.
- **PNG** (canvas `paintArtBand`): the board's renderer draws the frame again on its own canvas at
  `f` = width ÷ the frame's width pixels to each of the screen's, a tile of at most 2,048 pixels at a
  time through the camera the picture was framed with (its soft rim kept as many pixels wide as on
  the screen: renderer `aa`); the names and marks are written over each band from the same drawing as
  the screen's, transformed; the notes over them (artwork `drawNotes`, from sticky `asDrawn`: each
  mark, leader and open card as its elements show it, the icons' glyphs as pictures). A band of rows
  at a time (at most 4096² pixels), each band's pixels compressed as they come (`encodePng`: the
  browser's own deflate, `CompressionStream`), so no canvas of the full size is ever made; refused
  with a message where the browser cannot. The screen is drawn again after each band.
- **SVG** (artwork `artSvg`): its `viewBox` the frame, its `width` and `height` the size, what lies
  outside the frame clipped away. What the renderer draws is read from its layers (renderer `drawn`,
  canvas `artShapes`), each instance that reaches the frame a shape: a circle or point with its ring
  (dashed where the renderer dashes it), a segment, a bundled edge as the shader's spline
  (`bundlePoints`, 48 pieces) with a gradient from its end that uses to its end used. What the board
  writes over it — names, stars, keys, rings, the key graph's edges — is recorded as it is written
  (`SvgContext`, a 2D context's methods writing SVG; canvas `drawMarks`); then the notes, their
  glyphs as SVG. Named after the view's title, stripped of what Windows refuses (`artName`).
- **Styles** (canvas `buildScene`, `edgeEnds`, `constellations`): the circles' looks are the
  renderer's (gl/renderer.ts `FLAG_GLOW`, a fill fading from the centre to nothing; `FLAG_RADIAL`, a
  fill fading from a light at the top left to a quarter at the edge; `FLAG_HALO`, a ring fading to
  both its sides), a glow under the points in a layer of its own (`glow`), the constellations'
  lines in another (`figures`, under the edges). The territories' hues are the top-level clusters'
  by their size (`hueOf`); a star's size `0.65 + 1.15 · log(1 + uses) / log(1 + most uses)` times a
  point's. The ground (artwork `drawBackdrop`) is drawn under the board within the frame
  (`#art-sky`), and in the files under the board's drawing; the starfield's dust is seeded, so the
  same in every frame of a shape. In the SVG a glow and a fill are radial gradients, written once
  for a look and a colour, a halo a gradient of its own (`SvgContext.lit`).
- **The title and the foot** (artwork `drawTitle`, `drawFoot`; artframe `writeOver`): written over
  the board within the frame on a canvas of their own (`.art-ink`), and over each band of the PNG and
  into the SVG by the same code. The fonts (assets/webfonts/: Source Sans 3 and Source Serif 4, their
  Latin, Latin Extended and Greek, and Jost, its Latin and Latin Extended; variable weight, SIL Open
  Font License) are the page's
  (`/fonts/…`, web/style.css; within a snapshot of the page, inlined); a file is drawn once they are
  there, and an SVG carries them, each face in base64 (artframe `faces`).
- **The foot** (artwork `drawFoot`, in both files and on the frame's `.art-ink`): 10 pixels of the
  frame in from its corners, 10 px text and an 11 px bold wordmark in the page's `--grad` colours,
  scaled with the picture. The source line (artwork `sourceLine`: "github.com/A/B · main @ 1a2b3c4",
  "(modified)" where a `.lean` file differed) comes from the project's description: the server reads
  the remote (`origin`, else the first) and the commit when it lays a build out (server/history.ts
  `gitSource`, read-only; the address without scheme, user name, password, port or `.git`, and none
  for a path on the machine); a past build's is its own commit (shared/pastgraph.ts).
