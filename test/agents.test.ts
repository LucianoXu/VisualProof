// Agents as users (AgentSpec.md): their opinions are advice and never counted, the kind a request
// says, what `--agents` lets them change, the API's handlers called without HTTP, and undoing a
// layout batch.

import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import type { Peer } from "../src/shared/collab.ts";
import type { Cluster, ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { advice, adviceOf, current, emptyReview, invalid, judgedOn, logFileName, markOf, progressOf, record, replay, reviewFromJson, statusOf } from "../src/shared/review.ts";
import type { ReviewEvent, ReviewOp } from "../src/shared/review.ts";
import { reviewedBy } from "../src/shared/reviewqueue.ts";
import { printQuery } from "../src/shared/query.ts";
import { AgentApi, refusal } from "../src/server/agent.ts";
import type { AgentLevel, Answer, Caller, World } from "../src/server/agent.ts";
import { undo as undoBatch } from "../src/server/agentplaces.ts";
import { Timeline } from "../src/server/events.ts";
import type { NewEvent } from "../src/shared/timeline.ts";
import { Identities } from "../src/server/identity.ts";
import { Views } from "../src/server/views.ts";
import { agentSession, Presence } from "../src/server/presence.ts";
import { ReviewStore } from "../src/server/review.ts";
import { lakeTextHash } from "../src/server/status.ts";

const at = (k: number) => `2026-10-07T10:0${k}:00.000Z`;

test("an agent's opinion is advice: nothing that counts the review reads it", () => {
  const d = emptyReview();
  const events: ReviewEvent[] = [];
  const op = (by: string, verdict: "approve" | "comment", agent: boolean, k: number, hash = "h1"): void => {
    events.push(record(d, { op: "opinion", name: "X", by, verdict, comment: verdict === "comment" ? "why" : undefined, hash, text: `v ${hash}`, agent } as ReviewOp, "tc", at(k)));
  };
  op("Claude", "comment", true, 1);
  assert.equal(statusOf(d, "X", "h1"), "none", "advice alone leaves it unreviewed");
  assert.equal(markOf(d, "X", "M", false, "h1"), "none");
  assert.deepEqual(progressOf(d, [{ name: "X", module: "M", ext: false, hash: "h1" }]), { total: 1, approved: 0, commented: 0, stale: 0 });
  assert.equal(current(d, "X").length, 0);
  assert.equal(advice(d, "X").length, 1);
  assert.equal(adviceOf(d, "X", "h1"), "comment");
  assert.equal(adviceOf(d, "X", "h2"), null, "advice on an earlier version advises nothing now");
  // a person who happens to share the agent's name has not reviewed it
  assert.equal(reviewedBy(d, "Claude", "X", "h1"), false);

  op("Alice", "approve", false, 2);
  assert.equal(statusOf(d, "X", "h1"), "approved", "the agent's comment does not make it commented");
  // a person and an agent of the same name are two authors: neither replaces the other
  op("Claude", "approve", false, 3);
  assert.equal(current(d, "X").length, 2);
  assert.equal(advice(d, "X").length, 1);
  assert.equal(advice(d, "X")[0].verdict, "comment");
  assert.equal(reviewedBy(d, "Claude", "X", "h1"), true);
  // what each judged is its own, though the person's repeat of the same text is not stored again
  op("Claude", "comment", true, 4);
  const last = d.opinions.X[d.opinions.X.length - 1];
  assert.equal(last.agent, true);
  assert.equal(last.text, undefined, "the agent's own repeat on the same version and text");
  assert.deepEqual(judgedOn(d, "X", last), { of: "source", text: "v h1" });
  op("Claude", "approve", true, 5, "h2");
  assert.equal(statusOf(d, "X", "h2"), "stale", "people's opinions are on h1; the advice on h2 does not count");
  // the logs keep the mark, and the replay reads it back; so does the review as JSON carries it
  const again = replay([{ file: "people.jsonl", events: events.filter((e) => !(e.op === "opinion" && e.agent)) }, { file: "Claude.agent.jsonl", events: events.filter((e) => e.op === "opinion" && e.agent) }]);
  assert.equal(again.opinions.X.filter((o) => o.agent).length, 3);
  assert.equal(statusOf(again, "X", "h1"), "approved");
  assert.equal(statusOf(reviewFromJson(JSON.parse(JSON.stringify(d))), "X", "h1"), "approved");
});

test("whether something is an agent's is the server's to say, for every event; what it may record, its level's", () => {
  const base = { op: "opinion", name: "X", by: "A", verdict: "approve" };
  assert.equal(invalid({ ...base, agent: true }), null);
  assert.equal(invalid({ ...base, agent: "yes" }), "agent");
  // since level full (AgentSpec decision 9) an agent's event may be any: the level is checked where
  // the request comes in, not here
  assert.equal(invalid({ op: "target", name: "X", by: "A", on: true, agent: true }), null);
  assert.equal(invalid({ op: "trust", prefix: "X", by: "A", on: true, agent: true }), null);
  assert.equal(invalid({ op: "target", name: "X", by: "A", on: true, agent: false }), null);
});

test("a request says it comes from an agent; otherwise it is a person's", () => {
  const ids = new Identities();
  const req = (h: Record<string, string>) => ({ headers: h }) as unknown as IncomingMessage;
  assert.equal(ids.kind(req({ "x-visualproof-kind": "agent" })), "agent");
  assert.equal(ids.kind(req({ "x-visualproof-kind": " Agent " })), "agent");
  assert.equal(ids.kind(req({ "x-visualproof-kind": "person" })), "person");
  assert.equal(ids.kind(req({})), "person");
});

test("--agents: read writes nothing, advise gives advice and notes, full does what people do too", () => {
  assert.equal(refusal("read", "advise")?.status, 403);
  assert.equal(refusal("read", "full")?.status, 403);
  assert.equal(refusal("advise", "advise"), null);
  assert.equal(refusal("advise", "full")?.status, 403);
  assert.equal(refusal("full", "advise"), null);
  assert.equal(refusal("full", "full"), null);
  assert.ok((refusal("advise", "full")!.body as { hint: string }).hint.includes("--agents full"));
});

// ---------------------------------------------------------------------------------------------
// The API, on a small world: target t's statement uses a and y; a uses z (body), d and f; y uses
// z; d and e use each other; z uses the external E; t's proof uses p. u is a second target.

const SOURCE = [
  "namespace N", // 1
  "variable (n : Nat)", // 2
  "/-- The base. -/", // 3
  "def z : Nat := 0", // 4
  "open Classical in", // 5
  "def y : Nat := z", // 6
  "", // 7
  "def a : Nat :=", // 8
  "  z + 1", // 9
  "", // 10
  "end N", // 11
].join("\n");

function world(level: AgentLevel = "full") {
  const dir = mkdtempSync(join(tmpdir(), "vp-agents-"));
  const state = join(dir, "state");
  mkdirSync(state);
  writeFileSync(join(dir, "M.lean"), SOURCE);
  const names = ["N.t", "N.a", "N.y", "N.z", "N.d", "N.e", "N.f", "N.p", "N.u"];
  const range: Record<string, [number, number, number, number]> = { "N.z": [4, 0, 4, 16], "N.y": [6, 0, 6, 16], "N.a": [8, 0, 9, 7] };
  const nodes: ViewNode[] = names.map((name) => ({
    name,
    kind: name === "N.t" || name === "N.u" || name === "N.p" ? "theorem" : "def",
    module: "M",
    ax: 0,
    hash: `h-${name}`,
    type: name === "N.z" ? "Nat" : `T ${name}`,
    ...(name === "N.z" ? { doc: "The base." } : {}),
    ...(range[name] ? { range: range[name] } : {}),
    // a unit: Lean generated these from the command that writes N.a
    ...(name === "N.a" ? { also: ["N.a.Name", "N.a.instDecidableEqName"] } : {}),
  }));
  nodes.push({ name: "Ext.E", kind: "def", module: "Mathlib.X", ax: 0, ext: true });
  const ix = (n: string) => (n === "Ext.E" ? 9 : names.indexOf(n));
  const edges: number[] = [];
  const use = (u: string, v: string, site: number) => edges.push(ix(u), ix(v), site);
  use("N.t", "N.a", SITE_STMT);
  use("N.t", "N.y", SITE_STMT);
  use("N.t", "N.p", SITE_PROOF);
  use("N.a", "N.z", SITE_BODY);
  use("N.a", "N.d", SITE_STMT);
  use("N.a", "N.f", SITE_STMT);
  use("N.y", "N.z", SITE_STMT);
  use("N.z", "Ext.E", SITE_STMT);
  use("N.d", "N.e", SITE_BODY);
  use("N.e", "N.d", SITE_BODY);
  use("N.u", "N.y", SITE_STMT);
  // one cluster per way of clustering, every declaration in it
  const cluster: Cluster = { key: "N", label: "N", parent: -1, depth: 0, x: 0, y: 0, lx: 0, ly: 0, r: 100, count: nodes.length, ext: false };
  const layout = (): Layout => ({
    x: nodes.map((_, k) => k * 10),
    y: nodes.map(() => 0),
    lx: nodes.map((_, k) => k * 10),
    ly: nodes.map(() => 0),
    cluster: nodes.map(() => 0),
    clusters: [{ ...cluster }],
  });
  const meta: ViewMeta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: dir, roots: ["M"], toolchain: "tc", extractedAt: at(0), extractMs: 1 },
    modules: [{ name: "M", file: "M.lean", imports: [], compiled: lakeTextHash(SOURCE) }],
    nodes,
    projectCount: names.length,
    axioms: [],
    axiomSets: [[]],
    layouts: { namespace: layout(), module: layout() } as Record<ClusterMode, Layout>,
    edgeCount: edges.length / 3,
  };
  const review = new ReviewStore(dir, join(dir, "review"));
  const alice = { name: "Alice", agent: false };
  review.append(alice, { op: "target", name: "N.t", by: "Alice", on: true }, "tc");
  review.append(alice, { op: "target", name: "N.u", by: "Alice", on: true }, "tc");
  const peers: Peer[][] = [];
  const presence = new Presence((p) => peers.push(p));
  const changes: unknown[][] = [];
  const timeline = new Timeline(state, () => {});
  const views = new Views(state, LAYOUT_VERSION, () => {}, timeline);
  views.syncTargets(["N.t", "N.u"]);
  const w: World = {
    project: { root: dir, files: new Map([["M", "M.lean"]]), toolchain: "tc" },
    graph: { version: 1, prep: { metaGz: gzipSync(JSON.stringify(meta)), edgesGz: gzipSync(Buffer.from(Int32Array.from(edges).buffer)) } },
    review,
    timeline,
    places: views.places,
    views,
    presence,
    placesChanged: (ops) => changes.push(ops),
  };
  // Lean answers at once, except about the one name whose module it is still loading; it knows
  // neither N.zz nor a name with "nope" in it; what it was asked, and where, is kept
  const asked: { what: string; module: string; name: string; proofs?: boolean }[] = [];
  const unknown = (name: string) => name === "N.zz" || name.includes("nope");
  const lean = {
    describe: async (module: string, name: string) => {
      asked.push({ what: "describe", module, name });
      return name === "N.p" ? { pending: { line: 0, of: 2 } } : unknown(name) ? { contents: null } : { contents: `\`\`\`lean\n${name} : Nat\n\`\`\`` };
    },
    print: async (module: string, name: string, proofs: boolean) => {
      asked.push({ what: "print", module, name, proofs });
      if (name === "N.p") return { pending: { line: 0, of: 2 } };
      if (unknown(name)) return { messages: [{ severity: "error" as const, text: `Unknown constant \`${name}\`` }] };
      // a theorem's proof, printed, can be long
      if (name === "N.t" && proofs) return { messages: [{ severity: "information" as const, text: `theorem N.t : T N.t :=\n${"  proof\n".repeat(10_000)}` }] };
      return { messages: [{ severity: "information" as const, text: `def ${name} : Nat :=\n${proofs ? "proofs" : "⋯"}` }] };
    },
  };
  const api = new AgentApi(w, lean, level);
  const claude: Caller = { name: "Claude", kind: "agent" };
  const ask = (method: string, path: string, params: Record<string, string> | object = {}, caller: Caller = claude): Promise<Answer> =>
    api.handle(
      method === "GET"
        ? { method, path, query: new URLSearchParams(params as Record<string, string>), body: null, caller }
        : { method, path, query: new URLSearchParams(), body: params, caller },
    );
  return { dir, w, api, ask, asked, review, presence, peers, changes, done: () => rmSync(dir, { recursive: true, force: true }) };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = (a: Answer) => a.body as Json;

test("the API answers what an agent asks: search, a declaration, its source, a TCB in review order, why, Lean", async () => {
  const W = world();
  try {
    const index = json(await W.ask("GET", "/api/agent"));
    assert.equal(index.you.kind, "agent");
    assert.equal(index.you.may.full, true);
    assert.ok(json(await W.ask("GET", "/api/agent/endpoints")).endpoints.some((e: Json) => e.path === "/api/agent/tcb" && e.params.target));
    assert.ok(index.endpoints.some((line: string) => line.startsWith("GET /api/agent/tcb?target=")), "the entry names it");
    assert.equal(index.graph.targets, 2);

    const found = json(await W.ask("GET", "/api/agent/search", { q: "base" }));
    assert.equal(found.hits[0].name, "N.z");
    assert.equal(found.hits[0].where, "doc");

    // a name that does not exist: what was meant
    const miss = await W.ask("GET", "/api/agent/declaration", { name: "N.zz" });
    assert.equal(miss.status, 404);
    assert.ok(json(miss).didYouMean.length > 0);
    assert.ok(json(miss).hint);

    const z = json(await W.ask("GET", "/api/agent/declaration", { name: "N.z" }));
    assert.equal(z.statement, "Nat");
    assert.equal(z.doc, "The base.");
    assert.equal(z.hash, "h-N.z");
    assert.deepEqual(z.inTcbOf, ["N.t", "N.u"]);
    assert.equal(z.review.status, "none");
    assert.equal(z.usedBy.direct, 2);
    assert.equal(z.editedSinceCompiled, false);

    const src = json(await W.ask("GET", "/api/agent/source", { name: "N.z" }));
    assert.equal(src.compiled, true);
    assert.equal(src.text, "/-- The base. -/\ndef z : Nat := 0");
    // what is in force where it is written, as Lean, apart from the text
    assert.equal(src.context, "namespace N\nvariable (n : Nat)");
    assert.equal((await W.ask("GET", "/api/agent/source", { name: "Ext.E" })).status, 404);

    // bottom-up: what is used comes first; the proof's p is not in the TCB
    const tcb = json(await W.ask("GET", "/api/agent/tcb", { target: "N.t" }));
    const order = tcb.members.map((m: Json) => m.name);
    assert.ok(order.indexOf("N.z") < order.indexOf("N.y") && order.indexOf("N.z") < order.indexOf("N.a"));
    assert.equal(order[order.length - 1], "N.t");
    assert.ok(!order.includes("N.p"));
    assert.ok(!order.includes("Ext.E"), "Mathlib is trusted");
    assert.equal(tcb.counts.needReview, order.length);
    assert.deepEqual(tcb.axioms, [], "no axiom beyond the standard ones");
    assert.equal(tcb.trustedNotCounted, 1);
    const page = json(await W.ask("GET", "/api/agent/tcb", { target: "N.t", offset: "2", limit: "2" }));
    assert.deepEqual(page.members.map((m: Json) => m.name), order.slice(2, 4));
    assert.equal(page.members[0].position, 3);
    assert.equal(page.next, 4);

    const why = json(await W.ask("GET", "/api/agent/why", { target: "N.t", name: "N.e" }));
    assert.deepEqual(why.chain.map((c: Json) => c.name), ["N.t", "N.a", "N.d", "N.e"]);
    assert.equal(why.chain[1].usedIn, "the statement of N.t");
    assert.equal(why.chain[3].usedIn, "the body of N.d");
    assert.equal(json(await W.ask("GET", "/api/agent/why", { target: "N.t", name: "N.p" })).inTcb, false);

    const lean = json(await W.ask("GET", "/api/agent/describe", { name: "N.a" }));
    assert.match(lean.lean, /N\.a : Nat/);
    // Lean still loading: ask again later
    const later = await W.ask("GET", "/api/agent/describe", { name: "N.p" });
    assert.equal(later.status, 503);
    assert.equal(later.headers?.["retry-after"], "5");

    assert.equal((await W.ask("GET", "/api/agent/nothing")).status, 404);
    assert.equal((await W.ask("POST", "/api/agent/tcb")).status, 405);
  } finally {
    W.done();
  }
});

test("the API records advice, notes and where an agent looks; advice is never counted", async () => {
  const W = world();
  try {
    // writes say who and what makes them
    assert.equal((await W.ask("POST", "/api/agent/opinion", { name: "N.z", verdict: "approve" }, { name: "Claude", kind: "person" })).status, 400);
    assert.equal((await W.ask("POST", "/api/agent/opinion", { name: "N.z", verdict: "approve" }, { name: null, kind: "agent" })).status, 401);
    assert.equal((await W.ask("POST", "/api/agent/opinion", { name: "N.z", verdict: "comment" })).status, 400, "a comment needs text");

    const r = await W.ask("POST", "/api/agent/opinion", { name: "N.z", verdict: "comment", comment: "z should be 1" });
    assert.equal(r.status, 200);
    assert.equal(json(r).counted, false);
    const o = W.review.data.opinions["N.z"].at(-1)!;
    assert.equal(o.agent, true);
    assert.equal(o.hash, "h-N.z", "the server records the present hash");
    assert.equal(o.text, "namespace N\nvariable (n : Nat)\n\n/-- The base. -/\ndef z : Nat := 0", "and the compiled text it was given on, under its context");
    assert.equal(statusOf(W.review.data, "N.z", "h-N.z"), "none");

    const z = json(await W.ask("GET", "/api/agent/declaration", { name: "N.z" }));
    assert.equal(z.review.status, "none");
    assert.equal(z.review.advice[0].verdict, "comment");
    assert.equal(z.review.advice[0].yours, true);
    assert.equal(z.review.youAdvised, true);
    const tcb = json(await W.ask("GET", "/api/agent/tcb", { target: "N.t" }));
    assert.equal(tcb.counts.approved + tcb.counts.commented, 0, "advice moves no count");
    assert.equal(tcb.counts.agentComments, 1);
    assert.equal(tcb.counts.advisedByYou, 1);
    const todo = json(await W.ask("GET", "/api/agent/tcb", { target: "N.t", todo: "1" }));
    assert.equal(todo.total, tcb.total - 1);
    assert.ok(!todo.members.some((m: Json) => m.name === "N.z"));

    // a note of the project beside its declaration (in its cluster, just by its point, AttachmentSpec
    // decision 13), marked as the agent's; the timeline records it
    const n = await W.ask("POST", "/api/agent/note", { name: "N.a", text: "the swap is applied twice in `N.a`" });
    assert.equal(n.status, 200, JSON.stringify(n.body));
    assert.deepEqual([json(n).kind, json(n).here.cluster, json(n).places.namespace.cluster, json(n).places.module, json(n).by, json(n).agent, json(n).open], ["project", "N", "N", null, "Claude", true, true]);
    const stuck = W.w.views.book.notes.at(-1)!;
    assert.deepEqual([stuck.by, stuck.agent, stuck.text, Object.keys(stuck.places)], ["Claude", true, "the swap is applied twice in `N.a`", ["namespace"]]);
    const note = W.w.timeline.events.at(-1)! as Json;
    assert.deepEqual([note.kind, note.what, note.by, note.agent, note.view, note.title, note.note], ["note", "created", "Claude", true, "", "", stuck.id]);
    const act = json(await W.ask("GET", "/api/agent/activity", { since: at(0) }));
    assert.ok(act.events.some((e: Json) => e.kind === "opinion" && e.agent === true && e.name === "N.z"));
    assert.ok(act.events.some((e: Json) => e.kind === "note" && e.what === "created"));
    // a note of the kind agents left about a declaration before notes were on the board, still in a
    // timeline file: not read
    W.w.timeline.add({ kind: "note", by: "Claude", agent: true, name: "N.a", text: "an old note" } as unknown as NewEvent);
    assert.ok(!json(await W.ask("GET", "/api/agent/activity", { since: at(0) })).events.some((e: Json) => e.text === "an old note"));
    // what is about a declaration: a note that names it too
    assert.deepEqual(json(await W.ask("GET", "/api/agent/activity", { name: "N.a" })).events.map((e: Json) => e.kind), ["note"]);

    // where it looks: among the others, as an agent, followed like anyone
    const v = await W.ask("POST", "/api/agent/view", { review: "N.t", sel: "N.a" });
    assert.equal(v.status, 200);
    const me = W.presence.list().find((p) => p.id === agentSession("Claude"))!;
    assert.equal(me.agent, true);
    // N.t had no view: the agent is on the temporary view of its TCB a click gives it
    const tv = W.w.views.book.viewOf("N.t")!;
    assert.deepEqual([me.view?.sel, me.view?.view, printQuery(tv.scope), tv.kept], ["N.a", tv.id, "tcb(N.t)", false]);
    // a later view keeps what it does not change
    await W.ask("POST", "/api/agent/view", { sel: "N.z" });
    assert.equal(W.presence.agentView("Claude")?.view, tv.id);
    assert.equal((await W.ask("POST", "/api/agent/view", { sel: "N.nope" })).status, 404);
    // what it selects, a query's text, read and printed canonically; a selection that cannot be
    // read is refused, and sel and mode keep working without one
    assert.equal((await W.ask("POST", "/api/agent/view", { selection: "TCB( N.a ) or tcb(ns(N) except external)" })).status, 200);
    assert.equal(W.presence.agentView("Claude")?.selection, "tcb(N.a) or tcb(ns(N) except external)");
    const bad = await W.ask("POST", "/api/agent/view", { selection: "tcb(" });
    assert.equal(bad.status, 400);
    assert.match(json(bad).error, /^selection: at /);
    assert.equal((await W.ask("POST", "/api/agent/view", { selection: null, mode: "deps" })).status, 200);
    assert.deepEqual([W.presence.agentView("Claude")?.selection ?? null, W.presence.agentView("Claude")?.mode], [null, "deps"]);
    await W.ask("POST", "/api/agent/view", { leave: true });
    assert.ok(!W.presence.list().some((p) => p.agent));

    // a file changed since it was compiled: no advice on it until it is compiled again
    writeFileSync(join(W.dir, "M.lean"), SOURCE.replace("0", "1"));
    assert.equal(json(await W.ask("GET", "/api/agent/source", { name: "N.z" })).compiled, false);
    assert.equal((await W.ask("POST", "/api/agent/opinion", { name: "N.z", verdict: "approve" })).status, 409);
  } finally {
    W.done();
  }
});

test("what --agents allows, through the API", async () => {
  const R = world("read");
  const A = world("advise");
  try {
    assert.equal((await R.ask("POST", "/api/agent/opinion", { name: "N.z", verdict: "approve" })).status, 403);
    assert.equal((await R.ask("POST", "/api/agent/note", { name: "N.z", text: "x" })).status, 403);
    assert.equal((await R.ask("GET", "/api/agent/declaration", { name: "N.z" })).status, 200, "reading is always allowed");
    assert.equal(json(await R.ask("GET", "/api/agent")).you.may.advise, false);
    assert.equal((await A.ask("POST", "/api/agent/opinion", { name: "N.z", verdict: "approve" })).status, 200);
    assert.equal((await A.ask("POST", "/api/agent/pins", { pins: [{ name: "N.z", at: [1, 2] }] })).status, 403);
    // notes: added at advise, and its own edited, moved and deleted; someone else's at full only
    const added = await A.ask("POST", "/api/agent/note", { name: "N.z", text: "look" });
    assert.equal(added.status, 200);
    assert.equal((await A.ask("POST", "/api/agent/note/edit", { id: json(added).id, text: "look again" })).status, 200);
    A.w.views.arrangeNotes([{ op: "pnote", note: { id: "nBob", text: "Bob's", places: {}, open: true, by: "Bob", at: "" } }], null, "Bob");
    assert.equal((await A.ask("POST", "/api/agent/note/edit", { id: "nBob", text: "again" })).status, 403);
    assert.equal((await A.ask("POST", "/api/agent/note/move", { id: "nBob", ring: 90 })).status, 403);
    assert.equal((await A.ask("POST", "/api/agent/note/delete", { id: "nBob" })).status, 403);
    assert.equal((await A.ask("POST", "/api/agent/note/delete", { id: json(added).id })).status, 200);
    assert.equal((await R.ask("GET", "/api/agent/notes")).status, 200, "reading them is reading");
  } finally {
    R.done();
    A.done();
  }
});

test("an agent's layout is one batch that can be undone; what someone moved since is left", async () => {
  const W = world();
  const pins = () => W.w.places.data.layouts.namespace.nodes;
  try {
    // before: y was pinned by a person, z and a were not
    W.w.places.apply([{ op: "pin", mode: "namespace", kind: "node", key: "N.y", at: [5, 5] }]);
    const r = json(await W.ask("POST", "/api/agent/pins", { pins: [{ name: "N.z", at: [10, 20] }, { name: "N.a", at: [30, 40] }, { name: "N.y", at: [50, 60] }, { name: "N.z", at: [11, 21] }] }));
    assert.equal(r.count, 3, "each declaration once");
    assert.deepEqual(pins()["N.z"], [11, 21]);
    assert.equal(W.changes.length, 1, "every page is told at once");
    const e = W.w.timeline.events.find((x) => x.id === r.id)!;
    assert.equal(e.kind, "layout");
    assert.equal((e as Json).agent, true);

    const place = json(await W.ask("GET", "/api/agent/place", { name: "N.z" }));
    assert.deepEqual(place.pinned, [11, 21]);
    assert.deepEqual(place.parent, { cluster: "N", r: 100, room: 86.8 }, "the parent's room: how far from its centre anything may reach");
    // a place beyond the parent's circle is brought in, as every page would bring it
    const far = json(await W.ask("POST", "/api/agent/pins", { pins: [{ name: "N.d", at: [200, 0] }] }));
    assert.ok(far.placed[0].at[0] < place.room && far.placed[0].at[0] > place.room - 0.5);
    undoBatch(W.api, "Claude", true, far.id);

    // someone moves a afterwards
    W.w.places.apply([{ op: "pin", mode: "namespace", kind: "node", key: "N.a", at: [99, 99] }]);
    const u = await W.ask("POST", "/api/agent/undo", { id: r.id });
    assert.equal(u.status, 200);
    assert.equal(json(u).restored, 2);
    assert.deepEqual(json(u).kept, ["N.a"]);
    assert.equal(pins()["N.z"], undefined, "z had no pin: it is let go");
    assert.deepEqual(pins()["N.y"], [5, 5], "y's pin is put back");
    assert.deepEqual(pins()["N.a"], [99, 99], "a stays where someone moved it");
    const undo = W.w.timeline.events.at(-1)!;
    assert.equal(undo.kind, "undo");
    assert.equal((undo as Json).of, r.id);
    // once only; and a person may undo from the page too (the same handler)
    assert.equal((await W.ask("POST", "/api/agent/undo", { id: r.id })).status, 409);
    const r2 = json(await W.ask("POST", "/api/agent/pins", { pins: [{ name: "N.f", at: [1, 1] }] }));
    assert.equal(undoBatch(W.api, "Alice", false, r2.id).status, 200);
    assert.equal(pins()["N.f"], undefined);
    assert.equal((await W.ask("POST", "/api/agent/undo", { id: 12345 })).status, 404);
    // the activity says what moved and whether it was undone, without the operations
    const act = json(await W.ask("GET", "/api/agent/activity"));
    const lay = act.events.find((x: Json) => x.id === r.id);
    assert.equal(lay.undoneBy, undo.id);
    assert.equal(lay.ops, undefined);
  } finally {
    W.done();
  }
});

test("an agent is here while it works: away after a minute without a request, gone after three", () => {
  const sent: Peer[][] = [];
  const p = new Presence((x) => sent.push(x));
  p.agentBeat("Claude");
  const t0 = Date.now();
  assert.equal(p.list()[0].agent, true);
  assert.equal(p.list()[0].idle, false);
  p.expire(t0 + 40_000);
  assert.equal(p.list().length, 1, "a page would be gone by now; an agent thinks between requests");
  p.expire(t0 + 70_000);
  assert.equal(p.list()[0].idle, true);
  p.agentBeat("Claude");
  assert.equal(p.list()[0].idle, false, "a request wakes it");
  p.expire(Date.now() + 200_000);
  assert.equal(p.list().length, 0);
});

// ---------------------------------------------------------------------------------------------
// What the trial missed (docs/ROADMAP.md, A4 and A5): the context a declaration is written in, what
// it uses and what uses it, what Lean's #print shows, Lean about names the graph folds away, the
// trusted part of a TCB, fewer round trips, and room to lay out.

test("context: the namespaces, variables and opens in force where a declaration is written", async () => {
  const W = world();
  try {
    const y = json(await W.ask("GET", "/api/agent/context", { name: "N.y" }));
    assert.equal(y.compiled, true);
    assert.equal(y.line, 6);
    assert.equal(y.namespace, "N");
    assert.deepEqual(y.blocks, [{ kind: "namespace", name: "N", line: 1 }]);
    assert.deepEqual(y.variables, [{ line: 2, text: "(n : Nat)" }]);
    // `open … in` right before it holds for it alone
    assert.deepEqual(y.opens, [{ line: 5, text: "open Classical", namespaces: [], in: true }]);
    const a = json(await W.ask("GET", "/api/agent/context", { name: "N.a" }));
    assert.deepEqual(a.opens, [], "used up by y");
    assert.deepEqual(a.variables.map((x: Json) => x.text), ["(n : Nat)"]);
    assert.equal((await W.ask("GET", "/api/agent/context", { name: "Ext.E" })).status, 404, "outside the project there is no file");
    // a file changed since it was compiled: read from the present text, and said so
    writeFileSync(join(W.dir, "M.lean"), SOURCE.replace("variable (n : Nat)", "variable (n m : Nat)"));
    const edited = json(await W.ask("GET", "/api/agent/context", { name: "N.y" }));
    assert.equal(edited.compiled, false);
    assert.ok(edited.note);
    assert.equal(edited.variables[0].text, "(n m : Nat)");
  } finally {
    W.done();
  }
});

test("uses and users: each reference by name, where it sits, trusted or not; paged", async () => {
  const W = world();
  try {
    const uses = json(await W.ask("GET", "/api/agent/uses", { name: "N.a" }));
    assert.deepEqual(uses.refs.map((r: Json) => [r.name, r.where]), [["N.d", ["statement"]], ["N.f", ["statement"]], ["N.z", ["body"]]], "statement first, then body; by name");
    assert.deepEqual(uses.counts, { total: 3, statement: 2, body: 1, proof: 0, project: 3, external: 0, trusted: 0 });
    const z = json(await W.ask("GET", "/api/agent/uses", { name: "N.z" }));
    assert.deepEqual(z.refs, [{ name: "Ext.E", kind: "def", module: "Mathlib.X", external: true, where: ["statement"], trusted: true, trustedBy: ["Mathlib"] }]);
    const users = json(await W.ask("GET", "/api/agent/users", { name: "N.z" }));
    assert.deepEqual(users.refs.map((r: Json) => [r.name, r.where]), [["N.y", ["statement"]], ["N.a", ["body"]]], "where the reference sits in each user");
    const t = json(await W.ask("GET", "/api/agent/uses", { name: "N.t", where: "proof" }));
    assert.deepEqual(t.refs.map((r: Json) => r.name), ["N.p"], "only what sits in a proof");
    assert.equal(t.counts.total, 3, "the counts are of every reference");
    const page = json(await W.ask("GET", "/api/agent/uses", { name: "N.a", offset: "1", limit: "1" }));
    assert.deepEqual([page.refs.map((r: Json) => r.name), page.total, page.next], [["N.f"], 3, 2]);
    assert.equal((await W.ask("GET", "/api/agent/uses", { name: "N.a", where: "proofs" })).status, 400);
    // the declaration itself says how many there are
    const a = json(await W.ask("GET", "/api/agent/declaration", { name: "N.a" }));
    assert.deepEqual([a.usesDirect, a.usedBy.direct], [3, 1]);
    // and with the part asked for, both
    const both = json(await W.ask("GET", "/api/agent/declaration", { name: "N.a", include: "uses" }));
    assert.deepEqual([both.usesDirect, both.uses.total], [3, 3]);
  } finally {
    W.done();
  }
});

test("print: what Lean elaborated, proofs left out unless asked, bounded; Lean still loading says so", async () => {
  const W = world();
  try {
    const a = await W.ask("GET", "/api/agent/print", { name: "N.a" });
    assert.equal(a.status, 200);
    assert.deepEqual([json(a).lean, json(a).proofs, json(a).module, json(a).moduleChosen], ["def N.a : Nat :=\n⋯", false, "M", "its own"]);
    const t = json(await W.ask("GET", "/api/agent/print", { name: "N.t", proofs: "1" }));
    assert.equal(W.asked.at(-1)?.proofs, true);
    assert.ok(t.truncated && t.truncated.length > t.truncated.shown && t.lean.length === t.truncated.shown && t.lean.length <= 50_000, "cut short");
    assert.ok(t.lean.endsWith("proof"), "at a line's end");
    const later = await W.ask("GET", "/api/agent/print", { name: "N.p" });
    assert.equal(later.status, 503);
    assert.equal(later.headers?.["retry-after"], "5");
    const nope = await W.ask("GET", "/api/agent/print", { name: "N.zz" });
    assert.equal(nope.status, 404);
    assert.deepEqual(json(nope).didYouMean, ["N.z"]);
    assert.match(json(nope).lean, /Unknown constant/);
    // only a name is ever written into Lean source
    const bad = await W.ask("GET", "/api/agent/print", { name: "N.a\n#eval 1" });
    assert.equal(bad.status, 400);
    assert.equal((await W.ask("GET", "/api/agent/print", { name: "N.a", module: "Nope.Module" })).status, 400, "only a module of the graph is imported");
    assert.ok(!W.asked.some((x) => x.name.includes("#eval") || x.module === "Nope.Module"));
  } finally {
    W.done();
  }
});

test("describe and print take names the graph folds away, asked where the declaration they are under is imported", async () => {
  const W = world();
  try {
    // a constructor or a field is folded into the declaration that owns it: not in the graph
    const mk = json(await W.ask("GET", "/api/agent/describe", { name: "N.a.mk" }));
    assert.deepEqual([mk.module, mk.inGraph], ["M", false]);
    assert.match(mk.moduleChosen, /N\.a, the declaration it is under/);
    const p = json(await W.ask("GET", "/api/agent/print", { name: "N.a.mk.x" }));
    assert.equal(p.module, "M");
    // under nothing of the graph: the project's root module, which imports all of it
    await W.ask("GET", "/api/agent/describe", { name: "Other.thing" });
    assert.deepEqual(W.asked.at(-1), { what: "describe", module: "M", name: "Other.thing" });
    // unknown to Lean: what was meant, the declaration it is under first
    const nope = await W.ask("GET", "/api/agent/describe", { name: "N.a.nope" });
    assert.equal(nope.status, 404);
    assert.equal(json(nope).didYouMean[0], "N.a");
    // a module given is used, when it is one of the project's graph: only those reach Lean
    await W.ask("GET", "/api/agent/describe", { name: "N.a.mk", module: "M" });
    assert.deepEqual(W.asked.at(-1), { what: "describe", module: "M", name: "N.a.mk" });
    const asked = W.asked.length;
    const outside = await W.ask("GET", "/api/agent/describe", { name: "N.a.mk", module: "Mathlib.X" });
    assert.equal(outside.status, 400, "a module of the outside world is not imported on request");
    assert.match(json(outside).error, /not a module of the project's graph/);
    assert.equal((await W.ask("GET", "/api/agent/print", { name: "N.a", module: "_attic.Old" })).status, 400);
    assert.equal(W.asked.length, asked, "Lean was not asked");
    // a declaration of the outside world is asked about where a module of the project imports it
    const ext = json(await W.ask("GET", "/api/agent/describe", { name: "Ext.E" }));
    assert.equal(ext.module, "M");
    assert.match(ext.moduleChosen, /refers to Ext\.E|imports Mathlib\.X/);
  } finally {
    W.done();
  }
});

test("a name folded into a declaration is that declaration: what its command generated, a constructor beneath either, not a typo of a neighbour", async () => {
  const W = world();
  try {
    const a = await W.ask("GET", "/api/agent/declaration", { name: "N.a.Name" });
    assert.equal(a.status, 200);
    assert.deepEqual([json(a).name, json(a).asked, json(a).foldedInto], ["N.a", "N.a.Name", "N.a"]);
    assert.match(json(a).foldedNote, /generated it from the command that writes N\.a/);
    assert.deepEqual(json(a).also, ["N.a.Name", "N.a.instDecidableEqName"]);
    // a constructor of the generated type, a recursor, a constructor of a declaration
    for (const [name, unit] of [["N.a.Name.query", "N.a"], ["N.z.rec", "N.z"], ["N.z.mk", "N.z"], ["N.a.instDecidableEqName", "N.a"]]) {
      const r = await W.ask("GET", "/api/agent/declaration", { name });
      assert.deepEqual([r.status, json(r).name, json(r).foldedInto], [200, unit, unit], name);
    }
    // the declaration's own name says nothing of folding
    assert.equal(json(await W.ask("GET", "/api/agent/declaration", { name: "N.a" })).foldedInto, undefined);
    // a typo of a name beside it is a typo: what was meant
    const typo = await W.ask("GET", "/api/agent/declaration", { name: "N.a.Nme" });
    assert.equal(typo.status, 404);
    assert.ok(json(typo).didYouMean.includes("N.a.Name"));
    assert.equal((await W.ask("GET", "/api/agent/declaration", { name: "N.zz" })).status, 404, "under no declaration");
    // in a list, in the source, in what it uses, in advice: the same
    const many = json(await W.ask("GET", "/api/agent/declarations", { names: "N.a.Name,N.z" }));
    assert.deepEqual(many.declarations.map((d: Json) => [d.name, d.foldedInto]), [["N.a", "N.a"], ["N.z", undefined]]);
    const src = json(await W.ask("GET", "/api/agent/source", { name: "N.a.Name" }));
    assert.deepEqual([src.name, src.foldedInto, src.also], ["N.a", "N.a", ["N.a.Name", "N.a.instDecidableEqName"]]);
    assert.equal(src.context, "namespace N\nvariable (n : Nat)");
    assert.equal(json(await W.ask("GET", "/api/agent/uses", { name: "N.a.Name" })).foldedInto, "N.a");
    const r = json(await W.ask("POST", "/api/agent/opinion", { name: "N.a.Name", verdict: "approve", comment: "the names are right" }));
    assert.deepEqual([r.recorded.name, r.foldedInto], ["N.a", "N.a"]);
    assert.equal(W.review.data.opinions["N.a"].at(-1)?.hash, "h-N.a", "bound to the unit's version");
    // the search finds the unit by the name it folds, and says which
    const found = json(await W.ask("GET", "/api/agent/search", { q: "a.Name" }));
    assert.deepEqual([found.hits[0].name, found.hits[0].via], ["N.a", "N.a.Name"]);
    // Lean is asked about it where the unit is
    const d = json(await W.ask("GET", "/api/agent/describe", { name: "N.a.Name" }));
    assert.match(d.moduleChosen, /that of N\.a, the declaration its command writes/);
  } finally {
    W.done();
  }
});

test("the trusted part of a TCB, as a list: each member with what trusts it", async () => {
  const W = world();
  try {
    const t = json(await W.ask("GET", "/api/agent/tcb", { target: "N.t", include: "trusted" }));
    assert.deepEqual(t.members, [{ position: 1, name: "Ext.E", kind: "def", module: "Mathlib.X", external: true, trusted: true, trustedBy: ["Mathlib"] }]);
    assert.deepEqual(t.trusted, { project: 0, external: 1, byPrefix: { Mathlib: 1 } });
    assert.equal(t.total, 1);
    // a layer of the project trusted by name comes first
    W.review.append({ name: "Alice", agent: false }, { op: "trust", prefix: "N.d", by: "Alice", on: true }, "tc");
    const all = json(await W.ask("GET", "/api/agent/tcb", { target: "N.t", include: "all", limit: "500" }));
    const names = all.members.map((m: Json) => m.name);
    assert.deepEqual(names.slice(-2), ["N.d", "Ext.E"], "the members that need review, then the trusted, the project's first");
    assert.deepEqual(all.members.at(-2).trustedBy, ["N.d"]);
    assert.equal(all.total, all.counts.needReview + 2);
    assert.equal((await W.ask("GET", "/api/agent/tcb", { target: "N.t", include: "trusted", todo: "1" })).status, 400);
    assert.equal((await W.ask("GET", "/api/agent/tcb", { target: "N.t", include: "nothing" })).status, 400);
  } finally {
    W.done();
  }
});

test("fewer round trips: a declaration with its parts, several declarations, several pieces of advice", async () => {
  const W = world();
  try {
    const a = json(await W.ask("GET", "/api/agent/declaration", { name: "N.y", include: "source,context,uses,users,describe,print" }));
    assert.equal(a.name, "N.y");
    assert.equal(a.source.text, "def y : Nat := z");
    assert.equal(a.context.opens[0].in, true);
    assert.deepEqual(a.uses.refs.map((r: Json) => r.name), ["N.z"]);
    assert.deepEqual(a.users.refs.map((r: Json) => r.name), ["N.t", "N.u"]);
    assert.match(a.describe.lean, /N\.y : Nat/);
    assert.match(a.print.lean, /def N\.y/);
    assert.equal(a.failed, undefined);
    // a part that cannot be answered says so, and the rest is there
    const p = json(await W.ask("GET", "/api/agent/declaration", { name: "N.p", include: "print,source" }));
    assert.deepEqual(p.failed, { print: 503, source: 404 });
    assert.equal(p.print.status, 503);
    assert.equal(p.name, "N.p");
    assert.equal((await W.ask("GET", "/api/agent/declaration", { name: "N.y", include: "source,everything" })).status, 400);

    const many = json(await W.ask("GET", "/api/agent/declarations", { names: "N.z, N.zz ,N.a,N.z", include: "uses" }));
    assert.equal(many.count, 3, "each once");
    assert.equal(many.found, 2);
    assert.deepEqual(many.declarations.map((d: Json) => d.name), ["N.z", "N.zz", "N.a"]);
    assert.equal(many.declarations[1].status, 404);
    assert.deepEqual(many.declarations[1].didYouMean, ["N.z"]);
    assert.equal(many.declarations[2].uses.total, 3);
    const tooMany = Array.from({ length: 26 }, (_, k) => `N.x${k}`).join(",");
    assert.equal((await W.ask("GET", "/api/agent/declarations", { names: tooMany })).status, 400);
    assert.equal((await W.ask("GET", "/api/agent/declarations", {})).status, 400);

    // advice in a batch: each item checked as one opinion is, one refused refuses nothing else
    const r = await W.ask("POST", "/api/agent/opinions", {
      opinions: [
        { name: "N.z", verdict: "approve", comment: "0 is the base" },
        { name: "N.y", verdict: "comment" },
        { name: "N.zz", verdict: "approve" },
        { name: "Ext.E", verdict: "approve" },
        { name: "N.a", verdict: "comment", comment: "adds 1 to the base" },
        "not an opinion",
      ],
    });
    assert.equal(r.status, 200);
    const b = json(r);
    assert.deepEqual([b.recorded, b.refused, b.counted], [2, 4, false]);
    assert.deepEqual(b.results.map((x: Json) => x.status), [200, 400, 404, 400, 200, 400]);
    assert.ok(b.results[2].didYouMean, "an unknown name gets what was meant, as alone");
    assert.equal(b.results[0].recorded.hash, "h-N.z");
    assert.equal(W.review.data.opinions["N.a"].at(-1)?.agent, true);
    assert.equal(W.review.data.opinions["N.y"], undefined);
    assert.equal(statusOf(W.review.data, "N.a", "h-N.a"), "none", "advice in a batch is advice");
    assert.equal((await W.ask("POST", "/api/agent/opinions", { opinions: [] })).status, 400);
    assert.equal((await W.ask("POST", "/api/agent/opinions", { opinions: [{ name: "N.z", verdict: "approve" }] }, { name: "Claude", kind: "person" })).status, 400);
    const R = world("read");
    try {
      assert.equal((await R.ask("POST", "/api/agent/opinions", { opinions: [{ name: "N.z", verdict: "approve" }] })).status, 403);
    } finally {
      R.done();
    }
  } finally {
    W.done();
  }
});

test("place: the siblings in the parent, nearest first, each pinned or not and by whom", async () => {
  const W = world();
  try {
    // a person drops y, the agent drops a; d was pinned before the server kept who
    W.w.places.apply([{ op: "pin", mode: "namespace", kind: "node", key: "N.y", at: [12, 0] }], { by: "Alice" });
    await W.ask("POST", "/api/agent/pins", { pins: [{ name: "N.a", at: [30, 0] }] });
    W.w.places.data.layouts.namespace.nodes["N.d"] = [40, 0];
    const p = json(await W.ask("GET", "/api/agent/place", { name: "N.z" }));
    assert.equal(p.r, 5);
    assert.equal(p.siblings.total, 9, "every other declaration in the cluster");
    assert.equal(p.siblings.pinned, 3);
    assert.deepEqual(p.siblings.nearestTo, [30, 0], "z is laid out at (30, 0)");
    const list: Json[] = p.siblings.list;
    assert.deepEqual(list[0], { kind: "node", key: "N.a", declKind: "def", r: 5, at: [30, 0], gap: -10, pinned: true, pinnedBy: { name: "Claude", agent: true, at: list[0].pinnedBy.at }, laidOut: [10, 0] }, "a, pinned on z's place, overlaps it");
    const y = list.find((x) => x.key === "N.y")!;
    assert.deepEqual([y.pinned, y.pinnedBy.name, y.pinnedBy.agent], [true, "Alice", false]);
    const d = list.find((x) => x.key === "N.d")!;
    assert.deepEqual([d.pinned, d.pinnedBy], [true, null], "pinned, by whom not recorded");
    const e = list.find((x) => x.key === "N.e")!;
    assert.deepEqual([e.pinned, e.at, e.gap], [false, [50, 0], 10]);
    // nearest a place the agent has in mind
    const near = json(await W.ask("GET", "/api/agent/place", { name: "N.z", near: "88,0", limit: "2" }));
    assert.deepEqual(near.siblings.list.map((x: Json) => x.key), ["Ext.E", "N.u"]);
    assert.equal(near.siblings.more, 7);
    assert.equal((await W.ask("GET", "/api/agent/place", { name: "N.z", near: "x" })).status, 400);
    // the agent's own pin says it is its own
    const a = json(await W.ask("GET", "/api/agent/place", { name: "N.a", limit: "0" }));
    assert.deepEqual([a.pinned, a.pinnedBy.name, a.siblings.list.length], [[30, 0], "Claude", 0]);
  } finally {
    W.done();
  }
});

test("who dropped a pin is kept across a restart, and forgotten with the pin", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-places-"));
  const project = () => new Views(dir, LAYOUT_VERSION, () => {}).places;
  try {
    const s = project();
    s.apply([{ op: "pin", mode: "namespace", kind: "node", key: "A", at: [1, 2] }], { by: "Alice" });
    s.apply([{ op: "pin", mode: "module", kind: "cluster", key: "M", at: [3, 4] }], { by: "Claude", agent: true });
    s.apply([{ op: "pin", mode: "namespace", kind: "node", key: "B", at: [5, 6] }]);
    const again = project();
    assert.equal(again.authorOf("namespace", "node", "A")?.by, "Alice");
    assert.equal(again.authorOf("module", "cluster", "M")?.agent, true);
    assert.equal(again.authorOf("namespace", "node", "B"), null, "dropped without a name the server knows");
    again.apply([{ op: "unpin", mode: "namespace", kind: "node", key: "A" }]);
    assert.equal(again.authorOf("namespace", "node", "A"), null);
    again.apply([{ op: "clear" }]);
    assert.equal(project().authorOf("module", "cluster", "M"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the answer to a view says what people who follow the agent see: a target's view, which only a target has, focused on it", async () => {
  const W = world();
  try {
    const r = json(await W.ask("POST", "/api/agent/view", { review: "N.t", sel: "N.a", source: true }));
    assert.deepEqual(r.reviewView, ["N.t"]);
    assert.match(r.followersSee, /^the view "TCB of N\.t", N\.t's view, the review focused on N\.t.*looking at N\.a with its source open\.$/);
    const n = await W.ask("POST", "/api/agent/view", { review: "N.a" });
    assert.equal(n.status, 400);
    assert.match(json(n).error as string, /N\.a is not a target/);
    const none = json(await W.ask("POST", "/api/agent/view", { review: null, sel: null }));
    assert.equal(none.reviewView, null);
    assert.match(none.followersSee, /^the Project view/);
  } finally {
    W.done();
  }
});

test("key declarations through the API: read by agents, written at level full as an agent's; no explanation anywhere", async () => {
  const W = world();
  try {
    const alice = { name: "Alice", agent: false };
    W.review.append(alice, { op: "key", target: "N.t", name: "N.a", by: "Alice", on: true }, "tc");
    W.review.append(alice, { op: "key", target: "N.t", name: "N.y", by: "Alice", on: true }, "tc");
    // an explanation written before the owner removed them (2026-10-08) stays in Alice's log:
    // skipped, and Alice writes on
    appendFileSync(join(W.review.logDir, logFileName("Alice", false)), JSON.stringify({ op: "explain", at: at(9), by: "Alice", name: "N.a", text: "The scheme, as in *Definition 3*.", hash: "h-N.a" }) + "\n");
    assert.ok("change" in W.review.append(alice, { op: "opinion", name: "N.a", by: "Alice", verdict: "approve", hash: "h-N.a" }, "tc"));
    assert.deepEqual(W.review.problems, []);
    // the key graph: the target on top, each key declaration with its support by status
    const k = json(await W.ask("GET", "/api/agent/keys", { target: "N.t" }));
    // within a layer, what comes later in review order first: N.y, which N.u shares, comes early
    assert.deepEqual(k.keys.map((x: Json) => x.name), ["N.t", "N.a", "N.y"]);
    assert.equal(k.keys[0].target, true);
    const a = k.keys.find((x: Json) => x.name === "N.a");
    assert.equal(a.markedBy, "Alice");
    // what a key declaration is, is its docstring (N.a has none)
    assert.equal(a.doc, null);
    assert.deepEqual(a.support.members.sort(), ["N.d", "N.e", "N.f", "N.z"]);
    assert.equal(a.support.total, 4);
    assert.deepEqual(k.keys.find((x: Json) => x.name === "N.y").support.members, ["N.z"]);
    assert.deepEqual(k.edges.map((e: string[]) => e.join(">")).sort(), ["N.t>N.a", "N.t>N.y"]);
    assert.deepEqual(k.counts.key, { total: 3, approved: 1, commented: 0, stale: 0, unreviewed: 2, trusted: 0 });
    assert.equal(json(await W.ask("GET", "/api/agent/keys", { target: "N.t", members: "0" })).keys[1].support.members, undefined);
    assert.deepEqual(k.keys[0].restsOn, ["N.a", "N.y"]);
    // the TCB: members carry key, counts the key level; key=first and key=only
    const t = json(await W.ask("GET", "/api/agent/tcb", { target: "N.t", limit: "50" }));
    assert.deepEqual(t.members.filter((m: Json) => m.key).map((m: Json) => m.name).sort(), ["N.a", "N.t", "N.y"]);
    assert.deepEqual(t.counts.key, { total: 3, approved: 1, commented: 0, stale: 0, unreviewed: 2, trusted: 0 });
    const first = json(await W.ask("GET", "/api/agent/tcb", { target: "N.t", key: "first" }));
    assert.deepEqual(first.members.slice(0, 3).map((m: Json) => m.key), [true, true, true]);
    assert.deepEqual(json(await W.ask("GET", "/api/agent/tcb", { target: "N.t", key: "only" })).members.length, 3);
    assert.equal((await W.ask("GET", "/api/agent/tcb", { target: "N.t", key: "most" })).status, 400);
    assert.equal(json(await W.ask("GET", "/api/agent/targets")).targets[0].counts.key.total, 3);
    // a declaration says what it is key for
    const d = json(await W.ask("GET", "/api/agent/declaration", { name: "N.a" }));
    assert.deepEqual(d.keyFor, ["N.t"]);
    // a trusted member of the TCB may be key (the owner's decision of 2026-10-19): Mathlib's Ext.E,
    // read with the others, counted apart, never in need of review; a proof's helper may not
    assert.equal((await W.ask("POST", "/api/agent/key", { target: "N.t", name: "Ext.E", on: true })).status, 200);
    assert.equal((await W.ask("POST", "/api/agent/key", { target: "N.t", name: "N.p", on: true })).status, 409);
    const tk = json(await W.ask("GET", "/api/agent/keys", { target: "N.t" }));
    const e = tk.keys.find((x: Json) => x.name === "Ext.E");
    assert.deepEqual([e.trusted, e.trustedBy, "status" in e, e.markedByAgent], [true, ["Mathlib"], false, true]);
    assert.deepEqual(tk.counts.key, { total: 3, approved: 1, commented: 0, stale: 0, unreviewed: 2, trusted: 1 });
    assert.deepEqual(tk.edges.map((x: string[]) => x.join(">")).sort(), ["N.a>Ext.E", "N.t>N.a", "N.t>N.y", "N.y>Ext.E"]);
    const only = json(await W.ask("GET", "/api/agent/tcb", { target: "N.t", key: "only" }));
    // the trusted first, then in review order (N.y, which N.u shares too, before N.a), the target last
    assert.deepEqual(only.members.map((m: Json) => [m.name, !!m.key, !!m.trusted]), [["Ext.E", true, true], ["N.y", true, false], ["N.a", true, false], ["N.t", true, false]]);
    assert.deepEqual(only.members[0].trustedBy, ["Mathlib"]);
    assert.equal(json(await W.ask("GET", "/api/agent/tcb", { target: "N.t", include: "trusted" })).members.find((m: Json) => m.name === "Ext.E").key, true);
    assert.equal((await W.ask("GET", "/api/agent/tcb", { target: "N.t", include: "trusted", key: "first" })).status, 400);
    assert.equal(json(await W.ask("GET", "/api/agent/targets")).targets[0].counts.key.trusted, 1);
    assert.equal((await W.ask("POST", "/api/agent/key", { target: "N.t", name: "Ext.E", on: false })).status, 200);
    // agents read them, and at level full mark them too, as theirs (AgentSpec decision 9)
    assert.equal((await W.ask("POST", "/api/agent/key", { target: "N.t", name: "N.z", on: true })).status, 200);
    const activity = json(await W.ask("GET", "/api/agent/activity"));
    assert.ok(activity.events.some((e: Json) => e.kind === "key" && e.name === "N.a" && e.target === "N.t" && e.agent === false));
    assert.ok(activity.events.some((e: Json) => e.kind === "key" && e.name === "N.z" && e.by === "Claude" && e.agent === true));
    // no explanation anywhere (removed 2026-10-08): not in what a declaration or a key declaration
    // says, nor in the timeline, nor among the endpoints; the docstring says what it is
    const z = json(await W.ask("GET", "/api/agent/declarations", { names: "N.a,N.z", include: "source" }));
    const keys = json(await W.ask("GET", "/api/agent/keys", { target: "N.t" }));
    assert.equal(keys.keys.find((x: Json) => x.name === "N.z").doc, "The base.");
    const index = json(await W.ask("GET", "/api/agent"));
    for (const [what, body] of Object.entries({ declaration: d, declarations: z, keys, activity, index })) assert.doesNotMatch(JSON.stringify(body), /explanation|Definition 3/i, what);
    assert.ok(!activity.events.some((e: Json) => e.kind === "explain"));
    assert.ok(!json(await W.ask("GET", "/api/agent/endpoints")).endpoints.some((e: Json) => e.path === "/api/agent/explain"));
    assert.equal((await W.ask("POST", "/api/agent/explain", { name: "N.z", text: "The base." })).status, 404);
  } finally {
    W.done();
  }
});
