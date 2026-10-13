// What a drag on a PDF's page does in the reference window (AttachmentSpec decisions 5 and 11, the
// owner's decision of 2026-10-12): by default it selects text, as in any PDF reader, so that the
// reader can copy it; the box is a tool, armed by the window's ▭ for the next drag alone, which
// draws a box to link or clip and then disarms itself. Selecting text makes nothing: no link, no
// clip, no offer of one.
//
// The text to select is the server's words of the page (server/poppler.ts), never pdf.js's, whose
// text extraction failed in Safari: a layer of transparent words over the drawn page, one span a
// word, each at its word's box, in the reading order the server gives. The selection is the
// browser's own, so that ⌘C, Ctrl+C and the context menu's Copy copy it; but where it starts and
// ends is decided here, from the words' boxes, rather than by the browser's hit-testing of
// absolutely placed spans, which jumps across the page in the blank between them and differs
// between browsers. It is lit here too, a box a line in the browser's selection colour, since the
// browser lights each span on its own, of uneven heights and with seams where two meet. And what
// is copied is made here: the words in reading order, a space between two words of a line, a line
// break between lines.
//
// This module holds what can be decided without a page: the layer's geometry, the word nearest a
// point, where a selection is lit and the text it copies, a drag's and the tool's states.
// web/src/paperview.ts draws them.

import { lineRects } from "../../shared/library.ts";
import type { Region, Word } from "../../shared/library.ts";

/** A place among a PDF's words: the page, the word's index on it in reading order, and how many
 *  of the word's characters come before the place. */
export interface WordPos {
  page: number;
  k: number;
  at: number;
}

/** A page's words as the server reads them, and where each line starts among them. */
export interface WordsOfPage {
  words: readonly Word[];
  lines: readonly number[];
}

/** A word as the layer draws it: its box's top left in the page's fractions, the height of its
 *  letters as a fraction of the page's height, how much they are stretched across to fill its box,
 *  and its text with a space after it but the page's last, so that the browser's own reading of a
 *  selection (the services a Mac offers on it, a drag of it) has its words apart; what is copied is
 *  made here (`copyText`). `spacing` (the CSS word-spacing, in its letters' height) makes that space
 *  as wide as the gap to the next word of its line, and nothing at a line's end, so that a
 *  selection is lit across a line with neither seams nor gaps. */
export interface WordSpan {
  text: string;
  left: number;
  top: number;
  size: number;
  stretch: number;
  spacing: number;
}

/** the least and the most a word's letters are stretched: a word whose box says something absurd
 *  is still drawn */
const STRETCH = [0.05, 20] as const;

/** The layer's spans of a page's words: each at its word's box, its letters as tall as the box and
 *  stretched across to its width. `aspect` is the page's width over its height; `measure` the width
 *  of a text whose letters are 1 px tall, in the layer's font. */
export function wordSpans(p: WordsOfPage, aspect: number, measure: (text: string) => number): WordSpan[] {
  const starts = new Set(p.lines);
  const space = measure(" ");
  return p.words.map((w, k) => {
    const [text, x0, y0, x1, y1] = w;
    const h = Math.max(0, y1 - y0);
    const m = measure(text);
    const stretch = m > 0 && h > 0 ? Math.min(STRETCH[1], Math.max(STRETCH[0], ((x1 - x0) * aspect) / (h * m))) : 1;
    // the gap to the next word of its line, in the page's width, as the space after it is drawn
    const next = k + 1 < p.words.length && !starts.has(k + 1) ? p.words[k + 1] : null;
    const gap = next ? Math.max(0, next[1] - x1) : 0;
    const spacing = h > 0 ? (gap * aspect) / (h * stretch) - space : 0;
    return { text: k === p.words.length - 1 ? text : `${text} `, left: x0, top: y0, size: h, stretch, spacing };
  });
}

/** The line word `k` is on: its first word and its last. */
export function lineOf(p: WordsOfPage, k: number): [number, number] {
  let first = 0;
  for (const s of p.lines) if (s <= k && s > first) first = s;
  const next = p.lines.find((s) => s > k);
  return [first, (next ?? p.words.length) - 1];
}

/** how much taller than a page's usual word a word is to be read as standing on end (an arXiv
 *  stamp turned up the margin), which a point beside it is not level with */
const TALL = 3;
const usualHeights = new WeakMap<readonly Word[], number>();

/** The height of a page's usual word: the middle one of their heights. */
function usualHeight(words: readonly Word[]): number {
  let h = usualHeights.get(words);
  if (h === undefined) {
    const hs = words.map((w) => w[4] - w[2]).sort((a, b) => a - b);
    h = hs[hs.length >> 1] ?? 0;
    usualHeights.set(words, h);
  }
  return h;
}

/** The place among a page's words nearest the point (`x`, `y`, in the page's fractions): on the
 *  word under it, as many of its characters before it as the point is across the word; else, of the
 *  words level with the point, the nearest across — the end of a line past its last word, the
 *  start of one before its first; else the nearest word above or below. A word standing on end, far
 *  taller than the page's usual word (a stamp up the margin), is level with nothing, so that a drag
 *  from the margin starts at the line beside it. Null on a page with no words. `aspect` is the
 *  page's width over its height. */
export function nearestWord(p: WordsOfPage, x: number, y: number, aspect: number): { k: number; at: number } | null {
  const tall = TALL * usualHeight(p.words);
  let best = -1;
  // 0: on the word, 1: level with it, 2: neither; and how far, within the rank
  let bestRank = 3;
  let bestD = Infinity;
  p.words.forEach((w, k) => {
    const dx = Math.max(w[1] - x, 0, x - w[3]) * aspect;
    const dy = Math.max(w[2] - y, 0, y - w[4]);
    const rank = !dx && !dy ? 0 : !dy && w[4] - w[2] <= tall ? 1 : 2;
    const d = rank === 2 ? dy * 4 + dx : dx;
    if (rank < bestRank || (rank === bestRank && d < bestD)) {
      best = k;
      bestRank = rank;
      bestD = d;
    }
  });
  if (best < 0) return null;
  const [text, x0, , x1] = p.words[best];
  const across = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
  return { k: best, at: Math.round(Math.min(1, Math.max(0, across)) * text.length) };
}

/** Whether place `a` comes before place `b` in reading order (or is it). */
export function notAfter(a: WordPos, b: WordPos): boolean {
  return a.page !== b.page ? a.page < b.page : a.k !== b.k ? a.k < b.k : a.at <= b.at;
}

/** Control characters, which a word read from a PDF may carry for a glyph its font maps to nothing:
 *  no text to copy. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** The text a selection from one place to the other copies, whichever comes first: the words
 *  between them in reading order, the first and the last cut where the selection cuts them; a space
 *  between two words of a line, a line break between lines and between pages. A page whose words
 *  are not known adds nothing. */
export function copyText(pageOf: (page: number) => WordsOfPage | null | undefined, from: WordPos, to: WordPos): string {
  const [a, b] = notAfter(from, to) ? [from, to] : [to, from];
  let out = "";
  let line = false;
  for (let n = a.page; n <= b.page; n++) {
    const p = pageOf(n);
    if (!p || !p.words.length) continue;
    const starts = new Set(p.lines);
    const first = n === a.page ? Math.min(a.k, p.words.length - 1) : 0;
    const last = n === b.page ? Math.min(b.k, p.words.length - 1) : p.words.length - 1;
    if (out) line = true;
    for (let k = first; k <= last; k++) {
      const w = p.words[k][0];
      const piece = w.slice(n === a.page && k === a.k ? a.at : 0, n === b.page && k === b.k ? b.at : w.length).replace(CONTROL, "");
      if (k > first && starts.has(k)) line = true;
      if (!piece) continue;
      if (out) out += line ? "\n" : " ";
      out += piece;
      line = false;
    }
  }
  return out;
}

/** Where a selection is lit on a page: a box a line over the words selected, from `from` (null: the
 *  page's start) to `to` (null: its end), the first and the last word cut where the selection cuts
 *  them, as far across as their letters before the cut go. */
export function selectedRects(p: WordsOfPage, from: WordPos | null, to: WordPos | null): Region[] {
  if (!p.words.length) return [];
  const first = from ? Math.min(from.k, p.words.length - 1) : 0;
  const last = to ? Math.min(to.k, p.words.length - 1) : p.words.length - 1;
  const boxes: Region[] = [];
  for (let k = first; k <= last; k++) {
    const [text, x0, y0, x1, y1] = p.words[k];
    const across = (at: number) => x0 + ((x1 - x0) * Math.min(at, text.length)) / Math.max(1, text.length);
    const l = from && k === from.k ? across(from.at) : x0;
    const r = to && k === to.k ? across(to.at) : x1;
    if (r > l) boxes.push([l, y0, r, y1]);
  }
  return lineRects(boxes);
}

// ------------------------------------------------------------------ the box tool

/** The box tool's state: armed by the window's ▭ for the next drag alone, which draws a box; then
 *  it disarms itself. The button pressed again, or Esc, disarms it without drawing. It is the
 *  reader's own (web/src/surfaces.ts): those who follow them never see it. */
export class BoxTool {
  armed = false;
  private changed: (armed: boolean) => void;

  constructor(changed: (armed: boolean) => void) {
    this.changed = changed;
  }

  /** The button: armed where it was not, disarmed where it was. */
  press(): void {
    this.set(!this.armed);
  }

  /** Esc: disarmed; whether it was armed, so that Esc does nothing else. */
  escape(): boolean {
    if (!this.armed) return false;
    this.set(false);
    return true;
  }

  /** A box was drawn with it: it disarms itself. */
  drawn(): void {
    this.set(false);
  }

  /** The window closed: disarmed. */
  reset(): void {
    this.set(false);
  }

  private set(on: boolean): void {
    if (on === this.armed) return;
    this.armed = on;
    this.changed(on);
  }
}

/** What a press on a page or an image starts: a box (the tool armed; mouse and pen), a text
 *  selection (a PDF's page), a pan (an image, which has no text), or nothing of the window's own — a
 *  touch on a PDF scrolls its pages, a button other than the first is the browser's (the context
 *  menu), and a marker in the margin is a button of its own. */
export function pressKind(o: { armed: boolean; image: boolean; pointer: string; button: number; marker: boolean }): "box" | "text" | "pan" | null {
  if (o.button !== 0 || o.marker) return null;
  if (o.armed && o.pointer !== "touch") return "box";
  if (o.image) return "pan";
  return o.pointer === "touch" ? null : "text";
}

/** how far a press moves, in pixels, before it selects: less is a click */
export const SELECT_PX = 3;

/** What a text drag asks of the page it is on. */
export interface TextDragHooks {
  /** where the drag started, among the words; null while that page's words are not there */
  anchor(): WordPos | null;
  /** the place among the words nearest a point of the screen; null where no page's words are */
  posAt(x: number, y: number): WordPos | null;
  /** the browser's selection, from one place to another */
  select(from: WordPos, to: WordPos): void;
  /** a press that hardly moved: a click there */
  click(x: number, y: number): void;
}

/** One press on a PDF's page with the box tool disarmed: moved, it selects the words from where it
 *  started to where the pointer is; hardly moved, it is a click. With Shift it extends the selection
 *  there is from its start (`anchor` answers that start), as a click with Shift does in any reader.
 *  It offers nothing: no link, no clip. */
export class TextDrag {
  private x0: number;
  private y0: number;
  private hooks: TextDragHooks;
  private extend: boolean;
  private start: WordPos | null = null;
  moved = false;

  constructor(x0: number, y0: number, hooks: TextDragHooks, extend = false) {
    this.x0 = x0;
    this.y0 = y0;
    this.hooks = hooks;
    this.extend = extend;
  }

  move(x: number, y: number): void {
    if (!this.moved && Math.abs(x - this.x0) < SELECT_PX && Math.abs(y - this.y0) < SELECT_PX) return;
    this.moved = true;
    this.to(x, y);
  }

  up(x: number, y: number): void {
    if (this.moved) this.to(x, y);
    else if (this.extend && this.anchor()) this.to(x, y);
    else this.hooks.click(x, y);
  }

  private anchor(): WordPos | null {
    this.start ??= this.hooks.anchor();
    return this.start;
  }

  private to(x: number, y: number): void {
    const a = this.anchor();
    const b = a && this.hooks.posAt(x, y);
    if (a && b) this.hooks.select(a, b);
  }
}

/** how close in time, in ms, and in space, in pixels, presses are to count as one double or triple
 *  click */
const CLICK_MS = 450;
const CLICK_PX = 5;

/** Counts clicks in a row: a second within a short while and a few pixels of the first is a double
 *  click (a word), a third a triple (a line). The page counts them itself, since it decides where a
 *  selection starts and ends. */
export class Clicks {
  private last: { t: number; x: number; y: number; n: number } | null = null;

  count(t: number, x: number, y: number): number {
    const l = this.last;
    const n = l && t - l.t <= CLICK_MS && Math.abs(x - l.x) <= CLICK_PX && Math.abs(y - l.y) <= CLICK_PX ? (l.n % 3) + 1 : 1;
    this.last = { t, x, y, n };
    return n;
  }
}
