// Views (ViewSpec.md): the query language a scope and lighting up share, boards and their layout's
// memory, and the views the server keeps — kept or not, the Project view from today's pins, a
// target's view, pins and folds per view.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { boardLayout, boardSet, setKey } from "../src/shared/board.ts";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { LAYOUT_VERSION } from "../src/shared/graph.ts";
import { chainOf, cleanQuery, describe, describeCondition, evaluate, fromChain, invalidQuery, LIGHT, parseQuery, printQuery, QUERY_LIMITS, QueryError, readsReview, reviewScope, setOutside, withoutOutside, withSelection } from "../src/shared/query.ts";
import type { Query } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import type { ReviewData } from "../src/shared/review.ts";
import type { NewEvent, StoredEvent } from "../src/shared/timeline.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import type { Mode } from "../src/shared/viewgraph.ts";
import { applyViewOps, diffFolds, invalidViewOps, PROJECT, ViewBook, viewTitle } from "../src/shared/views.ts";
import type { ViewData } from "../src/shared/views.ts";
import { emptyLayouts } from "../src/shared/places.ts";
import type { Ask } from "../src/server/agent.ts";
import { agentSession, Presence } from "../src/server/presence.ts";
import { Views } from "../src/server/views.ts";
import { cleanView } from "../src/shared/collab.ts";
import type { Peer } from "../src/shared/collab.ts";

/** t uses d (statement), d uses e (body), t's proof uses p; x uses d; E is external, used by e;
 *  Q.s has a sorry. Modules: M.A holds t, d, p; M.B holds e, x; Q holds s. */
function world() {
  const nodes: ViewNode[] = [
    { name: "N.t", kind: "theorem", module: "M.A", ax: 0, hash: "t1" },
    { name: "N.d", kind: "def", module: "M.A", ax: 0, hash: "d1" },
    { name: "N.e", kind: "def", module: "M.B", ax: 0, hash: "e1" },
    { name: "N.p", kind: "theorem", module: "M.A", ax: 0, hash: "p1" },
    { name: "N.x", kind: "def", module: "M.B", ax: 0, hash: "x1" },
    { name: "Q.s", kind: "theorem", module: "Q", ax: 1, hash: "s1" },
    { name: "Ext.E", kind: "def", module: "Mathlib.X", ax: 0, ext: true },
  ];
  const edges = new Int32Array([0, 1, SITE_STMT, 1, 2, SITE_BODY, 0, 3, SITE_PROOF, 2, 6, SITE_STMT, 4, 1, SITE_STMT]);
  const meta = { nodes, projectCount: 6, axioms: ["propext", "sorryAx"], axiomSets: [[0], [0, 1]], layouts: {}, edgeCount: 5 } as unknown as ViewMeta;
  return new Graph(meta, edges);
}

const names = (g: Graph, s: Uint8Array) => g.nodes.filter((_, i) => s[i]).map((v) => v.name);

function review(): ReviewData {
  const d = emptyReview();
  d.opinions["N.d"] = [{ by: "Alice", verdict: "approve", hash: "d1", at: "2026-10-07T10:00:00Z" }];
  d.opinions["N.e"] = [{ by: "Bob", verdict: "approve", hash: "old", at: "2026-10-07T10:00:00Z" }];
  d.opinions["N.x"] = [
    { by: "Bob", verdict: "comment", comment: "no", hash: "x1", at: "2026-10-07T10:00:00Z" },
    { by: "Claude", verdict: "comment", comment: "wrong", hash: "x1", at: "2026-10-07T10:00:00Z", agent: true },
  ];
  d.opinions["N.t"] = [{ by: "Claude", verdict: "comment", comment: "?", hash: "t1", at: "2026-10-07T10:00:00Z", agent: true }];
  d.targets["N.t"] = { by: "Alice", at: "2026-10-07T09:00:00Z" };
  d.trusted = [...d.trusted, "M.B"].sort();
  return d;
}

// ---------------------------------------------------------------- the query language

test("a query's text reads back as the same query, and the text printed is canonical", () => {
  const texts = [
    "all",
    "tcb(N.t)",
    "tcb(N.t) except trusted except external",
    "uses(A.b, C.d) and kind(theorem, def)",
    "usedBy(selection)",
    "refs(N.t) or refs(file(M.A))",
    "ns(Fermat42) or file(Mathlib.NumberTheory)",
    "all and status(unreviewed, stale) except advice(comment)",
    "decl(A, B) or (tcb(C) except sorry)",
    "all and nonstandard",
    `tcb("selection", "A.«b c»", "x,y")`,
  ];
  for (const t of texts) {
    const q = parseQuery(t);
    assert.equal(printQuery(q), t, t);
    assert.deepEqual(parseQuery(printQuery(q)), q);
    assert.deepEqual(cleanQuery(JSON.parse(JSON.stringify(q))), q, "the JSON form survives a trip");
  }
  // words without regard to case, aliases, spacing: the same query, printed one way
  assert.equal(printQuery(parseQuery("  TCB( N.t )   EXCEPT   Trusted ")), "tcb(N.t) except trusted");
  assert.equal(printQuery(parseQuery("usedby(A) and namespace(B) and module(C)")), "usedBy(A) and ns(B) and file(C)");
  // left to right, one level: a combination on the right keeps its parentheses
  assert.equal(printQuery(parseQuery("(all except trusted) except external")), "all except trusted except external");
  assert.equal(printQuery(parseQuery("all except (trusted or external)")), "all except (trusted or external)");
  // the selection is a word; a declaration of that name is quoted
  assert.deepEqual(parseQuery("tcb(selection)"), LIGHT.tcb);
  assert.deepEqual(parseQuery('tcb("selection")'), { op: "tcb", of: ["selection"] });
});

test("a query that cannot be read says where", () => {
  const where = (t: string) => {
    try {
      parseQuery(t);
    } catch (e) {
      assert.ok(e instanceof QueryError);
      return (e as QueryError).at;
    }
    assert.fail(`${t} was read`);
  };
  assert.equal(where("tcb"), 3, "arguments missing");
  assert.equal(where("tcb(A) excep trusted"), 7, "not a combinator");
  assert.equal(where("kind(lemma)"), 5, "not a kind");
  assert.equal(where("tcb(A"), 5, "not closed");
  assert.equal(where("frobnicate"), 0);
  assert.equal(where('tcb("A)'), 4, "a quote not closed");
  assert.equal(cleanQuery({ op: "tcb", of: [] }), null);
  assert.equal(cleanQuery({ op: "kind", kinds: ["lemma"] }), null);
  assert.equal(cleanQuery("tcb("), null);
  assert.deepEqual(cleanQuery("all"), { op: "all" }, "text is read too");
});

test("the query language says comment (2026-10-09): status(commented) and advice(comment), the old words refused", () => {
  assert.deepEqual(parseQuery("status(commented)"), { op: "status", statuses: ["commented"] });
  assert.deepEqual(parseQuery("advice(comment, approve)"), { op: "advice", verdicts: ["comment", "approve"] });
  assert.equal(printQuery(parseQuery("all except STATUS(Commented) or advice(COMMENT)")), "all except status(commented) or advice(comment)");
  assert.equal(describe(parseQuery("status(commented)")), "commented");
  assert.equal(describe(parseQuery("advice(comment)")), "what an agent comments on");
  assert.equal(describe(parseQuery("advice(approve, comment)")), "what an agent approves or comments on");
  // the old words are no words of it, as text or as JSON (a scope kept with them is not read)
  assert.throws(() => parseQuery("status(disputed)"), /disputed is not one of unreviewed, approved, commented, stale/);
  assert.throws(() => parseQuery("advice(dispute)"), /dispute is not one of approve, comment/);
  assert.equal(cleanQuery({ op: "status", statuses: ["disputed"] }), null);
  assert.equal(cleanQuery({ op: "advice", verdicts: ["dispute"] }), null);
});

test("a query is bounded alike as text and as JSON: what one form takes the other takes, and one too large is refused as such, never by the stack", () => {
  const L = QUERY_LIMITS;
  const both = (t: string) => {
    const q = parseQuery(t);
    assert.deepEqual(cleanQuery(JSON.parse(JSON.stringify(q))), q, `the JSON form of ${t.slice(0, 50)}`);
    assert.deepEqual(parseQuery(printQuery(q)), q);
    return q;
  };
  // what selections and zoomed boards need: 900 picks in a row, 2,000 names, nesting to the bound
  both(Array.from({ length: 900 }, (_, i) => `decl(A.x${i})`).join(" or "));
  both(`decl(${Array.from({ length: L.names }, (_, i) => `n${i}`).join(", ")})`);
  both("tcb(".repeat(L.depth) + "decl(A)" + ")".repeat(L.depth));
  both("all except (".repeat(L.depth) + "all" + ")".repeat(L.depth));
  both(Array.from({ length: L.closures }, (_, i) => `usedBy(A${i})`).join(" or "));
  both('decl("") or ns("")');
  // a 30-pick view and one of 501 names were dropped at a restart before (the JSON form was bounded
  // tighter than the text): both are read back now
  assert.ok(cleanQuery(JSON.parse(JSON.stringify(parseQuery(Array.from({ length: 30 }, (_, i) => `decl(A.n${i})`).join(" or "))))));
  assert.ok(cleanQuery(JSON.parse(JSON.stringify(parseQuery(`decl(${Array.from({ length: 501 }, (_, i) => `A.n${i}`).join(", ")})`)))));
  // one past a bound: refused in either form, saying which
  const nest = (n: number): Query => (n ? { op: "tcb", of: nest(n - 1) } : { op: "decl", names: ["A"] });
  const past: [string, Query, RegExp][] = [
    ["tcb(".repeat(L.depth + 1) + "decl(A)" + ")".repeat(L.depth + 1), nest(L.depth + 1), /nests/],
    [Array.from({ length: L.terms + 1 }, () => "all").join(" or "), Array.from({ length: L.terms }, (): Query => ({ op: "all" })).reduce((a, b) => ({ op: "or", a, b }), { op: "all" } as Query), /parts/],
    [`decl(${Array.from({ length: L.names + 1 }, (_, i) => `n${i}`).join(",")})`, { op: "decl", names: Array.from({ length: L.names + 1 }, (_, i) => `n${i}`) }, /names/],
    [Array.from({ length: L.closures + 1 }, (_, i) => `tcb(A${i})`).join(" or "), Array.from({ length: L.closures }, (_, i): Query => ({ op: "tcb", of: [`A${i + 1}`] })).reduce((a, b) => ({ op: "or", a, b }), { op: "tcb", of: ["A0"] } as Query), /closures/],
    [`decl(${Array.from({ length: 11 }, (_, i) => "x".repeat(1990) + i).join(", ")})`, { op: "decl", names: Array.from({ length: 11 }, (_, i) => "x".repeat(1990) + i) }, /characters/],
  ];
  for (const [text, json, why] of past) {
    assert.throws(() => parseQuery(text), (e: unknown) => e instanceof QueryError && why.test(e.message), text.slice(0, 40));
    assert.equal(cleanQuery(json), null, `the JSON form of ${text.slice(0, 40)}`);
    assert.match(invalidQuery(json) ?? "", why);
  }
  // what overflowed the stack before is a QueryError (a 400 with a message), and a JSON tree of
  // any depth is refused without a walk to its bottom
  for (const t of ["(".repeat(9000) + "all" + ")".repeat(9000), "usedBy(".repeat(2400) + "decl(A)" + ")".repeat(2400)])
    assert.throws(() => parseQuery(t), (e: unknown) => e instanceof QueryError, t.slice(0, 20));
  let left: unknown = { op: "all" }, right: unknown = { op: "all" };
  for (let i = 0; i < 100_000; i++) {
    left = { op: "or", a: left, b: { op: "all" } };
    right = { op: "except", a: { op: "all" }, b: right };
  }
  assert.equal(cleanQuery(left), null);
  assert.equal(cleanQuery(right), null);
});

test("evaluating a query walks each closure once, however often the query asks for it", () => {
  const g = world();
  const d = review();
  const walk = g.closure.bind(g);
  let walks = 0;
  g.closure = (m, f) => (walks++, walk(m, f));
  const set = evaluate(parseQuery("usedBy(N.d) or uses(usedBy(N.d)) or usedBy(N.d) except (usedBy(N.d) and decl(N.x))"), { g, review: d });
  assert.equal(walks, 2, "usedBy(N.d) once, uses of it once");
  assert.deepEqual(names(g, set), ["N.t", "N.d", "N.e", "N.p", "Ext.E"]);
});

test("a query holds what it says, on the graph and the review", () => {
  const g = world();
  const d = review();
  const ev = (t: string, selection?: number[]) => names(g, evaluate(parseQuery(t), { g, review: d, selection }));
  assert.equal(ev("all").length, 7);
  assert.deepEqual(ev("tcb(N.t)"), ["N.t", "N.d", "N.e", "Ext.E"], "statement and bodies, proofs skipped");
  assert.deepEqual(ev("uses(N.t)"), ["N.t", "N.d", "N.e", "N.p", "Ext.E"]);
  assert.deepEqual(ev("refs(N.t)"), ["N.t", "N.d", "N.p"], "what it uses directly, its proof's too: one step (Direct)");
  assert.deepEqual(ev("usedBy(N.d)"), ["N.t", "N.d", "N.x"]);
  assert.deepEqual(ev("tcb(N.t) except external"), ["N.t", "N.d", "N.e"]);
  // trusted: the outside world by its module (Mathlib), the project's own by a prefix (M.B)
  assert.deepEqual(ev("tcb(N.t) except trusted"), ["N.t", "N.d"]);
  assert.deepEqual(ev("ns(N)"), ["N.t", "N.d", "N.e", "N.p", "N.x"]);
  assert.deepEqual(ev("file(M.A)"), ["N.t", "N.d", "N.p"]);
  assert.deepEqual(ev("file(M)"), ["N.t", "N.d", "N.e", "N.p", "N.x"], "a prefix, a whole component at a time");
  assert.deepEqual(ev("all and kind(theorem)"), ["N.t", "N.p", "Q.s"]);
  assert.deepEqual(ev("all and status(approved)"), ["N.d"]);
  assert.deepEqual(ev("all and status(stale)"), ["N.e"]);
  assert.deepEqual(ev("all and status(commented)"), ["N.x"], "an agent's comment is not a status");
  assert.deepEqual(ev("ns(N) and status(unreviewed)"), ["N.t", "N.p"]);
  assert.deepEqual(ev("all and advice(comment)"), ["N.t", "N.x"], "what an agent comments on");
  assert.deepEqual(ev("all and sorry"), ["Q.s"]);
  assert.deepEqual(ev("all and nonstandard"), ["Q.s"]);
  assert.deepEqual(ev("decl(N.p) or decl(Q.s, Nope)"), ["N.p", "Q.s"], "a name the graph does not hold stands for nothing");
  // lighting up: the four modes are queries on the selection, and agree with the graph's closures
  for (const m of ["plain", "tcb", "deps", "apps"] as Mode[]) {
    for (const sel of [[0], [1], [1, 4]]) assert.deepEqual(evaluate(LIGHT[m], { g, review: d, selection: sel }), g.closure(m, sel), `${m} of ${sel}`);
  }
  assert.deepEqual(ev("tcb(selection)"), [], "no selection lights nothing");
});

test("a scope's chain: its first set and its conditions, as the chips show them", () => {
  const q = parseQuery("tcb(N.t) except trusted except external and kind(def)");
  const { base, conditions } = chainOf(q);
  assert.deepEqual(base, { op: "tcb", of: ["N.t"] });
  assert.deepEqual(conditions.map(describeCondition), ["except what is trusted", "without the outside world", "only definitions"]);
  assert.deepEqual(fromChain(base, conditions), q);
  // a target's review set: what its review counts (shared/reviewqueue.ts), the untrusted outside
  // world and the non-standard axioms it rests on included
  assert.deepEqual(reviewScope("N.t"), parseQuery("tcb(N.t) except trusted or (uses(N.t) and kind(axiom) and nonstandard)"));
  // the External switch is a condition of the scope
  assert.ok(withoutOutside(q));
  assert.equal(printQuery(setOutside(q, true)), "tcb(N.t) except trusted and kind(def)");
  assert.equal(printQuery(setOutside(parseQuery("all"), false)), "all except external");
  // what is lit now, as a scope (Zoom in)
  assert.equal(printQuery(withSelection(LIGHT.deps, ["A", "B"])), "uses(A, B)");
  assert.equal(printQuery(withSelection(LIGHT.plain, ["A"])), "decl(A)");
  assert.ok(readsReview(q) && !readsReview(parseQuery("tcb(A) except external")));
});

// ---------------------------------------------------------------- boards

test("a board: the whole project on the server's layout, or a set laid out on its own", () => {
  const g = world();
  const d = review();
  const all = boardSet(g, d, parseQuery("all"));
  assert.ok(all.whole && all.outside && all.sub === null);
  const own = boardSet(g, d, parseQuery("all except external"));
  assert.ok(own.whole && !own.outside, "without the outside world: the same layout, the outside hidden");
  const tcb = boardSet(g, d, parseQuery("tcb(N.t) except external"));
  assert.ok(!tcb.whole && tcb.sub);
  assert.deepEqual(tcb.sub!.graph.nodes.map((v) => v.name), ["N.t", "N.d", "N.e"]);
  assert.equal(tcb.sub!.toSub[tcb.sub!.toFull[2]], 2);
  // a set's key is its names', whatever their order
  const rev = new Graph({ ...g.meta, nodes: [...g.nodes].reverse(), projectCount: 0 } as ViewMeta, new Int32Array());
  const set = new Uint8Array(7).fill(1);
  assert.equal(setKey(g, set), setKey(rev, set));
  set[2] = 0;
  assert.notEqual(setKey(g, set), setKey(rev, new Uint8Array(7).fill(1)));
});

test("a board's layout: recalled exactly from the memory of its set; a new set keeps what stays", () => {
  const g = world();
  const d = review();
  const b1 = boardSet(g, d, parseQuery("uses(N.t)"));
  const first = boardLayout(b1.sub!.graph, "namespace", b1.key, null);
  assert.ok(first.next, "a board laid out for the first time hands its memory over");
  // another page with that memory: the same picture, nothing to hand over
  const again = boardLayout(b1.sub!.graph, "namespace", b1.key, first.next);
  assert.equal(again.next, null);
  assert.deepEqual([again.layout.x, again.layout.y], [first.layout.x, first.layout.y]);
  // the set grows: what stays keeps its place
  const b2 = boardSet(g, d, parseQuery("uses(N.t) or decl(N.x)"));
  const grown = boardLayout(b2.sub!.graph, "namespace", b2.key, first.next);
  assert.ok(grown.next && grown.next.set === b2.key);
  for (const name of ["N.t", "N.d", "N.e", "N.p"]) {
    const a = b1.sub!.graph.byName.get(name)!, b = b2.sub!.graph.byName.get(name)!;
    const ca = first.layout.clusters[first.layout.cluster[a]], cb = grown.layout.clusters[grown.layout.cluster[b]];
    assert.deepEqual([grown.layout.x[b] - cb.x, grown.layout.y[b] - cb.y], [first.layout.x[a] - ca.x, first.layout.y[a] - ca.y], `${name} moved`);
  }
  // two pages starting from the same memory come to the same picture
  const other = boardLayout(b2.sub!.graph, "namespace", b2.key, first.next);
  assert.deepEqual([other.layout.x, other.layout.y], [grown.layout.x, grown.layout.y]);
});

// ---------------------------------------------------------------- the views

const pin = (key: string, at: [number, number], mode: "namespace" | "module" = "namespace") => ({ op: "pin" as const, mode, kind: "node" as const, key, at });

test("pins and folds per view, as operations; arranging an open view keeps it", () => {
  const book = new ViewBook();
  const { view, change } = book.open(parseQuery("tcb(N.t)"), "Alice", 1000);
  assert.equal(change?.what, "opened");
  assert.ok(!view.kept);
  assert.equal(book.open(parseQuery("tcb( N.t )"), "Bob", 1100).view.id, view.id, "the same scope: the open view is reused");
  assert.equal(invalidViewOps([{ op: "fold", mode: "namespace", key: "N", on: "yes" }]), "on");
  assert.equal(invalidViewOps([pin("A", [Infinity, 0])]), "at");
  assert.equal(invalidViewOps([{ op: "fold", mode: "namespace", key: "N", on: true }, pin("A", [1, 2])]), null);
  const kept = book.arrange(view.id, [{ op: "fold", mode: "namespace", key: "N", on: true }], "Bob");
  assert.deepEqual(kept, [{ id: view.id, what: "kept", by: "Bob" }]);
  assert.ok(view.kept);
  assert.equal(book.arrange(view.id, [{ op: "fold", mode: "namespace", key: "N", on: true }], "Bob"), null, "folded already");
  assert.deepEqual(book.arrange(view.id, [pin("N.d", [3, 4])], "Bob"), [], "kept already: nothing new");
  // each view its own pins and folds
  assert.deepEqual(book.project().pins.namespace.nodes, {});
  assert.deepEqual(view.folds.namespace, ["N"]);
  const v = { pins: { namespace: { nodes: {}, clusters: {} }, module: { nodes: {}, clusters: {} } }, folds: { namespace: ["A", "B"], module: [] }, hidden: { namespace: [] as string[], module: [] as string[] } };
  assert.ok(applyViewOps(v, diffFolds("namespace", ["A", "B"], ["B", "C"])));
  assert.deepEqual(v.folds.namespace.sort(), ["B", "C"]);
  assert.ok(applyViewOps(v, [pin("x", [1, 1]), { op: "clear" }]));
  assert.deepEqual(v.pins.namespace.nodes, {}, "a clear drops the pins");
  assert.deepEqual(v.folds.namespace.sort(), ["B", "C"], "and leaves the folds");
});

test("a view nobody keeps goes when no page has had it open for a while; a named one stays", () => {
  const book = new ViewBook();
  const a = book.open(parseQuery("uses(A)"), null, 0).view;
  const b = book.open(parseQuery("uses(B)"), null, 0).view;
  book.seen([a.id], 9000);
  assert.deepEqual(book.sweep(10000, 8000).map((c) => [c.id, c.what]), [[b.id, "gone"]]);
  assert.ok(book.get(a.id));
  assert.deepEqual(book.rename(a.id, "Mine", "Carol"), [{ id: a.id, what: "kept", by: "Carol" }, { id: a.id, what: "renamed", by: "Carol", was: null }]);
  assert.deepEqual(book.sweep(1e9, 8000), []);
  assert.equal(viewTitle(a), "Mine");
  // deleting is for kept views only, never the Project
  assert.match(book.remove(PROJECT, "Carol") as string, /cannot be deleted/);
  const o = book.open(parseQuery("uses(C)"), null, 0).view;
  assert.match(book.remove(o.id, "Carol") as string, /not kept/);
  assert.equal((book.remove(a.id, "Carol") as { what: string }).what, "deleted");
  assert.match(book.remove(a.id, "Carol") as string, /There is no view/);
});

/** A target's view as marking made one before 2026-10-12: kept, on its review set, linked to it and
 *  focused on it, named by it. */
const oldReviewView = (target: string): ViewData => ({ id: `review:${target}`, name: null, scope: reviewScope(target), clustering: "namespace", pins: emptyLayouts(), folds: { namespace: [], module: [] }, hidden: { namespace: [], module: [] }, by: null, at: "2026-10-01T00:00:00.000Z", kept: true, targets: [target], focus: target });

test("marking a target makes no view; a click gives it a temporary one; unmarked, its view stays, unlinked; duplicates copy the arrangement", () => {
  const book = new ViewBook();
  assert.deepEqual(book.syncTargets(["N.t", "Q.s"]), [], "marking makes nothing");
  assert.deepEqual([book.list().map((v) => v.id), book.viewOf("N.t"), book.viewOf("Q.s")], [[PROJECT], undefined, undefined]);
  // a click on N.t: a temporary view of its TCB, linked to it, titled by its scope, a ★ beside
  const r = book.openTarget("N.t", "Alice", 0).view;
  assert.deepEqual([printQuery(r.scope), r.kept, r.targets, r.focus, viewTitle(r)], ["tcb(N.t)", false, ["N.t"], "N.t", "TCB of N.t"]);
  book.arrange(r.id, [pin("N.d", [1, 2])], "A");
  assert.equal(book.get(r.id)!.kept, true, "a pin keeps it, and its link with it");
  const copy = book.create("My review", "Bob", { from: r.id });
  assert.ok(typeof copy !== "string");
  assert.deepEqual(copy.pins.namespace.nodes, { "N.d": [1, 2] });
  assert.equal(copy.targets, undefined, "a copy is a board of one's own, not the target's");
  // Q.s, linked to a view by hand, then unmarked: its view stays, kept, no longer the target's
  // (ViewSpec decision 29)
  const q = book.create("Q closely", "Bob") as ViewData;
  book.link(q.id, "Q.s", "Bob");
  assert.deepEqual(book.syncTargets(["N.t"]).map((c) => [c.id, c.what, c.target]), [[q.id, "unlinked", "Q.s"]]);
  assert.deepEqual([book.get(q.id)!.kept, book.get(q.id)!.targets, viewTitle(book.get(q.id)!)], [true, undefined, "Q closely"]);
  // marked again: nothing links it again, nor makes one
  assert.deepEqual(book.syncTargets(["N.t", "Q.s"]), []);
  assert.equal(book.viewOf("Q.s"), undefined);
});

test("a view named review:<target>, as marking made them before, is a view as any other: left as it is, its title its scope's, never linked again by marking", () => {
  const book = new ViewBook([oldReviewView("N.t")]);
  const id = "review:N.t";
  // still the target's: the targets synced leave it as it is
  assert.deepEqual(book.syncTargets(["N.t"]), []);
  assert.deepEqual([book.viewOf("N.t")?.id, book.get(id)!.kept, viewTitle(book.get(id)!)], [id, true, "review ★N.t"]);
  // unmarked: unlinked, kept, its id and scope as they were
  assert.deepEqual(book.syncTargets([]).map((c) => [c.id, c.what, c.target]), [[id, "unlinked", "N.t"]]);
  assert.deepEqual([book.get(id)!.kept, book.get(id)!.targets, printQuery(book.get(id)!.scope)], [true, undefined, printQuery(reviewScope("N.t"))]);
  // marked again: its id names it, and still nothing links it again
  assert.deepEqual(book.syncTargets(["N.t"]), []);
  assert.equal(book.viewOf("N.t"), undefined);
  // a click gives the target a temporary view of its TCB, not that one
  const t = book.openTarget("N.t", "Alice", 0).view;
  assert.notEqual(t.id, id);
  assert.equal(printQuery(t.scope), "tcb(N.t)");
});

test("a board's memory is handed over once per set: the first page's, then the others' agree", () => {
  const book = new ViewBook();
  const v = book.open(parseQuery("tcb(A)"), null).view;
  const m1 = { set: "s1", mem: { nodes: {}, clusters: {} } };
  assert.deepEqual(book.setMemory(v.id, "namespace", null, m1), { accepted: true, current: m1 });
  // a second page that started from no memory: refused, and told what there is
  assert.deepEqual(book.setMemory(v.id, "namespace", null, { set: "s1", mem: { nodes: {}, clusters: {} } }), { accepted: false, current: m1 });
  const m2 = { set: "s2", mem: { nodes: {}, clusters: {} } };
  assert.equal((book.setMemory(v.id, "namespace", "s1", m2) as { accepted: boolean }).accepted, true);
  assert.equal(book.memoryOf(v.id, "module"), null, "per way of clustering");
  book.relayout(v.id, "A");
  assert.equal(book.memoryOf(v.id, "namespace"), null, "laid out afresh: the memory goes");
});

/** A server's views in a site directory of their own: what was sent, and the timeline. */
function server(dir: string) {
  const sent: { event: string; data: unknown }[] = [];
  const events: StoredEvent[] = [];
  const timeline = { add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: new Date().toISOString() } as StoredEvent), events[events.length - 1]) };
  const views = new Views(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data }), timeline);
  const ask = (method: string, path: string, body: unknown = null, name: string | null = "Alice", kind: "person" | "agent" = "person", query = "") =>
    views.handle({ method, path, query: new URLSearchParams(query), body, caller: { name, kind } } as Ask, "full");
  return { views, sent, events, ask };
}

test("the server: a fresh one has the Project; views are kept on disk, open ones are not", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-views-"));
  try {
    const S = server(dir);
    assert.deepEqual(S.views.book.project().pins.namespace.nodes, {}, "nothing pinned yet");
    assert.deepEqual(S.views.book.project().folds, { namespace: [], module: [] }, "folds start open");
    S.views.places.apply([{ op: "pin", mode: "module", kind: "cluster", key: "M", at: [3, 4] }]);
    assert.deepEqual(S.views.book.project().pins.module.clusters, { M: [3, 4] }, "the agents' one set of pins is the Project's");
    assert.ok(existsSync(join(dir, "views.json")));
    // a view opened on a query, arranged by Bob: kept, and the timeline says so
    const open = S.ask("POST", "/api/views/open", { scope: "tcb(N.t) except external" }, null);
    const id = (open.body as { view: { id: string } }).view.id;
    const json = S.ask("POST", "/api/views/open", { scope: { op: "except", a: { op: "tcb", of: ["N.t"] }, b: { op: "external" } } });
    assert.equal((json.body as { view: { id: string } }).view.id, id, "the same scope as JSON: the same open view");
    const memory = { set: "k1", mem: { nodes: { "N.t": [0, 0, "N"] }, clusters: { N: [0, 0, 20] } } };
    assert.equal((S.ask("POST", "/api/views/memory", { id, mode: "namespace", base: null, memory }).body as { accepted: boolean }).accepted, true);
    // the page says it is the page by its stream's secret; the others are told its public id
    S.views.pageOf = (token) => (token === "secret-of-p1" ? "p1" : null);
    assert.equal(S.ask("POST", "/api/views/arrange", { id, token: "secret-of-p1", ops: [pin("N.t", [5, 5])] }, "Bob").status, 200);
    const ops = S.sent.filter((s) => s.event === "view-ops");
    assert.deepEqual(ops.at(-1)!.data, { id, ops: [pin("N.t", [5, 5])], from: "p1", by: "Bob" });
    assert.deepEqual(S.events.map((e) => e.kind === "view" && [e.what, e.by, e.view, e.scope]), [["created", "Bob", id, "tcb(N.t) except external"]]);
    // what another page is told
    const list = S.sent.filter((s) => s.event === "views").at(-1)!.data as { views: { id: string; kept: boolean }[]; changes: { what: string }[] };
    assert.ok(list.views.find((v) => v.id === id)!.kept);
    assert.deepEqual(list.changes.map((c) => c.what), ["kept"]);
    // one more opened and not kept, then a restart: the kept one is there with its memory, the other is not
    const other = (S.ask("POST", "/api/views/open", { scope: "uses(N.t)" }).body as { view: { id: string } }).view.id;
    const S2 = server(dir);
    assert.ok(S2.views.book.get(id)?.kept);
    assert.equal(S2.views.book.get(other), undefined);
    assert.deepEqual(S2.views.book.memoryOf(id, "namespace"), memory);
    assert.deepEqual(S2.views.book.get(id)!.pins.namespace.nodes, { "N.t": [5, 5] });
    assert.deepEqual(S2.views.book.project().pins.module.clusters, { M: [3, 4] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a kept view that cannot be read at the start is kept aside, said, and written back as it was: never dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-views-"));
  try {
    const record = (id: string, scope: unknown, more: object = {}) => ({ id, name: id, scope, clustering: "namespace", pins: emptyLayouts(), folds: { namespace: [], module: [] }, by: "Alice", at: "2026-10-07T10:00:00.000Z", kept: true, ...more });
    const deep = (n: number): unknown => (n ? { op: "tcb", of: deep(n - 1) } : { op: "decl", names: ["N.t"] });
    const picks = parseQuery(Array.from({ length: 30 }, (_, i) => `decl(N.n${i})`).join(" or "));
    const stored = {
      layoutVersion: LAYOUT_VERSION,
      views: [record("vgood", { op: "all" }), record("vpicks", picks), record("vdeep", deep(40)), record("vbroken", { op: "all" }, { pins: "nowhere" }), "not a view"],
      authors: { vdeep: { namespace: { nodes: { "N.t": { by: "Zoe", at: "x" } }, clusters: {} }, module: { nodes: {}, clusters: {} } } },
    };
    writeFileSync(join(dir, "views.json"), JSON.stringify(stored));
    const S = server(dir);
    assert.ok(S.views.book.get("vgood") && S.views.book.get("vpicks"), "a 30-pick scope is read back");
    assert.deepEqual(S.views.unreadable.map((u) => [u.id, u.why.match(/nests 40|pins|not a view/)?.[0]]), [["vdeep", "nests 40"], ["vbroken", "pins"], [null, "not a view"]]);
    const listed = S.ask("GET", "/api/views").body as { unreadable: { id: string | null; why: string }[] };
    assert.deepEqual(listed.unreadable.map((u) => u.id), ["vdeep", "vbroken", null], "listed, with why");
    // the next save writes them back as they were, flagged; a restart finds them again
    assert.equal(S.ask("POST", "/api/views/create", { name: "New" }).status, 200);
    const saved = JSON.parse(readFileSync(join(dir, "views.json"), "utf8"));
    const back = saved.views.filter((v: { unreadable?: string }) => v.unreadable);
    assert.deepEqual(back.map((v: { id?: string }) => v.id ?? null), ["vdeep", "vbroken", null]);
    assert.deepEqual(back[0].scope, deep(40), "as it was");
    assert.ok(saved.authors.vdeep, "its pins' authors with it");
    assert.equal(server(dir).views.unreadable.length, 3);
    // once it can be read (here: mended by hand), it is a view again and the flag goes
    saved.views = saved.views.map((v: { id?: string }) => (v.id === "vdeep" ? { ...v, scope: { op: "all" } } : v));
    writeFileSync(join(dir, "views.json"), JSON.stringify(saved));
    const S2 = server(dir);
    assert.ok(S2.views.book.get("vdeep"));
    S2.ask("POST", "/api/views/rename", { id: "vdeep", name: "Mended" });
    assert.equal(JSON.parse(readFileSync(join(dir, "views.json"), "utf8")).views.find((v: { id: string }) => v.id === "vdeep").unreadable, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the server's endpoints: names where something is recorded, agents within --agents, re-layout per board", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-views-"));
  try {
    const S = server(dir);
    assert.equal(S.ask("POST", "/api/views/create", { name: "Mine" }, null).status, 401);
    const made = S.ask("POST", "/api/views/create", { name: "Mine", scope: "ns(N)" });
    assert.equal(made.status, 200);
    const id = (made.body as { view: { id: string } }).view.id;
    assert.equal(S.ask("POST", "/api/views/scope", { id, scope: "ns(N" }).status, 400, "a scope that cannot be read");
    assert.match((S.ask("POST", "/api/views/scope", { id, scope: "ns(N" }).body as { error: string }).error, /at 4/);
    assert.equal(S.ask("POST", "/api/views/scope", { id, scope: "ns(N) except trusted" }, "Carol").status, 200);
    const change = S.sent.filter((s) => s.event === "views").at(-1)!.data as { changes: unknown[] };
    assert.deepEqual(change.changes, [{ id, what: "scope", by: "Carol" }], "who changed the scope, for the note");
    assert.equal(S.ask("POST", "/api/views/clustering", { id, clustering: "module" }).status, 200);
    assert.equal(S.views.book.get(id)!.clustering, "module");
    assert.equal(S.ask("POST", "/api/views/rename", { id, name: "Ours" }).status, 200);
    // re-layout drops this board's pins only
    S.ask("POST", "/api/views/arrange", { id, ops: [pin("N.d", [1, 1], "module")] });
    S.ask("POST", "/api/views/arrange", { id: PROJECT, ops: [pin("N.e", [2, 2])] });
    assert.equal(S.ask("POST", "/api/views/relayout", { id }).status, 200);
    assert.deepEqual(S.views.book.get(id)!.pins.module.nodes, {});
    assert.deepEqual(S.views.book.project().pins.namespace.nodes, { "N.e": [2, 2] });
    // agents: on a full server, what people do (AgentSpec decision 9), deleting and laying out
    // afresh included, marked as theirs; below full, none of it
    assert.equal(S.ask("POST", "/api/views/arrange", { id, ops: [pin("N.d", [1, 1])] }, "Claude", "agent").status, 200);
    const below = (path: string, level: "read" | "advise") => S.views.handle({ method: "POST", path, query: new URLSearchParams(), body: { id, scope: "all" }, caller: { name: "Claude", kind: "agent" } }, level).status;
    for (const path of ["/api/views/scope", "/api/views/delete", "/api/views/relayout"]) for (const level of ["read", "advise"] as const) assert.equal(below(path, level), 403, `${path} at ${level}`);
    const other = (S.ask("POST", "/api/views/create", { name: "Theirs" }, "Claude", "agent").body as { view: { id: string } }).view.id;
    assert.equal(S.ask("POST", "/api/views/relayout", { id: other }, "Claude", "agent").status, 200);
    assert.equal(S.ask("POST", "/api/views/delete", { id: other }, "Claude", "agent").status, 200);
    assert.deepEqual(
      S.events.filter((e) => e.kind === "view" && e.view === other).map((e) => (e.kind === "view" ? [e.what, e.by, e.agent ?? false] : null)),
      [["created", "Claude", true], ["relayout", "Claude", true], ["deleted", "Claude", true]],
    );
    assert.equal(S.ask("POST", "/api/views/delete", { id: PROJECT }).status, 400);
    assert.equal(S.ask("POST", "/api/views/delete", { id }).status, 200);
    assert.equal(S.ask("GET", "/api/views/view", null, "Alice", "person", `id=${id}`).status, 404);
    assert.deepEqual(
      S.events.filter((e) => e.kind === "view" && e.view === id).map((e) => (e.kind === "view" ? [e.what, e.by, e.name, e.was ?? null] : null)),
      [["created", "Alice", "Mine", null], ["scope", "Carol", "Mine", null], ["renamed", "Alice", "Ours", "Mine"], ["relayout", "Alice", "Ours", null], ["deleted", "Alice", null, "Ours"]],
    );
    // the list a page reads, and a view in full
    const all = S.ask("GET", "/api/views").body as { views: { id: string }[] };
    assert.deepEqual(all.views.map((v) => v.id), [PROJECT]);
    const project = S.ask("GET", "/api/views/view", null, "Alice", "person", `id=${PROJECT}`).body as { view: { scope: Query } };
    assert.deepEqual(project.view.scope, { op: "all" });
    assert.ok(JSON.parse(readFileSync(join(dir, "views.json"), "utf8")).views.length === 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("who dropped each pin is kept per view, across a restart, and never sent to pages", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-views-"));
  try {
    const S = server(dir);
    const P = S.views.places;
    assert.ok(P.apply([pin("N.d", [1, 2])], { by: "Zoe" }));
    const zoe = P.authorOf("namespace", "node", "N.d")!;
    assert.equal(zoe.by, "Zoe");
    assert.deepEqual(server(dir).views.places.authorOf("namespace", "node", "N.d"), zoe, "kept across a restart");
    assert.equal(P.authorOf("namespace", "node", "N.gone"), null);
    assert.ok(P.apply([pin("N.e", [3, 3])], { by: "Claude", agent: true }));
    assert.deepEqual({ ...P.authorOf("namespace", "node", "N.e"), at: "" }, { by: "Claude", agent: true, at: "" });
    assert.ok(P.apply([pin("N.e", [4, 4])]), "dropped again where the server does not know by whom");
    assert.equal(P.authorOf("namespace", "node", "N.e"), null);
    // per view: a page's drop on another board, under the page's name
    const id = (S.ask("POST", "/api/views/open", { scope: "ns(N)" }).body as { view: { id: string } }).view.id;
    S.ask("POST", "/api/views/arrange", { id, ops: [pin("N.d", [9, 9])] }, "Bob");
    assert.equal(S.views.placesOf(id).authorOf("namespace", "node", "N.d")?.by, "Bob");
    assert.equal(P.authorOf("namespace", "node", "N.d")?.by, "Zoe", "the Project's pin is another");
    S.ask("POST", "/api/views/arrange", { id, ops: [{ op: "unpin", mode: "namespace", kind: "node", key: "N.d" }] }, "Bob");
    assert.equal(S.views.placesOf(id).authorOf("namespace", "node", "N.d"), null, "let go: no author");
    // kept on disk, gone with a re-layout, never in what a page reads
    S.ask("POST", "/api/views/arrange", { id, ops: [pin("N.x", [1, 1])] }, "Bob");
    assert.equal(server(dir).views.placesOf(id).authorOf("namespace", "node", "N.x")?.by, "Bob");
    const page = JSON.stringify([S.ask("GET", "/api/views/view", null, "Bob", "person", `id=${PROJECT}`).body, S.ask("GET", "/api/views").body, S.sent]);
    assert.ok(!page.includes('"authors"') && !page.includes('"Zoe"'), "authors are the server's");
    S.ask("POST", "/api/views/relayout", { id });
    assert.equal(S.views.placesOf(id).authorOf("namespace", "node", "N.x"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("who made a view and who dropped a pin keep their marks — an agent's, a personal link's — and a rescoping is on the timeline, a target's view's too", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-views-"));
  try {
    const S = server(dir);
    const IVY = "0a1b2c3d4e";
    const ivy = (path: string, body: unknown) => S.views.handle({ method: "POST", path, query: new URLSearchParams(), body, caller: { name: "Ivy", kind: "person", person: IVY } } as Ask, "full");
    // made by someone invited by a personal link, by an agent, by a guest: as the record keeps it
    const mine = (ivy("/api/views/create", { name: "Ivy's", scope: "ns(N)" }).body as { view: { id: string } }).view.id;
    const theirs = (S.ask("POST", "/api/views/create", { name: "Claude's" }, "Claude", "agent").body as { view: { id: string } }).view.id;
    const opened = (S.ask("POST", "/api/views/open", { scope: "uses(N.t)" }, "Claude", "agent").body as { view: { id: string } }).view.id;
    const guest = (S.ask("POST", "/api/views/create", { name: "Bob's" }, "Bob").body as { view: { id: string } }).view.id;
    const marks = (id: string) => {
      const v = S.views.book.get(id)!;
      return [v.by, v.agent ?? false, v.person ?? null];
    };
    assert.deepEqual([marks(mine), marks(theirs), marks(opened), marks(guest)], [["Ivy", false, IVY], ["Claude", true, null], ["Claude", true, null], ["Bob", false, null]]);
    // a pin keeps the personal link of whoever dropped it
    assert.equal(ivy("/api/views/arrange", { id: guest, ops: [pin("N.d", [1, 1])] }).status, 200);
    assert.deepEqual({ ...S.views.book.authorOf(guest, "namespace", "node", "N.d"), at: "" }, { by: "Ivy", person: IVY, at: "" });
    // kept across a restart
    const S2 = server(dir);
    assert.deepEqual([S2.views.book.get(mine)!.person, S2.views.book.get(theirs)!.agent, S2.views.book.authorOf(guest, "namespace", "node", "N.d")?.person], [IVY, true, IVY]);
    // a rescoping is a view event of the timeline, with who did it — a target's view's as any
    // view's since its scope can be changed (ViewSpec decision 28)
    assert.equal(ivy("/api/views/scope", { id: mine, scope: "ns(N) except trusted" }).status, 200);
    const its = S.views.openTarget("N.t", "Ivy").id;
    assert.equal(ivy("/api/views/scope", { id: its, scope: "tcb(N.t) except external" }).status, 200);
    const scoped = S.events.filter((e) => e.kind === "view" && e.what === "scope");
    assert.deepEqual(scoped.map((e) => (e.kind === "view" ? [e.view, e.by, e.person ?? null, e.scope] : null)), [[mine, "Ivy", IVY, "ns(N) except trusted"], [its, "Ivy", IVY, "tcb(N.t) except external"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a view nobody keeps lives while a page sits on it, and a page that closed does not keep it", () => {
  const sent: Peer[][] = [];
  const presence = new Presence((peers) => sent.push(peers));
  const book = new ViewBook();
  const v = book.open(parseQuery("uses(N.t)"), null, 0).view;
  const view = (tabs: string[]) => cleanView({ mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: tabs[0] ?? null, tabs });
  presence.beat("s1", "Alice", view([PROJECT, v.id]), false);
  // nothing new is said for a while: what is open now still counts
  for (const t of [5000, 10000, 15000]) {
    book.seen(presence.list().flatMap((p) => [...(p.view?.tabs ?? []), ...(p.view?.view ? [p.view.view] : [])]), t);
    assert.deepEqual(book.sweep(t, 8000), []);
  }
  // the page reloads: its stream closes, and a heartbeat it sent while closing comes after
  presence.drop("s1");
  presence.beat("s1", "Alice", view([PROJECT, v.id]), false);
  assert.deepEqual(presence.list(), [], "a page whose stream closed is not brought back by a late heartbeat");
  assert.deepEqual(book.sweep(30000, 8000).map((c) => c.what), ["gone"]);
  // a page whose stream opens again (a lost connection) is back
  presence.open("s1");
  presence.beat("s1", "Alice", view([PROJECT]), false);
  assert.equal(presence.list().length, 1);
  // an agent that said it leaves comes back with its next request
  presence.agentBeat("Claude");
  presence.drop(agentSession("Claude"));
  presence.agentBeat("Claude");
  assert.ok(presence.list().some((p) => p.agent));
});

test("a target's view's scope is editable as any view's (ViewSpec decision 28): left as people make it", () => {
  const book = new ViewBook([oldReviewView("N.t")]);
  const id = "review:N.t";
  assert.equal(printQuery(book.get(id)!.scope), printQuery(reviewScope("N.t")));
  assert.deepEqual(book.setScope(id, parseQuery("tcb(N.t) except external"), "Alice"), [{ id, what: "scope", by: "Alice" }]);
  assert.equal(printQuery(book.get(id)!.scope), "tcb(N.t) except external");
  // the targets synced again leave it as it is
  assert.deepEqual(book.syncTargets(["N.t"]), []);
  assert.equal(printQuery(book.get(id)!.scope), "tcb(N.t) except external");
  // its name too; only the Project keeps its name
  assert.deepEqual((book.rename(id, "N.t, closely", "Alice") as { what: string }[]).map((c) => c.what), ["renamed"]);
  assert.match(String(book.rename(PROJECT, "Everything", "Alice")), /Project keeps its name/);
  // any other view's scope changes; a view not kept yet is kept by it (ViewSpec decision 6), as by
  // a pin: what was added to it from the canvas's menu outlives the pages that had it open
  const { view } = book.open(parseQuery("ns(N)"), "Alice");
  assert.equal(book.get(view.id)!.kept, false);
  assert.deepEqual(book.setScope(view.id, parseQuery("ns(N) except external"), "Alice"), [
    { id: view.id, what: "scope", by: "Alice" },
    { id: view.id, what: "kept", by: "Alice" },
  ]);
  assert.equal(book.get(view.id)!.kept, true);
  assert.deepEqual(book.setScope(view.id, parseQuery("ns(N)"), "Bob"), [{ id: view.id, what: "scope", by: "Bob" }]);
  // a rename the server carries into a scope is no one's work: it keeps nothing
  const other = book.open(parseQuery("ns(M)"), "Alice").view;
  assert.deepEqual(book.setScope(other.id, parseQuery("ns(M) except external"), null, false), [{ id: other.id, what: "scope", by: null }]);
  assert.equal(book.get(other.id)!.kept, false);
});

test("a view opened at a past build by an agent keeps both: the build it shows, and who made it", () => {
  const book = new ViewBook();
  const q = parseQuery("ns(N)");
  const { view, change } = book.open(q, "Claude", Date.now(), { agent: true, version: 3, clustering: "module" });
  assert.deepEqual([view.version, view.agent, view.clustering, view.kept, change?.what], [3, true, "module", false, "opened"]);
  // the same query at the same build is the same view; at the latest, another
  assert.equal(book.open(q, "Alice", Date.now(), { version: 3 }).view.id, view.id);
  const latest = book.open(q, "Alice", Date.now(), { person: "0a1b2c3d4e" }).view;
  assert.notEqual(latest.id, view.id);
  assert.deepEqual([latest.version, latest.person], [undefined, "0a1b2c3d4e"]);
});
