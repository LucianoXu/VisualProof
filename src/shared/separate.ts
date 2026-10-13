// Separating the children of one cluster: the page's scene (web/src/scene.ts, "the layout event")
// and the layout (shared/layout.ts, on the server and for boards on the page) both use it.
//
// Bodies are discs: a few large ones (sub-clusters) and up to a few thousand small ones
// (declarations, all of radius LEAF_R). A round pushes every overlapping pair apart; what holds its
// place (a drop) stays against what does not, and of two drops the later one stays. Only pairs
// touching something that moved in the previous round are looked at again, and small bodies find
// their neighbours through a hash grid kept in typed arrays, so a drop in a cluster of 2,000
// declarations settles in milliseconds rather than rebuilding everything every round.

export interface Bodies {
  n: number;
  x: Float64Array;
  y: Float64Array;
  r: Float64Array;
  /** holds its place against what does not */
  pinned: Uint8Array;
  /** of two that hold, the higher stays */
  seq: Float64Array;
  /** indices of the large bodies and of the small ones (all of one radius, `cell` apart at most) */
  big: Int32Array;
  small: Int32Array;
}

/** Packed bodies touch exactly; only a real overlap counts. */
const SLACK = 0.5;

export class Separator {
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

  private ensure(n: number, nSmall: number): void {
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

  private key(x: number, y: number): number {
    return (Math.imul(Math.floor(x / this.cell), 73856093) ^ Math.imul(Math.floor(y / this.cell), 19349663)) & this.mask;
  }

  private build(B: Bodies): void {
    this.head.fill(-1);
    for (let s = 0; s < B.small.length; s++) {
      const k = B.small[s];
      const h = this.key(B.x[k], B.y[k]);
      this.next[k] = this.head[h];
      this.head[h] = k;
    }
  }

  /** Push a and b apart if they overlap; marks what moved. */
  private push(B: Bodies, a: number, b: number): boolean {
    const dx = B.x[b] - B.x[a], dy = B.y[b] - B.y[a];
    const need = B.r[a] + B.r[b];
    const d2 = dx * dx + dy * dy;
    if (d2 >= (need - SLACK) * (need - SLACK)) return false;
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

  private overlap(B: Bodies, a: number, b: number): boolean {
    const dx = B.x[b] - B.x[a], dy = B.y[b] - B.y[a];
    const need = B.r[a] + B.r[b] - SLACK;
    return dx * dx + dy * dy < need * need;
  }

  /**
   * Up to `rounds` rounds of separation. After each round a body further from the origin than
   * `limit[k]` is brought back to it (null: no limit). Returns whether anything still moved in
   * the last round.
   */
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
      for (let s = 0; s < small.length; s++) if (moved[small[s]]) this.movedSmall[nMovedSmall++] = small[s];
      // large against large, and against the small ones (all of them when the large one moved)
      for (let p = 0; p < big.length; p++) {
        const a = big[p];
        for (let q = p + 1; q < big.length; q++) {
          const b = big[q];
          if ((moved[a] || moved[b]) && this.push(B, a, b)) any = true;
        }
        if (moved[a]) {
          for (let s = 0; s < small.length; s++) if (this.push(B, a, small[s])) any = true;
        } else {
          for (let s = 0; s < nMovedSmall; s++) if (this.push(B, a, this.movedSmall[s])) any = true;
        }
      }
      // small against their grid neighbours, where one of the two moved
      for (let s = 0; s < nMovedSmall; s++) {
        const a = this.movedSmall[s];
        const gx = Math.floor(B.x[a] / this.cell), gy = Math.floor(B.y[a] / this.cell);
        for (let i = gx - 1; i <= gx + 1; i++) {
          for (let j = gy - 1; j <= gy + 1; j++) {
            const h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) & this.mask;
            for (let b = this.head[h]; b >= 0; b = this.next[b]) {
              if (b === a || (moved[b] && b < a)) continue;
              if (this.push(B, a, b)) any = true;
            }
          }
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

  /** Whether any two bodies overlap (two drops on each other included). */
  overlaps(B: Bodies): boolean {
    const { big, small } = B;
    this.ensure(B.n, small.length);
    for (let p = 0; p < big.length; p++) {
      for (let q = p + 1; q < big.length; q++) if (this.overlap(B, big[p], big[q])) return true;
      for (let s = 0; s < small.length; s++) if (this.overlap(B, big[p], small[s])) return true;
    }
    this.build(B);
    for (let s = 0; s < small.length; s++) {
      const a = small[s];
      const gx = Math.floor(B.x[a] / this.cell), gy = Math.floor(B.y[a] / this.cell);
      for (let i = gx - 1; i <= gx + 1; i++) {
        for (let j = gy - 1; j <= gy + 1; j++) {
          const h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) & this.mask;
          for (let b = this.head[h]; b >= 0; b = this.next[b]) if (b > a && this.overlap(B, a, b)) return true;
        }
      }
    }
    return false;
  }
}
