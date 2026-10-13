// The overview's zoom points, asked of a worker (web/src/edgeworker.ts) and kept as they come back
// (CanvasSpec.md, "Edges"; the owner's request, 2026-10-10). The page asks for the points the camera
// needs and one ahead in the direction it zooms; a few questions at most are out at once, and the
// latest wins: an answer older than the point already held is dropped, and so is one whose point is
// no longer near the camera when it comes, or that was chosen for a tree since replaced. Where no
// worker can be had (no `Worker`, its file not served, the tests), the points are chosen on the page's
// thread at once, as they used to be.

import { OverviewModel, indexLooks } from "./overview.ts";
import type { FromWorker, OverviewGraph, Places, PointAsk, PointLooks, Toggles, ToWorker, Tree } from "./overview.ts";

/** What the queue needs of a worker (web/src/edgeworker.ts; a fake one in the tests). */
export interface EdgeWorker {
  postMessage(m: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: Event) => void) | null;
}

/** A question: a zoom point for a camera, under the selection's style it was asked in (`style`, the
 *  page's count), 0 for a point the camera needs and 1 for one asked ahead. */
export type Ask = PointAsk & { style: number; pri: number };

/** A zoom point chosen: its looks, and what it was chosen for. `serial` tells one choice from the
 *  next; `id` orders questions, the later winning. */
export interface ReadyPoint {
  point: number;
  looks: PointLooks;
  /** the looks by edge key, made when first blended */
  index: Map<number, number> | null;
  x: number;
  y: number;
  dim: boolean;
  style: number;
  id: number;
  serial: number;
}

interface Pending {
  id: number;
  base: number;
  ask: Ask;
  /** when it was asked, ms */
  at: number;
}

/** At most this many questions are out at once: one being answered, one waiting behind it. */
export const IN_FLIGHT = 2;

export class EdgeQueue {
  /** the points held, by zoom-point index, all chosen for the tree now (`base`) */
  readonly points = new Map<number, ReadyPoint>();
  private pending = new Map<number, Pending>();
  private worker: EdgeWorker | null = null;
  /** no worker: the page chooses itself, at once */
  private local: OverviewModel | null = null;
  private spawn: () => EdgeWorker | null;
  private onReady: () => void;
  private graph: OverviewGraph | null = null;
  private tree: Tree | null = null;
  private toggles: Toggles = { externals: true, proofs: false };
  private base = 0;
  private lo = -Infinity;
  private hi = Infinity;
  private next = 1;
  private serial = 0;
  /** answers dropped (stale, superseded, another tree's) and answers kept, and how long the worker
   *  took for the last one, ms */
  dropped = 0;
  answered = 0;
  lastMs = 0;
  /** how long an answer takes to come, waiting included, ms (smoothed): how far ahead a fast zoom
   *  is asked for */
  wait = 50;

  /** `spawn`: a worker, or null where none can be had; `onReady`: something came back (a point, or a
   *  question let go), so the page draws again and asks for what still waits. */
  constructor(spawn: () => EdgeWorker | null, onReady: () => void) {
    this.spawn = spawn;
    this.onReady = onReady;
  }

  /** Whether the points are chosen on the page's thread (no worker). */
  get onPageThread(): boolean {
    if (!this.worker && !this.local) this.start();
    return this.local !== null;
  }

  /** How many questions are out. */
  get inFlight(): number {
    return this.pending.size;
  }

  /** A new graph: its edges go to the worker (a copy: the page keeps its own). */
  setGraph(g: OverviewGraph): void {
    this.graph = g;
    if (this.onPageThread) this.local!.setGraph(g);
    else this.send({ type: "graph", n: g.n, projectCount: g.projectCount, outStart: g.outStart, outDst: g.outDst, outSite: g.outSite });
  }

  /** A new tree (a layout, folds) or new toggles: every point held is let go, and answers to
   *  questions asked before are dropped when they come. On the page's thread the scene's own arrays
   *  are read; a worker is sent a copy. */
  setBase(tree: Tree, toggles: Toggles): void {
    this.base++;
    this.tree = tree;
    this.toggles = { ...toggles };
    this.points.clear();
    this.lo = -Infinity;
    this.hi = Infinity;
    if (this.onPageThread) this.local!.setTree(tree, toggles);
    else this.sendTree();
  }

  /** The zoom points still wanted, [lo, hi]: the worker drops questions for others, and an answer
   *  for another is dropped when it comes. */
  near(lo: number, hi: number): void {
    if (lo === this.lo && hi === this.hi) return;
    this.lo = lo;
    this.hi = hi;
    if (this.worker) this.send({ type: "near", base: this.base, lo, hi });
  }

  /** The latest question out for point `i` under the tree now, if any. */
  asked(i: number): Ask | undefined {
    let best: Pending | undefined;
    for (const p of this.pending.values()) if (p.base === this.base && p.ask.point === i && (!best || p.id > best.id)) best = p;
    return best?.ask;
  }

  /** Ask for a point, with the positions `places` gives (read at once on the page's thread, copied
   *  for a worker). False when IN_FLIGHT questions are already out: ask again when one comes back. */
  ask(a: Ask, places: () => Places): boolean {
    const id = this.next++;
    if (this.onPageThread) {
      this.keep(id, a, this.local!.choose(a, places()));
      return true;
    }
    if (this.pending.size >= IN_FLIGHT) return false;
    this.pending.set(id, { id, base: this.base, ask: a, at: performance.now() });
    const P = places();
    const copy: Places = { cwx: P.cwx.slice(), cwy: P.cwy.slice(), nwx: P.nwx.slice(), nwy: P.nwy.slice(), curR: P.curR.slice(), drawnR: P.drawnR.slice() };
    const { style: _style, ...ask } = a;
    this.send({ type: "choose", id, base: this.base, places: copy, ...ask }, Object.values(copy).map((x) => x.buffer as ArrayBuffer));
    return true;
  }

  /** Let go of the points `keep` does not want. */
  evict(keep: (i: number) => boolean): void {
    for (const i of [...this.points.keys()]) if (!keep(i)) this.points.delete(i);
  }

  /** A point's looks by edge key. */
  indexOf(p: ReadyPoint): Map<number, number> {
    return (p.index ??= indexLooks(p.looks));
  }

  private keep(id: number, a: Ask, looks: PointLooks): void {
    this.answered++;
    this.points.set(a.point, { point: a.point, looks, index: null, x: a.x, y: a.y, dim: a.dim, style: a.style, id, serial: ++this.serial });
  }

  private start(): void {
    let w: EdgeWorker | null = null;
    try {
      w = this.spawn();
    } catch {
      w = null;
    }
    if (!w) {
      this.toPageThread();
      return;
    }
    this.worker = w;
    w.onmessage = (e) => {
      if (this.worker === w) this.answer(e.data);
    };
    // a worker that cannot run (its file not served): the page chooses itself, from now on
    w.onerror = () => {
      if (this.worker !== w) return;
      this.fail();
      this.onReady();
    };
  }

  /** The worker is given up: the page chooses itself from now on, and what was out is asked again,
   *  on the page's thread, at the next frame. */
  private fail(): void {
    this.worker?.terminate();
    this.worker = null;
    this.toPageThread();
    this.pending.clear();
  }

  private toPageThread(): void {
    this.local = new OverviewModel();
    if (this.graph) this.local.setGraph(this.graph);
    if (this.tree) this.local.setTree(this.tree, this.toggles);
  }

  private answer(m: FromWorker): void {
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.type === "looks") {
      this.lastMs = m.ms;
      this.wait = 0.7 * this.wait + 0.3 * (performance.now() - p.at);
      const held = this.points.get(p.ask.point);
      // another tree's, no longer near the camera, or older than what is held: the latest wins
      if (p.base !== this.base || p.ask.point < this.lo || p.ask.point > this.hi || (held && held.id > m.id)) this.dropped++;
      else this.keep(m.id, p.ask, m.looks);
    } else if (m.type === "dropped") this.dropped++;
    else if (m.type === "error") {
      // the worker could not: the page chooses itself from now on, where what goes wrong shows
      console.warn(`the overview's worker could not choose a point: ${m.error}`);
      this.fail();
    }
    this.onReady();
  }

  private sendTree(): void {
    const T = this.tree!;
    this.send({
      type: "tree",
      base: this.base,
      nc: T.nc,
      n: T.n,
      parent: T.parent,
      nodeCluster: T.nodeCluster,
      rep: T.rep,
      externals: this.toggles.externals,
      proofs: this.toggles.proofs,
    });
  }

  private send(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker!.postMessage(m, transfer);
  }
}
