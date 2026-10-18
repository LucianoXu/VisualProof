// Prototypes of the page on an upright monitor with a mouse (the owner's question of 2026-10-18;
// web/src/monitor.ts): the screens they are for, the tall page giving way to them while one is on
// show, and where a window the reader has not moved opens in one.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { intoRegion } from "../src/web/src/floatwin.ts";
import { MONITOR, SHEETED, TALL } from "../src/web/src/phone.ts";

const css = () => readFileSync(new URL("../src/web/style.css", import.meta.url), "utf8").replace(/\/\*[^]*?\*\//g, "");

test("an upright monitor is wide enough for a desktop's panels, upright, and has a fine pointer; a touch tablet keeps the tall page", () => {
  assert.equal(MONITOR, "(min-width: 1000px) and (max-aspect-ratio: 5/6) and (pointer: fine)");
  const text = css();
  assert.ok(text.includes(`@media ${MONITOR} {`), "style.css draws the prototypes in that block alone");
  for (const o of ["a", "b", "c"]) assert.ok(text.includes(`:root[data-monitor="${o}"] {`), `option ${o}`);
  // the tall page, and what it shares with a phone, give way while a prototype is on show
  for (const q of [TALL, SHEETED]) {
    const at = text.indexOf(`@media ${q} {`);
    assert.ok(at >= 0, q);
    assert.match(text.slice(at, at + 400), /^@media [^{]+\{\s*:root:not\(\[data-monitor\]\) \{/, `${q} gives way`);
  }
});

test("a window the reader has not moved opens inside the option's part of the screen, as large as fits there", () => {
  const lower = { x: 12, y: 1100, w: 1416, h: 1000 };
  // centred on the screen, as a source window opens: moved down into the part, its width kept
  assert.deepEqual(intoRegion({ x: 400, y: 600, w: 640, h: 900 }, lower), { x: 400, y: 1100, w: 640, h: 900 });
  // taller than the part: as tall as it
  assert.deepEqual(intoRegion({ x: 12, y: 108, w: 700, h: 2000 }, lower), { x: 12, y: 1100, w: 700, h: 1000 });
  // wider, and past its right: as wide, at its left
  assert.deepEqual(intoRegion({ x: 900, y: 1200, w: 1600, h: 400 }, lower), { x: 12, y: 1200, w: 1416, h: 400 });
  // no part: where it was
  const r = { x: 1, y: 2, w: 3, h: 4 };
  assert.equal(intoRegion(r, null), r);
});
