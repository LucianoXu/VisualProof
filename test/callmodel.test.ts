// The call on the page, without a browser (CallSpec, "The page"): where each tile goes in each
// layout, the compact call's one tile, the active speaker kept a moment, what is received, the
// room's payloads read with care, the People panel's order; what a tab calls itself, a duplicated
// tab's taking a new one; and the window's place at first and maximized.

import assert from "node:assert/strict";
import { test } from "node:test";
import { callFrame, callMode, clockText, compactFocus, gridShape, MORE_KEY, namesLine, nextSpeaker, parseReaction, peopleOrder, reactionPayload, screenKey, stageLayout, subscriptions } from "../src/web/src/call/model.ts";
import type { TileInfo } from "../src/web/src/call/model.ts";
import { callTab, newTab } from "../src/web/src/call/tab.ts";
import { CALL_TAB } from "../src/shared/call.ts";
import { EDGE, maximizedRect } from "../src/web/src/floatwin.ts";
import { DEFAULT, defaultRect } from "../src/web/src/pagecall.ts";

const cam = (id: string, since: number, local = false): TileInfo => ({ key: id, identity: id, kind: "camera", local, since });
const scr = (id: string, since: number): TileInfo => ({ key: screenKey(id), identity: id, kind: "screen", local: false, since });
const box = { w: 1000, h: 560 };

test("the grid holds every tile as large as it can, 16 to a page", () => {
  assert.deepEqual(gridShape(1, box), { cols: 1, rows: 1, w: 995, h: 560 });
  assert.equal(gridShape(4, box).cols, 2);
  const tiles = Array.from({ length: 20 }, (_, i) => cam(`p${i}`, i));
  const first = stageLayout({ tiles, mode: "grid", pinned: null, speaker: null, page: 0, box });
  assert.equal(first.kind, "grid");
  assert.equal(first.grid.length, 16);
  assert.equal(first.pages, 2);
  const second = stageLayout({ tiles, mode: "grid", pinned: null, speaker: null, page: 5, box });
  assert.equal(second.page, 1, "a page past the last is the last");
  assert.equal(second.grid.length, 4);
});

test("Auto: a presentation large, the others in a strip; without one, the grid; a pin wins", () => {
  const tiles = [cam("me", 0, true), cam("a", 1), cam("b", 2), scr("a", 5)];
  const l = stageLayout({ tiles, mode: "auto", pinned: null, speaker: null, page: 0, box });
  assert.equal(l.kind, "focus");
  assert.equal(l.focus, screenKey("a"));
  assert.deepEqual(l.strip, ["me", "a", "b"]);
  assert.equal(l.side, "right");
  assert.equal(stageLayout({ tiles: tiles.slice(0, 3), mode: "auto", pinned: null, speaker: null, page: 0, box }).kind, "grid");
  assert.equal(stageLayout({ tiles, mode: "auto", pinned: "b", speaker: null, page: 0, box }).focus, "b");
});

test("Speaker: who speaks large, the strip by who spoke last; more than fits counted in +N", () => {
  const tiles = Array.from({ length: 12 }, (_, i) => cam(`p${i}`, i));
  const spoke = new Map([["p9", 50]]);
  const l = stageLayout({ tiles, mode: "speaker", pinned: null, speaker: "p3", spoke, page: 0, box: { w: 800, h: 700 } });
  assert.equal(l.focus, "p3");
  assert.equal(l.side, "bottom");
  assert.equal(l.strip[0], "p9", "who spoke last first");
  assert.ok(l.more.length > 0);
  assert.ok(l.rects.has(MORE_KEY));
  assert.ok(!l.shown.has(l.more[0]), "what the strip does not show is not received");
});

test("the full call from 640×400 each way; smaller, the compact call's one tile", () => {
  assert.equal(callMode({ w: 640, h: 400 }), "full");
  assert.equal(callMode({ w: 639, h: 600 }), "compact");
  assert.equal(callMode({ w: 900, h: 399 }), "compact");
  const tiles = [cam("me", 0, true), cam("a", 1), cam("b", 2)];
  assert.equal(compactFocus(tiles, null, "b"), "b");
  assert.equal(compactFocus([...tiles, scr("a", 3)], null, "b"), screenKey("a"));
  assert.equal(compactFocus(tiles, "me", "b"), "me");
  assert.equal(compactFocus([cam("me", 0, true)], null, null), "me");
  const out = callFrame({ tiles, mode: "grid", pinned: null, speaker: null, page: 0, box: { w: 300, h: 200 }, seen: false, call: "compact" });
  assert.equal(out.shown.size, 0, "a window out of sight receives no video");
});

test("the active speaker keeps the large tile a moment; silence keeps the last", () => {
  const s1 = nextSpeaker(null, ["a"], 1000);
  assert.deepEqual(s1, { key: "a", since: 1000 });
  assert.equal(nextSpeaker(s1, ["b"], 1500), s1, "held");
  assert.deepEqual(nextSpeaker(s1, ["b"], 3000), { key: "b", since: 3000 });
  assert.equal(nextSpeaker(s1, [], 9000), s1);
});

test("only the video of tiles shown, on a page seen, is received", () => {
  const v = [{ sid: "T1", tile: "a" }, { sid: "T2", tile: "b" }];
  assert.deepEqual([...subscriptions(v, new Set(["a"]), true)], [["T1", true], ["T2", false]]);
  assert.deepEqual([...subscriptions(v, new Set(["a", "b"]), false)], [["T1", false], ["T2", false]]);
});

test("a reaction is one of six, read with care", () => {
  assert.equal(parseReaction(reactionPayload("🎉")), "🎉");
  assert.equal(parseReaction('{"emoji":"🦄"}'), null);
  assert.equal(parseReaction("not json"), null);
  assert.equal(parseReaction(new Uint8Array(1000)), null);
  assert.equal(parseReaction(new Uint8Array([0xff, 0xfe])), null);
});

test("People: raised hands first, the earliest first; then the reader; then by name", () => {
  const rows = [
    { identity: "c", name: "Cy", local: false, hand: null },
    { identity: "me", name: "Zed", local: true, hand: null },
    { identity: "b", name: "bob", local: false, hand: 20 },
    { identity: "a", name: "Al", local: false, hand: 10 },
    { identity: "d", name: "Ann", local: false, hand: null },
  ];
  assert.deepEqual(peopleOrder(rows).map((r) => r.identity), ["a", "b", "me", "d", "c"]);
});

test("words: a running time, who is in the call", () => {
  assert.equal(clockText(65_000), "1:05");
  assert.equal(clockText(3_725_000), "1:02:05");
  assert.equal(namesLine(["A"]), "A");
  assert.equal(namesLine(["A", "B"]), "A and B");
  assert.equal(namesLine(["A", "B", "C", "D", "E"]), "A, B and 3 others");
});

/** A BroadcastChannel between pages of a test: what one posts, the others hear. */
function channels() {
  const all: { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown): void; close(): void }[] = [];
  const make = () => {
    const me = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      postMessage(m: unknown) {
        for (const o of all) if (o !== me) queueMicrotask(() => o.onmessage?.({ data: m } as MessageEvent));
      },
      close() {},
    };
    all.push(me);
    return me;
  };
  return make;
}

test("a tab: 16 letters and digits, kept across a reload; a duplicated tab takes a new one", async () => {
  assert.match(newTab(), CALL_TAB);
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const make = channels();
  const deps = () => ({ storage, channel: make(), random: (b: Uint8Array) => crypto.getRandomValues(b), askMs: 30 });
  const one = callTab(deps());
  const t1 = await one.get();
  assert.match(t1, CALL_TAB);
  assert.equal(await one.copy, false);
  // a duplicate starts with a copy of the storage: it finds the tab held, and takes another
  const copy = new Map(store);
  const two = callTab({ storage: { getItem: (k) => copy.get(k) ?? null, setItem: (k, v) => void copy.set(k, v) }, channel: make(), random: (b) => crypto.getRandomValues(b), askMs: 30 });
  assert.equal(await two.copy, true);
  assert.notEqual(await two.get(), t1);
  assert.equal(await one.get(), t1, "the first keeps its own");
  // a reload: the first page gone, its storage kept
  one.close();
  const again = callTab({ storage, channel: make(), random: (b) => crypto.getRandomValues(b), askMs: 30 });
  assert.equal(await again.get(), t1);
});

test("the call window starts at the bottom right, 720×480 where it fits; maximized, under the bars", () => {
  const vp = { w: 1600, h: 1000 };
  const r = defaultRect(vp);
  assert.deepEqual({ w: r.w, h: r.h }, DEFAULT);
  assert.equal(r.x + r.w, vp.w - EDGE);
  assert.ok(r.y + r.h <= vp.h - EDGE);
  const small = defaultRect({ w: 500, h: 400 });
  assert.ok(small.w <= 500 - 2 * EDGE && small.x >= EDGE);
  assert.deepEqual(maximizedRect(vp, 96), { x: EDGE, y: 96, w: vp.w - 2 * EDGE, h: vp.h - 96 - EDGE });
});
