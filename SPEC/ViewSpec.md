# VisualProof View Spec

Supplements SPEC.md, "View". SPEC.md's "filter of nodes" is a view's scope (decision 2); its "record
of invisible clusters" is the view's hidden levels (decision 24).

## Decisions

1. **One dividing line.** A view is a board: what is on it and how it is arranged are shared. The
   reader is the camera: where they look, what they select and light up are theirs. The review and
   the timeline are global and do not depend on the board.
2. **A view is a scope and an arrangement.**
   - Scope: a query (Implementation notes) for the declarations on the board.
   - Arrangement: the clustering (namespace or file) and, per clustering, pins, folds and hidden
     levels. When the scope's set changes, the board is laid out again compactly: what stays keeps its
     place (the layout memory), new declarations go beside their cluster.
   - Items (notes of the project, AttachmentSpec decision 17): the Project shows all; another view
     shows those its scope gives, plus an add list, less a remove list, kept beside the scope and
     never in the query's text.
   - A view is its exported document's outline: what it holds, ordered bottom first by position on
     the board (ExportSpec decisions 12–13).
3. **The reader's own**: camera and selection (remembered per view), the tool, reading preferences
   (edges, theme, colour scheme), open tabs. A follower sees all but the theme and the
   tabs (CollabSpec decision 4).
4. **One query language** for scopes and the selection (decisions 11, 13).
5. **The Project and the board's settings.**
   - The Project (scope `all`, by namespace) is never deleted, renamed or rescoped. Every other view,
     a target's included, is rescoped by the scope chips, `e` (the outside world), Add to view and
     Remove from this view, and renamed by Rename.
   - Whether the outside world is on a board is a scope condition (`except external`), so shared.
     Edges are personal (proof edges are no more: the owner's decision of 2026-10-15).
   - Folds, Depth and Re-layout are the board's. Re-layout drops the board's pins under both
     clusterings and its layout memory, for everyone, so it asks first; people and agents at level
     full (AgentSpec decision 9) may do it.
   - `k` needs a focus (decision 28); `a` and `m` work on any board.
6. **A board is kept when it carries work.** A view opened from a query (Zoom in, a link) is
   temporary: it goes when the last page or agent leaves it, and its address reopens the query laid
   out afresh. An arrangement (pin, fold, hidden level, note), a name, a change of scope, items or
   focus, or a target linked keeps it, for everyone. Deleting a kept view asks first. Duplicate gives
   a copy to arrange. There are no private views.
7. **The clustering belongs to the board.**
8. **Placement says whom a control affects**: the left side panel is the board's (targets, cluster
   tree, ⚙ Board, Trusted); the bottom right is the reader's (zoom, fit; behind ⋯ the lock, edges,
   theme), as is the legend at the bottom left; the top holds the reader's tabs, tools and
   selection.
9. **Shared changes are visible**: a fold, move or rescope by someone else shows a short note where it
   happened ("Alice folded CaseI"). The timeline records views saved, renamed, rescoped (items
   included), deleted and re-laid out.
10. **Following and the address.** Following switches to the leader's view (opening a tab) and takes
    what decides what they are shown (CollabSpec decision 4). The address holds the view, tool,
    selection and what the panel shows (Implementation notes). Share's *Exactly what I see*
    (CollabSpec decision 7) appends `snap=`, applied once: the same region of the board, fitted to the
    opener's screen. Agents open views at any level; at level full they make, rename, duplicate,
    delete, rescope, arrange and re-lay out views as people do, under their name.

## The selection

11. **The selection is a list of picks.** A pick is one thing clicked under one tool. A cluster pick
    stands for the whole namespace (`ns(P) except external`) or folder (`file(P)`), not only what the
    board holds. The selection is the union of its picks, itself a query (`tcb(A) or decl(B)`), and
    is exactly what is lit.
12. **The tool is how the next click selects** (labelled *Mode*; explanations only under the
    pointer): Selection, Rests on (three steps, decision 20), Used by. Switching tool re-picks the last
    pick under the new tool, alone (back to Selection: only the thing clicked). Only Selection has
    shift-click, adding or removing one pick; other tools replace the selection. A cluster pick covers
    the picks inside it. Single click selects (clusters too, with their own panel); double-click
    folds or unfolds.
13. **Zoom in** opens a view of what is lit, within the board's scope; it does not follow later
    selections and has no added or removed items (as any view made from a selection or scope). Made
    from a board of a past build, Zoom in, a cluster's Zoom in and a target's key declarations open at
    that build.
14. **The selection shows at the top right**: a chip per pick, the count lit, Zoom in, Clear. The
    count is of what is lit and not trusted, the trusted lit told apart beside it ("N lit · +M
    trusted"; TCBSpec decision 7, the owner's decision of 2026-10-17), whatever the tool: under Rests
    on · TCB it is the TCB's size, the theorem among it; under the other tools the same split keeps
    one meaning for the number.
15. **A target's view opens with the target selected alone**, under the reader's tool (a click on a
    target never changes the tool). Going to a declaration from the target's review list or the
    strip's target selects it alone under the Selection tool. The target's review set (ReviewSpec
    decision 3) as a scope is `tcb(T) except trusted or (uses(T) and kind(axiom) and nonstandard)`,
    titled `review ★T`; any view may take it.
16. **What is lit is computed on the whole graph**, then met with the board: a path through a
    declaration the board lacks still counts, and Zoom in holds exactly what was lit.

## A simpler page: progressive disclosure

17. **Frequent things show; the rest is one click away**, for everyone:
    - Over the cluster tree, **⚙ Board** (scope chips, Clusters, Depth, Re-layout) and **Trusted**
      (with its prefix count; trusting's questions live there). Row shields also change trust.
    - The panel always shows kind, name, namespace, place, Source, editor link, "Also declares",
      statement, doc and review. Why-in-TCB (with a focus; starts open), counts, axioms and the TCB
      list (start folded; a non-standard axiom in red) fold, kept as the reader leaves them.
    - Behind ⋯: lock (a dot on ⋯ while drags move things), edges, theme.
    - Activity is an icon with a count. Popovers close on a press elsewhere, Esc, or their button.
18. **One mode**: no simple or advanced page; every tool and key is there for every reader.
19. **Nothing to choose**: a browser's `visualproof:ui` entry is neither read nor removed.

## Rests on

20. **Rests on is one mode in four steps**: Uses (everything used, proofs included) ⊇ TCB ⊇ Keys;
    and Direct (what it uses directly: the declarations its statement, body and proof refer to, one
    step; `refs(X)`), added by the owner's decision of 2026-10-14: everything used selects all a
    term depends on, to Zoom in on, and what it uses directly is what its code is read with.
    - The bar: *Selection | Rests on | Used by* (keys `1`–`3`), with a Uses / TCB / Keys / Direct switch while
      Rests on is on. `2` again steps TCB → Keys → Uses → Direct. Entering Rests on resumes the last step (a
      reading preference; TCB by default).
    - **Keys** selects X and the key declarations in its TCB: of the focus target (decision 28); with
      no focus, of every target, but a target clicked takes its own. The pick is `tcb(X) and (key(T…)
      or decl(X))` (written so a selection's `or`s never split it), `key(targets)` for every target.
    - Under Keys, the canvas draws the key graph's edges among what is lit (the focus target's, else
      the union), dashed (CanvasSpec, "Edges"): A → B means A rests on B through non-key declarations.

## The canvas's menu

21. **The right click opens the page's menu** on what is under the pointer; ContextMenu or Shift+F10
    on what is selected (else the empty canvas); Esc or a press elsewhere closes it. What the reader
    cannot do is left out, not greyed: board items need *arrange* (a name or a snapshot, and no
    preview), review items *write* (a name and a writable review), key marking a focus. On a past
    build's board one disabled line says the review is given on the latest build (decision 26).
    - Declaration: open source or a pinned window; select its TCB, uses, used-by; copy name; Remove
      from this view; Add to view ▸; mark key (for the focus) or target; Approve…, Comment…; trust its
      namespace; the two note items. A visitor (decision 27) has Add to this view, no Remove.
    - Cluster: fold; Hide this level; Remove; Add to view ▸; trust; the note items. Empty canvas: the
      note items, fit, Re-layout…. Note (decision 23): edit, collapse, attach/detach, switch kind, for
      a project note Add to view ▸ and Remove (not on the Project), Delete….
    - Add to view ▸ lists at most 40 views whose scope can change, kept first, then unkept ones marked
      *temporary* (adding keeps them); one already holding it is ✓ and disabled; then New view….
22. **Remove and Add change the scope** for everyone on the view: `scope except decl(X)`, `scope or
    decl(X)`, a cluster written as its pick. The scope stays short (shared/scopeedit.ts): a name joins
    a trailing `decl(…)` under the same joiner; re-adding what was removed drops it from its `except
    decl(…)`, and conversely. On the Project, Remove is **New view without it…**, a copy without it
    opened in a tab; it and New view… ask for a name, offering one. For an item, Add puts it on the add list only where the scope does not give it
    and takes it off the remove list; Remove does the converse.

## Notes on a board

23. **A view note belongs to a view** (a note is the project's unless made a view's, AttachmentSpec
    decisions 13–19). It is shared and changed as pins are; written from the menu or made from a
    project note, by people and agents (AgentSpec decision 5), and changed by anyone who can change
    the board. Its author is recorded as a pin's. Writing, editing, deleting are timeline events;
    opening, collapsing, moving and where its card hangs (CanvasSpec "Notes") are not, though
    shared as folds are. Copies
    of the view have its notes. When a declaration is renamed (HistorySpec decision 8), notes naming
    it in full between backticks are edited to the new name, as are pins, scopes and focuses, and a
    target's view follows (decision 29).

## Hidden levels

24. **A view hides levels of its cluster tree**: a hidden cluster's members move up into its parent;
    the top level may be hidden. Kept per view and clustering, shared; Duplicate copies them,
    Re-layout keeps them. Hiding or showing moves nothing on the board. A hidden cluster cannot be
    folded; its fold is dropped. Hidden levels are not listed in the outline; ⚙ Board lists them with
    *show*. The exported document's sections follow the tree (ExportSpec decision 12).

## Titles

25. **A view's title is short.** A name people gave (1–80 characters, no line break) is used as
    written; the Project is *Project*; a linked view has a ★ beside it (decision 29). An unnamed view
    is titled from its scope as the chips say a pick ("TCB of ns CaseI", "keys flt_regular rests on",
    "what caseI uses"), everywhere a title shows (tabs, Views menu, Activity, presence, the exported
    document, agents); the full scope is under the pointer (agents: `description`, `scope`).
    - A name is said by its last part plus the parents needed to tell it apart from others of its kind
      in the project ("IsFundamental.existence" beside "systemOfUnits.existence"); a last part that is
      a number or two letters keeps its parent; a «…» part is one part.
    - A cluster's set, a Keys pick ("keys X rests on", "keys of T in TCB of X") and a review set
      ("review ★T") are each one set, never split into conditions.
    - Conditions condensed: "− trusted", "− outside", "+ helper", "in ns CaseI", "in ★T", ", only
      theorems". About 30 characters, at most 48, the rest an ellipsis.
    - A view kept at a past build ends with it ("… @ Oct 9 22:27"; `@ build N` where the build's time
      is unknown). Save as new view replaces such a suffix, numbering only on a clash. The page uses
      the reader's time zone, the server its own.

## Views of a past build

26. **A view kept at a past build is a view** (HistorySpec decision 19): arranged, duplicated and
    exported (ExportSpec decision 16) as any, at that build's graph. It is not reviewed, which is said
    where the review would be. In the Time Machine, a view shown at another build is a preview that
    nothing arranges until Keep this version or Save as new view.

## Navigation and the focus

27. **Navigation never leaves the board.** Going to a declaration the board does not hold (from any
    link, list, search, Activity, message or step) shows it on this board as a **visitor**, selected
    under the current tool: a dashed point with its edges to the board and to other visitors. The
    board switches only when the reader picks a view, tab or the Project.
    - **Place**: inside its own cluster if the board draws it; otherwise under **temporary clusters**
      (dashed, italic, chains merged) for the levels missing below the deepest drawn cluster of its
      path, shared between visitors and following hidden levels. A visitor under an upper level of a
      merged chain gets temporary clusters beside its circle. The plan does not depend on trail order.
    - **Temporary**: in no scope, pin, layout memory or shared state; gone with the visitors.
    - **The board's arrangement stays.** Each new spot is free room nearest what it references, else
      against the rim where it covers least, others making way as from a drop and the circle growing
      only if needed. Spots are chosen in arrival order, so a newer visitor never moves an older one;
      a changed cluster gets a new spot. When the visitors go, everything is back where it was; pins
      are framed from the board's own arrangement meanwhile.
    - **Edges**: bundled as any, at most 400 to the board (statement and body references first).
    - **In a folded cluster** a visitor is hidden, its card marked with a dashed ring and a count;
      clicking the marker selects the newest. While a visitor is selected, the folds around it open
      for the reader alone; a double-click there unfolds for everyone.
    - **Whose**: the reader's alone, but followers see the leader's (same clusters, spots, open folds).
      Agents have no visitors; a followed agent's off-board selection becomes one on the follower's
      board.
    - **Trail**: the last six, cleared with the selection or on another board; whatever the board now
      holds becomes a member. A declaration in the address the board lacks is a visitor again after a
      reload; the trail lives only in the page.
    - Add to view makes a visitor a member. On a past build's board visitors are of that build
      (HistorySpec decision 17).
28. **The review is a focus.** A view has a focus target or none. With one: the review strip, `k`,
    Keys limited to it, its key diamonds, the Status scheme at first, why-in-TCB (ReviewSpec,
    "Reviewing a target"); with none, none of these. The review counts the focus's review set whatever
    the board holds. A target's review list shows wherever the target is selected.
    - **The view's focus** (shared, kept): set when the view is made from a target (its temporary
      view, its Key view), inherited by Zoom in, copied by Duplicate, New view without it… and Save as
      new view, set by the first target linked, or set for everyone from the header or by agents at
      level full. In force: the set focus while it is a target; else the first linked target still a
      target; else the board's only target; else none.
    - **The reader's focus** overrides it for that reader alone (header "Focus: ★T ▾"; linked targets
      first, then the view's focus, the board's other targets, none); remembered per view and
      followed.
    - On a past build's board the focus shows but the review is refused (decision 26).
29. **A target is linked to at most one view; a view may have several targets.**
    - Clicking a target (side panel, ★, Activity, agents' `view {review: T}`) opens its view with it
      selected (decision 15) and makes it the reader's focus there.
    - **Only a click or a link gives a target a view.** Marking, a server start, review sync, a build
      or a rename never makes one, nor does any panel, menu, endpoint or MCP tool.
    - **Linking** (view menu "Link ★T to this view", or the target's panel), for everyone, to any view
      but the Project and a past build's view, appends the target and keeps the view. The view it
      leaves keeps scope, arrangement and focus. A linked view always shows the latest build. A link
      set by someone is a timeline event and a board note; the server's and a click's are not.
    - **Unmarking** unlinks that target alone; the view stays.
    - **A linked view is a view with a ★** (yellow, on its tab and in the Views menu, tooltip naming
      its targets); nothing else names it apart. Older `review:<T>` views are plain views.
    - **The Views menu** is one list: the Project, kept views (linked ones first, by first target, then
      by age), then, past a line and in italics, unkept open views. The targets are the side panel's;
      one with no view says "no view".
    - **Deleting** a linked view unlinks its targets (Delete… names them) in one timeline event; pages
      on it go to the Project; other views focused on the target keep their focus.
    - **A target with no view, clicked**, gets the view Zoom in under Rests on → TCB makes from the
      Project: `tcb(T)`, by namespace, latest build, found open or made, linked and focused, titled
      "★ TCB of T". The link lasts as long as the view: unkept, both go (no event, no note).
    - The panel of a target with no view says so, with Link to this view and Key view.
    - Agents follow the same rules (AgentSpec decision 9); their `target` answers `view: null` after
      marking.

## Implementation notes

### The query language (shared/query.ts)

Two forms, JSON (stored, agents) and text (address, agents, chips), each printing the other. The
printed text is canonical: queries are the same when their texts are.

```
query   := term { ("and" | "or" | "except") term }        left to right
term    := "(" query ")"
         | "all" | "selection" | "trusted" | "external" | "sorry" | "nonstandard"
         | ("tcb" | "uses" | "usedBy" | "refs") "(" roots ")"
         | "decl" "(" name { "," name } ")"
         | "key" "(" ( "targets" | name { "," name } ) ")"
         | ("ns" | "file") "(" name ")"
         | "kind" "(" kind { "," kind } ")"
         | "status" "(" status { "," status } ")"
         | "advice" "(" verdict { "," verdict } ")"
roots   := "selection" | name { "," name } | query
kind    := theorem | def | abbrev | instance | structure | class | inductive | opaque
         | axiom | quot | constructor | recursor | notation | unknown
status  := unreviewed | approved | commented | stale
verdict := approve | comment
name    := a word without whitespace, "(", ")", "," or '"'  |  a JSON string
```

- In a closure, what starts with `(`, with `word(`, or with a word followed by a joiner is a query;
  otherwise names. A one-word query is parenthesised there (`tcb((external))`). Printing
  parenthesises only a combination on the right.
- A name with whitespace, parentheses, a comma or a quote, or equal to `selection` (in `key`,
  `targets`), is a JSON string; quoted names are only arguments. Keywords ignore case; `namespace`,
  `module`, `decls` alias `ns`, `file`, `decl`.
- Meaning: closures are TCB, everything used (proofs included), everything using; `refs` is the
  roots and what they refer to directly (statement, body, proof: one step); `ns(P)` names under
  P; `file(P)` modules under P; `external` outside the project; `sorry` rests on `sorryAx`;
  `nonstandard` rests on a non-standard axiom; `status`, `advice` (AgentSpec decision 2) of the
  present version; `key(T, …)` each target and its key marks still in its review set; `key(targets)`
  every target at evaluation. Unknown names stand for nothing.
- `QUERY_LIMITS`, the same for both forms: text 20,000 characters, nesting 32, 1,000 parts, 2,000
  names (each at most 2,000 characters), 64 closures (each `key` target one, `key(targets)` one).

### The address (web/src/state.ts)

`v=<view id>`, or `q=<query>` (+ `at=<snapshot>` for a past build) for an unkept view; `mode=` one of
`plain`, `deps`, `tcb`, `keys`, `apps`; `sel=` the selection's query; `s=` / `c=` the panel's
declaration or cluster when not the last pick's root. No `mode` means TCB. Esc closes what is open,
then clears the selection; it never leaves a view.

### Boards and layout memory (shared/board.ts)

- A scope holding the whole project (all of the outside world or none) uses the server's layout minus
  hidden circles, with no memory; Re-layout of the Project redoes it. Other boards are laid out on the
  page.
- Layout memory: per view and clustering, keyed by the set and the hidden levels; past builds key it
  by snapshot so it never mixes with the latest. A page recalls it exactly; on a changed set it lays
  out from the old memory and hands the new one over (at most 50 MB, the owner's decision of 2026-10-14; first wins). Handing over needs a
  name (or a private reader); otherwise the layout stays local.
- Zoom in's scope is the lit query alone when it lies within the board, else it `and` the board's
  scope. Zoom in is disabled when nothing is lit or the board holds just that.

### The store (server/views.ts)

- `<site>/views.json` holds every kept view and the project's notes; layout memory is in
  `<site>/view-memory/`, one file per view. The site is local and never committed.
- Unkept views live only in memory, while a page or agent has them open and a few seconds after.
- An unreadable kept view is never dropped: it stays in the file as is, is reported and listed, and
  comes back once readable. Missing fields take defaults; a legacy single `target` is read as
  `targets`. An unreadable note is skipped.
- Pins are stored per view and clustering in drop order (a reload keeps which overlapping drop
  wins), with the layout version. Pin authors (person or agent, and when) are kept per view and never
  sent to pages.
- Live events: `views`, `view-ops` (operation lists), `view-memory`, `note-ops`.
- A declaration moved to a new name (HistorySpec; `moveDeclaration`) moves its pins, note mentions,
  `decl`, closure roots and `key` targets in scopes, focuses, and target links (`retarget`, same view
  id). What a move carries into an unkept view does not keep it. The server never otherwise changes
  a scope.

### Views and target links (shared/views.ts)

- `views/open {scope, version?, clustering?, focus?}` finds or makes an unkept view by query and
  build; no item lists. `views/create {from, scope?, version?}` copies scope, clustering, pins, folds,
  hidden levels, layout memory, notes, items and focus; a copy of the Project lists as added the notes
  its scope does not give. New views: scope `all`, "New view" (then "New view 2"); copies "<title>
  (copy)".
- `targets` on a record, in link order; a target is in one list at most; nothing is stored for a
  target with no view. `syncTargets` (at start and each review change) drops unmarked targets from
  their view (`unlinked`) and moves a renamed target's link; it never creates or links a view.
- `POST /api/views/target {target}` (any level, no name needed) returns the target's view or the
  temporary one; its `linked` change is marked `temporary` and never recorded. `POST /api/views/review`, `POST /api/agent/views/review` and the MCP
  tool `make_review_view` do not exist (404).
- The `deleted` timeline event carries `targets` and `scope`; a legacy single `target` is read so.
- Reader focus lives in `Seen.focus` and `PresenceView.focus`.

### Visitors (web/src/visitors.ts, web/src/visits.ts)

Presence carries the trail (`PresenceView.visitors`: name, origin, `in` cluster, `spot`, legacy
`at`); at most eight are read. Nothing of a visitor reaches a view's record. The board's folds are
kept apart from folds opened for a visitor.

### Notes and items (shared/sticky.ts, shared/projectnotes.ts, shared/items.ts)

- A view keeps at most 300 notes, each at most 2,000 characters with place, open state, author,
  times, `carries` and `card`; ops `note`, `note-edit`, `note-move`, `note-open`, `note-card`,
  `note-delete`. The server stamps authors and editors from the sender, never from the page's data.
- Project notes: at most 1,000; ops `pnote…` via `/api/views/notes`, sent as `note-ops`;
  `/api/views/note-kind` switches kind atomically.
- `items {add, remove}`: op `{op: "item", note, in}`, refused on the Project; each change is a
  `view` timeline event with `what: "items"`.

### Hidden levels (shared/layout.ts, shared/board.ts)

- `hidden` per clustering; op `{op: "hide", mode, key, on}`. Hiding drops the cluster's fold.
- `clusterTree` merges chains first, then removes hidden levels bottom-up; a merged chain hides by its
  deepest key (intermediate keys hide nothing). Keys are full paths; a moved-up label that clashes
  with a sibling says the hidden levels it came through (`B.Z` beside `Z`).
- Memory under other hidden levels is regrouped: places kept, a shown level drawn round its members,
  siblings making way in that parent only.
- Pins are parent-relative: on hide or show they are reframed to the same place in the same
  operations; a hidden cluster keeps its own pin. Unpinned members of a dragged level are pinned in
  place (at most 1,500; beyond, they take layout places).

### Known limits

- Re-layout of the Project moves the unpinned parts of every whole-project board.
- `views/arrange` is not an undoable batch (only `POST /api/agent/pins` is).
- In an exported snapshot, view changes last until the page closes.
