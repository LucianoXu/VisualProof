// What is lit on a board, and what Zoom in opens (the owner's decision, 2026-10-08): the selection's
// query is evaluated on the whole graph and cut to what the board holds, so that a path through a
// declaration the board leaves out — a lemma used only in a proof, a trusted definition on a Review
// view — still counts, and the view Zoom in opens holds exactly what was lit. Zoom in is offered
// only where it would show something else than the board (the sets compared, not the texts).

import assert from "node:assert/strict";
import { test } from "node:test";
import { boardSet, lightUp, zoomScope } from "../src/shared/board.ts";
import type { BoardSet } from "../src/shared/board.ts";
import type { Cluster, ClusterMode, Kind, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { evaluate, parseQuery, printQuery, reviewScope, within } from "../src/shared/query.ts";
import type { Query } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import type { ReviewData } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import type { Mode } from "../src/shared/viewgraph.ts";
import { clusterPick, declPick } from "../src/web/src/selection.ts";

const TOOLS: Mode[] = ["plain", "tcb", "deps", "apps"];

/** t's statement uses d, f and the trusted u; its proof uses the lemma p. d's body uses e, and a
 *  proof inside it uses p too; p's statement uses f; e uses the outside world's E; u's body uses r.
 *  x uses d, s uses x. Namespaces N, Q, T; modules M.A (t, d, p), M.B (e, f, x, r), Q (s), T (u). */
function world(): Graph {
  const nodes: ViewNode[] = [
    { name: "N.t", kind: "theorem", module: "M.A", ax: 0 },
    { name: "N.d", kind: "def", module: "M.A", ax: 0 },
    { name: "N.e", kind: "def", module: "M.B", ax: 0 },
    { name: "N.p", kind: "theorem", module: "M.A", ax: 0 },
    { name: "N.f", kind: "def", module: "M.B", ax: 0 },
    { name: "N.x", kind: "def", module: "M.B", ax: 0 },
    { name: "Q.s", kind: "theorem", module: "Q", ax: 0 },
    { name: "T.u", kind: "def", module: "T", ax: 0 },
    { name: "N.r", kind: "def", module: "M.B", ax: 0 },
    { name: "Ext.E", kind: "def", module: "Mathlib.X", ax: 0, ext: true },
    { name: "Ext.F", kind: "def", module: "Mathlib.Y", ax: 0, ext: true },
  ];
  const E = [
    [0, 1, SITE_STMT], [0, 4, SITE_STMT], [0, 3, SITE_PROOF], [0, 7, SITE_STMT],
    [1, 2, SITE_BODY], [1, 3, SITE_PROOF],
    [2, 9, SITE_STMT],
    [3, 4, SITE_STMT],
    [5, 1, SITE_STMT],
    [6, 5, SITE_STMT],
    [7, 8, SITE_BODY],
  ];
  const meta = { nodes, projectCount: 9, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: E.length } as unknown as ViewMeta;
  return new Graph(meta, new Int32Array(E.flat()));
}

/** The review the boards are read with: the project's T trusted, besides the outside world. */
function trustingT(): ReviewData {
  const d = emptyReview();
  d.trusted = [...d.trusted, "T"].sort();
  return d;
}

const g = world();
const d = trustingT();
const board = (scope: string | Query) => boardSet(g, d, typeof scope === "string" ? parseQuery(scope) : scope);
/** The names lit by `q` on a board, in the board's own numbering read back to names. */
const lit = (bs: BoardSet, q: string) => {
  const L = lightUp(g, d, bs, parseQuery(q));
  const G = bs.sub ? bs.sub.graph : g;
  assert.equal(L.set.length, G.n, "numbered as the board's graph");
  const names = G.nodes.filter((_, j) => L.set[j]).map((v) => v.name);
  assert.equal(L.count, names.length);
  return names;
};
/** What a query held on the board's own graph, as lighting up was computed before. */
const onBoardOnly = (bs: BoardSet, q: string) => {
  const G = bs.sub!.graph;
  const s = evaluate(parseQuery(q), { g: G, review: d });
  return G.nodes.filter((_, j) => s[j]).map((v) => v.name);
};
const count = (s: Uint8Array) => s.reduce((a, b) => a + b, 0);

test("what is lit is computed on the whole graph and cut to the board: a path through what the board leaves out counts", () => {
  // the TCB of t holds no proof: p, which d's body uses inside a proof, is not on it
  const tcb = board("tcb(N.t)");
  assert.deepEqual(tcb.sub!.graph.nodes.map((v) => v.name), ["N.t", "N.d", "N.e", "N.f", "T.u", "N.r", "Ext.E"]);
  // what d uses reaches f through the lemma p; the board's own edges did not
  assert.deepEqual(lit(tcb, "uses(N.d)"), ["N.d", "N.e", "N.f", "Ext.E"]);
  assert.deepEqual(onBoardOnly(tcb, "uses(N.d)"), ["N.d", "N.e", "Ext.E"]);
  assert.deepEqual(lit(tcb, "usedBy(N.f)"), ["N.t", "N.d", "N.f"]);
  assert.deepEqual(onBoardOnly(tcb, "usedBy(N.f)"), ["N.t", "N.f"]);
  // TCB never passes through a proof, on the whole graph either
  assert.deepEqual(lit(tcb, "tcb(N.d)"), ["N.d", "N.e", "Ext.E"]);

  // a board of a target's review set leaves out what is trusted: r is reached through the trusted u, and still lit
  const rv = board(reviewScope("N.t"));
  assert.deepEqual(rv.sub!.graph.nodes.map((v) => v.name), ["N.t", "N.d", "N.e", "N.f", "N.r"]);
  assert.deepEqual(lit(rv, "tcb(N.t)"), ["N.t", "N.d", "N.e", "N.f", "N.r"]);
  assert.deepEqual(onBoardOnly(rv, "tcb(N.t)"), ["N.t", "N.d", "N.e", "N.f"]);
  assert.deepEqual(lit(rv, "usedBy(N.r)"), ["N.t", "N.r"]);
  assert.deepEqual(lit(rv, "uses(N.d)"), ["N.d", "N.e", "N.f"]);

  // a cluster's pick stands for all its declarations, those the board leaves out too: on a board
  // of e and u, N's circle holds e alone, and what N uses holds u, which t uses
  assert.deepEqual(lit(board("decl(N.e, T.u)"), "uses(ns(N) except external)"), ["N.e", "T.u"]);

  // the Project without the outside world (`e`): nothing outside is lit, though the board is the
  // whole graph's layout
  const inside = board("all except external");
  assert.ok(inside.whole && !inside.outside && !inside.sub);
  assert.deepEqual(lit(inside, "tcb(N.t)"), ["N.t", "N.d", "N.e", "N.f", "T.u", "N.r"]);
  assert.deepEqual(lit(inside, "uses(N.e)"), ["N.e"]);
  assert.deepEqual(lit(inside, "decl(Ext.E)"), []);
  // with it, everything the query holds
  assert.deepEqual(lit(board("all"), "uses(N.e)"), ["N.e", "Ext.E"]);
});

/** A graph of `n` declarations, the last `ext` outside the project, with random edges at random
 *  sites, in namespaces A, B, C and modules under M.A, M.B, X. */
function randomWorld(seed: number, n: number, ext: number): Graph {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const kinds: Kind[] = ["theorem", "def", "structure"];
  const nodes: ViewNode[] = [];
  for (let i = 0; i < n; i++) {
    const out = i >= n - ext;
    const v: ViewNode = out
      ? { name: `${pick(["Nat", "Set", "A"])}.o${i}`, kind: "def", module: pick(["Init.X", "Mathlib.Y"]), ax: 0, ext: true }
      : { name: `${pick(["A", "B", "C"])}.${pick(["P", "Q"])}.n${i}`, kind: pick(kinds), module: pick(["M.A", "M.B", "X"]), ax: 0 };
    nodes.push(v);
  }
  const edges: number[] = [];
  for (let u = 0; u < n - ext; u++) {
    const k = Math.floor(rnd() * 4);
    for (let e = 0; e < k; e++) {
      const v = Math.floor(rnd() * n);
      if (v !== u) edges.push(u, v, pick([SITE_STMT, SITE_BODY, SITE_PROOF, SITE_PROOF]));
    }
  }
  const meta = { nodes, projectCount: n - ext, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: edges.length / 3 } as unknown as ViewMeta;
  return new Graph(meta, new Int32Array(edges));
}

/** Every declaration of the graph and every cluster of both clusterings, under every tool: what is
 *  lit on the board is exactly what the view Zoom in opens holds; where it opens none, what is lit
 *  is nothing or the board itself; and in that view the same selection lights everything and
 *  offers no Zoom in again. */
function zoomHoldsWhatIsLit(G: Graph, review: ReviewData, scopes: Query[]): number {
  const clusters = new Map<string, ClusterMode>();
  for (const v of G.nodes) {
    const parts = v.name.split(".");
    for (let k = 1; k < parts.length; k++) clusters.set((v.ext ? "⟨external⟩." : "") + parts.slice(0, k).join("."), "namespace");
    const mparts = v.module.split(".");
    for (let k = 1; k <= mparts.length; k++) clusters.set((v.ext ? "⟨external⟩." : "") + mparts.slice(0, k).join("."), "module");
  }
  clusters.set("⟨external⟩", "namespace");
  const cl = (key: string): Cluster => ({ key, label: key, parent: -1, depth: 0, x: 0, y: 0, lx: 0, ly: 0, r: 1, count: 0, ext: key.startsWith("⟨external⟩") });
  let checked = 0;
  for (const scope of scopes) {
    const bs = boardSet(G, review, scope);
    for (const tool of TOOLS) {
      const picks = [...G.nodes.map((v) => declPick(tool, v.name)), ...[...clusters].map(([key, mode]) => clusterPick(tool, cl(key), mode))];
      for (const p of picks) {
        const L = lightUp(G, review, bs, p.q);
        const full = new Uint8Array(G.n);
        for (let j = 0; j < L.set.length; j++) if (L.set[j]) full[bs.sub ? bs.sub.toFull[j] : j] = 1;
        const what = `${printQuery(p.q)} on ${printQuery(scope)}`;
        assert.equal(count(full), L.count, what);
        const zs = zoomScope(p.q, scope, L, bs);
        if (zs === null) {
          assert.ok(L.count === 0 || L.count === bs.count, `${what}: Zoom in is offered where it shows something else`);
          if (L.count) assert.deepEqual(full, bs.set, what);
        } else {
          const zoomed = boardSet(G, review, zs);
          assert.deepEqual(zoomed.set, full, `${what}: Zoom in holds ${zoomed.count}, ${L.count} lit`);
          // in the view opened, the same selection lights all of it: no Zoom in again
          const again = lightUp(G, review, zoomed, p.q);
          assert.equal(again.count, zoomed.count, what);
          assert.equal(zoomScope(p.q, zs, again, zoomed), null, what);
        }
        checked++;
      }
    }
  }
  return checked;
}

test("Zoom in holds exactly what is lit: every declaration and cluster of every board, under every tool", () => {
  const scopes = [
    "all",
    "all except external",
    "tcb(N.t)",
    printQuery(reviewScope("N.t")),
    "uses(N.d)",
    "usedBy(N.f) except external",
    "ns(N) except external",
    "file(M.B)",
    "decl(N.d)",
    "tcb(N.t) except kind(theorem)",
  ].map(parseQuery);
  // every declaration of the graph, on every board, under every tool, and the clusters besides
  assert.ok(zoomHoldsWhatIsLit(g, d, scopes) > scopes.length * TOOLS.length * g.n);
  // and on graphs no one drew, with the outside world trusted and the project's B too
  for (const seed of [1, 7, 42]) {
    const G = randomWorld(seed, 70, 12);
    const r = emptyReview();
    r.trusted = [...r.trusted, "B"].sort();
    const roots = G.nodes.slice(0, 3).map((v) => v.name);
    const random = [
      "all",
      "all except external",
      `tcb(${roots[0]})`,
      printQuery(reviewScope(roots[1])),
      `uses(${roots[2]}) except trusted`,
      `usedBy(${roots[0]}, ${roots[1]})`,
      "ns(A) except external",
      "file(M.A) or ns(C.P)",
    ].map(parseQuery);
    zoomHoldsWhatIsLit(G, r, random);
  }
});

test("Zoom in is offered only where it changes something, and a view of the selection is not wrapped in itself", () => {
  const z = (scope: string | Query, q: string) => {
    const sc = typeof scope === "string" ? parseQuery(scope) : scope;
    const bs = boardSet(g, d, sc);
    const s = zoomScope(parseQuery(q), sc, lightUp(g, d, bs, parseQuery(q)), bs);
    return s && printQuery(s);
  };
  // a view that holds exactly the selection already: nothing to open ("TCB of t, and TCB of t")
  assert.equal(z("tcb(N.t)", "tcb(N.t)"), null);
  assert.equal(z("decl(N.d)", "decl(N.d)"), null);
  assert.equal(z(reviewScope("N.t"), "tcb(N.t)"), null, "the target's TCB is the whole board of its review set");
  assert.equal(z("all except external", "ns(N) or ns(Q) or ns(T) except external"), null, "the same set, said otherwise");
  // nothing lit: nothing to open
  assert.equal(z(reviewScope("N.t"), "decl(Q.s)"), null);
  // what lies within the board needs none of its conditions
  assert.equal(z(reviewScope("N.t"), "decl(N.d)"), "decl(N.d)");
  assert.equal(z("tcb(N.t)", "tcb(N.d)"), "tcb(N.d)");
  // what reaches past it keeps them all, so that the view holds what was lit
  assert.equal(z(reviewScope("N.t"), "uses(N.d)"), `uses(N.d) and (${printQuery(reviewScope("N.t"))})`);
  assert.equal(z("tcb(N.t)", "uses(N.d)"), "uses(N.d) and tcb(N.t)");
  assert.equal(z("all", "uses(N.d)"), "uses(N.d)");
  // a query among the board it is: itself
  assert.equal(printQuery(within(parseQuery("tcb(N.t) except trusted"), parseQuery("tcb(N.t) except trusted"))), "tcb(N.t) except trusted");
  // a cluster's view from its panel: the same rule
  assert.equal(z("ns(N) except external", "ns(N) except external"), null);
  assert.equal(z("all", "ns(N) except external"), "ns(N) except external");
  assert.equal(z("tcb(N.t)", "ns(N) except external"), "ns(N) except external and tcb(N.t)");
});
