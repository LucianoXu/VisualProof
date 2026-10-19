// What a reader's browser keeps (web/src/store.ts): the side panel's sections the reader folded,
// and the filter, which starts folded until the reader opens it; the conversation's window, and
// nothing of the source windows.

import assert from "node:assert/strict";
import { test } from "node:test";
import { seenOf, Store } from "../src/web/src/store.ts";

test("the filter starts folded, and stays as the reader leaves it; other sections start open", () => {
  const s = new Store("/nowhere");
  s.data.shut = undefined;
  s.data.opened = undefined;
  assert.equal(s.isShut("filter"), true);
  assert.equal(s.isShut("targets"), false);
  s.toggleShut("filter");
  assert.equal(s.isShut("filter"), false);
  assert.deepEqual(s.data.opened, ["filter"]);
  s.toggleShut("filter");
  assert.equal(s.isShut("filter"), true);
  assert.deepEqual(s.data.opened, []);
  s.toggleShut("targets");
  assert.equal(s.isShut("targets"), true);
  s.toggleShut("targets");
  assert.equal(s.isShut("targets"), false);
  // a reader who folded the filter before it started folded keeps it folded
  s.data.shut = ["filter"];
  s.data.opened = undefined;
  assert.equal(s.isShut("filter"), true);
  s.toggleShut("filter");
  assert.equal(s.isShut("filter"), false);
});

test("nothing of the source windows is kept: an older page's place for them is dropped; the conversation's window is kept", () => {
  const saved = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  const before = g.localStorage;
  g.localStorage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
  try {
    const chat = { place: { x: 40, y: 60, w: 440, h: 380, bottom: true }, collapsed: false };
    saved.set("visualproof:/p", JSON.stringify({ mode: "tcb", srcwin: { place: { x: 300, y: 120, w: 800, h: 500 }, sized: true }, chat }));
    const s = new Store("/p");
    assert.equal("srcwin" in s.data, false);
    assert.deepEqual(s.data.chat, chat);
    // the next save writes it without
    s.save();
    const written = JSON.parse(saved.get("visualproof:/p")!);
    assert.equal("srcwin" in written, false);
    assert.deepEqual(written.chat, chat);
    // and the conversation's place is read back as it was put
    assert.deepEqual(new Store("/p").data.chat, chat);
  } finally {
    g.localStorage = before;
  }
});

test("the conversations' pins an older page kept go (there are none: the window is the reader's own); what was seen of the channels is the browser's, the furthest of two tabs", () => {
  const saved = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  const before = g.localStorage;
  g.localStorage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
  try {
    saved.set("visualproof:/p", JSON.stringify({ mode: "tcb", talkPins: ["a1"], talkOpen: "a1", chatOpen: true, chatChannel: "a1", chatSeen: { public: 4 } }));
    const s = new Store("/p");
    assert.equal("talkPins" in s.data, false);
    assert.equal("talkOpen" in s.data, false);
    assert.deepEqual([s.data.chatOpen, s.data.chatChannel, s.data.chatSeen], [true, "a1", { public: 4 }]);
    s.save();
    assert.ok(!/talkPins|talkOpen/.test(saved.get("visualproof:/p")!));
    // another tab read further in one channel, less in another: each the furthest
    s.adopt(JSON.stringify({ chatSeen: { public: 2, a1: 7, junk: "x" } }));
    assert.deepEqual(s.data.chatSeen, { public: 4, a1: 7 });
    assert.deepEqual(seenOf(undefined, { b: -1, c: 1.5 }), undefined);
  } finally {
    g.localStorage = before;
  }
});
