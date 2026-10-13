// The ring around a board (AttachmentSpec decision 16, the owner's of 2026-10-11): a circle just
// outside every cluster of the board, at the board's own extent, where the notes that have no
// cluster on the board are — at the top level of its clustering, where someone let one go, or with
// no place under that clustering yet, at the angle of what it is about. Notes on the ring keep their
// order and a fixed gap on the screen between them; where one ring cannot hold them all so at the
// zoom, the rest go on rings further out, concentric with it, a fixed step apart on the screen (the
// owner's decision of 2026-10-11). This file is the geometry, the same in the pages and the tests:
// angles are kept in degrees clockwise from the top, and worked in radians in the board's
// coordinates, whose y grows downwards as the screen's does. Which ring a note is on is the layout's,
// never kept: its place is its angle.

import { noteLook } from "./sticky.ts";

/** How near the middle of the board, as a fraction of the ring's radius, the centre of what a note
 *  is about points nowhere: the note goes in the order notes were written instead. */
export const RING_NEAR = 0.2;
/** how far outside the farthest circle the ring is, as a fraction of its radius, and at least */
const RING_OUT = 0.03;
const RING_OUT_MIN = 12;
/** the room left between two notes on a ring, in pixels of the screen, whatever the zoom */
export const RING_GAP_PX = 6;
/** how much farther out each ring is than the one inside it, in pixels of the screen: an icon's
 *  24 px and 8 px between two icons at one angle */
export const RING_STEP_PX = 32;
/** the farthest a note is drawn from the angle it wants, along its ring, in radians: an eighth of
 *  the turn, so that it still points toward what it is about; where its angle is too crowded to hold
 *  it so near, it goes on a ring further out */
export const RING_REACH = Math.PI / 4;

/** The ring of a board: its centre and radius in the board's world. */
export interface Ring {
  x: number;
  y: number;
  r: number;
}

/** The ring around discs (the board's top-level circles, and its top-level declarations as small
 *  ones): centred on the middle of what they cover, just outside the farthest; null for nothing. */
export function ringAround(discs: Iterable<{ x: number; y: number; r: number }>): Ring | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const all: { x: number; y: number; r: number }[] = [];
  for (const d of discs) {
    all.push(d);
    x0 = Math.min(x0, d.x - d.r);
    y0 = Math.min(y0, d.y - d.r);
    x1 = Math.max(x1, d.x + d.r);
    y1 = Math.max(y1, d.y + d.r);
  }
  if (!all.length) return null;
  const x = (x0 + x1) / 2, y = (y0 + y1) / 2;
  let r = 0;
  for (const d of all) r = Math.max(r, Math.hypot(d.x - x, d.y - y) + d.r);
  return { x, y, r: r + Math.max(RING_OUT_MIN, r * RING_OUT) };
}

/** Degrees clockwise from the top as an angle in the board's coordinates, and back. */
export const ringRadians = (deg: number): number => ((deg - 90) * Math.PI) / 180;
export const ringDegrees = (rad: number): number => {
  const d = (rad * 180) / Math.PI + 90;
  return Math.round((((d % 360) + 360) % 360) * 10) / 10;
};

/** The angle of a spot of the board seen from the ring's centre, in degrees clockwise from the top:
 *  where a note let go at the top level goes on the ring. */
export const angleOf = (ring: Ring, x: number, y: number): number => ringDegrees(Math.atan2(y - ring.y, x - ring.x));

/** The angle, in radians, of what a note is about — the centre of its declarations on the board —
 *  or null where that centre is too near the middle to point anywhere (RING_NEAR). */
export function aboutAngle(ring: Ring, centre: [number, number] | null): number | null {
  if (!centre) return null;
  const dx = centre[0] - ring.x, dy = centre[1] - ring.y;
  return Math.hypot(dx, dy) < RING_NEAR * ring.r ? null : Math.atan2(dy, dx);
}

/** One note on the rings as packing them reads it: the angle it wants (radians; null: it goes in the
 *  order notes were written, from the top), when it was written, what its icon takes along a ring
 *  (its diameter, whatever the angle), and, where the note is expanded, the box of its icon and the
 *  card hanging outward from it, which it takes where the rings are large enough on the screen to
 *  show cards (shared/sticky.ts, noteLook). */
export interface RingItem {
  want: number | null;
  order: string;
  icon: number;
  open?: [number, number];
}

/** Where packing puts a note: on which ring, 0 the innermost, and at which angle (radians). */
export interface RingSpot {
  ring: number;
  a: number;
}

const TOP = -Math.PI / 2;
const TURN = 2 * Math.PI;

/** How much of a ring a note takes at angle a, along the ring: its icon's diameter, or, where its
 *  card shows (`cards`), the box's extent across the ray. */
function across(it: RingItem, a: number, cards: boolean): number {
  if (!it.open || !cards) return it.icon;
  const [w, h] = it.open;
  return Math.max(it.icon, Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)));
}

/** Writing order, oldest first, then the order given: which note a ring keeps first. */
const written = (items: RingItem[]) => (a: number, b: number) => (items[a].order < items[b].order ? -1 : items[a].order > items[b].order ? 1 : a - b);

/** The radius on the screen of ring `j` when the innermost is `rpx` pixels: each RING_STEP_PX
 *  farther out than the one inside it. */
export const ringPx = (rpx: number, j: number): number => Math.max(rpx, 1) + j * RING_STEP_PX;

/** The positions along a circle `c` pixels round, in pixels from the top, of notes that want
 *  positions `u` (in their order round it, unwrapped from the top) and must keep `g[i]` pixels
 *  between note i and the next (the last's to the first, round the top): each moved as little as
 *  the gaps need, their order kept — the least squares of their moves, by isotonic regression of
 *  the positions less the gaps before them, its spread held within what the circle leaves. Null
 *  where the gaps alone go round more than the circle. */
function spreadOn(u: number[], g: number[], c: number): number[] | null {
  const n = u.length;
  if (n === 1) return [u[0]];
  let total = 0;
  for (const x of g) total += x;
  const slack = c - total;
  if (slack < -1e-9) return null;
  const before = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) before[i] = before[i - 1] + g[i - 1];
  const z = u.map((x, i) => x - before[i]);
  // pool adjacent violators: blocks of equal value, merged while one is above the next
  const val: number[] = [], wt: number[] = [];
  for (const x of z) {
    val.push(x);
    wt.push(1);
    while (val.length > 1 && val[val.length - 2] > val[val.length - 1]) {
      const w = wt[wt.length - 2] + wt[wt.length - 1];
      const v = (val[val.length - 2] * wt[wt.length - 2] + val[val.length - 1] * wt[wt.length - 1]) / w;
      val.splice(-2, 2, v);
      wt.splice(-2, 2, w);
    }
  }
  let y: number[] = [];
  val.forEach((v, k) => {
    for (let j = 0; j < wt[k]; j++) y.push(v);
  });
  // the last must stay clear of the first round the top: the values are held within a window as
  // wide as the slack, placed where the squares are least — where their slope, rising with where
  // the window starts, is nought, found by halving
  if (y[n - 1] - y[0] > slack) {
    const slope = (a: number) => y.reduce((s, v, i) => s + (v < a ? a - z[i] : v > a + slack ? a + slack - z[i] : 0), 0);
    let lo = y[0], hi = y[n - 1] - slack;
    for (let k = 0; k < 48; k++) {
      const mid = (lo + hi) / 2;
      if (slope(mid) < 0) lo = mid;
      else hi = mid;
    }
    const a = (lo + hi) / 2;
    y = y.map((v) => Math.min(a + slack, Math.max(a, v)));
  }
  return y.map((v, i) => v + before[i]);
}

/** How far apart along a ring of radius `r` two points must be for the straight line between them to
 *  be `d` pixels long: on a small ring the line is shorter than the arc. None, on a ring narrower
 *  than `d`. */
const along = (d: number, r: number): number => (d > 2 * r ? Infinity : 2 * r * Math.asin(d / (2 * r)));

/** Notes `ks` laid out on ring `j` with the innermost `rpx` pixels round on the screen, their cards
 *  shown or not (`cards`). Those that want an angle first: in their order round the ring, spread so
 *  that RING_GAP_PX is between each two on the screen (spreadOn); what a card takes along the ring is
 *  read at the angle the note wants, then again where the first spreading put it, the larger kept, as
 *  a box's extent across the ray changes with the angle. Then those that want none, in the order
 *  written, each from the top clockwise at the first place the others leave room for. Their angles,
 *  in the order of `ks`; with `strict`, null where they do not fit: the gaps go round more than the
 *  ring, one that wants an angle is more than RING_REACH from it, or those that want none come round
 *  to the top again. */
function layRing(items: RingItem[], ks: number[], rpx: number, j: number, strict: boolean, cards: boolean): number[] | null {
  const r = ringPx(rpx, j);
  const c = TURN * r;
  // how far apart two notes taking `e1` and `e2` along the ring are kept: on a ring too narrow for
  // both, as far as it goes, where the layout is not being tried
  const apart = (e1: number, e2: number) => {
    const d = along((e1 + e2) / 2 + RING_GAP_PX, r);
    return Number.isFinite(d) || strict ? d : Math.PI * r;
  };
  const at = new Map<number, number>();
  // those that want an angle, at it as near as the gaps let them be, in their order round the ring
  const norm = (a: number) => ((((a - TOP) % TURN) + TURN) % TURN) + TOP;
  const seq = ks.filter((k) => items[k].want !== null).sort((a, b) => norm(items[a].want!) - norm(items[b].want!) || written(items)(a, b));
  const placed: { x: number; e: number }[] = [];
  if (seq.length) {
    const u = seq.map((k) => (norm(items[k].want!) - TOP) * r);
    let th = seq.map((k) => norm(items[k].want!));
    let ext = seq.map((k, i) => across(items[k], th[i], cards));
    let x: number[] | null = null;
    for (let pass = 0; pass < 2; pass++) {
      const g = seq.map((_, i) => apart(ext[i], ext[(i + 1) % seq.length]));
      x = spreadOn(u, g, c);
      if (!x) {
        if (strict) return null;
        x = u;
      }
      th = x.map((v) => TOP + v / r);
      ext = seq.map((k, i) => Math.max(ext[i], across(items[k], th[i], cards)));
    }
    if (strict && x!.some((v, i) => Math.abs(v - u[i]) > RING_REACH * r + 1e-6)) return null;
    seq.forEach((k, i) => {
      at.set(k, th[i]);
      placed.push({ x: ((x![i] % c) + c) % c, e: ext[i] });
    });
  }
  // those that want none, from the top clockwise in the order written, each at the first place
  // clear of those laid already, round the ring once at most: the others in their order round it,
  // once more on either side for the turn, are passed one after the other
  const loose = ks.filter((k) => items[k].want === null).sort(written(items));
  if (!loose.length) return ks.map((k) => at.get(k)!);
  placed.sort((a, b) => a.x - b.x);
  const others = [...placed.map((q) => ({ x: q.x - c, e: q.e })), ...placed, ...placed.map((q) => ({ x: q.x + c, e: q.e }))];
  const widest = others.reduce((m, q) => Math.max(m, q.e), 0);
  let p = 0;
  let prev: { x: number; e: number } | null = null;
  let first: { x: number; e: number } | null = null;
  for (const k of loose) {
    let e = across(items[k], TOP + p / r, cards);
    if (prev) p = Math.max(p, prev.x + apart(prev.e, e));
    for (let again = 0; again < 2; again++) {
      // the first of the others that could reach this far back, by halving
      const back = p - apart(e, widest);
      let i = 0, hi = others.length;
      while (i < hi) {
        const mid = (i + hi) >> 1;
        if (others[mid].x < back) i = mid + 1;
        else hi = mid;
      }
      for (; i < others.length && others[i].x < p + apart(e, others[i].e); i++) if (Math.abs(p - others[i].x) < apart(e, others[i].e) - 1e-9) p = others[i].x + apart(e, others[i].e);
      const wider = across(items[k], TOP + p / r, cards);
      if (wider <= e) break;
      e = wider;
    }
    // round to the top again: the first that wanted none is there
    if (strict && (!Number.isFinite(p) || p >= c || (first && p + apart(e, first.e) > first.x + c + 1e-9))) return null;
    first ??= { x: p, e };
    prev = { x: p, e };
    at.set(k, TOP + p / r);
  }
  return ks.map((k) => at.get(k)!);
}

/** The zooms packing decides at: the innermost ring 2^(m/12) pixels round on the screen, twelve to a
 *  doubling, from 1 pixel to 2^20. A view between two is packed as at the smaller, where every ring
 *  holds what it is given at least as easily — its cards counted where they show anywhere between
 *  the two. */
const STEPS = 12;
const M_TOP = 20 * STEPS;
const levelPx = (m: number) => 2 ** (m / STEPS);
const cardsAt = (m: number) => noteLook(true, levelPx(m + 1)) === "open";

/** The notes packed for the last set asked about, kept while the set stays the same (every frame
 *  while only the zoom changes, and every zoom Fit tries): the lowest zoom at which one ring holds
 *  them all (`top`), and which ring each is on at each zoom below it, worked out as far down as was
 *  asked (`low`). */
let packed: { key: string; top: number; low: number; at: Map<number, number[]> } | null = null;

/** Which ring each note is on at zoom `m` (levelPx), from where they are at the zoom above it
 *  (`above`): in the order they were written, each on the ring it was on there, or further out
 *  where that ring no longer holds it with the older ones on it — so that zooming out never brings
 *  one in, and moves one out only when it must. Those that want no angle keep their order ring after
 *  ring: one never goes inside an earlier one. A ring with nothing on it yet takes anything. */
function ringsAt(items: RingItem[], above: number[], m: number): number[] {
  const rings: number[][] = [];
  const out = new Array<number>(items.length);
  let looseFrom = 0;
  for (const k of items.map((_, k) => k).sort(written(items))) {
    let j = Math.max(above[k], items[k].want === null ? looseFrom : 0);
    while (rings[j]?.length && !layRing(items, [...rings[j], k], levelPx(m), j, true, cardsAt(m))) j++;
    (rings[j] ??= []).push(k);
    out[k] = j;
    if (items[k].want === null) looseFrom = j;
  }
  return out;
}

/** Where the notes on the rings go when the innermost is `rpx` pixels round on the screen (the
 *  owner's decision of 2026-10-11): each on a ring at the angle it wants — those that want none from
 *  the top, clockwise, in the order they were written — at least RING_GAP_PX from its neighbours
 *  along the ring, its order round the ring kept. A ring holds only as many as fit so at this zoom,
 *  each within RING_REACH of its angle; the rest go to rings further out, RING_STEP_PX apart. Zoomed
 *  in far enough, one ring holds them all; zooming out, a note moves out a ring only when the ring it
 *  is on no longer holds it with the older ones there — where its angle is too crowded, near its
 *  angle, the newest of a crowd first — and never back in until the view is zoomed in again past
 *  the same zoom: at a given zoom the rings are always the same. In the order given. */
export function packRings(items: RingItem[], rpx: number): RingSpot[] {
  const n = items.length;
  if (!n) return [];
  // the angles a note wants read to the degree: while the board settles they drift every frame, and
  // packing is worked out again only as they move by more
  const key = items.map((it) => `${it.want === null ? "-" : Math.round((it.want * 180) / Math.PI)}|${it.order}|${it.icon}|${it.open ? it.open.map(Math.round).join("x") : ""}`).join("\n");
  if (packed?.key !== key) {
    // the lowest zoom at which one ring holds them all, found by halving between 1 pixel and 2^20
    const all = items.map((_, k) => k);
    const fits = (m: number) => !!layRing(items, all, levelPx(m), 0, true, cardsAt(m));
    let lo = 0, hi = M_TOP;
    if (fits(0)) hi = 0;
    else
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
    packed = { key, top: hi, low: hi, at: new Map() };
  }
  const P = packed;
  const m = Math.max(0, Math.floor(STEPS * Math.log2(Math.max(rpx, 1)) + 1e-9));
  let ring = new Array<number>(n).fill(0);
  if (m < P.top) {
    // from the lowest zoom worked out so far down to this one, each from the zoom above it
    if (P.low < P.top) ring = P.at.get(P.low)!;
    for (let z = P.low - 1; z >= m; z--) {
      ring = ringsAt(items, ring, z);
      P.at.set(z, ring);
      P.low = z;
    }
    ring = P.at.get(m)!;
  }
  const rings: number[][] = [];
  ring.forEach((j, k) => (rings[j] ??= []).push(k));
  const out = new Array<RingSpot>(n);
  const cards = noteLook(true, rpx) === "open";
  rings.forEach((ks, j) => {
    if (!ks) return;
    const a = layRing(items, ks, rpx, j, false, cards) ?? ks.map((k) => items[k].want ?? TOP);
    ks.forEach((k, i) => (out[k] = { ring: j, a: a[i] }));
  });
  return out;
}

/** Where a note's box goes for a point of the ring at angle `a` (screen pixels): outside the ring,
 *  touching the point with the side that faces the middle — to its right on the right, above it at
 *  the top. The top left corner. */
export function ringBox(px: number, py: number, a: number, w: number, h: number): [number, number] {
  return [px + (w / 2) * (Math.cos(a) - 1), py + (h / 2) * (Math.sin(a) - 1)];
}

/** Something a fitted view must hold, as it is on the screen at a zoom `k`: a point of the board's
 *  world, at `k` times its coordinates, and a box around it in pixels of the screen — none for a
 *  point of the board, a note's for a note, which keeps its size on the screen whatever the zoom. */
export interface FitBox {
  x: number;
  y: number;
  dx0: number;
  dy0: number;
  dx1: number;
  dy1: number;
}

/** The view that fits what `boxes(k)` gives at zoom `k` into `vw` × `vh` pixels: the largest zoom, at
 *  most `kMax`, at which it all fits, and the point of the world to put in the middle. The boxes are
 *  asked for at each zoom tried, since notes on the ring are spread by how large the ring is on the
 *  screen. Null where nothing fits however far out the view goes: notes alone wider or taller than
 *  the room, which the caller then leaves out. */
export function fitFrame(boxes: (k: number) => FitBox[], vw: number, vh: number, kMax: number): { k: number; x: number; y: number } | null {
  const extent = (k: number) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes(k)) {
      x0 = Math.min(x0, b.x * k + b.dx0);
      y0 = Math.min(y0, b.y * k + b.dy0);
      x1 = Math.max(x1, b.x * k + b.dx1);
      y1 = Math.max(y1, b.y * k + b.dy1);
    }
    return { x0, y0, x1, y1 };
  };
  const fits = (k: number) => {
    const e = extent(k);
    return e.x1 - e.x0 <= vw && e.y1 - e.y0 <= vh;
  };
  if (!Number.isFinite(extent(kMax).x0)) return null;
  let k = kMax;
  if (!fits(kMax)) {
    // the extent grows with the zoom once the board outweighs the notes: the largest zoom that fits
    // is found by halving the interval between one that fits and one that does not
    let lo = kMax * 1e-6, hi = kMax;
    if (!fits(lo)) return null;
    for (let n = 0; n < 48; n++) {
      const mid = Math.sqrt(lo * hi);
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    k = lo;
  }
  const e = extent(k);
  return { k, x: (e.x0 + e.x1) / 2 / k, y: (e.y0 + e.y1) / 2 / k };
}
