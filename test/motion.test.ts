// Elastic motion along the hierarchy (CanvasSpec.md, "Motion").

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { Motion } from "../src/web/src/motion.ts";
import { Scene } from "../src/web/src/scene.ts";

/** Two namespaces; in A, n0 depends on n1 (a spring between them in frame A). */
function world() {
  const nodes: ViewNode[] = [];
  for (let i = 0; i < 40; i++) nodes.push({ name: `A.n${i}`, kind: "def", module: "M.A", ax: 0 });
  for (let i = 0; i < 40; i++) nodes.push({ name: `B.n${i}`, kind: "def", module: "M.B", ax: 0 });
  const edges = new Int32Array([0, 1, SITE_STMT]);
  const layout = computeLayout("namespace", nodes, edges);
  const meta = { nodes, projectCount: nodes.length, axioms: [], axiomSets: [[]] } as unknown as ViewMeta;
  const g = new Graph(meta, edges);
  const s = new Scene(layout);
  s.restore({ nodes: {}, clusters: {} }, [], (i) => nodes[i].name);
  const m = new Motion(s, g);
  s.motion = m;
  return { s, m, nodes };
}

const run = (s: Scene, ms: number) => {
  for (let t = 0; t < ms; t += 16) s.step(16);
};
const at = (s: Scene, i: number) => [s.nwx[i], s.nwy[i]] as const;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test("a displaced node springs back to its anchor, and the motion sleeps", () => {
  const { s, m } = world();
  const home = at(s, 5);
  s.curNX[5] += 40;
  m.wakeDisplaced();
  s.moving = true;
  run(s, 3000);
  assert.ok(dist(at(s, 5), home) < 0.5, `still ${dist(at(s, 5), home)} away`);
  assert.equal(m.moving, false);
});

test("a dragged node pushes its neighbour, which returns once let go; the dragged one stays", () => {
  const { s } = world();
  // drag n2 onto n3
  const target = at(s, 3);
  const home3 = at(s, 3);
  s.placeNode(2, target[0], target[1]);
  run(s, 300);
  assert.ok(dist(at(s, 2), at(s, 3)) >= 9, "the neighbour made way");
  s.endDrag();
  run(s, 3000);
  assert.ok(dist(at(s, 2), target) < 0.5, "the dragged node stays where it was dropped");
  // the neighbour is held off by the pin now sitting on its home, but no longer than that
  assert.ok(dist(at(s, 3), home3) < 12, "the neighbour came back as far as it can");
});

test("what a node depends on follows it while dragged, and springs back after", () => {
  // a chain, each declaration using the next: in dependency order each sits just above what it
  // uses, so a declaration from the middle can be pulled away from the one below it
  const nodes: ViewNode[] = [];
  for (let i = 0; i < 40; i++) nodes.push({ name: `A.c${i}`, kind: "def", module: "M.A", ax: 0 });
  const e: number[] = [];
  for (let i = 0; i < 39; i++) e.push(i, i + 1, SITE_STMT);
  const edges = new Int32Array(e);
  const layout = computeLayout("namespace", nodes, edges);
  const meta = { nodes, projectCount: nodes.length, axioms: [], axiomSets: [[]] } as unknown as ViewMeta;
  const s = new Scene(layout);
  s.restore({ nodes: {}, clusters: {} }, [], (i) => nodes[i].name);
  s.motion = new Motion(s, new Graph(meta, edges));
  const [u, v] = [20, 21];
  const homeV = at(s, v);
  const [x0, y0] = at(s, u);
  // away from what it uses, by two declarations' width
  const len = dist([x0, y0], homeV);
  const [tx, ty] = [x0 + ((x0 - homeV[0]) / len) * 20, y0 + ((y0 - homeV[1]) / len) * 20];
  for (let k = 1; k <= 20; k++) {
    s.placeNode(u, x0 + ((tx - x0) * k) / 20, y0 + ((ty - y0) * k) / 20);
    run(s, 16);
  }
  // held there a moment
  run(s, 300);
  const moved = dist(at(s, v), homeV);
  assert.ok(moved > 1, `c21 did not follow (moved ${moved})`);
  // towards the one that pulls it
  const toward = (at(s, v)[0] - homeV[0]) * (tx - homeV[0]) + (at(s, v)[1] - homeV[1]) * (ty - homeV[1]);
  assert.ok(toward > 0, "c21 moved away from what pulls it");
  s.endDrag();
  run(s, 3000);
  assert.ok(dist(at(s, v), homeV) < 0.5, "c21 springs back");
});

/** Every open cluster's circle contains its sub-clusters' circles and its declarations' points. */
function contained(s: Scene): string | null {
  for (let c = 0; c < s.nc; c++) {
    if (s.rep[c] >= 0) continue;
    for (const k of s.kidsC[c]) {
      if (s.rep[k] >= 0 && s.rep[k] !== k) continue;
      const d = Math.hypot(s.cwx[k] - s.cwx[c], s.cwy[k] - s.cwy[c]) + s.drawnR[k];
      if (d > s.drawnR[c] + 0.01) return `cluster ${k} sticks out of ${c} by ${(d - s.drawnR[c]).toFixed(2)}`;
    }
    for (const i of s.kidsN[c]) {
      if (s.nodeRep[i] >= 0) continue;
      const d = Math.hypot(s.nwx[i] - s.cwx[c], s.nwy[i] - s.cwy[c]) + 5;
      if (d > s.drawnR[c] + 0.01) return `node ${i} sticks out of ${c} by ${(d - s.drawnR[c]).toFixed(2)}`;
    }
  }
  return null;
}

test("circles contain exactly their cluster's contents on every frame: drags, drops, folds", () => {
  const { s } = world();
  const check = (what: string) => {
    const bad = contained(s);
    assert.equal(bad, null, `${what}: ${bad}`);
  };
  check("at rest");
  // drag a node out to the edge of its cluster and on past it, frame by frame
  const [x0, y0] = at(s, 7);
  for (let k = 1; k <= 30; k++) {
    s.placeNode(7, x0 + 15 * k, y0 - 8 * k);
    s.step(16);
    check(`drag frame ${k}`);
  }
  s.endDrag();
  for (let t = 0; t < 2000; t += 16) {
    s.step(16);
    check(`after release, ${t} ms`);
  }
  // fold and unfold the first cluster, frame by frame
  s.setFolded(new Set([0]));
  for (let t = 0; t < 1500; t += 16) {
    s.step(16);
    check(`folding, ${t} ms`);
  }
  s.setFolded(new Set());
  for (let t = 0; t < 1500; t += 16) {
    s.step(16);
    check(`unfolding, ${t} ms`);
  }
  // at rest, sibling clusters do not overlap
  for (let a = 0; a < s.rootC.length; a++) {
    for (let b = a + 1; b < s.rootC.length; b++) {
      const [p, q] = [s.rootC[a], s.rootC[b]];
      assert.ok(Math.hypot(s.cwx[p] - s.cwx[q], s.cwy[p] - s.cwy[q]) >= s.drawnR[p] + s.drawnR[q] - 1, "siblings overlap at rest");
    }
  }
});
