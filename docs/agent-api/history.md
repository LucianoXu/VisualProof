# History and activity

The timeline, and the history of builds.

## `GET /api/agent/activity?since=&limit=&name=` (any level)

The timeline, oldest first (MCP: `activity`). `since`: an ISO time (your last answer's `now`) or an
event `id`. `limit` (default 100, max 1000) keeps the newest; `more` counts the rest.
`name=<declaration>`: only what is about it — opinions, advice, notes, key marks, links on it; a
target's own events; a note is about the declarations its text names (in backticks, or a dotted
name bare).

```json
{ "now": "…", "more": 0,
  "events": [ { "at": "…", "kind": "opinion", "by": "Alice", "name": "IsRegularNumber", "verdict": "approve", … },
              { "id": 3, "kind": "layout", "by": "Claude", "agent": true, "count": 1, "moved": [ "…" ], "undoneBy": 4, … },
              { "id": 4, "kind": "undo", "by": "Alice", "of": 3, "restored": 1, "kept": [], … }, … ] }
```

Every event with a `by` has `agent`. `by` is null on a `view`, `note` or `undo` event done without a
name (a private reader's; their opinions, targets, key marks and trust keep their name).

- Review's logs (no `id`): `opinion`, `target`, `key` (as marked now: `target`, `name`), `file`
  (`what` added, edited, archived or restored; `sha`, `title` then, `wasTitle` before an edit),
  `link` (`what` made, edited or removed; `id`, `subject`, `label`, `file`; an edit's `changed`
  (of `subject`, `label`, `place`), `wasSubject`, `wasLabel`, and `auto` if VisualProof carried it
  with a cluster a build renamed).
- Server's timeline: `build` (files that `failed`, were `fixed`, got or lost a `sorry`), `tcb` (a
  target's TCB changed: `added`, `removed`, `changed`, `stale` opinions), `untarget`, `trust`,
  `untrust` (a prefix), `layout`, `undo`, `view` (`what` created, renamed, scope — `scope` after —,
  deleted, relayout, version (kept at a past build); or `items`: a project note added or taken out,
  `note` its id, `text` then, `shown` whether the view shows it by it), `note` (`what` created,
  edited or deleted; `view`, `title` for a view's own note, "" for a project note; `note` its id;
  `text` after, or before a deletion; `carried` `{mode, from, to}` where a build carried a project
  note to the cluster its declarations moved to, an edit by VisualProof).

## History

A snapshot of the graph per build read, kept for good: finish time, commit, every module's content
(an unchanged one kept once). Any level; the Time Machine reads the same under `/api/history`. None
on a saved graph (`--graph`): 404. MCP: `history` (`snapshots`, `diff`, `moves`, `last`, `lost`,
`archived`, `attach`, `unmove`, `archive`); `/history/graph` is HTTP only.

## `GET /api/agent/history`

```json
{ "snapshots": [ { "id": 1, "at": "…", "read": "…", "fingerprint": "…", "toolchain": "…", "commit": { "hash": "bd81b78…", "branch": null },
    "missing": [], "counts": { "modules": 27, "nodes": 297, … }, "bytes": { "new": 307706, "all": 196387 },
    "sources": { "kept": 27, "of": 27, "places": 0, "bytes": { … } }, "renames": { "high": 0, "medium": 0 } }, … ],
  "current": 2, "diskBytes": 415893 }
```

Oldest first. `at`: when the build finished (newest `.olean`); `approx`: only an extraction made
before the history dates it. `commit`: checked out when read (`dirty`: `.lean` files differed;
`guessed`: imported, the last commit before it). `missing`: modules not read (unknown at that
build, not gone). `bytes`: `new` written to keep it, `all` its files. `renames`: found against the
build before, per confidence. `sources`: texts kept (`kept` of `of` modules with a file; `places` of
them matched by recorded places, not Lake hash; gzipped `bytes` first kept for it and of all it
lists); absent until backfilled at server start.

## `GET /api/agent/history/graph?id=&part=`

A snapshot's graph (latest without `id`), as the page reads the graph on show, no layouts:
`{snapshot, modules: [{name, imports}], nodes, projectCount, axioms, axiomSets, edges}`. The first
`projectCount` nodes are the project's, `{name, kind, module, ax, type, doc?, range?, also?, flags?,
leanName?, display?, hash, kernel?}` (`hash`: its version under the renames in force, comparable
with opinions' and the graph on show's; `kernel`: the kernel hash read with); then outside ones,
`{name, kind, module, ax, ext: true}`. `ax` indexes `axiomSets`, whose entries index `axioms`;
`edges`: flat `src, dst, sites` triples (sites as in `uses`).

Large (flt-regular's: 0.8 MB of JSON, 139 KB gzipped) <!-- TODO(scale, sphere packing): re-measure -->:
ask only for a past build's whole graph.
`part=nodes`: no `edges`; adds `edgeCount` and `sources` (modules whose text then is kept, each
`lake` or `places`). `part=edges`: edges only, packed as `/api/edges?pack=2` packs the graph on
show's (shared/edgecodec.ts), a third of the bytes. Each part is kept compressed.

## `GET /api/agent/history/diff?from=&to=&most=`

From snapshot `from` to `to` (latest without it): `{from, to, counts: {added, removed, changed,
renamed}, added, removed, changed, renamed: [[was, is]]}`, lists sorted, at most `most` each
(default 2,000, max 20,000). A renamed declaration is in `renamed`, and in `changed` only if its
version changed (references are read under their names at `to`: renaming what it uses is no
change). What an unreadable module of the later build held is neither added nor removed.

## Renames and moves

Each build, vanished declarations are paired with new ones. High confidence (the same version once
names are mapped) migrates by itself: opinions, comments, target and key marks go to the new name (a
`move` event in the server's `log/visualproof.server.jsonl`); pins, mentions in notes (full names in
backticks, project and view notes) and names in view scopes move on the views (`views` lists view
"" for project notes). Opinions keep their version: a pure rename changes none. Medium confidence:
only suggested.

- `GET /api/agent/history/moves`: `{migrations: [{id, at, from, to, snap?, by, agent?, auto?,
  rename, review, carried: {opinions, targets, keys, notes, pins, scopes, reviewViews}, views:
  [{view, ops, scope?}], undone?: {by, agent?, at}}], suggestions: [{from, to, confidence:
  "medium", why, score, snap}]}`. `auto`: why sure (`same version`, or `same kernel hash` against a
  build read before versions); `review`: whether a move went to the logs (something was said of it
  or of what refers to it). A suggestion lasts while its old name is gone, its new one there, and
  no migration made it.
- `POST /api/agent/history/move {from, to}` (needs full; MCP: `attach`): what was said of a gone
  `from` goes to `to` in the graph — a move in your log; pins, notes, scopes on the views; a rename
  if `to` was absent from the last build with `from`. 409: `from` still in the graph; 404: `to`
  not. `{ok, changed, migration?}`.
- `POST /api/agent/history/unmove {id}` (needs full): an un-move in your log takes back exactly what
  it carried (what was said of the new name since stays), and its changes on the views. 409: undone
  already.

## The lost-and-found

What was said or marked of a declaration gone from the graph, carried by no rename, waits here for
everyone; nothing is deleted. Attach it (`history/move`) or archive it (only hides it).
`GET /api/agent/history/lost`:

```json
{ "lost": [ { "name": "isRegularPrime_two", "last": { "snapshot": 1, … }, "suggestions": [],
              "entries": [ { "key": "target:isRegularPrime_two", "kind": "target", "by": "Bob", … } ] } ],
  "migrations": [ { "key": "move:m1", "from": "isRegularPrime_three", "to": "isRegularPrime_3", … } ],
  "archived": [], "aside": { "entries": 0, "modules": [] }, "count": 2 }
```

- `last`: the newest build that had it (null if none kept did); `suggestions`: medium-confidence
  renames, likeliest first.
- Entry `kind`: `opinion` (`verdict`, `comment`), `target`, `key` (`target`, `member`: lost where
  either is gone), `pin` (`view`, `title`, `mode`), `note` (`view`, `note`, `text`: a note naming it
  in full in backticks; `view` "" for a project note).
- Entry `key`, the same for everyone: `opinion:<name>#<by>@<at>` (as a comment quotes an opinion),
  `target:<name>`, `key:<target>#<name>`, `pin:<view>:<mode>:<name>`,
  `note:<view>:<note id>:<name>`, `move:<migration id>`.
- `aside`: entries in files the build on show could not read (not vanished, not listed). `count`:
  lost entries and migrations not archived.

## Last build, and the archive

- `GET /api/agent/history/last?name=`: `{name, snapshot, at, approx?, commit, module}`, the newest
  build that had it; 404 if none kept did.
- `GET /api/agent/history/archive`: `{archived: [{key, on: true, by, agent?, person?, at}]}`, the
  lines that archived what is archived now.
- `POST /api/agent/history/archive {key, on}` or `{keys, on}` (needs full): archive entries or
  migrations (`on` true, default; at most 500) — to `archived`, for everyone — or put them back
  (`false`). The thing itself is untouched. Recorded in the server's state under your name, as an
  agent's: `{ok, changed, lines}`. 404: a key not listed (to put back: not archived).
