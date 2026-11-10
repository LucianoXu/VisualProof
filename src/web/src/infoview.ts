// The InfoView (ReviewSpec, "The InfoView"; the owner's decisions of 2026-11-01): a pane of the
// source window that shows what Lean says at the caret, as Lean's own InfoView does in an editor —
// the goals before the tactic there (after it, at the reader's asking), and the expected type of the
// term there — live from Lean's language server (server/hover.ts, `goals`), which elaborates the
// whole file. It stands right of the code, and below it in a narrow window and on a phone, and shows
// while the caret is in a proof, a `by` block or a term with an expected type; elsewhere it is
// hidden, and the reader may hide it (kept in the browser, the reader's own). Beside the code, its
// width is the reader's too (the owner's decision of 2026-11-10): its left edge dragged, kept in the
// browser for every window, a double-click on it giving it its own width again. A click in the code, or
// the keyboard's caret, puts the caret there; ↑ and ↓ step from tactic to tactic, the pane following.
// In File mode, a file window's too, it is about the whole file (the owner's decisions of
// 2026-11-01, and of 2026-11-08 for 0.11): a caret anywhere in it is a place of the file, ↑ and ↓
// step on through it, and a caret goes as the window turns to another file, of which it would be a
// place nobody clicked.
//
// The goals are drawn as the window draws code: Lean's highlighting, the names linked to the board,
// a card for each (web/src/hovercards.ts, nesting as in the source). Lean's interactive goals tag
// each subterm, whose type a card shows on hover, asked by the number the answer gives it. A widget
// is never drawn — its JavaScript is the project's code, which would run in every reader's browser
// (SECURITY.md) —: the pane says one is there.
//
// The caret is followed (CollabSpec, "Surfaces": `caret`): one reader steps through a proof while
// those following them watch. A follower's clicks in the code are reading then, as selecting text
// is; ↑ or ↓, or Before and After, end following, as a change to a followed part does.
//
// There is no Lean on a past build, in a snapshot of the page, nor for a file changed since it was
// compiled: the pane says why. This is the pane's logic and drawing, apart from the window
// (web/src/sourcewin.ts), which tells it the code on show and where the caret goes; its drawing is
// pure functions, tested without a browser (test/infoview.test.ts).

import type { Goal, GoalsAnswer, Hyp, SubtermInfo, Tagged } from "../../shared/goals.ts";
import { stepLine } from "../../shared/goals.ts";
import { escapeHtml, highlightLean, renderDoc } from "./highlight.ts";
import type { Card, HoverCards } from "./hovercards.ts";

/** Where the caret is: a line of the file (from 0) and a UTF-16 column, as Lean counts; and whether
 *  the goals after the tactic are on show. */
export interface Caret {
  line: number;
  ch: number;
  after: boolean;
}

/** The code a window shows, as the pane is told it: its module, the line of the file it starts at
 *  (from 0), its text, the Lake hash of the file's text; and why Lean is not asked about it, or
 *  null where it is. */
export interface InfoCode {
  module: string;
  start: number;
  text: string;
  hash: string;
  off: string | null;
}

export interface InfoHooks {
  /** what Lean says at a place of the file (server/hover.ts, `goals`); null where there is no Lean */
  goals(module: string, line: number, ch: number, hash: string): Promise<GoalsAnswer | null>;
  /** what subterm `k` of the answer at that place is */
  subterm(module: string, line: number, ch: number, hash: string, k: number): Promise<SubtermInfo | null>;
  /** how a name of the goals resolves, as the names of the code on show do */
  resolve(word: string): string | null;
  /** the window's cards, and the card for a declaration's name (the graph's at once, Lean's when it
   *  comes) */
  cards: HoverCards;
  card(name: string): Card;
  /** the pane hidden by the reader, in every window (kept in the browser), and hiding it */
  hidden(): boolean;
  hide(on: boolean): void;
  /** the pane's width beside the code as the reader set it, in every window (kept in the browser),
   *  and setting it (null: its own, PANE_W) */
  width(): number | null;
  setWidth(w: number | null): void;
  /** the reader moved the caret or turned to the goals before or after: those following see it */
  moved(): void;
  /** the window holding the pane, and whether it is fitted to its content (it grows with the pane
   *  beside the code) */
  win(): HTMLElement;
  fitted(): boolean;
  /** the file is not the text on show any more: the window reads it again */
  stale(): void;
  /** the caret stepped or followed to (line, ch) of the file: the window shows that place before it
   *  is scrolled to (in File mode, a folded proof holding it opened) */
  reveal?(line: number, ch: number): void;
}

/** how long Lean is waited for before the pane says it asks, and how often a place Lean has not
 *  reached yet is asked again */
const SLOW_MS = 300;
const AGAIN_MS = 900;
/** a window at least this wide has the pane beside its code; a window fitted to its code grows to
 *  make room for it from FITTED_MIN, where the screen is at least SCREEN_MIN wide */
export const SIDE_MIN = 700;
const FITTED_MIN = 540;
const SCREEN_MIN = 1000;

/** the pane's own width beside the code, in pixels, and the least the reader may make it; and the
 *  least the code keeps beside it, which the reader's width gives way to in a narrower window */
export const PANE_W = 360;
export const PANE_MIN = 240;
export const CODE_MIN = 300;

/** The pane's width beside the code: the reader's (`want`; null, its own), at least PANE_MIN, and
 *  leaving the code CODE_MIN of the `room` the two may share — the window's width, or for a window
 *  fitted to its code the most it may grow to — where that leaves the pane PANE_MIN; whole pixels. */
export function paneWidth(want: number | null, room: number): number {
  const w = want !== null && Number.isFinite(want) ? want : PANE_W;
  return Math.round(Math.max(PANE_MIN, Math.min(w, room - CODE_MIN)));
}

/** Whether the pane stands beside the code rather than below it. */
export function paneSide(winWidth: number, fitted: boolean, screenWidth: number): boolean {
  if (screenWidth < SCREEN_MIN && winWidth < SIDE_MIN) return false;
  return winWidth >= (fitted && screenWidth >= SCREEN_MIN ? FITTED_MIN : SIDE_MIN);
}

/** A place of `text` (an offset in it) as its line and column, from 0. */
export function caretOf(text: string, offset: number): { line: number; ch: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const nl = before.lastIndexOf("\n");
  return { line: before.split("\n").length - 1, ch: before.length - (nl + 1) };
}

/** A place of a block of the code on show — an offset in its text, the block starting at line
 *  `start` of the file — as the file's line and column, where Lean is asked: the block is the
 *  declaration's lines in Declaration mode, one of the file's pieces in File mode, so that a caret
 *  anywhere in the file is a place of the file (the owner's decisions of 2026-11-08, 0.11). */
export function placeIn(start: number, text: string, offset: number): { line: number; ch: number } {
  const at = caretOf(text, offset);
  return { line: start + at.line, ch: at.ch };
}

/** The tagged text of a goal drawn: each piece highlighted as code, its names linked where
 *  `isRef` resolves them; each subterm a span Lean can say more of, by its number. */
export function taggedHtml(t: Tagged, isRef: (w: string) => string | null): string {
  if (typeof t === "string") return highlightLean(t, (w) => isRef(w));
  if (Array.isArray(t)) return t.map((x) => taggedHtml(x, isRef)).join("");
  return `<span class="iv-t${t.d ? ` iv-${t.d}` : ""}" data-k="${t.k}">${taggedHtml(t.t, isRef)}</span>`;
}

/** The names a goal binds, which are no declarations whatever the board holds. */
function locals(hyps: readonly Hyp[]): Set<string> {
  return new Set(hyps.flatMap((h) => h.names));
}

function hypHtml(h: Hyp, isRef: (w: string) => string | null): string {
  const d = h.d ? ` iv-${h.d}` : "";
  return (
    `<div class="iv-hyp${d}"><span class="iv-names">${h.names.map(escapeHtml).join(" ")}</span><span class="iv-colon"> : </span>` +
    `<span class="iv-type">${taggedHtml(h.type, isRef)}${h.val !== undefined ? `<span class="iv-colon"> := </span>${taggedHtml(h.val, isRef)}` : ""}</span></div>`
  );
}

/** One goal drawn: its case, its hypotheses, what it says after `⊢`. */
export function goalHtml(g: Goal, resolve: (w: string) => string | null): string {
  const own = locals(g.hyps);
  const isRef = (w: string) => (own.has(w) || own.has(w.split(".")[0]) ? null : resolve(w));
  const d = g.d ? ` iv-${g.d}` : "";
  return (
    `<div class="iv-goal${d}">` +
    (g.case ? `<div class="iv-case">case <b>${escapeHtml(g.case)}</b></div>` : "") +
    g.hyps.map((h) => hypHtml(h, isRef)).join("") +
    `<div class="iv-target"><span class="iv-turn">${escapeHtml((g.prefix ?? "⊢ ").trim())}</span> ${taggedHtml(g.type, isRef)}</div></div>`
  );
}

/** What the pane shows for the caret: nothing (hidden), or its body. */
export interface PaneView {
  show: boolean;
  /** the goals before and after can be switched between */
  sides: boolean;
  html: string;
}

/** What the pane shows, from what is known at the caret (the pane's state, apart from the page):
 *  hidden without a caret, and where Lean has nothing there (no tactic state, no expected type, no
 *  widget); else why there is no answer, how far Lean is, or the goals and the expected type. */
export function paneView(caret: Caret | null, off: string | null, answer: GoalsAnswer | null, resolve: (w: string) => string | null): PaneView {
  const say = (cls: string, text: string): PaneView => ({ show: true, sides: false, html: `<p class="${cls}">${escapeHtml(text)}</p>` });
  if (!caret) return { show: false, sides: false, html: "" };
  if (off) return say("iv-off", off);
  if (!answer) return say("iv-wait", "Asking Lean…");
  if (answer.off) return say("iv-off", answer.off);
  if (answer.pending) return say("iv-wait", `Lean has elaborated line ${answer.pending.line.toLocaleString("en")} of ${answer.pending.of.toLocaleString("en")}…`);
  if (answer.error) return say("iv-err", `Lean could not be asked: ${answer.error}`);
  const goals = caret.after ? answer.after : answer.before;
  const any = answer.before != null || answer.after != null;
  if (!any && !answer.term && !answer.widgets) return { show: false, sides: false, html: "" };
  let html = "";
  if (answer.widgets) html += `<p class="iv-widget" title="Its JavaScript is the project's own code: VisualProof never runs it in a reader's browser.">A widget here: open it in your editor.</p>`;
  if (any) {
    const n = goals?.length ?? 0;
    html += `<div class="iv-h">${goals == null ? "No tactic state here" : n === 0 ? "No goals" : n === 1 ? "1 goal" : `${n} goals`}</div>`;
    // after a tactic that holds a proof of its own: the state the proof goes on from
    if (caret.after && answer.afterFrom !== undefined && goals)
      html += `<p class="iv-note" title="The tactic holds a proof of its own, which ends inside it: these are the goals after the whole line, where the proof goes on">As line ${answer.afterFrom + 1} begins, after the whole line</p>`;
    html += (goals ?? []).map((g) => goalHtml(g, resolve)).join("");
  }
  if (answer.term) {
    html += `<div class="iv-h">Expected type</div>`;
    // the hypotheses in scope repeat the goal's where there is one
    html += goalHtml({ hyps: goals?.length ? [] : answer.term.hyps, type: answer.term.type }, resolve);
  }
  return { show: true, sides: any, html };
}

/** The pane's head: what it shows, where, before or after the tactic, and the reader's hide. */
function headHtml(caret: Caret, sides: boolean, interactive: boolean): string {
  const seg = sides
    ? `<span class="iv-seg" role="group" aria-label="The goals before or after the tactic">` +
      `<button type="button" data-iv-when="before" aria-pressed="${!caret.after}" title="The goals before the tactic at the caret">Before</button>` +
      `<button type="button" data-iv-when="after" aria-pressed="${caret.after}" title="The goals after it">After</button></span>`
    : "";
  return (
    `<div class="iv-head"><span class="iv-title">InfoView</span><span class="iv-where" title="${interactive ? "Hover a subterm for its type" : ""}">line ${caret.line + 1}, column ${caret.ch + 1}</span>${seg}` +
    `<button type="button" class="icon iv-hide" data-iv-hide aria-label="Hide the InfoView" title="Hide the InfoView in every source window (kept in this browser)">${HIDE}</button></div>`
  );
}

const HIDE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>`;
/** the pane's left edge beside the code, which a drag widens or narrows (web/style.css: shown only
 *  there); the pointer's alone, as the page's other splitters are (web/src/monitor.ts) */
const GRIP = `<div class="iv-grip" aria-hidden="true" title="Drag to widen or narrow the InfoView; double-click for its own width"></div>`;

export class InfoView {
  private hooks: InfoHooks;
  private code: InfoCode | null = null;
  caret: Caret | null = null;
  private answer: GoalsAnswer | null = null;
  /** bumped at each new question, so that a slow answer to an earlier one is dropped */
  private turn = 0;
  private pane: HTMLElement | null = null;
  /** a line of the file in the code on show: the code's element, or the window's way of finding
   *  one (File mode's pieces, drawn as they are reached) */
  private lines: HTMLElement | ((line: number) => HTMLElement | null) | null = null;
  private again: ReturnType<typeof setTimeout> | null = null;
  private slow: ReturnType<typeof setTimeout> | null = null;
  /** the subterm the pointer rests on, and the wait before its card */
  private hot: HTMLElement | null = null;
  private hoverWait: ReturnType<typeof setTimeout> | null = null;
  private hoverTurn = 0;
  private sizer: ResizeObserver | null = null;
  /** the last press in the pane was on its grip, beside the code */
  private onGrip = false;

  constructor(hooks: InfoHooks) {
    this.hooks = hooks;
  }

  /** The window drew its frame: the pane's element in it, the code's element — or how the element of
   *  a line of the file is found (File mode, the owner's decision of 2026-11-01: the whole file, in
   *  pieces) —, and the code on show (null: none). A caret outside the code on show goes. */
  attach(pane: HTMLElement | null, lines: HTMLElement | ((line: number) => HTMLElement | null) | null, code: InfoCode | null): void {
    const was = this.code;
    this.code = code;
    this.lines = lines;
    if (this.pane !== pane) {
      this.pane = pane;
      if (pane) this.listen(pane);
    }
    const same = !!was && !!code && was.module === code.module && was.hash === code.hash;
    if (!same) this.answer = null;
    // a caret is a place of one file: in another file's code it would be another place, never clicked
    if (this.caret && ((was && code && was.module !== code.module) || !this.holds(this.caret.line))) this.caret = null;
    this.watchSize();
    if (this.caret && !same) this.ask();
    else this.draw();
  }

  /** The window turns to the file of `module` (another declaration's, another file in File mode),
   *  whose code it reads: a caret in the file on show goes with it — a place of one file is another
   *  place of the next, which nobody clicked —, and nothing is asked until the window tells the new
   *  code (`attach`). A followed reader's caret told meanwhile waits for that code. Nobody is told: the
   *  reader did not move it. */
  leave(module: string): void {
    const c = this.code;
    if (!c || c.module === module) return;
    this.code = null;
    this.answer = null;
    this.turn++;
    this.stopWaits();
    if (this.caret) {
      this.caret = null;
      this.draw();
    }
  }

  /** The element of line `line` of the file in the code on show, or null. */
  private lineEl(line: number): HTMLElement | null {
    const c = this.code, l = this.lines;
    if (!c || !l) return null;
    return typeof l === "function" ? l(line) : (l.querySelectorAll<HTMLElement>(".ln")[line - c.start] ?? null);
  }

  /** Whether line `line` of the file is in the code on show. */
  private holds(line: number): boolean {
    const c = this.code;
    return !!c && line >= c.start && line < c.start + c.text.split("\n").length;
  }

  /** The caret put at (line, ch) of the file by the reader: a click, the keyboard's caret. */
  place(line: number, ch: number): void {
    if (!this.holds(line)) return;
    const after = this.caret?.after ?? false;
    if (this.caret && this.caret.line === line && this.caret.ch === ch) return;
    this.caret = { line, ch, after };
    this.ask();
    this.hooks.moved();
  }

  /** ↑ or ↓: the caret to the previous or next line of code, where its code starts, the line
   *  scrolled into sight. False where there is nothing to step to. */
  step(dir: 1 | -1): boolean {
    const c = this.code, k = this.caret;
    if (!c || !k) return false;
    const to = stepLine(c.text, k.line - c.start, dir);
    if (!to) return false;
    this.caret = { line: c.start + to.line, ch: to.ch, after: k.after };
    this.ask();
    this.hooks.moved();
    this.show(this.caret);
    return true;
  }

  /** The caret as a followed reader's is (CollabSpec, "Surfaces"), or none: nobody is told. */
  follow(c: Caret | null): void {
    const k = this.caret;
    if (!c) return void (k && this.clear());
    if (k && k.line === c.line && k.ch === c.ch && k.after === c.after) return;
    const moved = !k || k.line !== c.line || k.ch !== c.ch;
    this.caret = { ...c };
    if (!this.code) return;
    if (!this.holds(c.line)) return;
    if (moved) {
      this.ask();
      this.show(c);
    } else this.draw();
  }

  /** The caret's place shown, stepped or followed to: what the window hides of it shown (a folded
   *  proof), its line scrolled into sight — clear of what stands over the code's edges, File mode's
   *  sticky header and the pane below the code (`scroll-padding`, web/style.css). */
  private show(c: { line: number; ch: number }): void {
    this.hooks.reveal?.(c.line, c.ch);
    this.lineEl(c.line)?.scrollIntoView({ block: "nearest" });
  }

  /** No caret here any more: another window holds the page's. */
  clear(): void {
    if (!this.caret) return;
    this.caret = null;
    this.turn++;
    this.stopWaits();
    this.draw();
  }

  /** The window goes. */
  dispose(): void {
    this.turn++;
    this.stopWaits();
    this.sizer?.disconnect();
    this.sizer = null;
    this.pane = null;
    this.lines = null;
  }

  private stopWaits(): void {
    if (this.again) clearTimeout(this.again);
    if (this.slow) clearTimeout(this.slow);
    if (this.hoverWait) clearTimeout(this.hoverWait);
    this.again = this.slow = this.hoverWait = null;
  }

  /** Lean asked what is at the caret; until it answers, the pane shows what it showed, and after a
   *  moment that it asks. A place Lean has not reached yet is asked again until it has, the pane
   *  saying how far Lean is meanwhile. */
  private ask(again = false): void {
    const c = this.code, k = this.caret;
    this.stopWaits();
    const turn = ++this.turn;
    if (!c || !k || c.off) {
      this.answer = null;
      return this.draw();
    }
    // what the pane showed stays a moment, the caret's line marked at once; asked again, how far
    // Lean is stays until it says more
    if (!again)
      this.slow = setTimeout(() => {
        if (turn !== this.turn) return;
        this.answer = null;
        this.draw();
      }, SLOW_MS);
    this.marks();
    void this.hooks.goals(c.module, k.line, k.ch, c.hash).then((a) => {
      if (turn !== this.turn) return;
      if (this.slow) clearTimeout(this.slow);
      this.slow = null;
      if (a?.stale) return this.hooks.stale();
      this.answer = a ?? { off: "There is no Lean to ask here." };
      this.draw();
      if (a?.pending) this.again = setTimeout(() => turn === this.turn && this.ask(true), AGAIN_MS);
    });
  }

  /** The pane drawn again as it stands, and the caret's line and tactic marked in the code. */
  draw(): void {
    this.marks();
    const pane = this.pane;
    if (!pane) return;
    const k = this.caret;
    const split = pane.parentElement;
    const v = paneView(k, this.code?.off ?? null, this.answer, (w) => this.hooks.resolve(w));
    const hidden = this.hooks.hidden();
    const focused = document.activeElement;
    pane.hidden = !v.show || hidden;
    split?.classList.toggle("iv-on", v.show && !hidden);
    // hidden by the reader: a tab at the code's top right shows it again — in File mode in the sticky
    // header over the code, in sight wherever in the file the reader is (the owner's decisions of
    // 2026-11-08, 0.11), the top of the whole file being mostly far above
    const bar = split?.parentElement?.querySelector<HTMLElement>(":scope > .sw-sticky") ?? null;
    const home = bar ?? split;
    let tab = home?.querySelector<HTMLButtonElement>(":scope > .iv-show") ?? null;
    if (v.show && hidden && home) {
      if (!tab) {
        tab = document.createElement("button");
        tab.type = "button";
        tab.className = "iv-show";
        tab.dataset.ivShow = "";
        tab.title = "Show the InfoView: what Lean says at the caret (kept in this browser)";
        tab.innerHTML = `<span aria-hidden="true">⊢</span> Lean`;
        tab.addEventListener("click", () => this.hooks.hide(false));
        if (bar) bar.append(tab);
        else home.prepend(tab);
      }
    } else tab?.remove();
    // the focus stays where it was: on Before or After, else in the window, whose keys step the caret
    const had = focused instanceof HTMLElement && (pane.contains(focused) || focused.matches("[data-iv-show]")) ? focused : null;
    const when = had?.closest<HTMLElement>("[data-iv-when]")?.dataset.ivWhen;
    if (!v.show || hidden || !k) {
      if (had) this.hooks.win().focus({ preventScroll: true });
      return this.below();
    }
    pane.innerHTML = GRIP + headHtml(k, v.sides, !!this.answer?.interactive) + `<div class="iv-body">${v.html}</div>`;
    pane.setAttribute("aria-label", "What Lean says at the caret");
    if (had && !had.isConnected) (pane.querySelector<HTMLElement>(`[data-iv-when="${when}"]`) ?? this.hooks.win()).focus({ preventScroll: true });
    this.below();
  }

  /** How much of the code's view the pane below the code stands over, so that a line the caret
   *  steps to is scrolled clear of it (`--iv-below`, web/style.css); none beside the code. */
  private below(): void {
    const pane = this.pane;
    const split = pane?.parentElement;
    const scroll = split?.closest<HTMLElement>(".sw-scroll");
    if (!pane || !split || !scroll) return;
    scroll.style.setProperty("--iv-below", `${!pane.hidden && !split.classList.contains("iv-side") ? pane.offsetHeight : 0}px`);
  }

  /** The caret's line marked in the code, and its tactic, where the browser can (the CSS Custom
   *  Highlight API): marks the code keeps however often it is drawn again. */
  marks(): void {
    const c = this.code, k = this.caret;
    for (const l of this.hooks.win().querySelectorAll(".ln.ln-caret")) l.classList.remove("ln-caret");
    const hl = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const Hl = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!c || !k || !this.holds(k.line)) return;
    const ln = this.lineEl(k.line);
    ln?.classList.add("ln-caret");
    // the tactic, where Lean has a tactic state there: elsewhere the line is no tactic's
    const a = this.answer;
    const t = a && (a.before || a.after) ? a.tactic : null;
    if (!hl || !Hl || !ln) return;
    if (!t || t.line !== k.line || t.to <= t.from) return void hl.delete("vp-tactic");
    const r = rangeIn(ln, t.from, t.to);
    if (r) hl.set("vp-tactic", new Hl(r));
  }

  /** The pane's own controls and hover: before or after, hide and show, a subterm's card. */
  private listen(pane: HTMLElement): void {
    const split = pane.parentElement;
    // (the tab that shows it again, hidden, has its own: it may stand outside, in File mode's header)
    split?.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (!pane.contains(t)) return;
      if (t.closest("[data-iv-hide]")) return this.hooks.hide(true);
      const when = t.closest<HTMLElement>("[data-iv-when]")?.dataset.ivWhen;
      if (when && this.caret && this.caret.after !== (when === "after")) {
        this.caret = { ...this.caret, after: when === "after" };
        this.draw();
        this.hooks.moved();
      }
    });
    pane.addEventListener("pointerdown", (e) => {
      this.onGrip = !!split?.classList.contains("iv-side") && !!(e.target as HTMLElement).closest(".iv-grip");
      if (this.onGrip) this.drag(e);
    });
    // (the grip holds the pointer while pressed: the double-click is the pane's, pressed on the grip)
    pane.addEventListener("dblclick", () => {
      if (this.onGrip) this.hooks.setWidth(null);
    });
    pane.addEventListener("mousemove", (e) => {
      if (e.buttons) return;
      const t = e.target as HTMLElement;
      const sub = this.answer?.interactive ? t.closest<HTMLElement>(".iv-t") : null;
      const ref = t.closest<HTMLElement>("[data-ref]");
      const on = sub ?? ref;
      if (this.hoverWait) clearTimeout(this.hoverWait);
      if (!on || !pane.contains(on)) {
        this.heat(null);
        return this.hooks.cards.leave();
      }
      if (on === this.hot && this.hooks.cards.open) return;
      this.hoverWait = setTimeout(() => this.hover(on), 150);
    });
    pane.addEventListener("mouseleave", () => {
      if (this.hoverWait) clearTimeout(this.hoverWait);
      this.heat(null);
      this.hooks.cards.leave();
    });
  }

  /** The subterm the pointer rests on, outlined. */
  private heat(el: HTMLElement | null): void {
    if (this.hot === el) return;
    this.hot?.classList.remove("iv-hot");
    this.hot = el;
    el?.classList.add("iv-hot");
  }

  /** A card for what the pointer rests on in the pane: a subterm's type and doc, as Lean says them;
   *  a name's card, as in the code, where Lean's goals are plain. */
  private async hover(on: HTMLElement): Promise<void> {
    const turn = ++this.hoverTurn;
    this.heat(on.matches(".iv-t") ? on : null);
    const box = on.getBoundingClientRect();
    const k = on.dataset.k;
    const c = this.code, caret = this.caret;
    if (k === undefined || !c || !caret) {
      const name = on.dataset.ref;
      if (!name) return;
      const card = this.hooks.card(name);
      this.hooks.cards.show(card.html ?? `<pre class="code">${escapeHtml(name)}</pre><div class="sw-tip-wait">Asking Lean…</div>`, box, name);
      void card.more?.then((html) => {
        if (turn === this.hoverTurn && html) this.hooks.cards.show(html, on.getBoundingClientRect(), name);
      });
      return;
    }
    const r = await this.hooks.subterm(c.module, caret.line, caret.ch, c.hash, Number(k));
    if (turn !== this.hoverTurn || !on.isConnected) return;
    if (!r || r.error || r.pending || r.stale || (!r.type && !r.expr)) return;
    this.hooks.cards.show(subtermHtml(r, (w) => this.hooks.resolve(w)), box);
  }

  /** A press on the pane's edge beside the code: dragged, the pane as wide as the pointer makes it,
   *  in this window as it moves and, let go, kept for every window (hooks.setWidth). Dragged left it
   *  widens, the code giving way, or the window growing where it is fitted to its code. */
  private drag(e: PointerEvent): void {
    const pane = this.pane;
    const split = pane?.parentElement;
    if (!pane || !split || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    // no text selected, no caret put down: the window still comes to the front (web/src/floatwin.ts)
    e.preventDefault();
    const x0 = e.clientX, w0 = pane.offsetWidth;
    let w = w0;
    pane.setPointerCapture(e.pointerId);
    split.classList.add("iv-sizing");
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      w = paneWidth(w0 + x0 - ev.clientX, this.room());
      pane.style.width = `${w}px`;
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      pane.removeEventListener("pointermove", move);
      pane.removeEventListener("pointerup", end);
      pane.removeEventListener("pointercancel", end);
      split.classList.remove("iv-sizing");
      if (w !== w0) this.hooks.setWidth(w);
    };
    pane.addEventListener("pointermove", move);
    pane.addEventListener("pointerup", end);
    pane.addEventListener("pointercancel", end);
  }

  /** The width the code and the pane beside it may share (paneWidth's `room`): the window's, or the
   *  most it may grow to where it is fitted to its code. */
  private room(): number {
    const split = this.pane?.parentElement;
    if (!split) return 0;
    const win = this.hooks.win();
    const max = this.hooks.fitted() ? parseFloat(getComputedStyle(win).maxWidth) : NaN;
    return split.clientWidth + (Number.isFinite(max) ? Math.max(0, max - win.offsetWidth) : 0);
  }

  /** The reader's width for the pane changed, in another window or this one: it takes it. */
  resized(): void {
    this.size();
  }

  /** Keep the pane beside the code where the window is wide enough, else below it, as wide there as
   *  the reader made it (paneWidth); and tell the pane how tall the window's scrolled view is, which
   *  it stays within. */
  private watchSize(): void {
    if (this.sizer || typeof ResizeObserver === "undefined") return this.size();
    this.sizer = new ResizeObserver(() => this.size());
    this.sizer.observe(this.hooks.win());
    this.size();
  }

  private size(): void {
    const split = this.pane?.parentElement;
    const scroll = split?.closest<HTMLElement>(".sw-scroll");
    if (!split || !scroll) return;
    const side = paneSide(this.hooks.win().offsetWidth, this.hooks.fitted(), document.documentElement.clientWidth || innerWidth);
    split.classList.toggle("iv-side", side);
    // below the code it takes no width of its own (web/style.css); while dragged, the drag's
    const pane = this.pane!;
    if (!side) pane.style.width = "";
    else if (!split.classList.contains("iv-sizing")) {
      const w = `${paneWidth(this.hooks.width(), this.room())}px`;
      if (pane.style.width !== w) pane.style.width = w;
    }
    scroll.style.setProperty("--sw-view", `${scroll.clientHeight}px`);
    this.below();
  }
}

/** A subterm's card: the term with its implicit arguments, its type, its constant's doc. */
export function subtermHtml(r: SubtermInfo, resolve: (w: string) => string | null): string {
  const isRef = (w: string) => resolve(w);
  const head = r.expr && r.type ? `${r.expr} : ${r.type}` : (r.type ?? r.expr ?? "");
  return `<pre class="code">${highlightLean(head, isRef)}</pre>${r.doc ? `<hr>${renderDoc(r.doc)}` : ""}`;
}

/** A range over characters `from`–`to` of the text in `el`. */
function rangeIn(el: HTMLElement, from: number, to: number): Range | null {
  const r = document.createRange();
  let acc = 0, started = false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (!started && from < acc + len) {
      r.setStart(n, from - acc);
      started = true;
    }
    if (started && to <= acc + len) {
      r.setEnd(n, to - acc);
      return r;
    }
    acc += len;
  }
  return null;
}
