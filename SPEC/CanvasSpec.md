# VisualProof Canvas Spec

How the canvas looks and behaves, beyond SPEC.md. What a board holds: ViewSpec.md. The review:
ReviewSpec.md. Whose a note is, which boards show it and its places: AttachmentSpec.md (decisions
12–19).

## Decisions

1. **WebGL2.** Canvas2D cannot carry the simulation and bundled edges of 20,000 nodes at
   interactive rates. Cards are DOM elements over the canvas, so their text is real text.
2. **Hierarchical coordinates**, as in a scene graph: a cluster's position is local to its parent's
   origin, a node's to its innermost cluster's; world = the sum along the chain. Moving a cluster,
   folded or not, carries its subtree; unfolding restores the children's local offsets. The
   namespace tree and the file tree have separate coordinates.
3. **Cluster boundaries are circles, and circles mean containment**: a cluster's circle contains its
   sub-clusters' circles and its declarations' points at every moment, also during motion, and
   nothing else. Circle inclusion is the cluster tree, exactly.
4. **Elastic displacement.** Every body (a visible node or a folded cluster) is sprung to its
   anchor; bodies push each other apart and spring back. Where a dragged body is dropped becomes its
   anchor (a pin, in local coordinates).
5. **Hierarchical edge bundling** (Holten 2006): an edge is a spline through the origins of the
   clusters on the tree path between its ends.

## Dependency order

Inside a cluster, what is used sits low and what uses it high: a tendency, not a strict order. Only
the placement of a cluster's children changes; the clusters stay.

- **Charge model.** Each dependency u → v is a 1 V battery with a resistor. Each cluster solves the
  network of its children: a dependency counts between the two children of its ends' lowest common
  ancestor, and in each cluster below that on either side between that side's child and the ground
  (everything outside the cluster, 0 V). Conductance log(1 + count), battery (a→b − b→a) /
  (a→b + b→a); φ minimises Σ conductance · (φ_a − φ_b − battery)², so no cycle needs breaking.
- **Placement.** Sorted by φ, children fill the disc from the top, each at the middle of its share of
  the disc's area; collisions and a pull to the centre keep it round. Only the order is kept.
- **Stability.** An item keeps its place unless its height in its cluster moved by more than a tenth
  of the cluster's radius. Across graph versions a node keeps its place only while its cluster keeps
  its key; with fewer than half the nodes surviving, the layout starts afresh.
  - **A build's two graphs are one** (the owner's decision of 2026-10-14). The graph read first waits
    for the usage pass, and its layout is provisional; the usage pass's graph completes the build
    and is laid out against what the build was laid out against (nothing, on a first read), never
    against the provisional layout, which lacked the notation's edges. So a first read gives the
    picture a Re-layout gives, and a later build keeps the places of the build before. A site with no
    memory lays its graph out afresh, whatever view the cache holds.
- **The same picture everywhere** (the owner's decision of 2026-10-19). The layout is a function of
  the graph alone, to the last bit, on the server and in every browser: it computes its
  transcendental functions itself (shared/libm.ts), sorts by total orders, and finds overlapping
  pairs through grids in the order a plain pass takes them.
- **Layout version** (`LAYOUT_VERSION`, shared/graph.ts): when it changes, the server drops every
  view's pins once (both clusterings) and its layout memory (`<site>/layout-memory.json`). Scoped
  boards' memory (`<site>/view-memory/`) has no version and is kept.

## Navigation

- **Going somewhere is a click** with the current tool (ViewSpec decision 12) on the declaration, from
  a list row, a name in a signature or a search hit: picked, shown in the panel, flown to, unfolded.
  Hovering a row highlights it without moving the view.
- **Tools** (ViewSpec decisions 12, 20): Selection; Rests on (Uses, TCB, Keys); Used by. Address
  tokens: `plain`, `deps`, `tcb`, `keys`, `apps`.
- **Back and forward.** Each step (a click on a declaration, row or name, a search hit, clearing the
  selection, another view) is a browser history entry holding the camera; ‹ › (bar, source window)
  and the browser's controls move through them. Switching tool with nothing selected rewrites the
  address without a step; with a selection it picks again, a step.
- **Shareable.** The address names view, tool, selection and panel content (ViewSpec decision 10),
  also in an exported snapshot.

Implementation notes:

- The layout (shared/layout.ts) runs on the server for the whole project and in the page for any
  other scope (shared/board.ts), so boards need no server and work in snapshots.
- The address uses `history.pushState` / `replaceState` and must work from `file://`; the camera
  rides in the entry's state.

## The coordinate model

- Layouts travel as local positions: cluster `(parent, lx, ly, r)`, node `(cluster, lx, ly)`, one
  per clustering; the page computes world positions. Pins are local offsets.
- **Folding is a layout event.** A folded cluster is one body, radius ∝ √size. Its siblings' anchors
  contract towards the parent's origin by area, keeping direction and rank in distance, never past
  their home distance: folding never enlarges the parent. Folding every top-level cluster leaves one
  body per top-level folder or namespace, packed.
- Folding goes a level at a time for the board ("Depth") or a cluster at a time (double-click, the
  outline). Folds belong to the board (ViewSpec decision 5).

## Motion

- **Forces follow the hierarchy.** Each cluster simulates only its direct children in its local
  frame (a sub-cluster is one disc): sibling collision, only while something is dragged; the anchor
  spring; dependency springs between the two children of the ends' lowest common ancestor, parallel
  edges one spring, log-stronger. Cost: the direct children of the moving clusters.
- **Pushing is cluster-granular.** During a drag only, a local contact pass lets the dragged body push
  nearby nodes of any cluster. The dragged body pulls its dependencies and dependants, rest lengths
  measured from where it was before the drag.
- A cluster's simulation sleeps when still and wakes on a drag, a contact or a body off its anchor;
  one whose contents pass its circle wakes its parent. Folded-away content rests at its anchors.
- Released bodies return to their anchors through each other (anchors never overlap, so the rest
  state is clean). A body dropped on others takes their place; the covered ones get anchors beside it.
- The simulation runs on the main thread (a worker adds a round trip between pointer and body).
  Nothing is rearranged during a drag; the parent is arranged once on release (its ancestors only if
  its size changed).

## Boundaries

- A circle is drawn at least as large as its contents need, plus a margin, growing at once and easing
  back to the layout's radius.
- Siblings never overlap at rest: a grown cluster pushes its siblings' anchors aside, a shrunk one
  lets them in. Of two overlapping drops the later stays and the earlier makes way. A declaration
  dropped on a sub-cluster of its own cluster is not left inside it.
- What is dragged stays inside its parent's circle. A drop never enlarges its circle beyond the little
  needed when what it crowds cannot fit. Top-level clusters go anywhere. Pins load clamped inside.
- A cluster's label sits inside the top of its circle once large enough on screen (folded: below it);
  one that would cover another moves a line down or is dropped, the enclosing cluster keeping its own.

## Hover, click, drag

- The pointer highlights the most specific target visible at this zoom: a note's icon, dot or card
  (above all), a declaration (when points are far enough apart), a card, a folded cluster, the
  innermost open cluster large enough on screen. It re-picks after a click or drag and when something
  comes to rest under a still pointer.
- **Click selects** with the current tool, clusters too (ViewSpec decisions 11–12); shift-click under
  Selection toggles one pick; a click on empty space clears. **Double-click folds or unfolds.** **Drag
  pans** unless drags move things; a drag starts after a few pixels, so a click never moves anything,
  and what is dragged keeps its offset from the pointer.
- **A pick has no card**: a ring marks each pick's root, and a lead runs from the last clicked thing
  to the panel. Lit declarations' cards take the first of eight places round the point covering no
  card, lit point, ring or panel (the last place first, so cards do not jump), else stay points.
- **The lock** (⋯, key `l`), on by default: locked, drags pan; let go, a drag moves what it starts on
  (a cluster with its contents), for everyone. The drag key held at the press does the other; ⋯ shows
  the way while it is held, and a dot while drags move things. Kept in the browser for all projects.
  With Ctrl or ⌘, letter keys are the browser's.
- **The drag key** is ⌘ on macOS and iPadOS, Ctrl elsewhere: on a Mac, Ctrl+click is the secondary
  click, so it opens the canvas's menu and is never a page click, while a Ctrl drag is ordinary. The
  platform is read once (`navigator.userAgentData.platform`, else `navigator.platform`, else the user
  agent); every text naming the key follows it. Ctrl+wheel (pinch) zooms everywhere.
- **Re-layout** is the board's (ViewSpec decision 5). The middle button pans; the right button opens
  the canvas's menu (ViewSpec, "The canvas's menu") and moves nothing.
- Space toggles the source window that follows the selection (ReviewSpec, "The source window"); it is
  not modal, and canvas clicks still select.

## A board of a past build

It works as a board of the latest build (HistorySpec decision 19). Only a **preview** of a view at
another build than its own (the Time Machine) is arranged by nobody: a drag pans whatever the lock,
and folds are the reader's own until the view's board is shown again.

- What is lit is drawn lit; a point gone now is marked with a red ring.
- The source window shows the text of then (HistorySpec decision 23): hover cards show statement and
  doc, generated declarations are listed by name. A banner names the build, and says when the text
  was matched by recorded places rather than by hash; where none is kept, window and panel say why.
  Pinned windows follow the board to its build, found by name.

## Notes

A note is an **icon at its place**, its content on a card hanging from it.

- **Placement.** A project note sits in its cluster under the board's clustering at a fraction of the
  drawn radius (the same spot on every board); a merged chain counts as each of its clusters, a
  hidden level as the nearest drawn cluster. A view note sits in the most specific open cluster at its
  spot at a local offset, else on the canvas in world coordinates; when that cluster is gone, in the
  nearest surviving ancestor, or the canvas; under the other clustering, on the ring about its
  cluster, never in a same-key cluster. Either is kept inside its circle as drawn. A drop goes into
  the most specific open cluster at the spot large enough on screen to point at (the one the highlight
  shows); a project note dropped where no cluster is goes on the ring at that angle. Otherwise the
  ring is as AttachmentSpec decision 16 says; hovering a ring note lights nothing.
- **Attached to a declaration** (either kind, by a drop on it; on every board holding it, a visitor
  counting): its place is an offset from the point in board units (a point is 10 across), so it
  scales with the zoom like a node. A dashed accent leader ends in a small diamond on the point's rim,
  leaving the point its colour.
- **Dragging an attached note** shows a circle round its point: the zone where it stays attached,
  dashed accent over a surface-coloured rim (visible in both themes), sized so a short move detaches
  it zoomed in and the circle still shows zoomed out. Inside/outside is read at the icon's centre, as
  for every drop. Dropped inside, it stays attached there, pushed clear of the point. Outside, the
  circle fades and the drag is a free note's; dropped there, it is detached. An icon already beyond
  the circle starts outside. Another declaration under the icon (where points can be pointed at) is
  lit and wins over the circle and clusters: the note attaches to it on the side dropped, clear of the
  point (on the point: the default direction). A free note dropped on a declaration attaches likewise.
- **The icon**: round, 24 px, accent outline; it shows only what the note carries — a note
  (nothing), an image (images alone), a paper (a PDF or clip) — and a count when more than one. A view
  note's icon has a dashed ring. Tooltip: first line, what it carries, the view, the declaration.
- **The card** (expanded): a DOM element of fixed screen size, page font and surface, accent edge:
  the text (plain with **bold**, *italics*, `code`; full names in backticks are links; never HTML),
  what it carries, the author (an agent with its robot). A view note's card has a dashed edge and
  says "only in this view" with the view's mark, never its name. It hangs on a thin leader, never
  over its own icon, and **covers other notes' icons and dots**. By default up and right of the icon,
  flipped to stay in the room the bars and panels leave and off its cluster's label; on the ring,
  outward. A drag on the card moves the card alone (its offset), never the note.
- **Long text** scrolls in the card past 260 px: wheel, two fingers, scrollbar, finger or pen; it
  never falls through to the canvas, even at the ends. A mouse drag off the scrollbar pans or moves
  the card; elsewhere, or with Ctrl, the wheel zooms. Scrolling never ends following; a press does.
- **Mentions follow their declaration** (HistorySpec decision 8): backticked full names are rewritten
  as an edit.
- **Clicks.** Icon: toggles expanded for everyone, at once. A carried item: opens in the reference
  window (a clip at its page, region lit; a PDF at page 1; an image whole). Card: nothing;
  double-click edits. Right click: Edit, Collapse/Expand, Attach…, Detach, Only in this view / In
  every view, Add to view ▸ / Remove from this view (project notes, not on the Project), Delete.
- **Files dropped or pasted** go to the library, each in a new project note at the drop (a paste:
  where the pointer last was), titled by the file, open for editing, added to the view; several lie a
  note's width apart.
- **Icons scale with what they belong to.** A note in a cluster, or attached, is an icon only while
  its cluster (attached: the one holding its declaration; top level: the board, the ring's radius its
  circle; a visitor's: its board cluster) is at least 120 px in radius on screen, where a card fits;
  below, a dot the size of a point, coloured by what it carries (note accent, a paper's amber, an
  image's teal), blending with the zoom, never in time. Leader and diamond fade with the icon and are
  absent for a dot. A card shows only with its icon whole. A click on a dot flies near enough to
  read; a drag on it pans. On the ring and canvas, icons keep their screen size; on the rings cards
  hide while the innermost ring's radius is under 120 px. A view note on the canvas always shows its
  card.
- **What is above what**, bottom to top: leaders (no line crosses an icon); icons, dots, folded
  clusters' note markers; cards, the last pressed or opened in front; what would hold a dragged note,
  and an attached note's circle; the dragged icon. All over the canvas, under the panels.
- **Fit to screen** (and a first framing) frames the board, the notes' marks at the resulting zoom
  and the open cards; failing that, without the cards; then the board alone; never under a bar or
  panel.
- **Folded**: notes inside a fold are hidden; the outermost folded cluster shows their count, and a
  click on it unfolds it for everyone.
- **Moving a note** is a drag on its icon when drags move things (else it pans, and the wheel zooms
  through it except over scrolling text); the card follows. What will hold it is lit: a declaration
  (over its cluster), an attached note's circle, the cluster, or for a project note at the top level
  the ring; a view note at the top level lights nothing. Dropped on a declaration it is attached
  (inside its own circle it stays attached); else it is placed from where its icon is (a project note
  under the board's clustering alone, on every board of it; a view note by `placeAt`), detached if it
  was attached.

Implementation notes:

- Notes are placed every frame from the scene's world positions, hidden more than 40 px off screen.
  Icon, leaders and card are separate elements of one layer stacked by z-index (`NOTE_Z`): leaders 1,
  marks 2, cards 3 (the last 64 raised keep their order), drop target 68, dragged icon 69. A note
  that comes from someone else is lit a moment.
- A text that scrolls takes the wheel only when it overflows and Ctrl is not held (overscroll
  contained); a finger or pen press on it, or a mouse press on its scrollbar, starts no card drag; it
  has `touch-action: pan-y`.
- **The rings** (shared/ring.ts): the first is centred on the box round the board's top-level circles
  and declarations, radius the farthest plus 3% (at least 12 units); each further ring 32 px of screen
  out (an icon and 8 px). A note's angle: where it was let go; else the mean position of what it is
  about (at most 4,000 declarations read); else none, if that lies within 0.2 of the radius from the
  middle. Neighbours keep at least 6 px of screen apart in a straight line, each taking its extent
  across the ray (its 24 px icon, plus its open card). Angled notes keep their order, each moved as
  little as the gaps need; a ring holds them while none is over 45° off its angle. Angle-less notes
  follow in written order, clockwise from the top at the first clear place, without passing the top.
  Rings are assigned at fixed zoom levels (twelve to a doubling; a zoom between two packed as at the
  smaller), from the lowest level where one ring holds all, downwards: in written order each note
  keeps its ring or moves out to the first that holds it with the older ones; an angle-less note
  never sits inside an older one. So zooming out moves the newest out first, only when needed, and a
  zoom's rings never depend on the path. A note's ring is never stored. A dragged note leaves the
  rings; the first ring is drawn dashed meanwhile.
- **The card's offset**: `card: [x, y]`, the card's centre from the icon's in whole screen pixels,
  x right, y down, each within 600 (`CARD_REACH`); on both kinds of note, kept across a switch of
  kind, shared like the open state, no timeline event. Set by `pnote-card` / `note-card` (`null`: the
  default), which need no name, and by agents via `card` on `note/move` or `note/edit`, at the levels
  moving needs. Default: nearest corner 20 px right of and above the icon's centre; on a ring, the
  near side 26 px out along the ray. Any offset is pushed out to keep the card 4 px clear of the icon.
  Flips are tried in the order across, vertical, both, for the first wholly in the room (6 px in); a
  kept offset is flipped only to stay on screen. A card let go keeps the offset it hung at.
- **The circle round an attached note's declaration** (shared/sticky.ts): screen radius `DECL_REACH`
  (64 units) × zoom, held between `ZONE_MIN_PX` (48) and `ZONE_MAX_PX` (160); inside while the icon's
  distance from the point × zoom is within it. An offset is at least `DECL_NEAR` (12 units), at most
  `DECL_FAR`, by default `DECL_AT` ([24, −24]); a drop is pushed out to `DECL_CLEAR_PX` (40 px on
  screen) where nearer, held between 12 and 64 units. The numbers hold together: 48 px contains the
  40 px push; 160 px contains `DECL_NEAR` at `ZOOM_MOST` (12: 144 px); `DECL_FAR` is 48 px at
  `ZOOM_LEAST` (0.02: 2,400 units), so any drop inside is kept as dropped or pushed out and still
  inside. `ZOOM_LEAST` and `ZOOM_MOST` are the canvas's zoom bounds. A drop within 0.1 unit of the
  point takes `DECL_AT`'s direction. A declaration target is a ring 17 px round its point (the icon's
  radius and 5) and none takes a note below zoom 0.6.
- **Icons and dots** (shared/notecard.ts): a note belongs to a circle (above) or to nothing (the
  ring, a view note on the canvas). Its icon share t at zoom k is 1 while radius × k ≥ 120
  (`AUTO_COLLAPSE_PX`; a card is ~240 px wide), else 1 + log2(radius × k / 120) / 0.5, down to 0; 1
  with nothing. The mark's screen radius is a point's (3·√k, 1.3–5 px) plus t of the way to 12 px;
  the dot fades in as 1 − t. Colours: `--note-paper` (the reference window's link colour),
  `--note-image`; a 1 px surface edge; hit within 4 px. An attached mark is at point + offset; its
  diamond 4.5 px beyond the point's radius (a visitor's: 1.5 × a point's, at least 5). A click on a
  mark at t < 1, or on a ring icon whose card is hidden, flies: to its cluster at 132 px radius (up to
  zoom 12); attached, to the middle of note and point, zoom at least 1.1, the cluster as large. A
  press on such a mark never moves anything.
- A carrying card is 320 px wide with an image or clip, 260 px with whole PDFs alone. A file the
  library has no record of shows as a paper.
- **Fit** (`fitFrame`): boxes for the board's corners, each note's mark (its icon plus 12 px where
  shown at the zoom tried, else its dot) and, with cards, each card shown at that zoom, unflipped. The
  zoom is the largest, at most 4, fitting 94% of the free room, by halving, the rings re-packed per
  zoom tried.
- A note's editor lies above the floating windows.

## Edges

- β runs from 0 (straight) to 1 (tight along the tree). Control points are cluster origins in world
  coordinates, splines evaluated on the GPU from a positions texture, so edges follow motion unrebuilt.
- **Nothing selected**: statement and body edges among the visible, aggregated per pair, width and
  opacity growing with log(count). Zoomed out, the heaviest bundles; zoomed in, the dependencies among
  the declarations in view (a single one drawn clearly), with a fifth of the budget for links beyond
  the view. **What is drawn follows the zoom continuously**, never time: edges grow in and bundles
  dissolve in proportion to the zoom, reversibly. No edge only a proof or grammar holds is drawn
  there: proof edges, once asked for by a switch, are no more (the owner's decision of 2026-10-15).
- **A selection**: the lit edges bundled on top, the rest faded to 30% of their opacity, still seen
  (overview `DIM`; on the board and in an artwork alike, the owner's decision of 2026-10-15; 12%
  before). Under Keys (ViewSpec decision 20),
  the key graph's edges instead: dashed ("rests on, through non-key declarations") and slightly bowed.
- Colour runs from the user (orange) to the used (blue), a key-graph edge from the end that rests on
  to the end rested on; in a selection, proof-only edges are fainter. The legend shows the gradient.
- **In the dark theme, edges step back as they grow many** (`--edge-crowd`; the owner's decision of
  2026-10-19), their ends deeper, so that a dense bundle mixes into a colour, not a haze. The light
  theme draws as before.

Implementation notes:

- The overview aggregates to units at least 45 px across per zoom step (half an octave), keeping six
  steps. Choices are made at zoom points a quarter step apart, each blended from its two steps; the
  camera draws its two points blended by position, an edge in both drawn once between its two looks.
  Re-chosen when the view moves a sixth of itself, at most every 150 ms and once after it stops.
- Budget: 0.6 bundles per on-screen unit, 250–1,500; both ends in view first (weight, shortness,
  nearness to the middle), then those leaving the view; soft, the next fifth fainter. Width and
  opacity are relative to the heaviest chosen bundle of its kind, the opacity floor 0.05–0.35, rising
  as fewer bundles are in view. Overview β = 0.85 · min(1, 2d / R) (d: the ends' distance, R: the
  largest cluster bent through); a selection's β = 0.85.
- **The overview is chosen in a worker** (web/src/edgeworker.ts, served as `/edges.js`), so zooming has
  no slow frames: the graph's edges are sent once, the tree and toggles numbered on change; each
  question carries positions, radii, camera and dimming. At most two questions are out; the latest
  wins (stale, far or wrong-tree answers are dropped; superseded questions skipped). A point chosen
  under another selection is drawn dimmed as now. Without a worker the page chooses itself.
- **A missing point never holds a frame**: the nearest held points stand in (within four points),
  and what is drawn moves toward the blend by at most twice the zoom travelled per frame; a zoom
  stopped for 60 ms settles at once. Fast zooms and flights ask ahead for where they will land.
- Declaration names (zoomed in, nothing lit): at most 700, nearest the middle first; one covering
  another name or a cluster label is left out.
- **Names float over everything** (the owner's decision of 2026-10-15): clusters' and declarations'
  names are written last, over the edges, points, rings and marks, each on a halo of the background
  that fades outward (web/src/halo.ts: three strokes round the letters, 7, 4.5 and 2.6 px wide at 22,
  40 and 85 % opacity), the halos of all of them before any name, so that nothing crosses a name and
  no halo covers another. An artwork's names and foot are written so too (ExportSpec decision 19).

## Depth

- Depth (⚙ Board, ViewSpec decision 17) and `[` / `]` fold or open the whole board a level at a time,
  skipping levels with no cluster of 20 px on screen, so each step changes the picture. The level
  shown (n / max, All open) is read from the folds.

## Zoom, theme and the ⋯ menu

- Zoom buttons (+, −, fit; keys `+`, `-`, `f`) at the bottom right. ⋯ (ViewSpec decision 17) holds
  the lock, edges, the linear form (ExportSpec decision 18, `o`) and theme (light, dark
  or the system's; light by default on every platform, the owner's decision of 2026-10-14); the theme
  is the browser's, for all projects, applied from the first paint.
- **Reduced motion holds on the whole page** (the reader's system setting; the owner's decision of
  2026-10-19): nothing glides; the camera is where it goes at once.

## Colour schemes and the legend

- **Kind**: a hue per kind (theorems their own); the outside world as rings, not dots.
- **An axiom is a ring** (the owner's decision of 2026-10-18): every axiom on the board, the
  project's and the outside world's, is drawn with a ring of its point's own colour a gap apart
  (1.5 px wide, 1.5 px out; web/src/axiomring.ts), in both schemes and every artwork style, lit or
  not. The palette stays: to a deuteranope Kind's axiom red and structure green are one colour
  (ΔE2000 1.2), and the shape tells them apart; the ring stands out from its ground as much as its
  point does. Its colour says nothing of its own, so it stays apart from every mark round a point,
  which go outside it: the pointer's and the selection's accent rings, the others' rings in their
  colours, a pin's grey ring, a past build's amber and teal, a key's gold diamond; the selection's
  and the others' clear of a lit axiom's ring by 2.5 px. An axiom's name is written beyond it. Every
  dot on the page that shows a kind or a state rings an axiom the same way: the legend's, the
  panel's, a card's, the search's, the source window's, the pointer's tip.
- **Status**: the most urgent state wins: building > failed or not built > contains `sorry` (anywhere
  below, through `sorryAx`) > commented > stale > approved > not yet reviewed / trusted (ReviewSpec,
  "What the page shows" and decision 3; trusted only with no opinion on it). Out of date, queued and
  blocked files show as last built. Okabe–Ito colours, apart for colour-blind readers; quiet states
  differ in lightness and shape:

  | State | Colour |
  |---|---|
  | building | sky blue |
  | failed or not built | dark grey |
  | contains sorry | reddish purple |
  | commented | cobalt blue, calm, darker than building |
  | stale | orange |
  | approved | bluish green |
  | not yet reviewed | mid grey, a plain dot |
  | trusted | a very light green |

  `--status-*` (web/style.css), both themes. On the dark canvas the quiet states go the other way
  (the owner's decision of 2026-10-18, with the dark theme's palette, midnight: a blue-black ground):
  the quieter, the closer to the ground — trusted a dim green, not yet reviewed a mid grey, failed
  the brightest, near white, as the light theme's failed is its darkest. Agents' advice is never a
  state.
- **Two palettes for the review, on purpose; do not unify them.** `--rv-*` colour what reviewers said
  where the review is read (opinions, progress, TCB lists and queues, trust shields, advice);
  `--status-*` only the Status scheme (points, file outlines and arcs, legend, card dots). The build
  status (pill, outline dots) has `--st-*`.
- **No status rings on the canvas**: the picks', other readers' (CollabSpec decision 4), the target's
  gold star, a key declaration's diamond (ExportSpec decision 4), a pin's thin ring and an axiom's own
  ring are the only marks; status is read by switching to Status. A card shows its point's colour in the scheme in force
  and no other mark of status. The outside world is a ring in its state's colour.
- **Files and clusters**: plain by kind. In Status, with clusters as files, a file whose own build
  failed, is building or has a `sorry` gets a thin outline in that colour (never a namespace); trouble
  inherited from below shows nothing. Each cluster of 18 px or more shows an arc from the top,
  clockwise: approved, then commented, of what it holds that needs review.
- **The legend** (bottom left) folds to a chip naming the scheme (by status a pie of the board's
  review). Open: Kind | Status, each colour with its count among the board's declarations (outside
  included while shown), and the edges' key; by kind the axiom's dot is ringed, by status a line of
  its own says that a ring is an axiom. Open or folded is kept in the browser.
- **Which scheme**: a view where the review has a focus (ViewSpec decision 28) opens in Status, others
  in Kind. The reader's switch is kept in the browser per project, apart for focused views and others;
  never shared, but followed (CollabSpec decision 4). Key `c`.

## The outline

- In the side panel's cluster tree, a folded row looks inactive (grey label, hollow mark).
