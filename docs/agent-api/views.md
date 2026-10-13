# Views and the layout

Views, their targets and focus, queries, the endpoints, past builds, pins on the Project view.

## Views

A view is a board everyone shares: its **scope** (a query) and arrangement (clustering, folds, pins,
hidden levels of its cluster tree); each person's camera and selection are their own. The
Project (`project`) holds everything; it cannot be deleted or renamed (400). A view on a query
nobody arranges or names is not kept: it lives while someone (a page, or you) is on it; pinning,
folding or naming keeps it.

- **A target has at most one view**, or none, opened by clicking it anywhere. Marking makes and
  links none. `views/link` sets it to any view; the view left keeps scope and arrangement.
- **A view may have several targets** (`targets`, first linked first; a star by its title, which
  stays as any view's, names them). Its focus starts as its first target; later links leave it.
- Taking a target off unlinks it alone; its view stays. A target's view is rescoped, renamed and
  deleted as any kept view; deleted, its targets have no view, and nothing gives them one by itself
  (not marking, a restart, a build or a rename).
- A click on a target with no view, or `view {review}` ([following](following.md)), gives it a
  temporary view of its TCB (`tcb(<target>)`, at the latest build), focused on it and linked while
  it lasts: kept (pinned, folded, named, rescoped, another target linked), it keeps the link; gone,
  the target has none again. Making it is no timeline event; nothing else makes a target a view.
- Views named `review:<target>` (made by marking before) are ordinary views.

## The review is a focus

A view has a focus target or none. With one, the page's review works there — the strip, its line
of progress, marking key (`k`), why a declaration is in the TCB — over the focus's whole review set,
whatever the board holds ([tcb](tcb.md)). `focus` (in every answer giving a view) is: as set (a
target's Key view, opened from its panel: that target; Zoom in: the focus of the view it came from;
by the first target linked; by anyone), else the first target linked, else the one target its
board holds, else `null`. Your own focus (`POST view {focus}`) changes nothing of the view.

## The query language

`all`, `tcb(A, B)`, `uses(A)`, `usedBy(A)`, `decl(A, B)`, `key(T)` (the target and the declarations
marked key for it that its review still holds; `key(targets)`: every target's), `ns(P)`, `file(P)`,
`trusted`, `external`, `kind(theorem, def)`, `status(unreviewed|approved|commented|stale)`,
`advice(approve|comment)`, `sorry`, `nonstandard`; joined left to right by `and`, `or`, `except`;
parentheses group; a closure may take a query (`tcb(ns(P) except external)`); a name that needs it
is in JSON quotes. A target's review set: `tcb(T) except trusted or (uses(T) and kind(axiom) and
nonstandard)`. At most 20,000 characters, 32 levels of nesting, 1,000 parts, 2,000 names, 64
closures (`tcb`, `uses`, `usedBy`, each target of a `key(…)`); beyond, 400.

## The endpoints

Under `/api/agent/`; changes are for everyone on the view. MCP: `views`, action the path's last
part (`list` for `GET views`, `read` for `views/view`).

| request | needs | what |
|---|---|---|
| `GET views` | — | per view `{id, title, description, name, scope, clustering, kept, targets?, focus, by, at, version?, on}`: `title` as shown (people's name, else short, "… @ Oct 9 22:27" at a past build), `description` the scope in full, `by` null for the nameless (a private reader), `on` who is on it, `version` the snapshot it is kept at. `unreadable`: kept views the server cannot read now, left untouched |
| `GET views/view?id=&mode=&members=` | — | scope; holdings `{project, outside}`; items `{add, remove}` (project notes added, taken out: `{id, text}`; `all: true` on the Project); folds; `hidden`; pins; clusters as laid out (`key, depth, count, r, parent, room, at, pinned`), in its own coordinates. `members=1`: its declarations (≤ 5,000) |
| `POST views/open {scope, version?, clustering?, focus?}` | — | the view on that query (the open one with the same scope and build, or a new unkept one); you are on it: `{view, holds, note}`. `version`: a snapshot id (`null`, `0`, left out: latest); `clustering`, `focus` (the target it is made from): a new one's |
| `POST views/create {name, scope?, clustering?, from?, version?}` | full | a kept, named view on a scope, or a copy of `from` (scope, clustering, pins, folds, items — on the Project, every note its scope would not give, as added — and build; with `scope`, that scope arranged as `from`); `version` keeps it at a build (the Time Machine's Save as new view), `null`/`0` latest |
| `POST views/scope {id, scope}` | full | change what it holds (those on it are told) |
| `POST views/items {id, add?, remove?}` | full | project notes (by id) added or taken out: on the add list only where the scope does not give it, the remove list only where it does. Not the Project (400; deleting is [`note/delete`](notes.md)); 404 for no project note. An Activity event, as a scope change: `{ok, changed, view, items: {add, remove}, notes: [{id, shown}]}` |
| `POST views/focus {id, focus}` | full | the view's own focus: a target's full name, or `null`/left out; personal focuses stay: `{ok, changed, view}` |
| `POST views/link {id, target}` | full | link a target (a view with targets takes another; an unkept one becomes kept); not the Project, nor a view at a past build (409): `{ok, changed, view, left?}`, `left` the view it leaves |
| `POST views/arrange {id, clustering?, hide?, show?, fold?, unfold?, pins?, version?}` | full | `version`: the build it is kept at (Keep this version in this view; `null`/`0`: latest again; never on the Project or a target's view; a timeline event); clustering; `hide`/`show` levels (`[keys]`: a hidden cluster's contents sit in its parent, a fold on it goes, the export's sections follow; nothing on the board moves, pins in what moves keep their place); `fold`/`unfold` (`[keys]`); `pins` `[{name or cluster, at: [x, y] or null}]` in the board's coordinates after hiding/showing (≤ 500; beyond the parent's room brought inside): `{ok, view, changed, hidden, placed, note?}` |
| `POST views/duplicate {id, name?}` | full | a kept copy (scope, clustering, pins, folds, items as for `create`), named `"<its title> (copy)"` (numbered while taken) unless named; you are on it: `{view, from}` |
| `POST views/rename {id, name}` | full | `null` removes a kept view's name: `{ok, changed, view}` |
| `POST views/delete {id}` | full | a kept view, with its pins, folds, layout; pages on it go to the Project. A target's view: `unlinked` names its targets; one timeline event: `{ok, deleted, title, scope, unlinked?, note}` |
| `POST views/relayout {id}` | full | ⚙ Board's Re-layout: every pin goes, not undoable; folds stay; on the Project the whole graph is laid out anew: `{ok, view, dropped, note}` |

## Views at a past build

Its `version` is a snapshot ([history](history.md)): the pages show that build's graph (a clock on
its tab, changes since marked), arranged as any view, with that build's layout memory. Not reviewed
(the review is the latest build's); exported by its id as that build's document
([export](export.md)); sources: `GET source?name=&snapshot=<version>`. These endpoints answer its
holdings, clusters and pins at the latest build; a layout they make never becomes its memory. The
companion shows who is in the Time Machine ([following](following.md)).

## `GET /api/agent/place?name=|cluster=&mode=&near=&limit=` (any level)

`place`, `pins` and `undo` are about the **Project view** (other views: `views/view`,
`views/arrange`). MCP: `pins` (actions `place`, `pin`, `undo`).

Where a declaration or cluster is (`mode`: `namespace`, default, or `module`), and what else is in
its parent. Coordinates are in the **parent cluster's frame**, origin at its centre.
`r`: radius (5 for a declaration); `room`: how far from the centre its centre may go;
`parent.room`: the parent's usable radius (less its label's room), so a child of radius `r` goes up
to `parent.room − r`. The page keeps a drop inside. A cluster's key is its full path
(`systemOfUnits.IsFundamental`); a top-level one has `parent.cluster` and `room` null, in the
canvas's frame.

`pinned`: its pin (null: at `laidOut`); `pinnedBy`: `{name, agent, at}`, null if unknown (`name`
null: a private reader, or a page that gave none). An undo's restored pins count
as the undoer's. `siblings`: the rest of the parent (declarations, clusters), each with `r`, `at`
(pin or layout), pinned and by whom, nearest first to `nearestTo` (your `near=x,y`, else the thing
itself); `gap`: free space between the circles were the thing at `nearestTo` (below zero:
overlap). `limit` 0–2000, default 100; `more`: the rest.

```json
{ "kind": "node", "key": "systemOfUnits.index", "r": 5, "room": 34.2, …,
  "parent": { "cluster": "systemOfUnits", "r": 53.1, "room": 39.2 }, "laidOut": [-15.1, 22.9],
  "pinned": [-10.8, -32.4], "pinnedBy": { "name": "Claude", "agent": true, "at": "…" },
  "siblings": { "total": 10, "pinned": 1, "nearestTo": [-20, 30], "more": 8,
    "list": [ { "key": "…", "declKind": "theorem", "at": [-25.4, 22.9], "gap": -1.1, … }, … ] } }
```

To avoid overlaps, ask with `near=` your spot and move until the first sibling's `gap` is positive:
on the page a pin pushes aside what is not pinned (a declaration, or a cluster with its contents),
and the later of two overlapping pins pushes the earlier, so an overlap moves things you did not
mean to, others' pins included.

## `POST /api/agent/pins` (needs full)

```json
{ "mode": "namespace", "pins": [ { "name": "systemOfUnits.index", "at": [-15, -45] },
    { "name": "systemOfUnits.isMaximal", "at": null } ] }
```

`at` in the parent's frame (`place`); `null` lets go (back to the layout). ≤ 500 per request;
beyond the parent's `room`, brought inside as a drag is. Pins are shared, live on every page. The
request is **one batch** in the timeline ("Claude moved 3 declarations"), with each pin's previous
place. Answer `{ok, id, count, placed: [{key, at}, …]}`; `id` null when nothing changed.

## `POST /api/agent/undo {id}` (needs full)

The batch's pins go back, except those moved since (`kept`): `{ok, id, restored, kept, note?}`; 409
already undone; 404 no such batch. People undo from Activity. `views/arrange` pins are no batch.
