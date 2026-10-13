// The overview's edges off the page's thread (CanvasSpec.md, "Edges"; the owner's request,
// 2026-10-10): the worker's protocol, the page's queue — the latest answer wins, a stale one is
// dropped, a few questions out at most — the page's own thread where there is no worker, the blend the
// page draws, and how what is drawn follows the camera.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { EdgeQueue, IN_FLIGHT } from "../src/web/src/edgequeue.ts";
import type { Ask, EdgeWorker } from "../src/web/src/edgequeue.ts";
import { EdgeWorkerCore } from "../src/web/src/edgeworker.ts";
import {
  BRACKET,
  DIM,
  LEVELS_KEPT,
  OverviewModel,
  aim,
  blendLooks,
  blendPoints,
  ease,
  edgeKey,
  indexLooks,
  weightGap,
  zoomPoint,
} from "../src/web/src/overview.ts";
import type { EdgeLook, FromWorker, Places, PointLooks, ToWorker, Weights } from "../src/web/src/overview.ts";
import { Scene } from "../src/web/src/scene.ts";

/** A small project: declarations in nested namespaces, a few outside it, edges of every site. */
function world() {
  const nodes: ViewNode[] = [];
  const spaces = ["A", "A.B", "A.B.C", "A.D", "E", "E.F", "G.H", "G.I.J"];
  for (let i = 0; i < 360; i++) {
    const ns = spaces[i % spaces.length];
    nodes.push({ name: `${ns}.n${i}`, kind: "def", module: `M.${ns.replace(/\./g, "_")}`, ax: 0 });
  }
  for (let i = 0; i < 40; i++) nodes.push({ name: `Ext.x${i}`, kind: "def", module: "Ext", ax: 0, ext: true });
  const e: number[] = [];
  for (let i = 1; i < 400; i++) {
    e.push(i, (i * 13) % i, SITE_STMT);
    e.push(i, (i * 7 + 3) % 400, i % 3 ? SITE_BODY : SITE_PROOF);
    if (i % 5 === 0) e.push(i, 360 + (i % 40), SITE_BODY);
  }
  const edges = new Int32Array(e);
  const layout = computeLayout("namespace", nodes, edges);
  const meta = { nodes, projectCount: 360, axioms: [], axiomSets: [[]], layouts: { namespace: layout, module: layout } } as unknown as ViewMeta;
  const g = new Graph(meta, edges);
  const S = new Scene(layout);
  S.restore({ nodes: {}, clusters: {} }, [], (i) => nodes[i].name);
  return { g, S };
}

/** A camera on the middle of the world, at zoom point `point`. */
function askAt(S: Scene, point: number, extra: Partial<Ask> = {}): Ask {
  let x = 0, y = 0;
  for (let i = 0; i < S.n; i++) {
    x += S.nwx[i] / S.n;
    y += S.nwy[i] / S.n;
  }
  return { point, x, y, w: 1200, h: 800, dim: false, style: 1, pri: 0, ...extra };
}

const unpack = (L: PointLooks): Map<string, EdgeLook> => {
  const m = new Map<string, EdgeLook>();
  for (let j = 0; j < L.n; j++) m.set(`${L.a[j]}:${L.b[j]}`, { path: Array.from(L.path.subarray(8 * j, 8 * j + L.len[j])), beta: L.beta[j], width: L.width[j], alpha: L.alpha[j] });
  return m;
};

/** What a blend draws, edge by edge, in order. */
type Drawn = { key: string; path: number[]; beta: number; width: number; alpha: number }[];

function drawnOf(sets: { looks: PointLooks; w: number; scale?: number }[]): Drawn {
  const out: Drawn = [];
  blendPoints(
    sets.map((s) => ({ looks: s.looks, index: indexLooks(s.looks), w: s.w, scale: s.scale ?? 1 })),
    (L, j, beta, width, alpha) => out.push({ key: `${L.a[j]}:${L.b[j]}`, path: Array.from(L.path.subarray(8 * j, 8 * j + L.len[j])), beta, width, alpha }),
  );
  return out;
}

test("the page's blend of two points is exactly the blend it drew before, edge for edge and in order", () => {
  const { g, S } = world();
  const M = new OverviewModel();
  M.setGraph(g);
  M.setTree(S, { externals: true, proofs: false });
  for (const point of [-14, -9, -6, -3, 0, 2]) {
    const A = M.choose(askAt(S, point), S);
    const B = M.choose(askAt(S, point + 1), S);
    assert.ok(A.n > 0 && B.n > 0, `point ${point} draws something`);
    for (const t of [0, 0.004, 0.25, 0.5, 0.731, 0.999, 1]) {
      const before: Drawn = [];
      blendLooks(unpack(A), unpack(B), t, (e, beta, width, alpha, key) => before.push({ key, path: e.path, beta, width, alpha }));
      assert.deepEqual(drawnOf([{ looks: A, w: 1 - t }, { looks: B, w: t }]), before, `point ${point}, t ${t}`);
    }
    // one point alone is drawn as it is
    const alone: Drawn = [];
    blendLooks(unpack(A), null, 0, (e, beta, width, alpha, key) => alone.push({ key, path: e.path, beta, width, alpha }));
    assert.deepEqual(drawnOf([{ looks: A, w: 1 }]), alone);
  }
});

test("with more than two points, an edge's alpha is the sum at the weights and its looks the mean over those that hold it", () => {
  const { g, S } = world();
  const M = new OverviewModel();
  M.setGraph(g);
  M.setTree(S, { externals: true, proofs: false });
  const P = [-8, -7, -6].map((p) => M.choose(askAt(S, p), S));
  const w = [0.2, 0.5, 0.3];
  const drawn = drawnOf(P.map((looks, k) => ({ looks, w: w[k] })));
  const keys = new Set(drawn.map((d) => d.key));
  assert.equal(keys.size, drawn.length, "each edge given once");
  for (const d of drawn) {
    const [a, b] = d.key.split(":").map(Number);
    let alpha = 0, beta = 0, held = 0;
    P.forEach((L, k) => {
      const j = indexLooks(L).get(edgeKey(a, b));
      if (j === undefined) return;
      alpha += w[k] * L.alpha[j];
      beta += w[k] * L.beta[j];
      held += w[k];
    });
    assert.ok(Math.abs(d.alpha - alpha) < 1e-12 && Math.abs(d.beta - beta / held) < 1e-12, d.key);
  }
  // two sets through the general rule agree with the exact one within rounding
  const exact = drawnOf([{ looks: P[0], w: 0.6 }, { looks: P[1], w: 0.4 }]);
  const third = drawnOf([{ looks: P[0], w: 0.6 }, { looks: P[1], w: 0.4 }, { looks: P[2], w: 0 }]);
  const byKey = new Map(third.map((d) => [d.key, d]));
  for (const d of exact) {
    const o = byKey.get(d.key)!;
    assert.ok(Math.abs(o.alpha - d.alpha) < 1e-12 && Math.abs(o.beta - d.beta) < 1e-12 && Math.abs(o.width - d.width) < 1e-12, d.key);
  }
});

test("a point chosen under another selection is shown dimmed as the selection now is", () => {
  const { g, S } = world();
  const M = new OverviewModel();
  M.setGraph(g);
  M.setTree(S, { externals: true, proofs: false });
  const plain = M.choose(askAt(S, -6), S);
  const dimmed = M.choose(askAt(S, -6, { dim: true }), S);
  const shown = drawnOf([{ looks: plain, w: 1, scale: DIM }]);
  const exact = drawnOf([{ looks: dimmed, w: 1 }]);
  const byKey = new Map(shown.map((d) => [d.key, d]));
  for (const d of exact) assert.ok(Math.abs(byKey.get(d.key)!.alpha - d.alpha) < 1e-12, d.key);
});

test("the worker answers in the protocol's shapes: looks in typed arrays, transferred; a question it drops is said so", () => {
  const { g, S } = world();
  const core = new EdgeWorkerCore();
  const posted: { m: FromWorker; transfer?: ArrayBuffer[] }[] = [];
  const post = (m: FromWorker, transfer?: ArrayBuffer[]) => posted.push({ m, transfer });
  const places = (): Places => ({ cwx: S.cwx.slice(), cwy: S.cwy.slice(), nwx: S.nwx.slice(), nwy: S.nwy.slice(), curR: S.curR.slice(), drawnR: S.drawnR.slice() });
  const choose = (id: number, point: number, pri = 0, base = 1): ToWorker => {
    const { style: _s, ...a } = askAt(S, point, { pri });
    return { type: "choose", id, base, places: places(), ...a };
  };
  const tree = (base: number, externals: boolean): ToWorker =>
    structuredClone({ type: "tree", base, nc: S.nc, n: S.n, parent: S.parent, nodeCluster: S.nodeCluster, rep: S.rep, externals, proofs: false });
  // a tree but no graph yet: an error, not a throw
  core.receive(tree(1, true), post);
  core.receive(choose(1, -6), post);
  core.next(post);
  assert.equal(posted[0].m.type, "error");
  assert.equal((posted[0].m as { id: number }).id, 1);
  posted.length = 0;

  core.receive(structuredClone({ type: "graph", n: g.n, projectCount: g.projectCount, outStart: g.outStart, outDst: g.outDst, outSite: g.outSite }), post);
  core.receive(choose(2, -6, 1), post);
  core.receive(choose(3, -5, 0), post);
  core.receive(choose(4, -6, 1), post); // the same point asked again: the earlier question is dropped
  core.receive(choose(5, 40, 1), post);
  core.receive({ type: "near", base: 1, lo: -8, hi: -3 }, post); // 40 is no longer wanted
  assert.deepEqual(posted.map((p) => p.m), [{ type: "dropped", id: 2 }, { type: "dropped", id: 5 }]);
  assert.equal(core.waiting, 2);
  core.next(post);
  core.next(post);
  assert.deepEqual(posted.map((p) => [p.m.type, (p.m as { id: number }).id]), [["dropped", 2], ["dropped", 5], ["looks", 3], ["looks", 4]]);
  assert.equal(core.waiting, 0);
  // what the camera needs (pri 0) before what is asked ahead (pri 1)
  const looks = posted.filter((p) => p.m.type === "looks");
  assert.deepEqual(looks.map((p) => (p.m as { id: number }).id), [3, 4]);
  const answer = looks[0].m as Extract<FromWorker, { type: "looks" }>;
  assert.equal(answer.point, -5);
  assert.equal(typeof answer.ms, "number");
  const L = answer.looks;
  assert.ok(L.n > 0);
  assert.ok(L.a instanceof Int32Array && L.b instanceof Int32Array && L.path instanceof Int32Array && L.len instanceof Uint8Array);
  assert.ok(L.beta instanceof Float64Array && L.width instanceof Float64Array && L.alpha instanceof Float64Array);
  assert.equal(L.path.length, 8 * L.n);
  assert.deepEqual(looks[0].transfer, [L.a, L.b, L.path, L.len, L.beta, L.width, L.alpha].map((x) => x.buffer));
  // the worker's answer is what the page would have chosen itself
  const M = new OverviewModel();
  M.setGraph(g);
  M.setTree(S, { externals: true, proofs: false });
  assert.deepEqual(structuredClone(L), M.choose(askAt(S, -5), S));
  // another tree: what waits for the old one is dropped
  core.receive(choose(6, -4), post);
  core.receive(tree(2, false), post);
  assert.deepEqual(posted.at(-1)!.m, { type: "dropped", id: 6 });
});

test("the aggregations kept are the steps last used, at most LEVELS_KEPT of them, and a new tree lets them go", () => {
  const { g, S } = world();
  const M = new OverviewModel();
  M.setGraph(g);
  M.setTree(S, { externals: true, proofs: false });
  for (let p = -24; p <= 8; p++) {
    M.choose(askAt(S, p), S);
    assert.ok(M.levelCount <= LEVELS_KEPT);
  }
  assert.equal(M.levelCount, LEVELS_KEPT);
  M.setTree(S, { externals: false, proofs: false });
  assert.equal(M.levelCount, 0);
});

/** A worker that keeps what it is sent, and answers when the test says. */
function fakeWorker() {
  const sent: { m: ToWorker; transfer?: Transferable[] }[] = [];
  const w = {
    sent,
    terminated: false,
    onmessage: null as ((e: MessageEvent<FromWorker>) => void) | null,
    onerror: null as ((e: Event) => void) | null,
    postMessage(m: ToWorker, transfer?: Transferable[]) {
      sent.push({ m, transfer });
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

test("the queue sends the graph, the tree and the questions, a copy of the positions with each, and keeps few out", () => {
  const { g, S } = world();
  const w = fakeWorker();
  let ready = 0;
  const Q = new EdgeQueue(() => w as unknown as EdgeWorker, () => ready++);
  Q.setGraph(g);
  Q.setBase(S, { externals: true, proofs: false });
  Q.near(-8, -3);
  assert.equal(Q.onPageThread, false);
  assert.deepEqual(w.sent.map((s) => s.m.type), ["graph", "tree", "near"]);
  const tree = w.sent[1].m as Extract<ToWorker, { type: "tree" }>;
  assert.equal(tree.base, 1);
  assert.equal(tree.nc, S.nc);
  assert.equal(tree.rep, S.rep);
  for (let k = 0; k < IN_FLIGHT; k++) assert.equal(Q.ask(askAt(S, -6 + k), () => S), true);
  assert.equal(Q.ask(askAt(S, -4), () => S), false, "no more than IN_FLIGHT out");
  assert.equal(Q.inFlight, IN_FLIGHT);
  const q = w.sent[3];
  const m = q.m as Extract<ToWorker, { type: "choose" }>;
  assert.equal(m.type, "choose");
  assert.equal(m.point, -6);
  assert.equal(m.base, 1);
  assert.ok(!("style" in m), "the page's own bookkeeping stays on the page");
  assert.notEqual(m.places.nwx, S.nwx, "a copy");
  assert.deepEqual(Array.from(m.places.nwx), Array.from(S.nwx));
  assert.deepEqual(q.transfer, Object.values(m.places).map((x) => x.buffer));
  assert.equal(Q.asked(-6)!.point, -6);
  assert.equal(Q.asked(-4), undefined);
  // a question the worker let go frees its place
  w.onmessage!({ data: { type: "dropped", id: m.id } } as MessageEvent<FromWorker>);
  assert.equal(Q.inFlight, IN_FLIGHT - 1);
  assert.equal(ready, 1);
  assert.equal(Q.ask(askAt(S, -4), () => S), true);
});

test("the latest answer wins, and one no longer near the camera, or for a replaced tree, is dropped", () => {
  const { g, S } = world();
  const w = fakeWorker();
  const Q = new EdgeQueue(() => w as unknown as EdgeWorker, () => {});
  Q.setGraph(g);
  Q.setBase(S, { externals: true, proofs: false });
  Q.near(-8, -3);
  const M = new OverviewModel();
  M.setGraph(g);
  M.setTree(S, { externals: true, proofs: false });
  const lastId = () => (w.sent.at(-1)!.m as { id: number }).id;
  const answer = (id: number, point: number, looks: PointLooks) => w.onmessage!({ data: { type: "looks", id, point, looks, ms: 1 } } as MessageEvent<FromWorker>);
  // the same point asked twice (the view moved, say): the later question's answer comes first
  Q.ask(askAt(S, -6, { style: 1 }), () => S);
  const older = lastId();
  Q.ask(askAt(S, -6, { style: 2 }), () => S);
  const newer = lastId();
  const looks = M.choose(askAt(S, -6), S);
  answer(newer, -6, looks);
  assert.equal(Q.points.get(-6)!.style, 2);
  answer(older, -6, M.choose(askAt(S, -6), S));
  assert.equal(Q.points.get(-6)!.style, 2, "an older answer never replaces a newer one");
  assert.equal(Q.points.get(-6)!.looks, looks);
  assert.equal(Q.dropped, 1);
  // the camera moved on before the answer came
  Q.ask(askAt(S, -4), () => S);
  const far = lastId();
  Q.near(0, 5);
  answer(far, -4, M.choose(askAt(S, -4), S));
  assert.equal(Q.points.has(-4), false);
  assert.equal(Q.dropped, 2);
  // a fold or a toggle since: another tree, and what was held is let go
  Q.ask(askAt(S, 2), () => S);
  const before = lastId();
  Q.setBase(S, { externals: false, proofs: false });
  assert.equal(Q.points.size, 0);
  Q.near(0, 5);
  answer(before, 2, M.choose(askAt(S, 2), S));
  assert.equal(Q.points.has(2), false);
  assert.equal(Q.dropped, 3);
  assert.equal(Q.inFlight, 0);
});

test("without a worker the page chooses itself, at once, what it chose before", () => {
  const { g, S } = world();
  for (const spawn of [() => null, () => { throw new Error("no Worker here"); }]) {
    let ready = 0;
    const Q = new EdgeQueue(spawn, () => ready++);
    Q.setGraph(g);
    Q.setBase(S, { externals: true, proofs: false });
    assert.equal(Q.onPageThread, true);
    for (let k = 0; k < IN_FLIGHT + 2; k++) assert.equal(Q.ask(askAt(S, -6 + k), () => S), true, "no limit on the page's thread");
    assert.equal(Q.inFlight, 0);
    assert.equal(ready, 0, "nothing to wait for");
    const M = new OverviewModel();
    M.setGraph(g);
    M.setTree(S, { externals: true, proofs: false });
    assert.deepEqual(Q.points.get(-6)!.looks, M.choose(askAt(S, -6), S));
  }
});

test("a worker that fails hands over to the page's thread, which asks again what was out", () => {
  const { g, S } = world();
  for (const how of ["onerror", "error"] as const) {
    const w = fakeWorker();
    let ready = 0;
    const Q = new EdgeQueue(() => w as unknown as EdgeWorker, () => ready++);
    Q.setGraph(g);
    Q.setBase(S, { externals: true, proofs: false });
    Q.ask(askAt(S, -6), () => S);
    const id = (w.sent.at(-1)!.m as { id: number }).id;
    const warn = console.warn;
    console.warn = () => {};
    try {
      if (how === "onerror") w.onerror!(new Event("error"));
      else w.onmessage!({ data: { type: "error", id, error: "boom" } } as MessageEvent<FromWorker>);
    } finally {
      console.warn = warn;
    }
    assert.equal(w.terminated, true);
    assert.equal(Q.onPageThread, true);
    assert.equal(Q.inFlight, 0);
    assert.equal(ready, 1, "the page draws again, and asks again");
    assert.equal(Q.ask(askAt(S, -6), () => S), true);
    assert.ok(Q.points.get(-6)!.looks.n > 0);
  }
});

test("what the camera draws: its two points by where it lies, or what is at hand while one is late", () => {
  const W = (...xs: [number, number][]) => xs.map(([point, w]) => ({ point, w }));
  assert.deepEqual(aim(4.25, [3, 4, 5, 6]), W([4, 0.75], [5, 0.25]));
  assert.deepEqual(aim(4, [4, 5]), W([4, 1], [5, 0]));
  assert.deepEqual(aim(4, [4]), W([4, 1]));
  // the finer point is late: the nearest ready ones on either side, blended by where it lies
  assert.deepEqual(aim(4.5, [4, 6]), W([4, 0.75], [6, 0.25]));
  // nothing beyond: the nearest one at full weight
  assert.deepEqual(aim(4.5, [2, 3, 4]), W([4, 1]));
  assert.deepEqual(aim(4.5, [7]), W([7, 1]));
  assert.equal(aim(4.5, []), null);
  // never across a gap wider than BRACKET; only what is near when anything is
  assert.deepEqual(aim(4.5, [4, 4 + BRACKET + 1]), W([4, 1]));
  assert.deepEqual(aim(4.5, [-20, 3, 6], [2, 7]), W([3, 0.5], [6, 0.5]));
  assert.deepEqual(aim(4.5, [-20], [2, 7]), W([-20, 1]));
});

test("what is drawn follows a camera that has its points exactly, and catches up with a late one by the zoom", () => {
  // every point ready: followed at the zoom's own pace, the camera's blend is drawn exactly, across
  // points and back
  const ready = Array.from({ length: 40 }, (_, k) => k - 20);
  let z = zoomPoint(0.37);
  let W = aim(z, ready)!;
  for (const dz of [0.07, 0.31, 0.5, 0.9, 1.3, 0.02, -0.4, -1.7, -0.05, 0.61]) {
    const next = z + dz;
    const to = aim(next, ready)!;
    W = ease(W, to, Math.abs(dz));
    assert.equal(W, to, `at ${next}`);
    z = next;
  }
  // a point late: what was drawn moves towards the camera's blend by at most the weight allowed
  const from: Weights = [{ point: 3, w: 1 }];
  const to: Weights = [{ point: 4, w: 0.6 }, { point: 5, w: 0.4 }];
  const half = ease(from, to, 0.5);
  assert.ok(Math.abs(weightGap(from, half) - 0.5) < 1e-12);
  assert.ok(Math.abs(weightGap(half, to) - 0.5) < 1e-12);
  assert.ok(Math.abs(half.reduce((s, x) => s + x.w, 0) - 1) < 1e-12);
  assert.deepEqual(half.map((x) => x.point), [3, 4, 5]);
  assert.equal(ease(half, to, 0.5), to);
  // nothing moves without a zoom to move along; all the way when settled
  assert.ok(Math.abs(weightGap(ease(from, to, 0), from)) < 1e-12);
  assert.equal(ease(from, to, Infinity), to);
});
