// The scene graph: positions as a tree that mirrors the cluster tree (CanvasSpec.md, decision 2).
//
// A cluster's position is local to its parent's origin, a node's to its cluster's. World positions
// are summed down the tree, so moving a cluster carries everything in it, folded or not.
//
// Three positions per body, all local:
//   home    — what the server laid out (or a pin the reader dropped it at);
//   anchor  — where it should be now: home, unless folding elsewhere made room and it moved in;
//   current — where it is drawn, which follows the anchor (C3 replaces the easing by motion).
//
// Folding is a layout event. A folded cluster takes the room of a small disc, so its parent's
// other children slide inwards along their own direction from the parent's origin until they
// touch something; the arrangement stays recognisable and the parent shrinks. With nothing folded
// the anchors are exactly the server's layout.
//
// The scene may hold room for what is not the board's: the discs the reader's visitors and their
// temporary clusters take (ViewSpec decision 27; web/src/visits.ts). What they cover makes way, as
// from a drop; they are never pins, and when they go everything is where it was.

import type { Layout } from "../../shared/graph.ts";
import type { Motion } from "./motion.ts";
import { type Bodies, Separator } from "../../shared/separate.ts";

/** A disc in a cluster's coordinates: what room is held for (Scene.setHeld). */
export interface Disc {
  x: number;
  y: number;
  r: number;
}

/** collision radius of a declaration, as the server packs them */
export const LEAF_R = 5;
const GAP = 2.5;
/** easing time constant for folding and disc radii, ms (positions move by motion.ts) */
const TAU = 110;

export interface PinState {
  nodes: Record<string, [number, number]>;
  clusters: Record<string, [number, number]>;
}

export class Scene {
  readonly layout: Layout;
  readonly n: number;
  readonly nc: number;
  readonly parent: Int32Array;
  readonly nodeCluster: Int32Array;
  readonly kidsC: number[][];
  readonly kidsN: number[][];
  readonly rootC: number[] = [];
  readonly rootN: number[] = [];

  private homeCX: Float32Array;
  private homeCY: Float32Array;
  private homeR: Float32Array;
  private homeNX: Float32Array;
  private homeNY: Float32Array;

  /** where the reader dropped things, local */
  readonly pinC = new Map<number, [number, number]>();
  readonly pinN = new Map<number, [number, number]>();
  /** body id (cluster c, node nc + i) → when it was dropped; later drops win where drops overlap */
  private dropSeq = new Map<number, number>();
  private dropNext = 1;
  /** clusters whose children must be arranged again (something in them moved, folded or grew) */
  private dirty: Uint8Array;
  private rootDirty = false;
  private separator = new Separator(2 * LEAF_R + GAP);

  /** room held in a cluster (-1: the top level) for what is not the board's, in its coordinates:
   *  the discs of the reader's visitors (setHeld) */
  private held = new Map<number, Disc[]>();
  /** where each held disc is after making way among the others (x, y pairs, as `held` orders them) */
  readonly heldAt = new Map<number, Float64Array>();

  /** what the reader asked to be folded */
  readonly folded = new Set<number>();
  /** folded and gathered: drawn as one disc. Lags `folded` while the contents flow in. */
  private shut = new Set<number>();
  /** cluster → outermost shut cluster containing it (itself included), or -1 */
  rep: Int32Array;
  /** node → shut cluster hiding it, or -1 */
  nodeRep: Int32Array;

  ancCX: Float32Array;
  ancCY: Float32Array;
  ancNX: Float32Array;
  ancNY: Float32Array;
  /** radius the cluster needs now, given what inside it is folded */
  effR: Float32Array;

  curCX: Float32Array;
  curCY: Float32Array;
  curNX: Float32Array;
  curNY: Float32Array;
  /** radius easing towards effR (the home radius, or what folding made it) */
  curR: Float32Array;
  /** the circle as drawn: never smaller than what it holds needs right now (CanvasSpec,
   *  "circles mean containment"); recomputed with the world positions */
  drawnR: Float32Array;
  /** how far a cluster's contents are spread: 1 open, 0 gathered into its origin */
  private bloom: Float32Array;
  private bloomTo: Float32Array;

  /** world positions and the scale a cluster's local frame is drawn at */
  readonly cwx: Float32Array;
  readonly cwy: Float32Array;
  readonly nwx: Float32Array;
  readonly nwy: Float32Array;
  scale: Float32Array;

  /** something is still easing or moving */
  moving = false;
  /** set by the canvas: moves bodies towards their anchors, elastically */
  motion: Motion | null = null;
  /** bumped whenever which clusters are shut changes, so the canvas can follow */
  repVersion = 0;

  constructor(layout: Layout) {
    this.layout = layout;
    const nc = (this.nc = layout.clusters.length);
    const n = (this.n = layout.x.length);
    this.parent = Int32Array.from(layout.clusters.map((c) => c.parent));
    this.nodeCluster = Int32Array.from(layout.cluster);
    this.kidsC = layout.clusters.map(() => []);
    this.kidsN = layout.clusters.map(() => []);
    layout.clusters.forEach((c, i) => (c.parent >= 0 ? this.kidsC[c.parent].push(i) : this.rootC.push(i)));
    layout.cluster.forEach((c, i) => (c >= 0 ? this.kidsN[c].push(i) : this.rootN.push(i)));

    this.homeCX = Float32Array.from(layout.clusters.map((c) => c.lx));
    this.homeCY = Float32Array.from(layout.clusters.map((c) => c.ly));
    this.homeR = Float32Array.from(layout.clusters.map((c) => c.r));
    this.homeNX = Float32Array.from(layout.lx);
    this.homeNY = Float32Array.from(layout.ly);

    this.ancCX = this.homeCX.slice();
    this.ancCY = this.homeCY.slice();
    this.ancNX = this.homeNX.slice();
    this.ancNY = this.homeNY.slice();
    this.effR = this.homeR.slice();
    this.curCX = this.homeCX.slice();
    this.curCY = this.homeCY.slice();
    this.curNX = this.homeNX.slice();
    this.curNY = this.homeNY.slice();
    this.curR = this.homeR.slice();
    this.drawnR = this.homeR.slice();
    this.bloom = new Float32Array(nc).fill(1);
    this.bloomTo = new Float32Array(nc).fill(1);
    this.cwx = new Float32Array(nc);
    this.cwy = new Float32Array(nc);
    this.nwx = new Float32Array(n);
    this.nwy = new Float32Array(n);
    this.scale = new Float32Array(nc).fill(1);
    this.rep = new Int32Array(nc).fill(-1);
    this.nodeRep = new Int32Array(n).fill(-1);
    this.dirty = new Uint8Array(nc);
    this.computeWorld();
  }

  // ---------------------------------------------------------------- state from outside

  /** Pins and folds by name, as saved; applied at once, without easing. */
  restore(pins: PinState, foldedKeys: string[], names: (i: number) => string): void {
    const byKey = new Map(this.layout.clusters.map((c, i) => [c.key, i]));
    for (const [key, p] of Object.entries(pins.clusters)) {
      const c = byKey.get(key);
      if (c !== undefined) this.pinC.set(c, p);
    }
    const byName = new Map<string, number>();
    for (let i = 0; i < this.n; i++) byName.set(names(i), i);
    for (const [name, p] of Object.entries(pins.nodes)) {
      const i = byName.get(name);
      if (i !== undefined) this.pinN.set(i, p);
    }
    for (const k of foldedKeys) {
      const c = byKey.get(k);
      if (c !== undefined) {
        this.folded.add(c);
        this.shut.add(c);
        this.bloom[c] = this.bloomTo[c] = 0;
      }
    }
    // places saved under an earlier layout (or before drags were confined) may lie outside the
    // parent: they are brought in, as a drag to them would have been
    for (const [c, [x, y]] of this.pinC) this.pinC.set(c, this.inside(this.parent[c], this.homeSize(c), x, y));
    for (const [i, [x, y]] of this.pinN) this.pinN.set(i, this.inside(this.nodeCluster[i], LEAF_R, x, y));
    for (const c of this.pinC.keys()) this.dropSeq.set(c, this.dropNext++);
    for (const i of this.pinN.keys()) this.dropSeq.set(this.nc + i, this.dropNext++);
    this.computeRep();
    this.computeAnchors(true);
    this.snap();
  }

  /** Pins as another reader left them (CollabSpec decision 2): what changed is set, what is gone
   *  is let go, in the order given (later drops win); the rest glides to its new place. True
   *  when anything changed. */
  applyPins(pins: PinState, names: (i: number) => string): boolean {
    const byKey = new Map(this.layout.clusters.map((c, i) => [c.key, i]));
    const byName = new Map<string, number>();
    for (let i = 0; i < this.n; i++) byName.set(names(i), i);
    const wantC = new Map<number, [number, number]>();
    for (const [key, [x, y]] of Object.entries(pins.clusters)) {
      const c = byKey.get(key);
      if (c !== undefined) wantC.set(c, this.inside(this.parent[c], this.homeSize(c), x, y));
    }
    const wantN = new Map<number, [number, number]>();
    for (const [name, [x, y]] of Object.entries(pins.nodes)) {
      const i = byName.get(name);
      if (i !== undefined) wantN.set(i, this.inside(this.nodeCluster[i], LEAF_R, x, y));
    }
    const same = (a: [number, number] | undefined, b: [number, number]) => !!a && Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
    let changed = false;
    for (const c of [...this.pinC.keys()])
      if (!wantC.has(c)) {
        this.pinC.delete(c);
        this.touch(this.parent[c]);
        changed = true;
      }
    for (const i of [...this.pinN.keys()])
      if (!wantN.has(i)) {
        this.pinN.delete(i);
        this.touch(this.nodeCluster[i]);
        changed = true;
      }
    for (const [c, p] of wantC) {
      if (same(this.pinC.get(c), p)) continue;
      this.pinC.set(c, p);
      this.dropSeq.set(c, this.dropNext++);
      this.touch(this.parent[c]);
      changed = true;
    }
    for (const [i, p] of wantN) {
      if (same(this.pinN.get(i), p)) continue;
      this.pinN.set(i, p);
      this.dropSeq.set(this.nc + i, this.dropNext++);
      this.touch(this.nodeCluster[i]);
      changed = true;
    }
    if (!changed) return false;
    this.computeAnchors();
    this.motion?.wakeDisplaced();
    this.moving = true;
    return true;
  }

  /** Pin one body at a place in its parent's coordinates, as a drop there would (the linear form's
   *  drop, web/src/linear.ts): brought inside the parent, the latest drop, the rest making way. */
  pinAt(kind: "node" | "cluster", k: number, lx: number, ly: number): void {
    if (kind === "cluster") {
      this.pinC.set(k, this.inside(this.parent[k], this.homeSize(k), lx, ly));
      this.dropSeq.set(k, this.dropNext++);
      this.touch(this.parent[k]);
    } else {
      this.pinN.set(k, this.inside(this.nodeCluster[k], LEAF_R, lx, ly));
      this.dropSeq.set(this.nc + k, this.dropNext++);
      this.touch(this.nodeCluster[k]);
    }
    this.computeAnchors();
    this.motion?.wakeDisplaced();
    this.moving = true;
  }

  pins(names: (i: number) => string): PinState {
    const out: PinState = { nodes: {}, clusters: {} };
    const r = (v: number) => Math.round(v * 10) / 10;
    // in the order they were dropped, so that a reload keeps which of two overlapping drops wins
    const when = (id: number) => this.dropSeq.get(id) ?? 0;
    for (const c of [...this.pinC.keys()].sort((a, b) => when(a) - when(b))) {
      const [x, y] = this.pinC.get(c)!;
      out.clusters[this.layout.clusters[c].key] = [r(x), r(y)];
    }
    for (const i of [...this.pinN.keys()].sort((a, b) => when(this.nc + a) - when(this.nc + b))) {
      const [x, y] = this.pinN.get(i)!;
      out.nodes[names(i)] = [r(x), r(y)];
    }
    return out;
  }

  foldedKeys(): string[] {
    return [...this.folded].map((c) => this.layout.clusters[c].key);
  }

  /** Fold or unfold; the contents flow in or out, the neighbours make or take the room. */
  setFolded(next: Set<number>): void {
    for (const c of [...this.folded]) {
      if (next.has(c)) continue;
      // unfold: open at once, then let the contents grow out of the origin
      this.folded.delete(c);
      this.shut.delete(c);
      this.bloomTo[c] = 1;
      this.touch(this.parent[c]);
    }
    for (const c of next) {
      if (this.folded.has(c)) continue;
      this.folded.add(c);
      this.bloomTo[c] = 0;
      this.touch(this.parent[c]);
    }
    this.computeRep();
    this.computeAnchors();
    this.motion?.wakeDisplaced();
    this.moving = true;
  }

  /** Drop a cluster at a world position: it becomes its home, its subtree comes along. It stays
   *  inside its parent's circle: dragged further, it follows the pointer along the edge. */
  placeCluster(c: number, wx: number, wy: number): void {
    const p = this.parent[c];
    const s = p >= 0 ? this.scale[p] : 1;
    const [lx, ly] = this.inside(p, this.rho(c), (wx - (p >= 0 ? this.cwx[p] : 0)) / s, (wy - (p >= 0 ? this.cwy[p] : 0)) / s);
    if (this.motion && this.motion.drag !== c) this.motion.dragFrom = [this.ancCX[c], this.ancCY[c]];
    this.pinC.set(c, [lx, ly]);
    this.dropSeq.set(c, this.dropNext++);
    this.ancCX[c] = this.curCX[c] = lx;
    this.ancCY[c] = this.curCY[c] = ly;
    this.touch(p);
    // while the pointer holds it, collisions make way (motion.ts); the arrangement follows on release
    if (!this.motion) this.computeAnchors();
    if (this.motion) {
      this.motion.drag = c;
      this.motion.wakeBody(c);
      this.motion.wakeDisplaced();
    }
    this.moving = true;
  }

  placeNode(i: number, wx: number, wy: number): void {
    const c = this.nodeCluster[i];
    const s = c >= 0 ? this.scale[c] : 1;
    const [lx, ly] = this.inside(c, LEAF_R, (wx - (c >= 0 ? this.cwx[c] : 0)) / s, (wy - (c >= 0 ? this.cwy[c] : 0)) / s);
    if (this.motion && this.motion.drag !== this.nc + i) this.motion.dragFrom = [this.ancNX[i], this.ancNY[i]];
    this.pinN.set(i, [lx, ly]);
    this.dropSeq.set(this.nc + i, this.dropNext++);
    this.ancNX[i] = this.curNX[i] = lx;
    this.ancNY[i] = this.curNY[i] = ly;
    this.touch(c);
    if (!this.motion) this.computeAnchors();
    if (this.motion) {
      this.motion.drag = this.nc + i;
      this.motion.wakeBody(this.nc + i);
      this.motion.wakeDisplaced();
    }
    this.moving = true;
  }

  /** The pointer let go: what was dragged stays as a pin, the rest springs back. */
  endDrag(): void {
    this.computeAnchors();
    if (this.motion) {
      this.motion.drag = null;
      this.motion.dragFrom = null;
      this.motion.wakeDisplaced();
    }
    this.moving = true;
  }

  unpinNode(i: number): void {
    this.pinN.delete(i);
    this.touch(this.nodeCluster[i]);
    this.computeAnchors();
    this.motion?.wakeDisplaced();
    this.moving = true;
  }

  unpinCluster(c: number): void {
    this.pinC.delete(c);
    this.touch(this.parent[c]);
    this.computeAnchors();
    this.motion?.wakeDisplaced();
    this.moving = true;
  }

  isShut(c: number): boolean {
    return this.shut.has(c);
  }

  /** Folded, or inside a folded cluster, as the reader asked (ahead of the animation). */
  collapsed(c: number): boolean {
    for (let x = c; x >= 0; x = this.parent[x]) if (this.folded.has(x)) return true;
    return false;
  }

  isPinned(i: number): boolean {
    return this.pinN.has(i);
  }

  /** Hold room in clusters for what is not the board's (ViewSpec decision 27): per cluster (-1: the
   *  top level), the discs the reader's visitors take there, in its coordinates, the later of two
   *  holding against the earlier. What they cover makes way; nothing of it is a pin, and an empty map
   *  gives every place back. `snap`: at once, for a scene just made. */
  setHeld(next: ReadonlyMap<number, readonly Disc[]>, snap = false): void {
    const same = (a: readonly Disc[], b: readonly Disc[]) => a.length === b.length && a.every((d, k) => d.x === b[k].x && d.y === b[k].y && d.r === b[k].r);
    let changed = false;
    for (const c of new Set([...this.held.keys(), ...next.keys()])) {
      if (same(this.held.get(c) ?? [], next.get(c) ?? [])) continue;
      this.touch(c);
      changed = true;
    }
    if (!changed) return;
    this.held = new Map([...next].filter(([, d]) => d.length).map(([c, d]) => [c, [...d]]));
    for (const c of [...this.heldAt.keys()]) if (!this.held.has(c)) this.heldAt.delete(c);
    this.computeAnchors();
    if (snap) return this.snap();
    this.motion?.wakeDisplaced();
    this.moving = true;
  }

  /** Whether room is held anywhere (setHeld). */
  holds(): boolean {
    return this.held.size > 0;
  }

  /** How far from a cluster's origin its contents may reach, leaving room for its name (Infinity
   *  for the top level, -1). */
  roomOf(c: number): number {
    return c < 0 ? Infinity : this.homeR[c] - this.padOf(c);
  }

  /** A cluster's children (-1: the top level's) as discs at their anchors, in its coordinates: a
   *  sub-cluster the room it takes now, a declaration its own. */
  discsIn(c: number): Disc[] {
    const out: Disc[] = [];
    for (const k of c < 0 ? this.rootC : this.kidsC[c]) out.push({ x: this.ancCX[k], y: this.ancCY[k], r: this.rho(k) });
    for (const i of c < 0 ? this.rootN : this.kidsN[c]) out.push({ x: this.ancNX[i], y: this.ancNY[i], r: LEAF_R });
    return out;
  }

  /** A cluster's anchor in the world, as the board arranges it with nothing folded gathering it
   *  (-1: the origin): where a place in its coordinates is, whatever is folded now. */
  anchorWorld(c: number): [number, number] {
    let x = 0, y = 0;
    for (let k = c; k >= 0; k = this.parent[k]) {
      x += this.ancCX[k];
      y += this.ancCY[k];
    }
    return [x, y];
  }

  /** A local position for a body of radius `r` in cluster `p`, brought inside the room the
   *  cluster has at home: a drag never grows the circle it happens in, so circles keep meaning
   *  containment without one of them swallowing the canvas. At the top level, anywhere. */
  private inside(p: number, r: number, lx: number, ly: number): [number, number] {
    if (p < 0) return [lx, ly];
    const room = Math.max(0, this.homeR[p] - this.padOf(p) - r);
    const d = Math.hypot(lx, ly);
    return d > room ? [(lx * room) / d, (ly * room) / d] : [lx, ly];
  }

  /** Room between a cluster's contents and its circle, for its label. */
  private padOf(c: number): number {
    return 10 + Math.min(14, Math.sqrt(this.layout.clusters[c].count));
  }

  private homeSize(c: number): number {
    return this.folded.has(c) ? this.bubbleR(c) : this.homeR[c];
  }

  /** Radius of a folded cluster's disc: grows with the square root of what it holds. */
  bubbleR(c: number): number {
    return Math.min(this.homeR[c], 9 + 2.2 * Math.sqrt(this.layout.clusters[c].count));
  }


  // ---------------------------------------------------------------- the layout event

  private computeRep(): void {
    this.repVersion++;
    const nc = this.nc;
    for (let c = 0; c < nc; c++) {
      const p = this.parent[c];
      const up = p >= 0 ? this.rep[p] : -1;
      this.rep[c] = up >= 0 ? up : this.shut.has(c) ? c : -1;
    }
    for (let i = 0; i < this.n; i++) {
      const c = this.nodeCluster[i];
      this.nodeRep[i] = c >= 0 ? this.rep[c] : -1;
    }
  }

  /** Room each child takes in its parent: a folded cluster its disc, an open one its extent. */
  private rho(c: number): number {
    return this.folded.has(c) ? this.bubbleR(c) : this.effR[c];
  }

  private touch(c: number): void {
    if (c < 0) this.rootDirty = true;
    else this.dirty[c] = 1;
  }

  /** Anchors for the children of every cluster marked, bottom-up (children's sizes first); a
   *  cluster whose size changed marks its parent. `all`: every cluster. */
  private computeAnchors(all = false): void {
    for (let c = this.nc - 1; c >= 0; c--) {
      if (!all && !this.dirty[c]) continue;
      this.dirty[c] = 0;
      // the contents of a folded cluster keep their places; only its disc matters outside
      const was = this.effR[c];
      this.effR[c] = this.arrange(this.kidsC[c], this.kidsN[c], this.homeR[c], c);
      if (Math.abs(this.effR[c] - was) > 1e-3) this.touch(this.parent[c]);
    }
    if (all || this.rootDirty) {
      this.rootDirty = false;
      this.arrange(this.rootC, this.rootN, Infinity, -1);
    }
  }

  /** Lay out one cluster's children; returns the radius the cluster needs. Room held in it
   *  (setHeld) is made after the board's own arrangement, so that it moves only what it covers. */
  private arrange(kc: number[], kn: number[], homeR: number, self: number): number {
    const R = this.arrangeBoard(kc, kn, homeR, self);
    const held = this.held.get(self);
    return held?.length ? this.makeWay(kc, kn, homeR, self, held, R) : R;
  }

  /** The board's own arrangement of one cluster's children; returns the radius the cluster needs. */
  private arrangeBoard(kc: number[], kn: number[], homeR: number, self: number): number {
    // Nothing changed size and nothing is pinned: the server's layout as it is.
    const shrunk = kc.some((c) => this.rho(c) < this.homeR[c] - 0.5);
    const grown = kc.some((c) => this.rho(c) > this.homeR[c] + 0.5);
    const pinned = kc.some((c) => this.pinC.has(c)) || kn.some((i) => this.pinN.has(i));
    if (!shrunk && !grown && !pinned) {
      for (const c of kc) {
        this.ancCX[c] = this.homeCX[c];
        this.ancCY[c] = this.homeCY[c];
      }
      for (const i of kn) {
        this.ancNX[i] = this.homeNX[i];
        this.ancNY[i] = this.homeNY[i];
      }
      return homeR;
    }
    // compaction by area: every child keeps its direction from the origin and its rank in
    // distance; its new distance is where the room taken by everything nearer ends. The content
    // drains towards the centre evenly, as a liquid would, and a short relaxation separates what
    // still touches. (Sliding each one along its ray until contact left radial streaks.)
    // `seq` orders what holds its place: later drops above earlier ones, a cluster that only grew
    // below every drop
    interface Item { c: number; i: number; hx: number; hy: number; r: number; pinned: boolean; seq: number; x: number; y: number }
    const items: Item[] = [];
    for (const c of kc) {
      const pin = this.pinC.get(c);
      const hx = pin ? pin[0] : this.homeCX[c], hy = pin ? pin[1] : this.homeCY[c];
      // a cluster that grew because something was dropped far out inside it holds its place,
      // like a pin: what was dropped stays under the pointer and its siblings make way
      const holds = !!pin || this.rho(c) > this.homeR[c] + 0.5;
      items.push({ c, i: -1, hx, hy, r: this.rho(c), pinned: holds, seq: pin ? this.dropSeq.get(c) ?? 1 : 0, x: hx, y: hy });
    }
    for (const i of kn) {
      const pin = this.pinN.get(i);
      const hx = pin ? pin[0] : this.homeNX[i], hy = pin ? pin[1] : this.homeNY[i];
      items.push({ c: -1, i, hx, hy, r: LEAF_R, pinned: !!pin, seq: pin ? this.dropSeq.get(this.nc + i) ?? 1 : 0, x: hx, y: hy });
    }
    const DENSITY = 0.72;
    let area = 0;
    for (const it of (shrunk ? items : []).filter((x) => !x.pinned).sort((a, b) => a.hx * a.hx + a.hy * a.hy - (b.hx * b.hx + b.hy * b.hy))) {
      const len = Math.hypot(it.hx, it.hy);
      const ux = len > 1e-6 ? it.hx / len : 1, uy = len > 1e-6 ? it.hy / len : 0;
      area += (Math.PI * (it.r + GAP / 2) ** 2) / DENSITY;
      const d = Math.min(len, Math.max(0, Math.sqrt(area / Math.PI) - it.r));
      it.x = ux * d;
      it.y = uy * d;
    }
    // separate what overlaps
    const n = items.length;
    const B: Bodies = {
      n,
      x: Float64Array.from(items, (it) => it.x),
      y: Float64Array.from(items, (it) => it.y),
      r: Float64Array.from(items, (it) => it.r),
      pinned: Uint8Array.from(items, (it) => (it.pinned ? 1 : 0)),
      seq: Float64Array.from(items, (it) => it.seq),
      big: Int32Array.from(items.flatMap((it, k) => (it.r > LEAF_R + 0.1 ? [k] : []))),
      small: Int32Array.from(items.flatMap((it, k) => (it.r > LEAF_R + 0.1 ? [] : [k]))),
    };
    // How far out a child may be pushed. Folding alone never pushes anything outwards: each child
    // stays within its home distance, so the parent never grows because something inside it shrank.
    // A drop inside a cluster keeps what it pushes within the cluster's room as well.
    const inward = shrunk && !grown && !pinned;
    const room = self >= 0 ? homeR - this.padOf(self) : Infinity;
    const limit = Float64Array.from(items, (it) => {
      const len = Math.hypot(it.hx, it.hy);
      return inward ? len : Math.max(len, room - it.r);
    });
    const sep = this.separator;
    // drops can stack up against each other: give them more rounds
    const rounds = pinned ? 64 : 16;
    sep.separate(B, rounds, limit);
    if (sep.overlaps(B)) {
      if (inward) {
        // What still touches eases back towards the home layout, where nothing does (every child
        // is there at its home size or smaller).
        const fx = B.x.slice(), fy = B.y.slice();
        const at = (t: number) => {
          for (let k = 0; k < n; k++) {
            B.x[k] = fx[k] + (items[k].hx - fx[k]) * t;
            B.y[k] = fy[k] + (items[k].hy - fy[k]) * t;
          }
        };
        let lo = 0, hi = 1;
        for (let s = 0; s < 7; s++) {
          const mid = (lo + hi) / 2;
          at(mid);
          if (sep.overlaps(B)) lo = mid;
          else hi = mid;
        }
        at(hi);
      } else {
        // no room left inside: the circle grows rather than let two siblings overlap
        sep.separate(B, rounds, null);
      }
    }
    items.forEach((it, k) => {
      it.x = B.x[k];
      it.y = B.y[k];
    });
    let extent = 0;
    for (const it of items) {
      extent = Math.max(extent, Math.hypot(it.x, it.y) + it.r);
      if (it.c >= 0) {
        this.ancCX[it.c] = it.x;
        this.ancCY[it.c] = it.y;
      } else {
        this.ancNX[it.i] = it.x;
        this.ancNY[it.i] = it.y;
      }
    }
    if (self < 0) return 0;
    return Math.max(extent + this.padOf(self), this.bubbleR(self));
  }

  /** The room held in a cluster (setHeld), made in its children as they are arranged: each held
   *  disc stays where it was put, against the children (pins included: it is the latest drop) and
   *  the earlier held ones; what it covers makes way within the cluster's room, as from a drop, and
   *  only where that cannot fit does the circle grow. A disc put where the cluster has free room
   *  covers nothing and moves nothing. Returns the radius the cluster needs. */
  private makeWay(kc: number[], kn: number[], homeR: number, self: number, held: readonly Disc[], R: number): number {
    const nk = kc.length + kn.length;
    const n = nk + held.length;
    const x = new Float64Array(n), y = new Float64Array(n), r = new Float64Array(n);
    const pinned = new Uint8Array(n), seq = new Float64Array(n);
    let k = 0;
    for (const c of kc) {
      [x[k], y[k], r[k]] = [this.ancCX[c], this.ancCY[c], this.rho(c)];
      pinned[k] = this.pinC.has(c) || this.rho(c) > this.homeR[c] + 0.5 ? 1 : 0;
      seq[k++] = this.dropSeq.get(c) ?? 0;
    }
    for (const i of kn) {
      [x[k], y[k], r[k]] = [this.ancNX[i], this.ancNY[i], LEAF_R];
      pinned[k] = this.pinN.has(i) ? 1 : 0;
      seq[k++] = this.dropSeq.get(this.nc + i) ?? 0;
    }
    // later than every drop there can be
    held.forEach((d, j) => {
      [x[k], y[k], r[k]] = [d.x, d.y, d.r];
      pinned[k] = 1;
      seq[k++] = 1e12 + j;
    });
    const idx = Array.from({ length: n }, (_, j) => j);
    const B: Bodies = { n, x, y, r, pinned, seq, big: Int32Array.from(idx.filter((j) => r[j] > LEAF_R + 0.1)), small: Int32Array.from(idx.filter((j) => r[j] <= LEAF_R + 0.1)) };
    const room = self >= 0 ? homeR - this.padOf(self) : Infinity;
    const limit = Float64Array.from(idx, (j) => Math.max(Math.hypot(x[j], y[j]), room - r[j]));
    // how far the children reach before they make way: the circle grows by what they are pushed out
    let reach = 0;
    for (let j = 0; j < nk; j++) reach = Math.max(reach, Math.hypot(x[j], y[j]) + r[j]);
    // only what a held disc covers makes way: overlaps the board's own arrangement has are its own
    // (a layout may hold some), and stay as they are where the held discs cover nothing
    let covers = false;
    for (let h = nk; h < n && !covers; h++)
      for (let j = 0; j < n && !covers; j++) if (j !== h && Math.hypot(x[j] - x[h], y[j] - y[h]) < r[j] + r[h] - 0.5) covers = true;
    const sep = this.separator;
    if (covers) {
      sep.separate(B, 64, limit);
      // no room left inside: the circle grows rather than let two overlap
      if (sep.overlaps(B)) sep.separate(B, 64, null);
    }
    k = 0;
    for (const c of kc) {
      this.ancCX[c] = x[k];
      this.ancCY[c] = y[k++];
    }
    for (const i of kn) {
      this.ancNX[i] = x[k];
      this.ancNY[i] = y[k++];
    }
    const at = new Float64Array(2 * held.length);
    for (let j = 0; j < held.length; j++) [at[2 * j], at[2 * j + 1]] = [x[nk + j], y[nk + j]];
    this.heldAt.set(self, at);
    if (self < 0) return 0;
    let pushed = 0, own = 0;
    for (let j = 0; j < n; j++) {
      const d = Math.hypot(x[j], y[j]) + r[j];
      if (j < nk) pushed = Math.max(pushed, d);
      else own = Math.max(own, d);
    }
    return Math.max(R, R + pushed - reach, own + this.padOf(self), this.bubbleR(self));
  }

  // ---------------------------------------------------------------- easing and world positions

  /** Jump to the anchors, for a scene that just appeared. */
  snap(): void {
    this.curCX.set(this.ancCX);
    this.curCY.set(this.ancCY);
    this.curNX.set(this.ancNX);
    this.curNY.set(this.ancNY);
    for (let c = 0; c < this.nc; c++) this.curR[c] = this.shut.has(c) ? this.bubbleR(c) : this.effR[c];
    this.bloom.set(this.bloomTo);
    this.moving = false;
    this.computeWorld();
  }

  /** Advance folding, disc radii and motion by dt ms; returns true while anything still moves. */
  step(dt: number): boolean {
    const a = 1 - Math.exp(-dt / TAU);
    let max = 0;
    let committed = false;
    for (let c = 0; c < this.nc; c++) {
      const targetR = this.folded.has(c) ? this.bubbleR(c) : this.effR[c];
      const dr = targetR - this.curR[c];
      this.curR[c] += dr * a;
      if (Math.abs(dr) > max) max = Math.abs(dr);
      const db = this.bloomTo[c] - this.bloom[c];
      this.bloom[c] += db * a * 1.4;
      if (Math.abs(db) > 0.004) max = Math.max(max, 1);
      // gathered enough: from now on it is one disc
      if (this.bloomTo[c] === 0 && this.bloom[c] < 0.03 && !this.shut.has(c)) {
        this.bloom[c] = 0;
        this.shut.add(c);
        committed = true;
      }
    }
    if (committed) {
      this.computeRep();
      // what just went out of sight rests at its anchor, ready to bloom out again
      for (let i = 0; i < this.n; i++) {
        if (this.nodeRep[i] < 0) continue;
        this.curNX[i] = this.ancNX[i];
        this.curNY[i] = this.ancNY[i];
      }
    }
    if (this.motion) {
      this.motion.step(dt);
    } else {
      // no motion attached (tests): ease straight to the anchors
      for (let c = 0; c < this.nc; c++) {
        this.curCX[c] += (this.ancCX[c] - this.curCX[c]) * a;
        this.curCY[c] += (this.ancCY[c] - this.curCY[c]) * a;
        max = Math.max(max, Math.abs(this.ancCX[c] - this.curCX[c]), Math.abs(this.ancCY[c] - this.curCY[c]));
      }
      for (let i = 0; i < this.n; i++) {
        this.curNX[i] += (this.ancNX[i] - this.curNX[i]) * a;
        this.curNY[i] += (this.ancNY[i] - this.curNY[i]) * a;
        max = Math.max(max, Math.abs(this.ancNX[i] - this.curNX[i]), Math.abs(this.ancNY[i] - this.curNY[i]));
      }
    }
    this.computeWorld();
    this.moving = max > 0.05 || (this.motion?.moving ?? false);
    if (!this.moving && !this.motion) this.snap();
    return this.moving;
  }

  computeWorld(): void {
    for (let c = 0; c < this.nc; c++) {
      const p = this.parent[c];
      if (p >= 0) {
        const s = this.scale[p];
        this.cwx[c] = this.cwx[p] + this.curCX[c] * s;
        this.cwy[c] = this.cwy[p] + this.curCY[c] * s;
        this.scale[c] = s * this.bloom[c];
      } else {
        this.cwx[c] = this.curCX[c];
        this.cwy[c] = this.curCY[c];
        this.scale[c] = this.bloom[c];
      }
    }
    for (let i = 0; i < this.n; i++) {
      const c = this.nodeCluster[i];
      if (c >= 0) {
        const s = this.scale[c];
        this.nwx[i] = this.cwx[c] + this.curNX[i] * s;
        this.nwy[i] = this.cwy[c] + this.curNY[i] * s;
      } else {
        this.nwx[i] = this.curNX[i];
        this.nwy[i] = this.curNY[i];
      }
    }
    this.computeExtents();
  }

  /** Every open cluster's circle encloses what it holds, as drawn now: bottom-up, children's
   *  circles first. A shut cluster is its bubble. */
  private computeExtents(): void {
    const MARGIN = 6;
    for (let c = this.nc - 1; c >= 0; c--) {
      if (this.rep[c] === c) {
        this.drawnR[c] = this.curR[c];
        continue;
      }
      if (this.rep[c] >= 0) continue;
      let reach = 0;
      const x = this.cwx[c], y = this.cwy[c];
      for (const k of this.kidsC[c]) reach = Math.max(reach, Math.hypot(this.cwx[k] - x, this.cwy[k] - y) + this.drawnR[k]);
      for (const i of this.kidsN[c]) {
        if (this.nodeRep[i] >= 0) continue;
        reach = Math.max(reach, Math.hypot(this.nwx[i] - x, this.nwy[i] - y) + LEAF_R);
      }
      // what is held in it is inside it too: a visitor's temporary clusters (setHeld)
      const held = this.held.get(c), at = this.heldAt.get(c);
      if (held && at) for (let j = 0; j < held.length; j++) reach = Math.max(reach, (Math.hypot(at[2 * j], at[2 * j + 1]) + held[j].r) * this.scale[c]);
      this.drawnR[c] = Math.max(this.curR[c], reach > 0 ? reach + MARGIN : 0);
    }
  }

  /** The world scale a cluster's contents are drawn at (below 1 while it gathers or blooms). */
  scaleOf(c: number): number {
    return this.scale[c];
  }
}
