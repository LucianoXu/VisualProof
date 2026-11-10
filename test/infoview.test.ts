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
import { caretOf, CODE_MIN, goalHtml, InfoView, PANE_MIN, PANE_W, paneSide, paneView, paneWidth, placeIn, subtermHtml, taggedHtml } from "../src/web/src/infoview.ts";
import type { InfoCode, InfoHooks } from "../src/web/src/infoview.ts";
import { chunksOf } from "../src/web/src/filemode.ts";
import { tacticSpan } from "../src/shared/goals.ts";
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

test("beside the code, the pane is as wide as the reader made it: its own width where they did not, never under its least, and leaving the code its room", () => {
  assert.equal(paneWidth(null, 1200), PANE_W);
  assert.equal(paneWidth(520, 1200), 520);
  assert.equal(paneWidth(431.6, 1200), 432, "whole pixels");
  assert.equal(paneWidth(100, 1200), PANE_MIN);
  // a window that leaves the code too little: the reader's width gives way, down to the least
  assert.equal(paneWidth(700, 900), 900 - CODE_MIN);
  assert.equal(paneWidth(700, 400), PANE_MIN);
  // what an older page or another hand kept is read with care
  assert.equal(paneWidth(Number.NaN, 1200), PANE_W);
  assert.equal(paneWidth(Infinity, 1200), PANE_W);
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

/** A file as File mode shows it (the owner's decisions of 2026-11-08, 0.11: the InfoView about the
 *  whole file): two declarations with tactic proofs, lines between them. Lines from 0 in the
 *  comments. */
const WHOLE = [
  "import Fixture.Basic", //                                                          0
  "", //                                                                              1
  "namespace Fixture", //                                                             2
  "", //                                                                              3
  "/-- A proof left open. -/", //                                                     4
  "theorem size_succ_pos (p : Point) : 0 < p.size + 1 := by sorry", //               5
  "", //                                                                              6
  "/-- Through `size_comm`. -/", //                                                   7
  "theorem size_twice (p : Point) : p.size + p.size = p.size + (p.y + p.x) := by", // 8
  "  rw [← size_comm]", //                                                            9
  "  -- done", //                                                                    10
  "", //                                                                             11
  "def succSize (p : Point) : Nat := p.size + 1", //                                 12
  "", //                                                                             13
  "end Fixture", //                                                                  14
].join("\n");
const WHOLE_LINES = WHOLE.split("\n");
/** its declarations, as File mode finds them, with their docstrings */
const WHOLE_DECLS = [
  { i: 0, start: 4, end: 5, head: 5 },
  { i: 1, start: 7, end: 10, head: 8 },
  { i: 2, start: 12, end: 12, head: 12 },
];

test("a caret anywhere in File mode's file is a place of the file, each piece counting from its own first line: Lean is asked there, at the tactic on that line", () => {
  // drawn in pieces of at most four lines between the declarations (web/src/filemode.ts)
  const chunks = chunksOf(WHOLE_DECLS, WHOLE_LINES.length, 4);
  assert.deepEqual(chunks.map((c) => [c.start, c.end]), [[0, 3], [4, 5], [6, 6], [7, 10], [11, 11], [12, 12], [13, 14]]);
  /** a click on `mark` (its `from`-th occurrence in the file): the piece it is in, and the place its
   *  offset in that piece's text gives */
  const click = (mark: string, from = 0) => {
    const at = WHOLE.indexOf(mark, from);
    const { line } = caretOf(WHOLE, at);
    const c = chunks.find((x) => x.start <= line && line <= x.end)!;
    const text = WHOLE_LINES.slice(c.start, c.end + 1).join("\n");
    const offset = at - WHOLE_LINES.slice(0, c.start).join("\n").length - (c.start ? 1 : 0);
    return placeIn(c.start, text, offset);
  };
  for (const [mark, line, tactic] of [
    ["sorry", 5, "sorry"],
    ["rw [", 9, "rw [← size_comm]"],
    ["size_comm]", 9, "rw [← size_comm]"],
  ] as const) {
    const p = click(mark);
    assert.deepEqual(p, caretOf(WHOLE, WHOLE.indexOf(mark)), `${mark}: the piece's place is the file's`);
    assert.equal(p.line, line);
    const s = tacticSpan(WHOLE_LINES[p.line], p.ch)!;
    assert.equal(WHOLE_LINES[p.line].slice(s.from, s.to), tactic, mark);
  }
  // between declarations, and in a declaration of no proof: places of the file too, where Lean says
  // nothing (the pane hidden)
  assert.deepEqual(click("namespace"), { line: 2, ch: 0 });
  assert.deepEqual(click("p.size + 1", WHOLE.indexOf("def succSize")), { line: 12, ch: 34 });
  // Declaration mode's one block, from the declaration's first line, gives the same places
  const decl = WHOLE_LINES.slice(7, 11).join("\n");
  assert.deepEqual(placeIn(7, decl, decl.indexOf("size_comm]")), click("size_comm]"));
});

/** The InfoView driven without a browser: no pane drawn, the questions it asks Lean recorded. */
function infoView() {
  const asked: string[] = [];
  const revealed: string[] = [];
  let moved = 0;
  const hooks: InfoHooks = {
    goals: async (module, line, ch, hash) => (asked.push(`${module}:${line}:${ch}:${hash}`), { tactic: null, before: [], after: [], term: null, interactive: true }),
    subterm: async () => null,
    resolve: () => null,
    cards: {} as InfoHooks["cards"],
    card: () => ({ html: "" }),
    hidden: () => false,
    hide: () => {},
    width: () => null,
    setWidth: () => {},
    moved: () => void moved++,
    win: () => ({ querySelectorAll: () => [] }) as unknown as HTMLElement,
    fitted: () => true,
    stale: () => {},
    reveal: (line, ch) => void revealed.push(`${line}:${ch}`),
  };
  const iv = new InfoView(hooks);
  return { iv, asked, revealed, moves: () => moved };
}

test("File mode's InfoView is about the whole file: a caret in any declaration's proof or between them asked of Lean, ↑ and ↓ stepping on through the file, a followed caret anywhere in it; a caret goes with its file", async () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const { iv, asked, revealed, moves } = infoView();
  try {
    const file: InfoCode = { module: "Fixture.Axioms", start: 0, text: WHOLE, hash: "h1", off: null };
    iv.attach(null, null, file);
    // a caret in one declaration's proof, then in another's further down, then between them
    iv.place(5, 58);
    iv.place(9, 2);
    iv.place(2, 0);
    await tick();
    assert.deepEqual(asked, ["Fixture.Axioms:5:58:h1", "Fixture.Axioms:9:2:h1", "Fixture.Axioms:2:0:h1"]);
    assert.equal(moves(), 3, "those following are told each time");
    // ↓ and ↑ step through the file, past comments and blank lines, from one declaration to the next
    iv.place(9, 2);
    assert.equal(iv.step(1), true);
    assert.deepEqual(iv.caret, { line: 12, ch: 0, after: false }, "past the comment and the blank line, into the next declaration");
    assert.equal(iv.step(-1), true);
    assert.deepEqual(iv.caret, { line: 9, ch: 2, after: false });
    assert.equal(iv.step(-1), true);
    assert.deepEqual(iv.caret, { line: 8, ch: 0, after: false });
    assert.deepEqual(revealed, ["12:0", "9:2", "8:0"], "the window shows each place stepped to");
    // the last line of code: nothing further
    iv.place(14, 0);
    assert.equal(iv.step(1), false);
    // a followed reader's caret, anywhere in the file: asked, shown, nobody told
    const told = moves();
    asked.length = 0;
    iv.follow({ line: 5, ch: 58, after: true });
    await tick();
    assert.deepEqual(asked, ["Fixture.Axioms:5:58:h1"]);
    assert.equal(revealed.at(-1), "5:58");
    assert.equal(moves(), told);
    // Declaration mode on the same file, then File mode again: the caret stays where it is held
    iv.attach(null, null, { ...file, start: 4, text: WHOLE_LINES.slice(4, 6).join("\n") });
    assert.deepEqual(iv.caret, { line: 5, ch: 58, after: true });
    iv.attach(null, null, { ...file, start: 7, text: WHOLE_LINES.slice(7, 11).join("\n") });
    assert.equal(iv.caret, null, "another declaration's lines do not hold it");
    // another file: a caret placed in this one goes as the window turns to it — line 9 of the next
    // file is a place nobody clicked
    iv.attach(null, null, file);
    iv.place(9, 2);
    asked.length = 0;
    iv.leave("Fixture.Use");
    assert.equal(iv.caret, null);
    iv.attach(null, null, { module: "Fixture.Use", start: 0, text: WHOLE, hash: "h2", off: null });
    await tick();
    assert.deepEqual(asked, [], "nothing asked of the new file");
    // as it does where the window tells another file's code without turning first
    iv.place(9, 2);
    iv.attach(null, null, file);
    assert.equal(iv.caret, null);
    // a followed caret told while the window reads the next file waits for its code, and is asked there
    iv.leave("Fixture.Use");
    asked.length = 0;
    iv.follow({ line: 9, ch: 2, after: false });
    await tick();
    assert.deepEqual(asked, [], "no code yet: nothing asked of the file before");
    iv.attach(null, null, { module: "Fixture.Use", start: 0, text: WHOLE, hash: "h2", off: null });
    await tick();
    assert.deepEqual(asked, ["Fixture.Use:9:2:h2"]);
    // turning to the same file keeps it
    iv.leave("Fixture.Use");
    assert.deepEqual(iv.caret, { line: 9, ch: 2, after: false });
  } finally {
    iv.dispose();
  }
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
  // in a file window, which has no declaration of its own: by its file (the owner's decisions of
  // 2026-11-08, 0.11), always pinned
  const inFile = { file: "FltRegular.CaseI.Statement", line: 231, character: 2 };
  assert.deepEqual(cleanView({ ...base, caret: inFile })!.caret, inFile);
  assert.deepEqual(cleanView({ ...base, caret: { ...inFile, pinned: true, after: true } })!.caret, { ...inFile, after: true });
  assert.deepEqual(cleanView({ ...base, caret: { ...inFile, decl: "A.b" } })!.caret, { decl: "A.b", line: 231, character: 2 }, "a declaration's window, where both are said");
  for (const bad of [{ ...inFile, file: "" }, { ...inFile, file: 4 }, { ...inFile, file: "x".repeat(301) }]) assert.equal(cleanView({ ...base, caret: bad })!.caret, undefined, JSON.stringify(bad));
  // a share link carries it, and its opener's page takes it once
  const snap = await writeSnapshot({ ...base, caret }, null);
  assert.deepEqual((await readSnapshot(snap, null))!.view.caret, caret);
  const fileSnap = await writeSnapshot({ ...base, caret: inFile }, null);
  assert.deepEqual((await readSnapshot(fileSnap, null))!.view.caret, inFile);
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
