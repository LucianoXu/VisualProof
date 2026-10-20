// The graph's layouts off the server's thread (server/layoutthread.ts): the same layout as laid out
// here, while the thread goes on with everything else.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayoutNode } from "../src/server/layoutthread.ts";
import { layOutHere, layOutOffThread } from "../src/server/layoutthread.ts";
import { memoryOf } from "../src/shared/layout.ts";
import type { ViewNode } from "../src/shared/graph.ts";

/** A graph of namespaces, each a chain of declarations, each also resting on one of the namespace
 *  after; and outside declarations they use. Large enough to take a while to lay out. */
function graph(spaces: number, each: number): { nodes: LayoutNode[]; edges: Int32Array } {
  const nodes: LayoutNode[] = [];
  const edges: number[] = [];
  for (let s = 0; s < spaces; s++) {
    for (let i = 0; i < each; i++) {
      const k = nodes.push({ name: `P.N${s}.Sub${i % 7}.d${i}`, module: `P.N${s}.M${i % 5}` }) - 1;
      if (i > 0) edges.push(k, k - 1, 1);
      if (s + 1 < spaces) edges.push(k, (s + 1) * each + ((i * 7) % each), 1);
    }
  }
  const ext = nodes.length;
  for (let i = 0; i < 50; i++) nodes.push({ name: `Mathlib.X${i}.y`, module: `Mathlib.X${i}`, ext: true });
  for (let k = 0; k < ext; k += 3) edges.push(k, ext + (k % 50), 1);
  return { nodes, edges: Int32Array.from(edges) };
}

test("a layout off the thread is the layout laid out here, and the thread goes on meanwhile", async () => {
  const { nodes, edges } = graph(40, 120);
  for (const mode of ["namespace", "module"] as const) {
    const here = layOutHere(mode, nodes, edges, null);
    let ticks = 0;
    const tick = setInterval(() => ticks++, 5);
    const t0 = performance.now();
    const off = await layOutOffThread(mode, nodes, edges, null);
    const ms = performance.now() - t0;
    clearInterval(tick);
    assert.deepEqual(off, here, mode);
    // laid out here, the interval could not have run until the end: a few ticks at most. Off the
    // thread it runs, though a loaded machine (CI's macOS) gives it fewer than one tick in 5 ms
    assert.ok(ticks >= Math.min(10, (ms / 5) * 0.15), `${mode}: ${ticks} ticks in ${Math.round(ms)} ms`);
  }
});

test("a layout off the thread is stabilized against the memory it is given", async () => {
  const before = graph(10, 40);
  const after = graph(10, 41);
  const mem = memoryOf(layOutHere("namespace", before.nodes, before.edges, null), before.nodes as ViewNode[]);
  assert.deepEqual(await layOutOffThread("namespace", after.nodes, after.edges, mem), layOutHere("namespace", after.nodes, after.edges, mem));
});
