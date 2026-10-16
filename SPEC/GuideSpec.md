# VisualProof Guide Spec

How the page teaches itself, beyond SPEC.md ("Tips": a tutorial of basic usage, and tips for the
rest, Apple-style — each a short visual demonstration with a concise description, as the main
documentation). The owner's decisions of 2026-10-16, which build on the tour CollabSpec's "The
guide" made first. The manual (`docs/MANUAL.md`) stays the reference for running a server and for
what each part does in full; a tip links to it.

## Decisions

### The tutorial

1. **The tutorial is the tour**: on the first visit, on the project itself, on a real theorem;
   replayed from the `?` sheet. It is the one place that walks through the basics in order — the
   map, selecting, what a theorem rests on, the board, the panel, review, together, colours,
   getting around — and grows a step only for something every reader needs. A step whose part is
   not shown is passed over; a snapshot has no step about the others; it is shown once per browser
   and project; its last step points at the tips (`?`).
2. **What a theorem rests on is one step in three views of one theorem** (the owner's decision):
   the theorem alone (Selection: its statement in the panel), its TCB (Rests on · TCB: what its
   statement rests on, proofs skipped), its key declarations (Rests on · Keys). A segmented
   *Statement · TCB · Keys* on the card says which is shown; Next goes through the three, and a
   segment goes to its view. Each view says its own counts, read from the graph and the review: how
   many declarations the TCB holds, how many the proofs use beyond it, how many are key — or, where
   none is, that `k` marks one in a target's TCB.
3. **The theorem the tour shows**: the selection; else a target with key declarations; else a
   target; else a theorem whose TCB holds 6 to 300 declarations, one whose proofs use more than its
   statement first (so that the TCB leaves something out). The tour leaves the reader's tool as it
   found it.
4. **The tour fits the reader**: a read-only reader is told what they can do there (the review as
   it stands, nobody sees them), not Approve or Comment; a phone has a tour of its own, in the words
   of fingers and of the parts a phone shows (PhoneSpec); with reduced motion (the system's
   setting) nothing in it glides.

### Tips

5. **A tip is a card**: a title of a few words, one or two sentences, a demonstration, and where it
   helps **Show me** and **More** (the manual's section on GitHub). Tips are grouped by what one
   does — Start, Seeing, Reviewing, Arranging, Together, Agents, Export, History — never by how
   expert a reader is (ViewSpec decision 18).
6. **A demonstration is a short clip of the page itself** (the owner's decision): the real page on
   a real project (the flt-regular showcase), the pointer's moves, clicks and keys drawn over it, the
   camera framed on the focus or around the pointer; a few seconds, looping, no sound; one for each
   theme, shown in the page's own. Clips are recorded by rendering, frame by frame, from a script of
   each (`npm run tips:record`), so that they are made again when the page changes; together they
   weigh at most 6 MB. With reduced motion, a clip is its key frame, played only when asked. A tip
   without a clip, and every tip in a snapshot, is its words alone.
7. **Show me** does it on the reader's own page: the sheet closes and the tour's spotlight rings
   the real control, with the tip's words beside it; where it helps, it first does something
   harmless on what is the reader's own — the tour's theorem selected in a mode, a popover opened —
   and never a change anyone else sees.
8. **Every tip is in the `?` sheet**: its first tab, *Tips*, before *Keys* (*Gestures* on a phone:
   every key and gesture, the "Open in editor" setting, and what the project and VisualProof are).
   A filter narrows the tips by their words.
9. **One tip at a time, in place, when it helps** (as TipKit does): a small card at the control a
   tip is about, shown when the reader is about to need it, by a rule of its own — at most eight
   rules. At most one in a page's session; none in the session of a tour (it has just taught the
   basics), while the sheet shows, while following someone, or in a snapshot. *Got it* ends it for
   good; so does doing what it teaches; Esc puts it away for the session. The reader turns in-place
   tips off in the sheet.
10. **Each tip says who and where it is for**: every reader, or those who can change the review
    (none about reviewing or arranging for a read-only reader); a larger screen, a phone, or both.
11. **What's new**: each tip names the release its feature came in. A page that finds the server
    on a newer release than this browser last saw says so once, quietly ("What's new in 0.4.1"),
    and the tips newer than the release seen before are marked *New* until the reader has looked at
    them. A first visit only records the release.
12. **Kept in the browser, for every project**: the tips seen and done, whether in-place tips are
    off, the last release seen (`visualproof:tips`). The tour's being shown stays per project.
13. **The sheet's About** says which VisualProof the server runs, to everyone, and to those let in
    fully that a newer release is out and what taking it needs (UpdateSpec).
14. **Agents are told nothing of tips**: their documentation is `docs/agent-api/`.

### Words

15. **The TCB list is "Its TCB"** (the owner's decision): "trusted" says *trusted without review*
    everywhere else (Trusted, the status), so the list of what a statement rests on is not called
    trusted. Its part in the panel has an ⓘ that opens the tip on what a TCB is.

## Implementation notes

- The catalogue is `web/src/tips.ts` (one entry per tip: id, group, words, who, where, since, the
  controls it is about, its Show me, its clip, its in-place rule, its manual anchor);
  `test/tips.test.ts` holds it to its budgets and to the page's surfaces.
- The sheet and the tour: `web/src/guide.ts`; the cards and the clip player: `web/src/tipcards.ts`;
  in-place tips: `web/src/intip.ts`; what the browser keeps: `web/src/tipstate.ts`.
- Clips are `assets/tips/<clip>.<light|dark>.mp4` with their key frame as `.webp`, served at
  `/tips/` with byte ranges (Safari plays a video only so); `/tips/index.json` lists those present.
