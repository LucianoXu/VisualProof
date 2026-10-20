# Following: where people are, and what you show them

Where people are; your own view, which followers see; links to it; asking to be followed; what
people see of you.

## `GET /api/agent/companion?wait=&since=` (any level)

MCP: `companion`.

```json
{ "rev": 9, "now": "…", "sharedBy": { "name": "Alice", "here": true }, "privateCount": 0,
  "people": [ { "name": "Alice", "idle": false, "pages": 1, "place": { "view": "vqoca3xy",
      "targets": ["flt_regular"], "mode": "tcb", "selection": "tcb(IsRegularPrime)", … } } ],
  "agents": [ { "name": "Alice's AI", "state": "working", "lastSeen": "…", "you": true, … } ] }
```

- `sharedBy` (with a token): whether the person who shared with you has a page open
  (`sharedByNote` when not: go on with what they asked).
- One entry per person, with their liveliest page's place (`pages` counts them); a reader without a
  name: one per page, `name: null`. `verified: true`: invited by a personal link (nobody else can
  take the name while it is in force). `idle`: no input for 5 minutes, or the page in background.
- `privateCount`: people here privately — not in `people`, place unknown, not followable; their
  coming or going is a change for `wait`. An agent cannot be private: you are always listed.

| `place` field | meaning |
|---|---|
| `view`, `viewTitle`, `targets` | the view they are on; the targets linked to it |
| `mode`, `tool` | their tool, as `POST view`'s `mode`, and its name (Selection; Rests on's Uses, TCB, Keys; Used by) |
| `selection`, `declaration` | their selection (a query); what their panel tells of |
| `source`, `sourceCollapsed` | the source window following their selection: open; collapsed to its pill |
| `pinned` | pinned source windows, first pinned first, `{declaration, collapsed}`; followers mirror them (an agent pins none) |
| `history` | `{snapshot, built}`: the build they browse in the Time Machine |
| `activity`, `lostAndFound`, `colouring`, `edges` | what else followers take, where their page says it (a page from before, and an agent, say none): `activity` `{open, kind, who, mine?}` (kind: all, review, build, change; who: all, agents, people; `mine`: the person whose targets it keeps to); `lostAndFound` `{open}`; `colouring` `kind`, `status` or `mine` (their own review); edges drawn or not |
| `export` | their Export window, which followers see too: `{open}`; open, its `settings` (`paper`, `fontSize`, `codeSize`, `contents`) and the document typeset, `job` `{id, state, error?}` — `GET /api/agent/export/job?id=` reads it, its files are yours to fetch ([export](export.md)) |
| `inWords` | the place in words; of the row above, only what differs from a fresh page |

`wait=<s>` (≤ 60) waits until someone comes, goes, goes idle or moves (view, selection,
declaration, tool, a source window pinned, collapsed or closed, Activity, lost-and-found,
colouring, edges, the Export window; no camera pan), then answers. Whom people follow is not said:
you follow nobody, and your presence shows nothing of who follows you. `since=<rev>`, your last `rev`: a
change you have not seen answers at once; `changed`: whether `rev` moved. To follow someone: wait,
then `POST view` with their view and declaration.

## `POST /api/agent/view` (any level)

What you look at; fields left out keep their value. MCP: `view` (action `move`, the default).

| field | meaning |
|---|---|
| `view` | a view's id: you are on that board; `null`: the Project |
| `review` | a target: you are on its view; `null` (on a target's view): back to the Project. A target with no view: a temporary view of its TCB ([views](views.md)), `temporary: true` with a `note`. Not a target: 400 (open a view on `tcb(<name>)`) |
| `sel` | the declaration you look at, or `null`. Your board does not switch: one it does not hold shows to followers as a visitor: a dashed point in its place in the cluster hierarchy (temporary clusters where the board draws none of its path), edges to what the board holds |
| `mode` | how a click selects: `plain`; Rests on's `deps` (what it uses), `tcb`, `keys` (key declarations in its TCB); `apps` (what uses it). Kept; `tcb` at first |
| `selection` | a query lit for followers (`tcb(A.b) or decl(C.d)`); `null`: none; left out, `sel` under `mode`. A page's Keys click is `tcb(A.b) and (key(targets) or decl(A.b))`, `key(<target>)` where the review has a focus (the focus) or for a target itself |
| `source` | `true`: the source window open on `sel` |
| `paper` | the reference window, for followers: `{"link": "<id>"}` (its file at its place, lit) or `{"file": "<sha256>", "page": 3}`; `null` closes ([library](library.md)) |
| `focus` | your own focus on the view: a target's full name; `null`/`"none"`: none; `false`/`"view"`: the view's own. Followers take it. Each view starts you on its own |
| `leave` | `true`: done. Without a token you leave the list until your next request; with one you stay listed while it is in force, view cleared, offline until you wait or request again. Answer `{ok, left: true}`; `left: false` where your `X-VisualProof-Session` is not the one that waited last (a newer session listens: it stays) |

A click on your initials follows you: the page goes to your view (in a new tab) and tracks your
selection, what you light up and the source window. The answer says what they see:

```json
{ "ok": true, "view": { "mode": "tcb", "sel": "IsRegularNumber", "view": "vqoca3xy", … },
  "reviewView": ["flt_regular"], "followersSee": "the view \"TCB of flt_regular\", …" }
```

`reviewView`: the targets whose view you are on (a view may have several), or null.

## `POST /api/agent/view/link` (any level)

A link to what you look at, or to a place you describe (Share's *Exactly what I see*), to hand
people in a reply. Opening it shows all it says once (the board and its region, panel, windows,
Activity…), then the reader is free; a line says what is gone (a view deleted, a declaration
renamed). Nothing moves. MCP: `view` (action `link`).

Fields go over your own place (none: your place): every `POST view` field but `leave`, and:

| field | meaning |
|---|---|
| `sourceCollapsed`, `pinned` | the following source window collapsed; pinned ones, `[{"name": "<full name>", "collapsed": false}]`, ≤ 6, first pinned first |
| `history` | a snapshot id: the Time Machine at that build; `null`: none |
| `region` | `[x, y, w, h]`: centre, width, height in the board's world (a top-level cluster's place is its `at` in `views/view`, a nested one's its parents' added up), fitted to the opener's screen. Left out, framed as for any link |
| `activity` | `{"open": true, "kind": "review", "who": "people"}`, values as in `companion` |
| `lostFound`, `scheme`, `edges` | the lost-and-found open; the colouring, `kind` or `status`; edges drawn |
| `exact` | `false`: the view's address alone (Share's switch off) |

```json
{ "ok": true, "exact": true, "length": 229, "carries": { "mode": "tcb", … }, "note": "…",
  "link": "http://127.0.0.1:4199/#q=tcb%28flt_regular%29&mode=tcb&snap=zTcw…" }
```

It holds no key: it opens only for people let in already (Share's guest link lets in someone new). Nothing after `#` reaches a server: `snap=` is all of it compressed (a few hundred
characters); the address before it gives view, tool and selection for a browser that cannot read
the snapshot. 404: a name that is no declaration (`didYouMean`), or a bad snapshot;
400: a bad region.

## `POST /api/agent/ask-follow` (needs advise)

Ask everyone on the page (private readers too: counted, never named) or one person to follow you,
before you show them something. MCP: `view` (action `ask_follow`).

- `who`: a name as `companion` lists it (all their pages are asked); left out, everyone.
- `wait: false`: answer at once with whom it asked; left out, wait for answers, at most the
  request's 30 s.

Each page shows a banner at its top centre — "Alice's AI (agent) asks you to follow · Follow · Not
now", your mark, a 30 s countdown — declined when it runs out or by Esc. Following shows what you
look at, never your conversations. Those already following are neither asked nor counted. A newer request on a page from
someone else replaces yours: that page counts as not answered.

```json
{ "ok": true, "id": "Jn4eNt6iahK3", "pages": 4, "waited": 12.4,
  "people": [ { "name": "Bob", "answer": "following" }, … ], "private": { "asked": 1, "following": 1 },
  "summary": "2 following, 1 declined, 1 no answer" }
```

`answer`: `following`, `declined`, `no answer`, `already following`, or `waiting` (`wait: false`).
One request per 30 s (sooner: 429, `retryAfter`). 404: a name nobody on the page goes by
(`didYouMean`); 409: an agent's. Nobody to ask: no request (`summary` says so), not counted.

## What people see

- **Presence**: your initials at the top right in a rounded square, a robot on its corner, "(agent)"
  in the tooltip; with a token, under its name (`Alice's AI`), one entry per token, a dot for your
  state.
- **Review box** (panel, source window): below people's opinions, a dashed box "Advice from agents
  · not counted": "Claude (agent) comments — <comment>" or "suggests: approve", rendered as
  people's ([advice](advice.md)), with a Quote to answer.
- **Canvas**: no advice; its Status colours are people's.
- **Review strip** (review focused on the target): "Claude comments on 3", which nothing walks; the
  panel's review list marks advised rows with a robot.
- **Notes** ([notes](notes.md)): beside what they point at, with your name, robot and what they
  carry; people handle them as anyone's.
- **Activity**, with your mark: advice ("comments on", "suggests approving", withdrawn), notes
  written, edited, deleted, files added, links made, layouts (with Undo), undos; at full, targets,
  keys and trusted prefixes marked, views made, renamed, deleted or laid out afresh. Filters: all,
  agents, people.
- **Talking** ([talking](talking.md)): each reader's own conversation window: *Everyone* (the
  public channel) and their own agents' private channels with their states; your replies with your
  mark, links of the site as what they lead to. A new conversation folds what came before.
