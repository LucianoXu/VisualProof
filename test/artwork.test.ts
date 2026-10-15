// Artwork (ExportSpec decision 19, web/src/artwork.ts): the board is the picture. Its SVG is what the
// board's renderer draws, read as shapes, and what the board writes over it, recorded as SVG
// (SvgContext), within the frame; its PNG is the board drawn again at the size chosen, made band by
// band. The settings are read with care, and the file is named so that every file system takes it.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArtShape } from "../src/web/src/canvas.ts";
import type { NotePicture } from "../src/web/src/artwork.ts";
import type { NameRow } from "../src/web/src/artwork.ts";
import { artName, artSvg, borderBand, borderInset, bundlePoints, cleanSettings, drawBackdrop, drawBorder, drawFoot, drawNotes, drawTitle, MAX_SIDE, NAME_ROWS, nameRows, oriented, presetOf, PRESETS, sourceLine, svgColour, SvgContext, titleOf, withChosen, wrapText } from "../src/web/src/artwork.ts";
import { ART_NAMES_BYTES } from "../src/shared/collab.ts";
import { arcHalf, HALO, writeNames } from "../src/web/src/halo.ts";

const FAMILY = `"Inter", sans-serif`;
const measure = (t: string) => t.length * 6;
const ctxOf = (pen: SvgContext) => pen as unknown as CanvasRenderingContext2D;

test("the picture is the frame's at the size chosen: its viewBox the frame's pixels, what lies outside it clipped away; the background the theme's, white or none", () => {
  const frame = { x: 100, y: 50, w: 400, h: 225 };
  const svg = artSvg(frame, { w: 3840, h: 2160 }, "#fafafa", FAMILY, measure, (pen) => pen.shape({ kind: "circle", x: 300, y: 160, r: 4, fill: [1, 0, 0, 1], stroke: null, ring: 0, ringR: 4, dashed: false }));
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 400 225" width="3840" height="2160" font-family="&quot;Inter&quot;, sans-serif">/);
  assert.match(svg, /<clipPath id="frame"><rect width="400" height="225"\/><\/clipPath>/);
  assert.match(svg, /<rect width="100%" height="100%" fill="rgb\(250,250,250\)"\/><g clip-path="url\(#frame\)"><g transform="translate\(-100 -50\)"><circle cx="300" cy="160" r="4" fill="rgb\(255,0,0\)"\/><\/g><\/g><\/svg>$/);
  assert.ok(!artSvg(frame, { w: 10, h: 10 }, null, FAMILY, measure, () => {}).includes(`height="100%"`), "transparent: no background");
});

test("the renderer's shapes as SVG draws them: a point and its ring, a dashed ring apart from its disc, a segment, an edge's spline coloured from end to end", () => {
  const pen = new SvgContext(measure, FAMILY);
  const shapes: ArtShape[] = [
    { kind: "circle", x: 10, y: 20, r: 3, fill: [0, 0, 1, 0.5], stroke: [0, 0, 0, 1], ring: 1, ringR: 3, dashed: false },
    { kind: "circle", x: 50, y: 50, r: 30, fill: [0, 0, 0, 0], stroke: [0.5, 0.5, 0.5, 0.75], ring: 1.2, ringR: 32.5, dashed: true },
    { kind: "circle", x: 60, y: 60, r: 8, fill: [0, 1, 0, 1], stroke: [0, 0, 0, 1], ring: 2, ringR: 10, dashed: false },
    { kind: "line", x0: 0, y0: 0, x1: 10, y1: 10, colour: [1, 1, 1, 0.25], width: 1.5 },
    { kind: "bundle", ctrl: [0, 0, 50, 80, 100, 0], beta: 0.85, width: 1.6, c0: [1, 0.5, 0, 0.4], c1: [0, 0.5, 1, 0.4] },
    { kind: "bundle", ctrl: [0, 0, 100, 0], beta: 0.85, width: 1, c0: [1, 0, 0, 1], c1: [1, 0, 0, 1] },
  ];
  for (const s of shapes) pen.shape(s);
  const [dot, dashed, disc, ring, line, bent, straight] = pen.body;
  assert.equal(dot, `<circle cx="10" cy="20" r="3" fill="rgb(0,0,255)" fill-opacity="0.5" stroke="rgb(0,0,0)" stroke-width="1"/>`);
  assert.equal(dashed, `<circle cx="50" cy="50" r="32.5" fill="none" stroke="rgb(128,128,128)" stroke-opacity="0.75" stroke-width="1.2" stroke-dasharray="5 4"/>`, "a ring alone: no disc");
  assert.equal(disc, `<circle cx="60" cy="60" r="8" fill="rgb(0,255,0)"/>`);
  assert.equal(ring, `<circle cx="60" cy="60" r="10" fill="none" stroke="rgb(0,0,0)" stroke-width="2"/>`, "a ring off its disc: apart");
  assert.equal(line, `<line x1="0" y1="0" x2="10" y2="10" stroke="rgb(255,255,255)" stroke-opacity="0.25" stroke-width="1.5"/>`);
  // the shader's spline, as finely as it draws it, its colours by a gradient from end to end
  assert.equal(bent.match(/[ML]/g)!.length, 49);
  assert.match(bent, /^<path d="M0,0L.*L100,0" fill="none" stroke="url\(#e0\)" stroke-width="1.6"\/>$/);
  assert.deepEqual(pen.defs, [`<linearGradient id="e0" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"><stop offset="0" stop-color="rgb(255,128,0)" stop-opacity="0.4"/><stop offset="1" stop-color="rgb(0,128,255)" stop-opacity="0.4"/></linearGradient>`]);
  assert.match(straight, /stroke="rgb\(255,0,0\)" stroke-width="1"\/>$/, "one colour: no gradient");
});

test("what the board writes is recorded as it is written: paths filled and stroked, arcs, dashes, the context's alpha, texts in their fonts, gradients once", () => {
  const pen = new SvgContext(measure, FAMILY);
  const c = ctxOf(pen);
  // a ring round a point: a whole turn is a circle in two halves
  c.beginPath();
  c.arc(10, 10, 5, 0, 2 * Math.PI);
  c.strokeStyle = "rgba(10, 20, 30, 0.5)";
  c.lineWidth = 2;
  c.setLineDash([3, 2]);
  c.stroke();
  c.setLineDash([]);
  assert.equal(pen.body[0], `<path d="M15,10A5 5 0 1 1 5,10A5 5 0 1 1 15,10" fill="none" stroke="rgb(10,20,30)" stroke-opacity="0.5" stroke-width="2" stroke-dasharray="3 2"/>`);
  // a quarter, and three quarters the other way round
  c.beginPath();
  c.arc(0, 0, 10, 0, Math.PI / 2);
  c.fillStyle = "#336699";
  c.fill();
  assert.equal(pen.body[1], `<path d="M10,0A10 10 0 0 1 0,10" fill="rgb(51,102,153)"/>`);
  c.beginPath();
  c.moveTo(0, 0);
  c.arc(0, 0, 10, 0, Math.PI / 2, true);
  c.closePath();
  c.fill();
  assert.equal(pen.body[2], `<path d="M0,0L10,0A10 10 0 1 0 0,10Z" fill="rgb(51,102,153)"/>`);
  // the context's alpha, kept by save and given back by restore
  c.save();
  c.globalAlpha = 0.5;
  c.fillStyle = "#fff8";
  c.beginPath();
  c.rect(0, 0, 4, 4);
  c.fill();
  c.restore();
  assert.equal(pen.body[3], `<path d="M0,0L4,0L4,4L0,4Z" fill="rgb(255,255,255)" fill-opacity="0.267"/>`);
  assert.equal(c.globalAlpha, 1);
  // texts: a cluster's name, centred and bold; a declaration's, from its left; a halo; another font
  c.font = `600 14px ${FAMILY}`;
  c.textAlign = "center";
  c.fillStyle = "rgb(20, 20, 20)";
  c.fillText("Fixture <A&B>", 100, 40);
  c.font = `11px ${FAMILY}`;
  c.textAlign = "left";
  c.fillText("helper", 5, 6);
  c.lineWidth = 3;
  c.lineJoin = "round";
  c.strokeStyle = "rgba(250,250,250,0.9)";
  c.strokeText("main", 1, 2);
  c.font = "italic 500 12px Georgia";
  c.textBaseline = "middle";
  c.fillText("note", 0, 0);
  assert.deepEqual(pen.body.slice(4), [
    `<text x="100" y="40" font-size="14" font-weight="600" text-anchor="middle" fill="rgb(20,20,20)">Fixture &lt;A&amp;B&gt;</text>`,
    `<text x="5" y="6" font-size="11" fill="rgb(20,20,20)">helper</text>`,
    `<text x="1" y="2" font-size="11" fill="none" stroke="rgb(250,250,250)" stroke-opacity="0.9" stroke-width="3" stroke-linejoin="round">main</text>`,
    `<text x="0" y="0" font-size="12" font-weight="500" font-style="italic" font-family="Georgia" dominant-baseline="central" fill="rgb(20,20,20)">note</text>`,
  ]);
  assert.equal(c.measureText("abc").width, 18);
  // a gradient, written once however often it is used
  const g = c.createLinearGradient(0, 0, 10, 0);
  g.addColorStop(0, "#ff0000");
  g.addColorStop(1, "rgba(0,0,255,0.5)");
  c.strokeStyle = g;
  c.setLineDash([]);
  c.lineJoin = "miter";
  c.lineWidth = 1;
  for (let k = 0; k < 2; k++) {
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(10, 0);
    c.stroke();
  }
  assert.equal(pen.defs.length, 1);
  assert.equal(pen.defs[0], `<linearGradient id="g0" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0"><stop offset="0" stop-color="rgb(255,0,0)" stop-opacity="1"/><stop offset="1" stop-color="rgb(0,0,255)" stop-opacity="0.5"/></linearGradient>`);
  assert.equal(pen.body.at(-1), `<path d="M0,0L10,0" fill="none" stroke="url(#g0)" stroke-width="1"/>`);
  // what is cleared is nothing; a transform scales and moves what follows
  c.clearRect(0, 0, 100, 100);
  c.setTransform(2, 0, 0, 2, 10, 20);
  c.beginPath();
  c.arc(0, 0, 3, 0, 2 * Math.PI);
  c.stroke();
  assert.match(pen.body.at(-1)!, /^<path d="M16,20A6 6 0 1 1 4,20A6 6 0 1 1 16,20" fill="none" stroke="url\(#g0\)" stroke-width="2"\/>$/);
});

test("colours as SVG writes them: hex, rgb() and rgba() read, an opacity apart; any other as it is", () => {
  assert.deepEqual(svgColour("#abc"), { rgb: "rgb(170,187,204)", a: 1 });
  assert.deepEqual(svgColour("#11223380"), { rgb: "rgb(17,34,51)", a: 0.502 });
  assert.deepEqual(svgColour("rgb(1, 2, 3)"), { rgb: "rgb(1,2,3)", a: 1 });
  assert.deepEqual(svgColour("rgba(1,2,3,0.25)", 0.5), { rgb: "rgb(1,2,3)", a: 0.125 });
  assert.deepEqual(svgColour("rgb(1 2 3 / 40%)"), { rgb: "rgb(1,2,3)", a: 0.4 });
  assert.deepEqual(svgColour("currentColor"), { rgb: "currentColor", a: 1 });
});

test("the notes as the board shows them: the leader to a declaration and its diamond, the leader to the card, the icon with its glyph, its dot as far as it turned into one, the card with its text", () => {
  const pen = new SvgContext(measure, FAMILY);
  const base: NotePicture = { x: 30, y: 40, r: 12, t: 1, fill: "rgb(255, 255, 255)", ring: "rgb(80, 80, 255)", ringW: 1.5, dashed: false, glyph: `<path d="M3 2.5h10"/>`, glyphPx: 14, colour: "rgb(80, 80, 255)", dot: "rgb(80, 80, 255)", surface: "rgb(255, 255, 255)", decl: null, card: null, lead: null };
  const glyphs: NotePicture[] = [];
  const open: NotePicture = {
    ...base,
    decl: { line: [30, 40, 60, 40], width: 1.5, colour: "rgba(80, 80, 255, 0.85)", mark: [62, 40], markPx: 5 },
    card: { x: 50, y: 0, w: 120, h: 60, bg: "rgb(255, 250, 230)", edge: "rgba(0, 0, 0, 0.1)", accent: "rgb(80, 80, 255)", text: "Why <this> holds", by: "Alice", textColour: "rgb(20, 20, 20)", byColour: "rgb(120, 120, 120)" },
    lead: { line: [40, 35, 50, 30], colour: "rgba(80, 80, 255, 0.75)", dashed: true },
  };
  // a dot alone, and an icon half turned into one
  drawNotes(ctxOf(pen), [open, { ...base, t: 0, r: 2.5 }, { ...base, x: 0, y: 0, t: 0.5, r: 6 }], FAMILY, (n) => glyphs.push(n));
  const b = pen.body;
  assert.equal(b[0], `<path d="M30,40L60,40" fill="none" stroke="rgb(80,80,255)" stroke-opacity="0.85" stroke-width="1.5" stroke-dasharray="4.5 4.5"/>`, "the leader to the declaration, dashed");
  assert.match(b[1], /^<path d="M62,36.46L65.54,40L62,43.54L58.46,40Z" fill="rgb\(80,80,255\)" fill-opacity="0.85"\/>$/, "the diamond on the point's rim");
  assert.equal(b[3], `<path d="M40,35L50,30" fill="none" stroke="rgb(80,80,255)" stroke-opacity="0.75" stroke-width="1.2" stroke-dasharray="4 3"/>`, "the leader to the card");
  assert.match(b[4], /^<path d="M41.25,40A11.25 11.25 0 1 1 18.75,40A11.25 11.25 0 1 1 41.25,40" fill="rgb\(255,255,255\)"\/>$/, "the icon, its ring inside its edge");
  assert.match(b[5], /stroke="rgb\(80,80,255\)" stroke-width="1.5"\/>$/);
  const texts = b.filter((x) => x.startsWith("<text"));
  assert.deepEqual(texts, [`<text x="62" y="19.8" font-size="12.5" fill="rgb(20,20,20)">Why &lt;this&gt; holds</text>`, `<text x="62" y="51" font-size="11" fill="rgb(120,120,120)">Alice</text>`]);
  assert.deepEqual(glyphs.map((n) => n.t), [1, 0.5], "a glyph where the icon shows");
  // the dot: drawn over the icon as much as it has turned into one
  const dots = b.filter((x) => x.includes(`fill-opacity="1"`) || x.includes(`fill-opacity="0.5"`));
  assert.ok(dots.some((x) => x.includes(`fill-opacity="0.5"`)), "half way: half the dot");
  assert.ok(b.some((x) => /A2.81 2.81 0 1 1/.test(x)), "a dot alone: its radius a little past the mark's");
});

test("a card's text is broken as the card breaks it: at its line breaks, between words, inside a word too long", () => {
  const w = (t: string) => t.length;
  assert.deepEqual(wrapText("one two three", 8, w), ["one two", "three"]);
  assert.deepEqual(wrapText("a\nb c", 10, w), ["a", "b c"]);
  assert.deepEqual(wrapText("abcdefghij kl", 4, w), ["abcd", "efgh", "ij", "kl"]);
  assert.deepEqual(wrapText("", 4, w), [""]);
});

test("an edge is the board's spline: from one end to the other, through its clusters, straight where beta is 0", () => {
  const ctrl = [0, 0, 50, 80, 100, 0];
  const p = bundlePoints(ctrl, 0.85, 20);
  assert.deepEqual([p[0], p[1]], [0, 0]);
  assert.deepEqual([+p[p.length - 2].toFixed(6), +p[p.length - 1].toFixed(6)], [100, 0]);
  assert.ok(Math.max(...p.filter((_, k) => k % 2)) > 20, "bent towards the middle control point");
  const flat = bundlePoints(ctrl, 0, 20);
  assert.ok(flat.filter((_, k) => k % 2).every((y) => Math.abs(y) < 1e-9), "straight");
});

test("settings kept in a browser are read with care; a file's name is what no file system refuses", () => {
  const now = { scheme: "status" as const, theme: "dark" as const };
  const fresh = cleanSettings(undefined, now);
  assert.deepEqual([fresh.scheme, fresh.theme, fresh.w, fresh.h], ["status", "dark", 3840, 2160]);
  assert.deepEqual([fresh.labels, fresh.background, fresh.source], ["board", "theme", false], "names as on the board; the theme's background; no source");
  const odd = cleanSettings({ w: 99999, h: -5, scheme: "rainbow" as never, labels: "some" as never, notes: "yes" as never }, now);
  assert.deepEqual([odd.w, odd.h, odd.scheme, odd.labels, odd.notes], [MAX_SIDE, 16, "status", "board", true]);
  // kept before 2026-10-15: every name, and a white background, are no longer offered
  const older = cleanSettings({ labels: "all" as never, background: "white" as never }, now);
  assert.deepEqual([older.labels, older.background], ["board", "theme"]);
  assert.equal(artName("TCB of ns CaseI @ Oct 9 22:27", "png"), "TCB of ns CaseI @ Oct 9 22 27.png");
  assert.equal(artName("a/b\\\\c|d?.", "svg"), "a b c d.svg");
  assert.equal(artName("  ", "png"), "VisualProof.png");
});

test("names and targets by selection (the owner's decision of 2026-10-15): kept as given, checked; the list of names filtered and cut short; what is ticked within what the artwork carries", () => {
  const now = { scheme: "kind" as const, theme: "light" as const };
  const fresh = cleanSettings(undefined, now);
  assert.deepEqual([fresh.namesFrom, fresh.hiddenNames, fresh.shownNames, fresh.shownTargets, fresh.keys], ["board", [], [], [], true], "from As shown, nothing hidden or added; the key marks on");
  const kept = cleanSettings({ labels: "chosen", namesFrom: "none", hiddenNames: ["c:A", "nope", 3], shownNames: ["d:A.b", "d:A.b", ""], targets: "chosen", shownTargets: ["A.t", "A.t", ""], keys: false } as never, now);
  assert.deepEqual([kept.labels, kept.namesFrom, kept.hiddenNames, kept.shownNames, kept.targets, kept.shownTargets, kept.keys], ["chosen", "none", ["c:A"], ["d:A.b"], "chosen", ["A.t"], false]);
  assert.equal(cleanSettings({ namesFrom: "all" } as never, now).namesFrom, "board");
  // kept before the key marks had a switch of their own: as the targets drew them, with their stars
  assert.equal(cleanSettings({ targets: "plain" }, now).keys, false);
  assert.equal(cleanSettings({ targets: "highlight" }, now).keys, true);
  // the list: by the name written or the full name, whatever the case, in the order given (the
  // clusters' first); at most so many lines, and how many more the filter holds
  const rows: NameRow[] = [
    { id: "c:A.Sub", label: "Sub", full: "A.Sub", cluster: true },
    { id: "d:A.Sub.lemma", label: "lemma", full: "A.Sub.lemma", cluster: false },
    { id: "d:B.main", label: "main", full: "B.main", cluster: false },
  ];
  assert.deepEqual(nameRows(rows, ""), { rows, more: 0 });
  assert.deepEqual(nameRows(rows, " SUB ").rows.map((r) => r.id), ["c:A.Sub", "d:A.Sub.lemma"]);
  assert.deepEqual(nameRows(rows, "b.ma"), { rows: [rows[2]], more: 0 });
  assert.deepEqual(nameRows(rows, "", 1), { rows: [rows[0]], more: 2 });
  assert.equal(NAME_ROWS, 2000);
  // ticked: added after what is chosen, each once, while they fit in what the artwork carries to those
  // following; what does not fit is counted, to be said
  assert.deepEqual(withChosen(["d:A.b"], ["d:A.b", "d:A.c"], ART_NAMES_BYTES), { list: ["d:A.b", "d:A.c"], left: 0 });
  const many = Array.from({ length: 500 }, (_, i) => `d:FltRegular.CaseII.InductionStep.Proof.lemma_${i}`);
  const r = withChosen([], many, ART_NAMES_BYTES);
  assert.ok(r.list.length > 50 && r.list.length < many.length, `${r.list.length} names`);
  assert.deepEqual(r.list, many.slice(0, r.list.length), "the first ones, in their order");
  assert.equal(r.left, many.length - r.list.length);
  assert.ok(Buffer.byteLength(JSON.stringify(r.list)) <= ART_NAMES_BYTES);
  assert.deepEqual(withChosen(r.list, [many[r.list.length]], ART_NAMES_BYTES), { list: r.list, left: 1 }, "full: the next one is said, not added");
});

test("a size in either orientation: each preset across or down, the square alike; a size is its preset either way", () => {
  assert.deepEqual(oriented(1920, 1080, true), { w: 1080, h: 1920 });
  assert.deepEqual(oriented(1080, 1920, false), { w: 1920, h: 1080 });
  assert.deepEqual(oriented(1920, 1080, false), { w: 1920, h: 1080 });
  assert.deepEqual(oriented(4096, 4096, true), { w: 4096, h: 4096 });
  assert.equal(presetOf(3840, 2160), presetOf(2160, 3840));
  assert.equal(PRESETS[presetOf(3508, 4961)].name, "A3, 300 dpi");
  assert.equal(presetOf(1000, 700), -1);
  for (const p of PRESETS) assert.ok(p.w >= p.h, `${p.name}: given landscape`);
});

test("the foot: Generated by VisualProof at the bottom left, VisualProof in its wordmark; the source and commit at the bottom right where asked; each on its halo, at the size chosen", () => {
  // 2 % of 500 pixels high: 10 pixels, as far from the edges
  const frame = { x: 100, y: 50, w: 400, h: 500 };
  const pen = new SvgContext(measure, FAMILY);
  drawFoot(ctxOf(pen), frame, sourceLine({ source: "github.com/A/B", commit: "0123456789abcdef", branch: "main" }), { text: "rgb(80, 80, 80)", halo: "rgb(250, 250, 250)" }, FAMILY, 2);
  const texts = pen.body.filter((x) => x.startsWith("<text"));
  // three halos for each of the three, then the three
  assert.equal(texts.length, 12);
  const [pre, mark, src] = texts.slice(9);
  assert.equal(pre, `<text x="110" y="540" font-size="10" font-weight="500" fill="rgb(80,80,80)">Generated by </text>`);
  assert.match(mark, /^<text x="188" y="540" font-size="11" font-weight="700" fill="url\(#g0\)">VisualProof<\/text>$/);
  assert.equal(src, `<text x="490" y="540" font-size="10" font-weight="500" text-anchor="end" fill="rgb(80,80,80)">github.com/A/B · main @ 0123456</text>`);
  assert.match(pen.defs[0], /<stop offset="0" stop-color="rgb\(94,92,230\)".*<stop offset="0.5" stop-color="rgb\(191,90,242\)".*<stop offset="1" stop-color="rgb\(255,55,95\)"/);
  assert.match(texts[0], /fill="none" stroke="rgb\(250,250,250\)" stroke-opacity="0.22" stroke-width="7" stroke-linejoin="round">Generated by /);
  // none asked: the left alone
  const bare = new SvgContext(measure, FAMILY);
  drawFoot(ctxOf(bare), frame, null, { text: "#555", halo: "#fff" }, FAMILY, 2);
  assert.equal(bare.body.filter((x) => x.startsWith("<text")).length, 8);
  assert.equal(sourceLine({ source: null, commit: "abcdef0123", branch: null, dirty: true }), "commit abcdef0 (modified)");
  // a frame too narrow for both side by side: the source a line higher
  const narrow = new SvgContext(measure, FAMILY);
  drawFoot(ctxOf(narrow), { x: 0, y: 0, w: 200, h: 500 }, "github.com/A/B · 0123456", { text: "#555", halo: "#fff" }, FAMILY, 2);
  const ys = narrow.body.slice(-3).map((x) => /y="([\d.]+)"/.exec(x)![1]);
  assert.deepEqual(ys, ["490", "490", "476"]);
  // larger, and larger still than the frame allows across: smaller until it fits within its margins
  const sized = (text: string, font: string) => text.length * 0.6 * Number(/([\d.]+)px/.exec(font)![1]);
  const big = new SvgContext(sized, FAMILY);
  drawFoot(ctxOf(big), frame, null, { text: "#555", halo: "#fff" }, FAMILY, 4);
  assert.match(big.body.at(-2)!, /^<text x="120" y="530" font-size="20" /, "4 %: 20 pixels, 20 from the edges");
  const tight = new SvgContext(sized, FAMILY);
  drawFoot(ctxOf(tight), { x: 0, y: 0, w: 150, h: 500 }, null, { text: "#555", halo: "#fff" }, FAMILY, 2);
  const [p, m] = tight.body.slice(-2).map((x) => [Number(/ x="([\d.]+)"/.exec(x)![1]), Number(/font-size="([\d.]+)"/.exec(x)![1])]);
  assert.ok(p[1] < 10, `smaller: ${p[1]}`);
  assert.ok(Math.abs(m[0] + 11 * 0.6 * m[1] - (150 - p[1])) < 0.1, "VisualProof ends at the margin");
});

test("names are written over everything on their halos: every halo first, outermost first, then every name", () => {
  const pen = new SvgContext(measure, FAMILY);
  writeNames(ctxOf(pen), [
    { text: "a", x: 0, y: 0, font: `11px ${FAMILY}`, align: "left", fill: "#111" },
    { text: "Big", x: 50, y: 20, font: `600 14px ${FAMILY}`, align: "center", fill: "#222" },
  ], "#ffffff");
  const order = pen.body.map((x) => `${/stroke-width="([\d.]+)"/.exec(x)?.[1] ?? "fill"}:${/>([^<]*)</.exec(x)![1]}`);
  assert.deepEqual(order, ["7:a", "7:Big", "4.5:a", "4.5:Big", "2.6:a", "2.6:Big", "fill:a", "fill:Big"]);
  assert.deepEqual(HALO.map(([, a]) => a), [0.22, 0.4, 0.85], "fading outward");
});

test("a PNG made band by band is a PNG: its chunks and their CRCs, its pixels as given, row by row", async () => {
  const { encodePng } = await import("../src/web/src/artwork.ts");
  const { inflateSync } = await import("node:zlib");
  const { crc32 } = await import("../src/server/export.ts");
  const w = 3, h = 5;
  const px = (x: number, y: number) => [x * 40, y * 50, (x + y) * 10, 255 - y];
  async function* bands() {
    // bands of 2 rows, the last of 1
    for (let y = 0; y < h; y += 2) {
      const n = Math.min(2, h - y);
      const b = new Uint8Array(n * w * 4);
      for (let r = 0; r < n; r++) for (let x = 0; x < w; x++) b.set(px(x, y + r), (r * w + x) * 4);
      yield b;
    }
  }
  const png = Buffer.from(await (await encodePng(w, h, bands())).arrayBuffer());
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < png.length; ) {
    const len = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString("latin1");
    const data = png.subarray(at + 8, at + 8 + len);
    assert.equal(png.readUInt32BE(at + 8 + len), crc32(png.subarray(at + 4, at + 8 + len)), `${type}'s CRC`);
    chunks.push({ type, data });
    at += 12 + len;
  }
  assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
  const ihdr = chunks[0].data;
  assert.deepEqual([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ...ihdr.subarray(8)], [w, h, 8, 6, 0, 0, 0]);
  const raw = inflateSync(chunks[1].data);
  assert.equal(raw.length, h * (1 + 4 * w));
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (1 + 4 * w)], 0, "no filter");
    for (let x = 0; x < w; x++) assert.deepEqual([...raw.subarray(y * (1 + 4 * w) + 1 + 4 * x, y * (1 + 4 * w) + 5 + 4 * x)], px(x, y));
  }
  await assert.rejects(encodePng(w, h + 1, bands()), /rows/);
});


test("the styles and the title (the owner's decisions of 2026-10-15): read with care; the project's own title and line; a style's ground the same in every frame of a shape", () => {
  const now = { scheme: "kind" as const, theme: "light" as const };
  const fresh = cleanSettings(undefined, now);
  assert.deepEqual([fresh.style, fresh.title, fresh.subtitle, fresh.titleSize], ["board", null, null, 7], "as the board; the project's own title, 7 % high");
  const odd = cleanSettings({ style: "neon" as never, title: "A\u0007B" + "x".repeat(200), subtitle: 5 as never, titleSize: 99 }, now);
  assert.deepEqual([odd.style, odd.title!.slice(0, 3), odd.title!.length, odd.subtitle, odd.titleSize], ["board", "A B", 120, null, 16]);
  assert.deepEqual([cleanSettings({ style: "stars", title: "", titleSize: 2.26 }, now)].map((s) => [s.style, s.title, s.titleSize]), [["stars", "", 3]], "no title is a title too");
  assert.deepEqual(titleOf("LeanyCrypt", 1, 1), { title: "LeanyCrypt", subtitle: "1 declaration · 1 target" });
  assert.deepEqual(titleOf("SpherePacking", 7851, 4).subtitle, "7,851 declarations · 4 targets");
  // the ground: none for the board's style; the cells' a field, the starfield's a sky with its dust
  const board = new SvgContext(measure, FAMILY);
  drawBackdrop(ctxOf(board), "board", { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(board.body.length, 0);
  const sky = () => {
    const pen = new SvgContext(measure, FAMILY);
    drawBackdrop(ctxOf(pen), "stars", { x: 10, y: 20, w: 400, h: 300 });
    return pen;
  };
  const a = sky(), b = sky();
  assert.deepEqual(a.body, b.body, "the same dust in the same places");
  assert.match(a.body[0], /^<path d="M10,20L410,20L410,320L10,320Z" fill="url\(#g0\)"\/>$/);
  assert.match(a.defs[0], /^<radialGradient id="g0" gradientUnits="userSpaceOnUse" fx="210" fy="140" fr="0" cx="210" cy="140" r="320">/);
  assert.ok(a.body.length > 100, `${a.body.length - 1} stars of dust`);
});

test("the title at the top left, the same in every style: spaced capitals of Jost over a line in the style's own face, on halos; the styles differ in colour and weight", () => {
  const frame = { x: 0, y: 0, w: 1000, h: 600 };
  const texts = (style: "board" | "cells" | "stars") => {
    const pen = new SvgContext(measure, FAMILY);
    drawTitle(ctxOf(pen), frame, "Sphere Packing", "7,851 declarations · 4 targets", 7, style, { ink: "#111", quiet: "#666", halo: "#fff" });
    return pen.body.filter((x) => x.startsWith("<text") && !x.includes('fill="none"'));
  };
  const jost = `font-family="&quot;Jost&quot;, &quot;Source Sans 3&quot;, -apple-system, &quot;Segoe UI&quot;, sans-serif"`;
  for (const style of ["board", "cells", "stars"] as const) {
    const t = texts(style);
    // the title letter by letter (its spacing), in capitals, at 7 % of the height its em times 0.8
    assert.ok(t[0].includes(`font-size="33.6"`) && t[0].includes(jost) && />S<\/text>$/.test(t[0]), `${style}: ${t[0]}`);
    assert.ok(!t.some((x) => />h<\/text>$/.test(x)), `${style}: in capitals`);
    // the line under it whole, in the style's face
    const line = t.find((x) => x.includes(">7,851 declarations · 4 targets<"))!;
    assert.ok(line, `${style}: its line`);
    assert.equal(line.includes(`font-style="italic"`), style === "stars", `${style}: the starfield's line in italics`);
  }
  assert.match(texts("board")[0], /x="35" y="45.19" font-size="33.6" font-weight="500" .*fill="rgb\(17,17,17\)"/, "the theme's ink");
  assert.ok(texts("cells")[0].includes(`fill="url(#`), "the cells' in a pale light");
  assert.ok(texts("stars")[0].includes(`fill="rgb(241,230,200)"`) && !texts("stars")[0].includes("font-weight"), "the starfield's in a pale gold, lighter");
  // none: nothing
  const none = new SvgContext(measure, FAMILY);
  drawTitle(ctxOf(none), frame, "", "", 7, "board", { ink: "#111", quiet: "#666", halo: "#fff" });
  assert.equal(none.body.length, 0);  // too wide for the frame: smaller until it fits within the margins, the line under it as much
  // smaller; a line longer than the frame alone smaller too
  const sized = (text: string, font: string) => text.length * 0.6 * Number(/([\d.]+)px/.exec(font)![1]);
  const narrow = { x: 0, y: 0, w: 400, h: 700 };
  const fitted = (title: string, line: string) => {
    const pen = new SvgContext(sized, FAMILY);
    drawTitle(ctxOf(pen), narrow, title, line, 10, "board", { ink: "#111", quiet: "#666", halo: "#fff" });
    const t = pen.body.filter((x) => x.startsWith("<text") && !x.includes('fill="none"'));
    const px = (x: string) => Number(/font-size="([\d.]+)"/.exec(x)![1]);
    return { title: px(t[0]), line: px(t.find((x) => x.includes(`>${line}<`))!), last: t.filter((x) => px(x) === px(t[0])).at(-1)! };
  };
  const room = 400 - 2 * 14;
  const f = fitted("Sphere Packing", "7,851 declarations");
  assert.ok(f.title < 56, `smaller than 10 % of the height's 56: ${f.title}`);
  // the last capital's right edge at the margin: 14 capitals, 13 spaces between them
  const end = Number(/x="([\d.]+)"/.exec(f.last)![1]) + 0.6 * f.title;
  assert.ok(Math.abs(end - (14 + room)) < 0.5, `the last letter ends at the margin: ${end}`);
  assert.ok(Math.abs(f.line / f.title - 0.36 / 0.8) < 2e-3, `the line under it as much smaller: ${f.line} under ${f.title}`);
  const short = fitted("SP", "a line under the title far too long to stand across the frame");
  assert.equal(short.title, 56, "a short title as it was");
  assert.ok(Math.abs(short.line * 0.6 * 61 - room) < 0.5, `the long line alone smaller: ${short.line}`);
});

test("names along an arc, letter by letter, each turned to its circle; the recorder turns and moves as the canvas does", () => {
  const pen = new SvgContext(measure, FAMILY);
  writeNames(ctxOf(pen), [{ text: "AB", x: 0, y: 0, font: `600 10px ${FAMILY}`, align: "center", fill: "#222", spacing: 2, arc: { cx: 100, cy: 100, r: 50 } }], "#fff");
  const fills = pen.body.filter((x) => !x.includes('fill="none"'));
  assert.equal(fills.length, 2, "a text for each letter");
  // the two letters either side of the top, turned by as much as they lie off it
  const at = fills.map((x) => /x="([\d.-]+)" y="([\d.-]+)" font-size="10" transform="rotate\(([\d.-]+) /.exec(x)!.slice(1).map(Number));
  assert.ok(at[0][0] < 100 && at[1][0] > 100 && at[0][1] < 52 && at[1][1] < 52, JSON.stringify(at));
  assert.ok(at[0][2] < 0 && at[1][2] > 0 && Math.abs(at[0][2] + at[1][2]) < 1e-6, "turned alike, either way");
  assert.ok(arcHalf(ctxOf(new SvgContext(measure, FAMILY)), { text: "AB", x: 0, y: 0, font: "10px x", align: "center", fill: "#222", spacing: 2, arc: { cx: 0, cy: 0, r: 50 } }) > 0.13);
  // straight, spaced
  const sp = new SvgContext(measure, FAMILY);
  writeNames(ctxOf(sp), [{ text: "AB", x: 100, y: 10, font: `10px ${FAMILY}`, align: "center", fill: "#222", spacing: 4 }], "#fff");
  assert.deepEqual(sp.body.filter((x) => !x.includes('fill="none"')).map((x) => /x="([\d.]+)"/.exec(x)![1]), ["92", "102"], "centred, its letters 4 apart");
});

test("a style's circles in the SVG as the renderer draws them: a glow, a fill from a light, a halo round a rim; gradients of one look and colour written once", () => {
  const pen = new SvgContext(measure, FAMILY);
  pen.shape({ kind: "circle", x: 0, y: 0, r: 4, fill: [1, 0, 0, 0.2], stroke: null, ring: 0, ringR: 4, dashed: false, look: "glow" });
  pen.shape({ kind: "circle", x: 9, y: 9, r: 6, fill: [1, 0, 0, 0.2], stroke: null, ring: 0, ringR: 6, dashed: false, look: "glow" });
  pen.shape({ kind: "circle", x: 50, y: 50, r: 40, fill: [0, 0, 1, 0.2], stroke: [0, 0, 1, 0.6], ring: 1.3, ringR: 40, dashed: false, look: "radial" });
  pen.shape({ kind: "circle", x: 50, y: 50, r: 40, fill: [0, 0, 0, 0], stroke: [0, 0, 1, 0.3], ring: 26, ringR: 40, dashed: false, halo: true });
  assert.equal(pen.defs.filter((d) => d.includes('id="l')).length, 2, "one glow, one fill");
  assert.equal(pen.body[0], `<circle cx="0" cy="0" r="4" fill="url(#l0)"/>`);
  assert.equal(pen.body[1], `<circle cx="9" cy="9" r="6" fill="url(#l0)"/>`);
  assert.match(pen.defs[0], /<stop offset="0" stop-color="rgb\(255,0,0\)" stop-opacity="0.2"\/>.*<stop offset="1" stop-color="rgb\(255,0,0\)" stop-opacity="0"\/>/);
  assert.match(pen.defs[1], /cx="0.375" cy="0.35" r="0.65"/);
  assert.equal(pen.body[3], `<circle cx="50" cy="50" r="40" fill="none" stroke="rgb(0,0,255)" stroke-opacity="0.6" stroke-width="1.3"/>`, "the rim over its fill");
  // the halo: a ring of light 26 wide round the rim, fading both ways
  assert.equal(pen.body[4], `<circle cx="50" cy="50" r="53" fill="url(#h2)"/>`);
  assert.match(pen.defs[2], /<stop offset="0.5094" stop-color="rgb\(0,0,255\)" stop-opacity="0"\/>.*<stop offset="0.7547" stop-color="rgb\(0,0,255\)" stop-opacity="0.3"\/>/);
});

test("a thin border round the picture (the owner's decision of 2026-10-15): off at first; a little within the edge, as wide as a part of the shorter side", () => {
  const now = { scheme: "kind" as const, theme: "light" as const };
  assert.equal(cleanSettings(undefined, now).border, false);
  assert.equal(cleanSettings({ border: true }, now).border, true);
  assert.equal(cleanSettings({ border: "yes" as never }, now).border, false);
  const pen = new SvgContext(measure, FAMILY);
  drawBorder(ctxOf(pen), { x: 10, y: 20, w: 1000, h: 500 }, "#666");
  assert.deepEqual(pen.body, [`<path d="M13,23L1007,23L1007,517L13,517Z" fill="none" stroke="rgb(102,102,102)" stroke-width="0.6"/>`]);
  const big = new SvgContext(measure, FAMILY);
  drawBorder(ctxOf(big), { x: 0, y: 0, w: 4000, h: 2000 }, "#666");
  assert.match(big.body[0], /^<path d="M12,12L3988,12L3988,1988L12,1988Z" .*stroke-width="2.4"\/>$/);
  // outside it, the ground alone: the band between the edge and the border, and the SVG's drawing
  // clipped within it
  assert.equal(borderInset({ w: 1000, h: 500 }), 3);
  assert.equal(borderInset({ w: 4000, h: 2000 }), 12);
  const band = new SvgContext(measure, FAMILY);
  borderBand(ctxOf(band), { x: 10, y: 20, w: 1000, h: 500 });
  band.fill();
  assert.deepEqual(band.body, [`<path d="M10,20L1010,20L1010,520L10,520ZM13,23L1007,23L1007,517L13,517Z" fill="rgb(0,0,0)"/>`]);
  band.clipRect("inside", 13, 23, 994, 494);
  assert.equal(band.defs.at(-1), `<clipPath id="inside"><rect x="13" y="23" width="994" height="494"/></clipPath>`);
});
