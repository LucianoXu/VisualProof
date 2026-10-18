// Key declarations (ExportSpec decisions 1, 3 and 4): their events and replay, what the server
// binds, what the page's review of a declaration shows (no explanation since 2026-10-08), the
// support and the key graph (shared/keys.ts) on small graphs with diamonds and cycles, the review
// set listed key first, `key(T)` in the query language, and what the agents' API says of them.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { keyFirst, keyGraph, keyLayers, keySet, statusCounts, topDown } from "../src/shared/keys.ts";
import { evaluate, parseQuery, printQuery, QUERY_LIMITS, readsReview } from "../src/shared/query.ts";
import { emptyReview, invalid, keyFor, keyMarked, keyMarks, logFileName, noChange, readEvent, record, replay, reviewFromJson } from "../src/shared/review.ts";
import type { ReviewData, ReviewEvent, ReviewOp, ReviewRequest } from "../src/shared/review.ts";
import { inTargets, reviewQueue, reviewSet } from "../src/shared/reviewqueue.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { ReviewStore } from "../src/server/review.ts";
import { ReviewApi } from "../src/server/reviewapi.ts";
import type { GraphView } from "../src/server/reviewapi.ts";
import { ReviewBox } from "../src/web/src/reviewbox.ts";
import type { ReviewHooks } from "../src/web/src/reviewbox.ts";

const at = (k: number) => `2026-10-08T10:${String(k).padStart(2, "0")}:00.000Z`;

/** A graph from edges written `a>b` (statement), `a=b` (body), `a~b` (proof); every name a
 *  declaration of the project, `X.*` outside it. */
function graph(spec: string[], kinds: Record<string, string> = {}): Graph {
  const names = new Set<string>();
  for (const e of spec) for (const n of e.split(/[>=~]/)) names.add(n);
  const own = [...names].filter((n) => !n.startsWith("X."));
  const ext = [...names].filter((n) => n.startsWith("X."));
  const order = [...own, ...ext];
  const index = new Map(order.map((n, i) => [n, i]));
  const nodes: ViewNode[] = order.map((name) => ({
    name,
    kind: (kinds[name] ?? (name === "T" ? "theorem" : "def")) as ViewNode["kind"],
    module: name.startsWith("X.") ? "Mathlib.X" : "M",
    ax: kinds[name] === "axiom" ? 1 : 0,
    hash: `h-${name}`,
    ...(name.startsWith("X.") ? { ext: true as const } : {}),
  }));
  const edges: number[] = [];
  for (const e of spec) {
    const m = /^(.+?)([>=~])(.+)$/.exec(e);
    if (!m) continue;
    edges.push(index.get(m[1])!, index.get(m[3])!, m[2] === ">" ? SITE_STMT : m[2] === "=" ? SITE_BODY : SITE_PROOF);
  }
  const meta = { nodes, projectCount: own.length, axioms: ["propext", "Fake.ax"], axiomSets: [[0], [1]], layouts: {}, edgeCount: edges.length / 3 } as unknown as ViewMeta;
  return new Graph(meta, new Int32Array(edges));
}

/** A review with T a target and `keys` marked key for it. */
function reviewWith(keys: string[]): ReviewData {
  const d = emptyReview();
  record(d, { op: "target", name: "T", by: "Alice", on: true }, "tc", at(0));
  keys.forEach((k, j) => record(d, { op: "key", target: "T", name: k, by: "Alice", on: true }, "tc", at(j + 1)));
  return d;
}

function analyse(g: Graph, d: ReviewData) {
  const root = g.byName.get("T")!;
  const q = reviewQueue(g, d, root, inTargets(g, [root]));
  const kg = keyGraph(g, d, root, q.order);
  const nm = (i: number) => g.nodes[i].name;
  const keyNames = kg.keys.map(nm);
  const supportOf = (k: string) => kg.support[keyNames.indexOf(k)].map(nm).sort();
  const supportersOf = (x: string) => (kg.supporters.get(g.byName.get(x)!) ?? []).map((j) => keyNames[j]).sort();
  const edges = kg.edges.map(([a, b]) => `${keyNames[a]}>${keyNames[b]}`).sort();
  return { root, q, kg, keyNames, supportOf, supportersOf, edges };
}

// ------------------------------------------------------------------- events and replay

test("key marks are events of the logs, replayed like the rest", () => {
  const d = emptyReview();
  const events: ReviewEvent[] = [];
  const rec = (r: ReviewOp, k: number) => events.push(record(d, r, "tc", at(k)));
  rec({ op: "target", name: "T", by: "Alice", on: true }, 1);
  rec({ op: "key", target: "T", name: "G", by: "Alice", on: true }, 2);
  rec({ op: "key", target: "T", name: "S", by: "Bob", on: true }, 3);
  // marked again by someone else: the first mark stands, with who made it
  rec({ op: "key", target: "T", name: "G", by: "Bob", on: true }, 4);
  assert.deepEqual(keyMarks(d, "T"), ["G", "S"]);
  assert.equal(d.keys.T.G.by, "Alice");
  rec({ op: "key", target: "T", name: "S", by: "Alice", on: false }, 5);
  assert.deepEqual(keyMarks(d, "T"), ["G"]);
  assert.equal(keyMarked(d, "T", "S"), false);
  // one declaration key for two targets
  rec({ op: "key", target: "U", name: "G", by: "Bob", on: true }, 6);
  assert.deepEqual(keyFor(d, "G"), ["T", "U"]);
  // the last mark of a target taken off leaves nothing of it
  rec({ op: "key", target: "U", name: "G", by: "Bob", on: false }, 7);
  assert.equal(Object.hasOwn(d.keys, "U"), false);

  // the logs replayed give the same review, in any order of files; JSON carries it whole
  const alice = events.filter((e) => e.by === "Alice");
  const bob = events.filter((e) => e.by === "Bob");
  for (const logs of [[{ file: "a.jsonl", events: alice }, { file: "b.jsonl", events: bob }], [{ file: "b.jsonl", events: bob }, { file: "a.jsonl", events: alice }]]) {
    const again = replay(logs);
    assert.deepEqual(JSON.parse(JSON.stringify(again.keys)), JSON.parse(JSON.stringify(d.keys)));
  }
  const back = reviewFromJson(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(keyMarks(back, "T"), ["G"]);
  assert.equal(Object.getPrototypeOf(back.keys), null);
  assert.equal(Object.getPrototypeOf(back.keys.T), null);
  // every line reads back as it was written
  for (const e of events) assert.deepEqual(readEvent(JSON.parse(JSON.stringify(e)), false), e);
});

test("a key mark is checked: sizes and kinds, for people and agents alike", () => {
  const key = { op: "key", target: "T", name: "G", by: "A", on: true };
  assert.equal(invalid(key), null);
  assert.equal(invalid({ ...key, target: "" }), "target");
  assert.equal(invalid({ ...key, target: "x".repeat(2001) }), "target");
  assert.equal(invalid({ ...key, on: "yes" }), "on");
  assert.match(invalid({ ...key, name: "T" }) ?? "", /always key/);
  assert.equal(invalid({ ...key, agent: true }), null, "an agent's at level full (AgentSpec decision 9)");
  // an explanation is no longer recorded (removed by the owner, 2026-10-08)
  assert.equal(invalid({ op: "explain", name: "G", by: "A", text: "x" }), "op");
  // a line of a log is read with the same bounds; every line of an agent's log is marked as an
  // agent's, and is read back as one
  assert.equal(readEvent({ op: "key", at: at(1), by: "A", target: "T", name: "G", on: true }, true), "a line of an agent's log not marked as an agent's");
  assert.deepEqual(readEvent({ op: "key", at: at(1), by: "A", target: "T", name: "G", on: true, agent: true }, true), { op: "key", at: at(1), by: "A", target: "T", name: "G", on: true, agent: true });
  assert.equal(readEvent({ op: "key", at: at(1), by: "A", name: "G", on: true }, false), "target");
  // what changes nothing appends nothing
  const d = reviewWith(["G"]);
  assert.equal(noChange(d, { op: "key", target: "T", name: "G", by: "B", on: true }), true);
  assert.equal(noChange(d, { op: "key", target: "T", name: "H", by: "B", on: false }), true);
  assert.equal(noChange(d, { op: "key", target: "T", name: "H", by: "B", on: true }), false);
});

test("the server binds a key mark to a target's review, and records no explanation", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-keys-"));
  try {
    // T's statement uses G; G's body uses S; T's proof uses P; X.m is outside the project
    const g = graph(["T>G", "G=S", "T~P", "G>X.m"]);
    const meta = g.meta;
    const view: GraphView = { g, meta, modules: new Map([["M", { file: null, compiled: null }]]) };
    const review = new ReviewStore(dir, "review");
    const api = new ReviewApi({ project: { root: dir, files: new Map(), toolchain: "tc" }, review, timeline: { add: (e) => ({ ...e, id: 1, at: "" }) as never } }, () => view);
    const post = (body: unknown, me = "Alice") => api.post(body, { name: me, agent: false }) as { status: number; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(post({ op: "key", target: "T", name: "G", on: true }).status, 409, "T is not a target yet");
    assert.equal(post({ op: "target", name: "T", on: true }).status, 200);
    assert.equal(post({ op: "key", target: "T", name: "G", on: true }).status, 200);
    assert.equal(post({ op: "key", target: "T", name: "S", on: true }, "Bob").status, 200);
    assert.equal(post({ op: "key", target: "T", name: "P", on: true }).status, 409, "a proof's helper is not in the review");
    assert.equal(post({ op: "key", target: "T", name: "X.m", on: true }).status, 409, "the outside world trusted by default is not in it");
    assert.equal(post({ op: "key", target: "T", name: "Nope", on: true }).status, 404);
    assert.equal(post({ op: "key", target: "T", name: "T", on: true }).status, 400);
    assert.equal(post({ op: "key", target: "T", name: "G", on: "yes" }).status, 400);
    // taking a mark off needs nothing of the graph: what is gone can be unmarked
    assert.equal(post({ op: "key", target: "T", name: "Gone", on: false }).status, 200);
    assert.deepEqual(keyMarks(review.data, "T"), ["G", "S"]);
    const line = JSON.parse(readFileSync(join(dir, "review", "log", logFileName("Bob", false)), "utf8").trim());
    assert.deepEqual([line.op, line.by, line.target, line.name, line.on], ["key", "Bob", "T", "S", true]);

    // explanations were removed (2026-10-08): the request is refused, and nothing is written
    const before = readFileSync(join(dir, "review", "log", logFileName("Alice", false)), "utf8");
    const ex = post({ op: "explain", name: "G", text: "The **game**." });
    assert.equal(ex.status, 400);
    assert.match(ex.body.error, /op is opinion, target, trust or key/);
    assert.equal(readFileSync(join(dir, "review", "log", logFileName("Alice", false)), "utf8"), before);
    assert.equal(Object.hasOwn(review.data, "explanations"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the page's review of a declaration: the key toggle, and no explanation to read or write", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-keys-page-"));
  try {
    // a review whose log, written before the owner removed explanations (2026-10-08), holds one
    const g = graph(["T>G", "G=S"]);
    const log = join(dir, "review", "log");
    mkdirSync(log, { recursive: true });
    const line = (e: object) => JSON.stringify(e) + "\n";
    writeFileSync(
      join(log, logFileName("Alice", false)),
      line({ op: "target", at: at(1), by: "Alice", name: "T", on: true }) +
        line({ op: "key", at: at(2), by: "Alice", target: "T", name: "G", on: true }) +
        line({ op: "explain", at: at(3), by: "Alice", name: "G", text: "Definition 2.3 of [X].", hash: "h-G" }),
    );
    const d = new ReviewStore(dir, "review").data;
    const root = g.byName.get("T")!;
    const hooks: ReviewHooks = {
      review: () => ({ data: d, error: null, blocked: null, readOnly: false, reviewer: "Alice" }),
      ensureReviewer: async () => "Alice",
      submit: async () => null,
      queue: (i) => reviewQueue(g, d, i, inTargets(g, [i])),
      progress: () => ({ total: 3, approved: 0, commented: 0, stale: 0 }),
      reviewLens: () => {},
      editedNow: () => false,
      edited: async () => false,
      textNow: () => null,
      text: async () => null,
      reviewRoot: () => root,
      inReview: (r, i) => !!reviewSet(g, d, r)[i],
      isKey: (r, i) => i === r || keyMarked(d, g.nodes[r].name, g.nodes[i].name),
      keyProgress: () => ({ total: 2, approved: 0, commented: 0, stale: 0, unreviewed: 2 }),
      keyView: () => {},
      go: () => {},
      openSource: () => {},
    };
    const box = new ReviewBox(g, hooks);
    // the source window's review (G) and the panel's (the target T, in full)
    const G = box.html(g.byName.get("G")!, false);
    const T = box.html(root, true);
    assert.match(G, /data-rv-key aria-pressed="true"[^>]*>◆ Key for T/);
    for (const html of [G, T]) assert.doesNotMatch(html, /explanation|explain|data-ex-|Definition 2\.3/i);
    assert.equal("aboutHtml" in box, false, "nothing draws an explanation above the doc");
    // the target's Key view, offered where the page makes views; a read-only reader's makes none
    // (CollabSpec decision 11), and is not offered it
    assert.match(T, /data-rv-keyview/);
    const { keyView: _, ...reader } = hooks;
    assert.doesNotMatch(new ReviewBox(g, { ...reader, review: () => ({ ...hooks.review(), readOnly: true }) }).html(root, true), /data-rv-keyview/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the comment box, in the panel and the source window alike: Approve and Comment, emptied once the opinion is taken, its text kept when it is refused", async () => {
  const g = graph(["T>G"]);
  const d = emptyReview();
  const G = g.byName.get("G")!;
  // what the server answers (null: taken), and what it is sent; `during` runs while it is sent
  let answer: string | null = null;
  let during = () => {};
  const sent: ReviewRequest[] = [];
  const hooks = {
    review: () => ({ data: d, error: null, blocked: null, readOnly: false, reviewer: "Alice" }),
    ensureReviewer: async () => "Alice",
    submit: async (op: ReviewRequest) => {
      sent.push(op);
      during();
      return answer;
    },
    editedNow: () => false,
    edited: async () => false,
    reviewRoot: () => null,
  } as unknown as ReviewHooks;
  const box = new ReviewBox(g, hooks);
  // the box and the line for a refusal, as the panel and the source window hold them
  const text = { value: "", focused: false, focus() { this.focused = true; }, matches: (s: string) => s === "[data-rv-comment]" };
  const err = { textContent: "", hidden: true };
  const root = { querySelector: (s: string) => (s === "[data-rv-comment]" ? text : s === ".rv-err" ? err : null) } as unknown as HTMLElement;
  const type = (s: string) => {
    text.value = s;
    box.input(text as unknown as HTMLElement, G);
  };
  const settle = () => new Promise((ok) => setImmediate(ok));
  const drawn = () => /<textarea class="rv-text" data-rv-comment[^>]*>([^<]*)<\/textarea>/.exec(box.html(G, false))![1];

  // the buttons: Approve, solid green, and Comment, solid blue, never a warning colour (the owner's
  // decision of 2026-10-12)
  const html = box.html(G, false);
  // whom it is for, said on the buttons where it is someone else (ReviewSpec decision 8): no one here
  assert.match(html, /<button class="rv-btn approve" data-rv="approve"[^>]*>Approve<span data-rv-for-who><\/span><\/button>/);
  assert.match(html, /<button class="rv-btn comment" data-rv="comment" title="Comment \(m\)[^"]*">Comment<span data-rv-for-who><\/span><\/button>/);
  assert.match(html, /Speaking for <input class="rv-for-in" data-rv-for list="rv-people" value=""/);
  assert.doesNotMatch(html, /disput/i);
  // Comment with nothing written sends nothing, and goes to the box
  box.give("comment", G, root);
  await settle();
  assert.deepEqual([sent.length, text.focused, err.hidden], [0, true, false]);
  // a comment taken: the box is empty, and every box drawn with the change comes empty
  let redrawn: string | null = null;
  during = () => (redrawn = drawn());
  type("Is n the bound or the length?");
  box.give("comment", G, root);
  await settle();
  assert.deepEqual(sent.at(-1), { op: "opinion", name: "G", verdict: "comment", comment: "Is n the bound or the length?" });
  assert.deepEqual([text.value, redrawn, drawn()], ["", "", ""]);
  // an approval with a comment: the same
  type("Read it against the paper's Definition 3.");
  box.give("approve", G, root);
  await settle();
  assert.deepEqual(sent.at(-1), { op: "opinion", name: "G", verdict: "approve", comment: "Read it against the paper's Definition 3." });
  assert.deepEqual([text.value, drawn()], ["", ""]);
  // refused: the text stays where it was written and in the box drawn next, and the reason shows
  answer = "The server cannot be reached.";
  during = () => {};
  type("Why 2 and not 3?");
  box.give("comment", G, root);
  await settle();
  assert.deepEqual([text.value, drawn(), err.textContent, err.hidden], ["Why 2 and not 3?", "Why 2 and not 3?", "The server cannot be reached.", false]);
  // refused after the box was drawn again while it went (someone else's change): put back
  during = () => (text.value = drawn());
  box.give("comment", G, root);
  await settle();
  assert.deepEqual([text.value, drawn()], ["Why 2 and not 3?", "Why 2 and not 3?"]);
  // taken while the reader typed on: what they typed since is theirs, and stays
  answer = null;
  during = () => type("Why 2 and not 3? And the bound?");
  box.give("comment", G, root);
  await settle();
  assert.deepEqual([text.value, drawn()], ["Why 2 and not 3? And the bound?", "Why 2 and not 3? And the bound?"]);
  assert.equal(sent.length, 5);
});

// ------------------------------------------------------------------- support and the key graph

test("support: what a key declaration reaches through members that are not key", () => {
  // T → A → B → C; T → D → C; B → E (outside, trusted by default)
  const g = graph(["T>A", "A=B", "B>C", "T>D", "D>C", "B>X.e"]);
  // nothing marked: the target supports everything
  let a = analyse(g, reviewWith([]));
  assert.deepEqual(a.keyNames, ["T"]);
  assert.deepEqual(a.supportOf("T"), ["A", "B", "C", "D"]);
  assert.deepEqual(a.edges, []);
  // B key: T supports A and D, and C through D; B supports C; the key graph T → B
  a = analyse(g, reviewWith(["B"]));
  assert.deepEqual(a.keyNames.sort(), ["B", "T"]);
  assert.deepEqual(a.supportOf("T"), ["A", "C", "D"]);
  assert.deepEqual(a.supportOf("B"), ["C"]);
  assert.deepEqual(a.supportersOf("C"), ["B", "T"]);
  assert.deepEqual(a.supportersOf("A"), ["T"]);
  assert.deepEqual(a.edges, ["T>B"]);
  // every member is supported by some key declaration
  for (const i of a.q.order) if (!a.kg.keys.includes(i)) assert.ok(a.kg.supporters.get(i)?.length, g.nodes[i].name);
});

test("support in a diamond: the bottom is supported by both sides, the key graph is a diamond", () => {
  // T → L, T → R, L → M, R → M, M → Z: L, R and M key
  const g = graph(["T>L", "T>R", "L>M", "R=M", "M>Z", "L>Y"]);
  const a = analyse(g, reviewWith(["L", "R", "M"]));
  assert.deepEqual(a.edges, ["L>M", "R>M", "T>L", "T>R"]);
  assert.deepEqual(a.supportOf("T"), []);
  assert.deepEqual(a.supportOf("L"), ["Y"]);
  assert.deepEqual(a.supportOf("M"), ["Z"]);
  // the layers: T, then L and R, then M
  const layer = keyLayers(a.kg);
  const of = (n: string) => layer[a.keyNames.indexOf(n)];
  assert.deepEqual([of("T"), of("L"), of("R"), of("M")], [0, 1, 1, 2]);
  const top = topDown(a.kg).map((j) => a.keyNames[j]);
  assert.equal(top[0], "T");
  assert.equal(top[3], "M");
  // a declaration key for two sides, reached also directly from the target: one layer below both
  const g2 = graph(["T>L", "T>M", "L>M"]);
  const b = analyse(g2, reviewWith(["L", "M"]));
  assert.deepEqual(b.edges, ["L>M", "T>L", "T>M"]);
  assert.deepEqual(keyLayers(b.kg)[b.keyNames.indexOf("M")], 2, "the longest path");
});

test("support in cycles: members that use each other, and key declarations that rest on each other", () => {
  // A and B use each other; C and D are key and use each other through E
  const g = graph(["T>A", "A=B", "B=A", "B>C", "C=E", "E=D", "D=C", "D>F"]);
  const a = analyse(g, reviewWith(["C", "D"]));
  assert.deepEqual(a.supportOf("T"), ["A", "B"]);
  assert.deepEqual(a.supportOf("C"), ["E"]);
  assert.deepEqual(a.supportOf("D"), ["F"]);
  assert.deepEqual(a.edges, ["C>D", "D>C", "T>C"]);
  // C and D rest on each other: one layer
  const layer = keyLayers(a.kg);
  assert.equal(layer[a.keyNames.indexOf("C")], layer[a.keyNames.indexOf("D")]);
  assert.equal(layer[a.keyNames.indexOf("C")], 1);
  // the target in a cycle with a key declaration terminates, and it stays on top
  const g2 = graph(["T>K", "K=W", "W=T"]);
  const b = analyse(g2, reviewWith(["K"]));
  assert.deepEqual(b.edges, ["K>T", "T>K"]);
  assert.equal(topDown(b.kg).map((j) => b.keyNames[j])[0], "T");
});

test("support reaches through a trusted layer of the project, and a proof's axiom is the target's", () => {
  // T → L (trusted by name) → U; T's proof uses P, which rests on the axiom Ax
  const g = graph(["T>L", "L=U", "T~P", "P~Ax"], { Ax: "axiom" });
  const d = reviewWith(["U"]);
  record(d, { op: "trust", prefix: "L", by: "Alice", on: true }, "tc", at(20));
  const a = analyse(g, d);
  assert.ok(!a.q.order.includes(g.byName.get("L")!), "L is trusted: not a member");
  assert.deepEqual(a.edges, ["T>U"], "T reaches U through the trusted L");
  // Ax is in the review (a non-standard axiom it rests on), and no statement or body reaches it
  const ax = g.byName.get("Ax")!;
  assert.ok(a.q.order.includes(ax));
  assert.deepEqual(a.kg.viaProof.map((i) => g.nodes[i].name), ["Ax"]);
  assert.deepEqual(a.supportersOf("Ax"), ["T"]);
  // a mark on what has left the review counts for nothing, and is kept
  record(d, { op: "trust", prefix: "U", by: "Alice", on: true }, "tc", at(21));
  assert.deepEqual(analyse(g, d).keyNames, ["T"]);
  assert.deepEqual(keyMarks(d, "T"), ["U"]);
});

test("support counts by review status, and the key level of progress", () => {
  const g = graph(["T>A", "A>B", "T>C"]);
  const d = reviewWith(["A"]);
  record(d, { op: "opinion", name: "A", by: "Alice", verdict: "approve", hash: "h-A" }, "tc", at(30));
  record(d, { op: "opinion", name: "B", by: "Alice", verdict: "comment", comment: "no", hash: "h-B" }, "tc", at(31));
  record(d, { op: "opinion", name: "C", by: "Alice", verdict: "approve", hash: "old" }, "tc", at(32));
  const a = analyse(g, d);
  assert.deepEqual(statusCounts(g, d, a.kg.keys), { total: 2, approved: 1, commented: 0, stale: 0, unreviewed: 1 });
  assert.deepEqual(statusCounts(g, d, a.kg.support[a.keyNames.indexOf("A")]), { total: 1, approved: 0, commented: 1, stale: 0, unreviewed: 0 });
  assert.deepEqual(statusCounts(g, d, a.kg.support[a.keyNames.indexOf("T")]), { total: 1, approved: 0, commented: 0, stale: 1, unreviewed: 0 });
});

test("the key graph is quick on a review of hundreds of members in a large graph", () => {
  // 600 members in a chain of diamonds under T, 20 key; 30,000 other declarations around them
  const spec: string[] = [];
  for (let k = 0; k < 300; k++) spec.push(`M${k}>L${k}`, `M${k}>R${k}`, `L${k}=M${k + 1}`, `R${k}=M${k + 1}`);
  spec.push("T>M0");
  for (let k = 0; k < 30000; k++) spec.push(`O${k}>M${k % 300}`, `O${k}>O${(k * 7) % 30000}`);
  const g = graph(spec);
  const keys = Array.from({ length: 20 }, (_, k) => `M${k * 15}`);
  const d = reviewWith(keys);
  const root = g.byName.get("T")!;
  const q = reviewQueue(g, d, root, inTargets(g, [root]));
  const t0 = performance.now();
  const kg = keyGraph(g, d, root, q.order);
  const ms = performance.now() - t0;
  assert.equal(kg.keys.length, 21);
  assert.equal(kg.edges.length, 20, "a chain: each key declaration rests on the next");
  assert.ok(ms < 200, `${ms.toFixed(1)} ms`);
});

// ------------------------------------------------------------------- key first

test("key first: the key declarations in review order, then the rest, as the agents' API lists them with key=first", () => {
  const g = graph(["T>A", "A>B", "B>C", "T>D"]);
  const d = reviewWith(["B", "D"]);
  const root = g.byName.get("T")!;
  const q = reviewQueue(g, d, root, inTargets(g, [root]));
  const kg = keyGraph(g, d, root, q.order);
  const isKey = new Set(kg.keys);
  const order = keyFirst(q.order, (i) => isKey.has(i));
  // bottom-up within each: B, D, T first; then C, A
  assert.deepEqual(order.map((i) => g.nodes[i].name), ["B", "D", "T", "C", "A"]);
});

// ------------------------------------------------------------------- key(T)

test("key(T) holds the target and its key declarations still in its review", () => {
  const g = graph(["T>A", "A>B", "T>C", "U>C"]);
  const d = reviewWith(["A", "B"]);
  record(d, { op: "target", name: "U", by: "Bob", on: true }, "tc", at(40));
  record(d, { op: "key", target: "U", name: "C", by: "Bob", on: true }, "tc", at(41));
  const names = (text: string) => {
    const s = evaluate(parseQuery(text), { g, review: d });
    return g.nodes.filter((_, i) => s[i]).map((v) => v.name).sort();
  };
  assert.deepEqual(names("key(T)"), ["A", "B", "T"]);
  assert.deepEqual(names("key(T, U)"), ["A", "B", "C", "T", "U"]);
  assert.deepEqual(names("key(U)"), ["C", "U"]);
  assert.deepEqual(names("key(Nope)"), []);
  assert.deepEqual(names("tcb(T) except key(T)"), ["C"]);
  assert.deepEqual(names("tcb(key(T)) and status(unreviewed)"), ["A", "B", "C", "T"]);
  // a mark on what is now trusted is left out
  record(d, { op: "trust", prefix: "B", by: "Alice", on: true }, "tc", at(42));
  assert.deepEqual(names("key(T)"), ["A", "T"]);
  // printed and read back the same; it reads the review; bounded
  assert.equal(printQuery(parseQuery("KEY( T , \"a b\" )")), 'key(T, "a b")');
  assert.equal(readsReview(parseQuery("all except key(T)")), true);
  assert.throws(() => parseQuery("key()"), /at least one target/);
  assert.throws(() => parseQuery(`key(${Array.from({ length: QUERY_LIMITS.closures + 1 }, (_, k) => `T${k}`).join(", ")})`), /closures/);
  // its JSON form, as an agent may send it
  const s = evaluate({ op: "key", of: ["T"] }, { g, review: d });
  assert.equal(s[g.byName.get("A")!], 1);
  // the key set as the page and the export read it, in review order
  const root = g.byName.get("T")!;
  const q = reviewQueue(g, d, root, inTargets(g, [root]));
  assert.deepEqual(keySet(g, d, root, q.order).map((i) => g.nodes[i].name), ["A", "T"]);
});
