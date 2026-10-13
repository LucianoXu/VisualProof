// Boards on a query (ViewSpec decisions 6 and 13), and the address
// (ViewSpec decision 10): a board on a query holds what it says, laid out on its own by the same
// rules; the address holds the view, the tool, the selection and what the panel tells of.

import assert from "node:assert/strict";
import { test } from "node:test";
import { boardLayout, boardSet } from "../src/shared/board.ts";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { parseQuery } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { decodeState, encodeState } from "../src/web/src/state.ts";
import type { ViewState } from "../src/web/src/state.ts";

test("a state survives the address, whatever the names hold", () => {
  const names = ["A.«b.c».d", "x y", "∀ε", "a+b&c=d", "Foo.bar'"];
  const states: ViewState[] = [
    { view: "project", scope: null, mode: "tcb", picks: `tcb(${names[0]})`, shown: { decl: names[0] } },
    { view: "review:A.«b.c».d", scope: null, mode: "plain", picks: `decl(${names[0]}) or decl("${names[1]}") or decl(${names[2]})`, shown: { decl: names[2] } },
    { view: null, scope: `tcb(${names[3]}, "${names[1]}") except external`, mode: "deps", picks: null, shown: null },
    { view: "v1x2y3z", scope: null, mode: "apps", picks: `usedBy("${names[1]}")`, shown: { decl: names[1] } },
    { view: "v1x2y3z", scope: null, mode: "apps", picks: `usedBy("${names[1]}") or usedBy(${names[4]})`, shown: { decl: names[1] } },
  ];
  for (const s of states) assert.deepEqual(decodeState("#" + encodeState(s)), s);
  assert.equal(decodeState(""), null);
  assert.equal(decodeState("#mode=nonsense"), null);
  // a link written by hand names the view alone
  assert.deepEqual(decodeState("#v=review:N.t"), { view: "review:N.t", scope: null, mode: "tcb", picks: null, shown: null });
  assert.equal(decodeState("#x=1"), null);
  // with no view: the Project
  assert.deepEqual(decodeState("#mode=tcb&s=N.d"), { view: null, scope: null, mode: "tcb", picks: "tcb(N.d)", shown: { decl: "N.d" } });
});

/** t uses d (statement), d uses e (body), t's proof uses p; x is unrelated; E is external. */
function world() {
  const nodes: ViewNode[] = [
    { name: "N.t", kind: "theorem", module: "M", ax: 0 },
    { name: "N.d", kind: "def", module: "M", ax: 0 },
    { name: "N.e", kind: "def", module: "M", ax: 0 },
    { name: "N.p", kind: "theorem", module: "M", ax: 0 },
    { name: "N.x", kind: "def", module: "M", ax: 0 },
    { name: "Ext.E", kind: "def", module: "Mathlib.X", ax: 0, ext: true },
  ];
  const edges = new Int32Array([0, 1, SITE_STMT, 1, 2, SITE_BODY, 0, 3, SITE_PROOF, 2, 5, SITE_STMT, 4, 1, SITE_STMT]);
  const meta = { nodes, projectCount: 5, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: 5 } as unknown as ViewMeta;
  return new Graph(meta, edges);
}

const sub = (g: Graph, q: string) => boardSet(g, emptyReview(), parseQuery(q)).sub!;

test("a board on a query holds what it says, numbered on its own", () => {
  const g = world();
  const names = (s: ReturnType<typeof sub>) => s.graph.nodes.map((v) => v.name);
  // TCB: statement and bodies, proofs skipped
  const tcb = sub(g, "tcb(N.t)");
  assert.deepEqual(names(tcb), ["N.t", "N.d", "N.e", "Ext.E"]);
  assert.equal(tcb.graph.projectCount, 3);
  assert.ok(tcb.graph.isExt(3));
  // dependencies: the proof too
  assert.deepEqual(names(sub(g, "uses(N.t)")), ["N.t", "N.d", "N.e", "N.p", "Ext.E"]);
  // users of d
  assert.deepEqual(names(sub(g, "usedBy(N.d)")), ["N.t", "N.d", "N.x"]);
  // without the outside world
  assert.deepEqual(names(sub(g, "tcb(N.t) except external")), ["N.t", "N.d", "N.e"]);
  // edges only among its own nodes, mapped both ways
  for (let u = 0; u < tcb.graph.n; u++) {
    assert.equal(tcb.toSub[tcb.toFull[u]], u);
    for (let e = tcb.graph.outStart[u]; e < tcb.graph.outStart[u + 1]; e++) assert.ok(tcb.graph.outDst[e] < tcb.graph.n);
  }
  assert.equal(tcb.toSub[4], -1);
});

test("a board is laid out by the same rules: the theorem above what it rests on", () => {
  const g = world();
  const s = sub(g, "uses(N.t)");
  const L = boardLayout(s.graph, "namespace", "k", null).layout;
  const y = (name: string) => L.y[s.graph.byName.get(name)!];
  assert.ok(y("N.t") < y("N.d") && y("N.d") < y("N.e"), "not ordered by dependency");
  assert.equal(L.x.length, 5);
});
