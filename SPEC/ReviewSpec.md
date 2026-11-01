# VisualProof Review Spec

How the review SPEC.md asks for is recorded, stored and shown. Units and TCBs are TCBSpec.md's.

## Decisions

1. **Opinions, not consensus.** An opinion is *approve* or *comment* (which needs text). A
   reviewer's new opinion replaces their earlier one; their current one can be withdrawn (decision
   9). Every opinion is kept with who, when, the toolchain, the version and the text judged. Nothing
   defines "the team approved": the page shows each reviewer's opinion and a summary.
   - **Nobody approves twice** (the owner's decision of 2026-10-20): an approval of the present
     version by someone whose current opinion there is already an approval of that version is not
     recorded — the server answers `{ok, unchanged: true}` and writes nothing, a comment sent with it
     neither — whether they give it, someone speaking for them records it (decision 8), or it is an
     agent's advice (AgentSpec decision 2). Once a change has made their approval stale, approving
     again is recorded: it is about another version.
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
   - **Approved ✓ withdraws** (the owner's decision of 2026-10-20): where the approval of whoever the
     box records for is of the present version, Approve reads *Approved ✓*, *Withdraw approval* under
     the pointer, and a click withdraws it ("What the page shows"). The key `a` only ever approves:
     where that approval stands it does nothing but say so, and never withdraws.

## What the page shows

- **Status**, from people's current opinions (none where withdrawn, decision 9): *commented* if one
  on the present version comments,
  else *approved* if one approves, else *stale* if any exist, else *not yet reviewed*. Comment
  before approve is one order, `VERDICT_ORDER` (shared/review.ts), read by every status, count,
  colour and query.
- **The review box**: each reviewer's latest opinion (stale ones marked, with What changed) and the
  history, all folded or all shown (below); the agents' advice apart; the comment box, Approve (solid green, saying where the approval
  stands, below) and Comment (solid blue)
  — the box empties when the opinion is taken and keeps its text when refused — and Speaking for;
  the key mark; ☆ Mark as target; for a target, its progress (key declarations, then all), the
  axioms outside the graph with their Approve and Comment, and its view (Its view, Key view, Link to
  this view: ViewSpec decision 29).
- **The opinions fold all or nothing** (the owner's decision of 2026-10-20): one toggle at their head,
  *Opinions N · M earlier, K withdrawn — Fold all* (or *Show all*), folds them all or shows them all,
  in every review box at once — the panel's and each source window's —, a reading preference, the
  reader's own (CollabSpec, "Yours"), kept in the browser; shown where none is kept.
  - **Folded**: a line for each person's current opinion — who, approved or commented, when, *stale*
    where it is on an earlier version, *recorded by* where someone spoke for them, Withdraw beside
    the one the box records for — and nothing of its text; the agents' advice a line each too.
  - **Shown**: each current opinion in full, with Quote, then *Earlier*: the opinions replaced or
    withdrawn and each withdrawal at its time; the advice in full.
  - **What changed** under a stale opinion is a diff, not an opinion: it keeps its own toggle,
    closed at first, folded or shown alike. A quoted opinion gone to shows them all.
- **Approve shows the state** (the owner's decision of 2026-10-20), wherever a review box stands, of
  the approval of whoever the box records for — the reader, or the person they speak for (decision
  8): *Approve* where they have no current approval (none, a comment, or withdrawn); *Approved ✓*,
  tinted rather than solid, where their current approval is of the present version — under the
  pointer or the keyboard's focus it reads *Withdraw approval*, and a click withdraws it (decision
  9), at once, as Withdraw does an approval; *Approve again* where their approval is of an earlier
  version. Speaking for someone, each Approve says theirs at once ("Approved ✓ for Bob"). An axiom
  outside the graph, in its target's box, has the same Approve.
- **One review box** (the owner's decision of 2026-10-19): it stands in the panel and in each source
  window, following or pinned, each on its own declaration, and it is the same box in each — the
  same controls, in the same order, under the same rules. Nothing of it is the panel's alone.
- **Withdraw** (decision 9) stands beside the current opinion of whoever the box records for — the
  reader, or the person they speak for — in every review box. An approval goes at once; a comment is
  asked about first; the page says what it did. The history (the opinions shown) lists an opinion
  withdrawn, faded, and its withdrawal at its time ("Alice withdrew their approval"; "recorded by" the typist where they
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
  - **Line numbers** (the owner's decision of 2026-10-20): a gutter of the file's own line numbers,
    muted, always shown, beside the code and beside the context above it (namespaces, opens,
    variables), each at its real number — a command of the context at the line it starts on, once
    for those Lean reads on one line; where the numbers are not contiguous, between the context and
    the code and inside the context where lines were left out, a visible break (a dashed rule across
    the gutter). A line that wraps is numbered on its first row only; its hanging indent stays as it
    is. The gutter is not part of the text: copying, selecting and quoting lines into a comment give
    the source alone, as before (a quote's header keeps its lines' numbers), and Lean's hovers and
    positions count in the text, which the gutter is not in. A past build shows that build's
    numbers; a declaration outside the project (Mathlib, Lean's core) its file's. The phone's window
    shows them too, narrower. The exported document keeps none (ExportSpec: "without line numbers").
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
  - **File mode** (the owner's decisions of 2026-11-01, on the owner's TODO "a way to show the
    holistic file"): the window shows the whole file its declaration is in.
    - **A mode of the window, not a window of another kind**: a *Declaration | File* switch in its
      title bar. Pinning, collapsing, placing, the review box and following stay the window's.
    - **The whole file**: the declaration highlighted (a bar at the gutter's edge, a faint ground)
      and scrolled to as the window opens or switches mode; the line numbers as in Declaration
      mode; each declaration of the file a mark in the gutter, where its command starts; names
      linked as in Declaration mode, and Lean's hovers across the whole file (the language server
      opens the whole file already).
      - **The marks show what Status shows** (the owner's decision of 2026-11-01), in its colours
        and with its priorities (CanvasSpec, "Colour schemes"): its file being compiled, its file's
        build failed or never done, *contains sorry* (`sorry` anywhere beneath it), before the review
        states — commented, stale, approved, not yet reviewed, trusted. A file outside the project
        has no build of its own to say, a past build's text none of now.
      - A declaration in no target's review set — there are targets, and none needs it — shows a
        hollow ring, "in no target's review set", in the not-yet-reviewed grey; with no targets at
        all, not yet reviewed, as the board shows it (the owner's decision of 2026-11-01).
      - The review box, the declaration's, stands under its lines in the file, under the same
        scrollbar, as it stands under its code in Declaration mode (the owner's decision of
        2026-11-01).
    - **Proofs are shown by default.** *Fold proofs*, in the window, folds each to a one-line mark,
      *⋯ proof*, which shows that one proof on a click; the reader's own, kept in the browser, not
      followed. It folds by the proof ranges the usage pass records (`proofs`, which the exported
      document cuts by: ExportSpec decision 8) and a theorem's value, read off its text as the
      document reads it, from after its `:=`.
      - Where the pass did not read the text on show (the owner's decision of 2026-11-01: a file
        changed since it was compiled, a file outside the project, a past build's text) only
        theorems' proofs fold:
        reading the text cannot tell a `by` that proves from one that builds data. A proof no
        longer than the mark stays as it is.
    - **Scrolling never changes the selection**: the review box stays the selected declaration's. A
      sticky header over the code names the declaration the reading position is in, with its mark;
      pressing it selects that declaration, an ordinary selection, which ends following like any.
    - **Opening a file** — from the switch; from the side panel's tree clustered by file, *Files*,
      a file's row (a button on the row under the pointer or the keyboard's focus, as hiding a level
      is: ViewSpec decision 24); from the board's menu on a file cluster, *Open the file* — is not
      tied to the selection.
      - A *file window* (the owner's decision of 2026-11-01): a window pinned on the file, in File
        mode, at its top, which does not follow the selection and has no declaration of its own
        (Declaration is not to be had in it, nor a review box, nor `a` `m` `k`); a name in it, or
        its sticky header, goes to the page as in any pinned window. One on the file already comes in front. It counts among
        the six pinned windows. Pinned windows are followed, so followers see it.
    - **Following**: the mode of each window and the file windows are part of the followed source
      windows (CollabSpec, "Surfaces"). Switching the mode is a control of a followed surface, as
      pinning is: it ends following. Scrolling stays the reader's own; others' pointers are by the
      file's line and column, in either mode.
    - **Bounds**: a file outside the project shows in File mode within the bounds above (only the
      modules the graph's outside declarations are in). A past build shows that build's text where
      it is kept (HistorySpec decision 23), else says why. A file changed since it was compiled
      shows its present text under the warning; a declaration's mark shows only where its text is
      still the compiled one (the latest build's text, as the history keeps it). A snapshot shows
      its project files as it does now.
    - **The phone**: the window as on the phone now (PhoneSpec decision 12), with the switch; no
      file window, nothing being pinned there (PhoneSpec decision 13).
    - **The InfoView** ("The InfoView" below) is about the whole file in File mode: its caret
      anywhere in the file, the pane beside it under the sticky header, ↑ and ↓ stepping through the
      file; by the same rules as in Declaration mode (none on a past build, in a snapshot, for a file
      changed since it was compiled).
    - **Large files stay quick**: the file is drawn in pieces — each declaration one, the lines
      between a few dozen at a time — filled, and asked Lean about, as they come near the screen.
    - **Agents** read a file too: `GET /api/agent/module` with `lines`, a few hundred lines at a
      time, within the same bounds (docs/agent-api/reading.md).
- **Hovering the source** shows Lean's hover from Lean's own language server, started in the
  project's folder of the cache (`lean-server/`) with the project's LEAN_PATH: with no lakefile
  there, it never runs `lake setup-file`, so it reads the owner's build and builds nothing. A file
  outside the project is opened by the same server in the same way. Until a
  file is elaborated the hover says how far Lean is. At most four files open (`--lean-files`, the
  owner's decisions of 2026-11-01); it stops after ten idle minutes. Over a Lean comment there is no card. A snapshot has no Lean: names show the graph's
  statement and doc. A click into the code with the mouse, which puts the InfoView's caret there,
  shows no card for the word it lands on (the owner's decision of 2026-11-01): one open goes, and
  none comes for that word until the pointer is on another word, or leaves the code; resting on it
  brings none, since resting is what the pointer does while its reader reads the InfoView. A tap
  and the keyboard as before.
- **Hover cards nest**: a name in a card opens a card beside it; a card closes a moment after the
  pointer leaves it for anything but a card nested in it. A nested card is the name `#check`ed in
  `Describe.lean` in that folder, importing the module on show; the graph's statement shows until
  Lean answers. Only a name that passes `isDeclName` (a dotted Lean name, nothing else) is ever
  written there: anything else would run as Lean source.
- **The InfoView** (the owner's decisions of 2026-11-01): what Lean's InfoView shows in an editor,
  in a pane of the source window.
  - **Live from Lean's language server**, the one that answers hovers, which elaborates the whole
    file: `$/lean/plainGoal` and `$/lean/plainTermGoal`, and the interactive goals through Lean's
    RPC (`$/lean/rpc/connect` and its keep-alive, `Lean.Widget.getInteractiveGoals`,
    `Lean.Widget.getInteractiveTermGoal`), which the page draws from the tagged text. Nothing is
    precomputed by the extractor: the usage pass elaborates without proofs.
  - **Where**: right of the code, below it when the window is narrow and on a phone (PhoneSpec). It
    shows while the caret — a click in the code, or the keyboard's caret — is in a proof, a `by`
    block or a term with an expected type; elsewhere it is hidden, and a toggle hides it (the
    reader's own, kept in the browser).
  - **What**: the goals at the caret, before the tactic, with a toggle for after; at a term, its
    expected type. Hypotheses and goals in Lean's highlighting, as the window draws code; names
    link to the board and open hover cards, nesting as in the source; with interactive goals a
    subterm shows its type on hover. ↑ and ↓, or the caret's own movement, step through the tactics,
    the pane following.
  - **After a tactic that holds a proof of its own** (`have h : P := by simp`; the owner's decision
    of 2026-11-01): the state after the whole line, the goals at the start of the next line of code
    of the same proof — the outer goal with `h` added, not Lean's "No goals" inside the nested
    block, where the tactic ends. The pane says which line's goals they are ("As line 50 begins"),
    and marks what the line added. Where the proof does not go on (the last tactic), what Lean says
    at the end, as for any tactic. The agents' `goals` follows the same rule.
  - **The caret is followed** (CollabSpec, "Surfaces": `caret`), so that one reader steps through a
    proof while those following them watch.
  - **Waiting**: when the window opens, Lean opens the file at once; while Lean elaborates, the pane
    says how far it has got ("Lean has elaborated line 120 of 800"); a place Lean has passed is
    answered at once.
  - **Limits**: the files Lean keeps open, for hovers and the InfoView, are a server option
    (`--lean-files`), four by default (the owner's decision of 2026-11-01: a Mathlib-heavy file's
    worker holds 1.9 to 2.6 GB resident, the heaviest measured 5.2 GB).
  - **Scope**: the latest build only — a past build, a snapshot and the exported document have no
    InfoView, and the pane says why; a file changed since it was compiled has none either, with why.
    Files outside the project as hovers. Read-only readers within the bounds hovers have: what Lean
    already said of this build, else within per-address and overall bounds.
  - **A project's own widgets are never drawn** (ProofWidgets, `#html`, panel widgets): their
    JavaScript is the project's code and would run in every reader's browser. Where one is, the pane
    says "A widget here: open it in your editor."
  - **What reaches Lean**: positions (numbers) and module names, checked as for hovers; no Lean
    source from a page or an agent. Agents ask the same (AgentSpec, "The API").
  - *How it reads the tactic* (the details settled in building it): Lean shows the goals before a
    tactic at its first character and those after it from there to its end, so the server reads
    the tactic at the caret from its line — from the `by` or the separator before the caret (`;`,
    `<;>`, a match arm's `|`, a case's `=>`, focusing dots left out) to the one after it, at the same
    depth of brackets — and asks before at its first character, after at its end (or, for a tactic
    that holds a `by`, at the next line of code whose code starts no further right than the tactic:
    a line further right is the nested block, or the tactic's own term going on), the expected type
    at the caret itself. Where the line is read wrong the answer is still Lean's own at that place.
    The page has one caret: placed in a window, it leaves the others. A follower's click in the code
    is reading; ↑, ↓, Before and After end following, as a change to a followed part does.
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
  - **Kept to one's own review** (the owner's decision of 2026-10-20): over the list, in review order
    or ◆ Key, *Yours: All · Not reviewed · Stale · Commented*, each with how many it keeps — what
    the reader has no opinion on (none given, or withdrawn), where theirs is on an earlier version,
    what theirs comments on — by their own opinions alone (as the Mine scheme, CanvasSpec, "Colour
    schemes"), the trusted key declarations, which need none, left out. A reading preference, as the
    order is (CollabSpec, "Yours"), kept in the browser; whom they follow changes nothing of it. A
    reader without a name has no review of their own, and no switch. Nothing of it joins the strip:
    there is no personal progress beside the team's.
  - Keys: `a` approve (only ever: where the approval stands, nothing — decision 9), `m` comment
    (asking for text first), `k` key (ExportSpec decision 4). The
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
  nothing (a target marked again, a prefix trusted again, a standing key mark, an approval of the
  version approved already: decision 1) writes nothing, and is answered `{ok, change: null,
  unchanged: true}`. A
  withdrawal (`{op: "withdraw", name, for?}`) is refused (409) where no opinion of whose it would
  take back stands; it binds nothing, so what was said of a declaration gone from the graph, or of
  a file changed since compiled, can be withdrawn.
- An opinion recorded without its text has no What changed: the page says the text was not recorded.
