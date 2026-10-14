// The Time Machine's layouts, off the page's thread (HistorySpec, "The Time Machine"): a past graph is
// laid out as a board is — computeLayout, then stabilize with the view's memory, or the latest
// build's layout — and a large project's whole graph takes long to lay out by namespace
// (Sphere-Packing-Lean's: about 1.5 s on the server), which would hold the page still at every
// step on the timeline. The page sends what a layout reads of each declaration, the edges, the
// levels hidden and the memory; it gets the layout back. Bundled beside the page (server/pipeline.ts).

import type { ClusterMode, ViewNode } from "../../shared/graph.ts";
import { computeLayout, stabilize } from "../../shared/layout.ts";
import type { LayoutMemory } from "../../shared/layout.ts";

export interface LayoutAsk {
  id: number;
  mode: ClusterMode;
  nodes: Pick<ViewNode, "name" | "module" | "ext">[];
  edges: Int32Array;
  hidden: string[];
  mem: LayoutMemory | null;
}

/** One past board's layout, as the page lays one out on its own thread where there is no worker. */
export function layOut(a: Omit<LayoutAsk, "id">) {
  const nodes = a.nodes as ViewNode[];
  return stabilize(computeLayout(a.mode, nodes, a.edges, a.hidden), nodes, a.mem);
}

// in a worker: each request answered in turn
const scope = globalThis as unknown as { onmessage: ((e: MessageEvent<LayoutAsk>) => void) | null; postMessage(m: unknown): void; document?: unknown };
if (typeof scope.document === "undefined" && typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined") {
  scope.onmessage = (e) => {
    const { id, ...ask } = e.data;
    try {
      scope.postMessage({ id, layout: layOut(ask) });
    } catch (err) {
      scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
