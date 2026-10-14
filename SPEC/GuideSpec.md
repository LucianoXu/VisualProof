# VisualProof Guide Spec

How the page teaches itself, beyond SPEC.md ("Tips"): a tutorial of basic usage, and tips for
advanced techniques, Apple-style — each a short visual demonstration with a concise description.
The tour that exists is CollabSpec's "The guide"; this spec builds on it.

*Draft, for the owner's review (2026-10-14). Nothing here is implemented yet.*

## Decisions

1. **The tutorial is the tour** (CollabSpec, "The guide"): on the first visit, on the project itself,
   on a real theorem; replayed from the `?` sheet. It stays the one place that walks through the
   basics in order (the map, selecting, the board, the panel, review, together, colours, getting
   around), and grows a step only for something every reader needs.
2. **A tip is a card**: a title of a few words, one or two sentences, and a demonstration — a short
   loop (2–4 s) drawn by the page itself in the page's own shapes (circles, dots, edges, a pointer,
   the keys pressed), in the theme's colours, so that it always looks like the page and is never
   out of date with a recording. With reduced motion (the system's setting), the loop is a still of
   its key frame. No text in the demonstration but key caps.
3. **Where tips are**:
   - **All of them, in the `?` sheet**, a *Tips* tab beside *Keys and gestures*: cards in groups
     (Seeing, Reviewing, Arranging, Together, Agents, Export, History), each playing its loop when
     shown or hovered.
   - **One at a time, in place, when it helps** (as TipKit does): a small popover at the control a
     tip is about, shown when the reader is about to need it — each tip has a rule (for example:
     a fourth click selecting declarations one by one shows *Add to the selection*; the first
     folded cluster shows *Open it for you alone*; a Share link copied twice shows *Exactly what I
     see*). At most one tip in a page's session, none during the tour, while following someone, or
     in a snapshot. *Got it* ends it for good; so does doing what it teaches.
   - The reader turns in-place tips off in the sheet; the choice, and the tips done, are kept in
     their browser, for all projects.
4. **The first tips** (each names its control or key):
   - Seeing: the three modes and the TCB; Keys (`k`); Used by; folding and opening a cluster for
     yourself; search syntax; the source window and Lean's hovers; colour by status (`c`).
   - Reviewing: approve and comment; key declarations (`2`); targets and their views; trust;
     the review's focus.
   - Arranging: dragging to pin (with the lock); re-layout and undo; a view from the selection
     (*Zoom in*); scopes and depth; notes on the board.
   - Together: following and being followed; going private; asking to follow; Activity's filters.
   - Agents: a token and its prompt; talking to an agent; what an agent may not do.
   - Export: the board as the outline; the document's notes; artwork (when ExportSpec decision 19
     is decided).
   - History: the Time Machine; keeping a version; a past build's document.
5. **Read-only readers and guests see the tips that fit them**: a tip about something the page does
   not offer them is not shown (a read-only reader gets no tip about review or pins).
6. **Agents** are told nothing of tips: their documentation is `docs/agent-api/`.

## Open questions

- Demonstrations drawn by the page (decision 2) cost more to make than short recorded videos, but
  never go out of date and weigh nothing. Recorded videos instead, or a mix?
- In-place tips at all (decision 3), or only the sheet's collection?
- Should the tour end by pointing at the Tips tab?
