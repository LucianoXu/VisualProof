// Trusting from the page (ReviewSpec decision 3, web/src/trust.ts): which prefix a cluster of the
// outline stands for, and what trusting it would change in each target's count.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cluster, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { emptyReview, OUTSIDE, progressOf } from "../src/shared/review.ts";
import type { ReviewData } from "../src/shared/review.ts";
import { reviewCount } from "../src/shared/reviewqueue.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { clusterPrefix, effectOf, tcbMembers } from "../src/web/src/trust.ts";

/** A target T whose statement uses Q.gate (declared under Lib) and V.perm (a vendored file), whose
 *  proof uses Q.lemma; Mathlib's E and the outside library O.f are used by Q.gate. */
function world() {
  const nodes: ViewNode[] = [
    { name: "P.T", kind: "theorem", module: "P.Main", ax: 0 },
    { name: "Q.gate", kind: "def", module: "P.Lib", ax: 0 },
    { name: "Equiv.perm", kind: "def", module: "V.Perm", ax: 0 },
    { name: "Q.lemma", kind: "theorem", module: "P.Lib", ax: 0 },
    { name: "Mathlib.E", kind: "def", module: "Mathlib.X", ax: 0, ext: true },
    { name: "O.f", kind: "def", module: "Other.Y", ax: 0, ext: true },
  ];
  const edges = new Int32Array([0, 1, SITE_STMT, 0, 2, SITE_STMT, 0, 3, SITE_PROOF, 1, 4, SITE_BODY, 1, 5, SITE_BODY]);
  const meta = { nodes, projectCount: 4, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: 5 } as unknown as ViewMeta;
  return new Graph(meta, edges);
}

const cluster = (key: string, ext = false) => ({ key, ext }) as Cluster;

test("a cluster of the outline stands for a prefix: the project's by namespace or folder, the outside world's by file only, or as a whole", () => {
  assert.equal(clusterPrefix(cluster("Lib.Algebra"), "namespace"), "Lib.Algebra");
  assert.equal(clusterPrefix(cluster("Vendored.GroupTheory"), "module"), "Vendored.GroupTheory");
  assert.equal(clusterPrefix(cluster("⟨external⟩.Aesop.Search", true), "module"), "Aesop.Search");
  assert.equal(clusterPrefix(cluster("⟨external⟩.Nat", true), "namespace"), null, "outside the project a namespace says nothing of modules");
  assert.equal(clusterPrefix(cluster("⟨external⟩", true), "module"), OUTSIDE, "the outside world, trusted at once");
  assert.equal(clusterPrefix(cluster("⟨external⟩", true), "namespace"), OUTSIDE);
});

test("what trusting a prefix changes: the declarations it covers, and each target's count", () => {
  const g = world();
  const d = emptyReview();
  // a target counts what its review holds (shared/reviewqueue.ts), under the trust asked about
  const targets = [{ name: "P.T", count: (dd: ReviewData) => reviewCount(g, dd, 0) }];
  // the TCB: T, gate, perm and what gate uses; not the proof's lemma
  assert.deepEqual(tcbMembers(g, [0]).map((m) => m.name).sort(), ["Equiv.perm", "Mathlib.E", "O.f", "P.T", "Q.gate"]);
  assert.equal(progressOf(d, tcbMembers(g, [0])).total, 4, "T, gate, perm and the outside library; not Mathlib");
  assert.equal(targets[0].count(d), 4, "what the review counts is what the progress counts");
  // a namespace: gate by name, and the lemma, which is not in the TCB
  assert.deepEqual(effectOf(g, d, "Q", true, targets), { own: 2, outside: 0, targets: [{ name: "P.T", before: 4, after: 3 }] });
  // a vendored folder, whatever namespace it extends
  assert.deepEqual(effectOf(g, d, "V", true, targets), { own: 1, outside: 0, targets: [{ name: "P.T", before: 4, after: 3 }] });
  // the outside world, by module
  assert.deepEqual(effectOf(g, d, "Other", true, targets), { own: 0, outside: 1, targets: [{ name: "P.T", before: 4, after: 3 }] });
  // what no TCB holds changes no count
  assert.deepEqual(effectOf(g, d, "P.Lib", true, [{ name: "P.T", count: (dd: ReviewData) => reviewCount(g, dd, 3) }]).targets, [{ name: "P.T", before: 1, after: 0 }]);
  // taking Mathlib off counts its declarations again
  assert.deepEqual(effectOf(g, d, "Mathlib", false, targets), { own: 0, outside: 1, targets: [{ name: "P.T", before: 4, after: 5 }] });
});
