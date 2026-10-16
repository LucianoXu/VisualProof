// The guide (GuideSpec): on a reader's first visit, a short tour of the page that lights up one part
// at a time on the project itself — a real theorem selected, what it rests on in three views — and,
// at any time, the `?` sheet: the tips first (web/src/tips.ts, each a card with its clip), then every
// key and gesture, and a button that replays the tour. Show me rings a tip's control with the tour's
// spotlight; What's new is said once when the server runs a newer release than this browser saw.
//
// The sheet's Keys tab also holds the one setting that is about the reader's machine rather than
// the page: the URL that opens a declaration in their editor (web/src/editor.ts). It sits with the
// keys because both are read once and then left alone, and the sheet is where a reader looks for
// how the page works with what they have. At its foot is what the graph holds, and which
// VisualProof the server runs (GuideSpec decision 13).

import { dragKeyName, MAC } from "./drag.ts";
import { escapeHtml } from "./highlight.ts";
import type { Store } from "./store.ts";
import { isPhone } from "./phone.ts";
import { typing } from "./typing.ts";
import type { Tool } from "./selection.ts";
import { TIPS } from "./tips.ts";
import type { Tip } from "./tips.ts";
import { cardsHtml, ClipPlayer, tipsFor } from "./tipcards.ts";
import type { TipsContext } from "./tipcards.ts";
import { TipState } from "./tipstate.ts";
import { InTips } from "./intip.ts";

/** What the server says of its release and a newer one (UpdateSpec; `GET /api/updates`): a
 *  read-only reader is told `running` alone. */
export interface UpdateStatus {
  running: string;
  /** the installed package's release, where the server runs another (a patch it took) */
  installed?: string;
  mode?: "auto" | "notify" | "off";
  checked?: string;
  newer?: { version: string; taken: boolean; command?: string; notes: string };
}

/** What the tour's TCB step says of its theorem (GuideSpec decision 2): what each view lights on
 *  the board, as the selection bar counts it ("19 lit"), the theorem itself left out — so that the
 *  card's numbers add up to the bar's. */
export interface RestsOn {
  /** its name, as the panel heads it */
  name: string;
  /** what its TCB lights that is to be read: not trusted */
  read: number;
  /** what its TCB lights that is trusted (Mathlib's, and what the review trusts), and assumed */
  assumed: number;
  /** what Uses lights beyond what TCB lights: what its proofs alone use, trusted or not */
  proofs: number;
  /** what Keys lights: the key declarations among what TCB lights */
  keys: number;
  /** it is a target */
  target: boolean;
}

export interface GuideHooks {
  /** the project's name */
  project(): string;
  /** the project as read, in a sentence: how much the graph holds, when and how it was read */
  about(): string;
  /** a snapshot: no names, no others, no timeline */
  snapshot(): boolean;
  /** a read-only reader (or a snapshot): nothing of the review is theirs to change */
  readOnly(): boolean;
  /** following someone: no tip shows in place (decision 9) */
  following(): boolean;
  /** the artwork mode: no tip shows in place */
  busy(): boolean;
  /** the declaration the tour shows things on (GuideSpec decision 3); null when there is none */
  example(): number | null;
  /** select it, as a click would, and bring it into view — without a step in the history */
  select(i: number): void;
  /** choose a tool, as a mode's button would — without a step in the history, and without what a
   *  tip in place counts as the reader's own choice */
  setTool(m: Tool): void;
  /** where the reader is (the tool, the step of Rests on, the selection, the camera), and putting
   *  them back there: the tour leaves the page as it found it (GuideSpec decision 3) */
  place(): unknown;
  back(place: unknown): void;
  /** Show me's moves recorded as one step in the history (they stay: GuideSpec decision 7) */
  record(): void;
  /** what the TCB step says of declaration `i` */
  restsOn(i: number): RestsOn;
  /** the camera frames what is lit (the TCB step's views; jumps with reduced motion) */
  frameLit(): void;
  /** whether a Show me can be done here (there is something to show: a theorem, someone else,
   *  read-only links); a tip whose Show me cannot shows without it */
  canShow(action: string): boolean;
  /** whether a tip is about something this page has at all (read-only links on a server that makes
   *  them) */
  applies(t: Tip): boolean;
  /** a Show me's action (GuideSpec decision 7) done on the reader's own page: the selector of what
   *  to ring after it, or null when there is nothing to show here */
  show(action: string): string | null;
  /** the tour ended (done or skipped) */
  ended(): void;
  /** the "Open in editor" templates: the server's, and the reader's own */
  editor(): { server: string | null; mine: string | null };
  /** set the reader's own template ("" goes back to the server's); why not, when refused */
  setEditor(t: string): string | null;
  /** what the server says of its release (decision 13); null where it says nothing (a snapshot) */
  updates(): Promise<UpdateStatus | null>;
  /** the clips the server has (decision 6); none in a snapshot */
  clips(): Promise<Set<string>>;
}

/** One view of a step: the TCB step shows its theorem three ways (GuideSpec decision 2). */
interface View {
  label: string;
  text: () => string;
  before: () => void;
  at?: () => DOMRect | null;
}

interface Step {
  title: string;
  text: string;
  /** what to light up: elements, or a rectangle; nothing for a step in the middle of the screen */
  at?: () => DOMRect | null;
  /** done before the step shows */
  before?: () => void;
  /** whether the step belongs in this page at all (a snapshot has no others) */
  only?: () => boolean;
  /** whether its place is shown now: a step whose place is not (the panel did not open) is
   *  passed over */
  when?: () => boolean;
  /** views gone through one by one before the next step */
  views?: View[];
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);

/** The Show me actions the guide does itself (GuideSpec decision 7): the TCB step's three views, and
 *  the sheet's About; the page does the others (web/src/main.ts, `showMe`). */
export const GUIDE_SHOWS = ["tcb-three", "help-about"] as const;

/** VisualProof's repository, which the help sheet links to (the owner's decision of 2026-10-16). */
const REPO = "https://github.com/LucianoXu/VisualProof";
/** the manual, which a tip's More links into (GuideSpec decision 5) */
const MANUAL = `${REPO}/blob/main/docs/MANUAL.md`;

/** The rectangle around the elements found, or null when none is shown. */
function around(...sels: string[]): DOMRect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sels) {
    const el = $(s);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    x0 = Math.min(x0, r.left);
    y0 = Math.min(y0, r.top);
    x1 = Math.max(x1, r.right);
    y1 = Math.max(y1, r.bottom);
  }
  return isFinite(x0) ? new DOMRect(x0, y0, x1 - x0, y1 - y0) : null;
}

/** The board's part of the screen: right of the side panel, under the bars, left of the panel. */
function board(): DOMRect {
  const side = $("#side")?.getBoundingClientRect();
  const panel = $("#panel.open")?.getBoundingClientRect();
  const left = side && side.width && !isPhone() ? side.right + 8 : 12;
  const right = panel && panel.width && !isPhone() ? panel.left - 8 : innerWidth - 12;
  const top = isPhone() ? 104 : 108;
  const bottom = isPhone() && panel && panel.height ? panel.top - 8 : innerHeight - 48;
  return new DOMRect(left, top, Math.max(40, right - left), Math.max(40, bottom - top));
}

/** "1 declaration", "3 declarations" */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A row of the sheet: keys (drawn as keys), then a gesture in words, then what it does. */
interface Row {
  k?: string[];
  g?: string;
  what: string;
}

/** The sheet on a phone (PhoneSpec decision 15; web/src/phone.ts): what the fingers do, and where
 *  the page keeps what reading and reviewing need. Nothing on the board is moved by a finger. */
const TOUCH: [string, Row[]][] = [
  [
    "The board",
    [
      { g: "drag", what: "move around" },
      { g: "pinch", what: "zoom; two fingers also move the board" },
      { g: "double-tap empty board", what: "zoom in there" },
      { g: "tap", what: "select a declaration, or a circle for all it holds; tap empty board to select nothing" },
      { g: "touch and hold", what: "what can be done with what is under your finger: its TCB, what it uses, what uses it, its source" },
      { g: "the frame button", what: "the whole board on the screen" },
    ],
  ],
  [
    "How a tap selects: the modes, in ⋯ at the top",
    [
      { g: "Selection", what: "just what you tap" },
      { g: "Rests on · Uses", what: "and everything it uses, proofs included" },
      { g: "Rests on · TCB", what: "and what its statement rests on, proofs skipped: its trusted computing base" },
      { g: "Rests on · Keys", what: "and the key declarations in its TCB" },
      { g: "Rests on · Direct", what: "and what it uses directly, proofs included" },
      { g: "Used by", what: "and everything that uses it" },
    ],
  ],
  [
    "Reading and reviewing",
    [
      { g: "the sheet", what: "what you tapped; tap its handle for the whole screen or half of it, ✕ to close it" },
      { g: "Source", what: "its code, on the whole screen; ✕ closes it" },
      { g: "Approve, Comment", what: "your opinion, under your name (⋯ at the top: your name)" },
      { g: "☰", what: "the targets under review, and the board's namespaces or folders" },
      { g: "Search", what: "names, statements and docstrings" },
      { g: "‹", what: "back" },
    ],
  ],
  [
    "Together, and the rest",
    [
      { g: "someone's initials", what: "follow them: you see what they see" },
      { g: "⋯ at the top", what: "the modes, share, the library, export, activity, your name, this sheet" },
      { g: "⋯ at the bottom", what: "edges, the linear form, the theme" },
      { g: "Kind ▾", what: "colour by kind or by review status" },
    ],
  ],
];

const KEYS: [string, Row[]][] = [
  [
    "Getting around",
    [
      { k: ["/"], what: "search names, statements and docstrings" },
      { k: ["Alt ←", "Alt →"], what: "back, forward" },
      { k: ["f"], what: "fit the view" },
      { k: ["+", "−"], what: "zoom in, out" },
      { k: ["[", "]"], what: "one level less, more" },
      { k: ["Esc"], what: "close, select nothing (the visitors, dashed, go with it)" },
      { k: ["t"], what: "the Time Machine: this view at a past build, to look at; t or Esc leaves it" },
      { k: ["←", "→"], g: "in it", what: "the build before, after (Home, End: the first, the last); or drag the timeline" },
    ],
  ],
  [
    "Selecting",
    [
      { g: "click", what: "select a declaration, or a cluster (a circle, a row of the tree)" },
      { k: ["Shift"], g: "click", what: "with Selection: add it, or take it out" },
      { k: ["1", "2", "3"], what: "how a click selects: just it, what it rests on, what uses it" },
      { k: ["2"], g: "again", what: "Rests on's next step: its TCB, the key declarations in it, everything it uses, what it uses directly" },
      { g: "click empty space", what: "select nothing (also Esc)" },
      { k: ["Space"], what: "the selection's source, in a window that follows it" },
      { g: "the pin of a source window", what: "keep it on its declaration: the next opens beside it" },
    ],
  ],
  [
    "Reviewing",
    [
      { k: ["a"], what: "approve the selection; in a source window, its declaration" },
      { k: ["m"], what: "comment on it: write the comment, Esc, m again" },
      { k: ["k"], what: "mark it key for the focus (Focus ▾), or unmark it" },
    ],
  ],
  [
    "Showing",
    [
      { k: ["e"], what: "the outside world on this board, for everyone" },
      { k: ["g"], what: "edges, for you" },
      { k: ["o"], what: "the linear form: the board as its document's outline, on one line" },
      { k: ["c"], what: "colour by kind or by status, for you" },
      { k: ["b"], what: "build status" },
      { k: ["p"], what: "frame meter" },
      { k: ["?"], what: "this sheet: the tips, and the keys" },
    ],
  ],
  [
    "With the pointer",
    [
      { g: "scroll", what: "zoom" },
      { g: "drag", what: "pan, anywhere (or with the middle button)" },
      // on a Mac, Ctrl+click is the right click: the drag key is ⌘ there (web/src/drag.ts)
      MAC ? { k: ["Ctrl"], g: "click, or right click", what: "what can be done with what is under the pointer: the menu" } : { g: "right click", what: "what can be done with what is under the pointer: the menu" },
      { k: ["Shift F10"], what: "the same menu on what is selected (or the ContextMenu key)" },
      { k: [dragKeyName()], g: "drag a dot, a circle or a note", what: "move it, for everyone on this board" },
      { k: ["l"], what: "let the lock go, or lock again: unlocked, a drag moves dots, circles and notes (the lock, behind ⋯ at the bottom right)" },
      { k: [dragKeyName()], g: "hold", what: "the other way while held: move things on a locked layout, or pan over them" },
      { g: "click a note's icon", what: "show its card, or the icon alone, for everyone on this board" },
      { g: "drag a note's card", what: "where it hangs from its icon, as a drag moves things; the note stays where it is" },
      { g: "double-click a note's card", what: "edit the note" },
      { g: "double-click a circle", what: "fold it, or open it, for everyone on this board" },
      { g: "rest on a name in the source", what: "what Lean says it is" },
      { g: "drag a window's title bar, or an edge", what: "move it, resize it; a double-click on the title bar collapses it" },
    ],
  ],
];

export class Guide {
  private store: Store;
  private hooks: GuideHooks;
  private steps: Step[] = [];
  private k = 0;
  /** the view of a step with views */
  private v = 0;
  /** the tour as a whole, or one step for a tip's Show me (GuideSpec decision 7) */
  private kind: "tour" | "show" = "tour";
  /** where the reader was when the tour began: theirs again when it ends (GuideSpec decision 3) */
  private placeBefore: unknown = null;
  private el: HTMLElement;
  private spot: HTMLElement;
  private shades: HTMLElement[];
  private card: HTMLElement;
  private help: HTMLElement;
  private news: HTMLElement;
  readonly tips = new TipState();
  readonly inPlace: InTips;
  private player: ClipPlayer | null = null;
  private tab: "tips" | "keys" = "tips";
  private filter = "";
  private clipsHad: Set<string> | null = null;
  /** the release tips newer than which are New while the sheet shows (decision 11); undefined until
   *  Tips is looked at in this showing of the sheet */
  private newShown: string | null | undefined = undefined;
  /** the release the server runs, as its event stream said (UpdateSpec); null until it says */
  private running: string | null = null;

  constructor(store: Store, hooks: GuideHooks) {
    this.store = store;
    this.hooks = hooks;
    this.el = $("#tour")!;
    this.spot = this.el.querySelector<HTMLElement>(".tour-spot")!;
    this.shades = [...this.el.querySelectorAll<HTMLElement>(".tour-shade")];
    this.card = this.el.querySelector<HTMLElement>(".tour-card")!;
    this.help = $("#help")!;
    this.news = $("#whatsnew")!;
    this.inPlace = new InTips(this.tips, {
      blocked: () => !this.el.hidden || !this.help.hidden || this.hooks.snapshot() || this.hooks.following() || this.hooks.busy(),
      fits: (t) => tipsFor(this.context(new Set())).includes(t),
      showMe: (t) => this.showTip(t),
    });
    this.card.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const seg = t.closest<HTMLElement>("[data-tour-view]");
      if (seg) this.view(Number(seg.dataset.tourView));
      else if (t.closest("[data-tour-next]")) this.next();
      else if (t.closest("[data-tour-back]")) this.back();
      else if (t.closest("[data-tour-skip]")) this.stop();
      else if (t.closest("[data-tour-tips]")) {
        this.stop();
        this.openHelp("tips");
      }
    });
    window.addEventListener(
      "keydown",
      (e) => {
        if (this.el.hidden) return;
        // the tour has the keys while it shows
        e.stopImmediatePropagation();
        if (e.key === "Escape") this.stop();
        else if (e.key === "ArrowRight" || e.key === "Enter") this.next();
        else if (e.key === "ArrowLeft") this.back();
        e.preventDefault();
      },
      true,
    );
    window.addEventListener("resize", () => {
      if (!this.el.hidden) this.place();
    });
    this.help.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>("[data-help-tab]");
      const show = t.closest<HTMLElement>("[data-tip-show]");
      if (t === this.help || t.closest("[data-help-close]")) this.closeHelp();
      else if (tab) this.showTab(tab.dataset.helpTab === "keys" ? "keys" : "tips");
      else if (show) {
        const tip = TIPS.find((x) => x.id === show.dataset.tipShow);
        this.closeHelp();
        if (tip) this.showTip(tip);
      } else if (t.closest("[data-help-tour]")) {
        this.closeHelp();
        this.start();
      }
    });
    this.help.addEventListener("keydown", (e) => {
      // a ? typed into the editor's field is part of a URL, into the filter a word
      if (e.key === "Escape" || (e.key === "?" && !typing(e.target))) {
        e.stopPropagation();
        // Esc leaves the field as it was saved: it cancels, as everywhere
        const field = this.help.querySelector<HTMLInputElement>("[data-help-editor]");
        if (field) field.value = this.hooks.editor().mine ?? "";
        this.closeHelp();
      }
    });
    // the template is saved when the field is left or Enter pressed; while it is typed, an earlier
    // complaint goes away
    this.help.addEventListener("change", (e) => {
      const el = e.target as HTMLElement;
      if (el.closest("[data-tips-off]")) {
        this.tips.off = !(el as HTMLInputElement).checked;
        return;
      }
      const field = el.closest<HTMLInputElement>("[data-help-editor]");
      if (!field) return;
      const why = this.hooks.setEditor(field.value);
      const err = this.help.querySelector<HTMLElement>("[data-help-editor-err]")!;
      err.textContent = why ?? "";
      err.hidden = !why;
      if (!why) this.help.querySelector<HTMLElement>("[data-help-editor-now]")!.innerHTML = this.editorNow();
    });
    this.help.addEventListener("input", (e) => {
      const el = e.target as HTMLElement;
      if (el.closest("[data-help-editor]")) this.help.querySelector<HTMLElement>("[data-help-editor-err]")!.hidden = true;
      else if (el.closest("[data-tips-filter]")) {
        this.filter = (el as HTMLInputElement).value;
        this.renderCards();
      }
    });
    // an ⓘ anywhere on the page opens its tip in the sheet (the panel's TCB part: GuideSpec
    // decision 15)
    document.addEventListener(
      "click",
      (e) => {
        const i = (e.target as HTMLElement).closest<HTMLElement>("[data-tip-open]");
        if (!i) return;
        e.preventDefault();
        e.stopPropagation();
        this.openHelp("tips", i.dataset.tipOpen);
      },
      true,
    );
    this.news.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      this.news.hidden = true;
      if (!t.closest("[data-news-close]")) this.openHelp("tips");
    });
  }

  /** The first visit: the tour, once. */
  firstVisit(): void {
    if (this.store.data.guided) return;
    this.start();
  }

  /** What the tips are shown against now. */
  private context(clips: Set<string>): TipsContext {
    const snapshot = this.hooks.snapshot();
    return {
      readOnly: this.hooks.readOnly(),
      phone: isPhone(),
      clips,
      newSince: this.newShown ?? null,
      manual: MANUAL,
      applies: (t) => this.hooks.applies(t),
      canShow: (a) => !snapshot && !this.hooks.following() && this.hooks.canShow(a),
    };
  }

  // ---------------------------------------------------------------- the tour

  /** The TCB step (GuideSpec decision 2): its theorem alone, its TCB, its key declarations, each
   *  with the counts of what it lights, the camera framing what is lit. */
  private restsOnStep(phone: boolean): Step | null {
    const i = this.hooks.example();
    if (i === null) return null;
    const ro = this.hooks.readOnly();
    let r = this.hooks.restsOn(i);
    const ring = (step: string) => () => (phone ? around("#panel") : around(step)) ?? board();
    // the mode's step at the top right, and the board it lights, together: nothing lit is shaded
    const lit = (step: string) => () => {
      const b = board();
      const m = phone ? null : around(step);
      if (!m) return b;
      const l = Math.min(b.left, m.left), t = Math.min(b.top, m.top);
      return new DOMRect(l, t, Math.max(b.right, m.right) - l, Math.max(b.bottom, m.bottom) - t);
    };
    const views: View[] = [
      {
        label: "Statement",
        before: () => {
          this.hooks.setTool("plain");
          this.hooks.select(i);
          r = this.hooks.restsOn(i);
        },
        text: () => `This is <b>${escapeHtml(r.name)}</b>. Lean checked its proof; whether it says what you mean is in the words of its statement, and they are defined elsewhere.`,
        at: () => (phone ? around("#panel") : around("#panel .p-head", "#panel .p-name", "#panel .sig")) ?? board(),
      },
      {
        label: "TCB",
        before: () => {
          this.hooks.setTool("tcb");
          this.hooks.frameLit();
        },
        // the numbers add up to the selection bar's: the theorem, what is to be read, what is assumed
        text: () => {
          const lit = r.read + r.assumed;
          const assumed = r.assumed ? `${r.assumed} trusted, as Mathlib is, and assumed` : "";
          const proofs = r.proofs ? ` What its proofs alone use, ${r.proofs} more, is not lit: the proofs are Lean's to check.` : "";
          if (!lit) return `Its <b>TCB</b> is itself alone: its statement rests on nothing but Lean.${proofs}`;
          if (!r.read) return `Its <b>TCB</b> lights ${lit} besides it, all ${r.assumed === 1 ? "of it " : ""}trusted, as Mathlib is, and assumed: nothing of the project's to read.${proofs}`;
          return `Its <b>TCB</b> lights ${lit} besides it: ${r.read} to read — definitions, axioms, the project's notation —${assumed ? ` and ${assumed}` : ""}. To trust it, read ${r.read === 1 ? "that one" : `those ${r.read}`}.${proofs}`;
        },
        at: lit("#rests-steps [data-mode=tcb]"),
      },
      {
        label: "Keys",
        // no key declaration: the TCB stays lit, and the card says how keys are marked
        before: () => {
          this.hooks.setTool(r.keys ? "keys" : "tcb");
          this.hooks.frameLit();
        },
        text: () =>
          r.keys
            ? r.keys === 1
              ? `Of those ${r.read + r.assumed}, the one the review marked <b>key</b>: what carries its meaning. Read it first.`
              : `Of those ${r.read + r.assumed}, the ${r.keys} the review marked <b>key</b>: the few that carry its meaning. Read them first.`
            : ro || this.hooks.snapshot()
              ? "None is marked <b>key</b> yet: the review marks the few of a target's TCB that carry its meaning."
              : phone
                ? "None is marked <b>key</b> yet. On a target's view, its panel's ◇ Mark as key marks the few that carry its meaning."
                : "None is marked <b>key</b> yet. On a view focused on a target, <kbd>k</kbd> marks the few of its TCB that carry its meaning.",
        at: () => (r.keys ? lit("#rests-steps [data-mode=keys]")() : ring("#rests-steps [data-mode=keys]")()),
      },
    ];
    return { title: "What it rests on", text: "", views };
  }

  start(): void {
    this.kind = "tour";
    this.placeBefore = this.hooks.place();
    this.inPlace.hush();
    const project = escapeHtml(this.hooks.project());
    const snapshot = this.hooks.snapshot();
    const live = () => !snapshot;
    // a read-only reader's page, and a snapshot, change nothing shared (the texts for them)
    const ro = this.hooks.readOnly();
    const reader = ro && !snapshot;
    const phone = isPhone();
    const rests = this.restsOnStep(phone);
    const all: Step[] = [
      { title: "Welcome", text: `${project}'s declarations as a map, and what each theorem rests on. A quick tour.` },
      {
        title: "The map",
        text: phone
          ? "Dots are declarations, circles namespaces. Drag to move around, pinch to zoom, tap to select; touch and hold for what can be done with what is under your finger."
          : ro
            ? `Dots are declarations, circles namespaces. Scroll to zoom, drag to pan, double-click a circle to fold it${reader ? ", for you alone" : ""}.`
            : `Dots are declarations, circles namespaces. Scroll to zoom, drag to pan, double-click a circle to fold it. To move things, drag with <b>${dragKeyName()}</b> held, or let the lock go (<b>l</b>).`,
        at: board,
      },
      {
        title: "Select",
        text: phone
          ? "Tap a declaration, or a circle for all of its declarations. How a tap selects is the mode, in <b>⋯</b> at the top: just it, what it rests on, or what uses it."
          : "Click a declaration, or a circle for all of its declarations. <b>Mode</b> is how a click selects: just it (<kbd>1</kbd>), what it <b>rests on</b> (<kbd>2</kbd>), or what uses it (<kbd>3</kbd>). Rest the pointer on a mode to read it.",
        at: () => around(phone ? "#more-btn" : "#lightup"),
      },
      ...(rests ? [rests] : []),
      {
        title: "The board",
        text: phone
          ? "<b>☰</b> opens the targets under review and this board's namespaces or folders."
          : ro
            ? "The left panel: the targets under review, and this board's clusters; <b>⚙ Board</b> shows what is on it. Tabs are the views you have open; <b>Views</b> lists them. Whatever you select, fold or open is yours alone."
            : "The left panel: the targets under review, and this board's clusters. A board is shared with everyone on it: <b>⚙ Board</b> holds what is on it (its scope, as chips), the clustering, the depth. Tabs are the views you have open; <b>Views</b> makes and lists them. Your camera and what you select are yours alone.",
        at: () => (phone ? around("#side-btn") : around("#side", "#tabs", ".views-wrap")),
      },
      {
        title: "The panel",
        text: phone
          ? "The sheet is what you tapped last: a tap on its handle gives it the whole screen or half of it, ✕ closes it. <b>Source</b> shows its code."
          : ro
            ? "All about what you clicked last; <b>Source</b> (<kbd>Space</kbd>) opens the code, and the parts with a ▸ open on a click."
            : "All about what you clicked last; <b>Source</b> (<kbd>Space</kbd>) opens the code, and the parts with a ▸ open on a click. Above it, what is selected: <b>Zoom in</b> opens a view of it.",
        at: () => (phone ? around("#panel") : around("#selbar", "#panel")),
        when: () => !!$("#panel.open"),
      },
      {
        title: "Review",
        text: snapshot
          ? "Opinions as they were when this snapshot was taken."
          : ro
            ? "The review as it stands, live: who approved, who commented, on which version. A read-only page records nothing."
            : phone
              ? "<b>Approve</b> or <b>Comment</b> on what you have read, under your name (⋯: your name)."
              : "<b>Approve</b> or <b>Comment</b> on what you have read. <b>Mark as target</b> a theorem to follow its review.",
        at: () => around("#panel .rv"),
        when: () => !!$("#panel.open .rv"),
      },
      {
        title: "Together",
        text: phone
          ? `Who else is here: tap one's initials to follow${reader ? "; nobody sees you" : ""}. <b>⋯</b> holds Activity.`
          : reader
            ? "Who else is here: click one to follow; nobody sees you. <b>Activity</b> lists what happened."
            : "Who else is here: click one to follow. <b>Activity</b> lists what happened.",
        at: () => (phone ? around("#peers", "#more-btn") : reader ? around("#activity-btn", "#peers") : around("#activity-btn", "#peers", "#who")),
        only: live,
      },
      {
        title: "Colours",
        text: phone
          ? "By kind, or by <b>status</b>: what reviewers said, what is trusted, what failed to build. <b>Kind ▾</b> at the bottom left switches them and says what each colour means."
          : "By kind, or by <b>status</b>: what reviewers said, what is trusted, what failed to build. The legend at the bottom left switches them (or <kbd>c</kbd>) and says what each colour means.",
        at: () => around("#legend"),
      },
      {
        title: "Getting around",
        // the last step points at the tips (GuideSpec decision 1)
        text: phone
          ? "‹ goes back; <b>Search</b> finds names, statements and docstrings. <b>⋯</b> → Help holds the gestures and the <b>Tips</b>."
          : "Back, forward and links work as in a browser; <kbd>/</kbd> searches names, statements and docstrings. <b>?</b> holds every key, and the <b>Tips</b>: how to do the rest, one at a time.",
        at: () => (phone ? around(".brand .nav", ".search-wrap", "#more-btn") : around(".brand .nav", ".search-wrap", "#help-btn")),
      },
    ];
    this.steps = all.filter((s) => !s.only || s.only());
    this.k = 0;
    this.v = 0;
    this.el.hidden = false;
    this.go(0);
  }

  /** A tip's Show me (GuideSpec decision 7): its control ringed, its words beside it, after what
   *  its action does on the reader's own page. */
  showTip(tip: Tip): void {
    if (!tip.showMe || !this.hooks.canShow(tip.showMe)) return;
    // the sheet's About: the sheet stays, on the tab that holds it
    if (tip.showMe === GUIDE_SHOWS[1]) {
      this.openHelp("keys");
      const about = this.help.querySelector<HTMLElement>("[data-help-tool]");
      about?.scrollIntoView({ block: "center" });
      about?.parentElement?.classList.add("flash");
      return;
    }
    let step: Step | null;
    if (tip.showMe === GUIDE_SHOWS[0]) {
      step = this.restsOnStep(isPhone());
      if (step) step.title = tip.title;
    } else {
      const ring = this.hooks.show(tip.showMe);
      step = ring === null ? null : { title: tip.title, text: tip.text, at: () => around(...ring.split(/\s*,\s*/)) };
    }
    if (!step) return;
    this.tips.done(tip.id);
    this.kind = "show";
    this.placeBefore = null;
    this.steps = [step];
    this.k = 0;
    this.v = 0;
    this.el.hidden = false;
    this.go(0);
  }

  private next(): void {
    const s = this.steps[this.k];
    if (s?.views && this.v < s.views.length - 1) this.view(this.v + 1);
    else this.go(this.k + 1);
  }

  private back(): void {
    const s = this.steps[this.k];
    if (s?.views && this.v > 0) this.view(this.v - 1);
    else this.go(this.k - 1, -1);
  }

  /** A view of the step shown: what it does done, its words, its place. */
  private view(v: number): void {
    const s = this.steps[this.k];
    if (!s?.views?.[v]) return;
    this.v = v;
    s.views[v].before();
    this.render();
  }

  private go(k: number, dir = k >= this.k ? 1 : -1): void {
    if (k < 0) return;
    if (k >= this.steps.length) return this.stop();
    const s = this.steps[k];
    s.before?.();
    // a step whose place is not shown (the panel did not open) is passed over, either way
    if (s.when && !s.when()) return this.go(k + dir, dir);
    this.k = k;
    // a step of views is entered at its first going forward, at its last coming back
    this.v = s.views ? (dir > 0 ? 0 : s.views.length - 1) : 0;
    s.views?.[this.v].before();
    this.render();
  }

  private render(): void {
    const s = this.steps[this.k];
    const k = this.k;
    const show = this.kind === "show";
    const lastView = !s.views || this.v === s.views.length - 1;
    const last = k === this.steps.length - 1 && lastView;
    const text = s.views ? s.views[this.v].text() : s.text;
    const seg = s.views
      ? `<div class="seg mini tour-seg" role="group" aria-label="${escapeHtml(s.title)}">${s.views
          .map((v, j) => `<button data-tour-view="${j}" class="${j === this.v ? "on" : ""}" aria-pressed="${j === this.v}">${v.label}</button>`)
          .join("")}</div>`
      : "";
    const next = k === 0 && this.v === 0 && !show ? "Show me" : last ? "Done" : "Next";
    this.card.innerHTML =
      (show ? "" : `<div class="tour-step">${k + 1} of ${this.steps.length}</div>`) +
      `<div class="tour-title">${s.title}</div>${seg}<div class="tour-text">${text}</div>` +
      `<div class="tour-actions">${show ? "" : `<button class="rv-btn" data-tour-skip>${last ? "Close" : "Skip"}</button>`}` +
      // the last step points at the tips (GuideSpec decision 1)
      (last && !show ? `<button class="rv-btn" data-tour-tips>Tips</button>` : "") +
      `<span class="tour-gap"></span>` +
      (k > 0 || this.v > 0 ? `<button class="rv-btn" data-tour-back>Back</button>` : "") +
      `<button class="rv-btn primary" data-tour-next>${next}</button></div>`;
    // the panel slides in: place again once it has
    this.place();
    setTimeout(() => this.place(), 360);
    this.card.querySelector<HTMLElement>("[data-tour-next]")?.focus();
  }

  /** Light up the step's place and put the card beside it, where there is room. */
  private place(): void {
    const s = this.steps[this.k];
    if (!s) return;
    const r = (s.views ? s.views[this.v].at : s.at)?.() ?? null;
    const pad = 6;
    const card = this.card;
    const w = card.offsetWidth, h = card.offsetHeight;
    this.spot.classList.toggle("none", !r);
    // the hole the shade leaves: the place, with a little room; nothing for a step in the middle
    const W = innerWidth, H = innerHeight;
    const hole = r ? { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad } : { l: W / 2, t: H / 2, r: W / 2, b: H / 2 };
    const rect = (el: HTMLElement, l: number, t: number, w2: number, h2: number) =>
      Object.assign(el.style, { left: `${l}px`, top: `${t}px`, width: `${Math.max(0, w2)}px`, height: `${Math.max(0, h2)}px` });
    rect(this.shades[0], 0, 0, W, hole.t);
    rect(this.shades[1], 0, hole.b, W, H - hole.b);
    rect(this.shades[2], 0, hole.t, hole.l, hole.b - hole.t);
    rect(this.shades[3], hole.r, hole.t, W - hole.r, hole.b - hole.t);
    rect(this.spot, hole.l, hole.t, hole.r - hole.l, hole.b - hole.t);
    if (!r) {
      card.style.transform = `translate(${Math.round((innerWidth - w) / 2)}px, ${Math.round((innerHeight - h) / 2)}px)`;
      return;
    }
    const gap = 14;
    const room = { below: innerHeight - r.bottom, above: r.top, right: innerWidth - r.right, left: r.left };
    let x: number, y: number;
    if (room.below >= h + gap + pad) [x, y] = [r.left, r.bottom + gap + pad];
    else if (room.above >= h + gap + pad) [x, y] = [r.left, r.top - h - gap - pad];
    else if (room.left >= w + gap + pad) [x, y] = [r.left - w - gap - pad, r.top];
    else if (room.right >= w + gap + pad) [x, y] = [r.right + gap + pad, r.top];
    // a large place (the map): the card inside it, at its bottom left, where it covers the least of
    // what is lit around the theorem in the middle
    else [x, y] = [r.left + 24, r.bottom - h - 24];
    x = Math.max(12, Math.min(x, innerWidth - w - 12));
    y = Math.max(12, Math.min(y, innerHeight - h - 12));
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  stop(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    if (this.kind === "tour") {
      this.store.data.guided = true;
      this.store.save();
      // the page as the tour found it (GuideSpec decision 3)
      this.hooks.back(this.placeBefore);
      this.hooks.ended();
    } else this.hooks.record();
    this.placeBefore = null;
  }

  // ---------------------------------------------------------------- What's new

  /** The server's event stream said which release it runs (UpdateSpec): What's new is said once when
   *  it is newer than the one this browser saw last (GuideSpec decision 11). */
  serverIs(version: string): void {
    this.running = version;
    if (this.hooks.snapshot()) return;
    const was = this.tips.meet(version);
    if (was === null) return;
    this.news.innerHTML = `<button class="news-open">What's new in ${escapeHtml(version)}</button><button class="icon" data-news-close title="Close" aria-label="Close">✕</button>`;
    this.news.hidden = false;
    setTimeout(() => (this.news.hidden = true), 15_000);
  }

  // ---------------------------------------------------------------- the sheet

  /** What the editor link is now, in a sentence. */
  private editorNow(): string {
    const { server, mine } = this.hooks.editor();
    const code = (t: string) => `<code>${escapeHtml(t)}</code>`;
    if (mine) return `Yours, kept in this browser. Leave the field empty ${server ? `to use the server's: ${code(server)}` : "for no link"}.`;
    if (server) return `The server's. Yours, if you set one here, is kept in this browser and goes first.`;
    return (
      `None is set, so there is no link. VS Code on the server's machine: ${code("vscode://file/{path}:{line}:{col}")}; ` +
      `over SSH: ${code("vscode://vscode-remote/ssh-remote+HOST{path}:{line}")}.`
    );
  }

  /** Which VisualProof the server runs, and what it says of a newer one (GuideSpec decision 13). */
  private aboutTool(u: UpdateStatus | null): string {
    const running = u?.running ?? this.running;
    const repo = `<a class="help-repo" href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO.replace("https://", "")}</a>`;
    let html = running ? `VisualProof ${escapeHtml(running)}${u?.installed && u.installed !== running ? ` (installed: ${escapeHtml(u.installed)})` : ""}. ` : "";
    html += `Open source: its documentation, its code and its issues are at ${repo}.`;
    const n = u?.newer;
    if (n && u?.mode !== "off") {
      // the server's word, shown as text; its release notes linked only where they are an https address
      const notes = /^https:\/\/[^\s"'<>]+$/.test(n.notes) ? `<a href="${escapeHtml(n.notes)}" target="_blank" rel="noopener noreferrer">what is new in it</a>` : "its notes on GitHub";
      html += `<div class="help-update">${escapeHtml(n.version)} is out (${notes}): ${n.taken ? "this server takes it by itself, at a quiet moment." : n.command ? `<code>${escapeHtml(n.command)}</code> on the server takes it.` : "the server's owner takes it."}</div>`;
    }
    return html;
  }

  openHelp(tab: "tips" | "keys" = this.tab, tipId?: string): void {
    const { server, mine } = this.hooks.editor();
    // a phone: the fingers, not the keys; no editor on it to open a declaration in
    const phone = isPhone();
    const keysTab = phone ? "Gestures" : "Keys";
    this.tab = tab;
    // a tip asked for by its ⓘ shows, whatever the filter was
    if (tipId) this.filter = "";
    this.help.innerHTML =
      `<div class="modal-box glass help-box${phone ? " help-touch" : ""}" role="dialog" aria-label="Help" tabindex="-1">` +
      `<div class="help-head"><div class="seg help-tabs" role="tablist" aria-label="Help">` +
      `<button role="tab" data-help-tab="tips">Tips</button><button role="tab" data-help-tab="keys">${keysTab}</button></div>` +
      `<button class="icon" data-help-close title="Close (Esc)">✕</button></div>` +
      `<div class="help-pane" data-help-pane="tips" role="tabpanel">` +
      `<input class="help-input tips-filter" data-tips-filter type="search" placeholder="Find a tip" value="${escapeHtml(this.filter)}" spellcheck="false" autocomplete="off" aria-label="Find a tip">` +
      `<div class="tips-list" data-tips-list></div>` +
      (this.hooks.snapshot() ? "" : `<label class="help-note tips-off"><input type="checkbox" data-tips-off${this.tips.off ? "" : " checked"}> Show a tip beside a control when it helps, now and then</label>`) +
      `</div>` +
      `<div class="help-pane" data-help-pane="keys" role="tabpanel" hidden>` +
      `<div class="help-grid">${(phone ? TOUCH : KEYS).map(
        ([group, rows]) =>
          `<div class="help-group"><div class="help-h">${group}</div>${rows
            .map(
              (r) =>
                `<div class="help-row"><span class="help-k">${(r.k ?? []).map((x) => `<kbd>${escapeHtml(x)}</kbd>`).join(" ")}${r.k && r.g ? " " : ""}${r.g ? `<span class="help-g">${escapeHtml(r.g)}</span>` : ""}</span><span>${escapeHtml(r.what)}</span></div>`,
            )
            .join("")}</div>`,
      ).join("")}</div>` +
      (phone ? "" : `<div class="help-editor"><div class="help-h">Open in editor</div>` +
      `<div class="help-note">A link from the panel and the source window to the declaration in your editor. ` +
      `<code>{path}</code> is the file on the server, <code>{rel}</code> the file in the project, <code>{line}</code> and <code>{col}</code> where it starts.</div>` +
      `<input class="help-input" data-help-editor value="${escapeHtml(mine ?? "")}" placeholder="${escapeHtml(server ?? "vscode://file/{path}:{line}:{col}")}" spellcheck="false" autocomplete="off" aria-label="Open in editor: URL template">` +
      `<div class="modal-err" data-help-editor-err hidden></div>` +
      `<div class="help-note" data-help-editor-now>${this.editorNow()}</div></div>`) +
      `<div class="help-about"><div class="help-h">About ${escapeHtml(this.hooks.project())}</div>` +
      `<div class="help-note">${escapeHtml(this.hooks.about())}</div></div>` +
      // which VisualProof, and where it is: its documentation, its code, where an issue is reported
      `<div class="help-about"><div class="help-h">About VisualProof</div>` +
      `<div class="help-note" data-help-tool>${this.aboutTool(null)}</div></div>` +
      `</div>` +
      `<div class="modal-actions"><button class="rv-btn" data-help-tour>Take the tour again</button><button class="rv-btn primary" data-help-close>Close</button></div></div>`;
    this.help.hidden = false;
    const box = this.help.querySelector<HTMLElement>(".help-box")!;
    this.player = new ClipPlayer(this.help.querySelector<HTMLElement>("[data-tips-list]")!, box);
    this.showTab(tab);
    box.focus();
    void this.hooks.updates().then((u) => {
      const el = this.help.querySelector<HTMLElement>("[data-help-tool]");
      if (u && el && !this.help.hidden) el.innerHTML = this.aboutTool(u);
    });
    // the clips the server has, read once: until then, and without them, the tips are their words
    if (!this.clipsHad)
      void this.hooks.clips().then((c) => {
        this.clipsHad = c;
        if (c.size && !this.help.hidden && this.tab === "tips") this.renderCards();
      });
    if (tipId) {
      const card = this.help.querySelector<HTMLElement>(`[data-tip="${CSS.escape(tipId)}"]`);
      if (card) {
        card.scrollIntoView({ block: "center" });
        card.classList.add("flash");
      }
    }
  }

  private showTab(tab: "tips" | "keys"): void {
    this.tab = tab;
    for (const b of this.help.querySelectorAll<HTMLElement>("[data-help-tab]")) {
      const on = b.dataset.helpTab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
    for (const p of this.help.querySelectorAll<HTMLElement>("[data-help-pane]")) p.hidden = p.dataset.helpPane !== tab;
    // Tips looked at: what is New stays marked while the sheet shows, and is not the next time
    if (tab === "tips" && this.newShown === undefined) {
      this.newShown = this.tips.newSince;
      this.tips.newLooked();
    }
    if (tab === "tips") this.renderCards();
    else this.player?.stop();
  }

  /** The cards as the filter has them; New marked until Tips has been looked at. */
  private renderCards(): void {
    const list = this.help.querySelector<HTMLElement>("[data-tips-list]");
    if (!list) return;
    list.innerHTML = cardsHtml(this.context(this.clipsHad ?? new Set()), this.filter);
    this.player?.start();
  }

  closeHelp(): void {
    // the editor's field lets go of the focus now, not at the next frame: a key pressed right after
    // Esc is a shortcut again, not text typed into a field no one sees
    if (this.help.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.player?.stop();
    this.player = null;
    this.newShown = undefined;
    this.help.hidden = true;
  }

  toggleHelp(): void {
    if (this.help.hidden) this.openHelp();
    else this.closeHelp();
  }
}
