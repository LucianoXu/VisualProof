// The order in which to review a target's TCB and why a declaration is in the TCB at all
// (ReviewSpec, "Reviewing a target"): pure functions of the graph and the review. The page's review
// (web/src/reviewqueue.ts: the strip, the target's review list), the agent API (server/agent.ts) and
// the server's checks of key declarations (server/reviewapi.ts) walk a TCB the same way.
//
// Where the review works is a view's focus (ViewSpec decision 28; shared/views.ts, viewFocus), not
// what its scope says; whatever the board holds, the review counts the focus's whole review set.
//
// What a target's review holds (decided 2026-10-08) is the scope `reviewScope` (shared/query.ts)
// evaluated on the graph — the TCB without what is trusted, an untrusted outside declaration
// included, and every non-standard axiom the target rests on through statements, bodies or proofs,
// which no prefix trusts. The queue and its progress count exactly that set, so that a board of that
// scope and the numbers beside it never disagree. An axiom the graph has no declaration for (one only
// the axiom sets name, used inside something outside the project) cannot be on a board: it is
// counted beside the queue, and approved from the target's panel.

import { SITE_BODY, SITE_STMT } from "./graph.ts";
import { current, fresh, STANDARD_AXIOMS, statusOf, trusted } from "./review.ts";
import type { Progress, ReviewData } from "./review.ts";
import { ALL_SITES } from "./viewgraph.ts";
import type { Graph } from "./viewgraph.ts";
import { evaluate, reviewScope } from "./query.ts";

/** The references a TCB follows: in statements and bodies, never inside a proof. */
export const TCB_SITES = SITE_STMT | SITE_BODY;

/** In how many of the targets' TCBs each declaration is. */
export function inTargets(g: Graph, targets: number[]): Uint16Array {
  const out = new Uint16Array(g.n);
  for (const t of targets) {
    const tcb = g.reach([t], TCB_SITES, "out");
    for (let i = 0; i < g.n; i++) out[i] += tcb[i];
  }
  return out;
}

/** Whether declaration `i` is an axiom beyond Lean's three standard ones: it needs review whatever
 *  is trusted (ReviewSpec decision 3). */
export function nonStandardAxiom(g: Graph, i: number): boolean {
  return g.nodes[i].kind === "axiom" && !STANDARD_AXIOMS.includes(g.nodes[i].name);
}

/** Whether declaration `i` needs review where it is in a target's TCB: no prefix trusts it, or it
 *  is a non-standard axiom. */
export function needsReview(g: Graph, d: ReviewData, i: number): boolean {
  return nonStandardAxiom(g, i) || !trusted(d, g.nodes[i].name, g.nodes[i].module, g.isExt(i));
}

/** What `root`'s review holds, its review set (`reviewScope`), in the graph's numbering. */
export function reviewSet(g: Graph, d: ReviewData, root: number): Uint8Array {
  return evaluate(reviewScope(g.nodes[root].name), { g, review: d });
}

/** A non-standard axiom a target rests on. */
export interface QueueAxiom {
  name: string;
  /** its declaration, in the target's review set; null where the graph has none the target reaches
   *  by its references (only the axiom sets say it rests on it) */
  node: number | null;
  /** where it comes in, at most VIA of them: the declarations the target reaches that use it
   *  directly, or — where the graph has no declaration for it — that rest on it through none of
   *  their references the graph holds */
  via: number[];
}

const VIA = 8;

/** The non-standard axioms `root` rests on, through statements, bodies or proofs: those the axiom
 *  sets of what it reaches name (the extractor's, through everything), and those it reaches as
 *  declarations. `set` is its review's set (reviewSet). */
export function axiomsReached(g: Graph, root: number, set: Uint8Array): QueueAxiom[] {
  const meta = g.meta;
  const reach = g.reach([root], ALL_SITES, "out");
  const names = new Set<string>();
  for (let i = 0; i < g.n; i++) {
    if (!reach[i]) continue;
    if (nonStandardAxiom(g, i)) names.add(g.nodes[i].name);
    for (const k of meta.axiomSets[g.nodes[i].ax] ?? []) if (!STANDARD_AXIOMS.includes(meta.axioms[k])) names.add(meta.axioms[k]);
  }
  const out: QueueAxiom[] = [];
  for (const name of [...names].sort()) {
    const j = g.byName.get(name);
    const node = j !== undefined && set[j] ? j : null;
    const via: number[] = [];
    if (node !== null) {
      for (let e = g.inStart[node]; e < g.inStart[node + 1]; e++) if (reach[g.inSrc[e]] && g.inSrc[e] !== node && !via.includes(g.inSrc[e])) via.push(g.inSrc[e]);
    } else {
      const k = meta.axioms.indexOf(name);
      const rests = (i: number) => k >= 0 && (meta.axiomSets[g.nodes[i].ax] ?? []).includes(k);
      for (let i = 0; i < g.n; i++) {
        if (!reach[i] || !rests(i)) continue;
        let deeper = false;
        for (let e = g.outStart[i]; e < g.outStart[i + 1] && !deeper; e++) deeper = g.outDst[e] !== i && rests(g.outDst[e]);
        if (!deeper) via.push(i);
      }
    }
    // the project's own first: that is where someone can do something about it
    via.sort((a, b) => Number(g.isExt(a)) - Number(g.isExt(b)) || (g.nodes[a].name < g.nodes[b].name ? -1 : 1));
    out.push({ name, node, via: via.slice(0, VIA) });
  }
  return out;
}

/** A target's review: its review set, in the order to review it, and the non-standard axioms it
 *  rests on. */
export interface Queue {
  /** non-standard axioms first (what everything rests on, and a `sorry` is what to see first),
   *  then bottom-up (reviewOrder) */
  order: number[];
  /** every non-standard axiom it rests on; one with a declaration is in `order` too, the others
   *  are counted beside it */
  axioms: QueueAxiom[];
}

/** `root`'s review queue. `shared`: in how many targets' TCBs each declaration is (inTargets). */
export function reviewQueue(g: Graph, d: ReviewData, root: number, shared: ArrayLike<number>): Queue {
  const set = reviewSet(g, d, root);
  const order = reviewOrder(g, set, shared);
  const ax = order.filter((i) => g.nodes[i].kind === "axiom");
  return { order: [...ax, ...order.filter((i) => g.nodes[i].kind !== "axiom")], axioms: axiomsReached(g, root, set) };
}

/** The axioms of a queue the graph has no declaration for on the board. */
export function offBoard(q: Queue): QueueAxiom[] {
  return q.axioms.filter((a) => a.node === null);
}

/** How far a target's review has come: every member of its queue, the axioms beside it included. */
export function queueProgress(g: Graph, d: ReviewData, q: Queue): Progress {
  const p: Progress = { total: 0, approved: 0, commented: 0, stale: 0 };
  const count = (name: string, hash: string | undefined) => {
    p.total++;
    const s = statusOf(d, name, hash);
    if (s === "approved") p.approved++;
    else if (s === "commented") p.commented++;
    else if (s === "stale") p.stale++;
  };
  for (const i of q.order) count(g.nodes[i].name, g.nodes[i].hash);
  for (const a of offBoard(q)) count(a.name, undefined);
  return p;
}

/** How many members `root`'s review counts under the review `d` (what trusting a prefix would
 *  change, web/src/trust.ts): its review set, and the axioms beside it. */
export function reviewCount(g: Graph, d: ReviewData, root: number): number {
  const set = reviewSet(g, d, root);
  let n = 0;
  for (let i = 0; i < g.n; i++) n += set[i];
  return n + axiomsReached(g, root, set).filter((a) => a.node === null).length;
}

/** Whether a reader is done with a member of a review: they gave an opinion on its present
 *  version — and, for a non-standard axiom, it is approved, so that "All reviewed" is never said
 *  while one is not. */
export function settled(d: ReviewData, reader: string | null, name: string, hash: string | undefined, axiom: boolean): boolean {
  return reviewedBy(d, reader, name, hash) && (!axiom || statusOf(d, name, hash) === "approved");
}

/** The declarations of `members` (a target's review, reviewSet) in the order to review them:
 *  bottom-up, what a declaration uses before it, since reviewing one means "it says what it
 *  should, given that what it uses means what it says" (ReviewSpec decision 2). Declarations that
 *  use each other are one step, together. Where the order leaves a choice, what more targets rest
 *  on comes first (`shared`, per declaration: one review of a common foundation advances every
 *  target on it), then the name. */
export function reviewOrder(g: Graph, set: Uint8Array, shared: ArrayLike<number>): number[] {
  const members: number[] = [];
  for (let i = 0; i < g.n; i++) if (set[i]) members.push(i);
  return dependencyOrder(g, members, (x, y) => (shared[x] !== shared[y] ? shared[x] > shared[y] : g.nodes[x].name < g.nodes[y].name));
}

/** Declarations `members` of `g` in dependency order, over statement and body references among
 *  them: what a declaration uses before it, declarations that use each other together, one step;
 *  where the order leaves a choice, `before` decides (by default, the name). The review queue's
 *  order (reviewOrder). */
export function dependencyOrder(g: Graph, members: number[], before: (x: number, y: number) => boolean = (x, y) => g.nodes[x].name < g.nodes[y].name): number[] {
  const local = new Map<number, number>();
  members.forEach((v, k) => local.set(v, k));
  // what each member uses among the members; nothing outside the project uses the project, so no
  // path between two members of a review leaves them
  const uses: number[][] = members.map(() => []);
  members.forEach((u, a) => {
    for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
      const b = g.outSite[e] & TCB_SITES ? local.get(g.outDst[e]) : undefined;
      if (b !== undefined && b !== a) uses[a].push(b);
    }
  });
  return stepOrder(uses, (a, b) => before(members[a], members[b])).map((a) => members[a]);
}

/** Items in dependency order, given what each uses (`uses`, by index): what an item uses before it,
 *  items that use each other as one step, together; where the order leaves a choice, the step
 *  whose first item comes `before` the other's first goes first, and within a step `before` orders
 *  the items. The indices, in order. */
export function stepOrder(uses: number[][], before: (a: number, b: number) => boolean): number[] {
  const m = uses.length;
  const comp = components(uses);
  const nc = comp.reduce((x, c) => Math.max(x, c + 1), 0);
  // each step's items in the order of choice; a step is chosen by its first
  const steps: number[][] = Array.from({ length: nc }, () => []);
  for (let a = 0; a < m; a++) steps[comp[a]].push(a);
  for (const s of steps) s.sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
  // a step is ready once every step it uses is done
  const waiting = new Int32Array(nc);
  const usedBy: number[][] = Array.from({ length: nc }, () => []);
  const seen = new Set<number>();
  for (let a = 0; a < m; a++) {
    for (const b of uses[a]) {
      const c = comp[a], d = comp[b];
      if (c === d || seen.has(c * nc + d)) continue;
      seen.add(c * nc + d);
      waiting[c]++;
      usedBy[d].push(c);
    }
  }
  const ready = new Heap<number>((c, d) => before(steps[c][0], steps[d][0]));
  for (let c = 0; c < nc; c++) if (!waiting[c]) ready.push(c);
  const out: number[] = [];
  while (ready.size) {
    const c = ready.pop();
    for (const a of steps[c]) out.push(a);
    for (const d of usedBy[c]) if (--waiting[d] === 0) ready.push(d);
  }
  return out;
}

/** The strongly connected components of a graph given by its successor lists (Tarjan's, without
 *  recursion: a TCB can be deep): each node's component number. */
function components(succ: number[][]): Int32Array {
  const n = succ.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const comp = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  let next = 0, nc = 0;
  const enter = (v: number) => {
    index[v] = low[v] = next++;
    stack.push(v);
    onStack[v] = 1;
  };
  for (let s = 0; s < n; s++) {
    if (index[s] >= 0) continue;
    enter(s);
    // the path being explored: a node and how many of its successors it has looked at
    const path: [number, number][] = [[s, 0]];
    while (path.length) {
      const top = path[path.length - 1];
      const v = top[0];
      if (top[1] < succ[v].length) {
        const w = succ[v][top[1]++];
        if (index[w] < 0) {
          enter(w);
          path.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      path.pop();
      if (path.length) {
        const u = path[path.length - 1][0];
        low[u] = Math.min(low[u], low[v]);
      }
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          comp[w] = nc;
        } while (w !== v);
        nc++;
      }
    }
  }
  return comp;
}

/** A binary heap: `pop` gives the item that comes `before` all others. */
class Heap<T> {
  private xs: T[] = [];
  private before: (a: T, b: T) => boolean;

  constructor(before: (a: T, b: T) => boolean) {
    this.before = before;
  }

  get size(): number {
    return this.xs.length;
  }

  push(x: T): void {
    const xs = this.xs;
    xs.push(x);
    for (let k = xs.length - 1; k > 0; ) {
      const p = (k - 1) >> 1;
      if (!this.before(xs[k], xs[p])) break;
      [xs[k], xs[p]] = [xs[p], xs[k]];
      k = p;
    }
  }

  pop(): T {
    const xs = this.xs;
    const top = xs[0];
    const last = xs.pop()!;
    if (xs.length) {
      xs[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1, r = l + 1;
        let best = k;
        if (l < xs.length && this.before(xs[l], xs[best])) best = l;
        if (r < xs.length && this.before(xs[r], xs[best])) best = r;
        if (best === k) break;
        [xs[k], xs[best]] = [xs[best], xs[k]];
        k = best;
      }
    }
    return top;
  }
}

/** The shortest chain of statement and body references from `from` to `to`, both included: why
 *  `to` is in `from`'s TCB. Null when it is not. */
export function whyChain(g: Graph, from: number, to: number): number[] | null {
  const parent = new Int32Array(g.n).fill(-1);
  parent[from] = from;
  const queue = [from];
  for (let k = 0; k < queue.length && parent[to] < 0; k++) {
    const u = queue[k];
    for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
      const v = g.outDst[e];
      if (!(g.outSite[e] & TCB_SITES) || parent[v] >= 0) continue;
      parent[v] = u;
      queue.push(v);
    }
  }
  if (parent[to] < 0) return null;
  const path = [to];
  while (path[path.length - 1] !== from) path.push(parent[path[path.length - 1]]);
  return path.reverse();
}

/** Whether `reader` has given an opinion on the present version of a declaration. */
export function reviewedBy(d: ReviewData, reader: string | null, name: string, hash: string | undefined): boolean {
  return !!reader && current(d, name).some((o) => o.by === reader && fresh(o, hash));
}
