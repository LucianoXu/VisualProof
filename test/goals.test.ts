// The InfoView's reading of the text and of Lean's answers (shared/goals.ts, server/goals.ts;
// ReviewSpec, "The InfoView"): where the tactic at a place is — the goals before it are asked at its
// first character, those after it at its end —, which lines ↑ and ↓ step to, a goal as Lean writes
// it; Lean's answers read, plain and interactive, as Lean gives them, and bounded.

import assert from "node:assert/strict";
import { test } from "node:test";
import { codeLines, flatten, goalText, parsePlainGoal, stepLine, tacticSpan } from "../src/shared/goals.ts";
import { readInfo, readInteractiveGoals, readInteractiveTermGoal, readPlainGoals, readPlainTermGoal, readWidgets, Reading, refsIn } from "../src/server/goals.ts";
import { INTERACTIVE, TERM } from "./leananswers.ts";

/** The tactic at the place of `mark` (its first character) in `line`, as text. */
const at = (line: string, mark: string, from = 0): string | null => {
  const s = tacticSpan(line, line.indexOf(mark, from));
  return s && line.slice(s.from, s.to);
};

test("the tactic a place is in: from the `by` or the separator before it to the one after it, at the same depth of brackets", () => {
  assert.equal(at("  cases a", "a"), "cases a");
  assert.equal(at("  cases a", "cases"), "cases a", "at its first character too");
  // the fixture's one-line proofs (test/fixture/Fixture/Basic.lean)
  const line = "  if h : a.x = b.x ∧ a.y = b.y then isTrue (by cases a; cases b; simp_all)";
  assert.equal(at(line, "cases a"), "cases a");
  assert.equal(at(line, "b; simp"), "cases b");
  assert.equal(at(line, "simp_all"), "simp_all", "the bracket that closes the block ends it");
  const s = tacticSpan(line, line.indexOf("cases b"))!;
  assert.deepEqual([s.from, s.to], [56, 63], "UTF-16 columns, as Lean counts them");
  // brackets inside a tactic are its own: a rewrite's list, a term in parentheses
  assert.equal(at("  rw [foo, bar] at h", "bar"), "rw [foo, bar] at h");
  assert.equal(at("  exact (foo bar)", "bar"), "exact (foo bar)");
  // a function's `=>` is in its term; a case's ends its head
  assert.equal(at("  exact fun x => foo x", "foo"), "exact fun x => foo x");
  assert.equal(at("  induction n with | zero => simp | succ n ih => omega", "simp"), "simp");
  assert.equal(at("  induction n with | zero => simp | succ n ih => omega", "omega"), "omega");
  assert.equal(at("  case h => exact foo", "foo"), "exact foo");
  assert.equal(at("  next => simp", "simp"), "simp");
  // an absolute value's bars are no arms
  assert.equal(at("  have : |x| < 1 := abs_lt.mpr h", "x|"), "have : |x| < 1 := abs_lt.mpr h");
  assert.equal(at("  have : |x| < 1 := by simp", "simp"), "simp", "a `by` in the line begins a block");
  // `<;>`, and a focusing dot, which is no tactic
  assert.equal(at("  constructor <;> simp", "simp"), "simp");
  assert.equal(at("  constructor <;> simp", "constructor"), "constructor");
  assert.equal(at("  · simp at h", "at"), "simp at h");
  assert.equal(at("  x |>.foo; simp", "foo"), "x |>.foo", "a pipe is no arm");
  // past the code: the line's last tactic; a line of no code: none
  assert.equal(at("  simp [foo] -- done", "done"), "simp [foo]");
  assert.equal(tacticSpan("  simp", 40)?.to, 6);
  assert.equal(tacticSpan("   ", 1), null);
  assert.equal(tacticSpan("  -- a comment", 5), null);
  assert.equal(at("  simp /- why -/ at h", "at"), "simp /- why -/ at h", "a comment closed on the line is inside the tactic");
  assert.equal(at('  exact "a;b" ++ c', "c"), 'exact "a;b" ++ c', "a string holds no separator");
});

test("↑ and ↓ step from a line of code to the next, past blank lines, comments and docstrings, to where its code starts", () => {
  const text = ["theorem t : P := by", "  intro x", "", "  -- why", "  /- a", "  comment -/", "  · simp", "    ring"].join("\n");
  assert.deepEqual(codeLines(text), [true, true, false, false, false, false, true, true]);
  assert.deepEqual(stepLine(text, 1, 1), { line: 6, ch: 2 });
  assert.deepEqual(stepLine(text, 6, -1), { line: 1, ch: 2 });
  assert.deepEqual(stepLine(text, 6, 1), { line: 7, ch: 4 });
  assert.equal(stepLine(text, 7, 1), null, "past the code's end");
  assert.equal(stepLine(text, 0, -1), null);
  assert.deepEqual(codeLines('  exact "-- not a comment"'), [true]);
});

test("a goal as Lean writes it: its case, its hypotheses grouped, a long type on lines of its own, a let's value, a conv goal", () => {
  const g = parsePlainGoal("case mk.mk\nx✝¹ y✝¹ x✝ y✝ : Nat\nh : { x := x✝¹, y := y✝¹ }.x = { x := x✝, y := y✝ }.x\n⊢ { x := x✝¹, y := y✝¹ } = { x := x✝, y := y✝ }");
  assert.equal(g.case, "mk.mk");
  assert.deepEqual(g.hyps.map((h) => h.names), [["x✝¹", "y✝¹", "x✝", "y✝"], ["h"]]);
  assert.equal(g.hyps[1].type, "{ x := x✝¹, y := y✝¹ }.x = { x := x✝, y := y✝ }.x", "a structure's := is no let's");
  assert.equal(g.type, "{ x := x✝¹, y := y✝¹ } = { x := x✝, y := y✝ }");
  assert.equal(g.prefix, "⊢ ");
  const long = parsePlainGoal("p : Point\nh :\n  a_very_long_name =\n    another\n⊢ p.x ≤\n  p.size");
  assert.deepEqual(long.hyps[1], { names: ["h"], type: "a_very_long_name =\n    another" });
  assert.equal(long.type, "p.x ≤\n  p.size");
  const lets = parsePlainGoal("n : Nat := 5\nf : Nat → Nat := fun x => x\n⊢ f n = 5");
  assert.deepEqual(lets.hyps, [{ names: ["n"], type: "Nat", val: "5" }, { names: ["f"], type: "Nat → Nat", val: "fun x => x" }]);
  const conv = parsePlainGoal("a b : Nat\n| a + b");
  assert.deepEqual([conv.prefix, conv.type], ["| ", "a + b"]);
  // written back as Lean wrote it
  for (const s of ["case h\na b : Nat\n⊢ a = b", "n : Nat := 5\n⊢ n = 5", "⊢ True"]) assert.equal(goalText(parsePlainGoal(s)), s);
  assert.equal(flatten(["a ", { k: 0, t: ["b", { k: 1, t: "c", d: "willChange" }] }, " d"]), "a bc d");
});

test("Lean's interactive goals read: each subterm numbered by the reference Lean holds for it, the diff kept, every reference found to release", () => {
  const r = new Reading();
  const goals = readInteractiveGoals(INTERACTIVE, r)!;
  assert.equal(goals.length, 1);
  const g = goals[0];
  assert.deepEqual(g.hyps.map((h) => [h.names, h.d ?? null]), [[["a", "b"], "removed"], [["h"], null]]);
  assert.deepEqual(g.type, { k: 5, t: [{ k: 3, t: "a", d: "willChange" }, " = ", { k: 4, t: "b" }] });
  assert.deepEqual(r.refs.map((x) => x.p), ["0", "4", "1", "13", "14", "12"], "numbered as read, a subterm before what holds it");
  assert.equal(g.prefix, "⊢ ");
  // what an answer holds, all of it: the goals' contexts too
  assert.deepEqual(refsIn(INTERACTIVE).map((x) => x.p).sort(), ["0", "1", "12", "13", "14", "15", "4"]);
  const t = readInteractiveTermGoal(TERM, new Reading())!;
  assert.deepEqual(t.range, [12, 46, 12, 66]);
  assert.deepEqual(t.hyps.map((h) => h.names), [["p"]]);
  // none there, or not Lean's shape
  assert.equal(readInteractiveGoals(null, new Reading()), null);
  assert.equal(readInteractiveTermGoal({ type: {} }, new Reading()), null);
  assert.equal(readWidgets({ widgets: [{ id: "hello", javascriptHash: "1", props: {} }] }), 1);
  assert.equal(readWidgets(null), 0);
  assert.deepEqual(readInfo({ type: { text: "Prop" }, exprExplicit: { append: [{ text: "@Eq " }, { tag: [{ info: { p: "9" } }, { text: "Nat" }] }] }, doc: "The equality relation." }), { expr: "@Eq Nat", type: "Prop", doc: "The equality relation." });
});

test("Lean's answers are bounded: past the subterms a page tags, text; past the characters it shows, cut", () => {
  const r = new Reading();
  const wide = { append: Array.from({ length: 25_000 }, (_, i) => ({ tag: [{ info: { p: String(i) } }, { text: "x" }] })) };
  r.code(wide);
  assert.equal(r.refs.length, 20_000);
  const big = new Reading();
  const t = big.code({ append: [{ text: "a".repeat(300_000) }, { text: "b".repeat(300_000) }, { text: "c" }] });
  assert.ok(big.cut);
  assert.ok(JSON.stringify(t).length < 410_000);
  // deeper than a page reads tags in: text, read without recursing
  let deep: unknown = { text: "z" };
  for (let i = 0; i < 5000; i++) deep = { tag: [{ info: { p: String(i) } }, deep] };
  const d = new Reading();
  assert.equal(JSON.stringify(d.code(deep)).includes('"z"'), true);
  assert.ok(refsIn(deep).length === 5000);
});

test("Lean's plain answers read: the goals as Lean writes them, the term's expected type with its range", () => {
  const goals = readPlainGoals({ goals: ["case mk\nb : Point\nx✝ y✝ : Nat\n⊢ { x := x✝, y := y✝ } = b"], rendered: "…" })!;
  assert.equal(goals[0].case, "mk");
  assert.deepEqual(goals[0].hyps.map((h) => h.names), [["b"], ["x✝", "y✝"]]);
  assert.deepEqual(readPlainGoals({ goals: [], rendered: "no goals" }), []);
  assert.equal(readPlainGoals(null), null);
  const t = readPlainTermGoal({ goal: "p : Point\n⊢ p.x ≤ p.size", range: { start: { line: 12, character: 46 }, end: { line: 12, character: 66 } } })!;
  assert.equal(t.type, "p.x ≤ p.size");
  assert.deepEqual(t.range, [12, 46, 12, 66]);
  assert.equal(readPlainTermGoal({ goal: "⊢ Nat" }), null, "no range: not Lean's answer");
});
