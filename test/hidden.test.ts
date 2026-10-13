// Hidden levels (ViewSpec decision 24): a board hides levels of its cluster tree, per way of
// clustering, and what a hidden cluster holds sits in its parent — the top level's at the top, a
// level inside a hidden one moved up twice, a merged chain hidden by its key, labels told apart where
// two siblings would read alike. Hiding or showing a level moves nothing on the board (the memory
// regrouped, the whole project's layout with its circles taken out), and the pins of what moves to
// another parent are put in that parent's coordinates. The levels are the board's: operations kept
// by the book and the server, a fold on a hidden level dropped, the agents' `views/arrange` with
// `hide` and `show`, and the page that hides one or is told another did.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { refusal } from "../src/server/agent.ts";
import type { Answer, World } from "../src/server/agent.ts";
import { memoryProblem, viewEndpoints } from "../src/server/agentviews.ts";
import { Presence } from "../src/server/presence.ts";
import { Views as ServerViews } from "../src/server/views.ts";
import { boardLayout, boardSet, layoutKey, reframePins, sameSet, wholeLayout } from "../src/shared/board.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_BODY, SITE_STMT } from "../src/shared/graph.ts";
import { clusterTree, computeLayout, withLocal } from "../src/shared/layout.ts";
import { emptyLayouts } from "../src/shared/places.ts";
import type { Pins } from "../src/shared/places.ts";
import { parseQuery } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import type { StoredEvent } from "../src/shared/timeline.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { applyViewOps, invalidViewOps, PROJECT, ViewBook } from "../src/shared/views.ts";
import type { ViewOp } from "../src/shared/views.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A.m sits in A beside A.B (f, g and its sub-namespace A.B.Z) and A.C (h, and A.C.D with k and l);
 *  A.Z.q makes A.B.Z's last part a sibling's too once A.B is hidden; P.Q is a chain (P holds
 *  nothing but Q); X.n is another top level; Ext.E is outside. */
function graph(): Graph {
  const names = ["A.m", "A.B.f", "A.B.g", "A.B.Z.p", "A.B.Z.p2", "A.Z.q", "A.C.h", "A.C.D.k", "A.C.D.l", "P.Q.r", "P.Q.s", "X.n"];
  const nodes: ViewNode[] = names.map((name, k) => ({ name, kind: k % 3 ? "def" : "theorem", module: `M.${name.split(".").slice(0, -1).join("_")}`, ax: 0, hash: `h-${name}` }));
  nodes.push({ name: "Ext.E", kind: "def", module: "Mathlib.X", ax: 0, ext: true });
  const at = (n: string) => nodes.findIndex((v) => v.name === n);
  const edges: number[] = [];
  const use = (a: string, b: string) => edges.push(at(a), at(b), SITE_STMT);
  use("A.m", "A.B.f");
  use("A.B.f", "A.B.g");
  use("A.B.g", "A.C.h");
  use("A.C.h", "A.C.D.k");
  use("A.C.D.k", "A.C.D.l");
  use("A.B.Z.p", "A.Z.q");
  use("P.Q.r", "P.Q.s");
  use("X.n", "A.m");
  edges.push(at("A.C.D.l"), at("Ext.E"), SITE_BODY);
  const meta = { nodes, projectCount: names.length, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: edges.length / 3 } as unknown as ViewMeta;
  return new Graph(meta, Int32Array.from(edges));
}

const edgesOf = (g: Graph) => {
  const out: number[] = [];
  for (let u = 0; u < g.n; u++) for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) out.push(u, g.outDst[e], g.outSite[e]);
  return Int32Array.from(out);
};

/** Each declaration's cluster by key ("" at the top), and each cluster's parent and label. */
function shape(g: Graph, L: Layout) {
  const key = (c: number) => (c >= 0 ? L.clusters[c].key : "");
  return {
    homes: Object.fromEntries(g.nodes.map((v, i) => [v.name, key(L.cluster[i])])),
    tree: Object.fromEntries(L.clusters.map((c) => [c.key, [key(c.parent), c.label, c.depth]])),
  };
}

test("hidden levels: what a hidden cluster holds sits in its parent, the top level's at the top, nested ones moved up twice", () => {
  const g = graph();
  const base = shape(g, clusterTree("namespace", g.nodes));
  // the board as it is: P.Q is one circle, a chain, under its deepest key
  assert.deepEqual(base.tree["P.Q"], ["", "P.Q", 0]);
  assert.equal(base.tree["P"], undefined);
  assert.deepEqual(base.tree["A.B.Z"], ["A.B", "Z", 2]);
  // A.B hidden: f and g in A, A.B.Z beside A.Z, each saying where it came from, A.Z as it was
  const b = shape(g, clusterTree("namespace", g.nodes, ["A.B"]));
  assert.equal(b.tree["A.B"], undefined);
  assert.deepEqual([b.homes["A.B.f"], b.homes["A.B.g"], b.homes["A.m"], b.homes["A.B.Z.p"]], ["A", "A", "A", "A.B.Z"]);
  assert.deepEqual(b.tree["A.B.Z"], ["A", "B.Z", 1], "a label a sibling has too says which hidden level it came through");
  assert.deepEqual(b.tree["A.Z"], ["A", "Z", 1]);
  assert.deepEqual(b.tree["A.C"], ["A", "C", 1], "a label nobody else has stays");
  // the top level hidden: its members are top-level, and so are its declarations
  const top = shape(g, clusterTree("namespace", g.nodes, ["A"]));
  assert.equal(top.tree["A"], undefined);
  assert.deepEqual([top.tree["A.B"], top.tree["A.C"], top.tree["A.C.D"]], [["", "B", 0], ["", "C", 0], ["A.C", "D", 1]]);
  assert.equal(top.homes["A.m"], "");
  // nested hidden levels: A.C and A.C.D both, so k and l move up twice
  const nested = shape(g, clusterTree("namespace", g.nodes, ["A.C", "A.C.D"]));
  assert.deepEqual(["A.C.h", "A.C.D.k", "A.C.D.l"].map((n) => nested.homes[n]), ["A", "A", "A"]);
  assert.ok(!("A.C" in nested.tree) && !("A.C.D" in nested.tree));
  // two hidden siblings: their declarations simply become siblings; nothing takes another's key
  const both = clusterTree("namespace", g.nodes, ["A.B", "A.C"]);
  assert.equal(new Set(both.clusters.map((c) => c.key)).size, both.clusters.length);
  assert.deepEqual(g.nodes.filter((_, i) => both.cluster[i] >= 0 && both.clusters[both.cluster[i]].key === "A").map((v) => v.name), ["A.m", "A.B.f", "A.B.g", "A.C.h"]);
  // a chain is hidden by its key, the circle's; an intermediate key of it hides nothing
  const chain = shape(g, clusterTree("namespace", g.nodes, ["P.Q"]));
  assert.deepEqual([chain.homes["P.Q.r"], chain.homes["P.Q.s"], chain.tree["P.Q"]], ["", "", undefined]);
  assert.deepEqual(shape(g, clusterTree("namespace", g.nodes, ["P"])), base);
  // the outside world can be hidden too: what it holds sits at the top, still outside
  const ext = clusterTree("namespace", g.nodes, ["⟨external⟩"]);
  assert.ok(ext.clusters.every((c) => c.key !== "⟨external⟩"));
  // counts and depths follow; the layout's tree is the same as the tree alone
  const laid = computeLayout("namespace", g.nodes, edgesOf(g), ["A.B"]);
  assert.deepEqual(shape(g, laid), b);
  assert.equal(laid.clusters.find((c) => c.key === "A")!.count, 9);
});

test("hiding or showing a level moves nothing: the memory regrouped, made for its set and its levels", () => {
  const g = graph();
  const first = boardLayout(g, "namespace", "set", null);
  assert.equal(first.next!.set, "set");
  // A.B hidden: every declaration and every cluster left stays where it was on the board
  const hid = boardLayout(g, "namespace", "set", first.next, ["A.B"]);
  assert.equal(hid.next!.set, layoutKey("set", ["A.B"]));
  assert.ok(sameSet(hid.next!.set, "set") && hid.next!.set !== "set");
  assert.deepEqual([hid.layout.x, hid.layout.y], [first.layout.x, first.layout.y]);
  for (const c of hid.layout.clusters) {
    const was = first.layout.clusters.find((k) => k.key === c.key)!;
    assert.deepEqual([c.x, c.y, c.r], [was.x, was.y, was.r], c.key);
  }
  // f, in A now: its place in A's coordinates is where it was on the board
  const f = g.byName.get("A.B.f")!;
  const A = hid.layout.clusters[hid.layout.cluster[f]];
  assert.equal(A.key, "A");
  assert.deepEqual([hid.layout.lx[f], hid.layout.ly[f]], [Math.round((first.layout.x[f] - A.x) * 10) / 10, Math.round((first.layout.y[f] - A.y) * 10) / 10]);
  // another page with that memory recalls it exactly; the order of the levels does not matter
  assert.equal(boardLayout(g, "namespace", "set", hid.next, ["A.B"]).next, null);
  assert.equal(layoutKey("set", ["A.C", "A.B"]), layoutKey("set", ["A.B", "A.C"]));
  assert.equal(layoutKey("set", []), "set", "without hidden levels the key is the set's, as memories were");
  // shown again: drawn round what it holds, where that is
  const back = boardLayout(g, "namespace", "set", hid.next, []);
  assert.equal(back.next!.set, "set");
  const AB = back.layout.clusters.find((c) => c.key === "A.B")!;
  for (const n of ["A.B.f", "A.B.g"]) {
    const i = g.byName.get(n)!;
    assert.deepEqual([back.layout.x[i], back.layout.y[i]], [first.layout.x[i], first.layout.y[i]], n);
    assert.ok(Math.hypot(back.layout.x[i] - AB.x, back.layout.y[i] - AB.y) + 5 <= AB.r + 0.1, `${n} inside A.B`);
  }
  // Re-layout (no memory): the flattened tree packed afresh, A's new members among its own
  const fresh = boardLayout(g, "namespace", "set", null, ["A.B"]);
  assert.deepEqual(shape(g, fresh.layout), shape(g, clusterTree("namespace", g.nodes, ["A.B"])));
  // a whole-project board: the server's layout, the hidden circles taken out, nothing moved
  const base = computeLayout("namespace", g.nodes, edgesOf(g));
  assert.equal(wholeLayout(base, g.nodes, "namespace", []), base);
  const whole = wholeLayout(base, g.nodes, "namespace", ["A"]);
  assert.ok(!whole.clusters.some((c) => c.key === "A"));
  assert.deepEqual([whole.x, whole.y], [base.x, base.y]);
  assert.deepEqual(whole.clusters.find((c) => c.key === "A.C")!.parent, -1);
  // overlaps a layout holds of its own (a real project's base layout can have some) are left as they are:
  // X laid over P.Q stays there when A goes
  const odd = withLocal(structuredClone(base));
  const X = odd.clusters.find((c) => c.key === "X")!, PQ = odd.clusters.find((c) => c.key === "P.Q")!;
  const n = g.byName.get("X.n")!;
  [odd.x[n], odd.y[n]] = [PQ.x + odd.x[n] - X.x, PQ.y + odd.y[n] - X.y];
  [X.x, X.y] = [PQ.x, PQ.y];
  withLocal(odd);
  const kept = wholeLayout(odd, g.nodes, "namespace", ["A"]);
  assert.deepEqual([kept.x, kept.y], [odd.x, odd.y]);
  assert.deepEqual([kept.clusters.find((c) => c.key === "X")!.x, kept.clusters.find((c) => c.key === "X")!.y], [PQ.x, PQ.y]);
});

test("the pins of what moves to another parent are put in its coordinates, at the same place; a hidden cluster's own pin waits", () => {
  const g = graph();
  const { layout: before, next: mem } = boardLayout(g, "namespace", "set", null);
  const regrouped = boardLayout(g, "namespace", "set", mem, ["A.B"]).layout;
  const pins: Pins = { nodes: { "A.B.f": [3, 4], "A.C.h": [1, 1] }, clusters: { "A.B": [5, 5], "A.B.Z": [10, 0] } };
  const ops = reframePins(g, before, regrouped, pins, "namespace");
  // f was at A.B's pin plus its own, in A: so it is now; A.B.Z likewise; A.C.h's frame stayed. A.B
  // was dragged (pinned off its layout place), so g, not pinned, is pinned where it is: its layout
  // place in A is where the layout put it, not where the drag did
  const gi = g.byName.get("A.B.g")!;
  const AB = before.clusters.find((c) => c.key === "A.B")!;
  const gAt: [number, number] = [Math.round((5 + before.lx[gi]) * 10) / 10, Math.round((5 + before.ly[gi]) * 10) / 10];
  assert.ok(Math.hypot(5 - AB.lx, 5 - AB.ly) > 1, "A.B was dragged");
  assert.deepEqual(ops, [
    { op: "pin", mode: "namespace", kind: "cluster", key: "A.B.Z", at: [15, 5] },
    { op: "pin", mode: "namespace", kind: "node", key: "A.B.f", at: [8, 9] },
    { op: "pin", mode: "namespace", kind: "node", key: "A.B.g", at: gAt },
  ]);
  // shown again: back into A.B's coordinates, A.B at its pin
  const moved: Pins = { nodes: { ...pins.nodes, "A.B.f": [8, 9], "A.B.g": gAt }, clusters: { ...pins.clusters, "A.B.Z": [15, 5] } };
  const back = reframePins(g, regrouped, before, moved, "namespace");
  assert.deepEqual(back.slice(0, 2), [
    { op: "pin", mode: "namespace", kind: "cluster", key: "A.B.Z", at: [10, 0] },
    { op: "pin", mode: "namespace", kind: "node", key: "A.B.f", at: [3, 4] },
  ]);
  const gBack = back.find((o) => o.op === "pin" && o.key === "A.B.g")!;
  assert.ok(gBack.op === "pin" && Math.hypot(gBack.at[0] - before.lx[gi], gBack.at[1] - before.ly[gi]) < 0.2, "g where it was in A.B");
  // a level not dragged: what it holds lands where it is without a pin, and nothing is pinned
  const still: Pins = { nodes: {}, clusters: { "A.B": [AB.lx, AB.ly] } };
  assert.deepEqual(reframePins(g, before, regrouped, still, "namespace"), []);
  // nothing pinned in a frame that changes: nothing to do
  assert.deepEqual(reframePins(g, before, regrouped, { nodes: { "X.n": [1, 2] }, clusters: {} }, "namespace"), []);
});

test("hidden levels are the board's: operations, a fold on a hidden level dropped, copied, kept through a re-layout and a restart", () => {
  assert.equal(invalidViewOps([{ op: "hide", mode: "namespace", key: "A", on: true }]), null);
  assert.equal(invalidViewOps([{ op: "hide", mode: "namespace", key: "", on: true }]), "key");
  assert.equal(invalidViewOps([{ op: "hide", mode: "both", key: "A", on: true }]), "mode");
  const v = { pins: emptyLayouts(), folds: { namespace: ["A.B", "A.C"], module: [] as string[] }, hidden: { namespace: [] as string[], module: [] as string[] } };
  assert.ok(applyViewOps(v, [{ op: "hide", mode: "namespace", key: "A.B", on: true }]));
  assert.deepEqual([v.hidden.namespace, v.folds.namespace], [["A.B"], ["A.C"]], "hiding a folded level drops its fold");
  assert.equal(applyViewOps(v, [{ op: "fold", mode: "namespace", key: "A.B", on: true }]), false, "nobody folds what the board does not show");
  assert.equal(applyViewOps(v, [{ op: "hide", mode: "namespace", key: "A.B", on: true }]), false, "hidden already");
  assert.deepEqual(v.hidden.module, [], "per way of clustering");
  assert.ok(applyViewOps(v, [{ op: "hide", mode: "namespace", key: "A.B", on: false }]));
  assert.deepEqual(v.hidden.namespace, []);
  // the book: arranging keeps a view, a copy has its levels, Re-layout leaves them
  const book = new ViewBook();
  const open = book.open(parseQuery("ns(A)"), "Alice").view;
  assert.deepEqual(book.arrange(open.id, [{ op: "hide", mode: "namespace", key: "A", on: true }], "Alice"), [{ id: open.id, what: "kept", by: "Alice" }]);
  const copy = book.create("Mine", "Bob", { from: open.id });
  assert.ok(typeof copy !== "string");
  assert.deepEqual(copy.hidden.namespace, ["A"]);
  book.relayout(open.id, "Alice");
  assert.deepEqual(open.hidden.namespace, ["A"]);
  assert.deepEqual(book.project().hidden, { namespace: [], module: [] });
  // the server: through its endpoint, out to the pages as view-ops, and on disk
  const dir = mkdtempSync(join(tmpdir(), "vp-hidden-"));
  try {
    const sent: { event: string; data: Json }[] = [];
    const views = new ServerViews(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data: data as Json }));
    const ops: ViewOp[] = [{ op: "fold", mode: "namespace", key: "A.C", on: true }, { op: "hide", mode: "namespace", key: "A.C", on: true }, { op: "hide", mode: "module", key: "M", on: true }];
    const r = views.handle({ method: "POST", path: "/api/views/arrange", query: new URLSearchParams(), body: { id: PROJECT, ops }, caller: { name: "Alice", kind: "person" } } as never, "full");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(sent.find((s) => s.event === "view-ops")?.data.ops, ops);
    assert.deepEqual([views.book.project().hidden, views.book.project().folds.namespace], [{ namespace: ["A.C"], module: ["M"] }, []]);
    const again = new ServerViews(dir, LAYOUT_VERSION, () => {});
    assert.deepEqual(again.book.project().hidden, { namespace: ["A.C"], module: ["M"] }, "kept on disk");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A live server's world for the agents' view endpoints, on graph() and its layouts. */
function agentWorld() {
  const dir = mkdtempSync(join(tmpdir(), "vp-hidden-agent-"));
  const g = graph();
  const nodes = g.nodes;
  const edges = edgesOf(g);
  const meta = {
    schema: 1, layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: dir, roots: ["A"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [], nodes, projectCount: g.projectCount, axioms: [], axiomSets: [[]],
    layouts: { namespace: computeLayout("namespace", nodes, edges), module: computeLayout("module", nodes, edges) } as Record<ClusterMode, Layout>,
    edgeCount: edges.length / 3,
  } as ViewMeta;
  const events: StoredEvent[] = [];
  const views = new ServerViews(dir, LAYOUT_VERSION, () => {}, { add: (e) => (events.push({ ...e, id: events.length + 1, at: "" } as StoredEvent), events.at(-1)!) });
  const presence = new Presence(() => {});
  views.peers = () => presence.list();
  const w = {
    project: { root: dir, files: new Map(), toolchain: "tc" },
    graph: { version: 1, prep: { metaGz: gzipSync(JSON.stringify(meta)), edgesGz: gzipSync(Buffer.from(edges.buffer)) } },
    review: { data: emptyReview(), append: () => ({ status: 403, error: "not written here" }) },
    timeline: { events, add: (e: never) => e },
    places: views.places,
    presence,
    placesChanged: () => {},
    views,
  } as unknown as World;
  const eps = viewEndpoints(w, () => refusal("full", "full"));
  const ask = async (method: "GET" | "POST", path: string, params: Json = {}): Promise<Answer> => {
    const e = eps.find((x) => x.method === method && x.path === path)!;
    const caller = { name: "Claude", kind: "agent" as const };
    return e.run(method === "GET" ? { method, path, query: new URLSearchParams(params), body: null, caller } : { method, path, query: new URLSearchParams(), body: params, caller });
  };
  return { w, g, meta, views, ask, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("agents hide levels and show them again through views/arrange, at level full, the pins of what moves kept in place", async () => {
  const W = agentWorld();
  try {
    const id = (await W.ask("POST", "/api/agent/views/open", { scope: "ns(A) or ns(X)" })).body as Json;
    const view = id.view.id as string;
    // a pin in A.B, which is to go
    assert.equal((await W.ask("POST", "/api/agent/views/arrange", { id: view, pins: [{ name: "A.B.f", at: [2, 0] }], fold: ["A.B"] })).status, 200);
    const r = await W.ask("POST", "/api/agent/views/arrange", { id: view, hide: ["A.B", "A"] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const v = W.views.book.get(view)!;
    assert.deepEqual([(r.body as Json).hidden, v.folds.namespace], [["A.B", "A"], []], "its fold dropped");
    // f moved up twice, to the top: its pin is where it was on the board, in the top's coordinates
    const seen = (await W.ask("GET", "/api/agent/views/view", { id: view })).body as Json;
    assert.deepEqual(seen.hidden, ["A.B", "A"]);
    assert.ok(!seen.clusters.some((c: Json) => c.key === "A" || c.key === "A.B"));
    assert.notDeepEqual(v.pins.namespace.nodes["A.B.f"], [2, 0]);
    // the board laid out with those levels hidden, its memory made for them
    const bs = boardSet(W.g, emptyReview(), v.scope);
    assert.equal(W.views.book.memoryOf(view, "namespace")?.set, layoutKey(bs.key, ["A.B", "A"]));
    // what it does not have, or does not hide, is said; a fold on what it hides is refused
    assert.equal((await W.ask("POST", "/api/agent/views/arrange", { id: view, hide: ["Nope"] })).status, 404);
    assert.equal((await W.ask("POST", "/api/agent/views/arrange", { id: view, show: ["A.C"] })).status, 404);
    assert.equal((await W.ask("POST", "/api/agent/views/arrange", { id: view, show: ["A.B"], fold: ["A"] })).status, 404);
    assert.deepEqual(v.hidden.namespace, ["A.B", "A"], "a refused request changes nothing");
    assert.equal((await W.ask("POST", "/api/agent/views/arrange", { id: view, show: ["A"] })).status, 200);
    assert.deepEqual(v.hidden.namespace, ["A.B"]);
    // a page's memory must be for the levels the board hides now
    const sub = boardLayout(bs.sub!.graph, "namespace", bs.key, null, ["A.B"]).next!;
    assert.equal(memoryProblem(W.w, v, "namespace", sub), null);
    assert.equal(memoryProblem(W.w, v, "namespace", { ...sub, set: bs.key })?.status, 409);
    // the Project hides its top level on the server's layout, with no memory of its own
    assert.equal((await W.ask("POST", "/api/agent/views/arrange", { id: PROJECT, hide: ["A"] })).status, 200);
    const proj = (await W.ask("GET", "/api/agent/views/view", { id: PROJECT })).body as Json;
    assert.ok(proj.clusters.some((c: Json) => c.key === "A.C" && c.parent === null));
    assert.equal(W.views.book.memoryOf(PROJECT, "namespace"), null);
  } finally {
    W.done();
  }
});

test("the page: hiding a level sends it with the pins it moves, lays the board out again, and follows another's", async () => {
  const W = agentWorld();
  try {
    const { Views } = await import("../src/web/src/views.ts");
    const { ViewNav } = await import("../src/web/src/viewnav.ts");
    const { BoardSync } = await import("../src/web/src/boardsync.ts");
    const { Store } = await import("../src/web/src/store.ts");
    const g = W.g;
    const book = new ViewBook();
    const rec = book.open(parseQuery("ns(A)"), null).view;
    rec.pins.namespace.nodes["A.B.f"] = [2, 0];
    const posted: Json[] = [];
    let memory: Json | null = null;
    const api = {
      list: async () => [],
      get: async () => ({ view: rec, memory: {} }),
      memory: async () => memory,
      post: async (action: string, body: Json) => {
        posted.push({ action, ...body });
        if (action === "memory") memory = body.memory;
        return action === "memory" ? { accepted: true } : { ok: true };
      },
    };
    const views = new Views(api as never, { graph: () => g, meta: () => W.meta, review: () => emptyReview() });
    // the canvas as far as hiding reads it: the board drawn, and the names its pins are kept under
    let board: Graph | null = null;
    const canvas = { layout: null as Layout | null, drawnLayout: () => canvas.layout, screenOf: (): [number, number] => [0, 0], applyPins: () => {}, setFoldedKeys: () => false, pinName: (j: number) => board!.nodes[j].name };
    const nav = new ViewNav(views, new Store("/nowhere"), {
      show: (b, L) => ((board = b.graph), (canvas.layout = L)),
      place: () => {},
      here: () => ({ cam: null, mode: "plain", picks: null, shown: null }),
      changed: () => {},
    });
    const noop = () => {};
    const sync = new BoardSync(views, nav, {
      canvas: canvas as never, outline: { render: noop } as never, boardPanel: { render: noop, note: noop } as never, notes: { at: noop } as never,
      snapshot: false, stream: () => null, me: () => "Alice", colorOf: () => "red", lost: noop, tabsChanged: noop, levelChanged: noop, activityChanged: noop, hint: noop, writeAddress: noop, notesChanged: noop,
    });
    assert.equal(await nav.show(rec.id), true);
    const before = canvas.layout!;
    assert.ok(before.clusters.some((c) => c.key === "A.B"));
    await sync.hideLevel("A.B");
    // one request: the level, and f's pin in A's coordinates
    const arranged = posted.find((p) => p.action === "arrange")!;
    assert.deepEqual(arranged.ops.map((o: Json) => [o.op, o.key]), [["hide", "A.B"], ["pin", "A.B.f"]]);
    assert.deepEqual(rec.hidden.namespace, ["A.B"]);
    const after = canvas.layout!;
    assert.ok(!after.clusters.some((c) => c.key === "A.B"), "laid out again without it");
    const f = nav.board.graph.byName.get("A.B.f")!;
    assert.deepEqual([after.x[f], after.y[f]], [before.x[f], before.y[f]], "nothing moved");
    assert.equal((posted.filter((p) => p.action === "memory").at(-1)!.memory as Json).set, layoutKey(nav.board.bs.key, ["A.B"]), "its memory made for the level hidden");
    // another page shows it again: this one follows
    sync.ops({ id: rec.id, ops: [{ op: "hide", mode: "namespace", key: "A.B", on: false }], from: "another", by: "Bob" });
    await nav.redraw();
    assert.ok(canvas.layout!.clusters.some((c) => c.key === "A.B"));
  } finally {
    W.done();
  }
});
