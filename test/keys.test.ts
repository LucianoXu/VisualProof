// Key declarations (ExportSpec decisions 1, 3 and 4): their events and replay, what the server
// binds, what the page's review of a declaration shows (no explanation since 2026-10-08), the
// support and the key graph (shared/keys.ts) on small graphs with diamonds and cycles, the review
// set listed key first, `key(T)` in the query language, and what the agents' API says of them. A
// key declaration is a member of the TCB, trusted ones included (the owner's decision of
// 2026-10-19): trusted keys are marked, kept, counted apart, and read as any.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { keyCounts, keyFirst, keyGraph, keyLayers, keySet, statusCounts, topDown } from "../src/shared/keys.ts";
import { evaluate, parseQuery, printQuery, QUERY_LIMITS, readsReview } from "../src/shared/query.ts";
import { emptyReview, invalid, keyFor, keyMarked, keyMarks, logFileName, noChange, readEvent, record, replay, reviewFromJson } from "../src/shared/review.ts";
import type { ReviewData, ReviewEvent, ReviewOp, ReviewRequest } from "../src/shared/review.ts";
import { inTargets, keyableSet, reviewQueue } from "../src/shared/reviewqueue.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { ReviewStore } from "../src/server/review.ts";
import { ReviewApi } from "../src/server/reviewapi.ts";
import type { GraphView } from "../src/server/reviewapi.ts";
import { ReviewBox } from "../src/web/src/reviewbox.ts";
import type { ReviewHooks } from "../src/web/src/reviewbox.ts";
import { ReviewFlow } from "../src/web/src/reviewqueue.ts";

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
    assert.equal(post({ op: "key", target: "T", name: "P", on: true }).status, 409, "a proof's helper is not in the TCB");
    // the outside world, trusted by default, is in the TCB: it may be key (the owner's decision of
    // 2026-10-19), and so may a declaration of the project trusted by name
    assert.equal(post({ op: "key", target: "T", name: "X.m", on: true }).status, 200, "an outside declaration of the TCB, trusted");
    assert.equal(post({ op: "trust", prefix: "S", on: true }).status, 200);
    assert.equal(post({ op: "key", target: "T", name: "S", on: false }, "Bob").status, 200);
    assert.equal(post({ op: "key", target: "T", name: "S", on: true }, "Bob").status, 200, "trusted by name, still in the TCB");
    assert.equal(post({ op: "trust", prefix: "S", on: false }).status, 200);
    assert.equal(post({ op: "key", target: "T", name: "Nope", on: true }).status, 404);
    assert.equal(post({ op: "key", target: "T", name: "T", on: true }).status, 400);
    assert.equal(post({ op: "key", target: "T", name: "G", on: "yes" }).status, 400);
    // taking a mark off needs nothing of the graph: what is gone can be unmarked
    assert.equal(post({ op: "key", target: "T", name: "Gone", on: false }).status, 200);
    assert.deepEqual(keyMarks(review.data, "T"), ["G", "S", "X.m"]);
    const line = JSON.parse(readFileSync(join(dir, "review", "log", logFileName("Bob", false)), "utf8").trim().split("\n").at(-1)!);
    assert.deepEqual([line.op, line.by, line.target, line.name, line.on], ["key", "Bob", "T", "S", true]);

    // explanations were removed (2026-10-08): the request is refused, and nothing is written
    const before = readFileSync(join(dir, "review", "log", logFileName("Alice", false)), "utf8");
    const ex = post({ op: "explain", name: "G", text: "The **game**." });
    assert.equal(ex.status, 400);
    assert.match(ex.body.error, /op is opinion, withdraw, target, trust or key/);
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
      keyable: (r, i) => i !== r && !!keyableSet(g, d, r)[i],
      isKey: (r, i) => i === r || keyMarked(d, g.nodes[r].name, g.nodes[i].name),
      keyProgress: () => ({ total: 2, approved: 0, commented: 0, stale: 0, unreviewed: 2, trusted: 0 }),
      keyView: () => {},
      go: () => {},
      openSource: () => {},
    };
    const box = new ReviewBox(g, hooks);
    // the source window's review (G) and the panel's (the target T, in full)
    const G = box.html(g.byName.get("G")!);
    const T = box.html(root);
    assert.match(G, /data-rv-key aria-pressed="true"[^>]*>◆ Key for T/);
    for (const html of [G, T]) assert.doesNotMatch(html, /explanation|explain|data-ex-|Definition 2\.3/i);
    assert.equal("aboutHtml" in box, false, "nothing draws an explanation above the doc");
    // the target's Key view, offered where the page makes views; a read-only reader's makes none
    // (CollabSpec decision 11), and is not offered it
    assert.match(T, /data-rv-keyview/);
    const { keyView: _, ...reader } = hooks;
    assert.doesNotMatch(new ReviewBox(g, { ...reader, review: () => ({ ...hooks.review(), readOnly: true }) }).html(root), /data-rv-keyview/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the key toggle stands in every review box alike — the panel's and each source window's, on its own declaration — where the focus's TCB holds it, trusted or not, and the reader may mark", () => {
  // T's TCB holds G, H, the trusted layer L and the outside X.e (trusted by default); K is outside
  // it; U is another target, whose TCB holds K; T's proof uses P
  const g = graph(["T>G", "T>H", "U>K", "T>L", "L=X.e", "T~P"]);
  const d = reviewWith(["H"]);
  record(d, { op: "target", name: "U", by: "Alice", on: true }, "tc", at(9));
  record(d, { op: "trust", prefix: "L", by: "Alice", on: true }, "tc", at(10));
  const T = g.byName.get("T")!, G = g.byName.get("G")!, H = g.byName.get("H")!, K = g.byName.get("K")!, U = g.byName.get("U")!;
  const L = g.byName.get("L")!, Xe = g.byName.get("X.e")!, P = g.byName.get("P")!;
  let focus: number | null = T;
  let state = { readOnly: false, blocked: null as string | null };
  const sent: ReviewRequest[] = [];
  const hooks = {
    review: () => ({ data: d, error: null, blocked: state.blocked, readOnly: state.readOnly, reviewer: "Alice" }),
    ensureReviewer: async () => "Alice",
    submit: async (op: ReviewRequest) => (sent.push(op), null),
    editedNow: () => false,
    edited: async () => false,
    reviewRoot: () => focus,
    keyable: (r: number, i: number) => i !== r && !!keyableSet(g, d, r)[i],
    isKey: (r: number, i: number) => i === r || keyMarked(d, g.nodes[r].name, g.nodes[i].name),
    queue: (i: number) => reviewQueue(g, d, i, inTargets(g, [i])),
    progress: () => ({ total: 0, approved: 0, commented: 0, stale: 0 }),
    keyProgress: () => ({ total: 0, approved: 0, commented: 0, stale: 0, unreviewed: 0, trusted: 0 }),
  } as unknown as ReviewHooks;
  const box = new ReviewBox(g, hooks);
  /** what the box of declaration `i` shows of the key mark: the toggle's words, the tag's, or none.
   *  One review box (ReviewSpec, "One review box"): the panel and every source window draw it. */
  const key = (i: number) => {
    const html = box.html(i);
    const b = /<button class="rv-btn rv-key[^"]*" data-rv-key aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/.exec(html);
    if (b) return `button ${b[2]}`;
    const t = /<div class="rv-tag rv-key-tag">([^<]*)<\/div>/.exec(html);
    return t ? `tag ${t[1]}` : null;
  };
  assert.equal(key(G), "button ◇ Mark as key for T");
  assert.equal(key(H), "button ◆ Key for T");
  assert.equal(key(T), null, "the target is key without a mark");
  assert.equal(key(K), null, "what its TCB does not hold");
  assert.equal(key(P), null, "a proof's helper: not in the TCB");
  // trusted, in the project or outside it: key all the same (the owner's decision of 2026-10-19)
  assert.equal(key(L), "button ◇ Mark as key for T", "a trusted layer of the project");
  assert.equal(key(Xe), "button ◇ Mark as key for T", "an outside declaration, trusted by default");
  // another focus: its own TCB's
  focus = U;
  assert.equal(key(K), "button ◇ Mark as key for U");
  assert.equal(key(G), null);
  // no focus: no toggle anywhere
  focus = null;
  for (const i of [G, H, K, L, Xe]) assert.equal(key(i), null);
  // who may not mark (a snapshot, a past build, a read-only reader; a log that cannot be read) sees
  // only what is marked
  focus = T;
  for (const s of [{ readOnly: true, blocked: null }, { readOnly: false, blocked: "Your review log …" }]) {
    state = s;
    assert.equal(key(H), "tag ◆ Key for T");
    assert.equal(key(G), null);
  }
  // a press on a window's toggle marks that window's declaration, whatever else the reader looks at
  state = { readOnly: false, blocked: null };
  const toggle = { closest: (s: string) => (s === "[data-rv-key]" ? toggle : null) } as unknown as HTMLElement;
  assert.equal(box.click(toggle, L, { querySelector: () => null } as unknown as HTMLElement), true);
  return new Promise<void>((done) =>
    setImmediate(() => {
      assert.deepEqual(sent, [{ op: "key", target: "T", name: "L", on: true }]);
      done();
    }),
  );
});

test("one review box: the panel's and each source window's offer the same controls in the same order — Approve, Comment, Speaking for, the key mark, the target mark, and a target's progress and view", () => {
  // T a target with G marked key and the trusted X.e marked key; G a declaration of its TCB
  const g = graph(["T>G", "G>X.e"]);
  const d = reviewWith(["G", "X.e"]);
  const T = g.byName.get("T")!, G = g.byName.get("G")!;
  const R = { data: d, error: null, blocked: null as string | null, readOnly: false, reviewer: "Alice" };
  const hooks = {
    review: () => R,
    ensureReviewer: async () => "Alice",
    submit: async () => null,
    editedNow: () => false,
    edited: async () => false,
    reviewRoot: () => T,
    keyable: (r: number, i: number) => i !== r && !!keyableSet(g, d, r)[i],
    isKey: (r: number, i: number) => i === r || keyMarked(d, g.nodes[r].name, g.nodes[i].name),
    queue: (i: number) => reviewQueue(g, d, i, inTargets(g, [i])),
    progress: () => ({ total: 2, approved: 0, commented: 0, stale: 0 }),
    keyProgress: () => ({ total: 2, approved: 0, commented: 0, stale: 0, unreviewed: 2, trusted: 1 }),
    targetView: () => ({ title: null, here: false, why: null }),
    linkHere: () => {},
    reviewLens: () => {},
    keyView: () => {},
  } as unknown as ReviewHooks;
  const box = new ReviewBox(g, hooks);
  // the controls a box offers, in the order it shows them
  const controls = (html: string) =>
    [...html.matchAll(/<(?:button|textarea|input)[^>]*?\b(data-rv(?:-[a-z]+)?)(?:="([^"]*)")?/g)].map((m) => (m[1] === "data-rv" ? `rv=${m[2]}` : m[1])).filter((c) => c !== "data-rv-by");
  // a declaration of the TCB: the comment, Approve, Comment, Speaking for, the key mark, the target mark
  assert.deepEqual(controls(box.html(G)), ["data-rv-comment", "rv=approve", "rv=comment", "data-rv-for", "data-rv-key", "data-rv-target"]);
  // the target: the same, its progress (key declarations apart, the trusted beside them) and its view
  const t = box.html(T);
  assert.deepEqual(controls(t), ["data-rv-comment", "rv=approve", "rv=comment", "data-rv-for", "data-rv-target", "data-rv-link", "data-rv-keyview"]);
  assert.match(t, /◆<\/span> Key: <b>0<\/b> \/ 2 approved <span class="muted rv-key-trusted">\+1 trusted<\/span>/);
  assert.match(t, /All: <b>0<\/b> \/ 2 approved/);
  // the box takes no argument saying where it stands: the panel passes the TCB it has, nothing more
  assert.equal(box.html(T, g.reach([T], SITE_STMT | SITE_BODY, "out")), t);
  // who may not record sees the same marks as tags, wherever the box stands
  R.readOnly = true;
  assert.deepEqual(controls(box.html(G)), []);
  assert.match(box.html(G), /◆ Key for T/);
  assert.match(box.html(T), /<div class="rv-tag">★ Target<\/div>/);
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
  const drawn = () => /<textarea class="rv-text" data-rv-comment[^>]*>([^<]*)<\/textarea>/.exec(box.html(G))![1];

  // the buttons: Approve, solid green, and Comment, solid blue, never a warning colour (the owner's
  // decision of 2026-10-12)
  const html = box.html(G);
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
  // a mark on what is trusted since stays a key, trusted (the owner's decision of 2026-10-19)
  record(d, { op: "trust", prefix: "U", by: "Alice", on: true }, "tc", at(21));
  const b = analyse(g, d);
  assert.deepEqual(b.keyNames, ["U", "T"]);
  assert.deepEqual(b.kg.trusted.map((i) => g.nodes[i].name), ["U"]);
  assert.deepEqual(b.edges, ["T>U"]);
  assert.deepEqual(keyCounts(g, d, b.kg), { total: 1, approved: 0, commented: 0, stale: 0, unreviewed: 1, trusted: 1 });
  // one on what has left the TCB counts for nothing, and is kept
  const g2 = graph(["T>L", "T~P", "P~Ax", "L~U"], { Ax: "axiom" });
  assert.deepEqual(analyse(g2, d).keyNames, ["T"]);
  assert.deepEqual(keyMarks(d, "T"), ["U"]);
});

test("trusted key declarations, in the project and outside it: read first, counted apart, their walks through the trusted world", () => {
  // T → A → X.r (outside, trusted by default) → X.s → X.k; A → B; X.k is key, and the trusted layer
  // Q of the project (T → Q → C) is key too
  const g = graph(["T>A", "A=X.r", "X.r>X.s", "X.s=X.k", "A>B", "T>Q", "Q=C", "C>X.k"]);
  const d = reviewWith(["X.k", "Q", "B"]);
  record(d, { op: "trust", prefix: "Q", by: "Alice", on: true }, "tc", at(20));
  const a = analyse(g, d);
  // the trusted ones first, in dependency order among themselves; then the review's in review order;
  // the target last
  assert.deepEqual(a.keyNames, ["Q", "X.k", "B", "T"]);
  assert.deepEqual(a.kg.trusted.map((i) => g.nodes[i].name), ["Q", "X.k"]);
  // the key graph reaches X.k through the outside world, and Q's support is C, which needs review
  assert.deepEqual(a.edges, ["Q>X.k", "T>B", "T>Q", "T>X.k"]);
  assert.deepEqual(a.supportOf("Q"), ["C"]);
  assert.deepEqual(a.supportOf("X.k"), [], "the outside world never uses the project");
  assert.deepEqual(a.supportOf("T"), ["A"]);
  // every member is supported, trusted members are never in a support
  for (const i of a.q.order) if (!a.kg.keys.includes(i)) assert.ok(a.kg.supporters.get(i)?.length, g.nodes[i].name);
  for (const s of a.kg.support) for (const i of s) assert.ok(a.q.order.includes(i));
  // K counts what needs review — B and the target — the trusted apart; never "not yet reviewed"
  record(d, { op: "opinion", name: "B", by: "Alice", verdict: "approve", hash: "h-B" }, "tc", at(21));
  assert.deepEqual(keyCounts(g, d, a.kg), { total: 2, approved: 1, commented: 0, stale: 0, unreviewed: 1, trusted: 2 });
  // listed key first: the trusted ones, then the review's in review order, then the rest
  assert.deepEqual(keyFirst(a.q.order, a.kg.keys).map((i) => g.nodes[i].name), ["Q", "X.k", "B", "T", "A", "C"]);
  // key(T) holds them, trusted or not: the Keys pick and the exported Key view
  const s = evaluate(parseQuery("key(T)"), { g, review: d });
  assert.deepEqual(g.nodes.filter((_, i) => s[i]).map((v) => v.name).sort(), ["B", "Q", "T", "X.k"]);
  // the target trusted itself: still last, counted apart
  record(d, { op: "trust", prefix: "T", by: "Alice", on: true }, "tc", at(22));
  const root = g.byName.get("T")!;
  const kg = keyGraph(g, d, root, reviewQueue(g, d, root, inTargets(g, [root])).order);
  assert.equal(kg.keys.at(-1), root);
  assert.ok(kg.trusted.includes(root));
});

test("the page's review with a trusted key declaration: what can be marked, the key progress, the ◆ Key list and the strip tell it apart", () => {
  // T → A; T → Q, trusted by name, → X.e outside; T's proof uses P. A and Q are key.
  const g = graph(["T>A", "T>Q", "Q=X.e", "T~P"]);
  const d = reviewWith(["A", "Q"]);
  record(d, { op: "trust", prefix: "Q", by: "Alice", on: true }, "tc", at(20));
  const T = g.byName.get("T")!, A = g.byName.get("A")!, Q = g.byName.get("Q")!, Xe = g.byName.get("X.e")!, P = g.byName.get("P")!;
  const flow = new ReviewFlow({ graph: () => g, review: () => d, reader: () => "Alice" });
  // what the key control is offered for: the TCB, trusted or not, but never the target or a proof's
  assert.deepEqual([A, Q, Xe, P, T].map((i) => flow.keyable(T, i)), [true, true, true, false, false]);
  assert.deepEqual([flow.isKey(T, Q), flow.isTrustedKey(T, Q), flow.isTrustedKey(T, A)], [true, true, false]);
  // key progress: A and T need review, Q is told apart; what is left for the reader is never Q
  assert.deepEqual(flow.keyProgress(T), { total: 2, approved: 0, commented: 0, stale: 0, unreviewed: 2, trusted: 1 });
  assert.equal(flow.keysLeft(T), 2);
  record(d, { op: "opinion", name: "A", by: "Alice", verdict: "approve", hash: "h-A" }, "tc", at(21));
  record(d, { op: "opinion", name: "T", by: "Alice", verdict: "approve", hash: "h-T" }, "tc", at(22));
  assert.equal(flow.keysLeft(T), 0, "Q needs no review");
  assert.deepEqual(flow.keyProgress(T), { total: 2, approved: 2, commented: 0, stale: 0, unreviewed: 0, trusted: 1 });
  // the ◆ Key list: Q first, marked trusted and unnumbered, then A and T numbered in review order
  const list = flow.listHtml(T, true);
  const rows = [...list.matchAll(/<button class="([^"]*)" data-walk="(\d+)"[^>]*><span class="q-n( q-trusted)?"[^>]*>(\d*)/g)].map((m) => [g.nodes[Number(m[2])].name, m[4], m[1].includes("rv-trusted"), !!m[3]]);
  assert.deepEqual(rows, [["Q", "", true, true], ["A", "1", false, false], ["T", "2", false, false]]);
  assert.match(list, /Q<span class="muted"> · trusted<\/span>/);
  assert.match(list.replace(/<[^>]*>/g, ""), /The key declarations, ◆, 1 trusted first, needing no review, then the rest in review order: 2 of 2 approved, 0 not yet reviewed by you\./);
  assert.doesNotMatch(flow.listHtml(T), /data-walk="${Q}"/, "the full review list holds what needs review alone");
  // the strip: ◆ approved / K, then +1 trusted
  const el = () => ({ innerHTML: "", title: "", hidden: false });
  const strip: Record<string, ReturnType<typeof el>> = { "#lens-title": el(), "#lens-meta": el() };
  const doc = globalThis as unknown as { document?: unknown };
  const was = doc.document;
  doc.document = { querySelector: (sel: string) => strip[sel] ?? null };
  try {
    flow.renderStrip(T);
  } finally {
    doc.document = was;
  }
  assert.match(strip["#lens-meta"].innerHTML.replace(/<[^>]*>/g, ""), /^· ◆2 \/ 2 \+1 trusted · 2 \/ 2 approved/);
});

test("what can be key for a target: its TCB, trusted or not, and its review set — no trust changes it", () => {
  // T's statement uses G; G's body the outside X.m; T's proof uses P, which rests on the axiom Ax
  const g = graph(["T>G", "G=X.m", "T~P", "P~Ax"], { Ax: "axiom" });
  const d = reviewWith([]);
  const names = () => {
    const s = keyableSet(g, d, g.byName.get("T")!);
    return g.nodes.filter((_, i) => s[i]).map((v) => v.name).sort();
  };
  assert.deepEqual(names(), ["Ax", "G", "T", "X.m"], "the TCB, and the axiom its review holds through a proof");
  record(d, { op: "trust", prefix: "G", by: "Alice", on: true }, "tc", at(5));
  record(d, { op: "trust", prefix: "@external", by: "Alice", on: true }, "tc", at(6));
  assert.deepEqual(names(), ["Ax", "G", "T", "X.m"]);
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
  const order = keyFirst(q.order, kg.keys);
  // bottom-up within each: B, D, T first; then C, A
  assert.deepEqual(order.map((i) => g.nodes[i].name), ["B", "D", "T", "C", "A"]);
});

// ------------------------------------------------------------------- key(T)

test("key(T) holds the target and its key declarations still in its TCB, trusted or not", () => {
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
  // a mark on what is now trusted stays (the owner's decision of 2026-10-19); one on what has left
  // the TCB is left out
  record(d, { op: "trust", prefix: "B", by: "Alice", on: true }, "tc", at(42));
  assert.deepEqual(names("key(T)"), ["A", "B", "T"]);
  record(d, { op: "key", target: "T", name: "U", by: "Alice", on: true }, "tc", at(43));
  assert.deepEqual(names("key(T)"), ["A", "B", "T"], "U is not in T's TCB");
  // printed and read back the same; it reads the review; bounded
  assert.equal(printQuery(parseQuery("KEY( T , \"a b\" )")), 'key(T, "a b")');
  assert.equal(readsReview(parseQuery("all except key(T)")), true);
  assert.throws(() => parseQuery("key()"), /at least one target/);
  assert.throws(() => parseQuery(`key(${Array.from({ length: QUERY_LIMITS.closures + 1 }, (_, k) => `T${k}`).join(", ")})`), /closures/);
  // its JSON form, as an agent may send it
  const s = evaluate({ op: "key", of: ["T"] }, { g, review: d });
  assert.equal(s[g.byName.get("A")!], 1);
  // the key set as the page and the export read it: the trusted first, then in review order
  const root = g.byName.get("T")!;
  const q = reviewQueue(g, d, root, inTargets(g, [root]));
  assert.deepEqual(keySet(g, d, root, q.order).map((i) => g.nodes[i].name), ["B", "A", "T"]);
});
