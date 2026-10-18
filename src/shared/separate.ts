// Separating the children of one cluster: the page's scene (web/src/scene.ts, "the layout event")
// and the layout (shared/layout.ts, on the server and for boards on the page) both use it.
//
// Bodies are discs: large ones (sub-clusters, a few or a few thousand: a folder of 1,800 files) and
// up to a few thousand small ones (declarations, all of radius LEAF_R). A round pushes every
// overlapping pair apart, one pair after another in a fixed order, each push seeing the ones before
// it; what holds its place (a drop) stays against what does not, and of two drops the later one
// stays. Only pairs touching something that moved in the previous round are looked at again.
//
// A pair that does not overlap is not pushed, so a round need only find the pairs that do, in the
// order the plain pass takes them — every large body against every later large one, then against
// the small ones; then the small ones among themselves — to give the plain pass's result to the last
// bit without looking at the pairs that are far apart. The large bodies are filed in a grid, the
// small ones in another, each where it was when the round began; one that moves further than a
// slack is filed again where it is. While one large body meets the others in turn, nothing moves but
// it and the one it meets, so what it may meet is known from where they are, and looked for again
// only once it has moved further than a slack itself. Small ones find their neighbours among
// themselves through a hash grid kept in typed arrays, made at the start of the round. So a drop in a
// cluster of 2,000 declarations settles in milliseconds, and so do the rounds that settle a cluster
// of 1,800 files, which the plain pass took most of a minute over (NavierStokesAndEuler by file).

import { hypot } from "./libm.ts";

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

/** the fewest large bodies a round files in grids: with fewer, it looks at every pair */
const INDEXED = 200;

/** the most cells a box is filed in; a wider one is found by every look */
const WIDE = 4096;
/** the most cells a grid has: wider than that, its cells are made larger */
const CELLS = 1 << 20;

/**
 * Bodies filed in the cells of a square grid over a region, in typed arrays: each by its centre, in
 * one cell, moved from it when filed again; or by a box round it, in every cell the box covers,
 * leaving its old entries behind when filed again. What a box covers is found by visiting its cells.
 * A place outside the region counts in the cell at its edge, so nothing is ever lost: what is found
 * is a superset of what was filed there, for the caller to test exactly.
 */
export class BoxGrid {
  private size = 1;
  private ox = 0;
  private oy = 0;
  private nx = 1;
  private ny = 1;
  /** per cell, the first body filed by its centre and the first box entry */
  private headP = new Int32Array(1);
  private headE = new Int32Array(1);
  /** per body filed by its centre: its cell, and its neighbours in the cell's list */
  private at = new Int32Array(0);
  private nextP = new Int32Array(0);
  private prevP = new Int32Array(0);
  private nextE = new Int32Array(0);
  private bodyE = new Int32Array(0);
  private used = 0;
  private stamp = new Int32Array(0);
  private token = 0;
  /** boxes too wide to file by their cells (or not numbers), which every look finds */
  private wide: number[] = [];
  private isWide = new Uint8Array(0);
  /** what the last look found */
  found: Int32Array = new Int32Array(16);
  /** where each body was filed, and how far its box reaches from there (0: by its centre) */
  fx = new Float64Array(0);
  fy = new Float64Array(0);
  fe = new Float64Array(0);

  /** Empty, for bodies numbered below `n`, cells `size` wide over [x0, x1] × [y0, y1]. */
  reset(size: number, n: number, x0: number, y0: number, x1: number, y1: number): void {
    let s = size > 0 && Number.isFinite(size) ? size : 1;
    if (!(x0 <= x1 && y0 <= y1 && Number.isFinite(x0 + x1 + y0 + y1))) x0 = y0 = x1 = y1 = 0;
    while ((Math.floor(x1 / s) - Math.floor(x0 / s) + 1) * (Math.floor(y1 / s) - Math.floor(y0 / s) + 1) > CELLS) s *= 2;
    this.size = s;
    this.ox = Math.floor(x0 / s);
    this.oy = Math.floor(y0 / s);
    this.nx = Math.floor(x1 / s) - this.ox + 1;
    this.ny = Math.floor(y1 / s) - this.oy + 1;
    const cells = this.nx * this.ny;
    if (this.headP.length < cells) {
      this.headP = new Int32Array(cells);
      this.headE = new Int32Array(cells);
    }
    this.headP.fill(-1, 0, cells);
    this.headE.fill(-1, 0, cells);
    this.used = 0;
    this.wide.length = 0;
    if (this.stamp.length < n) {
      this.stamp = new Int32Array(n);
      this.isWide = new Uint8Array(n);
      this.at = new Int32Array(n);
      this.nextP = new Int32Array(n);
      this.prevP = new Int32Array(n);
      this.fx = new Float64Array(n);
      this.fy = new Float64Array(n);
      this.fe = new Float64Array(n);
      this.token = 0;
    } else this.isWide.fill(0, 0, n);
    this.at.fill(-1, 0, n);
  }

  /** the column (row) of a place, at the region's edge if outside it; NaN where it is not a number */
  col(x: number): number {
    const c = Math.floor(x / this.size) - this.ox;
    return c < 0 ? 0 : c >= this.nx ? this.nx - 1 : c;
  }
  row(y: number): number {
    const c = Math.floor(y / this.size) - this.oy;
    return c < 0 ? 0 : c >= this.ny ? this.ny - 1 : c;
  }

  /** the grid's columns and rows, and the width of its cells */
  get columns(): number {
    return this.nx;
  }
  get rows(): number {
    return this.ny;
  }
  get width(): number {
    return this.size;
  }

  /** How many cells the box [x0, x1] × [y0, y1] covers. */
  cells(x0: number, y0: number, x1: number, y1: number): number {
    return (this.col(x1) - this.col(x0) + 1) * (this.row(y1) - this.row(y0) + 1);
  }

  /** File body `k` at (x, y): by its centre where `e` is 0, else by the box reaching `e` from there
   *  every way. Filed again the way it was filed first. */
  add(k: number, x: number, y: number, e: number): void {
    this.fx[k] = x;
    this.fy[k] = y;
    this.fe[k] = e;
    if (e === 0) {
      const i = this.col(x), j = this.row(y);
      if (!(i >= 0 && j >= 0)) {
        if (!this.isWide[k]) this.wide.push(k);
        this.isWide[k] = 1;
        return;
      }
      const c = j * this.nx + i;
      const was = this.at[k];
      if (was === c) return;
      if (was >= 0) {
        const p = this.prevP[k], q = this.nextP[k];
        if (p >= 0) this.nextP[p] = q;
        else this.headP[was] = q;
        if (q >= 0) this.prevP[q] = p;
      }
      this.at[k] = c;
      this.prevP[k] = -1;
      this.nextP[k] = this.headP[c];
      if (this.headP[c] >= 0) this.prevP[this.headP[c]] = k;
      this.headP[c] = k;
      return;
    }
    const i0 = this.col(x - e), i1 = this.col(x + e);
    const j0 = this.row(y - e), j1 = this.row(y + e);
    const count = (i1 - i0 + 1) * (j1 - j0 + 1);
    if (!(count <= WIDE)) {
      if (!this.isWide[k]) this.wide.push(k);
      this.isWide[k] = 1;
      return;
    }
    const need = this.used + count;
    if (need > this.nextE.length) {
      const cap = Math.max(need, 2 * this.nextE.length, 64);
      const nn = new Int32Array(cap), nb = new Int32Array(cap);
      nn.set(this.nextE.subarray(0, this.used));
      nb.set(this.bodyE.subarray(0, this.used));
      this.nextE = nn;
      this.bodyE = nb;
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const h = j * this.nx + i;
        const en = this.used++;
        this.bodyE[en] = k;
        this.nextE[en] = this.headE[h];
        this.headE[h] = en;
      }
    }
  }

  /** The bodies filed in the cells of [x0, x1] × [y0, y1], each once, into `found`; how many. */
  find(x0: number, y0: number, x1: number, y1: number): number {
    const i0 = this.col(x0), i1 = this.col(x1);
    const j0 = this.row(y0), j1 = this.row(y1);
    const m = this.wideOnes(0);
    let n = m;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) n = this.cell(i, j, n);
    // each once
    if (this.token >= 0x3fffffff) {
      this.stamp.fill(0);
      this.token = 0;
    }
    const t = ++this.token;
    const stamp = this.stamp, found = this.found;
    let k = 0;
    for (let f = 0; f < n; f++) {
      const b = found[f];
      if (stamp[b] === t) continue;
      stamp[b] = t;
      found[k++] = b;
    }
    return k;
  }

  /** The bodies filed in the cell at column `i` and row `j`, appended to `found` from `m` on (one
   *  filed by a box perhaps more than once); where they end. */
  cell(i: number, j: number, m: number): number {
    const c = j * this.nx + i;
    let found = this.found;
    const nextP = this.nextP;
    for (let k = this.headP[c]; k >= 0; k = nextP[k]) {
      if (m === found.length) found = this.grow();
      found[m++] = k;
    }
    const nextE = this.nextE, bodyE = this.bodyE;
    for (let en = this.headE[c]; en >= 0; en = nextE[en]) {
      if (m === found.length) found = this.grow();
      found[m++] = bodyE[en];
    }
    return m;
  }

  /** The bodies too wide to file by their cells, appended to `found` from `m` on. */
  wideOnes(m: number): number {
    for (const k of this.wide) {
      if (m === this.found.length) this.grow();
      this.found[m++] = k;
    }
    return m;
  }

  private grow(): Int32Array {
    const f = new Int32Array(2 * this.found.length);
    f.set(this.found);
    return (this.found = f);
  }
}

export class Separator {
  private head = new Int32Array(0);
  private next = new Int32Array(0);
  private mask = 0;
  private moved = new Uint8Array(0);
  private movedNext = new Uint8Array(0);
  private movedSmall = new Int32Array(0);
  /** each body's place among the large ones and among the small ones, or -1 */
  private rankBig = new Int32Array(0);
  private rankSmall = new Int32Array(0);
  /** the large bodies (up to `rPoint` by their centres, the larger by their boxes), the small ones */
  private bigs = new BoxGrid();
  private smalls = new BoxGrid();
  private rPoint = 0;
  /** the largest small body */
  private rSmall = 0;
  /** how far a body may move from where it is filed before it is filed again, and how far the large
   *  body meeting the others may move from where it looked before it looks again */
  private slackFiled = 1;
  private slackLook = 1;
  /** the places in their list of what one large body may meet, in order; which bodies its turn has
   *  seen; how many the grid found at the last look */
  private cand = new Int32Array(64);
  private seen = new Int32Array(0);
  private turn = 0;
  private looked = 0;
  /** whether this round files the bodies in the grids */
  private indexed = false;

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
      this.rankBig = new Int32Array(n);
      this.rankSmall = new Int32Array(n);
      this.seen = new Int32Array(n);
      this.turn = 0;
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

  /** Each body's place in its list; the grids' slacks, from the large bodies' sizes. */
  private rank(B: Bodies): void {
    const { big, small } = B;
    this.rankBig.fill(-1, 0, B.n);
    this.rankSmall.fill(-1, 0, B.n);
    for (let p = 0; p < big.length; p++) this.rankBig[big[p]] = p;
    for (let s = 0; s < small.length; s++) this.rankSmall[small[s]] = s;
    let rs = 0;
    for (let s = 0; s < small.length; s++) rs = Math.max(rs, B.r[small[s]]);
    this.rSmall = rs;
    // the largest tenth filed by their boxes, the others by their centres; slacks a fraction of the
    // middling large body
    const r = Float64Array.from(big, (k) => B.r[k]).sort();
    const mid = r.length ? r[r.length >> 1] : this.cell / 2;
    this.rPoint = r.length ? r[Math.floor(0.9 * (r.length - 1))] : 0;
    this.slackFiled = mid / 4;
    this.slackLook = mid / 2;
  }

  /** File every body where it is now, over the region they cover. */
  private file(B: Bodies): void {
    const { big, small } = B;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < B.n; k++) {
      const x = B.x[k], y = B.y[k];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    // cells about as wide as a middling look's radius, or wider where the region holds many more
    // cells than bodies
    const area = (x1 - x0) * (y1 - y0);
    this.bigs.reset(Math.max(this.cell, 0.75 * (this.rPoint + this.lookReach(false)), Math.sqrt(area / (4 * big.length + 64))), B.n, x0, y0, x1, y1);
    for (let p = 0; p < big.length; p++) {
      const k = big[p];
      this.bigs.add(k, B.x[k], B.y[k], B.r[k] <= this.rPoint ? 0 : B.r[k] + this.slackFiled);
    }
    this.smalls.reset(Math.max(this.cell, Math.sqrt(area / (4 * small.length + 64))), B.n, x0, y0, x1, y1);
    for (let s = 0; s < small.length; s++) {
      const k = small[s];
      this.smalls.add(k, B.x[k], B.y[k], 0);
    }
  }

  /** How far beyond its own radius a look of a large body reaches, among the large ones or the
   *  small ones: to where what may meet it before it looks again was filed. */
  private lookReach(small: boolean): number {
    return this.slackLook + (small ? this.rSmall : this.rPoint) + this.slackFiled;
  }

  /** A body that moved: filed again once it is further than the slack from where it was filed. */
  private track(B: Bodies, k: number): void {
    if (!this.indexed) return;
    const g = this.rankBig[k] >= 0 ? this.bigs : this.smalls;
    const dx = B.x[k] - g.fx[k], dy = B.y[k] - g.fy[k];
    const s = this.slackFiled * 0.999;
    if (dx * dx + dy * dy > s * s) g.add(k, B.x[k], B.y[k], g.fe[k]);
  }

  /** Push a and b apart if they overlap; marks what moved. 0 when they do not overlap, else 1 if a
   *  moved, 2 if b did, 3 if both. */
  private push(B: Bodies, a: number, b: number): number {
    const dx = B.x[b] - B.x[a], dy = B.y[b] - B.y[a];
    const need = B.r[a] + B.r[b];
    const d2 = dx * dx + dy * dy;
    if (d2 >= (need - SLACK) * (need - SLACK)) return 0;
    const pa = B.pinned[a], pb = B.pinned[b];
    const fixA = pa && (!pb || B.seq[a] > B.seq[b]);
    const fixB = pb && (!pa || B.seq[b] > B.seq[a]);
    const d = Math.sqrt(d2) || 1e-3;
    const over = need - d;
    const ra = B.r[a] * B.r[a], rb = B.r[b] * B.r[b];
    const wa = fixA ? 0 : fixB ? 1 : rb / (ra + rb);
    const ux = d2 ? dx / d : 1, uy = d2 ? dy / d : 0;
    let m = 0;
    if (wa > 0) {
      B.x[a] -= ux * over * wa;
      B.y[a] -= uy * over * wa;
      this.movedNext[a] = 1;
      m |= 1;
    }
    if (wa < 1) {
      B.x[b] += ux * over * (1 - wa);
      B.y[b] += uy * over * (1 - wa);
      this.movedNext[b] = 1;
      m |= 2;
    }
    return m;
  }

  private overlap(B: Bodies, a: number, b: number): boolean {
    const dx = B.x[b] - B.x[a], dy = B.y[b] - B.y[a];
    const need = B.r[a] + B.r[b] - SLACK;
    return dx * dx + dy * dy < need * need;
  }

  /** How many cells a look of large body `a` from (qx, qy) visits. */
  private lookCells(B: Bodies, a: number, qx: number, qy: number, small: boolean): number {
    const r = B.r[a] + this.lookReach(small);
    return (small ? this.smalls : this.bigs).cells(qx - r, qy - r, qx + r, qy + r);
  }

  /** What large body `a` may meet among the large ones (`small` false) or the small ones (true),
   *  looking from (qx, qy) — it stays within the slack of there until it looks again — in its turn
   *  `t`: the cells of the look its earlier looks have not visited, and in them what it has not seen
   *  yet in this turn, their places in their list after place `after` put in order into the
   *  candidates from `from` on, where `to` ended them. Returns where they end now; `this.looked` is
   *  how many the grid found. */
  private gather(B: Bodies, a: number, qx: number, qy: number, small: boolean, after: number, t: number, from: number, to: number): number {
    const g = small ? this.smalls : this.bigs;
    const rank = small ? this.rankSmall : this.rankBig;
    const reach = B.r[a] + this.lookReach(small);
    const i0 = g.col(qx - reach), i1 = g.col(qx + reach);
    const j0 = g.row(qy - reach), j1 = g.row(qy + reach);
    const rects = this.rects;
    const nr = this.nRects;
    let m = nr === 0 ? g.wideOnes(0) : 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let done = false;
        for (let v = 0; v < nr && !done; v++) done = i >= rects[4 * v] && i <= rects[4 * v + 1] && j >= rects[4 * v + 2] && j <= rects[4 * v + 3];
        if (!done) m = g.cell(i, j, m);
      }
    }
    if (nr < rects.length / 4) {
      rects[4 * nr] = i0;
      rects[4 * nr + 1] = i1;
      rects[4 * nr + 2] = j0;
      rects[4 * nr + 3] = j1;
      this.nRects = nr + 1;
    } else this.nRects = 0; // too many looks to remember: the next one visits all its cells again
    this.looked = m;
    if (this.cand.length < to + m) {
      const c = new Int32Array(Math.max(2 * this.cand.length, to + m));
      c.set(this.cand.subarray(0, to));
      this.cand = c;
    }
    const cand = this.cand, found = g.found, seen = this.seen;
    let n = to;
    for (let f = 0; f < m; f++) {
      const k = found[f];
      if (seen[k] === t) continue;
      seen[k] = t;
      const q = rank[k];
      if (q > after) cand[n++] = q;
    }
    // in order among those still to come: all of them at first, the few new ones later
    if (from === to) {
      if (n - from > 1) cand.subarray(from, n).sort();
    } else {
      for (let j = to; j < n; j++) {
        const q = cand[j];
        let i = j;
        while (i > from && cand[i - 1] > q) {
          cand[i] = cand[i - 1];
          i--;
        }
        cand[i] = q;
      }
    }
    return n;
  }
  /** the cells each look of the turn visited, as column and row ranges */
  private rects = new Int32Array(4 * 16);
  private nRects = 0;

  /**
   * Large body big[p] against the later large ones (`small` false) or against the small ones, in
   * their order, as the plain pass takes them, from the grid. Where the grid would visit more cells,
   * or find more bodies, than the plain pass would look at — a crowd, where everything touches
   * everything — the plain pass takes over from where the grid had come to.
   */
  private against(B: Bodies, p: number, small: boolean, nMovedSmall: number): boolean {
    const list = small ? B.small : B.big;
    const moved = this.moved;
    const a = B.big[p];
    let qx = B.x[a], qy = B.y[a];
    const after = small ? -1 : p;
    // what the plain pass would cost, in pairs; a cell visited costs about four, a body found two
    let budget = small ? (moved[a] ? list.length : nMovedSmall) : list.length - p - 1;
    if (budget === 0) return false;
    if (!(4 * this.lookCells(B, a, qx, qy, small) <= budget)) return this.plain(B, p, small, after, nMovedSmall);
    if (this.turn >= 0x3fffffff) {
      // the marks start again before they could wrap round
      this.seen.fill(0);
      this.turn = 0;
    }
    const t = ++this.turn;
    this.nRects = 0;
    let nc = this.gather(B, a, qx, qy, small, after, t, 0, 0);
    budget -= 2 * this.looked;
    const s2 = this.slackLook * 0.999 * (this.slackLook * 0.999);
    let any = false;
    for (let ci = 0; ci < nc; ) {
      const q = this.cand[ci++];
      const b = list[q];
      if (!(moved[a] || moved[b])) continue;
      const m = this.push(B, a, b);
      if (!m) continue;
      any = true;
      if (m & 2) this.track(B, b);
      // a moved: what it may meet now, from where it is, once it is further than the slack
      if (m & 1) {
        const dx = B.x[a] - qx, dy = B.y[a] - qy;
        if (dx * dx + dy * dy > s2) {
          qx = B.x[a];
          qy = B.y[a];
          if (!(4 * this.lookCells(B, a, qx, qy, small) <= budget)) return this.plain(B, p, small, q, nMovedSmall) || any;
          nc = this.gather(B, a, qx, qy, small, q, t, ci, nc);
          budget -= 2 * this.looked;
          if (budget < 0) return this.plain(B, p, small, q, nMovedSmall) || any;
        }
      }
    }
    return any;
  }

  /** The plain pass of large body big[p] against the list's bodies after place `after`: the later
   *  large ones, or the small ones (those that moved, where big[p] did not). */
  private plain(B: Bodies, p: number, small: boolean, after: number, nMovedSmall: number): boolean {
    const moved = this.moved;
    const a = B.big[p];
    let any = false;
    if (!small) {
      const big = B.big;
      for (let q = after + 1; q < big.length; q++) {
        const b = big[q];
        if (!(moved[a] || moved[b])) continue;
        const m = this.push(B, a, b);
        if (m) {
          any = true;
          if (m & 2) this.track(B, b);
        }
      }
    } else if (moved[a]) {
      const list = B.small;
      for (let s = after + 1; s < list.length; s++) {
        const m = this.push(B, a, list[s]);
        if (m) {
          any = true;
          if (m & 2) this.track(B, list[s]);
        }
      }
    } else {
      for (let s = 0; s < nMovedSmall; s++) {
        const b = this.movedSmall[s];
        if (after >= 0 && this.rankSmall[b] <= after) continue;
        const m = this.push(B, a, b);
        if (m) {
          any = true;
          if (m & 2) this.track(B, b);
        }
      }
    }
    return any;
  }

  /**
   * Up to `rounds` rounds of separation. After each round a body further from the origin than
   * `limit[k]` is brought back to it (null: no limit). Returns whether anything still moved in
   * the last round.
   */
  separate(B: Bodies, rounds: number, limit: Float64Array | null): boolean {
    const { big, small } = B;
    this.ensure(B.n, small.length);
    // the grids serve the large bodies' turns alone, where there are enough of them to be worth it
    const indexed = (this.indexed = big.length >= INDEXED);
    if (indexed) this.rank(B);
    const moved = this.moved, next = this.movedNext;
    moved.fill(1, 0, B.n);
    let any = false;
    for (let round = 0; round < rounds; round++) {
      any = false;
      next.fill(0, 0, B.n);
      this.build(B);
      if (indexed) this.file(B);
      let nMovedSmall = 0;
      for (let s = 0; s < small.length; s++) if (moved[small[s]]) this.movedSmall[nMovedSmall++] = small[s];
      // large against large, and against the small ones (all of them when the large one moved)
      for (let p = 0; p < big.length; p++) {
        if (indexed ? this.against(B, p, false, nMovedSmall) : this.plain(B, p, false, p, nMovedSmall)) any = true;
        if (indexed ? this.against(B, p, true, nMovedSmall) : this.plain(B, p, true, -1, nMovedSmall)) any = true;
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
          const d = hypot(B.x[k], B.y[k]);
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
    const indexed = big.length >= INDEXED;
    if (indexed) {
      this.rank(B);
      this.file(B);
    }
    for (let p = 0; p < big.length; p++) {
      const a = big[p];
      const x = B.x[a], y = B.y[a];
      // against the later large ones, then against the small ones: from the grids, or each in turn
      for (let pass = 0; pass < 2; pass++) {
        const toSmall = pass === 1;
        const list = toSmall ? small : big;
        const from = toSmall ? 0 : p + 1;
        if (from >= list.length) continue;
        if (!indexed || !(this.lookCells(B, a, x, y, toSmall) <= list.length - from)) {
          for (let q = from; q < list.length; q++) if (this.overlap(B, a, list[q])) return true;
          continue;
        }
        const g = toSmall ? this.smalls : this.bigs;
        const reach = B.r[a] + this.lookReach(toSmall);
        const m = g.find(x - reach, y - reach, x + reach, y + reach);
        for (let f = 0; f < m; f++) {
          const b = g.found[f];
          if ((toSmall || this.rankBig[b] > p) && this.overlap(B, a, b)) return true;
        }
      }
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
