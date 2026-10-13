// The reference window's text and its box tool (the owner's decision of 2026-10-12). A drag on a
// PDF's page selects its text, as in any PDF reader, and makes nothing: no link, no clip, no offer.
// The text is the server's words laid over the page, a span a word at its box, in the server's
// reading order; what is copied reads as the words do, a space between the words of a line and a
// line break between lines. The box is a tool, armed by the title bar's ▭ for the next drag alone,
// then disarmed by itself, or by ▭ again, or by Esc. An image has no text: a plain drag moves it,
// and the box tool draws on it as on a page.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BoxTool, Clicks, copyText, lineOf, nearestWord, notAfter, pressKind, selectedRects, TextDrag, wordSpans } from "../src/web/src/paperwords.ts";
import type { WordPos, WordsOfPage } from "../src/web/src/paperwords.ts";
import { pressActs } from "../src/web/src/surfaces.ts";
import type { PageEl } from "../src/web/src/surfaces.ts";

/** A page of two lines, as the server reads it: each word [text, left, top, right, bottom] in the
 *  page's fractions, and where each line starts. */
const PAGE1: WordsOfPage = {
  words: [
    ["Let", 0.1, 0.1, 0.16, 0.12],
    ["G", 0.17, 0.1, 0.19, 0.12],
    ["be", 0.2, 0.1, 0.24, 0.12],
    ["Theorem", 0.1, 0.13, 0.25, 0.15],
    ["3.", 0.26, 0.13, 0.29, 0.15],
  ],
  lines: [0, 3],
};
const PAGE2: WordsOfPage = {
  words: [
    ["Proof", 0.1, 0.1, 0.2, 0.12],
    ["by", 0.21, 0.1, 0.25, 0.12],
    ["induction.", 0.26, 0.1, 0.4, 0.12],
  ],
  lines: [0],
};
const pages = new Map<number, WordsOfPage>([
  [1, PAGE1],
  [2, PAGE2],
]);
const pos = (page: number, k: number, at: number): WordPos => ({ page, k, at });

test("the word layer is the server's words: a span a word at its box in the page's fractions, in reading order, its letters as tall as the box and stretched to its width", () => {
  // letters half as wide as they are tall, in the layer's font
  const measure = (t: string) => 0.5 * t.length;
  const spans = wordSpans(PAGE1, 0.75, measure);
  assert.equal(spans.length, 5, "a span a word");
  assert.deepEqual(
    spans.map((s) => s.text),
    ["Let ", "G ", "be ", "Theorem ", "3."],
    "the server's order, a space after each word but the page's last",
  );
  const [let_] = spans;
  assert.equal(let_.left, 0.1);
  assert.equal(let_.top, 0.1);
  assert.ok(Math.abs(let_.size - 0.02) < 1e-9, "as tall as its box, a fraction of the page's height");
  // its box is 0.06 of the page's width (0.045 of its height at 3:4); "Let" is 1.5 letters' heights
  // wide, 0.03 of the page's height: stretched 1.5 times
  assert.ok(Math.abs(let_.stretch - 1.5) < 1e-9);
  // the space after a word as wide as the gap to the next of its line: "Let" to "G" is 0.01 of the
  // page's width, 0.0075 of its height, 0.375 of the letters' height, 0.25 once stretched 1.5 times;
  // the space is 0.5 wide, so 0.25 less. At a line's end the space is nothing
  assert.ok(Math.abs(let_.spacing - (0.25 - 0.5)) < 1e-9);
  assert.ok(Math.abs(spans[2].spacing + 0.5) < 1e-9, "the end of a line");
  // nothing depends on the zoom: the same words, the same layer
  assert.deepEqual(wordSpans(PAGE1, 0.75, measure), spans);
  // a word the font measures as nothing, or whose box has no height, is drawn as it comes; an
  // absurd box is held within reason
  assert.equal(wordSpans({ words: [["x", 0.1, 0.1, 0.2, 0.1]], lines: [0] }, 0.75, measure)[0].stretch, 1);
  assert.equal(wordSpans({ words: [["x", 0.1, 0.1, 0.2, 0.12]], lines: [0] }, 0.75, () => 0)[0].stretch, 1);
  assert.equal(wordSpans({ words: [["x", 0, 0.1, 1, 0.1001]], lines: [0] }, 0.75, measure)[0].stretch, 20);
  // two columns read column by column, as the server gives them: the layer keeps that order, so
  // that a selection runs down a column before the next
  const cols: WordsOfPage = {
    words: [
      ["Left", 0.1, 0.1, 0.2, 0.12],
      ["one", 0.1, 0.13, 0.2, 0.15],
      ["Right", 0.6, 0.1, 0.7, 0.12],
    ],
    lines: [0, 1, 2],
  };
  assert.deepEqual(
    wordSpans(cols, 0.75, measure).map((s) => [s.text, s.left]),
    [
      ["Left ", 0.1],
      ["one ", 0.1],
      ["Right", 0.6],
    ],
  );
  assert.deepEqual(lineOf(PAGE1, 1), [0, 2]);
  assert.deepEqual(lineOf(PAGE1, 4), [3, 4]);
});

test("a point on a page is read as the nearest place among its words", () => {
  const A = 0.75;
  // on a word: as many of its letters before it as the point is across it
  assert.deepEqual(nearestWord(PAGE1, 0.22, 0.11, A), { k: 2, at: 1 });
  assert.deepEqual(nearestWord(PAGE1, 0.12, 0.11, A), { k: 0, at: 1 });
  // left of a line, its start; right of it, its end
  assert.deepEqual(nearestWord(PAGE1, 0.02, 0.14, A), { k: 3, at: 0 });
  assert.deepEqual(nearestWord(PAGE1, 0.6, 0.11, A), { k: 2, at: 2 });
  // between two lines, the nearer; under the last, the last
  assert.deepEqual(nearestWord(PAGE1, 0.12, 0.124, A), { k: 0, at: 1 });
  assert.deepEqual(nearestWord(PAGE1, 0.12, 0.127, A)?.k, 3);
  assert.deepEqual(nearestWord(PAGE1, 0.9, 0.9, A), { k: 4, at: 2 });
  // in the gutter between two columns, level with a line: the nearer column's word
  const cols: WordsOfPage = {
    words: [
      ["Left", 0.1, 0.1, 0.2, 0.12],
      ["Right", 0.6, 0.1, 0.7, 0.12],
    ],
    lines: [0, 1],
  };
  assert.deepEqual(nearestWord(cols, 0.3, 0.11, A), { k: 0, at: 4 });
  assert.deepEqual(nearestWord(cols, 0.5, 0.11, A), { k: 1, at: 0 });
  // a stamp turned up the left margin, read first: a drag from the margin beside a line starts at
  // that line, not at the stamp; on the stamp itself, the stamp
  const stamped: WordsOfPage = {
    words: [
      ["arXiv:1910.09336v2", 0.02, 0.2, 0.04, 0.6],
      ["Applied", 0.15, 0.4, 0.25, 0.42],
      ["to", 0.26, 0.4, 0.29, 0.42],
    ],
    lines: [0, 1],
  };
  assert.deepEqual(nearestWord(stamped, 0.08, 0.41, A), { k: 1, at: 0 });
  assert.deepEqual(nearestWord(stamped, 0.03, 0.3, A)?.k, 0);
  // a page with no words (a scan) has no place
  assert.equal(nearestWord({ words: [], lines: [] }, 0.5, 0.5, A), null);
  assert.equal(notAfter(pos(1, 2, 0), pos(1, 2, 1)), true);
  assert.equal(notAfter(pos(2, 0, 0), pos(1, 4, 2)), false);
});

test("copying gives the words as they read: in reading order, a space between words, a line break between lines and pages", () => {
  const of = (n: number) => pages.get(n);
  assert.equal(copyText(of, pos(1, 0, 0), pos(1, 4, 2)), "Let G be\nTheorem 3.");
  // the first and the last word cut where the selection cuts them
  assert.equal(copyText(of, pos(1, 0, 1), pos(1, 3, 3)), "et G be\nThe");
  assert.equal(copyText(of, pos(1, 3, 1), pos(1, 3, 4)), "heo");
  // dragged backwards, the same
  assert.equal(copyText(of, pos(1, 3, 3), pos(1, 0, 1)), "et G be\nThe");
  // from the end of a word, the next; to the start of one, the one before
  assert.equal(copyText(of, pos(1, 0, 3), pos(1, 3, 0)), "G be");
  // across a page
  assert.equal(copyText(of, pos(1, 3, 0), pos(2, 1, 2)), "Theorem 3.\nProof by");
  // a page whose words are not known adds nothing
  assert.equal(copyText((n) => (n === 2 ? undefined : n === 1 ? PAGE1 : PAGE2), pos(1, 4, 0), pos(3, 0, 5)), "3.\nProof");
  // a glyph a font maps to no character is no text
  const ctl: WordsOfPage = { words: [["Pr", 0, 0, 0.1, 0.1], ["\u0002", 0.11, 0, 0.12, 0.1], ["x", 0.13, 0, 0.2, 0.1]], lines: [0] };
  assert.equal(copyText(() => ctl, pos(1, 0, 0), pos(1, 2, 1)), "Pr x");
  // nothing selected, nothing copied
  assert.equal(copyText(of, pos(1, 2, 2), pos(1, 2, 2)), "");
});

test("a selection is lit a box a line over its words, cut where it cuts them", () => {
  // from the middle of "Let" to the end of "Theorem": the rest of the first line, then the second's
  // first word
  const r = selectedRects(PAGE1, pos(1, 0, 1), pos(1, 3, 7));
  assert.equal(r.length, 2, "a box a line");
  assert.ok(Math.abs(r[0][0] - 0.12) < 1e-9, "\"Let\" cut after its first letter, a third across");
  assert.deepEqual([r[0][1], r[0][2], r[0][3]], [0.1, 0.24, 0.12]);
  assert.deepEqual(r[1], [0.1, 0.13, 0.25, 0.15]);
  // a page the selection runs through, whole; one it starts on, from there to its end
  assert.equal(selectedRects(PAGE1, null, null).length, 2);
  assert.deepEqual(selectedRects(PAGE2, pos(2, 1, 0), null), [[0.21, 0.1, 0.4, 0.12]]);
  // nothing selected, nothing lit
  assert.deepEqual(selectedRects(PAGE1, pos(1, 2, 2), pos(1, 2, 2)), []);
});

test("the box tool is armed for one drag: the drag draws a box and disarms it; ▭ again or Esc disarms it without drawing", () => {
  const seen: boolean[] = [];
  const tool = new BoxTool((on) => seen.push(on));
  const kind = () => pressKind({ armed: tool.armed, image: false, pointer: "mouse", button: 0, marker: false });
  assert.equal(tool.armed, false);
  assert.equal(kind(), "text", "by default a drag selects text");
  tool.press();
  assert.equal(kind(), "box", "armed: the next drag draws a box");
  tool.drawn();
  assert.equal(tool.armed, false, "the drag drew it and disarmed it");
  assert.equal(kind(), "text", "the drag after selects text again");
  tool.press();
  tool.press();
  assert.equal(tool.armed, false, "▭ again disarms it");
  tool.press();
  assert.equal(tool.escape(), true, "Esc disarms it, and does nothing else");
  assert.equal(tool.armed, false);
  assert.equal(tool.escape(), false, "Esc with the tool disarmed is the window's");
  tool.reset();
  assert.deepEqual(seen, [true, false, true, false, true, false], "the button and the cursor told each change, and no other");
  // pen draws as the mouse; a touch scrolls a PDF's pages whatever the tool; a marker in the
  // margin is a button, and another button than the first the browser's
  tool.press();
  assert.equal(pressKind({ armed: true, image: false, pointer: "pen", button: 0, marker: false }), "box");
  assert.equal(pressKind({ armed: true, image: false, pointer: "touch", button: 0, marker: false }), null);
  assert.equal(pressKind({ armed: false, image: false, pointer: "touch", button: 0, marker: false }), null);
  assert.equal(pressKind({ armed: true, image: false, pointer: "mouse", button: 0, marker: true }), null);
  assert.equal(pressKind({ armed: false, image: false, pointer: "mouse", button: 2, marker: false }), null);
});

test("a plain drag selects text and never offers a link or a clip; a click opens a link", () => {
  const log: string[] = [];
  const hooks = (start: WordPos | null) => ({
    anchor: () => start,
    posAt: (x: number) => (x > 100 ? pos(1, 4, 2) : pos(1, 0, 0)),
    select: (a: WordPos, b: WordPos) => log.push(`select ${a.k}.${a.at}-${b.k}.${b.at}`),
    click: (x: number, y: number) => log.push(`click ${x},${y}`),
  });
  // pressed on "Let", dragged to "3.": the words between selected as it goes
  const d = new TextDrag(10, 10, hooks(pos(1, 0, 0)));
  d.move(11, 11);
  assert.deepEqual(log, [], "a press that hardly moves selects nothing yet");
  d.move(150, 40);
  d.up(160, 40);
  assert.deepEqual(log, ["select 0.0-4.2", "select 0.0-4.2"]);
  // pressed before the page's words came: the selection starts once they are there
  log.length = 0;
  let start: WordPos | null = null;
  const late = new TextDrag(10, 10, { ...hooks(null), anchor: () => start });
  late.move(150, 40);
  assert.deepEqual(log, []);
  start = pos(1, 1, 0);
  late.move(150, 40);
  assert.deepEqual(log, ["select 1.0-4.2"]);
  // a click is a click: the page opens the link there, or lets go of what is selected
  log.length = 0;
  const c = new TextDrag(10, 10, hooks(pos(1, 0, 0)));
  c.up(11, 10);
  assert.deepEqual(log, ["click 11,10"]);
  // with Shift, a click extends the selection there is
  log.length = 0;
  new TextDrag(150, 10, hooks(pos(1, 1, 0)), true).up(150, 10);
  assert.deepEqual(log, ["select 1.0-4.2"]);
  // a place is picked in one place alone, a box drawn with the tool, and a box is drawn only where
  // the press is the tool's: a text drag has nothing to offer with
  const src = readFileSync(new URL("../src/web/src/paperview.ts", import.meta.url), "utf8");
  const picks = [...src.matchAll(/this\.hooks\.picked\(\{/g)];
  assert.equal(picks.length, 1);
  const box = src.slice(src.indexOf("protected dragBox("), src.indexOf("clearDrag(): void"));
  assert.ok(box.includes("this.hooks.picked({"), "picked in the box drag");
  const calls = [...src.matchAll(/this\.dragBox\(/g)];
  assert.equal(calls.length, 2, "on a page and on an image");
  assert.match(src.slice(calls[0].index! - 300, calls[0].index), /if \(kind === "text"\) return this\.dragText\(e, page\);/);
  assert.match(src.slice(calls[1].index! - 30, calls[1].index), /kind === "box"\) return $/);
  // and the window's text never comes from pdf.js
  assert.doesNotMatch(src, /getTextContent|streamTextContent/);
});

test("clicks in a row: a second near the first is a double click (a word), a third a triple (its line)", () => {
  const c = new Clicks();
  assert.equal(c.count(1000, 10, 10), 1);
  assert.equal(c.count(1200, 11, 10), 2);
  assert.equal(c.count(1400, 11, 11), 3);
  assert.equal(c.count(1600, 11, 11), 1, "a fourth starts again");
  assert.equal(c.count(3000, 11, 11), 1, "too late");
  assert.equal(c.count(3100, 40, 11), 1, "too far");
});

test("an image has no text: a plain drag moves it, the box tool draws on it", () => {
  const img = (armed: boolean, pointer: string, button = 0, marker = false) => pressKind({ armed, image: true, pointer, button, marker });
  assert.equal(img(false, "mouse"), "pan");
  assert.equal(img(false, "pen"), "pan");
  assert.equal(img(false, "touch"), "pan", "a touch moves it, as before");
  assert.equal(img(true, "mouse"), "box");
  assert.equal(img(true, "touch"), "pan");
  assert.equal(img(false, "mouse", 2), null);
  assert.equal(img(false, "mouse", 0, true), null, "a marker is a button");
});

test("following: the box tool is the reader's own, and selecting text on a page is reading", () => {
  const at = (...chain: string[]): PageEl | null =>
    chain.reduce<PageEl | null>((parentElement, own) => ({ matches: (sel: string) => sel.split(",").some((s) => s.trim() === own), parentElement }), null);
  assert.equal(pressActs(at(".pw-win", "[data-pw-box]")), false, "the box tool armed or disarmed");
  assert.equal(pressActs(at(".pw-win", ".pw-page", ".pw-words", "span")), false, "a word pressed to select");
  assert.equal(pressActs(at(".pw-win", ".pw-page")), false, "a page pressed");
  // a marker in the margin still goes to the board, which is the reader's move
  assert.equal(pressActs(at(".pw-win", ".pw-page", "button")), true);
});

test("the layer, the tool and the cursor as the stylesheet draws them", () => {
  const css = readFileSync(new URL("../src/web/style.css", import.meta.url), "utf8");
  // the words are transparent and selectable, under the search's matches and the links
  assert.match(css, /\.pw-words \{ position: absolute; inset: 0; z-index: 0;[^}]*user-select: text; -webkit-user-select: text; \}/);
  assert.match(css, /\.pw-words > span \{[^}]*color: transparent;/);
  assert.match(css, /\.pw-hits \{[^}]*pointer-events: none; z-index: 1; \}/);
  assert.match(css, /\.pw-marks \{[^}]*pointer-events: none; z-index: 2; \}/);
  // a link on a page lets presses through to its words; the margin's markers stay buttons above
  assert.match(css, /\.pw-page \.pw-mark \{ pointer-events: none; \}/);
  assert.match(css, /\.pw-margin \{[^}]*z-index: 4;/);
  // armed: crosshair over the pages and the image
  assert.match(css, /\.pw-win\.boxing \.pw-page, \.pw-win\.boxing \.pw-page \.pw-words > span, \.pw-win\.boxing \.pw-image \{ cursor: crosshair; \}/);
  const win = readFileSync(new URL("../src/web/src/paperwin.ts", import.meta.url), "utf8");
  assert.match(win, /<button class="icon" data-pw-box aria-pressed="false" title="Draw a box[^"]*"/);
  assert.doesNotMatch(win, /TextLayer|getTextContent/);
});
