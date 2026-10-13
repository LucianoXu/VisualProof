// The scene graph's promises (CanvasSpec.md, "The coordinate model").

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewNode } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { Scene } from "../src/web/src/scene.ts";

function synthetic() {
  const nodes: ViewNode[] = [];
  const spaces = ["A", "A.B", "A.B.C", "A.D", "E", "F", "G.H"];
  for (let i = 0; i < 400; i++) {
    const ns = spaces[i % spaces.length];
    nodes.push({ name: `${ns}.n${i}`, kind: "def", module: `M.${ns.replace(/\./g, "_")}`, ax: 0 });
  }
  const e: number[] = [];
  for (let i = 1; i < 400; i++) e.push(i, (i * 13) % i, 1);
  return { nodes, layout: computeLayout("namespace", nodes, new Int32Array(e)) };
}

const settle = (s: Scene) => {
  for (let k = 0; k < 400 && s.moving; k++) s.step(16);
};

test("with nothing folded, the scene is the server's layout", () => {
  const { layout } = synthetic();
  const s = new Scene(layout);
  s.restore({ nodes: {}, clusters: {} }, [], (i) => String(i));
  for (let i = 0; i < layout.x.length; i++) {
    assert.ok(Math.abs(s.nwx[i] - layout.x[i]) < 0.2 && Math.abs(s.nwy[i] - layout.y[i]) < 0.2, `node ${i} moved`);
  }
});

test("folding the top level packs the top clusters, each keeping its direction", () => {
  const { layout } = synthetic();
  const s = new Scene(layout);
  s.restore({ nodes: {}, clusters: {} }, [], (i) => String(i));
  const tops = s.rootC;
  const before = tops.map((c) => [s.cwx[c], s.cwy[c]]);
  s.setFolded(new Set(tops));
  settle(s);
  // no two top bodies overlap
  for (let a = 0; a < tops.length; a++) {
    for (let b = a + 1; b < tops.length; b++) {
      const [ca, cb] = [tops[a], tops[b]];
      const d = Math.hypot(s.cwx[ca] - s.cwx[cb], s.cwy[ca] - s.cwy[cb]);
      assert.ok(d >= s.bubbleR(ca) + s.bubbleR(cb) - 0.5, `${layout.clusters[ca].key} overlaps ${layout.clusters[cb].key}`);
    }
  }
  // they came closer to the origin, roughly along their own direction (collisions may turn a
  // body a little; the arrangement stays recognisable)
  tops.forEach((c, k) => {
    const [bx, by] = before[k];
    const r0 = Math.hypot(bx, by);
    const r1 = Math.hypot(s.cwx[c], s.cwy[c]);
    assert.ok(r1 <= r0 + 0.5, `${layout.clusters[c].key} moved outwards`);
    if (r0 > 1 && r1 > 1) {
      const cos = (bx * s.cwx[c] + by * s.cwy[c]) / (r0 * r1);
      assert.ok(cos > Math.cos((20 * Math.PI) / 180), `${layout.clusters[c].key} turned more than 20°`);
    }
  });
  // and only they are drawn: every node is hidden inside one of them
  for (let i = 0; i < s.n; i++) if (layout.cluster[i] >= 0) assert.ok(s.nodeRep[i] >= 0, `node ${i} still drawn`);
});

test("folding a cluster never pushes its siblings outwards or grows its parent", () => {
  const { layout } = synthetic();
  for (let c = 0; c < layout.clusters.length; c++) {
    const s = new Scene(layout);
    s.restore({ nodes: {}, clusters: {} }, [], (i) => String(i));
    const p = s.parent[c];
    const sibs = p >= 0 ? s.kidsC[p] : s.rootC;
    const home = sibs.map((k) => Math.hypot(s.ancCX[k], s.ancCY[k]));
    s.setFolded(new Set([c]));
    settle(s);
    const name = layout.clusters[c].key;
    if (p >= 0) assert.ok(s.effR[p] <= layout.clusters[p].r + 0.5, `folding ${name} grew its parent`);
    sibs.forEach((k, j) => assert.ok(Math.hypot(s.ancCX[k], s.ancCY[k]) <= home[j] + 0.5, `folding ${name} pushed ${layout.clusters[k].key} out`));
    const rad = (k: number) => (k === c ? s.bubbleR(k) : s.effR[k]);
    for (let a = 0; a < sibs.length; a++) {
      for (let b = a + 1; b < sibs.length; b++) {
        const [x, y] = [sibs[a], sibs[b]];
        const d = Math.hypot(s.cwx[x] - s.cwx[y], s.cwy[x] - s.cwy[y]);
        assert.ok(d >= rad(x) + rad(y) - 0.5, `folding ${name}: ${layout.clusters[x].key} overlaps ${layout.clusters[y].key}`);
      }
    }
  }
});

test("a folded cluster carries its contents when it is moved", () => {
  const { layout } = synthetic();
  const s = new Scene(layout);
  s.restore({ nodes: {}, clusters: {} }, [], (i) => String(i));
  const c = layout.clusters.findIndex((cl) => cl.key === "A.B");
  const inside = layout.cluster.findIndex((k) => k === c);
  const offset = [s.nwx[inside] - s.cwx[c], s.nwy[inside] - s.cwy[c]];
  s.setFolded(new Set([c]));
  settle(s);
  s.placeCluster(c, s.cwx[c] + 300, s.cwy[c] - 120);
  settle(s);
  const at = [s.cwx[c], s.cwy[c]];
  s.setFolded(new Set());
  settle(s);
  assert.ok(Math.abs(s.cwx[c] - at[0]) < 0.5 && Math.abs(s.cwy[c] - at[1]) < 0.5, "the cluster stays where it was dropped");
  assert.ok(Math.abs(s.nwx[inside] - s.cwx[c] - offset[0]) < 0.5 && Math.abs(s.nwy[inside] - s.cwy[c] - offset[1]) < 0.5, "its contents came along");
});

test("places survive a round trip by name", () => {
  const { layout, nodes } = synthetic();
  const name = (i: number) => nodes[i].name;
  const s = new Scene(layout);
  s.restore({ nodes: {}, clusters: {} }, [], name);
  const home = s.nodeCluster[5];
  const [px, py] = [s.cwx[home] + 8, s.cwy[home] - 6];
  s.placeNode(5, px, py);
  const c = layout.clusters.findIndex((cl) => cl.key === "E");
  s.placeCluster(c, -500, 40);
  const saved = s.pins(name);
  const t = new Scene(layout);
  t.restore(saved, [], name);
  assert.ok(Math.abs(t.nwx[5] - px) < 0.5 && Math.abs(t.nwy[5] - py) < 0.5);
  assert.ok(Math.abs(t.cwx[c] + 500) < 0.5 && Math.abs(t.cwy[c] - 40) < 0.5);
});

test("a drag stays inside the circle it happens in; places saved outside are brought in", () => {
  const { layout, nodes } = synthetic();
  const name = (i: number) => nodes[i].name;
  const s = new Scene(layout);
  s.restore({ nodes: {}, clusters: {} }, [], name);
  const deep = layout.clusters.findIndex((cl) => cl.key === "A.B.C");
  const i = layout.cluster.findIndex((k) => k === deep);
  const within = (sc: Scene, what: string) => {
    for (let c = sc.nodeCluster[i]; c >= 0; c = sc.parent[c]) {
      assert.ok(sc.effR[c] <= layout.clusters[c].r + 0.5, `${what}: ${layout.clusters[c].key} grew`);
      assert.ok(sc.drawnR[c] <= layout.clusters[c].r + 0.5, `${what}: ${layout.clusters[c].key} is drawn larger`);
    }
  };
  // dragged far out, across everything
  s.placeNode(i, s.cwx[deep] + 5000, s.cwy[deep] - 3000);
  s.endDrag();
  settle(s);
  within(s, "after the drag");
  const d = Math.hypot(s.nwx[i] - s.cwx[deep], s.nwy[i] - s.cwy[deep]);
  assert.ok(d > layout.clusters[deep].r / 2, "it went as far as its circle lets it");
  // a place saved far outside (by an earlier version, or under another layout)
  const t = new Scene(layout);
  t.restore({ nodes: { [name(i)]: [4000, 0] }, clusters: { "A.B": [-2500, 900] } }, [], name);
  settle(t);
  // a sub-cluster put at the edge may crowd what was beside it: the circle grows a little rather
  // than let siblings overlap (A.B is more than half of A: about 5%), never by a multiple
  for (let c = t.nodeCluster[i]; c >= 0; c = t.parent[c]) {
    assert.ok(t.drawnR[c] <= layout.clusters[c].r * 1.08 + 0.5, `after a restore: ${layout.clusters[c].key} grew to ${t.drawnR[c]}`);
  }
  const ab = layout.clusters.findIndex((cl) => cl.key === "A.B");
  const a = t.parent[ab];
  assert.ok(Math.hypot(t.cwx[ab] - t.cwx[a], t.cwy[ab] - t.cwy[a]) + t.drawnR[ab] <= t.drawnR[a] + 0.5, "A.B is inside A");
});

test("two drops never overlap: the later one stays where it was dropped, the earlier makes way", () => {
  const { layout, nodes } = synthetic();
  const name = (i: number) => nodes[i].name;
  const s = new Scene(layout);
  s.restore({ nodes: {}, clusters: {} }, [], name);
  const [e, f] = ["E", "F"].map((k) => layout.clusters.findIndex((cl) => cl.key === k));
  const check = (sc: Scene, what: string) => {
    assert.ok(Math.hypot(sc.cwx[f] - 400, sc.cwy[f] - 400) < 0.5, `${what}: the later drop moved`);
    const gap = Math.hypot(sc.cwx[e] - sc.cwx[f], sc.cwy[e] - sc.cwy[f]) - sc.drawnR[e] - sc.drawnR[f];
    assert.ok(gap >= -0.5, `${what}: E and F overlap by ${-gap}`);
  };
  s.placeCluster(e, 400, 400);
  s.endDrag();
  settle(s);
  s.placeCluster(f, 400, 400);
  s.endDrag();
  settle(s);
  check(s, "after the drops");
  // the order survives a reload
  const t = new Scene(layout);
  t.restore(s.pins(name), [], name);
  settle(t);
  check(t, "after a reload");
});
