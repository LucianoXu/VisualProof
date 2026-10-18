// The search (shared/search.ts; the list's quota is web/src/search.ts): names first, then
// statements, then docstrings; every word has to be found; each result shows where it matched.

import assert from "node:assert/strict";
import { test } from "node:test";
import { lowerKeepingOffsets, marked, narrows, queryWords, search, SearchIndex, snippet } from "../src/shared/search.ts";
import type { Searchable } from "../src/shared/search.ts";
import { quota } from "../src/web/src/search.ts";

const nodes: Searchable[] = [
  { name: "Q.flipAt", type: "Q.Grid → Q.Grid", doc: "Flips two cells." },
  { name: "Q.flipAt_flipAt", type: "Q.flipAt (Q.flipAt r) = r" },
  { name: "Q.cflipAt_comm", type: "Q.cflipAt a ∘ Q.cflipAt b = Q.cflipAt b ∘ Q.cflipAt a" },
  { name: "Q.reflection", type: "↥(Matrix.unitaryGroup Bool ℂ)" },
  { name: "Q.longer", type: "∀ (n : ℕ), Matrix.unitaryGroup (Fin n) ℂ → Matrix.unitaryGroup (Fin n) ℂ → Prop" },
  { name: "Q.FLT.TWFLT", type: "Q.Grid → Prop", doc: "**Fermat's Last Theorem** (Wiles, Taylor, Ribet 1995, Theorem 3)." },
  { name: "Q.semistable", type: "Q.Grid → Prop", doc: "After Wiles et al.: a semistable FLT." },
  { name: "Q.subunitaryGroupish", type: "Q.Grid → Q.Grid", doc: "Not about Matrix.unitaryGroup at all." },
  // outside the project: a name only
  { name: "Matrix.unitaryGroup" },
  { name: "Other.flipAt" },
];
const ix = new SearchIndex(nodes, 8);
const names = (hits: { i: number }[]) => hits.map((h) => nodes[h.i].name);

test("a name match ranks as it always did: exact, then a prefix, then inside; the project first; shorter first", () => {
  const f = search(ix, "flipAt");
  assert.deepEqual(names(f.hits.name), ["Q.flipAt", "Other.flipAt", "Q.flipAt_flipAt", "Q.cflipAt_comm"]);
  // a declaration whose name has the word is found by its name, whatever else has it
  assert.ok(f.hits.statement.every((h) => !nodes[h.i].name.toLowerCase().includes("flipat")));
});

test("statements and docstrings are searched after names, each result saying where it matched", () => {
  const f = search(ix, "unitaryGroup");
  assert.deepEqual(names(f.hits.name), ["Matrix.unitaryGroup", "Q.subunitaryGroupish"]);
  // the shorter statement first: the word stands more for what it says
  assert.deepEqual(names(f.hits.statement), ["Q.reflection", "Q.longer"]);
  assert.ok(f.hits.statement.every((h) => h.where === "statement" && h.word === "unitarygroup"));
  assert.equal(f.hits.doc.length, 0, "the declaration whose docstring has it has it in its name");
  const d = search(ix, "wiles");
  assert.deepEqual(names(d.hits.doc), ["Q.semistable", "Q.FLT.TWFLT"]);
  assert.ok(d.hits.doc.every((h) => h.where === "doc"));
  assert.deepEqual(d.matched, Int32Array.from([5, 6]));
});

test("every word has to be found, each in the name, the statement or the docstring", () => {
  assert.deepEqual(names(search(ix, "flipAt comm").hits.name), ["Q.cflipAt_comm"]);
  // FLT in the name, Wiles in the docstring: found, as a docstring match, ahead of a shorter
  // docstring that has both words
  const f = search(ix, "FLT Wiles");
  assert.deepEqual(names(f.hits.doc), ["Q.FLT.TWFLT", "Q.semistable"]);
  assert.equal(f.hits.doc[0].word, "wiles");
  assert.deepEqual(names(search(ix, "TW Wiles").hits.doc), ["Q.FLT.TWFLT"]);
  assert.equal(search(ix, "Wiles Taylor Ribet").hits.doc.length, 1);
  assert.equal(search(ix, "Wiles Euler").matched.length, 0);
  // case does not matter, and a word given twice counts once
  assert.deepEqual(queryWords("  Wiles  wiles TAYLOR "), ["wiles", "taylor"]);
});

test("a query that adds to the last one finds the same looking only at what that one found", () => {
  let prev = search(ix, "fl");
  for (const q of ["fli", "flip", "flipAt", "flipAt ", "flipAt c", "flipAt co"]) {
    assert.ok(narrows(prev.query, q));
    const narrowed = search(ix, q, prev.matched);
    const full = search(ix, q);
    assert.deepEqual(narrowed.hits, full.hits, q);
    prev = narrowed;
  }
  assert.equal(narrows("flipAt", "flip"), false);
  assert.equal(narrows("flipAt", "cflipAt"), false);
});

test("lowercase text keeps every offset, so a place found in it is the place in the text", () => {
  const s = "İstanbul Σ x";
  const l = lowerKeepingOffsets(s);
  assert.equal(l.length, s.length);
  assert.equal(l.indexOf("stanbul"), s.indexOf("stanbul"));
  assert.equal(lowerKeepingOffsets("Matrix.unitaryGroup"), "matrix.unitarygroup");
});

test("marks: every occurrence of every word, overlaps as one, white space as one space", () => {
  const text = "Q.cflipAt a\n   ∘ Q.cflipAt b";
  const pieces = marked(text, text.toLowerCase(), ["cflip", "flipat"]);
  assert.deepEqual(pieces, [
    { text: "Q.", mark: false },
    { text: "cflipAt", mark: true },
    { text: " a ∘ Q.", mark: false },
    { text: "cflipAt", mark: true },
    { text: " b", mark: false },
  ]);
  // a stretch of the text: a word cut by its edge is marked as far as it shows
  assert.deepEqual(marked(text, text.toLowerCase(), ["cflipat"], 4, 12), [
    { text: "lipAt", mark: true },
    { text: " a ", mark: false },
  ]);
});

test("a snippet is a short stretch around the word that needed the place, cut at a word", () => {
  const doc = nodes[5].doc!;
  const s = snippet(doc, doc.toLowerCase(), ["wiles"], "wiles");
  // close to the beginning: from the beginning
  assert.equal(s.before, false);
  assert.equal(s.pieces.map((p) => p.text).join(""), doc);
  assert.deepEqual(s.pieces.filter((p) => p.mark).map((p) => p.text), ["Wiles"]);
  const long = "word ".repeat(40) + "target " + "tail ".repeat(40);
  const t = snippet(long, long, ["target"], "target", 60, 20);
  assert.equal(t.before, true);
  assert.equal(t.after, true);
  const shown = t.pieces.map((p) => p.text).join("");
  assert.ok(shown.startsWith("word "), "starts at a word");
  assert.ok(shown.includes("target") && shown.length <= 60);
  // never half a character: 𝔽 is two UTF-16 units
  const wide = "𝔽".repeat(30) + " x " + "𝔽".repeat(30);
  const w = snippet(wide, wide, ["x"], "x", 20, 7);
  for (const p of w.pieces) assert.doesNotMatch(p.text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, "no lone surrogate");
});

test("the list's rows: each place up to its share, then what is left to names, statements, docstrings", () => {
  assert.deepEqual(quota({ name: 100, statement: 520, doc: 3 }, 18, 6), { name: 9, statement: 6, doc: 3 });
  assert.deepEqual(quota({ name: 1, statement: 520, doc: 0 }, 18, 6), { name: 1, statement: 17, doc: 0 });
  assert.deepEqual(quota({ name: 4, statement: 2, doc: 1 }, 18, 6), { name: 4, statement: 2, doc: 1 });
});

test("a name a declaration folds finds it, after the declarations found by their own names", () => {
  const ns: Searchable[] = [
    // a notation, and the name Lean generated for it: no dots, its module's path in it
    { name: "termR", also: ["_aux_FltRegular_CaseI_Statement___macroRules_FltRegular_termR_1"] },
    { name: "FltRegular.caseI" },
    { name: "FltRegular.caseI_easier" },
    { name: "QOR", also: ["QOR.Name"] },
    { name: "N.renamed" },
  ];
  const nx = new SearchIndex(ns);
  const found = (q: string) => search(nx, q).hits.name.map((h) => [ns[h.i].name, h.via ?? null]);
  assert.deepEqual(found("caseI flt"), [["FltRegular.caseI", null], ["FltRegular.caseI_easier", null], ["termR", "_aux_FltRegular_CaseI_Statement___macroRules_FltRegular_termR_1"]]);
  assert.deepEqual(found("name"), [["N.renamed", null], ["QOR", "QOR.Name"]]);
  assert.deepEqual(found("termR"), [["termR", null]], "its own name first");
});
