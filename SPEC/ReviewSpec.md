# VisualProof Review Spec

How the review SPEC.md asks for is recorded, stored and shown. Units and TCBs are TCBSpec.md's.

## Decisions

1. **Opinions, not consensus.** An opinion is *approve* or *comment* (which needs text). A
   reviewer's new opinion replaces their earlier one; their current one can be withdrawn (decision
   9). Every opinion is kept with who, when, the toolchain, the version and the text judged. Nothing
   defines "the team approved": the page shows each reviewer's opinion and a summary.
2. **An opinion is about one version of one declaration** (TCBSpec decisions 1 and 3); on another
   version it is *stale*. Reviewing a declaration means "it says what it should, given that what it
   uses means what it says", so a change underneath stales only what changed. An opinion records the
   text judged (context and compiled excerpt, TCBSpec decision 4; else the graph's statement); a
   stale one shows a line diff against the text now ("What changed").
3. **What needs review**, a target's *review set*: its TCB minus what is trusted (untrusted
   declarations outside the project included), plus every non-standard axiom it reaches, through
   proofs too (`sorryAx` included), which needs review whatever is trusted (one with no node is
   counted beside the list and approved from the target's panel).
   - **Trusted**: the standard axioms (`propext`, `Classical.choice`, `Quot.sound`) and what a
     trusted prefix covers, a whole dotted component at a time: outside declarations by module, the
     project's by module or name. Defaults `Mathlib`, `Init`, `Lean`, `Std`, `Batteries`;
     `@external` trusts everything outside the project. The list is part of the review, changed by
     people and agents at level full (AgentSpec decision 9) from the cluster tree's shields and the
     Trusted popover (ViewSpec decision 17), where removed defaults stay listed. Trusted
     declarations are not counted but can get opinions, and be key (ExportSpec decision 1); the
     panel names the prefix that trusts one.
     A TCB's size leaves them out too, telling them apart as "+N trusted" (TCBSpec decision 7).
   - The count is the review set wherever the focus is on the target (ViewSpec decision 28), on the
     whole graph, never what a board holds.
4. **Targets** are marked by people and agents at level full. Marking makes no view (ViewSpec
   decision 29). Targets have no checkpoints: an opinion goes stale by itself, what newly enters a
   TCB shows as not yet reviewed, and the timeline records TCB changes (CollabSpec decision 5).
5. **Storage: in the site**, its `log/` (`--site <dir>`, relative to the current directory or absolute, the owner's decision of 2026-10-14;
   default `<data home>/sites/<project>-<hash>/`), local, never committed; one server at a time
   (`.lock`). **One append-only log per writer** ("The logs"); a damaged file is reported, never
   rewritten; files changed on disk are read again. The server binds what is written: it takes the
   hash and the judged text itself, and refuses names outside the graph and files edited since
   compiled.
6. **Identity**: the name a reviewer gives (CollabSpec decision 3), on every event, asked for at the
   first recording action. Someone invited by a personal link (CollabSpec decision 9) is their link:
   what they record shows under their latest name.
7. **Live and frozen.** What is recorded reaches every open page at once; a snapshot shows the
   review as it was, read-only.
8. **An opinion recorded for someone else** (the owner's decisions of 2026-10-15, for a review held
   together at one screen). Whoever is at the keyboard may record an opinion, approve or comment,
   as another person's.
   - **It is that person's opinion**: it replaces their earlier one and counts as theirs in every
     status, count and query (decision 1); a later opinion of their own, or another recorded for
     them, replaces it in turn.
   - **It says who recorded it**: shown under their name, "recorded by" the one who typed it, and
     without their ✓ where they are invited (CollabSpec decision 9): they did not record it
     themselves. An invited person may be recorded for like anyone.
   - **Opinions only**, and their withdrawal (decision 9): targets, trust, key marks, moves and the
     library stay each writer's own.
   - **People only**: a person records for another person; an agent never records for anyone, a
     read-only reader records nothing (CollabSpec decision 11), and nobody records for an agent.
   - **One person each time**: several people approve separately; there is no joint opinion.
9. **Withdrawing an opinion** (the owner's decision of 2026-10-19). A reviewer may withdraw their
   current opinion on a declaration, approve or comment, stale or not.
   - **Afterwards they have no opinion there**: every status, count and queue is as if they had
     given none; their earlier opinions are not restored. A later opinion of theirs stands as any.
   - **An event, never an erasure**: a line of their log ("The logs"). The opinion and its
     withdrawal stay in the declaration's history, which the panel's list of opinions shows ("Alice
     withdrew their approval"); the timeline (Activity) records it, leading to the declaration.
   - **Speaking for** (decision 8): whoever is at the keyboard may withdraw the current opinion of
     the person they speak for, recorded as by them, as recording one is.
   - **Agents**: an agent at level advise or full (AgentSpec decision 9) withdraws its own advice,
     never anyone else's opinion or advice; nobody withdraws an agent's advice for it.
   - A read-only reader withdraws nothing (CollabSpec decision 11); a private reader as a person
     (CollabSpec decision 8).

## What the page shows

- **Status**, from people's current opinions (none where withdrawn, decision 9): *commented* if one
  on the present version comments,
  else *approved* if one approves, else *stale* if any exist, else *not yet reviewed*. Comment
  before approve is one order, `VERDICT_ORDER` (shared/review.ts), read by every status, count,
  colour and query.
- **The review box**: each reviewer's latest opinion (stale ones marked, with What changed) and the
  history; the agents' advice apart; the comment box, Approve (solid green) and Comment (solid blue)
  — the box empties when the opinion is taken and keeps its text when refused — and Speaking for;
  the key mark; ☆ Mark as target; for a target, its progress (key declarations, then all), the
  axioms outside the graph with their Approve and Comment, and its view (Its view, Key view, Link to
  this view: ViewSpec decision 29).
- **One review box** (the owner's decision of 2026-10-19): it stands in the panel and in each source
  window, following or pinned, each on its own declaration, and it is the same box in each — the
  same controls, in the same order, under the same rules. Nothing of it is the panel's alone.
- **Withdraw** (decision 9) stands beside the current opinion of whoever the box records for — the
  reader, or the person they speak for — in every review box. An approval goes at once; a comment is
  asked about first; the page says what it did. The history lists an opinion withdrawn, faded, and
  its withdrawal at its time ("Alice withdrew their approval"; "recorded by" the typist where they
  spoke for its author).
- **The key mark** (ExportSpec decision 1): where the reader's focus is a target whose TCB holds the
  declaration — trusted or not, in the project or outside it (the owner's decision of 2026-10-19) —
  or whose review set does, *◇ Mark as key for T* / *◆ Key for T* (`k`), in every review box alike;
  in a following window, a control of a followed surface (CollabSpec, "Following ends"). Who may
  not mark sees *◆ Key for T* where it is marked. The target is key without a mark, and offered
  none.
- **Speaking for** (decision 8), beside Approve and Comment wherever a review box stands: yourself to
  start with; the people the site knows — invited people, and the names in the logs, agents left
  out; or someone else, by a name typed. The choice stays, on every review box of the page, until
  it is changed back; while it is someone else's, the box carries a coloured line, "Recording for
  <name>", and its buttons say so ("Approve for <name>"). An opinion recorded for someone shows
  under their name, "recorded by <typist>", without ✓; Activity says "<typist> recorded <name>'s
  approval of X" (or comment), and of a withdrawal "<typist> withdrew <name>'s approval of X"; the
  agents' API gives `recordedBy` beside such an opinion and such a withdrawal.
- **Comments** are plain text in the logs, given to agents as written, read by the page as light
  Markdown: `>` quotes, `code`, fenced code (```` ```lean ```` highlighted), **bold**, *italics*;
  all else, HTML included, is text. A full declaration name in backticks links (a generated name to
  its unit), as does a short name Lean would resolve in the namespaces around the commented
  declaration; names in quoted code never link (their `open`s are not carried). Only the two
  references below are followed.
  - **Quoting an opinion** inserts at the caret, on its own lines,
    `> [**Alice** (2026-10-09)](opinion:…):` and the commenter's own words without their quotes and
    quoted code, at most 4 lines and 300 characters, "…" where cut. Posted, the attribution goes
    to the opinion, opening the history where it is no longer the latest.
  - **Quoting code** puts the whole lines a selection in a source window touches into that window's
    comment box, a fenced Lean block under
    `[FltRegular/NumberTheory/RegularPrimes.lean:31–32](source:IsRegularPrime#L31-L32)`, which
    opens the source at those lines; where the file changed above them, they are found by the
    quoted text.
  - **The references**: `opinion:<name>#<by>@<at>` and `source:<name>#L<from>-L<to>` (`#L<from>`
    for one line); a part is percent-encoded only where it would end the link or the part
    (whitespace, brackets, `#`, `@`, `%`, quotes). Agents can write them.
  - A comment holds at most 10,000 characters; a quote past that is refused. The panel and a source
    window on one declaration share one draft.
- **Targets** are listed atop the side panel with their progress; a click opens the target's view,
  or where it has none a temporary view of its TCB, linked to it and focused on it. A target is
  marked with a gold five-pointed star, never too small to see.
- **Typing is typing**: while a field has focus, the page's shortcuts stand aside; Esc leaves it.
- **The source window** (Space, or "Source") shows the selected declaration's source, not modal:
  context above the code, its review box below (the panel's: "One review box"), one vertical
  scrollbar. It follows the selection and closes
  when no declaration is selected.
  - The code wraps, a continuation hanging four characters past its line's indentation; copying
    copies the source. Each line keeps its line break in the text, so hover positions count in it.
  - Each opening puts the following window in the middle, fitted to its code: at least 560 px wide
    where the screen allows, at most 92% × 88% of it, refitted per declaration until the reader
    moves or resizes it; no place is kept across openings or reloads. It moves by its title bar,
    resizes from any edge, collapses (button, or a double-click on the title bar) to a pill that
    reopens as it was, stays inside the screen and snaps to its edges.
  - **Pinning** keeps a window on its declaration, a step aside (down-right, else up-left, a step
    further per pinned window there); the next opening makes a new following window, a step aside
    where it would cover a pinned one exactly. At most one following and six pinned; a seventh pin
    is refused, saying why. A pinned window has no back and forward, a name in it goes to the page,
    and its review keys act on its own declaration. Pins do not survive a reload.
  - **In front**: the window pressed or focused last; the conversation window above them all
    (CollabSpec decision 13, the owner's decision of 2026-10-19); hover cards above all windows; popovers, modal windows and transient messages above those.
  - **Keys**: Space opens and closes the following window, also from its pill. Focus in a window:
    Esc closes it, `a` `m` `k` act on its declaration, Space presses a focused button, its comment
    box is typing (Esc returns to the window). Elsewhere Esc closes in turn a question about trust,
    a popover, the views menu, the following window, Activity, then clears the selection.
  - **Following** (CollabSpec decision 4): for a window the reader pinned, the follower's following
    window is pinned where the reader pinned theirs, else a new one opens a step aside; a pinned
    window of the follower's own on the same declaration stands for it. Pinning, collapsing,
    opening a pill or closing a window ends following; nothing on the screen changes as it ends.
  - **Names** link at once by reading the file as Lean would (enclosing namespaces, then the
    `open`s in force), then by Lean's answer, which wins (dot notation: `o.elim` to `Option.elim`).
  - **Outside the project** (the owner's decision of 2026-10-20): the window, and Lean's hovers in
    it, show every declaration from outside the project too — the packages of the project's
    `.lake/packages/` and Lean's core (`Init`, `Std`, `Lean`…, from the toolchain's `src/lean/`).
    The extractor records an outside declaration's place, as Lean keeps it in the `.olean`, and its
    docstring, as for a project declaration; its file is its module's in its package, found as Lake
    lays the package out (its `srcDir`, and each library's under it), Lean's core's in the
    toolchain; it is served as the project's files are. Agents read it too (`source`, `describe`).
    Only the `.lean` files of modules the graph's outside declarations are in are ever read, resolved
    inside the packages' and the toolchain's source folders, never by a path a request gives nor a
    symbolic link out of them, by whoever may read the project's sources, read-only readers
    included, within the same bounds. Its title bar names the package and its revision.
    - *Proposed*: where the package is at another revision than when the graph was read (a
      dependency updated, a branch being built), the present text found by name, under a warning,
      as for a file changed since it was compiled; an opinion on an outside declaration records no
      text, as before.
- **Hovering the source** shows Lean's hover from Lean's own language server, started in the
  project's folder of the cache (`lean-server/`) with the project's LEAN_PATH: with no lakefile
  there, it never runs `lake setup-file`, so it reads the owner's build and builds nothing. A file
  outside the project is opened by the same server in the same way. Until a
  file is elaborated the hover says how far Lean is. At most two files open; it stops after ten idle
  minutes. Over a Lean comment there is no card. A snapshot has no Lean: names show the graph's
  statement and doc.
- **Hover cards nest**: a name in a card opens a card beside it; a card closes a moment after the
  pointer leaves it for anything but a card nested in it. A nested card is the name `#check`ed in
  `Describe.lean` in that folder, importing the module on show; the graph's statement shows until
  Lean answers. Only a name that passes `isDeclName` (a dotted Lean name, nothing else) is ever
  written there: anything else would run as Lean source.
- **What was compiled, and what is there now.** The graph describes the text each file was compiled
  from, whose hash its module carries. Where the file now differs, the source window shows the
  present text found by name (or that it is gone) under a warning, and no opinion can be given
  until the file is compiled again: an opinion binds the compiled version.
- **What a command generated** (TCBSpec decision 1) is listed with the declaration, `#print` on
  demand; an opinion on the declaration covers it.
- **Reviewing a target** is done wherever the focus is on it (ViewSpec decision 28), by following
  names in the source window.
  - **The review strip**: *Reviewing ★target · ◆ approved / K · approved / total* (K and "+N
    trusted" as ExportSpec decision 4 counts them), commented and stale counts, the declarations
    agents comment on (AgentSpec decision 6), and *All reviewed ✓* once the reader has an opinion on
    the present version of every member and every non-standard axiom is approved. Only the target's name can be pressed. No focus, no strip.
  - **There is no *Next to review***: no button, no key (`n`, `s` do nothing), nothing for agents.
  - **Review order** (the target's list; the agents' `tcb`, `key=first` putting key declarations
    first): non-standard axioms, then bottom-up over statement and body references (cycles
    together), then what more targets rest on, then by name; or key declarations alone (◆ Key), or
    by kind. A row goes to its declaration, as a visitor where the board does not hold it (ViewSpec
    decision 27); rows the reader settled are faded.
  - Keys: `a` approve, `m` comment (asking for text first), `k` key (ExportSpec decision 4). The
    panel says why a declaration is in the TCB: the shortest chain of references from the target.

## The logs

`<site>/log/<writer>.jsonl`, one JSON event per line, appended, never rewritten. A person's file is
their name made safe for every replica (letters and digits that read the same in every Unicode
normal form, joined by `-`, at most 32 characters, accents dropped) and a short hash of the exact
name, so names differing only in case or punctuation never share a file: `Alice-3f2a9c1b.jsonl`. An
agent's ends `.agent.jsonl`; an invited person's is the link's id, `3f2a9c1b07.person.jsonl`.

```jsonl
{"op":"target","at":"2026-10-12T22:18:52.977Z","by":"Alice","name":"flt_regular","on":true}
{"op":"opinion","name":"IsRegularPrime","by":"Alice","verdict":"approve","at":"…","toolchain":"leanprover/lean4:v4.33.0-rc2","hash":"8b…","text":"def IsRegularPrime …"}
{"op":"trust","prefix":"@external","on":true,"by":"Alice","at":"…"}
```

- **Events** (each with `op`, `at`, `by`): `opinion`, `withdraw` (decision 9), `target`, `trust`,
  `key` (ExportSpec decision 1), `move` (HistorySpec decisions 7–10), `name`, and the library's
  `file`, `file-edit`, `file-archive`, `file-restore`, `link`, `link-edit`, `unlink`
  (AttachmentSpec.md).
- **`withdraw`** `{"op":"withdraw","name","by","at"}` (decision 9) takes back the current opinion of
  its writer on `name` — of the person it is for, with `for` and `forPerson` as on an opinion
  recorded for someone else; an agent's line, its advice. The replay marks their latest opinion
  there withdrawn, unless it is already; a line with nothing standing to take back does nothing.
  What summarises the review never reads a withdrawn opinion; the history keeps it, and a move
  carries it as it is. A version before 0.6.0 reads the line as one it cannot read (its writer's
  next write refused), the opinion standing there again.
- **`move`** `{"op":"move","from","to","on","rename"?}` carries what was said of one declaration
  (opinions, target mark, key marks) to another, or takes it back (`on: false`); a thing carried
  keeps the names it was on (`was`). `rename` says `to` is `from` renamed: what refers to it keeps
  its version (TCBSpec decision 3).
- **The server's own log**, `log/visualproof.server.jsonl`, under the name `VisualProof`: the moves
  of renames it found, with why it is sure (`auto`) and the snapshot (`snap`), and the `link-edit`s
  that carried links to a cluster a build renamed whole (AttachmentSpec decision 6), marked the same
  way. It holds nothing else and no other log holds such a line.
- **Replay**: every line of every log, applied to an empty review with the default trusted list; one
  writer's lines in file order, different writers' by `at`, ties by file name, so every server
  replays the same.
- **A line that cannot be read** (cut off, edited badly, or breaking a rule here) is reported on
  every page and in `/api/status` with its file and line; the rest is read. Its writer's next write
  is refused (409) until it is fixed by hand.
- **An agent's log**: every line carries `"agent": true`, no person's line does. Its opinions are
  advice, never counted (AgentSpec decision 2); at level full (AgentSpec decision 9) its targets,
  trust and key marks count as a person's would. The level is checked when a line is written; a log
  read back is replayed as written.
- **An invited person's log**: every line carries the link's id, `"person": "3f2a9c1b07"`, beside the
  name written under (`by`); no other log's line carries one. A rename appends
  `{"op":"name","person":"3f2a9c1b07","by":"<new name>","at":"…"}` where the log exists. The replay
  shows all an id recorded under its latest name, keeping the earlier ones. The id is the writer: a
  guest who gives a name the id once had is someone else.
- **An opinion recorded for someone else** (decision 8) is a line of the typist's own log: `by` (and
  `person`) are the typist's, as on every line; `for` is the name it is recorded for, and
  `forPerson` that person's link id where they are invited, so that it follows their renames. The
  replay gives the opinion to `forPerson`, else to `for`; it is refused where `for` names the typist
  or `forPerson` is the typist's own id, on an agent's line, and on any event but an opinion or a
  withdrawal (decision 9), which takes back the opinion of the person it is for. `for`
  is a name as any (`validName`: 1–60 characters, no line breaks). A name typed for someone that is
  an invited person's protected name is that person (the server fills in `forPerson`); one that is
  a guest's already in the logs, in another case, is that guest as the logs write them; no one
  records for an agent's name, in any case. Someone recorded for who has no log of their own yet
  is given one by their first rename (its `name` line), so that what was recorded for them follows
  it; the first line of theirs read shows all of it under their name, the earlier names kept. A
  guest recorded for under a name later given to an invited person stays that guest, as a guest's
  own log does (CollabSpec decision 9). A version before 0.3.0 reads such a line as the typist's
  own: nothing is lost, the attribution is.
- `comment`: as written, at most 10,000 characters. `text` (or `statement` where there was no
  source; never both): what was judged, at most 64 Ki characters, only on opinions with a `hash`,
  not repeated by an opinion replacing the same reviewer's on the same version and text.
- **A verdict** is `approve` or `comment`; any other (`dispute`, the old name of `comment`) makes a
  line that cannot be read.
- `explain` and `checkpoint` lines (retired events) are skipped, whatever they hold, never
  reported; a checkpoint makes no target.

## Implementation notes

- An append first checks that the file is the size last read, so what was written meanwhile is read
  first, never overwritten. The first write creates `log/` (and the site's README where the server
  did not make the folder). Every event is checked: sizes bounded, a comment needs text, `by`,
  `agent` and `person` are those of who asks; only the server writes its own lines.
- `log/` is polled every second, also when serving a saved graph; a file is reread only when its
  size, time or inode changed, from where the last read stopped when it only grew. A page reads the
  whole review as it loads (`GET /api/review`: gzipped, tagged with the server's run and revision,
  304 to a page that has it); its event stream says which revision the server holds as it opens and
  whenever older events came in (`review-rev`), and a page holding another reads it again; new events
  come as `review-delta`; a replay whole that comes to the same review is a delta of no events (the
  owner's decision of 2026-10-19).
- `POST /api/review` records the page's events and answers with the change; a request that changes
  nothing (a target marked again, a prefix trusted again, a standing key mark) writes nothing. A
  withdrawal (`{op: "withdraw", name, for?}`) is refused (409) where no opinion of whose it would
  take back stands; it binds nothing, so what was said of a declaration gone from the graph, or of
  a file changed since compiled, can be withdrawn.
- An opinion recorded without its text has no What changed: the page says the text was not recorded.
