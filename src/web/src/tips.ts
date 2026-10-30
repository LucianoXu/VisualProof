// What the `?` sheet teaches (GuideSpec decisions 5–11): the tour film's chapters (TOUR), a review
// in thirteen scenes, one card each; and the tips the film does not show (TIPS), one row each, in
// their groups. Each says its words, the controls it is about, and what shows it — Show me, a rule
// that shows it in place; a tip says too who and where it is for and the release its feature came
// in. test/tips.test.ts holds both to their budgets and to the page's surfaces (web/src/surfaces.ts).
// A rule (`when`) is said in full in the comment beside it.

export type TipGroup = "start" | "seeing" | "reviewing" | "arranging" | "together" | "export" | "history";

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
  /** its Show me (decision 7): an action done on the reader's own page (web/src/pageguide.ts, `showMe`;
   *  the TCB step's three views, `tcb-three`, and the sheet's About, `help-about`, are the guide's) */
  showMe?: string;
  /** its clip's id: assets/tips/<clip>.light.mp4 — the phone's gestures alone; the film shows the
   *  rest (decision 6) */
  clip?: string;
  /** for the recorder (scripts/tips/): what the clip shows, step by step */
  demo?: string;
  /** the rule that shows it in place (decision 9; web/src/intip.ts, RULES) */
  when?: string;
  /** the heading of docs/MANUAL.md its More links to, as GitHub anchors it */
  manual?: string;
}

/** A chapter of the tour film (GuideSpec decision 6): one scene of a review, a card beside the
 *  player. Where it starts and ends in the film, and its captions, are the recording's
 *  (`/tips/tour.json`). */
export interface Chapter {
  /** stable: the recording's chapters are named by it; an in-place tip is kept as done under
   *  `tour-<id>` */
  id: string;
  /** a few words, at most 32 characters */
  title: string;
  /** at most 220 characters; <b>, <kbd> allowed */
  text: string;
  /** the controls it is about, as for a tip */
  about: string[];
  showMe?: string;
  manual?: string;
  /** the rule that shows it in place, which opens the film at it (web/src/intip.ts, RULES) */
  when?: string;
}

/** The film, in its order: a review of Sphere-Packing-Lean's theorem in dimension 24, from marking
 *  its target to its artwork (the owner's decisions of 2026-10-16, night, and 2026-10-17). */
export const TOUR: Chapter[] = [
  {
    id: "target",
    title: "Mark a target",
    text: "Search for a theorem, select it, and mark it as a target: the review is about what its statement says.",
    about: ["#search", "#panel [data-rv-target]", "#targets"],
    showMe: "ring-target",
    manual: "review",
  },
  {
    id: "view",
    title: "A view of what it uses",
    text: "Rests on · Uses lights everything it uses. <b>Zoom in</b> opens just that as a view: a board of its own, laid out on its own, shared with everyone.",
    about: ["#rests-steps [data-mode=deps]", "#selbar [data-zoom]", "#tabs"],
    showMe: "ring-zoom",
    manual: "views",
  },
  {
    id: "arrange",
    title: "Arrange the board",
    text: "Drag a declaration with <kbd>Ctrl</kbd> held, or let the lock go, to place it for everyone; double-click a circle to fold it, again to open it.",
    about: ["#canvas", "#lock-btn", "key:l"],
    showMe: "ring-lock",
    manual: "what-you-see",
  },
  {
    id: "source",
    title: "Read the source",
    text: "<kbd>Space</kbd> opens the source, following the selection, with the panel's review box. Rest on a name for what Lean says it is; click it to go there.",
    about: [".sw-win", "key:Space"],
    showMe: "open-source",
    manual: "review",
  },
  {
    id: "keys",
    title: "Key declarations",
    text: "On the target's view, select the declarations that carry its meaning and mark them key with a click. <b>Keys</b> selects them.",
    about: ["#panel [data-rv-key]", "#selbar [data-mark-keys]", "#rests-steps [data-mode=keys]"],
    showMe: "ring-key",
    // key-in-target: on a view focused on a target T (its review strip shows), the reader approves a
    // declaration of T's TCB — the second they approved in T's TCB in this page's session — while T
    // has no key declaration but itself. At #panel [data-rv-key]. Ends: a key marked (k, ◇ Mark as
    // key, Mark selected as key); Got it.
    when: "key-in-target",
    manual: "review",
  },
  {
    id: "checks",
    title: "Three ways to check",
    text: "<b>Selection</b>: the statement alone, least effort. <b>Keys</b>: the few that carry the meaning. <b>TCB</b>: all it rests on, most effort, most confidence. The counts say what each costs, the trusted apart.",
    about: ["#lightup [data-mode=plain]", "#rests-steps [data-mode=keys]", "#rests-steps [data-mode=tcb]", "key:2"],
    showMe: "tcb-three",
    // tcb-first: the reader's own click selects, under Rests on · TCB, a theorem whose TCB lights
    // more than itself (not the tour's selection, not one taken by following or by a link opened),
    // for the first time in this browser. At #rests-steps [data-mode=tcb] on a larger screen, at the
    // panel's TCB part (#panel .p-tcb) on a phone. Ends: Got it; Show me pressed in it (it runs the
    // three views); Watch; the reader stepping to another step of Rests on.
    when: "tcb-first",
    manual: "how-the-tcb-is-computed",
  },
  {
    id: "review",
    title: "Comment and approve",
    text: "Comment or approve each declaration you read: an opinion holds for the version it judged, and the target's progress counts it. <b>Withdraw</b> takes yours back.",
    about: ["#panel [data-rv=approve]", "#panel [data-rv=comment]", "#targets"],
    showMe: "ring-review",
    manual: "review",
  },
  {
    id: "project",
    title: "Back to the Project",
    text: "The Project is the whole codebase; views are slices of it. Every board shows how far the review has come.",
    about: ["#tabs", "#targets"],
    manual: "views",
  },
  {
    id: "share",
    title: "Share",
    text: "A link for people, a read-only link for readers, and for an AI agent a token with a prompt to paste.",
    about: ["#share-btn", "#share-pop"],
    showMe: "ring-share",
    manual: "together",
  },
  {
    id: "agent",
    title: "Work with an agent",
    text: "Talk with your agent (its menu → <b>Talk</b>), in a channel no one else reads: it reads the codebase through the API and answers, its links going where it explains. It gives advice; approving stays with people.",
    about: ["#share-pop [data-tab=agent]", "#peers", "#convo"],
    showMe: "share-agent",
    manual: "together",
  },
  {
    id: "library",
    title: "Papers and notes",
    text: "Add a paper to the <b>Library</b> and link it to the declarations it explains; pin notes on the board for everyone.",
    about: ["#library-btn", ".pw-win", "#stickies"],
    showMe: "library-pair",
    manual: "references",
  },
  {
    id: "export",
    title: "A typeset document",
    text: "<b>Export</b> draws the view as its outline on one line: drag a section to reorder it, then statements, sources and the review are typeset as a PDF.",
    about: ["#export-btn", "#export-modal", "#linear"],
    showMe: "ring-export",
    // first-export: the Export window opened for the first time in this browser, the linear form
    // drawn beside it. At #linear. Ends: Got it; Watch; it goes, unanswered, when the window closes.
    when: "first-export",
    manual: "exported-documents",
  },
  {
    id: "artwork",
    title: "Artwork",
    text: "The board as a poster: frame it, choose what is named, and export a PNG and an SVG.",
    about: ["#export-modal [data-ex-art]", "#art", "#art-panel"],
    showMe: "ring-export",
    manual: "exported-documents",
  },
];

/** The groups of the tips, in the sheet's order (decision 5). */
export const GROUPS: readonly { id: TipGroup; title: string }[] = [
  { id: "start", title: "Start" },
  { id: "seeing", title: "Seeing" },
  { id: "reviewing", title: "Reviewing" },
  { id: "arranging", title: "Arranging" },
  { id: "together", title: "Together" },
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
    title: "Kept up to date",
    text: "A server installed from npm takes VisualProof's fixes by itself, unless told not to, and this page reloads where you were. The help's About says which VisualProof runs.",
    who: "all",
    where: "both",
    since: "0.4.0",
    about: ["#help"],
    showMe: "help-about",
    manual: "updates",
  },

  // ─────────────────────────────────────────────────────────────── seeing
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
    manual: "what-you-see",
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
    manual: "what-you-see",
  },

  // ─────────────────────────────────────────────────────────────── reviewing
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
    manual: "what-you-see",
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

  // ─────────────────────────────────────────────────────────────── together
  {
    id: "follow",
    group: "together",
    title: "Follow someone",
    text: "Click someone's initials to see what they see: their view, camera, selection and windows. Anything you change ends it, and <b>Follow again</b> in the strip takes you back; Esc stops it.",
    who: "all",
    where: "both",
    since: "0.1.0",
    about: ["#peers", "#following"],
    showMe: "ring-peers",
    manual: "together",
  },
  {
    id: "conversations",
    group: "together",
    title: "Conversations",
    text: "The conversation button (Conversations in ⋯ on a phone) opens your own window: <b>Everyone</b>, where @ and a name mentions someone, and a private channel with each agent you made. It stays in front, whoever you follow.",
    who: "full",
    where: "both",
    since: "0.6.0",
    about: ["#talk-btn", "#convo"],
    manual: "together",
  },
  {
    id: "copy-link",
    group: "together",
    title: "Copy link",
    text: "Right-click a declaration, a cluster or a note → <b>Copy link</b>; on the empty canvas, a link to what you see. A conversation shows it as what it leads to, and it carries no key.",
    who: "all",
    where: "desktop",
    since: "0.6.0",
    about: ["#ctxmenu"],
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

  // ─────────────────────────────────────────────────────────────── export
  {
    id: "linear-form",
    group: "export",
    title: "The board as an outline",
    text: "<kbd>o</kbd> draws the board as its document's outline, on one line, the first section at the top: drag along it to reorder what the PDF prints.",
    who: "full",
    where: "desktop",
    since: "0.2.0",
    about: ["#linear", "key:o"],
    showMe: "linear",
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
