// The InfoView's pane (web/src/infoview.ts; ReviewSpec, "The InfoView"): what it shows from what is
// known at the caret, the goals drawn as code with their subterms numbered, where it stands, a place
// of the code as the file's line and column; and the caret followed (CollabSpec, "Surfaces": caret)
// — carried by presence and a share link, checked as the server checks a heartbeat, a press on
// Before or After ending following and hiding the pane not.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanView } from "../src/shared/collab.ts";
import type { PresenceView } from "../src/shared/collab.ts";
import type { GoalsAnswer } from "../src/shared/goals.ts";
import { readSnapshot, writeSnapshot } from "../src/shared/sharesnap.ts";
import { readInteractiveGoals, readInteractiveTermGoal, Reading } from "../src/server/goals.ts";
import { INTERACTIVE, TERM } from "./leananswers.ts";
import { caretOf, goalHtml, paneSide, paneView, subtermHtml, taggedHtml } from "../src/web/src/infoview.ts";
import { afterClick } from "../src/web/src/hovercards.ts";
import { keyActs, pressActs } from "../src/web/src/surfaces.ts";
import type { PageEl } from "../src/web/src/surfaces.ts";

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

/** An element of the page as the rule reads it (test/surfaces.test.ts). */
const at = (...chain: string[]): PageEl | null =>
  chain.reduce<PageEl | null>((parentElement, own) => {
    const mine = own.split("|");
    return { matches: (sel: string) => sel.split(",").some((s) => mine.includes(s.trim())), parentElement };
  }, null);

test("the caret is followed: carried by presence and a share link as the server checks it; Before or After ends following, hiding the pane and reading do not", async () => {
  const base: PresenceView = { mode: "tcb", sel: "A.b", source: true, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };
  const caret = { decl: "FltRegular.p_dvd_c_of_ab_of_anegc", line: 49, character: 2, after: true as const };
  assert.deepEqual(cleanView({ ...base, caret })!.caret, caret);
  assert.deepEqual(cleanView({ ...base, caret: { ...caret, after: "yes", pinned: true } })!.caret, { decl: caret.decl, line: 49, character: 2, pinned: true });
  for (const bad of [{ ...caret, line: -1 }, { ...caret, character: 1.5 }, { ...caret, decl: 5 }, { ...caret, line: 1e9 }, "here"]) assert.equal(cleanView({ ...base, caret: bad })!.caret, undefined, JSON.stringify(bad));
  // a share link carries it, and its opener's page takes it once
  const snap = await writeSnapshot({ ...base, caret }, null);
  assert.deepEqual((await readSnapshot(snap, null))!.view.caret, caret);
  // Before and After change it; the pane's text is read; hiding it is the reader's own
  assert.equal(pressActs(at(".sw-win", ".sw-info", ".sw-info [data-iv-when]")), true);
  assert.equal(pressActs(at(".sw-win", ".sw-info")), false, "the goals read, selected");
  assert.equal(pressActs(at(".sw-win", ".sw-info", "[data-iv-hide]")), false);
  assert.equal(pressActs(at(".sw-win", "[data-iv-show]")), false);
  assert.equal(pressActs(at(".sw-win", "pre")), false, "a click in the code is reading, while following");
  // ↑ and ↓ step it: no page's key, they end following as a key does
  assert.equal(keyActs({ key: "ArrowDown" }, at(".sw-win"), false), true);
});

test("a click into the code shows no card for the word it landed on, until the pointer is on another word; a rest there brings none", () => {
  // no click: every word its card
  assert.deepEqual(afterClick("", "12:4"), { show: true, clicked: "" });
  // the word clicked into, rested on or moved within: quiet
  assert.deepEqual(afterClick("12:4", "12:4"), { show: false, clicked: "12:4" });
  // another word: its card, and the clicked one is forgotten
  assert.deepEqual(afterClick("12:4", "12:9"), { show: true, clicked: "" });
  assert.deepEqual(afterClick("", "12:4"), { show: true, clicked: "" }, "back on it: its card again");
});
