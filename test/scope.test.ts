// Names in a declaration's source, resolved as Lean would by default (web/src/scope.ts), and
// linked part by part where Lean says a dotted name is dot notation (web/src/highlight.ts); the
// source in lines that wrap to the source window's width, its text unchanged (highlightLines); and
// everything in force where a declaration is written, as the agents' API reads it
// (shared/scope.ts, `contextAt`).

import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightLean, highlightLines } from "../src/web/src/highlight.ts";
import type { Graph } from "../src/shared/viewgraph.ts";
import { namespacesOf, resolver, scopeAt } from "../src/web/src/scope.ts";
import { contextAt } from "../src/shared/scope.ts";

/** Just what scope.ts reads of a graph: the names. */
function graphOf(names: string[]): Graph {
  return { nodes: names.map((name) => ({ name })), byName: new Map(names.map((n, i) => [n, i])) } as unknown as Graph;
}

const g = graphOf(["A.Prime.two_le", "A.Prime.one_lt", "A.Order.Bound", "A.Order.Sem.run", "B.helper", "B.other", "Root", "C.x"]);
const has = (n: string) => namespacesOf(g).has(n);

const file = `/-! A module doc that says
namespace NotReally
-/
namespace A.Order
open A.Prime
open scoped Matrix

section Inner
open B (helper)
end Inner

namespace Sem
-- open C
open Classical in
def run := two_le
end Sem

open C in
def later := x
`.split("\n");

test("the scope where a declaration starts: namespaces and opens, sections closing theirs", () => {
  const at = file.findIndex((l) => l.startsWith("def run"));
  const s = scopeAt(file, at, has);
  assert.deepEqual(s.namespaces, ["A.Order.Sem", "A.Order", "A"]);
  // `open A.Prime` holds; the section's `open B (helper)` ended with it; a comment opens nothing;
  // `Classical` is not in the graph, so it opens nothing either
  assert.deepEqual(s.opens, ["A.Prime"]);
  assert.equal(s.aliases.size, 0);
  // `open C in` holds for the next declaration only
  const later = scopeAt(file, file.findIndex((l) => l.startsWith("def later")), has);
  assert.deepEqual(later.opens, ["A.Prime", "C"]);
});

test("a short name resolves in the namespaces around, as written, then in what is open", () => {
  const at = file.findIndex((l) => l.startsWith("def run"));
  const r = resolver(g, "A.Order.Sem.run", scopeAt(file, at, has));
  assert.equal(r("two_le"), "A.Prime.two_le", "through `open A.Prime`");
  assert.equal(r("Bound"), "A.Order.Bound", "in an enclosing namespace");
  assert.equal(r("Prime.one_lt"), "A.Prime.one_lt", "partly qualified, under an enclosing namespace");
  assert.equal(r("Root"), "Root");
  assert.equal(r("run"), null, "its own name links nowhere");
  assert.equal(r("helper"), null, "an alias from a section that ended");
  const inSection = resolver(g, "A.Order.thing", scopeAt(file, file.findIndex((l) => l.startsWith("end Inner")), has));
  assert.equal(inSection("helper"), "B.helper", "`open B (helper)` opens that one name");
  assert.equal(inSection("other"), null, "and only that one");
});

test("a dotted name links part by part when its parts mean different things", () => {
  const html = highlightLean("o.elim x", (w) => (w === "o.elim" ? [null, "Option.elim"] : null));
  assert.equal(html, 'o.<span class="tk-ref" data-ref="Option.elim">elim</span> x');
  // and is told where it is, so that the same word can mean different things in two places
  const at: number[] = [];
  highlightLean("x + x", (w, off) => (at.push(off), null));
  assert.deepEqual(at, [0, 4]);
});

test("the source in lines that wrap: each line its own element with its indentation, the text the source's to the character", () => {
  const src = 'theorem t (x : Nat) :\n    x = x := by\n  /- a "comment"\n     across lines -/\n\n  exact rfl';
  const said: [string, number][] = [];
  const html = highlightLines(src, (w, off) => (said.push([w, off]), w === "Nat" ? "Nat" : null));
  // the text, with its line breaks, is the source's: a character's offset in it is its offset in
  // the source, which is how a hover finds its line and column (sourcewin.ts, positionAt)
  const text = html.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  assert.equal(text, src);
  // one element per line, carrying its indentation, the line break at its end; none after the last
  const lines = [...html.matchAll(/<span class="ln" style="--in:(\d+)">/g)].map((m) => Number(m[1]));
  assert.deepEqual(lines, [0, 4, 2, 5, 0, 2]);
  assert.equal(html.match(/\n<\/span>/g)?.length, 5);
  // a comment across lines: one piece on each line, of the same kind, no element open across a line
  assert.equal(html.match(/tk-comment/g)?.length, 2);
  for (const line of html.split(/(?=<span class="ln")/)) assert.equal(line.match(/<span/g)!.length, line.match(/<\/span>/g)!.length, line);
  // names are linked, and told where they are, as highlightLean tells them
  assert.match(html, /<span class="tk-ref tk-type" data-ref="Nat">Nat<\/span>/);
  const plain: [string, number][] = [];
  highlightLean(src, (w, off) => (plain.push([w, off]), null));
  assert.deepEqual(said, plain);
  // a deep indentation keeps room for its text in a narrow window
  assert.match(highlightLines(" ".repeat(40) + "x"), /--in:24"/);
});

const longer = `namespace A
universe u v
open A.Prime
open scoped Matrix -- notation only
set_option autoImplicit false

variable {α : Type u} [DecidableEq α]
  (f : α → α) -- a comment inside
  /- and a block
     comment -/ (g : α)

section Inner
variable (x : Nat)
local notation "‖" a "‖" => f a
attribute [local instance] Classical.propDecidable
include f
def inner := x
end Inner

mutual
def even : Nat → Bool
  | 0 => true
  | n + 1 => odd n
def odd : Nat → Bool
  | 0 => false
  | n + 1 => even n
end

namespace B
namespace C
end B.C

open B (helper) in
set_option maxHeartbeats 400000 in
omit [DecidableEq α] in
/-- The one asked about. -/
@[simp]
theorem asked : True := trivial

open C in def other := 1
theorem last : True := trivial
`.split("\n");

test("the context of a declaration: blocks, opens, variables as written, universes, options, local commands", () => {
  const at = longer.findIndex((l) => l.startsWith("/-- The one asked about."));
  const c = contextAt(longer, at, has);
  assert.equal(c.namespace, "A");
  assert.deepEqual(c.namespaces, ["A"]);
  // `namespace B` / `namespace C` closed at once by `end B.C`; `mutual … end` closed by its `end`
  assert.deepEqual(c.blocks, [{ kind: "namespace", name: "A", line: 1 }]);
  assert.deepEqual(c.universes, [{ line: 2, text: "u v" }]);
  assert.deepEqual(c.opens, [
    { line: 3, text: "open A.Prime", namespaces: ["A.Prime"] },
    { line: 4, text: "open scoped Matrix", namespaces: [], scoped: true },
    { line: 33, text: "open B (helper)", namespaces: ["B"], in: true },
  ]);
  // binders over several lines, comments taken out, the section's variable gone with it
  assert.deepEqual(c.variables, [{ line: 7, text: "{α : Type u} [DecidableEq α] (f : α → α) (g : α)" }]);
  assert.deepEqual(c.options, [{ line: 5, text: "autoImplicit false" }, { line: 34, text: "maxHeartbeats 400000", in: true }]);
  assert.deepEqual(c.local, [{ line: 35, text: "omit [DecidableEq α]", in: true }]);
  // and the scope the page links names with agrees
  assert.equal(scopeAt(longer, at, has).aliases.get("helper"), "B.helper");
});

test("what a section holds ends with it; `… in` holds for the next command only", () => {
  const inner = contextAt(longer, longer.findIndex((l) => l.startsWith("def inner")), has);
  assert.deepEqual(inner.blocks.map((b) => [b.kind, b.name]), [["namespace", "A"], ["section", "Inner"]]);
  assert.deepEqual(inner.variables.map((v) => v.text), ["{α : Type u} [DecidableEq α] (f : α → α) (g : α)", "(x : Nat)"]);
  assert.deepEqual(inner.local.map((x) => x.text), ['local notation "‖" a "‖" => f a', "attribute [local instance] Classical.propDecidable", "include f"]);
  const odd = contextAt(longer, longer.findIndex((l) => l.startsWith("def odd")), has);
  assert.deepEqual(odd.blocks.map((b) => b.kind), ["namespace", "mutual"]);
  // `open C in def other` on one line holds for `other` alone, and nothing is pending after `asked`
  const last = contextAt(longer, longer.findIndex((l) => l.startsWith("theorem last")), has);
  assert.deepEqual(last.opens.map((o) => o.text), ["open A.Prime", "open scoped Matrix"]);
  assert.deepEqual(last.options.map((o) => o.text), ["autoImplicit false"]);
  assert.deepEqual(last.local, []);
});
