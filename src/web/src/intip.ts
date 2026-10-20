// Tips in place (GuideSpec decision 9), as TipKit shows them: one small card at the control a tip is
// about, when the reader is about to need it, by a rule of its own (a tip's or a film chapter's
// `when`, web/src/tips.ts, where each rule is said in full); a chapter's card opens the film at it. At most one in a page's session, and none in the session of a
// tour, while the sheet shows, while following someone, or in a snapshot. Got it ends it for good,
// and so does doing what it teaches (`did`); left unanswered — a press elsewhere, Esc, 15 seconds —
// it goes and may come once more in a later session, after which it is done. The reader turns them
// off in the sheet.

import { escapeHtml } from "./highlight.ts";
import { isPhone } from "./phone.ts";
import { TIPS, TOUR } from "./tips.ts";
import type { Tip } from "./tips.ts";
import type { TipState } from "./tipstate.ts";

/** The rules: where each shows its tip, on a larger screen and on a phone (decision 9: at most
 *  eight). The page says when (web/src/page.ts, `offerTip`). */
export const RULES: Record<string, { at: string; phone?: string }> = {
  "selection-replace": { at: "#lightup [data-mode=plain]" },
  "tcb-first": { at: "#rests-steps [data-mode=tcb]", phone: "#panel .p-tcb" },
  "rests-only-tcb": { at: "#rests-steps" },
  "key-in-target": { at: "#panel [data-rv-key]" },
  "stale-opinion": { at: "#panel [data-rv-changes]" },
  "share-twice": { at: "#share-pop [data-tab=readonly]" },
  "first-export": { at: "#linear" },
  "first-time-machine": { at: "#tmbar" },
};

/** What a rule shows in place: a tip, or a chapter of the film. `key` is what it is kept as done
 *  under (a chapter's: `tour-<id>`). */
export interface InPlace {
  key: string;
  title: string;
  text: string;
  showMe?: string;
  tip?: Tip;
  chapter?: string;
}

/** The tip or the chapter a rule shows. */
export function inPlaceOf(rule: string): InPlace | null {
  const t = TIPS.find((x) => x.when === rule);
  if (t) return { key: t.id, title: t.title, text: t.text, showMe: t.showMe, tip: t };
  const c = TOUR.find((x) => x.when === rule);
  return c ? { key: `tour-${c.id}`, title: c.title, text: c.text, showMe: c.showMe, chapter: c.id } : null;
}

/** how long an unanswered tip stays */
const STAYS_MS = 15_000;
/** how long after its moment a tip shows: what triggered it has settled (a panel slid in) */
const SETTLE_MS = 600;

export interface InTipHooks {
  /** whether no tip may show now: the tour or the sheet showing, following someone, a snapshot,
   *  the artwork mode */
  blocked(): boolean;
  /** whether a tip is for this reader on this screen (who and where, decision 10) */
  fits(t: Tip): boolean;
  /** Show me (decision 7) */
  showMe(e: InPlace): void;
  /** whether the film can be watched here (it is on the server, not a snapshot) */
  canWatch(): boolean;
  /** the sheet opened at a chapter of the film, playing from its start */
  watch(chapter: string): void;
}

export class InTips {
  private el: HTMLElement;
  /** the rule shown in this page's session, if one was */
  private used: string | null = null;
  /** no tip in place in this session: the tour ran */
  private quiet = false;
  private anchor: string | null = null;
  private follow: ReturnType<typeof setInterval> | null = null;
  private stay: ReturnType<typeof setTimeout> | null = null;
  private state: TipState;
  private hooks: InTipHooks;

  constructor(state: TipState, hooks: InTipHooks) {
    this.state = state;
    this.hooks = hooks;
    this.el = document.getElementById("intip")!;
    this.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const shown = this.entry();
      if (!shown) return;
      if (t.closest("[data-intip-ok]")) this.end(true);
      else if (t.closest("[data-intip-show]")) {
        this.end(true);
        this.hooks.showMe(shown);
      } else if (t.closest("[data-intip-watch]") && shown.chapter) {
        this.end(true);
        this.hooks.watch(shown.chapter);
      }
    });
    // Esc, or a press elsewhere, puts it away unanswered. Esc is the tip's alone, as a popover's is:
    // the next one closes what is open, leaves the Time Machine, clears the selection
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape" || this.el.hidden || e.isComposing) return;
        e.stopPropagation();
        e.preventDefault();
        this.end(false);
      },
      true,
    );
    document.addEventListener("pointerdown", (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node)) this.end(false);
    });
    window.addEventListener("resize", () => this.place());
  }

  /** The tour ran in this session: nothing more is shown in place in it. */
  hush(): void {
    this.quiet = true;
    this.end(false);
  }

  private entry(): InPlace | null {
    return this.used ? inPlaceOf(this.used) : null;
  }

  /** Whether a rule's tip would show now, were its moment to come: what the page asks before it
   *  counts anything for it. */
  open(rule: string): boolean {
    if (this.used !== null || this.quiet || this.state.off || this.hooks.blocked()) return false;
    const e = inPlaceOf(rule);
    return !!e && !!RULES[rule] && !this.state.isDone(e.key) && (!e.tip || this.hooks.fits(e.tip));
  }

  /** One more of what a rule counts, kept across visits (the picks under one step): how many now;
   *  nothing is counted once the rule's tip is done. */
  count(name: string, rule: string): number {
    const e = inPlaceOf(rule);
    return !e || this.state.isDone(e.key) ? 0 : this.state.bump(name);
  }

  /** The page says a rule's moment came: its tip shows once what triggered it has settled, unless
   *  one did in this session, the reader had it already, turned tips off, or the page is busy. */
  offer(rule: string): void {
    if (!this.open(rule)) return;
    // taken now, so that the same moment twice does not show it twice
    this.used = rule;
    setTimeout(() => {
      const tip = this.entry();
      const r = RULES[rule];
      const sel = (isPhone() && r.phone) || r.at;
      const at = document.querySelector<HTMLElement>(sel);
      // gone meanwhile, or the page busy: another moment, in this session, may show it
      if (!tip || this.hooks.blocked() || !at || at.hidden || !at.getBoundingClientRect().width) {
        this.used = null;
        return;
      }
      this.anchor = sel;
      this.state.shown(tip.key);
      // a chapter: Watch opens the film at it
      const watch = tip.chapter && this.hooks.canWatch() ? `<button class="rv-btn" data-intip-watch>Watch</button>` : "";
      this.el.innerHTML =
        `<div class="intip-title">${escapeHtml(tip.title)}</div><div class="intip-text">${tip.text}</div>` +
        `<div class="intip-acts">${watch}${tip.showMe ? `<button class="rv-btn" data-intip-show>Show me</button>` : ""}<button class="rv-btn primary" data-intip-ok>Got it</button></div>`;
      this.el.hidden = false;
      this.place();
      // the control may move (a panel slides in, a window is dragged): the card goes with it
      this.follow = setInterval(() => this.place(), 400);
      this.stay = setTimeout(() => this.end(false), STAYS_MS);
    }, SETTLE_MS);
  }

  /** The reader did what a rule's tip teaches: it is done, shown or not. */
  did(rule: string): void {
    const tip = inPlaceOf(rule);
    if (!tip || this.state.isDone(tip.key)) return;
    this.state.done(tip.key);
    if (this.used === rule && !this.el.hidden) this.end(false);
  }

  private end(done: boolean): void {
    if (this.follow) clearInterval(this.follow);
    if (this.stay) clearTimeout(this.stay);
    this.follow = this.stay = null;
    const tip = this.entry();
    if (done && tip) this.state.done(tip.key);
    this.el.hidden = true;
  }

  /** Beside its control: below it where there is room, else above, within the screen. */
  private place(): void {
    if (this.el.hidden || !this.anchor) return;
    const at = document.querySelector<HTMLElement>(this.anchor);
    if (!at || !at.getBoundingClientRect().width) return this.end(false);
    const r = at.getBoundingClientRect();
    const w = this.el.offsetWidth, h = this.el.offsetHeight, gap = 10;
    const below = innerHeight - r.bottom >= h + gap + 8;
    const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
    const y = below ? r.bottom + gap : Math.max(8, r.top - h - gap);
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.el.classList.toggle("above", !below);
    // the arrow points at the control's middle
    this.el.style.setProperty("--arrow-x", `${Math.round(Math.max(14, Math.min(r.left + r.width / 2 - x, w - 14)))}px`);
  }
}
