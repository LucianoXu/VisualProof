// The review wherever it has a focus: the order of review, who reviewed what, and why a
// declaration is in a TCB (shared/reviewqueue.ts).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { emptyReview, record, trusted } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { inTargets, reviewedBy, reviewOrder, TCB_SITES, whyChain } from "../src/shared/reviewqueue.ts";

/** Two targets, t and u. t's statement uses a and y; a uses z (body), d and f; y uses z; d and e use
 *  each other; z uses the external E; t's proof uses p. u's statement uses y. */
function world() {
  const names = ["N.t", "N.a", "N.y", "N.z", "N.d", "N.e", "N.f", "N.p", "N.u"];
  const nodes: ViewNode[] = names.map((name) => ({ name, kind: name === "N.t" || name === "N.u" || name === "N.p" ? "theorem" : "def", module: "M", ax: 0 }));
  nodes.push({ name: "Ext.E", kind: "def", module: "Mathlib.X", ax: 0, ext: true });
  const at = (n: string) => (n === "Ext.E" ? 9 : names.indexOf(n));
  const edges: number[] = [];
  const use = (u: string, v: string, site: number) => edges.push(at(u), at(v), site);
  use("N.t", "N.a", SITE_STMT);
  use("N.t", "N.y", SITE_STMT);
  use("N.t", "N.p", SITE_PROOF);
  use("N.a", "N.z", SITE_BODY);
  use("N.a", "N.d", SITE_STMT);
  use("N.a", "N.f", SITE_STMT);
  use("N.y", "N.z", SITE_STMT);
  use("N.z", "Ext.E", SITE_STMT);
  use("N.d", "N.e", SITE_BODY);
  use("N.e", "N.d", SITE_BODY);
  use("N.u", "N.y", SITE_STMT);
  const meta = { nodes, projectCount: 9, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: edges.length / 3 } as unknown as ViewMeta;
  return new Graph(meta, new Int32Array(edges));
}

const named = (g: Graph, xs: number[]) => xs.map((i) => g.nodes[i].name);

test("each declaration counts the targets whose TCB holds it", () => {
  const g = world();
  const n = inTargets(g, [g.byName.get("N.t")!, g.byName.get("N.u")!]);
  const of = (name: string) => n[g.byName.get(name)!];
  assert.equal(of("N.y"), 2);
  assert.equal(of("N.z"), 2);
  assert.equal(of("Ext.E"), 2);
  assert.equal(of("N.a"), 1);
  assert.equal(of("N.u"), 1);
  assert.equal(of("N.p"), 0, "a proof is not in a TCB");
});

test("the review order is bottom-up, a shared foundation first, then by name", () => {
  const g = world();
  const t = g.byName.get("N.t")!;
  const d = emptyReview();
  // the members: the TCB, without what is trusted
  const members = (dd: typeof d) => g.reach([t], TCB_SITES, "out").map((x, i) => x & Number(!trusted(dd, g.nodes[i].name, g.nodes[i].module, g.isExt(i))));
  const shared = inTargets(g, [t, g.byName.get("N.u")!]);
  const order = reviewOrder(g, members(d), shared);
  // z and y are in both targets' TCBs: first, though their names come last; d and e use each other
  // and come together; the target itself last; the trusted outside world, and the proof, not at all
  assert.deepEqual(named(g, order), ["N.z", "N.y", "N.d", "N.e", "N.f", "N.a", "N.t"]);
  // with one target, nothing is shared: the name decides among what is ready
  assert.deepEqual(named(g, reviewOrder(g, members(d), inTargets(g, [t]))), ["N.d", "N.e", "N.f", "N.z", "N.a", "N.y", "N.t"]);
  // what uses something comes after it, cycles aside
  const pos = new Map(order.map((i, k) => [i, k]));
  for (const u of order)
    for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
      const v = g.outDst[e];
      const cycle = g.nodes[u].name === "N.d" || g.nodes[u].name === "N.e";
      if (g.outSite[e] & (SITE_STMT | SITE_BODY) && pos.has(v) && !cycle) assert.ok(pos.get(v)! < pos.get(u)!, `${g.nodes[v].name} before ${g.nodes[u].name}`);
    }
  // an untrusted outside declaration needs review, and takes its place in the order
  const own = { ...d, trusted: [] };
  const all = reviewOrder(g, members(own), shared);
  assert.deepEqual(named(g, all).slice(0, 2), ["Ext.E", "N.z"]);
});

test("why a declaration is in a TCB: the shortest chain of statement and body references", () => {
  const g = world();
  const t = g.byName.get("N.t")!;
  const of = (name: string) => whyChain(g, t, g.byName.get(name)!);
  assert.deepEqual(named(g, of("N.e")!), ["N.t", "N.a", "N.d", "N.e"]);
  assert.deepEqual(named(g, of("N.y")!), ["N.t", "N.y"]);
  assert.deepEqual(named(g, of("N.t")!), ["N.t"]);
  const ext = of("Ext.E")!;
  assert.equal(ext.length, 4);
  for (let k = 1; k < ext.length; k++) {
    let found = false;
    for (let e = g.outStart[ext[k - 1]]; e < g.outStart[ext[k - 1] + 1]; e++) found ||= g.outDst[e] === ext[k];
    assert.ok(found, "each step is a reference");
  }
  // what only a proof uses is not in the TCB; nor what the target does not use
  assert.equal(of("N.p"), null);
  assert.equal(of("N.u"), null);
});

test("a declaration is reviewed by a reader once they gave an opinion on its present version", () => {
  const d = emptyReview();
  record(d, { op: "opinion", name: "X", by: "Alice", verdict: "approve", hash: "h1" }, "lean4:v4", "2026-10-07T12:00:00Z");
  record(d, { op: "opinion", name: "Y", by: "Alice", verdict: "comment", comment: "off by one", hash: "h1" }, "lean4:v4", "2026-10-07T12:00:01Z");
  assert.equal(reviewedBy(d, "Alice", "X", "h1"), true);
  assert.equal(reviewedBy(d, "Alice", "Y", "h1"), true, "a comment is an opinion too");
  assert.equal(reviewedBy(d, "Alice", "X", "h2"), false, "the declaration changed since");
  assert.equal(reviewedBy(d, "Bob", "X", "h1"), false, "someone else's opinion is theirs");
  assert.equal(reviewedBy(d, null, "X", "h1"), false, "a reader without a name has given none");
});
