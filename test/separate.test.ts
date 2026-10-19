// The separation and the settling find what may meet through grids (shared/separate.ts, BoxGrid):
// the separation gives what the plain pass over every pair gave, to the last bit, and the layout of
// a graph is 0.4.4's, to the last bit (the digests below are 0.4.4's layouts), so that no layout
// made before moves.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bodies } from "../src/shared/separate.ts";
import { Separator } from "../src/shared/separate.ts";
import { clusterTree, computeLayout, memoryOf, regroup, stabilize } from "../src/shared/layout.ts";
import type { ViewNode } from "../src/shared/graph.ts";
import { digest, folderGraph, showcaseGraphs } from "./layoutgraphs.ts";

/** 0.4.4's separation, every pair in turn: what the separation must give. */
class PlainSeparator {
  private head = new Int32Array(0);
  private next = new Int32Array(0);
  private mask = 0;
  private moved = new Uint8Array(0);
  private movedNext = new Uint8Array(0);
  private movedSmall = new Int32Array(0);
  private cell: number;
  constructor(cell: number) {
    this.cell = cell;
  }
  private ensure(n: number, nSmall: number) {
    if (this.next.length < n) {
      this.next = new Int32Array(n);
      this.moved = new Uint8Array(n);
      this.movedNext = new Uint8Array(n);
      this.movedSmall = new Int32Array(n);
    }
    let size = 64;
    while (size < 2 * nSmall) size <<= 1;
    if (this.head.length !== size) this.head = new Int32Array(size);
    this.mask = size - 1;
  }
  private hash(i: number, j: number) {
    return (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) & this.mask;
  }
  private build(B: Bodies) {
    this.head.fill(-1);
    for (const k of B.small) {
      const h = this.hash(Math.floor(B.x[k] / this.cell), Math.floor(B.y[k] / this.cell));
      this.next[k] = this.head[h];
      this.head[h] = k;
    }
  }
  private push(B: Bodies, a: number, b: number): boolean {
    const dx = B.x[b] - B.x[a], dy = B.y[b] - B.y[a];
    const need = B.r[a] + B.r[b];
    const d2 = dx * dx + dy * dy;
    if (d2 >= (need - 0.5) * (need - 0.5)) return false;
    const pa = B.pinned[a], pb = B.pinned[b];
    const fixA = pa && (!pb || B.seq[a] > B.seq[b]);
    const fixB = pb && (!pa || B.seq[b] > B.seq[a]);
    const d = Math.sqrt(d2) || 1e-3;
    const over = need - d;
    const ra = B.r[a] * B.r[a], rb = B.r[b] * B.r[b];
    const wa = fixA ? 0 : fixB ? 1 : rb / (ra + rb);
    const ux = d2 ? dx / d : 1, uy = d2 ? dy / d : 0;
    if (wa > 0) {
      B.x[a] -= ux * over * wa;
      B.y[a] -= uy * over * wa;
      this.movedNext[a] = 1;
    }
    if (wa < 1) {
      B.x[b] += ux * over * (1 - wa);
      B.y[b] += uy * over * (1 - wa);
      this.movedNext[b] = 1;
    }
    return true;
  }
  private overlap(B: Bodies, a: number, b: number) {
    const dx = B.x[b] - B.x[a], dy = B.y[b] - B.y[a];
    const need = B.r[a] + B.r[b] - 0.5;
    return dx * dx + dy * dy < need * need;
  }
  separate(B: Bodies, rounds: number, limit: Float64Array | null): boolean {
    const { big, small } = B;
    this.ensure(B.n, small.length);
    const moved = this.moved, next = this.movedNext;
    moved.fill(1, 0, B.n);
    let any = false;
    for (let round = 0; round < rounds; round++) {
      any = false;
      next.fill(0, 0, B.n);
      this.build(B);
      let nMovedSmall = 0;
      for (const k of small) if (moved[k]) this.movedSmall[nMovedSmall++] = k;
      for (let p = 0; p < big.length; p++) {
        const a = big[p];
        for (let q = p + 1; q < big.length; q++) if ((moved[a] || moved[big[q]]) && this.push(B, a, big[q])) any = true;
        if (moved[a]) {
          for (const s of small) if (this.push(B, a, s)) any = true;
        } else for (let s = 0; s < nMovedSmall; s++) if (this.push(B, a, this.movedSmall[s])) any = true;
      }
      for (let s = 0; s < nMovedSmall; s++) {
        const a = this.movedSmall[s];
        const gx = Math.floor(B.x[a] / this.cell), gy = Math.floor(B.y[a] / this.cell);
        for (let i = gx - 1; i <= gx + 1; i++)
          for (let j = gy - 1; j <= gy + 1; j++)
            for (let b = this.head[this.hash(i, j)]; b >= 0; b = this.next[b]) {
              if (b === a || (moved[b] && b < a)) continue;
              if (this.push(B, a, b)) any = true;
            }
      }
      if (limit) {
        for (let k = 0; k < B.n; k++) {
          const d = Math.hypot(B.x[k], B.y[k]);
          if (d > limit[k]) {
            B.x[k] *= limit[k] / d;
            B.y[k] *= limit[k] / d;
            next[k] = 1;
          }
        }
      }
      moved.set(next.subarray(0, B.n));
      if (!any) break;
    }
    return any;
  }
  overlaps(B: Bodies): boolean {
    const { big, small } = B;
    this.ensure(B.n, small.length);
    for (let p = 0; p < big.length; p++) {
      for (let q = p + 1; q < big.length; q++) if (this.overlap(B, big[p], big[q])) return true;
      for (const s of small) if (this.overlap(B, big[p], s)) return true;
    }
    this.build(B);
    for (const a of small) {
      const gx = Math.floor(B.x[a] / this.cell), gy = Math.floor(B.y[a] / this.cell);
      for (let i = gx - 1; i <= gx + 1; i++)
        for (let j = gy - 1; j <= gy + 1; j++) for (let b = this.head[this.hash(i, j)]; b >= 0; b = this.next[b]) if (b > a && this.overlap(B, a, b)) return true;
    }
    return false;
  }
}

test("the separation is the plain pass over every pair, to the last bit: large bodies and small, crowded and apart, held and free", () => {
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const indexed = new Separator(12.5), plain = new PlainSeparator(12.5);
  let cases = 0;
  for (const nBig of [0, 3, 40, 220, 700]) {
    for (const nSmall of [0, 60, 900]) {
      for (const spread of [80, 900, 6000]) {
        const n = nBig + nSmall;
        const order = Array.from({ length: n }, (_, k) => k).sort(() => rnd() - 0.5);
        const B: Bodies = {
          n,
          x: Float64Array.from({ length: n }, () => (rnd() - 0.5) * spread),
          y: Float64Array.from({ length: n }, () => (rnd() - 0.5) * spread),
          r: new Float64Array(n),
          pinned: new Uint8Array(n),
          seq: new Float64Array(n),
          big: Int32Array.from(order.slice(0, nBig)),
          small: Int32Array.from(order.slice(nBig)),
        };
        for (const k of B.big) B.r[k] = 6 + rnd() ** 3 * 200;
        for (const k of B.small) B.r[k] = 5.3;
        for (let k = 0; k < n; k++) if (rnd() < 0.1) [B.pinned[k], B.seq[k]] = [1, Math.floor(rnd() * 4)];
        const limit = spread === 900 ? Float64Array.from({ length: n }, () => rnd() * spread) : null;
        for (const rounds of [1, 16]) {
          const A = { ...B, x: B.x.slice(), y: B.y.slice() }, Z = { ...B, x: B.x.slice(), y: B.y.slice() };
          const what = `${nBig} large, ${nSmall} small, ${spread} wide, ${rounds} rounds`;
          assert.equal(indexed.separate(A, rounds, limit), plain.separate(Z, rounds, limit), what);
          assert.equal(indexed.overlaps(A), plain.overlaps(Z), what);
          assert.deepEqual([...A.x, ...A.y], [...Z.x, ...Z.y], what);
          cases++;
        }
      }
    }
  }
  assert.equal(cases, 90);
});

/** 0.4.4's layouts of the test graphs (test/layoutgraphs.ts), by digest */
const LAYOUTS: Record<string, Record<string, string>> = {
  "flt-regular build 1": { namespace: "0ffd5da3af8e9c1a", module: "51a56a935aa883dd" },
  "flt-regular build 2": { namespace: "a4ce21dee3bdd5eb", module: "1e03bee9cdf366c5" },
  "flt-regular build 3": { namespace: "ce8bab55eccd119e", module: "75b89f635a3fc174" },
  "a folder of 250 files": { module: "d5af8d31bc8f6a6f" },
};

test("the layout of a graph is 0.4.4's, to the last bit: the flt-regular showcase's builds, and a folder of 250 files", () => {
  for (const g of [...showcaseGraphs(), folderGraph(250)]) {
    for (const [mode, want] of Object.entries(LAYOUTS[g.name])) {
      assert.equal(digest(computeLayout(mode as "namespace", g.nodes as ViewNode[], g.edges)), want, `${g.name} by ${mode}`);
    }
  }
});

test("so are a layout kept in place across a build that removed declarations, and one regrouped under hidden levels", () => {
  const a = folderGraph(250), b = folderGraph(250, 37);
  const mem = memoryOf(computeLayout("module", a.nodes as ViewNode[], a.edges), a.nodes as ViewNode[]);
  assert.equal(digest(stabilize(computeLayout("module", b.nodes as ViewNode[], b.edges), b.nodes as ViewNode[], mem)), "1d09198d56f1359f");
  assert.equal(digest(regroup(clusterTree("module", a.nodes as ViewNode[], ["P"]), a.nodes as ViewNode[], mem)), "0a4a823e231a31ad");
});
