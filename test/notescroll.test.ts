// A long note scrolls in its card (web/src/sticky.ts, CanvasSpec "Notes", the owner's decision of
// 2026-10-12): the wheel, a trackpad's two fingers, a finger and the scrollbar scroll a note's text
// that is longer than its card shows, and the wheel never falls through to the canvas at its ends;
// anywhere else on a note, and with Ctrl (a pinch), the wheel zooms the canvas as before.

import assert from "node:assert/strict";
import { test } from "node:test";
import { scrolls, textPress, wheelGoes } from "../src/web/src/sticky.ts";

/** a note's text as the browser measures it: 363 px of text in 260, a classic 15 px scrollbar */
const long = { scrollHeight: 363, clientHeight: 260, clientWidth: 223, offsetWidth: 238 };
/** the same where the bar is drawn over the text (macOS): it takes no room */
const overlay = { ...long, clientWidth: 238 };
/** a text the card shows whole */
const short = { scrollHeight: 127, clientHeight: 127, clientWidth: 238, offsetWidth: 238 };

test("the wheel scrolls a note's text that is longer than its card shows, at its ends too; elsewhere, and with Ctrl, it zooms the canvas", () => {
  assert.equal(scrolls(long), true);
  assert.equal(scrolls(short), false);
  assert.equal(scrolls(null), false);
  // a rounding pixel is no scrolling
  assert.equal(scrolls({ ...short, scrollHeight: 128 }), false);
  // the text's, wherever it is scrolled to: at its top or its end too, where the browser then does
  // nothing (its overscroll is contained), so that it is not read
  assert.equal(wheelGoes(long, false), "text");
  // a pinch on a trackpad (Ctrl and the wheel) zooms the canvas wherever it is
  assert.equal(wheelGoes(long, true), "canvas");
  // a text the card shows whole, or the card off its text (the byline, what it carries): the canvas
  assert.equal(wheelGoes(short, false), "canvas");
  assert.equal(wheelGoes(null, false), "canvas");
});

test("a press on a note's text is the text's where it scrolls it — a finger or a pen anywhere, the mouse on its scrollbar — and the card's elsewhere", () => {
  // the mouse: the classic bar's 15 px are the bar's, the rest of the text presses the card (a drag
  // pans, or moves the card)
  assert.equal(textPress(long, "mouse", 4), true);
  assert.equal(textPress(long, "mouse", 14), true);
  assert.equal(textPress(long, "mouse", 16), false);
  assert.equal(textPress(long, "mouse", 120), false);
  // a bar drawn over the text: its last 12 px
  assert.equal(textPress(overlay, "mouse", 11), true);
  assert.equal(textPress(overlay, "mouse", 13), false);
  // outside the text's box is no press on it
  assert.equal(textPress(long, "mouse", -1), false);
  // a finger or a pen scrolls it, anywhere on it
  assert.equal(textPress(long, "touch", 120), true);
  assert.equal(textPress(long, "pen", 120), true);
  // a text that does not scroll has no bar: every press is the card's
  for (const kind of ["mouse", "touch", "pen"]) assert.equal(textPress(short, kind, 4), false, kind);
});
