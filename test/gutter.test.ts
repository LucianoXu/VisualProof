// The source window's gutter (web/src/gutter.ts; ReviewSpec, "The source window", the owner's
// decision of 2026-10-20): the file's own line numbers beside the code and the context above it,
// each at its real line, a break where the numbers shown are not contiguous, a wrapped line numbered
// once; and the numbers outside the text, which stays the source to the character.

import assert from "node:assert/strict";
import { test } from "node:test";
import { contextGutter, cutMarks, gutterDigits, gutterRows, rowMarks } from "../src/web/src/gutter.ts";
import { contextLines, exactContext, readContext } from "../src/shared/context.ts";
import type { ModuleContexts } from "../src/shared/context.ts";
import { highlightLines } from "../src/web/src/highlight.ts";

/** The numbers drawn, `·` for none, `┄` before a row after a break. */
const drawn = (rows: { n: number | null; gap: boolean }[]) => rows.map((r) => `${r.gap ? "┄" : ""}${r.n ?? "·"}`).join(" ");

/** The text of highlighted HTML: its tags taken out, its entities read. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

test("the gutter numbers each row at its line, breaking where the numbers are not contiguous", () => {
  assert.equal(drawn(gutterRows([20, 21, 22])), "20 21 22", "contiguous lines: no break");
  assert.equal(drawn(gutterRows([3, 5, 6, 12])), "3 ┄5 6 ┄12");
  assert.equal(drawn(gutterRows([7])), "7", "the first row has nothing above it to break from");
  assert.equal(drawn(gutterRows([])), "");
  // the elaborator's context gives each binder of `variable {α : Type} [DecidableEq α]` apart, on
  // the same line: numbered once, no break between them
  assert.equal(drawn(gutterRows([15, 15, 15, 16, 20, 20])), "15 · · 16 ┄20 ·");
  // a place not known: no number, and the next row is compared with the last one known
  assert.equal(drawn(gutterRows([4, 0, 5, 0, 9])), "4 · 5 · ┄9");
  assert.equal(drawn(gutterRows([0, 2])), "· 2");
});

test("folded or whole, the context's gutter breaks where lines are left out, and before the code where it does not follow", () => {
  // namespace at 3, opens at 5 and 6, a variable at 9 folded away, an `include … in` at 11 right
  // above the code at 12
  const lines = [3, 5, 6, 9, 11];
  const kept = [true, true, true, false, true];
  const g = contextGutter(lines, kept, 12);
  assert.equal(drawn(g.open), "3 ┄5 6 ┄9 ┄11");
  assert.deepEqual(g.folded.map((r) => (r ? drawn([r]) : null)), ["3", "┄5", "6", null, "┄11"]);
  assert.deepEqual(g.cut, { open: false, folded: false }, "the code follows the context's last line");
  // the line right above the code folded away: whole, the code follows it; folded, a break
  const h = contextGutter([3, 4, 10], [true, true, false], 11);
  assert.deepEqual(h.cut, { open: false, folded: true });
  assert.equal(drawn(h.open), "3 4 ┄10");
  // a number repeated: shown on the first of its rows that is shown
  const r = contextGutter([7, 7, 7], [false, true, true], 20);
  assert.equal(drawn(r.open), "7 · ·");
  assert.deepEqual(r.folded.map((x) => (x ? drawn([x]) : null)), [null, "7", "·"]);
  assert.deepEqual(r.cut, { open: true, folded: true });
  // the classes the style draws them by, whole and folded
  assert.equal(rowMarks(r.open[2], r.folded[2]), "again again-f");
  assert.equal(rowMarks(r.open[1], r.folded[1]), "again");
  assert.equal(rowMarks(r.open[0], r.folded[0]), "");
  assert.equal(rowMarks(g.open[3], g.folded[3]), "gap", "a row folded away has no folded marks");
  assert.equal(rowMarks(g.open[1], g.folded[1]), "gap gap-f");
  assert.equal(cutMarks(h.cut), "cut-f");
  assert.equal(cutMarks(r.cut), "cut cut-f");
  assert.equal(cutMarks(g.cut), "");
});

test("the gutter holds room for the code's last line, the largest number shown", () => {
  assert.deepEqual([9, 10, 99, 100, 12345].map(gutterDigits), [1, 2, 2, 3, 5]);
  assert.equal(gutterDigits(0), 1);
});

const FILE = `import Mathlib

namespace A.B
universe u
open X

/-- a section -/
section Inner
variable {α : Type u} [DecidableEq α]
  (R : α → α)

open Classical in
/-- The one asked about. -/
def asked (x : α) : α := R x
end Inner
`;

test("the context read from the text: each command at the line it is written on, its first", () => {
  const lines = FILE.split("\n");
  const start = lines.findIndex((l) => l.startsWith("/-- The one"));
  const ctx = contextLines(readContext(lines, start));
  assert.deepEqual(
    ctx.map((l) => [l.line, l.text]),
    [
      [3, "namespace A.B"],
      [4, "universe u"],
      [5, "open X"],
      [8, "section Inner"],
      [9, "variable {α : Type u} [DecidableEq α] (R : α → α)"],
      [12, "open Classical in"],
    ],
  );
  for (const l of ctx) assert.ok(lines[l.line - 1].startsWith(l.text.split(" ")[0]), `${l.text} is written at ${l.line}`);
  const g = contextGutter(ctx.map((l) => l.line), ctx.map(() => true), start + 1);
  // the variable over lines 9–10, shown as one command, is numbered at its first: 12 after it is a
  // break, as the numbers are not contiguous; the declaration's doc at 13 follows `… in` at 12
  assert.equal(drawn(g.open), "3 4 5 ┄8 9 ┄12");
  assert.equal(g.cut.open, false);
});

test("the elaborator's context: the binders of one `variable` on its line, numbered once", () => {
  const lines = FILE.split("\n");
  const start = lines.findIndex((l) => l.startsWith("/-- The one"));
  // as server/usage.ts gives it: a variable per binder, each at its binder's line
  const m: ModuleContexts = {
    hash: "h",
    contexts: [
      {
        namespace: "A.B",
        namespaces: ["A.B", "A"],
        blocks: [
          { kind: "namespace", name: "A.B", line: 3 },
          { kind: "section", name: "Inner", line: 8 },
        ],
        opens: [{ line: 5, text: "X", namespaces: ["X"] }],
        variables: [
          { line: 9, text: "{α : Type u}" },
          { line: 9, text: "[DecidableEq α]" },
          { line: 10, text: "(R : α → α)" },
        ],
        universes: [{ line: 4, text: "u" }],
        options: [],
        local: [],
      },
    ],
    decls: { "A.B.asked": [0, 0, 2] },
  };
  const exact = exactContext(m, "A.B.asked", "h")!;
  const ctx = contextLines(readContext(lines, start, exact));
  const g = contextGutter(ctx.map((l) => l.line), ctx.map(() => true), start + 1);
  assert.equal(drawn(g.open), "3 4 5 ┄8 9 · 10");
  assert.equal(g.cut.open, true, "10, then the code at 13: lines left out");
});

test("the code's lines carry their numbers outside the text, which stays the source to the character", () => {
  const src = "theorem t (h : a < b) :\n    a ≤ b := by\n\n  exact le_of_lt h -- a \"comment\" & more";
  const html = highlightLines(src, () => null, 31);
  // one element per line of the source, each numbered from the first: a line wrapped on the screen
  // is one element, so one number, on its first row (web/style.css)
  assert.deepEqual([...html.matchAll(/<span class="ln"( data-n="(\d+)")? style="--in:(\d+)">/g)].map((m) => [Number(m[2]), Number(m[3])]), [
    [31, 0],
    [32, 4],
    [33, 0],
    [34, 2],
  ]);
  // the number is an attribute, not text: the text is the source, so copying, quoting and the
  // positions Lean is asked at count in it alone
  assert.equal(textOf(html), src);
  assert.doesNotMatch(textOf(html), /31|32|33|34/);
  // a long line is one element, one number, whatever its length
  const long = `theorem long : ${Array.from({ length: 60 }, (_, k) => `x${k}`).join(" + ")} = 0 := sorry`;
  const one = highlightLines(long, () => null, 400);
  assert.equal((one.match(/data-n=/g) ?? []).length, 1);
  assert.match(one, /data-n="400"/);
  // without a first line (Lean's #print, a hover, a comment's code), no numbers at all
  assert.doesNotMatch(highlightLines(src), /data-n/);
});
