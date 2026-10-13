// A visitor shows in its own place in the cluster hierarchy (ViewSpec decision 27, the owner's
// decision of 2026-10-11): in its own cluster where the board draws it, else in temporary clusters
// nested in the deepest cluster of its path the board draws — the top level, maybe — shared by the
// visitors that have them in common, a hidden level's members in its parent, a folded cluster round
// a selected one opened for the reader alone. Followers compute the same; nothing temporary reaches
// the view's scope, pins or memory, and the board's places come back when the visitors go.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanView } from "../src/shared/collab.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { joinChains } from "../src/web/src/bundles.ts";
import { LEAF_R, Scene } from "../src/web/src/scene.ts";
import { freeSpot, packPlan, readVisitors, rimSpot, shareVisitors, tempPad } from "../src/web/src/visitors.ts";
import type { VisitNode, VisitPlan, Visitor } from "../src/web/src/visitors.ts";
import { openFor, placeVisits, planOn, visitChain, visitWorld } from "../src/web/src/visits.ts";
import type { VisitIn } from "../src/web/src/visits.ts";

/** A board: A.m beside A.B (f, g) and A.C (h, and A.C.D with k, l), X.n at the top level, and the
 *  structure A.S whose namespace holds A.S.f; `extra` adds more of its declarations. */
function board(mode: ClusterMode = "namespace", extra: string[] = []) {
  const names = ["A.m", "A.B.f", "A.B.g", "A.C.h", "A.C.D.k", "A.C.D.l", "A.S.f", "X.n", ...extra];
  const nodes: ViewNode[] = names.map((name) => ({ name, kind: "def", module: `M.${name.split(".").slice(0, -1).join(".")}`, ax: 0 }));
  const at = (n: string) => names.indexOf(n);
  const edges = [at("A.m"), at("A.B.f"), SITE_STMT, at("A.B.f"), at("A.B.g"), SITE_STMT, at("A.C.h"), at("A.C.D.k"), SITE_STMT, at("X.n"), at("A.m"), SITE_STMT];
  const meta = { nodes, projectCount: names.length, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: edges.length / 3 } as unknown as ViewMeta;
  const g = new Graph(meta, Int32Array.from(edges));
  return { g, names, layout: (hidden: string[] = []) => computeLayout(mode, nodes, Int32Array.from(edges), hidden) };
}

const node = (name: string, module = `M.${name.split(".").slice(0, -1).join(".")}`, ext = false): VisitNode => ({ name, module, ext });

/** The plan as keys: each temporary cluster's key, label, the board's cluster it is in and the one it
 *  is inside (by key), and each visitor's place, the same whatever the indices. */
function shape(plan: VisitPlan, L: Layout, names: string[]) {
  const key = (c: number) => (c < 0 ? "" : L.clusters[c].key);
  return {
    temps: plan.temps.map((t) => [t.key, t.label, key(t.in), t.up < 0 ? "" : plan.temps[t.up].key, t.count]).sort(),
    at: Object.fromEntries(names.map((n, k) => [n, [key(plan.at[k].in), plan.at[k].up < 0 ? "" : plan.temps[plan.at[k].up].key]])),
  };
}

test("a visitor whose own cluster the board draws sits in that cluster; a structure in its own namespace's", () => {
  const { g, layout } = board();
  const L = layout();
  const vs = [node("A.B.v"), node("A.S")];
  const s = shape(planOn(L, "namespace", [], g, vs), L, ["A.B.v", "A.S"]);
  assert.deepEqual(s.temps, []);
  assert.deepEqual(s.at, { "A.B.v": ["A.B", ""], "A.S": ["A.S", ""] });
});

test("the levels the board does not draw are temporary clusters inside the deepest one it draws, a chain merged as the board merges its own", () => {
  const { g, layout } = board();
  const L = layout();
  // A.E.F: neither drawn, E holding nothing but F — one circle, "E.F", in A
  const s = shape(planOn(L, "namespace", [], g, [node("A.E.F.v")]), L, ["A.E.F.v"]);
  assert.deepEqual(s.temps, [["A.E.F", "E.F", "A", "", 1]]);
  assert.deepEqual(s.at, { "A.E.F.v": ["A", "A.E.F"] });
  // under a cluster that is drawn deeper down: A.C.D.Q in A.C.D
  const d = shape(planOn(L, "namespace", [], g, [node("A.C.D.Q.v")]), L, ["A.C.D.Q.v"]);
  assert.deepEqual(d.temps, [["A.C.D.Q", "Q", "A.C.D", "", 1]]);
});

test("visitors share the temporary clusters they have in common, and a chain splits where they part", () => {
  const { g, layout } = board();
  const L = layout();
  const names = ["A.E.F.v", "A.E.w", "A.E.F.u", "A.E.G.H.x"];
  const s = shape(planOn(L, "namespace", [], g, names.map((n) => node(n))), L, names);
  assert.deepEqual(s.temps, [
    ["A.E", "E", "A", "", 4],
    ["A.E.F", "F", "A", "A.E", 2],
    ["A.E.G.H", "G.H", "A", "A.E", 1],
  ]);
  assert.deepEqual(s.at, { "A.E.F.v": ["A", "A.E.F"], "A.E.w": ["A", "A.E"], "A.E.F.u": ["A", "A.E.F"], "A.E.G.H.x": ["A", "A.E.G.H"] });
  // packed: each temporary cluster holds what is in it, its name's room above
  const plan = planOn(L, "namespace", [], g, names.map((n) => node(n)));
  const P = packPlan(plan, names);
  const E = plan.temps.findIndex((t) => t.key === "A.E"), F = plan.temps.findIndex((t) => t.key === "A.E.F");
  assert.ok(P.r[E] >= Math.hypot(P.x[F], P.y[F]) + P.r[F] + tempPad(4) - 1e-6, "E holds F");
  for (const k of [0, 2]) assert.ok(Math.hypot(P.vx[k], P.vy[k]) + LEAF_R <= P.r[F] - tempPad(2) + 1e-6, "F holds its visitors");
});

test("at the top level: a path the board draws nothing of is a temporary cluster at the top; the outside world's apart", () => {
  const { g, layout } = board();
  const L = layout();
  const names = ["Z.Y.u", "Mathlib.foo"];
  const s = shape(planOn(L, "namespace", [], g, [node("Z.Y.u"), node("Mathlib.foo", "Mathlib.X", true)]), L, names);
  // the outside world's cluster is never merged with what it holds, as on the board
  assert.deepEqual(s.temps, [["Z.Y", "Z.Y", "", "", 1], ["⟨external⟩", "External", "", "", 1], ["⟨external⟩.Mathlib", "Mathlib", "", "⟨external⟩", 1]].sort());
  assert.deepEqual(s.at, { "Z.Y.u": ["", "Z.Y"], "Mathlib.foo": ["", "⟨external⟩.Mathlib"] });
  // by file, the same rule on the files' tree
  const byFile = board("module");
  const LF = byFile.layout();
  const f = shape(planOn(LF, "module", [], byFile.g, [node("A.Q.v", "M.A.Q")]), LF, ["A.Q.v"]);
  assert.deepEqual(f.temps, [["M.A.Q", "Q", "M.A", "", 1]]);
});

test("hidden levels: the visitor is placed as that board's tree has it, a hidden level's members in its parent", () => {
  const { g, layout } = board();
  // A hidden: its members at the top level, A.B and A.C drawn there
  const L = layout(["A"]);
  const names = ["A.E.w", "A.v", "A.B.z"];
  const s = shape(planOn(L, "namespace", ["A"], g, names.map((n) => node(n))), L, names);
  assert.deepEqual(s.temps, [["A.E", "E", "", "", 1]]);
  assert.deepEqual(s.at, { "A.E.w": ["", "A.E"], "A.v": ["", ""], "A.B.z": ["A.B", ""] });
  // A.C hidden: what it holds is in A, A.C.D among it
  const LC = layout(["A.C"]);
  const c = shape(planOn(LC, "namespace", ["A.C"], g, [node("A.C.z"), node("A.C.D.y"), node("A.C.Q.x")]), LC, ["A.C.z", "A.C.D.y", "A.C.Q.x"]);
  assert.deepEqual(c.temps, [["A.C.Q", "Q", "A", "", 1]]);
  assert.deepEqual(c.at, { "A.C.z": ["A", ""], "A.C.D.y": ["A.C.D", ""], "A.C.Q.x": ["A", "A.C.Q"] });
});

/** A scene of the board, as a page has it. */
function sceneOf(L: Layout, folds: string[] = []) {
  const S = new Scene(L);
  S.restore({ nodes: {}, clusters: {} }, folds, (i) => String(i));
  return S;
}
const settle = (S: Scene) => {
  for (let k = 0; k < 600 && S.moving; k++) S.step(16);
};
const inputs = (names: string[], places: Visitor["place"][] = []): VisitIn[] => names.map((n, k) => ({ ...node(n), place: places[k] ?? null, near: [] }));

test("a folded cluster round a visitor hides it on its card; the clusters round a selected one are those to open", () => {
  const { g, layout } = board();
  const L = layout();
  const A = L.clusters.findIndex((c) => c.key === "A"), AB = L.clusters.findIndex((c) => c.key === "A.B");
  const names = ["A.B.v", "A.E.w"];
  const plan = planOn(L, "namespace", [], g, inputs(names));
  // A.B.v selected: A.B and A, folded or not, are what opens for it
  assert.deepEqual([...openFor(plan, L.clusters.map((c) => c.parent), [0])].sort(), [A, AB].sort());
  assert.deepEqual([...openFor(plan, L.clusters.map((c) => c.parent), [])], []);
  // A folded on the board: both are on its card, and their edges end there
  const S = sceneOf(L, ["A"]);
  const V = placeVisits(S, L, plan, inputs(names));
  const W = visitWorld(V, S);
  assert.deepEqual([...W.vrep], [A, A]);
  assert.deepEqual(visitChain(V, W, S, S.nc + S.n, 0), [A]);
  // open: drawn in their places, the chain through the temporary cluster
  const open = sceneOf(L);
  const V2 = placeVisits(open, L, plan, inputs(names));
  const W2 = visitWorld(V2, open);
  assert.deepEqual([...W2.vrep], [-1, -1]);
  const E = plan.temps.findIndex((t) => t.key === "A.E");
  const base = open.nc + open.n;
  assert.deepEqual(visitChain(V2, W2, open, base, 1), [base + plan.temps.length + 1, base + E, A]);
  // an edge from it to A.B.f runs up through E and A, and down through A.B
  const f = g.byName.get("A.B.f")!;
  assert.deepEqual(joinChains(visitChain(V2, W2, open, base, 1), [open.nc + f, AB, A]), [base + plan.temps.length + 1, base + E, A, AB, open.nc + f]);
});

test("followers compute the same: the plan whatever the trail's order, the places carried by presence, the positions drawn", () => {
  const { g, layout } = board();
  const L = layout();
  const names = ["A.E.F.v", "A.B.v", "Z.Y.u", "A.E.w"];
  const a = planOn(L, "namespace", [], g, inputs(names));
  const rev = [...names].reverse();
  const b = planOn(L, "namespace", [], g, inputs(rev));
  assert.deepEqual(shape(a, L, names), shape(b, L, rev));
  const pa = packPlan(a, names), pb = packPlan(b, rev);
  names.forEach((n, k) => {
    const j = rev.indexOf(n);
    assert.deepEqual([pa.vx[k], pa.vy[k]], [pb.vx[j], pb.vy[j]], `${n} packs the same`);
  });
  // the leader places them; presence carries the places; the follower's scene draws them where the
  // leader's does
  const lead = sceneOf(L);
  const VL = placeVisits(lead, L, a, inputs(names));
  const trail: Visitor[] = names.map((n, k) => ({ name: n, from: null, place: VL.places[k] }));
  const sent = cleanView({ mode: "plain", sel: null, source: false, clusterMode: "namespace", cam: null, view: "v", scope: null, tabs: [], visitors: shareVisitors(trail) })!;
  const got = readVisitors(sent.visitors);
  assert.deepEqual(got, trail.map((v) => ({ ...v, place: { in: v.place!.in, at: [Math.round(v.place!.at[0] * 10) / 10, Math.round(v.place!.at[1] * 10) / 10] } })));
  const follow = sceneOf(L);
  const VF = placeVisits(follow, L, planOn(L, "namespace", [], g, inputs(names)), inputs(names, got.map((v) => v.place)));
  settle(lead);
  settle(follow);
  const WL = visitWorld(VL, lead), WF = visitWorld(VF, follow);
  for (let k = 0; k < names.length; k++) assert.ok(Math.hypot(WL.vx[k] - WF.vx[k], WL.vy[k] - WF.vy[k]) < 0.2, `${names[k]} is where the leader sees it`);
  // and placing afresh on the same board gives the same places, without presence
  const again = placeVisits(sceneOf(L), L, a, inputs(names));
  assert.deepEqual(again.places, VL.places);
});

test("a visitor's place: free room in its cluster where there is some, else against the rim where it covers least; a newer one never moves an older", () => {
  // two discs in a room of 50: a free spot beside them, nearest what is preferred
  const bodies = [{ x: 0, y: 0, r: 20 }, { x: 25, y: 0, r: 5 }];
  const at = freeSpot(bodies, 50, 6, [0, 30])!;
  assert.ok(at, "there is room");
  for (const b of bodies) assert.ok(Math.hypot(at[0] - b.x, at[1] - b.y) >= b.r + 6, "it covers nothing");
  assert.ok(Math.hypot(at[0], at[1]) <= 44 + 1e-9, "inside the room");
  assert.ok(Math.hypot(at[0] - 0, at[1] - 30) < 6, "near what it was drawn towards");
  // a full room: none free; against the rim where it covers least
  const full = Array.from({ length: 37 }, (_, k) => ({ x: (k % 7) * 10 - 30, y: Math.floor(k / 7) * 10 - 20, r: 5 }));
  assert.equal(freeSpot(full, 30, 5, [0, 0]), null);
  const rim = rimSpot(full, 30, 5, [0, 0]);
  assert.ok(Math.abs(Math.hypot(rim[0], rim[1]) - 25) < 1e-9);
  // the name of a cluster written where it would go: kept clear of it
  const named = freeSpot([], 50, 5, [0, -40], (x, y) => y > -20);
  assert.ok(named && named[1] > -20);
  // a newer visitor's place never moves an older one's
  const { g, layout } = board();
  const L = layout();
  const S = sceneOf(L);
  const first = placeVisits(S, L, planOn(L, "namespace", [], g, inputs(["A.E.v"])), inputs(["A.E.v"]));
  const both = ["A.E.v", "A.Q.w"];
  const second = placeVisits(S, L, planOn(L, "namespace", [], g, inputs(both)), inputs(both, [first.places[0]]));
  assert.deepEqual(second.places[0], first.places[0]);
  assert.notDeepEqual(second.places[1].at, first.places[0].at);
});

test("nothing temporary is the board's: pins, folds and the layout untouched, and every place back when the visitors go", () => {
  const { g, layout } = board("namespace", Array.from({ length: 30 }, (_, k) => `A.B.p${k}`));
  const L = layout();
  const before = JSON.stringify(L);
  const S = sceneOf(L, ["A.C"]);
  S.placeNode(g.byName.get("A.m")!, S.cwx[0] + 3, S.cwy[0] + 3);
  S.endDrag();
  settle(S);
  const names = (i: number) => g.nodes[i].name;
  const pins = JSON.stringify(S.pins(names)), folds = S.foldedKeys();
  const anchors = () => [...S.ancCX, ...S.ancCY, ...S.ancNX, ...S.ancNY].map((v) => Math.round(v * 1000) / 1000);
  const world = () => [...S.cwx, ...S.cwy, ...S.nwx, ...S.nwy, ...S.drawnR].map((v) => Math.round(v * 100) / 100);
  const [a0, w0] = [anchors(), world()];
  // a visitor where A.B has free room moves nothing of the board
  const AB = L.clusters.findIndex((c) => c.key === "A.B");
  const plan = planOn(L, "namespace", [], g, inputs(["A.B.v"]));
  const V = placeVisits(S, L, plan, inputs(["A.B.v"]));
  S.setHeld(V.held);
  settle(S);
  assert.deepEqual(anchors(), a0, "free room: nothing made way");
  // one put on the packed declarations of A.B: they make way, within A.B
  S.setHeld(new Map([[AB, [{ x: 0, y: 0, r: 22 }]]]));
  settle(S);
  assert.notDeepEqual(anchors(), a0, "what it covers made way");
  assert.equal(JSON.stringify(S.pins(names)), pins, "no pin");
  assert.deepEqual(S.foldedKeys(), folds, "no fold");
  for (const i of S.kidsN[AB]) assert.ok(Math.hypot(S.nwx[i] - S.cwx[AB], S.nwy[i] - S.cwy[AB]) <= S.drawnR[AB], "its circle holds them");
  assert.ok(Math.hypot(S.heldAt.get(AB)![0], S.heldAt.get(AB)![1]) < 1e-9, "the visitor stays where it was put");
  // the visitors go: every place is the board's again
  S.setHeld(new Map());
  settle(S);
  assert.deepEqual(anchors(), a0);
  assert.deepEqual(world(), w0);
  assert.equal(S.holds(), false);
  assert.equal(JSON.stringify(L), before, "the layout, which memory is made from, never changed");
});

test("a held disc on free room moves nothing, not even the overlaps the board's own layout has", () => {
  const { layout } = board("namespace", Array.from({ length: 12 }, (_, k) => `A.B.p${k}`));
  const L = layout();
  const AB = L.clusters.findIndex((c) => c.key === "A.B");
  // two declarations of A.B on one spot, as a layout may leave some
  const [i, j] = L.cluster.flatMap((c, n) => (c === AB ? [n] : [])).slice(0, 2);
  L.lx[j] = L.lx[i];
  L.ly[j] = L.ly[i];
  const S = sceneOf(L);
  const before = [...S.ancNX, ...S.ancNY];
  const spot = freeSpot(S.discsIn(AB), S.roomOf(AB), LEAF_R, [0, 0]);
  assert.ok(spot, "A.B has free room");
  S.setHeld(new Map([[AB, [{ x: spot[0], y: spot[1], r: LEAF_R }]]]));
  assert.deepEqual([...S.ancNX, ...S.ancNY], before);
  assert.deepEqual([S.ancNX[i], S.ancNY[i]], [S.ancNX[j], S.ancNY[j]], "the layout's own overlap stays");
});

test("on a board of a past build, a visitor is of that build, against that build's clusters", () => {
  // the past build had A.E (A.E.q, removed since): its board draws A.E, and the visitor A.E.w sits in it
  const past = board("namespace", ["A.E.q"]);
  const now = board();
  const LP = past.layout(), LN = now.layout();
  assert.deepEqual(shape(planOn(LP, "namespace", [], past.g, inputs(["A.E.w"])), LP, ["A.E.w"]), { temps: [], at: { "A.E.w": ["A.E", ""] } });
  assert.deepEqual(shape(planOn(LN, "namespace", [], now.g, inputs(["A.E.w"])), LN, ["A.E.w"]).temps, [["A.E", "E", "A", "", 1]]);
  // a place kept in a cluster that build does not draw is chosen again there
  const S = sceneOf(LP);
  const V = placeVisits(S, LP, planOn(LP, "namespace", [], past.g, inputs(["A.E.w"])), inputs(["A.E.w"], [{ in: "A", at: [1, 1] }]));
  assert.equal(V.places[0].in, "A.E");
});
