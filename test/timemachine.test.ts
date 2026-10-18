// The Time Machine (HistorySpec decisions 15–19): the ruler, a tick per build at equal intervals;
// a past graph and its marks against now, from what /diff says; its board, cut by the view's scope,
// laid out so that what both have stays where it is now; a view kept at a build — the operation on
// the server and on the page, kept and saved as a new view, read and set by agents; where a reader is
// in it, in presence, and following that ends on the follower's own step; the read-only guards; and
// the snapshot's graph served in parts, kept.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { refusal } from "../src/server/agent.ts";
import type { Answer, Ask, World } from "../src/server/agent.ts";
import { viewEndpoints } from "../src/server/agentviews.ts";
import { diffGraphs, History } from "../src/server/history.ts";
import { historyAnswer } from "../src/server/historyapi.ts";
import type { HistoryWorld } from "../src/server/historyapi.ts";
import { Presence } from "../src/server/presence.ts";
import { ownName } from "../src/server/versions.ts";
import { Views as ServerViews } from "../src/server/views.ts";
import { boardSet, edgesOf, lightUp, snapshotOfKey, wholeLayout } from "../src/shared/board.ts";
import { cleanView } from "../src/shared/collab.ts";
import { packEdges, unpackEdges } from "../src/shared/edgecodec.ts";
import type { ClusterMode, Layout, RawGraph, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_BODY, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { parseQuery } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import type { NewEvent, StoredEvent } from "../src/shared/timeline.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { applyViewOps, invalidViewOps, PROJECT, summary, ViewBook } from "../src/shared/views.ts";
import type { Change, ViewData } from "../src/shared/views.ts";
import { menuItems } from "../src/web/src/ctxmenu.ts";
import { LayoutQueue } from "../src/web/src/layoutqueue.ts";
import type { LayoutWorker } from "../src/web/src/layoutqueue.ts";
import { layOut } from "../src/web/src/layoutworker.ts";
import { keepInView, markWords, maxScroll, nearestTick, onNewBuild, PAST_CHANGED, PAST_GHOST, PAST_RENAMED, pastGraph, pastMemory, reviewThen, ruler, RULER, Seek, step, tickX, timeline, unreadWords } from "../src/web/src/past.ts";
import type { HistoryDiff, Snapshot, SnapshotNodes } from "../src/web/src/past.ts";
import { pressActs } from "../src/web/src/surfaces.ts";
import type { PageEl } from "../src/web/src/surfaces.ts";
import { clusterPick } from "../src/web/src/selection.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const H = 3_600_000;
const T0 = Date.parse("2026-10-06T12:00:00Z");
const snap = (id: number, at: number, nodes = 10, approx = false): Snapshot => ({
  id,
  at: new Date(at).toISOString(),
  ...(approx ? { approx: true as const } : {}),
  read: new Date(at).toISOString(),
  commit: { hash: `c${id}`.padEnd(40, "0"), branch: "main" },
  toolchain: "tc",
  missing: [],
  counts: { modules: 2, nodes, edges: 3, externals: 1 },
});

test("the ruler: a tick per build at equal intervals, long for the first build of a commit; where a drag or a step lands; many builds scroll", () => {
  const c = (id: number, at: number, hash: string | null, dirty = false): Snapshot => ({ ...snap(id, at), commit: hash ? { hash: hash.padEnd(40, "0"), branch: "main", ...(dirty ? { dirty: true } : {}) } : null });
  // ids are not in build order: the timeline is; builds minutes apart and days apart are a step
  // apart alike
  const snaps = [c(3, T0 + 20 * 60_000, "b"), c(1, T0, "a"), c(2, T0 + 10 * 60_000, "a", true), c(4, T0 + 50 * H, "b"), c(5, T0 + 75 * H, "a")];
  const t = timeline(snaps);
  assert.deepEqual(t.ticks.map((k) => k.id), [1, 2, 3, 4, 5]);
  const r = ruler(t.ticks.length, 300);
  const xs = t.ticks.map((_, i) => tickX(r, i));
  assert.ok(xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1] - r.step) < 1e-9), "equal intervals");
  assert.equal(r.step, RULER.maxStep, "a few builds are no further apart than the farthest step");
  assert.equal(r.width, 4 * RULER.maxStep + 2 * RULER.pad, "and the ruler only as wide as they need");
  assert.equal(maxScroll(r), 0);
  // major: the first build of a commit (its commit not the build before's: back to a commit is a new
  // one again); minor: the same commit built again, edited or not
  assert.deepEqual(t.ticks.map((k) => k.major), [true, false, true, false, true]);
  const day = (at: number) => new Date(at).toDateString();
  assert.deepEqual(t.ticks.map((k) => k.day), t.ticks.map((k, i) => i === 0 || day(k.at) !== day(t.ticks[i - 1].at)));
  // without commits (no git repository), the first build of a day is major
  const plain = timeline([c(1, T0, null), c(2, T0 + H, null), c(3, T0 + 30 * H, null), c(4, T0 + 31 * H, "x")]);
  assert.deepEqual(plain.ticks.map((k) => k.major), [true, false, true, true]);
  // a drag lands on the nearest tick, the ends on the first and the last; a step goes one build on
  // or back, and no further
  assert.equal(nearestTick(t, r, 0), 1);
  assert.equal(nearestTick(t, r, xs[1] + r.step * 0.4), 2);
  assert.equal(nearestTick(t, r, xs[1] + r.step * 0.6), 3);
  assert.equal(nearestTick(t, r, 1e6), 5);
  assert.equal(step(t, 2, -1), 1);
  assert.equal(step(t, 2, 1), 3);
  assert.equal(step(t, 5, 1), null);
  assert.equal(step(t, 1, -1), null);
  // two builds spread over the narrowest ruler; a single build stands in its middle
  const two = ruler(2, 300);
  assert.equal(two.width, RULER.minWidth);
  assert.equal(tickX(two, 1) - tickX(two, 0), RULER.minWidth - 2 * RULER.pad);
  const one = ruler(1, 300);
  assert.equal(tickX(one, 0), one.width / 2);
  assert.equal(nearestTick(timeline([snap(7, T0)]), one, 3), 7);
  assert.equal(nearestTick(timeline([]), one, 3), null);
  // more builds than fit the closest step apart: the ruler takes the whole room and its strip
  // scrolls, the build aimed at kept in sight with two steps around it
  const many = ruler(100, 300);
  assert.equal(many.step, RULER.minStep);
  assert.equal(many.width, 300);
  assert.equal(many.strip, 99 * RULER.minStep + 2 * RULER.pad);
  assert.equal(maxScroll(many), many.strip - 300);
  assert.equal(keepInView(many, maxScroll(many), 0), 0, "the first build: the strip's start");
  assert.equal(keepInView(many, 0, 99), maxScroll(many), "the last: its end");
  const mid = keepInView(many, 0, 50);
  assert.equal(mid, tickX(many, 50) + 2 * RULER.minStep - 300, "scrolled as little as shows it with its margin");
  assert.equal(keepInView(many, mid, 45), mid, "a build in sight moves nothing");
  const bigT = timeline(Array.from({ length: 100 }, (_, i) => snap(i + 1, T0 + i * H)));
  assert.equal(nearestTick(bigT, many, mid + 150), bigT.ticks[Math.round((mid + 150 - RULER.pad) / RULER.minStep)].id, "a place on the strip, scrolled");
  // a room narrower than the narrowest ruler: the ruler takes it all
  assert.equal(ruler(3, 60).width, 60);
});

// ---------------------------------------------------------------------------------- a past graph

/** The graph on show: A.S, A.g (A.f renamed), B.t (changed since), B.u (new since); Nat outside. */
function now(): Graph {
  const nodes: ViewNode[] = [
    { name: "A.S", kind: "structure", module: "A", ax: 0, type: "Type", hash: "vS" },
    { name: "A.g", kind: "def", module: "A", ax: 0, type: "A.S → Nat", hash: "vf" },
    { name: "B.t", kind: "theorem", module: "B", ax: 0, type: "∀ s, A.g s = 0", hash: "vt2" },
    { name: "B.u", kind: "theorem", module: "B", ax: 1, type: "B.t", hash: "vu" },
    { name: "Nat", kind: "inductive", module: "Init", ax: 0, ext: true },
  ];
  const meta = {
    schema: 1, layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: "/x", roots: ["B"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [{ name: "A", file: "A.lean", imports: [] }, { name: "B", file: "B.lean", imports: ["A"] }],
    nodes, projectCount: 4, axioms: ["propext", "sorryAx"], axiomSets: [[], [1]],
    layouts: {} as Record<ClusterMode, Layout>, edgeCount: 5,
  } as ViewMeta;
  // g → S, g → Nat, t → g, u → t, u → g
  const edges = new Int32Array([1, 0, SITE_STMT, 1, 4, SITE_STMT, 2, 1, SITE_STMT, 3, 2, SITE_STMT, 3, 1, SITE_BODY]);
  meta.layouts = { namespace: computeLayout("namespace", nodes, edges), module: computeLayout("module", nodes, edges) };
  return new Graph(meta, edges);
}

/** The snapshot of then: A.S, A.f, B.t, B.old (gone now); Nat outside. */
function then(): { nodes: SnapshotNodes; edges: Int32Array; diff: HistoryDiff } {
  const nodes: SnapshotNodes = {
    snapshot: snap(5, T0),
    modules: [{ name: "A", imports: [] }, { name: "B", imports: ["A"] }],
    nodes: [
      { name: "A.S", kind: "structure", module: "A", ax: 0, type: "Type", hash: "vS" },
      { name: "A.f", kind: "def", module: "A", ax: 0, type: "A.S → Nat", hash: "vf" },
      { name: "B.t", kind: "theorem", module: "B", ax: 0, type: "∀ s, A.f s = 1", hash: "vt1" },
      { name: "B.old", kind: "theorem", module: "B", ax: 0, type: "True", hash: "vo" },
      { name: "Nat", kind: "inductive", module: "Init", ax: 0, ext: true },
    ],
    projectCount: 4,
    axioms: ["propext"],
    axiomSets: [[], [0]],
    edgeCount: 4,
  };
  // f → S, f → Nat, t → f, old → t
  const edges = new Int32Array([1, 0, SITE_STMT, 1, 4, SITE_STMT, 2, 1, SITE_STMT, 3, 2, SITE_STMT]);
  const diff: HistoryDiff = { from: 5, to: 9, counts: { added: 1, removed: 1, changed: 1, renamed: 1 }, added: ["B.u"], removed: ["B.old"], changed: ["B.t"], renamed: [["A.f", "A.g"]] };
  return { nodes, edges, diff };
}

test("a past graph: that build's declarations alone, marked from the diff — ghost, changed, renamed (the owner's decision, 2026-10-10)", () => {
  const N = now();
  const T = then();
  const p = pastGraph(T.nodes, T.edges, N, T.diff);
  const g = p.graph;
  // the snapshot's project, then the outside world: B.u, new since, is not of that build
  assert.deepEqual(g.nodes.map((v) => v.name), ["A.S", "A.f", "B.t", "B.old", "Nat"]);
  assert.equal(g.projectCount, 4);
  assert.equal(g.byName.get("B.u"), undefined);
  const mark = (name: string) => p.marks[g.byName.get(name)!];
  assert.equal(mark("A.S"), 0);
  assert.equal(mark("A.f"), PAST_RENAMED, "under its name then");
  assert.equal(mark("B.t"), PAST_CHANGED, "another version now");
  assert.equal(mark("B.old"), PAST_GHOST, "gone now");
  assert.equal(p.nowName.get("A.f"), "A.g");
  assert.deepEqual(markWords(mark("A.f"), "A.g"), ["now A.g"]);
  // a declaration renamed and changed carries both: the diff's `changed` names it as it is now
  const both = pastGraph(T.nodes, T.edges, N, { ...T.diff, changed: ["A.g"] });
  assert.equal(both.marks[both.graph.byName.get("A.f")!], PAST_RENAMED | PAST_CHANGED);
  // the snapshot's edges kept
  const out = (name: string) => [...g.reach([g.byName.get(name)!], SITE_STMT | SITE_BODY, "out")].flatMap((x, i) => (x && g.nodes[i].name !== name ? [g.nodes[i].name] : [])).sort();
  assert.deepEqual(out("A.f"), ["A.S", "Nat"]);
  assert.deepEqual(out("B.old"), ["A.S", "A.f", "B.t", "Nat"]);
  // the snapshot's axioms
  assert.deepEqual(g.axiomsOf(g.byName.get("A.f")!), []);
  // the snapshot's build time is the graph's
  assert.equal(g.meta.project.extractedAt, T.nodes.snapshot.at);
});

test("a past board is a board of the past graph: its scope evaluated there, nothing new since on it", () => {
  const N = now();
  const T = then();
  const p = pastGraph(T.nodes, T.edges, N, T.diff);
  const names = (s: Uint8Array) => p.graph.nodes.filter((_, i) => s[i]).map((v) => v.name);
  const board = (q: string) => boardSet(p.graph, emptyReview(), parseQuery(q));
  // a closure of then: B.t's TCB then holds what it used then (the owner's decision of 2026-10-10:
  // the set comes from the snapshot)
  const tcb = board("tcb(B.t)");
  assert.deepEqual(names(tcb.set), ["A.S", "A.f", "B.t", "Nat"]);
  assert.ok(!tcb.whole && tcb.sub);
  // a namespace holds its declarations of then, the ghost among them, and none new since
  assert.deepEqual(names(board("ns(B) except external").set), ["B.t", "B.old"]);
  assert.deepEqual(names(board("decl(B.t)").set), ["B.t"]);
  assert.deepEqual(names(board("decl(B.u)").set), [], "a name new since names nothing there");
  // everything: the whole graph, as the Project is
  const all = board("all");
  assert.ok(all.whole && all.outside && !all.sub);
});

test("a view whose build has declarations renamed since: its names of now reach them, what was said of them is read under their names then", () => {
  const N = now();
  const T = then();
  const p = pastGraph(T.nodes, T.edges, N, T.diff);
  const g = p.graph;
  // A.f was renamed A.g since: at this build it is A.f, and answers to A.g too
  assert.equal(g.byName.get("A.g"), g.byName.get("A.f"));
  assert.equal(g.nodes[g.byName.get("A.g")!].name, "A.f");
  // a scope as a move left it, in names of now, holds it; so does a board of part of the graph
  const bs = boardSet(g, emptyReview(), parseQuery("decl(A.g) or tcb(B.t)"));
  assert.deepEqual(bs.sub!.graph.nodes.map((v) => v.name), ["A.S", "A.f", "B.t", "Nat"]);
  assert.equal(bs.sub!.graph.byName.get("A.g"), bs.sub!.graph.byName.get("A.f"), "the other names go with a declaration into a board");
  // the review: an approval and a target mark of A.g, a key mark of it for B.t, all kept under A.g
  const d = emptyReview();
  d.opinions["A.g"] = [{ by: "Alice", verdict: "approve", at: "", hash: "vf" } as never];
  d.targets["A.g"] = { by: "Alice", at: "" };
  d.keys["B.t"] = Object.assign(Object.create(null), { "A.g": { by: "Bob", at: "" } });
  const r = reviewThen(d, p.nowName);
  assert.equal(r.opinions["A.f"], d.opinions["A.g"]);
  assert.equal(r.targets["A.f"], d.targets["A.g"]);
  assert.ok(Object.hasOwn(r.keys["B.t"], "A.f"));
  assert.ok(!Object.hasOwn(d.opinions, "A.f"), "the review itself is left as it is");
  // what reads the review by name on that graph finds it: a status condition, the key marks
  const approved = boardSet(g, r, parseQuery("status(approved)"));
  assert.deepEqual(g.nodes.filter((_, i) => approved.set[i]).map((v) => v.name), ["A.f"]);
  const keys = boardSet(g, r, parseQuery("key(B.t)"));
  assert.deepEqual(g.nodes.filter((_, i) => keys.set[i]).map((v) => v.name), ["A.f", "B.t"]);
  // nothing renamed: the review as it is
  assert.equal(reviewThen(d, new Map()), d);
});

test("selecting a cluster of a past board lights every declaration of that build in it (the owner's report, 2026-10-10)", () => {
  const N = now();
  const T = then();
  const p = pastGraph(T.nodes, T.edges, N, T.diff);
  const g = p.graph;
  // a cluster pick under each tool, on the whole board and on a board of the namespace: what is lit
  // is computed on the past graph, the board's own numbering, which holds no declaration new since
  for (const scope of ["all", "ns(B) except external", "ns(B) or ns(A)"]) {
    const bs = boardSet(g, emptyReview(), parseQuery(scope));
    const board = bs.sub ? bs.sub.graph : g;
    const toFull = (j: number) => (bs.sub ? bs.sub.toFull[j] : j);
    for (const tool of ["plain", "tcb", "deps", "apps", "keys"] as const) {
      const pick = clusterPick(tool, { key: "B", label: "B", parent: -1, depth: 0, x: 0, y: 0, lx: 0, ly: 0, r: 1, count: 3, ext: false }, "namespace");
      const lit = lightUp(g, emptyReview(), bs, pick.q);
      const litNames = board.nodes.filter((_, j) => lit.set[j]).map((v) => v.name);
      for (const name of ["B.t", "B.old"]) assert.ok(litNames.includes(name), `${scope}, ${tool}: ${name} lit`);
      assert.ok(!board.byName.has("B.u"), `${scope}: B.u, new since, is not on the board`);
      // the marks the canvas draws are read in the board's numbering: B.old is the ghost
      const j = board.byName.get("B.old")!;
      assert.equal(p.marks[toFull(j)], PAST_GHOST, `${scope}: B.old is gone now, and lit`);
    }
  }
});

test("a past graph is laid out from the board of now: what both have stays where it is, a renamed one under its name then", () => {
  const N = now();
  const T = then();
  const p = pastGraph(T.nodes, T.edges, N, T.diff);
  for (const mode of ["namespace", "module"] as ClusterMode[]) {
    const nowL = wholeLayout(N.meta.layouts[mode], N.nodes, mode, []);
    const mem = pastMemory(nowL, N.nodes, p.nowName);
    assert.deepEqual(mem.nodes["A.f"], mem.nodes["A.g"], "remembered under its name then");
    const L = layOut({ mode, nodes: p.graph.nodes, edges: edgesOf(p.graph), hidden: [], mem });
    const at = (L2: Layout, g: Graph, name: string) => {
      const i = g.byName.get(name)!;
      return [L2.x[i], L2.y[i]];
    };
    // A did not change but for the rename: all of it stays, the renamed one where it is now; so does
    // the outside world
    for (const [past, present] of [["A.S", "A.S"], ["A.f", "A.g"], ["Nat", "Nat"]])
      assert.deepEqual(at(L, p.graph, past), at(nowL, N, present), `${mode}: ${past} stays where ${present} is`);
    const clusterOf = (L2: Layout, g: Graph, name: string) => L2.clusters[L2.cluster[g.byName.get(name)!]].key;
    for (const name of ["A.S", "A.f"]) assert.equal(clusterOf(L, p.graph, name), clusterOf(nowL, N, name === "A.f" ? "A.g" : name));
    // B holds a ghost: each declaration of it has a place of its own there, on nothing else (where its
    // height in B's dependency order moved, the fresh layout's: CanvasSpec, "Dependency order")
    const B = ["B.t", "B.old"];
    for (const name of B) assert.equal(clusterOf(L, p.graph, name), "B");
    for (const a of B)
      for (const b of B) if (a < b) assert.ok(Math.hypot(at(L, p.graph, a)[0] - at(L, p.graph, b)[0], at(L, p.graph, a)[1] - at(L, p.graph, b)[1]) >= 9, `${mode}: ${a} clear of ${b}`);
  }
});

// ------------------------------------------------------------------------------------ a version

test("a view's version: an operation, applied the same way everywhere; refused on the Project and the views linked to targets", () => {
  assert.equal(invalidViewOps([{ op: "version", snapshot: 3 }]), null);
  assert.equal(invalidViewOps([{ op: "version", snapshot: null }]), null);
  assert.equal(invalidViewOps([{ op: "version", snapshot: 0 }]), "snapshot");
  assert.equal(invalidViewOps([{ op: "version", snapshot: "3" }]), "snapshot");
  const book = new ViewBook();
  const v = book.create("Kummer", "Alice", { scope: parseQuery("ns(A)") }) as ViewData;
  const r = book.arrange(v.id, [{ op: "version", snapshot: 3 }], "Alice") as Change[];
  assert.deepEqual(r, [{ id: v.id, what: "version", by: "Alice", snapshot: 3 }]);
  assert.equal(v.version, 3);
  assert.equal(summary(v).version, 3, "the list says it: each tab's clock");
  assert.equal(book.arrange(v.id, [{ op: "version", snapshot: 3 }], "Alice"), null, "nothing changed");
  // a pin and the version at once: the pin is the view's, the version too
  assert.deepEqual(book.arrange(v.id, [{ op: "pin", mode: "namespace", kind: "node", key: "A.x", at: [1, 2] }], "Bob"), []);
  assert.deepEqual(book.arrange(v.id, [{ op: "version", snapshot: null }], "Bob"), [{ id: v.id, what: "version", by: "Bob", snapshot: null }]);
  assert.equal(v.version, undefined);
  // a clear is a re-layout's: the pins go, the version stays
  applyViewOps(v, [{ op: "version", snapshot: 2 }, { op: "clear" }]);
  assert.deepEqual([v.version, v.pins.namespace.nodes], [2, {}]);
  applyViewOps(v, [{ op: "pin", mode: "namespace", kind: "node", key: "A.x", at: [1, 2] }]);
  // the Project and the views linked to targets always show the latest
  assert.match(book.arrange(PROJECT, [{ op: "version", snapshot: 3 }], "Alice") as string, /always show the latest/);
  const linked = book.openTarget("B.t", "Alice").view;
  assert.match(book.arrange(linked.id, [{ op: "version", snapshot: 3 }], "Alice") as string, /always show the latest/);
  assert.equal(book.arrange(PROJECT, [{ op: "version", snapshot: null }], "Alice"), null, "the latest is what it shows");
  // Save as new view: a copy of the view, kept at a build; a copy of a kept view is kept there too
  const saved = book.create("Kummer · Oct 7", "Alice", { from: v.id, version: 4 }) as ViewData;
  assert.deepEqual([saved.version, saved.scope, saved.pins.namespace.nodes["A.x"]], [4, v.scope, [1, 2]]);
  assert.equal((book.create("copy", "Bob", { from: saved.id }) as ViewData).version, 4);
  assert.equal((book.create("latest", "Bob", { from: saved.id, version: null }) as ViewData).version, undefined);
  assert.match(book.create("x", "Bob", { version: 0 }) as string, /snapshot's id/);
});

/** A server's views in a site directory of their own, with a history of snapshots 1 to 4. */
function server(dir: string) {
  const sent: { event: string; data: Json }[] = [];
  const events: StoredEvent[] = [];
  const timeline = { add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: new Date().toISOString() } as StoredEvent), events[events.length - 1]) };
  const views = new ServerViews(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data: data as Json }), timeline);
  views.snapshotAt = (id) => (id >= 1 && id <= 4 ? new Date(T0 + id * H).toISOString() : null);
  const ask = (path: string, body: Json, name: string | null = "Alice") => views.handle({ method: "POST", path, query: new URLSearchParams(), body, caller: { name, kind: "person" } } as Ask, "full");
  return { views, sent, events, ask };
}

test("the server keeps a view at a build for everyone on it, says so to the pages, and the timeline records it", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-tm-views-"));
  try {
    const S = server(dir);
    const id = ((S.ask("/api/views/create", { name: "Kummer", scope: "ns(A)" }).body as Json).view as ViewData).id;
    const keep = (snapshot: number | null, name: string | null = "Alice") => S.ask("/api/views/arrange", { id, ops: [{ op: "version", snapshot }] }, name);
    assert.equal(keep(3).status, 200);
    assert.equal(S.views.book.get(id)!.version, 3);
    // every page is told: the operation, and the list with the clock
    assert.ok(S.sent.some((s) => s.event === "view-ops" && s.data.id === id && s.data.ops[0].op === "version"));
    const list = S.sent.filter((s) => s.event === "views").at(-1)!.data;
    assert.equal(list.views.find((v: Json) => v.id === id).version, 3);
    assert.deepEqual(list.changes, [{ id, what: "version", by: "Alice", snapshot: 3 }]);
    // the timeline: which build, when it was built
    const e = S.events.at(-1) as Json;
    assert.deepEqual([e.kind, e.what, e.view, e.snapshot, e.built, e.by], ["view", "version", id, 3, new Date(T0 + 3 * H).toISOString(), "Alice"]);
    // a build the history does not have, a reader without a name, the Project: refused
    assert.equal(keep(9).status, 400);
    assert.match((keep(9).body as Json).error, /no snapshot 9/);
    assert.equal(keep(2, null).status, 401);
    assert.equal(S.ask("/api/views/arrange", { id: PROJECT, ops: [{ op: "version", snapshot: 2 }] }).status, 400);
    assert.equal(S.views.book.get(id)!.version, 3, "a refused request changes nothing");
    // kept on disk
    const again = new ServerViews(dir, LAYOUT_VERSION, () => {});
    assert.equal(again.book.get(id)!.version, 3);
    // the latest again
    assert.equal(keep(null).status, 200);
    assert.equal(S.views.book.get(id)!.version, undefined);
    assert.equal((S.events.at(-1) as Json).snapshot, null);
    // Save as new view: views/create with from and the version, which the history must have
    const saved = S.ask("/api/views/create", { name: "Kummer · then", from: id, version: 2 });
    assert.equal(saved.status, 200);
    assert.equal(((saved.body as Json).view as ViewData).version, 2);
    assert.equal(S.ask("/api/views/create", { name: "nope", from: id, version: 7 }).status, 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agents read a view's version, and at level full keep it at a build or bring it back to the latest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-tm-agents-"));
  try {
    const N = now();
    const edges = edgesOf(N);
    const meta = N.meta;
    const views = new ServerViews(dir, LAYOUT_VERSION, () => {}, { add: (e) => e as never });
    views.snapshotAt = (id) => (id === 2 ? new Date(T0).toISOString() : null);
    const presence = new Presence(() => {});
    views.peers = () => presence.list();
    const w = {
      project: { root: dir, files: new Map(), toolchain: "tc" },
      graph: { version: 1, prep: { metaGz: gzipSync(JSON.stringify(meta)), edgesGz: gzipSync(Buffer.from(edges.buffer)) } },
      review: { data: emptyReview(), append: () => ({ status: 403, error: "no" }) },
      timeline: { events: [], add: (e: never) => e },
      places: views.places,
      presence,
      placesChanged: () => {},
      views,
    } as unknown as World;
    const eps = viewEndpoints(w, () => refusal("full", "full"));
    const ask = async (method: "GET" | "POST", path: string, params: Json): Promise<Answer> => {
      const e = eps.find((x) => x.method === method && x.path === path)!;
      const caller = { name: "Claude", kind: "agent" as const };
      return e.run(method === "GET" ? { method, path, query: new URLSearchParams(params), body: null, caller } : { method, path, query: new URLSearchParams(), body: params, caller });
    };
    const made = await ask("POST", "/api/agent/views/create", { name: "B then", scope: "ns(B)", version: 2 });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const id = (made.body as Json).view.id;
    assert.equal((made.body as Json).view.version, 2);
    // read: the view says the build it is kept at
    assert.equal(((await ask("GET", "/api/agent/views/view", { id })).body as Json).view.version, 2);
    // 0 is the latest again, as a tool's integer says it
    assert.equal((await ask("POST", "/api/agent/views/arrange", { id, version: 0 })).status, 200);
    assert.equal(views.book.get(id)!.version, undefined);
    assert.equal((await ask("POST", "/api/agent/views/arrange", { id, version: 2 })).status, 200);
    assert.equal(views.book.get(id)!.version, 2);
    assert.equal((await ask("POST", "/api/agent/views/arrange", { id, version: 5 })).status, 400, "a build the history does not have");
    assert.equal((await ask("POST", "/api/agent/views/arrange", { id: PROJECT, version: 2 })).status, 400);
    assert.equal((await ask("POST", "/api/agent/views/create", { name: "x", version: 5 })).status, 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the page keeps a view at a build from a preview, which nothing arranges, and takes another page's at once", async () => {
  const { Views } = await import("../src/web/src/views.ts");
  const { ViewNav } = await import("../src/web/src/viewnav.ts");
  const { BoardSync } = await import("../src/web/src/boardsync.ts");
  const { Store } = await import("../src/web/src/store.ts");
  const N = now();
  const book = new ViewBook();
  const rec = book.create("B", "Alice", { scope: parseQuery("ns(B)") }) as ViewData;
  const posted: Json[] = [];
  const api = {
    list: async () => book.list().map(summary),
    get: async () => ({ view: structuredClone(rec), memory: {} }),
    memory: async () => null,
    post: async (action: string, body: Json) => {
      posted.push({ action, ...body });
      return action === "memory" ? { accepted: true } : { ok: true };
    },
  };
  const views = new Views(api as never, { graph: () => N, meta: () => N.meta, review: () => emptyReview() });
  await views.load();
  const nav = new ViewNav(views, new Store("/nowhere"), { show: () => {}, place: () => {}, here: () => ({ cam: null, mode: "plain", picks: null, shown: null }), changed: () => {} });
  const hints: string[] = [];
  let frozen: string | null = "a preview";
  const noop = () => {};
  const canvas = { layout: { clusters: [] }, pinsRecord: () => ({ nodes: { "B.t": [1, 1] }, clusters: {} }), foldedKeys: () => ["B"] };
  const sync = new BoardSync(views, nav, {
    canvas: canvas as never, outline: { render: noop } as never, boardPanel: { render: noop, note: noop } as never, notes: { at: noop } as never,
    snapshot: false, stream: () => null, me: () => "Alice", colorOf: () => "red", lost: noop, tabsChanged: noop, levelChanged: noop, activityChanged: noop, hint: (t) => hints.push(t), writeAddress: noop, notesChanged: noop,
    frozen: () => frozen,
  });
  assert.equal(await nav.show(rec.id), true);
  // a preview of the view at another build: nothing arranges the board, and why is said
  await sync.arrange([{ op: "fold", mode: "namespace", key: "B", on: true }]);
  sync.sharePins();
  sync.shareFolds();
  assert.equal(await sync.setScope(parseQuery("all")), "a preview");
  await sync.setHidden(["B"], true);
  assert.deepEqual(posted.filter((p) => p.action !== "memory"), []);
  assert.deepEqual(hints, ["a preview", "a preview"]);
  // keeping a build is what may be done there
  assert.equal(await sync.keepVersion(3), null);
  assert.deepEqual(posted.at(-1), { action: "arrange", id: rec.id, token: null, ops: [{ op: "version", snapshot: 3 }] });
  assert.equal(views.rec(rec.id)!.version, 3);
  // another page brought it back to the latest: the operation comes first, and the board is shown
  // again at once (it was applied silently before, and the list that came after found nothing changed)
  let redrawn = 0;
  const redraw = nav.redraw.bind(nav);
  nav.redraw = () => (redrawn++, redraw());
  sync.ops({ id: rec.id, ops: [{ op: "version", snapshot: null }], from: "another page", by: "Bob" });
  assert.equal(views.rec(rec.id)!.version, undefined);
  assert.equal(redrawn, 1, "the board on show is drawn again, of the latest build");
  // the list that follows finds it applied; a list alone (a page that was away) says it too
  assert.ok(!views.listed([{ ...summary(rec), version: undefined }], [{ id: rec.id, what: "version", by: "Bob", snapshot: null }]).redo.has(rec.id));
  views.rec(rec.id)!.version = 3;
  const { redo } = views.listed([{ ...summary(rec), version: undefined }], [{ id: rec.id, what: "version", by: "Bob", snapshot: null }]);
  assert.ok(redo.has(rec.id));
  assert.equal(views.rec(rec.id)!.version, undefined);
  frozen = null;
  sync.sharePins();
  assert.equal(posted.at(-1)!.ops[0].op, "pin", "its own board is arranged as any board");
});

test("a view kept at a past build is a board as any: laid out once, its memory handed over under the snapshot's id and recalled by every page; a preview hands nothing over", async () => {
  const { Views } = await import("../src/web/src/views.ts");
  const N = now();
  const T = then();
  const p = pastGraph(T.nodes, T.edges, N, T.diff);
  const book = new ViewBook();
  const rec = book.create("B then", "Alice", { scope: parseQuery("ns(B) except external"), version: 5 }) as ViewData;
  // the server's memory of the view, compare and set, as server/views.ts keeps it
  let server: { set: string; mem: unknown } | null = null;
  const posted: Json[] = [];
  const api = {
    list: async () => book.list().map(summary),
    get: async () => ({ view: structuredClone(rec), memory: server ? { namespace: server.set } : {} }),
    memory: async () => server,
    post: async (action: string, body: Json) => {
      posted.push({ action, ...body });
      if (action !== "memory") return { ok: true };
      if ((server?.set ?? null) !== body.base) return { accepted: false, current: server };
      server = body.memory;
      return { accepted: true };
    },
  };
  // the Time Machine's part: the past graph, and a layout made off the page's thread, counted
  let laidOut = 0;
  let preview = false;
  const source = { past: p, layout: async (b: { graph: Graph }, mode: ClusterMode, mem: { mem: never } | null) => (laidOut++, layOut({ mode, nodes: b.graph.nodes, edges: edgesOf(b.graph), hidden: [], mem: mem?.mem ?? null })) };
  const page = () => new Views(api as never, { graph: () => N, meta: () => N.meta, review: () => emptyReview(), past: () => source as never, preview: () => preview });
  const one = page();
  await one.record(rec.id);
  const b = one.board(rec.id)!;
  assert.equal(b.full, p.graph, "the past graph is the board's");
  assert.deepEqual(b.graph.nodes.map((v) => v.name), ["B.t", "B.old"], "its scope on the past graph, of that build alone");
  const L = await one.layout(b, "namespace");
  assert.equal(laidOut, 1);
  // handed over under the snapshot's id: never the key of a board of the latest build of the same names
  assert.match(server!.set, /^@5:/);
  assert.equal(snapshotOfKey(server!.set), 5);
  assert.equal(one.key(b, "namespace"), server!.set);
  // another page recalls it exactly, laying nothing out
  const two = page();
  await two.record(rec.id);
  const L2 = await two.layout(two.board(rec.id)!, "namespace");
  assert.equal(laidOut, 1);
  assert.deepEqual([L2.x, L2.y], [L.x, L.y]);
  // a level hidden: regrouped from the memory, nothing laid out, handed over under the same build
  const hiddenNow = two.layoutWith(two.board(rec.id)!, "namespace", ["B"]);
  assert.equal(hiddenNow.clusters.some((c) => c.key === "B"), false);
  // a preview of the view at another build: laid out from the view's memory, never handed over
  preview = true;
  const three = page();
  await three.record(rec.id);
  server = { set: "@4:other", mem: server!.mem };
  const before = posted.length;
  const pb = three.board(rec.id)!;
  assert.equal(pb.preview, true);
  await three.layout(pb, "namespace");
  assert.equal(laidOut, 2);
  assert.equal(posted.length, before, "nothing handed over from a preview");
  assert.equal(server!.set, "@4:other");
});

test("the canvas's menu on a past board: the source of then, the review refused where it would be, arranged as any board but in a preview", () => {
  const ctx = { fixed: false, review: null, views: [{ id: "v1", title: "V", holds: false }], arrange: true, write: false, past: true };
  const decl = menuItems({ kind: "decl", name: "A.f", ext: false, key: null, target: false, ns: { prefix: "A", on: false } }, ctx);
  // its source is that build's text (HistorySpec decision 23)
  assert.deepEqual(decl.map((m) => m.act), ["source", "pin", "tcb", "deps", "apps", "copy", "remove", "add", "past-review", "note", "note-view"]);
  // the review's items give way to one line that says why, which cannot be chosen
  const why = decl.find((m) => m.act === "past-review")!;
  assert.ok(why.disabled && /latest build/.test(why.label));
  const cluster = menuItems({ kind: "cluster", key: "A", folded: false, folder: false, trust: { prefix: "A", on: false } }, ctx).map((m) => m.act);
  assert.deepEqual(cluster, ["fold", "hide", "remove", "add", "past-review", "note", "note-view"]);
  assert.deepEqual(menuItems({ kind: "canvas" }, ctx).map((m) => m.act), ["note", "note-view", "fit", "relayout"]);
  assert.deepEqual(menuItems({ kind: "note", open: true, view: false }, ctx).map((m) => m.act), ["note-edit", "note-toggle", "note-kind", "note-delete"]);
  // a preview of the view at another build (the Time Machine browsing it): nothing arranges it
  const preview = { ...ctx, arrange: false, preview: true };
  assert.deepEqual(menuItems({ kind: "cluster", key: "A", folded: false, folder: false, trust: null }, preview).map((m) => m.act), ["fold"]);
  assert.deepEqual(menuItems({ kind: "canvas" }, preview).map((m) => m.act), ["fit"]);
  assert.deepEqual(menuItems({ kind: "note", open: true, view: false }, preview), []);
  // the graph of now, for comparison: the source and the review are there
  const nowItems = menuItems({ kind: "decl", name: "A.f", ext: false, key: null, target: false, ns: null }, { ...ctx, past: false, write: true }).map((m) => m.act);
  assert.ok(nowItems.includes("source") && nowItems.includes("approve") && !nowItems.includes("past-review"));
});

// ----------------------------------------------------------------------------- presence, following

test("presence carries where a reader is in the Time Machine; a follower's own step ends following, reading the lists does not", () => {
  const base = { mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: "v1", scope: null, tabs: ["v1"] };
  assert.deepEqual(cleanView({ ...base, history: { snapshot: 5 } })!.history, { snapshot: 5 });
  assert.equal(cleanView({ ...base, history: { snapshot: -1 } })!.history, undefined);
  assert.equal(cleanView({ ...base, history: { snapshot: "5" } })!.history, undefined);
  assert.equal(cleanView(base)!.history, undefined);
  // the server hands it on as it came
  const lists: Json[][] = [];
  const presence = new Presence((peers) => lists.push(peers as never));
  presence.beat("p1", "Alice", cleanView({ ...base, history: { snapshot: 5 } }), false);
  assert.deepEqual(presence.list().find((p) => p.id === "p1")!.view!.history, { snapshot: 5 });
  // what ends following (web/src/surfaces.ts): a drag on the timeline or a press on the bar's
  // buttons, a row of a list that goes to a declaration; not opening a list, nor reading or closing
  // it ("What changed" opened is the reader's own, CollabSpec decision 4)
  const at = (...chain: string[]): PageEl | null =>
    chain.reduce<PageEl | null>((parentElement, own) => ({ matches: (sel: string) => sel.split(",").some((s) => s.trim() === own), parentElement }), null);
  assert.equal(pressActs(at("#tmbar", ".tm-line")), true, "a drag on the timeline");
  assert.equal(pressActs(at("#tmbar", "button")), true, "Keep, Save, ✕");
  assert.equal(pressActs(at("#tmbar", "#tmbar .tm-sum", "[data-tm-list]")), false, "a count opening its list");
  assert.equal(pressActs(at("#tm-list")), false, "reading a list");
  assert.equal(pressActs(at("#tm-list", "button")), false, "closing it");
  assert.equal(pressActs(at("#tm-list", "[data-tm-go]")), true, "going to a declaration");
});

// ------------------------------------------------------------------------------- the snapshot served

function raw(o: { rename?: boolean } = {}): RawGraph {
  const f = o.rename ? "A.g" : "A.f";
  const node = (name: string, module: string, shape: string, refs: number[]) => ({ name, kind: "def" as const, module, type: `${name} : Nat`, ax: 0, hash: `k-${name}`, shape, refs });
  return {
    schema: 1,
    roots: ["B"],
    modules: [{ name: "A", imports: [] }, { name: "B", imports: ["A"] }],
    nodes: [node("A.S", "A", "sS", [0]), node(f, "A", "sf", [0, 1]), node("B.t", "B", "st", [2, 3])],
    externals: [{ name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0 }],
    edges: [[1, 0, 1], [1, 3, 1], [2, 1, 1]],
    axioms: [],
    axiomSets: [[]],
    stats: { folded: 0, metaDropped: 0, ms: 0 },
    refNames: ["Nat", "A.S", "A.S mk", f],
  };
}

test("a snapshot's graph in the page's two parts, made once and kept under the renames in force; a rename alone is no change", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-tm-history-"));
  try {
    const h = new History(dir);
    const opts = (at: number, fingerprint: string) => ({ at, fingerprint, commit: { hash: "abc", branch: "main" }, toolchain: "tc", missing: [] as string[] });
    h.record(raw(), opts(T0, "f1"));
    h.record(raw({ rename: true }), opts(T0 + H, "f2"));
    let tag = "";
    const w: HistoryWorld = { history: h, identity: () => ownName, identityTag: () => tag };
    const get = (query: string) => historyAnswer(w, { method: "GET", path: "/api/history/graph", query: new URLSearchParams(query), body: null, caller: { name: null, kind: "person" } } as Ask);
    const nodes = get("id=1&part=nodes");
    const edges = get("id=1&part=edges");
    const whole = get("id=1").body as Json;
    const N = JSON.parse(gunzipSync(nodes.gz!.body).toString("utf8"));
    assert.equal(N.edges, undefined, "no edges among the declarations");
    assert.equal(N.edgeCount, whole.edges.length / 3);
    assert.deepEqual(N.nodes, whole.nodes);
    assert.deepEqual(N.snapshot.id, 1);
    // the edges, packed: the same triples as the whole graph's
    const E = unpackEdges(new Uint8Array(gunzipSync(edges.gz!.body)));
    const triples = (xs: ArrayLike<number>) => Array.from({ length: xs.length / 3 }, (_, k) => `${xs[3 * k]},${xs[3 * k + 1]},${xs[3 * k + 2]}`).sort();
    assert.deepEqual(triples(E), triples(whole.edges));
    // kept: the same bytes again (tagged once, answered 304 to a page that has them)
    assert.equal(get("id=1&part=nodes").gz!.body, nodes.gz!.body);
    // other renames in force: made again
    tag = "A.g→A.f";
    assert.notEqual(get("id=1&part=nodes").gz!.body, nodes.gz!.body);
    assert.equal(get("id=1&part=what").status, 400);
    // the diff: A.f renamed to A.g, and B.t, which refers to it, not changed though the renames in
    // force do not hold that rename (it touched nothing said)
    const d = diffGraphs(h.graph(1)!, h.graph(2)!, ownName, new Map([["A.f", "A.g"]]));
    assert.deepEqual([d.renamed, d.changed, d.added, d.removed], [[["A.f", "A.g"]], [], [], []]);
    // without the rename between them, B.t refers to another name: changed, as before
    assert.deepEqual(diffGraphs(h.graph(1)!, h.graph(2)!, ownName).changed, ["B.t"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the mode: opened at the latest or at a build, stepped, left; which build each view shows, and which board is a preview", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, fetch: g.fetch };
  // just enough of an element for the bar to be drawn into, part by part
  const el = (): Record<string, unknown> => {
    const classes = new Set<string>();
    const classList = { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c), toggle() {} };
    const e: Record<string, unknown> = { hidden: true, innerHTML: "", textContent: "", title: "", style: {}, dataset: {}, classList, addEventListener() {}, setAttribute() {}, querySelectorAll: () => [], contains: () => false, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) };
    const part = { ...e };
    e.querySelector = () => part;
    part.querySelector = () => part;
    return e;
  };
  g.window = { addEventListener() {} };
  g.document = { body: { classList: { add() {}, remove() {}, toggle() {} } }, documentElement: { clientWidth: 1400 } };
  const N = now();
  const snaps = [snap(1, T0), snap(2, T0 + 5 * H), snap(3, T0 + 9 * H)];
  g.fetch = async (url: string) => ({ ok: true, json: async () => (String(url).startsWith("/api/history?") || url === "/api/history" ? { snapshots: snaps, current: 3 } : {}) });
  try {
    const { TimeMachine } = await import("../src/web/src/timemachine.ts");
    const book = new ViewBook();
    const here = book.create("B", "Alice", { scope: parseQuery("ns(B)") }) as ViewData;
    const other = book.create("A", "Alice", { scope: parseQuery("ns(A)") }) as ViewData;
    let board = { id: here.id, rec: here };
    const said: string[] = [];
    let changed = 0;
    const tm = new TimeMachine(el() as never, el() as never, el() as never, {
      present: () => N, meta: () => N.meta, review: () => emptyReview(), board: () => board as never, title: () => "B",
      redraw: async () => {}, memory: async () => null, changed: () => changed++, go: () => true, say: (t) => said.push(t),
      keep: async () => null, saveAs: async () => null,
    });
    // a build it does not have: the latest, and it says so
    assert.equal(await tm.open({ snapshot: 9 }), true);
    assert.deepEqual([tm.active, tm.view, tm.snapshot], [true, here.id, 3]);
    assert.match(said[0], /no snapshot 9/);
    // at the latest, the graph of now: the view's own board, no preview
    assert.equal(tm.snapshotFor(here), null);
    assert.equal(tm.preview(here, null), false);
    assert.equal(tm.preview(other, null), false, "another view is not in the Time Machine");
    // at another build, the view's scope and arrangement on that build: a preview
    const past = { snapshot: snap(2, T0 + 5 * H) } as never;
    assert.equal(tm.preview(here, past), true);
    // a step back: aimed at at once (the bar, presence); the board keeps the build it shows until
    // the one aimed at is ready — this test's server has no graph to give, so it says so
    const going = tm.show(2);
    assert.equal(tm.snapshot, 2);
    assert.equal(tm.shown, 3);
    assert.equal(tm.snapshotFor(here), null, "the board still shows the latest");
    await going;
    assert.equal(tm.snapshotFor(here), null, "a build that cannot be read is never shown");
    assert.ok(said.some((t) => /could not be read/.test(t)));
    assert.equal(tm.snapshotFor(other), null);
    tm.step(-1);
    tm.step(-1);
    assert.equal(tm.snapshot, 1, "no further than the first");
    tm.end(true);
    assert.equal(tm.snapshot, 3);
    assert.ok(changed >= 3, "each step tells the others where the reader is");
    // left: a view kept at a build shows it, as its own board; the latest is no past build
    await tm.close();
    assert.deepEqual([tm.active, tm.view, tm.snapshot], [false, null, null]);
    assert.equal(tm.preview(here, null), false);
    other.version = 2;
    assert.equal(tm.snapshotFor(other), 2);
    assert.equal(tm.preview(other, past), false, "its own build: its own board, arranged as any");
    assert.equal(tm.preview(other, null), true, "its build not at hand: the latest is shown as a preview, which nothing arranges");
    other.version = 3;
    assert.equal(tm.snapshotFor(other), null, "kept at the latest: the graph of now");
    assert.equal(tm.preview(other, null), false);
    // opened on a view kept at a build, it browses from there: its board shows that build until the
    // one aimed at is ready
    other.version = 2;
    board = { id: other.id, rec: other };
    await tm.open({ snapshot: 1 });
    assert.equal(tm.snapshot, 1);
    assert.equal(tm.shown, 2);
    assert.equal(tm.snapshotFor(other), 2);
  } finally {
    Object.assign(g, saved);
  }
});

test("a new build: a reader at the latest goes on to it; one at a build they chose, on a view kept at it, or following someone stays (the owner's decision of 2026-10-18)", async () => {
  // the rule: the build aimed at, the latest before and after the list was read again
  assert.equal(onNewBuild(3, 3, 4, { following: false }), 4, "at the latest: on to the new one");
  assert.equal(onNewBuild(2, 3, 4, { following: false }), null, "at a build chosen: stays");
  assert.equal(onNewBuild(3, 3, 4, { kept: 3, following: false }), null, "on a view kept at the build: stays, kept");
  assert.equal(onNewBuild(3, 3, 4, { kept: 2, following: false }), 4, "on a view kept elsewhere, browsed to the latest: on");
  assert.equal(onNewBuild(3, 3, 4, { following: true }), null, "following: where the followed reader is, as presence says");
  assert.equal(onNewBuild(3, 3, 3, { following: false }), null, "the same build read again: nothing new");
  assert.equal(onNewBuild(null, 3, 4, { following: false }), null);

  // on the page: the list read again as the server says a build was read (`history`)
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, fetch: g.fetch };
  const el = (): Record<string, unknown> => {
    const classList = { add() {}, remove() {}, contains: () => false, toggle() {} };
    const e: Record<string, unknown> = { hidden: true, innerHTML: "", textContent: "", title: "", style: {}, dataset: {}, classList, addEventListener() {}, setAttribute() {}, querySelectorAll: () => [], contains: () => false, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) };
    const part = { ...e };
    e.querySelector = () => part;
    part.querySelector = () => part;
    return e;
  };
  g.window = { addEventListener() {} };
  g.document = { body: { classList: { add() {}, remove() {}, toggle() {} } }, documentElement: { clientWidth: 1400 } };
  const N = now();
  const snaps = [snap(1, T0), snap(2, T0 + 5 * H), snap(3, T0 + 9 * H)];
  g.fetch = async (url: string) => ({ ok: true, json: async () => (url === "/api/history" ? { snapshots: [...snaps], current: snaps.length } : {}) });
  try {
    const { TimeMachine } = await import("../src/web/src/timemachine.ts");
    const book = new ViewBook();
    let told = 0;
    // each reader's page, on a view of its own; the follower's says it follows someone
    const followers = new Set<unknown>();
    type Page = InstanceType<typeof TimeMachine>;
    const page = (v = book.create("B", "Alice", { scope: parseQuery("ns(B)") }) as ViewData): Page => {
      const tm: Page = new TimeMachine(el() as never, el() as never, el() as never, {
        present: () => N, meta: () => N.meta, review: () => emptyReview(), board: () => ({ id: v.id, rec: v }) as never, title: () => "B",
        redraw: async () => {}, memory: async () => null, changed: () => told++, go: () => true, say: () => {}, keep: async () => null, saveAs: async () => null,
        following: () => followers.has(tm),
        newBuild: (from, to) => news.push([from, to]),
      });
      return tm;
    };
    // each page is told of a new build, the Time Machine open or not: the selection follows its renames
    const news: [number, number][] = [];
    const kept = book.create("B kept", "Alice", { scope: parseQuery("ns(B)") }) as ViewData;
    const latestView = book.create("B latest", "Alice", { scope: parseQuery("ns(B)") }) as ViewData;
    const build = async (tms: Page[]) => {
      snaps.push(snap(snaps.length + 1, T0 + (10 + snaps.length) * H));
      for (const tm of tms) await tm.historyChanged();
    };
    // four readers: at the latest; at a build they chose; on the view kept at the build they are at;
    // following someone at the latest
    const atLatest = page(latestView), atPast = page(), onKept = page(kept), follower = page();
    kept.version = 3;
    for (const tm of [atLatest, atPast, onKept, follower]) await tm.open();
    void atPast.show(2);
    followers.add(follower);
    const at = (tm: Page) => tm.snapshot;
    told = 0;
    await build([atLatest, atPast, onKept, follower]);
    assert.deepEqual(news, [[3, 4], [3, 4], [3, 4], [3, 4]]);
    assert.equal(at(atLatest), 4, "at the latest: the new build, the board of now");
    assert.equal(atLatest.snapshotFor(latestView), null, "no past board of the build before");
    assert.equal(atLatest.shown, 4);
    assert.ok(told >= 1, "those following it are told where it is");
    assert.equal(at(atPast), 2, "at a past build: it stays");
    assert.equal(at(onKept), 3, "on a view kept at its build: it stays, the view kept");
    assert.equal(kept.version, 3);
    assert.equal(onKept.snapshotFor(kept), 3);
    assert.equal(at(follower), 3, "following: not on by itself");
    // the followed reader went on: presence brings their build, and the follower goes there
    await follower.show(4);
    assert.equal(at(follower), 4);
    // the build read again (the usage pass's graph): nothing new, nobody moves
    await atLatest.historyChanged();
    assert.equal(at(atLatest), 4);
    assert.equal(news.length, 4, "no new build");
    // with the Time Machine closed, the board is the board of now, whatever comes; a view kept at a
    // build stays at it
    await atLatest.close();
    await onKept.close();
    await build([atLatest, onKept]);
    assert.equal(atLatest.snapshotFor(latestView), null);
    assert.equal(onKept.snapshotFor(kept), 3);
    assert.deepEqual(news.slice(4), [[4, 5], [4, 5]], "told with the Time Machine closed too");
  } finally {
    Object.assign(g, saved);
  }
});

// ------------------------------------------------------------------------- a drag loads as it goes

test("latest wins: the board shows only the build aimed at last, whatever order loads finish in; what was passed is not wanted", () => {
  const s = new Seek();
  s.order = [1, 2, 3, 4, 5, 6];
  s.reset(6, true);
  assert.equal(s.waiting, false);
  // a drag back across 5 and 4 onto 3
  s.aim(5);
  s.aim(4);
  s.aim(3);
  assert.deepEqual([s.target, s.shown, s.dir, s.waiting], [3, 6, -1, true]);
  // the loads finish out of order: 4 first, then 3, then 5
  assert.equal(s.ready(4), false, "4 was left: dropped");
  assert.equal(s.shown, 6);
  assert.equal(s.ready(3), true, "the build aimed at: shown");
  assert.equal(s.ready(5), false, "5 finished after 3: never shown after it");
  assert.equal(s.ready(3), false, "on show already");
  assert.deepEqual([s.shown, s.waiting], [3, false]);
  // what is wanted: the build aimed at and the one shown; beside it, fetched; the two beyond it in the
  // way the reader goes, laid out ahead, the nearest sooner
  assert.deepEqual(s.beyond, [2, 1]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => s.fetchWant(id)), [1, 1, 2, 1, 0, 0]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => s.layoutWant(id)), [1, 2, 3, 0, 0, 0], "laid out ahead in the way the reader goes");
  // a fast drag on to 6 passes 4 and 5: while 6 loads, 3 stays on show
  s.aim(4);
  s.aim(5);
  s.aim(6);
  assert.deepEqual([s.target, s.shown, s.dir], [6, 3, 1]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => s.fetchWant(id)), [0, 0, 2, 0, 1, 2]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => s.layoutWant(id)), [0, 0, 3, 0, 0, 3], "nothing beyond the last");
  // and back to where the board is: nothing to wait for
  s.aim(3);
  assert.equal(s.waiting, false);
  assert.equal(s.ready(6), false);
  // wiggling: a build aimed at again is shown once ready, though it was left meanwhile
  s.aim(2);
  s.aim(1);
  s.aim(2);
  assert.equal(s.ready(1), false);
  assert.equal(s.ready(2), true);
  // left: nothing ahead is wanted, only the build the view is kept at
  s.reset(4, false);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => s.fetchWant(id)), [0, 0, 0, 2, 0, 0]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => s.layoutWant(id)), [0, 0, 0, 3, 0, 0]);
});

test("the layouts in turn: the build aimed at first, one nobody wants dropped before it starts, and one running stopped when a wanted one waits", async () => {
  const workers: { posted: { id: number; mode: string }[]; terminated: boolean; onmessage: ((e: MessageEvent) => void) | null; onerror: ((e: Event) => void) | null; postMessage(m: { id: number; mode: string }): void; terminate(): void }[] = [];
  const spawn = () => {
    const w = { posted: [] as { id: number; mode: string }[], terminated: false, onmessage: null as ((e: MessageEvent) => void) | null, onerror: null as ((e: Event) => void) | null, postMessage(m: { id: number; mode: string }) { w.posted.push(m); }, terminate() { w.terminated = true; } };
    workers.push(w);
    return w as unknown as LayoutWorker;
  };
  const reply = (w: (typeof workers)[number], tag: string) => w.onmessage!({ data: { id: w.posted.at(-1)!.id, layout: { tag } } } as unknown as MessageEvent);
  const want = new Map<number, number>([[1, 2], [2, 1]]);
  const q = new LayoutQueue((id) => want.get(id) ?? 0, spawn, () => { throw new Error("no layout on the page's thread here"); });
  let gathered = 0;
  const ask = (snapshot: number) => () => {
    gathered++;
    return { mode: `m${snapshot}`, nodes: [], edges: new Int32Array(0), hidden: [], mem: null } as never;
  };
  const results: string[] = [];
  const track = (p: Promise<unknown>, name: string) => p.then((L) => results.push(`${name}:${(L as { tag: string }).tag}`), (e: Error) => results.push(`${name}:${e.name}`));
  const t1 = track(q.lay(1, ask(1)), "1");
  const t2 = track(q.lay(2, ask(2)), "2");
  const t3 = track(q.lay(3, ask(3)), "3");
  await t3;
  assert.deepEqual(results, ["3:Skipped"], "nobody wants 3: dropped at once");
  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].posted.map((m) => m.mode), ["m1"], "one at a time");
  assert.equal(gathered, 1, "what a layout reads is gathered when it starts");
  // the reader goes on: 1 is passed, 4 aimed at
  want.delete(1);
  want.set(4, 2);
  const t4 = track(q.lay(4, ask(4)), "4");
  await t1;
  assert.equal(workers[0].terminated, true, "the layout of a build passed is stopped: 4 waits");
  assert.equal(workers.length, 2);
  assert.deepEqual(workers[1].posted.map((m) => m.mode), ["m4"], "the build aimed at before the one ahead");
  reply(workers[1], "L4");
  await t4;
  assert.deepEqual(workers[1].posted.map((m) => m.mode), ["m4", "m2"]);
  reply(workers[1], "L2");
  await t2;
  assert.deepEqual(results, ["3:Skipped", "1:Skipped", "4:L4", "2:L2"]);
  assert.deepEqual([q.dropped, q.stopped, q.busy], [1, 1, false]);
  // a running layout nobody wants finishes where nothing waits (it may be wanted again)
  want.set(5, 2);
  const t5 = track(q.lay(5, ask(5)), "5");
  want.delete(5);
  q.prune();
  assert.equal(workers[1].terminated, false);
  reply(workers[1], "L5");
  await t5;
  assert.equal(results.at(-1), "5:L5");
  // two workers: the build aimed at and the one beyond side by side; a third waits, and the layout of
  // a build passed is stopped for it only where no worker is free
  workers.length = 0;
  const two = new LayoutQueue((id) => want.get(id) ?? 0, spawn, () => { throw new Error("no"); }, 2);
  want.clear();
  want.set(10, 3).set(11, 2).set(12, 1);
  const r10 = two.lay(10, ask(10)), r11 = two.lay(11, ask(11)), r12 = two.lay(12, ask(12));
  assert.deepEqual(two.running, [10, 11]);
  want.delete(10);
  want.set(13, 3);
  const r13 = two.lay(13, ask(13));
  await assert.rejects(r10, { name: "Skipped" });
  assert.deepEqual(two.running, [13, 11], "10 passed: stopped for 13, aimed at now; 12 waits");
  want.delete(12);
  two.prune();
  await assert.rejects(r12, { name: "Skipped" });
  reply(workers.at(-1)!, "L13");
  reply(workers[1], "L11");
  assert.deepEqual(await Promise.all([r13, r11]), [{ tag: "L13" }, { tag: "L11" }]);
  assert.deepEqual(two.running, [null, null]);
});

test("a drag on the page: loads that finish out of order show only the build aimed at last, and what was passed is aborted", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, fetch: g.fetch };
  const el = (): Record<string, unknown> => {
    const classes = new Set<string>();
    const classList = { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c), toggle() {} };
    const e: Record<string, unknown> = { hidden: true, innerHTML: "", textContent: "", title: "", style: {}, dataset: {}, classList, addEventListener() {}, setAttribute() {}, querySelectorAll: () => [], contains: () => false, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) };
    const part = { ...e };
    e.querySelector = () => part;
    part.querySelector = () => part;
    return e;
  };
  g.window = { addEventListener() {} };
  g.document = { body: { classList: { add() {}, remove() {}, toggle() {} } }, documentElement: { clientWidth: 1400 } };
  const N = now();
  const snaps = [1, 2, 3, 4, 5, 6].map((id) => snap(id, T0 + id * H));
  // the server answers when the test says so, build by build; an abort fails a request at once
  const pending: { id: number; url: string; signal?: AbortSignal; answer(): void }[] = [];
  const answer = (id: number) => {
    for (const r of pending.filter((x) => x.id === id && !x.signal?.aborted)) {
      pending.splice(pending.indexOf(r), 1);
      r.answer();
    }
  };
  const { nodes, edges, diff } = then();
  g.fetch = (url: string, init?: { signal?: AbortSignal }) => {
    if (url === "/api/history") return Promise.resolve({ ok: true, json: async () => ({ snapshots: snaps, current: 6 }) });
    const id = Number(/(?:id|from)=(\d+)/.exec(url)![1]);
    return new Promise((ok, no) => {
      const body = url.includes("part=edges")
        ? { ok: true, arrayBuffer: async () => packEdges(edges, nodes.nodes.length).slice().buffer }
        : { ok: true, json: async () => (url.includes("/diff") ? { ...diff, from: id, to: 6 } : { ...nodes, snapshot: snaps[id - 1] }) };
      pending.push({ id, url, signal: init?.signal, answer: () => ok(body) });
      init?.signal?.addEventListener("abort", () => no(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  };
  const settle = async () => {
    for (let k = 0; k < 6; k++) await new Promise((r) => setTimeout(r, 5));
  };
  try {
    const { TimeMachine } = await import("../src/web/src/timemachine.ts");
    const book = new ViewBook();
    const here = book.create("B", "Alice", { scope: parseQuery("ns(B)") }) as ViewData;
    const board = { id: here.id, rec: here };
    const drawn: (number | null)[] = [];
    const said: string[] = [];
    let tm: InstanceType<typeof TimeMachine>;
    tm = new TimeMachine(el() as never, el() as never, el() as never, {
      present: () => N, meta: () => N.meta, review: () => emptyReview(), board: () => board as never, title: () => "B",
      redraw: async () => void drawn.push(tm.snapshotFor(here)), memory: async () => null, changed: () => {}, go: () => true, say: (t) => said.push(t),
      keep: async () => null, saveAs: async () => null,
    });
    await tm.open();
    assert.deepEqual(drawn, [null], "opened at the latest: the board of now, read-only");
    // a drag back passes 5 onto 4
    void tm.show(5);
    void tm.show(4);
    assert.deepEqual([tm.snapshot, tm.shown], [4, 6]);
    // 4's answers come first: shown while the drag goes on; 5's come after, and it is never shown
    answer(4);
    await settle();
    assert.deepEqual([tm.snapshot, tm.shown], [4, 4]);
    answer(5);
    await settle();
    assert.deepEqual(drawn, [null, 4], "5 finished after 4 and was dropped");
    // a fast drag on back passes 3 and 2 onto 1: 3 is aborted, 2 (beside 1) is fetched on
    void tm.show(3);
    void tm.show(2);
    void tm.show(1);
    const three = pending.filter((r) => r.id === 3);
    assert.ok(three.length >= 3 && three.every((r) => r.signal?.aborted), "what was fetched for 3 (its graph's two parts and its diff) is aborted");
    assert.ok(pending.some((r) => r.id === 2 && !r.signal?.aborted), "2, beside the build aimed at, is fetched ahead");
    answer(2);
    await settle();
    assert.equal(tm.shown, 4, "2 is ready first, but the reader went on: the board keeps 4");
    answer(1);
    await settle();
    assert.deepEqual(drawn, [null, 4, 1], "only the builds aimed at last were shown, in order");
    assert.deepEqual([tm.snapshot, tm.shown], [1, 1]);
    assert.deepEqual(said, [], "an abort is not an error");
    // stepping to a build ready (2, fetched ahead) shows it at once
    tm.step(1);
    await settle();
    assert.deepEqual(drawn, [null, 4, 1, 2]);
    // left: what is in flight for the builds browsed (3, beyond 2 that way, fetched ahead) is given up
    assert.ok(pending.some((r) => r.id === 3 && !r.signal?.aborted));
    await tm.close();
    assert.ok(pending.every((r) => r.signal?.aborted), "nothing is fetched for the Time Machine once it is left");
  } finally {
    Object.assign(g, saved);
  }
});

// --------------------------------------------------------------- what is made from a past board

test("what is made from a board of a past build keeps its build: a view on a query is found or made by its query and build, on the server, for agents and on the page", async () => {
  // the book: one view nobody keeps per query and build
  const book = new ViewBook();
  const q = parseQuery("ns(B)");
  const now1 = book.open(q, "Alice").view;
  const then2 = book.open(q, "Alice", Date.now(), { version: 2 }).view;
  const then3 = book.open(q, "Alice", Date.now(), { version: 3, clustering: "module" }).view;
  assert.equal(now1.version, undefined);
  assert.deepEqual([then2.version, then3.version, then3.clustering], [2, 3, "module"]);
  assert.equal(new Set([now1.id, then2.id, then3.id]).size, 3, "the same query at three builds: three views");
  assert.equal(book.open(q, "Bob", Date.now(), { version: 2 }).view.id, then2.id, "found again by its query and build");
  assert.equal(book.open(q, "Bob").view.id, now1.id);
  assert.equal(summary(then2).version, 2, "the list says the build");
  // Duplicate of a view kept at a build is kept at it too: a copy is the same board
  const kept = book.create("B then", "Alice", { scope: q, version: 2 }) as ViewData;
  assert.equal((book.create("B then (copy)", "Alice", { from: kept.id }) as ViewData).version, 2);
  assert.equal((book.create("B now", "Alice", { from: kept.id, version: null }) as ViewData).version, undefined, "unless asked for the latest");

  // the server: views/open takes a version the history has, and a new view's clustering
  const dir = mkdtempSync(join(tmpdir(), "vp-tm-open-"));
  try {
    const S = server(dir);
    const open = (body: Json) => S.ask("/api/views/open", body);
    const a = open({ scope: "ns(A)", version: 2, clustering: "module" });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const av = (a.body as Json).view as ViewData;
    assert.deepEqual([av.version, av.clustering, av.kept], [2, "module", false]);
    assert.equal(((open({ scope: "ns(A)", version: 2 }).body as Json).view as ViewData).id, av.id);
    assert.notEqual(((open({ scope: "ns(A)" }).body as Json).view as ViewData).id, av.id, "the latest build's is another view");
    assert.equal(((open({ scope: "ns(A)", version: null }).body as Json).view as ViewData).version, undefined);
    assert.equal(open({ scope: "ns(A)", version: 9 }).status, 404, "a build the history does not have");
    assert.equal(open({ scope: "ns(A)", version: "2" }).status, 400);
    assert.equal(open({ scope: "ns(A)", clustering: "folder" }).status, 400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // agents: views/open {scope, version}
  const adir = mkdtempSync(join(tmpdir(), "vp-tm-agentopen-"));
  try {
    const N = now();
    const edges = edgesOf(N);
    const views = new ServerViews(adir, LAYOUT_VERSION, () => {}, { add: (e) => e as never });
    views.snapshotAt = (id) => (id === 2 ? new Date(T0).toISOString() : null);
    const presence = new Presence(() => {});
    views.peers = () => presence.list();
    const w = {
      project: { root: adir, files: new Map(), toolchain: "tc" },
      graph: { version: 1, prep: { metaGz: gzipSync(JSON.stringify(N.meta)), edgesGz: gzipSync(Buffer.from(edges.buffer)) } },
      review: { data: emptyReview(), append: () => ({ status: 403, error: "no" }) },
      timeline: { events: [], add: (e: never) => e },
      places: views.places,
      presence,
      placesChanged: () => {},
      views,
    } as unknown as World;
    const eps = viewEndpoints(w, () => refusal("full", "full"));
    const e = eps.find((x) => x.method === "POST" && x.path === "/api/agent/views/open")!;
    const ask = async (body: Json) => e.run({ method: "POST", path: e.path, query: new URLSearchParams(), body, caller: { name: "Claude", kind: "agent" } });
    const r = await ask({ scope: "ns(B)", version: 2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((r.body as Json).view.version, 2);
    assert.match((r.body as Json).note, /snapshot 2 on the pages, arranged there as any view/);
    assert.equal(((await ask({ scope: "ns(B)", version: 0 })).body as Json).view.version, undefined, "0 is the latest");
    assert.equal((await ask({ scope: "ns(B)", version: 5 })).status, 404);
  } finally {
    rmSync(adir, { recursive: true, force: true });
  }

  // the page: Zoom in from a past board opens at its build; the tab and the address keep it, and a
  // tab whose view the server forgot opens it again at that build
  const { Views } = await import("../src/web/src/views.ts");
  const { ViewNav } = await import("../src/web/src/viewnav.ts");
  const { Store } = await import("../src/web/src/store.ts");
  const { decodeState, encodeState } = await import("../src/web/src/state.ts");
  const N = now();
  const pbook = new ViewBook();
  const posted: Json[] = [];
  let forgot = false;
  const api = {
    list: async () => pbook.list().map(summary),
    get: async (id: string) => (forgot ? null : { view: structuredClone(pbook.get(id)!), memory: {} }),
    memory: async () => null,
    post: async (action: string, body: Json) => {
      posted.push({ action, ...body });
      if (action === "open") return { view: structuredClone(pbook.open(parseQuery(body.scope), "Alice", Date.now(), { ...(body.version ? { version: body.version } : {}), ...(body.clustering ? { clustering: body.clustering } : {}) }).view) };
      return action === "memory" ? { accepted: true } : { ok: true };
    },
  };
  const views = new Views(api as never, { graph: () => N, meta: () => N.meta, review: () => emptyReview() });
  await views.load();
  const store = new Store("/nowhere");
  const nav = new ViewNav(views, store, { show: () => {}, place: () => {}, here: () => ({ cam: null, mode: "plain", picks: null, shown: null }), changed: () => {} });
  assert.equal(await nav.open("ns(B)", null, { version: 2, clustering: "module" }), true);
  assert.deepEqual(posted.find((p) => p.action === "open"), { action: "open", scope: "ns(B)", version: 2, clustering: "module" });
  const id = nav.board.id;
  assert.equal(nav.board.rec.version, 2);
  assert.deepEqual(store.data.tabs.find((t) => t.id === id), { id, q: "ns(B)", at: 2 });
  assert.equal(nav.queryVersion(), 2);
  // the address: the query and its build; an address without one is the latest's
  const st = { view: null, scope: "ns(B)", version: 2, mode: "tcb" as const, picks: null, shown: null };
  assert.match(encodeState(st), /q=ns%28B%29&at=2/);
  assert.deepEqual(decodeState("#" + encodeState(st)), st);
  assert.equal(decodeState("#q=ns(B)&mode=tcb")!.version, undefined);
  assert.equal(decodeState("#v=x&at=2&mode=tcb")!.version, undefined, "a kept view's build is its record's");
  // the server forgot it: its tab opens it again, at its build
  await nav.show(PROJECT);
  forgot = true;
  views.drop(id);
  posted.length = 0;
  assert.equal(await nav.select(id), true);
  forgot = false;
  assert.deepEqual(posted.filter((p) => p.action === "open").map((p) => p.version), [2]);
  assert.equal(nav.board.rec.version, 2);
});

test("Save as new view goes to the new view: shown while the Time Machine is open, then it is left, the board of now never drawn between", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, fetch: g.fetch };
  const el = (): Record<string, unknown> => {
    const classes = new Set<string>();
    const classList = { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c), toggle() {} };
    const e: Record<string, unknown> = { hidden: true, innerHTML: "", textContent: "", title: "", style: {}, dataset: {}, classList, addEventListener() {}, setAttribute() {}, querySelectorAll: () => [], contains: () => false, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) };
    const part = { ...e };
    e.querySelector = () => part;
    part.querySelector = () => part;
    return e;
  };
  g.window = { addEventListener() {} };
  g.document = { body: { classList: { add() {}, remove() {}, toggle() {} } }, documentElement: { clientWidth: 1400 } };
  const N = now();
  const snaps = [snap(1, T0), snap(2, T0 + 5 * H)];
  g.fetch = async (url: string) => ({ ok: true, json: async () => (url === "/api/history" ? { snapshots: snaps, current: 2 } : {}) });
  try {
    const { TimeMachine } = await import("../src/web/src/timemachine.ts");
    const book = new ViewBook();
    const here = book.create("B", "Alice", { scope: parseQuery("ns(B)") }) as ViewData;
    let board = { id: here.id, rec: here };
    const log: string[] = [];
    const tm = new TimeMachine(el() as never, el() as never, el() as never, {
      present: () => N, meta: () => N.meta, review: () => emptyReview(), board: () => board as never, title: () => "B",
      redraw: async () => void log.push(`redraw ${board.id}`), memory: async () => null, changed: () => {}, go: () => true, say: () => {},
      keep: async () => null, saveAs: async () => null,
    });
    await tm.open();
    log.length = 0;
    const copy = book.create("B · then", "Alice", { from: here.id, version: 1 }) as ViewData;
    const r = await tm.leaveFor(async () => {
      log.push(`show ${copy.id}, the Time Machine ${tm.active ? "open" : "left"}`);
      board = { id: copy.id, rec: copy };
      return true;
    });
    assert.equal(r, true);
    assert.equal(tm.active, false);
    assert.deepEqual(log, [`show ${copy.id}, the Time Machine open`], "no board drawn again: the new view is on show");
    // where the new view could not be shown, the Time Machine stays
    await tm.open();
    assert.equal(await tm.leaveFor(async () => false), false);
    assert.equal(tm.active, true);
  } finally {
    Object.assign(g, saved);
  }
});

test("a view kept at a build the page has not heard of: the list of builds is read again, not the view shown at the latest", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, fetch: g.fetch };
  const el = (): Record<string, unknown> => {
    const e: Record<string, unknown> = { hidden: true, innerHTML: "", textContent: "", title: "", style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, addEventListener() {}, setAttribute() {}, querySelectorAll: () => [], contains: () => false, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) };
    e.querySelector = () => ({ ...e });
    return e;
  };
  g.window = { addEventListener() {} };
  g.document = { body: { classList: { add() {}, remove() {}, toggle() {} } }, documentElement: { clientWidth: 1400 } };
  const N = now();
  // the page read the list before the server read the build of snapshot 3, and was away when it did
  let snaps = [snap(1, T0), snap(2, T0 + 5 * H)];
  let lists = 0;
  g.fetch = async (url: string) => ({ ok: true, json: async () => (url === "/api/history" ? (lists++, { snapshots: snaps, current: 2 }) : {}) });
  try {
    const { TimeMachine } = await import("../src/web/src/timemachine.ts");
    const book = new ViewBook();
    const v = book.create("B", "Alice", { scope: parseQuery("ns(B)") }) as ViewData;
    const tm = new TimeMachine(el() as never, el() as never, el() as never, {
      present: () => N, meta: () => N.meta, review: () => emptyReview(), board: () => ({ id: v.id, rec: v }) as never, title: () => "B",
      redraw: async () => {}, memory: async () => null, changed: () => {}, go: () => true, say: () => {}, keep: async () => null, saveAs: async () => null,
    });
    await tm.load();
    assert.equal(lists, 1);
    snaps = [snap(1, T0), snap(3, T0 + 2 * H), snap(2, T0 + 5 * H)];
    v.version = 3;
    await tm.prepare(v);
    assert.equal(lists, 2, "read again once");
    assert.equal(tm.snapshotFor(v), 3, "its build, not the latest");
    assert.equal(tm.preview(v, { snapshot: snap(3, T0 + 2 * H) } as never), false);
    // a build it knows: nothing read again
    await tm.prepare(v);
    assert.equal(lists, 2);
  } finally {
    Object.assign(g, saved);
  }
});

test("a build that could not read some files says so on the bar: what they held is on none of its boards and counts as no change", () => {
  assert.equal(unreadWords([]), null, "a build that read every file says nothing");
  const one = unreadWords(["M.Tagged"])!;
  assert.equal(one.label, "1 file unread");
  assert.match(one.tip, /^A file could not be read at this build \(a failed file, or what imports one\): M\.Tagged\. What it held/);
  const many = unreadWords(Array.from({ length: 10 }, (_, i) => `M.F${i}`))!;
  assert.equal(many.label, "10 files unread");
  assert.match(many.tip, /M\.F7, and 2 more\. What they held is on none of its boards, and is not counted as changed\.$/);
  // the bar says it after what changed since, latest or not: where room is short the counts keep theirs
  const tm = readFileSync(new URL("../src/web/src/timemachine.ts", import.meta.url), "utf8");
  const sum = tm.slice(tm.indexOf("private summaryHtml("), tm.indexOf("private changesHtml("));
  assert.match(sum, /unreadWords\(this\.snaps\.find\(\(x\) => x\.id === id\)\?\.missing \?\? \[\]\)/);
  assert.match(sum, /return this\.changesHtml\(id\) \+ unread;/);
});

test("a view kept at a past build and focused on a target: its note under the review strip, not hidden by it (HistorySpec decision 19)", () => {
  const web = (f: string) => readFileSync(new URL(`../src/web/${f}`, import.meta.url), "utf8");
  const css = web("style.css").replace(/\/\*[^]*?\*\//g, "");
  // the note is placed under the strip's height, on a larger screen, a phone and a tall screen alike
  const tops = [...css.matchAll(/(?<!,\s*)#tm-kept\s*\{([^}]*)\}/g)].map((m) => /top:\s*([^;]+);/.exec(m[1])?.[1]);
  assert.deepEqual(tops, ["calc(110px + var(--lens-h, 0px))", "calc(100px + var(--lens-h, 0px))", "calc(108px + var(--lens-h, 0px))"]);
  // what is said for a moment goes under both
  assert.match(css, /\.hint\.say\.below \{ top: calc\(118px \+ var\(--strip-h, 38px\)\); \}/);
  const main = web("src/main.ts");
  assert.match(main, /setProperty\("--lens-h", `\$\{lens\}px`\)/);
  assert.match(main, /setProperty\("--strip-h", `\$\{lens \+ kept\}px`\)/);
  assert.match(main, /hint\.classList\.toggle\("below", !\$\("#lensbar"\)\.hidden \|\| !\$\("#tm-kept"\)\.hidden\)/);
  // a tall screen's board starts under the lower of the two
  assert.match(web("src/phone.ts"), /const strip = \[\$\("tm-kept"\), \$\("lensbar"\)\]\.find/);
});
