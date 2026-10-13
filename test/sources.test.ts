// The page's source windows (web/src/sources.ts, ReviewSpec "The source window", decided
// 2026-10-09): one that follows the selection, opened and closed by Space; pinned ones that stay on
// their declarations, at most six, each a step aside from the following window; following someone,
// this reader's windows mirror all of theirs, the following one and the pinned ones, open,
// collapsed and closed with them, and are this reader's own once following ends; keys inside a
// window and elsewhere; where a window opens; and what ends following among a window's controls
// (web/src/surfaces.ts, pressActs and doubleClickActs).

import assert from "node:assert/strict";
import { test } from "node:test";
import { CASCADE, EDGE } from "../src/web/src/floatwin.ts";
import type { Rect } from "../src/web/src/floatwin.ts";
import { doubleClickActs, pressActs } from "../src/web/src/surfaces.ts";
import type { PageEl } from "../src/web/src/surfaces.ts";
import { asideRect, FIT_W, MAX_PINNED, MIN, openBounds, openRect, PIN_CAP, routeKey, Sources } from "../src/web/src/sources.ts";
import type { SourcePane } from "../src/web/src/sources.ts";

const VP = { w: 1440, h: 900 };
/** where the following window is kept */
const HOME: Rect = { x: 334, y: 128, w: 640, h: 500 };

/** A window as the page would draw it, recording what it was asked to do. */
class Pane implements SourcePane {
  decl = -1;
  name = "";
  collapsed = false;
  pinnedAt: Rect | null = null;
  /** pinned as it opened, this many steps aside (a followed reader's window) */
  asideAt = 0;
  removed = false;
  fronted = 0;
  reviews = 0;
  shown: number[] = [];
  private at: Rect = { ...HOME };
  show(i: number) {
    this.decl = i;
    this.name = `D${i}`;
    this.shown.push(i);
  }
  redrawReview() {
    this.reviews++;
  }
  pin(at: Rect) {
    this.pinnedAt = at;
    this.at = at;
  }
  pinAside(step: number) {
    this.asideAt = step;
    this.at = { ...HOME, x: HOME.x + step * CASCADE, y: HOME.y + step * CASCADE };
  }
  collapse(on: boolean) {
    this.collapsed = on;
  }
  front() {
    this.fronted++;
  }
  /** where the page put it: paired with the reference window, say */
  place(r: Rect) {
    this.at = r;
  }
  rect() {
    return this.at;
  }
  /** the page's elements inside it: in these tests, the pane stands for them */
  holds(t: unknown) {
    return t === this;
  }
  remove() {
    this.removed = true;
  }
}

function page() {
  const made: Pane[] = [];
  const said: string[] = [];
  let changes = 0;
  const s = new Sources<Pane>({
    make: () => {
      const p = new Pane();
      made.push(p);
      return p;
    },
    say: (t) => said.push(t),
    changed: () => changes++,
    viewport: () => VP,
  });
  return { s, made, said, changes: () => changes };
}

test("Space opens the following window on the selection and closes it; it follows the selection, and closes with nothing selected", () => {
  const { s, made, changes } = page();
  // nothing selected: Space opens nothing
  s.toggle(null);
  assert.equal(made.length, 0);
  s.toggle(3);
  assert.equal(made.length, 1);
  const p = made[0];
  assert.equal(s.following, p);
  assert.equal(p.decl, 3);
  assert.equal(s.open, true);
  assert.equal(changes(), 1, "the others are told it opened");
  // a click on the canvas: the same window shows the declaration clicked
  s.follow(5);
  assert.equal(made.length, 1);
  assert.equal(p.decl, 5);
  // the review changed: drawn again
  s.follow(5);
  assert.deepEqual(p.shown, [3, 5, 5]);
  // nothing selected, or a cluster: it closes
  s.follow(null);
  assert.equal(p.removed, true);
  assert.equal(s.following, null);
  assert.equal(changes(), 2);
  // closed, the selection changing opens nothing
  s.follow(6);
  assert.equal(made.length, 1);
  // Source in the panel opens one; Space closes it
  const q = s.show(7);
  assert.equal(made.length, 2);
  assert.equal(q.decl, 7);
  s.toggle(7);
  assert.equal(q.removed, true);
});

test("a collapsed following window is opened again by Space or Source, and follows the selection meanwhile", () => {
  const { s, made } = page();
  const p = s.show(2);
  p.collapse(true);
  s.follow(4);
  assert.equal(p.decl, 4);
  assert.equal(p.collapsed, true, "collapsed, it follows as a pill");
  // Space: opened again, not closed
  s.toggle(4);
  assert.equal(p.collapsed, false);
  assert.equal(p.removed, false);
  s.toggle(4);
  assert.equal(p.removed, true);
  // Source on a collapsed window opens it again, in front
  const q = s.show(1);
  q.collapse(true);
  const fronted = q.fronted;
  s.show(1);
  assert.equal(q.collapsed, false);
  assert.ok(q.fronted > fronted);
  assert.equal(made.length, 2);
});

test("a pinned window stays on its declaration, a step aside; the next one opened follows, beside it", () => {
  const { s, made, changes } = page();
  const p = s.show(1);
  assert.equal(s.pin(p), true);
  assert.equal(s.following, null, "no window follows the selection until the next opens");
  assert.deepEqual(s.pinned, [p]);
  assert.deepEqual(p.pinnedAt, { ...HOME, x: HOME.x + CASCADE, y: HOME.y + CASCADE });
  assert.equal(changes(), 2, "the others are told the following window is gone");
  // the selection moves: the pinned window stays where it is
  s.follow(4);
  assert.equal(p.decl, 1);
  assert.deepEqual(p.shown, [1]);
  // Space opens a new following window on the selection; the pinned one stays
  s.toggle(4);
  assert.equal(made.length, 2);
  const q = made[1];
  assert.equal(s.following, q);
  assert.equal(q.decl, 4);
  s.follow(9);
  assert.equal(q.decl, 9);
  assert.equal(p.decl, 1);
  // pinned too: a step further, not on the first
  assert.equal(s.pin(q), true);
  assert.deepEqual(q.pinnedAt, { ...HOME, x: HOME.x + 2 * CASCADE, y: HOME.y + 2 * CASCADE });
  // only the following window is pinned
  assert.equal(s.pin(p), false);
  // a pinned window closes alone: the following window stays; the others are told, as they are of
  // its pinning (decided 2026-10-09: pinned windows are shared too)
  const before = changes();
  const r = s.show(3);
  s.close(p);
  assert.equal(p.removed, true);
  assert.deepEqual(s.pinned, [q]);
  assert.equal(s.following, r);
  assert.equal(changes(), before + 2, "the new following window opened, and the pinned one closed");
});

test(`at most ${MAX_PINNED} windows are pinned, and the reader is told why the next is not`, () => {
  const { s, said } = page();
  for (let k = 0; k < MAX_PINNED; k++) assert.equal(s.pin(s.show(k)), true);
  assert.equal(s.pinned.length, MAX_PINNED);
  const extra = s.show(99);
  assert.equal(s.pin(extra), false);
  assert.deepEqual(said, [PIN_CAP]);
  // refused, it goes on following
  assert.equal(s.following, extra);
  assert.equal(extra.pinnedAt, null);
  s.follow(100);
  assert.equal(extra.decl, 100);
  // their places never coincide
  const at = s.pinned.map((p) => p.pinnedAt!);
  for (const a of at) for (const b of at) if (a !== b) assert.ok(Math.abs(a.x - b.x) >= CASCADE || Math.abs(a.y - b.y) >= CASCADE);
  // one closed, one more may be pinned
  s.close(s.pinned[0]);
  assert.equal(s.pin(extra), true);
});

/** What a followed reader's page says of their windows (Shared): following `f` (null: closed), and
 *  pinned on each of `pins`; a declaration followed by `-` is collapsed. */
const theirs = (f: number | `${number}-` | null, ...pins: (number | `${number}-`)[]) => {
  const one = (x: number | string) => ({ decl: Number(String(x).replace("-", "")), collapsed: String(x).endsWith("-") });
  return { following: f === null ? null : one(f), pinned: pins.map(one) };
};

test("following someone: the following window mirrors theirs — open on their selection, collapsed as theirs is, or closed", () => {
  const { s, made } = page();
  // they open their source on 8: a following window opens here
  s.mirror(theirs(8));
  const f = s.following!;
  assert.equal(f.decl, 8);
  // they move on to 9: the same window shows it
  s.mirror(theirs(9));
  assert.equal(f.decl, 9);
  assert.equal(made.length, 1);
  // they collapse it, and open it again: so does this one
  s.mirror(theirs("9-"));
  assert.equal(f.collapsed, true);
  s.mirror(theirs("10-"));
  assert.equal(f.collapsed, true);
  assert.equal(f.decl, 10);
  s.mirror(theirs(10));
  assert.equal(f.collapsed, false);
  // their source window open on nothing that is a declaration here: nothing changes
  s.mirror({ following: { decl: null, collapsed: false }, pinned: [] });
  assert.equal(s.following, f);
  assert.equal(f.decl, 10);
  // they close it: it closes here
  s.mirror(theirs(null));
  assert.equal(f.removed, true);
  assert.equal(s.following, null);
  // closed there and here: nothing
  s.mirror(theirs(null));
  assert.equal(made.length, 1);
});

test("following someone: a pinned window here for each of theirs, collapsed and closed with theirs, a step aside each", () => {
  const { s, made, changes } = page();
  // they read 1, pin it, read 2 and pin it, read 3
  s.mirror(theirs(1));
  const f = s.following!;
  // pinned there: the following window here is pinned, a step aside, as this reader would pin it
  s.mirror(theirs(null, 1));
  assert.deepEqual(s.pinned, [f]);
  assert.equal(s.following, null);
  assert.deepEqual(f.pinnedAt, { ...HOME, x: HOME.x + CASCADE, y: HOME.y + CASCADE });
  s.mirror(theirs(2, 1));
  const g = s.following!;
  s.mirror(theirs(3, 1, 2));
  assert.deepEqual(s.pinned, [f, g]);
  assert.deepEqual(s.pinned.map((p) => p.decl), [1, 2]);
  assert.equal(s.following!.decl, 3);
  // they collapse the first: so does the one here; opened again, the same
  s.mirror(theirs(3, "1-", 2));
  assert.deepEqual([f.collapsed, g.collapsed], [true, false]);
  s.mirror(theirs(3, 1, 2));
  assert.equal(f.collapsed, false);
  // they close the first: it closes here, the others stay
  const told = changes();
  s.mirror(theirs(3, 2));
  assert.equal(f.removed, true);
  assert.deepEqual(s.pinned, [g]);
  assert.ok(changes() > told, "what this reader shows the others changed too");
  // windows of theirs this page never saw pinned (a follower who comes late): each a new window,
  // pinned as it opens, a step further aside than those here, on its declaration, collapsed as theirs
  s.mirror(theirs(3, 2, 7, "8-"));
  const [h, k] = s.pinned.slice(1);
  assert.deepEqual([h.decl, h.asideAt, h.collapsed], [7, 2, false]);
  assert.deepEqual([k.decl, k.asideAt, k.collapsed], [8, 3, true]);
  assert.equal(made.length, 5);
  // the same again changes nothing
  s.mirror(theirs(3, 2, 7, "8-"));
  assert.equal(made.length, 5);
  assert.deepEqual(s.pinned.map((p) => p.decl), [2, 7, 8]);
});

test("following someone: this reader's own pinned windows stay; one on a declaration they pinned stands for theirs; at most six", () => {
  const { s, made } = page();
  const mine = s.show(1);
  s.pin(mine);
  const other = s.show(4);
  s.pin(other);
  // they have 4 pinned, and 5: the window here on 4 stands for theirs, a new one opens for 5
  s.mirror(theirs(null, 4, 5));
  assert.deepEqual(s.pinned.map((p) => p.decl), [1, 4, 5]);
  assert.equal(made.length, 3);
  // they close 4: the window here on 4 stood for theirs, and closes; the one on 1 is this reader's
  s.mirror(theirs(null, 5));
  assert.equal(other.removed, true);
  assert.equal(mine.removed, false);
  // they pin many: as many open here as six pinned allow
  s.mirror(theirs(null, 5, 10, 11, 12, 13, 14));
  assert.equal(s.pinned.length, MAX_PINNED);
  assert.deepEqual(s.pinned.map((p) => p.decl), [1, 5, 10, 11, 12, 13]);
});

test("following ends: the windows that stood for theirs are this reader's own, and stay", () => {
  const { s } = page();
  s.mirror(theirs(3, 1, 2));
  const [a, b] = s.pinned;
  const f = s.following!;
  s.release();
  assert.deepEqual(s.pinned, [a, b]);
  assert.equal(s.following, f);
  // following someone else, who pinned nothing: they stay, this reader's
  s.mirror(theirs(6));
  assert.deepEqual(s.pinned, [a, b]);
  assert.equal(a.removed || b.removed, false);
  assert.equal(f.decl, 6);
  // following the first again: their windows are the ones here on the same declarations, no second ones
  s.release();
  s.mirror(theirs(3, 1, 2));
  assert.deepEqual(s.pinned, [a, b]);
});

test("the pinned windows' reviews are drawn again; in a new graph each is found by name, or closes", () => {
  const { s } = page();
  const a = s.show(1);
  s.pin(a);
  const b = s.show(2);
  s.pin(b);
  const f = s.show(3);
  s.redrawReviews();
  assert.deepEqual([a.reviews, b.reviews, f.reviews], [1, 1, 0]);
  // renumbered: D1 is 11 now, D2 is gone
  s.redraw((name) => (name === "D1" ? 11 : undefined));
  assert.equal(a.decl, 11);
  assert.equal(b.removed, true);
  assert.deepEqual(s.pinned, [a]);
  assert.equal(s.following, f, "the following window follows the selection, found by name elsewhere");
});

test("the window a key is pressed in: Esc closes it, a, m and k are its declaration's, Space presses its buttons; elsewhere the page's", () => {
  const { s } = page();
  const f = s.show(1);
  s.pin(f);
  const g = s.show(2);
  assert.equal(s.at(f), f);
  assert.equal(s.at(g), g);
  assert.equal(s.at({}), null);
  // focus inside a window
  assert.equal(routeKey("Escape", true, false), "close");
  assert.equal(routeKey("Escape", true, true), "close");
  for (const k of ["a", "m", "k"]) assert.equal(routeKey(k, true, false), "own");
  assert.equal(routeKey(" ", true, true), "press");
  // Space on the window itself is the page's: the following window opens or closes
  assert.equal(routeKey(" ", true, false), "page");
  for (const k of ["n", "1", "2", "/", "f", "s", "?"]) assert.equal(routeKey(k, true, false), "page");
  // focus elsewhere: every key is the page's, as it was
  for (const k of ["Escape", " ", "a", "m", "k", "n", "1"]) {
    assert.equal(routeKey(k, false, false), "page");
    assert.equal(routeKey(k, false, true), "page");
  }
});

test("a window opens in the middle of the screen, as large as its code within the modal's bounds; one opened for a followed reader's pinned window, steps aside", () => {
  // at most 92 % × 88 % of the screen, at least FIT_W wide and MIN tall
  assert.deepEqual(openBounds(VP), { max: { w: 0.92 * VP.w, h: 0.88 * VP.h }, min: { w: FIT_W, h: MIN.h } });
  // a small screen: no larger than 92 % of it, nor than it less its margins; at least that
  const phone = openBounds({ w: 360, h: 640 });
  assert.deepEqual(phone.max, { w: 0.92 * 360, h: 0.88 * 640 });
  assert.ok(phone.max.w <= 360 - 2 * EDGE);
  assert.equal(phone.min.w, phone.max.w);
  assert.equal(openBounds({ w: 200, h: 640 }).max.w, 200 - 2 * EDGE);
  // in the middle
  assert.deepEqual(openRect({ w: 640, h: 400 }, VP, []), { x: (VP.w - 640) / 2, y: (VP.h - 400) / 2, w: 640, h: 400 });
  // a pinned window elsewhere, or a step aside from there: still in the middle
  const mid = openRect({ w: 640, h: 400 }, VP, []);
  assert.deepEqual(openRect({ w: 640, h: 400 }, VP, [{ ...mid, x: mid.x + CASCADE, y: mid.y + CASCADE }]), mid);
  // on a pinned window: a step aside from it
  assert.deepEqual(openRect({ w: 640, h: 400 }, VP, [{ ...mid, w: 300 }]), { ...mid, x: mid.x + CASCADE, y: mid.y + CASCADE });
  // a followed reader's pinned windows: one step aside, two steps…
  assert.deepEqual(asideRect({ w: 640, h: 400 }, VP, 2), { ...mid, x: mid.x + 2 * CASCADE, y: mid.y + 2 * CASCADE });
  // …as far as the screen's margin lets it, where it is tall, and further aside than the one before
  const h = 0.88 * VP.h;
  const two = asideRect({ w: 640, h }, VP, 2), three = asideRect({ w: 640, h }, VP, 3);
  assert.equal(two.y + h, VP.h - EDGE);
  assert.deepEqual([two.x, three.x - two.x], [mid.x + 2 * CASCADE, CASCADE]);
});

test("a pinned window stands under the page's bars: pinned as tall as the room under them, it stays there instead of stepping up over the tab bar; opened for a followed reader's or a share link's, it steps aside under them", () => {
  // the view bar's bottom and 8 px: where the paired windows' tops are (web/src/paperdock.ts, pairTop)
  const TOP = 108;
  const made: Pane[] = [];
  const s = new Sources<Pane>({ make: () => (made.push(new Pane()), made[made.length - 1]), say: () => {}, changed: () => {}, viewport: () => VP, top: () => TOP });
  // the following window paired with the reference window: under the bars, as tall as the room
  // there; pinned (by this reader, or because the followed reader pinned theirs), it has no step to
  // take down, and none up that stays under the bars (in the page it went to y 80, over the tab bar)
  const paired = { x: EDGE, y: TOP, w: 703, h: VP.h - EDGE - TOP };
  const f = s.show(1);
  f.place(paired);
  s.pin(f);
  assert.deepEqual(f.pinnedAt, paired);
  const g = s.show(2);
  g.place(paired);
  s.mirror({ following: { decl: 3, collapsed: false }, pinned: [{ decl: 1, collapsed: false }, { decl: 2, collapsed: false }] });
  assert.ok(g.pinnedAt!.y >= TOP, "pinned for the followed reader: under the bars too");
  // a shorter one steps down and to the right, as before
  const h = s.show(4);
  h.place({ x: 300, y: 200, w: 640, h: 400 });
  s.pin(h);
  assert.deepEqual(h.pinnedAt, { x: 300 + CASCADE, y: 200 + CASCADE, w: 640, h: 400 });
  // opened for a followed reader's pinned window, or a share link's: no taller than the room under
  // the bars, in the middle of it, each a step further aside, and never over the bars
  assert.equal(openBounds(VP, TOP).max.h, VP.h - EDGE - TOP);
  assert.equal(openBounds(VP).max.h, 0.88 * VP.h, "the following window's bounds as decided");
  for (const size of [{ w: 640, h: VP.h - EDGE - TOP }, { w: 640, h: 400 }])
    for (const step of [1, 2, 3]) {
      const r = asideRect(size, VP, step, TOP);
      assert.ok(r.y >= TOP && r.y + r.h <= VP.h - EDGE, `${size.h} px tall, ${step} steps aside`);
    }
  assert.deepEqual(asideRect({ w: 640, h: 400 }, VP, 1, TOP), { x: (VP.w - 640) / 2 + CASCADE, y: TOP + (VP.h - EDGE - TOP - 400) / 2 + CASCADE, w: 640, h: 400 });
});

/** An element of the page as the rule reads it: inside the ones before it, each matching the
 *  selector it is given. */
const at = (...chain: string[]): PageEl | null =>
  chain.reduce<PageEl | null>((parentElement, own) => ({ matches: (sel: string) => sel.split(",").some((s) => s.trim() === own), parentElement }), null);

test("following ends on acting, and on any change to which windows there are or how they show; not on reading, nor on moving or resizing a window", () => {
  // outside every reading surface (the canvas, the bars): any press
  assert.equal(pressActs(at()), true);
  // in a source window: its text, its title bar (moving it), its edges (resizing it)
  assert.equal(pressActs(at(".sw-win")), false);
  // its own controls (decided 2026-10-09): pinning, collapsing, opening the pill, closing a
  // pinned window, as closing the following window, back and forward, approving
  assert.equal(pressActs(at(".sw-win", "button", "[data-sw-pin]")), true);
  assert.equal(pressActs(at(".sw-win", "button", "[data-sw-collapse]")), true);
  assert.equal(pressActs(at(".sw-win", "button", ".sw-pill-open")), true);
  assert.equal(pressActs(at(".sw-win", "button", ".sw-win.pinned [data-sw-close]")), true);
  assert.equal(pressActs(at(".sw-win", "button")), true);
  // a name that goes to its declaration, the comment box: acting
  assert.equal(pressActs(at(".sw-win", "[data-ref]")), true);
  assert.equal(pressActs(at(".sw-win", "textarea")), true);
  // hover cards over a window: reading
  assert.equal(pressActs(at(".hcard")), false);
  // a double-click on a window's title bar collapses it: acting; on its buttons, its press acted
  // already; on the code it selects a word: reading
  assert.equal(doubleClickActs(at(".sw-win:not(.collapsed) .sw-head")), true);
  assert.equal(doubleClickActs(at(".sw-win:not(.collapsed) .sw-head", "button")), false);
  assert.equal(doubleClickActs(at(".sw-win")), false);
  assert.equal(doubleClickActs(at()), false);
});
