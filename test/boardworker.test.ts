// A board of the latest build that the page lays out (a view of a part of the project: Zoom in, a
// target's, one nobody keeps) is laid out off the page's thread, by the worker the Time Machine lays
// out past boards with (web/src/layoutworker.ts; the owner's decision of 2026-10-18), and comes out
// as it did on the page's thread (shared/board.ts, boardLayout), the memory handed over too. The
// board on show stays meanwhile; a board no step goes to any more is never shown — a later step, or
// the reader staying where they are (back to a place of the board on show) — and its layout, given
// up, is no fault. While the step waits, the tabs carry the Time Machine's busy mark.

import assert from "node:assert/strict";
import { test } from "node:test";
import { boardLayout, boardSet } from "../src/shared/board.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_BODY, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { parseQuery } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { ViewBook } from "../src/shared/views.ts";
import type { ViewData } from "../src/shared/views.ts";
import { layOut } from "../src/web/src/layoutworker.ts";
import type { LayoutAsk } from "../src/web/src/layoutworker.ts";
import { Skipped } from "../src/web/src/layoutqueue.ts";
import { BUSY_AFTER_MS, Tabs } from "../src/web/src/tabs.ts";
import { layoutAsk, Views } from "../src/web/src/views.ts";
import { ViewNav } from "../src/web/src/viewnav.ts";
import { Store } from "../src/web/src/store.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Ask = Omit<LayoutAsk, "id">;

/** A project of a few hundred declarations in nested namespaces, with edges within and across them:
 *  enough sub-clusters, declarations and dependencies for every part of the layout to work. */
function world(): { g: Graph; meta: ViewMeta } {
  const nodes: ViewNode[] = [];
  for (const a of ["A", "B", "C"])
    for (const b of ["P", "Q", "R", "S"])
      for (const c of ["x", "y", "z"]) for (let k = 0; k < 9; k++) nodes.push({ name: `${a}.${b}.${c}.d${k}`, kind: k % 3 ? "def" : "theorem", module: `M.${a}.${b}`, ax: 0, hash: `h${nodes.length}` });
  for (let k = 0; k < 7; k++) nodes.push({ name: `${k % 2 ? "B" : "A"}.top${k}`, kind: "def", module: "M.Top", ax: 0, hash: `t${k}` });
  const projectCount = nodes.length;
  for (let k = 0; k < 12; k++) nodes.push({ name: `Mathlib.E${k % 3}.e${k}`, kind: "def", module: `Mathlib.E${k % 3}`, ax: 0, ext: true });
  const edges: number[] = [];
  let seed = 11;
  const rand = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % n);
  for (let u = 0; u < projectCount; u++) for (let j = 0; j < 4; j++) edges.push(u, rand(j === 3 ? nodes.length : projectCount), j % 2 ? SITE_BODY : SITE_STMT);
  const E = Int32Array.from(edges);
  const meta = {
    schema: 1, layoutVersion: LAYOUT_VERSION,
    project: { name: "world", root: "/nowhere", roots: ["A"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [], nodes, projectCount, axioms: [], axiomSets: [[]],
    layouts: { namespace: computeLayout("namespace", nodes, E), module: computeLayout("module", nodes, E) } as Record<ClusterMode, Layout>,
    edgeCount: E.length / 3,
  } as unknown as ViewMeta;
  return { g: new Graph(meta, E), meta };
}

/** The views as the page holds them, of one view `rec`, with a server that takes every memory. */
function pageViews(W: ReturnType<typeof world>, recs: ViewData[], layOutHook?: (id: string, ask: () => Ask) => Promise<Layout>) {
  const posted: Json[] = [];
  const memories = new Map<string, Json>();
  const api = {
    list: async () => [],
    get: async (id: string) => ({ view: recs.find((r) => r.id === id)!, memory: { namespace: memories.get(`${id}:namespace`)?.set ?? null } }),
    memory: async (id: string, mode: string) => memories.get(`${id}:${mode}`) ?? null,
    post: async (action: string, body: Json) => {
      posted.push({ action, ...body });
      if (action === "memory") memories.set(`${body.id}:${body.mode}`, body.memory);
      return action === "memory" ? { accepted: true } : { ok: true };
    },
  };
  const views = new Views(api as never, { graph: () => W.g, meta: () => W.meta, review: () => emptyReview(), ...(layOutHook ? { layOut: layOutHook } : {}) });
  return { views, posted, memories };
}

/** As the worker does it: the ask and the layout through postMessage's structured clone. */
const inWorker = async (_id: string, ask: () => Ask): Promise<Layout> => structuredClone(layOut(structuredClone(ask())));

test("a board laid out in the worker is the board laid out on the page's thread: from nothing, from a memory, with levels hidden, the memory handed over the same", async () => {
  const W = world();
  const book = new ViewBook();
  const rec = book.open(parseQuery("ns(A) or ns(B.Q)"), null).view;
  for (const hidden of [[], ["A.Q"]]) {
    rec.hidden.namespace = hidden;
    const here = pageViews(W, [rec]);
    const away = pageViews(W, [rec], inWorker);
    for (const P of [here, away]) await P.views.record(rec.id);
    const [bh, ba] = [here.views.board(rec.id)!, away.views.board(rec.id)!];
    const [Lh, La] = [await here.views.layout(bh, "namespace"), await away.views.layout(ba, "namespace")];
    assert.ok(La.clusters.length > 10 && La.x.length > 130, "a board of some size");
    assert.deepEqual(La, Lh, `the same layout, hiding ${JSON.stringify(hidden)}`);
    const memory = (P: typeof here) => P.posted.filter((p) => p.action === "memory").map((p) => p.memory);
    assert.deepEqual(memory(away), memory(here), "the same memory handed over");
    assert.equal(memory(away).length, 1);
    // and as boardLayout makes it, which the page's thread runs
    assert.deepEqual(La, boardLayout(ba.graph, "namespace", ba.bs.key, null, hidden).layout);
  }
  // from a memory of another set (the view's scope widened): what both hold stays where it was
  rec.hidden.namespace = [];
  const narrow = boardSet(W.g, emptyReview(), parseQuery("ns(A)"));
  const before = boardLayout(narrow.sub!.graph, "namespace", narrow.key, null, []).next!;
  const here = pageViews(W, [rec]);
  const away = pageViews(W, [rec], inWorker);
  for (const P of [here, away]) {
    P.memories.set(`${rec.id}:namespace`, before);
    await P.views.record(rec.id);
  }
  const ask = layoutAsk(away.views.board(rec.id)!.graph, "namespace", [], before);
  assert.equal(ask.mem, before.mem, "the memory goes to the worker");
  const [La, Lh] = [await away.views.layout(away.views.board(rec.id)!, "namespace"), await here.views.layout(here.views.board(rec.id)!, "namespace")];
  assert.deepEqual(La, Lh);
  // laid out from it, not afresh
  assert.notDeepEqual(La, boardLayout(away.views.board(rec.id)!.graph, "namespace", away.views.board(rec.id)!.bs.key, null, []).layout);
});

/** A layout the test answers when it likes: each asked is kept, with its view. */
function heldLayouts() {
  const asked: { id: string; ask: () => Ask; ok(L: Layout): void; no(e: Error): void }[] = [];
  const hook = (id: string, ask: () => Ask) => new Promise<Layout>((ok, no) => asked.push({ id, ask, ok, no }));
  const answer = (id: string) => {
    const k = asked.findIndex((a) => a.id === id);
    if (k < 0) throw new Error(`no layout of ${id} asked: ${asked.map((a) => a.id).join(", ")}`);
    const [a] = asked.splice(k, 1);
    a.ok(layOut(a.ask()));
  };
  const skip = (id: string) => {
    const k = asked.findIndex((a) => a.id === id);
    const [a] = asked.splice(k, 1);
    a.no(new Skipped());
  };
  return { asked, hook, answer, skip };
}

const settle = () => new Promise((ok) => setTimeout(ok, 20));

test("the board on show stays while another is laid out; one no step goes to any more is never shown, given up or not", async () => {
  const W = world();
  const book = new ViewBook();
  const x = book.open(parseQuery("ns(A)"), null).view;
  const y = book.open(parseQuery("ns(B)"), null).view;
  const z = book.open(parseQuery("ns(C)"), null).view;
  const v = book.open(parseQuery("ns(A.P)"), null).view;
  const w = book.open(parseQuery("ns(B.P)"), null).view;
  const H = heldLayouts();
  const recs = [x, y, z, v, w];
  const { views } = pageViews(W, recs, H.hook);
  const shown: string[] = [];
  const nav = new ViewNav(views, new Store("/nowhere"), { show: (b) => shown.push(b.id), place: () => {}, here: () => ({ cam: null, mode: "plain", picks: null, shown: null }), changed: () => {} });
  // x laid out and shown
  const toX = nav.show(x.id);
  await settle();
  assert.deepEqual([H.asked.map((a) => a.id), nav.aimed], [[x.id], x.id]);
  H.answer(x.id);
  assert.equal(await toX, true);
  assert.deepEqual([shown, nav.aimed], [[x.id], null]);
  // y asked, then z before y is laid out: x stays on show, y never shows, z does
  const toY = nav.show(y.id);
  await settle();
  const toZ = nav.show(z.id);
  await settle();
  assert.deepEqual([nav.board.id, nav.aimed, shown], [x.id, z.id, [x.id]], "x on show meanwhile");
  H.answer(z.id);
  assert.equal(await toZ, true);
  H.answer(y.id);
  assert.equal(await toY, false);
  assert.deepEqual(shown, [x.id, z.id], "y's board, laid out after z's, is not shown");
  // given up (the queue dropped it as nobody's): no fault, nothing shown
  const toV = nav.show(v.id);
  await settle();
  H.skip(v.id);
  assert.equal(await toV, false);
  assert.deepEqual([shown, nav.board.id], [[x.id, z.id], z.id]);
  // the reader stays where they are (back to a place of the board on show): the step is given up
  const toW = nav.show(w.id);
  await settle();
  assert.equal(nav.aimed, w.id);
  nav.stay();
  assert.equal(nav.aimed, null);
  H.answer(w.id);
  assert.equal(await toW, false);
  assert.deepEqual([shown, nav.board.id], [[x.id, z.id], z.id], "no flash of w");
  // staying on a board with no step on its way changes nothing
  nav.stay();
  assert.equal(await nav.show(z.id), true);
  // a new graph while a board is laid out: its board is made anew, and that one is shown, recalled
  // from the memory the first handed over
  const shownBoards: unknown[] = [];
  const nav2 = new ViewNav(views, new Store("/nowhere"), { show: (b) => shownBoards.push(b), place: () => {}, here: () => ({ cam: null, mode: "plain", picks: null, shown: null }), changed: () => {} });
  const u = book.open(parseQuery("ns(C.P)"), null).view;
  recs.push(u);
  const toU = nav2.show(u.id);
  await settle();
  const old = views.board(u.id);
  views.graphChanged();
  H.answer(u.id);
  assert.equal(await toU, true);
  assert.deepEqual(H.asked, [], "not laid out again");
  assert.equal(shownBoards.length, 1);
  assert.notEqual(shownBoards[0], old);
  assert.equal(shownBoards[0], views.board(u.id));
});

test("while a step waits for its board, the tabs carry the Time Machine's busy mark, a moment after it starts; a quick one never blinks it", async () => {
  /** an element as the tabs write it */
  const el = () => {
    const classes = new Set<string>();
    const attrs: Record<string, string> = {};
    return { innerHTML: "", hidden: true, classes, attrs, classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) }, setAttribute: (k: string, v: string) => (attrs[k] = v), addEventListener() {}, querySelector: () => null };
  };
  const g = globalThis as Record<string, unknown>;
  g.window ??= { addEventListener() {} };
  const [bar, btn, menu] = [el(), el(), el()];
  const tabs = new Tabs(bar as never, btn as never, menu as never, {
    tabs: () => [{ id: "project" }], active: () => "project", title: () => "Project", summary: () => undefined, list: () => [], select() {}, close() {},
    create: async () => null, duplicate: async () => null, rename: async () => null, remove: async () => null, readOnly: () => false,
  } as never);
  tabs.render();
  assert.equal(bar.classes.has("busy"), false);
  // quick: done before the mark would show
  tabs.busy(true);
  tabs.busy(false);
  await new Promise((ok) => setTimeout(ok, BUSY_AFTER_MS + 50));
  assert.equal(bar.classes.has("busy"), false);
  assert.doesNotMatch(bar.innerHTML, /tm-wait/);
  // long: the mark, where the view's tab will be, and aria-busy
  tabs.busy(true);
  await new Promise((ok) => setTimeout(ok, BUSY_AFTER_MS + 50));
  assert.equal(bar.classes.has("busy"), true);
  assert.equal(bar.attrs["aria-busy"], "true");
  assert.match(bar.innerHTML, /data-tab="project"[\s\S]*class="tab tab-wait tm-wait"[\s\S]*laying out/);
  tabs.busy(false);
  assert.equal(bar.classes.has("busy"), false);
  assert.doesNotMatch(bar.innerHTML, /tm-wait/);
});
