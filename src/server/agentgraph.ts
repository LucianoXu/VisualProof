// The graph on show as the agents' API reads it (server/agent.ts and the modules of its endpoints):
// its declarations and their search index, each module's file and imports, and what the API works
// out of it and keeps — the Project's layout by its hidden levels, TCBs, review orders.

import { gunzipSync } from "node:zlib";
import type { ClusterMode, Layout, ViewMeta } from "../shared/graph.ts";
import type { ReviewData } from "../shared/review.ts";
import { inTargets, reviewQueue, TCB_SITES } from "../shared/reviewqueue.ts";
import type { Queue } from "../shared/reviewqueue.ts";
import { SearchIndex } from "../shared/search.ts";
import { Graph } from "../shared/viewgraph.ts";
import { layoutKey, wholeLayout } from "../shared/board.ts";

/** The graph on show, as the API reads it: built from the server's prepared view once per
 *  version. The page's review route reads it too (server/reviewapi.ts). */
export class View {
  readonly version: number;
  readonly meta: ViewMeta;
  readonly g: Graph;
  readonly index: SearchIndex;
  /** each module's source file (relative to the project), the hash of the text it was compiled
   *  from, and what it imports */
  readonly modules = new Map<string, { file: string | null; compiled: string | null; imports: string[] }>();
  /** per module of the outside world, the project's modules that import it directly, those with
   *  the fewest imports first: where Lean is asked about an outside name (leanTarget) */
  private importers: Map<string, string[]> | null = null;
  /** the project's root module, which imports all of it: where Lean is asked about a name that is
   *  not under any declaration of the graph */
  readonly root: string | null;
  /** per way of clustering and levels hidden, the Project's layout and what each of its clusters
   *  holds directly (-1: the top), for laying out */
  private projects = new Map<string, { L: Layout; children: Map<number, { nodes: number[]; clusters: number[] }> }>();
  private tcbs = new Map<number, Uint8Array>();
  private orders = new Map<number, Queue>();
  private orderKey = "";
  private shared: Uint16Array | null = null;

  constructor(version: number, metaGz: Buffer, edgesGz: Buffer) {
    this.version = version;
    this.meta = JSON.parse(gunzipSync(metaGz).toString("utf8"));
    const raw = gunzipSync(edgesGz);
    this.g = new Graph(this.meta, new Int32Array(new Uint8Array(raw).buffer));
    this.index = new SearchIndex(this.meta.nodes, this.meta.projectCount);
    for (const m of this.meta.modules) {
      this.modules.set(m.name, { file: m.file, compiled: m.compiled ?? null, imports: m.imports });
    }
    this.root = this.meta.project.roots.find((r) => this.modules.has(r)) ?? null;
  }

  /** A module of the project's graph where declaration `i` of the outside world is known, and
   *  why that one: one that imports its module directly (the fewest imports first), else that of a
   *  declaration of the project that refers to it, else the root module, which imports everything
   *  the project does. Lean is only ever asked where a module of the graph is imported. */
  homeOf(i: number): { module: string; why: string } | null {
    const n = this.g.nodes[i];
    if (!this.importers) {
      this.importers = new Map();
      for (const [name, m] of [...this.modules].sort((a, b) => a[1].imports.length - b[1].imports.length))
        for (const imp of m.imports) if (!this.modules.has(imp)) this.importers.set(imp, [...(this.importers.get(imp) ?? []), name]);
    }
    const direct = this.importers.get(n.module)?.[0];
    if (direct) return { module: direct, why: `${direct}, a module of the project that imports ${n.module}, where ${n.name} is declared` };
    for (let e = this.g.inStart[i]; e < this.g.inStart[i + 1]; e++) {
      const u = this.g.inSrc[e];
      if (!this.g.isExt(u)) return { module: this.g.nodes[u].module, why: `that of ${this.g.nodes[u].name}, a declaration of the project that refers to ${n.name}` };
    }
    return this.root ? { module: this.root, why: "the project's root module, which imports all of it" } : null;
  }

  /** The Project view's layout by `mode` with the levels `hidden` hidden (ViewSpec decision 24): the
   *  server's, their circles taken out, as the pages show it. */
  projectLayout(mode: ClusterMode, hidden: readonly string[]): Layout {
    return this.project(mode, hidden).L;
  }

  /** What a cluster of the Project's layout (projectLayout) holds directly, its declarations and
   *  its clusters (-1: the top). */
  inside(mode: ClusterMode, hidden: readonly string[], c: number): { nodes: number[]; clusters: number[] } {
    return this.project(mode, hidden).children.get(c) ?? { nodes: [], clusters: [] };
  }

  private project(mode: ClusterMode, hidden: readonly string[]): { L: Layout; children: Map<number, { nodes: number[]; clusters: number[] }> } {
    const key = `${mode}\u0000${layoutKey("", hidden)}`;
    let p = this.projects.get(key);
    if (!p) {
      const L = wholeLayout(this.meta.layouts[mode], this.g.nodes, mode, hidden);
      const m = new Map<number, { nodes: number[]; clusters: number[] }>();
      const at = (k: number) => {
        let x = m.get(k);
        if (!x) m.set(k, (x = { nodes: [], clusters: [] }));
        return x;
      };
      L.cluster.forEach((k, i) => at(k).nodes.push(i));
      L.clusters.forEach((cl, k) => at(cl.parent).clusters.push(k));
      // the levels change seldom: the last few are enough
      if (this.projects.size >= 8) this.projects.clear();
      this.projects.set(key, (p = { L, children: m }));
    }
    return p;
  }

  /** A declaration's TCB (statement and body references, itself included). */
  tcb(i: number): Uint8Array {
    let t = this.tcbs.get(i);
    if (!t) {
      t = this.g.reach([i], TCB_SITES, "out");
      if (this.tcbs.size > 64) this.tcbs.clear();
      this.tcbs.set(i, t);
    }
    return t;
  }

  /** `root`'s review in review order, the page's (shared/reviewqueue.ts): its review set
   *  holds, and the axioms beside it. Worked out again only when the targets or the trusted
   *  prefixes change, as on the page. */
  order(root: number, d: ReviewData): Queue {
    const g = this.g;
    const key = Object.keys(d.targets).sort().join("\n") + "\n\n" + d.trusted.join("\n");
    if (key !== this.orderKey) {
      this.orders.clear();
      this.shared = null;
      this.orderKey = key;
    }
    let o = this.orders.get(root);
    if (!o) {
      const targets = Object.keys(d.targets).map((n) => g.byName.get(n)).filter((i): i is number => i !== undefined);
      this.shared ??= inTargets(g, targets);
      o = reviewQueue(g, d, root, this.shared);
      this.orders.set(root, o);
    }
    return o;
  }
}
