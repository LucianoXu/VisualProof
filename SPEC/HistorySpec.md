# VisualProof History Spec

What the server keeps of each build, how a renamed declaration takes what was said of it along, what
becomes of what was said of one that is gone, and how the page looks back. A declaration's version
is TCBSpec decision 3's.

## Decisions

### Nothing is lost

1. **Nothing is ever deleted.** Opinions with their comments, targets, key marks, notes and pins
   stay: a rename carries them to the new name, a declaration gone without a confident rename leaves
   them in the lost-and-found, archiving only hides an entry. The review's logs are never rewritten;
   snapshots are kept for good.

### Snapshots

2. **A snapshot of the graph at every build the server reads**: each project declaration with what
   its card shows, its version's parts, the kernel's hash, its axioms and out-edges, and the outside
   declarations it refers to. Usage-pass results other than edges (contexts, proof spans) are not
   kept.
3. **Content-addressed per module**: a module's content is a file named by its hash, stored once; a
   snapshot is a manifest of them.
4. **A snapshot's version** is its build time (the newest `.olean`), the commit checked out when read
   (read-only git; `dirty` where `.lean` files differ), and the manifest. One build is one snapshot:
   the same build read again (the usage pass's graph, a newer extractor, a restart) replaces its
   manifest, the previous kept beside it; a re-read holding fewer modules changes nothing.
5. **Keep all.** No snapshot is pruned. The history begins with the extractions the cache holds from
   before it.

### Renames and moves

6. **Renames are found at every new graph**: declarations that vanished since the build before are
   paired with those that appeared. What an unreadable module (in either build) held is set aside: it
   did not vanish.
   - **High confidence**: the same version once names are mapped (decision 11), the declaration and
     what was renamed with it set aside, the same kind, one on each side. Pairing repeats until
     nothing more pairs (one pairing can enable another). Against a build from before versions, the
     kernel's hash stands in.
   - **Medium confidence**: alike (same last name, same module and nearby, a file of the same name, a
     statement that reads alike, content shared with several). Offered as suggestions, never applied.
7. **A high-confidence rename is migrated by itself** as appended **move** events. An undo appends an
   **un-move**, which takes back exactly what the move carried and keeps what was said of the new name
   since.
8. **What a move carries**: opinions with their comments (never rewritten), the target mark, key marks
   (as a member, and as a target its own review's), links to places in library files (AttachmentSpec
   decision 6), a target's linked view with its arrangement; on the views, pins (both clusterings,
   where the new name has none), backticked full-name mentions in notes, and the name in scopes
   (`decl(…)`, the roots of `tcb`, `uses`, `usedBy`, the targets of `key(…)`).
9. **Where moves are recorded.** In the review's logs, so that the logs alone replay correctly: a move
   is `{"op":"move","from","to","on","rename"?}`, and each thing carried keeps its earlier names
   (`was`), which an un-move reads. Moves the server finds go only to `log/visualproof.server.jsonl`,
   under the name VisualProof, with why (`auto`) and the snapshot (`snap`); that log holds nothing
   else. A person's or agent's move or un-move is in their own log. Views, pins and notes (in the
   site) are changed through the views' own operations.
10. **A rename carries the identity.** A move with `rename` makes the new name the old one renamed:
    what refers to it keeps its version (decision 11). Every server-found move is one; a person's
    move is one where the declaration it goes to was not there in the last build that had the one it
    comes from. The server appends a move only where it carries something, or where an opinion on a
    declaration referring to the renamed one depends on its identity; otherwise the rename is in the
    history alone, and pins, notes and scopes are moved all the same.

### The version

11. **A pure rename stales nothing** (TCBSpec decision 3): a version maps the names a declaration
    refers to through the renames in force to the first name each had. An opinion recorded under a
    kernel hash is bound, on replay, to the version of the content that hash was taken of.

### The lost-and-found and the archive

12. **The lost-and-found** lists, for everyone on the server: each opinion, target, key mark, note
    mention, pin or link whose declaration is not in the graph and that no rename in force carried,
    one entry per thing, under the name it was on, with who and when (a link whose cluster is gone,
    under the cluster: AttachmentSpec decision 6); every migration, the server's and by hand, with
    what it carried and its undo; and a lost name's suggestions, first.
13. **Actions**: **Show in history** (the Time Machine at the last snapshot that had it, on it);
    **Attach to…** (a current declaration; appends a move); **Archive** (hidden, still kept, can be put
    back).
14. **Its entry point** is the build-status popover (decision 15).

### The Time Machine

15. **The build status** ("Built") opens a popover: build time, commit, recent builds, and the buttons
    **Time Machine** and **Lost-and-found**.
16. **In Time Machine mode** the tab row gives way to the view's name, a ruler, a summary of what
    changed against now (added, removed, changed, renamed) and a small chart of the declarations over
    time. Views are not switched until the mode is left. **The ruler**: one tick per build at equal
    intervals, oldest left, whatever time lies between. The first build of a commit is *major* (long
    tick); another build of the same commit, edited or not, *minor* (short). No labels under it. Where
    builds do not fit, it scrolls.
17. **The past graph is that build's declarations alone**: what was added since is on none of its
    boards. Marks: *ghost* (gone now), *changed*, *renamed*. A board of it evaluates its scope, and
    what is lit, on that graph.
18. **Browsing is personal and followable**, as a camera is. A follower's own drag on the timeline,
    or leaving the mode, ends following.
    - **At the latest, a new build is followed** (the owner's decision of 2026-10-18): a reader at the
      latest build when a new one is read goes on to it, as the board does with the mode closed, and
      is never left on what has become a past build. Someone at a build they chose stays there, a
      view kept at a build stays kept, and a follower goes where the reader they follow goes. What
      the reader has stays: the selection, the panel, the camera where the declarations survive.
      What changed is told as ever, by the build status and Activity.
19. **A view's graph version** is an option of the view, the latest by default. **Keep this version
    in this view** sets it for everyone; **Save as new view** makes a view of it; a clock badge marks a
    kept view. Browsing is personal; saving is explicit.
    - **A view kept at a past build is a view; only the review differs.** It is arranged in every way
      and duplicated; its arrangement is its own and shared; its layout memory is its board's, never
      mixed with a latest-build board's.
    - **Refused there**: the review (opinions, comments, key and target marks, trusting prefixes),
      which is the latest build's. Each refusal says why in one short sentence where the action
      would be.
    - **Exported** as any view: that build's document (ExportSpec decision 16).

### Source texts

A past build's source is static text only, no Lean queries, stored as git stores blobs.

20. **Every build's text, kept as git keeps blobs**: each project file's text in the site, named by its
    SHA-256 (`history/sources/<sha256>.gz`), stored once; the manifest names per module the blob its
    build compiled. Nothing is written into the project or its `.git`; git is only read.
21. **Only what was built.** A module's kept text is the one whose Lake hash is the compiled-text hash
    in its trace: the working file, else the build's commit's blob with that hash; otherwise it is
    *not kept*, and the page says so for that module alone. A text that is not the build's is never
    shown as the build's.
22. **Older snapshots are backfilled** once, at start, in the background, logged: by the compiled hash
    where the cache still records it, else by the places the snapshot recorded. Candidates: the
    build's commit, the commits on top of it, the working tree, the blobs kept. How complete each
    snapshot came out is reported.
23. **A past board shows the text of then**: in the source window, highlighted, at its range in that
    snapshot with that build's line numbers, its names linked on the past graph. Lean is not asked: a
    hover card shows the snapshot's statement and doc. "Its source then is not kept" only where it is
    not. Quoting into a comment stays refused. The agents' `source` takes an optional snapshot.

## Implementation notes

### On disk (`<site>/history/`)

- `modules/<hash>.json.gz`: a module's units in the extractor's order (kind, statement, doc, range,
  `also`, flags, notation fields, axioms by name, kernel hash, `shape`, `refs`: TCBSpec, "A unit's
  version") and edges (`targets`, each name once; `out` per unit `[unit, target, sites, …]`); or a
  snapshot's outside declarations.
- `snapshots/<id>.json.gz`: module → content hash, and `sources`. A re-read leaves the previous one as
  `snapshots/<id>-<fingerprint>.json.gz`.
- `index.jsonl`: one `SnapshotInfo` line per snapshot written (id, build time, `approx`, read time,
  fingerprint, commit, toolchain, `missing` modules, counts, bytes, `imported`, renames, `sources`
  summary); the last line of an id wins.
- `sources/<sha256>.gz`: gzipped text, checked against its name when read. A manifest's `sources`:
  module → `{file, lake?, blob?, check?: "lake"|"places", from?: "tree"|"git:<commit>"|"kept", why?}`.
- `renames.jsonl` (`{snap, at, pairs}`), `migrations.jsonl`, `archive.jsonl`.
- The first start imports `<cache>/extract/`: the extractor's and usage pass's graphs of one build
  (same declarations, within two minutes) are one, the merged kept; a build with no newer `.olean` has
  a known time, the others are `approx` with the last commit before (`guessed`). Old extractions get
  unique names as the extractor makes them now (`uniqueNames`).

### Renames, moves, versions

- A pairing's key is the version with the declaration's own name, and its members', read as one
  placeholder, so that a declaration renamed with what refers to it pairs. It runs against the graph
  before (or this build as read before), under the identities in force.
- `migrations.jsonl`: a line per migration (id `m1`…, when, from, to, snapshot, who, with an invitee's
  link id, `auto`, `rename`, whether a move went to the logs, what it carried, per view the operations
  and the scope before and after) and per undo (`{undo, by, agent?, person?, at}`). An undo appends an
  un-move to the undoer's log where a move was written, and moves back on the views only what nobody
  changed since (a pin where the old name was not pinned since, the mention it edited, the scope name).
  A target's view comes back with the target; one with no view comes back with none (ViewSpec decision
  29).
- Replay (shared/moves.ts, server and pages alike): `was` oldest first (`wasOf` for a key mark of a
  target's own review); `ReviewData.renamed` maps each name to the one before, followed to the first;
  a rename back undoes it. A move that changes nothing is not written. A target's view keeps its id.
- Versions are made before a graph is served, and again when the renames change (a move or un-move
  by hand, or found in the logs). Kernel-hash opinions are bound by the reading, never by rewriting.

### API

Routes under `/api/history` (agents: `/api/agent/history`, docs/agent-api/history.md). `POST /move {from,
to}` is refused where `from` is in the graph or `to` is not. Moving and archiving need a name (a
private reader's too, CollabSpec decision 8) and record an invitee's link id (CollabSpec decision 9);
agents need level full. Pages are sent `lost` (`{rev, count, lost}`) and read the list again at a new
`rev`. A server serving a saved graph keeps no history.

### The lost-and-found

- **Computed, never stored**, from the review and every view against the graph on show (outside
  declarations included). A note mention is lost only where no rename in force leads on and a kept
  build had the name (anything else in backticks is code). A key mark is listed under the member
  where that is gone, else the target. A past view's pins and notes of names its build had are not
  lost: they are that board's. Entries of a module the graph could not read are counted apart (`aside`).
- **Entry keys**, the same on every page: `opinion:<name>#<by>@<at>` (the reference comments use),
  `target:<name>`, `key:<target>#<name>`, `pin:<view>:<mode>:<name>`, `note:<view>:<note id>:<name>`,
  `move:<migration id>`; an invitee's opinion also answers to keys under the names they went by
  (`aliases`), so that a rename keeps it archived.
- `GET /lost` → `{lost: [{name, last, suggestions, entries}], migrations, archived: [{key, line,
  entry | migration}], aside, count}`; `count` is the lost entries and the migrations not archived.
- `archive.jsonl`: `{key, on, by, agent?, person?, at}` per archiving or putting back, the last line
  of a key its state; a line cut short is left on a line of its own. `POST /archive {key | keys (≤ 500),
  on}`; 404 for a key neither listed nor archived.
- Show in history: `GET /last?name=` finds the newest kept build that had the name from the module
  files and manifests, without reading a graph (`{name, snapshot, at, approx?, commit, module}`; 404
  where none had it).

### The Time Machine

- **The past graph** (shared/pastgraph.ts, which the server uses to print a past view too) is the
  snapshot's alone; a declaration renamed since also answers to its name now. Marks come from
  `/diff` (`removed`, `changed`, `renamed`); `added` is only listed by name. The diff compares
  versions under the renames in force, the earlier build's references read under their later names,
  so a rename that touched nothing said is no change of what refers to it.
- **Layout memory** of a past board is keyed by the snapshot (`@<snapshot>:<key>`), never recalled
  for a latest-build board of the same names nor the other way; the server accepts it only under its
  build's key. Without one, the board is stabilized against the view's memory of any build (else the
  latest whole-project layout, else afresh), off the page's thread, so that what both builds hold
  stays put.
- **A preview** (decision 19's notes): a board of a view at another build than its own (browsed, or
  its own build unreadable) is the view's scope and arrangement on that build's graph, and nobody
  arranges it: a drag pans, arranging is refused ("Keep this version, or Save as new view, to arrange
  it"), a fold is the reader's own, no memory is handed over. Export prints it as shown.
- The review's colours are today's opinions against that build's versions. The keys `a`, `m`, `k` and
  `submit` itself are refused too. The review and the views' records speak the names of now; on a
  past graph the review is also read under the names then (`reviewThen`), and what a past board writes
  or opens by name uses the name now.
- **Ruler**: major where the commit's hash differs from the build before's (the first build, a return
  to an earlier commit), `dirty` aside; without commits, the first build of a day. The ruler's line
  breaks between days. Where builds do not fit the closest spacing a pointer still hits, the strip
  scrolls: every build keeps a tick of its own.
- **Dragging** loads builds as the slider moves, not once let go. **The latest wins**: a build is
  shown only if it is still the one aimed at when ready; work for builds nobody wants is aborted. An
  unreadable build says so, and the board stays.
- **Following**: presence carries `history: {snapshot}` as it carries the camera (none from a private
  reader). The follower's own drag, a step or a press on the bar ends it; reading a count's list does
  not.
- **A new build** (decision 18's notes, web/src/past.ts, `onNewBuild`): when the list of builds is read
  again (`history`, or a new graph on show), a reader aimed at the build that was the latest is aimed
  at the new latest, and its board is the board of now, which the new graph replaces as any open
  page's. Not where the view on show is kept at that build, nor while following someone: presence
  brings the followed reader's build. Those following the reader are told the build it is at now.
  Every page, the mode open or not, asks `/diff` from the build before to the new one for its
  renames: the selection follows those (a rename of a declaration nothing was said of is in the
  history alone, decision 10) as it follows the renames in force.

### A view's version

- `ViewData.version` (snapshot id; absent: latest), set by the view operation `{op: "version",
  snapshot: number | null}`; the server refuses an unknown snapshot and a reader without a name, and
  records the view event `{what: "version", snapshot, built}`.
- The Project and views linked to targets always show the latest build (`versionRefused`): the one is
  everyone's way in, on the other the review is given.
- Save as new view (`views/create` with `from` and `version`) is named "<title> @ Oct 7 14:50"
  (ViewSpec decision 25), shown at once with the layout on show, then the Time Machine is left. A
  duplicate of a kept view keeps its build.
- **What is made from a past board keeps its build**: Zoom in, a cluster's Zoom in and a target's key
  declarations open at it (`views/open` takes `version`); an unkept view is found by query and build
  together; the address (`at=`) and the tab carry the build; a history entry made in the Time Machine
  keeps its build in `history.state`, not the address. Going elsewhere by name goes to present things.
  Only Keep this version and Latest again change a view's version.
- Agents at level full set it with `views/arrange {version}` and `views/create {version}`; a layout
  they make of a past board is never handed over as its memory.

### Source texts (server/sourcestore.ts)

- **At a reading**: per module, the trace's compiled hash; the working file where its Lake hash
  matches, else `git show <commit>:./<file>` of the commit checked out, else nothing. A re-read keeps
  what was found for a module whose hash is the same and whose file was edited since.
- **The backfill**: snapshots without `sources`, oldest first, each given its texts once (refused where
  a reading did meanwhile). Hashes from the cache's `view/<fingerprint>-v*.meta.json.gz`
  (`modules[].compiled`), else the trace of a module not compiled since the build. Candidates, each
  text once: the build's commit, the commits on top (`git log --ancestry-path --all ^<commit>`,
  nearest first, at most 64), the working tree, the kept blobs. Without a hash, a candidate must agree
  with every recorded place: project imports, each declaration's range (inside the text, on token
  boundaries, in code points), its opening doc comment, the name its command writes (`_root_.` and
  universe parameters aside). One agreeing text is kept (`places`); with several, none, except the
  commit's text for a build read clean. **Why so narrow**: edits inside proofs or to an `open` move no
  place, so other versions of a file often agree too.
- `GET /api/history/source?id=&module=` → `{module, file, text, lake, check, from, snapshot, at,
  commit}`, or 404 with `kept: false` and `why`; never another text. `part=nodes` carries `sources`
  (module → `lake` | `places`). Agents' `GET /api/agent/source?name=&snapshot=` finds the declaration
  by its name then, its name now, or a generated name.
- A past source window sends no hover request, no `#print` and offers no editor link (the editor
  opens the file as it is now).
