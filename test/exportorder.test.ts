// The board is the outline of the exported document (the owner's decisions of 2026-10-12): the notes
// the view shows print as the document's prose — a note attached to a declaration right after it, a
// note in a cluster in its section, a note on the ring or on the canvas at the start — with the
// images and clips they carry as figures and the whole PDFs as references; and everything comes in
// the order of the view's board, the lowest first, ties left to right, whatever depends on what
// (shared/doc/order.ts). The server reads the board as the page draws it (server/boardspots.ts):
// its layout memory, its pins, its hidden levels; agents' exports and those of past builds alike.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync, gzipSync } from "node:zlib";
import { buildDoc, printedNotes } from "../src/shared/doc/build.ts";
import type { DocFiles, DocInput } from "../src/shared/doc/build.ts";
import { figureAssets, renderLatex } from "../src/shared/doc/latex.ts";
import type { DeclEntry, DocModel, Item, NoteEntry, Section } from "../src/shared/doc/model.ts";
import { freshSpots, orderDoc } from "../src/shared/doc/order.ts";
import type { BoardNote, BoardSpots } from "../src/shared/doc/order.ts";
import { planDoc } from "../src/shared/doc/sections.ts";
import { DEFAULT_SETTINGS } from "../src/shared/doc/settings.ts";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { applyLibrary } from "../src/shared/library.ts";
import type { LibraryEvent } from "../src/shared/library.ts";
import { emptyLayouts } from "../src/shared/places.ts";
import { declSpot } from "../src/shared/notecard.ts";
import type { ProjectNote } from "../src/shared/projectnotes.ts";
import { parseQuery } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import type { ReviewData } from "../src/shared/review.ts";
import type { StickyNote } from "../src/shared/sticky.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { boardLayout, boardSet, layoutKey, pastSetKey } from "../src/shared/board.ts";
import { memoryOf } from "../src/shared/layout.ts";
import type { ViewData } from "../src/shared/views.ts";
import { AgentApi } from "../src/server/agent.ts";
import type { Caller, World } from "../src/server/agent.ts";
import { boardSpots } from "../src/server/boardspots.ts";
import { crc32, Exporter } from "../src/server/export.ts";
import { docFiles, figureFiles, figureNotes, imageTool } from "../src/server/figures.ts";
import { Library } from "../src/server/library.ts";
import { ReviewStore } from "../src/server/review.ts";
import { Views } from "../src/server/views.ts";
import { tinyPdf } from "./pdf.ts";

// ------------------------------------------------------------------- a board of our own

/** A.a1 and A.a2 (a2 uses a1), A.B.b1 and A.B.b2, C.c1, `top` in no namespace, and Nat outside. */
function graph(): Graph {
  const names = ["A.a1", "A.a2", "A.B.b1", "A.B.b2", "C.c1", "top"];
  const nodes: ViewNode[] = names.map((name) => ({ name, kind: "def", module: `M.${name.split(".")[0]}`, ax: 0, type: "Nat" }));
  nodes.push({ name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0, ext: true });
  const edges = new Int32Array([1, 0, SITE_STMT, 2, 0, SITE_STMT, 0, 6, SITE_STMT]);
  const meta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: "/nowhere", roots: ["A"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [],
    nodes,
    projectCount: names.length,
    axioms: [],
    axiomSets: [[]],
    layouts: {},
    edgeCount: 3,
  } as unknown as ViewMeta;
  return new Graph(meta, edges);
}

const PDF = "a".repeat(64), PNG = "b".repeat(64), GIF = "c".repeat(64), GONE = "d".repeat(64);

/** The library: a paper, a photo, a GIF, and a paper this server does not have. */
function review(): ReviewData {
  const d = emptyReview();
  const ev = (e: object, k: number) => applyLibrary(d, { at: `2026-10-12T10:00:0${k}.000Z`, by: "Alice", ...e } as LibraryEvent);
  ev({ op: "file", sha: PDF, title: "Tight Adaptive Reprogramming", type: "pdf", size: 9, pages: 3, name: "ghhm21.pdf" }, 0);
  ev({ op: "file", sha: PNG, title: "Whiteboard, Oct 9", type: "png", size: 9, name: "board.png" }, 1);
  ev({ op: "file", sha: GIF, title: "An animation", type: "gif", size: 9 }, 2);
  ev({ op: "file", sha: GONE, title: "Lost paper", type: "pdf", size: 9, pages: 2 }, 3);
  return d;
}

let seq = 0;
const at = () => `2026-10-12T09:${String(seq++).padStart(2, "0")}:00.000Z`;
/** A note of the project, as the board carries it. */
const pnote = (id: string, text: string, over: Partial<ProjectNote> = {}): ProjectNote => ({ id, text, places: {}, open: true, by: "Alice", at: at(), ...over });
/** A note of the view's own. */
const vnote = (id: string, text: string, over: Partial<StickyNote> = {}): StickyNote => ({ id, text, place: { mode: "namespace", in: [], world: [0, 0] }, open: true, by: "Bob", at: at(), ...over });

/** A board as hand-made positions: each declaration's point, each circle's centre, the notes. */
function spots(decls: Record<string, [number, number]>, clusters: Record<string, [number, number]>, notes: BoardNote[] = []): BoardSpots {
  return { decls: new Map(Object.entries(decls)), clusters: new Map(Object.entries(clusters)), notes };
}

/** The board the tests start from: A low, C high; in A, a1 lowest, then the circle A.B, then a2. */
const BASE = {
  decls: { "A.a1": [0, 90], "A.a2": [0, 40], "A.B.b1": [-5, 70], "A.B.b2": [5, 60], "C.c1": [0, -100], top: [200, 0], Nat: [400, 0] } as Record<string, [number, number]>,
  clusters: { A: [0, 50], "A.B": [0, 65], C: [0, -100] } as Record<string, [number, number]>,
};

const input = (board: BoardSpots | undefined, over: Partial<DocInput> = {}): DocInput => ({
  g: graph(),
  review: review(),
  view: { id: "v", name: "Outline", scope: parseQuery("all"), clustering: "namespace", hidden: [], authors: [] },
  settings: DEFAULT_SETTINGS,
  source: () => null,
  fileOf: () => null,
  build: { fingerprint: "f", commit: null },
  ...(board ? { board } : {}),
  ...over,
});

const sectionsIn = (xs: readonly Item[]): Section[] => xs.flatMap((x) => (x.t === "section" ? [x.section] : []));
/** What a section or the document holds, in order: a declaration by its name, a note by its id, a
 *  section by its key. */
const seqOf = (xs: readonly Item[]): string[] => xs.map((x) => (x.t === "decl" ? x.decl.name : x.t === "note" ? x.note.id.replace(/^note:/, "") : `§${x.section.key}`));
const section = (doc: DocModel, key: string): Section => {
  const find = (xs: readonly Item[]): Section | undefined => {
    for (const s of sectionsIn(xs)) if (s.key === key) return s;
    for (const s of sectionsIn(xs)) {
      const t = find(s.items);
      if (t) return t;
    }
    return undefined;
  };
  return find(doc.items)!;
};
const declOf = (doc: DocModel, name: string): DeclEntry => {
  const walk = (xs: readonly Item[]): DeclEntry | undefined => {
    for (const x of xs) {
      if (x.t === "decl" && x.decl.name === name) return x.decl;
      if (x.t === "section") {
        const d = walk(x.section.items);
        if (d) return d;
      }
    }
    return undefined;
  };
  return walk(doc.items)!;
};
const noteText = (e: NoteEntry): string => (e.text ?? []).map((b) => (b.t === "p" ? b.inl.map((x) => (x.t === "br" ? "\n" : x.s)).join("") : "")).join("\n\n");

// ------------------------------------------------------------------- where notes print

test("notes print where the board has them: on a declaration after it, in a cluster in its section, outside every cluster at the start; with and without `decl`", () => {
  const onA1 = pnote("onA1", "Why a1 is defined so.", { decl: { name: "A.a1", at: [12, -12] } });
  const onA1b = pnote("onA1b", "A second word on a1.", { decl: { name: "A.a1", at: [12, 14] } });
  const inB = pnote("inB", "The B part.");
  const ring = pnote("ring", "Read this first.");
  const canvas = vnote("canvas", "Our plan for this view.");
  const inC = vnote("inC", "C, briefly.");
  // attached to a declaration the document does not print (outside the project): where its icon is
  const onNat = pnote("onNat", "About Nat.", { decl: { name: "Nat", at: [0, 0] } });
  // a note whose `decl` names a declaration the board does not hold reads by its place
  const away = pnote("away", "About something elsewhere.", { decl: { name: "Z.zz", at: [0, 0] } });
  const board = spots(BASE.decls, BASE.clusters, [
    { note: onA1, kind: "project", at: [12, 78], in: ["A"], on: "A.a1" },
    { note: onA1b, kind: "project", at: [12, 104], in: ["A"], on: "A.a1" },
    { note: inB, kind: "project", at: [0, 75], in: ["A.B", "A"] },
    { note: ring, kind: "project", at: [0, 300], in: [] },
    { note: canvas, kind: "view", at: [0, -300], in: [] },
    { note: inC, kind: "view", at: [3, -90], in: ["C"] },
    { note: onNat, kind: "project", at: [400, 10], in: ["⟨external⟩"], on: "Nat" },
    { note: away, kind: "project", at: [0, 45], in: ["A"] },
  ]);
  const doc = buildDoc(input(board));
  // the start: the notes outside every cluster and `top`, in no namespace, lowest first; then A
  // (low) before C (high)
  assert.deepEqual(seqOf(doc.items), ["ring", "onNat", "top", "canvas", "§A", "§C"]);
  // in A: a1 (lowest), the circle A.B, the note placed in A, a2; in A.B its note among b1 and b2
  assert.deepEqual(seqOf(section(doc, "A").items), ["A.a1", "§A.B", "away", "A.a2"]);
  assert.deepEqual(seqOf(section(doc, "A.B").items), ["inB", "A.B.b1", "A.B.b2"]);
  assert.deepEqual(seqOf(section(doc, "C").items), ["inC", "C.c1"]);
  // a1's own notes after it, lowest first
  assert.deepEqual(declOf(doc, "A.a1").notes?.map((n) => n.id), ["note:onA1b", "note:onA1"]);
  assert.equal(declOf(doc, "A.a2").notes, undefined);
  // the kinds are said; their authors are not printed (the author line counts them)
  assert.deepEqual(printedNotes(doc).map((n) => [n.id, n.kind]), [
    ["note:ring", "project"], ["note:onNat", "project"], ["note:canvas", "view"], ["note:onA1b", "project"], ["note:onA1", "project"], ["note:inB", "project"], ["note:away", "project"], ["note:inC", "view"],
  ]);
  assert.equal(doc.count.notes, 8);
  const tex = renderLatex(doc);
  assert.ok(!tex.includes("Alice") && !tex.includes("Bob"), "no note's author is printed");
  // a declaration's notes inside it, after its code; the start's notes before the first section
  assert.match(tex, /\\end\{vpCode\}\n\\begin\{vpNote\}\{vp:note\.3a\.onA1b\}\nA second word on a1\.\n\\end\{vpNote\}\n\\begin\{vpNote\}\{vp:note\.3a\.onA1\}/);
  assert.ok(tex.indexOf("Read this first.") < tex.indexOf("\\vpSection{"));
});

test("a section's own declarations and notes after one of its sections are headed by its title again, \"continued\"", () => {
  // in A: a1 lowest, then A.B, then a2: a2 comes after A.B and is A's
  const doc = buildDoc(input(spots(BASE.decls, BASE.clusters)));
  const tex = renderLatex(doc);
  const b = tex.indexOf("\\vpSection{vp:section.3a.A.2e.B}");
  const resume = tex.indexOf("\\vpSectionResume{2}{A}");
  assert.ok(b > 0 && resume > b && tex.indexOf("\\begin{vpDecl}{vp:A.2e.a2}") > resume, "a2 under A's title again, after A.B");
  assert.ok(tex.indexOf("\\begin{vpDecl}{vp:A.2e.a1}") < b, "a1 before A.B needs no heading again");
  // once per return, never at the top
  assert.equal(tex.split("\\vpSectionResume").length - 1, 1);
});

// ------------------------------------------------------------------- the order

test("the board's order: the lowest first within a section and at the top level, ties left to right; moving things reorders the document", () => {
  const doc = buildDoc(input(spots(BASE.decls, BASE.clusters)));
  assert.deepEqual(seqOf(doc.items), ["top", "§A", "§C"]);
  assert.deepEqual(seqOf(section(doc, "A").items), ["A.a1", "§A.B", "A.a2"]);
  // level: left to right
  const level = buildDoc(input(spots({ ...BASE.decls, "A.B.b1": [8, 60], "A.B.b2": [-8, 60] }, BASE.clusters)));
  assert.deepEqual(seqOf(section(level, "A.B").items), ["A.B.b2", "A.B.b1"]);
  // within a tenth of a unit is level, as the layout rounds its places
  const near = buildDoc(input(spots({ ...BASE.decls, "A.B.b1": [8, 60.04], "A.B.b2": [-8, 60] }, BASE.clusters)));
  assert.deepEqual(seqOf(section(near, "A.B").items), ["A.B.b2", "A.B.b1"]);
  // a reader drags a2 below a1, and C below A: the document follows
  const moved = buildDoc(input(spots({ ...BASE.decls, "A.a2": [0, 120] }, { ...BASE.clusters, C: [0, 400] })));
  assert.deepEqual(seqOf(moved.items), ["top", "§C", "§A"]);
  assert.deepEqual(seqOf(section(moved, "A").items), ["A.a2", "A.a1", "§A.B"]);
  // the sections are numbered in that order
  assert.match(renderLatex(moved), /\\vpSection\{vp:section\.3a\.C\}\{1\}\{1\}\{C\}/);
});

test("no dependency order: a2 uses a1, yet a2 printed first where the board has it lower; a fresh board reads foundations first", () => {
  const doc = buildDoc(input(spots({ ...BASE.decls, "A.a2": [0, 95] }, BASE.clusters)));
  assert.deepEqual(seqOf(section(doc, "A").items), ["A.a2", "A.a1", "§A.B"]);
  // without a board the builder lays one out afresh (shared/doc/order.ts, freshSpots), where what is
  // used sits lower (CanvasSpec, "Dependency order"): a chain c0 ← c1 ← … ← c5 reads from its
  // foundation, row by row, each row left to right — c2 before c1 though c2 uses c1
  const N = 6;
  const chainNodes: ViewNode[] = Array.from({ length: N }, (_, k) => ({ name: `Ch.c${k}`, kind: "def", module: "M.Ch", ax: 0, type: "Nat" }));
  const ce: number[] = [];
  for (let k = 1; k < N; k++) ce.push(k, k - 1, SITE_STMT);
  const chain = new Graph({ ...graph().meta, nodes: chainNodes, projectCount: N, edgeCount: N - 1 } as ViewMeta, Int32Array.from(ce));
  const fresh = freshSpots(chain, new Uint8Array(N).fill(1), "namespace", []);
  const read = seqOf(section(buildDoc(input(undefined, { g: chain })), "Ch").items);
  assert.equal(read[0], "Ch.c0");
  assert.deepEqual([...read.slice(N - 3)].sort(), ["Ch.c3", "Ch.c4", "Ch.c5"]);
  const [y1, y2] = [fresh.decls.get("Ch.c1")!, fresh.decls.get("Ch.c2")!];
  if (Math.round(y1[1] * 10) === Math.round(y2[1] * 10)) assert.ok(read.indexOf(y1[0] < y2[0] ? "Ch.c1" : "Ch.c2") < read.indexOf(y1[0] < y2[0] ? "Ch.c2" : "Ch.c1"), "level: left to right");
  const g = graph();
  // the order follows the positions alone: the plan carries none
  const plan = planDoc(g, new Uint8Array(g.n).fill(1), "namespace", []);
  const o = orderDoc(plan, g, spots({ ...BASE.decls, "A.a1": [0, -500] }, BASE.clusters));
  const a = o.items.find((p) => p.t === "section" && p.s.plan.key === "A");
  assert.ok(a && a.t === "section");
  assert.deepEqual(a.s.items.map((p) => (p.t === "decl" ? g.nodes[p.i].name : p.t === "section" ? p.s.plan.key : "note")), ["A.B", "A.a2", "A.a1"]);
});

// ------------------------------------------------------------------- what a note prints

test("a note's text: its Markdown carried over, its line breaks kept, a full name in backticks linked where the document prints it, plain code where it does not", () => {
  const n = pnote("md", "Uses `A.a1` and `Nope.x`, **bold** and *italic*.\nA second line.\n\nA paragraph of its own, with `top`.");
  const doc = buildDoc(input(spots(BASE.decls, BASE.clusters, [{ note: n, kind: "project", at: [0, 500], in: [] }])));
  const e = printedNotes(doc)[0];
  const [p1, p2] = e.text!;
  assert.ok(p1.t === "p" && p2.t === "p");
  assert.deepEqual(p1.inl, [
    { t: "text", s: "Uses " },
    { t: "decl", s: "A.a1", id: "A.a1" },
    { t: "text", s: " and " },
    { t: "code", s: "Nope.x" },
    { t: "text", s: ", " },
    { t: "strong", s: "bold" },
    { t: "text", s: " and " },
    { t: "em", s: "italic" },
    { t: "text", s: "." },
    { t: "br", s: "" },
    { t: "text", s: "A second line." },
  ]);
  assert.deepEqual(p2.inl[1], { t: "decl", s: "top", id: "top" });
  const tex = renderLatex(doc);
  assert.match(tex, /Uses \\vpMention\{vp:A\.2e\.a1\}\{A\.\\vpBreak\{\}a1\} and \\vpInlineCode\{Nope\.x\}, \\textbf\{bold\} and \\emph\{italic\}\.\\newline A second line\.\n\nA paragraph of its own, with \\vpMention\{vp:top\}\{top\}\./);
  // a name written to act as LaTeX is text
  const evil = pnote("evil", "\\input{/etc/passwd} `A.a1}\\x{`");
  const t2 = renderLatex(buildDoc(input(spots(BASE.decls, BASE.clusters, [{ note: evil, kind: "project", at: [0, 500], in: [] }]))));
  assert.match(t2, /\\textbackslash\{\}input\\\{\/etc\/passwd\\\} \\vpInlineCode\{A\.a1\\\}\\textbackslash\{\}x\\\{\}/);
});

test("figures from the images and clips a note carries; whole PDFs, and what cannot be drawn, as references; a note that says only its file's title prints as that file", () => {
  const photo = pnote("photo", "The whiteboard after the meeting.", { carries: [{ file: PNG }, { file: PDF, page: 2, region: [0.1, 0.2, 0.6, 0.3] }, { file: PDF }, { file: GIF }, { file: GONE, page: 1, region: [0, 0, 1, 0.5] }] });
  // made for a file, its text the file's title, or the name it was added under: no prose
  const titled = pnote("titled", "Tight Adaptive Reprogramming", { carries: [{ file: PDF }] });
  const named = pnote("named", "board.png", { carries: [{ file: PNG }] });
  const said = pnote("said", "Section 3 is what we follow.", { carries: [{ file: PDF }] });
  const files: DocFiles = { has: (sha) => sha !== GONE, drawable: (_, type) => type === "png" || type === "jpeg", pageSize: (sha, page) => (sha === PDF && page === 2 ? { w: 612, h: 792 } : null) };
  const board = spots(BASE.decls, BASE.clusters, [
    { note: photo, kind: "project", at: [0, 500], in: [] },
    { note: titled, kind: "project", at: [0, 400], in: [] },
    { note: named, kind: "view", at: [0, 300], in: [] },
    { note: said, kind: "project", at: [0, 200], in: [] },
  ]);
  const doc = buildDoc(input(board, { files }));
  const [p, t, n, s] = printedNotes(doc);
  // numbered as first cited, in the order the document prints
  assert.deepEqual(doc.references?.map((r) => [r.n, r.title]), [[1, "Whiteboard, Oct 9"], [2, "Tight Adaptive Reprogramming"], [3, "An animation"], [4, "Lost paper"]]);
  assert.deepEqual(p.figures, [
    { ref: 1, file: PNG },
    // the clip's size as the paper prints it: half the width of a letter page, a tenth of its height
    { ref: 2, file: PDF, page: 2, region: [0.1, 0.2, 0.6, 0.3], size: [306, 79.2] },
  ]);
  // the whole PDF, the GIF no tool here draws, the clip of a file this server lacks
  assert.deepEqual(p.papers, [{ label: "", ref: 2 }, { label: "", ref: 3 }, { label: "", page: 1, ref: 4 }]);
  assert.equal(noteText(p), "The whiteboard after the meeting.");
  assert.deepEqual([t.text, t.papers], [null, [{ label: "", ref: 2 }]]);
  assert.deepEqual([n.text, n.figures], [null, [{ ref: 1, file: PNG }]]);
  assert.deepEqual([noteText(s), s.papers], ["Section 3 is what we follow.", [{ label: "", ref: 2 }]]);
  // as LaTeX: the figure files beside the document, a clip at its printed width
  const tex = renderLatex(doc);
  assert.match(tex, new RegExp(`\\\\vpFigure\\{figures/fig-${PNG}\\.png\\}\\{\\}\\{Whiteboard, Oct 9\\}\\{\\}\\{1\\}`));
  assert.match(tex, new RegExp(`\\\\vpFigure\\{figures/clip-${PDF}-p2-1000-2000-6000-3000-w1275\\.png\\}\\{306pt\\}\\{Tight Adaptive Reprogramming\\}\\{2\\}\\{2\\}`));
  assert.match(tex, /\\begin\{vpNote\}\{vp:note\.3a\.titled\}\n\\vpPaper\{\}\{Tight Adaptive Reprogramming\}\{\}\{2\}\n\\end\{vpNote\}/);
  assert.match(tex, /\\vpPaper\{\}\{Lost paper\}\{1\}\{4\}/);
  // the clip asked at print resolution: 4.25 in at 300 dpi
  assert.deepEqual(figureAssets(doc).map((a) => [a.name.slice(0, 5), a.px ?? null, a.type]), [["fig-b", null, "png"], ["clip-", 1275, "pdf"]]);
  // the export's notes say what could not be a figure, and why
  const said2 = figureNotes(board.notes, review(), files);
  assert.equal(said2.length, 2);
  assert.match(said2[0], /does not have the file of Lost paper/);
  assert.match(said2[1], /An animation cannot be drawn into the document here/);
});

/** A PNG `w` × `h` of one colour, made here. */
function png(w: number, h: number, rgb: [number, number, number] = [40, 90, 200]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type, "latin1");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

test("the figures are drawn from the library: an image's bytes, a clip by the server's clip renderer at print resolution, a GIF turned into a PNG where ImageMagick is here", { skip: !new Exporter(tmpdir()).available() && "xelatex is not installed" }, async () => {
  const state = mkdtempSync(join(tmpdir(), "vp-figures-"));
  try {
    const lib = new Library(state, state);
    const paper = lib.put(tinyPdf([["Page one."], ["Theorem 8. Every key is lost.", "Proof. Trivially."]], "Tight Adaptive Reprogramming"));
    const photo = lib.put(png(120, 60));
    assert.ok("sha" in paper && "sha" in photo);
    const d = emptyReview();
    const ev = (e: object, k: number) => applyLibrary(d, { at: `2026-10-12T10:00:0${k}.000Z`, by: "Alice", ...e } as LibraryEvent);
    ev({ op: "file", sha: paper.sha, title: "Tight Adaptive Reprogramming", type: "pdf", size: 9, pages: 2 }, 0);
    ev({ op: "file", sha: photo.sha, title: "Whiteboard, Oct 9", type: "png", size: 9 }, 1);
    const n = pnote("fig", "What `A.a1` stands for.", { carries: [{ file: photo.sha }, { file: paper.sha, page: 2, region: [0.08, 0.06, 0.7, 0.12] }] });
    const files: DocFiles = { has: (sha) => lib.has(sha), drawable: (_, t) => t === "png" || t === "jpeg", pageSize: () => ({ w: 612, h: 792 }) };
    const doc = buildDoc(input(spots(BASE.decls, BASE.clusters, [{ note: n, kind: "project", at: [12, 80], in: ["A"], on: "A.a1" }]), { review: d, files }));
    const figs = figureFiles(doc, lib);
    assert.equal(figs.length, 2);
    const clip = await figs[1].make();
    assert.equal(clip.subarray(1, 4).toString(), "PNG", "the clip renderer's PNG");
    // the clip renderer's own cache holds it: the reference window's clip is the same file
    assert.ok(readFileSync(join(state, "files-cache", paper.sha, `clip-2-0.08_0.06_0.7_0.12-w1600.png`)).equals(clip));
    const ex = new Exporter(state);
    const job = ex.compile(renderLatex(doc), [], figs);
    const done = await ex.wait(job.id);
    assert.equal(done?.state, "done", done?.log);
    assert.equal(done?.notes, undefined, "every figure was drawn");
    const text = execFileSync("pdftotext", ["-", "-"], { input: ex.file(job.id, "pdf")!.body }).toString("utf8");
    assert.match(text, /Figure 1: Whiteboard, Oct 9/);
    assert.match(text, /Figure 2: Tight Adaptive Reprogramming, p\. 2/);
    assert.match(text, /What A\.a1 \(p\. 1\) stands for\./);
    // the sources' zip carries the figures, so that it typesets anywhere
    const zipped = ex.file(job.id, "zip")!.body.toString("latin1");
    assert.ok(zipped.includes(`figures/fig-${photo.sha}.png`) && zipped.includes("figures/clip-"));
    // a figure that cannot be made is left blank, and the job says which
    const broken = ex.compile(renderLatex(doc).replace("\\end{document}", "% another\n\\end{document}"), [], [{ name: figs[0].name, make: () => Promise.reject(new Error("gone")) }, figs[1]]);
    const after = await ex.wait(broken.id);
    assert.equal(after?.state, "done", after?.log);
    assert.match(after?.notes?.join(" ") ?? "", /A figure could not be drawn and is left blank: fig-.*\(gone\)/);
    // a GIF, turned into a PNG by ImageMagick where the server has it
    if (imageTool()) {
      const gifPath = join(state, "x.gif");
      execFileSync(imageTool()!, ["-size", "8x8", "xc:red", `gif:${gifPath}`]);
      const gif = lib.put(readFileSync(gifPath));
      assert.ok("sha" in gif);
      const dg = emptyReview();
      applyLibrary(dg, { at: "2026-10-12T10:00:00.000Z", by: "Alice", op: "file", sha: gif.sha, title: "Red", type: "gif", size: 9 } as LibraryEvent);
      const gdoc = buildDoc(input(spots(BASE.decls, BASE.clusters, [{ note: pnote("g", "Red.", { carries: [{ file: gif.sha }] }), kind: "project", at: [0, 500], in: [] }]), { review: dg, files: { ...files, drawable: () => true } }));
      const made = await figureFiles(gdoc, lib)[0].make();
      assert.equal(made.subarray(1, 4).toString(), "PNG");
      // a PNG of 16 bits a channel, which XeLaTeX's driver draws blank where it has transparency:
      // turned into one of 8 at most
      const deepPath = join(state, "deep.png");
      execFileSync(imageTool()!, ["-size", "16x8", "gradient:steelblue-white", "-alpha", "on", "-depth", "16", `png64:${deepPath}`]);
      const deep = lib.put(readFileSync(deepPath));
      assert.ok("sha" in deep);
      assert.equal(readFileSync(deepPath)[24], 16);
      const dd = emptyReview();
      applyLibrary(dd, { at: "2026-10-12T10:00:00.000Z", by: "Alice", op: "file", sha: deep.sha, title: "Deep", type: "png", size: 9 } as LibraryEvent);
      const real = await docFiles(lib, []);
      assert.equal(real.drawable(deep.sha, "png"), true);
      const ddoc = buildDoc(input(spots(BASE.decls, BASE.clusters, [{ note: pnote("dp", "Deep.", { carries: [{ file: deep.sha }] }), kind: "project", at: [0, 500], in: [] }]), { review: dd, files: real }));
      const eight = await figureFiles(ddoc, lib)[0].make();
      assert.ok(eight[24] <= 8, `${eight[24]} bits a channel`);
    }
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------- the board as the server reads it

/** A view record of `scope`, by namespace. */
function viewOf(id: string, over: Partial<ViewData> = {}): ViewData {
  return { id, name: "Mine", scope: parseQuery("all"), clustering: "namespace", pins: emptyLayouts(), folds: { namespace: [], module: [] }, hidden: { namespace: [], module: [] }, by: "Alice", at: "2026-10-12T08:00:00.000Z", kept: true, ...over };
}

test("the server reads the board as the page draws it: its layout, its pins applied as the page applies them, its notes where their icons are", () => {
  const g = graph();
  const d = review();
  const fresh = boardSpots({ g, review: d, rec: viewOf("v"), memory: null, notes: [] });
  assert.equal(fresh.fresh, true, "no page had laid it out: the server did, as a page will");
  assert.deepEqual([...fresh.decls.keys()].sort(), ["A.B.b1", "A.B.b2", "A.a1", "A.a2", "C.c1", "Nat", "top"]);
  // a2 dropped low in A, below a1: pinned in A's coordinates, which the page keeps it at
  const a1 = fresh.decls.get("A.a1")!, A = fresh.clusters.get("A")!;
  const pinned = viewOf("v", { pins: { namespace: { nodes: { "A.a2": [0, a1[1] - A[1] + 12] }, clusters: {} }, module: { nodes: {}, clusters: {} } } });
  const moved = boardSpots({ g, review: d, rec: pinned, memory: null, notes: [] });
  assert.ok(moved.decls.get("A.a2")![1] > moved.decls.get("A.a1")![1], "a2 is lower now");
  const doc = buildDoc(input(moved, { g, review: d }));
  const names = seqOf(section(doc, "A").items).filter((x) => !x.startsWith("§"));
  assert.deepEqual(names, ["A.a2", "A.a1"]);
  // notes: one of the project in A.B by its place, one attached to a1 (with `decl`), one on the ring
  // where it was let go (at the bottom), a view's own on the canvas, one the view does not show
  const inB = pnote("inB", "In B.", { places: { namespace: { in: [["A.B", 0, 0.5], ["A", 0.1, 0.1]] } } });
  // (shown by its place in A; with `decl`, attached to a1 whatever its place, its icon 14 units right
  // of a1's point and 14 up: a place on the board, as the page draws it)
  const onA1 = pnote("onA1", "On a1.", { places: { namespace: { in: [["A", 0.5, 0.5]] } }, decl: { name: "A.a1", at: [14, -14] } });
  // at the top level a note is the Project's, and this view's where it was added to it
  const ring = pnote("ring", "At the bottom of the ring.", { places: { namespace: { ring: 180 } } });
  const canvas = vnote("canvas", "On the canvas.", { place: { mode: "namespace", in: [], world: [900, 900] } });
  const s = boardSpots({ g, review: d, rec: viewOf("v", { notes: [canvas], items: { add: ["ring"], remove: [] } }), memory: null, notes: [inB, onA1, ring] });
  const by = new Map(s.notes.map((n) => [n.note.id, n]));
  assert.deepEqual(by.get("inB")?.in, ["A.B", "A"]);
  const B = s.clusters.get("A.B")!;
  assert.ok(by.get("inB")!.at[1] > B[1], "half a radius below A.B's centre");
  // the attached note's position is its declaration's point and its offset in the board's units, the
  // spot the page draws its icon at whatever the zoom (shared/notecard.ts, declSpot)
  assert.deepEqual([by.get("onA1")?.on, by.get("onA1")?.at], ["A.a1", [s.decls.get("A.a1")![0] + 14, s.decls.get("A.a1")![1] - 14]]);
  assert.deepEqual(by.get("onA1")?.at, declSpot(s.decls.get("A.a1")!, [14, -14]));
  assert.deepEqual([by.get("ring")?.in, by.get("canvas")?.at, by.get("canvas")?.kind], [[], [900, 900], "view"]);
  // the ring's bottom is below everything the board draws
  const lowest = Math.max(...[...s.decls.values()].map((p) => p[1]));
  assert.ok(by.get("ring")!.at[1] > lowest);
  const notes = buildDoc(input(s, { g, review: d }));
  assert.deepEqual(seqOf(notes.items).slice(0, 1), ["canvas"], "the canvas note, lowest, first at the start");
  assert.ok(seqOf(notes.items).includes("ring"));
  assert.deepEqual(declOf(notes, "A.a1").notes?.map((n) => n.id), ["note:onA1"]);
  assert.ok(seqOf(section(notes, "A.B").items).includes("inB"));
  // a note the view does not show is not printed: one taken out of it
  const out = boardSpots({ g, review: d, rec: viewOf("v", { items: { add: [], remove: ["inB"] } }), memory: null, notes: [inB, ring] });
  assert.deepEqual(out.notes.map((n) => n.note.id), []);
  // on the Project, every note of the project
  assert.deepEqual(boardSpots({ g, review: d, rec: viewOf("project"), memory: null, notes: [inB, ring] }).notes.map((n) => n.note.id), ["inB", "ring"]);
});

test("agents export the board's order through the API, as the page does; a past build's board is laid out as the Time Machine lays it out", async () => {
  const g = graph();
  const dir = mkdtempSync(join(tmpdir(), "vp-order-api-"));
  try {
    const review = new ReviewStore(dir, join(dir, "review"));
    const edges: number[] = [];
    for (let i = 0; i < g.n; i++) for (let e = g.outStart[i]; e < g.outStart[i + 1]; e++) edges.push(i, g.outDst[e], g.outSite[e]);
    mkdirSync(join(dir, "state"));
    const views = new Views(join(dir, "state"), LAYOUT_VERSION, () => {});
    const v = views.book.create("Outline", "Alice", { scope: parseQuery("all except external"), clustering: "namespace" }) as ViewData;
    views.arrangeNotes([{ op: "pnote", note: pnote("np", "A note of the project in C.", { places: { namespace: { in: [["C", 0.3, 0.3]] } } }) }], null, "Alice", false, null);
    const w = {
      project: { root: dir, files: new Map(), toolchain: "tc" },
      graph: { version: 1, fingerprint: "f00d", prep: { metaGz: gzipSync(JSON.stringify(g.meta)), edgesGz: gzipSync(Buffer.from(Int32Array.from(edges).buffer)) } },
      review,
      views,
      timeline: { events: [], add: (e: object) => ({ ...e, id: 1, at: "" }) },
      presence: { agentBeat: () => {}, agentView: () => null, drop: () => {} },
    } as unknown as World;
    const api = new AgentApi(w, null, "read");
    const claude: Caller = { name: "Claude", kind: "agent" };
    const model = async () => {
      const a = await api.handle({ method: "GET", path: "/api/agent/export", query: new URLSearchParams({ view: v.id }), body: null, caller: claude });
      assert.equal(a.status, 200, JSON.stringify(a.body));
      return a.body as DocModel;
    };
    const first = await model();
    assert.equal(first.version, 10);
    assert.ok(printedNotes(first).some((n) => n.id === "note:np"), "the note of the project in C prints");
    assert.ok(seqOf(section(first, "C").items).includes("np"));
    // as the server lays out the board, so does the page: the same memory, the same picture; a pin
    // dropped on the board moves the document
    const before = seqOf(first.items).filter((x) => x.startsWith("§"));
    const pos = boardSpots({ g, review: review.data, rec: views.book.get(v.id)!, memory: null, notes: views.book.notes });
    const [top, bottom] = [before[0], before[before.length - 1]].map((k) => k.slice(1));
    const at = (k: string) => pos.clusters.get(k)!;
    // swap the heights of the lowest and the highest top-level sections, as two drags would
    views.book.arrange(v.id, [
      { op: "pin", mode: "namespace", kind: "cluster", key: top, at: [at(top)[0], at(bottom)[1]] },
      { op: "pin", mode: "namespace", kind: "cluster", key: bottom, at: [at(bottom)[0], at(top)[1]] },
    ], "Alice", { by: "Alice" });
    const second = await model();
    const after = seqOf(second.items).filter((x) => x.startsWith("§"));
    assert.equal(after[0], `§${bottom}`);
    assert.equal(after[after.length - 1], `§${top}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a past build's board: its memory of that build recalled exactly, else laid out from the view's memory as the Time Machine does, a declaration renamed since read under its name then", () => {
  const g = graph();
  const d = review();
  const rec = viewOf("v", { version: 1 });
  const past = { snapshot: 1, nowName: new Map<string, string>(), now: g, nowReview: d };
  // no memory: laid out afresh, as the Time Machine does where the view's board of now is not the
  // whole project
  const laid = boardSpots({ g, review: d, rec, memory: null, past, notes: [] });
  assert.equal(laid.fresh, true);
  // the memory a page handed over for that build, under the snapshot's id, is recalled exactly: a2
  // where it was put
  const bs = boardSet(g, d, rec.scope);
  const G = bs.sub ? bs.sub.graph : g;
  const L = boardLayout(G, "namespace", bs.key, null, []).layout;
  const orig = memoryOf(L, G.nodes);
  const mem = structuredClone(orig);
  const a1 = mem.nodes["A.a1"];
  mem.nodes["A.a2"] = [a1[0] + 1, a1[1] + 30, a1[2]];
  const kept = boardSpots({ g, review: d, rec, memory: { set: pastSetKey(1, layoutKey(bs.key, [])), mem }, past, notes: [] });
  assert.equal(kept.fresh, undefined);
  assert.ok(Math.abs(kept.decls.get("A.a2")![1] - (a1[1] + 30)) < 0.5, "where the memory of that build has it");
  const doc = buildDoc(input(kept, { review: d }));
  assert.deepEqual(seqOf(section(doc, "A").items).filter((x) => !x.startsWith("§")), ["A.a2", "A.a1"]);
  // the latest build's memory is never taken for that build's: laid out from it, keeping in place
  // what it holds, a2 under the name it had then (A.old)
  const then = new Graph({ ...g.meta, nodes: g.nodes.map((n) => (n.name === "A.a2" ? { ...n, name: "A.old" } : n)) } as ViewMeta, Int32Array.from([1, 0, SITE_STMT, 2, 0, SITE_STMT, 0, 6, SITE_STMT]));
  const renamed = boardSpots({ g: then, review: d, rec, memory: { set: layoutKey(bs.key, []), mem: orig }, past: { ...past, nowName: new Map([["A.old", "A.a2"]]) }, notes: [] });
  assert.equal(renamed.fresh, true);
  const was = orig.nodes["A.a2"];
  assert.ok(Math.hypot(renamed.decls.get("A.old")![0] - was[0], renamed.decls.get("A.old")![1] - was[1]) < 0.5, "A.old where A.a2 is now");
});
