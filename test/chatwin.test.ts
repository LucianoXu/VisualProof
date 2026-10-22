// The conversation window (web/src/chatwin.ts, CollabSpec decision 13): where it starts, beside the
// side panel; what the browser keeps of it read back, the invalid included; the pill's excerpt of a
// message (web/src/talk.ts); a new conversation's fold, and when one may be started (the owner's
// decision of 2026-10-11). Its geometry, moved and resized, is the floating windows'
// (test/floatwin.test.ts). The following strip stepping aside from it. Left open, it opens again
// once the page has its parts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { defaultRect, DEFAULT, FOOT, MIN, restore, STRIP_GAP, stripAside } from "../src/web/src/chatwin.ts";
import { EDGE, readPlace } from "../src/web/src/floatwin.ts";
import { excerpt, fold, fresh } from "../src/web/src/talk.ts";

const VP = { w: 1440, h: 900 };
const INSETS = { left: 288, top: 116 };

test("the window starts at the bottom left of the canvas, beside the side panel, level with its foot", () => {
  const r = defaultRect(VP, INSETS);
  assert.deepEqual(r, { x: INSETS.left, y: VP.h - FOOT - DEFAULT.h, w: DEFAULT.w, h: DEFAULT.h });
  // no side panel (a narrow window hides it): at the viewport's left margin
  assert.equal(defaultRect({ w: 800, h: 700 }, { left: 0, top: 116 }).x, EDGE);
  // a short viewport: no taller than the room under the bars, never below the least
  const short = defaultRect({ w: 1440, h: 520 }, INSETS);
  assert.equal(short.h, 520 - FOOT - INSETS.top);
  assert.equal(short.y, INSETS.top);
  assert.equal(defaultRect({ w: 1440, h: 300 }, INSETS).h, MIN.h);
  // no room beside the panel: over it, at the margin, as wide as fits
  const cramped = defaultRect({ w: 520, h: 700 }, { left: 288, top: 116 });
  assert.equal(cramped.x, EDGE);
  assert.equal(cramped.w, DEFAULT.w);
  const phone = defaultRect({ w: 360, h: 640 }, { left: 0, top: 116 });
  assert.equal(phone.w, 360 - 2 * EDGE);
  assert.ok(phone.x >= 0 && phone.x + phone.w <= 360);
});

test("what the browser keeps is read back with care: an invalid place is the default place", () => {
  const def = defaultRect(VP, INSETS);
  for (const bad of [undefined, null, 42, "left", [], {}, { place: null }, { place: "x" }, { place: { x: 1, y: 2, w: 3 } },
    { place: { x: "1", y: 2, w: 300, h: 300 } }, { place: { x: NaN, y: 2, w: 300, h: 300 } }, { place: { x: 1, y: 2, w: Infinity, h: 300 } },
    { place: { x: 1, y: 2, w: -300, h: 300 } }, { place: { x: 1, y: 2, w: 300, h: 0 } }]) {
    assert.deepEqual(restore(bad, VP, INSETS).rect, def, JSON.stringify(bad));
  }
  assert.equal(readPlace({ x: 1, y: 2, w: 300, h: 300, right: "yes" })?.right, undefined);
  // a valid place, wherever it was put, is brought inside
  assert.deepEqual(restore({ place: { x: -500, y: 99999, w: 99999, h: 250 } }, VP, INSETS).rect, { x: EDGE, y: VP.h - EDGE - 250, w: VP.w - 2 * EDGE, h: 250 });
  // collapsed as the reader left it; else collapsed on a narrow screen only
  assert.equal(restore({ collapsed: true }, VP, INSETS).collapsed, true);
  assert.equal(restore({ collapsed: false }, { w: 600, h: 800 }, INSETS).collapsed, false);
  assert.equal(restore({}, VP, INSETS).collapsed, false);
  assert.equal(restore({ collapsed: "yes" }, { w: 600, h: 800 }, INSETS).collapsed, true);
});

test("the pill shows a message's start as one line of plain text", () => {
  assert.equal(excerpt("It is **averaged** in `A.b`:\nthe rounds are *uniform*."), "It is averaged in A.b: the rounds are uniform.");
  assert.equal(excerpt("A sketch:\n```lean\nhp = 1\n```\nas stated."), "A sketch: … as stated.");
  assert.equal(excerpt("guess_P_eq stays as it is"), "guess_P_eq stays as it is");
  const long = excerpt("word ".repeat(60), 40);
  assert.ok(long.length <= 40 && long.endsWith("…"));
});

test("the page folds what came before the last divider into one line counting its messages; a new conversation needs something said since the last", () => {
  const m = (id: number, kind: "person" | "agent" | "divider", text = `m${id}`) => ({ id, at: "2026-10-11T10:00:00.000Z", from: kind === "agent" ? "Alice's AI" : "Alice", kind, channel: "private" as const, text });
  const plain = [m(1, "person"), m(2, "agent")];
  assert.deepEqual(fold(plain), { earlier: [], count: 0, divider: null, current: plain });
  const thread = [m(1, "person"), m(2, "agent"), m(3, "divider"), m(4, "person"), m(5, "agent"), m(6, "divider"), m(7, "person")];
  const f = fold(thread);
  assert.deepEqual(f.earlier.map((x) => x.id), [1, 2, 3, 4, 5]);
  assert.equal(f.count, 4, "dividers are not messages");
  assert.equal(f.divider!.id, 6);
  assert.deepEqual(f.current.map((x) => x.id), [7]);
  assert.equal(fresh([]), true);
  assert.equal(fresh(thread), false);
  assert.equal(fresh(thread.slice(0, 6)), true);
});

test("the following strip steps aside from the window rather than cover its box", () => {
  // the strip low in the middle, the window at the bottom left beside the side panel, under it
  const strip = { x: 570, y: 818, w: 300, h: 30 };
  const win = defaultRect(VP, INSETS);
  const to = stripAside(strip, win, VP);
  assert.deepEqual(to, { x: win.x + win.w + STRIP_GAP, y: strip.y });
  // nothing to step aside from: the window closed, or elsewhere
  assert.equal(stripAside(strip, null, VP), null);
  assert.equal(stripAside(strip, { x: 900, y: 100, w: 440, h: 420 }, VP), null);
  // no room at its right: to its left
  const right = { x: 700, y: 400, w: 600, h: 440 };
  assert.deepEqual(stripAside(strip, right, VP), { x: right.x - STRIP_GAP - strip.w, y: strip.y });
  // as wide as the screen (a phone's dock): above it, where it was across
  const phone = { w: 390, h: 844 };
  const ps = { x: 45, y: 760, w: 300, h: 30 };
  const dock = { x: 12, y: 420, w: 366, h: 400 };
  assert.deepEqual(stripAside(ps, dock, phone), { x: ps.x, y: dock.y - STRIP_GAP - ps.h });
  // nowhere clear: it stays
  assert.equal(stripAside(ps, { x: 0, y: 0, w: 390, h: 844 }, phone), null);
});

test("a window left open opens again once the page has its parts, so that a page left with it open reloads", () => {
  // opened, it draws its thread with page.talk and page.people, which the conversations' part and the
  // one after it give: opened while the conversations' part was made, it threw, and every reload of a
  // page left with it open stopped there, the loader on the screen (the owner's report of 2026-10-22)
  const read = (f: string) => readFileSync(new URL(`../src/web/src/${f}`, import.meta.url), "utf8");
  const talk = read("pagetalk.ts");
  assert.match(talk, /const reopenTalk = \(\) => \{\s*if \(store\.data\.chatOpen && !talkBtn\.hidden\) page\.chatWin\.show\(\);\s*\};/);
  assert.equal(talk.match(/page\.chatWin\.show\(/g)?.length, 2, "the window opens by the button and by reopenTalk alone");
  const main = read("main.ts");
  const first = main.indexOf("page.nav.select(first");
  const reopen = main.indexOf("page.reopenTalk();");
  const parts = [...main.slice(0, first).matchAll(/Object\.assign\(page, (?:await )?\w+Part\(page\)\)/g)];
  assert.ok(parts.length > 10 && reopen > 0 && reopen < first, "reopened before the first view is shown");
  assert.ok(parts.every((m) => m.index! < reopen), "reopened once every part is made");
});
