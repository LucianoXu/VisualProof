// Rests on (decided 2026-10-08, ViewSpec decision 20): Uses, TCB and Keys are three granularities of
// one question, what a declaration rests on — everything it uses ⊇ its TCB ⊇ the key declarations in
// its TCB — and one mode with a three-step switch. Keys is a query like every pick
// (`tcb(X) and (key(T…) or decl(X))`): where the review is focused on a target, its key declarations,
// elsewhere every target's, a target clicked its own. Here: those picks and their queries, read back
// from a selection's text and the address; retool into and out of Keys; key 2 stepping through Rests
// on and resuming the step last used; the key graph's edges drawn among what is lit; every step on
// show; and an agent's tool reported as Keys.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boardSet, lightUp, zoomScope } from "../src/shared/board.ts";
import type { Cluster, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { keyGraph, litKeyEdges } from "../src/shared/keys.ts";
import { cleanQuery, describe, evaluate, keysQuery, namesIn, parseQuery, printQuery, QUERY_LIMITS, readKeys, reviewScope } from "../src/shared/query.ts";
import type { Query } from "../src/shared/query.ts";
import { emptyReview, record } from "../src/shared/review.ts";
import type { ReviewData } from "../src/shared/review.ts";
import { inTargets, reviewQueue } from "../src/shared/reviewqueue.ts";
import { viewTitle } from "../src/shared/views.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { clusterPick, declPick, enterStep, keyTwo, pickWords, readSelection, retool, selectionText, shownOf, STEPS } from "../src/web/src/selection.ts";
import type { KeysOf, Pick, Root } from "../src/web/src/selection.ts";
import { decodeState, encodeState } from "../src/web/src/state.ts";
import type { ViewState } from "../src/web/src/state.ts";
import { Store } from "../src/web/src/store.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

const at = (k: number) => `2026-10-08T12:${String(k).padStart(2, "0")}:00.000Z`;

/** Two targets, N.T and N.U. T's statement uses A, whose body uses B; B's statement uses C and its
 *  body E; T's proof uses the lemma P. U's statement uses C, D and E. X, not a target, uses A.
 *  Namespaces N (T, A, P, U, X) and M (B, C, D, E). */
function world(): Graph {
  const names = ["N.T", "N.A", "N.P", "N.U", "N.X", "M.B", "M.C", "M.D", "M.E"];
  const nodes: ViewNode[] = names.map((name) => ({ name, kind: name === "N.T" || name === "N.U" || name === "N.P" ? "theorem" : "def", module: name.startsWith("N.") ? "N" : "M", ax: 0, hash: `h-${name}` }));
  const i = (n: string) => names.indexOf(n);
  const E: [string, string, number][] = [
    ["N.T", "N.A", SITE_STMT], ["N.A", "M.B", SITE_BODY], ["M.B", "M.C", SITE_STMT], ["M.B", "M.E", SITE_BODY], ["N.T", "N.P", SITE_PROOF],
    ["N.U", "M.C", SITE_STMT], ["N.U", "M.D", SITE_STMT], ["N.U", "M.E", SITE_STMT],
    ["N.X", "N.A", SITE_STMT],
  ];
  const meta = { nodes, projectCount: names.length, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: E.length } as unknown as ViewMeta;
  return new Graph(meta, new Int32Array(E.flatMap(([a, b, s]) => [i(a), i(b), s])));
}

/** T's key declarations are B and C; U's are C, D and E. */
function review(): ReviewData {
  const d = emptyReview();
  record(d, { op: "target", name: "N.T", by: "Alice", on: true }, "tc", at(0));
  record(d, { op: "target", name: "N.U", by: "Alice", on: true }, "tc", at(1));
  let k = 2;
  for (const [t, xs] of [["N.T", ["M.B", "M.C"]], ["N.U", ["M.C", "M.D", "M.E"]]] as const)
    for (const name of xs) record(d, { op: "key", target: t, name, by: "Alice", on: true }, "tc", at(k++));
  return d;
}

const g = world();
const d = review();
const names = (q: Query) => {
  const s = evaluate(q, { g, review: d });
  return g.nodes.filter((_, j) => s[j]).map((v) => v.name).sort();
};
const cl = (key: string): Cluster => ({ key, label: key, parent: -1, depth: 0, x: 0, y: 0, lx: 0, ly: 0, r: 1, count: 0, ext: false });
/** Whose key declarations, as the page decides it (web/src/pagereview.ts, keysFor): the focus's
 *  target; elsewhere a target clicked is its own, anything else every target's. */
const keysFor = (onReview: string | null) => (r: Root): KeysOf =>
  onReview ?? ("decl" in r && Object.hasOwn(d.targets, r.decl) ? r.decl : null);

test("key(targets): every target's key declarations, read and printed, sent as JSON, bounded", () => {
  assert.deepEqual(names(parseQuery("key(targets)")), ["M.B", "M.C", "M.D", "M.E", "N.T", "N.U"]);
  assert.deepEqual(names(parseQuery("key(N.T)")), ["M.B", "M.C", "N.T"]);
  assert.deepEqual(parseQuery("key(targets)"), { op: "key", of: "targets" });
  assert.equal(printQuery(parseQuery("KEY( targets )")), "key(targets)");
  // a target named `targets` is a name: quoted, it reads back as one
  assert.deepEqual(parseQuery('key("targets")'), { op: "key", of: ["targets"] });
  assert.equal(printQuery({ op: "key", of: ["targets", "N.T"] }), 'key("targets", N.T)');
  assert.deepEqual(parseQuery(printQuery({ op: "key", of: ["targets"] })), { op: "key", of: ["targets"] });
  assert.deepEqual(cleanQuery({ op: "key", of: "targets" }), { op: "key", of: "targets" });
  assert.equal(cleanQuery({ op: "key", of: "all" }), null);
  assert.deepEqual(namesIn(parseQuery("key(targets) or decl(N.X)")), ["N.X"]);
  assert.equal(describe(parseQuery("key(targets)")), "key declarations of every target");
  // it counts as one closure, however many targets the project has
  const many = Array.from({ length: QUERY_LIMITS.closures - 1 }, (_, k) => `tcb(A${k})`).join(" or ");
  assert.doesNotThrow(() => parseQuery(`${many} or key(targets)`));
  assert.throws(() => parseQuery(`${many} or key(targets) or tcb(B)`), /closures/);
});

test("Keys picks: X and the key declarations in its TCB — the focus's target's, elsewhere every target's, a target its own", () => {
  // elsewhere: every target's key declarations in X's TCB, X itself included
  const x = declPick("keys", "N.X");
  assert.equal(printQuery(x.q), "tcb(N.X) and (key(targets) or decl(N.X))");
  assert.deepEqual(names(x.q), ["M.B", "M.C", "M.E", "N.X"], "E is U's key declaration, in X's TCB");
  // the form the owner wrote, decl(X) or (tcb(X) and key(T…)), holds the same
  assert.deepEqual(names(x.q), names(parseQuery("decl(N.X) or (tcb(N.X) and key(N.T, N.U))")));
  // focused on T: T's key declarations only
  const xT = declPick("keys", "N.X", "N.T");
  assert.equal(printQuery(xT.q), "tcb(N.X) and (key(N.T) or decl(N.X))");
  assert.deepEqual(names(xT.q), ["M.B", "M.C", "N.X"]);
  // a target clicked: exactly it and its key declarations, focused on it and elsewhere alike
  // (the page gives a target its own: every target's would hold U's E, which is in T's TCB)
  const t = declPick("keys", "N.T", keysFor(null)({ decl: "N.T" }));
  assert.deepEqual(names(t.q), ["M.B", "M.C", "N.T"]);
  assert.deepEqual(names(declPick("keys", "N.T", keysFor("N.T")({ decl: "N.T" })).q), ["M.B", "M.C", "N.T"]);
  assert.deepEqual(names(declPick("keys", "N.T").q), ["M.B", "M.C", "M.E", "N.T"]);
  // a cluster: its declarations, and the key declarations in their TCB
  const N = clusterPick("keys", cl("N"), "namespace");
  assert.equal(printQuery(N.q), "tcb(ns(N) except external) and (key(targets) or (ns(N) except external))");
  assert.deepEqual(names(N.q), ["M.B", "M.C", "M.D", "M.E", "N.A", "N.P", "N.T", "N.U", "N.X"]);
  assert.deepEqual(names(clusterPick("keys", cl("N"), "namespace", "N.T").q), ["M.B", "M.C", "N.A", "N.P", "N.T", "N.U", "N.X"]);
  assert.deepEqual(names(clusterPick("keys", cl("M"), "module", "N.T").q), ["M.B", "M.C", "M.D", "M.E"], "a cluster with no target in it");
  // in words, on a chip and as a view's title
  assert.deepEqual([x, xT, t, N].map((p) => pickWords(p)), ["keys N.X rests on", "keys N.X rests on", "keys N.T rests on", "keys ns N rests on"]);
  assert.equal(describe(x.q), "key declarations N.X rests on");
  assert.equal(describe(xT.q), "key declarations of N.T that N.X rests on");
  assert.equal(describe(t.q), "key declarations N.T rests on");
  assert.equal(viewTitle({ id: "v1", name: null, scope: x.q }), "keys N.X rests on");
  assert.equal(viewTitle({ id: "v1", name: null, scope: xT.q }), "keys of N.T in TCB of N.X");
});

test("a Keys pick is one part of the selection: read back from its text, beside other picks", () => {
  const picks: Pick[] = [declPick("keys", "N.X"), declPick("plain", "M.D"), clusterPick("keys", cl("M"), "module", "N.T"), declPick("keys", "N.T", "N.T")];
  const text = selectionText(picks)!;
  assert.equal(
    text,
    "tcb(N.X) and (key(targets) or decl(N.X)) or decl(M.D) or (tcb(file(M)) and (key(N.T) or file(M))) or (tcb(N.T) and (key(N.T) or decl(N.T)))",
  );
  assert.deepEqual(readSelection(text), picks, "every pick reads back as the click it was");
  assert.deepEqual(readKeys(picks[0].q), { from: "N.X", keys: "targets" });
  assert.deepEqual(readKeys(parseQuery("tcb(N.X) and (key(targets) or decl(N.A))")), null, "a decl that is not the root is no Keys pick");
  assert.deepEqual(readSelection("tcb(N.X) and (key(targets) or decl(N.A))").map((p) => [p.tool, p.root]), [["plain", null]]);
  // keysQuery builds what readKeys reads
  assert.deepEqual(readKeys(keysQuery("N.A", ["N.T", "N.U"])), { from: "N.A", keys: ["N.T", "N.U"] });
});

test("the address: mode=keys with its selection; the older modes' addresses still work", () => {
  const keysSel = selectionText([declPick("keys", "N.X", "N.T")]);
  const states: ViewState[] = [
    { view: "review:N.T", scope: null, mode: "keys", picks: keysSel, shown: { decl: "N.X" } },
    { view: "project", scope: null, mode: "keys", picks: selectionText([clusterPick("keys", cl("N"), "namespace")]), shown: { cluster: "N" } },
    { view: null, scope: "tcb(N.X) and (key(targets) or decl(N.X))", mode: "keys", picks: null, shown: null },
  ];
  for (const s of states) assert.deepEqual(decodeState("#" + encodeState(s)), s);
  assert.ok(encodeState(states[0]).includes("mode=keys"));
  // Uses stays deps and TCB stays tcb
  assert.deepEqual(decodeState("#v=project&mode=deps&sel=uses(N.X)"), { view: "project", scope: null, mode: "deps", picks: "uses(N.X)", shown: { decl: "N.X" } });
  assert.deepEqual(decodeState("#mode=tcb&s=N.X"), { view: null, scope: null, mode: "tcb", picks: "tcb(N.X)", shown: { decl: "N.X" } });
  assert.deepEqual(decodeState("#v=review:N.T")?.mode, "tcb");
  assert.equal(decodeState("#mode=rests"), null, "Rests on is a mode of the bar, not a tool");
});

test("retool into and out of Keys: the same thing clicked, at the new step", () => {
  const text = (r: { picks: Pick[] }) => selectionText(r.picks);
  const x = declPick("tcb", "N.X");
  // into Keys: elsewhere every target's, where the review has a focus its target's, a target its own
  const k = retool([x], shownOf(x), "keys", keysFor(null));
  assert.equal(text(k), "tcb(N.X) and (key(targets) or decl(N.X))");
  assert.deepEqual(k.shown, { decl: "N.X" });
  assert.equal(text(retool([x], shownOf(x), "keys", keysFor("N.T"))), "tcb(N.X) and (key(N.T) or decl(N.X))");
  const t = declPick("plain", "N.T");
  assert.equal(text(retool([declPick("plain", "M.D"), t], shownOf(t), "keys", keysFor(null))), "tcb(N.T) and (key(N.T) or decl(N.T))");
  // out of Keys: to another step, to Selection, to Used by
  assert.equal(text(retool(k.picks, k.shown, "deps")), "uses(N.X)");
  assert.equal(text(retool(k.picks, k.shown, "tcb")), "tcb(N.X)");
  assert.equal(text(retool(k.picks, k.shown, "plain")), "decl(N.X)");
  assert.equal(text(retool(k.picks, k.shown, "apps")), "usedBy(N.X)");
  // a cluster under Keys, and back
  const N = clusterPick("tcb", cl("N"), "namespace");
  const kN = retool([N], shownOf(N), "keys", keysFor("N.T"));
  assert.equal(text(kN), "tcb(ns(N) except external) and (key(N.T) or (ns(N) except external))");
  assert.deepEqual(kN.shown, { cluster: "N" });
  assert.equal(text(retool(kN.picks, kN.shown, "plain")), "ns(N) except external");
  // a Keys pick read from an address is retooled as any other
  const read = readSelection(text(k));
  assert.equal(text(retool(read, shownOf(read[0]), "tcb")), "tcb(N.X)");
});

test("key 2: Rests on at the step last used, TCB at first; again, TCB, Keys, Uses, Direct", () => {
  assert.deepEqual(STEPS, ["deps", "tcb", "keys", "refs"], "as the switch shows them");
  // entering, from Selection or Used by
  assert.equal(keyTwo("plain", undefined), "tcb", "a reader who never chose starts at TCB");
  assert.equal(keyTwo("plain", "keys"), "keys");
  assert.equal(keyTwo("apps", "deps"), "deps");
  assert.equal(enterStep("keys"), "keys");
  assert.equal(enterStep("deps"), "deps");
  assert.equal(enterStep("apps"), "tcb", "only a step is remembered");
  // pressed again
  const cycle = (from: "tcb" | "keys" | "deps" | "refs", n: number) => {
    const out: string[] = [];
    let m: string = from;
    for (let k = 0; k < n; k++) out.push((m = keyTwo(m as "tcb", null)));
    return out;
  };
  assert.deepEqual(cycle("tcb", 5), ["keys", "deps", "refs", "tcb", "keys"]);
  assert.deepEqual(cycle("deps", 2), ["refs", "tcb"]);
  assert.equal(enterStep("refs"), "refs");
});

test("the step last used is kept in this browser, beside the other reading preferences", () => {
  const kept = new Map<string, string>();
  const was = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  try {
    const s = new Store("/restson");
    assert.equal(s.data.restsOn, undefined, "never chosen: entering starts at TCB");
    assert.equal(enterStep(s.data.restsOn), "tcb");
    s.data.restsOn = "keys";
    s.save();
    const again = new Store("/restson");
    assert.equal(again.data.restsOn, "keys");
    assert.equal(enterStep(again.data.restsOn), "keys");
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = was;
  }
});

test("the key graph's edges among what is lit: the focus's target's, elsewhere the union over the targets", () => {
  const order = (t: string) => {
    const root = g.byName.get(t)!;
    const targets = ["N.T", "N.U"].map((n) => g.byName.get(n)!);
    return reviewQueue(g, d, root, inTargets(g, targets)).order;
  };
  const kg = (t: string) => keyGraph(g, d, g.byName.get(t)!, order(t));
  const edges = (kgs: string[], q: Query) => {
    const s = evaluate(q, { g, review: d });
    return litKeyEdges(kgs.map(kg), (i) => s[i] === 1).map(([a, b]) => `${g.nodes[a].name}→${g.nodes[b].name}`);
  };
  // T rests on B through A; B on C directly. U on C, D and E.
  assert.deepEqual(edges(["N.T"], parseQuery("all")), ["N.T→M.B", "M.B→M.C"]);
  // X elsewhere: B, C and E are lit; of every target's key graph, B→C has both ends lit
  assert.deepEqual(edges(["N.T", "N.U"], declPick("keys", "N.X").q), ["M.B→M.C"]);
  // the cluster N elsewhere: both targets' key graphs, each edge once
  assert.deepEqual(edges(["N.T", "N.U"], clusterPick("keys", cl("N"), "namespace").q), ["N.T→M.B", "N.U→M.C", "N.U→M.D", "N.U→M.E", "M.B→M.C"]);
  // focused on T: T's key graph alone
  assert.deepEqual(edges(["N.T"], clusterPick("keys", cl("N"), "namespace", "N.T").q), ["N.T→M.B", "M.B→M.C"]);
  // nothing lit, or one end alone: nothing
  assert.deepEqual(edges(["N.T", "N.U"], parseQuery("decl(N.T, M.D)")), []);
  // an edge two key graphs share is drawn once
  assert.deepEqual(litKeyEdges([kg("N.T"), kg("N.T")], () => true).length, 2);
});

test("Keys on a board of a target's review set lights what the board holds, and Zoom in opens just that", () => {
  const bs = boardSet(g, d, reviewScope("N.T"));
  const q = declPick("keys", "N.A", "N.T").q;
  const lit = lightUp(g, d, bs, q);
  const G = bs.sub!.graph;
  assert.deepEqual(G.nodes.filter((_, j) => lit.set[j]).map((v) => v.name).sort(), ["M.B", "M.C", "N.A"]);
  assert.equal(lit.inside, true);
  assert.equal(printQuery(zoomScope(q, reviewScope("N.T"), lit, bs)!), "tcb(N.A) and (key(N.T) or decl(N.A))");
});

test("the bar shows every mode and Rests on's three steps, for everyone", () => {
  const html = readFileSync(new URL("../src/web/index.html", import.meta.url), "utf8");
  const button = (mode: string) => new RegExp(`<button data-mode="${mode}"[^>]*>`).exec(html)?.[0] ?? "";
  for (const m of ["plain", "deps", "tcb", "keys", "apps"]) assert.ok(button(m), `${m} is on the bar`);
  // the steps sit inside Rests on's switch
  const steps = /<span id="rests-steps"[^]*?<\/span>/.exec(html)?.[0] ?? "";
  for (const m of ["deps", "tcb", "keys"]) assert.ok(steps.includes(`data-mode="${m}"`));
});

test("an agent's tool may be Keys: presence carries it, and the companion reports it", async () => {
  const S = await site();
  try {
    const r = await S.ask("POST", "/api/share/agents", { name: "Claude" }, { "x-visualproof-name": "Alice" });
    const token = (r.json?.prompt as string).match(/vpa_[0-9a-f]{10}_[A-Za-z0-9_-]{43}/)![0];
    const auth = { authorization: `Bearer ${token}` };
    const sel = "tcb(N.b) and (key(targets) or decl(N.b))";
    assert.equal((await S.ask("POST", "/api/agent/view", { mode: "keys", sel: "N.b", selection: sel }, auth)).status, 200);
    const me = (await S.ask("GET", "/api/agent/companion", undefined, auth)).json!.agents.find((a: Json) => a.you);
    assert.deepEqual([me.place.mode, me.place.tool, me.place.selection], ["keys", "Keys", sel]);
    // Rests on is the bar's mode, not a tool: its steps are
    const bad = await S.ask("POST", "/api/agent/view", { mode: "rests" }, auth);
    assert.equal(bad.status, 400);
    assert.match(bad.json!.error, /plain, deps, tcb, keys or apps/);
  } finally {
    await S.close();
  }
});
