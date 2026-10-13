// The reader's visitors laid on the board's scene (ViewSpec decision 27, the owner's decision of
// 2026-10-11): each in its own place in the cluster hierarchy, the clusters it needs added as
// temporary ones (web/src/visitors.ts, planVisitors), the outermost of them in the deepest cluster the
// board draws, at a spot chosen once.
//
// Making room: what a visitor brings goes where its cluster has free room, nearest the declarations it
// has references with; where the cluster has none, against its rim where it covers least, and what it
// covers makes way, as from a drop, the circle growing only where that cannot fit (web/src/scene.ts,
// setHeld). Nothing of it is a pin or the board's: when the visitors go, every place comes back.
//
// A spot is in its cluster's coordinates and carried to followers with the trail (PresenceView), so a
// follower draws the temporary clusters where the leader does; the rest — which clusters, nested how,
// packed how — is a function of the visitors and the board, the same on every page.

import type { ClusterMode, Layout } from "../../shared/graph.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { LEAF_R } from "./scene.ts";
import type { Disc, Scene } from "./scene.ts";
import { freeSpot, packPlan, planVisitors, rimSpot } from "./visitors.ts";
import type { Packed, VisitNode, VisitPlace, VisitPlan } from "./visitors.ts";

/** How far outside what it holds a cluster's circle is drawn (web/src/scene.ts, computeExtents). */
const DRAWN_MARGIN = 6;

/** A visitor as it is placed: what its cluster path is read from, its place where it has one, and the
 *  board's declarations it has references with (indices of the board's graph), towards which a new
 *  place is chosen. */
export interface VisitIn extends VisitNode {
  place: VisitPlace | null;
  near: readonly number[];
}

/** The outermost of what visitors bring into a cluster of the board: a temporary cluster, or a visitor
 *  that sits in the board's cluster itself. */
export interface Item {
  /** the board's cluster it is in, -1 for the top level */
  in: number;
  /** its temporary cluster, or -1 */
  temp: number;
  /** the visitor it is, or -1 */
  visitor: number;
  /** its spot in the cluster's coordinates, and its radius */
  at: [number, number];
  r: number;
  /** its index among the discs held in its cluster (Scene.heldAt) */
  slot: number;
}

/** The visitors placed on a board: the plan, how it packs, the outermost items and each visitor's item
 *  and place. */
export interface Visits {
  plan: VisitPlan;
  pack: Packed;
  items: Item[];
  item: number[];
  places: VisitPlace[];
  /** the room each cluster holds for them (Scene.setHeld) */
  held: Map<number, Disc[]>;
}

/** Whether a declaration's name is a namespace too, on a board whose declarations are `names` (the
 *  outside world's left out), the visitors' among them: a structure then sits in its own namespace's
 *  cluster, as the board would draw it (shared/layout.ts, pathOf). */
export function prefixTest(g: Pick<Graph, "n" | "nodes" | "isExt">, visitors: readonly string[]): (name: string) => boolean {
  const memo = new Map<string, boolean>();
  return (name) => {
    let hit = memo.get(name);
    if (hit !== undefined) return hit;
    const head = `${name}.`;
    hit = visitors.some((v) => v.startsWith(head));
    for (let i = 0; !hit && i < g.n; i++) if (!g.isExt(i) && g.nodes[i].name.startsWith(head)) hit = true;
    memo.set(name, hit);
    return hit;
  };
}

/** Where the visitors `vs` belong on a board (web/src/visitors.ts, planVisitors): its layout `L` by
 *  `mode`, the levels `hidden`, its graph `g`. */
export function planOn(L: Layout, mode: ClusterMode, hidden: readonly string[], g: Pick<Graph, "n" | "nodes" | "isExt">, vs: readonly VisitNode[]): VisitPlan {
  const drawn = new Map(L.clusters.map((c, k) => [c.key, k]));
  return planVisitors(mode, drawn, new Set(hidden), vs, prefixTest(g, vs.map((v) => v.name)));
}

/** The board's clusters round the places of the visitors `chosen` (indices of the trail): the folded
 *  ones among them open for the reader while those are selected (ViewSpec decision 27). */
export function openFor(plan: VisitPlan, parent: ArrayLike<number>, chosen: readonly number[]): Set<number> {
  const out = new Set<number>();
  for (const k of chosen) for (let c = plan.at[k]?.in ?? -1; c >= 0; c = parent[c]) out.add(c);
  return out;
}

/** Place the visitors `vs` (the trail, oldest first) on a board as `plan` says (planOn): its layout
 *  `L`, its scene `S` as the board arranges it. An item keeps the place its oldest visitor has in
 *  that cluster; one with none is given a spot — in the order its oldest visitor came, so that a newer
 *  one never moves an older one — where `ok` (a spot of the world and a radius) finds no cluster's
 *  name written. */
export function placeVisits(S: Scene, L: Layout, plan: VisitPlan, vs: readonly VisitIn[], ok: (x: number, y: number, r: number) => boolean = () => true): Visits {
  const names = vs.map((v) => v.name);
  const pack = packPlan(plan, names);
  const keyOf = (c: number) => (c < 0 ? "" : L.clusters[c].key);
  // the outermost items, and which visitors each holds
  const items: Item[] = [];
  const ofTemp = new Map<number, number>();
  plan.temps.forEach((t, k) => {
    if (t.up >= 0) return;
    ofTemp.set(k, items.length);
    items.push({ in: t.in, temp: k, visitor: -1, at: [0, 0], r: pack.r[k], slot: 0 });
  });
  const item = plan.at.map((a, k) => {
    if (a.up < 0) {
      items.push({ in: a.in, temp: -1, visitor: k, at: [0, 0], r: LEAF_R, slot: 0 });
      return items.length - 1;
    }
    let t = a.up;
    while (plan.temps[t].up >= 0) t = plan.temps[t].up;
    return ofTemp.get(t)!;
  });
  const members = items.map(() => [] as number[]);
  item.forEach((j, k) => members[j].push(k));
  // in the order their oldest visitors came
  const order = items.map((_, j) => j).sort((a, b) => members[a][0] - members[b][0]);
  const placed = new Map<number, Item[]>();
  for (const j of order) {
    const it = items[j];
    const kept = members[j].map((k) => vs[k].place).find((p) => p && p.in === keyOf(it.in));
    if (kept) it.at = [kept.at[0], kept.at[1]];
    else {
      const room = S.roomOf(it.in);
      // a sub-cluster's circle is drawn a little outside what it holds (Scene, computeExtents)
      const bodies = [...S.discsIn(it.in).map((d) => (d.r > LEAF_R ? { ...d, r: d.r + DRAWN_MARGIN } : d)), ...(placed.get(it.in) ?? []).map((o) => ({ x: o.at[0], y: o.at[1], r: o.r }))];
      // towards the declarations it has references with, as the board arranges them
      const [ox, oy] = S.anchorWorld(it.in);
      let sx = 0, sy = 0, m = 0;
      for (const k of members[j])
        for (const i of vs[k].near) {
          const [cx, cy] = S.anchorWorld(S.nodeCluster[i]);
          sx += cx + S.ancNX[i];
          sy += cy + S.ancNY[i];
          m++;
        }
      const prefer: [number, number] = m ? [sx / m - ox, sy / m - oy] : [0, 0];
      const okHere = (x: number, y: number) => ok(ox + x, oy + y, it.r);
      it.at = freeSpot(bodies, room, it.r, prefer, okHere) ?? rimSpot(bodies, room, it.r, prefer);
    }
    const list = placed.get(it.in) ?? [];
    it.slot = list.length;
    list.push(it);
    placed.set(it.in, list);
  }
  const held = new Map<number, Disc[]>();
  for (const [c, list] of placed) held.set(c, list.map((o) => ({ x: o.at[0], y: o.at[1], r: o.r })));
  const places = item.map((j) => ({ in: keyOf(items[j].in), at: [items[j].at[0], items[j].at[1]] as [number, number] }));
  return { plan, pack, items, item, places, held };
}

/** Where the visitors are drawn now, in the world: each temporary cluster's centre and radius, each
 *  visitor's point, and per visitor the folded cluster whose card hides it (-1 where none does). They
 *  follow their clusters, as the scene moves them (its held discs made way among themselves). */
export interface VisitWorld {
  tx: Float64Array;
  ty: Float64Array;
  tr: Float64Array;
  /** per temporary cluster, the folded cluster hiding it, or -1 */
  trep: Int32Array;
  vx: Float64Array;
  vy: Float64Array;
  vrep: Int32Array;
}

export function visitWorld(V: Visits, S: Scene): VisitWorld {
  const T = V.plan.temps.length, K = V.plan.at.length;
  const W: VisitWorld = { tx: new Float64Array(T), ty: new Float64Array(T), tr: new Float64Array(T), trep: new Int32Array(T), vx: new Float64Array(K), vy: new Float64Array(K), vrep: new Int32Array(K) };
  const centre = (it: Item): [number, number, number] => {
    const at = S.heldAt.get(it.in);
    const hx = at ? at[2 * it.slot] : it.at[0], hy = at ? at[2 * it.slot + 1] : it.at[1];
    if (it.in < 0) return [hx, hy, 1];
    const s = S.scale[it.in];
    return [S.cwx[it.in] + hx * s, S.cwy[it.in] + hy * s, s];
  };
  const scaleOf = (c: number) => (c < 0 ? 1 : S.scale[c]);
  const repOf = (c: number) => (c < 0 ? -1 : S.rep[c]);
  for (let t = 0; t < T; t++) {
    const tc = V.plan.temps[t];
    const s = scaleOf(tc.in);
    if (tc.up < 0) {
      const it = V.items[V.items.findIndex((x) => x.temp === t)];
      [W.tx[t], W.ty[t]] = centre(it);
    } else {
      W.tx[t] = W.tx[tc.up] + V.pack.x[t] * s;
      W.ty[t] = W.ty[tc.up] + V.pack.y[t] * s;
    }
    W.tr[t] = V.pack.r[t] * s;
    W.trep[t] = repOf(tc.in);
  }
  for (let k = 0; k < K; k++) {
    const a = V.plan.at[k];
    if (a.up >= 0) {
      const s = scaleOf(a.in);
      W.vx[k] = W.tx[a.up] + V.pack.vx[k] * s;
      W.vy[k] = W.ty[a.up] + V.pack.vy[k] * s;
    } else [W.vx[k], W.vy[k]] = centre(V.items[V.item[k]]);
    W.vrep[k] = repOf(a.in);
  }
  return W;
}

/** A visitor's chain of position ids up to the top level, as its edges are bundled through the
 *  hierarchy (web/src/bundles.ts, joinChains): itself, its temporary clusters, the board's clusters
 *  round it — or, hidden in a folded cluster's card, that card and the clusters round it. Ids past the
 *  scene's (`base` = clusters and declarations) are the visitors' own: a temporary cluster t at
 *  base + t, a visitor k at base + temps + k. */
export function visitChain(V: Visits, W: VisitWorld, S: Pick<Scene, "parent">, base: number, k: number): number[] {
  const out: number[] = [];
  const a = V.plan.at[k];
  if (W.vrep[k] < 0) {
    out.push(base + V.plan.temps.length + k);
    for (let t = a.up; t >= 0; t = V.plan.temps[t].up) out.push(base + t);
  }
  for (let c = W.vrep[k] >= 0 ? W.vrep[k] : a.in; c >= 0; c = S.parent[c]) out.push(c);
  return out;
}
