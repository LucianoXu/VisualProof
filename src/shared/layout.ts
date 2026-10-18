// Positions for every node, clustered by namespace or by file.
//
// The layout is a tree of discs. Each cluster lays out its own children — its nodes as small
// circles, its sub-clusters as the discs they already computed — and reports the disc that
// encloses them. So a cluster's interior never depends on anything outside it, folding a cluster
// is just drawing its disc, nothing overlaps, and the same graph gives the same picture.
//
// Inside a cluster, what is used sits low and what uses it sits high (CanvasSpec.md, "Dependency
// order"): every dependency is a 1 V battery, each cluster solves the network of its children with
// everything outside it as the ground, and the children settle into the disc by potential, the
// highest on top, like liquids of different density.
//
// A board may hide levels of its tree (ViewSpec decision 24): a hidden cluster's sub-clusters and
// declarations sit in its parent, and the tree is laid out as it then is.
//
// The same graph gives the same picture on every engine: the server's Node, the page's browser, a
// follower's other browser. Engines round sines, logarithms and lengths each their own way in the
// last digit, and the settling below makes a different picture of a different last digit, so the
// layout computes them itself (shared/libm.ts) from the operations every engine rounds alike; its
// sorts are total orders, and nothing in it reads the clock or a random number.

import { packEnclose, packSiblings } from "d3-hierarchy";
import type { Cluster, ClusterMode, Layout, ViewNode } from "./graph.ts";
import { acos, cos, hypot, log1p, sin } from "./libm.ts";
import { type Bodies, BoxGrid, Separator } from "./separate.ts";

const LEAF_R = 5;
/** gap between declarations that touch, as the page packs them */
const GAP = 2.5;

/** the outside world's cluster, at the top level of either way of clustering */
export const EXT_KEY = "⟨external⟩";

/** Lean names split on dots, except inside «guillemets». */
export function splitName(name: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of name) {
    if (ch === "«") depth++;
    else if (ch === "»") depth--;
    if (ch === "." && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

interface TNode {
  key: string;
  label: string;
  parent: TNode | null;
  kids: Map<string, TNode>;
  leaves: number[];
  ext: boolean;
  count: number;
  /** relative to the parent's centre until `place` makes it absolute */
  x: number;
  y: number;
  r: number;
  id: number;
  /** this cluster's index among its parent's children (sub-clusters first, then declarations) */
  slot: number;
  /** number of children; the ground is child `m` */
  m: number;
  /** dependencies between children, a uses b, keyed a · (m + 1) + b: those whose two ends meet here */
  flow: Map<number, number>;
  /** per child, dependencies on the outside world and from it */
  gOut: Float64Array;
  gIn: Float64Array;
}

function tnode(key: string, label: string, parent: TNode | null, ext: boolean): TNode {
  const none = new Float64Array(0);
  return { key, label, parent, kids: new Map(), leaves: [], ext, count: 0, x: 0, y: 0, r: 0, id: -1, slot: 0, m: 0, flow: new Map(), gOut: none, gIn: none };
}

/** The parts of the path of a declaration's cluster by `mode`: its namespace or its file, the
 *  outside world under its own cluster; `prefixes` the names that are namespaces as well (a
 *  structure sits in its own namespace's cluster). A visitor's place is read from it too
 *  (web/src/visitors.ts, `planVisitors`). */
export function pathOf(mode: ClusterMode, n: Pick<ViewNode, "name" | "module" | "ext">, prefixes: ReadonlySet<string>): string[] {
  if (n.ext) {
    if (mode === "module") return [EXT_KEY, ...n.module.split(".").slice(0, 2)];
    const parts = splitName(n.name);
    return parts.length > 1 ? [EXT_KEY, parts[0]] : [EXT_KEY];
  }
  if (mode === "module") return n.module.split(".");
  const parts = splitName(n.name);
  // a structure and its namespace are one thing: `Foo` sits in the cluster of `Foo.bar`
  return prefixes.has(n.name) ? parts : parts.slice(0, -1);
}

/** Every key a cluster of a layout of `nodes` by `mode` can have: the tree computeLayout builds
 *  before it merges chains, whose keys the merged one keeps. What a layout's memory may speak of
 *  (server/agentviews.ts checks a memory a page hands over against it). */
export function clusterKeys(mode: ClusterMode, nodes: ViewNode[]): Set<string> {
  const prefixes = new Set<string>();
  if (mode === "namespace") {
    for (const n of nodes) {
      if (n.ext) continue;
      const parts = splitName(n.name);
      for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join("."));
    }
  }
  const keys = new Set<string>();
  for (const n of nodes) {
    let key = "";
    for (const part of pathOf(mode, n, prefixes)) {
      key = key ? `${key}.${part}` : part;
      keys.add(key);
    }
  }
  return keys;
}

/** Each node's innermost cluster key by `mode` in that same tree, before chains are merged and
 *  levels hidden ("" for a node at the top level): the keys around it are its prefixes. A structure
 *  sits in the cluster of its namespace where `nodes` hold what is in that namespace, as a board
 *  draws it. What a note's place is read against (shared/noteplace.ts). */
export function innerKeys(mode: ClusterMode, nodes: Pick<ViewNode, "name" | "module" | "ext">[]): string[] {
  const prefixes = new Set<string>();
  if (mode === "namespace") {
    for (const n of nodes) {
      if (n.ext) continue;
      const parts = splitName(n.name);
      for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join("."));
    }
  }
  return nodes.map((n) => pathOf(mode, n, prefixes).join("."));
}

interface Item {
  key: string;
  r: number;
  x: number;
  y: number;
  sub?: TNode;
  leaf?: number;
}

/**
 * Potentials of a cluster's children (CanvasSpec.md, "Dependency order"): every dependency a → b is
 * a 1 V battery; a pair of children is joined with conductance log(1 + its dependencies) and a
 * battery of (a→b − b→a) / (a→b + b→a); the outside world is held at 0 V. Minimises
 * Σ conductance · (φ_a − φ_b − battery)² by conjugate gradients on the grounded Laplacian.
 */
function potentials(c: TNode): Float64Array {
  const m = c.m;
  const pa: number[] = [], pb: number[] = [], pc: number[] = [];
  const rhs = new Float64Array(m);
  const diag = new Float64Array(m);
  const join = (a: number, b: number, ab: number, ba: number) => {
    const tot = ab + ba;
    const g = log1p(tot);
    const drop = (ab - ba) / tot;
    rhs[a] += g * drop;
    diag[a] += g;
    if (b < m) {
      rhs[b] -= g * drop;
      diag[b] += g;
      pa.push(a);
      pb.push(b);
      pc.push(g);
    }
  };
  for (const [key, ab] of c.flow) {
    const a = Math.floor(key / (m + 1)), b = key - a * (m + 1);
    const ba = c.flow.get(b * (m + 1) + a) ?? 0;
    if (a < b || ba === 0) join(a, b, ab, ba);
  }
  for (let a = 0; a < m; a++) if (c.gOut[a] + c.gIn[a] > 0) join(a, m, c.gOut[a], c.gIn[a]);
  // a child joined to nothing rests at the ground; the small term keeps the system definite
  const EPS = 1e-4;
  const mul = (x: Float64Array, y: Float64Array) => {
    for (let k = 0; k < m; k++) y[k] = (diag[k] + EPS) * x[k];
    for (let e = 0; e < pa.length; e++) {
      const a = pa[e], b = pb[e], g = pc[e];
      y[a] -= g * x[b];
      y[b] -= g * x[a];
    }
  };
  const phi = new Float64Array(m);
  const r = rhs.slice();
  const p = r.slice();
  const Ap = new Float64Array(m);
  let rr = r.reduce((s, v) => s + v * v, 0);
  const stop = rr * 1e-12;
  for (let it = 0; it < 1000 && rr > stop && rr > 0; it++) {
    mul(p, Ap);
    let pAp = 0;
    for (let k = 0; k < m; k++) pAp += p[k] * Ap[k];
    const alpha = rr / pAp;
    let next = 0;
    for (let k = 0; k < m; k++) {
      phi[k] += alpha * p[k];
      r[k] -= alpha * Ap[k];
      next += r[k] * r[k];
    }
    const beta = next / rr;
    rr = next;
    for (let k = 0; k < m; k++) p[k] = r[k] + beta * p[k];
  }
  return phi;
}

const separator = new Separator(2 * LEAF_R + GAP);
/** declarations sit on a hexagonal lattice this far apart: touching, with room for rounding */
const PITCH = 2 * LEAF_R + 0.3;

const sq = (v: number) => v * v;
/** the directions a sub-cluster is tried in round a placed one */
const ANGLES = 24;
const COS = Float64Array.from({ length: ANGLES }, (_, s) => cos((2 * Math.PI * s) / ANGLES));
const SIN = Float64Array.from({ length: ANGLES }, (_, s) => sin((2 * Math.PI * s) / ANGLES));

/**
 * The children settle into a disc by potential, the highest on top. Each one's height is where the
 * area of everything above it ends (the share of a disc above a chord). Sub-clusters, largest
 * first, take the free spot nearest their height, sideways being cheap; declarations then fill the
 * hexagonal lattice cells nearest the centre that the sub-clusters leave free, the highest
 * potential in the highest cell.
 *
 * What a spot is checked against is found in a grid of the discs placed (shared/separate.ts,
 * BoxGrid), which gives what checking every one of them gave, so that a folder of 1,800 files
 * settles in time proportional to its size.
 */
function settle(items: Item[], phi: Float64Array): void {
  const n = items.length;
  const order = [...items.keys()].sort((p, q) => phi[q] - phi[p] || p - q);
  let total = 0;
  for (const it of items) total += Math.PI * sq(it.r + 0.3);
  const R = Math.sqrt(total / (Math.PI * 0.78));
  // the share of a unit disc's area above the chord at height t
  const above = (t: number) => (acos(t) - t * Math.sqrt(1 - t * t)) / Math.PI;
  const heightOf = (f: number) => {
    let lo = -1, hi = 1;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (above(mid) > f) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const share = new Float64Array(n);
  let acc = 0;
  for (const k of order) {
    const a = Math.PI * sq(items[k].r + 0.3);
    share[k] = heightOf((acc + a / 2) / total);
    acc += a;
  }
  const big = [...items.keys()].filter((k) => items[k].sub).sort((p, q) => items[q].r - items[p].r || p - q);
  const leaves = order.filter((k) => !items[k].sub);
  if (big.length === 0) {
    // declarations only: all of one size, so any compact packing will do — pack them tightly,
    // then hand the places out from the top down by potential
    const spots = packSiblings(leaves.map(() => ({ x: 0, y: 0, r: LEAF_R + 0.15 })));
    spots.sort((a, b) => a.y - b.y || a.x - b.x);
    leaves.forEach((k, j) => {
      items[k].x = spots[j].x;
      items[k].y = spots[j].y;
    });
    return;
  }
  // the sub-clusters' sizes: the grids' cells about as wide as a middling one, the largest tenth
  // filed by their boxes and the others by their centres
  const radii = Float64Array.from(big, (k) => items[k].r).sort();
  const rMax = radii[radii.length - 1];
  const rPoint = radii[Math.floor(0.9 * (radii.length - 1))];
  const cell = Math.max(PITCH, 2 * radii[radii.length >> 1]);
  const grid = new BoxGrid();
  /** so few that looking at each is quicker than the grid */
  const few = big.length < 32;
  // placed as tall as the estimate says, then stretched or squeezed until it comes out round
  let scale = R;
  for (let pass = 0; pass < 3; pass++) {
    place(share.map((t) => -t * scale));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const it of items) {
      x0 = Math.min(x0, it.x - it.r);
      x1 = Math.max(x1, it.x + it.r);
      y0 = Math.min(y0, it.y - it.r);
      y1 = Math.max(y1, it.y + it.r);
    }
    const aspect = (x1 - x0) / Math.max(1e-6, y1 - y0);
    if (Math.abs(aspect - 1) < 0.06 || big.length === 0) break;
    scale *= Math.sqrt(aspect);
  }
  finish();

  function place(ty: Float64Array): void {
  // 1. sub-clusters, largest first
  const px: number[] = [], py: number[] = [], pr: number[] = [];
  // the placed ones in a grid over where they can go, every target height inside it
  let t0 = 0, t1 = 0;
  for (const k of big) {
    t0 = Math.min(t0, ty[k]);
    t1 = Math.max(t1, ty[k]);
  }
  const span = 3 * (R + Math.max(-t0, t1)) + 2 * rMax;
  if (!few) grid.reset(Math.max(cell, Math.sqrt((2 * span * (t1 - t0 + 2 * span)) / (8 * big.length + 64))), big.length, -span, t0 - span, span, t1 + span);
  const reachFree = rPoint + 0.3 + 1e-6;
  const free = (x: number, y: number, r: number) => {
    if (few) {
      for (let j = 0; j < px.length; j++) {
        const need = r + pr[j] + 0.3;
        if (sq(x - px[j]) + sq(y - py[j]) < need * need) return false;
      }
      return true;
    }
    const e = r + reachFree;
    const m = grid.find(x - e, y - e, x + e, y + e);
    for (let f = 0; f < m; f++) {
      const j = grid.found[f];
      const need = r + pr[j] + 0.3;
      if (sq(x - px[j]) + sq(y - py[j]) < need * need) return false;
    }
    return true;
  };
  const cost = (x: number, y: number, t: number) => sq(y - t) + 0.3 * x * x;
  for (const k of big) {
    const r = items[k].r;
    const t = ty[k];
    let bx = 0, by = t, best = free(0, t, r) ? 0 : Infinity;
    if (best > 0) {
      // touching one of the placed discs nearest the target
      for (const j of nearest(px, py, pr, t)) {
        const d = r + pr[j] + 0.3;
        for (let s = 0; s < ANGLES; s++) {
          const x = px[j] + d * COS[s], y = py[j] + d * SIN[s];
          const c = cost(x, y, t);
          if (c < best && free(x, y, r)) {
            best = c;
            bx = x;
            by = y;
          }
        }
      }
      // nothing free beside them: further out along the height
      for (let step = 1; best === Infinity; step++) {
        for (const x of [step * r, -step * r]) if (best === Infinity && free(x, t, r)) [best, bx, by] = [0, x, t];
      }
    }
    items[k].x = bx;
    items[k].y = by;
    if (!few) grid.add(px.length, bx, by, r <= rPoint ? 0 : r + 0.3 + 1e-6);
    px.push(bx);
    py.push(by);
    pr.push(r);
  }
  // close the gaps the one-by-one placement left: drawn towards the middle, held at their heights
  if (big.length > 1) {
    const D: Bodies = {
      n: big.length,
      x: Float64Array.from(px),
      y: Float64Array.from(py),
      r: Float64Array.from(pr, (r) => r + 0.3),
      pinned: new Uint8Array(big.length),
      seq: new Float64Array(big.length),
      big: Int32Array.from(big.keys()),
      small: new Int32Array(0),
    };
    for (let it = 0; it < 80; it++) {
      for (let j = 0; j < big.length; j++) {
        D.x[j] *= 0.93;
        D.y[j] += (ty[big[j]] - D.y[j]) * 0.1;
        D.y[j] *= 0.985;
      }
      separator.separate(D, 4, null);
    }
    for (let guard = 0; guard < 20 && separator.overlaps(D); guard++) separator.separate(D, 50, null);
    big.forEach((k, j) => {
      items[k].x = px[j] = D.x[j];
      items[k].y = py[j] = D.y[j];
    });
  }

  // 2. declarations on the lattice cells nearest the centre that the discs leave free
  if (leaves.length) {
    const rowH = (PITCH * Math.sqrt(3)) / 2;
    let Rl = Math.sqrt(leaves.length) * PITCH * 0.55 + 2 * PITCH;
    // the discs by the boxes a cell's centre must stay out of
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    for (let q = 0; q < px.length; q++) {
      x0 = Math.min(x0, px[q] - pr[q]);
      x1 = Math.max(x1, px[q] + pr[q]);
      y0 = Math.min(y0, py[q] - pr[q]);
      y1 = Math.max(y1, py[q] + pr[q]);
    }
    grid.reset(Math.max(cell, Math.sqrt(((x1 - x0) * (y1 - y0)) / (8 * px.length + 64))), px.length, x0, y0, x1, y1);
    for (let q = 0; q < px.length; q++) grid.add(q, px[q], py[q], pr[q] + LEAF_R + 0.3 + 1e-6);
    let cells: [number, number, number][] = [];
    for (let attempt = 0; attempt < 60; attempt++) {
      cells = [];
      const rows = Math.ceil(Rl / rowH);
      for (let j = -rows; j <= rows; j++) {
        const y = j * rowH;
        const off = j & 1 ? PITCH / 2 : 0;
        const cols = Math.ceil(Rl / PITCH) + 1;
        const gj = grid.row(y);
        for (let i = -cols; i <= cols; i++) {
          const x = i * PITCH + off;
          const d2 = x * x + y * y;
          if (d2 > Rl * Rl) continue;
          let ok = true;
          const m = grid.cell(grid.col(x), gj, grid.wideOnes(0));
          for (let f = 0; f < m && ok; f++) {
            const q = grid.found[f];
            const need = pr[q] + LEAF_R + 0.3;
            if (sq(x - px[q]) + sq(y - py[q]) < need * need) ok = false;
          }
          if (ok) cells.push([x, y, d2]);
        }
      }
      if (cells.length >= leaves.length) break;
      Rl *= 1.08;
    }
    cells.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    const chosen = cells.slice(0, leaves.length).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    leaves.forEach((k, j) => {
      items[k].x = chosen[j][0];
      items[k].y = chosen[j][1];
    });
  }
  }

  /** The (at most) twelve placed discs nearest (0, t) — by the distance to their edge, the first
   *  placed first among equals — found ring by ring of cells round it: a disc not found yet is at
   *  least as far as the rings reach, less the largest radius filed by its centre. */
  function nearest(px: number[], py: number[], pr: number[], t: number): number[] {
    const key = (j: number) => hypot(px[j], py[j] - t) - pr[j];
    const byKey = (a: number, b: number, ka: number, kb: number) => ka - kb || a - b;
    if (px.length <= 12 || few) {
      const ks = px.map((_, j) => key(j));
      return px.map((_, j) => j).sort((a, b) => byKey(a, b, ks[a], ks[b])).slice(0, 12);
    }
    const qi = grid.col(0), qj = grid.row(t);
    const nx = grid.columns, ny = grid.rows, w = grid.width;
    const seen = new Set<number>();
    const cand: number[] = [], ks: number[] = [];
    for (let k = 0; ; k++) {
      // the discs too wide to file by their cells, with the first ring
      const wide = k === 0 ? grid.wideOnes(0) : 0;
      for (let f = 0; f < wide; f++) {
        const b = grid.found[f];
        if (seen.has(b)) continue;
        seen.add(b);
        cand.push(b);
        ks[b] = key(b);
      }
      for (let j = qj - k; j <= qj + k; j++) {
        if (j < 0 || j >= ny) continue;
        const edge = j === qj - k || j === qj + k;
        for (let i = qi - k; i <= qi + k; i += edge ? 1 : 2 * k) {
          if (i < 0 || i >= nx) continue;
          const m = grid.cell(i, j, 0);
          for (let f = 0; f < m; f++) {
            const b = grid.found[f];
            if (seen.has(b)) continue;
            seen.add(b);
            cand.push(b);
            ks[b] = key(b);
          }
        }
      }
      const all = qi - k <= 0 && qi + k >= nx - 1 && qj - k <= 0 && qj + k >= ny - 1;
      if (cand.length >= 12 || all) {
        cand.sort((a, b) => byKey(a, b, ks[a], ks[b]));
        if (all || ks[cand[11]] + 1e-6 < k * w - rPoint) return cand.slice(0, 12);
      }
    }
  }

  function finish(): void {
  // nothing should touch now; if anything does, it is pushed apart
  const B: Bodies = {
    n,
    x: Float64Array.from(items, (it) => it.x),
    y: Float64Array.from(items, (it) => it.y),
    r: Float64Array.from(items, (it) => it.r + 0.3),
    pinned: new Uint8Array(n),
    seq: new Float64Array(n),
    big: Int32Array.from(big),
    small: Int32Array.from(leaves),
  };
  if (separator.overlaps(B)) {
    for (let guard = 0; guard < 20 && separator.overlaps(B); guard++) separator.separate(B, 50, null);
    items.forEach((it, k) => {
      it.x = B.x[k];
      it.y = B.y[k];
    });
  }
  }
}

function layoutCluster(c: TNode, pos: Float64Array): void {
  for (const k of c.kids.values()) layoutCluster(k, pos);
  // children in slot order: sub-clusters, then declarations
  const items: Item[] = [];
  for (const k of c.kids.values()) items.push({ key: "c:" + k.key, r: k.r, x: 0, y: 0, sub: k });
  for (const n of c.leaves) items.push({ key: "n:" + n, r: LEAF_R, x: 0, y: 0, leaf: n });
  c.count = c.leaves.length + [...c.kids.values()].reduce((a, k) => a + k.count, 0);

  if (items.length === 1) {
    items[0].x = 0;
    items[0].y = 0;
  } else if (items.length > 1) {
    settle(items, potentials(c));
  }
  // the enclosing disc, with room for the label
  const enc = items.length ? packEnclose(items.map((i) => ({ x: i.x, y: i.y, r: i.r }))) : { x: 0, y: 0, r: 0 };
  const pad = c.parent ? 10 + Math.min(14, Math.sqrt(c.count)) : 0;
  c.r = (enc?.r ?? 0) + pad;
  for (const it of items) {
    const x = it.x - (enc?.x ?? 0);
    const y = it.y - (enc?.y ?? 0);
    if (it.sub) {
      it.sub.x = x;
      it.sub.y = y;
    } else {
      pos[2 * it.leaf!] = x;
      pos[2 * it.leaf! + 1] = y;
    }
  }
}

/** The cluster tree of `nodes` by `mode` as a board shows it, each node in its cluster (`home`): a
 *  cluster holding nothing but one cluster merged into it (one circle, the labels joined), and the
 *  levels `hidden` names taken out (ViewSpec decision 24) — what a hidden cluster holds, its
 *  sub-clusters and its declarations, sits in its parent, the top level's at the top. A key is a
 *  full path, so whatever moves up keeps one no other cluster has: two hidden siblings' declarations
 *  simply become siblings. A cluster that moved up keeps its label, unless a sibling reads the same;
 *  then it says which hidden levels it came through (`Proof.Basic` beside `Basic`). */
function buildTree(mode: ClusterMode, nodes: ViewNode[], hidden: ReadonlySet<string>): { root: TNode; home: TNode[] } {
  const prefixes = new Set<string>();
  if (mode === "namespace") {
    for (const n of nodes) {
      if (n.ext) continue;
      const parts = splitName(n.name);
      for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join("."));
    }
  }
  const root = tnode("", "", null, false);
  const home: TNode[] = new Array(nodes.length);
  nodes.forEach((n, i) => {
    let cur = root;
    for (const part of pathOf(mode, n, prefixes)) {
      const key = cur.key ? `${cur.key}.${part}` : part;
      let next = cur.kids.get(part);
      if (!next) {
        next = tnode(key, part === EXT_KEY ? "External" : part, cur, cur.ext || part === EXT_KEY);
        cur.kids.set(part, next);
      }
      cur = next;
    }
    cur.leaves.push(i);
  });
  // a cluster holding nothing but one cluster says nothing: merge the chain into one label
  const collapse = (c: TNode) => {
    for (const [part, k] of [...c.kids]) {
      let kid = k;
      while (kid.leaves.length === 0 && kid.kids.size === 1 && kid.key !== EXT_KEY) {
        const only = [...kid.kids.values()][0];
        only.label = `${kid.label}.${only.label}`;
        only.parent = c;
        kid = only;
      }
      c.kids.set(part, kid);
      collapse(kid);
    }
  };
  collapse(root);
  // the hidden levels, bottom-up so that one inside another moves up twice; a merged chain is
  // hidden by its key, the deepest of its levels, which is the circle's. Children are known by
  // their keys from here on: two that moved up can share a last part, never a key.
  const via = new Map<TNode, string[]>();
  const lift = (c: TNode) => {
    const kids = new Map<string, TNode>();
    for (const k of c.kids.values()) {
      lift(k);
      if (!hidden.has(k.key)) {
        kids.set(k.key, k);
        continue;
      }
      for (const kk of k.kids.values()) {
        kk.parent = c;
        via.set(kk, [k.label, ...(via.get(kk) ?? [])]);
        kids.set(kk.key, kk);
      }
      c.leaves.push(...k.leaves);
    }
    c.kids = kids;
    // labels are told apart where they are drawn: never inside a level that goes
    if (hidden.has(c.key)) return;
    const seen = new Map<string, number>();
    for (const k of kids.values()) seen.set(k.label, (seen.get(k.label) ?? 0) + 1);
    for (const k of kids.values()) if (seen.get(k.label)! > 1 && via.has(k)) k.label = [...via.get(k)!, k.label].join(".");
  };
  if (hidden.size) lift(root);
  const reindex = (c: TNode) => {
    for (const n of c.leaves) home[n] = c;
    for (const k of c.kids.values()) reindex(k);
  };
  reindex(root);
  return { root, home };
}

/** The tree as a layout: clusters parents first (each with its depth), every node in its cluster;
 *  places from `rel` (each node relative to its cluster, each cluster to its parent, as
 *  layoutCluster leaves them), or all at the origin. */
function flatten(root: TNode, n: number, rel: Float64Array | null): Layout {
  const clusters: Cluster[] = [];
  const x = new Array<number>(n).fill(0);
  const y = new Array<number>(n).fill(0);
  const cluster = new Array<number>(n).fill(-1);
  const place = (c: TNode, ox: number, oy: number, parentId: number, depth: number) => {
    const cx = ox + c.x;
    const cy = oy + c.y;
    let id = parentId;
    if (c.parent) {
      id = clusters.length;
      c.id = id;
      clusters.push({
        key: c.key, label: c.label, parent: parentId, depth,
        x: round(cx), y: round(cy), lx: 0, ly: 0, r: round(c.r), count: c.count, ext: c.ext,
      });
    }
    for (const i of c.leaves) {
      if (rel) {
        x[i] = round(cx + rel[2 * i]);
        y[i] = round(cy + rel[2 * i + 1]);
      }
      cluster[i] = id;
    }
    for (const k of c.kids.values()) place(k, cx, cy, id, c.parent ? depth + 1 : 0);
  };
  place(root, 0, 0, -1, 0);
  return withLocal({ x, y, lx: [], ly: [], cluster, clusters });
}

/** The cluster tree a layout of `nodes` by `mode` with the levels `hidden` hidden has, everything at
 *  the origin: a board's structure — its clusters, their parents, depths, labels and counts, each
 *  node's cluster, in the order computeLayout gives them — without the cost of laying it out. What
 *  a layout's memory is recalled or regrouped onto (shared/board.ts), and what the exported
 *  document's sections follow (shared/doc/sections.ts). */
export function clusterTree(mode: ClusterMode, nodes: ViewNode[], hidden: Iterable<string> = []): Layout {
  const { root } = buildTree(mode, nodes, new Set(hidden));
  const count = (c: TNode): number => (c.count = c.leaves.length + [...c.kids.values()].reduce((a, k) => a + count(k), 0));
  count(root);
  return flatten(root, nodes.length, null);
}

export function computeLayout(
  mode: ClusterMode,
  nodes: ViewNode[],
  edges: Int32Array,
  hidden: Iterable<string> = [],
): Layout {
  // 1. the tree
  const { root, home } = buildTree(mode, nodes, new Set(hidden));
  // every cluster numbers its children: sub-clusters first, then declarations
  const leafSlot = new Int32Array(nodes.length);
  const number = (c: TNode) => {
    let s = 0;
    for (const k of c.kids.values()) {
      k.slot = s++;
      number(k);
    }
    for (const n of c.leaves) leafSlot[n] = s++;
    c.m = s;
    c.gOut = new Float64Array(s);
    c.gIn = new Float64Array(s);
  };
  number(root);

  // 2. edges: a dependency counts in the cluster where its two ends meet, between the children
  // holding them; in every cluster below that, the other end is outside — the ground
  const chain = (c: TNode): TNode[] => {
    const out: TNode[] = [];
    for (let x: TNode | null = c; x; x = x.parent) out.push(x);
    return out.reverse();
  };
  const chains = new Map<TNode, TNode[]>();
  const chainOf = (c: TNode) => {
    let ch = chains.get(c);
    if (!ch) chains.set(c, (ch = chain(c)));
    return ch;
  };
  for (let e = 0; e < edges.length; e += 3) {
    const u = edges[e];
    const v = edges[e + 1];
    if (u === v) continue;
    const cu = chainOf(home[u]);
    const cv = chainOf(home[v]);
    let i = 0;
    while (i < cu.length && i < cv.length && cu[i] === cv[i]) i++;
    const meet = cu[i - 1];
    const a = i < cu.length ? cu[i].slot : leafSlot[u];
    const b = i < cv.length ? cv[i].slot : leafSlot[v];
    if (a !== b) {
      const key = a * (meet.m + 1) + b;
      meet.flow.set(key, (meet.flow.get(key) ?? 0) + 1);
    }
    for (let j = i; j < cu.length; j++) cu[j].gOut[j + 1 < cu.length ? cu[j + 1].slot : leafSlot[u]]++;
    for (let j = i; j < cv.length; j++) cv[j].gIn[j + 1 < cv.length ? cv[j + 1].slot : leafSlot[v]]++;
  }

  // 3. bottom-up discs, then top-down absolute positions
  const rel = new Float64Array(nodes.length * 2);
  layoutCluster(root, rel);
  return flatten(root, nodes.length, rel);
}

/** Fill in the local coordinates from the world ones: a cluster relative to its parent, a node
 *  relative to its cluster. The scene graph on the page works in these. */
export function withLocal(L: Layout): Layout {
  for (const c of L.clusters) {
    const p = c.parent >= 0 ? L.clusters[c.parent] : null;
    c.lx = round(c.x - (p ? p.x : 0));
    c.ly = round(c.y - (p ? p.y : 0));
  }
  L.lx = L.x.map((x, i) => round(x - (L.cluster[i] >= 0 ? L.clusters[L.cluster[i]].x : 0)));
  L.ly = L.y.map((y, i) => round(y - (L.cluster[i] >= 0 ? L.clusters[L.cluster[i]].y : 0)));
  return L;
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------------------------
// Stability across rebuilds
//
// A fresh layout is a function of the whole graph, so one new declaration can reshuffle its
// cluster and, through the cluster's new radius, everything around it. A live view must not jump
// like that: people remember where things are. So the server keeps the last layout it served,
// and a new one keeps every surviving node and cluster where it was. Only what is new is placed:
// at the spot the fresh layout suggests relative to its cluster, then moved to the nearest free
// place. Quality drifts over many rebuilds; a re-layout starts afresh.

export interface LayoutMemory {
  nodes: Record<string, [number, number, string]>;
  clusters: Record<string, [number, number, number]>;
}

export function memoryOf(layout: Layout, nodes: ViewNode[]): LayoutMemory {
  const mem: LayoutMemory = { nodes: {}, clusters: {} };
  layout.clusters.forEach((c) => (mem.clusters[c.key] = [c.x, c.y, c.r]));
  nodes.forEach((n, i) => {
    const c = layout.cluster[i];
    mem.nodes[n.name] = [layout.x[i], layout.y[i], c >= 0 ? layout.clusters[c].key : ""];
  });
  return mem;
}

const SPACING = 2 * LEAF_R;

/** Points already taken, for finding free room near a target. */
class Occupancy {
  private cells = new Map<string, [number, number][]>();
  private key(x: number, y: number) {
    return `${Math.floor(x / SPACING)},${Math.floor(y / SPACING)}`;
  }
  add(x: number, y: number) {
    const k = this.key(x, y);
    const c = this.cells.get(k);
    if (c) c.push([x, y]);
    else this.cells.set(k, [[x, y]]);
  }
  free(x: number, y: number): boolean {
    const gx = Math.floor(x / SPACING);
    const gy = Math.floor(y / SPACING);
    for (let i = gx - 1; i <= gx + 1; i++) {
      for (let j = gy - 1; j <= gy + 1; j++) {
        for (const [px, py] of this.cells.get(`${i},${j}`) ?? []) {
          if (sq(px - x) + sq(py - y) < SPACING * SPACING) return false;
        }
      }
    }
    return true;
  }
}

/** The free spot nearest to (x, y), searched outward on a hexagonal spiral; `discs` are
 *  sub-clusters the spot must stay out of. */
function nearestFree(occ: Occupancy, x: number, y: number, discs: { x: number; y: number; r: number }[] = []): [number, number] {
  const ok = (px: number, py: number) =>
    occ.free(px, py) && discs.every((d) => sq(d.x - px) + sq(d.y - py) >= sq(d.r + LEAF_R));
  if (ok(x, y)) return [x, y];
  for (let ring = 1; ring < 400; ring++) {
    const n = 6 * ring;
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const px = x + cos(a) * ring * SPACING;
      const py = y + sin(a) * ring * SPACING;
      if (ok(px, py)) return [px, py];
    }
  }
  return [x, y];
}

/** `fresh` with everything `mem` remembers kept in place, relative to its cluster, unless its
 *  height in the cluster (the dependency order) moved by more than a tenth of the cluster's
 *  radius: then it goes where the fresh layout puts it. Returns the fresh layout unchanged when
 *  there is no memory or too little of the graph survived for it to mean anything. */
export function stabilize(fresh: Layout, nodes: ViewNode[], mem: LayoutMemory | null): Layout {
  if (!mem) return fresh;
  const survivors = nodes.filter((n) => mem.nodes[n.name]).length;
  if (survivors < nodes.length * 0.5) return fresh;
  const MOVE = 0.1;
  // the top level has no circle: heights there are measured against the extent of everything
  const extent = (xs: [number, number, number][]) => xs.reduce((m, [x, y, r]) => Math.max(m, hypot(x, y) + r), 1);
  const freshTop = extent(fresh.clusters.filter((c) => c.parent < 0).map((c) => [c.x, c.y, c.r]));
  const oldTop = extent(Object.values(mem.clusters));
  /** an offset in a frame of radius `r`, kept if its height did not move much */
  const keeps = (fy: number, fr: number, oy: number, or: number) => Math.abs(fy / fr - oy / or) <= MOVE;

  const cs = fresh.clusters.map((c) => ({ ...c }));
  // parents first: each keeps its old offset in its parent (so a subtree follows its parent), or
  // takes the fresh one
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const p = c.parent;
    const fp = p >= 0 ? fresh.clusters[p] : null;
    const old = mem.clusters[c.key];
    const oldP = p >= 0 ? mem.clusters[cs[p].key] : null;
    const px = p >= 0 ? cs[p].x : 0, py = p >= 0 ? cs[p].y : 0;
    const fx = fresh.clusters[i].x - (fp ? fp.x : 0), fy = fresh.clusters[i].y - (fp ? fp.y : 0);
    if (old && (p < 0 || oldP)) {
      const ox = old[0] - (oldP ? oldP[0] : 0), oy = old[1] - (oldP ? oldP[1] : 0);
      if (keeps(fy, fp ? fp.r : freshTop, oy, oldP ? oldP[2] : oldTop)) {
        c.x = round(px + ox);
        c.y = round(py + oy);
        c.r = old[2];
        continue;
      }
    }
    c.x = round(px + fx);
    c.y = round(py + fy);
  }

  const x = [...fresh.x];
  const y = [...fresh.y];
  const occ = new Occupancy();
  // each cluster's sub-clusters, and the top level's
  const kids: number[][] = cs.map(() => []);
  const top: number[] = [];
  cs.forEach((k, i) => (k.parent >= 0 ? kids[k.parent] : top).push(i));
  const placed = new Uint8Array(nodes.length);
  nodes.forEach((n, i) => {
    const old = mem.nodes[n.name];
    const c = fresh.cluster[i];
    const key = c >= 0 ? cs[c].key : "";
    if (!old || old[2] !== key) return;
    const oldC = c >= 0 ? mem.clusters[key] : null;
    if (c >= 0 && !oldC) return;
    const ox = old[0] - (oldC ? oldC[0] : 0), oy = old[1] - (oldC ? oldC[1] : 0);
    const fc = c >= 0 ? fresh.clusters[c] : null;
    const fy = fresh.y[i] - (fc ? fc.y : 0);
    if (!keeps(fy, fc ? fc.r : freshTop, oy, oldC ? oldC[2] : oldTop)) return;
    x[i] = round((c >= 0 ? cs[c].x : 0) + ox);
    y[i] = round((c >= 0 ? cs[c].y : 0) + oy);
    occ.add(x[i], y[i]);
    placed[i] = 1;
  });
  // the rest (new, or moved in the order) at the spot the fresh layout suggests in its cluster
  nodes.forEach((_, i) => {
    if (placed[i]) return;
    const c = fresh.cluster[i];
    let tx = fresh.x[i];
    let ty = fresh.y[i];
    if (c >= 0) {
      tx = cs[c].x + (fresh.x[i] - fresh.clusters[c].x);
      ty = cs[c].y + (fresh.y[i] - fresh.clusters[c].y);
    }
    // stay out of the sub-clusters of its own cluster, as they stand now
    const discs = (c >= 0 ? kids[c] : top).map((k) => ({ x: cs[k].x, y: cs[k].y, r: cs[k].r }));
    [x[i], y[i]] = nearestFree(occ, tx, ty, discs).map(round) as [number, number];
    occ.add(x[i], y[i]);
    // a disc grows to hold what was placed outside it, and so do the discs around it
    for (let k = c; k >= 0; k = cs[k].parent) {
      const d = hypot(x[i] - cs[k].x, y[i] - cs[k].y) + LEAF_R + 4;
      if (d > cs[k].r) cs[k].r = round(d);
    }
  });
  return relax(withLocal({ x, y, lx: [], ly: [], cluster: fresh.cluster, clusters: cs }));
}

/** The layout of `tree` (clusterTree) for the same declarations `mem` was made for, under other
 *  hidden levels (ViewSpec decision 24): nothing moves. Every declaration and every cluster `mem`
 *  places stays where it was on the board — a level hidden leaves what it held in place, inside the
 *  circle that holds it now — and a level shown again, which `mem` has no place for, is drawn round
 *  what it holds, where that is; the siblings it would cover make way (`relax`, in its parent
 *  alone: elsewhere a layout may hold overlaps of its own, which are left as they are). A
 *  declaration `mem` does not place (none, when the set is the same) waits at its cluster's
 *  centre. `at`: the places of the declarations by index, where a layout of the same nodes is at
 *  hand (the whole-project board's base layout), read directly rather than looked up by name. */
export function regroup(tree: Layout, nodes: ViewNode[], mem: LayoutMemory, at?: { x: number[]; y: number[] }): Layout {
  const cs = tree.clusters.map((c) => ({ ...c }));
  const x = new Array<number>(nodes.length).fill(0);
  const y = new Array<number>(nodes.length).fill(0);
  const placed = new Uint8Array(nodes.length);
  nodes.forEach((n, i) => {
    const m: readonly [number, number, ...unknown[]] | undefined = at ? [at.x[i], at.y[i]] : mem.nodes[n.name];
    if (!m) return;
    x[i] = m[0];
    y[i] = m[1];
    placed[i] = 1;
  });
  const kidsC: number[][] = cs.map(() => []);
  const kidsN: number[][] = cs.map(() => []);
  cs.forEach((c, k) => c.parent >= 0 && kidsC[c.parent].push(k));
  tree.cluster.forEach((c, i) => c >= 0 && kidsN[c].push(i));
  /** the parents of the clusters drawn anew: where something may have to make way */
  const anew = new Set<number>();
  // children before their parents: a cluster comes after its parent in the tree's order
  for (let k = cs.length - 1; k >= 0; k--) {
    const c = cs[k];
    const m = mem.clusters[c.key];
    if (m) {
      [c.x, c.y, c.r] = m;
      continue;
    }
    anew.add(c.parent);
    const discs = [...kidsC[k].map((j) => ({ x: cs[j].x, y: cs[j].y, r: cs[j].r })), ...kidsN[k].filter((i) => placed[i]).map((i) => ({ x: x[i], y: y[i], r: LEAF_R }))];
    const enc = discs.length ? packEnclose(discs) : null;
    c.x = round(enc?.x ?? 0);
    c.y = round(enc?.y ?? 0);
    c.r = round((enc?.r ?? 0) + 10 + Math.min(14, Math.sqrt(c.count)));
  }
  nodes.forEach((_, i) => {
    const c = tree.cluster[i];
    if (placed[i] || c < 0) return;
    x[i] = cs[c].x;
    y[i] = cs[c].y;
  });
  const L = withLocal({ x, y, lx: [], ly: [], cluster: tree.cluster, clusters: cs });
  return anew.size ? relax(L, anew) : L;
}

/**
 * The siblings of one parent pushed apart, as relax does: up to 40 rounds, each pushing every pair
 * that overlaps — a cluster (the first `nc` items) against every item after it — in that order, the
 * smaller one moving more; `DX`, `DY` add up how far each item moved. Returns how many pushes there
 * were. While a cluster meets the others in turn nothing moves but it and the one it meets, so what
 * it may meet is found in a grid of where they were (shared/separate.ts, BoxGrid), which gives what
 * looking at every pair gave, to the last bit.
 */
function apart(nc: number, n: number, X: Float64Array, Y: Float64Array, R: Float64Array, DX: Float64Array, DY: Float64Array): number {
  const push = (a: number, b: number): number => {
    let dx = X[b] - X[a], dy = Y[b] - Y[a];
    let d = hypot(dx, dy);
    // packed discs touch exactly: only a real overlap counts
    const need = R[a] + R[b];
    if (d >= need - 0.5) return 0;
    if (d < 1e-6) {
      dx = 1;
      dy = 0;
      d = 1;
    }
    const over = need - d;
    const wa = (R[b] * R[b]) / (R[a] * R[a] + R[b] * R[b]); // the smaller one moves more
    const ax = (-dx / d) * over * wa, ay = (-dy / d) * over * wa;
    X[a] += ax;
    Y[a] += ay;
    DX[a] += ax;
    DY[a] += ay;
    const bx = (dx / d) * over * (1 - wa), by = (dy / d) * over * (1 - wa);
    X[b] += bx;
    Y[b] += by;
    DX[b] += bx;
    DY[b] += by;
    return 1;
  };
  let moved = 0;
  if (n < 64) {
    for (let iter = 0; iter < 40; iter++) {
      let any = false;
      for (let a = 0; a < nc; a++) for (let b = a + 1; b < n; b++) if (push(a, b)) (any = true), moved++;
      if (!any) break;
    }
    return moved;
  }
  // the largest tenth filed by their boxes, the others by their centres; slacks a fraction of the
  // middling radius
  const radii = R.slice().sort();
  const rPoint = radii[Math.floor(0.9 * (n - 1))], mid = radii[n >> 1];
  const slackFiled = mid / 4, slackLook = mid / 2;
  const reachOut = slackLook + rPoint + slackFiled;
  const grid = new BoxGrid();
  const seen = new Int32Array(n).fill(-1);
  let cand = new Int32Array(64);
  const rects: number[] = [];
  /** what cluster `a` may meet seen from (qx, qy), in the cells no earlier look of its turn visited:
   *  those after `after`, in order, into the candidates from `from` on, where `to` ended them */
  const gather = (a: number, qx: number, qy: number, after: number, from: number, to: number): number => {
    const e = R[a] + reachOut;
    const i0 = grid.col(qx - e), i1 = grid.col(qx + e), j0 = grid.row(qy - e), j1 = grid.row(qy + e);
    let m = rects.length ? 0 : grid.wideOnes(0);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let done = false;
        for (let v = 0; v < rects.length && !done; v += 4) done = i >= rects[v] && i <= rects[v + 1] && j >= rects[v + 2] && j <= rects[v + 3];
        if (!done) m = grid.cell(i, j, m);
      }
    }
    rects.push(i0, i1, j0, j1);
    if (cand.length < to + m) {
      const c = new Int32Array(Math.max(2 * cand.length, to + m));
      c.set(cand.subarray(0, to));
      cand = c;
    }
    let k = to;
    for (let f = 0; f < m; f++) {
      const b = grid.found[f];
      if (seen[b] === a) continue;
      seen[b] = a;
      if (b > after) cand[k++] = b;
    }
    if (from === to) cand.subarray(from, k).sort();
    else {
      for (let j = to; j < k; j++) {
        const q = cand[j];
        let i = j;
        while (i > from && cand[i - 1] > q) {
          cand[i] = cand[i - 1];
          i--;
        }
        cand[i] = q;
      }
    }
    return k;
  };
  const s2 = sq(slackLook * 0.999), f2 = sq(slackFiled * 0.999);
  for (let iter = 0; iter < 40; iter++) {
    let any = false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < n; k++) {
      x0 = Math.min(x0, X[k]);
      x1 = Math.max(x1, X[k]);
      y0 = Math.min(y0, Y[k]);
      y1 = Math.max(y1, Y[k]);
    }
    grid.reset(Math.max(1, 0.75 * (rPoint + reachOut), Math.sqrt(((x1 - x0) * (y1 - y0)) / (4 * n + 64))), n, x0, y0, x1, y1);
    for (let k = 0; k < n; k++) grid.add(k, X[k], Y[k], R[k] <= rPoint ? 0 : R[k] + slackFiled);
    seen.fill(-1);
    for (let a = 0; a < nc; a++) {
      let qx = X[a], qy = Y[a];
      rects.length = 0;
      let nc2 = gather(a, qx, qy, a, 0, 0);
      for (let ci = 0; ci < nc2; ) {
        const b = cand[ci++];
        if (!push(a, b)) continue;
        any = true;
        moved++;
        if (sq(X[b] - grid.fx[b]) + sq(Y[b] - grid.fy[b]) > f2) grid.add(b, X[b], Y[b], grid.fe[b]);
        if (sq(X[a] - qx) + sq(Y[a] - qy) > s2) {
          qx = X[a];
          qy = Y[a];
          nc2 = gather(a, qx, qy, b, ci, nc2);
        }
      }
    }
    if (!any) break;
  }
  return moved;
}

/** Clusters that grew in place (new members) or arrived (new clusters) can overlap their
 *  siblings. Push siblings apart in each parent's local frame, smallest moving most, bottom-up so
 *  a parent sees its children's final sizes; then let each parent grow to hold its children and
 *  recompute world positions from the local ones. Nothing already apart moves. `only`: the parents
 *  (-1 the top) whose children are looked at, and each one's parent once it grew; every one where
 *  it is left out. */
export function relax(L: Layout, only?: ReadonlySet<number>): Layout {
  const cs = L.clusters;
  const kidsC: number[][] = cs.map(() => []);
  const kidsN: number[][] = cs.map(() => []);
  const rootC: number[] = [];
  const rootN: number[] = [];
  cs.forEach((c, i) => (c.parent >= 0 ? kidsC[c.parent] : rootC).push(i));
  L.cluster.forEach((c, i) => (c >= 0 ? kidsN[c] : rootN).push(i));
  // how far each item moved in its parent's frame; world positions change by exactly the sum
  // of these along the chain, so whatever did not move keeps its coordinates to the last digit
  const dcx = new Float64Array(cs.length), dcy = new Float64Array(cs.length);
  const dnx = new Float64Array(L.x.length), dny = new Float64Array(L.x.length);
  const separate = (kc: number[], kn: number[]) => {
    if (!kc.length) return 0;
    const nc = kc.length, n = nc + kn.length;
    const X = new Float64Array(n), Y = new Float64Array(n), R = new Float64Array(n);
    const DX = new Float64Array(n), DY = new Float64Array(n);
    kc.forEach((c, j) => ([X[j], Y[j], R[j]] = [cs[c].lx, cs[c].ly, cs[c].r]));
    kn.forEach((i, j) => ([X[nc + j], Y[nc + j], R[nc + j]] = [L.lx[i], L.ly[i], LEAF_R]));
    const moved = apart(nc, n, X, Y, R, DX, DY);
    kc.forEach((c, j) => {
      cs[c].lx = X[j];
      cs[c].ly = Y[j];
      dcx[c] += DX[j];
      dcy[c] += DY[j];
    });
    kn.forEach((i, j) => {
      L.lx[i] = X[nc + j];
      L.ly[i] = Y[nc + j];
      dnx[i] += DX[nc + j];
      dny[i] += DY[nc + j];
    });
    return moved;
  };
  const look = only ? new Set(only) : null;
  for (let c = cs.length - 1; c >= 0; c--) {
    if (look && !look.has(c)) continue;
    if (separate(kidsC[c], kidsN[c]) === 0) continue;
    // grow to hold what moved
    let reach = 0;
    for (const k of kidsC[c]) reach = Math.max(reach, hypot(cs[k].lx, cs[k].ly) + cs[k].r);
    for (const i of kidsN[c]) reach = Math.max(reach, hypot(L.lx[i], L.ly[i]) + LEAF_R);
    const was = cs[c].r;
    cs[c].r = round(Math.max(cs[c].r, reach + 6));
    // a parent that grew may now cover its siblings: its own parent is looked at in its turn
    if (look && cs[c].r !== was) look.add(cs[c].parent);
  }
  if (!look || look.has(-1)) separate(rootC, rootN);
  // world positions move by the accumulated deltas, parents first
  const wdx = new Float64Array(cs.length), wdy = new Float64Array(cs.length);
  cs.forEach((c, i) => {
    wdx[i] = (c.parent >= 0 ? wdx[c.parent] : 0) + dcx[i];
    wdy[i] = (c.parent >= 0 ? wdy[c.parent] : 0) + dcy[i];
    if (wdx[i] || wdy[i]) {
      c.x = round(c.x + wdx[i]);
      c.y = round(c.y + wdy[i]);
      c.lx = round(c.lx);
      c.ly = round(c.ly);
    }
  });
  for (let i = 0; i < L.x.length; i++) {
    const c = L.cluster[i];
    const dx = (c >= 0 ? wdx[c] : 0) + dnx[i];
    const dy = (c >= 0 ? wdy[c] : 0) + dny[i];
    if (dx || dy) {
      L.x[i] = round(L.x[i] + dx);
      L.y[i] = round(L.y[i] + dy);
      L.lx[i] = round(L.lx[i]);
      L.ly[i] = round(L.ly[i]);
    }
  }
  return L;
}
