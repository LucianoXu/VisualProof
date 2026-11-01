// File mode of the source window (ReviewSpec, "The source window", the owner's decisions of
// 2026-11-01; web/src/filemode.ts): the declarations of a file where the window would show each, the
// pieces the file is drawn in, the declaration a reading position is in, the proofs that fold, the
// marks in the gutter; and the lines drawn with them (web/src/highlight.ts), whose text stays the
// source's to the character, so that the positions Lean is asked at hold, folded or not.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { emptyReview, record } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { chunksOf, declAt, FOLD_MARK, fileDecls, fileMark, headLine, moduleDecls, proofFolds, sameText } from "../src/web/src/filemode.ts";
import { highlightLines } from "../src/web/src/highlight.ts";
import { FILE_MARK_LABEL } from "../src/web/src/filemode.ts";

/** A file of the project: a module doc, a definition with a proof inside it, a theorem whose proof
 *  starts on the line after its `:=`, a short one, a structure, a theorem with a docstring and an
 *  attribute. Lines from 1 in the comments. */
const FILE = [
  "/-! The module's doc -/", //  1
  "namespace P", //               2
  "", //                          3
  "def half (n : ℕ) : ℕ := n / 2", // 4
  "", //                          5
  "def pos (n : ℕ) (h : 0 < n) : { m // 0 < m } :=", // 6
  "  ⟨n, by", //                  7
  "    exact h⟩", //              8
  "", //                          9
  "theorem half_le (n : ℕ) : half n ≤ n :=", // 10
  "  Nat.div_le_self n 2", //     11
  "", //                          12
  "theorem one : 1 = 1 := rfl", // 13
  "", //                          14
  "structure S where", //         15
  "  x : ℕ", //                   16
  "", //                          17
  "/-- A doc", //                 18
  "  over two lines. -/", //      19
  "@[simp]", //                   20
  "theorem big (a b : ℕ) : a + b = b + a := by", // 21
  "  omega", //                   22
  "", //                          23
  "end P", //                     24
];

const node = (name: string, kind: string, range: [number, number, number, number], more: Partial<ViewNode> = {}): ViewNode => ({ name, kind, module: "P.F", ax: 0, hash: `${name}#1`, range, ...more }) as ViewNode;

/** The file's graph; `sorry`: the declarations that rest on `sorry` (their axioms hold `sorryAx`). */
function world(sorry: readonly string[] = []) {
  const nodes: ViewNode[] = [
    node("P.big", "theorem", [18, 0, 22, 7]),
    node("P.half", "def", [4, 0, 4, 29]),
    // the usage pass's proof inside a definition: `by\n    exact h` (lines from 1, columns in code points)
    node("P.pos", "def", [6, 0, 8, 12], { proofs: [[7, 6, 8, 11]] }),
    node("P.half_le", "theorem", [10, 0, 11, 21]),
    node("P.one", "theorem", [13, 0, 13, 26]),
    node("P.S", "structure", [15, 0, 16, 7]),
    // Lean generated it: no text of its own
    node("P.S.mk.injEq", "theorem", [15, 0, 16, 7], { gen: "P.S" }),
    node("Q.other", "def", [1, 0, 1, 5], { module: "Q.G" }),
    { name: "Nat.add_comm", kind: "theorem", module: "Init.Core", ax: 0, ext: true, range: [10, 0, 12, 0] } as ViewNode,
  ];
  for (const n of nodes) if (sorry.includes(n.name)) n.ax = 1;
  const meta = { nodes, projectCount: 8, axioms: ["sorryAx"], axiomSets: [[], [0]], layouts: {}, edgeCount: 0 } as unknown as ViewMeta;
  return new Graph(meta, new Int32Array(0));
}

test("the declarations of a file, each where the window shows it, in the order of the file; what Lean generated and what is elsewhere left out", () => {
  const g = world();
  assert.deepEqual(moduleDecls(g, "P.F").length, 7);
  assert.deepEqual(moduleDecls(g, "Init.Core"), [8], "outside the project, those of the module the graph holds");
  const ds = fileDecls(g, "P.F", FILE, false);
  assert.deepEqual(
    ds.map((d) => [g.nodes[d.i].name, d.start + 1, d.end + 1, d.head + 1]),
    [
      ["P.half", 4, 4, 4],
      ["P.pos", 6, 8, 6],
      ["P.half_le", 10, 11, 10],
      ["P.one", 13, 13, 13],
      ["P.S", 15, 16, 15],
      // its docstring and attribute are its own; its mark where its command starts
      ["P.big", 18, 22, 21],
    ],
  );
  // a file changed since it was compiled: each found by name in the present text, one gone left out
  const edited = ["namespace P", "", "theorem one : 1 = 1 := rfl", "", "def half (n : ℕ) : ℕ := n / 2", "end P"];
  assert.deepEqual(
    fileDecls(g, "P.F", edited, true).map((d) => [g.nodes[d.i].name, d.start + 1, d.end + 1]),
    [
      ["P.one", 3, 3],
      ["P.half", 5, 5],
    ],
  );
});

test("headLine: past a docstring and the attributes after it; the docstring's own line where the command follows it there", () => {
  assert.equal(headLine(FILE, 17, 21), 20);
  assert.equal(headLine(["/-- doc -/ theorem t : True := trivial"], 0, 0), 0);
  assert.equal(headLine(["/-- doc -/", "-- a comment", "@[simp] theorem t : True := trivial"], 0, 2), 2);
  // a docstring that never closes: the start
  assert.equal(headLine(["/-- doc", "theorem t"], 0, 1), 0);
});

test("the pieces: each declaration's lines one piece, those that meet one together, the lines between cut to a few dozen; all of the file, in order", () => {
  const g = world();
  const ds = fileDecls(g, "P.F", FILE, false);
  const cs = chunksOf(ds, FILE.length, 4);
  assert.deepEqual(
    cs.map((c) => [c.start + 1, c.end + 1]),
    [
      [1, 3],
      [4, 4],
      [5, 5],
      [6, 8],
      [9, 9],
      [10, 11],
      [12, 12],
      [13, 13],
      [14, 14],
      [15, 16],
      [17, 17],
      [18, 22],
      [23, 24],
    ],
  );
  // a long stretch between declarations: pieces of at most `max` lines
  assert.deepEqual(chunksOf([], 10, 4).map((c) => [c.start, c.end]), [[0, 3], [4, 7], [8, 9]]);
  // declarations whose lines overlap (a declaration inside another's) are one piece
  const nested = [
    { i: 0, start: 2, end: 8, head: 2 },
    { i: 1, start: 4, end: 5, head: 4 },
    { i: 2, start: 8, end: 9, head: 8 },
  ];
  assert.deepEqual(chunksOf(nested, 12).map((c) => [c.start, c.end]), [[0, 1], [2, 9], [10, 11]]);
  // where the reading is: the innermost declaration holding the line, none between
  assert.equal(declAt(nested, 4)!.i, 1);
  assert.equal(declAt(nested, 6)!.i, 0);
  assert.equal(declAt(nested, 9)!.i, 2);
  assert.equal(declAt(nested, 1), null);
  assert.equal(declAt(nested, 10), null);
});

test("the proofs that fold: a theorem's value after its `:=`, a definition's proofs where the pass found them in this text, nothing shorter than the mark", () => {
  const g = world();
  const ds = fileDecls(g, "P.F", FILE, false);
  const folds = proofFolds(g, ds, FILE, () => true);
  const text = (f: (typeof folds)[number]) => {
    const [l0, c0] = f.from, [l1, c1] = f.to;
    if (l0 === l1) return FILE[l0].slice(c0, c1);
    return [FILE[l0].slice(c0), ...FILE.slice(l0 + 1, l1), FILE[l1].slice(0, c1)].join("\n");
  };
  assert.deepEqual(folds.map(text), [
    // P.pos: the usage pass's span, `by` to the proof's end
    "by\n    exact h",
    // P.half_le: from the end of its `:=` line, its mark after the `:=`
    "\n  Nat.div_le_self n 2",
    // P.big: after `:= `, on the same line
    "by\n  omega",
  ]);
  assert.ok(FOLD_MARK.length >= "rfl".length, "`:= rfl` stays as it is");
  // where the pass did not read this text, a definition's proofs are not folded: a theorem's are
  assert.deepEqual(proofFolds(g, ds, FILE, () => false).map((f) => g.nodes[ds[f.decl].i].name), ["P.half_le", "P.big"]);
});

test("the lines with their proofs folded: the text is the source's to the character, hidden or not; the mark has no text; a line all folded is hidden whole", () => {
  const g = world();
  const ds = fileDecls(g, "P.F", FILE, false);
  const folds = proofFolds(g, ds, FILE, () => true);
  const src = FILE.join("\n");
  const starts = [0];
  for (const l of FILE) starts.push(starts.at(-1)! + l.length + 1);
  const off = ([l, c]: [number, number]) => starts[l] + c;
  const html = highlightLines(src, () => null, 1, {
    folds: folds.map((f) => ({ from: off(f.from), to: off(f.to), id: `${f.from[0]}:${f.from[1]}` })),
    line: (k) => (k === 20 ? { cls: " hl", lead: `<span class="dm s-approved" aria-hidden="true"></span>` } : undefined),
  });
  const textOf = (h: string) => h.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  assert.equal(textOf(html), src, "every character there, in order");
  // three marks, each before what it stands for
  assert.equal((html.match(/class="pf-mark"/g) ?? []).length, 3);
  // half_le's proof starts after its `:=` line: the mark ends that line, the next line is hidden whole
  const lines = html.split(/(?=<span class="ln)/);
  assert.match(lines[9], /:=<button type="button" class="pf-mark" data-pf-open="9:39"/);
  assert.match(lines[10], /^<span class="ln pf-l" data-n="11" data-pf="9:39"/);
  // pos's proof: `⟨n, ` stays, then the mark, the rest of the line and the next hidden but `⟩`
  assert.match(lines[6], /⟨n, (<\/span>)?<button type="button" class="pf-mark" data-pf-open="6:6"/);
  assert.match(lines[7], /^<span class="ln" data-n="8"[^>]*><span class="pf-t" data-pf="6:6">/);
  // the window's declaration and a mark: classes and what leads the line, no text
  assert.match(lines[20], /^<span class="ln hl" data-n="21" style="--in:0"><span class="dm s-approved" aria-hidden="true"><\/span>/);
});

test("the marks: Status's review states, trusted, and hollow where no target's review set holds it; where a changed file keeps a declaration's text", () => {
  const g = world();
  const d = emptyReview();
  const at = (k: number) => new Date(Date.UTC(2026, 10, 1, 10, 0, k)).toISOString();
  record(d, { op: "opinion", name: "P.half", by: "Alice", verdict: "approve", hash: "P.half#1" }, "tc", at(1));
  record(d, { op: "opinion", name: "P.pos", by: "Bob", verdict: "comment", comment: "why?", hash: "P.pos#1" }, "tc", at(2));
  record(d, { op: "opinion", name: "P.one", by: "Bob", verdict: "approve", hash: "P.one#0" }, "tc", at(3));
  d.trusted.push("P.S");
  const inReview = (i: number) => g.nodes[i].name !== "P.big";
  const marks = ["P.half", "P.pos", "P.one", "P.S", "P.half_le", "P.big"].map((n) => fileMark(d, g, g.byName.get(n)!, inReview));
  assert.deepEqual(marks, ["approved", "commented", "stale", "trusted", "unreviewed", "free"]);
  // no targets to say it by: what needs review is not yet reviewed, as the board says it
  assert.equal(fileMark(d, g, g.byName.get("P.big")!, null), "unreviewed");
  // a file changed since it was compiled: the mark where the declaration's lines are still those
  const now = ["namespace P", "def half (n : ℕ) : ℕ := n / 2", "theorem one : 1 = 1 := by rfl", "end P"];
  assert.equal(sameText(FILE, [4, 0, 4, 29], now, { start: 1, end: 1 }), true);
  assert.equal(sameText(FILE, [13, 0, 13, 26], now, { start: 2, end: 2 }), false);
  assert.equal(sameText(FILE, [6, 0, 8, 12], now, { start: 1, end: 1 }), false, "fewer lines");
});

test("the marks show what Status shows (the owner's decision of 2026-11-01): the file being compiled, failed, `sorry` beneath, before any review state", () => {
  const g = world(["P.half", "P.big"]);
  const d = emptyReview();
  const at = (k: number) => new Date(Date.UTC(2026, 10, 1, 10, 0, k)).toISOString();
  record(d, { op: "opinion", name: "P.half", by: "Alice", verdict: "approve", hash: "P.half#1" }, "tc", at(1));
  record(d, { op: "opinion", name: "P.pos", by: "Bob", verdict: "comment", comment: "why?", hash: "P.pos#1" }, "tc", at(2));
  const mark = (n: string, file?: Parameters<typeof fileMark>[4], inReview: ((i: number) => boolean) | null = () => n !== "P.half_le") => fileMark(d, g, g.byName.get(n)!, inReview, file);
  // `sorry` beneath it wins over an approval, and over being in no target's review set
  assert.deepEqual(["P.half", "P.big", "P.pos", "P.half_le"].map((n) => mark(n)), ["sorry", "sorry", "commented", "free"]);
  // the file being compiled, or its build failed or never done: before everything else, as on the board
  const file = (state: string) => ({ module: "P.F", state }) as never;
  assert.deepEqual(["P.half", "P.pos", "P.half_le"].map((n) => mark(n, file("building"))), ["building", "building", "building"]);
  assert.deepEqual(["P.half", "P.pos"].map((n) => mark(n, file("failed"))), ["failed", "failed"]);
  assert.equal(mark("P.pos", file("unbuilt")), "failed");
  // out of date, queued, blocked, or built: as last built (a file "sorry" says it of some declaration of
  // it; its own axioms say it of each)
  for (const state of ["ok", "stale", "queued", "blocked"]) assert.equal(mark("P.pos", file(state)), "commented", state);
  // outside the project there is no build of its own to say
  assert.equal(fileMark(d, g, g.byName.get("Nat.add_comm")!, null, file("failed")), "trusted");
  // each said as the legend says it
  assert.deepEqual([FILE_MARK_LABEL.sorry, FILE_MARK_LABEL.failed, FILE_MARK_LABEL.building, FILE_MARK_LABEL.free], ["contains sorry", "failed or not built", "building", "in no target's review set"]);
});
