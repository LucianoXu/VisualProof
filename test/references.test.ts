// The references (the owner's decisions of 2026-10-11, after Safari). The reference window reads a
// page's text from the server, never from pdf.js: search answers from poppler's words, its matches
// drawn as boxes line by line; a box drawn on a page takes the words inside it as its quote and its
// default label; the page bundles pdf.js's legacy build, whose worker and assets the server serves,
// and asks pdf.js for no text. The library's popover: its head when it chooses a file, its dates
// in English.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { defaultLabel, lineRects, quoteInRegion, quoteRects } from "../src/shared/library.ts";
import type { Region, Word } from "../src/shared/library.ts";
import { libraryDate, libraryHead } from "../src/web/src/library.ts";
import { tinyPdf } from "./pdf.ts";
import { site } from "./site.ts";

const PDF = tinyPdf([["Let G be a game between an adversary and a challenger.", "The advantage is small."], ["Theorem 3. Halving undoes doubling.", "Proof by induction on n."]], "A Tiny Paper on Games");

test("search reads the server's words, and its matches are drawn as boxes of their words, one box a line; a box takes the words inside it as its quote and its label", async () => {
  const S = await site();
  try {
    const r = await fetch(`${S.base}/api/library/upload?name=paper.pdf`, { method: "POST", headers: { "x-visualproof-name": "Alice" }, body: new Uint8Array(PDF) });
    const sha = ((await r.json()) as { file: { sha: string } }).file.sha;
    // a match across a line break: two boxes, one for each line's words
    const s = await S.ask("GET", `/api/library/search?sha=${sha}&q=${encodeURIComponent("a challenger. The advantage")}&limit=500`);
    assert.equal(s.status, 200);
    const m = s.json!.matches[0] as { page: number; boxes: Region[] };
    assert.equal(m.page, 1);
    assert.equal(m.boxes.length, 4, "a word a box, as the server answers");
    const lit = lineRects(m.boxes);
    assert.equal(lit.length, 2, "drawn as one box a line");
    assert.ok(lit[0][3] <= lit[1][1] + 0.005, "the first line above the second");
    assert.ok(lit[1][0] < lit[0][0], "the second line starts at the margin");
    // case and white space loosely, every match
    assert.equal((await S.ask("GET", `/api/library/search?sha=${sha}&q=${encodeURIComponent("THEOREM   3")}`)).json!.matches.length, 1);
    // a box around the first line of page 2: its words are the quote, the label the page and them
    const t = await S.ask("GET", `/api/library/text?sha=${sha}&page=2`);
    const words = t.json!.words as Word[];
    const lines = t.json!.lines as number[];
    const first = words.filter((w) => w[2] < words[0][4]);
    const box: Region = [first[0][1] - 0.01, first[0][2] - 0.005, Math.max(...first.map((w) => w[3])) + 0.01, first[0][4] + 0.005];
    const quote = quoteInRegion(words, lines, box);
    assert.deepEqual(quote, { text: "Theorem 3. Halving undoes doubling.", after: "Proof by induction on n." });
    assert.equal(defaultLabel({ page: 2, region: box, quote: quote! }, "pdf"), "p. 2 “Theorem 3. Halving undoes doubling.”");
    // found again in the page's words, where it is lit for a link with no region
    assert.deepEqual(quoteRects(words, lines, quote!), [lineRects(first.map((w) => [w[1], w[2], w[3], w[4]] as Region))[0]]);
    // a box around no words: a region alone, labelled by its page
    assert.equal(quoteInRegion(words, lines, [0.6, 0.6, 0.9, 0.9]), null);
    assert.equal(defaultLabel({ page: 2, region: [0.6, 0.6, 0.9, 0.9] }, "pdf"), "p. 2");
  } finally {
    await S.close();
  }
});

test("a box across two columns quotes its own words, with the text around them kept", () => {
  // two columns read column by column: the left one's two lines, then the right one's
  const words: Word[] = [
    ["Left", 0.1, 0.1, 0.2, 0.12],
    ["one", 0.21, 0.1, 0.3, 0.12],
    ["Left", 0.1, 0.13, 0.2, 0.15],
    ["two", 0.21, 0.13, 0.3, 0.15],
    ["Right", 0.6, 0.1, 0.7, 0.12],
    ["one", 0.71, 0.1, 0.8, 0.12],
  ];
  const lines = [0, 2, 4];
  // the first line of both columns: the words between them in reading order are left out
  const q = quoteInRegion(words, lines, [0.05, 0.09, 0.85, 0.125]);
  assert.equal(q?.text, "Left one Right one");
  assert.equal(q?.after, undefined);
  // the left column alone: its text as it reads
  assert.deepEqual(quoteInRegion(words, lines, [0.05, 0.09, 0.35, 0.16]), { text: "Left one Left two", after: "Right one" });
});

test("the page bundles pdf.js's legacy build and never asks it for text; the server serves its worker and its assets", async () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  for (const f of ["web/src/paperview.ts", "web/src/paperwin.ts"]) {
    assert.doesNotMatch(src(f), /getTextContent|TextLayer|streamTextContent/, `${f} asks pdf.js for no text`);
  }
  assert.match(src("web/src/paperview.ts"), /from "pdfjs-dist\/legacy\/build\/pdf\.min\.mjs"/);
  assert.match(src("server/pipeline.ts"), /"pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs"/);
  const S = await site();
  try {
    const font = await fetch(`${S.base}/pdfjs/standard_fonts/FoxitDingbats.pfb`);
    assert.equal(font.status, 200);
    assert.equal((await fetch(`${S.base}/pdfjs/wasm/openjpeg.wasm`)).headers.get("content-type"), "application/wasm");
    // its script engine for PDFs' JavaScript is never served
    assert.equal((await fetch(`${S.base}/pdfjs/wasm/quickjs-eval.wasm`)).status, 404);
  } finally {
    await S.close();
  }
});

test("the library's popover choosing a file to link: its title alone, which wraps, then Cancel and ✕ on its first line; no comment squeezed under it", () => {
  const head = libraryHead({ link: "decl(Nat.Prime.eq_one_or_self_of_dvd)" });
  assert.match(head, /^<div class="lb-head"><div class="lb-head-t"><b>Link [^<]*eq_one_or_self_of_dvd to a reference<\/b><\/div><button class="link" data-lb-cancel>Cancel<\/button><button class="icon" data-lb-close [^>]*>✕<\/button><\/div>$/);
  assert.doesNotMatch(head, /choose the file|muted/);
  // attaching: what becomes of the file, on a line of its own under the head
  const attach = libraryHead({ attach: "n1", label: "Theorem 8" });
  assert.match(attach, /<\/div><div class="muted lb-hint">An image is attached whole, a paper whole or by a clip of it\.<\/div>$/);
  // the Library itself: what it holds beside its name, in the same wrapping block, and ✕ alone
  const lib = libraryHead(null);
  assert.match(lib, /<div class="lb-head-t"><b>Library<\/b> <span class="muted">references — papers and images — /);
  assert.doesNotMatch(lib, /Cancel/);
  // laid out so: the title takes the room and wraps, the buttons never shrink or wrap
  const css = readFileSync(new URL("../src/web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.lb-head \{ display: flex; align-items: flex-start;/);
  assert.match(css, /\.lb-head-t \{ flex: 1 1 auto; min-width: 0;[^}]*overflow-wrap: anywhere; \}/);
  assert.match(css, /\.lb-head > \.link, \.lb-head > \.icon \{ flex: none;[^}]*white-space: nowrap; \}/);
});

test("the library writes a file's date in English, whatever the browser's language", () => {
  assert.equal(libraryDate("2026-10-11T07:37:51.896Z"), "Oct 11, 2026");
  assert.equal(libraryDate("2026-01-02T12:00:00Z"), "Jan 2, 2026");
  assert.equal(libraryDate("not a date"), "");
  // the library's rows use it
  assert.match(readFileSync(new URL("../src/web/src/library.ts", import.meta.url), "utf8"), /\$\{libraryDate\(f\.at\)\}/);
});

test("a glyph a PDF's font maps to no character is no text: left out of the server's words, and out of a box's quote where words read before still carry it", async () => {
  const { parseBboxLayout } = await import("../src/server/poppler.ts");
  const xhtml = `<page width="100" height="100"><line><word xMin="10" yMin="10" xMax="20" yMax="12">Pr</word><word xMin="21" yMin="10" xMax="23" yMax="12">&#x2;</word><word xMin="24" yMin="10" xMax="30" yMax="12">x</word></line></page>`;
  assert.deepEqual(
    parseBboxLayout(xhtml)[0].words.map((w) => w[0]),
    ["Pr", "x"],
  );
  // words kept from before, with the control character: the quote, its context and the note made of
  // it hold none
  const words: Word[] = [
    ["Pr", 0.1, 0.1, 0.2, 0.12],
    ["\u0002", 0.21, 0.1, 0.23, 0.12],
    ["x", 0.24, 0.1, 0.3, 0.12],
    ["\u0003", 0.1, 0.2, 0.2, 0.22],
  ];
  const q = quoteInRegion(words, [0, 3], [0.05, 0.05, 0.35, 0.15]);
  assert.deepEqual(q, { text: "Pr x" });
  assert.equal(quoteInRegion(words, [0, 3], [0.05, 0.18, 0.35, 0.25]), null, "a box of nothing but such glyphs quotes nothing");
});
