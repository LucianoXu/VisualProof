// The page's source windows (ReviewSpec, "The source window", decided 2026-10-09): at most one that
// follows the selection, and the ones the reader pinned, each staying on its declaration. They are
// only this page's — a reload starts without them — and nothing of where they were is kept: each
// opening of the following window is in the middle of the screen, fitted to its code, as the modal
// window was (openRect).
//
// Pinning turns the following window into a pinned one, moved a step aside from its place
// (web/src/floatwin.ts, cascadeRect), so that the next declaration opened — Space, or Source in the
// panel — opens in a new following window, in the middle again, beside the pinned one. At most
// MAX_PINNED are pinned at once.
//
// What a reader shares (CollabSpec decision 4) is all of them: the following window, open or not,
// on which declaration, collapsed or not, and each pinned window's declaration, collapsed or not. A
// follower's windows mirror theirs (Sources.mirror), each placed by the follower's own rules, since
// screens differ; once following ends, the windows that stood for theirs are the follower's own.
//
// This is the windows' logic alone, with no page in it, so that it is tested without a browser
// (test/sources.test.ts); web/src/sourcewin.ts draws each window, web/src/pagepanels.ts wires them.

import { MAX_PINNED } from "../../shared/collab.ts";
import { cascadeRect, CASCADE, EDGE, insideRect, onTop } from "./floatwin.ts";
import type { Rect, Size } from "./floatwin.ts";

/** the most windows pinned at once: a few declarations side by side, not a wall of them */
export { MAX_PINNED };
/** the smallest the reader can make a source window, viewport permitting */
export const MIN: Size = { w: 360, h: 160 };
/** the least width a window fitted to its code takes, where the screen has room: a declaration's
 *  lines are wide (decided 2026-10-06: at least 560 px wide, as large as the code needs) */
export const FIT_W = 560;

/** Why a window was not pinned: there are as many as there may be. */
export const PIN_CAP = `${MAX_PINNED} source windows are pinned already: close one to pin another.`;

/** One source window, as the page's set of them drives it. */
export interface SourcePane {
  /** the declaration it shows, and its name (what it is found by in a new graph) */
  readonly decl: number;
  readonly name: string;
  readonly collapsed: boolean;
  /** show declaration `i`: another, or the same drawn again */
  show(i: number): void;
  /** draw its review again: the review changed */
  redrawReview(): void;
  /** it is pinned, at `at`: it stays on its declaration, its place its own */
  pin(at: Rect): void;
  /** it is pinned as it opens, fitted to its code `step` steps aside from the middle of the screen
   *  (asideRect), until the reader moves or resizes it: a followed reader's pinned window */
  pinAside(step: number): void;
  /** collapsed to its pill, or opened again */
  collapse(on: boolean): void;
  front(): void;
  /** where it is on the screen */
  rect(): Rect;
  /** whether the page's element `t` is inside it */
  holds(t: unknown): boolean;
  /** it goes from the page */
  remove(): void;
}

export interface SourcesHooks<P extends SourcePane> {
  /** a new window, which follows the selection until it is pinned */
  make(): P;
  /** tell the reader something for a moment: why a window was not pinned */
  say(text: string): void;
  /** a window opened, closed or was pinned: what the others are told changed */
  changed(): void;
  /** the viewport's size */
  viewport(): Size;
  /** window `p` was opened on declaration `i` — Source, Space, a comment's code quote, Open in a
   *  pinned window — or the following window stepped to it: the reference window opens its first
   *  link beside that window, pinned or not (AttachmentSpec decision 8) */
  shown?(p: P, i: number): void;
  /** where a pinned window's top may be: under the page's bars (web/src/paperdock.ts, pairTop) */
  top?(): number;
}

/** What a followed reader's windows are, as the follower's page reads their presence
 *  (shared/collab.ts, PresenceView): their following window, open on a declaration (null: on
 *  nothing that is one here) or closed (null); their pinned windows, the first pinned first, each
 *  on a declaration this page has. */
export interface Shared {
  following: { decl: number | null; collapsed: boolean } | null;
  pinned: { decl: number; collapsed: boolean }[];
}

export class Sources<P extends SourcePane> {
  /** the window that follows the selection, or null */
  following: P | null = null;
  /** the pinned windows, the first pinned first */
  pinned: P[] = [];
  /** the pinned windows that stand for a followed reader's, while following them */
  private mirrored = new Set<P>();
  private hooks: SourcesHooks<P>;

  constructor(hooks: SourcesHooks<P>) {
    this.hooks = hooks;
  }

  /** Every window, the following one first. */
  get all(): P[] {
    return this.following ? [this.following, ...this.pinned] : [...this.pinned];
  }

  /** Whether the following window is open, collapsed or not: what the others are told. */
  get open(): boolean {
    return this.following !== null;
  }

  /** The window holding `t` (where a key was pressed, a click landed), or null. */
  at(t: unknown): P | null {
    return this.all.find((p) => p.holds(t)) ?? null;
  }

  /** Source in the panel, or Space: declaration `i` in the following window — a new one if there is
   *  none — opened if it was collapsed, in front. The reader asked for it: it is paired again even
   *  where it showed `i` already (the reference window, closed since, opens again). */
  show(i: number): P {
    let p = this.following;
    if (!p) {
      p = this.hooks.make();
      this.following = p;
      p.show(i);
      this.hooks.changed();
    } else if (p.decl !== i) p.show(i);
    if (p.collapsed) p.collapse(false);
    p.front();
    this.hooks.shown?.(p, i);
    return p;
  }

  /** A window shown to the reader again, whatever it is (a comment's code quote clicked, on a
   *  declaration a window shows already): opened if it was collapsed, in front, and paired as one
   *  just opened. */
  reveal(p: P): void {
    if (p.collapsed) p.collapse(false);
    p.front();
    if (p.decl >= 0) this.hooks.shown?.(p, p.decl);
  }

  /** Space: the following window closes; collapsed, it opens again; with none, one opens on the
   *  selection `i`. */
  toggle(i: number | null): void {
    const p = this.following;
    if (p && !p.collapsed) return this.close(p);
    if (p) {
      p.collapse(false);
      p.front();
    } else if (i !== null) this.show(i);
  }

  /** The selection changed, or what shows it did: the following window shows declaration `i`;
   *  with no declaration selected (nothing, or a cluster) it closes. Pinned windows stay. */
  follow(i: number | null): void {
    const p = this.following;
    if (!p) return;
    if (i === null) return this.close(p);
    const step = p.decl !== i;
    p.show(i);
    if (step) this.hooks.shown?.(p, i);
  }

  /** Following someone (web/src/people.ts): this reader's windows as theirs are, each placed by this
   *  page's own rules. The following window opens on their declaration, follows it and closes with
   *  theirs; a pinned window stands for each of theirs — one pinned here on the same declaration,
   *  else this page's following window pinned where they pinned theirs, else a new one a step aside
   *  — and closes when theirs does; each is collapsed as theirs is. Windows this reader pinned
   *  on other declarations stay, and at most MAX_PINNED are pinned. */
  mirror(s: Shared): void {
    // theirs matched to those here: first the windows that stood for them, then any on the same
    // declaration
    const left = new Set(this.pinned);
    const states: [P, boolean][] = [];
    const missing: Shared["pinned"] = [];
    for (const e of s.pinned) {
      const on = [...left].filter((p) => p.decl === e.decl);
      const p = on.find((q) => this.mirrored.has(q)) ?? on[0];
      if (!p) {
        missing.push(e);
        continue;
      }
      left.delete(p);
      this.mirrored.add(p);
      states.push([p, e.collapsed]);
    }
    // closed there, closed here
    for (const p of left) if (this.mirrored.has(p)) this.close(p);
    for (const e of missing) {
      if (this.pinned.length >= MAX_PINNED) break;
      const f = this.following;
      let p: P;
      // they pinned their following window: this one is pinned as this reader would pin it
      if (f && f.decl === e.decl && s.following?.decl !== e.decl) {
        this.pinAt(f);
        p = f;
      } else {
        p = this.hooks.make();
        p.pinAside(this.pinned.length + 1);
        p.show(e.decl);
        this.pinned.push(p);
        this.hooks.changed();
      }
      this.mirrored.add(p);
      states.push([p, e.collapsed]);
    }
    for (const [p, on] of states) if (p.collapsed !== on) p.collapse(on);
    // their following window: open on their declaration, or closed; on nothing that is a
    // declaration here, as it is
    const f = s.following;
    if (f && f.decl !== null) {
      let p = this.following;
      if (!p) p = this.show(f.decl);
      else if (p.decl !== f.decl) {
        // a step as any other, which the pairing is told of: it pairs nothing while this reader
        // follows, and the window says so
        p.show(f.decl);
        this.hooks.shown?.(p, f.decl);
      }
      if (p.collapsed !== f.collapsed) p.collapse(f.collapsed);
    } else if (!f && this.following) this.close(this.following);
  }

  /** Following ended: the windows that stood for the followed reader's are this reader's own. */
  release(): void {
    this.mirrored.clear();
  }

  /** Pin the following window: it stays on its declaration, a step aside from its place; no window
   *  follows the selection until the next one opens. Refused, with why, when MAX_PINNED are pinned
   *  already. */
  pin(p: P): boolean {
    if (p !== this.following) return false;
    if (this.pinned.length >= MAX_PINNED) {
      this.hooks.say(PIN_CAP);
      return false;
    }
    this.pinAt(p);
    return true;
  }

  /** "Open in a pinned window" (the canvas's menu): declaration `i` in a window of its own, pinned
   *  as it opens a step aside from the middle of the screen; a pinned window on it already comes
   *  in front instead. Either is paired. Refused, with why, when MAX_PINNED are pinned already. */
  openPinned(i: number): P | null {
    const have = this.pinned.find((p) => p.decl === i);
    if (have) {
      this.reveal(have);
      return have;
    }
    if (this.pinned.length >= MAX_PINNED) {
      this.hooks.say(PIN_CAP);
      return null;
    }
    const p = this.hooks.make();
    p.pinAside(this.pinned.length + 1);
    p.show(i);
    this.pinned.push(p);
    p.front();
    this.hooks.changed();
    this.hooks.shown?.(p, i);
    return p;
  }

  /** The following window pinned, a step aside from its place and from every pinned window, under
   *  the page's bars. */
  private pinAt(p: P): void {
    const at = cascadeRect(p.rect(), this.pinned.map((q) => q.rect()), this.hooks.viewport(), MIN, this.hooks.top?.() ?? EDGE);
    this.following = null;
    this.pinned.push(p);
    p.pin(at);
    this.hooks.changed();
  }

  /** Close a window: its ✕, Esc inside it, Space for the following one. */
  close(p: P): void {
    if (p === this.following) this.following = null;
    else {
      const k = this.pinned.indexOf(p);
      if (k < 0) return;
      this.pinned.splice(k, 1);
      this.mirrored.delete(p);
    }
    p.remove();
    this.hooks.changed();
  }

  /** The review changed, or what it shows with (the board, for its key declarations): the pinned
   *  windows' reviews are drawn again. The following window is
   *  drawn again as it follows. */
  redrawReviews(): void {
    for (const p of this.pinned) p.redrawReview();
  }

  /** A new graph, or files that changed: each pinned window shows its declaration again, found by
   *  name; one whose declaration the graph no longer holds closes. */
  redraw(find: (name: string) => number | undefined): void {
    for (const p of [...this.pinned]) {
      const i = find(p.name);
      if (i === undefined) this.close(p);
      else p.show(i);
    }
  }
}

/** How large a source window may be while it is fitted to its code (decided 2026-10-09, as the
 *  modal window was): at most 92 % × 88 % of the screen, and a margin from its edges — from `top`
 *  at the top, the page's bars' bottom for a pinned window, which stands under them; at least
 *  FIT_W wide and MIN tall, where the screen is. */
export function openBounds(vp: Size, top = EDGE): { max: Size; min: Size } {
  const max = { w: Math.min(0.92 * vp.w, vp.w - 2 * EDGE), h: Math.min(0.88 * vp.h, vp.h - top - EDGE) };
  return { max, min: { w: Math.min(FIT_W, max.w), h: Math.min(MIN.h, max.h) } };
}

/** Where the following window goes at the size its code gives it, while the reader has not moved
 *  or resized it (decided 2026-10-09): in the middle of the screen, as the modal window opened; a
 *  step aside where it would lie on a pinned window (`pinned`), so that that one stays in sight. */
export function openRect(size: Size, vp: Size, pinned: readonly Rect[]): Rect {
  const at = insideRect({ x: (vp.w - size.w) / 2, y: (vp.h - size.h) / 2, ...size }, vp);
  if (!pinned.some((r) => onTop(r, at))) return at;
  return cascadeRect(at, pinned, vp, { w: Math.min(MIN.w, size.w), h: Math.min(MIN.h, size.h) });
}

/** Where a pinned window opened for a followed reader's (or a share link's) goes, while the reader
 *  has not moved or resized it: `step` steps down and to the right of the middle of the screen
 *  under the page's bars (`top`, their bottom), so that each opened stands a step beside the one
 *  before; as far as the screen's margins let it, and never over the bars where it fits under
 *  them. */
export function asideRect(size: Size, vp: Size, step: number, top = EDGE): Rect {
  const under = (r: Rect): Rect => {
    const at = insideRect(r, vp);
    return top + at.h <= vp.h - EDGE ? { ...at, y: Math.max(at.y, top) } : at;
  };
  const mid = under({ x: (vp.w - size.w) / 2, y: top + (vp.h - EDGE - top - size.h) / 2, ...size });
  return under({ ...mid, x: mid.x + step * CASCADE, y: mid.y + step * CASCADE });
}

/** What a key does where it is pressed (ReviewSpec, "The source window", decided 2026-10-09):
 *  `close` the window it was pressed in (Esc); `own` the review keys on that window's declaration
 *  (a, m, k); `press` a control's own (Space on a button or a link in a window); `page` the page's
 *  shortcut, as anywhere else. Typing in a field is the page's to tell first: keys there are text. */
export type KeyRoute = "close" | "own" | "press" | "page";

export function routeKey(key: string, inWindow: boolean, onControl: boolean): KeyRoute {
  if (!inWindow) return "page";
  if (key === "Escape") return "close";
  if (key === " " && onControl) return "press";
  if (key === "a" || key === "m" || key === "k") return "own";
  return "page";
}
