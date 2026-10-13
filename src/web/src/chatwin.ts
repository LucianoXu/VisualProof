// The conversation's window (AgentSpec decision 8, the window decided 2026-10-08): following an
// agent that can be talked to, its conversation (web/src/talk.ts) is a floating window
// (web/src/floatwin.ts); pinned, it stays when following ends (web/src/talkpins.ts, the owner's
// decision of 2026-10-12). The reader moves it by its title bar, resizes it from any edge or corner,
// and collapses it — its button, or a double-click on the title bar — to a one-line pill: the
// agent's state and the start of its last message. A reply that comes while it is collapsed lights
// the pill a moment and leaves a mark on it; a click on the pill opens the window again.
//
// It starts at the bottom left of the canvas, beside the side panel (the canvas's insets), level
// with the panel's foot; below 900 px, collapsed. Where the reader puts it, its size and whether it
// is collapsed are a reading preference kept in this browser (web/src/store.ts): one place for every
// agent, apart from the source windows'. It lies among the source windows, in front when it was
// pressed or focused last (decided 2026-10-09), and nothing in it moves when one of them opens.
//
// All of it is inside `#following`, from which the reader's own input never ends following
// (web/src/people.ts): moving, resizing, collapsing, pinning it leaves the reader following.

import { clampRect, EDGE, FloatWindow, readKept, readPlace, rectOf } from "./floatwin.ts";
import type { Kept, Rect, Size } from "./floatwin.ts";
import type { Store } from "./store.ts";

/** the smallest the reader can make the window, viewport permitting */
export const MIN: Size = { w: 300, h: 200 };
/** its size at first */
export const DEFAULT: Size = { w: 440, h: 380 };
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
  /** the window was opened from its pill: the thread shows again */
  expanded(): void;
}

const viewport = (): Size => ({ w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight });

/** The window around a conversation: `#following` while it has one (the `talking` class). */
export class ChatWindow {
  private el: HTMLElement;
  private store: Store;
  private hooks: ChatWindowHooks;
  /** the agent talked to, or null: no window, the strip alone */
  private agent: string | null = null;
  private win: FloatWindow;

  constructor(el: HTMLElement, store: Store, hooks: ChatWindowHooks) {
    this.el = el;
    this.store = store;
    this.hooks = hooks;
    this.win = new FloatWindow(el, {
      min: MIN,
      handle: ".fl-strip",
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
      start: (vp) => defaultRect(vp, this.hooks.insets()),
      live: () => !!this.agent,
      collapsed: (on) => {
        if (on) return;
        el.classList.remove("unseen", "flash");
        this.hooks.expanded();
      },
    });
    el.addEventListener("animationend", (e) => {
      if (e.target === el && e.animationName === "fl-flash") el.classList.remove("flash");
    });
  }

  get collapsed(): boolean {
    return this.win.collapsed;
  }

  /** Where the window is on the screen, while it is one (expanded or its pill); else null. */
  get rect(): Rect | null {
    if (!this.agent) return null;
    const r = this.el.getBoundingClientRect();
    return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  }

  /** The agent this reader talks with now, or null: the window opens, as kept, or closes. Another
   *  agent takes the same window, as it is. */
  show(agent: string | null): void {
    if (agent === this.agent) return;
    const was = this.agent;
    this.agent = agent;
    this.el.classList.toggle("talking", !!agent);
    this.el.classList.remove("unseen", "flash");
    if (!agent) {
      // the pill and the window's buttons go: the keys go back to the page
      if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      this.win.reset();
      return;
    }
    if (!was) {
      this.win.setCollapsed(restore(this.store.data.chat, viewport(), this.hooks.insets()).collapsed);
      // a window that opens comes to the front
      this.win.front();
    }
    this.win.layout();
  }

  /** Put the window where it is kept, in the viewport as it is now (it changed, or the insets did). */
  layout(): void {
    this.win.layout();
  }

  /** The conversation was asked for (a pinned agent's badge, web/src/talkpins.ts): the window
   *  expanded, as the reader's choice, and in front. */
  reveal(): void {
    if (!this.agent) return;
    if (this.collapsed) this.win.collapse(false);
    this.win.front();
  }

  /** Collapse the window to its pill, or open it again; the reader's choice is kept. */
  collapse(on: boolean): void {
    this.win.collapse(on);
  }

  /** The agent replied: collapsed, the pill lights a moment and keeps a mark until it is opened. */
  replied(): void {
    if (!this.agent || !this.collapsed) return;
    this.el.classList.add("unseen");
    this.el.classList.remove("flash");
    void this.el.offsetWidth;
    this.el.classList.add("flash");
  }
}
