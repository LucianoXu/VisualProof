// Elastic motion, computed along the hierarchy (CanvasSpec.md, "Motion").
//
// Every cluster is a frame: its direct children are the bodies it simulates, in its own local
// coordinates — nodes as small discs, sub-clusters as discs of their drawn radius. Forces:
//   - the anchor spring pulls each body back to its anchor (elastic return);
//   - collisions keep siblings apart (resolved positionally, which is stable at any stiffness);
//   - dependency springs join the two children of the lowest common ancestor of an edge's ends,
//     the same decomposition a bundled edge follows, with the anchors' distance as rest length:
//     at rest they do nothing, when a body is moved what it is tied to follows and springs back.
// Collisions act while something is being dragged: that is when bodies must make way. Once let
// go, every body returns to its anchor straight through the others, so nothing can get stuck
// behind a neighbour in a tight packing (anchors never overlap, so the rest is clean).
// A frame sleeps once nothing in it moves. Moving a cluster body carries its subtree for free,
// since everything under it is local. During a drag only, a contact pass lets the dragged body
// push individual nodes of other clusters, so what it touches makes way.

import { SITE_BODY, SITE_STMT } from "../../shared/graph.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { LEAF_R } from "./scene.ts";
import type { Scene } from "./scene.ts";

const K_ANCHOR = 140; // s^-2: comes back in about half a second
const DAMPING = 2 * 0.62 * Math.sqrt(K_ANCHOR); // slightly under critical: a liquid settle
const K_DEP = 18;
const SUBSTEP = 1 / 120;
const REST = 0.03;
const ROOT = -1;

interface Spring {
  a: number;
  b: number;
  k: number;
}

interface FrameData {
  rep: number;
  ids: Int32Array;
  /** the first nBig bodies are clusters (discs), the rest nodes */
  nBig: number;
  sa: Int32Array;
  sb: Int32Array;
  sk: Float64Array;
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  ax: Float64Array;
  ay: Float64Array;
  r: Float64Array;
  fx: Float64Array;
  fy: Float64Array;
  cell: Float64Array;
  order: Int32Array;
}

export class Motion {
  private S: Scene;
  private vcx: Float32Array;
  private vcy: Float32Array;
  private vnx: Float32Array;
  private vny: Float32Array;
  /** springs per frame (cluster id, or -1 for the root), between body ids */
  private springs = new Map<number, Spring[]>();
  private awake = new Set<number>();
  /** the body under the pointer: kept where the pointer puts it */
  drag: number | null = null;
  /** the dragged body's anchor before the drag, in its frame: what its springs measure their rest
   *  length from, so that what it is tied to follows it and springs back after */
  dragFrom: [number, number] | null = null;
  /** visible nodes near a world point; the canvas answers from its hit grid */
  near: (wx: number, wy: number, r: number) => number[] = () => [];

  constructor(scene: Scene, g: Graph) {
    this.S = scene;
    this.vcx = new Float32Array(scene.nc);
    this.vcy = new Float32Array(scene.nc);
    this.vnx = new Float32Array(scene.n);
    this.vny = new Float32Array(scene.n);
    this.buildSprings(g);
  }

  /** Body ids: a cluster is its index, a node is nc + its index. */
  private frameOf(body: number): number {
    const S = this.S;
    return body < S.nc ? S.parent[body] : S.nodeCluster[body - S.nc];
  }

  /** An edge u → v becomes a spring in the frame where the two first meet. */
  private buildSprings(g: Graph): void {
    const S = this.S;
    const count = new Map<number, Map<number, number>>(); // frame → (pair key → count)
    const up = (i: number): [number[], number[]] => {
      // (frame, body) pairs from the node up to the root
      const frames: number[] = [];
      const bodies: number[] = [];
      let body = S.nc + i;
      let frame = S.nodeCluster[i];
      for (;;) {
        frames.push(frame);
        bodies.push(body);
        if (frame === ROOT) break;
        body = frame;
        frame = S.parent[frame];
      }
      return [frames, bodies];
    };
    const memo = new Map<number, [number[], number[]]>();
    const path = (i: number) => {
      let p = memo.get(i);
      if (!p) memo.set(i, (p = up(i)));
      return p;
    };
    for (let u = 0; u < g.n; u++) {
      for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
        if (!(g.outSite[e] & (SITE_STMT | SITE_BODY))) continue;
        const v = g.outDst[e];
        const [fu, bu] = path(u);
        const [fv, bv] = path(v);
        // lowest frame on both paths
        const at = new Map<number, number>();
        fu.forEach((f, k) => at.set(f, k));
        for (let k = 0; k < fv.length; k++) {
          const ku = at.get(fv[k]);
          if (ku === undefined) continue;
          const a = bu[ku], b = bv[k];
          if (a !== b) {
            const key = a < b ? a * 4_194_304 + b : b * 4_194_304 + a;
            let m = count.get(fv[k]);
            if (!m) count.set(fv[k], (m = new Map()));
            m.set(key, (m.get(key) ?? 0) + 1);
          }
          break;
        }
      }
    }
    for (const [frame, m] of count) {
      const deg = new Map<number, number>();
      for (const key of m.keys()) {
        const a = Math.floor(key / 4_194_304), b = key % 4_194_304;
        deg.set(a, (deg.get(a) ?? 0) + 1);
        deg.set(b, (deg.get(b) ?? 0) + 1);
      }
      const list: Spring[] = [];
      for (const [key, n] of m) {
        const a = Math.floor(key / 4_194_304), b = key % 4_194_304;
        // heavier bundles pull harder; busy bodies are not pulled apart by their many ties
        list.push({ a, b, k: (K_DEP * Math.log1p(n)) / Math.sqrt(Math.max(deg.get(a)!, deg.get(b)!)) });
      }
      this.springs.set(frame, list);
    }
  }

  wake(frame: number): void {
    this.awake.add(frame);
  }

  wakeBody(body: number): void {
    this.awake.add(this.frameOf(body));
  }

  get moving(): boolean {
    return this.awake.size > 0;
  }

  /** Wake every frame whose bodies are away from their anchors (after folds moved anchors). */
  wakeDisplaced(): void {
    const S = this.S;
    for (let c = 0; c < S.nc; c++) {
      if (Math.abs(S.curCX[c] - S.ancCX[c]) > REST || Math.abs(S.curCY[c] - S.ancCY[c]) > REST) this.awake.add(S.parent[c]);
    }
    for (let i = 0; i < S.n; i++) {
      if (Math.abs(S.curNX[i] - S.ancNX[i]) > REST || Math.abs(S.curNY[i] - S.ancNY[i]) > REST) this.awake.add(S.nodeCluster[i]);
    }
  }

  // body accessors
  private px(b: number): number {
    return b < this.S.nc ? this.S.curCX[b] : this.S.curNX[b - this.S.nc];
  }
  private py(b: number): number {
    return b < this.S.nc ? this.S.curCY[b] : this.S.curNY[b - this.S.nc];
  }
  private setP(b: number, x: number, y: number): void {
    if (b < this.S.nc) {
      this.S.curCX[b] = x;
      this.S.curCY[b] = y;
    } else {
      this.S.curNX[b - this.S.nc] = x;
      this.S.curNY[b - this.S.nc] = y;
    }
  }
  private ax(b: number): number {
    return b < this.S.nc ? this.S.ancCX[b] : this.S.ancNX[b - this.S.nc];
  }
  private ay(b: number): number {
    return b < this.S.nc ? this.S.ancCY[b] : this.S.ancNY[b - this.S.nc];
  }
  private radius(b: number): number {
    return b < this.S.nc ? Math.max(this.S.drawnR[b], LEAF_R) : LEAF_R;
  }

  /** Advance the awake frames by dt ms. */
  step(dtMs: number): void {
    const S = this.S;
    let steps = Math.max(1, Math.min(8, Math.round(dtMs / 1000 / SUBSTEP)));
    while (steps-- > 0) {
      for (const f of [...this.awake]) this.stepFrame(f);
    }
    if (this.drag !== null) this.contact();
    // a frame whose contents now reach beyond its disc pushes on its siblings: wake the parent
    for (const f of [...this.awake]) {
      if (f === ROOT) continue;
      let reach = 0;
      for (const c of S.kidsC[f]) reach = Math.max(reach, Math.hypot(S.curCX[c], S.curCY[c]) + S.drawnR[c]);
      for (const i of S.kidsN[f]) if (S.nodeRep[i] < 0) reach = Math.max(reach, Math.hypot(S.curNX[i], S.curNY[i]) + LEAF_R);
      if (reach > S.curR[f] + 2) {
        S.curR[f] = reach;
        this.awake.add(S.parent[f]);
      }
    }
  }

  /** A frame's bodies and springs in local indices, cached until what is shut changes. */
  private frames = new Map<number, FrameData>();

  private data(f: number): FrameData {
    const S = this.S;
    const hit = this.frames.get(f);
    if (hit && hit.rep === S.repVersion) return hit;
    const ids: number[] = [];
    const kc = f === ROOT ? S.rootC : S.kidsC[f];
    const kn = f === ROOT ? S.rootN : S.kidsN[f];
    for (const c of kc) if (S.rep[c] < 0 || S.rep[c] === c) ids.push(c);
    const nBig = ids.length;
    for (const i of kn) if (S.nodeRep[i] < 0) ids.push(S.nc + i);
    const index = new Map<number, number>();
    ids.forEach((b, k) => index.set(b, k));
    const sa: number[] = [], sb: number[] = [], sk: number[] = [];
    for (const sp of this.springs.get(f) ?? []) {
      const a = index.get(sp.a), b = index.get(sp.b);
      if (a === undefined || b === undefined) continue;
      sa.push(a);
      sb.push(b);
      sk.push(sp.k);
    }
    const n = ids.length;
    const d: FrameData = {
      rep: S.repVersion, ids: Int32Array.from(ids), nBig,
      sa: Int32Array.from(sa), sb: Int32Array.from(sb), sk: Float64Array.from(sk),
      x: new Float64Array(n), y: new Float64Array(n), vx: new Float64Array(n), vy: new Float64Array(n),
      ax: new Float64Array(n), ay: new Float64Array(n), r: new Float64Array(n), fx: new Float64Array(n), fy: new Float64Array(n),
      cell: new Float64Array(n), order: new Int32Array(n),
    };
    this.frames.set(f, d);
    return d;
  }

  private stepFrame(f: number): void {
    const S = this.S;
    // a frame inside a shut cluster is not drawn: everything rests at its anchor
    if (f !== ROOT && S.rep[f] >= 0) {
      for (const c of S.kidsC[f]) this.rest(c);
      for (const i of S.kidsN[f]) this.rest(S.nc + i);
      this.awake.delete(f);
      return;
    }
    const D = this.data(f);
    const n = D.ids.length;
    const { x, y, vx, vy, ax, ay, r, fx, fy } = D;
    let drag = -1;
    for (let k = 0; k < n; k++) {
      const b = D.ids[k];
      x[k] = this.px(b);
      y[k] = this.py(b);
      vx[k] = this.vx(b);
      vy[k] = this.vy(b);
      ax[k] = this.ax(b);
      ay[k] = this.ay(b);
      r[k] = this.radius(b);
      if (b === this.drag) drag = k;
      fx[k] = K_ANCHOR * (ax[k] - x[k]) - DAMPING * vx[k];
      fy[k] = K_ANCHOR * (ay[k] - y[k]) - DAMPING * vy[k];
    }
    for (let q = 0; q < D.sa.length; q++) {
      const a = D.sa[q], b = D.sb[q];
      const dx = x[b] - x[a], dy = y[b] - y[a];
      const d = Math.hypot(dx, dy) || 1e-6;
      const from = this.dragFrom;
      const [pax, pay] = a === drag && from ? from : [ax[a], ay[a]];
      const [pbx, pby] = b === drag && from ? from : [ax[b], ay[b]];
      const rest = Math.hypot(pbx - pax, pby - pay);
      const f0 = (D.sk[q] * (d - rest)) / d;
      fx[a] += f0 * dx;
      fy[a] += f0 * dy;
      fx[b] -= f0 * dx;
      fy[b] -= f0 * dy;
    }
    const dt = SUBSTEP;
    let energy = 0;
    for (let k = 0; k < n; k++) {
      if (k === drag) {
        vx[k] = vy[k] = 0;
        continue;
      }
      vx[k] += fx[k] * dt;
      vy[k] += fy[k] * dt;
      x[k] += vx[k] * dt;
      y[k] += vy[k] * dt;
    }
    if (this.drag !== null) this.collide(D, drag);
    // asleep when nothing in the frame moves any more; a body held off its anchor by a
    // neighbour (a pin dropped on it) rests where it is
    for (let k = 0; k < n; k++) energy = Math.max(energy, Math.hypot(vx[k], vy[k]) * dt);
    if (drag >= 0) energy = Infinity;
    const sleep = energy < REST * 0.05;
    for (let k = 0; k < n; k++) {
      const b = D.ids[k];
      if (sleep) {
        if (Math.hypot(x[k] - ax[k], y[k] - ay[k]) < 0.5) {
          x[k] = ax[k];
          y[k] = ay[k];
        }
        vx[k] = vy[k] = 0;
      }
      this.setP(b, x[k], y[k]);
      this.setV(b, vx[k], vy[k]);
    }
    if (sleep) this.awake.delete(f);
  }

  /** Push overlapping siblings apart, the lighter one more; the dragged body does not yield.
   *  Discs are checked against everything; nodes against their grid neighbours, found by
   *  sorting the bodies by cell. */
  private collide(D: FrameData, drag: number): void {
    const { x, y, r, cell, order } = D;
    const n = D.ids.length;
    const CELL = 2 * LEAF_R + 2;
    const W = 1 << 20;
    const resolve = (a: number, b: number) => {
      const dx = x[b] - x[a], dy = y[b] - y[a];
      const need = r[a] + r[b] - 0.5;
      const d2 = dx * dx + dy * dy;
      if (d2 >= need * need) return;
      const d = Math.sqrt(d2) || 1e-3;
      const push = need - d;
      const wa = a === drag ? 0 : b === drag ? 1 : (r[b] * r[b]) / (r[a] * r[a] + r[b] * r[b]);
      const ux = d2 ? dx / d : 1, uy = d2 ? dy / d : 0;
      x[a] -= ux * push * wa;
      y[a] -= uy * push * wa;
      x[b] += ux * push * (1 - wa);
      y[b] += uy * push * (1 - wa);
    };
    for (let a = 0; a < D.nBig; a++) for (let b = a + 1; b < n; b++) resolve(a, b);
    const small = n - D.nBig;
    if (small < 2) return;
    for (let k = D.nBig; k < n; k++) {
      cell[k] = Math.floor(x[k] / CELL) * W + Math.floor(y[k] / CELL);
      order[k - D.nBig] = k;
    }
    const ord = order.subarray(0, small);
    ord.sort((p, q) => cell[p] - cell[q]);
    const keys = new Float64Array(small);
    for (let k = 0; k < small; k++) keys[k] = cell[ord[k]];
    const find = (key: number) => {
      let lo = 0, hi = small;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (keys[mid] < key) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    for (let s = 0; s < small; s++) {
      const a = ord[s];
      const key = keys[s];
      // the same cell after this one, then the neighbouring cells "ahead" of it
      for (let t = s + 1; t < small && keys[t] === key; t++) resolve(a, ord[t]);
      for (const off of [W, 1, W + 1, W - 1]) {
        for (let t = find(key + off); t < small && keys[t] === key + off; t++) resolve(a, ord[t]);
      }
    }
  }

  /** The dragged body pushes the nodes it touches, whatever cluster they are in. */
  private contact(): void {
    const S = this.S;
    const d = this.drag!;
    const own = this.frameOf(d);
    const wx = d < S.nc ? S.cwx[d] : S.nwx[d - S.nc];
    const wy = d < S.nc ? S.cwy[d] : S.nwy[d - S.nc];
    const rd = this.radius(d) * (d < S.nc ? this.scaleOf(own) : 1);
    for (const j of this.near(wx, wy, rd + LEAF_R * 2)) {
      if (S.nc + j === d || S.nodeCluster[j] === own) continue;
      // inside the dragged cluster: it carries those, it does not push them
      if (d < S.nc && this.inside(j, d)) continue;
      const dx = S.nwx[j] - wx, dy = S.nwy[j] - wy;
      const dist = Math.hypot(dx, dy) || 1e-3;
      const need = rd + LEAF_R + 1;
      if (dist >= need) continue;
      const f = S.nodeCluster[j];
      const s = this.scaleOf(f) || 1;
      const push = (need - dist) / s;
      S.curNX[j] += (dx / dist) * push;
      S.curNY[j] += (dy / dist) * push;
      this.awake.add(f);
    }
  }

  private inside(i: number, c: number): boolean {
    for (let x = this.S.nodeCluster[i]; x >= 0; x = this.S.parent[x]) if (x === c) return true;
    return false;
  }

  private scaleOf(f: number): number {
    return f === ROOT ? 1 : this.S.scale[f];
  }

  private vx(b: number): number {
    return b < this.S.nc ? this.vcx[b] : this.vnx[b - this.S.nc];
  }
  private vy(b: number): number {
    return b < this.S.nc ? this.vcy[b] : this.vny[b - this.S.nc];
  }
  private setV(b: number, x: number, y: number): void {
    if (b < this.S.nc) {
      this.vcx[b] = x;
      this.vcy[b] = y;
    } else {
      this.vnx[b - this.S.nc] = x;
      this.vny[b - this.S.nc] = y;
    }
  }

  private rest(b: number): void {
    this.setP(b, this.ax(b), this.ay(b));
    this.setV(b, 0, 0);
  }
}
