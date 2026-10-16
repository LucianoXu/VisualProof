// The tips (GuideSpec decisions 5–11): every one the `?` sheet holds, in its groups, each with its
// words, who and where it is for, the release its feature came in, the controls it is about, and
// what shows it — Show me, a clip, a rule that shows it in place. test/tips.test.ts holds the
// catalogue to its budgets and to the page's surfaces (web/src/surfaces.ts).
//
// The clips (`clip`) show the flt-regular showcase (showcase/flt-regular/story.ts: Alice, Bob,
// Charlie, Alice's AI; the targets flt_regular, FltRegular.caseII and
// eq_pow_prime_of_unit_of_congruent; builds faae830, 91d8f19, b8a5f23); `demo` says what each shows.
// A rule (`when`) is said in full in the comment beside it.

export type TipGroup = "start" | "seeing" | "reviewing" | "arranging" | "together" | "agents" | "export" | "history";

export interface Tip {
  /** kebab-case, stable: what a reader has seen and done is kept under it (web/src/tipstate.ts) */
  id: string;
  group: TipGroup;
  /** a few words, at most 32 characters */
  title: string;
  /** one or two sentences, at most 220 characters; <b> and <kbd> allowed */
  text: string;
  /** "full": not for a read-only reader (decision 10) */
  who: "all" | "full";
  where: "desktop" | "phone" | "both";
  /** the release its feature came in (decision 11) */
  since: string;
  /** the controls it is about, as web/src/surfaces.ts declares them, or keys ("key:k") */
  about: string[];
  /** its Show me (decision 7): an action done on the reader's own page (web/src/main.ts, `showMe`;
   *  the TCB step's three views, `tcb-three`, and the sheet's About, `help-about`, are the guide's) */
  showMe?: string;
  /** its clip's id: assets/tips/<clip>.<light|dark>.mp4 (decision 6) */
  clip?: string;
  /** for the recorder (scripts/tips/): what the clip shows, step by step */
  demo?: string;
  /** the rule that shows it in place (decision 9; web/src/intip.ts, RULES) */
  when?: string;
  /** the heading of docs/MANUAL.md its More links to, as GitHub anchors it */
  manual?: string;
}

/** The groups, in the sheet's order (decision 5). */
export const GROUPS: readonly { id: TipGroup; title: string }[] = [
  { id: "start", title: "Start" },
  { id: "seeing", title: "Seeing" },
  { id: "reviewing", title: "Reviewing" },
  { id: "arranging", title: "Arranging" },
  { id: "together", title: "Together" },
  { id: "agents", title: "Agents" },
  { id: "export", title: "Export" },
  { id: "history", title: "History" },
];

export const TIPS: Tip[] = [
  // ─────────────────────────────────────────────────────────────── start
  {
    id: "select-and-modes",
    group: "start",
    title: "How a click selects",
    text: "<b>Mode</b> is how a click selects: just it (<kbd>1</kbd>), what it rests on (<kbd>2</kbd>), or what uses it (<kbd>3</kbd>). Under Selection, Shift-click adds a declaration or takes it off.",
    who: "all",
    where: "desktop",
    since: "0.1.0",
    about: ["#lightup", "key:1", "key:2", "key:3"],
    showMe: "ring-modes",
    // selection-replace: under Selection, the reader clicks a declaration while another one is
    // selected, three times within 20 s, each click replacing the selection (no Shift). At
    // #lightup [data-mode=plain]. Ends: a Shift-click that adds to the selection; Got it.
    when: "selection-replace",
    manual: "what-you-see",
  },
  {
    id: "phone-fingers",
    group: "start",
    title: "Fingers on the board",
    text: "Drag to move around, pinch to zoom, tap to select. Touch and hold for what can be done with what is under your finger; <b>⋯</b> at the top holds the modes.",
    who: "all",
    where: "phone",
    since: "0.2.0",
    about: ["#canvas", "#more-btn"],
    clip: "phone-fingers",
    demo: "A phone's screen (390×844), the Project. One finger drags the board up a little; two fingers pinch it open about the FltRegular circle; a tap on IsRegularPrime: the sheet rises from the bottom to half the screen, on its statement. Finger dots, no pointer.",
    manual: "on-a-phone",
  },
  {
    id: "updates",
    group: "start",
    title: "Always up to date",
    text: "The server takes VisualProof's fixes by itself, at a quiet moment, and this page reloads where you were. A newer release is announced in the help, under About.",
    who: "all",
    where: "both",
    since: "0.4.0",
    about: ["#help"],
    showMe: "help-about",
    manual: "run",
  },

  // ─────────────────────────────────────────────────────────────── seeing
  {
    id: "what-a-tcb-is",
    group: "seeing",
    title: "What a TCB is",
    text: "What you must read to believe a theorem says what you mean: the definitions its statement rests on, its axioms, the project's notation. What is trusted, Mathlib first, lights too, and is assumed.",
    who: "all",
    where: "both",
    since: "0.1.0",
    about: ["#rests-steps [data-mode=tcb]", "#panel .p-tcb", "key:2"],
    showMe: "tcb-three",
    clip: "tcb",
    demo: "The Project, Kind colours. (1) Selection: click flt_regular — it alone is lit; the panel opens on its statement, ∀ {p : ℕ} [Fact (Nat.Prime p)], IsRegularPrime p → p ≠ 2 → FermatLastTheoremFor p. (2) Press 2 (TCB, its key cap shown; the mode's TCB step lit at the top right): IsRegularPrime and IsRegularNumber light up, with the outside definitions the statement uses (FermatLastTheoremFor, CyclotomicField, NumberField.RingOfIntegers, ClassGroup, …); the proof's lemmas stay dark. (3) Press 2 again (Keys): only flt_regular, IsRegularPrime and FermatLastTheoremFor stay lit, each with its gold diamond, joined by dashed edges. The camera frames what is lit at each view (pans, no zoom); about 2 s a view, 6 s in all — the one clip allowed to be that long.",
    // tcb-first: the reader's own click selects, under Rests on · TCB, a theorem whose TCB lights
    // more than itself (not the tour's selection, not one taken by following or by a link opened),
    // for the first time in this browser. At #rests-steps [data-mode=tcb] on a larger screen, at the
    // panel's TCB part (#panel .p-tcb) on a phone. Ends: Got it; Show me pressed in it (it runs the
    // three views); the reader stepping to another step of Rests on.
    when: "tcb-first",
    manual: "how-the-tcb-is-computed",
  },
  {
    id: "rests-on-steps",
    group: "seeing",
    title: "Rests on, step by step",
    text: "Press <kbd>2</kbd> again for the next step: its TCB, the key declarations in it, everything it uses (proofs included), what it uses directly.",
    who: "all",
    where: "desktop",
    since: "0.1.0",
    about: ["#rests-steps", "key:2"],
    showMe: "rests-steps",
    clip: "rests-steps",
    demo: "The Project, flt_regular selected under Rests on · TCB (IsRegularPrime, IsRegularNumber lit). The frame holds the board with #rests-steps in its top right corner, each step lighting as it is reached. Press 2: Keys — flt_regular, IsRegularPrime, FermatLastTheoremFor, dashed. Press 2: Uses — the whole proof lights up, FltRegular.caseI, FltRegular.caseII, Kummer's lemma, Hilbert92, hundreds. Press 2: Direct — what flt_regular names itself.",
    // rests-only-tcb: the reader's fifth pick under Rests on · TCB (counted in this browser), never
    // having chosen Keys, Uses or Direct. At #rests-steps. Ends: any other step chosen (2 again, or a
    // click on Keys, Uses or Direct); Got it.
    when: "rests-only-tcb",
    manual: "what-you-see",
  },
  {
    id: "used-by",
    group: "seeing",
    title: "What uses it",
    text: "<b>Used by</b> (<kbd>3</kbd>) lights everything that uses a declaration: what a change to it reaches.",
    who: "all",
    where: "both",
    since: "0.1.0",
    about: ["#lightup [data-mode=apps]", "key:3"],
    showMe: "used-by",
    clip: "used-by",
    demo: "The Project, nothing selected. Press 3 (Used by lit at the top right, its key cap shown); the pointer goes to IsRegularNumber and clicks: IsRegularPrime, flt_regular and the lemmas that assume regularity light up, from where it is up the board.",
    manual: "what-you-see",
  },
  {
    id: "source-and-hovers",
    group: "seeing",
    title: "Read the source",
    text: "<kbd>Space</kbd> opens the selection's source in a window that follows it. Rest on a name for what Lean says it is; click it to go there.",
    who: "all",
    where: "desktop",
    since: "0.1.0",
    about: [".sw-win", "key:Space"],
    showMe: "open-source",
    clip: "source",
    demo: "IsRegularPrime selected on the Project. Press Space: its source window opens over the board — def IsRegularPrime : Prop := IsRegularNumber p, with its doc, the context muted above it (open Nat Polynomial NumberField, variable (n p : ℕ)). The pointer rests on IsRegularNumber in the code: Lean's card says what it is (its type, its doc).",
    manual: "review",
  },
  {
    id: "colours-status",
    group: "seeing",
    title: "Colour by status",
    text: "The legend at the bottom left, or <kbd>c</kbd>, colours by what reviewers said: approved, commented, stale, not yet reviewed, trusted. Open it for how many of each.",
    who: "all",
    where: "both",
    since: "0.1.0",
    about: ["#legend", "key:c"],
    showMe: "colour-status",
    clip: "status",
    demo: "The Project in Kind. Press c: the board turns to Status — bluish green approved, cobalt blue commented, orange stale, hollow grey not yet reviewed, very light green trusted. The pointer clicks the legend's chip at the bottom left: it opens, counting the board's declarations per colour.",
    manual: "what-you-see",
  },

  // ─────────────────────────────────────────────────────────────── reviewing
  {
    id: "approve-comment",
    group: "reviewing",
    title: "Approve or comment",
    text: "Read it, then <b>Approve</b> (<kbd>a</kbd>) or <b>Comment</b> (<kbd>m</kbd>). An opinion is bound to the declaration's version: when that changes, the opinion says it was given on an earlier one.",
    who: "full",
    where: "both",
    since: "0.1.0",
    about: ["#panel [data-rv=approve]", "#panel [data-rv=comment]", "key:a", "key:m"],
    showMe: "ring-review",
    clip: "approve",
    demo: "The view 'flt_regular: what the statement means', Status colours. Click NumberField.instCommRingRingOfIntegers: its panel shows Bob's comment and Alice's approval. In the panel's box type 'The subalgebra's ring structure.' and press Approve: the opinion shows at once under the recorder's name, the box empties.",
    manual: "review",
  },
  {
    id: "targets",
    group: "reviewing",
    title: "Mark a target",
    text: "<b>☆ Mark as target</b> a theorem whose TCB you review: the side panel lists it with how far its review has come, and a click there opens its view.",
    who: "full",
    where: "both",
    since: "0.1.0",
    about: ["#panel [data-rv-target]", "#targets"],
    showMe: "ring-target",
    clip: "targets",
    demo: "The Project, the side panel's Targets in the frame: caseII, eq_pow_prime_of_unit_of_congruent and flt_regular, each with its progress bar (flt_regular 7/8). The pointer clicks caseII: its view 'Case II' opens in a tab, by file, and the strip under the view bar reads its progress.",
    manual: "review",
  },
  {
    id: "key-declarations",
    group: "reviewing",
    title: "Key declarations",
    text: "Of a target's TCB, the few that carry its meaning: on a view focused on the target, <kbd>k</kbd> marks one. Keys are read first, and <b>Keys</b> selects them.",
    who: "full",
    where: "both",
    since: "0.1.0",
    about: ["#panel [data-rv-key]", "#rests-steps [data-mode=keys]", "key:k"],
    showMe: "ring-key",
    // key-in-target: on a view focused on a target T (its review strip shows), the reader approves a
    // declaration of T's TCB — the second they approved in T's TCB in this page's session — while T
    // has no key declaration but itself. At #panel [data-rv-key]. Ends: a key marked (k, ◇ Mark as
    // key, Mark selected as key); Got it.
    when: "key-in-target",
    manual: "review",
  },
  {
    id: "what-changed",
    group: "reviewing",
    title: "What changed",
    text: "An opinion given on an earlier version says so: <b>What changed</b> shows the lines removed and added since, so a second reading takes only the change.",
    who: "all",
    where: "both",
    since: "0.1.0",
    about: ["#panel [data-rv-changes]"],
    showMe: "what-changed",
    clip: "what-changed",
    demo: "The Project in Status. Click exists_not_dvd_spanSingleton_eq (orange: stale): the panel shows Bob's approval 'on an earlier version' and Alice's AI's advice. The pointer clicks What changed: one line removed and one added, in the proof (spanSingleton_zero left its simp only).",
    // stale-opinion: the panel shows a declaration with an opinion given on an earlier version (by
    // anyone), its What changed closed, for the first time in this browser. At the panel's
    // [data-rv-changes] summary. Ends: What changed opened; Got it.
    when: "stale-opinion",
    manual: "review",
  },
  {
    id: "trusted",
    group: "reviewing",
    title: "Trusted without review",
    text: "Mathlib, Lean core and the standard axioms are trusted: not counted, in need of no opinion. <b>Trusted</b>, over the clusters, lists them; a row's shield trusts a part of the project.",
    who: "full",
    where: "both",
    since: "0.1.0",
    about: ["#trusted-btn", "#trust-list"],
    showMe: "ring-trusted",
    manual: "review",
  },
  {
    id: "library",
    group: "reviewing",
    title: "Papers beside the code",
    text: "Papers and images in the <b>Library</b> are linked to declarations: a declaration's source opens with its paper beside it, at the place linked, lit.",
    who: "all",
    where: "desktop",
    since: "0.1.0",
    about: ["#library-btn", ".pw-win"],
    showMe: "library-pair",
    clip: "library",
    demo: "The view 'Kummer's lemma: the class-group side'. Click eq_pow_prime_of_unit_of_congruent (Kummer's lemma) and press Space: its source opens on the left, Charlie's reading notes on the right at §1, the quote 'Kummer's lemma.' lit; the two windows line up top and bottom.",
    manual: "references",
  },

  // ─────────────────────────────────────────────────────────────── arranging
  {
    id: "drag-to-pin",
    group: "arranging",
    title: "Move things",
    text: "Hold <kbd>Ctrl</kbd> (<kbd>⌘</kbd> on a Mac) and drag, or let the lock go (<kbd>l</kbd>): what you drop stays there, for everyone on this board. <b>Re-layout</b> drops the pins.",
    who: "full",
    where: "desktop",
    since: "0.1.0",
    about: ["#lock-btn", "#relayout", "key:l"],
    showMe: "ring-lock",
    clip: "drag",
    demo: "The Project. Ctrl held (its key cap shown by the pointer), drag IsRegularNumber a short way to the right, out of the crowd, and let go: it stays, its neighbours settle, what it depends on leans after it.",
    manual: "what-you-see",
  },
  {
    id: "zoom-in-view",
    group: "arranging",
    title: "A view of what is lit",
    text: "<b>Zoom in</b>, above the panel, opens exactly what is lit as a view of its own, laid out by itself, in a tab.",
    who: "full",
    where: "both",
    since: "0.1.0",
    about: ["#selbar [data-zoom]"],
    showMe: "ring-zoom",
    clip: "zoom-in",
    demo: "The Project, flt_regular selected under Rests on · TCB (lit). The pointer presses Zoom in on the selection's bar: a tab 'TCB of flt_regular' opens, and its board lays out only those declarations.",
    manual: "views",
  },
  {
    id: "board-scope",
    group: "arranging",
    title: "What a board holds",
    text: "<b>⚙ Board</b> sets what is on this board — chips such as <i>TCB of X</i> or <i>except trusted</i> — its clustering and its depth, for everyone on it.",
    who: "full",
    where: "desktop",
    since: "0.1.0",
    about: ["#board-btn", "#board-pop"],
    showMe: "ring-board",
    manual: "views",
  },
  {
    id: "notes",
    group: "arranging",
    title: "Notes on the board",
    text: "Right-click → <b>Add a note here</b>: a note everyone sees at once, at that place on every board. Drop a PDF or an image on the board for a note that carries it.",
    who: "full",
    where: "desktop",
    since: "0.1.0",
    about: ["#ctxmenu", "#stickies"],
    clip: "notes",
    demo: "The Project. Right-click the empty board beside IsRegularPrime → Add a note here; type 'Regular: p does not divide the class number.' and press Ctrl Enter (its key caps shown): the note's icon sits there, its card open on the text.",
    manual: "what-you-see",
  },

  // ─────────────────────────────────────────────────────────────── together
  {
    id: "follow",
    group: "together",
    title: "Follow someone",
    text: "Click someone's initials to see what they see: their view, camera, selection and windows. Anything you change ends it, and so does Esc.",
    who: "all",
    where: "both",
    since: "0.1.0",
    about: ["#peers", "#following"],
    showMe: "ring-peers",
    manual: "together",
  },
  {
    id: "read-only-link",
    group: "together",
    title: "Read-only links",
    text: "Share → <b>Read-only link</b>: whoever has it reads the project, the review and the history, changes nothing shared, and nobody sees them.",
    who: "full",
    where: "both",
    since: "0.1.0",
    about: ["#share-btn", "#share-pop [data-tab=readonly]"],
    showMe: "share-readonly",
    // share-twice: Share opened for the second time in this page's session, on a server whose Share
    // has the Read-only link tab (started with --access-key-file), the reader never having opened
    // that tab in this browser. At #share-pop [data-tab=readonly]. Ends: that tab opened; Got it.
    // Without that tab on this server, the tip itself is not shown.
    when: "share-twice",
    manual: "together",
  },

  // ─────────────────────────────────────────────────────────────── agents
  {
    id: "ai-agents",
    group: "agents",
    title: "Work with an AI agent",
    text: "Share → <b>AI agent</b> makes a token and a prompt for any agent; follow the agent to talk with it. What it says is advice: shown apart, never counted.",
    who: "full",
    where: "desktop",
    since: "0.1.0",
    about: ["#share-pop [data-tab=agent]", "#peers", "#following"],
    showMe: "share-agent",
    manual: "together",
  },

  // ─────────────────────────────────────────────────────────────── export
  {
    id: "export-document",
    group: "export",
    title: "Print a view",
    text: "<b>Export</b> typesets the view on show as a PDF. While its window is open the board is the document's outline, on one line (<kbd>o</kbd>): drag along it to reorder.",
    who: "full",
    where: "desktop",
    since: "0.2.0",
    about: ["#export-btn", "#export-modal", "#linear", "key:o"],
    showMe: "linear",
    clip: "linear",
    demo: "The view 'Fermat's Last Theorem for regular primes: the statement and its steps'. The pointer presses Export: the window docks at the right and the board eases into one vertical line, its sections numbered as the PDF numbers them, the first at the top.",
    // first-export: the Export window opened for the first time in this browser, the linear form
    // drawn beside it. At #linear. Ends: Got it; it goes, unanswered, when the window closes.
    when: "first-export",
    manual: "exported-documents",
  },
  {
    id: "artwork",
    group: "export",
    title: "The board as a picture",
    text: "Export → <b>Artwork</b>: frame the board, set its look, save a PNG or an SVG. On the command line, <b>visualproof artwork</b> makes the same picture from a recipe.",
    who: "all",
    where: "desktop",
    since: "0.2.0",
    about: ["#export-modal [data-ex-art]", "#art", "#art-panel"],
    showMe: "ring-export",
    clip: "artwork",
    demo: "The Project. Export → Artwork: the window closes into the artwork mode, the frame closes in on the whole board as it takes the artwork's look over half a second; in the panel, Style → Starfield: the board turns into a night sky.",
    manual: "exported-documents",
  },

  // ─────────────────────────────────────────────────────────────── history
  {
    id: "time-machine",
    group: "history",
    title: "The Time Machine",
    text: "<kbd>t</kbd> shows this view at a past build: what is gone is a red ghost, what changed since has an amber ring. <kbd>←</kbd> <kbd>→</kbd> step through the builds; Esc leaves.",
    who: "all",
    where: "desktop",
    since: "0.1.0",
    about: ["#tmbar", "key:t"],
    showMe: "time-machine",
    clip: "time-machine",
    demo: "The view 'Kummer's lemma: the class-group side' (by file). Press t: the bar shows the ruler with three builds (7 Sep, 23 Sep, 14 Oct). Press ← twice, to faae830: Hilbert92's declarations get amber rings, changed since.",
    // first-time-machine: the Time Machine opened by the reader (t, the build popover, a link) for
    // the first time in this browser. At #tmbar, its ruler. Ends: another build reached (← or →);
    // Got it; Esc puts it away, unanswered.
    when: "first-time-machine",
    manual: "review",
  },
  {
    id: "lost-and-found",
    group: "history",
    title: "Lost and found",
    text: "What was said of a declaration the graph no longer has waits in the build status's <b>Lost-and-found</b>: attach it to the new name, or archive it.",
    who: "full",
    where: "both",
    since: "0.1.0",
    about: ["#build", "#build-pop [data-bp=lost]", "#lostfound"],
    showMe: "ring-lost",
    manual: "review",
  },
];
