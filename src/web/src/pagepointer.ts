// Pointers in a room (CollabSpec decision 4; the owner's decisions of 2026-10-20; web/src/pointers.ts):
// this page's pointer and text selection said to the others of its room while it is in one, and theirs
// drawn here, each found again on this page's layout.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { personKey } from "../../shared/collab.ts";
import { Pointers } from "./pointers.ts";
import { inYours } from "./surfaces.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** What the pointers give the page's other parts. */
export interface PointerPart {
  pointers: Pointers;
}

export function pointerPart(page: Page): PointerPart {
  const { data } = page;
  const board = () => $("#canvas").getBoundingClientRect();
  const pointers = new Pointers($("#pointers"), {
    toWorld: (x, y) => {
      const r = board();
      return page.canvas.toWorld(x - r.left, y - r.top);
    },
    toScreen: (x, y) => {
      const r = board();
      const [sx, sy] = page.canvas.toScreen(x, y);
      return [sx + r.left, sy + r.top];
    },
    // the room the bars and panels leave the board: a point under them is not drawn over them
    boardRoom: () => {
      const r = board();
      const i = page.canvas.screen.insets;
      return { left: r.left + i.left, top: r.top + i.top, right: r.right - i.right, bottom: r.bottom - i.bottom };
    },
    linear: () =>
      page.linear.shown
        ? { at: (x, y) => page.linear.pointAt(x, y), screenOf: (p) => page.linear.screenOf(p), room: () => page.linear.room(), reveal: (k) => page.linear.reveal(k) }
        : null,
    windowDecl: (el) => page.sources.all.find((w) => w.el === el)?.name ?? null,
    // the window open on it, the following one first; a collapsed one is a pill, which holds no code
    windowOf: (decl) => {
      const all = page.sources.all.filter((w) => w.name === decl);
      return (all.find((w) => !w.collapsed) ?? all[0])?.el ?? null;
    },
    yours: (el) => inYours(el),
    stream: () => (page.people.stream ? { token: page.people.stream.token, id: page.people.stream.id } : null),
    me: () => {
      const s = page.people.stream;
      if (!s) return null;
      const me = page.people.listed;
      return { id: s.id, key: me && !page.people.isPrivate && !page.reader ? personKey(me) : null, follows: page.people.followedKey };
    },
    peers: () => page.people.peers,
    privateFollowers: () => page.people.privateFollowing,
    readOnly: () => !!page.reader,
    send: (body) => data.pointer(body),
  });
  if (!data.snapshot) {
    // where the pointer is, and its presses; off the page; the text selected
    window.addEventListener("pointermove", (e) => pointers.moved(e.clientX, e.clientY, e.target instanceof Element ? e.target : null), { capture: true, passive: true });
    window.addEventListener("pointerdown", (e) => pointers.moved(e.clientX, e.clientY, e.target instanceof Element ? e.target : null, true), { capture: true, passive: true });
    document.documentElement.addEventListener("pointerleave", () => pointers.left());
    document.addEventListener("selectionchange", () => pointers.selected());
  }
  return { pointers };
}
