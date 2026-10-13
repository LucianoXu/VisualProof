// The reference window paired with a source window (AttachmentSpec decisions 8 and 11, the owner's
// of 2026-10-10 and 2026-10-11): the page's set of source windows says which window the reader
// opened or stepped, by every route, pinned or not (web/src/sources.ts, `shown`), which is when the
// reference window opens that declaration's first link (web/src/paperdock.ts, `pairingStep`); the
// two then stand side by side, the source on the left and the reference on the right, across the
// page over the panels, their edges lined up (`pairArea`, `pairRects`); whenever the pairing opens
// or shows them, they never overlap but where the page is too narrow for both, a window the reader
// placed by hand kept where the other can stand beside it, and the two laid out afresh where it
// cannot (`pairKeeps`, `pairPlaces`); the pairing is always on, and where it opens nothing, the
// source window says why (`unpairedLine`); and nothing about a page's text stops a link from being
// lit by its region (shared/library.ts, `placeOnPage`).

import assert from "node:assert/strict";
import { test } from "node:test";
import { clampRect, EDGE, moveRect, resizeRect } from "../src/web/src/floatwin.ts";
import type { Rect, Size } from "../src/web/src/floatwin.ts";
import { DOCK_GAP, MIN as PAPER_MIN, overlaps, PAIR_MAX, PAIR_MIN, pairArea, pairedSourceMax, pairingStep, pairKeeps, pairPlaces, pairRects, roomBeside, unpairedLine } from "../src/web/src/paperdock.ts";
import { MIN as SOURCE_MIN, Sources } from "../src/web/src/sources.ts";
import { Store } from "../src/web/src/store.ts";
import type { SourcePane } from "../src/web/src/sources.ts";
import { placeOnPage } from "../src/shared/library.ts";
import type { Link, Word } from "../src/shared/library.ts";

const VP = { w: 1600, h: 1000 };

let made = 0;
class Pane implements SourcePane {
  decl = -1;
  name = "";
  collapsed = false;
  pinned = false;
  id = ++made;
  show(i: number) {
    this.decl = i;
    this.name = `D${i}`;
  }
  redrawReview() {}
  pin() {
    this.pinned = true;
  }
  pinAside() {
    this.pinned = true;
  }
  collapse(on: boolean) {
    this.collapsed = on;
  }
  front() {}
  rect(): Rect {
    return { x: 400, y: 100, w: 600, h: 500 };
  }
  holds() {
    return false;
  }
  remove() {}
}

test("every way a source window opens or steps pairs it: Source and Space (again on what it shows too), a step, a comment's code quote, Open in a pinned window; a pinned window as the following one; a followed reader's window", () => {
  const told: [number, number, boolean][] = [];
  const s = new Sources<Pane>({ make: () => new Pane(), say: () => {}, changed: () => {}, viewport: () => VP, shown: (p, i) => told.push([p.id, i, p.pinned]) });
  // Source, or Space: opened
  const a = s.show(3);
  // the selection moves (go, a step back or forward, a name clicked in the code, a key): it steps
  s.follow(5);
  s.follow(5);
  s.follow(7);
  // Source again on what it shows: the reader asked for it, so the reference opens again where it
  // was closed
  s.show(7);
  assert.deepEqual(told, [[a.id, 3, false], [a.id, 5, false], [a.id, 7, false], [a.id, 7, false]]);
  told.length = 0;
  // pinned, it stays on its declaration: the next one opened follows, and is the one paired
  s.pin(a);
  s.follow(9);
  assert.deepEqual(told, [], "nothing follows the selection until a window opens");
  const b = s.show(9);
  // Open in a pinned window: a new pinned window, paired
  const c = s.openPinned(11)!;
  // on a declaration a pinned window shows already: that one, in front, paired
  s.openPinned(7);
  // a comment's code quote on a declaration a window shows: that window, shown and paired
  s.reveal(a);
  assert.deepEqual(told, [[b.id, 9, false], [c.id, 11, true], [a.id, 7, true], [a.id, 7, true]]);
  // closed with no declaration selected: nothing to open
  told.length = 0;
  s.follow(null);
  assert.deepEqual(told, []);
  // a followed reader's window: opened, and each step it takes, told as any other (the pairing then
  // pairs nothing, and the window says why)
  s.mirror({ following: { decl: 13, collapsed: false }, pinned: [] });
  s.mirror({ following: { decl: 13, collapsed: false }, pinned: [] });
  s.mirror({ following: { decl: 15, collapsed: false }, pinned: [] });
  const f = s.following!;
  assert.deepEqual(told, [[f.id, 13, false], [f.id, 15, false]]);
});

const link = (id: string, file = "f"): Link => ({ id, subject: "decl(A.b)", file, page: 10, region: [0.1, 0.16, 0.9, 0.36], label: "p. 10", by: "Olivia", at: "2026-10-11T07:46:12.465Z" });

test("the pairing opens the first link, lays the two out afresh when it opens the window or comes to another source window, and keeps what the reader made of them on a step", () => {
  const found = { links: [link("l1"), link("l2")] };
  const recorded = (sha: string) => sha === "f";
  const base = { found, recorded, open: false, collapsed: false, lit: null, again: false, other: false };
  // the reference window closed: opened, laid out afresh
  assert.deepEqual(pairingStep(base), { open: found.links[0], afresh: true });
  // open, on a step of the same window to another declaration: opened there, the reader's places kept
  assert.deepEqual(pairingStep({ ...base, open: true, lit: "l9" }), { open: found.links[0], afresh: false });
  // another source window (a pinned one opened, the following one again): laid out afresh
  assert.deepEqual(pairingStep({ ...base, open: true, lit: "l9", other: true }), { open: found.links[0], afresh: true });
  // the same declaration again in the same window, its link lit already: nothing moves
  assert.deepEqual(pairingStep({ ...base, open: true, lit: "l1", again: true }), { keep: true });
  // the same, the reference window collapsed to its pill: the reader asked again, so it opens
  assert.deepEqual(pairingStep({ ...base, open: true, collapsed: true, lit: "l1", again: true }), { open: found.links[0], afresh: false });
  // the same, but in another window: that one is paired now, laid out afresh
  assert.deepEqual(pairingStep({ ...base, open: true, lit: "l1", again: true, other: true }), { open: found.links[0], afresh: true });
  // no link: said in the window where it is open, which keeps what it showed
  assert.deepEqual(pairingStep({ ...base, found: null, open: true }), { none: "unlinked", said: true });
  assert.deepEqual(pairingStep({ ...base, found: null }), { none: "unlinked", said: false });
  // a link into a file the library has no record of: nothing opens
  assert.deepEqual(pairingStep({ ...base, found: { links: [link("l3", "g")] } }), { none: "unrecorded", said: false });
});

test("where the pairing opens nothing, the source window's head says why in a line: following someone; nothing linked", () => {
  assert.equal(unpairedLine({ following: "Olivia's AI" }), "Following Olivia's AI: the reference window shows theirs.");
  // nothing linked: around it under the board's clustering, a folder (by file) or a namespace
  assert.equal(unpairedLine({ unlinked: "Fermat42.not_minimal", mode: "module" }), "No reference is linked to Fermat42.not_minimal or to a folder around it.");
  assert.equal(unpairedLine({ unlinked: "Fermat42.not_minimal", mode: "namespace" }), "No reference is linked to Fermat42.not_minimal or to a namespace around it.");
  assert.match(unpairedLine({ unrecorded: "Fermat42.Minimal" }), /Fermat42\.Minimal is a file the library has no record of/);
});

test("the pairing is always on: the choice an older page kept, off in a browser that turned it off, is dropped as the page loads and gone with its next save", () => {
  const saved = new Map<string, string>([["visualproof:/p", JSON.stringify({ paired: false, reviewer: "Ada" })]]);
  const g = globalThis as Record<string, unknown>;
  const before = g.localStorage;
  g.localStorage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
  try {
    const s = new Store("/p");
    assert.ok(!("paired" in s.data));
    assert.equal(s.data.reviewer, "Ada", "the rest kept");
    s.save();
    assert.ok(!("paired" in JSON.parse(saved.get(s.key)!)));
  } finally {
    g.localStorage = before;
  }
});

test("a link is lit by its region whatever the page's words do; a quote with no region by its words where they are known, else nowhere, and no failure of the words stops anything", () => {
  const words: Word[] = [
    ["Theorem", 0.1, 0.2, 0.2, 0.22],
    ["8", 0.21, 0.2, 0.23, 0.22],
    ["There", 0.1, 0.23, 0.17, 0.25],
    ["exists", 0.18, 0.23, 0.26, 0.25],
  ];
  const lines = [0, 2];
  const region = [0.1, 0.16, 0.9, 0.36] as [number, number, number, number];
  const quote = { text: "Theorem 8 There exists", before: "" };
  // the owner's link: a region alone, at p. 10 — the words not come yet, unreadable, or there
  for (const w of [undefined, null, { words, lines }]) assert.deepEqual(placeOnPage({ page: 10, region }, w), { rects: [region], box: region });
  // a region and a quote: the region
  assert.deepEqual(placeOnPage({ page: 10, region, quote }, { words, lines }).box, region);
  // a quote alone: its words, line by line
  const q = placeOnPage({ page: 10, quote }, { words, lines });
  assert.deepEqual(q.rects, [
    [0.1, 0.2, 0.23, 0.22],
    [0.1, 0.23, 0.26, 0.25],
  ]);
  assert.deepEqual(q.box, [0.1, 0.2, 0.26, 0.25]);
  // its words unknown, unreadable, not holding it, or of a shape nobody expects: nowhere, no throw
  assert.deepEqual(placeOnPage({ page: 10, quote }, undefined), { rects: [], box: null });
  assert.deepEqual(placeOnPage({ page: 10, quote }, null), { rects: [], box: null });
  assert.deepEqual(placeOnPage({ page: 10, quote: { text: "Lemma 2" } }, { words, lines }), { rects: [], box: null });
  assert.deepEqual(placeOnPage({ page: 10, quote }, { words: [[null, 0, 0, 1, 1]] as unknown as Word[], lines: [0] }), { rects: [], box: null });
});

/** where the view bar ends, 8 px above which the pair's tops are */
const TOP = 108;

const apart = (a: Rect, b: Rect) => a.x + a.w <= b.x;
const lined = (a: Rect, b: Rect) => a.y === b.y && a.y + a.h === b.y + b.h;

test("paired, the two stand over the side panels: the page's width less its margins, centred and PAIR_MAX wide at most, under the view bar to the page's bottom margin", () => {
  // a laptop's page, a desktop's, and one wider than the cap
  assert.deepEqual(pairArea({ w: 1440, h: 900 }, TOP), { left: EDGE, right: 1440 - EDGE, top: TOP, bottom: 900 - EDGE });
  assert.deepEqual(pairArea({ w: 1600, h: 1000 }, TOP), { left: EDGE, right: 1600 - EDGE, top: TOP, bottom: 1000 - EDGE });
  assert.equal(PAIR_MAX, 1800);
  assert.deepEqual(pairArea({ w: 1920, h: 1080 }, TOP), { left: 60, right: 1860, top: TOP, bottom: 1080 - EDGE });
  assert.deepEqual(pairArea({ w: 2560, h: 1440 }, TOP), { left: 380, right: 2180, top: TOP, bottom: 1440 - EDGE });
  // a page so low that the view bar would leave less than the least height: the tops rise
  assert.equal(pairArea({ w: 1440, h: 300 }, TOP).top, 300 - EDGE - 220);
});

test("paired, the source window stands on the left as wide as its code wants, between its least and half, the reference taking the rest on the right, neither covering the other, their tops and bottoms lined up", () => {
  for (const [vp, half] of [
    [{ w: 1440, h: 900 }, 703],
    [{ w: 1600, h: 1000 }, 783],
    [{ w: 1920, h: 1080 }, 895],
    [{ w: 1100, h: 800 }, 533],
  ] as const) {
    const a = pairArea(vp, TOP);
    assert.equal(pairedSourceMax(a), half, `half the pair at ${vp.w} px`);
    // a source whose code is narrow: as wide as its code, the reference taking the rest
    const { source, paper } = pairRects(500, a, vp);
    assert.equal(source.x, a.left);
    assert.equal(source.w, Math.min(500, half));
    assert.equal(paper.x, source.x + source.w + DOCK_GAP, "on its right, a gap between");
    assert.equal(paper.x + paper.w, a.right, "together they fill the area");
    assert.ok(apart(source, paper));
    assert.ok(lined(source, paper), "the same top and the same bottom");
    assert.equal(source.y, TOP);
    assert.equal(source.h, vp.h - EDGE - TOP);
    // a source whose code is wide: half at most, the reference the other half or more
    const wide = pairRects(1600, a, vp);
    assert.equal(wide.source.w, half);
    assert.equal(wide.paper.w, a.right - a.left - DOCK_GAP - half);
    assert.ok(apart(wide.source, wide.paper) && lined(wide.source, wide.paper));
  }
  // a source narrower than its least: at its least
  assert.equal(pairRects(200, pairArea(VP, TOP), VP).source.w, PAIR_MIN.source);
});

test("where the page is too narrow for both at their least, each is at its least at one of its margins, overlapping as little as that allows, their edges still lined up", () => {
  // the pair needs 810 px, and an 820 px page leaves it 796
  const need = PAIR_MIN.source + DOCK_GAP + PAIR_MIN.paper;
  for (const vp of [
    { w: 820, h: 700 },
    { w: 700, h: 700 },
  ]) {
    const a = pairArea(vp, TOP);
    assert.ok(a.right - a.left < need);
    const o = pairRects(500, a, vp);
    assert.equal(o.source.x, EDGE);
    assert.equal(o.source.w, PAIR_MIN.source);
    assert.equal(o.paper.x + o.paper.w, vp.w - EDGE);
    assert.equal(o.paper.w, PAIR_MIN.paper);
    assert.equal(o.source.x + o.source.w - o.paper.x, PAIR_MIN.source + PAIR_MIN.paper - (vp.w - 2 * EDGE));
    assert.ok(lined(o.source, o.paper));
  }
  // the least page that holds both apart
  const just = { w: need + 2 * EDGE, h: 700 };
  const r = pairRects(500, pairArea(just, TOP), just);
  assert.ok(apart(r.source, r.paper));
  assert.equal(r.source.w, PAIR_MIN.source);
  assert.equal(r.paper.w, PAIR_MIN.paper);
});


// ---------------------------------------------------------------- never overlapping

/** What the pairing shows as it opens or shows the reference window beside the source window
 *  (web/src/paperlinks.ts, `keepApart` then `rects`): the places the reader gave the two by hand
 *  (`source`, `paper`; null where the page placed it) kept where they can be, the rest placed beside
 *  them or afresh; `code` the width the source window's code wants. */
function shown(code: number, source: Rect | null, paper: Rect | null, vp: Size) {
  const a = pairArea(vp, TOP);
  const keep = pairKeeps(source, paper, a);
  return { keep, ...pairPlaces(code, keep.source ? source : null, keep.paper ? paper : null, a, vp) };
}

/** Where the two stand as the reader lets go of a drag, before the pairing next shows them. */
const dropped = (code: number, source: Rect | null, paper: Rect | null, vp: Size) => pairPlaces(code, source, paper, pairArea(vp, TOP), vp);

/** whether the page is too narrow for the two side by side at their least: the only page on which
 *  they may overlap */
function narrow(vp: Size): boolean {
  const a = pairArea(vp, TOP);
  return a.right - a.left < PAIR_MIN.source + DOCK_GAP + PAIR_MIN.paper;
}

const LAPTOP = { w: 1440, h: 900 };
const DESKTOP = { w: 1920, h: 1080 };

test("two windows overlap where they share more than an edge; the room beside a window is on its side with the more room, the right where the two have as much", () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  assert.ok(!overlaps(a, { x: 100, y: 0, w: 50, h: 100 }), "edge to edge");
  assert.ok(!overlaps(a, { x: 0, y: 100, w: 100, h: 50 }), "one under the other");
  assert.ok(overlaps(a, { x: 99, y: 99, w: 50, h: 50 }));
  const area = { left: 0, right: 1000, top: 0, bottom: 800 };
  assert.deepEqual(roomBeside({ x: 400, y: 0, w: 200, h: 800 }, 380, area), { left: 610, right: 1000 }, "as much on each side: the right");
  assert.deepEqual(roomBeside({ x: 450, y: 0, w: 200, h: 800 }, 380, area), { left: 0, right: 440 });
  assert.equal(roomBeside({ x: 300, y: 0, w: 400, h: 800 }, 380, area), null, "290 px on each side");
});

test("the owner's case: the source window widened by hand, then another declaration opened (Source, Space, a step, a name clicked in the code, the selection changing): the reference beside it at the width left, or both laid out afresh", () => {
  const a = pairArea(LAPTOP, TOP);
  const fresh = pairRects(703, a, LAPTOP);
  assert.deepEqual([fresh.source, fresh.paper], [
    { x: 12, y: 108, w: 703, h: 780 },
    { x: 725, y: 108, w: 703, h: 780 },
  ]);
  // dragged 200 px wider by its right edge: the reference where the rule had put it is what the two
  // overlapped by before (190 px measured in the page)
  const wide = resizeRect(fresh.source, "e", 200, 0, LAPTOP, SOURCE_MIN);
  assert.equal(wide.w, 903);
  assert.ok(overlaps(wide, fresh.paper));
  // let go of: the reference beside it, across the width left
  assert.deepEqual(dropped(703, wide, null, LAPTOP).paper, { x: 925, y: 108, w: 503, h: 780 });
  // another declaration, whatever its code: the reader's width kept, the reference beside it
  for (const code of [300, 703, 1200]) {
    const o = shown(code, wide, null, LAPTOP);
    assert.deepEqual(o.keep, { source: true, paper: false });
    assert.deepEqual(o.source, wide);
    assert.deepEqual(o.paper, { x: 925, y: 108, w: 503, h: 780 });
  }
  // dragged so wide that the reference has less than its least beside it: as the reader lets go,
  // it stands at its least at the page's right margin over the source the reader dragged onto it;
  // the next declaration lays the two out afresh
  const wider = resizeRect(fresh.source, "e", 600, 0, LAPTOP, SOURCE_MIN);
  assert.deepEqual(dropped(703, wider, null, LAPTOP).paper, { x: 1048, y: 108, w: PAIR_MIN.paper, h: 780 });
  const o = shown(703, wider, null, LAPTOP);
  assert.deepEqual(o.keep, { source: false, paper: false });
  assert.deepEqual([o.source, o.paper], [fresh.source, fresh.paper]);
});

test("the source window moved by hand: the reference on its side with the more room, across all of it, kept on the next declaration; where neither side holds the reference, laid out afresh", () => {
  for (const vp of [LAPTOP, DESKTOP]) {
    const a = pairArea(vp, TOP);
    const fresh = pairRects(600, a, vp);
    // a little to the right, and down: the reference on its right
    const right = moveRect(fresh.source, 120, 40, vp, SOURCE_MIN);
    let o = shown(600, right, null, vp);
    assert.deepEqual(o.source, right, `kept at ${vp.w}`);
    assert.equal(o.paper.x, right.x + right.w + DOCK_GAP);
    assert.equal(o.paper.x + o.paper.w, a.right);
    assert.ok(!overlaps(o.source, o.paper));
    // against the page's right margin: the reference on its left, from the area's left edge
    const far = moveRect(fresh.source, vp.w, 0, vp, SOURCE_MIN);
    o = shown(600, far, null, vp);
    assert.deepEqual(o.source, far);
    assert.deepEqual(o.paper, { x: a.left, y: TOP, w: far.x - DOCK_GAP - a.left, h: vp.h - EDGE - TOP });
    assert.ok(!overlaps(o.source, o.paper));
    // in the middle of the page, 300 px left on either side, less than the reference's least
    const middle = { ...fresh.source, x: a.left + 300 + DOCK_GAP, w: a.right - a.left - 2 * (300 + DOCK_GAP) };
    assert.ok(overlaps(dropped(600, middle, null, vp).paper, middle), "as the reader lets go");
    o = shown(600, middle, null, vp);
    assert.deepEqual(o.keep, { source: false, paper: false });
    assert.deepEqual([o.source, o.paper], [fresh.source, fresh.paper]);
  }
});

test("the reference window resized or moved by hand: the source beside it, as wide as its code wants up to the width left, kept on the next declaration; where it leaves the source less than its least, laid out afresh", () => {
  const a = pairArea(LAPTOP, TOP);
  const fresh = pairRects(703, a, LAPTOP);
  // 250 px wider by its left edge, over the source
  const wide = resizeRect(fresh.paper, "w", -250, 0, LAPTOP, PAPER_MIN);
  assert.deepEqual(wide, { x: 475, y: 108, w: 953, h: 780 });
  assert.ok(overlaps(wide, fresh.source), "the two overlapped by 240 px in the page before");
  // a source whose code is wide: across the width left; narrow: as wide as its code, beside it
  let o = shown(703, null, wide, LAPTOP);
  assert.deepEqual(o.keep, { source: false, paper: true });
  assert.deepEqual(o.paper, wide);
  assert.deepEqual(o.source, { x: 12, y: 108, w: 453, h: 780 });
  o = shown(430, null, wide, LAPTOP);
  assert.deepEqual(o.source, { x: 475 - DOCK_GAP - 430, y: 108, w: 430, h: 780 });
  // at the source's least where its code is narrower still
  assert.equal(shown(200, null, wide, LAPTOP).source.w, PAIR_MIN.source);
  // moved to the left of the page: the source on its right
  const left = moveRect(fresh.paper, -LAPTOP.w, 0, LAPTOP, PAPER_MIN);
  o = shown(703, null, left, LAPTOP);
  assert.deepEqual(o.paper, left);
  assert.equal(o.source.x, left.x + left.w + DOCK_GAP);
  assert.ok(!overlaps(o.source, o.paper));
  // moved into the middle, leaving the source its least on neither side: laid out afresh
  const middle = moveRect(wide, -250, 0, LAPTOP, PAPER_MIN);
  assert.ok(overlaps(dropped(703, null, middle, LAPTOP).source, middle), "as the reader lets go");
  o = shown(703, null, middle, LAPTOP);
  assert.deepEqual(o.keep, { source: false, paper: false });
  assert.deepEqual([o.source, o.paper], [fresh.source, fresh.paper]);
});

test("both windows placed by hand: both kept where they do not overlap; else the source kept and the reference beside it; else the reference kept and the source beside it; else laid out afresh", () => {
  const a = pairArea(LAPTOP, TOP);
  const fresh = pairRects(703, a, LAPTOP);
  const source = { x: 40, y: 140, w: 600, h: 600 };
  // apart, one above the other included
  for (const paper of [{ x: 700, y: 120, w: 500, h: 700 }, { x: 40, y: 760, w: 900, h: 120 }]) assert.deepEqual(shown(703, source, paper, LAPTOP).keep, { source: true, paper: true });
  // the reference dragged over the source: the source kept, the reference beside it
  let o = shown(703, source, { x: 300, y: 200, w: 700, h: 600 }, LAPTOP);
  assert.deepEqual(o.keep, { source: true, paper: false });
  assert.deepEqual(o.paper, { x: 650, y: 108, w: 778, h: 780 });
  // the source too wide for the reference beside it, the reference leaving the source room beside
  // it: the reference kept, the source beside it
  const big = { x: 12, y: 108, w: 1100, h: 780 };
  const paper = { x: 900, y: 108, w: 528, h: 780 };
  o = shown(703, big, paper, LAPTOP);
  assert.deepEqual(o.keep, { source: false, paper: true });
  assert.deepEqual(o.source, { x: 900 - DOCK_GAP - 703, y: 108, w: 703, h: 780 });
  assert.ok(!overlaps(o.source, o.paper));
  // neither leaves the other its least
  o = shown(703, big, { x: 300, y: 108, w: 1100, h: 780 }, LAPTOP);
  assert.deepEqual(o.keep, { source: false, paper: false });
  assert.deepEqual([o.source, o.paper], [fresh.source, fresh.paper]);
});

test("a pinned source window: placed by the pairing at the size it was set, at most half; resized by hand, kept with the reference beside it, or laid out afresh; beside a reference placed by hand", () => {
  const a = pairArea(LAPTOP, TOP);
  // pinned as it stood a step aside, wider than half: on the left of the two at half
  const placed = pairPlaces(953, null, null, a, LAPTOP);
  assert.deepEqual(placed.source, { x: 12, y: 108, w: 703, h: 780 });
  assert.ok(!overlaps(placed.source, placed.paper));
  // resized by hand, 250 px wider: kept, the reference beside it (measured in the page: 975, 453)
  const wide = resizeRect(placed.source, "e", 250, 0, LAPTOP, SOURCE_MIN);
  let o = shown(953, wide, null, LAPTOP);
  assert.deepEqual(o.source, wide);
  assert.deepEqual(o.paper, { x: 975, y: 108, w: 453, h: 780 });
  // 700 px wider: laid out afresh, the pinned window at half again
  o = shown(1403, resizeRect(placed.source, "e", 700, 0, LAPTOP, SOURCE_MIN), null, LAPTOP);
  assert.deepEqual(o.keep, { source: false, paper: false });
  assert.deepEqual(o.source, placed.source);
  // the reference placed by hand: the pinned window beside it, at its set size where it has room
  const paper = { x: 900, y: 108, w: 528, h: 780 };
  assert.deepEqual(pairPlaces(600, null, paper, a, LAPTOP).source, { x: 900 - DOCK_GAP - 600, y: 108, w: 600, h: 780 });
});

test("reopened after Space closed the two: the pairing opens the reference window afresh, and whatever the reader had done to either is let go of", () => {
  const found = { links: [link("l1")] };
  const step = pairingStep({ found, recorded: () => true, open: false, collapsed: false, lit: null, again: false, other: true });
  assert.deepEqual(step, { open: found.links[0], afresh: true });
  // laid out afresh: both placed by the rule, side by side
  for (const vp of [LAPTOP, DESKTOP]) {
    const o = shown(640, null, null, vp);
    assert.deepEqual([o.source, o.paper], [pairRects(640, pairArea(vp, TOP), vp).source, pairRects(640, pairArea(vp, TOP), vp).paper]);
    assert.ok(!overlaps(o.source, o.paper));
  }
});

test("the page resized: a window the reader placed kept where the other still stands beside it in the new page, the two laid out afresh where it does not, overlapping only on a page too narrow for both", () => {
  const fresh = pairRects(703, pairArea(LAPTOP, TOP), LAPTOP);
  const wide = resizeRect(fresh.source, "e", 200, 0, LAPTOP, SOURCE_MIN);
  // wider: kept, the reference across the room to the wider area's right edge
  let o = shown(703, clampRect(wide, DESKTOP, SOURCE_MIN), null, DESKTOP);
  assert.deepEqual(o.source, wide);
  assert.deepEqual(o.paper, { x: 925, y: 108, w: 1860 - 925, h: 1080 - EDGE - TOP });
  // narrower, leaving the reference less than its least: afresh
  const small = { w: 1100, h: 800 };
  o = shown(703, clampRect(wide, small, SOURCE_MIN), null, small);
  assert.deepEqual(o.keep, { source: false, paper: false });
  assert.ok(!overlaps(o.source, o.paper));
  assert.equal(o.source.w, 533);
  // the reference placed by hand, the page narrowed under it
  const paper = resizeRect(fresh.paper, "w", -100, 0, LAPTOP, PAPER_MIN);
  o = shown(703, null, clampRect(paper, small, PAPER_MIN), small);
  assert.ok(!overlaps(o.source, o.paper));
  // too narrow for both: the rule's fallback alone overlaps them
  const tiny = { w: 820, h: 700 };
  o = shown(703, clampRect(wide, tiny, SOURCE_MIN), null, tiny);
  assert.ok(narrow(tiny) && overlaps(o.source, o.paper));
  assert.deepEqual(o.keep, { source: false, paper: false });
});

test("following someone: the reference window mirroring theirs stands beside the follower's own source window by the same rule, the follower's places kept where they leave room", () => {
  // the follower's source widened by hand, and their reference dragged over it before they followed
  const fresh = pairRects(703, pairArea(LAPTOP, TOP), LAPTOP);
  const source = resizeRect(fresh.source, "e", 200, 0, LAPTOP, SOURCE_MIN);
  const paper = moveRect(fresh.paper, -200, 0, LAPTOP, PAPER_MIN);
  assert.ok(overlaps(source, paper));
  const o = shown(703, source, paper, LAPTOP);
  assert.deepEqual(o.keep, { source: true, paper: false });
  assert.deepEqual(o.source, source);
  assert.deepEqual(o.paper, { x: 925, y: 108, w: 503, h: 780 }, "measured in the page while following");
});

test("wherever the reader placed the two, the pairing never shows them overlapping but on a page too narrow for both; a place it keeps is exactly the reader's, and one it lets go of goes by the rule", () => {
  let seed = 11;
  const rnd = (k: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % k);
  const placed = (vp: Size, min: Size): Rect | null => {
    if (rnd(3) === 0) return null;
    return clampRect({ x: rnd(vp.w), y: rnd(vp.h), w: min.w + rnd(vp.w), h: min.h + rnd(vp.h) }, vp, min);
  };
  for (const vp of [LAPTOP, { w: 1600, h: 1000 }, DESKTOP, { w: 2560, h: 1440 }, { w: 1100, h: 800 }, { w: 820, h: 700 }, { w: 700, h: 600 }]) {
    for (let k = 0; k < 3000; k++) {
      const source = placed(vp, SOURCE_MIN);
      const paper = placed(vp, PAPER_MIN);
      const code = 200 + rnd(1600);
      const o = shown(code, source, paper, vp);
      const what = JSON.stringify({ vp, source, paper, code });
      assert.ok(!overlaps(o.source, o.paper) || narrow(vp), what);
      if (o.keep.source) assert.deepEqual(o.source, source, what);
      if (o.keep.paper) assert.deepEqual(o.paper, paper, what);
      if (source && paper && !overlaps(source, paper)) assert.deepEqual(o.keep, { source: true, paper: true }, what);
      if (!o.keep.source && !o.keep.paper) {
        const rule = pairRects(code, pairArea(vp, TOP), vp);
        assert.deepEqual([o.source, o.paper], [rule.source, rule.paper], what);
      }
      // a window let go of beside a kept one stands at least at its least, the area's height
      if (o.keep.source !== o.keep.paper) {
        const other = o.keep.source ? o.paper : o.source;
        assert.ok(other.w >= (o.keep.source ? PAIR_MIN.paper : PAIR_MIN.source), what);
        assert.equal(other.y, pairArea(vp, TOP).top, what);
      }
    }
  }
});
