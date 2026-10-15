# VisualProof Collaboration Spec (M4)

Supplements SPEC.md, "Collaboration". What a board shares and what is each reader's own: ViewSpec
decision 1. Agents: AgentSpec.md. Access and secrets: SECURITY.md. For users: docs/MANUAL.md.

## Decisions

1. **One workspace per server**: views, the review and the timeline are shared; camera, tool,
   selection, source windows and open tabs are each reader's own (ViewSpec decision 3).
2. **Pins live in the site**, with the views (ViewSpec decision 5): presentation, not review. One
   pin per node or cluster and clustering; the last drop wins; a drop is shared on release, not
   during the drag. **Re-layout** drops the board's pins for everyone, so it asks first, and the
   timeline records who did it (a person, or an agent at level full, AgentSpec decision 9).
3. **Identity: the name a reader gives, or the proxy's.** A guest's name is free and changeable; the
   only check is that it is not an invited person's (decision 9). What is recorded is under the
   name the page sends (a private reader's layout under none, decision 8). `--identity-header`
   takes the name from an authenticating proxy's header, believed as it comes (SECURITY.md): the
   page cannot change it and there are no personal links. No login of the tool's own.
4. **Following: what you see is followed; how you look at it is yours.** A follower sees exactly
   what the followed reader sees, nothing of their own over it; window places and sizes, scrolling,
   folds and the tools they open stay theirs. "Surfaces" is the authoritative list, and
   web/src/surfaces.ts its registry: presence carries exactly the followed parts, and what ends
   following derives from it. A new surface (popover, drawer, window, key) is declared in both
   before it ships. Others' pointers are never drawn.
   - **Starting to follow** applies the followed state at once: Activity closes or opens (with the
     followed reader's filters) as theirs is; the follower's source windows mirror theirs, at most
     six pinned on the follower's side, their own included; "My targets" becomes the followed
     reader's ("Alice's targets").
   - **Changing anything followed ends following**, as does acting on what is shown (a control of a
     followed surface, typing in a field of one), so nothing moves under a comment being written.
     Reading (scrolling, selecting or copying text, hovering) never ends it. A tool of the reader's
     own that changes a followed part (a view from the Views menu, a search result, a file from the
     Library) acts as that part's control.
   - **When following ends**, the follower keeps what their page shows, as their own.
   - A part the followed page does not report (an agent reports no Activity, lost-and-found,
     colouring or edges) leaves the follower's own in place.
5. **The timeline** (Activity) records what changes the shared state: the review's events and the
   library's files and links (read from the review's logs, so the logs bring their own history);
   builds, failed and fixed files, `sorry` appearing or going; per target, a TCB change and the
   opinions it made stale; trust changes; view events (ViewSpec decisions 9 and 29); notes written,
   edited, deleted, added to a view or taken out, or carried by a build with their cluster; agents'
   layouts and their undoing (AgentSpec decision 4). An agent's events carry its mark. Not events:
   pages opened or closed, ordinary drags, a note opened, collapsed or moved. Every event leads to
   what it is about.
6. *Covered by SPEC.md (the server never builds).*
7. **Access by a link.** With `--access-key-file`, only those given `/k/<key>` get in (SECURITY.md):
   the link leaves a cookie and the key leaves the address; agents send the key as `Authorization:
   Bearer`, or a token of their own (AgentSpec decision 7); everything else is answered 404. The
   key's link makes guests; a link per person is decision 9. Share's three tabs: *Public link*
   (`/k/<key>#<the address>`), *Invite a person* (decision 9), *AI agent* (AgentSpec decision 7).
   - **Exactly what I see**: a switch under the link, on by default, kept per browser, for every
     link Share makes. On, the link carries a snapshot of every followed part ("Surfaces"), the
     camera as the same region of the board fitted to the opener's screen, not the same zoom. Off,
     the address alone.
   - **Applied once**, as starting to follow applies a state; then the reader is free. What no
     longer exists (view, build, declaration, focus target, reference file or link) is left out and
     one line says so.
   - **In the fragment**, which no server sees: `/k/<key>#<the address>&snap=<the snapshot>`.
     Agents make such links too (AgentSpec decision 5).
8. **Visibility: Visible or Private**, per browser, effective at once. A private page tells nothing
   of where its reader is; they are not listed, cannot be followed or ask to be, but may follow
   others; the others see only a count ("+2 private"). Their layout changes are shared and recorded
   without a name ("someone"); their review keeps their name and needs one. Agents are always
   visible.
9. **Identity: guests and invited people.** A guest comes by the key's link and gives a name:
   another name is another writer. An invited person comes by a personal link made in Share for a
   name; it lets them in and says who they are.
   - **Identity is the link, not the name.** The holder is the link's id; the name is changeable,
     and what they did shows under their current name. Every earlier name is kept.
   - **Their log is the link's** (ReviewSpec, "The logs"): one file named by the id. Every line
     carries the id beside the name it was written under, and a rename appends a `name` line, so the
     log says who is who by itself. Logs named by a guest's name are read as before.
   - **Names are protected**: a holder's name carries ✓ wherever names show, and while the link is in
     force no guest (in any case or Unicode form) and no other link may take it.
   - **The link** is shown once to its maker; the server keeps only its digest. **It lasts until
     revoked**: a person's link is who they are in the review, and an expiry would make them someone
     else with a new log (an agent's token, a credential for a piece of work, lasts days). Revoking
     cuts it off at once, its pages too; a browser that also holds the key goes on as a guest.
     People with a name make and revoke links; agents never.
   - A private invited person is as decision 8 says, their review keeping its ✓.
10. **Asking others to follow.** *Ask everyone to follow me* (the name's menu) asks everyone online,
    private readers included (counted, never named), except those already following; *Ask … to
    follow me* (a person's menu) asks every page of that person. The asker needs a name and must be
    visible. One request per asker every 30 s; the server refuses sooner.
    - The asked see a banner in the asker's colour, "Alice asks you to follow · Follow · Not now",
      with a visible 30 s countdown, after which it is declined; Esc declines it, except in a field or
      a menu. **The banner never takes the focus** (its buttons are out of the tab order, a press
      leaves the focus where it was), so no keystroke of someone typing answers it. A newer request
      replaces it. It is a surface of the reader's own: answering never ends following by itself;
      **Follow** follows the asker, ending any other following.
    - The asker sees each answer on the asked person's initials (following ✓, declined ✕, no answer
      –, pending) and a summary line ("2 following, 1 declined"), private answers only counted, for
      20 s after the request ends.
    - Agents ask too, at advise and full (AgentSpec decision 8); agents cannot be asked.
    - The server relays requests and answers through its live events and keeps nothing beyond a
      request's life.
11. **Read-only access.** A read-only reader sees what a guest sees, changes
    nothing that is shared, and is seen by nobody: a way to show a project, a showcase above all.
    - **By a link of its own**, Share's *Read-only link*, which anyone let in may make. It lasts until
      revoked; the server keeps the link itself (proposed 2026-10-14: a digest alone could not give
      a read-only reader back the link they came by, nor show a link again; the link gives no more
      than a guest has); people with a name revoke these links as they do personal links
      (decision 9), and revoking cuts their pages off at once. A read-only
      reader's Share holds this tab alone and gives the link they came by, so revoking one link cuts
      off everyone it reached. Behind `--identity-header` there are none.
    - **Without a token only by the owner's choice.** `--public` (with `--access-key-file`) makes
      everyone who comes without the key or a link of their own a read-only reader, where decision 7
      answers 404; the read-only link is then the address alone. Without `--public` no address shows
      the project to someone not given a link, so no reader can make a private project public.
    - **What they do stays theirs**: the selection, the tool, the camera, folds, windows, the build
      browsed in the Time Machine, search, sources and Lean's hovers, the library's files and links.
      What a guest's page would share (folds, the views it opens) stays in the page and is gone on
      reload. Pins, notes, the review (opinions, targets, key marks, trust), views (made, renamed or
      changed), re-layout, undo, uploads, fetching by URL and talking to agents are not offered, and
      the server refuses them (403) whatever the page sends.
    - **What costs the server is bounded.** Lean's hovers are answered from a cache per build where
      they can be, and within bounds per address and in all (429 beyond). The printed document is of
      the view as it is shared, never of a reader's folds, so the export's cache answers most
      requests; one typesetting at a time for all read-only readers. Their event streams have a bound
      of their own, so they never take the places of the people working ("Bounds").
    - **Nobody sees them**: not listed, not counted (not even as private, decision 8), not in the
      timeline (they record nothing); they cannot be followed or asked to follow, and ask nobody.
      They see the others and may follow them; whoever does not want to be seen by them goes private.
    - **No agents**: a read-only reader makes no agent token, and neither `--public` nor a read-only
      link reaches the agents' API.
    - **Share's tabs** become *Guest link* (decision 7's *Public link*, renamed: it makes guests),
      *Read-only link*, *Invite a person* and *AI agent*. "Exactly what I see" (decision 7) holds for
      a read-only link as for the others.

## What the page shows

- **Presence**: up to five initials beside the reader's name (more as "+N"), coloured by the name,
  faded after five minutes idle or with the page hidden, then the private readers as "+N private".
- **On the canvas**: a ring in another reader's colour around what they selected, with their
  initials; several readers on one declaration share the ring.
- **In the panel**: "Also here: Alice, Bob" under the declaration's name.
- **Activity**: the count of others' events since the reader last looked; the drawer lists events
  newest first, by day, with filters (All, Review, Builds, Changes; My targets; Everyone, Agents,
  People). A key mark taken off leaves nothing; a target taken off shows only that it was.

## Surfaces (decision 4)

Followed parts, in the order a follower applies them. The first ten are the place, applied in one
step; the rest each on its own once the place is reached.

| Part | What | Presence fields | Keys |
|---|---|---|---|
| view | the board on show (its tab), its clustering; the side panel | `view`, `scope`, `clusterMode` | |
| history | the build browsed in the Time Machine | `history` | `t`, ←, →, Home, End |
| camera | the camera | `cam` | `f`, `+`, `−` |
| tool | Selection, Rests on and its step, Used by | `mode` | `1`–`3` |
| selection | the selection, and going somewhere | `selection` | the menu key |
| focus | the reader's own focus and its review strip | `focus` | |
| visitors | declarations gone to that the board does not hold | `visitors` | |
| panel | what the right panel tells of | `sel` | `a`, `m`, `k` |
| sources | source windows, following and pinned: open, collapsed, on what | `source`, `sourceCollapsed`, `pinned` | Space |
| paper | the reference window: open, collapsed, file, page, link | `paper` | |
| activity | Activity open or closed, its filters | `activity` (`open`, `kind`, `who`, `mine`) | |
| lostFound | the lost-and-found open or closed | `lostFound` (`open`) | |
| colouring | the legend's Kind or Status | `scheme` | `c` |
| edges | edges drawn | `edges` | `g` |
| proofEdges | proof edges drawn | `proofEdges` | |
| linear | the board drawn as its document's outline, the linear form (ExportSpec decision 18) | `linear` | `o` |
| artwork | the artwork mode: on or off, its settings (the board drawn with them) and its frame (ExportSpec decision 19, the owner's decision of 2026-10-14) | `artwork` | |

Presence also carries `tabs` (the views a page has open, which the server then keeps); no follower
takes it. A share link carries every followed part in a form of its own (shared/sharesnap.ts); a
part without a form does not typecheck.

**Yours**: window places and sizes; scroll positions; folded sections; the TCB list's order; the
outline's levels; "What changed"; the legend folded; the eyes' ⋯; the theme; the layout lock (`l`);
zoom, find and the box tool of the reference window; Share and its switch; Export; Help (`?`); the
Library popover; ⚙ Board (`e`, `[`, `]`); Trusted; the Views menu; the focus menu; the build status
(`b`); the search box (`/`); the name, its menu and window; the others' initials and a person's menu;
the request banner; the follower's own conversation window and its pin, and the following strip;
hover cards; the pointer's highlight; the frame meter (`p`). A control inside one that changes a
followed part is that part's.

**No surface**: the frames (bars, footer, windows' layer), whose blank parts count as the canvas;
words, tooltips and hints, the notes of others' changes, the loader.

### Following ends

- **A press** counts in the innermost surface: on a control that changes a followed part, wherever
  it is, it ends following; in a surface of the reader's own, never; on a followed surface (side
  panel, panel, source and reference windows, Activity, lost-and-found, review strip), only on a
  control, not on text or a scrollbar; outside every surface (the canvas), always. A double-click
  on a source or reference window's title bar ends it; the wheel, on the canvas only; Back and
  Forward too.
- The presence bar, a person's menu, the following strip and its conversation, the name's menu and
  window and the request banner are wholly the reader's own: only their own way out ends following
  (the strip's ✕, the followed initials clicked again, a Shift-click on a pinned agent's badge),
  and Esc.
- **Keys**: a followed part's key (table above), yes, wherever the focus is; typing in a field of a
  surface of the reader's own, no, but Enter choosing a search result does; typing anywhere else,
  yes; Enter or Space on a control, as a press; a modifier alone, Ctrl or ⌘ with a letter outside a
  field, a menu's own keys, and the keys of what is the reader's own, no; any other key, yes.
- **Esc** ends it, but first declines a request shown (outside a field and a menu), closes the
  name's window or a menu, or does what it does in a field of the reader's own (the conversation's
  box, the search box).
- It ends when the followed reader leaves ("Alice left").

## The guide (G1)

A tour on the first visit, on the project itself, nine steps, on a real theorem (the selection, else
a target, else one whose TCB holds 6 to 300 declarations); a step whose part is not shown is passed
over; a snapshot has no step about the others; shown once per browser. The `?` sheet lists every key
and gesture and replays the tour.

## Implementation notes

- **Identity**: the page's name travels as `X-VisualProof-Name`, percent-encoded; or the proxy's
  header is read; or a personal link's cookie names the reader and the name header is ignored. A
  request that records something takes its author from there, never from its body, and is refused
  without one (401). Pins need no name. A private page sends `X-VisualProof-Private: <its session>`;
  an agent's is ignored. What arranges a board (pins, folds, re-layouts, scopes, views, notes on a
  board, an undo from Activity) is recorded under the caller's name, or none for a private reader;
  the review and messages to agents always take the caller's name.
- **Presence**: one entry per open event stream. The stream's first event, `hello`, gives the page a
  public id and a secret token; a heartbeat counts only with that token, so no page speaks for
  another. Heartbeats every 10 s, and at once when a followed part changes; an entry goes when its
  stream closes or after 35 s of silence. The server checks every field and drops what is malformed,
  and sends the whole list as one `presence` event at most every 500 ms.
- **Private pages**: the heartbeat is `{token, private: true}` alone. The server keeps an unlisted,
  empty entry and sends `private` (`{count}`) beside every `presence`. Going private or back gives
  the stream a new public id, so nothing said under one ties to the other. A private page names no
  views, so the server holds the views it reads or opens, and those in its tabs when it went private,
  while a stream of its session is open and a minute after.
- **Pins** travel as a view's operations (`pin`, `unpin`, `clear`, `fold`; `note`, `note-edit`,
  `note-move`, `note-open`, `note-delete`), applied the same way on the server and in every page; the
  project's notes as `note-ops`. Every (re)connection brings every view and project note. Pins of
  declarations the graph no longer holds (a failed file) are kept.
- **The timeline**: `<site>/events.jsonl`, appended; the last 90 days and at most 5,000 events. The
  review's and the library's events are read from the logs, not stored there (a library event never
  carries a quote). Trust changes need a name.
- **The access cookie** is named per instance, `visualproof_access_<12 hex of a hash of the key>`
  (cookies are per host, not per port); its value is derived from the key, never the key. One under
  the old shared name `visualproof_access` is let in and replaced.
- **Links with what the sharer sees**: after the address, `snap=` and `z` + raw-deflated JSON in
  base64url, or `j` + the JSON where deflating does not pay. The JSON holds the followed fields by
  their presence names; the camera as `region`, `[x, y, w, h]` (centre and size, in board
  coordinates, of the room the bars and panels leave, to a tenth); visitors without `at`. A page
  reads at most 32,000 characters, inflated to at most 256 KB, every field checked as a heartbeat's.
  The opener takes the board and its build (`at=`, never in a snapshot) from the address, applies the
  snapshot once, its windows becoming its own, and drops `snap=` from the address; a snapshot it
  cannot read leaves the address alone, and it says so.
- **Personal links**: `/i/vpp_<10 hex id>_<32 random bytes, base64url>`. The site's
  `person-invites.json` (mode 600) keeps per link the id, a digest of the token (never the token),
  the current and earlier names, maker, revoked (by whom), lastUsed (written at most once a minute);
  revoked links stay, so their holders' work keeps its name. Opening a link answers 303 to `/` with
  the cookie `visualproof_person_<12 hex of this server's own>`, valued the id and a digest of the
  kept digest (HttpOnly, SameSite=Lax, 400 days, renewed at each load), compared in constant time; it
  lets the browser in whatever the access key. A revoked link answers 410 (who, when); its cookie admits nobody
  and is cleared. A guest's request giving a holder's name counts as nameless. Making, listing and
  revoking links: 403 to agents, 404 behind `--identity-header`; making and revoking need a name.
  The holder's id travels with what they record (`person`), never with a private reader's layout.
- **Read-only links** (server/readonly.ts): `/r/vpr_<10 hex id>_<32 random bytes, base64url>`. The
  site's `readonly-links.json` (mode 600) keeps per link the id, the token, its maker (or null),
  revoked (by whom), lastUsed (written at most once a minute); revoked links stay. Opening a link
  answers 303 to `/` with the cookie `visualproof_readonly_<12 hex of this server's own>`, valued
  the id and a digest of the token (HttpOnly, SameSite=Lax, 400 days, renewed at each load),
  compared in constant time; it admits its holder read-only where nothing else lets them in (the
  key or a personal link let in fully). A revoked link answers 410 (who, when); its cookie is
  cleared and lets nobody in, and its pages' event streams end. `GET /api/share` tells a read-only
  page `{path, readOnly: true}` (its link, or `/` under `--public`), any other
  `{path, readOnlyLinks, public}`; `/api/share/readonly` lists (GET), makes (POST) and revokes
  (POST …/revoke, with a name): 403 to agents, 404 without `--access-key-file` or behind
  `--identity-header`. A read-only reader's requests are allowed by method and path
  (server/readonlygate.ts): reads, the posts that only read (`/api/hover/open`, `/api/hover/names`)
  and `POST /api/export`; anything else is 403 `{readOnly: true}`. `/api/identity` tells the page
  `{readOnly: {by: "link" | "public"}}`, and the page offers nothing that writes, sends no
  heartbeat, gives no name and talks to no agent.
- **Requests to follow** (`POST /api/ask`, server/askfollow.ts): 401 without a name, 409 from a
  private page or for an agent, 404 for someone gone, 429 with `retryAfter` within 30 s, counted per
  person (link, else name) and per page. Nobody to ask makes no request and does not count. Answers:
  `follow`, `decline`, `timeout`, or `following` (sent at once, silently, by a page already
  following the asker; the server does not know who follows whom). A replaced request, or one on a
  page that closes, is answered `timeout`. A request ends when all answered or after 33 s (30 + 3 of
  grace); the asker closing or going private withdraws it. Held in memory only.
- **Bounds**: at most 200 event streams (then 503), and 400 more for read-only readers, counted
  apart; 4 per page (the oldest goes); a stream with more than 4 MB unread is closed. Read-only
  readers' hovers: 60 a minute per address and 300 in all (429 with `Retry-After`), answers kept per
  build and question (2,000); their printed documents, one typesetting at a time for all of them
  (429), the export's cache answering the rest. Request bodies are bounded (413); a failing handler answers 500 with a
  JSON reason, never hangs. Only the graph's modules are served or hovered.
- **Far pages**: pages are often far away, over lossy links. The page's files and the graph carry a
  content tag (304 when the browser has them); edges travel packed; JSON over 2 KB is gzipped; the
  page asks for the graph's two parts and the review at once.
