// The conversation window (CollabSpec decision 13, the owner's decisions of 2026-10-19): one window,
// the reader's own, holding the conversations (web/src/talk.ts). The reader opens and closes it —
// the top bar's conversation button, Talk in an agent's menu, a click on a mention's notice — and
// nothing else does: following never opens, closes or changes it. It is a floating window
// (web/src/floatwin.ts): the reader moves it by its title bar, resizes it from any edge or corner,
// and collapses it — its button, or a double-click on the title bar — to a one-line pill: the channel
// on show and the start of its last message. A message that comes while it is collapsed lights the
// pill a moment and leaves a mark on it; a click on the pill opens the window again.
//
// It is in front of the source and reference windows, always (ReviewSpec, "In front"): a layer of its
// own above theirs (style.css), never in their order; hover cards, popovers, modal windows and
// transient messages lie above it. So opening a source window, or following someone whose windows
// open, never hides it, and nothing there needs closing to find it.
//
// It starts at the bottom left of the canvas, beside the side panel (the canvas's insets), level
// with the panel's foot; below 900 px, collapsed. Where the reader puts it, its size, whether it is
// collapsed, and whether it is open are a reading preference kept in this browser
// (web/src/store.ts). On a phone and a tall screen it docks in the sheet's place, on an upright
// monitor in the work area's column (PhoneSpec decisions 21 and 34), as the source windows do.

import { clampRect, EDGE, FloatWindow, readKept, readPlace, rectOf } from "./floatwin.ts";
import type { Kept, Rect, Size } from "./floatwin.ts";
import type { Store } from "./store.ts";

/** the smallest the reader can make the window, viewport permitting */
export const MIN: Size = { w: 300, h: 220 };
/** its size at first */
export const DEFAULT: Size = { w: 440, h: 420 };
/** the side panel's foot, from the viewport's bottom (#side in web/style.css): the window starts
 *  level with it */
export const FOOT = 56;
/** below this width the window starts collapsed */
export const NARROW = 900;

/** Where the window starts: at the bottom left of the canvas — beside the side panel (`insets.left`,
 *  over it where there is no room beside it), level with its foot, under the bars (`insets.top`) —
 *  DEFAULT large where it fits. */
export function defaultRect(vp: Size, insets: { left: number; top: number }): Rect {
  const left = Math.max(insets.left, EDGE);
  const x = vp.w - left - EDGE >= MIN.w ? left : EDGE;
  const w = Math.min(DEFAULT.w, vp.w - x - EDGE);
  const foot = vp.h - FOOT;
  const h = Math.min(DEFAULT.h, Math.max(foot - Math.max(insets.top, EDGE), MIN.h));
  return clampRect({ x, y: foot - h, w, h }, vp, MIN);
}

/** The window as this browser keeps it, in this viewport: where the reader put it, else where it
 *  starts; collapsed as they left it, else collapsed on a narrow screen. */
export function restore(kept: unknown, vp: Size, insets: { left: number; top: number }): { rect: Rect; collapsed: boolean } {
  const k = kept && typeof kept === "object" ? (kept as Record<string, unknown>) : {};
  const place = readPlace(k.place);
  return {
    rect: place ? rectOf(place, vp, MIN) : defaultRect(vp, insets),
    collapsed: typeof k.collapsed === "boolean" ? k.collapsed : vp.w < NARROW,
  };
}

export interface ChatWindowHooks {
  /** the canvas's insets (web/src/main.ts): the side panel's right, the bars' foot */
  insets(): { left: number; top: number };
  /** the window opened, or was opened again from its pill: the thread shows */
  expanded(): void;
  /** the reader closed it, or opened it */
  toggled(open: boolean): void;
}

const viewport = (): Size => ({ w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight });

/** The conversation window: `#convo`. */
export class ChatWindow {
  private el: HTMLElement;
  private store: Store;
  private hooks: ChatWindowHooks;
  private win: FloatWindow;
  private shown = false;

  constructor(el: HTMLElement, store: Store, hooks: ChatWindowHooks) {
    this.el = el;
    this.store = store;
    this.hooks = hooks;
    this.win = new FloatWindow(el, {
      min: MIN,
      handle: ".cv-head",
      collapser: "[data-collapse]",
      opener: ".fl-pill-open",
      keeper: {
        read: () => this.store.data.chat,
        write: (change: Kept) => {
          this.store.data.chat = { ...readKept(this.store.data.chat), ...change };
          this.store.save();
        },
      },
      keepsCollapsed: true,
      // its own layer, above the source and reference windows' order (ReviewSpec, "In front")
      onTop: true,
      start: (vp) => defaultRect(vp, this.hooks.insets()),
      live: () => this.shown,
      collapsed: (on) => {
        if (on) return;
        el.classList.remove("unseen", "flash");
        this.hooks.expanded();
      },
    });
    el.addEventListener("animationend", (e) => {
      if (e.target === el && e.animationName === "fl-flash") el.classList.remove("flash");
    });
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-cv-close]")) this.close();
    });
  }

  /** Whether it is open, collapsed or not. */
  get open(): boolean {
    return this.shown;
  }

  get collapsed(): boolean {
    return this.win.collapsed;
  }

  /** Whether the reader sees its thread now: open, not collapsed, the page in front. */
  get reading(): boolean {
    return this.shown && !this.win.collapsed && !document.hidden;
  }

  /** Open it, as kept (collapsed or not, where the reader put it); `expand`: expanded whatever was
   *  kept, as asked for from a menu or a notice. */
  show(expand = false): void {
    if (!this.shown) {
      this.shown = true;
      this.el.hidden = false;
      this.win.setCollapsed(restore(this.store.data.chat, viewport(), this.hooks.insets()).collapsed);
      this.keepOpen(true);
      this.hooks.toggled(true);
    }
    if (expand && this.win.collapsed) this.win.collapse(false);
    this.win.layout();
    if (!this.win.collapsed) this.hooks.expanded();
  }

  /** The reader closed it: its ✕, or the conversation button again. */
  close(): void {
    if (!this.shown) return;
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.shown = false;
    this.el.hidden = true;
    this.el.classList.remove("unseen", "flash");
    this.win.reset();
    this.keepOpen(false);
    this.hooks.toggled(false);
  }

  /** Put the window where it is kept, in the viewport as it is now (it changed, or the insets did). */
  layout(): void {
    this.win.layout();
  }

  /** Collapse the window to its pill, or open it again; the reader's choice is kept. */
  collapse(on: boolean): void {
    this.win.collapse(on);
  }

  /** Something new came while it is collapsed: the pill lights a moment and keeps a mark until it
   *  is opened. */
  replied(): void {
    if (!this.shown || !this.collapsed) return;
    this.el.classList.add("unseen");
    this.el.classList.remove("flash");
    void this.el.offsetWidth;
    this.el.classList.add("flash");
  }

  /** What came is seen: the pill's mark goes. */
  markSeen(): void {
    this.el.classList.remove("unseen");
  }

  private keepOpen(on: boolean): void {
    this.store.data.chatOpen = on || undefined;
    this.store.save();
  }
}
