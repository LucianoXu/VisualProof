// Key declarations (ExportSpec decisions 1, 3 and 4): the members of a target's review that matter
// for understanding it — the central definitions, the structures they are built on, the main theorem —
// marked by people, or by agents at level full, per target; the target itself is always key. What each key declaration rests
// on beyond itself (its support), and how the key declarations rest on one another (the key graph),
// are pure functions of the graph, the review and the target's review set, over the same set and
// edges the review queue walks (shared/reviewqueue.ts): the page, the agents' API and the exported
// document (shared/doc/) all read them here.
//
// A member x that is not key is *supported by* a key declaration k when x is reachable from k
// through members that are not key, along statement and body references. The key graph has an edge
// from k₁ to k₂ when k₂ is reachable from k₁ that way. Two refinements keep "every member is
// supported by some key declaration" true where the review set is more than what the target
// reaches through its members:
//
// - a declaration of the project in the target's TCB that is trusted, by module or by name (a layer
//   reviewed elsewhere), is not a member, but what it uses may be: the walk passes through it as
//   through a member that is not key (the outside world never uses the project, so nothing else
//   outside the set can lead back into it);
// - a non-standard axiom the target rests on only through a proof is a member that no statement or
//   body reaches: it is the target's support, as `viaProof` says.
//
// A review holds many members and a target a dozen key declarations: after one walk over the
// target's TCB, each walk reads the edges of the members and of what it passes through, never the
// whole graph's (TODO(scale, sphere packing): re-measure).

import type { ReviewData } from "./review.ts";
import { keyMarks, statusOf } from "./review.ts";
import { TCB_SITES } from "./reviewqueue.ts";
import type { Graph } from "./viewgraph.ts";

/** A target's key declarations, what each supports, and how they rest on one another. */
export interface KeyGraph {
  root: number;
  /** the key declarations, in review order (bottom-up, so the target comes last): the target, and
   *  the members of its review marked key */
  keys: number[];
  /** per member of the review that is not key, the key declarations supporting it: indices into
   *  `keys`, ascending */
  supporters: Map<number, number[]>;
  /** per key declaration (an index into `keys`), the members it supports, in review order */
  support: number[][];
  /** the key graph: [from, to] as indices into `keys`, sorted */
  edges: [number, number][];
  /** members no statement or body reaches from a key declaration: the non-standard axioms the
   *  target rests on through proofs alone. They are the target's support. */
  viaProof: number[];
}

/** How a set of declarations stands, by review status. */
export interface StatusCounts {
  total: number;
  approved: number;
  commented: number;
  stale: number;
  unreviewed: number;
}

/** The key declarations of `root` among the members of its review (`order`, the queue's order —
 *  shared/reviewqueue.ts), in that order: the target, and each member marked key. A mark on
 *  a declaration that has left the review (now trusted, or no longer in the TCB) is kept in the
 *  review but counts for nothing until it is back. */
export function keySet(g: Graph, d: ReviewData, root: number, order: readonly number[]): number[] {
  const marked = new Set(keyMarks(d, g.nodes[root].name));
  return order.filter((i) => i === root || marked.has(g.nodes[i].name));
}

/** `root`'s key graph over its review: `order` is the review's members in review order (the
 *  queue's `order`). */
export function keyGraph(g: Graph, d: ReviewData, root: number, order: readonly number[]): KeyGraph {
  const keys = keySet(g, d, root, order);
  // the target is always key, also where the review does not hold it (a test, a graph read again)
  if (!keys.includes(root)) keys.push(root);
  const keyAt = new Map<number, number>();
  keys.forEach((k, j) => keyAt.set(k, j));
  const position = new Map<number, number>();
  order.forEach((i, k) => position.set(i, k));
  const member = (v: number) => position.has(v);
  // what a walk may pass through besides members: the project's own declarations in the target's
  // TCB that are not members, which only a trusted prefix keeps out of the review
  const tcb = g.reach([root], TCB_SITES, "out");
  const passable = (v: number) => member(v) || (tcb[v] === 1 && !g.isExt(v));

  const supporters = new Map<number, number[]>();
  const support: number[][] = keys.map(() => []);
  const edges = new Set<number>();
  const K = keys.length;
  const seen = new Int32Array(g.n).fill(-1);
  for (let kj = 0; kj < K; kj++) {
    const k = keys[kj];
    seen[k] = kj;
    const stack = [k];
    while (stack.length) {
      const u = stack.pop()!;
      for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
        if (!(g.outSite[e] & TCB_SITES)) continue;
        const v = g.outDst[e];
        if (seen[v] === kj) continue;
        seen[v] = kj;
        const kv = keyAt.get(v);
        // a key declaration is where a walk stops: what lies beyond it is its own support
        if (kv !== undefined) {
          edges.add(kj * K + kv);
          continue;
        }
        if (!passable(v)) continue;
        if (member(v)) {
          const s = supporters.get(v);
          if (s) s.push(kj);
          else supporters.set(v, [kj]);
          support[kj].push(v);
        }
        stack.push(v);
      }
    }
  }
  // what no statement or body reaches: the target rests on it through a proof
  const rootAt = keyAt.get(root)!;
  const viaProof: number[] = [];
  for (const i of order) {
    if (keyAt.has(i) || supporters.has(i)) continue;
    supporters.set(i, [rootAt]);
    support[rootAt].push(i);
    viaProof.push(i);
  }
  for (const s of support) s.sort((a, b) => position.get(a)! - position.get(b)!);
  return {
    root,
    keys,
    supporters,
    support,
    edges: [...edges].sort((a, b) => a - b).map((x) => [Math.floor(x / K), x % K]),
    viaProof,
  };
}

/** The key graph's edges to draw while the tool is the Keys step of Rests on and something is lit
 *  (ViewSpec decision 20): of each key graph given — the focus's target's, or elsewhere every
 *  target's, which makes the union over the targets whose key declarations are lit — the edges
 *  whose two ends are lit, as [from, to] declarations, each once, in order. An edge from A to B
 *  says that A rests on B through declarations that are not key. */
export function litKeyEdges(kgs: Iterable<KeyGraph>, lit: (i: number) => boolean): [number, number][] {
  const out = new Map<string, [number, number]>();
  for (const kg of kgs) {
    for (const [a, b] of kg.edges) {
      const u = kg.keys[a], v = kg.keys[b];
      if (lit(u) && lit(v)) out.set(`${u} ${v}`, [u, v]);
    }
  }
  return [...out.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/** How the declarations `xs` stand, by people's review status. */
export function statusCounts(g: Graph, d: ReviewData, xs: Iterable<number>): StatusCounts {
  const c: StatusCounts = { total: 0, approved: 0, commented: 0, stale: 0, unreviewed: 0 };
  for (const i of xs) {
    c.total++;
    const s = statusOf(d, g.nodes[i].name, g.nodes[i].hash);
    if (s === "approved") c.approved++;
    else if (s === "commented") c.commented++;
    else if (s === "stale") c.stale++;
    else c.unreviewed++;
  }
  return c;
}

/** The review's order with its key declarations first (ExportSpec decision 4): the key ones in
 *  review order, then the rest in review order — how the agents' API lists a review set with
 *  `key=first`. */
export function keyFirst(order: readonly number[], isKey: (i: number) => boolean): number[] {
  return [...order.filter(isKey), ...order.filter((i) => !isKey(i))];
}

/** The key graph's layers, top-down (an index per key declaration, into `kg.keys`): the target at
 *  0, each other one a layer below every key declaration that rests on it — the longest path from
 *  the target, key declarations that rest on one another counted as one. A key declaration no
 *  statement or body reaches (an axiom reached through a proof) is put just under the target. */
export function keyLayers(kg: KeyGraph): number[] {
  const K = kg.keys.length;
  // reachability within the key graph: it is small (a dozen, a few dozen at most)
  const reach: Uint8Array[] = kg.keys.map(() => new Uint8Array(K));
  for (const [a, b] of kg.edges) reach[a][b] = 1;
  for (let m = 0; m < K; m++) for (let a = 0; a < K; a++) if (reach[a][m]) for (let b = 0; b < K; b++) if (reach[m][b]) reach[a][b] = 1;
  // a component: those that reach one another, named by its first member
  const comp = kg.keys.map((_, a) => {
    for (let b = 0; b < a; b++) if (reach[a][b] && reach[b][a]) return b;
    return a;
  });
  const root = kg.keys.indexOf(kg.root);
  const layer = new Array<number>(K).fill(-1);
  layer[root] = 0;
  // longest path on the components, relaxed until nothing moves: at most K rounds
  for (let round = 0; round <= K; round++) {
    let moved = false;
    for (const [a, b] of kg.edges) {
      if (layer[a] < 0 || comp[a] === comp[b]) continue;
      if (layer[b] < layer[a] + 1) {
        layer[b] = layer[a] + 1;
        moved = true;
      }
    }
    // a component's members share its deepest layer
    for (let a = 0; a < K; a++) if (layer[a] >= 0 && layer[comp[a]] < layer[a]) (layer[comp[a]] = layer[a]), (moved = true);
    for (let a = 0; a < K; a++) if (layer[comp[a]] > layer[a]) (layer[a] = layer[comp[a]]), (moved = true);
    if (!moved) break;
  }
  return layer.map((l, a) => (l >= 0 ? l : a === root ? 0 : 1));
}

/** The key declarations top-down (indices into `kg.keys`): the target, then layer by layer, within
 *  a layer the later in review order first — what rests on more comes before what it rests on. */
export function topDown(kg: KeyGraph): number[] {
  const layer = keyLayers(kg);
  return kg.keys.map((_, a) => a).sort((a, b) => layer[a] - layer[b] || b - a);
}
