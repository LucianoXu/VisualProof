// Graphs to lay out in the layout's tests: the flt-regular showcase's three builds, read from its
// history (showcase/flt-regular/site, as the Time Machine reads a past build), and a project with a
// folder of hundreds of files, whose settling and separating go through the grids
// (shared/separate.ts).

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { History } from "../src/server/history.ts";
import type { LayoutNode } from "../src/server/layoutthread.ts";

export interface LayoutGraph {
  name: string;
  nodes: LayoutNode[];
  edges: Int32Array;
}

export const SHOWCASE_SITE = fileURLToPath(new URL("../showcase/flt-regular/site", import.meta.url));

/** The showcase's builds, oldest first. */
export function showcaseGraphs(): LayoutGraph[] {
  const h = new History(SHOWCASE_SITE);
  return h.list().map((s) => {
    const g = h.graph(s.id)!;
    return {
      name: `flt-regular build ${s.id}`,
      nodes: g.nodes.map((n) => (n.ext ? { name: n.name, module: n.module, ext: true as const } : { name: n.name, module: n.module })),
      edges: Int32Array.from(g.edges.flat()),
    };
  });
}

/** A project of `files` files in one folder, each of one to a dozen declarations in a namespace of
 *  its own, a few at the folder's own module, resting on each other along the files and on a few
 *  outside declarations; `drop` leaves every `drop`-th declaration out (0: none). */
export function folderGraph(files: number, drop = 0): LayoutGraph {
  const nodes: LayoutNode[] = [];
  const edges: number[] = [];
  let seed = 4242;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const ids: number[] = [];
  let k = 0;
  const add = (name: string, module: string) => {
    k++;
    if (drop && k % drop === 0) return -1;
    return nodes.push({ name, module }) - 1;
  };
  for (let i = 0; i < 40; i++) ids.push(add(`P.root${i}`, "P"));
  for (let f = 0; f < files; f++) {
    const each = 1 + Math.floor(rnd() ** 2 * 12);
    for (let d = 0; d < each; d++) ids.push(add(`P.F${f}.d${d}`, `P.F${f}`));
  }
  const ext = nodes.length;
  for (let i = 0; i < 30; i++) nodes.push({ name: `Mathlib.X${i % 6}.y${i}`, module: `Mathlib.X${i % 6}`, ext: true });
  const live = ids.filter((i) => i >= 0);
  for (let j = 1; j < live.length; j++) {
    edges.push(live[j], live[Math.floor(rnd() * j)], 1);
    if (rnd() < 0.5) edges.push(live[j], live[Math.max(0, j - 1 - Math.floor(rnd() * 30))], 2);
    if (rnd() < 0.3) edges.push(live[j], ext + Math.floor(rnd() * 30), 1);
  }
  return { name: `a folder of ${files} files${drop ? `, every ${drop}th declaration left out` : ""}`, nodes, edges: Int32Array.from(edges) };
}

/** A short digest of a value's JSON: two layouts with the same digest are the same to the last bit. */
export const digest = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
