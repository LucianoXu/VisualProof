// The overview's choosing, off the page's thread (CanvasSpec.md, "Edges"; the owner's request,
// 2026-10-10): aggregating a zoom step, choosing a point's edges for a camera and their looks took
// up to 60 ms inside a frame. The page sends the graph's edges once, the scene's tree whenever it
// changes, and each zoom point it wants with the positions it is asked at (web/src/edgequeue.ts);
// the worker answers each with the point's looks (web/src/overview.ts). Bundled beside the page as
// /edges.js (server/pipeline.ts).
//
// Questions are answered one at a time, the page's needs before what it asks ahead. Between two, the
// worker lets the page's newer messages in, so that a question no longer wanted — its point no
// longer near the camera, the same point asked again since, or another tree — is dropped unanswered
// rather than worked on.

import { OverviewModel, looksBuffers } from "./overview.ts";
import type { FromWorker, ToWorker } from "./overview.ts";

type Choose = Extract<ToWorker, { type: "choose" }>;

/** The worker's state and its answers, apart from the messaging, so that the tests can drive it. */
export class EdgeWorkerCore {
  readonly model = new OverviewModel();
  private base = -1;
  private lo = -Infinity;
  private hi = Infinity;
  private queue: Choose[] = [];

  /** Take one message in; `choose` waits in the queue for `next`. */
  receive(m: ToWorker, post: (a: FromWorker) => void): void {
    switch (m.type) {
      case "graph":
        this.model.setGraph({ n: m.n, projectCount: m.projectCount, outStart: m.outStart, outDst: m.outDst, outSite: m.outSite });
        break;
      case "tree":
        this.base = m.base;
        this.model.setTree(
          { nc: m.nc, n: m.n, parent: m.parent, nodeCluster: m.nodeCluster, rep: m.rep },
          { externals: m.externals },
        );
        this.prune(post);
        break;
      case "near":
        if (m.base === this.base) {
          this.lo = m.lo;
          this.hi = m.hi;
        }
        this.prune(post);
        break;
      case "choose":
        this.queue.push(m);
        break;
    }
  }

  /** Whether a question waits. */
  get waiting(): number {
    return this.queue.length;
  }

  /** Drop what is no longer wanted: another tree's questions, points outside the window, and a point
   *  asked again since (the later question wins). */
  private prune(post: (a: FromWorker) => void): void {
    const keep: Choose[] = [];
    for (let k = 0; k < this.queue.length; k++) {
      const q = this.queue[k];
      const later = this.queue.some((r, j) => j > k && r.point === q.point && r.base === q.base);
      if (q.base !== this.base || q.point < this.lo || q.point > this.hi || later) post({ type: "dropped", id: q.id });
      else keep.push(q);
    }
    this.queue = keep;
  }

  /** Answer the next question: what the camera needs before what is asked ahead, the first asked
   *  among equals. */
  next(post: (a: FromWorker, transfer?: ArrayBuffer[]) => void): void {
    this.prune(post);
    if (!this.queue.length) return;
    let k = 0;
    for (let j = 1; j < this.queue.length; j++) if (this.queue[j].pri < this.queue[k].pri) k = j;
    const [q] = this.queue.splice(k, 1);
    const t0 = performance.now();
    try {
      const looks = this.model.choose(q, q.places);
      post({ type: "looks", id: q.id, point: q.point, looks, ms: performance.now() - t0 }, looksBuffers(looks));
    } catch (err) {
      post({ type: "error", id: q.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

// in a worker: messages in, and one question answered per turn, the page's newer messages let in
// between two
interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  document?: unknown;
}
const scope = globalThis as unknown as WorkerScope;
if (typeof scope.document === "undefined" && typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined") {
  const core = new EdgeWorkerCore();
  const post = (a: FromWorker, transfer?: ArrayBuffer[]) => scope.postMessage(a, transfer ?? []);
  // a turn of its own after the messages already here: a MessageChannel's, which no timer clamps
  const turn = new MessageChannel();
  let scheduled = false;
  turn.port1.onmessage = () => {
    scheduled = false;
    core.next(post);
    if (core.waiting) schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    turn.port2.postMessage(0);
  };
  scope.onmessage = (e) => {
    core.receive(e.data, post);
    if (core.waiting) schedule();
  };
}
