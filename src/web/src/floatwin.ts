// Floating windows: the conversation with an agent (web/src/chatwin.ts, decided 2026-10-08) and the
// source windows (web/src/sourcewin.ts, decided 2026-10-09). The reader moves one by its title bar,
// resizes it from any edge or corner, and collapses it — its button, or a double-click on the title
// bar — to a one-line pill; a click on the pill opens it again. Mouse, pen and touch alike: the
// pointer is captured until it is let go.
//
// A window stays inside the viewport, a margin from its edges, and snaps to them. Where a window
// kind is kept in this browser (web/src/store.ts: the conversation's), it is kept by the corner it
// is nearest, so that it keeps to that corner when the viewport changes. A window may instead be
// fitted to its content, as the source windows are: nothing of it is kept, and until the reader
// moves or resizes it, it is as large as its content needs, within bounds, and placed by a rule of
// its kind; from then on its place and size are the reader's until it goes.
//
// The windows lie in one layer over the page (#windows), the one last pressed or focused in front;
// hover cards and the page's modal windows lie above that layer. The geometry is pure functions,
// tested without a browser (test/floatwin.test.ts).

import { sheeted } from "./phone.ts";
import { windowRegion, windowsDocked } from "./monitor.ts";

/** `r` moved and shrunk into `region`, where there is one (web/src/monitor.ts: where a window the
 *  reader has not moved opens on an upright monitor). */
export function intoRegion(r: Rect, region: Rect | null): Rect {
  if (!region) return r;
  const w = Math.min(r.w, region.w), h = Math.min(r.h, region.h);
  return { x: fit(r.x, region.x, region.x + region.w - w), y: fit(r.y, region.y, region.y + region.h - h), w, h };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** A window as kept: its size, and how far it is from the viewport's left or right edge and from
 *  its top or bottom — the nearer ones, which `right` and `bottom` name. */
export interface Place extends Rect {
  right?: boolean;
  bottom?: boolean;
}

/** What this browser keeps of a window kind: where the reader put it, if they moved or resized it;
 *  whether it is collapsed, where the kind keeps that. */
export interface Kept {
  place?: Place;
  collapsed?: boolean;
}

/** the margin a window keeps from the viewport's edges: the page's other panels keep the same */
export const EDGE = 12;
/** how near an edge's line it snaps to it */
export const SNAP = 10;
/** how far each window opened beside another is moved from it, down and to the right */
export const CASCADE = 28;

/** `v` within [lo, hi], `hi` winning where the range is empty (a viewport smaller than the least) */
const fit = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** A fitted window's bounds within `region`, where there is one. */
function capped(b: { max: Size; min: Size }, region: Rect | null): { max: Size; min: Size } {
  if (!region) return b;
  const max = { w: Math.min(b.max.w, region.w), h: Math.min(b.max.h, region.h) };
  return { max, min: { w: Math.min(b.min.w, max.w), h: Math.min(b.min.h, max.h) } };
}

/** The largest a window may be: the viewport less its margins. */
export function maxSize(vp: Size): Size {
  return { w: Math.max(vp.w - 2 * EDGE, 120), h: Math.max(vp.h - 2 * EDGE, 80) };
}

/** A size between the least and the most. */
function clampSize(s: Size, vp: Size, min: Size): Size {
  const max = maxSize(vp);
  return { w: fit(s.w, min.w, max.w), h: fit(s.h, min.h, max.h) };
}

/** One axis of a position: within the margins, centred where it cannot be. */
function clampAt(at: number, len: number, end: number): number {
  const hi = end - EDGE - len;
  return hi < EDGE ? Math.max(0, (end - len) / 2) : fit(at, EDGE, hi);
}

/** A rect brought inside the viewport: no larger than it less its margins, no smaller than the
 *  least, a margin from every edge. */
export function clampRect(r: Rect, vp: Size, min: Size): Rect {
  const s = clampSize(r, vp, min);
  return { x: clampAt(r.x, s.w, vp.w), y: clampAt(r.y, s.h, vp.h), w: s.w, h: s.h };
}

/** A rect the page placed kept under `top` (the page's bars) in the viewport: moved down to it, and
 *  no taller than the room under it, where that room holds the least height; as it is otherwise. */
export function underRect(r: Rect, vp: Size, top: number, min: Size): Rect {
  const room = vp.h - EDGE - top;
  if (r.y >= top || room < min.h) return r;
  return { ...r, y: top, h: Math.min(r.h, room) };
}

/** A rect moved inside the viewport, a margin from every edge, its size as it is: a window fitted
 *  to its content is as large as that is. */
export function insideRect(r: Rect, vp: Size): Rect {
  return { ...r, x: clampAt(r.x, r.w, vp.w), y: clampAt(r.y, r.h, vp.h) };
}

/** One axis of a snap: onto the near or the far edge's line when within SNAP of it. */
function snapAt(at: number, len: number, end: number): number {
  if (Math.abs(at - EDGE) <= SNAP) return EDGE;
  if (Math.abs(end - EDGE - (at + len)) <= SNAP && end - EDGE - len >= EDGE) return end - EDGE - len;
  return at;
}

/** A rect within SNAP of the viewport's edges put on them. */
export function snapRect(r: Rect, vp: Size): Rect {
  return { ...r, x: snapAt(r.x, r.w, vp.w), y: snapAt(r.y, r.h, vp.h) };
}

/** A window dragged by (dx, dy) from `r`: inside the viewport, snapped to its edges. */
export function moveRect(r: Rect, dx: number, dy: number, vp: Size, min: Size): Rect {
  return snapRect(clampRect({ ...r, x: r.x + dx, y: r.y + dy }, vp, min), vp);
}

/** One axis of a resize: the segment from `at`, `len` long, its start (`fromStart`) or its end
 *  dragged by `d`; the other end stays. Within the margins, between the least and the most, the
 *  moving end snapped to the edge. */
function stretch(at: number, len: number, d: number, fromStart: boolean, min: number, max: number, end: number): [number, number] {
  if (fromStart) {
    const b = at + len;
    let a = Math.max(at + d, EDGE);
    if (a - EDGE <= SNAP) a = EDGE;
    const l = fit(b - a, min, Math.min(max, b - EDGE));
    return [b - l, l];
  }
  let b = Math.min(at + len + d, end - EDGE);
  if (end - EDGE - b <= SNAP) b = end - EDGE;
  return [at, fit(b - at, min, Math.min(max, end - EDGE - at))];
}

/** A window resized from `r` by an edge or a corner (`edges`: n, s, e, w, ne, nw, se, sw) dragged
 *  by (dx, dy); the opposite edges stay. */
export function resizeRect(r: Rect, edges: string, dx: number, dy: number, vp: Size, min: Size): Rect {
  const max = maxSize(vp);
  const out = { ...r };
  if (edges.includes("e") || edges.includes("w")) [out.x, out.w] = stretch(r.x, r.w, dx, edges.includes("w"), min.w, max.w, vp.w);
  if (edges.includes("n") || edges.includes("s")) [out.y, out.h] = stretch(r.y, r.h, dy, edges.includes("n"), min.h, max.h, vp.h);
  return out;
}

/** What is kept of a rect: its size and its distance from the nearer edges. */
export function placeOf(r: Rect, vp: Size): Place {
  const right = r.x + r.w / 2 > vp.w / 2;
  const bottom = r.y + r.h / 2 > vp.h / 2;
  const p: Place = {
    x: Math.round(right ? vp.w - r.x - r.w : r.x),
    y: Math.round(bottom ? vp.h - r.y - r.h : r.y),
    w: Math.round(r.w),
    h: Math.round(r.h),
  };
  if (right) p.right = true;
  if (bottom) p.bottom = true;
  return p;
}

/** The rect a kept place stands for in this viewport: at the same distance from the same edges,
 *  brought inside it. */
export function rectOf(p: Place, vp: Size, min: Size): Rect {
  const s = clampSize(p, vp, min);
  return clampRect({ x: p.right ? vp.w - p.x - s.w : p.x, y: p.bottom ? vp.h - p.y - s.h : p.y, ...s }, vp, min);
}

/** A kept place read back, or null when what is kept is none: missing, from an older page, or
 *  edited by hand into something that is not a place. */
export function readPlace(raw: unknown): Place | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : null);
  const x = n("x"), y = n("y"), w = n("w"), h = n("h");
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  const p: Place = { x, y, w, h };
  if (o.right === true) p.right = true;
  if (o.bottom === true) p.bottom = true;
  return p;
}

/** What is kept of a window kind read back with care: whatever is there may be from an older page. */
export function readKept(raw: unknown): Kept {
  const k = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Kept = {};
  const place = readPlace(k.place);
  if (place) out.place = place;
  if (typeof k.collapsed === "boolean") out.collapsed = k.collapsed;
  return out;
}

/** Whether two windows lie on one another: their top left corners less than half a step apart, so
 *  that the one in front hides the other's title bar. */
export function onTop(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < CASCADE / 2 && Math.abs(a.y - b.y) < CASCADE / 2;
}

/** Where a window opened beside `from` goes: CASCADE down and to the right of it, and a step further
 *  for each window there already (`taken`), so that none opens exactly on another; where that would
 *  leave the viewport, up and to the left instead. `from`'s size, inside the viewport, and never
 *  above `top` where it fits under it: a source window keeps under the page's bars (the share-link
 *  agent's test of 2026-10-12, after a pinned window stepped up over the tab bar). */
export function cascadeRect(from: Rect, taken: readonly Rect[], vp: Size, min: Size, top = EDGE): Rect {
  const others = [from, ...taken];
  const start = clampRect(from, vp, min);
  if (start.y < top && top + start.h <= vp.h - EDGE) start.y = top;
  for (const dir of [1, -1]) {
    for (let k = 1; k <= 32; k++) {
      const want = { ...start, x: start.x + dir * k * CASCADE, y: start.y + dir * k * CASCADE };
      const at = clampRect(want, vp, min);
      if (at.x !== want.x || at.y !== want.y || at.y < top) break;
      if (!others.some((r) => onTop(r, at))) return at;
    }
  }
  // no room for a step either way (a window nearly as large as the screen): on it, as it is
  return start;
}

/** The windows' order with `x` in front, the rest as they were. */
export function raise<T>(order: readonly T[], x: T): T[] {
  return [...order.filter((y) => y !== x), x];
}

/** Where a window kind keeps its place in this browser: what is kept, and a change to keep. */
export interface Keeper {
  read(): unknown;
  write(change: Kept): void;
}

/** A window fitted to its content until the reader moves or resizes it: the most it may grow to
 *  and the least it takes, and where its kind puts it at the size its content gives it. */
export interface FitRule {
  bounds(vp: Size): { max: Size; min: Size };
  at(size: Size, vp: Size): Rect;
}

export interface FloatOptions {
  /** the smallest the reader can make it, viewport permitting */
  min: Size;
  /** its title bar, which moves it and which a double-click collapses; the button that collapses
   *  it, and the pill's that opens it again: selectors inside it */
  handle: string;
  collapser: string;
  opener: string;
  /** where its kind is kept, or null: a window whose place is its own once the reader puts it
   *  somewhere (a source window) */
  keeper: Keeper | null;
  /** whether collapsing it is kept with its place */
  keepsCollapsed?: boolean;
  /** where it starts, the reader not having put it anywhere; or fitted to its content (`fit`),
   *  which a window with a kept place never is */
  start?(vp: Size): Rect;
  fit?: FitRule;
  /** whether it is a window now (the conversation's: while talking with an agent) */
  live(): boolean;
  /** the reader collapsed it or opened it again */
  collapsed?(on: boolean): void;
  /** the reader moved or resized it, and let it go */
  placed?(): void;
  /** where its top may be while the page places it (a pinned source window: under the page's
   *  bars); the reader may move it anywhere */
  top?(): number;
}

const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
/** how far the pointer moves before a press on the title bar or an edge moves anything: a click
 *  (and a double-click, which collapses) is not a drag */
const DRAG_PX = 3;

const viewport = (): Size => ({ w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight });
const px = (v: number) => `${Math.round(v)}px`;

/** the windows in the layer, the frontmost last: each one's z-index there is its place in it */
let stack: HTMLElement[] = [];
const restack = () => stack.forEach((el, k) => (el.style.zIndex = String(k + 1)));

/** A window the reader moves, resizes and collapses: `el`, positioned in #windows. */
export class FloatWindow {
  readonly el: HTMLElement;
  private o: FloatOptions;
  private keeper: Keeper | null;
  collapsed = false;
  /** where it is now */
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** a window whose place is its own: where the reader left it, or where it was put (pinned) */
  private own: Rect | null = null;
  /** fitted to its content now: its size is its content's, and only its position is set */
  private fitting = false;
  /** a drag or a resize under way: the window is where the pointer puts it, whatever else moves */
  private dragging = false;
  /** the reader moved or resized it since its place was last set by the page (`ownPlace`, `unmove`):
   *  what the source and reference windows, paired, keep as the reader's choice */
  byHand = false;
  private watch: ResizeObserver | null = null;
  private resized = () => this.layout();

  constructor(el: HTMLElement, o: FloatOptions) {
    this.el = el;
    this.o = o;
    this.keeper = o.keeper;
    for (const d of EDGES) {
      const h = document.createElement("div");
      h.className = `fl-rz fl-rz-${d}`;
      h.dataset.rz = d;
      h.setAttribute("aria-hidden", "true");
      el.append(h);
    }
    // the window pressed or focused comes to the front
    el.addEventListener("pointerdown", () => this.front(), true);
    el.addEventListener("focusin", () => this.front());
    el.addEventListener("pointerdown", (e) => this.press(e));
    el.addEventListener("dblclick", (e) => {
      const t = e.target as Element;
      if (this.o.live() && !this.collapsed && t.closest(this.o.handle) && !t.closest("button, a")) this.collapse(true);
    });
    el.addEventListener("click", (e) => {
      const t = e.target as Element;
      if (t.closest(this.o.collapser)) this.collapse(true);
      else if (t.closest(this.o.opener)) this.collapse(false);
    });
    window.addEventListener("resize", this.resized);
    // a window fitted to its content keeps to its place as the content changes size
    if (o.fit && typeof ResizeObserver !== "undefined") {
      this.watch = new ResizeObserver(() => {
        if (this.fitting && !this.dragging && !this.collapsed && this.o.live()) this.refit();
      });
      this.watch.observe(el);
    }
  }

  /** Bring the window to the front of the others. */
  front(): void {
    if (stack[stack.length - 1] === this.el) return;
    stack = raise(stack, this.el);
    restack();
  }

  /** The window goes for good: it is no longer kept in step with the viewport. */
  dispose(): void {
    window.removeEventListener("resize", this.resized);
    this.watch?.disconnect();
    stack = stack.filter((el) => el !== this.el);
    restack();
  }

  private kept() {
    return this.keeper ? readKept(this.keeper.read()) : {};
  }

  private keep(change: Kept): void {
    this.keeper?.write(change);
  }

  /** Put the window where it is kept, in the viewport as it is now (it changed, or what the window
   *  avoids did). */
  layout(): void {
    if (!this.o.live() || this.dragging) return;
    const vp = viewport();
    const k = this.kept();
    this.fitting = false;
    if (this.own) {
      // a place the page gave it stays under the bars as the viewport changes; the reader's is theirs
      const r = clampRect(this.own, vp, this.o.min);
      this.rect = this.o.top && !this.byHand ? underRect(r, vp, this.o.top(), this.o.min) : r;
    }
    else if (k.place) this.rect = rectOf(k.place, vp, this.o.min);
    else if (this.o.fit) {
      this.fitting = true;
      // collapsed, the pill stays at the corner of the window as it was
      if (this.collapsed) return this.place();
      const { max, min } = capped(this.o.fit.bounds(vp), windowRegion(vp));
      Object.assign(this.el.style, { width: "max-content", height: "", minWidth: px(min.w), minHeight: px(min.h), maxWidth: px(max.w), maxHeight: px(max.h) });
      return this.refit();
    } else this.rect = intoRegion(this.o.start ? this.o.start(vp) : clampRect({ x: EDGE, y: EDGE, w: this.o.min.w, h: this.o.min.h }, vp, this.o.min), windowRegion(vp));
    this.place();
  }

  /** A window fitted to its content, at the size it has now: where its rule puts it. */
  private refit(): void {
    const size = { w: this.el.offsetWidth, h: this.el.offsetHeight };
    if (!size.w || !size.h || !this.o.fit) return;
    this.rect = intoRegion(this.o.fit.at(size, viewport()), windowRegion(viewport()));
    this.place();
  }

  /** The place is the window's own from now on, not its kind's, nor fitted to its content: it is at
   *  `r`, and stays where the reader puts it, as large as they make it. */
  ownPlace(r: Rect): void {
    this.keeper = null;
    this.own = r;
    this.byHand = false;
    this.layout();
  }

  /** Where the reader put it is forgotten: it is placed by its kind's rule again, fitted to its
   *  content where it is (the pairing lays the source and reference windows out afresh). */
  unmove(): void {
    this.own = null;
    this.byHand = false;
    this.layout();
  }

  /** The window at `this.rect`; collapsed, the pill at the rect's corner nearest the viewport's. */
  private place(): void {
    const s = this.el.style;
    const r = this.rect;
    if (!this.collapsed) {
      if (this.fitting) Object.assign(s, { left: px(r.x), top: px(r.y), right: "auto", bottom: "auto" });
      else Object.assign(s, { left: px(r.x), top: px(r.y), right: "auto", bottom: "auto", width: px(r.w), height: px(r.h), maxWidth: "", maxHeight: "", minWidth: "", minHeight: "" });
      return;
    }
    const vp = viewport();
    const right = r.x + r.w / 2 > vp.w / 2;
    const bottom = r.y + r.h / 2 > vp.h / 2;
    Object.assign(s, {
      left: right ? "auto" : px(r.x),
      right: right ? px(vp.w - r.x - r.w) : "auto",
      top: bottom ? "auto" : px(r.y),
      bottom: bottom ? px(vp.h - r.y - r.h) : "auto",
      width: "",
      height: "",
      maxWidth: px(r.w),
      maxHeight: "",
      minWidth: "",
      minHeight: "",
    });
  }

  /** No longer a window (the conversation's strip alone): what placed it goes, its place among the
   *  windows too. */
  reset(): void {
    this.collapsed = false;
    this.el.classList.remove("collapsed");
    for (const k of ["left", "top", "right", "bottom", "width", "height", "maxWidth", "maxHeight", "minWidth", "minHeight", "zIndex"] as const) this.el.style[k] = "";
    stack = stack.filter((el) => el !== this.el);
    restack();
  }

  /** Collapse the window or open it again, as it was kept or as it starts: nothing is kept. */
  setCollapsed(on: boolean): void {
    this.collapsed = on;
    this.el.classList.toggle("collapsed", on);
    this.layout();
  }

  /** The reader collapses the window to its pill, or opens it again; their choice is kept where
   *  the kind keeps it. */
  collapse(on: boolean): void {
    if (!this.o.live() || on === this.collapsed) return;
    const inside = this.el.contains(document.activeElement);
    this.setCollapsed(on);
    if (this.o.keepsCollapsed) this.keep({ collapsed: on });
    // the keyboard stays in the window: on the pill, or on the button that collapses it again
    if (inside) this.el.querySelector<HTMLElement>(on ? this.o.opener : this.o.collapser)?.focus();
    this.o.collapsed?.(on);
  }

  /** A press on the title bar moves the window, on an edge or a corner resizes it; mouse, pen or
   *  touch alike, the pointer captured until it is let go. */
  private press(e: PointerEvent): void {
    if (!this.o.live() || this.collapsed || this.dragging || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    // docked on a phone or a tall screen (style.css; PhoneSpec decisions 12 and 21): placed there, not by hand
    if (sheeted() || windowsDocked()) return;
    const t = e.target as Element;
    const edge = t.closest<HTMLElement>("[data-rz]");
    const bar = t.closest<HTMLElement>(this.o.handle);
    const handle = edge ?? (bar && !t.closest("button, a") ? bar : null);
    if (!handle || !this.el.contains(handle)) return;
    e.preventDefault();
    const start = { ...this.rect };
    // a window fitted to its content is moved as large as it is, however small
    const min = this.fitting ? { w: Math.min(this.o.min.w, start.w), h: Math.min(this.o.min.h, start.h) } : this.o.min;
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    this.dragging = true;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < DRAG_PX) return;
      if (!moved) this.el.classList.add(edge ? "sizing" : "moving");
      moved = true;
      const vp = viewport();
      // resized, a window is as large as the reader makes it
      if (edge) this.fitting = false;
      this.rect = edge ? resizeRect(start, edge.dataset.rz!, dx, dy, vp, this.o.min) : moveRect(start, dx, dy, vp, min);
      this.place();
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      this.el.classList.remove("moving", "sizing");
      this.dragging = false;
      if (!moved) return;
      this.byHand = true;
      // moved or resized, a window kept nowhere — fitted to its content until now — keeps its place
      // and size, its own, until it goes
      if (this.own || !this.keeper) this.own = { ...this.rect };
      else this.keep({ place: placeOf(this.rect, viewport()) });
      this.layout();
      this.o.placed?.();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
  }
}
