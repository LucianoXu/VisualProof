// Renames and moves (HistorySpec.md): the declarations that vanished paired with those that
// appeared, at each confidence (server/renames.ts); a move replayed — what it carries, its undoing,
// the identity it links (shared/moves.ts) — in the review's logs, the server's own among them
// (server/review.ts); and what it does to the views: pins, notes' mentions, scopes, a target's view
// (server/views.ts).

import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SnapGraph, SnapNode } from "../src/server/history.ts";
import { findRenames, Renames } from "../src/server/renames.ts";
import { ReviewStore, SERVER_LOG, SERVER_WRITER } from "../src/server/review.ts";
import { Views } from "../src/server/views.ts";
import { ownName } from "../src/server/versions.ts";
import { identityIn, renameInNote, renameInQuery } from "../src/shared/moves.ts";
import { parseQuery, printQuery } from "../src/shared/query.ts";
import { applyEvent, current, emptyReview, keyMarks, logFileName, replay, reviewFromJson, statusOf } from "../src/shared/review.ts";
import type { ReviewData, ReviewEvent } from "../src/shared/review.ts";
import { LAYOUT_VERSION } from "../src/shared/graph.ts";

// ---------------------------------------------------------------- pairing

const snapNode = (name: string, module: string, o: Partial<SnapNode> = {}): SnapNode => ({ name, kind: "def", module, type: `${name.split(".").pop()} : Nat → Nat`, ax: [], hash: `k-${name}`, shape: `s-${name.split(".").pop()}`, refs: ["Nat"], ...o });

function snap(id: number, nodes: SnapNode[], missing: string[] = []): SnapGraph {
  return {
    info: { id, at: new Date(id * 1000).toISOString(), read: "", fingerprint: `f${id}`, commit: null, toolchain: "tc", missing, counts: { modules: 0, nodes: nodes.length, edges: 0, externals: 0 }, bytes: { new: 0, all: 0 } },
    modules: [],
    nodes,
    projectCount: nodes.length,
    edges: [],
  };
}

test("pairing at high confidence: the same version, names aside — whole namespaces renamed, references between them, the declaration itself", () => {
  // Q.Old.{S, f, t} became Q.New.{S, f, t}: f is built from S, t speaks of f and S's constructor
  const before = snap(1, [
    snapNode("Q.Old.S", "Q.Old", { kind: "structure", shape: "sS", refs: ["Nat", "Q.Old.S"] }),
    snapNode("Q.Old.f", "Q.Old", { shape: "sf", refs: ["Q.Old.S", "Q.Old.S mk", "Nat"] }),
    snapNode("Q.Old.t", "Q.Old", { kind: "theorem", shape: "st", refs: ["Q.Old.f", "Eq"] }),
    snapNode("Q.keep", "Q", { shape: "sk", refs: ["Q.Old.f"] }),
    snapNode("Q.Old.gone", "Q.Old", { shape: "sg", refs: [] }),
  ]);
  const after = snap(2, [
    snapNode("Q.New.S", "Q.New", { kind: "structure", shape: "sS", refs: ["Nat", "Q.New.S"] }),
    snapNode("Q.New.f", "Q.New", { shape: "sf", refs: ["Q.New.S", "Q.New.S mk", "Nat"] }),
    snapNode("Q.New.t", "Q.New", { kind: "theorem", shape: "st", refs: ["Q.New.f", "Eq"] }),
    snapNode("Q.keep", "Q", { shape: "sk", refs: ["Q.New.f"] }),
    snapNode("Q.New.fresh", "Q.New", { shape: "sz", refs: [] }),
  ]);
  const ps = findRenames(before, after, ownName);
  const high = ps.filter((p) => p.confidence === "high").map((p) => [p.from, p.to, p.why]);
  assert.deepEqual(high.sort(), [
    ["Q.Old.S", "Q.New.S", "same version"],
    ["Q.Old.f", "Q.New.f", "same version"],
    ["Q.Old.t", "Q.New.t", "same version"],
  ]);
  assert.ok(!ps.some((p) => p.from === "Q.Old.gone" && p.confidence === "high"), "something else that went is not a rename");
  // a real change is no rename of high confidence
  const changed = snap(3, [snapNode("Q.New.S", "Q.New", { kind: "structure", shape: "sS2", refs: ["Nat", "Q.New.S"] }), ...after.nodes.slice(1)]);
  assert.ok(!findRenames(before, changed, ownName).some((p) => p.from === "Q.Old.S" && p.confidence === "high"));
});

test("pairing at medium confidence: alike, not the same — offered, each new declaration once", () => {
  const before = snap(1, [
    snapNode("A.X.lemma_one", "A.X", { type: "lemma_one : ∀ n, f n = g n", shape: "a1" }),
    snapNode("A.twin1", "A.T", { shape: "same" }),
    snapNode("A.twin2", "A.T", { shape: "same" }),
    snapNode("A.lonely", "A.L", { type: "lonely : Bool", shape: "l1" }),
  ]);
  const after = snap(2, [
    snapNode("A.Y.lemma_one", "A.Y", { type: "lemma_one : ∀ n, f n = g (n + 0)", shape: "a2" }),
    snapNode("A.twin", "A.T", { shape: "same" }),
    snapNode("B.unrelated", "B", { type: "unrelated : String", shape: "u" }),
  ]);
  const ps = findRenames(before, after, ownName);
  assert.ok(ps.every((p) => p.confidence === "medium"), JSON.stringify(ps));
  const lemma = ps.find((p) => p.from === "A.X.lemma_one")!;
  assert.equal(lemma.to, "A.Y.lemma_one");
  assert.match(lemma.why, /the same last name/);
  const twin = ps.filter((p) => p.to === "A.twin");
  assert.equal(twin.length, 1, "offered once");
  assert.match(twin[0].why, /the same content as others/);
  assert.ok(!ps.some((p) => p.from === "A.lonely"), "nothing alike: nothing offered");
});

test("pairing sets aside what a build could not read, and against a build read before versions the kernel's hash stands", () => {
  const before = snap(1, [snapNode("A.f", "A"), snapNode("B.g", "B")]);
  const after = snap(2, [snapNode("A.f2", "A", { hash: "k-A.f" })], ["B"]);
  for (const n of before.nodes) delete n.shape;
  const ps = findRenames(before, after, ownName);
  assert.deepEqual(ps.map((p) => [p.from, p.to, p.confidence, p.why]), [["A.f", "A.f2", "high", "same kernel hash"]]);
});

test("renames compose from one snapshot to a later one", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-moves-"));
  try {
    const r = new Renames(dir);
    r.record(2, [{ from: "A", to: "B", confidence: "high", why: "same version" }, { from: "X", to: "Y", confidence: "medium", why: "", score: 0.7 }]);
    r.record(3, [{ from: "B", to: "C", confidence: "high", why: "same version" }, { from: "P", to: "Q", confidence: "high", why: "same version" }]);
    assert.deepEqual([...r.between(1, 3, [1, 2, 3])].sort(), [["A", "C"], ["P", "Q"]]);
    assert.deepEqual([...r.between(2, 3, [1, 2, 3])].sort(), [["B", "C"], ["P", "Q"]]);
    assert.deepEqual([...new Renames(dir).between(1, 2, [1, 2, 3])], [["A", "B"]], "kept, and read back");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- moves in the review

const at = (m: number) => new Date(Date.UTC(2026, 9, 9, 10, m)).toISOString();

test("a move carries opinions, comments, the target mark and key marks; its undoing takes back exactly those", () => {
  const events: ReviewEvent[] = [
    { op: "target", at: at(0), by: "Alice", name: "A.main", on: true },
    { op: "key", at: at(1), by: "Alice", target: "A.main", name: "A.f", on: true },
    { op: "key", at: at(2), by: "Alice", target: "A.main", name: "A.h", on: true },
    { op: "opinion", at: at(3), by: "Alice", name: "A.f", verdict: "comment", comment: "why `A.f`?", hash: "v1" },
    { op: "opinion", at: at(4), by: "Bob", name: "A.g", verdict: "approve", hash: "vg" },
    // A.f is A.g now (A.g existed: a person attaches, no rename); A.main is A.top renamed
    { op: "move", at: at(5), by: "Alice", from: "A.f", to: "A.g", on: true },
    { op: "move", at: at(6), by: "VisualProof", from: "A.main", to: "A.top", on: true, rename: true, auto: "same version", snap: 2 },
    { op: "opinion", at: at(7), by: "Carol", name: "A.g", verdict: "approve", hash: "vg" },
  ];
  const d = replay([{ file: "x.jsonl", events }]);
  assert.deepEqual(Object.keys(d.targets), ["A.top"]);
  assert.deepEqual(d.targets["A.top"].was, ["A.main"]);
  assert.deepEqual(keyMarks(d, "A.top"), ["A.g", "A.h"], "its key marks, as a target, and the mark on A.f, now A.g");
  assert.deepEqual(d.opinions["A.g"].map((o) => [o.by, o.was]), [["Alice", ["A.f"]], ["Bob", undefined], ["Carol", undefined]]);
  assert.equal(d.opinions["A.g"][0].comment, "why `A.f`?", "its comment as written");
  assert.equal(Object.hasOwn(d.opinions, "A.f"), false);
  assert.equal(identityIn(d.renamed, "A.top"), "A.main");
  assert.equal(identityIn(d.renamed, "A.g"), "A.g", "an attach is no rename");
  // the same review through JSON, as a page takes it, then a delta applied
  const page = reviewFromJson(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(page.targets["A.top"].was, ["A.main"]);
  assert.equal(page.renamed?.["A.top"], "A.main");
  // undone: what the move carried goes back, what was said of A.g since stays
  const undo: ReviewEvent[] = [
    { op: "move", at: at(8), by: "Bob", from: "A.f", to: "A.g", on: false },
    { op: "move", at: at(9), by: "Bob", from: "A.main", to: "A.top", on: false, rename: true },
  ];
  for (const e of undo) applyEvent(page, e);
  const d2 = replay([{ file: "x.jsonl", events: [...events, ...undo] }]);
  for (const x of [page, d2] as ReviewData[]) {
    assert.deepEqual(Object.keys(x.targets), ["A.main"]);
    assert.equal(x.targets["A.main"].was, undefined);
    assert.deepEqual(keyMarks(x, "A.main"), ["A.f", "A.h"]);
    assert.deepEqual(x.opinions["A.f"].map((o) => o.by), ["Alice"]);
    assert.deepEqual(x.opinions["A.g"].map((o) => o.by), ["Bob", "Carol"]);
    assert.equal(identityIn(x.renamed, "A.top"), "A.top");
  }
});

test("renames chain and come back: the identity is the first name; a rename back is itself again", () => {
  const ev = (m: number, from: string, to: string, on = true): ReviewEvent => ({ op: "move", at: at(m), by: "VisualProof", from, to, on, rename: true, auto: "same version" });
  const d = replay([{ file: "visualproof.server.jsonl", events: [ev(0, "A", "B"), ev(1, "B", "C")] }]);
  assert.equal(identityIn(d.renamed, "C"), "A");
  const back = replay([{ file: "visualproof.server.jsonl", events: [ev(0, "A", "B"), ev(1, "B", "A")] }]);
  assert.equal(identityIn(back.renamed, "A"), "A");
  assert.equal(Object.keys(back.renamed ?? {}).length, 0);
  // an undoing in the middle of a chain: C is B renamed, B is new
  const mid = replay([{ file: "visualproof.server.jsonl", events: [ev(0, "A", "B"), ev(1, "B", "C"), ev(2, "A", "B", false)] }]);
  assert.equal(identityIn(mid.renamed, "C"), "B");
});

test("old logs without moves replay as before", () => {
  const events: ReviewEvent[] = [
    { op: "target", at: at(0), by: "Alice", name: "A.main", on: true },
    { op: "opinion", at: at(1), by: "Alice", name: "A.f", verdict: "approve", hash: "h1" },
  ];
  const d = replay([{ file: "a.jsonl", events }]);
  assert.equal(d.renamed, undefined);
  assert.equal(statusOf(d, "A.f", "h1"), "approved");
  assert.deepEqual(current(d, "A.f")[0].was, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(d)), JSON.parse(JSON.stringify({ ...emptyReview(), targets: { "A.main": { by: "Alice", at: at(0) } }, opinions: { "A.f": [{ by: "Alice", verdict: "approve", at: at(1), hash: "h1" }] } })));
});

test("the server writes the moves it finds to a log of its own; a person's moves go to theirs; neither holds the other's", () => {
  const root = mkdtempSync(join(tmpdir(), "vp-moves-"));
  try {
    const store = new ReviewStore(root, ".visualproof");
    const r1 = store.append({ name: "Alice", agent: false }, { op: "opinion", name: "A.f", by: "Alice", verdict: "approve", hash: "v" }, "tc");
    assert.ok("change" in r1);
    const m = store.append(SERVER_WRITER, { op: "move", from: "A.f", to: "A.g", on: true, rename: true, auto: "same version", snap: 3, by: "VisualProof" }, "tc");
    assert.ok("change" in m && m.change && m.change.events?.length === 1, JSON.stringify(m));
    const log = join(root, ".visualproof", "log");
    const line = JSON.parse(readFileSync(join(log, SERVER_LOG), "utf8"));
    assert.deepEqual([line.op, line.from, line.to, line.on, line.rename, line.auto, line.snap, line.by], ["move", "A.f", "A.g", true, true, "same version", 3, "VisualProof"]);
    assert.deepEqual(store.data.opinions["A.g"].map((o) => o.was), [["A.f"]]);
    // the same again carries nothing: nothing is written
    const again = store.append(SERVER_WRITER, { op: "move", from: "A.f", to: "A.g", on: true, rename: true, auto: "same version", by: "VisualProof" }, "tc");
    assert.ok("unchanged" in again);
    // a person undoes it, in their own log
    const u = store.append({ name: "Bob", agent: false }, { op: "move", from: "A.f", to: "A.g", on: false, rename: true, by: "Bob" }, "tc");
    assert.ok("change" in u && u.change);
    assert.match(readFileSync(join(log, logFileName("Bob", false)), "utf8"), /"op":"move".*"on":false/);
    assert.deepEqual(store.data.opinions["A.f"].map((o) => o.by), ["Alice"]);
    // nobody else writes the server's kind of move, and the server writes nothing else
    assert.equal((store.append({ name: "Bob", agent: false }, { op: "move", from: "A.f", to: "A.g", on: true, auto: "x", by: "Bob" }, "tc") as { status: number }).status, 400);
    assert.equal((store.append(SERVER_WRITER, { op: "target", name: "A.f", on: true, by: "VisualProof" }, "tc") as { status: number }).status, 400);
    // a line of the wrong kind in either is a line that cannot be read
    appendFileSync(join(log, SERVER_LOG), JSON.stringify({ op: "target", at: at(30), by: "VisualProof", name: "A.x", on: true }) + "\n");
    appendFileSync(join(log, logFileName("Bob", false)), JSON.stringify({ op: "move", at: at(31), by: "Bob", from: "A.y", to: "A.z", on: true, auto: "same version" }) + "\n");
    store.refresh();
    assert.deepEqual(store.problems.map((p) => [p.file, p.why.split(" (")[0]]).sort(), [
      [logFileName("Bob", false), "a move the server found, or a link it carried, outside its own log"],
      [SERVER_LOG, "the server's log holds the moves it found and the links it carried, nothing else"],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- moves on the views

test("a move on the views: pins, notes' mentions and scopes follow, and come back when undone; a target's view goes with it", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-moves-"));
  try {
    const sent: [string, unknown][] = [];
    const views = new Views(dir, LAYOUT_VERSION, (e, d) => sent.push([e, d]));
    const place = { mode: "namespace" as const, in: [] as [string, number, number][], world: [0, 0] as [number, number] };
    views.arrange("project", [
      { op: "pin", mode: "namespace", kind: "node", key: "A.f", at: [3, 4] },
      { op: "pin", mode: "module", kind: "node", key: "A.f", at: [5, 6] },
      { op: "note", note: { id: "n1", text: "see `A.f` and `A.ff`", place, open: true, by: null, at: "" } },
    ], null, "Alice");
    const v = views.book.create("Mine", "Alice", { scope: parseQuery("tcb(A.f) or decl(A.f, A.h) except key(A.main)") }) as { id: string };
    const moved = views.moveDeclaration("A.f", "A.g", "VisualProof");
    // and then another, in the same note and scope: undoing the first leaves it
    views.arrange("project", [{ op: "note-edit", id: "n1", text: "see `A.g` and `A.ff`, `A.h`" }], null, "Alice");
    views.moveDeclaration("A.h", "A.k", "VisualProof");
    const p = views.book.get("project")!;
    assert.deepEqual([p.pins.namespace.nodes["A.g"], p.pins.module.nodes["A.g"], p.pins.namespace.nodes["A.f"]], [[3, 4], [5, 6], undefined]);
    assert.equal(printQuery(views.book.get(v.id)!.scope), "tcb(A.g) or decl(A.g, A.k) except key(A.main)");
    assert.deepEqual(moved.map((m) => m.view).sort(), ["project", v.id].sort());
    assert.equal(p.notes![0].text, "see `A.g` and `A.ff`, `A.k`", "a full name in backticks; another name that starts with it is left");
    // the first undone: what it moved comes back, the second and the edit stay
    views.unmoveDeclaration("A.f", "A.g", moved, "Bob");
    assert.deepEqual([p.pins.namespace.nodes["A.f"], p.pins.namespace.nodes["A.g"]], [[3, 4], undefined]);
    assert.equal(p.notes![0].text, "see `A.f` and `A.ff`, `A.k`");
    assert.equal(printQuery(views.book.get(v.id)!.scope), "tcb(A.f) or decl(A.f, A.k) except key(A.main)");
    // a target moved: its view goes with it, arrangement and all — its scope and its focus name the
    // new name as every view's do (the move), and the link is the new name's once the move is
    // replayed (the targets synced); the view keeps its id
    const tv = views.openTarget("A.main", "Alice");
    views.arrange(tv.id, [{ op: "fold", mode: "namespace", key: "A", on: true }], null, "Alice");
    const top = views.moveDeclaration("A.main", "A.top", "VisualProof");
    views.syncTargets(["A.top"], (t) => (t === "A.top" ? ["A.main"] : undefined));
    const r = views.book.get(tv.id)!;
    assert.deepEqual([views.book.viewOf("A.top")?.id, r.targets, r.focus, r.folds.namespace, printQuery(r.scope)], [tv.id, ["A.top"], "A.top", ["A"], "tcb(A.top)"]);
    // undone: the view is the old name's again, its scope and focus with it
    views.unmoveDeclaration("A.main", "A.top", top, "Bob", false, true);
    const back = views.book.get(tv.id)!;
    assert.deepEqual([back.targets, back.focus, printQuery(back.scope)], [["A.main"], "A.main", "tcb(A.main)"]);
    // a scope and a note, read as the page writes them
    assert.equal(renameInNote("`A.f`, `A.f`", "A.f", "B"), "`B`, `B`");
    assert.equal(printQuery(renameInQuery(parseQuery("key(A.f) and uses(ns(A.f) except external)"), "A.f", "B")), "key(B) and uses(ns(A.f) except external)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a migration is kept with what undoes it, and its undoing is kept too", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-moves-"));
  try {
    mkdirSync(dir, { recursive: true });
    const r = new Renames(dir);
    const m = r.migrated({ at: at(0), from: "A.f", to: "A.g", snap: 2, by: "VisualProof", auto: "same version", rename: true, review: true, carried: { opinions: 2, targets: 0, keys: 1, notes: 1, pins: 2, scopes: 0, reviewViews: 0 }, views: [] });
    assert.equal(m.id, "m1");
    r.undone("m1", "Bob", false);
    writeFileSync(join(dir, "junk"), "");
    const again = new Renames(dir);
    assert.equal(again.get("m1")?.undone?.by, "Bob");
    assert.equal(again.migrations.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
