// Visitors (ViewSpec decision 27): navigation never leaves the board. Going to a declaration the
// board on show does not hold — from the panel, a target's review list, a link in a comment, a name
// in the source, the search, a step of Rests on or Used by — shows it on this board as a temporary point,
// a visitor, drawn dashed with its edges to what the board holds, so that one sees why one came.
//
// A visitor shows in its own place in the cluster hierarchy (the owner's decision, 2026-10-11): in
// its own cluster where the board draws it, else inside the deepest cluster of its path the board
// draws (or at the top level), in temporary clusters for the levels between — dashed circles with
// their names in italics, shared by the visitors they hold. Nothing of it is the view's: the board's
// clusters and declarations keep their places, and what made way for a visitor returns when it goes.
//
// A visitor is the reader's own: never part of the view's scope, arrangement or layout memory, and
// not seen by the others on the view — but those who follow the reader see the leader's visitors, as
// they see the leader's selection (presence carries them: PresenceView.visitors). The last few stay
// as a trail one steps back along; they go when the selection is cleared or the board changes. One
// that comes to be in the board's scope (Add to view, a key mark on a target's Key view) is a member
// at once, and leaves the trail.
//
// This file holds the trail, the temporary clusters a set of visitors needs and how they are packed,
// where the outermost of them is put in a cluster of the board, and the references a visitor's edges
// draw, all as pure functions; web/src/visits.ts lays them on the board's scene, web/src/pageselection.ts
// keeps the trail of the board on show and web/src/canvas.ts draws it.

import { packEnclose, packSiblings } from "d3-hierarchy";
import type { ClusterMode } from "../../shared/graph.ts";
import { SITE_BODY, SITE_STMT } from "../../shared/graph.ts";
import { EXT_KEY, pathOf as clusterPath } from "../../shared/layout.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { LEAF_R } from "./scene.ts";
import type { Disc } from "./scene.ts";

/** Where the outermost of what a visitor brings stands — itself, or the outermost temporary cluster
 *  it is in: in the board's cluster `in` (by its key, "" for the top level), at `at` in that
 *  cluster's own coordinates, so that it moves with the cluster. Chosen once, when the visitor comes,
 *  and carried to whoever follows. */
export interface VisitPlace {
  in: string;
  at: [number, number];
}

/** One visitor: a declaration of the board's graph by name, the declaration it was reached from (null
 *  where none on the board), and its place (null until the canvas has placed it). */
export interface Visitor {
  name: string;
  from: string | null;
  place: VisitPlace | null;
}

/** How many visitors the trail keeps: the last few, which stepping back walks along. */
export const TRAIL = 6;

/** The trail with `v` its newest: one that is a visitor already keeps its place and becomes the
 *  newest; the oldest go beyond TRAIL. */
export function visit(trail: readonly Visitor[], v: Visitor): Visitor[] {
  const was = trail.find((x) => x.name === v.name);
  const rest = trail.filter((x) => x.name !== v.name);
  return [...rest, was ?? v].slice(-TRAIL);
}

/** The trail without what is no visitor now: what the board holds (a member since: Add to view, a
 *  rescope, a key mark on a Key view) and what its graph does not have. The same array where
 *  nothing went, so that a caller can tell. */
export function stillVisiting(trail: Visitor[], visiting: (name: string) => boolean): Visitor[] {
  const out = trail.filter((v) => visiting(v.name));
  return out.length === trail.length ? trail : out;
}

// ---------------------------------------------------------------------------------- the places

/** What a visitor's place is read from: its name, its file and whether it is of the outside world. */
export interface VisitNode {
  name: string;
  module: string;
  ext: boolean;
}

/** A temporary cluster: a level of a visitor's path the board does not draw (ViewSpec decision 27).
 *  `key` is its full path (the deepest level's, where a chain of levels holding nothing but one is
 *  merged into one, as the board merges its own), `label` what is written on it. */
export interface TempCluster {
  key: string;
  label: string;
  /** the board's cluster it is drawn in (an index of the layout's clusters), -1 for the top level */
  in: number;
  /** the temporary cluster it is directly inside, -1 where it is directly in `in` */
  up: number;
  /** how many visitors it holds, at any depth */
  count: number;
}

/** The temporary clusters a set of visitors needs, each one before those inside it, and per visitor
 *  the board's cluster it is in and its innermost temporary cluster (-1: directly in that one). */
export interface VisitPlan {
  temps: TempCluster[];
  at: { in: number; up: number }[];
}

/** Where each visitor belongs on a board (ViewSpec decision 27): its cluster path by `mode`, as the
 *  board's tree would have it — the hidden levels taken out, so that a hidden level's members are in
 *  its parent (decision 24), a structure in its own namespace where the board or a visitor has names
 *  under it (`isPrefix`) — met with the clusters the board draws (`drawn`: key → index of the
 *  layout's clusters). The deepest level the board draws holds the visitor; the levels beneath it are
 *  temporary clusters, one tree under each cluster of the board, so that visitors share the ones they
 *  have in common, and a level that holds nothing but one level is merged with it, as the board's own
 *  are (`NumberTheory.FLT`), the outside world's apart. A function of the set and the board alone, in
 *  any order of the visitors: a follower computes the same. */
export function planVisitors(mode: ClusterMode, drawn: ReadonlyMap<string, number>, hidden: ReadonlySet<string>, nodes: readonly VisitNode[], isPrefix: (name: string) => boolean): VisitPlan {
  interface Level {
    key: string;
    label: string;
    kids: Map<string, Level>;
    visitors: number[];
  }
  const level = (key: string, label: string): Level => ({ key, label, kids: new Map(), visitors: [] });
  // per cluster of the board (-1: the top level), the levels under it that it does not draw
  const under = new Map<number, Level>();
  nodes.forEach((n, k) => {
    const parts = clusterPath(mode, { name: n.name, module: n.module, ...(n.ext ? { ext: true as const } : {}) }, isPrefix(n.name) ? new Set([n.name]) : new Set());
    const levels: { key: string; part: string }[] = [];
    let key = "";
    for (const part of parts) {
      key = key ? `${key}.${part}` : part;
      if (!hidden.has(key)) levels.push({ key, part });
    }
    let d = levels.length - 1;
    while (d >= 0 && !drawn.has(levels[d].key)) d--;
    const inn = d >= 0 ? drawn.get(levels[d].key)! : -1;
    let at: Level = under.get(inn) ?? level("", "");
    under.set(inn, at);
    for (const lv of levels.slice(d + 1)) {
      const next: Level = at.kids.get(lv.key) ?? level(lv.key, lv.part === EXT_KEY ? "External" : lv.part);
      at.kids.set(lv.key, next);
      at = next;
    }
    at.visitors.push(k);
  });
  // a level holding nothing but one level says nothing: one circle, the labels joined
  const merge = (lv: Level) => {
    for (const [key, first] of [...lv.kids]) {
      let kid = first;
      while (!kid.visitors.length && kid.kids.size === 1 && kid.key !== EXT_KEY) {
        const only = [...kid.kids.values()][0];
        only.label = `${kid.label}.${only.label}`;
        kid = only;
      }
      lv.kids.set(key, kid);
      merge(kid);
    }
  };
  const temps: TempCluster[] = [];
  const at = nodes.map(() => ({ in: -1, up: -1 }));
  const walk = (lv: Level, inn: number, up: number): number => {
    let count = lv.visitors.length;
    for (const k of lv.visitors) at[k] = { in: inn, up };
    for (const kid of [...lv.kids.values()].sort((a, b) => cmp(a.key, b.key))) {
      const t = temps.length;
      temps.push({ key: kid.key, label: kid.label, in: inn, up, count: 0 });
      temps[t].count = walk(kid, inn, t);
      count += temps[t].count;
    }
    return count;
  };
  for (const [inn, root] of [...under].sort((a, b) => a[0] - b[0])) {
    merge(root);
    walk(root, inn, -1);
  }
  return { temps, at };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The gap between packed discs, as the layout leaves it. */
const GAP = 2.5;

/** Room between a temporary cluster's contents and its circle, for its name: a cluster's own
 *  (web/src/scene.ts, padOf), by how many visitors it holds. */
export function tempPad(count: number): number {
  return 10 + Math.min(14, Math.sqrt(count));
}

/** Each temporary cluster's radius and centre (relative to the one it is in; an outermost one's
 *  place is its spot), and each visitor's point (relative to its temporary cluster; one directly in
 *  a board's cluster is its own spot). Inside a temporary cluster its own temporary clusters and
 *  visitors are packed as siblings, in the order of their names, so that the same set packs the
 *  same whatever the trail's order. */
export interface Packed {
  r: number[];
  x: number[];
  y: number[];
  vx: number[];
  vy: number[];
}

export function packPlan(plan: VisitPlan, names: readonly string[]): Packed {
  const T = plan.temps.length;
  const out: Packed = { r: new Array(T).fill(0), x: new Array(T).fill(0), y: new Array(T).fill(0), vx: names.map(() => 0), vy: names.map(() => 0) };
  const kids: { t: number; k: number; key: string }[][] = plan.temps.map(() => []);
  plan.temps.forEach((tc, t) => tc.up >= 0 && kids[tc.up].push({ t, k: -1, key: tc.key }));
  plan.at.forEach((a, k) => a.up >= 0 && kids[a.up].push({ t: -1, k, key: names[k] }));
  // inside out: a temporary cluster comes after the one it is in (planVisitors)
  for (let t = T - 1; t >= 0; t--) {
    const list = kids[t].sort((a, b) => cmp(a.key, b.key));
    const discs = list.map((c) => ({ x: 0, y: 0, r: (c.t >= 0 ? out.r[c.t] : LEAF_R) + GAP / 2 }));
    if (discs.length > 1) packSiblings(discs);
    const enc = discs.length ? packEnclose(discs) : { x: 0, y: 0, r: LEAF_R };
    list.forEach((c, j) => {
      const dx = discs[j].x - enc.x, dy = discs[j].y - enc.y;
      if (c.t >= 0) {
        out.x[c.t] = dx;
        out.y[c.t] = dy;
      } else {
        out.vx[c.k] = dx;
        out.vy[c.k] = dy;
      }
    });
    out.r[t] = enc.r + tempPad(plan.temps[t].count);
  }
  return out;
}

/** Where what a visitor brings, a disc of radius `r`, goes in a cluster of the board: the spot
 *  nearest `prefer` (in the cluster's coordinates) where it covers none of the cluster's children
 *  (`bodies`), a gap kept, within `room` of the cluster's origin — the room its contents have, its
 *  name's above it (Infinity at the top level) — and where `ok` says no name is written (the
 *  avoidance of the clusters' labels). Rings round `prefer` are tried outwards. Null where no such
 *  spot is: then it goes against the rim (rimSpot), and what it covers makes way. */
export function freeSpot(bodies: readonly Disc[], room: number, r: number, prefer: readonly [number, number], ok: (x: number, y: number) => boolean = () => true): [number, number] | null {
  const lim = room - r;
  if (!(lim >= 0)) return null;
  // the declarations through a grid, the larger bodies each
  const CELL = 4 * LEAF_R;
  const grid = new Map<number, number[]>();
  const big: number[] = [];
  const cellOf = (i: number, j: number) => (i + 100000) * 200003 + (j + 100000);
  bodies.forEach((b, j) => {
    if (b.r > 2 * LEAF_R) return void big.push(j);
    const key = cellOf(Math.floor(b.x / CELL), Math.floor(b.y / CELL));
    const cell = grid.get(key);
    if (cell) cell.push(j);
    else grid.set(key, [j]);
  });
  const near = Math.ceil((r + 2 * LEAF_R + GAP) / CELL);
  const free = (x: number, y: number): boolean => {
    for (const j of big) {
      const b = bodies[j];
      if ((b.x - x) ** 2 + (b.y - y) ** 2 < (b.r + r + GAP) ** 2) return false;
    }
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    for (let i = gx - near; i <= gx + near; i++)
      for (let j = gy - near; j <= gy + near; j++)
        for (const k of grid.get(cellOf(i, j)) ?? []) {
          const b = bodies[k];
          if ((b.x - x) ** 2 + (b.y - y) ** 2 < (b.r + r + GAP) ** 2) return false;
        }
    return true;
  };
  // the preferred spot, brought into the room
  let [px, py] = prefer;
  const d0 = Math.hypot(px, py);
  if (d0 > lim) [px, py] = [(px * lim) / d0, (py * lim) / d0];
  // how far to look: across the room, or at the top level a little past everything there is
  let reach = lim + Math.hypot(px, py);
  if (!Number.isFinite(reach)) {
    reach = 2 * r + GAP;
    for (const b of bodies) reach = Math.max(reach, Math.hypot(b.x - px, b.y - py) + b.r + 2 * r + GAP);
  }
  const step = Math.max(r / 2, reach / 120, 1);
  for (let rho = 0; rho <= reach + step; rho += step) {
    const m = rho === 0 ? 1 : Math.ceil((2 * Math.PI * rho) / step);
    for (let q = 0; q < m; q++) {
      // from the lower right round: the clusters' names are at their tops
      const a = Math.PI / 4 + (q * 2 * Math.PI) / m;
      const x = px + rho * Math.cos(a), y = py + rho * Math.sin(a);
      if (Math.hypot(x, y) > lim + 1e-9) continue;
      if (free(x, y) && ok(x, y)) return [x, y];
    }
  }
  return null;
}

/** Where what a visitor brings goes when no spot of a cluster is free (freeSpot): against the rim of
 *  its room, at the angle where it covers least of the cluster's children (by how deep it overlaps
 *  them), the nearest `prefer`'s direction among equals (the lower right where `prefer` is the
 *  middle). What it covers makes way (web/src/scene.ts, the held room); the circle grows only where
 *  that cannot fit otherwise. */
export function rimSpot(bodies: readonly Disc[], room: number, r: number, prefer: readonly [number, number]): [number, number] {
  const lim = Math.max(0, room - r);
  const want = Math.hypot(prefer[0], prefer[1]) > 1e-6 ? Math.atan2(prefer[1], prefer[0]) : Math.PI / 4;
  if (!Number.isFinite(lim)) return [prefer[0], prefer[1]];
  let best: [number, number] = [lim * Math.cos(want), lim * Math.sin(want)];
  let bestCost = Infinity, bestTurn = Infinity;
  for (let q = 0; q < 72; q++) {
    const a = want + (q * 2 * Math.PI) / 72;
    const x = lim * Math.cos(a), y = lim * Math.sin(a);
    let cost = 0;
    for (const b of bodies) cost += Math.max(0, b.r + r + GAP - Math.hypot(b.x - x, b.y - y));
    const turn = Math.min(q, 72 - q);
    if (cost < bestCost - 1e-6 || (Math.abs(cost - bestCost) <= 1e-6 && turn < bestTurn)) {
      [best, bestCost, bestTurn] = [[x, y], cost, turn];
    }
  }
  return best;
}

/** Whether a disc of radius `r` round a point of the world is clear of every box of `boxes` (left,
 *  top, right, bottom, four numbers a box): what a visitor's spot keeps clear of the clusters' names
 *  as they are written on the board, so that it never sits on a circle's label. */
export function clearOfBoxes(boxes: readonly number[], x: number, y: number, r: number): boolean {
  for (let j = 0; j + 3 < boxes.length; j += 4) {
    // the nearest point of the box to the spot, within r of it or not
    const nx = Math.max(boxes[j], Math.min(x, boxes[j + 2]));
    const ny = Math.max(boxes[j + 1], Math.min(y, boxes[j + 3]));
    if ((nx - x) ** 2 + (ny - y) ** 2 <= r * r) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------- presence

/** The trail as a follower is told it (PresenceView.visitors), read back with care: at most TRAIL
 *  visitors, each a name, where it was reached from and its place where one is given (a page of
 *  before 2026-10-11 gives a place of the world instead, which is not read: the follower places it). */
export function readVisitors(raw: unknown): Visitor[] {
  if (!Array.isArray(raw)) return [];
  const out: Visitor[] = [];
  const finite = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e8);
  for (const x of raw.slice(0, TRAIL)) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    if (!o || typeof o.decl !== "string" || !o.decl || o.decl.length > 2000) continue;
    const place = typeof o.in === "string" && o.in.length <= 2000 && finite(o.spot) ? { in: o.in, at: [o.spot[0], o.spot[1]] as [number, number] } : null;
    out.push({ name: o.decl, from: typeof o.from === "string" && o.from.length <= 2000 ? o.from : null, place });
  }
  return out;
}

/** The trail as presence carries it: each visitor's declaration, where it came from, its place (the
 *  board's cluster and the spot in it), and where it is drawn in the world (`world`), which pages of
 *  before 2026-10-11 read. */
export function shareVisitors(trail: readonly Visitor[], world: (k: number) => [number, number] | null = () => null): { decl: string; at?: [number, number]; from?: string; in?: string; spot?: [number, number] }[] {
  const r = (n: number) => Math.round(n * 10) / 10;
  return trail.map((v, k) => {
    const w = world(k);
    return {
      decl: v.name,
      ...(w ? { at: [r(w[0]), r(w[1])] as [number, number] } : {}),
      ...(v.from ? { from: v.from } : {}),
      ...(v.place ? { in: v.place.in, spot: [r(v.place.at[0]), r(v.place.at[1])] as [number, number] } : {}),
    };
  });
}

// ---------------------------------------------------------------------------------- edges

/** The most edges a visitor draws to the board: one used everywhere would be a wall of them. */
export const MAX_EDGES = 400;

/** A visitor's references, as its edges are drawn: to and from what the board holds (`toView`: a
 *  declaration of the whole graph on the board, or -1) and the other visitors (`visitorOf`: its
 *  index in the trail, or -1). Each is [the other end, whether it uses the visitor (in) or the
 *  visitor uses it (out), whether the reference is in a statement or a body (strong) or only in a
 *  proof or on grammar]. At most MAX_EDGES to the board, the strong first. */
export function visitorEdges(g: Graph, v: number, toView: (i: number) => number, visitorOf: (i: number) => number): { board: [number, boolean, boolean][]; visitors: [number, boolean, boolean][] } {
  const strong = (site: number) => (site & (SITE_STMT | SITE_BODY)) !== 0;
  const board = new Map<string, [number, boolean, boolean]>();
  const visitors = new Map<string, [number, boolean, boolean]>();
  const take = (u: number, incoming: boolean, site: number) => {
    if (u === v) return;
    const j = toView(u);
    const m = j >= 0 ? board : visitors;
    const end = j >= 0 ? j : visitorOf(u);
    if (end < 0) return;
    const key = `${end}${incoming ? "<" : ">"}`;
    const was = m.get(key);
    if (!was || (!was[2] && strong(site))) m.set(key, [end, incoming, strong(site) || !!was?.[2]]);
  };
  for (let e = g.outStart[v]; e < g.outStart[v + 1]; e++) take(g.outDst[e], false, g.outSite[e]);
  for (let e = g.inStart[v]; e < g.inStart[v + 1]; e++) take(g.inSrc[e], true, g.inSite[e]);
  const all = [...board.values()].sort((a, b) => Number(b[2]) - Number(a[2]));
  return { board: all.slice(0, MAX_EDGES), visitors: [...visitors.values()] };
}
