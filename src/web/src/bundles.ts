// Hierarchical edge bundling (CanvasSpec.md, "Edges"; Holten 2006).
//
// An edge's control points are the cluster origins on its tree path: up from one end to the
// lowest common ancestor, and down to the other. Dependencies that travel the same way through
// the hierarchy share control points and run together as a bundle.
//
// Ends are "units": what an edge end stands for on screen right now. A declaration is its own
// unit, unless it sits in a cluster that is folded, or too small on screen to tell apart from its
// siblings — then that cluster is the unit, and every edge into it is aggregated. Zoomed out the
// overview shows which parts of the project depend on which; zoomed in, which declarations do.
//
// Position ids, shared with the positions texture: cluster c → c, node i → nc + i.

import type { Graph } from "../../shared/viewgraph.ts";
import type { Scene } from "./scene.ts";

/** What `pathOf` reads of the scene: the cluster tree. A worker holds a copy (web/src/overview.ts). */
export type PathTree = Pick<Scene, "nc" | "parent" | "nodeCluster">;
/** What `units` reads of the scene: the tree, what is shut, and the circles' radii now. */
export type UnitTree = PathTree & Pick<Scene, "n" | "rep" | "curR">;
/** What `aggregate` reads of the graph: its edges. */
export type EdgeGraph = Pick<Graph, "n" | "outStart" | "outDst" | "outSite">;

export interface Bundle {
  a: number;
  b: number;
  w: number;
  path: number[];
}

const MAX_POINTS = 8;

/** Each node's unit (a position id): itself, or the outermost cluster above it that is shut or
 *  smaller than `minPx` on screen. */
export function units(S: UnitTree, k: number, minPx: number): Int32Array {
  const cu = new Int32Array(S.nc).fill(-1);
  for (let c = 0; c < S.nc; c++) {
    const p = S.parent[c];
    if (p >= 0 && cu[p] >= 0) cu[c] = cu[p];
    else if (S.rep[c] === c || S.curR[c] * k < minPx) cu[c] = c;
  }
  const out = new Int32Array(S.n);
  for (let i = 0; i < S.n; i++) {
    const c = S.nodeCluster[i];
    out[i] = c >= 0 && cu[c] >= 0 ? cu[c] : S.nc + i;
  }
  return out;
}

/** Edges between units, counted: pair k runs from unit a[k] (the end that uses) to unit b[k]
 *  (the end that is used), standing for w[k] edges. */
export interface Pairs {
  n: number;
  a: Int32Array;
  b: Int32Array;
  w: Int32Array;
}

/** Edges between units, counted. `keep` filters nodes (hidden externals, say). The pairs come in
 *  the order each is first met (by the node that uses, then its edges), counted in a hash table of
 *  typed arrays: a Map keyed by a · 2^22 + b, numbers past the small integers, took a second and a
 *  half a zoom step on NavierStokesAndEuler's 5 million edges, and the overview's edges lagged that
 *  long behind a zoom (CanvasSpec, "Edges"). */
export function aggregate(g: EdgeGraph, unit: Int32Array, sites: number, keep: (i: number) => boolean): Pairs {
  let size = 1024;
  let slot = new Int32Array(size).fill(-1);
  let A = new Int32Array(256), B = new Int32Array(256), w = new Int32Array(256);
  let n = 0;
  // the pair's slot: its two ids mixed, every bit of them reaching the low ones the slot is read from
  const at = (a: number, b: number) => {
    let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    return (h ^ (h >>> 15)) & (size - 1);
  };
  for (let u = 0; u < g.n; u++) {
    if (!keep(u)) continue;
    const a = unit[u];
    for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
      if (!(g.outSite[e] & sites)) continue;
      const v = g.outDst[e];
      if (!keep(v)) continue;
      const b = unit[v];
      if (a === b) continue;
      let h = at(a, b);
      for (;;) {
        const k = slot[h];
        if (k < 0) break;
        if (A[k] === a && B[k] === b) break;
        h = (h + 1) & (size - 1);
      }
      if (slot[h] >= 0) {
        w[slot[h]]++;
        continue;
      }
      if (n === A.length) {
        const grow = (x: Int32Array) => {
          const y = new Int32Array(2 * x.length);
          y.set(x);
          return y;
        };
        [A, B, w] = [grow(A), grow(B), grow(w)];
      }
      A[n] = a;
      B[n] = b;
      w[n] = 1;
      slot[h] = n++;
      // at most half full: grown, and every pair put again
      if (2 * n > size) {
        size *= 2;
        slot = new Int32Array(size).fill(-1);
        for (let k = 0; k < n; k++) {
          let j = at(A[k], B[k]);
          while (slot[j] >= 0) j = (j + 1) & (size - 1);
          slot[j] = k;
        }
      }
    }
  }
  return { n, a: A.slice(0, n), b: B.slice(0, n), w: w.slice(0, n) };
}

/** Indices of the `cap` highest scores among `idx` (all of them if there are fewer), in no
 *  particular order. Linear time: a selection, not a sort. */
export function topK(idx: Int32Array, score: Float64Array, cap: number): Int32Array {
  const n = idx.length;
  if (n <= cap) return idx;
  const s = new Float64Array(n);
  for (let k = 0; k < n; k++) s[k] = score[idx[k]];
  // the (n - cap)-th smallest score is the threshold (Hoare's quickselect)
  const want = n - cap;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const pivot = s[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (s[i] < pivot) i++;
      while (s[j] > pivot) j--;
      if (i <= j) {
        const t = s[i];
        s[i] = s[j];
        s[j] = t;
        i++;
        j--;
      }
    }
    if (want <= j) hi = j;
    else if (want >= i) lo = i;
    else break;
  }
  const threshold = s[want];
  const out = new Int32Array(cap);
  let m = 0;
  for (let k = 0; k < n && m < cap; k++) if (score[idx[k]] > threshold) out[m++] = idx[k];
  for (let k = 0; k < n && m < cap; k++) if (score[idx[k]] === threshold) out[m++] = idx[k];
  return out;
}

/** The control points from one end to the other through the tree, at most MAX_POINTS. */
export function pathOf(S: PathTree, a: number, b: number): number[] {
  const chain = (id: number) => {
    const out = [id];
    let c = id < S.nc ? S.parent[id] : S.nodeCluster[id - S.nc];
    while (c >= 0) {
      out.push(c);
      c = S.parent[c];
    }
    return out;
  };
  return joinChains(chain(a), chain(b));
}

/** The control points between two ends, each given with its chain of ancestors up to the top level
 *  (`ca[0]` and `cb[0]` the ends): up to the common ancestor, through it, down to the other end, at
 *  most MAX_POINTS. A visitor's chain runs through its temporary clusters (ViewSpec decision 27). */
export function joinChains(ca: readonly number[], cb: readonly number[]): number[] {
  const inB = new Map<number, number>();
  cb.forEach((x, k) => inB.set(x, k));
  let path: number[];
  const ka = ca.findIndex((x) => inB.has(x));
  if (ka >= 0) {
    const kb = inB.get(ca[ka])!;
    // up to the common ancestor, through it, down to the other end
    path = [...ca.slice(0, ka + 1), ...cb.slice(0, kb).reverse()];
    // an end that is the ancestor itself (an edge into its own cluster) is just a short hop
    if (path.length < 2) path = [ca[0], cb[0]];
  } else {
    path = [...ca, ...[...cb].reverse()];
  }
  if (path.length > MAX_POINTS) {
    const keep = [path[0]];
    for (let k = 1; k < MAX_POINTS - 1; k++) keep.push(path[Math.round((k * (path.length - 1)) / (MAX_POINTS - 1))]);
    keep.push(path[path.length - 1]);
    path = keep;
  }
  return path;
}
