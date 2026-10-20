// The selection as a list of picks (web/src/selection.ts, decided 2026-10-07): a pick is one thing
// clicked under one tool, the selection is their union and a query of shared/query.ts; a cluster is
// the tools over a set a query names (`tcb(ns(P) except external)`). And the address that carries
// it (web/src/state.ts).

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import type { Cluster, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { cleanQuery, describe, evaluate, namesIn, parseQuery, printQuery, readsReview, within, withSelection } from "../src/shared/query.ts";
import type { Query } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { click, clusterPick, clusterSet, declPick, edgeMode, followRenames, pickWords, readSelection, remove, retool, selectionQuery, selectionText, shownOf } from "../src/web/src/selection.ts";
import type { Pick } from "../src/web/src/selection.ts";
import { titleNames } from "../src/shared/titles.ts";
import { decodeState, encodeState } from "../src/web/src/state.ts";
import type { ViewState } from "../src/web/src/state.ts";

/** t uses d (statement), d uses e (body), t's proof uses p; x uses d; e uses the outside world's E.
 *  Namespaces N and Q; modules M.A (t, d, p), M.B (e, x), Q (s). The outside world also has a
 *  declaration under N, and one named Nat with one under it. */
function world() {
  const nodes: ViewNode[] = [
    { name: "N.t", kind: "theorem", module: "M.A", ax: 0 },
    { name: "N.d", kind: "def", module: "M.A", ax: 0 },
    { name: "N.e", kind: "def", module: "M.B", ax: 0 },
    { name: "N.p", kind: "theorem", module: "M.A", ax: 0 },
    { name: "N.x", kind: "def", module: "M.B", ax: 0 },
    { name: "Q.s", kind: "theorem", module: "Q", ax: 0 },
    { name: "Ext.E", kind: "def", module: "Mathlib.X", ax: 0, ext: true },
    { name: "N.outside", kind: "def", module: "Mathlib.Y", ax: 0, ext: true },
    { name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0, ext: true },
    { name: "Nat.add", kind: "def", module: "Init.Prelude", ax: 0, ext: true },
  ];
  const edges = new Int32Array([0, 1, SITE_STMT, 1, 2, SITE_BODY, 0, 3, SITE_PROOF, 2, 6, SITE_STMT, 4, 1, SITE_STMT]);
  const meta = { nodes, projectCount: 6, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: 5 } as unknown as ViewMeta;
  return new Graph(meta, edges);
}

const g = world();
const d = emptyReview();
const setOf = (q: Query) => evaluate(q, { g, review: d });
const lit = (q: Query | null) => (q ? g.nodes.filter((_, i) => setOf(q)[i]).map((v) => v.name) : []);
const cl = (key: string): Cluster => ({ key, label: key, parent: -1, depth: 0, x: 0, y: 0, lx: 0, ly: 0, r: 1, count: 0, ext: key.startsWith("⟨external⟩") });

test("a closure of the set a query holds: read, printed, sent as JSON, evaluated", () => {
  const texts = [
    "tcb(ns(N) except external)",
    "uses(file(M.A))",
    "usedBy(ns(Nat) and external except decl(Nat))",
    "tcb((external))",
    "decl(N.p) or tcb(ns(Q) except external) or (file(M) and external)",
  ];
  for (const t of texts) {
    const q = parseQuery(t);
    assert.equal(printQuery(q), t, t);
    assert.deepEqual(cleanQuery(JSON.parse(JSON.stringify(q))), q, "the JSON form survives a trip");
  }
  // a list of names is still names; a name that is a word of the language is a name there
  assert.deepEqual(parseQuery("tcb(N.t, N.x)"), { op: "tcb", of: ["N.t", "N.x"] });
  assert.deepEqual(parseQuery("tcb(external)"), { op: "tcb", of: ["external"] });
  assert.deepEqual(parseQuery("tcb((external))"), { op: "tcb", of: { op: "external" } });
  assert.deepEqual(parseQuery("TCB( ns(N) )"), { op: "tcb", of: { op: "ns", prefix: "N" } });
  assert.throws(() => parseQuery("tcb(ns(N)"), /closing parenthesis/);
  // evaluated: the closure of every declaration the inner query holds
  assert.deepEqual(lit(parseQuery("tcb(ns(N) except external)")), ["N.t", "N.d", "N.e", "N.p", "N.x", "Ext.E"]);
  assert.deepEqual(lit(parseQuery("tcb(file(M.A))")), ["N.t", "N.d", "N.e", "N.p", "Ext.E"]);
  assert.deepEqual(lit(parseQuery("usedBy(file(M.B))")), ["N.t", "N.d", "N.e", "N.x"]);
  assert.deepEqual(lit(parseQuery("tcb(kind(theorem) and ns(Q))")), ["Q.s"]);
  assert.deepEqual(lit(parseQuery("tcb(decl(Nope))")), [], "nothing held, nothing lit");
  // what reads the query: names, the review, the selection put in, words
  assert.deepEqual(namesIn(parseQuery("tcb(decl(N.t) or decl(N.x))")), ["N.t", "N.x"]);
  assert.ok(readsReview(parseQuery("tcb(ns(N) except trusted)")) && !readsReview(parseQuery("tcb(ns(N))")));
  assert.equal(printQuery(withSelection(parseQuery("tcb(selection and kind(def))"), ["N.d"])), "tcb(decl(N.d) and kind(def))");
  assert.equal(describe(parseQuery("tcb(ns(N))")), "TCB of namespace N");
  assert.equal(describe(parseQuery("decl(N.p) or (ns(N) except external)")), "N.p or (namespace N except the outside world)");
  // a view opened from a board holds the selection among what the board holds: its whole scope
  const zoom = (sel: string, board: string) => printQuery(within(parseQuery(sel), parseQuery(board)));
  assert.equal(zoom("ns(N) except external", "all"), "ns(N) except external");
  assert.equal(zoom("decl(N.p) or (ns(N) except external)", "tcb(N.t) except trusted"), "decl(N.p) or (ns(N) except external) and (tcb(N.t) except trusted)");
  assert.deepEqual(lit(within(parseQuery("ns(N) except external"), parseQuery("tcb(N.t)"))), lit(parseQuery("tcb(N.t)")).filter((n) => lit(parseQuery("ns(N) except external")).includes(n)));
});

test("a cluster's set is what the cluster tree holds, in the project and outside it", () => {
  assert.equal(printQuery(clusterSet("N", "namespace")), "ns(N) except external");
  assert.deepEqual(lit(clusterSet("N", "namespace")), ["N.t", "N.d", "N.e", "N.p", "N.x"], "not the outside world's N.outside");
  assert.deepEqual(lit(clusterSet("M", "module")), ["N.t", "N.d", "N.e", "N.p", "N.x"]);
  assert.deepEqual(lit(clusterSet("⟨external⟩", "namespace")), ["Ext.E", "N.outside", "Nat", "Nat.add"]);
  // by namespace, outside the project: names under the first component, that name itself not
  assert.deepEqual(lit(clusterSet("⟨external⟩.Nat", "namespace")), ["Nat.add"]);
  assert.deepEqual(lit(clusterSet("⟨external⟩.Init.Prelude", "module")), ["Nat", "Nat.add"]);
});

test("picks: their queries, their words, and read back from the selection's text", () => {
  const picks: Pick[] = [
    declPick("plain", "N.x"),
    declPick("tcb", "N.t"),
    clusterPick("plain", cl("N"), "namespace"),
    clusterPick("deps", cl("M.A"), "module"),
    clusterPick("apps", cl("⟨external⟩.Nat"), "namespace"),
    clusterPick("tcb", cl("⟨external⟩"), "module"),
  ];
  const text = selectionText(picks)!;
  assert.equal(
    text,
    "decl(N.x) or tcb(N.t) or (ns(N) except external) or uses(file(M.A)) or usedBy(ns(Nat) and external except decl(Nat)) or tcb((external))",
  );
  assert.deepEqual(readSelection(text), picks, "every pick reads back as the click it was");
  assert.deepEqual(picks.map((p) => pickWords(p)), ["N.x", "TCB of N.t", "ns N", "what file M.A uses", "what uses ns Nat (outside)", "TCB of the outside world"]);
  // with the graph's names, as a view's title says them (ViewSpec decision 25): the parents that
  // tell a name apart from the project's others of its kind, no more
  const told = titleNames(() => ["Dim8.Main", "Dim24.Main", "Dim24.Aux.lemma"], () => ["Dim8", "Dim24", "Dim24.Aux", "Q.Aux"], () => ["Dim24.Aux", "Q.Aux"]);
  assert.deepEqual(
    [declPick("deps", "Dim24.Main"), declPick("plain", "Dim24.Aux.lemma"), clusterPick("plain", cl("Dim24.Aux"), "namespace"), clusterPick("tcb", cl("Q.Aux"), "module"), clusterPick("plain", cl("⟨external⟩.Nat"), "namespace")].map((p) => pickWords(p, told)),
    ["what Dim24.Main uses", "lemma", "ns Dim24.Aux", "TCB of file Q.Aux", "ns Nat (outside)"],
  );
  // the selection holds the union of its picks
  assert.deepEqual(lit(selectionQuery(picks.slice(0, 2))), ["N.t", "N.d", "N.e", "N.x", "Ext.E"]);
  assert.equal(selectionQuery([]), null);
  // a cluster's pick printed first keeps its meaning: left to right
  const first = [clusterPick("plain", cl("N"), "namespace"), declPick("plain", "Q.s")];
  assert.deepEqual(readSelection(selectionText(first)), first);
  assert.deepEqual(lit(parseQuery(selectionText(first)!)), ["N.t", "N.d", "N.e", "N.p", "N.x", "Q.s"]);
  // written by hand: a part no click makes is a pick with no root; nonsense is nothing
  assert.deepEqual(readSelection("kind(theorem) or ns(Q)").map((p) => p.root), [null, { cluster: "Q", by: "namespace" }]);
  assert.deepEqual(readSelection("tcb("), []);
  assert.deepEqual(readSelection(null), []);
  assert.equal(edgeMode([declPick("tcb", "N.t"), clusterPick("tcb", cl("N"), "namespace")]), "tcb");
  assert.equal(edgeMode([declPick("tcb", "N.t"), declPick("plain", "N.x")]), "plain");
});

test("a click: one pick, or with shift under Selection one pick in or out; a cluster covers", () => {
  const x = declPick("plain", "N.x"), t = declPick("plain", "N.t"), s = declPick("plain", "Q.s");
  const N = clusterPick("plain", cl("N"), "namespace");
  const at = (p: Pick) => shownOf(p);
  // without shift, or under another tool, the selection is the pick clicked
  assert.deepEqual(click([x, t], at(t), s, false, setOf), { picks: [s], shown: { decl: "Q.s" }, covered: null });
  const tt = declPick("tcb", "N.t");
  assert.deepEqual(click([x], at(x), tt, true, setOf).picks, [tt], "shift under TCB is a click");
  // shift: in, then out; the panel tells of what came, and of the last left when its own went
  let r = click([x], at(x), s, true, setOf);
  assert.deepEqual([r.picks, r.shown], [[x, s], { decl: "Q.s" }]);
  r = click(r.picks, r.shown, s, true, setOf);
  assert.deepEqual([r.picks, r.shown], [[x], { decl: "N.x" }]);
  r = click([x, s], at(x), s, true, setOf);
  assert.deepEqual([r.picks, r.shown], [[x], { decl: "N.x" }], "the panel stays on what it told of");
  // a cluster comes in place of the picks it covers; the TCB of N.t is not inside N
  r = click([x, s, declPick("tcb", "N.t")], at(x), N, true, setOf);
  assert.deepEqual([r.picks, r.shown], [[s, declPick("tcb", "N.t"), N], { cluster: "N" }]);
  // something a picked cluster covers changes nothing, and says by which
  const r2 = click(r.picks, r.shown, t, true, setOf);
  assert.deepEqual([r2.picks, r2.shown, r2.covered], [r.picks, r.shown, N]);
  // also under another tool's cluster pick: the TCB of N holds the outside world's Ext.E
  const tN = clusterPick("tcb", cl("N"), "namespace");
  assert.equal(click([tN], at(tN), declPick("plain", "Ext.E"), true, setOf).covered, tN);
  // a declaration's pick covers nothing: shift adds inside it
  assert.deepEqual(click([tt], at(tt), declPick("plain", "N.d"), true, setOf).picks, [tt, declPick("plain", "N.d")]);
  // the chip's ×
  assert.deepEqual(remove([x, s, N], { cluster: "N" }, 2), { picks: [x, s], shown: { decl: "Q.s" }, covered: null });
  assert.deepEqual(remove([x, s, N], { cluster: "N" }, 0).shown, { cluster: "N" });
  assert.deepEqual(remove([x], { decl: "N.x" }, 0), { picks: [], shown: null, covered: null });
});

test("the address: the view, the tool, the selection's text and what the panel tells of", () => {
  const sel = selectionText([declPick("tcb", "A.«b.c».d"), clusterPick("plain", cl("x y"), "namespace")]);
  const states: ViewState[] = [
    { view: "project", scope: null, mode: "tcb", picks: "tcb(A.d)", shown: { decl: "A.d" } },
    { view: "review:A.«b.c».d", scope: null, mode: "plain", picks: sel, shown: { cluster: "x y" } },
    { view: "review:A.«b.c».d", scope: null, mode: "plain", picks: sel, shown: { decl: "A.«b.c».d" } },
    { view: null, scope: `tcb(a+b&c=d, "x y") except external`, mode: "deps", picks: null, shown: null },
    { view: "v1x2y3z", scope: null, mode: "apps", picks: "kind(theorem)", shown: { decl: "∀ε" } },
  ];
  for (const s of states) assert.deepEqual(decodeState("#" + encodeState(s)), s);
  // what the panel tells of is left out when it is the last pick's root
  assert.ok(!encodeState(states[1]).includes("c="));
  assert.ok(encodeState(states[2]).includes("s="));
  assert.equal(decodeState(""), null);
  assert.equal(decodeState("#mode=nonsense"), null);
  assert.equal(decodeState("#x=1"), null);
  // a link written by hand names the view alone; the tool is TCB
  assert.deepEqual(decodeState("#v=review:N.t"), { view: "review:N.t", scope: null, mode: "tcb", picks: null, shown: null });
  // an address from before picks: the declarations lit, under its tool
  assert.deepEqual(decodeState("#mode=tcb&s=N.d"), { view: null, scope: null, mode: "tcb", picks: "tcb(N.d)", shown: { decl: "N.d" } });
  assert.deepEqual(decodeState("#mode=plain&s=N.d&f=N.d&f=N.e")?.picks, "decl(N.d) or decl(N.e)");
  // a selection that cannot be read is nothing selected
  assert.deepEqual(decodeState("#mode=tcb&sel=tcb(")?.picks, null);
});

test("another tool selects the pick last clicked again, alone: the last of several, the one thing clicked", () => {
  const text = (r: { picks: Pick[] }) => selectionText(r.picks);
  // from Selection with several picks to TCB: the last pick only, under TCB
  const several = [declPick("plain", "N.t"), declPick("plain", "N.d")];
  const tcb = retool(several, shownOf(several[1]), "tcb");
  assert.equal(text(tcb), "tcb(N.d)");
  assert.deepEqual(tcb.shown, { decl: "N.d" });
  // the one the panel tells of, when it is not the last
  assert.equal(text(retool(several, shownOf(several[0]), "deps")), "uses(N.t)");
  // back to Selection: the one thing clicked
  assert.equal(text(retool(tcb.picks, tcb.shown, "plain")), "decl(N.d)");
  // between closures, and a cluster's set under each tool
  assert.equal(text(retool(tcb.picks, tcb.shown, "apps")), "usedBy(N.d)");
  const N = { key: "N", label: "N", parent: -1, depth: 0, x: 0, y: 0, lx: 0, ly: 0, r: 1, count: 5, ext: false } as Cluster;
  assert.equal(text(retool([clusterPick("plain", N, "namespace")], { cluster: "N" }, "tcb")), "tcb(ns(N) except external)");
  // nothing selected, or a pick no tool can be given again: unchanged, the same list
  const none: Pick[] = [];
  assert.equal(retool(none, null, "tcb").picks, none);
  const byHand = readSelection("kind(def) and sorry");
  assert.equal(retool(byHand, null, "tcb").picks, byHand);
});

test("a build renames what is selected: the selection and the panel are on its name now, through a chain of renames (HistorySpec decision 10)", () => {
  const text = (r: { picks: Pick[] }) => selectionText(r.picks);
  // N.d was renamed N.d2, then N.d3: the graph has N.d3 and N.t, no longer N.d
  const renamed = { "N.d2": "N.d", "N.d3": "N.d2" };
  const has = (n: string) => n === "N.d3" || n === "N.t";
  const picks = [declPick("tcb", "N.d"), declPick("tcb", "N.t")];
  const r = followRenames(picks, { decl: "N.d" }, renamed, has);
  assert.equal(text(r), "tcb(N.d3) or tcb(N.t)");
  assert.deepEqual(r.picks[0].root, { decl: "N.d3" });
  assert.equal(r.picks[1], picks[1], "what the graph has stays as it is");
  assert.deepEqual(r.shown, { decl: "N.d3" });
  // under Keys, the target whose key declarations it holds is renamed with it
  assert.equal(text(followRenames([declPick("keys", "N.d", "N.d")], null, renamed, has)), text({ picks: [declPick("keys", "N.d3", "N.d3")] }));
  // gone without a rename, a cluster, a pick written by hand, nothing renamed: the same list and object
  const gone = [declPick("plain", "N.x")];
  const shown = { decl: "N.x" };
  const same = followRenames(gone, shown, renamed, has);
  assert.equal(same.picks, gone);
  assert.equal(same.shown, shown);
  const N = { key: "N", label: "N", parent: -1, depth: 0, x: 0, y: 0, lx: 0, ly: 0, r: 1, count: 5, ext: false } as Cluster;
  const others = [clusterPick("plain", N, "namespace"), ...readSelection("uses(N.d) and kind(def)")];
  assert.equal(others[1].root, null, "no click makes it");
  assert.equal(followRenames(others, { cluster: "N" }, renamed, has).picks, others);
  assert.equal(followRenames(picks, null, undefined, has).picks, picks);
  // a rename that leads to nothing the graph has (renamed again, then gone): left as it is
  assert.equal(followRenames(picks, null, renamed, (n) => n === "N.t").picks, picks);
  // a loop, as a log edited by hand could make one: no answer, no hang
  assert.equal(followRenames(picks, null, { "N.a": "N.d", "N.d": "N.a" }, (n) => n === "N.t").picks, picks);
});

test("the page follows a rename of what is selected at a new graph and at the move, whichever comes first", () => {
  // the server sends the graph before the move it found (server/live.ts): the page follows at both;
  // the page's wiring is web/src/main.ts and the parts it makes (web/src/page*.ts), where what one
  // part calls of another is the page's (`page.`)
  const web = new URL("../src/web/src/", import.meta.url);
  const main = ["main.ts", ...readdirSync(web).filter((f) => /^page.*\.ts$/.test(f)).sort()].map((f) => readFileSync(new URL(f, web), "utf8")).join("\n");
  const install = main.slice(main.indexOf("const install = async"), main.indexOf("const renderBuild = () => {"));
  assert.match(install, /const followed = (page\.)?followSelection\(\);[^]*await (page\.)?nav\.redraw\(\);[^]*if \(followed\) (page\.)?selectionFollowed\(\);/);
  const changed = main.slice(main.indexOf("const reviewChanged = () => {"), main.indexOf("const takeWhole = "));
  assert.match(changed, /const followed = (page\.)?followSelection\(\);/);
  assert.match(changed, /if \(followed \|\| S\.mode === "keys"/);
  assert.match(changed, /if \(followed\) (page\.)?selectionFollowed\(\);/);
  // and the renames of declarations nothing was said of, in the history alone: asked for at each new
  // build, followed as they come
  const follow = main.slice(main.indexOf("const followSelection = "), main.indexOf("const selectionFollowed = "));
  assert.match(follow, /for \(const \[from, to\] of buildRenames\) if \(!Object\.hasOwn\(renamed, to\)\) renamed\[to\] = from;/);
  assert.match(follow, /fetch\(`\/api\/history\/diff\?from=\$\{from\}&to=\$\{to\}&most=20000`\)/);
  assert.match(follow, /if \(!followSelection\(\)\) return;\s*apply\(\);\s*selectionFollowed\(\);/);
  assert.match(main, /newBuild: \(from, to\) => void (page\.)?newBuild\(from, to\),/);
});
