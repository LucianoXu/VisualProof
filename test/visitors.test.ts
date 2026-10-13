// Navigation never leaves the board (ViewSpec decision 27, the owner's, 2026-10-10): a declaration
// gone to that the board does not hold is a visitor on it — a temporary point in its own place in the
// cluster hierarchy (2026-10-11; test/visitclusters.test.ts), with its edges to what the board holds.
// It is the reader's own (presence carries it to those who follow them, nothing else does); the last
// few stay as a trail; one the board comes to hold is a member at once.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Views } from "../src/server/views.ts";
import { LAYOUT_VERSION } from "../src/shared/graph.ts";
import { boardSet } from "../src/shared/board.ts";
import { cleanView } from "../src/shared/collab.ts";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { parseQuery, printQuery } from "../src/shared/query.ts";
import { applyEvent, emptyReview } from "../src/shared/review.ts";
import { inTargets, reviewQueue } from "../src/shared/reviewqueue.ts";
import { scopeWith } from "../src/shared/scopeedit.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { clearOfBoxes, freeSpot, MAX_EDGES, readVisitors, shareVisitors, stillVisiting, TRAIL, visit, visitorEdges } from "../src/web/src/visitors.ts";
import type { VisitPlace, Visitor } from "../src/web/src/visitors.ts";

/** t uses d (statement), d uses e (body), t's proof uses p; x uses d. */
function world() {
  const nodes: ViewNode[] = [
    { name: "N.t", kind: "theorem", module: "M.A", ax: 0, hash: "t1" },
    { name: "N.d", kind: "def", module: "M.A", ax: 0, hash: "d1" },
    { name: "N.e", kind: "def", module: "M.B", ax: 0, hash: "e1" },
    { name: "N.p", kind: "theorem", module: "M.A", ax: 0, hash: "p1" },
    { name: "N.x", kind: "def", module: "M.B", ax: 0, hash: "x1" },
  ];
  const edges = new Int32Array([0, 1, SITE_STMT, 1, 2, SITE_BODY, 0, 3, SITE_PROOF, 4, 1, SITE_STMT]);
  const meta = { nodes, projectCount: 5, axioms: ["propext"], axiomSets: [[0]], layouts: {}, edgeCount: 4 } as unknown as ViewMeta;
  return new Graph(meta, edges);
}

const v = (name: string, at: [number, number] | null = null, from: string | null = null, inn = "N"): Visitor => ({ name, from, place: at ? { in: inn, at } : null });

test("the trail: the newest last, a visitor gone to again keeps its place, the oldest go beyond the last few", () => {
  let trail: Visitor[] = [];
  trail = visit(trail, v("A", [1, 1], "T"));
  trail = visit(trail, v("B", [2, 2], "A"));
  assert.deepEqual(trail.map((x) => x.name), ["A", "B"]);
  // gone to again: the newest, where it stood
  trail = visit(trail, v("A", [9, 9]));
  assert.deepEqual(trail.map((x) => [x.name, x.place?.at]), [["B", [2, 2]], ["A", [1, 1]]]);
  for (let k = 0; k < 10; k++) trail = visit(trail, v(`C${k}`));
  assert.equal(trail.length, TRAIL);
  assert.deepEqual(trail.map((x) => x.name), ["C4", "C5", "C6", "C7", "C8", "C9"]);
});

test("a visitor's spot keeps clear of the clusters' names as they are written, as of the points drawn", () => {
  // a cluster's name written across the top of its circle, and a point below it
  const labels = [-30, -12, 30, 0];
  assert.equal(clearOfBoxes(labels, 0, -5, 2), false, "on the name");
  assert.equal(clearOfBoxes(labels, 0, 4, 5), false, "within reach of it");
  assert.equal(clearOfBoxes(labels, 0, 10, 5), true);
  assert.equal(clearOfBoxes([], 0, 0, 5), true);
  // drawn towards the name itself, beside a declaration under it: the nearest free spot clear of it
  const near: [number, number] = [0, -6];
  const at = freeSpot([{ x: 0, y: 14, r: 5 }], 60, 4, near, (x, y) => clearOfBoxes(labels, x, y, 4))!;
  assert.ok(clearOfBoxes(labels, at[0], at[1], 4), `clear of the name: ${at}`);
  assert.deepEqual(freeSpot([{ x: 0, y: 14, r: 5 }], 60, 4, near), near, "where the name is, but for it");
});

test("a visitor's edges: to what the board holds that it uses or that uses it, strong or a proof's, and to the other visitors", () => {
  const g = world();
  // the board holds t and x; d is the visitor, e another one
  const onBoard = new Map([[0, 0], [4, 1]]);
  const toView = (i: number) => onBoard.get(i) ?? -1;
  const visitorOf = (i: number) => (i === 2 ? 0 : -1);
  const e = visitorEdges(g, 1, toView, visitorOf);
  // t and x use d in their statements: both come in; d uses e in its body: a visitor's edge, out
  assert.deepEqual(e.board.sort((a, b) => a[0] - b[0]), [[0, true, true], [1, true, true]]);
  assert.deepEqual(e.visitors, [[0, false, true]]);
  // p's only reference is t's proof: drawn, fainter
  const ep = visitorEdges(g, 3, toView, () => -1);
  assert.deepEqual(ep.board, [[0, true, false]]);
  assert.ok(MAX_EDGES >= 100);
});

test("a visitor is the reader's own: presence carries the trail to whoever follows, read back with care", () => {
  const trail = [v("N.d", [12.345, -3.21], "N.t"), v("N.e", [1, 2], null, ""), v("N.f")];
  const drawn: [number, number][] = [[40.04, 7], [1, 2], [5, 5]];
  const shared = shareVisitors(trail, (k) => drawn[k]);
  assert.deepEqual(shared, [
    { decl: "N.d", at: [40, 7], from: "N.t", in: "N", spot: [12.3, -3.2] },
    { decl: "N.e", at: [1, 2], in: "", spot: [1, 2] },
    { decl: "N.f", at: [5, 5] },
  ]);
  const place = { mode: "plain", sel: "N.d", source: false, clusterMode: "namespace", cam: null, view: "v1", scope: null, tabs: [], visitors: [...shared, { decl: "", at: [0, 0] }, { decl: "N.x", spot: [NaN, 1], in: "N" }, "junk"] };
  const clean = cleanView(place)!;
  assert.deepEqual(clean.visitors, [...shared, { decl: "N.x" }], "what is no visitor is left out, and a place that is none");
  const back: VisitPlace | null = readVisitors(clean.visitors)[0].place;
  assert.deepEqual(back, { in: "N", at: [12.3, -3.2] });
  assert.deepEqual(readVisitors(clean.visitors).slice(0, 3), [v("N.d", [12.3, -3.2], "N.t"), v("N.e", [1, 2], null, ""), v("N.f")]);
  // a page of before 2026-10-11 says a place of the world alone: the follower places it
  assert.deepEqual(readVisitors([{ decl: "N.d", at: [3, 4], from: "N.t" }]), [v("N.d", null, "N.t")]);
  assert.deepEqual(readVisitors(undefined), []);
  assert.equal("visitors" in cleanView({ ...place, visitors: [] })!, false);
  assert.ok((cleanView({ ...place, visitors: Array.from({ length: 30 }, (_, k) => ({ decl: `N.${k}`, at: [k, k] })) })!.visitors ?? []).length <= 8);
});

test("Add to view makes a visitor a member, and so does a key mark on a target's Key view; the trail drops what the board holds", () => {
  const g = world();
  const d = emptyReview();
  d.targets["N.t"] = { by: "Alice", at: "2026-10-10T00:00:00Z" };
  const holds = (scope: string) => {
    const bs = boardSet(g, d, parseQuery(scope));
    return (name: string) => bs.set[g.byName.get(name)!] === 1;
  };
  // the board: decl(N.t); N.d and N.e visitors
  let trail = [v("N.d"), v("N.e")];
  const scope = parseQuery("decl(N.t)");
  // Add to view: decl(N.t, N.d), and N.d is a member at once
  const added = printQuery(scopeWith(scope, { op: "decl", names: ["N.d"] }, () => false));
  assert.equal(added, "decl(N.t, N.d)");
  const onBoard = holds(added);
  trail = stillVisiting(trail, (n) => !onBoard(n));
  assert.deepEqual(trail.map((x) => x.name), ["N.e"]);
  // the same array where nothing went
  assert.equal(stillVisiting(trail, () => true), trail);
  // a target's Key view holds its key set: N.d marked key for N.t is on it from then on
  const key = "key(N.t)";
  assert.equal(holds(key)("N.d"), false);
  applyEvent(d, { op: "key", at: "2026-10-10T00:00:01Z", by: "Alice", target: "N.t", name: "N.d", on: true });
  assert.equal(holds(key)("N.d"), true);
  assert.deepEqual(stillVisiting([v("N.d")], (n) => !holds(key)(n)), []);
});

test("the target's review list holds the focus's whole review set, whatever the board holds: a row it does not hold is gone to as a visitor", () => {
  const g = world();
  const d = emptyReview();
  d.targets["N.t"] = { by: "Alice", at: "2026-10-10T00:00:00Z" };
  const q = reviewQueue(g, d, 0, inTargets(g, [0]));
  // the board: the target's Key view, which holds the target alone
  const bs = boardSet(g, d, parseQuery("key(N.t)"));
  const row = q.order.find((i) => !bs.set[i]);
  assert.notEqual(row, undefined, "the review list holds what the board does not");
  // gone to: a visitor, reached from the target, its place the canvas's to choose
  const trail = visit([], { name: g.nodes[row!].name, from: "N.t", place: null });
  assert.deepEqual(trail.map((x) => [x.name, x.from]), [[g.nodes[row!].name, "N.t"]]);
});

test("a visitor is never part of a view: a page that has some changes nothing of the views the server keeps", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-visitors-"));
  try {
    const views = new Views(dir, LAYOUT_VERSION, () => {});
    // the target's view, kept
    const its = views.book.create("N.t closely", "Alice", { scope: parseQuery("tcb(N.t)") }) as { id: string };
    views.book.link(its.id, "N.t", "Alice");
    views.syncTargets(["N.t"]);
    const file = join(dir, "views.json");
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    const view = cleanView({ mode: "plain", sel: "N.d", source: false, clusterMode: "namespace", cam: null, view: its.id, scope: null, tabs: [its.id], visitors: [{ decl: "N.d", at: [3, 4], from: "N.t", in: "N", spot: [1, 1] }] })!;
    views.seenPeers([{ id: "s1", name: "Alice", idle: false, view } as never]);
    views.sweep();
    const after = existsSync(file) ? readFileSync(file, "utf8") : "";
    assert.equal(after, before, "views.json is as it was");
    const r = views.book.get(its.id)!;
    assert.equal(printQuery(r.scope).includes("N.d"), false);
    assert.deepEqual([r.pins.namespace.nodes, views.book.memoryOf(r.id, "namespace")], [{}, null]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
