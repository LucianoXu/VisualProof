// One's own review (the owner's decisions of 2026-10-20): the Mine colour scheme — Status's review
// states from the reader's own opinions alone (CanvasSpec, "Colour schemes"), beside Kind and
// Status, `c` stepping through the three, followed as the colouring part is (CollabSpec decision 4);
// a reader without a name has none to show, and the legend says so. The query `mine(approved |
// commented | stale | none)` (ViewSpec, the query language), read and printed, bounded and
// evaluated as `status(…)` is, against the reader's own review; for no reader (the server, an
// agent) it holds nothing.

import assert from "node:assert/strict";
import { test } from "node:test";
import { boardSet, lightUp } from "../src/shared/board.ts";
import { cleanView } from "../src/shared/collab.ts";
import { cleanQuery, describe, describeCondition, evaluate, parseQuery, printQuery, QUERY_LIMITS, readsReview } from "../src/shared/query.ts";
import { scopeTitle } from "../src/shared/titles.ts";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { emptyReview, record } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { Legend } from "../src/web/src/legend.ts";
import { mineCodes, mineLabel, SCHEMES_SHOWN, STATUSES, statusCodes } from "../src/web/src/status.ts";
import type { Scheme } from "../src/web/src/status.ts";
import { Store } from "../src/web/src/store.ts";

const at = (k: number) => new Date(Date.UTC(2026, 9, 20, 11, 0, k)).toISOString();

/** Six declarations of the project, one outside it, one trusted by a prefix; Alice and Bob said
 *  different things, an agent advised, and Carol (invited by a personal link) approved. */
export function mineWorld() {
  const nodes: ViewNode[] = [
    { name: "P.a", kind: "def", module: "P.A", ax: 0, hash: "a1" },
    { name: "P.b", kind: "def", module: "P.A", ax: 0, hash: "b1" },
    { name: "P.c", kind: "theorem", module: "P.B", ax: 0, hash: "c1" },
    { name: "P.d", kind: "theorem", module: "P.B", ax: 0, hash: "d1" },
    { name: "P.e", kind: "def", module: "P.C", ax: 0, hash: "e1" },
    { name: "Q.f", kind: "def", module: "Q.F", ax: 0, hash: "f1" },
    { name: "Mathlib.g", kind: "def", module: "Mathlib.X", ax: 0, ext: true },
  ];
  const meta = { nodes, projectCount: 6, axioms: ["propext"], axiomSets: [[0]], layouts: {}, edgeCount: 0 } as unknown as ViewMeta;
  const g = new Graph(meta, new Int32Array(0));
  const d = emptyReview();
  d.trusted.push("Q");
  const op = (k: number, by: string, name: string, verdict: "approve" | "comment", hash: string, more: object = {}) =>
    record(d, { op: "opinion", name, by, verdict, hash, ...(verdict === "comment" ? { comment: "why?" } : {}), ...more }, "tc", at(k));
  // Alice: approved a, commented on b, approved c before it changed; Bob: commented on a, approved b
  // and d; an agent approved e (advice, nobody's own); Carol approved d; Alice withdrew her approval
  // of d
  op(1, "Alice", "P.a", "approve", "a1");
  op(2, "Alice", "P.b", "comment", "b1");
  op(3, "Alice", "P.c", "approve", "c0");
  op(4, "Bob", "P.a", "comment", "a1");
  op(5, "Bob", "P.b", "approve", "b1");
  op(6, "Bob", "P.d", "approve", "d1");
  op(7, "Claude", "P.e", "approve", "e1", { agent: true });
  op(8, "Carol", "P.d", "approve", "d1", { person: "c0c0c0c0c0" });
  op(9, "Alice", "P.d", "approve", "d1");
  record(d, { op: "withdraw", name: "P.d", by: "Alice" }, "tc", at(10));
  return { g, d };
}

const states = (codes: Uint8Array) => [...codes].map((c) => STATUSES[c]);

test("Mine: Status's review states from one reader's own opinions alone — different for Alice and Bob; nothing of agents, nothing of anyone else", () => {
  const { g, d } = mineWorld();
  // the team's, for comparison: a comment wins, a stale one is stale, trusted and outside
  assert.deepEqual(states(statusCodes(d, g, new Map())), ["commented", "commented", "stale", "approved", "unreviewed", "trusted", "trusted"]);
  assert.deepEqual(states(mineCodes(d, g, { by: "Alice" })), ["approved", "commented", "stale", "unreviewed", "unreviewed", "trusted", "trusted"]);
  assert.deepEqual(states(mineCodes(d, g, { by: "Bob" })), ["commented", "approved", "unreviewed", "approved", "unreviewed", "trusted", "trusted"]);
  // someone invited by a personal link is their link, whatever name they go by
  assert.deepEqual(states(mineCodes(d, g, { by: "Carol", person: "c0c0c0c0c0" })).slice(0, 5), ["unreviewed", "unreviewed", "unreviewed", "approved", "unreviewed"]);
  assert.equal(states(mineCodes(d, g, { by: "Carol" }))[3], "unreviewed", "a guest of her name is someone else");
  // an agent's advice is no one's own: not the person's of its name either
  assert.equal(states(mineCodes(d, g, { by: "Claude" }))[4], "unreviewed");
  // a reader without a name: nothing of theirs — what needs review, and what is trusted
  assert.deepEqual(states(mineCodes(d, g, null)), ["unreviewed", "unreviewed", "unreviewed", "unreviewed", "unreviewed", "trusted", "trusted"]);
  // the hover tip says whose
  assert.equal(mineLabel(STATUSES.indexOf("stale"), null), "your opinion is stale");
  assert.equal(mineLabel(STATUSES.indexOf("approved"), "Alice"), "Alice approved");
  assert.equal(mineLabel(STATUSES.indexOf("unreviewed"), null), "not reviewed by you");
});

/** The legend drawn into a stand-in, open or folded, in `scheme`, with these counts. */
function legend(scheme: Scheme, o: { open?: boolean; whose?: string | null; none?: boolean; status?: number[] } = {}): string {
  const el = { innerHTML: "", addEventListener() {} } as unknown as HTMLElement;
  const status = o.status ?? STATUSES.map(() => 1);
  new Legend(el, {
    scheme: () => scheme,
    setScheme() {},
    counts: () => ({ status, kinds: [] }),
    isOpen: () => o.open ?? true,
    setOpen() {},
    keyEdges: () => false,
    mineWhose: () => o.whose ?? null,
    mineNone: () => o.none ?? false,
  }).render();
  return el.innerHTML;
}

test("the legend: Kind | Status | Mine; Mine's five rows and whose they are; a reader without a name told why there is nothing of theirs", () => {
  assert.deepEqual(SCHEMES_SHOWN, ["kind", "status", "mine"], "the legend's order, and c's");
  const html = legend("mine", { status: [0, 0, 0, 2, 1, 3, 9, 4] });
  assert.deepEqual([...html.matchAll(/data-scheme="([a-z]+)" class="(on)?"/g)].map((m) => m[1] + (m[2] ? "*" : "")), ["kind", "status", "mine*"]);
  const rows = [...html.matchAll(/<div class="lg-row[^"]*" title="([^"]*)"><span class="dot ss s-([a-z]+)"><\/span><span class="lg-name">([^<]*)<\/span><span class="lg-n">(\d+)<\/span>/g)].map((m) => `${m[2]} ${m[4]}`);
  // no build, no sorry: the review's states alone
  assert.deepEqual(rows, ["commented 2", "stale 1", "approved 3", "unreviewed 9", "trusted 4"]);
  assert.match(html, /Your own opinions alone/);
  assert.match(html, /3 of 15 approved by you/);
  // following Alice: hers, named
  const hers = legend("mine", { whose: "Alice" });
  assert.match(hers, /Alice's own opinions, as you follow Alice/);
  assert.match(hers, /title="Alice's current opinion approves its present version"/);
  assert.match(legend("mine", { open: false, whose: "Alice" }), /<\/span>Alice's<span class="lg-chip-n">/);
  // nobody's: said, and no progress shown
  const none = legend("mine", { none: true });
  assert.match(none, /You have no name yet, so no opinions of your own to show/);
  assert.doesNotMatch(none, /lg-prog/);
  const chip = legend("mine", { open: false, none: true });
  assert.match(chip, /<span class="lg-swatch lg-mine"><\/span>Mine<span class="lg-chev"/, "folded: its name, no count");
  // by status, as it was: the build's states among the rows
  assert.match(legend("status"), /s-failed/);
  assert.doesNotMatch(legend("mine"), /s-failed|s-sorry|s-building/);
});

test("the reader's choice keeps Mine, apart where the review has a focus and elsewhere; presence carries it to followers", () => {
  const s = new Store("/nowhere");
  s.data.scheme = undefined;
  s.setScheme(false, "mine");
  assert.equal(s.schemeFor(false), "mine");
  assert.equal(s.schemeFor(true), "status");
  s.setScheme(true, "mine");
  assert.equal(s.schemeFor(true), "mine");
  // the colouring part: kind, status or mine; anything else is not read
  const base = { mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };
  assert.equal(cleanView({ ...base, scheme: "mine" })!.scheme, "mine");
  assert.equal(cleanView({ ...base, scheme: "rainbow" })!.scheme, undefined);
});

test("the query: mine(…) read and printed canonically, in either form, its words its own; bounded as any", () => {
  for (const t of ["mine(none)", "mine(approved, commented, stale, none)", "tcb(P.d) except trusted and mine(none, stale)", "all except mine(approved)"]) {
    const q = parseQuery(t);
    assert.equal(printQuery(q), t, t);
    assert.deepEqual(cleanQuery(JSON.parse(JSON.stringify(q))), q, "the JSON form survives a trip");
  }
  assert.deepEqual(parseQuery("MINE(None, STALE)"), { op: "mine", statuses: ["none", "stale"] });
  assert.throws(() => parseQuery("mine(unreviewed)"), /unreviewed is not one of approved, commented, stale, none/);
  assert.throws(() => parseQuery("mine()"), /mine: give at least one/);
  assert.throws(() => parseQuery("mine"), /mine takes its arguments in parentheses/);
  assert.equal(cleanQuery({ op: "mine", statuses: ["mine"] }), null);
  assert.equal(cleanQuery({ op: "mine", statuses: [] }), null);
  // its words count among the names, its parts among the parts, as status's do
  assert.throws(() => parseQuery(`mine(${Array.from({ length: QUERY_LIMITS.names + 1 }, () => "none").join(", ")})`), /names more than/);
  // it reads the review: a board of it is computed again as opinions come
  assert.equal(readsReview(parseQuery("tcb(A) and mine(none)")), true);
  // in words: "me" is whoever reads them
  assert.equal(describe(parseQuery("mine(none)")), "not reviewed by me");
  assert.equal(describe(parseQuery("mine(stale, commented)")), "stale of mine or commented on by me");
  assert.equal(describeCondition({ op: "and", q: parseQuery("mine(none)") }), "only not reviewed by me");
  assert.equal(scopeTitle(parseQuery("tcb(P.d) and mine(none)")), "TCB of P.d, only not reviewed by me");
});

test("the query evaluated: one reader's own review — Alice's and Bob's apart, none for nobody; a board and what is lit read it", () => {
  const { g, d } = mineWorld();
  const ev = (t: string, me: { by: string; person?: string } | null) => {
    const set = evaluate(parseQuery(t), { g, review: d, me });
    return g.nodes.filter((_, i) => set[i]).map((v) => v.name);
  };
  const alice = { by: "Alice" }, bob = { by: "Bob" };
  assert.deepEqual(ev("mine(approved)", alice), ["P.a"]);
  assert.deepEqual(ev("mine(commented)", alice), ["P.b"]);
  assert.deepEqual(ev("mine(stale)", alice), ["P.c"]);
  // none: no opinion of hers — withdrawn included —, trusted or not, as status(unreviewed) is
  assert.deepEqual(ev("mine(none)", alice), ["P.d", "P.e", "Q.f", "Mathlib.g"]);
  assert.deepEqual(ev("all except trusted and mine(none)", alice), ["P.d", "P.e"]);
  assert.deepEqual(ev("mine(approved)", bob), ["P.b", "P.d"]);
  assert.deepEqual(ev("mine(none)", bob), ["P.c", "P.e", "Q.f", "Mathlib.g"]);
  assert.deepEqual(ev("mine(approved)", { by: "Carol", person: "c0c0c0c0c0" }), ["P.d"]);
  // nobody's own review — the server, an agent, a reader without a name: nothing, mine(none) too
  assert.deepEqual(ev("mine(none)", null), []);
  assert.deepEqual(evaluate(parseQuery("mine(approved, none)"), { g, review: d }).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(ev("mine(approved)", { by: "Claude" }), [], "an agent's advice is no one's own");
  // a board of it, and what it lights up, are the reader's
  const scope = parseQuery("all except trusted and mine(none)");
  const names = (set: Uint8Array) => g.nodes.filter((_, i) => set[i]).map((v) => v.name);
  assert.deepEqual(names(boardSet(g, d, scope, alice).set), ["P.d", "P.e"]);
  assert.deepEqual(names(boardSet(g, d, scope, bob).set), ["P.c", "P.e"]);
  assert.equal(boardSet(g, d, scope).count, 0, "nobody's");
  const all = boardSet(g, d, parseQuery("all"));
  assert.equal(lightUp(g, d, all, parseQuery("mine(stale)"), alice).count, 1);
  assert.equal(lightUp(g, d, all, parseQuery("mine(stale)")).count, 0);
});
