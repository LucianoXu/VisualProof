// The review (ReviewSpec.md): opinions bound to versions, summaries, trust. Its storage, the logs in
// the site's folder, is test/reviewlog.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { adviceOf, byName, covers, current, DEFAULT_TRUSTED, emptyReview, invalid, judgedOn, markOf, MAX_TEXT, OUTSIDE, prefixLabel, progressOf, readEvent, record, reviewFromJson, statusOf, trusted, trustedBy, validPrefix, VERDICT_ORDER } from "../src/shared/review.ts";
import type { ReviewOp } from "../src/shared/review.ts";
import { tcbDiff } from "../src/shared/timeline.ts";
import type { ViewMeta } from "../src/shared/graph.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { ReviewBox } from "../src/web/src/reviewbox.ts";
import type { ReviewHooks } from "../src/web/src/reviewbox.ts";

const at = (k: number) => `2026-10-06T12:00:0${k}Z`;

test("a declaration's status sums up the reviewers' latest opinions on its present version", () => {
  const d = emptyReview();
  const say = (op: ReviewOp, k: number) => record(d, op, "lean4:v4", at(k));
  assert.equal(statusOf(d, "X", "h1"), "none");
  say({ op: "opinion", name: "X", by: "Alice", verdict: "approve", hash: "h1" }, 1);
  assert.equal(statusOf(d, "X", "h1"), "approved");
  // the declaration changed: the opinion is about another version
  assert.equal(statusOf(d, "X", "h2"), "stale");
  // a comment on the present version is shown ahead of an approval
  say({ op: "opinion", name: "X", by: "Bob", verdict: "comment", comment: "wrong modulus", hash: "h1" }, 2);
  assert.equal(statusOf(d, "X", "h1"), "commented");
  // Bob changes his mind: his approval replaces his comment
  say({ op: "opinion", name: "X", by: "Bob", verdict: "approve", hash: "h1" }, 3);
  assert.equal(statusOf(d, "X", "h1"), "approved");
  assert.equal(current(d, "X").length, 2);
  // everything is kept
  assert.equal(d.opinions.X.length, 3);
});

test("approve or comment (2026-10-09): a comment needs text, is shown ahead of an approval, in one order every summary reads; dispute is no verdict", () => {
  assert.deepEqual(VERDICT_ORDER, ["comment", "approve"], "the owner's default: a comment ahead of an approval");
  const d = emptyReview();
  const say = (by: string, verdict: "approve" | "comment", agent = false, k = 1) =>
    record(d, { op: "opinion", name: "X", by, verdict, ...(verdict === "comment" ? { comment: "Is n the bound or the length?" } : {}), hash: "h1", ...(agent ? { agent } : {}) } as ReviewOp, "tc", at(k));
  // the event and the opinion carry the verdict as given, and its text
  const e = say("Bob", "comment");
  assert.deepEqual([e.op, e.op === "opinion" && e.verdict, e.op === "opinion" && e.comment], ["opinion", "comment", "Is n the bound or the length?"]);
  say("Alice", "approve", false, 2);
  assert.equal(statusOf(d, "X", "h1"), "commented", "a reviewer's comment is not hidden by another's approval");
  assert.equal(markOf(d, "X", "M", false, "h1"), "commented");
  assert.deepEqual(progressOf(d, [{ name: "X", module: "M", ext: false, hash: "h1" }]), { total: 1, approved: 0, commented: 1, stale: 0 });
  assert.equal(statusOf(d, "X", "h2"), "stale", "a comment on an earlier version is stale like an approval");
  // agents' advice is summed up in the same order
  say("Claude", "approve", true, 3);
  assert.equal(adviceOf(d, "X", "h1"), "approve");
  say("Robot", "comment", true, 4);
  assert.equal(adviceOf(d, "X", "h1"), "comment");
  // a comment needs text; "dispute" is no verdict any more, in a request or in a log
  assert.equal(invalid({ op: "opinion", name: "X", by: "Alice", verdict: "comment", comment: "  " }), "a comment needs text");
  assert.equal(invalid({ op: "opinion", name: "X", by: "Alice", verdict: "comment", comment: "why?" }), null);
  assert.equal(invalid({ op: "opinion", name: "X", by: "Alice", verdict: "dispute", comment: "wrong" }), "verdict");
  const line = { op: "opinion", name: "X", by: "Alice", verdict: "comment", comment: "why?", at: at(5) };
  assert.equal(typeof readEvent(line, false), "object");
  assert.equal(readEvent({ ...line, verdict: "dispute" }, false), "verdict", "an old line is a line that cannot be read");
  assert.equal(readEvent({ ...line, verdict: "dispute", agent: true }, true), "verdict", "an agent's too");
});

test("what needs review: the project's declarations and untrusted externals; not the standard axioms", () => {
  const d = emptyReview();
  assert.equal(trusted(d, "Mathlib.Foo", "Mathlib.Algebra.Group", true), true);
  assert.equal(trusted(d, "Init.x", "Init", true), true);
  assert.equal(trusted(d, "Other.y", "SomeLib.Z", true), false);
  assert.equal(trusted(d, "MathlibLike.y", "MathlibLike.Z", true), false, "a prefix is a module path, not a string prefix");
  assert.equal(trusted(d, "Mine.z", "Mine.Z", false), false);
  assert.equal(trusted(d, "Classical.choice", "Init.Core", true), true);
  assert.equal(trusted(d, "Classical.choice", "Mine.Core", false), true, "a standard axiom, wherever it is");
  const p = progressOf(d, [
    { name: "A", module: "M", ext: false, hash: "a" },
    { name: "B", module: "M", ext: false, hash: "b" },
    { name: "Mathlib.C", module: "Mathlib.X", ext: true },
  ]);
  assert.deepEqual(p, { total: 2, approved: 0, commented: 0, stale: 0 });
});

test("a trusted prefix covers the project's declarations by module or name, the outside world's by module", () => {
  const d = emptyReview();
  const say = (prefix: string, on: boolean) => record(d, { op: "trust", prefix, by: "Alice", on }, "lean4:v4", at(1));
  say("Vendored", true);
  say("Lib.Algebra", true);
  // a vendored library, by its files: whatever namespaces it extends
  assert.equal(trusted(d, "Equiv.Perm.cycleType_x", "Vendored.GroupTheory.Perm", false), true);
  assert.equal(trusted(d, "Vendored.Rep.x", "Vendored", false), true, "the module itself");
  // a layer reviewed on its own, by its namespace: wherever it is declared
  assert.equal(trusted(d, "Lib.Algebra.Group.H", "Lib.Order.Helpers", false), true);
  assert.equal(trusted(d, "Lib.Algebra", "Lib.Basic", false), true, "the prefix itself");
  // a whole component at a time
  assert.equal(trusted(d, "Lib.Algebraic.Run", "Lib.Algebraic.Semantics", false), false);
  assert.equal(trusted(d, "VendoredX.y", "VendoredX", false), false);
  // outside the project, a name says nothing of where it comes from: by module only, as before
  assert.equal(trusted(d, "Lib.Algebra.ext", "OtherLib.X", true), false);
  assert.equal(trusted(d, "Nat.foo", "Vendored.X", true), true);
  assert.deepEqual(trustedBy(d, "Lib.Algebra.Group.H", "Vendored.A", false), ["Lib.Algebra", "Vendored"], "every prefix that covers it, in order");
  assert.deepEqual(trustedBy(d, "A.b", "A", false), []);
  // what the canvas and the lists mark: opinions first, then trust, for the project's own only
  assert.equal(markOf(d, "Vendored.Rep.x", "Vendored", false, "h"), "trusted");
  assert.equal(markOf(d, "Mathlib.C", "Mathlib.X", true, undefined), "none", "the outside world trusted by default is not news");
  assert.equal(markOf(d, "A.b", "A", false, "h"), "none");
  record(d, { op: "opinion", name: "Vendored.Rep.x", by: "Bob", verdict: "comment", comment: "wrong", hash: "h" }, "lean4:v4", at(2));
  assert.equal(markOf(d, "Vendored.Rep.x", "Vendored", false, "h"), "commented", "an opinion on a trusted declaration still shows");
  // progress counts what is left: trusted declarations are not counted, whatever was said of them
  const members = [
    { name: "T.main", module: "T", ext: false, hash: "t" },
    { name: "Lib.Algebra.Group.H", module: "Lib.Algebra.Lib", ext: false, hash: "a" },
    { name: "Vendored.Rep.x", module: "Vendored", ext: false, hash: "h" },
    { name: "Mathlib.C", module: "Mathlib.X", ext: true },
  ];
  assert.deepEqual(progressOf(d, members), { total: 1, approved: 0, commented: 0, stale: 0 });
  say("Vendored", false);
  assert.deepEqual(progressOf(d, members), { total: 2, approved: 0, commented: 1, stale: 0 }, "no longer trusted: counted again, with its opinions");
  // a name with the name of an object's own property is a declaration like any other
  assert.equal(statusOf(d, "constructor", "h"), "none");
  assert.equal(markOf(d, "toString", "M", false, "h"), "none");
});

test("trusting is recorded in the review's list: sorted, once each, and read back as it was", () => {
  const d = emptyReview();
  const say = (prefix: string, on: boolean) => record(d, { op: "trust", prefix, by: "Alice", on }, "lean4:v4", at(1));
  say("Vendored", true);
  say("Lib.Algebra", true);
  say("Vendored", true);
  assert.deepEqual(d.trusted, ["Batteries", "Init", "Lean", "Lib.Algebra", "Mathlib", "Std", "Vendored"]);
  say("Mathlib", false);
  say("Nowhere", false);
  assert.deepEqual(d.trusted, ["Batteries", "Init", "Lean", "Lib.Algebra", "Std", "Vendored"], "a default can be taken off; what is not there stays not there");
  // the review as JSON carries it to a page: the same list; without one, the defaults
  assert.deepEqual(reviewFromJson(JSON.parse(JSON.stringify(d))).trusted, d.trusted, "still a list of strings");
  assert.deepEqual(reviewFromJson({ version: 1, targets: {}, opinions: {} }).trusted, DEFAULT_TRUSTED);
  assert.deepEqual(reviewFromJson({ version: 1, trusted: ["Std", "Init", "Std", 3] }).trusted, ["Init", "Std"]);
});

test("requests are checked before anything is written", () => {
  assert.equal(invalid({ op: "opinion", name: "X", by: "Alice", verdict: "approve" }), null);
  assert.ok(invalid({ op: "opinion", name: "X", by: "Alice", verdict: "comment" }), "a comment needs text");
  assert.ok(invalid({ op: "opinion", name: "X", by: "  ", verdict: "approve" }), "a reviewer has a name");
  assert.ok(invalid({ op: "opinion", name: "X", by: "Alice", verdict: "maybe" }));
  assert.ok(invalid({ op: "opinion", name: "X", by: "Alice", verdict: "withdraw" }), "a new opinion replaces an old one; nothing is withdrawn");
  assert.ok(invalid({ op: "delete-everything" }));
  assert.equal(invalid({ op: "checkpoint", name: "T", by: "Alice", tcb: {} }), "op", "checkpoints were removed (2026-10-09)");
  assert.equal(invalid({ op: "target", name: "T", by: "Alice", on: true }), null);
  // a trusted prefix is a dotted name and nothing else
  assert.equal(invalid({ op: "trust", prefix: "Lib.Algebra", by: "Alice", on: true }), null);
  assert.equal(invalid({ op: "trust", prefix: "Vendored", by: "Alice", on: false }), null);
  assert.equal(invalid({ op: "trust", prefix: "A.«b c».d", by: "Alice", on: true }), null);
  for (const prefix of ["", "Foo.", ".Foo", "Foo..Bar", "Foo Bar", "Foo\nimport X", "⟨external⟩.Mathlib", "A".repeat(201), 3, undefined])
    assert.ok(invalid({ op: "trust", prefix, by: "Alice", on: true }), `prefix ${JSON.stringify(prefix)}`);
  assert.ok(invalid({ op: "trust", prefix: "Foo", by: "Alice", on: "yes" }), "on or off");
  assert.ok(invalid({ op: "trust", prefix: "Foo", by: " ", on: true }), "a reviewer has a name");
});

test("an opinion's text is bounded: a text or a statement, not both", () => {
  const base = { op: "opinion", name: "X", by: "Alice", verdict: "approve", hash: "h" };
  assert.equal(invalid({ ...base, text: "def x := 1" }), null);
  assert.equal(invalid({ ...base, statement: "ℕ" }), null);
  assert.equal(invalid({ ...base, text: "a".repeat(MAX_TEXT) }), null);
  assert.ok(invalid({ ...base, text: "a".repeat(MAX_TEXT + 1) }));
  assert.ok(invalid({ ...base, statement: "a".repeat(MAX_TEXT + 1) }));
  assert.ok(invalid({ ...base, text: 3 }));
  assert.ok(invalid({ ...base, text: "" }));
  assert.ok(invalid({ ...base, text: "def x := 1", statement: "ℕ" }));
});

test("an opinion records the text it was given on, once per version and text", () => {
  const d = emptyReview();
  const say = (op: Omit<Extract<ReviewOp, { op: "opinion" }>, "op" | "name">, k: number) => {
    record(d, { op: "opinion", name: "X", ...op }, "tc", at(k));
    return d.opinions.X[d.opinions.X.length - 1];
  };
  const v1 = "def x : Nat :=\n  1";
  const a1 = say({ by: "Alice", verdict: "approve", hash: "h1", text: v1 }, 1);
  assert.equal(a1.text, v1);
  assert.deepEqual(judgedOn(d, "X", a1), { of: "source", text: v1 });
  // Alice changes her mind on the same version and text: the text is not stored again, but read back
  const a2 = say({ by: "Alice", verdict: "comment", comment: "should be 2", hash: "h1", text: v1 }, 2);
  assert.equal(a2.text, undefined);
  assert.deepEqual(judgedOn(d, "X", a2), { of: "source", text: v1 });
  const a3 = say({ by: "Alice", verdict: "approve", hash: "h1", text: v1 }, 3);
  assert.equal(a3.text, undefined);
  assert.deepEqual(judgedOn(d, "X", a3), { of: "source", text: v1 }, "through a chain of repeats");
  // Bob's opinion on the same text is his own: nothing is borrowed across reviewers
  const b1 = say({ by: "Bob", verdict: "approve", hash: "h1", text: v1 }, 4);
  assert.equal(b1.text, v1);
  // the same version with another text (a proof or a comment changed) is stored
  const v1b = "/-- one -/\ndef x : Nat :=\n  1";
  const a4 = say({ by: "Alice", verdict: "approve", hash: "h1", text: v1b }, 5);
  assert.equal(a4.text, v1b);
  // another version is always stored
  const a5 = say({ by: "Alice", verdict: "approve", hash: "h2", text: v1b }, 6);
  assert.equal(a5.text, v1b);
  // where there was no source, the statement
  const a6 = say({ by: "Alice", verdict: "approve", hash: "h3", statement: "Nat" }, 7);
  assert.deepEqual(judgedOn(d, "X", a6), { of: "statement", text: "Nat" });
  const a7 = say({ by: "Alice", verdict: "approve", hash: "h3", statement: "Nat" }, 8);
  assert.equal(a7.statement, undefined);
  assert.deepEqual(judgedOn(d, "X", a7), { of: "statement", text: "Nat" });
  // an opinion without a hash never goes stale: it keeps no text
  record(d, { op: "opinion", name: "Mathlib.y", by: "Alice", verdict: "approve", text: "theorem y" }, "tc", at(9));
  assert.equal(d.opinions["Mathlib.y"][0].text, undefined);
  // an opinion that recorded no text has none, and its line in the log says nothing of one
  const old = record(d, { op: "opinion", name: "Old", by: "Carol", verdict: "approve", hash: "h0" }, "tc", at(1));
  assert.equal(judgedOn(d, "Old", d.opinions.Old[0]), null);
  assert.ok(!JSON.stringify(old).includes("text"));
});

test("what changed: a line diff with a little context, long unchanged runs collapsed", async () => {
  const { lineDiff } = await import("../src/web/src/linediff.ts");
  const lines = Array.from({ length: 20 }, (_, k) => `line ${k}`);
  // the same text: nothing to show
  assert.deepEqual(lineDiff(lines.join("\n"), lines.join("\n")), { rows: [], added: 0, removed: 0 });
  // other line endings are not a change
  assert.equal(lineDiff("a\r\nb", "a\nb").rows.length, 0);
  // one line changed in the middle: two lines of context each side, the rest collapsed
  const after = [...lines];
  after[10] = "line ten";
  const one = lineDiff(lines.join("\n"), after.join("\n"));
  assert.deepEqual(one, {
    added: 1,
    removed: 1,
    rows: [
      { op: "skip", lines: 8 },
      { op: "same", text: "line 8" },
      { op: "same", text: "line 9" },
      { op: "del", text: "line 10" },
      { op: "add", text: "line ten" },
      { op: "same", text: "line 11" },
      { op: "same", text: "line 12" },
      { op: "skip", lines: 7 },
    ],
  });
  // a longest common subsequence: an insertion and a deletion, not everything rewritten
  assert.deepEqual(lineDiff("a\nb\nc", "a\nx\nb").rows, [
    { op: "same", text: "a" },
    { op: "add", text: "x" },
    { op: "same", text: "b" },
    { op: "del", text: "c" },
  ]);
  // a short gap between two changes stays whole; a long one collapses; one hidden line is shown
  const gap = (n: number) => {
    const a = ["x", ...Array.from({ length: n }, (_, k) => `k${k}`), "y"];
    const b = ["X", ...a.slice(1, -1), "Y"];
    return lineDiff(a.join("\n"), b.join("\n")).rows.map((r) => r.op);
  };
  assert.deepEqual(gap(5), ["del", "add", "same", "same", "same", "same", "same", "del", "add"], "one line between the contexts is shown, not a marker");
  assert.deepEqual(gap(6), ["del", "add", "same", "same", "skip", "same", "same", "del", "add"]);
  // added and removed at the ends, and an empty side
  assert.deepEqual(lineDiff("a", "a\nb").rows, [{ op: "same", text: "a" }, { op: "add", text: "b" }]);
  assert.deepEqual(lineDiff("a\nb", "b").rows, [{ op: "del", text: "a" }, { op: "same", text: "b" }]);
  // too large to compare line by line: still right, shown removed then added
  const big = (tag: string) => Array.from({ length: 2500 }, (_, k) => `${tag}${k}`).join("\n");
  const huge = lineDiff(big("p"), big("q"));
  assert.equal(huge.removed, 2500);
  assert.equal(huge.added, 2500);
  assert.equal(huge.rows[0].op, "del");
  assert.equal(huge.rows[huge.rows.length - 1].op, "add");
});

test("a TCB diff, as the timeline makes it, names what was added, removed and changed", () => {
  assert.deepEqual(tcbDiff({ a: "1", b: "2", c: "3" }, { a: "1", b: "9", d: "4" }), { added: ["d"], removed: ["c"], changed: ["b"] });
  // names that an object has already are names like any
  const then = byName<string>(), now = byName<string>();
  then["toString"] = "1";
  now["constructor"] = "2";
  now["__proto__"] = "3";
  assert.deepEqual(tcbDiff(then, now), { added: ["__proto__", "constructor"], removed: ["toString"], changed: [] });
  assert.deepEqual(tcbDiff({}, now).added, ["__proto__", "constructor"]);
});

test("a declaration's source: its compiled place, or found by name when the file has changed", async () => {
  const { compiledExcerpt, findExcerpt } = await import("../src/shared/excerpt.ts");
  const text = [
    "namespace N",                   // 1
    "",                              // 2
    "/-- The doc. -/",               // 3
    "@[simp]",                       // 4
    "def foo (n : Nat) : Nat :=",    // 5
    "  n + 1",                       // 6
    "",                              // 7
    "theorem foo_pos : 0 < foo 0 := by", // 8
    "  simp [foo]",                  // 9
    "",                              // 10
    "def foo (b : Bool) : Bool := b", // 11 (another foo, in another namespace further down)
    "end N",                         // 12
  ];
  assert.deepEqual(compiledExcerpt(text, [5, 0, 6]), { start: 2, end: 5 }, "doc and attribute included");
  // what is directly above and belongs to it, and nothing that does not: the declaration before
  // (an attribute with more on its line), anything past a blank line, the end of someone else's
  // comment — as a declaration once showed `@[simp] theorem id_apply …` above itself
  const near = [
    "@[simp] theorem id_apply : id 1 = 1 := rfl", // 1
    "",                                            // 2
    "/-- Composition,",                            // 3
    "    in order. -/",                            // 4
    "-- a remark",                                 // 5
    "def comp := 0",                               // 6
    "/-! A section. -/",                           // 7
    "def next := 1",                               // 8
  ];
  assert.deepEqual(compiledExcerpt(near, [6, 0, 6]), { start: 2, end: 5 }, "a whole docstring and a comment, not the theorem past the blank line");
  assert.deepEqual(compiledExcerpt(near, [8, 0, 8]), { start: 7, end: 7 }, "a module comment ending above is not its docstring");
  // the file changed: lines were added above, the old place points elsewhere
  const edited = ["-- a new comment", "", ...text];
  assert.deepEqual(findExcerpt(edited, "N.foo", 5), { start: 4, end: 7 }, "the nearest foo to where it was");
  assert.deepEqual(findExcerpt(edited, "N.foo_pos", 8), { start: 9, end: 10 });
  assert.equal(findExcerpt(edited, "N.gone", 5), null);
  // the text an opinion records, and what a stale one is compared with
  const { declarationText } = await import("../src/shared/excerpt.ts");
  assert.deepEqual(declarationText(text, false, "N.foo", [5, 0, 6, 7]), { text: "/-- The doc. -/\n@[simp]\ndef foo (n : Nat) : Nat :=\n  n + 1", edited: false });
  assert.deepEqual(declarationText(edited, true, "N.foo", [5, 0, 6, 7]), { text: "/-- The doc. -/\n@[simp]\ndef foo (n : Nat) : Nat :=\n  n + 1", edited: true });
  assert.equal(declarationText(edited, true, "N.gone", [5, 0, 6, 7]), null);
});

test("the outside world can be trusted as a whole, and is shown by its words", () => {
  assert.ok(validPrefix(OUTSIDE));
  assert.ok(covers(OUTSIDE, "Nat.add", "Init.Prelude", true));
  assert.ok(covers(OUTSIDE, "Foo.ext", "ThirdParty.X", true), "whatever its module");
  assert.ok(!covers(OUTSIDE, "Lib.x", "Lib.A", false), "never the project's own");
  const d = emptyReview();
  d.trusted = [OUTSIDE];
  assert.ok(trusted(d, "Foo.ext", "ThirdParty.X", true));
  assert.equal(prefixLabel(OUTSIDE), "the outside world");
  assert.equal(prefixLabel("Mathlib"), "Mathlib");
  assert.equal(invalid({ op: "trust", prefix: OUTSIDE, by: "Ada", on: true }), null);
});

test("what an opinion judges: the context the declaration is written in, a blank line, its text; in the compiled file and in an edited one", async () => {
  const { judgedText, withContext } = await import("../src/shared/context.ts");
  const text = [
    "namespace N",
    "open Foo (bar) in",
    "def skipped := 1",
    "open Foo",
    "variable (R : Nat)",
    "",
    "/-- A record. -/",
    "declare_type Q (R : Nat) where",
    "  data query : Unit",
    "",
    "set_option maxHeartbeats 400000 in",
    "@[simps] def comp (n : Nat) : Nat × Nat :=",
    "  (n, n)",
    "end N",
  ];
  const ctx = "namespace N\nopen Foo\nvariable (R : Nat)";
  // the docstring is the text's, the `open … in` before another declaration is not in force
  assert.equal(judgedText(text, false, "N.Q", [8, 0, 9, 19])?.text, `${ctx}\n\n/-- A record. -/\ndeclare_type Q (R : Nat) where\n  data query : Unit`);
  const comp = `${ctx}\nset_option maxHeartbeats 400000 in\n\n@[simps] def comp (n : Nat) : Nat × Nat :=\n  (n, n)`;
  assert.equal(judgedText(text, false, "N.comp", [12, 0, 13, 8])?.text, comp);
  // in a file changed since, it is found by name, and its context read from the present text
  const edited = ["namespace N", "-- moved", ...text.slice(1)];
  assert.deepEqual(judgedText(edited, true, "N.comp", [12, 0, 13, 8]), { text: comp, edited: true });
  assert.equal(judgedText(edited, true, "N.gone", [12, 0, 13, 8]), null);
  // nothing in force: the text alone
  assert.equal(withContext("", "def x := 1"), "def x := 1");
  assert.equal(judgedText(["def x := 1"], false, "x", [1, 0, 1, 10])?.text, "def x := 1");
});

test("a declaration of the project can be marked as target from its panel; one outside it is offered none, a target always its mark", () => {
  const nodes = [
    { name: "P.t", kind: "theorem", module: "P", ax: 0, hash: "h" },
    { name: "Nat.Prime", kind: "def", module: "Mathlib.Data.Nat.Prime", ax: 0, ext: true },
  ];
  const g = new Graph({ nodes, projectCount: 1, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: 0 } as unknown as ViewMeta, new Int32Array(0));
  const d = emptyReview();
  const box = (readOnly: boolean) =>
    new ReviewBox(g, {
      review: () => ({ data: d, error: null, blocked: null, readOnly, reviewer: "Alice" }),
      editedNow: () => false,
      reviewRoot: () => null,
      progress: () => ({ total: 1, approved: 0, commented: 0, stale: 0 }),
      keyProgress: () => ({ total: 1, approved: 0, commented: 0, stale: 0, unreviewed: 1 }),
      queue: () => ({ order: [0], axioms: [] }),
    } as unknown as ReviewHooks);
  assert.match(box(false).html(0, true), /data-rv-target>☆ Mark as target</);
  // the server refuses a target outside the project (server/reviewapi.ts): no button to be refused
  assert.doesNotMatch(box(false).html(1, true), /data-rv-target|Target/);
  // a target, wherever it is: its mark, and the way to take it off
  record(d, { op: "target", name: "Nat.Prime", by: "Alice", on: true }, "tc", at(1));
  assert.match(box(false).html(1, true), /data-rv-target>★ Target</);
  assert.match(box(true).html(1, true), /<div class="rv-tag">★ Target<\/div>/);
});
