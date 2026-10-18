// What a board shows (ViewSpec decision 2): the declarations its scope holds, laid out by the same
// rules as the whole project. A scope that holds every declaration of the project is shown on the
// server's own layout, with the outside world or without it; any other is taken out of the graph
// and laid out on its own (CanvasSpec, "Navigation", implementation notes).
//
// A board is shared, so its picture must be the same on every page that shows it and stay put
// when its set changes. The layout of a set is a function of the set (shared/layout.ts); what is
// kept between sets is the layout's memory (shared/layout.ts `stabilize`), and that memory is the
// board's, kept by the server per view and way of clustering together with the set it was made
// for. A page that finds the memory made for the set it shows recalls that layout exactly; one
// whose set changed lays it out again from the memory, keeping in place what stays, and hands the
// new memory to the server. Pages that start from the same memory and the same set come to the
// same picture, so whichever hands it over first, they agree. The server and the agents' API read
// boards the same way.
//
// A board may hide levels of its cluster tree, per way of clustering (ViewSpec decision 24). A
// board laid out on its own is laid out with them taken out, and its memory is made for its set
// under those levels (`layoutKey`): hiding or showing one starts from the memory before and keeps
// everything in place (shared/layout.ts, `regroup`), so a Re-layout is what packs the flattened
// tree afresh. A whole-project board stays the server's layout, its hidden circles taken out
// (`wholeLayout`): computed the same on every page from what they all have, it keeps no memory.
// Pins are places in their parent's circle, so the pins of what a level hidden or shown gives
// another parent are moved into that parent's coordinates, at the same place (`reframePins`).
//
// What a selection lights up on a board is computed on the whole graph and then cut to what the
// board holds (the owner's decision, 2026-10-08): a board's own graph keeps only the edges among its
// members, and a path through a declaration it leaves out — a lemma used only in a proof, a trusted
// definition on a board of a target's review set — is still a path. So what is lit is exactly what a view of it holds
// (`lightUp`, `zoomScope`), and Zoom in shows what was lit.

import type { ClusterMode, Layout, ViewMeta, ViewNode } from "./graph.ts";
import { clusterTree, computeLayout, memoryOf, regroup, stabilize, withLocal } from "./layout.ts";
import { hypot } from "./libm.ts";
import type { LayoutMemory } from "./layout.ts";
import type { PlaceOp, Pins } from "./places.ts";
import { evaluate, within } from "./query.ts";
import type { Query } from "./query.ts";
import type { ReviewData } from "./review.ts";
import { Graph } from "./viewgraph.ts";

/** Part of a graph as a graph of its own, with maps between the two numberings. */
export interface Sub {
  graph: Graph;
  /** sub node → whole-graph node */
  toFull: Int32Array;
  /** whole-graph node → sub node, or -1 */
  toSub: Int32Array;
}

/** The declarations `set` holds, as a graph of their own (edges among them only). */
export function subgraph(g: Graph, set: Uint8Array): Sub {
  // whole-graph order keeps the project's declarations before the outside world, as Graph expects
  const toFull: number[] = [];
  const toSub = new Int32Array(g.n).fill(-1);
  let projectCount = 0;
  for (let i = 0; i < g.n; i++) {
    if (!set[i]) continue;
    toSub[i] = toFull.length;
    toFull.push(i);
    if (i < g.projectCount) projectCount++;
  }
  const edges: number[] = [];
  for (const u of toFull) {
    for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
      const v = g.outDst[e];
      if (toSub[v] >= 0) edges.push(toSub[u], toSub[v], g.outSite[e]);
    }
  }
  const meta: ViewMeta = {
    ...g.meta,
    nodes: toFull.map((i) => g.nodes[i]),
    projectCount,
    edgeCount: edges.length / 3,
    layouts: {} as Record<ClusterMode, Layout>,
  };
  const sub = new Graph(meta, new Int32Array(edges));
  // the other names a declaration answers to (a past graph's: its name now, web/src/past.ts) go with
  // it
  for (const [name, i] of g.byName) if (toSub[i] >= 0 && g.nodes[i].name !== name && !sub.byName.has(name)) sub.byName.set(name, toSub[i]);
  return { graph: sub, toFull: Int32Array.from(toFull), toSub };
}

/** A graph's edges as the layout reads them: (source, target, site) triples. */
export function edgesOf(g: Graph): Int32Array {
  const edges = new Int32Array(3 * g.outDst.length);
  let k = 0;
  for (let u = 0; u < g.n; u++) {
    for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
      edges[k++] = u;
      edges[k++] = g.outDst[e];
      edges[k++] = g.outSite[e];
    }
  }
  return edges;
}

/** A short key for a set of declarations, by their names: the same set gives the same key on
 *  every page and on the server, whatever the numbering. */
export function setKey(g: Graph, set: Uint8Array): string {
  let sum = 0, mix = 0, count = 0;
  for (let i = 0; i < g.n; i++) {
    if (!set[i]) continue;
    count++;
    // two FNV-1a hashes of the name, combined so that the order does not matter
    let h1 = 2166136261, h2 = 374761393;
    for (const ch of g.nodes[i].name) {
      const c = ch.codePointAt(0)!;
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ c, 2246822519);
    }
    sum = (sum + (h1 >>> 0)) >>> 0;
    mix = (mix ^ Math.imul(h2, 3266489917)) >>> 0;
  }
  return `${count}.${sum.toString(36)}.${mix.toString(36)}`;
}

/** What a scope holds in a graph, and how it is shown. */
export interface BoardSet {
  /** per whole-graph node */
  set: Uint8Array;
  key: string;
  count: number;
  /** every declaration of the project: shown on the server's layout */
  whole: boolean;
  /** (whole) the outside world is on it */
  outside: boolean;
  /** (not whole) the set as a graph of its own */
  sub: Sub | null;
}

/** The board a scope makes of a graph and a review. A scope holding the whole project and either
 *  all of the outside world or none of it is the server's layout; anything else is laid out on its
 *  own. */
export function boardSet(g: Graph, review: ReviewData, scope: Query): BoardSet {
  const set = evaluate(scope, { g, review });
  let own = 0, ext = 0;
  for (let i = 0; i < g.n; i++) if (set[i]) i < g.projectCount ? own++ : ext++;
  const outsideAll = ext === g.n - g.projectCount;
  const whole = own === g.projectCount && g.projectCount > 0 && (ext === 0 || outsideAll);
  return { set, key: setKey(g, set), count: own + ext, whole, outside: whole && ext > 0, sub: whole ? null : subgraph(g, set) };
}

/** What a selection lights up on a board. */
export interface Lit {
  /** per node of the board's graph (the whole graph's numbering on a whole board) */
  set: Uint8Array;
  /** how many are lit */
  count: number;
  /** the query holds nothing the board leaves out, so a view of it needs none of the board's
   *  conditions */
  inside: boolean;
}

/** What query `q` lights up on board `bs` of graph `g` (the graph the board was taken from): the
 *  query's set in the whole graph, then what of it the board holds — never the outside world on a
 *  board without it. */
export function lightUp(g: Graph, review: ReviewData, bs: BoardSet, q: Query): Lit {
  const full = evaluate(q, { g, review });
  let total = 0, count = 0;
  if (!bs.sub) {
    // the whole graph is the board's: cut in place what its scope leaves out
    const every = bs.count === g.n;
    for (let i = 0; i < g.n; i++) {
      if (!full[i]) continue;
      total++;
      if (every || bs.set[i]) count++;
      else full[i] = 0;
    }
    return { set: full, count, inside: count === total };
  }
  const { toFull } = bs.sub;
  const set = new Uint8Array(toFull.length);
  for (let i = 0; i < g.n; i++) total += full[i];
  for (let j = 0; j < toFull.length; j++) {
    if (!full[toFull[j]]) continue;
    set[j] = 1;
    count++;
  }
  return { set, count, inside: count === total };
}

/** The scope of a view of what `q` lights up on a board of scope `scope` (Zoom in, ViewSpec
 *  decision 13): the query among what the board holds — its whole scope, so that the view holds
 *  exactly what was lit, on a board of a target's review set what is in the target's TCB — or the query alone where it
 *  holds nothing the board leaves out. Null when that view would hold nothing, or just what the
 *  board holds: the sets are compared, not the texts, so a view of the selection does not offer
 *  itself again. */
export function zoomScope(q: Query, scope: Query, lit: Lit, bs: BoardSet): Query | null {
  // what is lit lies within the board: as many as the board holds is the board itself
  if (!lit.count || lit.count === bs.count) return null;
  return lit.inside ? q : within(q, scope);
}

/** The layout's memory as the server keeps it for a view and a way of clustering: the memory, and
 *  the set (setKey) it was made for. */
export interface BoardMemory {
  set: string;
  mem: LayoutMemory;
}

/** The key a board's layout memory is made for: the set it holds (setKey) and, where any, the levels
 *  it hides by that clustering — a memory made under other hidden levels is not recalled, and is
 *  handed over anew. Without hidden levels it is the set's key alone, as memories were before. */
export function layoutKey(set: string, hidden: readonly string[]): string {
  if (!hidden.length) return set;
  let h1 = 2166136261, h2 = 374761393;
  for (const ch of [...new Set(hidden)].sort().join("\n")) {
    const c = ch.codePointAt(0)!;
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return `${set}~${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`;
}

/** Whether two layout keys are of the same set, whatever levels they hide. */
export const sameSet = (a: string, b: string): boolean => a.split("~")[0] === b.split("~")[0];

/** The key a board of a past build's graph keeps its memory under (HistorySpec decision 19, the
 *  owner's decision of 2026-10-10): its layout key under the snapshot's id, so that the memory of a
 *  past board and that of a board of the latest build are never taken for each other, though they
 *  hold the same names. */
export const pastSetKey = (snapshot: number, key: string): string => `@${snapshot}:${key}`;

/** The snapshot a memory's key says it is of (pastSetKey), or null for the latest build's. */
export function snapshotOfKey(key: string): number | null {
  const m = /^@(\d+):/.exec(key);
  return m ? Number(m[1]) : null;
}

/** The layout `mem` remembers, exactly, where it holds every declaration and cluster of `tree` in
 *  the same cluster; null where it does not. `tree` gives the tree (clusterTree, or a fresh
 *  layout). */
export function recall(tree: Layout, g: Graph, mem: LayoutMemory): Layout | null {
  const clusters = tree.clusters.map((c) => {
    const m = mem.clusters[c.key];
    return m ? { ...c, x: m[0], y: m[1], r: m[2] } : null;
  });
  if (clusters.some((c) => c === null)) return null;
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < g.n; i++) {
    const m = mem.nodes[g.nodes[i].name];
    const c = tree.cluster[i];
    if (!m || m[2] !== (c >= 0 ? tree.clusters[c].key : "")) return null;
    x.push(m[0]);
    y.push(m[1]);
  }
  return withLocal({ x, y, lx: [], ly: [], cluster: tree.cluster, clusters: clusters as Layout["clusters"] });
}

/** A board's layout by `mode`, for the set `set` (setKey) of graph `g` with the levels `hidden`
 *  hidden: recalled from the memory when it was made for this set and these levels; regrouped from
 *  it when only the levels differ (nothing moves); else laid out afresh keeping in place what the
 *  memory holds. `next` is the memory to hand to the server when it changed (null when the memory
 *  already fits). */
export function boardLayout(g: Graph, mode: ClusterMode, set: string, memory: BoardMemory | null, hidden: readonly string[] = []): { layout: Layout; next: BoardMemory | null } {
  const key = layoutKey(set, hidden);
  const quick = recalled(g, mode, key, memory, hidden);
  if (quick) return quick;
  const layout = stabilize(computeLayout(mode, g.nodes, edgesOf(g), hidden), g.nodes, memory?.mem ?? null);
  return { layout, next: { set: key, mem: memoryOf(layout, g.nodes) } };
}

/** The part of boardLayout that lays nothing out: the layout `memory` remembers for `key` (a layout
 *  key, layoutKey or pastSetKey), recalled, or regrouped from it where only the hidden levels differ;
 *  null where the board must be laid out, keeping in place what the memory holds. */
export function recalled(g: Graph, mode: ClusterMode, key: string, memory: BoardMemory | null, hidden: readonly string[]): { layout: Layout; next: BoardMemory | null } | null {
  if (!memory || !(memory.set === key || sameSet(memory.set, key))) return null;
  const tree = clusterTree(mode, g.nodes, hidden);
  const L = memory.set === key ? recall(tree, g, memory.mem) : null;
  if (L) return { layout: L, next: null };
  if (memory.set === key) return null;
  const layout = regroup(tree, g.nodes, memory.mem);
  return { layout, next: { set: key, mem: memoryOf(layout, g.nodes) } };
}

/** A whole-project board with the levels `hidden` hidden: the server's layout `base` of `nodes`,
 *  everything where it is there, the hidden levels' circles taken out (and a level the base has no
 *  circle for drawn round what it holds). Every page computes the same from the same, so it keeps
 *  no memory; Re-layout of the Project lays the base out anew. */
export function wholeLayout(base: Layout, nodes: ViewNode[], mode: ClusterMode, hidden: readonly string[]): Layout {
  if (!hidden.length) return base;
  return regroup(clusterTree(mode, nodes, hidden), nodes, memoryOf(base, nodes), base);
}

/** The pins of a board whose frame a change of hidden levels moves, as operations: a pin is a place
 *  in its parent's coordinates, and a level hidden or shown gives what it holds directly another
 *  parent. Each such pin is put in its new parent's coordinates at the same place on the board, with
 *  the pins along both chains of parents. What is not pinned but would land elsewhere in its new
 *  parent — the members of a level that was dragged, whose layout places are relative to where the
 *  layout put it — is pinned where it is (at most `MAX_REFRAME` of them; beyond that they go to their
 *  layout places). A hidden cluster's own pin is kept, for when it is shown again; what is in a
 *  frame that stays is left alone. `before` and `after` are the board's layouts by `mode` of graph
 *  `g`, under the levels hidden before and after. */
/** the most places a change of hidden levels pins that were not pinned (shared/places.ts takes 2,000
 *  operations at a time) */
export const MAX_REFRAME = 1500;

export function reframePins(g: { n: number; nodes: { name: string }[] }, before: Layout, after: Layout, pins: Pins, mode: ClusterMode): PlaceOp[] {
  const ops: PlaceOp[] = [];
  const byKey = (L: Layout) => new Map(L.clusters.map((c, k) => [c.key, k]));
  const kb = byKey(before);
  // where each cluster of `before` is on the board, its pins applied along its chain
  const wb = new Map<number, [number, number]>();
  const worldB = (c: number): [number, number] => {
    if (c < 0) return [0, 0];
    let w = wb.get(c);
    if (!w) {
      const cl = before.clusters[c];
      const [px, py] = worldB(cl.parent);
      const [x, y] = pins.clusters[cl.key] ?? [cl.lx, cl.ly];
      wb.set(c, (w = [px + x, py + y]));
    }
    return w;
  };
  const r = (v: number) => Math.round(v * 10) / 10;
  const away = (x1: number, y1: number, x2: number, y2: number) => hypot(x1 - x2, y1 - y2) > 0.5;
  let extra = 0;
  // the same after, parents first, with the pins as they are made
  const wa: [number, number][] = [];
  const worldA = (c: number): [number, number] => (c < 0 ? [0, 0] : wa[c]);
  after.clusters.forEach((cl, c) => {
    const [px, py] = worldA(cl.parent);
    const was = kb.get(cl.key);
    const pin = pins.clusters[cl.key];
    const parentKey = (L: Layout, k: number) => (L.clusters[k].parent >= 0 ? L.clusters[L.clusters[k].parent].key : "");
    const [bx, by] = was !== undefined ? worldB(was) : [0, 0];
    // its parent changed: the same place on the board, in the new parent's coordinates, if pinned
    // or if its layout place there is not where it was
    if (was !== undefined && parentKey(before, was) !== parentKey(after, c) && (pin || (extra < MAX_REFRAME && away(bx, by, px + cl.lx, py + cl.ly)))) {
      if (!pin) extra++;
      const at: [number, number] = [r(bx - px), r(by - py)];
      ops.push({ op: "pin", mode, kind: "cluster", key: cl.key, at });
      wa[c] = [px + at[0], py + at[1]];
    } else {
      const [x, y] = pin ?? [cl.lx, cl.ly];
      wa[c] = [px + x, py + y];
    }
  });
  const index = new Map<string, number>();
  for (let i = 0; i < g.n; i++) index.set(g.nodes[i].name, i);
  const key = (L: Layout, c: number) => (c >= 0 ? L.clusters[c].key : "");
  for (const [name, [x, y]] of Object.entries(pins.nodes)) {
    const i = index.get(name);
    if (i === undefined) continue;
    const cb = before.cluster[i], ca = after.cluster[i];
    if (key(before, cb) === key(after, ca)) continue;
    const [bx, by] = worldB(cb);
    const [ax, ay] = worldA(ca);
    ops.push({ op: "pin", mode, kind: "node", key: name, at: [r(bx + x - ax), r(by + y - ay)] });
  }
  // a declaration that is not pinned and changed parent: pinned where it is, if it would move
  for (let i = 0; i < g.n && extra < MAX_REFRAME; i++) {
    const name = g.nodes[i].name;
    if (pins.nodes[name] || i >= before.cluster.length || i >= after.cluster.length) continue;
    const cb = before.cluster[i], ca = after.cluster[i];
    if (key(before, cb) === key(after, ca)) continue;
    const [bx, by] = worldB(cb);
    const [ax, ay] = worldA(ca);
    const x = bx + before.lx[i], y = by + before.ly[i];
    if (!away(x, y, ax + after.lx[i], ay + after.ly[i])) continue;
    extra++;
    ops.push({ op: "pin", mode, kind: "node", key: name, at: [r(x - ax), r(y - ay)] });
  }
  return ops;
}
