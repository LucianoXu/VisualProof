// Pointers in a room (CollabSpec decision 4; the owner's decisions of 2026-10-20; shared/pointer.ts):
// while a reader follows someone, or someone follows them, their page says where its pointer is and
// what text it has selected, and draws those of the others in its room — whom it follows, who follows
// it, who follows the same reader — each a cursor in their colour with their initials, fading once it
// is still; their text selection a highlight in that colour; the followed reader's clicks a ripple.
//
// A place is said as what it is on (`anchorAt`), and found again on this page's own layout
// (`resolveAt`): the board by its world, the linear form by its row, a source window's code by line
// and column, the reference window by its page, an element of a followed surface by the steps down to
// it. A surface of the reader's own (web/src/surfaces.ts) is never said: the pointer there is off. A
// place this page does not show where it is — scrolled away in this reader's own scrolling, a surface
// a phone shows elsewhere — is said by a small mark at the edge of what holds it, in the other's
// colour ("↓ Alice"), which a click scrolls to; scrolling is never followed. Nothing of it ends
// following: the layer lets every press through, and its marks are the reader's own.
//
// A part of the page: web/src/pagepointer.ts makes it.

import { colorOf, initials, personKey } from "../../shared/collab.ts";
import type { Peer } from "../../shared/collab.ts";
import { FADE_MS, FOLLOW_MS, inRoom, LEAD_MS, SHOWN, STEPS_MAX } from "../../shared/pointer.ts";
import type { PointerAt, PointerBody, PointerNews, Root, RoomPage, SelAt, Step, TextAt } from "../../shared/pointer.ts";
import { escapeHtml } from "./highlight.ts";

/** A box on the screen, in the page's coordinates. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the anchoring asks of the page. */
export interface AnchorHooks {
  /** the board's world at a point of the screen, and back */
  toWorld(x: number, y: number): [number, number];
  toScreen(x: number, y: number): [number, number];
  /** the room the panels leave the board on the screen */
  boardRoom(): Box;
  /** the linear form where it is shown: a point of it said and found again, its room, and its own
   *  camera brought to a row (the reader's own scrolling) */
  linear(): { at(x: number, y: number): [string, number, number] | null; screenOf(p: [string, number, number]): [number, number] | null; room(): Box; reveal(key: string): void } | null;
  /** the declaration a source window shows, and the window showing a declaration */
  windowDecl(el: Element): string | null;
  windowOf(decl: string): HTMLElement | null;
  /** a surface of the reader's own (web/src/surfaces.ts): never said, nor drawn on */
  yours(el: Element): boolean;
}

/** What inside a source window's code is no text of it: what the code's own text is drawn beside
 *  (line numbers, marks), which a page leaves out of what is copied. */
const NOT_TEXT = '[aria-hidden="true"]';
/** the code of a source window */
const CODE = "pre.code.src";
/** where a point is the board's */
const BOARD = "#canvas, #labels, #cards, #stickies";

const clamp01 = (n: number) => Math.min(1.5, Math.max(-0.5, n));
const round = (n: number, d = 1000) => Math.round(n * d) / d;

// ---------------------------------------------------------------- steps

/** The step from an element's parent down to it: an attribute that says what it is (its id, else
 *  its first `data-` attribute, else its first class), and its place among its siblings. */
function stepOf(e: Element): Step {
  const nth = e.parentElement ? Array.prototype.indexOf.call(e.parentElement.children, e) : 0;
  if (e.id && e.id.length <= 160) return ["id", e.id, nth];
  for (const a of Array.from(e.attributes)) {
    if (!/^data-[a-z0-9-]{1,40}$/.test(a.name)) continue;
    if (a.value === "") return [a.name, null, nth];
    if (a.value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(a.value)) return [a.name, a.value, nth];
  }
  const cls = (e.getAttribute("class") ?? "").split(/\s+/).find((c) => /^[\w-]{1,60}$/.test(c));
  return cls ? ["class", cls, nth] : [null, null, nth];
}

/** Whether a child is what a step says it is. */
function isStep(k: Element | undefined, a: string, v: string | null): boolean {
  if (!k) return false;
  if (a === "class") return (k.getAttribute("class") ?? "").split(/\s+/).includes(v ?? "");
  return v === null ? k.hasAttribute(a) : k.getAttribute(a) === v;
}

/** The steps from `root` down to `e` (inside it), at most STEPS_MAX: deeper, the element that many
 *  steps down, which holds it. */
export function stepsTo(root: Element, e: Element): { steps: Step[]; el: Element } | null {
  const chain: Element[] = [];
  for (let x: Element | null = e; x && x !== root; x = x.parentElement) chain.unshift(x);
  if (chain.length && chain[0].parentElement !== root) return null;
  const kept = chain.slice(0, STEPS_MAX);
  return { steps: kept.map(stepOf), el: kept.at(-1) ?? root };
}

/** The element `steps` lead to from `root`, on this page: each step's child by what it is — its
 *  place when the child there is what it says, else the first child that is — else by its place. */
export function follow(root: Element, steps: readonly Step[]): Element | null {
  let e: Element = root;
  for (const [a, v, n] of steps) {
    const kids = e.children;
    let next: Element | undefined = kids[n];
    if (a && !isStep(next, a, v)) next = Array.from(kids).find((k) => isStep(k, a, v)) ?? (v === null ? next : undefined);
    if (!next) return null;
    e = next;
  }
  return e;
}

// ---------------------------------------------------------------- text

/** The text nodes of `el` that are its text, in order: not what it draws beside its text. */
function texts(el: Element): Text[] {
  const out: Text[] = [];
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out.push(c as Text);
      else if (c.nodeType === 1 && !(c as Element).matches(NOT_TEXT)) walk(c);
    }
  };
  walk(el);
  return out;
}

/** Where (`node`, `offset`) is in `el`'s text, in characters from its start; null outside it, or in
 *  what is drawn beside the text. */
export function offsetIn(el: Element, node: Node, offset: number): number | null {
  if (!el.contains(node)) return null;
  if (node.nodeType === 3) {
    let n = 0;
    for (const t of texts(el)) {
      if (t === node) return n + Math.min(offset, t.length);
      n += t.length;
    }
    return null;
  }
  // a point between an element's children: the text before it
  const at = document.createRange();
  at.setStart(node, offset);
  at.collapse(true);
  let n = 0;
  for (const t of texts(el)) {
    if (at.comparePoint(t, 0) >= 0) break;
    n += t.length;
  }
  return n;
}

/** The text node and offset `o` characters into `el`'s text; its end where it is shorter. */
export function pointIn(el: Element, o: number): { node: Text; offset: number } | null {
  const all = texts(el);
  let n = 0;
  for (const t of all) {
    if (o <= n + t.length) return { node: t, offset: o - n };
    n += t.length;
  }
  const last = all.at(-1);
  return last ? { node: last, offset: last.length } : null;
}

/** A line and column of code, from a point in its text. */
export function lineColOf(text: string, o: number): [number, number] {
  const before = text.slice(0, o);
  const nl = before.lastIndexOf("\n");
  let line = 0;
  for (let i = before.indexOf("\n"); i >= 0; i = before.indexOf("\n", i + 1)) line++;
  return [line, o - nl - 1];
}

/** The point of code a line and column are at: within the line, its end where it is shorter. */
export function offsetOf(text: string, [line, col]: [number, number]): number | null {
  let at = 0;
  for (let l = 0; l < line; l++) {
    const nl = text.indexOf("\n", at);
    if (nl < 0) return null;
    at = nl + 1;
  }
  const end = text.indexOf("\n", at);
  return at + Math.min(col, (end < 0 ? text.length : end) - at);
}

const textOf = (el: Element) => texts(el).map((t) => t.data).join("");

/** The text node and offset under a point of the screen, as the browser's caret would be there. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
  if (typeof d.caretPositionFromPoint === "function") {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

// ---------------------------------------------------------------- saying where

/** The surface an element's steps start from: a source window (by its declaration), the reference
 *  window, else the nearest element of the page's own with an id. */
function rootOf(e: Element, h: AnchorHooks): { root: Root; el: Element } | null {
  const sw = e.closest(".sw-win");
  if (sw) {
    const decl = h.windowDecl(sw);
    return decl ? { root: { sw: decl }, el: sw } : null;
  }
  const pw = e.closest(".pw-win");
  if (pw) return { root: { pw: true }, el: pw };
  for (let x: Element | null = e; x && x !== document.body; x = x.parentElement) if (x.id && /^[A-Za-z][\w-]{0,60}$/.test(x.id)) return { root: { id: x.id }, el: x };
  return null;
}

/** Where on this page an element's steps start. */
function rootEl(r: Root, h: AnchorHooks): Element | null {
  if ("sw" in r) return h.windowOf(r.sw);
  if ("pw" in r) return document.querySelector(".pw-win");
  return document.getElementById(r.id);
}

/** Where the pointer at (x, y), over `t`, is, as any page finds it again; null where it is on
 *  nothing followed — a surface of the reader's own, a bar's blank part. */
export function anchorAt(x: number, y: number, t: Element | null, h: AnchorHooks): PointerAt | null {
  if (!t || h.yours(t)) return null;
  const lin = t.closest("#linear") ? h.linear() : null;
  if (lin) {
    const p = lin.at(x, y);
    return p ? { l: [p[0], round(p[1]), round(p[2], 10)] } : null;
  }
  if (t.closest(BOARD)) {
    const [wx, wy] = h.toWorld(x, y);
    return { b: [round(wx, 10), round(wy, 10)] };
  }
  const sw = t.closest(".sw-win");
  const code = sw ? t.closest(CODE) : null;
  if (sw && code) {
    const decl = h.windowDecl(sw);
    const c = caretAt(x, y);
    const o = decl && c ? offsetIn(code, c.node, c.offset) : null;
    if (decl && o !== null) return { sw: decl, lc: lineColOf(textOf(code), o) };
  }
  const page = t.closest(".pw-win .pw-page, .pw-win .pw-img");
  if (page) {
    const r = page.getBoundingClientRect();
    const n = page.classList.contains("pw-page") ? Number((page as HTMLElement).dataset.n) : 0;
    if (r.width > 0 && r.height > 0 && Number.isInteger(n)) return { pw: [n, round(clamp01((x - r.left) / r.width)), round(clamp01((y - r.top) / r.height))] };
  }
  const from = rootOf(t, h);
  const path = from ? stepsTo(from.el, t) : null;
  if (!from || !path) return null;
  const r = path.el.getBoundingClientRect();
  return { in: from.root, p: path.steps, f: [round(clamp01((x - r.left) / (r.width || 1))), round(clamp01((y - r.top) / (r.height || 1)))] };
}

/** A point in text, as any page finds it again; null where it is in no followed surface's text. */
export function textAt(node: Node, offset: number, h: AnchorHooks): TextAt | null {
  const e = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!e || h.yours(e)) return null;
  const sw = e.closest(".sw-win");
  const code = sw ? e.closest(CODE) : null;
  if (sw && code) {
    const decl = h.windowDecl(sw);
    const o = decl ? offsetIn(code, node, offset) : null;
    return decl && o !== null ? { sw: decl, lc: lineColOf(textOf(code), o) } : null;
  }
  const from = rootOf(e, h);
  const path = from ? stepsTo(from.el, e) : null;
  if (!from || !path) return null;
  const o = offsetIn(path.el, node, offset);
  return o === null ? null : { in: from.root, p: path.steps, o };
}

/** The reader's text selection, as any page finds it again; null where there is none, or it is not
 *  in a followed surface's text. */
export function selectionAt(sel: Selection | null, h: AnchorHooks): SelAt | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const a = textAt(r.startContainer, r.startOffset, h), b = textAt(r.endContainer, r.endOffset, h);
  return a && b ? { a, b } : null;
}

// ---------------------------------------------------------------- finding it again

/** Where a place is on this page: the point, the box it shows in (what holds it, as scrolled and as
 *  much of it as the screen shows) — the point outside it is scrolled away — and what a click on the
 *  edge's mark brings into view; null where this page does not show it at all. */
export interface Found {
  x: number;
  y: number;
  box: Box;
  /** bring it into view: the reader's own scrolling; absent where that would move a followed part
   *  (the board's camera) */
  reveal?: () => void;
  /** where what holds it is not shown at all (a phone's drawer closed, a window collapsed to its
   *  pill): the nearest place that leads there, the mark set by it; null where none does */
  lead?: { el: Element; what: string; open?: () => void };
}

/** On a page that does not show a surface at the moment, where it is reached from: a phone's side
 *  panel from the drawer's button (PhoneSpec decision 6), which opens it. */
const LEADS: Record<string, { sel: string; what: string }> = { side: { sel: "#side-btn", what: "in the side panel" } };

const onScreen = (e: Element) => {
  const r = e.getBoundingClientRect();
  return laidOut(e) && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
};

/** The place that leads to a surface this page does not show now: a drawer's button; a window
 *  collapsed to its pill (inert: opening it would change what is followed). */
function leadTo(root: Element | null, r: Root): Found | null {
  let lead: Found["lead"] | null = null;
  if ("id" in r) {
    // the surface holding it, and what leads there
    let l: (typeof LEADS)[string] | undefined;
    for (let x: Element | null = root; x && !l; x = x.parentElement) l = LEADS[x.id];
    const el = l ? document.querySelector<HTMLElement>(l.sel) : null;
    if (l && el && onScreen(el)) lead = { el, what: l.what, open: () => el.click() };
  } else if (root && onScreen(root)) lead = { el: root, what: "sw" in r ? "in its source window" : "in the reference window" };
  if (!lead) return null;
  const b = lead.el.getBoundingClientRect();
  // what covers it (a window docked over the bar) leaves nothing to point by
  const hit = typeof document.elementFromPoint === "function" ? document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2) : lead.el;
  if (!hit || !(hit === lead.el || lead.el.contains(hit))) return null;
  return { x: (b.left + b.right) / 2, y: b.bottom, box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, lead };
}

const VIEWPORT = (): Box => ({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
const meet = (a: Box, b: Box): Box => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
const scrolls = new WeakMap<Element, boolean>();

/** What shows of what holds an element: the screen within every box that clips it, up to `root`. A
 *  point of the element outside it is scrolled away. */
function shownBox(e: Element, root: Element): Box {
  let box = VIEWPORT();
  for (let x: Element | null = e.parentElement; x; x = x.parentElement) {
    let clips = scrolls.get(x);
    if (clips === undefined) {
      const s = getComputedStyle(x);
      clips = /(auto|scroll|hidden|clip)/.test(s.overflowY + s.overflowX);
      scrolls.set(x, clips);
    }
    if (clips) box = meet(box, x.getBoundingClientRect());
    if (x === root) break;
  }
  return box;
}

/** Whether an element is laid out on this page. */
const laidOut = (e: Element) => e.getClientRects().length > 0;

/** The rectangle of a point of text: the character it is before (after, at the end). */
function caretRect(p: { node: Text; offset: number }): DOMRect | null {
  const r = document.createRange();
  const at = Math.min(p.offset, p.node.length);
  if (at < p.node.length) r.setStart(p.node, at), r.setEnd(p.node, at + 1);
  else if (at > 0) r.setStart(p.node, at - 1), r.setEnd(p.node, at);
  else return p.node.parentElement?.getBoundingClientRect() ?? null;
  const rects = r.getClientRects();
  const rect = rects[at < p.node.length ? 0 : rects.length - 1] ?? r.getBoundingClientRect();
  return at < p.node.length ? rect : new DOMRect(rect.right, rect.top, 0, rect.height);
}

/** A point of text on this page: its node and offset, and what holds it. */
function textHere(t: TextAt, h: AnchorHooks): { p: { node: Text; offset: number }; holder: Element; root: Element } | null {
  if ("lc" in t) {
    const win = h.windowOf(t.sw);
    const code = win?.querySelector(CODE);
    if (!win || !code) return null;
    const o = offsetOf(textOf(code), t.lc);
    const p = o === null ? null : pointIn(code, o);
    return p ? { p, holder: code, root: win } : null;
  }
  const root = rootEl(t.in, h);
  const el = root ? follow(root, t.p) : null;
  const p = el ? pointIn(el, t.o) : null;
  return p && root ? { p, holder: el!, root } : null;
}

/** Where a pointer's place is on this page; null where this page does not show it. */
export function resolveAt(at: PointerAt, h: AnchorHooks): Found | null {
  if ("b" in at) {
    const [x, y] = h.toScreen(at.b[0], at.b[1]);
    return { x, y, box: meet(VIEWPORT(), h.boardRoom()) };
  }
  if ("l" in at) {
    const lin = h.linear();
    const p = lin?.screenOf(at.l);
    return lin && p ? { x: p[0], y: p[1], box: meet(VIEWPORT(), lin.room()), reveal: () => lin.reveal(at.l[0]) } : null;
  }
  if ("lc" in at) {
    const t = textHere(at, h);
    const r = t ? caretRect(t.p) : null;
    if (!t || !r || !laidOut(t.holder)) return leadTo(h.windowOf(at.sw), { sw: at.sw });
    const near = t.p.node.parentElement ?? t.holder;
    return { x: r.left, y: r.top + r.height / 2, box: shownBox(t.holder, t.root), reveal: () => near.scrollIntoView({ block: "center", inline: "nearest" }) };
  }
  if ("pw" in at) {
    const win = document.querySelector(".pw-win");
    const page = win?.querySelector(at.pw[0] ? `.pw-page[data-n="${at.pw[0]}"]` : ".pw-img");
    if (!win || !page || !laidOut(page)) return leadTo(win, { pw: true });
    const r = page.getBoundingClientRect();
    return { x: r.left + at.pw[1] * r.width, y: r.top + at.pw[2] * r.height, box: shownBox(page, win), reveal: () => page.scrollIntoView({ block: "nearest", inline: "nearest" }) };
  }
  const root = rootEl(at.in, h);
  const el = root ? follow(root, at.p) : null;
  if (el && h.yours(el)) return null;
  if (!root || !el || !laidOut(el) || !onScreen(root)) return leadTo(root, at.in);
  const r = el.getBoundingClientRect();
  return { x: r.left + at.f[0] * r.width, y: r.top + at.f[1] * r.height, box: shownBox(el, root), reveal: () => el.scrollIntoView({ block: "nearest", inline: "nearest" }) };
}

/** The rectangles a selection covers on this page, each within what shows it; none where either end
 *  is not shown. */
export function resolveSel(s: SelAt, h: AnchorHooks): { rects: Box[]; box: Box; reveal: () => void } | null {
  const a = textHere(s.a, h), b = textHere(s.b, h);
  if (!a || !b || !laidOut(a.holder)) return null;
  const r = document.createRange();
  try {
    r.setStart(a.p.node, a.p.offset);
    r.setEnd(b.p.node, b.p.offset);
    if (r.collapsed) {
      r.setStart(b.p.node, b.p.offset);
      r.setEnd(a.p.node, a.p.offset);
    }
  } catch {
    return null;
  }
  const box = shownBox(a.holder, a.root);
  const rects: Box[] = [];
  for (const q of Array.from(r.getClientRects()).slice(0, 200)) {
    const c = meet(box, q);
    if (c.right > c.left && c.bottom > c.top) rects.push(c);
  }
  const near = a.p.node.parentElement ?? a.holder;
  return { rects, box, reveal: () => near.scrollIntoView({ block: "center", inline: "nearest" }) };
}

// ---------------------------------------------------------------- the room

/** What the room asks of the page. */
export interface PointerHooks extends AnchorHooks {
  /** this page's stream's secret and public id; null before its hello */
  stream(): { token: string; id: string } | null;
  /** this page and the others as their rooms are worked out (shared/pointer.ts): this page, each
   *  other page listed, and the private readers following this reader, counted */
  me(): RoomPage | null;
  peers(): readonly Peer[];
  privateFollowers(): number;
  /** someone unseen (a read-only reader) follows this reader, as the server says */
  unseenFollowers(): boolean;
  /** a read-only page: its pointer is shown to nobody, and it says whom it follows itself */
  readOnly(): boolean;
  /** send what the page says (POST /api/pointer) */
  send(body: PointerBody): void;
}

/** One other page's pointer as this page draws it. */
interface Other {
  id: string;
  name: string;
  color: string;
  at: PointerAt | null;
  sel: SelAt | null;
  /** when it last moved, or its selection changed */
  moved: number;
  cursor: HTMLElement;
  edge: HTMLElement;
  /** the highlight of its selection: one element per rectangle */
  marks: HTMLElement[];
  /** where the cursor is drawn, easing to where it is */
  shown: { x: number; y: number } | null;
}

const ARROW = `<svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true"><path d="M1.5 1.5v15.2l4.1-3.9 2.6 6 2.7-1.2-2.6-5.8h5.6z" fill="var(--c)" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

export class Pointers {
  private layer: HTMLElement;
  private hooks: PointerHooks;
  private others = new Map<string, Other>();
  private frame = 0;
  private later: ReturnType<typeof setTimeout> | null = null;
  /** what this page said last, and when; what it has to say next */
  private sent = { at: "null", sel: "null", when: 0 };
  private wait: ReturnType<typeof setTimeout> | null = null;
  private next: { at: PointerAt | null; click?: true } = { at: null };
  /** the read-only page's word on whom it follows, as said last */
  private toldFollows: string | null | undefined = undefined;
  private still = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  constructor(layer: HTMLElement, hooks: PointerHooks) {
    this.layer = layer;
    this.hooks = hooks;
    // an edge's mark brings what it points at into view: this reader's own scrolling
    layer.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>(".ptr-edge");
      const o = b ? this.others.get(b.dataset.from ?? "") : undefined;
      if (!o) return;
      const f = o.at ? resolveAt(o.at, this.hooks) : null;
      const s = o.sel ? resolveSel(o.sel, this.hooks) : null;
      (f?.lead?.open ?? f?.reveal ?? s?.reveal)?.();
    });
  }

  // ---------------------------------------------------------------- what this page says

  /** Whether this page is in a room and says where its pointer is: listed (a private or read-only
   *  reader's is shown to nobody), and following someone or followed — by someone unseen too. */
  private speaks(): boolean {
    const me = this.hooks.me();
    if (!me || me.key === null || this.hooks.readOnly()) return false;
    if (me.follows !== null) return true;
    return this.hooks.privateFollowers() > 0 || this.hooks.unseenFollowers() || this.hooks.peers().some((p) => !p.agent && p.view?.following === me.key);
  }

  /** The pointer moved (or pressed, `click`) at (x, y) over `t`: said, at most every LEAD_MS while
   *  this reader is followed, FOLLOW_MS while they follow, and not at all out of a room. */
  moved(x: number, y: number, t: Element | null, click = false): void {
    if (!this.speaks()) return;
    this.next = { at: anchorAt(x, y, t, this.hooks), ...(click || this.next.click ? { click: true as const } : {}) };
    this.schedule(click);
  }

  /** The pointer left the page. */
  left(): void {
    if (!this.speaks()) return;
    this.next = { at: null };
    this.schedule(false);
  }

  /** The text selection changed. */
  selected(): void {
    if (this.speaks()) this.schedule(false);
  }

  private schedule(now: boolean): void {
    const every = this.hooks.me()?.follows ? FOLLOW_MS : LEAD_MS;
    const due = this.sent.when + every - Date.now();
    if (now || due <= 0) return this.flush();
    if (!this.wait) this.wait = setTimeout(() => this.flush(), due);
  }

  private flush(): void {
    if (this.wait) clearTimeout(this.wait);
    this.wait = null;
    const s = this.hooks.stream();
    if (!s || !this.speaks()) return;
    const sel = selectionAt(typeof document !== "undefined" ? document.getSelection() : null, this.hooks);
    const at = JSON.stringify(this.next.at), selText = JSON.stringify(sel);
    if (at === this.sent.at && selText === this.sent.sel && !this.next.click) return;
    this.hooks.send({ token: s.token, at: this.next.at, sel, ...(this.next.click ? { click: true as const } : {}) });
    this.sent = { at, sel: selText, when: Date.now() };
    this.next = { at: this.next.at };
  }

  /** The page's stream (re)connected: the server knows nothing yet of whom a read-only page
   *  follows. */
  connected(): void {
    this.toldFollows = undefined;
    this.roomChanged();
  }

  /** Who this page follows, or who is in its room, changed: a read-only page says whom it follows;
   *  the others' marks of pages no longer in the room go; a page leaving every room says its pointer
   *  is off once. */
  roomChanged(): void {
    const me = this.hooks.me();
    const s = this.hooks.stream();
    if (this.hooks.readOnly() && s) {
      const f = me?.follows ?? null;
      if (f !== this.toldFollows) {
        this.toldFollows = f;
        this.hooks.send({ token: s.token, following: f });
      }
    }
    for (const o of [...this.others.values()]) if (!this.inMyRoom(o.id)) this.drop(o.id);
    if (!this.speaks() && this.sent.at !== "null" && s && me?.key) {
      this.hooks.send({ token: s.token, at: null, sel: null });
      this.sent = { at: "null", sel: "null", when: Date.now() };
    }
  }

  // ---------------------------------------------------------------- what the others say

  private inMyRoom(id: string): boolean {
    const me = this.hooks.me();
    const p = this.hooks.peers().find((x) => x.id === id);
    if (!me || !p || p.agent) return false;
    return inRoom(me, { id: p.id, key: personKey(p), follows: p.view?.following ?? null });
  }

  /** Another page of the room said where its pointer is: drawn, its click a ripple where it is the
   *  reader this page follows. */
  heard(n: PointerNews): void {
    if (!this.inMyRoom(n.from)) return;
    const p = this.hooks.peers().find((x) => x.id === n.from)!;
    let o = this.others.get(n.from);
    if (!o) {
      const cursor = document.createElement("div");
      cursor.className = "ptr";
      cursor.innerHTML = `${ARROW}<span class="ptr-who">${escapeHtml(p.name ? initials(p.name) : "?")}</span>`;
      cursor.hidden = true;
      const edge = document.createElement("button");
      edge.type = "button";
      edge.className = "ptr-edge";
      edge.dataset.from = n.from;
      edge.tabIndex = -1;
      edge.hidden = true;
      this.layer.append(cursor, edge);
      o = { id: n.from, name: p.name ?? "A reader", color: p.name ? colorOf(p.name) : "var(--text-3)", at: null, sel: null, moved: 0, cursor, edge, marks: [], shown: null };
      for (const el of [cursor, edge]) el.style.setProperty("--c", o.color);
      this.others.set(n.from, o);
    }
    const changed = JSON.stringify(n.at) !== JSON.stringify(o.at) || JSON.stringify(n.sel) !== JSON.stringify(o.sel);
    o.at = n.at;
    o.sel = n.sel;
    if (changed || n.click) o.moved = Date.now();
    const me = this.hooks.me();
    if (n.click && n.at && me?.follows === personKey(p)) this.ripple(o, n.at);
    this.request();
  }

  /** A page's marks go: it left the room, or the page. */
  drop(id: string): void {
    const o = this.others.get(id);
    if (!o) return;
    o.cursor.remove();
    o.edge.remove();
    for (const m of o.marks) m.remove();
    this.others.delete(id);
  }

  private ripple(o: Other, at: PointerAt): void {
    const f = resolveAt(at, this.hooks);
    if (!f || f.lead || !inside(f, f.box)) return;
    const r = document.createElement("div");
    r.className = "ptr-ripple";
    r.style.setProperty("--c", o.color);
    r.style.transform = `translate(${f.x}px, ${f.y}px)`;
    this.layer.append(r);
    setTimeout(() => r.remove(), 900);
  }

  private request(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
  }

  /** Draw every pointer of the room where this page shows its place: the latest SHOWN to move, each
   *  fading FADE_MS after it stopped; the others' selections; a mark at the edge for a place
   *  scrolled away. Drawn every frame while one shows: the board's camera and the reader's scrolling
   *  move them. */
  private draw(): void {
    this.frame = 0;
    const now = Date.now();
    const still = this.still?.matches ?? false;
    const shownIds = new Set(drawnOf([...this.others.values()], now));
    const latest = [...this.others.values()].filter((o) => shownIds.has(o.id));
    let again = false, held = false;
    for (const o of this.others.values()) {
      const on = latest.includes(o);
      const age = now - o.moved;
      const live = on && age < FADE_MS + 400;
      const f = live && o.at ? resolveAt(o.at, this.hooks) : null;
      // the cursor: where its place shows; else the mark at the edge of what holds it
      if (f && !f.lead && inside(f, f.box)) {
        const to = { x: f.x, y: f.y };
        o.shown = !o.shown || still ? to : { x: o.shown.x + (to.x - o.shown.x) * 0.55, y: o.shown.y + (to.y - o.shown.y) * 0.55 };
        if (Math.abs(o.shown.x - to.x) > 0.5 || Math.abs(o.shown.y - to.y) > 0.5) again = true;
        o.cursor.style.transform = `translate(${o.shown.x}px, ${o.shown.y}px)`;
        o.cursor.style.opacity = age < FADE_MS ? "1" : "0";
        o.cursor.hidden = false;
        o.edge.hidden = true;
      } else {
        o.cursor.hidden = true;
        o.shown = null;
        this.edge(o, f, age);
      }
      if (live) again = true;
      // its selection, as long as it holds one
      const s = on && o.sel ? resolveSel(o.sel, this.hooks) : null;
      const rects = s?.rects ?? [];
      while (o.marks.length < rects.length) {
        const m = document.createElement("div");
        m.className = "ptr-sel";
        m.style.setProperty("--c", o.color);
        this.layer.prepend(m);
        o.marks.push(m);
      }
      o.marks.forEach((m, i) => {
        const r = rects[i];
        m.hidden = !r;
        if (r) Object.assign(m.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
      });
      if (rects.length) held = true;
    }
    if (again) this.request();
    // only selections held still: drawn again a few times a second, as the reader scrolls
    else if (held && !this.later) this.later = setTimeout(() => ((this.later = null), this.request()), 150);
  }

  /** The mark at the edge of what holds a place scrolled away ("↓ Alice"), while it moves; a click
   *  on it scrolls there. */
  private edge(o: Other, f: Found | null, age: number): void {
    if (!f || age >= FADE_MS || f.box.right <= f.box.left || f.box.bottom <= f.box.top) {
      o.edge.hidden = true;
      return;
    }
    // a surface this page does not show now: a mark by what leads there
    if (f.lead) {
      const said = `• ${o.name}`;
      if (o.edge.textContent !== said) o.edge.textContent = said;
      o.edge.title = `${o.name}'s pointer is ${f.lead.what}${f.lead.open ? " — click to open it" : ""}`;
      o.edge.classList.toggle("inert", !f.lead.open);
      o.edge.dataset.dir = "lead";
      o.edge.style.left = `${f.x}px`;
      o.edge.style.top = `${f.y + 10}px`;
      o.edge.hidden = false;
      return;
    }
    const b = f.box;
    const dir = f.y < b.top ? "above" : f.y > b.bottom ? "below" : f.x < b.left ? "left" : "right";
    const arrow = { above: "↑", below: "↓", left: "←", right: "→" }[dir];
    const x = Math.min(b.right - 12, Math.max(b.left + 12, f.x));
    const y = Math.min(b.bottom - 12, Math.max(b.top + 12, f.y));
    const said = `${arrow} ${o.name}`;
    if (o.edge.textContent !== said) o.edge.textContent = said;
    o.edge.title = `${o.name}'s pointer is ${dir === "left" || dir === "right" ? `off to the ${dir}` : dir}${f.reveal ? " — click to scroll there" : ""}`;
    o.edge.classList.toggle("inert", !f.reveal);
    o.edge.dataset.dir = dir;
    o.edge.style.left = `${x}px`;
    o.edge.style.top = `${y}px`;
    o.edge.hidden = false;
  }
}

const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;

/** Which of the room's pointers a page draws at `now`: at most SHOWN, those that moved last, and of
 *  them those still moving or with a selection (the others faded). */
export function drawnOf(others: readonly { id: string; moved: number; sel?: unknown }[], now: number): string[] {
  return [...others]
    .sort((a, b) => b.moved - a.moved)
    .slice(0, SHOWN)
    .filter((o) => now - o.moved < FADE_MS + 400 || !!o.sel)
    .map((o) => o.id);
}
