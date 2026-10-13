// The layout's promises: nothing overlaps, every node sits inside its cluster, and the same
// graph gives the same picture.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewNode } from "../src/shared/graph.ts";
import { computeLayout, memoryOf, splitName, stabilize } from "../src/shared/layout.ts";

function synthetic(): { nodes: ViewNode[]; edges: Int32Array } {
  const nodes: ViewNode[] = [];
  const spaces = ["A", "A.B", "A.B.C", "A.D", "E"];
  for (let i = 0; i < 300; i++) {
    const ns = spaces[i % spaces.length];
    nodes.push({ name: `${ns}.n${i}`, kind: i % 3 ? "theorem" : "def", module: `Mod.${ns.replace(/\./g, "_")}`, ax: 0 });
  }
  nodes.push({ name: "A.B", kind: "structure", module: "Mod.A", ax: 0 });
  for (let i = 0; i < 20; i++) nodes.push({ name: `Ext${i % 4}.x${i}`, kind: "theorem", module: `Mathlib.Foo.Bar${i}`, ax: 0, ext: true });
  const e: number[] = [];
  for (let i = 1; i < 300; i++) e.push(i, (i * 7) % i, i % 2 ? 1 : 4);
  for (let i = 0; i < 20; i++) e.push(i, 301 + i, 2);
  return { nodes, edges: new Int32Array(e) };
}

test("names split on dots, not inside guillemets", () => {
  assert.deepEqual(splitName("A.«b.c».d"), ["A", "«b.c»", "d"]);
});

for (const mode of ["namespace", "module"] as const) {
  test(`${mode}: no two nodes overlap, every node is inside its cluster`, () => {
    const { nodes, edges } = synthetic();
    const L = computeLayout(mode, nodes, edges);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j]);
        assert.ok(d >= 9.5, `${nodes[i].name} and ${nodes[j].name} overlap (${d})`);
      }
      for (let c = L.cluster[i]; c >= 0; c = L.clusters[c].parent) {
        const cl = L.clusters[c];
        assert.ok(Math.hypot(L.x[i] - cl.x, L.y[i] - cl.y) <= cl.r, `${nodes[i].name} outside ${cl.key}`);
      }
    }
  });

  test(`${mode}: deterministic`, () => {
    const a = synthetic();
    const b = synthetic();
    assert.deepEqual(computeLayout(mode, a.nodes, a.edges), computeLayout(mode, b.nodes, b.edges));
  });
}

test("a structure sits in the cluster of its own namespace", () => {
  const { nodes, edges } = synthetic();
  const L = computeLayout("namespace", nodes, edges);
  const s = nodes.findIndex((n) => n.name === "A.B");
  assert.equal(L.clusters[L.cluster[s]].key, "A.B");
});

test("externals live under one External cluster", () => {
  const { nodes, edges } = synthetic();
  const L = computeLayout("module", nodes, edges);
  nodes.forEach((n, i) => {
    if (!n.ext) return;
    let c = L.cluster[i];
    while (L.clusters[c].parent >= 0) c = L.clusters[c].parent;
    assert.equal(L.clusters[c].label, "External");
  });
});

test("a rebuild keeps survivors in place and fits the newcomers in", async () => {
  const { memoryOf, stabilize } = await import("../src/shared/layout.ts");
  const before = synthetic();
  const L0 = computeLayout("namespace", before.nodes, before.edges);
  const mem = memoryOf(L0, before.nodes);
  // three new declarations in A.B, one removed from E
  const after = synthetic();
  const gone = after.nodes.findIndex((n) => n.name === "E.n4");
  after.nodes.splice(gone, 1);
  for (let k = 0; k < 3; k++) after.nodes.push({ name: `A.B.fresh${k}`, kind: "def", module: "Mod.A_B", ax: 0 });
  // the same edges, minus those of the removed node, renumbered past it
  const kept: number[] = [];
  const shift = (v: number) => (v > gone ? v - 1 : v);
  for (let e = 0; e < before.edges.length; e += 3) {
    const [s, d, m] = [before.edges[e], before.edges[e + 1], before.edges[e + 2]];
    if (s !== gone && d !== gone) kept.push(shift(s), shift(d), m);
  }
  const edges = new Int32Array(kept);
  const L1 = stabilize(computeLayout("namespace", after.nodes, edges), after.nodes, mem);
  // survivors stay put, unless a cluster that grew had to push them aside
  let same = 0, survivors = 0;
  after.nodes.forEach((n, i) => {
    const j = before.nodes.findIndex((m) => m.name === n.name);
    if (j < 0) return;
    survivors++;
    if (Math.hypot(L1.x[i] - L0.x[j], L1.y[i] - L0.y[j]) < 0.2) same++;
  });
  assert.ok(same >= survivors * 0.85, `only ${same} of ${survivors} survivors kept their place`);
  for (let i = 0; i < after.nodes.length; i++) {
    for (let j = i + 1; j < after.nodes.length; j++) {
      assert.ok(Math.hypot(L1.x[i] - L1.x[j], L1.y[i] - L1.y[j]) >= 9.5, `${after.nodes[i].name} overlaps ${after.nodes[j].name}`);
    }
    for (let c = L1.cluster[i]; c >= 0; c = L1.clusters[c].parent) {
      const cl = L1.clusters[c];
      assert.ok(Math.hypot(L1.x[i] - cl.x, L1.y[i] - cl.y) <= cl.r + 0.5, `${after.nodes[i].name} outside ${cl.key}`);
    }
  }
});

test("a cluster that grows a lot between rebuilds does not overlap its siblings", async () => {
  const { memoryOf, stabilize } = await import("../src/shared/layout.ts");
  const before = synthetic();
  const L0 = computeLayout("namespace", before.nodes, before.edges);
  const mem = memoryOf(L0, before.nodes);
  const after = synthetic();
  // A.D more than doubles; a brand new cluster X appears
  for (let k = 0; k < 120; k++) after.nodes.splice(300, 0, { name: `A.D.grown${k}`, kind: "def", module: "Mod.A_D", ax: 0 });
  for (let k = 0; k < 20; k++) after.nodes.splice(300, 0, { name: `X.new${k}`, kind: "def", module: "Mod.X", ax: 0 });
  const L1 = stabilize(computeLayout("namespace", after.nodes, new Int32Array(0)), after.nodes, mem);
  const kids = new Map<number, number[]>();
  L1.clusters.forEach((c, i) => kids.set(c.parent, [...(kids.get(c.parent) ?? []), i]));
  for (const [, sib] of kids) {
    for (let a = 0; a < sib.length; a++) {
      for (let b = a + 1; b < sib.length; b++) {
        const A = L1.clusters[sib[a]], B = L1.clusters[sib[b]];
        assert.ok(Math.hypot(A.x - B.x, A.y - B.y) >= A.r + B.r - 0.5, `${A.key} overlaps ${B.key}`);
      }
    }
  }
  after.nodes.forEach((n, i) => {
    for (let c = L1.cluster[i]; c >= 0; c = L1.clusters[c].parent) {
      const cl = L1.clusters[c];
      assert.ok(Math.hypot(L1.x[i] - cl.x, L1.y[i] - cl.y) <= cl.r + 0.5, `${n.name} outside ${cl.key}`);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Dependency order (CanvasSpec.md): what is used sits low, what uses it sits high.

/** Spearman's rank correlation. */
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((_, i) => i).sort((p, q) => v[p] - v[q]);
    const r = new Array<number>(v.length);
    idx.forEach((i, k) => (r[i] = k));
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const n = a.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function layered(backEdge: boolean) {
  const nodes: ViewNode[] = [];
  const e: number[] = [];
  // a chain in one namespace: c_k uses c_(k-1)
  for (let k = 0; k < 40; k++) nodes.push({ name: `A.c${k}`, kind: "theorem", module: "M.A", ax: 0 });
  for (let k = 1; k < 40; k++) e.push(k, k - 1, 4);
  // two namespaces under A: everything in High uses something in Low
  const low = nodes.length;
  for (let k = 0; k < 30; k++) nodes.push({ name: `A.Low.l${k}`, kind: "def", module: "M.Low", ax: 0 });
  const high = nodes.length;
  for (let k = 0; k < 30; k++) nodes.push({ name: `A.High.h${k}`, kind: "theorem", module: "M.High", ax: 0 });
  for (let k = 0; k < 30; k++) e.push(high + k, low + ((k * 7) % 30), 1, high + k, low + ((k * 11 + 3) % 30), 4);
  // inside Low, a little structure of its own
  for (let k = 1; k < 30; k++) e.push(low + k, low + Math.floor(k / 2), 1);
  if (backEdge) e.push(low + 5, high + 2, 4);
  return { nodes, edges: new Int32Array(e) };
}

for (const backEdge of [false, true]) {
  test(`what is used sits below what uses it${backEdge ? ", also with a dependency against the grain" : ""}`, () => {
    const { nodes, edges } = layered(backEdge);
    const L = computeLayout("namespace", nodes, edges);
    // the chain climbs: screen y falls as k grows
    const chain = nodes.map((n, i) => i).filter((i) => nodes[i].name.startsWith("A.c"));
    const rho = spearman(chain.map((i) => Number(nodes[i].name.slice(3))), chain.map((i) => -L.y[i]));
    assert.ok(rho > 0.8, `the chain is not ordered upwards (ρ = ${rho.toFixed(2)})`);
    // the namespace that uses sits above the one it uses
    const at = (key: string) => L.clusters.find((c) => c.key === key)!;
    assert.ok(at("A.High").y < at("A.Low").y, "A.High is not above A.Low");
    // and the picture is still a valid one
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) assert.ok(Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j]) >= 9.5, "overlap");
      for (let c = L.cluster[i]; c >= 0; c = L.clusters[c].parent) {
        const cl = L.clusters[c];
        assert.ok(Math.hypot(L.x[i] - cl.x, L.y[i] - cl.y) <= cl.r, `${nodes[i].name} outside ${cl.key}`);
      }
    }
  });
}

test("on a rebuild, what moved in the dependency order moves; the rest keeps its place", () => {
  const { nodes, edges } = layered(false);
  // one more declaration in A, using nothing yet: it rests low
  nodes.push({ name: "A.x", kind: "theorem", module: "M.A", ax: 0 });
  const x = nodes.length - 1;
  const before = computeLayout("namespace", nodes, edges);
  const mem = memoryOf(before, nodes);
  // now it uses the top of the chain: it belongs on top
  const more = new Int32Array([...edges, ...[39, 38, 37, 36].flatMap((k) => [x, k, 4])]);
  const after = stabilize(computeLayout("namespace", nodes, more), nodes, mem);
  const top = (L: typeof before, i: number) => L.y[i] - L.clusters[L.cluster[i]].y;
  assert.ok(top(after, x) < top(before, x) - 20, "A.x did not move up");
  let kept = 0;
  for (let i = 0; i < nodes.length; i++) if (i !== x && after.x[i] === before.x[i] && after.y[i] === before.y[i]) kept++;
  assert.ok(kept >= 0.9 * (nodes.length - 1), `only ${kept} of ${nodes.length - 1} kept their place`);
});
