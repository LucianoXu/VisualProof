// The graph's layouts, off the server's thread: computeLayout then stabilize, for each clustering in
// a worker of its own, both at once. Laid out on the server's thread, Sphere-Packing-Lean's graph held
// every request for seconds (2.5 s a clustering, more against a memory far off); a worker holds
// none. A worker is given what a layout reads of each declaration, the edges and the memory, as
// the page's own (web/src/layoutworker.ts), and gives the layout back. This module is its own
// worker, so that a checkout (TypeScript) and the package (JavaScript) find it alike.

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import type { ClusterMode, Layout, ViewNode } from "../shared/graph.ts";
import { computeLayout, stabilize } from "../shared/layout.ts";
import type { LayoutMemory } from "../shared/layout.ts";

/** What a layout reads of a declaration. */
export type LayoutNode = Pick<ViewNode, "name" | "module" | "ext">;

interface Ask {
  vpLayout: true;
  mode: ClusterMode;
  nodes: LayoutNode[];
  edges: Int32Array;
  memory: LayoutMemory | null;
}

/** A clustering's layout, here: computeLayout, then stabilize against the memory. */
export function layOutHere(mode: ClusterMode, nodes: LayoutNode[], edges: Int32Array, memory: LayoutMemory | null): Layout {
  const all = nodes as ViewNode[];
  return stabilize(computeLayout(mode, all, edges), all, memory);
}

/** A clustering's layout, in a worker. Should no worker start, or one fail, it is laid out here:
 *  slower to answer others meanwhile, never wrong. */
export function layOutOffThread(mode: ClusterMode, nodes: LayoutNode[], edges: Int32Array, memory: LayoutMemory | null): Promise<Layout> {
  const ask: Ask = { vpLayout: true, mode, nodes: nodes.map(({ name, module, ext }) => (ext ? { name, module, ext } : { name, module })), edges, memory };
  return new Promise<Layout>((ok) => {
    let done = false;
    const here = () => {
      if (done) return;
      done = true;
      ok(layOutHere(mode, nodes, edges, memory));
    };
    let worker: Worker;
    try {
      worker = new Worker(new URL(import.meta.url), { workerData: ask });
    } catch {
      return here();
    }
    worker.once("message", (layout: Layout) => {
      if (done) return;
      done = true;
      ok(layout);
      void worker.terminate();
    });
    worker.once("error", here);
    worker.once("exit", (code) => {
      if (code !== 0) here();
    });
  });
}

// in a worker: the one layout asked, and back
if (!isMainThread && (workerData as Ask | null)?.vpLayout) {
  const a = workerData as Ask;
  parentPort!.postMessage(layOutHere(a.mode, a.nodes, a.edges, a.memory));
}
