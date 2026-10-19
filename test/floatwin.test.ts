// The floating windows (web/src/floatwin.ts), shared by the conversation's window and the source
// windows. Their geometry: a rect clamped to the viewport and snapped to its edges, moved and
// resized within it; a place kept by its nearer edges and read back; a window opened a step aside
// from another; the windows' order. The conversation window's least size (web/src/chatwin.ts) is
// the one these were first written for. And a window driven in a page made of just enough
// (test/fakedom.ts): a source window opening in the middle of the screen, fitted to its code, fitted
// again while the reader has not touched it, keeping their place once they have, and nothing of it
// kept for the next; the conversation's window, kept where the reader put it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { CASCADE, cascadeRect, clampRect, EDGE, FloatWindow, insideRect, moveRect, onTop, placeOf, raise, readKept, readPlace, rectOf, resizeRect, snapRect, underRect } from "../src/web/src/floatwin.ts";
import type { FloatOptions, Kept, Rect } from "../src/web/src/floatwin.ts";
import { MIN } from "../src/web/src/chatwin.ts";
import { MIN as SRC_MIN, openBounds, openRect } from "../src/web/src/sources.ts";
import { drag, fakePage, FakeEl, observers } from "./fakedom.ts";

const VP = { w: 1440, h: 900 };

test("a rect is brought inside the viewport, a margin from its edges, between the least and the most", () => {
  // inside already: untouched
  assert.deepEqual(clampRect({ x: 300, y: 200, w: 440, h: 380 }, VP, MIN), { x: 300, y: 200, w: 440, h: 380 });
  // off the right and bottom edges: brought back, a margin from them
  assert.deepEqual(clampRect({ x: 1300, y: 800, w: 440, h: 380 }, VP, MIN), { x: VP.w - EDGE - 440, y: VP.h - EDGE - 380, w: 440, h: 380 });
  // off the left and top
  assert.deepEqual(clampRect({ x: -200, y: -50, w: 440, h: 380 }, VP, MIN), { x: EDGE, y: EDGE, w: 440, h: 380 });
  // larger than the viewport: the viewport less its margins
  assert.deepEqual(clampRect({ x: 0, y: 0, w: 3000, h: 2000 }, VP, MIN), { x: EDGE, y: EDGE, w: VP.w - 2 * EDGE, h: VP.h - 2 * EDGE });
  // smaller than the least: the least
  assert.deepEqual(clampRect({ x: 100, y: 100, w: 50, h: 20 }, VP, MIN), { x: 100, y: 100, w: MIN.w, h: MIN.h });
  // a viewport narrower than the least window: as wide as the viewport less its margins
  const phone = { w: 300, h: 560 };
  const r = clampRect({ x: 40, y: 40, w: 440, h: 380 }, phone, MIN);
  assert.equal(r.w, 300 - 2 * EDGE);
  assert.equal(r.x, EDGE);
  assert.ok(r.x + r.w <= phone.w && r.y + r.h <= phone.h);
});

test("near an edge the window snaps to it; further off it stays where it was put", () => {
  assert.deepEqual(snapRect({ x: EDGE + 8, y: 300, w: 440, h: 380 }, VP), { x: EDGE, y: 300, w: 440, h: 380 });
  // the right and bottom edges
  const r = snapRect({ x: VP.w - EDGE - 440 - 5, y: VP.h - EDGE - 380 - 10, w: 440, h: 380 }, VP);
  assert.deepEqual(r, { x: VP.w - EDGE - 440, y: VP.h - EDGE - 380, w: 440, h: 380 });
  // 40 px off: no snap
  assert.deepEqual(snapRect({ x: EDGE + 40, y: EDGE + 40, w: 440, h: 380 }, VP), { x: EDGE + 40, y: EDGE + 40, w: 440, h: 380 });
});

test("moving the window keeps it inside the viewport and snaps it", () => {
  const start = { x: 288, y: 464, w: 440, h: 380 };
  assert.deepEqual(moveRect(start, 400, -250, VP, MIN), { x: 688, y: 214, w: 440, h: 380 });
  // dragged far beyond the left edge: on it
  assert.deepEqual(moveRect(start, -1000, 0, VP, MIN), { x: EDGE, y: 464, w: 440, h: 380 });
  // dragged to a few pixels from the bottom: onto it
  assert.equal(moveRect(start, 0, VP.h - EDGE - 380 - 464 - 6, VP, MIN).y, VP.h - EDGE - 380);
});

test("resizing moves the edges dragged and keeps the others, between the least and the viewport", () => {
  const start = { x: 288, y: 214, w: 440, h: 380 };
  // the bottom-right corner
  assert.deepEqual(resizeRect(start, "se", 120, 160, VP, MIN), { x: 288, y: 214, w: 560, h: 540 });
  // the left edge pushed past the least width: the right edge stays
  const narrow = resizeRect(start, "w", 400, 0, VP, MIN);
  assert.deepEqual(narrow, { x: 288 + 440 - MIN.w, y: 214, w: MIN.w, h: 380 });
  // the top edge pulled up beyond the viewport: at its margin, the bottom staying
  const tall = resizeRect(start, "n", 0, -1000, VP, MIN);
  assert.deepEqual(tall, { x: 288, y: EDGE, w: 440, h: 214 + 380 - EDGE });
  // the right edge pulled beyond the viewport: at its margin
  assert.equal(resizeRect(start, "e", 5000, 0, VP, MIN).w, VP.w - EDGE - 288);
  // the moving edge snaps to the viewport's edge when near it
  const nearRight = VP.w - EDGE - (288 + 440) - 8;
  assert.equal(resizeRect(start, "e", nearRight, 0, VP, MIN).w, VP.w - EDGE - 288);
  // the top-left corner shrunk below the least: the least, from the bottom-right corner
  assert.deepEqual(resizeRect(start, "nw", 500, 500, VP, MIN), { x: 288 + 440 - MIN.w, y: 214 + 380 - MIN.h, w: MIN.w, h: MIN.h });
  // an edge that is not dragged is not moved
  assert.deepEqual(resizeRect(start, "s", 50, 20, VP, MIN), { x: 288, y: 214, w: 440, h: 400 });
});

test("a place is kept by its nearer edges, and keeps to its corner in another viewport", () => {
  const vp = VP;
  // at the bottom right
  const r = { x: 948, y: 214, w: 300, h: 540 };
  const p = placeOf(r, vp);
  assert.deepEqual(p, { x: 192, y: 146, w: 300, h: 540, right: true, bottom: true });
  assert.deepEqual(rectOf(p, vp, MIN), r);
  // the same distance from the right and the bottom in a smaller viewport
  assert.deepEqual(rectOf(p, { w: 1100, h: 800 }, MIN), { x: 1100 - 192 - 300, y: 800 - 146 - 540, w: 300, h: 540 });
  // at the top left: from the left and the top
  assert.deepEqual(placeOf({ x: 288, y: 120, w: 440, h: 380 }, vp), { x: 288, y: 120, w: 440, h: 380 });
  // in a viewport too short for it: as far from the right, shrunk to fit and brought inside
  const small = rectOf(p, { w: 700, h: 500 }, MIN);
  assert.deepEqual(small, { x: 700 - 192 - 300, y: EDGE, w: 300, h: 500 - 2 * EDGE });
});

test("a window fitted to its content keeps its size: moved inside, however small", () => {
  // inside already: untouched; off the edge: moved in, as large as it is
  assert.deepEqual(insideRect({ x: 300, y: 200, w: 120, h: 90 }, VP), { x: 300, y: 200, w: 120, h: 90 });
  assert.deepEqual(insideRect({ x: 1400, y: -40, w: 120, h: 90 }, VP), { x: VP.w - EDGE - 120, y: EDGE, w: 120, h: 90 });
});

test("what is kept of a window kind is read back with care: its place, whether collapsed", () => {
  assert.deepEqual(readKept(undefined), {});
  assert.deepEqual(readKept("x"), {});
  assert.deepEqual(readKept({ place: { x: 1, y: 2, w: 300, h: 300 }, collapsed: false }), { place: { x: 1, y: 2, w: 300, h: 300 }, collapsed: false });
  // what an older page kept beside it is not read; a place that is none is no place
  assert.deepEqual(readKept({ place: { x: 1, y: 2, w: 300, h: 300 }, sized: true }), { place: { x: 1, y: 2, w: 300, h: 300 } });
  assert.deepEqual(readKept({ place: { x: 1, y: 2, w: -3, h: 300 }, collapsed: 1 }), {});
});

test("a window opened beside another goes a step down and to the right of it, a step further for each there already", () => {
  const from = { x: 300, y: 130, w: 640, h: 500 };
  const one = cascadeRect(from, [], VP, MIN);
  assert.deepEqual(one, { x: 300 + CASCADE, y: 130 + CASCADE, w: 640, h: 500 });
  // the next one a step further, not on the first
  const two = cascadeRect(from, [one], VP, MIN);
  assert.deepEqual(two, { x: 300 + 2 * CASCADE, y: 130 + 2 * CASCADE, w: 640, h: 500 });
  // a pinned window moved away frees its step
  assert.deepEqual(cascadeRect(from, [{ ...one, x: 900, y: 300 }], VP, MIN), one);
  // no room below and to the right: up and to the left
  const corner = { x: VP.w - EDGE - 640, y: VP.h - EDGE - 500, w: 640, h: 500 };
  assert.deepEqual(cascadeRect(corner, [], VP, MIN), { ...corner, x: corner.x - CASCADE, y: corner.y - CASCADE });
  // six of them never land on one another
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  for (let k = 0; k < 6; k++) taken.push(cascadeRect(from, taken, VP, MIN));
  for (const a of taken) for (const b of taken) if (a !== b) assert.ok(Math.abs(a.x - b.x) >= CASCADE || Math.abs(a.y - b.y) >= CASCADE);
  // a window as large as the screen has no step to take: it stays on it
  const full = { x: EDGE, y: EDGE, w: VP.w - 2 * EDGE, h: VP.h - 2 * EDGE };
  assert.deepEqual(cascadeRect(full, [], VP, MIN), full);
  // kept under the page's bars (`top`): one as tall as the room under them stays, rather than step
  // up over them; one above them is brought under them first, where it fits
  const top = 108;
  const tall = { x: EDGE, y: top, w: 700, h: VP.h - EDGE - top };
  assert.deepEqual(cascadeRect(tall, [], VP, MIN, top), tall);
  assert.deepEqual(cascadeRect({ ...from, y: 40 }, [], VP, MIN, top), { ...from, x: from.x + CASCADE, y: top + CASCADE });
  assert.deepEqual(cascadeRect(corner, [], VP, MIN, top), { ...corner, x: corner.x - CASCADE, y: corner.y - CASCADE });
  // a place the page gave a window, the viewport made lower: under the bars still, no taller than
  // the room there (a pinned window over the tab bar after the page went from 1,080 to 900 px high)
  const pinned = clampRect({ x: 60, y: 108, w: 877, h: 960 }, { w: 1440, h: 900 }, MIN);
  assert.equal(pinned.y, EDGE);
  assert.deepEqual(underRect(pinned, { w: 1440, h: 900 }, top, MIN), { x: 60, y: top, w: 877, h: 900 - EDGE - top });
  assert.deepEqual(underRect(from, VP, top, MIN), from, "under them already");
  assert.deepEqual(underRect({ ...from, y: 20 }, { w: 800, h: 200 }, top, MIN), { ...from, y: 20 }, "no room under them: as it is");
  // on one another: corners less than half a step apart, whatever their sizes
  assert.ok(onTop(from, { ...from, x: from.x + CASCADE / 2 - 1, w: 300 }));
  assert.ok(!onTop(from, one));
});

test("the window pressed last comes to the front, the others keeping their order", () => {
  assert.deepEqual(raise(["a", "b", "c"], "a"), ["b", "c", "a"]);
  assert.deepEqual(raise(["a", "b", "c"], "c"), ["a", "b", "c"]);
  // a window not there yet comes in front
  assert.deepEqual(raise(["a", "b"], "d"), ["a", "b", "d"]);
});

// ---------------------------------------------------------------- a window in a page

const resizeTo = fakePage(VP);

/** A source window as web/src/sourcewin.ts makes one: fitted to its code by its rule, kept nowhere;
 *  `content`, the size its code gives it. */
function sourceWindow(content: { w: number; h: number }, pinned: () => Rect[] = () => []) {
  const el = new FakeEl("div", "sw-win");
  const head = new FakeEl("div", "sw-head");
  el.append(head);
  el.content = content;
  const opts: FloatOptions = {
    min: SRC_MIN,
    handle: ".sw-head",
    collapser: "[data-sw-collapse]",
    opener: ".sw-pill-open",
    keeper: null,
    fit: { bounds: openBounds, at: (size, vp) => openRect(size, vp, pinned()) },
    live: () => true,
  };
  const win = new FloatWindow(el as unknown as HTMLElement, opts);
  const ro = observers[observers.length - 1];
  win.layout();
  /** the code drawn changed size: the window is told, as a ResizeObserver tells it */
  const content2 = (c: { w: number; h: number }) => {
    el.content = c;
    ro.fire();
  };
  return { el, head, win, content: content2 };
}

const centred = (w: number, h: number): Rect => ({ x: (VP.w - w) / 2, y: (VP.h - h) / 2, w, h });

test("a source window opens in the middle of the screen, as large as its code, within the modal's bounds", () => {
  const { el, win } = sourceWindow({ w: 800, h: 420 });
  assert.deepEqual(win.rect, centred(800, 420));
  // its size is its code's, between the least and the most, which the page sets for it
  assert.equal(el.style.width, "max-content");
  assert.equal(el.style.maxWidth, `${Math.round(0.92 * VP.w)}px`);
  assert.equal(el.style.maxHeight, `${Math.round(0.88 * VP.h)}px`);
  assert.equal(el.style.left, `${(VP.w - 800) / 2}px`);
  // code larger than the screen: at most 92 % × 88 % of it, in the middle
  const big = sourceWindow({ w: 3000, h: 2000 });
  assert.deepEqual(big.win.rect, centred(Math.round(0.92 * VP.w), Math.round(0.88 * VP.h)));
  // a few short lines: never smaller than its least
  const small = sourceWindow({ w: 200, h: 60 });
  assert.deepEqual(small.win.rect, centred(560, SRC_MIN.h));
  // a phone: no larger than the screen less its margins
  const b = openBounds({ w: 360, h: 640 });
  assert.ok(b.max.w <= 360 - 2 * EDGE && b.min.w === b.max.w);
});

test("untouched, it is fitted again and centred for each declaration; moved or resized, it keeps the reader's place and size until it goes", () => {
  const { el, head, win, content } = sourceWindow({ w: 800, h: 420 });
  // the next declaration, and the next: fitted to each, in the middle
  content({ w: 1000, h: 600 });
  assert.deepEqual(win.rect, centred(1000, 600));
  content({ w: 640, h: 300 });
  assert.deepEqual(win.rect, centred(640, 300));
  // moved by its title bar: where the reader put it, as large as it was
  drag(head, -200, -100);
  const moved = { x: (VP.w - 640) / 2 - 200, y: (VP.h - 300) / 2 - 100, w: 640, h: 300 };
  assert.deepEqual(win.rect, moved);
  assert.equal(el.style.width, "640px", "its size is set, no longer its code's");
  // another declaration: the window stays where it is, as large as it is
  content({ w: 1200, h: 700 });
  assert.deepEqual(win.rect, moved);
  // collapsed to its pill and opened again: the same place and size
  win.collapse(true);
  win.collapse(false);
  assert.deepEqual(win.rect, moved);
  // resized from a corner: as large as the reader makes it, and so it stays
  const r = sourceWindow({ w: 800, h: 420 });
  drag(r.el.edge("se"), 100, 80);
  assert.deepEqual(r.win.rect, { ...centred(800, 420), w: 900, h: 500 });
  r.content({ w: 600, h: 200 });
  assert.deepEqual(r.win.rect, { ...centred(800, 420), w: 900, h: 500 });
  // the next opening is a new window: in the middle, fitted again — nothing of the last is kept
  const next = sourceWindow({ w: 700, h: 380 });
  assert.deepEqual(next.win.rect, centred(700, 380));
});

test("collapsed while untouched, it opens again where it was; the screen resized, it is in its middle again", () => {
  const { win } = sourceWindow({ w: 800, h: 420 });
  win.collapse(true);
  assert.deepEqual(win.rect, centred(800, 420));
  win.collapse(false);
  assert.deepEqual(win.rect, centred(800, 420));
  resizeTo({ w: 1200, h: 800 });
  assert.deepEqual(win.rect, { x: 200, y: 190, w: 800, h: 420 });
  resizeTo(VP);
  assert.deepEqual(win.rect, centred(800, 420));
});

test("a following window that would lie on a pinned one steps aside, so that the pinned one stays in sight", () => {
  // a pinned window where the new one would open: a step down and to the right of it
  const pinned = centred(800, 420);
  const { win } = sourceWindow({ w: 800, h: 420 }, () => [pinned]);
  assert.deepEqual(win.rect, { ...pinned, x: pinned.x + CASCADE, y: pinned.y + CASCADE });
  // pinned a step aside already, as pinning leaves it: the new one opens in the middle
  const aside = { ...pinned, x: pinned.x + CASCADE, y: pinned.y + CASCADE };
  assert.deepEqual(sourceWindow({ w: 800, h: 420 }, () => [aside]).win.rect, pinned);
  // two there: past both
  const two = sourceWindow({ w: 800, h: 420 }, () => [pinned, aside]).win.rect;
  assert.deepEqual(two, { ...pinned, x: pinned.x + 2 * CASCADE, y: pinned.y + 2 * CASCADE });
});

test("the conversation's window is kept where the reader put it, from one opening to the next", () => {
  let kept: Kept = {};
  const keeper = { read: () => kept, write: (c: Kept) => (kept = { ...kept, ...c }) };
  const make = () => {
    const el = new FakeEl("div", "talking");
    const strip = new FakeEl("div", "fl-strip");
    el.append(strip);
    const win = new FloatWindow(el as unknown as HTMLElement, {
      min: MIN,
      handle: ".fl-strip",
      collapser: "[data-collapse]",
      opener: ".fl-pill-open",
      keeper,
      start: () => ({ x: 288, y: 464, w: 440, h: 380 }),
      live: () => true,
    });
    win.layout();
    return { win, strip };
  };
  const first = make();
  assert.deepEqual(first.win.rect, { x: 288, y: 464, w: 440, h: 380 });
  drag(first.strip, 300, -200);
  assert.deepEqual(kept.place, placeOf({ x: 588, y: 264, w: 440, h: 380 }, VP));
  // opened again, or on a page loaded again: where it was put
  assert.deepEqual(make().win.rect, { x: 588, y: 264, w: 440, h: 380 });
});

test("the conversation window is in front of the others always (ReviewSpec, \"In front\"): never in their order, whichever was pressed last", () => {
  const conv = new FakeEl("div", "convo");
  conv.append(new FakeEl("div", "cv-head"));
  const top = new FloatWindow(conv as unknown as HTMLElement, { min: MIN, handle: ".cv-head", collapser: "[data-collapse]", opener: ".fl-pill-open", keeper: null, onTop: true, start: () => ({ x: 288, y: 464, w: 440, h: 380 }), live: () => true });
  top.layout();
  const a = sourceWindow({ w: 600, h: 400 });
  const b = sourceWindow({ w: 500, h: 300 });
  // pressed, a source window comes in front of the other, and gets a place in their order
  b.win.front();
  a.win.front();
  assert.ok(Number(a.el.style.zIndex) > Number(b.el.style.zIndex));
  // the conversation window pressed: it takes no place in their order (its layer is style.css's,
  // above theirs), and theirs stays as it was
  const order = [a.el.style.zIndex, b.el.style.zIndex];
  top.front();
  conv.dispatch({ type: "pointerdown" });
  assert.equal(conv.style.zIndex ?? "", "", "no z-index of the order's");
  assert.deepEqual([a.el.style.zIndex, b.el.style.zIndex], order);
  // and the stylesheet puts its layer above every place in that order
  const css = readFileSync(new URL("../src/web/style.css", import.meta.url), "utf8");
  assert.match(css, /#windows > #convo \{ z-index: 1000; \}/);
  a.win.dispose();
  b.win.dispose();
  top.dispose();
});
