# Notes

Writing notes that point people at something; listing, editing, moving, deleting them. MCP:
`notes` (`write`, `list`, `edit`, `move`, `delete`).

## `POST /api/agent/note` (needs advise)

Written as from the canvas menu, marked as yours, in Activity under your name; it moves nobody's
view.

- **A note of the project** (no `view`; the default): one item, belonging to views as declarations
  do. One place per clustering: in a cluster at a spot kept as a fraction of its radius (the same
  on every board), or on the board's ring at an angle; under the other clustering, until placed,
  on the ring at the angle of what it is about. Shown on the Project always; on another view where
  its scope gives it (`why` in `GET notes`; naming a declaration in backticks does not count) or
  where added (`in`, or `views/items`: [views](views.md)), unless taken out. Where the board does not draw its cluster, or at the top
  level: on the ring, toward what it is linked to there.
- **A view's own note** (`view`): on that board alone, in a cluster at an offset in its local
  coordinates, or at a spot of the board.
- **Attached** (`decl`, either kind): placed at the declaration under every clustering, shown on
  every board holding it, its icon at its offset (closer on screen as the zoom goes out) with a
  dashed leader; a dot while the declaration's cluster is too small on screen. A rename
  carries it; with the declaration gone otherwise, it falls back to its places beside it in its own
  cluster under both clusterings.

```json
{ "text": "every use of `MyProject.Example.halve` in the rounding layer assumes rounding down",
  "name": "MyProject.Example.halve" }
```

| field | meaning |
|---|---|
| `text` | ≤ 2,000 characters: plain text, **bold**, *italics*, `code`; a full name in backticks links; no HTML |
| `view` | a view's id: its own note |
| `in` | (project note) the view you write it in, which it is added to (at advise), so it shows there wherever put; left out, the Project's and what the scopes give |
| `clustering` | (project note) `namespace` (default) or `module`: the one it is placed under |
| `cluster`, `at` | a cluster key in that clustering (a namespace, or a folder: its modules' path with dots) and `[x, y]`: project note, a fraction of the radius (`[0.5, -0.3]`: right, a bit up; default `[0, 0]`); view's note, an offset from the centre — or — |
| `name` | a declaration: just beside its point, in its cluster by that clustering (view's note: on a view holding it) — or — |
| `ring` | (project note, top level) degrees clockwise from the top (`0` top, `90` right); `true`: no place by that clustering, at its cluster's angle under the other — or — |
| `decl` | attach: a full name, or `{"name": …, "at": [x, y]}`, the icon's offset from the point in board units (a point is 10 across, neighbours ~10.3 apart; x right, y down; kept along its direction 12–2400 units away, to 0.1; default `[24, -24]`). A person's drag keeps it attached within 64 units at middle zooms, held to 48–160 px on screen (2400 units at the least zoom). Project note: its places go beside it under both clusterings; view's note: its board must hold it. 404 unknown name; 400 with another place — or — |
| `at` alone | (view's note) `[x, y]` in its board's world coordinates, in the innermost open cluster there, or on the canvas |
| `open` | `true` (default): text shown; `false`: collapsed to its first words |
| `card` | the card's centre from the icon's, `[x, y]` in screen pixels (x right, y down), each within ±600; default up-right (outward on the ring) |
| `carries` | ≤ 8, none twice: `{"file": "<sha256>"}` (or the bare hash) for an image or whole PDF of the library; `{"file": …, "page": 10, "region": [0.11, 0.16, 0.89, 0.28]}` for a clip of a PDF page, in fractions from its top left (word boxes: `library/text`, [library](library.md)). Each in the library, not archived; an image whole; a page the PDF has (400 says why). People see it under the text (a PDF as its first page and title); a click opens it in the reference window (a clip at its place) |

Boards are read as laid out at rest (pins, hidden levels); a project note placed by `name` or
`cluster` is placed on the Project. When a build moves all of a note's cluster to another
(a folder or namespace renamed), the note follows (an edit by VisualProof); its cluster otherwise
gone, it shows in the nearest one left, or on the ring. A key never stands for the other
clustering's cluster (a folder and a namespace can share one).

Answer `{ok, id, kind, text, open, by, agent, at, carries, card, decl, here, …}`, plus `places`
(per clustering `{cluster, at, around}`, `{ring}` or null), `why` and `in?` for a project note, or
`view`, `clustering` for a view's. `decl`: `{name, at}` or null. `here`, its place on the board (the Project's, its view's, or the `in` one): `{decl, at}`;
`{cluster, at}` or `{cluster, offset}`; `{spot}`; or `{ring, about}` — `ring` the angle it was let
go at, or null: at the angle of `about` (`{links}`, subjects a carried file is linked to there, else
`{clustering, cluster}`), else by order of writing. 404: unknown view, cluster or
declaration; 409: the view holds 300 notes, or the project 1,000.

## `GET /api/agent/notes?view=&all=` (any level)

`{view, title, items?, notes: [{id, kind, text, open, by, agent, at, edited?, carries, card, decl,
places? and why? | view?, here}], note}`: anyone's notes on the board — project notes that view
shows (left out, the Project: all) and its own. `all=1`: every project note, `here` and `why` null
where not shown.

- `why`: `project` (the Project holds all), `decl` (attached to a declaration on the board),
  `cluster` (its cluster is on it), `ring` (top level here; its cluster under the other clustering
  is on the board), `link` (carries a file linked to what the board holds), `added`.
- `items`: the view's `{add, remove}`, by id. `card`: null by default. `carries`: each with `what`
  (`image`, `pdf`, `clip`), the file's `title` (null without a library record), `archived` where so.

## `POST /api/agent/note/edit`, `/note/move`, `/note/delete` (needs advise)

Your own notes at advise, anyone's at full. `id` names the note; `view` too for a view's own.

- `edit {id, view?, text?, carries?, open?, card?, kind?}`: `carries`: the whole list (`[]`: none;
  items already carried stay whatever became of their file; additions are checked); `card: null`:
  the default. `kind: "view"` with `view` makes a project note that
  view's own (Only in this view; it leaves every view's items); `kind: "project"` makes a view's
  note the project's (In every view), added to that view. A switch keeps text, author, what it
  carries and its place on that board (its cluster under the board's clustering, none under the
  other; or the ring at its angle); 409 where that board does not show it.
- `move {id, view?, clustering?, cluster? + at?, name?, ring?, decl?, detach?, card?}`: a project
  note moves under one clustering (default `namespace`) on every board of it, the other untouched;
  a view's note on its board (`name`, `cluster` + `at`, `at`). `decl` attaches either kind, as for
  `note`; `decl: null` or `detach: true` detaches it (back
  at its place under each clustering), as does any other place given. `card` moves the card,
  with a place or alone (the note then stays, attached or not).
- `delete {id, view?}`: for everyone; a project note leaves every view's items.

Activity records edits of text or carries, and deletions (with the text); not opening, collapsing,
moving, attaching, detaching, card moves or kind switches. Edits and switches keep the attachment.
