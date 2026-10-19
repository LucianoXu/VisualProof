// A TCB's size counts what is not trusted (TCBSpec decision 7, the owner's decision of 2026-10-17):
// the trusted declarations stay in the TCB and are lit, but the panel's counts, the selection bar
// (ViewSpec decision 14) and the tour's TCB step tell them apart as "+N trusted", never adding them
// in — and the tour's numbers are the bar's.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { evaluate } from "../src/shared/query.ts";
import { emptyReview, record } from "../src/shared/review.ts";
import type { ReviewData, ReviewOp } from "../src/shared/review.ts";
import { trustSplit } from "../src/shared/reviewqueue.ts";
import { ALL_SITES, Graph } from "../src/shared/viewgraph.ts";
import { keysText, restsOnCounts, tcbText } from "../src/web/src/guide.ts";
import type { RestsOn } from "../src/web/src/guide.ts";
import { Panel } from "../src/web/src/panel.ts";
import type { PanelHooks } from "../src/web/src/panel.ts";
import type { ReviewBox } from "../src/web/src/reviewbox.ts";
import { SelectionBar } from "../src/web/src/selbar.ts";
import type { LitCount } from "../src/web/src/selbar.ts";
import { declPick } from "../src/web/src/selection.ts";

/** N.t's statement uses N.a and N.b, its proof Mathlib.P; N.a's body uses N.c, its statement
 *  Mathlib.X and an axiom of Mathlib's that is not standard; N.b uses Mathlib.Y, Other.Z (outside,
 *  and not trusted) and propext. The review trusts N.c besides the defaults. */
function world(): { g: Graph; d: ReviewData; at: (n: string) => number } {
  const project = ["N.t", "N.a", "N.b", "N.c"];
  const outside: [string, string, string][] = [
    ["Mathlib.X", "Mathlib.Algebra.X", "def"],
    ["Mathlib.Y", "Mathlib.Order.Y", "def"],
    ["Other.Z", "Other.Z", "def"],
    ["propext", "Init.Core", "axiom"],
    ["Mathlib.bad", "Mathlib.Logic.Bad", "axiom"],
    ["Mathlib.P", "Mathlib.Data.P", "theorem"],
  ];
  const nodes: ViewNode[] = [
    ...project.map((name) => ({ name, kind: name === "N.t" ? "theorem" : "def", module: "N", ax: 0, hash: `h-${name}` })),
    ...outside.map(([name, module, kind]) => ({ name, kind, module, ax: 0 })),
  ] as ViewNode[];
  const names = nodes.map((v) => v.name);
  const at = (n: string) => names.indexOf(n);
  const edges: number[] = [];
  const use = (u: string, v: string, site: number) => edges.push(at(u), at(v), site);
  use("N.t", "N.a", SITE_STMT);
  use("N.t", "N.b", SITE_STMT);
  use("N.t", "Mathlib.P", SITE_PROOF);
  use("N.a", "N.c", SITE_BODY);
  use("N.a", "Mathlib.X", SITE_STMT);
  use("N.a", "Mathlib.bad", SITE_STMT);
  use("N.b", "Mathlib.Y", SITE_STMT);
  use("N.b", "Other.Z", SITE_STMT);
  use("N.b", "propext", SITE_BODY);
  const meta = { nodes, projectCount: project.length, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: edges.length / 3 } as unknown as ViewMeta;
  const d = emptyReview();
  record(d, { op: "trust", prefix: "N.c", on: true, by: "Alice" } as ReviewOp, "tc", "2026-10-17T00:00:00Z");
  return { g: new Graph(meta, new Int32Array(edges)), d, at };
}

/** What a tool lights on a whole board, clicking N.t. */
const lit = (g: Graph, d: ReviewData, tool: "tcb" | "deps" | "keys") => evaluate(declPick(tool, "N.t", "N.t").q, { g, review: d });

test("a TCB's size counts what needs review — the project's, an untrusted outside one, a non-standard axiom — the trusted apart", () => {
  const { g, d, at } = world();
  const tcb = g.reach([at("N.t")], SITE_STMT | SITE_BODY, "out");
  // N.a, N.b, Other.Z, Mathlib.bad; then N.c (trusted by the review), Mathlib.X, Mathlib.Y, propext
  assert.deepEqual(trustSplit(g, d, tcb, at("N.t")), { counted: 4, trusted: 4 });
  assert.deepEqual(trustSplit(g, d, tcb), { counted: 5, trusted: 4 }, "the theorem itself, where it is not left out");
  // what it uses: Mathlib.P besides, used in its proof and trusted
  assert.deepEqual(trustSplit(g, d, g.reach([at("N.t")], ALL_SITES, "out"), at("N.t")), { counted: 4, trusted: 5 });
  // trust taken off N.c: it counts again
  record(d, { op: "trust", prefix: "N.c", on: false, by: "Alice" } as ReviewOp, "tc", "2026-10-17T00:00:01Z");
  assert.deepEqual(trustSplit(g, d, tcb, at("N.t")), { counted: 5, trusted: 3 });
});

/** Just enough of an element for the selection bar: its HTML, whether it is hidden. */
const barEl = () => ({ innerHTML: "", hidden: true, addEventListener: () => {} });
const bar = (lit: LitCount) => {
  const el = barEl();
  const sb = new SelectionBar(el as unknown as HTMLElement, { show: () => {}, remove: () => {}, zoom: () => {}, canOpenViews: () => true, clear: () => {}, markKeys: () => {} });
  sb.render([declPick("tcb", "N.t")], 0, lit, true);
  return el.innerHTML;
};
/** The bar's numbers, as a reader sees them. */
const barSays = (html: string) => html.replace(/<[^>]*>/g, "").match(/[\d,]+ lit( · \+[\d,]+ trusted)?/)?.[0];

test("the selection bar counts what is lit and not trusted, the trusted lit told apart, each with a title that says so", () => {
  const html = bar({ counted: 8, trusted: 11 });
  assert.equal(barSays(html), "8 lit · +11 trusted");
  assert.match(html, /title="Declarations lit on this board that are not trusted">8 lit</);
  assert.match(html, /title="Trusted declarations lit too: assumed without review, and not counted[^"]*"> · \+11 trusted</);
  // nothing trusted lit: the count alone
  assert.equal(barSays(bar({ counted: 3, trusted: 0 })), "3 lit");
  assert.doesNotMatch(bar({ counted: 3, trusted: 0 }), /trusted<\/span>/);
  // all of it trusted: nothing to read, said as such
  assert.equal(barSays(bar({ counted: 0, trusted: 2 })), "0 lit · +2 trusted");
  assert.equal(barSays(bar({ counted: 1234, trusted: 5678 })), "1,234 lit · +5,678 trusted");
});

test("the panel's Counts: in TCB what is not trusted, +N trusted beneath, uses the same; Its TCB lists what is counted", () => {
  const { g, d, at } = world();
  const el = { innerHTML: "", scrollTop: 0, classList: { add: () => {}, remove: () => {}, contains: () => false }, addEventListener: () => {}, querySelector: () => null };
  const box = { html: () => "", reveal: () => {} } as unknown as ReviewBox;
  const hooks = new Proxy({ reviewData: () => d, queue: () => null, listOrder: () => "kind", shut: () => false, editorLink: () => null, alsoHere: () => "", why: () => "", isPinned: () => false, fileOf: () => undefined } as Partial<PanelHooks>, {
    get: (o, k) => (k in o ? o[k as keyof PanelHooks] : () => undefined),
  }) as PanelHooks;
  const doc = globalThis as unknown as { document?: unknown };
  const was = doc.document;
  doc.document = { activeElement: null };
  try {
    new Panel(el as unknown as HTMLElement, g, box, hooks).show(at("N.t"));
  } finally {
    doc.document = was;
  }
  const text = el.innerHTML.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /Counts 4 in TCB · 4 uses · 0 used by/);
  assert.match(text, / 4 in TCB \+4 trusted /);
  assert.match(text, / 4 uses \+5 trusted /);
  assert.doesNotMatch(el.innerHTML, /external<\/span>/, "no longer split by where");
  assert.match(el.innerHTML, /<span class="muted" title="Trusted without review, and not counted[^"]*">\+4 trusted<\/span>/);
  // Its TCB: the four counted, by kind — N.c, Mathlib's and propext not among them
  assert.match(text, /Its TCB 4 /);
  const listed = [...el.innerHTML.matchAll(/<button class="row [^"]*" data-go="(\d+)"/g)].map((m) => g.nodes[Number(m[1])].name).sort();
  assert.deepEqual(listed, ["Mathlib.bad", "N.a", "N.b", "Other.Z"]);
});

test("the tour's TCB step says the selection bar's numbers: it and what is to be read, then the trusted", () => {
  const { g, d, at } = world();
  record(d, { op: "target", name: "N.t", on: true, by: "Alice" } as ReviewOp, "tc", "2026-10-17T00:00:02Z");
  record(d, { op: "key", target: "N.t", name: "N.a", on: true, by: "Alice" } as ReviewOp, "tc", "2026-10-17T00:00:03Z");
  // a mark on what the review trusts lights too, told apart (the owner's decision of 2026-10-19)
  record(d, { op: "key", target: "N.t", name: "N.c", on: true, by: "Alice" } as ReviewOp, "tc", "2026-10-17T00:00:04Z");
  const views = { tcb: lit(g, d, "tcb"), uses: lit(g, d, "deps"), keys: lit(g, d, "keys") };
  const r: RestsOn = { name: "t", ...restsOnCounts(g, d, at("N.t"), views), target: true };
  assert.deepEqual(
    { self: r.self, read: r.read, assumed: r.assumed, proofs: r.proofs, keys: r.keys, trustedKeys: r.trustedKeys },
    { self: "read", read: 4, assumed: 4, proofs: 1, keys: 1, trustedKeys: 1 },
  );
  // the TCB view: the bar beside it says 5 lit · +4 trusted, and so does the card
  const tcbBar = trustSplit(g, d, views.tcb);
  assert.equal(barSays(bar(tcbBar)), "5 lit · +4 trusted");
  const words = tcbText(r).replace(/<[^>]*>/g, "");
  assert.equal(
    words,
    "Its TCB lights 5: it, and 4 declarations to read — definitions, axioms, the project's notation. The 4 trusted, as Mathlib is, light too, and are assumed. To trust it, read those 4. What its proofs alone use, 1 more, is not lit: the proofs are Lean's to check.",
  );
  assert.ok(words.includes(`lights ${tcbBar.counted}:`) && words.includes(`The ${tcbBar.trusted} trusted`));
  // the Keys view: the bar says 2 lit (it and N.a) · +1 trusted (N.c), the card the one key among the
  // 4 to read, then the trusted one
  assert.equal(barSays(bar(trustSplit(g, d, views.keys))), "2 lit · +1 trusted");
  assert.equal(
    keysText(r).replace(/<[^>]*>/g, ""),
    "Of the 4 declarations to read, the one the review marked key: what carries its meaning. Read it first. One more is key and trusted: read for what it means, in need of no review.",
  );
  assert.equal(keysText({ ...r, keys: 0 }).replace(/<[^>]*>/g, ""), "The review marked key one declaration it rests on, trusted: what carries its meaning, in need of no review. Read it first.");
  assert.equal(keysText({ ...r, trustedKeys: 0 }).replace(/<[^>]*>/g, ""), "Of the 4 declarations to read, the one the review marked key: what carries its meaning. Read it first.");
});

test("the tour's TCB step where the bar counts otherwise: nothing to read, the theorem trusted itself, one alone", () => {
  const base: RestsOn = { name: "t", self: "read", read: 0, assumed: 0, proofs: 0, keys: 0, target: false };
  const say = (o: Partial<RestsOn>) => tcbText({ ...base, ...o }).replace(/<[^>]*>/g, "");
  assert.equal(say({}), "Its TCB is itself alone: its statement rests on nothing but Lean.");
  // bar: 1 lit · +11 trusted
  assert.equal(say({ assumed: 11 }), "Its TCB lights it alone to read: the 11 it rests on are trusted, as Mathlib is, and assumed.");
  // bar: 2 lit · +1 trusted
  assert.equal(say({ read: 1, assumed: 1 }), "Its TCB lights 2: it, and 1 declaration to read — definitions, axioms, the project's notation. The one trusted, as Mathlib is, lights too, and is assumed. To trust it, read that one.");
  // bar: 8 lit, nothing trusted
  assert.equal(say({ read: 7 }), "Its TCB lights 8: it, and 7 declarations to read — definitions, axioms, the project's notation. To trust it, read those 7.");
  // a theorem of Mathlib's selected — bar: 0 lit · +4 trusted; or with one of the project's read
  assert.equal(say({ self: "trusted", assumed: 3 }), "Its TCB lights nothing to read, and 4 trusted, it among them, as Mathlib is, and assumed.");
  assert.equal(say({ self: "trusted", read: 1, assumed: 3 }), "Its TCB lights 1 declaration to read, and 4 trusted, it among them, as Mathlib is, and assumed. To trust it, read that one.");
});

test("a target whose TCB counts nothing still lists its review: what its proofs rest on needs review too", () => {
  // N.u's statement uses Mathlib.X alone, trusted; its proof rests on Mathlib.bad, an axiom that is not
  // standard: its TCB counts nothing, its review holds it and the axiom (ReviewSpec decision 3)
  const { g, d, at } = world();
  const u = g.nodes.length;
  const meta = { ...g.meta, nodes: [...g.nodes, { name: "N.u", kind: "theorem", module: "N", ax: 0, hash: "h-N.u" }] } as unknown as ViewMeta;
  const edges: number[] = [];
  for (let i = 0; i < g.n; i++) for (let e = g.outStart[i]; e < g.outStart[i + 1]; e++) edges.push(i, g.outDst[e], g.outSite[e]);
  edges.push(u, at("Mathlib.X"), SITE_STMT, u, at("Mathlib.bad"), SITE_PROOF);
  const g2 = new Graph({ ...meta, edgeCount: edges.length / 3 } as ViewMeta, new Int32Array(edges));
  const show = (order: "review" | "kind", target: boolean) => {
    const el = { innerHTML: "", scrollTop: 0, classList: { add: () => {}, remove: () => {}, contains: () => false }, addEventListener: () => {}, querySelector: () => null };
    const box = { html: () => "", reveal: () => {} } as unknown as ReviewBox;
    const hooks = new Proxy({ reviewData: () => d, queue: () => (target ? `<div class="q-list">axiom Mathlib.bad · used in N.u</div>` : null), listOrder: () => order, shut: () => false, editorLink: () => null, alsoHere: () => "", why: () => "", isPinned: () => false, fileOf: () => undefined } as Partial<PanelHooks>, {
      get: (o, k) => (k in o ? o[k as keyof PanelHooks] : () => undefined),
    }) as PanelHooks;
    const doc = globalThis as unknown as { document?: unknown };
    const was = doc.document;
    doc.document = { activeElement: null };
    try {
      new Panel(el as unknown as HTMLElement, g2, box, hooks).show(u);
    } finally {
      doc.document = was;
    }
    return el.innerHTML;
  };
  assert.deepEqual(trustSplit(g2, d, g2.reach([u], SITE_STMT | SITE_BODY, "out"), u), { counted: 0, trusted: 1 });
  // not a target: nothing to list
  assert.doesNotMatch(show("review", false), /Its TCB/);
  // a target: its review list, in review order, the axiom first
  const html = show("review", true);
  assert.match(html, /Its TCB.*0 · in review order/s);
  assert.match(html, /axiom Mathlib\.bad · used in N\.u/);
  // by kind: its TCB, which holds nothing to read, says so
  assert.match(show("kind", true).replace(/<[^>]*>/g, " "), /Nothing in its TCB is to be read: all of it is trusted\./);
});
