// What the review records, as the server binds it (server/reviewapi.ts): the declaration's hash and
// the text judged are the server's, names are the graph's. A target's review is what its Review
// view holds (shared/reviewqueue.ts), non-standard axioms included, and the page shows a change of
// it on the board at once (web/src/views.ts, viewnav.ts).

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { boardSet } from "../src/shared/board.ts";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { parseQuery, printQuery, reviewScope } from "../src/shared/query.ts";
import { emptyReview, logFileName, record, statusOf } from "../src/shared/review.ts";
import type { ReviewData } from "../src/shared/review.ts";
import { inTargets, offBoard, queueProgress, reviewQueue, settled } from "../src/shared/reviewqueue.ts";
import type { NewEvent } from "../src/shared/timeline.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { ViewBook } from "../src/shared/views.ts";
import { ReviewStore } from "../src/server/review.ts";
import { ReviewApi } from "../src/server/reviewapi.ts";
import type { GraphView } from "../src/server/reviewapi.ts";
import { lakeTextHash } from "../src/server/status.ts";

const SOURCE = ["namespace N", "def z : Nat := 0", "", "/-- The a. -/", "def a : Nat :=", "  z + 1", "end N"].join("\n");

/** Target N.t: its statement uses N.a and N.y; its proof uses N.p, whose proof uses `sorry`
 *  (sorryAx, which Init would trust as a prefix). N.a uses N.z (body), Mathlib's E and another
 *  library's O.f; N.y uses toString, constructor and __proto__ (declarations of the project, named
 *  so), and rests on Lean.ofReduceBool, an axiom the graph has no declaration for. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "vp-reviewapi-"));
  writeFileSync(join(dir, "M.lean"), SOURCE);
  const own = ["N.t", "N.a", "N.z", "N.y", "N.p", "toString", "constructor", "__proto__"];
  const ax: Record<string, number> = { "N.t": 3, "N.p": 1, "N.y": 2, sorryAx: 1 };
  const nodes: ViewNode[] = own.map((name) => ({
    name,
    kind: name === "N.t" || name === "N.p" ? "theorem" : "def",
    module: "M",
    ax: ax[name] ?? 0,
    hash: `h-${name}`,
    type: `T ${name}`,
    ...(name === "N.a" ? { range: [5, 0, 6, 7] as [number, number, number, number] } : name === "N.z" ? { range: [2, 0, 2, 16] as [number, number, number, number] } : {}),
  }));
  nodes.push({ name: "Ext.E", kind: "def", module: "Mathlib.X", ax: 0, ext: true });
  nodes.push({ name: "O.f", kind: "def", module: "Other.Y", ax: 0, ext: true });
  nodes.push({ name: "sorryAx", kind: "axiom", module: "Init.Prelude", ax: 1, ext: true });
  const at = (n: string) => nodes.findIndex((v) => v.name === n);
  const edges: number[] = [];
  const use = (u: string, v: string, site: number) => edges.push(at(u), at(v), site);
  use("N.t", "N.a", SITE_STMT);
  use("N.t", "N.y", SITE_STMT);
  use("N.t", "N.p", SITE_PROOF);
  use("N.p", "sorryAx", SITE_PROOF);
  use("N.a", "N.z", SITE_BODY);
  use("N.a", "Ext.E", SITE_STMT);
  use("N.a", "O.f", SITE_STMT);
  for (const n of ["toString", "constructor", "__proto__"]) use("N.y", n, SITE_STMT);
  const meta = {
    schema: 1,
    project: { name: "fixture", root: dir, roots: ["M"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [{ name: "M", file: "M.lean", imports: [], compiled: lakeTextHash(SOURCE) }],
    nodes,
    projectCount: own.length,
    axioms: ["propext", "sorryAx", "Lean.ofReduceBool"],
    axiomSets: [[0], [1], [2], [0, 1, 2]],
    layouts: {},
    edgeCount: edges.length / 3,
  } as unknown as ViewMeta;
  const g = new Graph(meta, new Int32Array(edges));
  const view: GraphView = { g, meta, modules: new Map([["M", { file: "M.lean", compiled: lakeTextHash(SOURCE) }]]) };
  const review = new ReviewStore(dir, "review");
  const events: NewEvent[] = [];
  let graph: GraphView | null = view;
  const api = new ReviewApi(
    { project: { root: dir, files: new Map([["M", "M.lean"]]), toolchain: "tc" }, review, timeline: { add: (e) => (events.push(e), { ...e, id: events.length, at: "" }) as never } },
    () => graph,
  );
  const post = (body: unknown, me = "Alice") => api.post(body, { name: me, agent: false }) as { status: number; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const lastLine = (who: string) => JSON.parse(readFileSync(join(dir, "review", "log", logFileName(who, false)), "utf8").trim().split("\n").at(-1)!);
  return { dir, g, view, review, api, post, events, lastLine, noGraph: () => (graph = null), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the server binds what an opinion is about; the request says only what the reader decides", () => {
  const W = world();
  try {
    // whatever hash and text a page sends, the graph's and the compiled file's are recorded
    const r = W.post({ op: "opinion", name: "N.a", verdict: "approve", hash: "forged", text: "forged", statement: "forged", by: "Mallory", agent: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const e = W.lastLine("Alice");
    assert.deepEqual([e.by, e.hash, e.text, e.statement, e.agent], ["Alice", "h-N.a", "namespace N\n\n/-- The a. -/\ndef a : Nat :=\n  z + 1", undefined, undefined]);
    assert.ok(r.body.change.events.length === 1, "the answer carries the change, for the page to apply at once");
    // no range: the statement the graph holds
    assert.equal(W.post({ op: "opinion", name: "N.y", verdict: "approve" }).status, 200);
    assert.equal(W.lastLine("Alice").statement, "T N.y");
    // a name that is not a declaration of the graph
    assert.equal(W.post({ op: "opinion", name: "N.nope", verdict: "approve" }).status, 404);
    assert.equal(W.post({ op: "opinion", name: "propext", verdict: "approve" }).status, 404, "a standard axiom the graph does not hold");
    // the outside world's declarations have no version: bound to the name alone
    assert.equal(W.post({ op: "opinion", name: "O.f", verdict: "approve" }).status, 200);
    assert.equal(W.lastLine("Alice").hash, undefined);
    // an axiom the target rests on that the graph has no declaration for: by its name
    assert.equal(W.post({ op: "opinion", name: "Lean.ofReduceBool", verdict: "comment", comment: "native_decide" }).status, 200);
    assert.equal(statusOf(W.review.data, "Lean.ofReduceBool", undefined), "commented");
    // what is asked is checked
    assert.equal(W.post({ op: "opinion", name: "N.z", verdict: "comment" }).status, 400, "a comment needs text");
    assert.equal(W.post({ op: "opinion", name: "N.z", verdict: "maybe" }).status, 400);
    // "dispute" is a comment's old name (2026-10-09): refused, the answer naming the new one, and
    // nothing written
    const before = readFileSync(join(W.dir, "review", "log", logFileName("Alice", false)), "utf8");
    const old = W.post({ op: "opinion", name: "N.z", verdict: "dispute", comment: "z should be 1" });
    assert.equal(old.status, 400);
    assert.match(old.body.error, /approve or comment/);
    assert.match(old.body.hint, /use comment/i);
    assert.equal(readFileSync(join(W.dir, "review", "log", logFileName("Alice", false)), "utf8"), before);
    assert.equal(W.post({ op: "opinion", name: "N.z", verdict: "approve", comment: 3 }).status, 400);
    assert.equal(W.post([1, 2]).status, 400);
    assert.equal(W.post(null).status, 400);
    assert.equal(W.post({ op: "delete-everything" }).status, 400);
    // a file changed since it was compiled: what the reader sees is not what the hash is about
    writeFileSync(join(W.dir, "M.lean"), SOURCE.replace("z + 1", "z + 2"));
    const edited = W.post({ op: "opinion", name: "N.a", verdict: "approve" });
    assert.equal(edited.status, 409);
    assert.match(edited.body.error, /changed since it was compiled/);
    writeFileSync(join(W.dir, "M.lean"), SOURCE);
    // the graph not read yet: try again
    W.noGraph();
    assert.equal(W.post({ op: "opinion", name: "N.a", verdict: "approve" }).status, 503);
  } finally {
    W.done();
  }
});

test("targets are the project's declarations; a checkpoint is no longer recorded; trust as before", () => {
  const W = world();
  try {
    assert.equal(W.post({ op: "target", name: "N.t", on: true }).status, 200);
    assert.equal(W.post({ op: "target", name: "Ext.E", on: true }).status, 404, "not the outside world's");
    assert.equal(W.post({ op: "target", name: "N.nope", on: true }).status, 404);
    assert.equal(W.post({ op: "target", name: "N.t", on: "yes" }).status, 400);
    // a target no longer in the graph can still be taken off; the timeline says who did
    W.review.append({ name: "Bob", agent: false }, { op: "target", name: "Gone.t", by: "Bob", on: true }, "tc");
    assert.equal(W.post({ op: "target", name: "Gone.t", on: false }).status, 200);
    assert.deepEqual(W.events.at(-1), { kind: "untarget", by: "Alice", name: "Gone.t" });
    // checkpoints were removed by the owner (2026-10-09): refused, and nothing written
    const before = readFileSync(join(W.dir, "review", "log", logFileName("Alice", false)), "utf8");
    const c = W.post({ op: "checkpoint", name: "N.t" });
    assert.equal(c.status, 400);
    assert.match(c.body.error, /op is opinion, target, trust or key/);
    assert.equal(readFileSync(join(W.dir, "review", "log", logFileName("Alice", false)), "utf8"), before);
    assert.deepEqual(Object.keys(W.review.data.targets["N.t"]).sort(), ["at", "by"]);
    // trust: a dotted prefix, the timeline told when it changes something
    assert.equal(W.post({ op: "trust", prefix: "Tau Ceti", on: true }).status, 400);
    assert.equal(W.post({ op: "trust", prefix: "Other", on: true }).status, 200);
    assert.deepEqual(W.events.at(-1), { kind: "trust", by: "Alice", prefix: "Other" });
    const n = W.events.length;
    assert.deepEqual(W.post({ op: "trust", prefix: "Other", on: true }).body, { ok: true, change: null }, "so already: nothing appended");
    assert.equal(W.events.length, n);
    // names an object has already: declarations like any
    for (const name of ["toString", "constructor", "__proto__"]) {
      assert.equal(W.post({ op: "opinion", name, verdict: "approve" }).status, 200, name);
      assert.equal(statusOf(W.review.data, name, `h-${name}`), "approved", name);
    }
    assert.equal(W.post({ op: "target", name: "constructor", on: true }).status, 200);
    assert.ok(Object.hasOwn(W.review.data.targets, "constructor"));
  } finally {
    W.done();
  }
});

test("a board of a target's review set and its queue hold the same: the untrusted outside world in, what is trusted out, the target too", () => {
  const W = world();
  try {
    const g = W.g;
    const T = g.byName.get("N.t")!;
    const check = (d: ReviewData, why: string) => {
      const board = boardSet(g, d, reviewScope("N.t"));
      const q = reviewQueue(g, d, T, inTargets(g, [T]));
      const onBoard = g.nodes.filter((_, i) => board.set[i]).map((v) => v.name).sort();
      assert.deepEqual(q.order.map((i) => g.nodes[i].name).sort(), onBoard, why);
      // what the strip, the panel, the Targets list and the agents count: the board, and the
      // axioms it cannot hold
      assert.equal(queueProgress(g, d, q).total, onBoard.length + offBoard(q).length, why);
      return onBoard;
    };
    const d = emptyReview();
    assert.deepEqual(check(d, "by default"), ["N.a", "N.t", "N.y", "N.z", "O.f", "__proto__", "constructor", "sorryAx", "toString"]);
    record(d, { op: "trust", prefix: "Other", by: "Alice", on: true }, "tc", "2026-10-08T10:00:00Z");
    assert.ok(!check(d, "the other library trusted").includes("O.f"));
    record(d, { op: "trust", prefix: "N", by: "Alice", on: true }, "tc", "2026-10-08T10:00:01Z");
    assert.deepEqual(check(d, "the project's namespace trusted"), ["__proto__", "constructor", "sorryAx", "toString"]);
    record(d, { op: "trust", prefix: "@external", by: "Alice", on: true }, "tc", "2026-10-08T10:00:02Z");
    assert.ok(check(d, "the whole outside world trusted").includes("sorryAx"), "a non-standard axiom is never trusted");
    // the text of the scope, as such a board shows it, holds the same
    assert.equal(printQuery(reviewScope("N.t")), "tcb(N.t) except trusted or (uses(N.t) and kind(axiom) and nonstandard)");
    assert.deepEqual(boardSet(g, d, parseQuery(printQuery(reviewScope("N.t")))).set, boardSet(g, d, reviewScope("N.t")).set);
  } finally {
    W.done();
  }
});

test("non-standard axioms a target rests on, through proofs too, are counted; All reviewed waits for them to be approved", () => {
  const W = world();
  try {
    const g = W.g;
    const T = g.byName.get("N.t")!;
    const d = emptyReview();
    const q = reviewQueue(g, d, T, inTargets(g, [T]));
    // sorryAx comes in through the proof of N.p, which the TCB does not follow; first in the queue
    assert.equal(g.nodes[q.order[0]].name, "sorryAx");
    assert.deepEqual(q.axioms.map((a) => [a.name, a.node === null ? null : g.nodes[a.node].name, a.via.map((j) => g.nodes[j].name)]), [
      ["Lean.ofReduceBool", null, ["N.y"]],
      ["sorryAx", "sorryAx", ["N.p"]],
    ]);
    assert.deepEqual(queueProgress(g, d, q), { total: 10, approved: 0, commented: 0, stale: 0 });
    // a reader who comments on sorryAx has reviewed it, and is still not done: it is not approved
    let k = 0;
    const say = (name: string, by: string, verdict: "approve" | "comment") =>
      record(d, { op: "opinion", name, by, verdict, ...(verdict === "comment" ? { comment: "sorry" } : {}) }, "tc", `2026-10-08T10:00:${String(k++).padStart(2, "0")}Z`);
    say("sorryAx", "Alice", "comment");
    assert.equal(settled(d, "Alice", "sorryAx", undefined, true), false);
    assert.equal(settled(d, "Alice", "N.z", "h-N.z", false), false);
    say("N.z", "Alice", "comment");
    assert.equal(settled(d, "Alice", "N.z", "h-N.z", false), true, "a declaration is done with once the reader gave an opinion");
    say("sorryAx", "Bob", "approve");
    assert.equal(settled(d, "Alice", "sorryAx", undefined, true), false, "Alice's word on it is still a comment: not approved");
    say("sorryAx", "Alice", "approve");
    assert.equal(settled(d, "Alice", "sorryAx", undefined, true), true);
    // the axiom the board cannot hold counts as the rest do
    say("Lean.ofReduceBool", "Alice", "approve");
    assert.equal(queueProgress(g, d, q).approved, 2);
  } finally {
    W.done();
  }
});

test("the page: a review change that changes a board's set draws it again at once, also when it comes twice", async () => {
  const W = world();
  try {
    const { Views } = await import("../src/web/src/views.ts");
    const { ViewNav } = await import("../src/web/src/viewnav.ts");
    const { Store } = await import("../src/web/src/store.ts");
    const g = W.g;
    let d = emptyReview();
    const book = new ViewBook();
    // a board of what is not yet reviewed in the TCB
    const rec = book.open(parseQuery("tcb(N.t) and status(unreviewed)"), null).view;
    // the layout's memory is handed over a moment later, as from the server
    const api = {
      list: async () => [],
      get: async () => ({ view: rec, memory: {} }),
      memory: async () => null,
      post: async () => (await new Promise((ok) => setTimeout(ok, 5)), { accepted: true }),
    };
    const views = new Views(api as never, { graph: () => g, meta: () => g.meta, review: () => d });
    const shown: string[][] = [];
    const nav = new ViewNav(views, new Store("/nowhere"), {
      show: (b) => shown.push(b.graph.nodes.map((v) => v.name).sort()),
      place: () => {},
      here: () => ({ cam: null, mode: "plain", picks: null, shown: null }),
      changed: () => {},
    });
    assert.equal(await nav.show(rec.id), true);
    assert.ok(shown.at(-1)!.includes("N.z"));
    // N.z approved: the page is told twice (the answer to its request, and the event every page
    // gets) — the board follows once, and is drawn
    d = emptyReview();
    record(d, { op: "opinion", name: "N.z", by: "Alice", verdict: "approve", hash: "h-N.z" }, "tc", "2026-10-08T10:00:00Z");
    const first = views.reviewChanged();
    assert.deepEqual(first, [rec.id]);
    const redraw = nav.redraw();
    const b = views.board(rec.id);
    assert.deepEqual(views.reviewChanged(), [], "the same set: the same board");
    assert.equal(views.board(rec.id), b);
    await redraw;
    assert.ok(!shown.at(-1)!.includes("N.z"), "the approved declaration left the board");
    // another change while the board is being laid out: the latest is drawn, never none
    record(d, { op: "opinion", name: "N.a", by: "Alice", verdict: "approve", hash: "h-N.a" }, "tc", "2026-10-08T10:00:01Z");
    views.reviewChanged();
    const one = nav.redraw();
    record(d, { op: "opinion", name: "N.y", by: "Alice", verdict: "approve", hash: "h-N.y" }, "tc", "2026-10-08T10:00:02Z");
    views.reviewChanged();
    await Promise.all([one, nav.redraw()]);
    assert.ok(!shown.at(-1)!.includes("N.a") && !shown.at(-1)!.includes("N.y"));
    assert.equal(nav.board, views.board(rec.id));
  } finally {
    W.done();
  }
});
