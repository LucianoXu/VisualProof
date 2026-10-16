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
   segment goes to its view. The Statement view lights the theorem alone; the TCB and Keys views say
   what they light, in numbers that add up to the selection bar's count: what is to be read, what is
   trusted and assumed, what the proofs alone use beyond it, how many are key — or, where none is,
   how one is marked.
3. **The theorem the tour shows**: the selection; else a target whose Keys view lights key
   declarations; else a target; else a theorem whose TCB holds 6 to 300 declarations, one whose
   proofs use more than its statement first (so that the TCB leaves something out). The tour leaves
   the page as it found it: the reader's tool and the step of Rests on a `2` resumes, the selection,
   the camera, and no step in the history; nothing it does counts as the reader's doing for a tip in
   place.
4. **The tour fits the reader**: a read-only reader is told what they can do there (the review as
   it stands, nobody sees them), not Approve or Comment; a phone has a tour of its own, in the words
   of fingers and of the parts a phone shows (PhoneSpec); with reduced motion (the system's
   setting) nothing in it glides.

### Tips

5. **The Tips tab is one film of a review** (the owner's decision of 2026-10-16, night): a review on a
   real project (Sphere-Packing-Lean) told in eleven scenes, in order — *Mark a target*, *A view of
   what it uses*, *Read the source*, *Key declarations*, *Its TCB, reviewed*, *Back to the
   Project*, *Share*, *Work with an agent*, *Papers and notes*, *A typeset document*, *Artwork*. On a
   larger screen the player (about 960 px wide, 16:10) has the chapters beside it, on a phone above
   them; under it a bar of one segment per chapter, the one playing filling. Each chapter is a card
   of one row; the one playing is open, with its words (two sentences at most), **Show me** and
   **More** (the manual's section on GitHub); the first is open when the sheet opens. No grid of
   clips: one film.
6. **The film**: the real page on a real project, the pointer's moves, clicks and keys drawn over
   it, the camera framed on the focus; the agent's lines played through the agents' API. Light
   theme only, in the Kind palette; in the dark theme it sits in a thin frame of the theme's, so
   that it does not glare. It is recorded by rendering, frame by frame, from a script
   (`npm run tips:record`), so that it is made again when the page changes, with a key frame at each
   chapter's start; the recording says where each chapter starts and ends
   (`tour.chapters.json`). It plays muted and inline from the chapter asked for (the first, by
   default) and stops at its last frame — a replay control then — and the open card follows it; a
   card, or a segment of the bar, goes to its chapter and plays it. With reduced motion nothing
   plays by itself: a card shows its chapter's key frame with a button that plays from there.
   Without the film (not recorded) and in a snapshot, the cards are their words alone.
7. **The reference tips** are what the film does not show — the phone's gestures, the Time
   Machine, the linear form, lost and found, trust, updates, read-only links, and the rest — under
   the film, one row each: its title and its first line; a click opens it (its words, Show me,
   More), one at a time. They are grouped by what one does — Start, Seeing, Reviewing, Arranging,
   Together, Export, History — never by how expert a reader is (ViewSpec decision 18). Only the
   phone's gestures keep a clip, on a phone, light only, in its row when it is open. A filter
   narrows the rows by their words.
8. **Show me** does it on the reader's own page: the sheet closes and the tour's spotlight rings
   the real control, with the words beside it; where it helps, it first does something harmless on
   what is the reader's own — the tour's theorem selected in a mode, a popover opened — and never a
   change anyone else sees. What it did stays, as one step in the history. The sheet's first tab is
   *Tips*, before *Keys* (*Gestures* on a phone: every key and gesture, the "Open in editor"
   setting, and what the project and VisualProof are).
9. **One tip at a time, in place, when it helps** (as TipKit does): a small card at the control a
   tip or a chapter of the film is about, shown when the reader is about to need it, by a rule of
   its own — at most eight rules; a chapter's card has **Watch**, which opens the sheet at that
   chapter, playing from its start. At most one in a page's session; none in the session of a tour (it has just taught the
   basics), while the sheet shows, while following someone, or in a snapshot. *Got it* ends it for
   good; so does doing what it teaches; Esc puts it away for the session. The reader turns in-place
   tips off in the sheet.
10. **Each tip says who and where it is for**: every reader, or those who can change the review
    (none about reviewing or arranging for a read-only reader); a larger screen, a phone, or both.
11. **What's new**: each reference tip names the release its feature came in. A page that finds the server
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
    trusted. Its part in the panel has an ⓘ that opens the film at its chapter on the TCB.

## Implementation notes

- The film's chapters (`TOUR`) and the reference tips (`TIPS`) are `web/src/tips.ts`;
  `test/tips.test.ts` holds both to their budgets and to the page's surfaces.
- The sheet and the tour: `web/src/guide.ts`; the film and its cards: `web/src/tourfilm.ts`; the
  reference rows: `web/src/tipcards.ts`; in-place tips: `web/src/intip.ts`; what the browser keeps:
  `web/src/tipstate.ts`.
- The film is `assets/tips/tour.light.mp4`, its poster `tour.light.webp`, each chapter's key frame
  `tour-<chapter>.light.webp`, its chapters `tour.chapters.json` (`{ duration, chapters: [{ id,
  start, end }] }`); the phone's gestures `phone-fingers.light.mp4`. Served at `/tips/` with byte
  ranges (Safari plays a video only so); `/tips/index.json` lists the clips present.
