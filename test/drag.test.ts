// What a drag on the canvas does (web/src/drag.ts, decided 2026-10-09): it pans by default; the lock
// let go, it moves what it starts on; the drag key held does the other way — ⌘ on a Mac, where
// Ctrl+click is the right click, and Ctrl elsewhere (2026-10-11). The choice is kept in the browser,
// for every project, and a new visitor starts panning.

import assert from "node:assert/strict";
import { test } from "node:test";
import { dragKeyHeld, dragKeyName, dragMoves, isDragKey, lockedChoice, menuClick, onMac, setLockedChoice } from "../src/web/src/drag.ts";
import { Store } from "../src/web/src/store.ts";

/** A browser's storage, for the length of `f`. */
function withStorage(saved: Map<string, string>, f: () => void): void {
  const g = globalThis as Record<string, unknown>;
  const before = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => void saved.set(k, v),
    removeItem: (k: string) => void saved.delete(k),
  };
  try {
    f();
  } finally {
    g.localStorage = before;
  }
}

test("a drag pans unless the lock is let go; the drag key held does the other way", () => {
  // locked (the default): a drag pans, with the key it moves
  assert.equal(dragMoves(true, false), false);
  assert.equal(dragMoves(true, true), true);
  // the lock let go: a drag moves, with the key it pans
  assert.equal(dragMoves(false, false), true);
  assert.equal(dragMoves(false, true), false);
});

test("the drag key is ⌘ on a Mac, where Ctrl+click is the right click, and Ctrl elsewhere", () => {
  // the platform, read once: what the browser names, else navigator.platform, else its user agent
  for (const nav of [
    { userAgentData: { platform: "macOS" } },
    { platform: "MacIntel" },
    // an iPad asking for desktop pages says MacIntel; asking for its own, iPad
    { platform: "iPad" },
    { platform: "iPhone" },
    { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" },
  ])
    assert.equal(onMac(nav), true, JSON.stringify(nav));
  for (const nav of [
    { userAgentData: { platform: "Windows" }, platform: "MacIntel" },
    { userAgentData: { platform: "Linux" } },
    { platform: "Win32" },
    { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (Macintosh; …)" },
    { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/131.0" },
    {},
    undefined,
  ])
    assert.equal(onMac(nav), false, JSON.stringify(nav));
  const ctrl = { ctrlKey: true, metaKey: false }, cmd = { ctrlKey: false, metaKey: true };
  // a Mac: ⌘ alone makes a drag do the other way; Ctrl does nothing to drags
  assert.equal(dragKeyName(true), "⌘");
  assert.equal(dragKeyHeld(cmd, true), true);
  assert.equal(dragKeyHeld(ctrl, true), false);
  assert.equal(isDragKey("Meta", true), true);
  assert.equal(isDragKey("Control", true), false);
  // and a Ctrl+click is the secondary click there: the menu's, never a click of the page's
  assert.equal(menuClick({ button: 0, ctrlKey: true }, true), true);
  assert.equal(menuClick({ button: 0, ctrlKey: false }, true), false);
  // elsewhere: Ctrl alone; ⊞ or Super is the system's, and Ctrl+click a click
  assert.equal(dragKeyName(false), "Ctrl");
  assert.equal(dragKeyHeld(ctrl, false), true);
  assert.equal(dragKeyHeld(cmd, false), false);
  assert.equal(isDragKey("Control", false), true);
  assert.equal(isDragKey("Meta", false), false);
  assert.equal(menuClick({ button: 0, ctrlKey: true }, false), false);
  // on a locked layout, a Mac's ⌘+drag moves and its Ctrl+drag pans, as a drag with no key does;
  // let go, the other way round
  assert.equal(dragMoves(true, dragKeyHeld(cmd, true)), true);
  assert.equal(dragMoves(true, dragKeyHeld(ctrl, true)), false);
  assert.equal(dragMoves(false, dragKeyHeld(cmd, true)), false);
  assert.equal(dragMoves(false, dragKeyHeld(ctrl, true)), true);
});

test("a new visitor starts panning; the reader's choice is kept in this browser for every project", () => {
  const saved = new Map<string, string>();
  withStorage(saved, () => {
    assert.equal(lockedChoice(), true, "nobody chose: locked");
    setLockedChoice(false);
    assert.equal(lockedChoice(), false);
    assert.equal(saved.get("visualproof:drag"), "move");
    setLockedChoice(true);
    assert.equal(lockedChoice(), true);
    assert.equal(saved.has("visualproof:drag"), false, "the default is kept as nothing");
    // the lock an older page kept per project is not read, and goes with the next save
    saved.set("visualproof:/p", JSON.stringify({ mode: "tcb", locked: false }));
    const s = new Store("/p");
    assert.equal((s.data as { locked?: unknown }).locked, undefined);
    s.save();
    assert.equal(JSON.parse(saved.get("visualproof:/p")!).locked, undefined);
    assert.equal(lockedChoice(), true);
  });
  // storage blocked: the default, and nothing breaks
  const g = globalThis as Record<string, unknown>;
  const before = g.localStorage;
  g.localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  try {
    assert.equal(lockedChoice(), true);
    setLockedChoice(false);
  } finally {
    g.localStorage = before;
  }
});
