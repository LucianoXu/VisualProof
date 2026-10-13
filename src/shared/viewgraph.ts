// The graph as the page reads it: adjacency in both directions, and the closures the modes draw.
// The agent API (server/agent.ts) reads the same graph the same way, so it lives here.

import type { ViewMeta, ViewNode } from "./graph.ts";
import { SITE_BODY, SITE_GRAMMAR, SITE_PROOF, SITE_STMT } from "./graph.ts";

export type Mode = "plain" | "tcb" | "deps" | "apps";

export const ALL_SITES = SITE_STMT | SITE_BODY | SITE_PROOF | SITE_GRAMMAR;

/** Which edges each mode follows. TCB never passes through a proof: by proof irrelevance a
 *  reference inside one cannot change what the statement it supports means; nor through grammar
 *  (SITE_GRAMMAR): what a syntax tree means is the rule's that interprets it. */
export const MODE_SITES: Record<Mode, number> = {
  plain: ALL_SITES,
  tcb: SITE_STMT | SITE_BODY,
  deps: ALL_SITES,
  apps: ALL_SITES,
};

export class Graph {
  readonly meta: ViewMeta;
  readonly nodes: ViewNode[];
  readonly n: number;
  readonly projectCount: number;
  readonly outStart: Int32Array;
  readonly outDst: Int32Array;
  readonly outSite: Uint8Array;
  readonly inStart: Int32Array;
  readonly inSrc: Int32Array;
  readonly inSite: Uint8Array;
  readonly byName = new Map<string, number>();
  /** a declaration Lean generated from a command → the unit it is folded into (ViewNode.also) */
  readonly foldedInto = new Map<string, number>();

  constructor(meta: ViewMeta, edges: Int32Array) {
    this.meta = meta;
    this.nodes = meta.nodes;
    this.n = meta.nodes.length;
    this.projectCount = meta.projectCount;
    const m = edges.length / 3;
    const n = this.n;
    this.outStart = new Int32Array(n + 1);
    this.inStart = new Int32Array(n + 1);
    for (let e = 0; e < m; e++) {
      this.outStart[edges[3 * e] + 1]++;
      this.inStart[edges[3 * e + 1] + 1]++;
    }
    for (let i = 0; i < n; i++) {
      this.outStart[i + 1] += this.outStart[i];
      this.inStart[i + 1] += this.inStart[i];
    }
    this.outDst = new Int32Array(m);
    this.outSite = new Uint8Array(m);
    this.inSrc = new Int32Array(m);
    this.inSite = new Uint8Array(m);
    const oc = this.outStart.slice(0, n);
    const ic = this.inStart.slice(0, n);
    for (let e = 0; e < m; e++) {
      const s = edges[3 * e];
      const d = edges[3 * e + 1];
      const site = edges[3 * e + 2];
      this.outDst[oc[s]] = d;
      this.outSite[oc[s]++] = site;
      this.inSrc[ic[d]] = s;
      this.inSite[ic[d]++] = site;
    }
    meta.nodes.forEach((v, i) => {
      this.byName.set(v.name, i);
      for (const a of v.also ?? []) this.foldedInto.set(a, i);
      // a notation unit answers to its Lean constant too, as to what it folds
      if (v.leanName) this.foldedInto.set(v.leanName, i);
    });
  }

  isExt(i: number): boolean {
    return i >= this.projectCount;
  }

  /** Everything reachable from `from` (included) along edges whose sites meet `sites`. */
  reach(from: Iterable<number>, sites: number, dir: "out" | "in"): Uint8Array {
    const seen = new Uint8Array(this.n);
    const stack: number[] = [];
    for (const f of from) {
      if (!seen[f]) {
        seen[f] = 1;
        stack.push(f);
      }
    }
    const start = dir === "out" ? this.outStart : this.inStart;
    const adj = dir === "out" ? this.outDst : this.inSrc;
    const site = dir === "out" ? this.outSite : this.inSite;
    while (stack.length) {
      const u = stack.pop()!;
      for (let e = start[u]; e < start[u + 1]; e++) {
        if (!(site[e] & sites)) continue;
        const v = adj[e];
        if (!seen[v]) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
    return seen;
  }

  closure(mode: Mode, focus: number[]): Uint8Array {
    switch (mode) {
      case "plain": {
        const s = new Uint8Array(this.n);
        for (const f of focus) s[f] = 1;
        return s;
      }
      case "tcb":
        return this.reach(focus, MODE_SITES.tcb, "out");
      case "deps":
        return this.reach(focus, ALL_SITES, "out");
      case "apps":
        return this.reach(focus, ALL_SITES, "in");
    }
  }

  axiomsOf(i: number): string[] {
    const set = this.meta.axiomSets[this.nodes[i].ax] ?? [];
    return set.map((k) => this.meta.axioms[k]);
  }

  /** The last name component, the way a card titles a node (`shortName`). */
  short(i: number): string {
    return shortName(this.nodes[i]);
  }

  /** Whether a node is a notation unit that only declares syntax (TCBSpec.md, decision 2). */
  isGrammar(i: number): boolean {
    return !!this.nodes[i].flags?.includes("grammar");
  }
}

/** What a card calls a node: a notation unit by its display form (`notation · I · in
 *  UnitLemmas`, RawNode.display), anything else by the last component of its name — a numeric or
 *  generated tail reads better with its parent. */
export function shortName(v: { name: string; display?: string }): string {
  if (v.display) return v.display;
  const parts = v.name.split(".");
  let last = parts[parts.length - 1];
  if (/^\d+$/.test(last) || last.length <= 2) last = parts.slice(-2).join(".");
  return last;
}
