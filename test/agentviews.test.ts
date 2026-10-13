// Agents and views (ViewSpec decision 10): the endpoints of the agents' API that list, open, make,
// rescope and arrange views, within what --agents allows; what an agent opens is where it is.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { AgentApi, refusal } from "../src/server/agent.ts";
import type { AgentLevel, Answer, World } from "../src/server/agent.ts";
import { graphOf, memoryProblem, viewEndpoints } from "../src/server/agentviews.ts";
import { Presence } from "../src/server/presence.ts";
import { Views } from "../src/server/views.ts";
import { boardLayout, boardSet } from "../src/shared/board.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { emptyLayouts } from "../src/shared/places.ts";
import { reviewScope } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import type { StoredEvent } from "../src/shared/timeline.ts";
import { PROJECT } from "../src/shared/views.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function world(level: AgentLevel = "full") {
  const dir = mkdtempSync(join(tmpdir(), "vp-agentviews-"));
  const names = ["N.A.t", "N.A.d", "N.B.e", "N.B.p", "N.B.x"];
  const nodes: ViewNode[] = names.map((name) => ({ name, kind: name.endsWith("t") || name.endsWith("p") ? "theorem" : "def", module: name.slice(0, 3), ax: 0, hash: `h-${name}` }));
  nodes.push({ name: "Ext.E", kind: "def", module: "Mathlib.X", ax: 0, ext: true });
  const edges = new Int32Array([0, 1, SITE_STMT, 1, 2, SITE_BODY, 0, 3, SITE_PROOF, 2, 5, SITE_STMT, 4, 1, SITE_STMT]);
  const meta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: dir, roots: ["N"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [],
    nodes,
    projectCount: names.length,
    axioms: [],
    axiomSets: [[]],
    layouts: { namespace: computeLayout("namespace", nodes, edges), module: computeLayout("module", nodes, edges) } as Record<ClusterMode, Layout>,
    edgeCount: 5,
  } as ViewMeta;
  const review = emptyReview();
  review.targets["N.A.t"] = { by: "Alice", at: "" };
  const events: StoredEvent[] = [];
  const sent: { event: string; data: Json }[] = [];
  // the target's view, as marking made one before 2026-10-12: a view as any other, linked to it
  const linked = { id: "review:N.A.t", name: null, scope: reviewScope("N.A.t"), clustering: "namespace", pins: emptyLayouts(), folds: { namespace: [], module: [] }, hidden: { namespace: [], module: [] }, by: null, at: "2026-10-01T00:00:00.000Z", kept: true, targets: ["N.A.t"], focus: "N.A.t" };
  writeFileSync(join(dir, "views.json"), JSON.stringify({ layoutVersion: LAYOUT_VERSION, views: [linked] }));
  const views = new Views(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data: data as Json }), { add: (e) => (events.push({ ...e, id: events.length + 1, at: "" } as StoredEvent), events.at(-1)!) });
  views.syncTargets(["N.A.t"]);
  const presence = new Presence(() => {});
  views.peers = () => presence.list();
  const w: World & { views: Views } = {
    project: { root: dir, files: new Map(), toolchain: "tc" },
    graph: { version: 1, prep: { metaGz: gzipSync(JSON.stringify(meta)), edgesGz: gzipSync(Buffer.from(edges.buffer)) } },
    review: { data: review, append: () => ({ status: 403, error: "not written here" }) },
    timeline: { events, add: (e) => (events.push({ ...e, id: events.length + 1, at: "" } as StoredEvent), events.at(-1)!) },
    places: views.places,
    presence,
    placesChanged: () => {},
    views,
  };
  const eps = viewEndpoints(w, () => refusal(level, "full"));
  const ask = async (method: "GET" | "POST", path: string, params: Json = {}, kind: "agent" | "person" = "agent"): Promise<Answer> => {
    const e = eps.find((x) => x.method === method && x.path === path);
    assert.ok(e, `${method} ${path}`);
    const caller = { name: "Claude", kind };
    return e.run(method === "GET" ? { method, path, query: new URLSearchParams(params), body: null, caller } : { method, path, query: new URLSearchParams(), body: params, caller });
  };
  return { w, views, presence, sent, events, ask, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const body = (a: Answer) => a.body as Json;

test("an agent lists views, opens one on a query and is on it, and reads what a board holds", async () => {
  const W = world();
  try {
    const listed = body(await W.ask("GET", "/api/agent/views"));
    assert.deepEqual(listed.views.map((v: Json) => v.id), [PROJECT, "review:N.A.t"]);
    // the short title, its scope's — a name of two letters said with its parent as a chip says it —
    // and the scope in full
    assert.equal(listed.views[1].title, "review ★A.t");
    assert.equal(listed.views[1].description, "TCB of A.t, except what is trusted, or what A.t uses and axioms and what rests on non-standard axioms");
    const bad = await W.ask("POST", "/api/agent/views/open", { scope: "tcb(N.A.t" });
    assert.equal(bad.status, 400);
    assert.match(body(bad).error, /at 9/);
    const opened = body(await W.ask("POST", "/api/agent/views/open", { scope: "tcb(N.A.t) except external" }));
    assert.equal(opened.view.kept, false);
    assert.deepEqual(opened.holds, { project: 3, outside: 0 });
    const id = opened.view.id;
    // the agent is on it: people following it go there, and it lives while the agent is here
    const me = W.presence.list().find((p) => p.agent)!;
    assert.equal(me.view?.view, id);
    assert.equal(me.view?.scope, "tcb(N.A.t) except external");
    W.views.seenPeers(W.presence.list());
    assert.deepEqual(W.views.book.sweep(Date.now() + 5000, 8000), []);
    assert.deepEqual(body(await W.ask("GET", "/api/agent/views")).views.find((v: Json) => v.id === id).on, ["Claude (agent)"]);
    // the board, laid out as the pages lay it out: its memory is handed over
    const seen = body(await W.ask("GET", "/api/agent/views/view", { id, members: "1" }));
    assert.deepEqual(seen.members, ["N.A.t", "N.A.d", "N.B.e"]);
    assert.ok(seen.clusters.length > 0);
    assert.ok(W.views.book.memoryOf(id, "namespace"));
    assert.equal((await W.ask("GET", "/api/agent/views/view", { id: "nope" })).status, 404);
  } finally {
    W.done();
  }
});

test("an agent makes, rescopes and arranges views on a full server; arranging keeps a view; never on a read one", async () => {
  const W = world();
  try {
    const made = body(await W.ask("POST", "/api/agent/views/create", { name: "Claude's map", scope: "ns(N.B)" }));
    assert.equal(made.view.kept, true);
    assert.deepEqual(W.events.map((e) => e.kind === "view" && [e.what, e.by, e.agent]), [["created", "Claude", true]]);
    const id = made.view.id;
    const rescoped = body(await W.ask("POST", "/api/agent/views/scope", { id, scope: "ns(N.B) except kind(theorem)" }));
    assert.deepEqual(rescoped.holds, { project: 2, outside: 0 });
    // an open view arranged: kept, folds and pins as the pages have them
    const open = body(await W.ask("POST", "/api/agent/views/open", { scope: "uses(N.A.t)" })).view.id;
    const board = body(await W.ask("GET", "/api/agent/views/view", { id: open }));
    const cluster = board.clusters.find((c: Json) => c.parent !== null) ?? board.clusters[0];
    const r = await W.ask("POST", "/api/agent/views/arrange", { id: open, fold: [cluster.key], pins: [{ name: "N.A.d", at: [1e5, 0] }, { cluster: cluster.key, at: [3, 4] }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const v = W.views.book.get(open)!;
    assert.ok(v.kept, "arranging keeps it");
    assert.deepEqual(v.folds.namespace, [cluster.key]);
    assert.ok(Math.hypot(...v.pins.namespace.nodes["N.A.d"]) < 1e5, "a place beyond the room is brought inside");
    assert.equal(W.views.placesOf(open).authorOf("namespace", "node", "N.A.d")?.agent, true, "who dropped it");
    const ops = W.sent.filter((s) => s.event === "view-ops").at(-1)!.data;
    assert.equal(ops.by, "Claude");
    // a declaration the board does not hold, a cluster it does not have
    assert.equal((await W.ask("POST", "/api/agent/views/arrange", { id: open, pins: [{ name: "N.B.x", at: [0, 0] }] })).status, 404);
    assert.equal((await W.ask("POST", "/api/agent/views/arrange", { id: open, fold: ["Nope"] })).status, 404);
    // the clustering, then folds in it
    assert.equal((await W.ask("POST", "/api/agent/views/arrange", { id: open, clustering: "module" })).status, 200);
    assert.equal(W.views.book.get(open)!.clustering, "module");
    // a person through this API, and a server that lets agents only read
    assert.equal((await W.ask("POST", "/api/agent/views/open", { scope: "all" }, "person")).status, 400);
    const R = world("read");
    try {
      assert.equal((await R.ask("POST", "/api/agent/views/open", { scope: "all" })).status, 200, "opening is reading");
      for (const [path, params] of [["/api/agent/views/create", { name: "x" }], ["/api/agent/views/scope", { id: PROJECT, scope: "all" }], ["/api/agent/views/arrange", { id: PROJECT, fold: [] }]] as const)
        assert.equal((await R.ask("POST", path, params)).status, 403, path);
    } finally {
      R.done();
    }
  } finally {
    W.done();
  }
});

test("the agents' API serves the endpoints about views, and an agent goes to a view or a target's view by its id", async () => {
  const W = world();
  try {
    const api = new AgentApi(W.w, { describe: async () => ({ contents: null }), print: async () => ({ messages: [] }) }, "full");
    const caller = { name: "Claude", kind: "agent" as const };
    const post = (path: string, b: Json) => api.handle({ method: "POST", path, query: new URLSearchParams(), body: b, caller });
    const listed = body(await api.handle({ method: "GET", path: "/api/agent/endpoints", query: new URLSearchParams(), body: null, caller }));
    assert.ok(listed.endpoints.some((e: Json) => e.path === "/api/agent/views/arrange" && e.needs === "--agents full"));
    const r = body(await post("/api/agent/view", { review: "N.A.t", sel: "N.A.d" }));
    assert.deepEqual(r.reviewView, ["N.A.t"]);
    assert.match(r.followersSee, /^the view "review ★A\.t", N\.A\.t's view, the review focused on N\.A\.t.*looking at N\.A\.d\.$/);
    const me = () => W.presence.list().find((p) => p.agent)!.view!;
    assert.equal(me().view, "review:N.A.t");
    assert.equal((await post("/api/agent/view", { review: "N.A.d" })).status, 400, "only a target has a view");
    assert.equal((await post("/api/agent/view", { view: "nope" })).status, 404);
    const home = body(await post("/api/agent/view", { view: null }));
    assert.equal(me().view, PROJECT);
    assert.match(home.followersSee, /^the Project view: everything/);
  } finally {
    W.done();
  }
});

test("a refused arrangement changes nothing: the clustering, folds and pins are all checked before any is applied", async () => {
  const W = world();
  try {
    const before = structuredClone(W.views.book.project());
    const told = W.sent.length;
    for (const params of [
      { id: PROJECT, clustering: "module", fold: ["Nope"] },
      { id: PROJECT, clustering: "module", unfold: ["N.A", "Nope"] },
      { id: PROJECT, clustering: "module", pins: [{ name: "Nope.x", at: [1, 1] }] },
      { id: PROJECT, clustering: "module", fold: ["N.B"], pins: [{ name: "N.A.d", at: ["a", 1] }] },
      { id: PROJECT, clustering: "sideways", fold: ["N.B"] },
    ]) {
      const r = await W.ask("POST", "/api/agent/views/arrange", params);
      assert.ok(r.status >= 400, JSON.stringify(params));
      assert.deepEqual(W.views.book.project(), before, `${JSON.stringify(params)} changed nothing`);
    }
    assert.equal(W.sent.length, told, "and told nobody anything");
    // all of it valid: all of it applied, folds in the clustering it asks for
    const r = await W.ask("POST", "/api/agent/views/arrange", { id: PROJECT, clustering: "module", fold: ["N.B"] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(W.views.book.project().clustering, "module");
    assert.deepEqual(W.views.book.project().folds.module, ["N.B"]);
  } finally {
    W.done();
  }
});

test("a board's memory is handed over under a name and within --agents, as arranging is, and only for the set the board holds", async () => {
  const W = world();
  try {
    W.views.checkMemory = (v, mode, m) => memoryProblem(W.w, v, mode, m);
    const id = body(await W.ask("POST", "/api/agent/views/open", { scope: "ns(N.B) or decl(N.A.d)" })).view.id;
    // what a page makes of the board: the set it holds, laid out
    const G = graphOf(W.w)!;
    const bs = boardSet(G.g, W.w.review.data, W.views.book.get(id)!.scope);
    const { next } = boardLayout(bs.sub!.graph, "namespace", bs.key, null);
    assert.ok(next);
    const hand = (memory: unknown, name: string | null = "Alice", kind: "person" | "agent" = "person", level: AgentLevel = "full", view = id) =>
      W.views.handle({ method: "POST", path: "/api/views/memory", query: new URLSearchParams(), body: { id: view, mode: "namespace", base: null, memory }, caller: { name, kind } }, level);
    assert.equal(hand(next, null).status, 401, "a name first");
    assert.equal(hand(next, "Claude", "agent", "advise").status, 403, "an agent on a server that does not let it lay out");
    assert.equal(hand({ ...next, set: "4.zz.zz" }).status, 409, "a set the board does not hold");
    const extra = structuredClone(next);
    extra.mem.nodes["Not.on.board"] = [0, 0, ""];
    assert.equal(hand(extra).status, 400, "a declaration the board does not hold");
    const fewer = structuredClone(next);
    delete fewer.mem.nodes["N.A.d"];
    assert.equal(hand(fewer).status, 400, "not everything the board holds");
    const cluster = structuredClone(next);
    cluster.mem.clusters["Made.Up"] = [0, 0, 10];
    assert.equal(hand(cluster).status, 400, "a cluster no layout of the board has");
    const home = structuredClone(next);
    home.mem.nodes["N.A.d"] = [0, 0, "Made.Up"];
    assert.equal(hand(home).status, 400, "a declaration placed in a cluster no layout has");
    assert.equal(hand(next, "Alice", "person", "full", PROJECT).status, 400, "the Project is the server's layout");
    assert.equal(W.views.book.memoryOf(id, "namespace"), null, "nothing refused was taken");
    const ok = hand(next);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(W.views.book.memoryOf(id, "namespace"), next);
  } finally {
    W.done();
  }
});

test("a view kept at a past build keeps a memory of that build's board, never the latest's; agents' layouts of it are not handed over", async () => {
  const W = world();
  try {
    // snapshots 1 and 2, 2 the latest: a view kept at 1 shows a past build, one kept at 2 the latest
    W.views.snapshotAt = (id) => (id === 1 || id === 2 ? new Date(0).toISOString() : null);
    W.views.latest = () => 2;
    W.views.checkMemory = (v, mode, m) => memoryProblem(W.w, v, mode, m, W.views.pastOf(v));
    const make = (version: number) => body(W.views.handle({ method: "POST", path: "/api/views/create", query: new URLSearchParams(), body: { name: `B ${version}`, scope: "ns(N.B) or decl(N.A.d)", version }, caller: { name: "Alice", kind: "person" } }, "full")).view.id as string;
    const past = make(1), kept = make(2);
    assert.equal(W.views.pastOf(W.views.book.get(past)!), 1);
    assert.equal(W.views.pastOf(W.views.book.get(kept)!), null, "kept at the latest build: the graph on show");
    const G = graphOf(W.w)!;
    const bs = boardSet(G.g, W.w.review.data, W.views.book.get(past)!.scope);
    const { next } = boardLayout(bs.sub!.graph, "namespace", bs.key, null);
    const hand = (view: string, memory: unknown) => W.views.handle({ method: "POST", path: "/api/views/memory", query: new URLSearchParams(), body: { id: view, mode: "namespace", base: null, memory }, caller: { name: "Alice", kind: "person" } }, "full");
    // the past view takes a memory of its build only, which the pages check as they recall it
    assert.equal(hand(past, next).status, 409, "the latest build's memory is not a past board's");
    assert.equal(hand(past, { ...next!, set: `@2:${next!.set}` }).status, 409, "nor another build's");
    assert.equal(hand(past, { ...next!, set: `@1:${next!.set}` }).status, 200);
    assert.equal(W.views.book.memoryOf(past, "namespace")!.set, `@1:${next!.set}`);
    // a view of the latest build takes no past board's memory
    assert.equal(hand(kept, { ...next!, set: `@1:${next!.set}` }).status, 409);
    assert.equal(hand(kept, next).status, 200);
    // an agent arranging the past view lays its board out on the latest graph: that layout is not
    // handed over as the view's memory, which stays its build's
    const r = await W.ask("POST", "/api/agent/views/arrange", { id: past, fold: ["N.B"] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(W.views.book.memoryOf(past, "namespace")!.set, `@1:${next!.set}`);
  } finally {
    W.done();
  }
});
