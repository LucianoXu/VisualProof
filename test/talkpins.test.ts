// A conversation's pin (web/src/talkpins.ts, AgentSpec decision 8, the owner's decision of
// 2026-10-12): kept per agent in this browser, read back with care; a pinned conversation stays open
// when following ends and after a reload, and opens again from its agent's badge; an unpinned one
// goes with following, as before. The pin is the reader's own (web/src/surfaces.ts): pressing it never
// ends following (test/surfaces.test.ts holds every surface to that).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Peer } from "../src/shared/collab.ts";
import { Store } from "../src/web/src/store.ts";
import { closed, isPinned, opened, pin, readPins, shownTalk, unpin, writePins } from "../src/web/src/talkpins.ts";
import { inYours, keyActs, pressActs, YOURS } from "../src/web/src/surfaces.ts";
import type { PageEl } from "../src/web/src/surfaces.ts";

const talk = { state: "listening" as const, since: "2026-10-12T10:00:00.000Z", doing: null, status: null, read: 0, lastSeen: null };
const agent = (id: string, name: string): Peer => ({ id, name, view: null, idle: false, agent: true, talk });
const A = agent("a1", "Alice's AI");
const B = agent("b2", "Bob's AI");
const alice: Peer = { id: "s9", name: "Alice", view: null, idle: false };
/** an agent working without a token of its own: it cannot be talked to */
const loose: Peer = { id: "c3", name: "Carol's AI", view: null, idle: false, agent: true };

test("what the browser keeps of the pins is read back with care", () => {
  for (const bad of [{}, { talkPins: "a1" }, { talkPins: null }, { talkPins: [1, null, {}, ""] }, { talkOpen: "a1" }, { talkPins: [], talkOpen: "a1" }])
    assert.deepEqual(readPins(bad), { pinned: [], open: null }, JSON.stringify(bad));
  assert.deepEqual(readPins({ talkPins: ["a1", "b2", "a1", 7], talkOpen: "b2" }), { pinned: ["a1", "b2"], open: "b2" });
  // the open one only where it is pinned
  assert.deepEqual(readPins({ talkPins: ["a1"], talkOpen: "b2" }), { pinned: ["a1"], open: null });
  assert.deepEqual(readPins({ talkPins: ["a1"], talkOpen: 3 }), { pinned: ["a1"], open: null });
  // kept as little as there is, and read back as written
  const kept: { talkPins?: string[]; talkOpen?: string } = { talkPins: ["x"], talkOpen: "x" };
  writePins(kept, { pinned: [], open: null });
  assert.deepEqual(JSON.parse(JSON.stringify(kept)), {});
  writePins(kept, { pinned: ["a1"], open: null });
  assert.deepEqual(JSON.parse(JSON.stringify(kept)), { talkPins: ["a1"] });
  writePins(kept, { pinned: ["a1"], open: "a1" });
  assert.deepEqual(kept, { talkPins: ["a1"], talkOpen: "a1" });
  assert.deepEqual(readPins(kept), { pinned: ["a1"], open: "a1" });
});

test("pinned, a conversation stays open when following ends, and opens again from its badge; unpinned, it goes with following", () => {
  let p = readPins({});
  // following Alice's AI: its conversation shows, pinned or not
  assert.equal(shownTalk(p, true, A, [A, B]), A);
  // unpinned, following ends: no conversation
  assert.equal(shownTalk(p, false, null, [A, B]), null);
  // pinned while following: the open one, which stays when following ends
  p = pin(p, A.id);
  assert.deepEqual(p, { pinned: ["a1"], open: "a1" });
  assert.equal(isPinned(p, "a1"), true);
  assert.equal(shownTalk(p, false, null, [A, B]), A);
  // pinning again changes nothing
  assert.deepEqual(pin(p, A.id), p);
  // following a person meanwhile: the window is the strip's; the pinned conversation comes back after
  assert.equal(shownTalk(p, true, null, [A, B, alice]), null);
  assert.equal(shownTalk(p, false, null, [A, B, alice]), A);
  // following an agent not pinned meanwhile: its conversation; then the pinned one again
  assert.equal(shownTalk(opened(p, B.id), true, B, [A, B]), B);
  assert.deepEqual(opened(p, B.id), p, "an agent not pinned is not the one left open");
  assert.equal(shownTalk(opened(p, B.id), false, null, [A, B]), A);
  // closed (its ✕): it stays pinned, and its badge opens it again
  p = closed(p);
  assert.deepEqual(p, { pinned: ["a1"], open: null });
  assert.equal(shownTalk(p, false, null, [A, B]), null);
  p = opened(p, A.id);
  assert.equal(shownTalk(p, false, null, [A, B]), A);
  // a second agent pinned is the one open now; the first stays pinned
  p = pin(p, B.id);
  assert.deepEqual(p, { pinned: ["a1", "b2"], open: "b2" });
  assert.equal(shownTalk(p, false, null, [A, B]), B);
  // following the first, pinned: it is the one left open when following ends
  p = opened(p, A.id);
  assert.equal(shownTalk(p, false, null, [A, B]), A);
  // unpinned: it closes, following nobody; the other stays pinned
  p = unpin(p, A.id);
  assert.deepEqual(p, { pinned: ["b2"], open: null });
  assert.equal(shownTalk(p, false, null, [A, B]), null);
  // unpinning one not open leaves the open one
  assert.deepEqual(unpin({ pinned: ["a1", "b2"], open: "b2" }, "a1"), { pinned: ["b2"], open: "b2" });
});

test("a pinned conversation shows while its agent is listed with a token: after a reload, once the server says it is", () => {
  const p = pin(readPins({}), A.id);
  // the page before the first presence: nobody listed
  assert.equal(shownTalk(p, false, null, []), null);
  assert.equal(shownTalk(p, false, null, [B, alice]), null, "its token revoked, or expired");
  assert.equal(shownTalk(p, false, null, [B, A]), A);
  // a page or an agent without a token under the same id is no conversation
  assert.equal(shownTalk({ pinned: ["s9", "c3"], open: "s9" }, false, null, [alice, loose]), null);
  assert.equal(shownTalk({ pinned: ["s9", "c3"], open: "c3" }, false, null, [alice, loose]), null);
});

test("the pins are kept in this browser, survive a reload, and are taken from another tab so that no tab undoes them", () => {
  const saved = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  const before = g.localStorage;
  g.localStorage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
  try {
    const one = new Store("/p");
    const two = new Store("/p");
    writePins(one.data, pin(readPins(one.data), A.id));
    one.save();
    // a reload reads them back
    assert.deepEqual(readPins(new Store("/p").data), { pinned: ["a1"], open: "a1" });
    // the other tab takes the pins, not which one is open, which is its own
    two.data.talkOpen = undefined;
    two.adopt(saved.get(two.key)!);
    assert.deepEqual(two.data.talkPins, ["a1"]);
    assert.equal(two.data.talkOpen, undefined);
    two.data.reviewer = "Bob";
    two.save();
    assert.deepEqual(JSON.parse(saved.get("visualproof:/p")!).talkPins, ["a1"], "its next save keeps the pin");
    // unpinned in the first tab: the second takes that too
    writePins(one.data, unpin(readPins(one.data), A.id));
    one.save();
    two.adopt(saved.get(two.key)!);
    assert.equal(two.data.talkPins, undefined);
  } finally {
    g.localStorage = before;
  }
});

/** An element of the page as the rule reads it, inside the ones before it (test/surfaces.test.ts). */
const at = (...chain: string[]): PageEl | null =>
  chain.reduce<PageEl | null>((parentElement, own) => {
    const mine = own.split("|");
    return { matches: (sel: string) => sel.split(",").some((s) => mine.includes(s.trim())), parentElement };
  }, null);

test("the pin is the reader's own: pressing it, or Enter or Space on it, never ends following, nor does a Shift-click on a badge", () => {
  const y = YOURS.find((s) => s.id === "talkPin");
  assert.ok(y && "where" in y && y.where === "#following [data-pin]", "declared in the registry");
  const pinBtn = at("#windows", "#following", ".fl-strip", "#following [data-pin]|button");
  assert.equal(inYours(pinBtn), true);
  assert.equal(pressActs(pinBtn), false);
  assert.equal(keyActs({ key: "Enter" }, pinBtn, false), false);
  assert.equal(keyActs({ key: " " }, pinBtn, false), false);
  // the window's other buttons, its pill, a badge of the presence bar: the reader's own whole
  assert.equal(pressActs(at("#windows", "#following", ".fl-pill", "button")), false);
  assert.equal(pressActs(at("#bar", "#peers", "button")), false);
});
