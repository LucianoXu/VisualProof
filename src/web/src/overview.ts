// The overview's edges, chosen (CanvasSpec.md, "Edges"): with nothing selected, which edges between
// the units on screen are drawn, and how. What is drawn is chosen at zoom points a quarter of a zoom
// step apart (a step: a half octave), each point from the aggregations of the two steps it lies
// between, for the camera's centre when it was asked for; the page blends two points (or, while one
// is late, what it has) and writes the instances.
//
// The choosing runs off the page's thread (the owner's request, 2026-10-10: no slow frames while
// zooming), in a worker (web/src/edgeworker.ts) asked by web/src/edgequeue.ts, which holds a copy of
// the graph's edges and of the scene's tree and is sent the positions with each question. Where there
// is no worker, the page runs the same OverviewModel on its own thread, as it used to.
//
// Position ids, as in web/src/bundles.ts: cluster c → c, node i → nc + i.

import { SITE_BODY, SITE_GRAMMAR, SITE_PROOF, SITE_STMT } from "../../shared/graph.ts";
import { type EdgeGraph, type Pairs, aggregate, pathOf, topK, units } from "./bundles.ts";

/** How far apart the overview's zoom points are, in zoom steps (a step: a half octave): about 9%
 *  of zoom, the distance at which what is drawn used to be chosen again. */
export const ZOOM_POINT = 0.25;

/** The zoom-point coordinate of a camera zoom `k`: point i is at zoom 2^(i · ZOOM_POINT / 2). */
export const zoomPoint = (k: number): number => (2 * Math.log2(k)) / ZOOM_POINT;

/** How one edge of the overview is drawn: its control points, its bundling strength, its width in
 *  pixels and its alpha. */
export interface EdgeLook {
  path: number[];
  beta: number;
  width: number;
  alpha: number;
}

/** Two sets of edges blended, the second at `t` (0 to 1) and the first at what is left: an edge both
 *  hold given once, between its two looks; one only one holds at that one's share. */
export function blendLooks(
  a: Map<string, EdgeLook> | null,
  b: Map<string, EdgeLook> | null,
  t: number,
  put: (e: EdgeLook, beta: number, width: number, alpha: number, key: string) => void,
): void {
  const A = t >= 1 ? null : a;
  const B = t <= 0 ? null : b;
  const give = (e: EdgeLook, beta: number, width: number, alpha: number, key: string) => {
    if (alpha > 0.002) put(e, beta, width, alpha, key);
  };
  if (A)
    for (const [key, x] of A) {
      const y = B?.get(key);
      if (y) give(y, x.beta + (y.beta - x.beta) * t, x.width + (y.width - x.width) * t, x.alpha + (y.alpha - x.alpha) * t, key);
      else give(x, x.beta, x.width, x.alpha * (1 - t), key);
    }
  if (B) for (const [key, y] of B) if (!A?.has(key)) give(y, y.beta, y.width, y.alpha * t, key);
}

/** 0 below `a`, 1 above `b`, smoothly between. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------ what the choosing reads

/** What of the graph the overview reads: its edges, and where the outside world begins. */
export type OverviewGraph = EdgeGraph & { projectCount: number };

/** What of the scene's tree the overview reads; it changes with a new layout and with what is shut
 *  (Scene.repVersion). */
export interface Tree {
  nc: number;
  n: number;
  parent: Int32Array;
  nodeCluster: Int32Array;
  rep: Int32Array;
}

/** Where everything is when a point is chosen: world positions, and the circles' radii (the eased
 *  one `units` reads, and the drawn one the bundling strength reads). They move while the scene does,
 *  so a question carries the ones it is asked at. */
export interface Places {
  cwx: Float32Array;
  cwy: Float32Array;
  nwx: Float32Array;
  nwy: Float32Array;
  curR: Float32Array;
  drawnR: Float32Array;
}

/** The overview's toggles: the outside world shown. */
export interface Toggles {
  externals: boolean;
}

/** One zoom point asked for: `point` the zoom-point index, the camera's centre (`x`, `y`), the
 *  canvas's size, and whether a selection dims the overview. */
export interface PointAsk {
  point: number;
  x: number;
  y: number;
  w: number;
  h: number;
  dim: boolean;
}

/** What a point draws, packed for the trip from the worker: edge j runs from unit a[j] to unit b[j]
 *  through len[j] control points path[8j ..]; its beta, width and alpha. In the order the edges are
 *  drawn. */
export interface PointLooks {
  n: number;
  a: Int32Array;
  b: Int32Array;
  path: Int32Array;
  len: Uint8Array;
  beta: Float64Array;
  width: Float64Array;
  alpha: Float64Array;
}

/** The buffers a point's looks travel in, transferred rather than copied. */
export const looksBuffers = (L: PointLooks): ArrayBuffer[] =>
  [L.a, L.b, L.path, L.len, L.beta, L.width, L.alpha].map((x) => x.buffer as ArrayBuffer);

/** An edge's key among a point's looks: its two units. */
export const edgeKey = (a: number, b: number): number => a * 4194304 + b;

/** A point's looks indexed by edge key. */
export function indexLooks(L: PointLooks): Map<number, number> {
  const m = new Map<number, number>();
  for (let j = 0; j < L.n; j++) m.set(edgeKey(L.a[j], L.b[j]), j);
  return m;
}

function pack(looks: Map<string, EdgeLook>): PointLooks {
  const n = looks.size;
  const L: PointLooks = {
    n,
    a: new Int32Array(n),
    b: new Int32Array(n),
    path: new Int32Array(8 * n),
    len: new Uint8Array(n),
    beta: new Float64Array(n),
    width: new Float64Array(n),
    alpha: new Float64Array(n),
  };
  let j = 0;
  for (const e of looks.values()) {
    // a path runs from one end to the other (pathOf)
    L.a[j] = e.path[0];
    L.b[j] = e.path[e.path.length - 1];
    L.path.set(e.path, 8 * j);
    L.len[j] = e.path.length;
    L.beta[j] = e.beta;
    L.width[j] = e.width;
    L.alpha[j] = e.alpha;
    j++;
  }
  return L;
}

// ------------------------------------------------------------------ the choosing

/** The overview's aggregation at one zoom step: each unit, the edges between units counted. */
interface OverviewLevel {
  pairs: Pairs;
  units: Int32Array;
}

/** What of a step is chosen for a view (indices into its pairs; `inside`: both ends in view;
 *  `strength`: 1 within the budget, less past it). */
interface Chosen {
  sel: Int32Array;
  inside: Uint8Array;
  strength: Float32Array;
}

/** How many zoom steps' aggregations are kept: the camera's two and one on either side, and two more
 *  for where it heads or lands. */
export const LEVELS_KEPT = 6;

/** The choosing, wherever it runs: the graph's edges and the scene's tree as last given, and the
 *  aggregations of the zoom steps last used (LEVELS_KEPT of them), kept until the tree or the
 *  toggles change. */
export class OverviewModel {
  private g: OverviewGraph | null = null;
  private tree: Tree | null = null;
  private toggles: Toggles = { externals: true };
  private levels = new Map<number, OverviewLevel>();

  setGraph(g: OverviewGraph): void {
    this.g = g;
    this.levels.clear();
  }

  setTree(tree: Tree, toggles: Toggles): void {
    this.tree = tree;
    this.toggles = { ...toggles };
    this.levels.clear();
  }

  /** How many zoom steps' aggregations are held (for the tests). */
  get levelCount(): number {
    return this.levels.size;
  }

  /** What the overview draws at zoom point `ask.point` (zoom 2^(point · ZOOM_POINT / 2)), for the
   *  camera centred at (x, y), with everything where `places` has it: chosen from the aggregations of
   *  the two steps the point lies between, blended as it lies between them — none of the finer over
   *  the first fifth of the way, all of it over the last fifth, smoothly between. */
  choose(ask: PointAsk, places: Places): PointLooks {
    if (!this.g || !this.tree) throw new Error("the overview has no graph or no tree yet");
    const zs = ask.point * ZOOM_POINT;
    const cam = { x: ask.x, y: ask.y, k: Math.pow(2, zs / 2) };
    const lo = Math.floor(zs);
    const up = smoothstep(0.2, 0.8, zs - lo);
    const at = (level: number) => {
      let v = this.levels.get(level);
      if (v) this.levels.delete(level);
      else v = this.aggregateLevel(level, places);
      // the last used last: the one used longest ago goes first
      this.levels.set(level, v);
      while (this.levels.size > LEVELS_KEPT) this.levels.delete(this.levels.keys().next().value!);
      return this.looksOf(v, this.chooseLevel(v, cam, ask, places), ask, places);
    };
    const coarse = up < 1 ? at(lo) : null;
    const fine = up > 0 ? at(lo + 1) : null;
    const looks = new Map<string, EdgeLook>();
    blendLooks(coarse, fine, up, (e, beta, width, alpha, key) => looks.set(key, { path: e.path, beta, width, alpha }));
    return pack(looks);
  }

  /** The aggregation of zoom step `level`: each node's unit as the camera at 2^(level/2) sees it,
   *  and the edges between units, counted. */
  private aggregateLevel(level: number, places: Places): OverviewLevel {
    const g = this.g!;
    const unit = units({ ...this.tree!, curR: places.curR }, Math.pow(2, level / 2), 45);
    // statements and bodies: never proofs or grammar, which no TCB follows (proof edges are no more,
    // the owner's decision of 2026-10-15)
    const sites = SITE_STMT | SITE_BODY;
    const ext = this.toggles.externals;
    const pairs = aggregate(g, unit, sites, (i) => i < g.projectCount || ext);
    return { pairs, units: Int32Array.from(new Set(unit)) };
  }

  /** Choose what step `v` draws for a camera `cam`. About 0.6 per unit on screen (between 250 and
   *  1,500), so that zoomed in each stays an edge one can follow: those with both ends in view
   *  first (heaviest first; among equals the short ones, then those nearest the middle of the
   *  screen), then, in up to a fifth of the budget, those leaving the view (heaviest first): what
   *  the part in view uses, or is used by, elsewhere. The limit is soft: the next fifth past it is
   *  drawn fainter the further past it. */
  private chooseLevel(v: OverviewLevel, cam: { x: number; y: number; k: number }, ask: PointAsk, S: Places): Chosen {
    const P = v.pairs;
    const hw = ask.w / 2 / cam.k, hh = ask.h / 2 / cam.k;
    // a margin of a quarter of the view: what is about to scroll in is already there
    const x0 = cam.x - hw * 1.25, x1 = cam.x + hw * 1.25, y0 = cam.y - hh * 1.25, y1 = cam.y + hh * 1.25;
    const diag = Math.hypot(hw, hh);
    const nc = this.tree!.nc;
    const X = (id: number) => (id < nc ? S.cwx[id] : S.nwx[id - nc]);
    const Y = (id: number) => (id < nc ? S.cwy[id] : S.nwy[id - nc]);
    const U = v.units;
    let onScreen = 0;
    for (let k = 0; k < U.length; k++) {
      const x = X(U[k]), y = Y(U[k]);
      if (Math.abs(x - cam.x) <= hw && Math.abs(y - cam.y) <= hh) onScreen++;
    }
    const budget = Math.max(250, Math.min(1500, Math.round(0.6 * onScreen)));
    const score = new Float64Array(P.n);
    const both: number[] = [];
    const one: number[] = [];
    for (let k = 0; k < P.n; k++) {
      const ax = X(P.a[k]), ay = Y(P.a[k]), bx = X(P.b[k]), by = Y(P.b[k]);
      const ia = ax >= x0 && ax <= x1 && ay >= y0 && ay <= y1;
      const ib = bx >= x0 && bx <= x1 && by >= y0 && by <= y1;
      if (!ia && !ib) continue;
      if (ia && ib) {
        // the weight decides; among equals, the short one, then the one nearer the middle
        const len = Math.hypot(bx - ax, by - ay) / diag;
        const d = Math.hypot((ax + bx) / 2 - cam.x, (ay + by) / 2 - cam.y) / diag;
        score[k] = P.w[k] + 0.55 * (1 - Math.min(1, len)) + 0.4 * (1 - Math.min(1, d));
        both.push(k);
      } else {
        score[k] = P.w[k];
        one.push(k);
      }
    }
    // each kind's share, and the soft fifth past it, ranked by score: rank r past the share draws
    // the fainter the further past
    const soft = (n: number) => Math.ceil(n * 1.2);
    const ranked = (idx: number[], cap: number): { idx: Int32Array; strength: Float32Array } => {
      const top = Array.from(topK(Int32Array.from(idx), score, soft(cap))).sort((a, b) => score[b] - score[a]);
      const strength = new Float32Array(top.length);
      const span = Math.max(1, soft(cap) - cap);
      for (let r = 0; r < top.length; r++) strength[r] = r < cap ? 1 : Math.max(0, 1 - (r - cap + 1) / (span + 1));
      return { idx: Int32Array.from(top), strength };
    };
    const innerCap = budget - Math.min(Math.round(budget / 5), one.length);
    const inner = ranked(both, innerCap);
    const outer = ranked(one, budget - Math.min(inner.idx.length, innerCap));
    const n = inner.idx.length + outer.idx.length;
    const sel = new Int32Array(n), inside = new Uint8Array(n), strength = new Float32Array(n);
    sel.set(inner.idx);
    sel.set(outer.idx, inner.idx.length);
    inside.fill(1, 0, inner.idx.length);
    strength.set(inner.strength);
    strength.set(outer.strength, inner.idx.length);
    return { sel, inside, strength };
  }

  /** How step `v` draws what was chosen of it, each edge by its units' ids (`a:b`): width and alpha
   *  grow with the weight relative to the heaviest chosen of their kind (in view, or leaving it), so
   *  zoomed in a single dependency between two declarations reads as clearly as a heavy bundle does
   *  zoomed out; an edge past the soft limit fainter by its rank. */
  private looksOf(v: OverviewLevel, chosen: Chosen, ask: PointAsk, S: Places): Map<string, EdgeLook> {
    const P = v.pairs;
    const T = this.tree!;
    const { sel, inside, strength } = chosen;
    let maxIn = 1, maxOut = 1, nIn = 0, n = 0;
    for (let j = 0; j < sel.length; j++) {
      const w = P.w[sel[j]];
      n += strength[j];
      if (inside[j]) {
        maxIn = Math.max(maxIn, w);
        nIn += strength[j];
      } else maxOut = Math.max(maxOut, w);
    }
    const nc = T.nc;
    const X = (id: number) => (id < nc ? S.cwx[id] : S.nwx[id - nc]);
    const Y = (id: number) => (id < nc ? S.cwy[id] : S.nwy[id - nc]);
    // many bundles share the screen: the more there are, the fainter each; with a selection the
    // overview steps back so the selection's own edges read
    const crowd = Math.min(1, Math.sqrt(OVERVIEW_CROWD / Math.max(1, n)));
    const fade = (ask.dim ? DIM : 1) * crowd;
    // few edges in view (zoomed in): even a single one clearly visible
    const floor = 0.05 + 0.3 * Math.min(1, Math.max(0, (1200 - nIn) / 900));
    const looks = new Map<string, EdgeLook>();
    for (let j = 0; j < sel.length; j++) {
      const k = sel[j];
      const a = P.a[k], b = P.b[k], w = P.w[k];
      const max = inside[j] ? maxIn : maxOut;
      const t = Math.log1p(w) / Math.log1p(max);
      // widths are absolute enough that a bundle of one stays a thin line
      const width = 0.7 + 2.0 * t * Math.min(1, Math.log1p(max) / Math.log1p(50));
      const alpha = (floor + (0.45 - floor) * t * t) * fade * strength[j];
      // bundling strength: an edge short beside the cluster it would bend through (neighbours in
      // a cluster seen up close) is drawn nearly straight, so it reads as an edge between those
      // two; one that spans its cluster bends along the tree
      const path = pathOf(T, a, b);
      let R = 0;
      for (let q = 1; q < path.length - 1; q++) if (path[q] < nc) R = Math.max(R, S.drawnR[path[q]]);
      const d = Math.hypot(X(b) - X(a), Y(b) - Y(a));
      const beta = R > 0 ? 0.85 * Math.min(1, (2 * d) / R) : 0.85;
      looks.set(`${a}:${b}`, { path, beta, width, alpha });
    }
    return looks;
  }
}

/** The number of bundles past which the more there are, the fainter each (looksOf); a theme's own
 *  fading with their number starts there too (web/src/canvas.ts, crowdFade). */
export const OVERVIEW_CROWD = 400;

/** How much a selection dims the overview, so that its own edges read, the rest still seen faintly:
 *  on the board and in an artwork alike (the owner's decision of 2026-10-15; 0.12 before). */
export const DIM = 0.3;

// ------------------------------------------------------------------ the worker's protocol

/** What the page tells the worker. `graph`: the graph's edges, once per graph; `tree`: the scene's
 *  tree and the toggles, whenever either changes, numbered (`base`); `near`: the zoom points still
 *  wanted, [lo, hi] — a question waiting for any other is dropped; `choose`: one zoom point, with the
 *  positions it is asked at, `pri` 0 for a point the camera needs, 1 for one asked ahead. */
export type ToWorker =
  | { type: "graph"; n: number; projectCount: number; outStart: Int32Array; outDst: Int32Array; outSite: Uint8Array }
  | ({ type: "tree"; base: number } & Tree & Toggles)
  | { type: "near"; base: number; lo: number; hi: number }
  | ({ type: "choose"; id: number; base: number; pri: number; places: Places } & PointAsk);

/** What the worker answers a `choose` with: the point's looks and how long they took; or that it was
 *  dropped unanswered (no longer wanted, or asked again since); or what went wrong. */
export type FromWorker =
  | { type: "looks"; id: number; point: number; looks: PointLooks; ms: number }
  | { type: "dropped"; id: number }
  | { type: "error"; id: number; error: string };

// ------------------------------------------------------------------ blending on the page

/** A point's looks as the page blends them: at weight `w`, its alphas times `scale` (a point chosen
 *  under another selection, shown dimmed as the selection now is until it is chosen again). */
export interface Weighted {
  looks: PointLooks;
  index: Map<number, number>;
  w: number;
  scale: number;
}

/** Blend sets of looks, in order of their zoom points, their weights summing to 1, and give what is
 *  drawn: `put(looks, j, beta, width, alpha)` for edge j of `looks`. Two sets are blended exactly as
 *  blendLooks blends them (the second at its weight); with more (a late point being caught up), an
 *  edge's alpha is the sum of its sets' alphas at their weights, and its beta and width are the
 *  weighted mean over the sets that hold it. An edge is given once, in the order of the first set that
 *  holds it; one too faint to see is left out. */
export function blendPoints(sets: Weighted[], put: (L: PointLooks, j: number, beta: number, width: number, alpha: number) => void): void {
  const give = (L: PointLooks, j: number, beta: number, width: number, alpha: number) => {
    if (alpha > 0.002) put(L, j, beta, width, alpha);
  };
  if (sets.length <= 2) {
    const t = sets.length === 2 ? sets[1].w : 0;
    const A = t >= 1 ? null : sets[0] ?? null;
    const B = t <= 0 ? null : sets[1] ?? null;
    if (A) {
      const X = A.looks;
      for (let j = 0; j < X.n; j++) {
        const xa = X.alpha[j] * A.scale;
        const k = B ? B.index.get(edgeKey(X.a[j], X.b[j])) : undefined;
        if (k !== undefined) {
          const Y = B!.looks;
          const ya = Y.alpha[k] * B!.scale;
          give(Y, k, X.beta[j] + (Y.beta[k] - X.beta[j]) * t, X.width[j] + (Y.width[k] - X.width[j]) * t, xa + (ya - xa) * t);
        } else give(X, j, X.beta[j], X.width[j], xa * (1 - t));
      }
    }
    if (B) {
      const Y = B.looks;
      for (let k = 0; k < Y.n; k++) {
        if (A && A.index.has(edgeKey(Y.a[k], Y.b[k]))) continue;
        give(Y, k, Y.beta[k], Y.width[k], Y.alpha[k] * B.scale * t);
      }
    }
    return;
  }
  const seen = new Set<number>();
  for (let s = 0; s < sets.length; s++) {
    const X = sets[s].looks;
    for (let j = 0; j < X.n; j++) {
      const key = edgeKey(X.a[j], X.b[j]);
      if (seen.has(key)) continue;
      seen.add(key);
      let alpha = 0, beta = 0, width = 0, held = 0;
      for (let r = s; r < sets.length; r++) {
        const S = sets[r];
        const k = r === s ? j : S.index.get(key);
        if (k === undefined) continue;
        alpha += S.w * S.looks.alpha[k] * S.scale;
        beta += S.w * S.looks.beta[k];
        width += S.w * S.looks.width[k];
        held += S.w;
      }
      if (held > 0) give(X, j, beta / held, width / held, alpha);
    }
  }
}

// ------------------------------------------------------------------ following the camera

/** What the overview draws, as weights of zoom points, by point; the weights sum to 1. */
export type Weights = { point: number; w: number }[];

/** Two points ready further apart than this are not blended across: the gap is too wide for what
 *  lies between them to be read from them. */
export const BRACKET = 4;

/** What the camera at zoom-point coordinate `z` would draw with the points `ready` (any order): the
 *  two points it lies between, blended by where it lies; where one of them is not ready, the nearest
 *  ready ones on either side, blended by where it lies between them (when they are at most BRACKET
 *  apart), or the nearest one ready at full weight. Only the points ready within `near` are looked at
 *  while there are any. Null when nothing is ready. */
export function aim(z: number, ready: Iterable<number>, near: [number, number] = [-Infinity, Infinity]): Weights | null {
  const all = [...ready];
  const inside = all.filter((r) => r >= near[0] && r <= near[1]);
  const R = new Set(inside.length ? inside : all);
  const i0 = Math.floor(z);
  const t = z - i0;
  if (R.has(i0) && R.has(i0 + 1)) return [{ point: i0, w: 1 - t }, { point: i0 + 1, w: t }];
  let p = -Infinity, q = Infinity;
  for (const r of R) {
    if (r <= z && r > p) p = r;
    if (r >= z && r < q) q = r;
  }
  if (p === q) return [{ point: p, w: 1 }];
  if (q - p <= BRACKET) {
    const u = (z - p) / (q - p);
    return [{ point: p, w: 1 - u }, { point: q, w: u }];
  }
  if (z - p <= q - z) return isFinite(p) ? [{ point: p, w: 1 }] : null;
  return [{ point: q, w: 1 }];
}

/** How much weight separates two blends: what has to move from one point to another. */
export function weightGap(a: Weights, b: Weights): number {
  const m = new Map<number, number>();
  for (const x of a) m.set(x.point, (m.get(x.point) ?? 0) + x.w);
  for (const x of b) m.set(x.point, (m.get(x.point) ?? 0) - x.w);
  let d = 0;
  for (const v of m.values()) d += Math.abs(v);
  return d / 2;
}

/** `from` moved towards `to` by at most `step` of weight: all the way when it is that near
 *  (`to` itself, so that a camera followed exactly draws exactly what it would), else that far along
 *  the straight way between them. */
export function ease(from: Weights, to: Weights, step: number): Weights {
  const d = weightGap(from, to);
  if (d <= step + 1e-12) return to;
  const f = step / d;
  const m = new Map<number, number>();
  for (const x of from) m.set(x.point, (m.get(x.point) ?? 0) + x.w * (1 - f));
  for (const x of to) m.set(x.point, (m.get(x.point) ?? 0) + x.w * f);
  return [...m].filter(([, w]) => w > 1e-9).sort((a, b) => a[0] - b[0]).map(([point, w]) => ({ point, w }));
}
