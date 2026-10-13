# VisualProof Attachment Spec

Supplements SPEC.md, "Attachment": the library of PDFs and images, links from declarations and
clusters to places in them, the reference window, and the notes that carry files. How a note is
drawn and moved is CanvasSpec's ("Notes"); a view note is ViewSpec decision 23.

## Decisions

### Files

1. **A library of files.** PDFs and images (PNG, JPEG, WebP, GIF), added by anyone who can write a
   note: uploaded, or by URL, fetched once and kept (an arXiv abstract's URL gives its PDF). A
   record holds the title (the PDF's own, else the file's name; editable), type, size, pages, who
   added it and when (dated in English, "Oct 11, 2026", whatever the browser's language) and the
   source URL. Stored by content hash, never twice; at most 50 MB a file, the library at most
   `--library-limit`. Served to whoever can open the page, behind its access check.
2. **Files never change.** Links, clips and page markers are records of their own pointing into a
   file. A revised paper is another file; links to the first stay with it.
3. **Where things are kept.** Bytes in the site's `files/`; the record and every link are events of
   the review's log (ReviewSpec decision 5), naming the file by hash. A server that reads a link to a
   file it lacks (a log restored without its files, bytes purged) says so and offers to add it,
   taking only bytes of that hash. Removing a file archives it (HistorySpec decision 1): hidden from
   the library, its links and notes saying so, restorable. Only the owner purges bytes, from the
   command line.

### Links

4. **A link joins a subject and a place.** Subject: `decl(X)`, `ns(P)` or `file(P)`. Place: a PDF's
   page with a region, a quote or both; or an image, whole or a region. A label ("Theorem 3, p. 12";
   by default the page and the quote's first words). Any number per subject, in the order made.
5. **Making one.** A box drawn with the box tool makes a link or a clip; selecting text makes
   neither. The words inside the box, as the server reads the page, are the quote and give the
   label. The box links to the declaration or cluster selected on the board, or, from a panel's Link
   to a reference…, to that panel's subject (which can also link a whole page, or an image, without
   a box). **The box is a tool**: ▭ in the window's title bar arms
   it for the next drag only; the drag draws a box and offers Link to …, Clip to a note and the
   label, and the tool disarms. ▭ again or Esc disarms it. Armed, the button shows pressed and the
   cursor is a crosshair. It is the reader's own: followers see nothing of it (CollabSpec decision 4).
6. **A link is part of the review**: a log event attributed as an opinion is, edited and removed by
   events. It follows its declaration to a new name (HistorySpec decision 8), and goes to the
   lost-and-found when it is gone with no confident rename (HistorySpec decision 12). A link to a
   cluster follows a build that moves all its declarations to one other cluster (a folder or a
   namespace renamed), else goes to the lost-and-found when the cluster is gone. Anyone who can give
   an opinion can link; not on a past build's board (ViewSpec decision 26).
7. **Following a link**: panels list links under **References** (a reference can be a photo). A click
   opens the reference window at the place, lit by its region, else by its quote's words.
8. **Source and explanation open together.** Opening a declaration's source (Source, Space, a
   comment's quote of code, Open in a pinned window), and every step of the source window to another
   declaration, opens its first link beside it; the others are offered in the reference window. It
   pairs with whichever source window the reader last opened or stepped, pinned or not.
   - It opens at the link's page and region whatever the paper's text; a failure in finding a link
     never stops the source window.
   - Without links of its own, the innermost cluster around it with one (under the board's
     clustering) gives its link, and says so; with none, the window says so and keeps what it showed.
   - Always on; no setting.
   - Where it opens nothing, a line in the source window's head says why: following someone; no link
     on it or around it; or a link into a file the library has no record of.
   - Space closes and reopens both windows together.
   - When the pairing opens or shows them, the two never overlap. A window the reader moved or
     resized keeps its place where both fit side by side, the other beside it on the roomier side;
     else both are laid out afresh (decision 11). Only a page too narrow for both at their least
     overlaps them.
9. **Back from the paper**: each page's margin marks the subjects linked to it; a click goes to that
   subject on the board, never leaving it (ViewSpec decision 27).
10. **The exported document** prints a declaration's links under it ("Reference: Theorem 3 [title,
    p. 12]"), a cluster's under its section, and the files cited at the end under "References"
    (ExportSpec decision 17).

### The reference window

11. **A window of the page, like the source window.**
    - **Paired**: source left, reference right, side by side, across the page less its margins,
      centred, at most 1,800 px together, over the side panels (which stay). The source is as wide as
      its code, between its least width and half the pair; the reference takes the rest; same top
      and bottom. Too narrow for both at their least: each at its least at one edge, overlapping as
      little as possible. A mirrored window (following) obeys the same rule. Re-laid on resize.
    - **PDFs are drawn by pdf.js**, its legacy build (Safari needs it), bundled into the page so that
      no outside service sees the files, pages drawn as they come into sight.
    - **A page's text is the server's words, never pdf.js's** (whose text fails in Safari): search,
      a box's quote and selection all read them.
    - **A drag on a page selects text**, copied (⌘C, Ctrl+C, the context menu) as readable text: words
      in reading order, spaces between words, line breaks between lines. Selecting makes nothing and
      never ends following. Search matches and links stay drawn over the selection and keep their
      clicks.
    - **An image** zooms and pans as the canvas does; a drag moves it; the box tool draws on it.

### Notes carry attachments

12. **The canvas has one kind of thing: the note.** A note carries files and clips: an image, a whole
    PDF (first page and title), or a clip (a region of a page, as an image). A click opens it in the
    reference window. A clip is made with the box tool, then Clip to a note.
    - **The icon says what it carries, nothing else**: a note (nothing), an image (images alone), a
      paper (a PDF or a clip), with a count where it carries more than one thing. Text never changes
      it; a view note keeps its dashed ring. **Icons scale with what they belong to**: see CanvasSpec,
      "Notes".
    - **A note's text follows its file's title**: where a note carries one file alone and its text is
      exactly that file's title, or the name it was added under, renaming the file renames the note,
      as an edit by VisualProof. Text someone wrote stays.
    - **Files reach the canvas by themselves**: a file new to the library, from anyone, gets a note
      of the project carrying it, by whoever added it: collapsed, its text the title, with no place,
      so on the Project's ring, and on another view's only where a link or an add brings it (decision
      17). The same bytes again make no second note. The library has no "put on canvas" action.
    - **Dropping a file on the canvas, or pasting an image**, adds it to the library and makes one
      note carrying it where it was let go, added to the view on show, and no other.

### Whose a note is

13. **A note is the project's**: an item of the views (decision 17). Writing one (Add a note here) or
    dropping a file makes one, added to the view on show; nothing is asked.
14. **A view note** is a view's own (Add a note for this view; a note's menu: Only in this view / In
    every view). It is kept with the view, shown on its board alone, copied with it, and drawn apart
    (dashed edge, the view's mark). What it carries is still the library's.

### Where a project's note is

15. **One place per clustering**: in a cluster at a spot kept as a fraction of its radius, or at the
    top level on the ring at an angle. Under the other clustering it has no place until put there.
    Moving it under one clustering never moves it under the other; under one, its place is every
    view's.
    - **Attached to a declaration**: a note of either kind dropped on a declaration is attached to it,
      under every clustering. Its places are the fallback (decision 18), set beside the declaration in
      its own cluster under each clustering when attached. The icon's offset from the point is a
      place on the board, in board units: at least 12, at most 2,400, by default 24 right and 24 up.
    - **Dragging it**: inside the circle round its declaration (CanvasSpec, "Notes") it stays
      attached at the new offset; outside, it is a free note's drag and is detached; let go on any
      other declaration (which wins over the circle and clusters), it is attached there. A free note
      dropped on a declaration is attached to it.
16. **The ring.** Where a note has no place under a clustering, it is on a ring around the whole
    board, at the angle of the centre, on this board, of its cluster's declarations under the other
    clustering; where that centre is too near the middle, or it is at the top level there too, in the
    order written, clockwise from the top. A note shown on a board that does not draw its cluster
    (added or linked), or at the top level, points toward what it carries a file linked to on this
    board, else as above. One let go on the ring keeps that angle as its place. An attached note is at
    its declaration where the board holds it, else on the ring toward its links. Crowded notes go on
    further concentric rings near their angle; the ring is the layout's, never kept, and the same at
    a given zoom. Hovering a ring note lights nothing on the board.
17. **Items belong to views as declarations do.** An item is a note of the project.
    - **The Project holds every item.**
    - **Another view shows an item** where its scope gives it, live: attached to a declaration on the
      board (a reader's visitor counts; a past board reads the name then); in a cluster on the board;
      at the top level, in a cluster under the other clustering that has a declaration on the board;
      or carrying a file linked to a declaration or cluster on the board. An attached note's places
      count only once its declaration is gone. Naming a declaration in backticks connects nothing.
    - It also shows where **added** (written, dropped or clipped in the view, or Add to view ▸), and
      not where **taken out** (Remove from this view; not on the Project, where an item is deleted).
    - **New views** start with what their scope gives. Duplicate copies the added and taken-out
      lists; of the Project, the items the copy would not derive, as added.
    - **What a view keeps**: the two lists beside its scope, never in the scope's text (ViewSpec
      decision 25). Changing them is a view operation, shared live, and a timeline event. Deleting a
      note takes it off every list. A past board applies the same rules on its build.
    - View notes are untouched by this. The exported document's authors count a view's items
      (ExportSpec decision 15).
18. **When its cluster is gone**: a build that moves all the declarations of the note's cluster to
    one other cluster (a folder or namespace renamed) moves the note with them; otherwise it is in
    the nearest surviving cluster around it, at its spot, or on the ring; never in a same-named
    cluster of the other clustering. **When its declaration is gone**: the attachment follows a
    rename at the same offset (HistorySpec decision 8) and goes back with an un-move; with no rename,
    the note is where its places put it.
19. **Folds and hidden levels**: a note in a folded cluster, or attached to a declaration (or a
    visitor) a fold hides, is hidden and counted on the outermost folded cluster. A note in a hidden
    level is in the nearest drawn cluster around it (ViewSpec decision 24); an attached one stays at
    its declaration, where the board draws it.

### Agents

20. **Everything through the API**: an agent does with the library, links, notes, view items and the
    reference window (shown to its followers) whatever the page does, through the agents' API and the
    MCP server, including a page's words with their places, search, and pages and clips as images.
    At advise it adds files, links and notes and changes its own; at full it also changes, archives
    and removes others' (AgentSpec decision 9), and changes a view's items. Everything it makes is
    marked as an agent's.

## Implementation notes

- **Storage.** Bytes: `<site>/files/<sha256>`, written whole (temporary name, then rename). What
  Poppler read and drew: `<cache>/files-cache/<sha256>/`. `visualproof purge-file <project> <sha256>
  [--site dir]` deletes both; it takes the site's lock, so the site's server must be stopped. It is
  the only deletion; the record and links stay, saying the file is missing.
- **The library's events** (shared/library.ts), lines of the review's logs with `at`, `by`, and
  `agent` or `person` as any line (ReviewSpec, "The logs"). A line that breaks these rules is not
  read.
  - `{"op":"file","sha","title","type","size","pages"?,"name"?,"url"?}`, `{"op":"file-edit","sha",
    "title"}`, `{"op":"file-archive","sha"}`, `{"op":"file-restore","sha"}`.
  - `{"op":"link","id","subject","file","page"?,"region"?,"quote"?,"label"}`; `{"op":"link-edit",
    "id","subject"?,"label"?,"page"?,"region"?,"quote"?,"auto"?,"snap"?}`, changing at least one
    thing, `null` removing a part of the place; `{"op":"unlink","id"}`.
  - `sha`: 64 lower-case hex. `type`: `pdf|png|jpeg|webp|gif`. Link id: `l` + 12 hex, made by the
    server. Region: `[left, top, right, bottom]`, fractions of the page or image from its top left,
    non-empty, four decimals. Quote: `{text, before?, after?}`, at most 2,000 characters, whitespace
    made single, 48 characters of context kept each side, only on a page. Title ≤ 300, label ≤ 200.
  - The first record of a hash stands. A `link-edit` with `auto` is written only by the server, in
    its own log (ReviewSpec, "The logs").
  - A quote is found again (`findQuote`) with whitespace, then case, read loosely, preferring the
    match whose context agrees most. Default label: the page and the quote's first six words
    (`p. 12 “Let p be a regular prime…”`); "The image" or "A region of the image" for an image.
- **Adding bytes.** Type from the first bytes, never the name: `%PDF-` within the first 1,024 bytes,
  or the PNG, JPEG, WebP or GIF signature; anything else (SVG, HTML) 415. Over 50 MB: 413, answered
  before the body is read. Over the library limit (2 GB by default): 507. The same bytes again are
  the existing file (an archived one restored). Bytes for a record this server lacks (`sha=`) are
  taken only if they hash to it (409 otherwise), recording nothing.
- **Title**: the PDF's own (`pdfinfo`) unless empty, a file name, "Untitled", a word processor's, or
  only an identifier (arXiv id, DOI); else the uploaded or served name without extension; else the
  host. An arXiv paper added by URL takes its abstract page's title.
- **Permissions.** The page and the agents call the same operations with who asks. Writing needs a
  name. An agent edits, archives or removes what someone else made only at full (403 otherwise). A
  link's subject must be a declaration
  (a generated name stands for its command's unit) or a cluster key of either clustering, external
  ones included, of the graph on show. A PDF link has a page, an image's none. An archived file takes
  no link (409).
- **Serving files** (`/api/library/…`, behind the page's access check): as their own type, with
  `nosniff`, a sandboxing Content-Security-Policy, `inline`, cached `immutable`. pdf.js's fonts,
  CMaps, decoders and colour profiles are served from `pdfjs-dist` by file name alone
  (`/pdfjs/{standard_fonts,cmaps,wasm,iccs}/<name>`); its script engine never is, so a PDF's
  JavaScript does not run.
- **Fetching by URL** (server/fetchurl.ts; SECURITY.md): http and https only, no credentials in the
  address. Every address the name resolves to is checked: no loopback, private (10/8, 172.16/12,
  192.168/16, carrier-grade NAT), link-local (cloud metadata), reserved, multicast or unspecified
  address, the IPv6 equivalents (and documentation ranges), IPv4 written as IPv6 (mapped, NAT64)
  read as IPv4, nor the server's own interfaces. The connection goes to the address checked (against
  DNS rebinding), the name kept for TLS and Host. Redirects are followed by hand, at most 5, each
  checked again. At most 50 MB (by Content-Length and while reading), 60 s in all; only a 200 is
  the file. arXiv `abs/` or `pdf/` addresses (any version, `www.`, `export.`, or reached by redirect)
  are fetched as `https://arxiv.org/pdf/<id>`; a file new to the library takes the abstract page's
  `citation_title` (≤ 300 characters), fetched through the same guard, at most 2 MB in 15 s; its
  failure never fails the adding. Tests never reach the internet.
- **Poppler** (server/poppler.ts): a PDF is untrusted input, so the tools run without a shell, at most
  two at once, with time limits (`pdfinfo` 20 s, `pdftotext` 120 s, `pdftoppm` 60 s). `pdftotext
  -bbox-layout` runs once per file and is kept (`words.json.gz`: each word `[text, left, top, right,
  bottom]` in page fractions, and line starts); control characters (unmapped glyphs) are dropped. A
  page's text is its words joined by spaces, its lines by line breaks. Pages and clips are drawn at
  widths 400–2,000 px in steps of 400, a clip at 36–600 dpi.
- **Links carried** (decision 6): a move carries the links on `decl(from)` to `decl(to)`, each
  keeping `was`, and an un-move takes back exactly those. After each build's renames, a cluster a
  link names that the build lacks, whose surviving declarations all sit under one other cluster with
  the same part below it, has its links carried there by a server `link-edit` with `auto`
  ("namespace renamed", "folder renamed") and `snap`. The lost-and-found lists a link (`link:<id>`)
  under its declaration's name (Attach to… moves it), or under a gone cluster's subject (Archive
  only).
- **The reference window** (web/src/paperwin.ts, paperview.ts, paperdock.ts):
  - pdf.js's legacy build and worker, the page's build targeting `es2022,safari16`: the modern build
    draws nothing in Safari. pdf.js only draws; it gives no text and no text layer. At most 12 pages
    stay drawn.
  - **The text layer**: the server's words as transparent spans over the page, in reading order,
    sized to their boxes. Selection ends are computed from the word boxes, never from the browser's
    hit-testing (which jumps across blanks); a word over three times the page's usual height (the
    arXiv stamp) is level with nothing. Where both ends are in the layer, Copy writes the server's
    words, cut where the selection cuts, spaces and line breaks as above.
  - Links draw as their region, else their quote's word boxes, in a paper's colours in both themes.
    Their boxes let presses through to the text; margin markers stay buttons above it.
  - The box tool disarms after one drag; a click leaves it armed. Esc disarms it before anything
    else, even outside the window (but not in a field), then lets go of what was picked, then closes
    the window. A press on the layer is reading: it ends no following.
  - **Side by side**: the source at least 420 px, the reference at least 380 px, 10 px apart, within
    12 px page margins, the pair at most 1,800 px. **Placed by hand**: each time the pairing shows
    the two, the reader's places are kept if they do not overlap; else the source's if it leaves the
    reference 380 px; else the reference's if it leaves the source 420 px; else both are laid out
    afresh, as they are when the reference opens from closed or pairs with another source window.
- **The pairing** (web/src/paperlinks.ts): a source window becomes the paired one when Source or
  Space is pressed (even on what it shows), when it steps to another declaration, when a comment's
  quote of code reveals it, or when Open in a pinned window opens or reuses it. The cluster chain is,
  by namespace, the name and each prefix (a structure is its namespace); by file, the module and
  each prefix. The pairing waits until the source window shows its code at its final size, then
  places both in one task, so that they appear once, where they stay. The reference window opens at
  its final width before its file loads. Errors in finding a link are caught. A `paired` setting an
  older page stored is dropped. Following someone, the window mirrors theirs (carried by presence:
  file, page, link, collapsed; shared/collab.ts), beside the follower's paired source window.
- **In the timeline** (CollabSpec decision 5): one entry per library event that changed something —
  a file's hash and title then; a link's id, subject, label, file, and for an edit what changed
  (`subject`, `label`, `place`), what was before, and `auto` — never a quote's text.
  `GET /api/agent/activity` lists kinds `file` and `link`.
- **A project's note** (shared/projectnotes.ts): text, open, author, last edit, `carries`, `card`
  (CanvasSpec), `places` and `decl`. A place per clustering is `{in: [[key, x, y], …]}` (its
  cluster's key, then every enclosing key that was a circle there, each with the spot as a fraction
  of that circle's radius) or `{ring: degrees}`, clockwise from the top. Kept in the site's
  `views.json` (`notes`, at most 1,000), changed by `pnote`, `pnote-edit`, `pnote-move` (one
  clustering; `place` null removes it), `pnote-open`, `pnote-card`, `pnote-decl`, `pnote-delete`, sent
  as `note-ops`. The server stamps author and editor; the timeline records written, edited and
  deleted, with `view` "".
- **Holding cluster**: the first key of its place that the board's whole graph still has (read when
  shown, so a cluster that comes back takes it back), at the spot of the first key drawn as a circle,
  else the ring. A view note's place counts only under the clustering it was put under.
- **Carried by a build** (decision 18): a note's cluster under a clustering, gone in the new build,
  whose declarations (followed by name or a confident rename) all moved from `K.rest` to `K'.rest`,
  takes the note to `K'` at the same spots, by a `pnote-move` by VisualProof and a timeline event. A
  cluster split or gone carries nothing.
- **The switch** (decision 14): one step, keeping the note's text, author, state, last edit,
  `carries` and `decl`; no timeline event. A view note made the project's on a board is added to
  that view.
- **Attached to a declaration** (decisions 15–20):
  - `decl?: {name, at}` on both kinds. `name`: the full name as the latest build names it (attached
    on a past board: through its renames since). `at`: the icon's centre from the point's, board
    units, x right, y down, a tenth of a unit, 12–2,400 along its direction (`DECL_NEAR`,
    `DECL_FAR`), default `[24, -24]`. A stored offset beyond 2,400 is clamped on reading; an
    operation's is refused, as is a name over one line or 2,000 characters. The server does not check
    the name against the graph.
  - Changed only by `pnote-decl` and `note-decl` (`null` detaches), which need no name and make no
    timeline event; every other operation, the switch and `views.json` keep it; `pnote-move` and
    `note-move` move only the fallback.
  - A drop keeps the offset where it was let go, pushed out to clear the point (40 px on the screen,
    held to 12–64 units), never past 2,400. Attaching also moves the fallback beside the point: under
    the board's clustering in its drawn cluster (the ring for a top-level declaration), and, when
    newly attached, under the other clustering too.
  - A move of a declaration re-attaches its notes to the new name at the same offset, under the
    mover's name, no timeline event; an un-move attaches back those still on the new name.
  - Agents: `decl` on `note` and `note/move` (404 for a name the graph lacks); `decl` null or
    `detach: true` detaches, so does any place given; `decl` with a place is 400.
- **Items** (decision 17; shared/items.ts):
  - Why a view shows a note: `decl`, `cluster`, `ring`, `link` (a file it carries, whole or clipped,
    is linked to `decl(X)` with X on the board, `ns(P)` holding or naming one of its declarations,
    `file(P)` holding one), else `added`; never if on the remove list. A note's words never count. A
    past board reads its build's names. Recomputed at every render, so it is live.
  - A view's `items: {add, remove}`: note ids, at most 1,000 a list, each in one list at most, absent
    where empty, never on the Project. The one operation is `{op: "item", note, in: "add" | "remove" |
    null}` in `view-ops`, refused on the Project and for a non-note; removing an id is always taken.
    Add to view ▸ puts it on the add list only where the scope does not give it; Remove from this
    view on the remove list only where the scope gives it; each takes it off the other list. An item
    operation keeps the view.
  - Timeline: a `view` event, `what: "items"`, with the note's id, text then and `shown`; it counts
    among the view's traces for its document's authors.
  - A note written with a board on show (`POST /api/views/notes {ops, in}`, not the Project) is added
    to that view in the same step, with no event of its own. A file added through the library is the
    Project's alone.
  - A note deleted or made a view's own leaves every list, with no timeline event.
  - `views/open` (Zoom in, a target's key declarations, a query) makes no lists. A copy of the
    Project gets, as added, the notes a view of the Project's own scope would not derive (reckoned on
    that scope, so that a copy that leaves something out leaves the notes about it out too).
- **Notes carry attachments** (decision 12; shared/sticky.ts, server/views.ts):
  - `carries`: at most 8, each `{file}` (an image, or a PDF shown by its first page or `page`) or a
    clip `{file, page, region}`; none twice; a region comes with its page. `pnote-edit` and
    `note-edit` give the whole list (`[]` empties it, absent keeps it); a change is an edit of the
    note, stamped and in the timeline.
  - Each newly carried file must be in the library, not archived, an image whole, the page within
    the PDF; else 400. What a note carries already stays, whatever became of its file.
  - Drawn under the text at the card's width: 320 px where it carries an image or a clip, 260 px for
    whole PDFs alone. Loaded only while the note shows; never stretched. An archived file is marked; a
    file with no record says so, and counts as a paper for the icon. A clip opens with its region lit
    and dashed: a mark, not a link.
  - Files on the ring: a file's first record writes a `pnote` by its adder (no places, collapsed, text
    the title, control characters made spaces, ≤ 2,000 characters). Bytes already held, a restore,
    and bytes filling a record (`sha=`) write none. Each file is considered once (`filesNoted` in
    views.json): never again once a note carries it, where the page writes its own (`note=0`, a drop
    or paste), or after its note is deleted. At each start, every unarchived file of the records not
    yet considered (records also arrive through the logs) gets its note, by VisualProof.
  - Title following runs at start and after every change of the review (a rename on the page, by an
    agent, or a log changed on disk). `views.json` keeps the title the notes last followed
    (`fileTitles`); notes carrying that file alone, with text exactly the old title or the added name
    (with or without extension), take the new title, by VisualProof. The first run (no `fileTitles`)
    also matches every name the file went by: its added name, its first title and every title an
    edit gave it, from the review's history.
  - Drop, paste and Clip to a note are refused on a preview and in a snapshot; a clip is still
    offered on a past board, where links are not. A file the library refuses makes no note; the
    others go on. A clip's note goes beside the selected declaration, else in the selected cluster,
    else on the ring; its text the field's, else the box's words with the page, else the label.
