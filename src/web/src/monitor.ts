// An upright monitor with a mouse (the owner's correction of 2026-10-18 to PhoneSpec's tall screens):
// prototypes of three layouts, for the owner to choose from — not decided, and not in the spec yet.
// A monitor turned on its side has room and a fine pointer: a desktop's page, its height used, not a
// phone's drawer and sheet. Each keeps every desktop affordance (popovers, hover, the menus, the
// keys); they differ in where the side panel, the panel and the windows go.
//
// - a, the desktop reflowed: the side panel down the left, the whole height; the panel a pane under
//   the board, the board's width, its height the splitter's; the windows float as on a desktop and
//   open in the pane's place, over it, the board staying in sight.
// - b, the board above, a work area below: the side panel at the board's left; across the bottom,
//   panes side by side — the panel (or Activity, the lost-and-found in its place), each open window
//   — with splitters between them and above them; the windows do not float there.
// - c, the board above, the desktop below: the board the screen's whole width; under it, the side
//   panel at the left and the panel at the right as on a desktop, the windows floating between them.
//
// Chosen by `?monitor=a|b|c` (kept in this browser; `?monitor=0` forgets it), on a screen MONITOR
// matches (web/src/phone.ts); 0.4.3's tall page everywhere else. While one is on show the root
// carries `data-monitor`, the tall page's rules give way (style.css), and a small switch at the
// bottom of the screen goes from one to another.

import type { Rect, Size } from "./floatwin.ts";
import { MONITOR } from "./phone.ts";

export type MonitorOption = "a" | "b" | "c";
const OPTIONS: readonly MonitorOption[] = ["a", "b", "c"];
const KEY = "visualproof:monitor-layout";
const SIZES = "visualproof:monitor-sizes";
const EDGE = 12;
const GAP = 8;

const matches = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
const $ = (id: string) => document.getElementById(id);
const open = (id: string) => !!$(id)?.classList.contains("open");
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      // not kept: the page works as asked all the same
    }
  },
};

/** The option asked for: the URL's, which this browser keeps, else the one it kept. */
function asked(): { option: MonitorOption | null; prototyping: boolean } {
  let v: string | null = null;
  try {
    v = new URLSearchParams(location.search).get("monitor");
  } catch {
    // no URL to read: none asked
  }
  if (v !== null) store.set(KEY, OPTIONS.includes(v as MonitorOption) ? v : null);
  else v = store.get(KEY);
  return { option: OPTIONS.includes(v as MonitorOption) ? (v as MonitorOption) : null, prototyping: v !== null };
}
let wanted: { option: MonitorOption | null; prototyping: boolean } = typeof location === "object" ? asked() : { option: null, prototyping: false };

/** The option on show: one asked for, on an upright monitor. */
export function monitorOption(): MonitorOption | null {
  return wanted.option && matches(MONITOR) ? wanted.option : null;
}

/** The windows are panes of the work area (option b): placed there, not dragged. */
export function windowsDocked(): boolean {
  return monitorOption() === "b";
}

/** The sizes the reader gave the parts, per option, in px: the lower part's height, the side panel's
 *  and the panel's widths (b, c). */
interface Sizes {
  low?: number;
  side?: number;
  panel?: number;
}
let sizes: Partial<Record<MonitorOption, Sizes>> = (() => {
  try {
    return JSON.parse(store.get(SIZES) ?? "{}") ?? {};
  } catch {
    return {};
  }
})();

/** The parts' sizes for option `o` on a screen of `vp`: the reader's, within bounds, else the
 *  option's own. */
function sizesOf(o: MonitorOption, vp: Size): Required<Sizes> {
  const k = sizes[o] ?? {};
  const low = { a: 0.42, b: 0.45, c: 0.45 }[o] * vp.h;
  const side = o === "c" ? Math.min(340, Math.max(260, vp.w * 0.2)) : 300;
  const panel = o === "b" ? Math.min(720, Math.max(420, vp.w * 0.34)) : Math.min(640, Math.max(400, vp.w * 0.3));
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return {
    low: clamp(k.low ?? low, vp.h * 0.25, vp.h - 420),
    side: clamp(k.side ?? side, 220, vp.w * 0.4),
    panel: clamp(k.panel ?? panel, 340, vp.w * 0.5),
  };
}

/** Where the board's room is, as the canvas's insets (web/src/main.ts) take it; null where no
 *  option is on show. Also sets what the page's style places by: `--mon-low`, `--mon-side-w`,
 *  `--mon-panel-w`, `--mon-room-bottom` (the foot of the board's room, for the legend and the zoom's
 *  box), and lays the splitters out. */
export function monitorInsets(): { left: number; right: number; top: number; bottom: number } | null {
  const o = monitorOption();
  if (!o) return null;
  const vp = { w: innerWidth, h: innerHeight };
  const s = sizesOf(o, vp);
  const body = document.body.style;
  body.setProperty("--mon-low", `${Math.round(s.low)}px`);
  body.setProperty("--mon-side-w", `${Math.round(s.side)}px`);
  body.setProperty("--mon-panel-w", `${Math.round(s.panel)}px`);
  const bar = $("selbar")!;
  const strip = [$("lensbar"), $("tm-kept")].find((e) => e && !e.hidden);
  const viewbar = $("viewbar")!.getBoundingClientRect().bottom;
  const top = Math.max(!bar.hidden ? bar.getBoundingClientRect().bottom + 12 : 0, strip ? strip.getBoundingClientRect().bottom + 12 : viewbar + 28);
  // option a keeps the pane's room only while something is in it; b and c keep their lower part
  const pane = open("panel") || open("activity") || open("lostfound");
  const low = o !== "a" || pane ? s.low + EDGE + GAP : EDGE;
  body.setProperty("--mon-room-bottom", `${Math.round(low)}px`);
  layoutSplitters(o, s, vp, pane);
  const side = $("side")!.getBoundingClientRect();
  return { left: o !== "c" && side.width ? side.right + GAP : 0, right: 0, top, bottom: low + 36 };
}

/** The board's room, for the tour's spotlight (web/src/guide.ts); null where no option is on show. */
export function monitorRoom(): DOMRect | null {
  const i = monitorInsets();
  if (!i) return null;
  return new DOMRect(i.left + EDGE, i.top, Math.max(40, innerWidth - i.left - i.right - 2 * EDGE), Math.max(40, innerHeight - i.top - i.bottom));
}

/** Where a window the reader has not moved opens (web/src/floatwin.ts, and the reference window's
 *  pairing, web/src/paperdock.ts): the lower part — a: the pane's place, right of the side panel
 *  where a source and a reference fit there side by side (810 px), over it otherwise; c: between the
 *  side panel and the panel where they fit there, else across it, over the panels as windows lie
 *  over a desktop's — so that the board stays in sight; null where windows open as on a desktop (no option) or do not float (b). */
export function windowRegion(vp: Size): Rect | null {
  const o = monitorOption();
  if (!o || o === "b") return null;
  const s = sizesOf(o, vp);
  const y = vp.h - EDGE - s.low;
  if (o === "c") {
    // between the side panel and the panel where a pair fits there, else across the lower part
    const panel = ["panel", "activity", "lostfound"].map((id) => $(id)).find((e) => e?.classList.contains("open"))?.getBoundingClientRect();
    const from = EDGE + s.side + GAP, to = panel ? vp.w - EDGE - s.panel - GAP : vp.w - EDGE;
    return to - from >= PAIR_LEAST ? { x: from, y, w: to - from, h: s.low } : { x: EDGE, y, w: vp.w - 2 * EDGE, h: s.low };
  }
  const side = $("side")?.getBoundingClientRect();
  const besideSide = side?.width ? side.right + GAP : EDGE;
  const left = vp.w - besideSide - EDGE >= PAIR_LEAST ? besideSide : EDGE;
  return { x: left, y, w: vp.w - left - EDGE, h: s.low };
}
/** a source and a reference window side by side at their least (web/src/paperdock.ts, PAIR_MIN) */
const PAIR_LEAST = 810;

// ---------------------------------------------------------------- splitters

interface Split {
  el: HTMLElement;
  /** what a drag of `d` px (down or right) does to the sizes it started from */
  drag: (start: Required<Sizes>, d: number) => Sizes;
  axis: "x" | "y";
}
let splits: Split[] = [];
let resizedHook: (() => void) | null = null;

function splitter(axis: "x" | "y", drag: Split["drag"]): Split {
  const el = document.createElement("div");
  el.className = `mon-split mon-split-${axis}`;
  el.setAttribute("aria-hidden", "true");
  const sp: Split = { el, drag, axis };
  el.addEventListener("pointerdown", (e) => {
    const o = monitorOption();
    if (!o || e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("on");
    const start = sizesOf(o, { w: innerWidth, h: innerHeight });
    const from = axis === "x" ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      sizes = { ...sizes, [o]: { ...start, ...sp.drag(start, (axis === "x" ? ev.clientX : ev.clientY) - from) } };
      resizedHook?.();
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.classList.remove("on");
      store.set(SIZES, JSON.stringify(sizes));
      resizedHook?.();
      // the windows take their places in the new room
      dispatchEvent(new Event("resize"));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end, { once: true });
    el.addEventListener("pointercancel", end, { once: true });
  });
  // a double-click gives the parts their own sizes again
  el.addEventListener("dblclick", () => {
    const o = monitorOption();
    if (!o) return;
    sizes = { ...sizes, [o]: {} };
    store.set(SIZES, JSON.stringify(sizes));
    resizedHook?.();
    dispatchEvent(new Event("resize"));
  });
  document.body.append(el);
  return sp;
}

/** Between two windows side by side in b's work area: a drag gives the one at the left its width,
 *  the rest following; a double-click shares the room again. Kept while the page is open. */
let winSplits: HTMLElement[] = [];
function windowSplitters(on: boolean): void {
  const wins = on
    ? [...document.querySelectorAll<HTMLElement>("#windows > :is(.sw-win, .pw-win, #following.talking):not(.collapsed, [hidden])")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((w) => w.r.width)
        .sort((a, b) => a.r.left - b.r.left)
    : [];
  while (winSplits.length < Math.max(0, wins.length - 1)) {
    const el = document.createElement("div");
    el.className = "mon-split mon-split-x";
    el.setAttribute("aria-hidden", "true");
    el.addEventListener("pointerdown", (e) => {
      const left = (el as HTMLElement & { left?: HTMLElement }).left;
      if (!left || e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add("on");
      const w0 = left.getBoundingClientRect().width, x0 = e.clientX;
      const move = (ev: PointerEvent) => {
        left.style.flex = `0 0 ${Math.max(280, w0 + ev.clientX - x0)}px`;
        windowSplitters(true);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", () => (el.removeEventListener("pointermove", move), el.classList.remove("on")), { once: true });
    });
    el.addEventListener("dblclick", () => {
      for (const w of document.querySelectorAll<HTMLElement>("#windows > *")) w.style.flex = "";
      windowSplitters(true);
    });
    document.body.append(el);
    winSplits.push(el);
  }
  winSplits.forEach((el, k) => {
    const a = wins[k], b = wins[k + 1];
    el.hidden = !a || !b;
    if (!a || !b) return;
    (el as HTMLElement & { left?: HTMLElement }).left = a.el;
    Object.assign(el.style, { left: `${a.r.right}px`, top: `${a.r.top}px`, width: `${b.r.left - a.r.right}px`, height: `${a.r.height}px` });
  });
}

/** Each splitter at the edge it moves, shown where that edge is. */
function layoutSplitters(o: MonitorOption, s: Required<Sizes>, vp: Size, pane: boolean): void {
  if (!splits.length) {
    splits = [
      // the lower part's top: dragged down, it is shorter
      splitter("y", (st, d) => ({ low: st.low - d })),
      // the side panel's right edge (c)
      splitter("x", (st, d) => ({ side: st.side + d })),
      // the panel's other edge: its right in b, its left in c
      splitter("x", (st, d) => ({ panel: st.panel + (monitorOption() === "c" ? -d : d) })),
    ];
  }
  const [low, side, panel] = splits;
  const place = (sp: Split, r: Rect | null) => {
    sp.el.hidden = !r;
    if (r) Object.assign(sp.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  };
  const y = vp.h - EDGE - s.low;
  const left = o === "a" ? EDGE + s.side + GAP : EDGE;
  place(low, o !== "a" || pane ? { x: left, y: y - GAP, w: vp.w - left - EDGE, h: GAP } : null);
  place(side, o === "c" ? { x: EDGE + s.side, y, w: GAP, h: s.low } : null);
  const panelOpen = open("panel") || open("activity") || open("lostfound");
  // in b the panel alone takes the work area's width: its edge moves only beside a window
  const beside = !!document.querySelector("#windows > :is(.sw-win, .pw-win, #following.talking):not(.collapsed, [hidden])");
  place(panel, !panelOpen || o === "a" || (o === "b" && !beside) ? null : o === "b" ? { x: EDGE + s.panel, y, w: GAP, h: s.low } : { x: vp.w - EDGE - s.panel - GAP, y, w: GAP, h: s.low });
  // the windows' own, once they stand where the work area puts them
  requestAnimationFrame(() => windowSplitters(monitorOption() === "b"));
}

// ---------------------------------------------------------------- the switch

export interface MonitorHooks {
  /** the board's room changed: the canvas's insets follow (web/src/main.ts) */
  resized(): void;
}

/** The prototypes on the page: the root's mark, kept as the screen turns or the window is resized
 *  across MONITOR's line; and the switch from one to another while they are being chosen. */
export class MonitorLayout {
  private hooks: MonitorHooks;
  private pill: HTMLElement | null = null;

  constructor(hooks: MonitorHooks) {
    this.hooks = hooks;
    resizedHook = () => this.hooks.resized();
    if (typeof matchMedia === "function") matchMedia(MONITOR).addEventListener("change", () => this.apply());
    this.apply();
    // the work area's panes follow the windows that come and go (b)
    const windows = $("windows");
    if (windows)
      new MutationObserver((ms) => {
        if (monitorOption() && ms.some((m) => (m.type === "childList" ? m.target === windows : m.target.parentNode === windows))) this.hooks.resized();
      }).observe(windows, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
  }

  /** The root marked with the option on show, or not; the switch drawn; then the board's room and
   *  the windows' places, once the page has laid itself out. */
  apply(): void {
    const o = mark();
    if (!o) for (const el of [...splits.map((sp) => sp.el), ...winSplits]) el.hidden = true;
    this.drawSwitch();
    setTimeout(() => {
      this.hooks.resized();
      dispatchEvent(new Event("resize"));
    }, 0);
  }

  /** While the layouts are being chosen (one was asked for), on an upright monitor: a pill at the
   *  bottom of the screen — 0.4.3, A, B, C. */
  private drawSwitch(): void {
    if (!wanted.prototyping || !matches(MONITOR)) {
      this.pill?.remove();
      this.pill = null;
      return;
    }
    if (!this.pill) {
      this.pill = document.createElement("div");
      this.pill.id = "monitor-switch";
      this.pill.className = "glass";
      this.pill.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-mon]");
        if (!b) return;
        const v = b.dataset.mon!;
        wanted = { option: OPTIONS.includes(v as MonitorOption) ? (v as MonitorOption) : null, prototyping: true };
        store.set(KEY, wanted.option ?? "0");
        try {
          const u = new URL(location.href);
          u.searchParams.set("monitor", v);
          history.replaceState(history.state, "", u);
        } catch {
          // the address stays; the choice is kept in this browser
        }
        this.apply();
      });
      document.body.append(this.pill);
    }
    const on = wanted.option ?? "0";
    const opt = (v: string, label: string, title: string) => `<button data-mon="${v}" class="${on === v ? "on" : ""}" title="${title}">${label}</button>`;
    this.pill.innerHTML =
      `<span class="mon-l">Monitor layout</span>` +
      opt("0", "0.4.3", "As shipped: the drawer and the sheet") +
      opt("a", "A", "The desktop reflowed: the side panel down the left, the panel a pane under the board") +
      opt("b", "B", "The board above, a work area below: the side panel, the panel and the windows as panes") +
      opt("c", "C", "The board above, the desktop below: the side panel and the panel under the board, windows floating between");
  }
}

/** The root marked with the option on show, or not. */
function mark(): MonitorOption | null {
  const o = monitorOption();
  const root = document.documentElement;
  if (o) root.dataset.monitor = o;
  else delete root.dataset.monitor;
  return o;
}

// marked as the page's code loads, before anything is laid out
if (typeof document === "object") mark();
