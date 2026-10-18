// An upright monitor, with a mouse (PhoneSpec decisions 29–35, the owner's choice of 2026-10-18): a
// desktop's page, its height used. The board above, the side panel at its left; under them a work
// area across the screen, where the panel — or Activity, the lost-and-found in its place — is a pane
// at the left and the windows (the source windows, the reference window, a conversation) one column
// at its right, stacked from the top in that order. Splitters set the work area's height, the
// panel's width and each window's share of the column; a double-click gives them their own again,
// and this browser keeps what the reader set. The panel alone takes the work area's width, as the
// column does with no declaration selected; with nothing in it the board has the whole height. The
// windows are placed there, not dragged (web/src/floatwin.ts). Everything else — the popovers,
// hover, the menus, the keys, the selection bar under the modes — is a desktop's.
//
// The geometry is a pure function (`workArea`), tested without a browser (test/monitor.test.ts);
// the page applies it in `MonitorLayout`: the panel by the body's variables, each window by its own
// (--dock-x, --dock-y, --dock-w, --dock-h, read by style.css's monitor block).

import type { Rect, Size } from "./floatwin.ts";
import { isMonitor, MONITOR } from "./phone.ts";

const EDGE = 12;
const GAP = 8;
/** a window's least height in the column, and a collapsed one's pill */
const WIN_MIN = 140;
const PILL_H = 34;
const SIZES = "visualproof:monitor-sizes";

/** What the reader set, kept in this browser: the work area's height as a share of the screen's, the
 *  panel's width, and each kind of window's weight in the column. */
export interface Sizes {
  low?: number;
  panel?: number;
  stack?: Partial<Record<Kind, number>>;
}
export type Kind = "source" | "paper" | "talk";
/** the column's order, from the top: the declaration's source, the reference beside it, a
 *  conversation */
const RANK: Record<Kind, number> = { source: 0, paper: 1, talk: 2 };
/** each kind's share of the column, where the reader has set none: the reference the tallest, as a
 *  page of a PDF is read best */
const WEIGHT: Record<Kind, number> = { source: 2, paper: 3, talk: 2 };

/** The work area's height and the panel's width on a screen of `vp`: the reader's, within bounds, else
 *  their own — half the screen; 30 % of its width, 380 to 640 px. */
export function sized(s: Sizes, vp: Size): { low: number; panel: number; stack: Record<Kind, number> } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return {
    low: clamp((s.low ?? 0.5) * vp.h, vp.h * 0.25, vp.h - 420),
    panel: clamp(s.panel ?? Math.min(640, Math.max(380, vp.w * 0.3)), 320, vp.w - 2 * EDGE - GAP - 360),
    stack: { ...WEIGHT, ...s.stack },
  };
}

/** A window in the work area: its kind, collapsed or not, and a collapsed one's pill's width. */
export interface Docked {
  kind: Kind;
  collapsed: boolean;
  pillW?: number;
}

export interface Split {
  /** low: the work area's top; panel: between the panel and the column; stack: between two windows
   *  of the column (their indices in `wins`) */
  kind: "low" | "panel" | "stack";
  rect: Rect;
  between?: [number, number];
}

export interface Area {
  /** the work area's top; null where nothing is in it and the board has the whole height */
  top: number | null;
  panel: Rect | null;
  column: Rect | null;
  /** each window's place, in the order given: an open one's in the column, a collapsed one's pill */
  wins: Rect[];
  splits: Split[];
}

/** Where everything in the work area goes on a screen of `vp` (decisions 32–35): the panel (`pane`:
 *  it, Activity or the lost-and-found is open) and the windows `wins`. */
export function workArea(vp: Size, s: Sizes, pane: boolean, wins: readonly Docked[]): Area {
  const { low, panel: pw, stack } = sized(s, vp);
  const open = wins.map((w, i) => ({ ...w, i })).filter((w) => !w.collapsed).sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.i - b.i);
  const pills = wins.map((w, i) => ({ ...w, i })).filter((w) => w.collapsed);
  const out: Area = { top: null, panel: null, column: null, wins: wins.map(() => ({ x: 0, y: 0, w: 0, h: 0 })), splits: [] };
  // the pills, in a row from the right at the foot of the column, or of the screen
  const placePills = (right: number, bottom: number) => {
    let x = right;
    for (const p of pills) {
      const w = Math.min(280, p.pillW ?? 200);
      x -= w;
      out.wins[p.i] = { x, y: bottom - PILL_H, w, h: PILL_H };
      x -= GAP;
    }
  };
  if (!pane && !open.length) {
    placePills(vp.w - EDGE, vp.h - EDGE);
    return out;
  }
  const top = vp.h - EDGE - low;
  out.top = top;
  out.splits.push({ kind: "low", rect: { x: EDGE, y: top - GAP, w: vp.w - 2 * EDGE, h: GAP } });
  if (pane) out.panel = { x: EDGE, y: top, w: open.length ? pw : vp.w - 2 * EDGE, h: low };
  if (!open.length) {
    placePills(vp.w - EDGE - GAP, vp.h - EDGE - GAP);
    return out;
  }
  const x = pane ? EDGE + pw + GAP : EDGE;
  const column = { x, y: top, w: vp.w - EDGE - x, h: low };
  out.column = column;
  if (pane) out.splits.push({ kind: "panel", rect: { x: EDGE + pw, y: top, w: GAP, h: low } });
  // the windows from the top, each its weight's share of what the pills leave
  const room = low - (pills.length ? PILL_H + GAP : 0) - GAP * (open.length - 1);
  const total = open.reduce((t, w) => t + stack[w.kind], 0);
  let y = top;
  open.forEach((w, k) => {
    const last = k === open.length - 1;
    const h = last ? top + room + GAP * (open.length - 1) - y : Math.max(WIN_MIN, Math.round((room * stack[w.kind]) / total));
    out.wins[w.i] = { x, y, w: column.w, h };
    if (!last) out.splits.push({ kind: "stack", rect: { x, y: y + h, w: column.w, h: GAP }, between: [w.i, open[k + 1].i] });
    y += h + GAP;
  });
  placePills(vp.w - EDGE, vp.h - EDGE);
  return out;
}

/** The weights two neighbouring windows of the column take when the splitter between them is
 *  dragged by `d` px: their heights change by it, their sum stays, neither under its least. */
export function restack(stack: Record<Kind, number>, a: { kind: Kind; h: number }, b: { kind: Kind; h: number }, d: number): Record<Kind, number> {
  if (a.kind === b.kind) return stack;
  const sum = a.h + b.h;
  const ha = Math.min(Math.max(a.h + d, WIN_MIN), sum - WIN_MIN);
  const w = stack[a.kind] + stack[b.kind];
  return { ...stack, [a.kind]: (w * ha) / sum, [b.kind]: (w * (sum - ha)) / sum };
}

// ---------------------------------------------------------------- the page

const $ = (id: string) => document.getElementById(id);
const store = {
  read(): Sizes {
    try {
      const o = JSON.parse(localStorage.getItem(SIZES) ?? "{}");
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  },
  write(s: Sizes): void {
    try {
      localStorage.setItem(SIZES, JSON.stringify(s));
    } catch {
      // not kept: the sizes hold while the page is open
    }
  },
};
let sizes: Sizes = typeof localStorage === "object" ? store.read() : {};

const WINDOWS = "#windows > :is(.sw-win, .pw-win, #following.talking):not([hidden])";
const kindOf = (el: Element): Kind => (el.classList.contains("sw-win") ? "source" : el.classList.contains("pw-win") ? "paper" : "talk");
const paneOpen = () => ["panel", "activity", "lostfound"].some((id) => $(id)?.classList.contains("open"));

/** the work area as it stands, and the windows it holds */
function current(): { area: Area; els: HTMLElement[] } {
  const els = [...document.querySelectorAll<HTMLElement>(WINDOWS)];
  const wins = els.map((el) => ({ kind: kindOf(el), collapsed: el.classList.contains("collapsed"), pillW: el.classList.contains("collapsed") ? el.offsetWidth || undefined : undefined }));
  return { area: workArea({ w: innerWidth, h: innerHeight }, sizes, paneOpen(), wins), els };
}

let splitEls: HTMLElement[] = [];
let resizedHook: (() => void) | null = null;

/** Each window where the work area puts it, the splitters at their edges, the page's variables;
 *  then the board's room, as the canvas's insets (web/src/main.ts) take it. Null off a monitor. */
export function monitorInsets(): { left: number; right: number; top: number; bottom: number } | null {
  if (!isMonitor()) return null;
  const { area, els } = current();
  const body = document.body.style;
  const { low } = sized(sizes, { w: innerWidth, h: innerHeight });
  body.setProperty("--mon-low", `${Math.round(low)}px`);
  body.setProperty("--mon-pane-w", `${Math.round(area.panel?.w ?? sized(sizes, { w: innerWidth, h: innerHeight }).panel)}px`);
  body.setProperty("--mon-area", area.top === null ? "none" : "block");
  const room = area.top === null ? EDGE : innerHeight - area.top + GAP;
  body.setProperty("--mon-room-bottom", `${Math.round(room)}px`);
  els.forEach((el, k) => {
    const r = area.wins[k];
    if (!el.classList.contains("mon-docked")) el.classList.add("mon-docked");
    for (const [v, n] of [["--dock-x", r.x], ["--dock-y", r.y], ["--dock-w", r.w], ["--dock-h", r.h]] as const) el.style.setProperty(v, `${Math.round(n)}px`);
  });
  layoutSplits(area, els);
  const bar = $("selbar")!;
  const strip = [$("tm-kept"), $("lensbar")].find((e) => e && !e.hidden);
  const viewbar = $("viewbar")!.getBoundingClientRect().bottom;
  const top = Math.max(!bar.hidden ? bar.getBoundingClientRect().bottom + 12 : 0, strip ? strip.getBoundingClientRect().bottom + 12 : viewbar + 28);
  const side = $("side")!.getBoundingClientRect();
  return { left: side.width ? side.right + GAP : 0, right: 0, top, bottom: room + 36 };
}

/** The board's room, for the tour's spotlight (web/src/guide.ts); null off a monitor. */
export function monitorRoom(): DOMRect | null {
  const i = monitorInsets();
  if (!i) return null;
  return new DOMRect(i.left + EDGE, i.top, Math.max(40, innerWidth - i.left - i.right - 2 * EDGE), Math.max(40, innerHeight - i.top - i.bottom));
}

/** The splitters where the work area has them; a drag sets what each moves, a double-click gives it
 *  its own size again, and this browser keeps it. */
function layoutSplits(area: Area, els: HTMLElement[]): void {
  while (splitEls.length < area.splits.length) {
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.addEventListener("pointerdown", (e) => drag(el, e));
    el.addEventListener("dblclick", () => {
      const sp = (el as SplitEl).split;
      if (!sp) return;
      if (sp.kind === "low") sizes = { ...sizes, low: undefined };
      else if (sp.kind === "panel") sizes = { ...sizes, panel: undefined };
      else sizes = { ...sizes, stack: undefined };
      store.write(sizes);
      changed();
    });
    document.body.append(el);
    splitEls.push(el);
  }
  splitEls.forEach((el, k) => {
    const sp = area.splits[k];
    el.hidden = !sp;
    (el as SplitEl).split = sp;
    (el as SplitEl).els = els;
    if (!sp) return;
    el.className = `mon-split mon-split-${sp.kind === "panel" ? "x" : "y"}`;
    Object.assign(el.style, { left: `${sp.rect.x}px`, top: `${sp.rect.y}px`, width: `${sp.rect.w}px`, height: `${sp.rect.h}px` });
  });
}
type SplitEl = HTMLElement & { split?: Split; els?: HTMLElement[] };

function drag(el: SplitEl, e: PointerEvent): void {
  const sp = el.split;
  if (!sp || e.button !== 0) return;
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  el.classList.add("on");
  const vp = { w: innerWidth, h: innerHeight };
  const start = sized(sizes, vp);
  const from = sp.kind === "panel" ? e.clientX : e.clientY;
  const pair = sp.between && el.els ? sp.between.map((i) => ({ kind: kindOf(el.els![i]), h: el.els![i].getBoundingClientRect().height })) : null;
  const move = (ev: PointerEvent) => {
    const d = (sp.kind === "panel" ? ev.clientX : ev.clientY) - from;
    if (sp.kind === "low") sizes = { ...sizes, low: (start.low - d) / vp.h };
    else if (sp.kind === "panel") sizes = { ...sizes, panel: start.panel + d };
    else if (pair) sizes = { ...sizes, stack: restack(start.stack, pair[0], pair[1], d) };
    changed(false);
  };
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.classList.remove("on");
    store.write(sizes);
    changed();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", end, { once: true });
  el.addEventListener("pointercancel", end, { once: true });
}

/** The sizes changed: the board's room follows, and the windows' contents their new size. */
function changed(settled = true): void {
  resizedHook?.();
  if (settled) dispatchEvent(new Event("resize"));
}

export interface MonitorHooks {
  /** the board's room changed: the canvas's insets follow (web/src/main.ts) */
  resized(): void;
}

/** The work area on the page: laid out again as windows come, go, collapse or open, and as the
 *  screen crosses MONITOR's line, where the windows go back to their own places. */
export class MonitorLayout {
  constructor(hooks: MonitorHooks) {
    resizedHook = () => hooks.resized();
    const windows = $("windows");
    if (windows)
      new MutationObserver((ms) => {
        if (isMonitor() && ms.some((m) => (m.type === "childList" ? m.target === windows : m.target.parentNode === windows))) hooks.resized();
      }).observe(windows, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
    if (typeof matchMedia === "function")
      matchMedia(MONITOR).addEventListener("change", () => {
        if (!isMonitor()) {
          // off a monitor: each window at its own place again, no splitter
          for (const el of document.querySelectorAll<HTMLElement>(".mon-docked")) {
            el.classList.remove("mon-docked");
            for (const v of ["--dock-x", "--dock-y", "--dock-w", "--dock-h"]) el.style.removeProperty(v);
          }
          for (const el of splitEls) el.hidden = true;
        }
        setTimeout(() => changed(), 0);
      });
  }
}
