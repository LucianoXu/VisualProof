// The InfoView's pane (web/src/infoview.ts; ReviewSpec, "The InfoView"): what it shows from what is
// known at the caret, the goals drawn as code with their subterms numbered, where it stands, a place
// of the code as the file's line and column.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { GoalsAnswer } from "../src/shared/goals.ts";
import { readInteractiveGoals, readInteractiveTermGoal, Reading } from "../src/server/goals.ts";
import { INTERACTIVE, TERM } from "./leananswers.ts";
import { caretOf, goalHtml, paneSide, paneView, subtermHtml, taggedHtml } from "../src/web/src/infoview.ts";

const resolve = (w: string) => ({ Point: "Fixture.Point", size: null, b: "Fixture.b" })[w] ?? null;

test("a goal drawn as code: Lean's highlighting, names linked as in the source but the goal's own, each subterm numbered", () => {
  const goals = readInteractiveGoals(INTERACTIVE, new Reading())!;
  const html = goalHtml(goals[0], resolve);
  assert.match(html, /data-ref="Fixture\.Point"/, "a declaration's name links to the board");
  assert.ok(!html.includes('data-ref="Fixture.b"'), "a hypothesis' name is the goal's own, whatever the board holds");
  assert.match(html, /<span class="iv-t iv-willChange" data-k="3">a<\/span>/);
  assert.match(html, /class="iv-hyp iv-removed"/);
  assert.match(html, /<span class="iv-turn">⊢<\/span>/);
  assert.equal(taggedHtml("x < y", () => null), "x &lt; y");
  assert.match(taggedHtml(["fun ", { k: 0, t: "x" }], () => null), /tk-keyword/);
  assert.match(subtermHtml({ expr: "a = b", type: "Prop", doc: "The *equality*." }, () => null), /<pre class="code">a = b : <span class="tk-keyword">Prop<\/span><\/pre><hr><p>The <em>equality<\/em>.<\/p>/);
});

test("the pane: hidden without a caret and where Lean has nothing there; else why not, how far Lean is, or the goals and the expected type", () => {
  const caret = { line: 26, ch: 47, after: false };
  assert.equal(paneView(null, null, null, resolve).show, false);
  assert.match(paneView(caret, "A past build has no InfoView: Lean knows only the latest build.", null, resolve).html, /past build/);
  assert.match(paneView(caret, null, null, resolve).html, /Asking Lean/);
  assert.match(paneView(caret, null, { pending: { line: 120, of: 800 } }, resolve).html, /Lean has elaborated line 120 of 800/);
  assert.match(paneView(caret, null, { error: "Lean stopped" }, resolve).html, /iv-err.*Lean stopped/);
  assert.match(paneView(caret, null, { off: "This file has changed since it was compiled" }, resolve).html, /changed since/);
  // not in a proof, nor a term with an expected type: hidden
  assert.equal(paneView(caret, null, { tactic: null, before: null, after: null, term: null, interactive: true }, resolve).show, false);
  const a: GoalsAnswer = { tactic: { line: 26, from: 47, to: 54 }, before: readInteractiveGoals(INTERACTIVE, new Reading()), after: [], term: null, interactive: true };
  const before = paneView(caret, null, a, resolve);
  assert.ok(before.show && before.sides);
  assert.match(before.html, /1 goal/);
  const after = paneView({ ...caret, after: true }, null, a, resolve);
  assert.match(after.html, /No goals/);
  // a term: its expected type, with what is in scope where there is no goal
  const term = paneView(caret, null, { tactic: null, before: null, after: null, term: readInteractiveTermGoal(TERM, new Reading()), interactive: true }, resolve);
  assert.ok(term.show && !term.sides);
  assert.match(term.html, /Expected type/);
  assert.match(term.html, /iv-names">p</);
  // a widget: said, never drawn
  const w = paneView(caret, null, { tactic: null, before: null, after: null, term: null, widgets: 2 }, resolve);
  assert.ok(w.show);
  assert.match(w.html, /A widget here: open it in your editor\./);
  assert.ok(!/<script|<iframe/.test(w.html));
});

test("the pane stands beside the code in a wide window, a window fitted to its code growing to make room; below it in a narrow one and on a phone", () => {
  assert.equal(paneSide(900, false, 1440), true);
  assert.equal(paneSide(600, false, 1440), false, "a window the reader made narrow");
  assert.equal(paneSide(600, true, 1440), true, "fitted, it grows by the pane");
  assert.equal(paneSide(390, false, 390), false, "a phone");
  assert.equal(paneSide(800, true, 820), true, "a tablet, wide enough");
  assert.equal(paneSide(560, true, 820), false);
});

test("a place of the code on show is a line and a UTF-16 column, as Lean counts", () => {
  const text = "theorem t : P := by\n  simp [ℤ]\n  ring";
  assert.deepEqual(caretOf(text, 0), { line: 0, ch: 0 });
  assert.deepEqual(caretOf(text, text.indexOf("simp")), { line: 1, ch: 2 });
  assert.deepEqual(caretOf(text, text.indexOf("]")), { line: 1, ch: 9 });
  assert.deepEqual(caretOf(text, text.length + 5), { line: 2, ch: 6 }, "past the end: its end");
  // a character outside the BMP counts two, as in the page's text and Lean's positions
  assert.deepEqual(caretOf("𝔽 x", 3), { line: 0, ch: 3 });
});
