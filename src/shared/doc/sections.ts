// The exported document's plan (ExportSpec decisions 12 and 13): what a view holds, as the document
// prints it. Every declaration of the project the board holds is printed, whatever is folded; what
// the view holds from outside the project is not, and is counted instead. The sections are the
// view's cluster structure as the board shows it — its clustering, its hidden levels taken out
// (ViewSpec decision 24; shared/layout.ts, clusterTree) — each cluster that holds something printed
// a section, nested by its depth.
//
// The plan says what is printed, not in which order: the order is the board's (the owner's decisions
// of 2026-10-12, shared/doc/order.ts), from where the view's board draws each thing, which only the
// server and a page that lays the board out know. The builder (shared/doc/build.ts) prints from it
// in that order, and the Export window (web/src/exportmodal.ts) says from it what the document will
// hold, so that the two agree.

import type { ClusterMode } from "../graph.ts";
import { clusterTree } from "../layout.ts";
import type { Graph } from "../viewgraph.ts";

/** Heading levels: section, subsection, subsubsection, then a paragraph-level heading, which every
 *  deeper level takes too. */
export const HEADING_LEVELS = 4;

/** The most declarations one document prints: some 400 pages, typeset in well under the time
 *  XeLaTeX is given (server/export.ts). A larger view is narrowed first. */
export const MAX_DOC_DECLS = 2000;

/** Why a view of `count` declarations of the project makes no document, or null. */
export function tooMuch(count: number): string | null {
  if (!count) return "This view holds no declaration of the project: there is nothing to print";
  if (count > MAX_DOC_DECLS)
    return `This view holds ${count.toLocaleString("en")} declarations of the project; a document prints at most ${MAX_DOC_DECLS.toLocaleString("en")}. Export a narrower view: a namespace or a folder, a target's Key view (key(T)) or the TCB of a target`;
  return null;
}

/** A section of the plan: a cluster of the board that holds something printed. */
export interface SectionPlan {
  /** the cluster's key (its full path) */
  key: string;
  /** its heading: the cluster's label as the board shows it, with the labels of the clusters merged
   *  into it; below the paragraph level, the path from the paragraph-level section above */
  title: string;
  /** its heading's level, 1 to HEADING_LEVELS */
  level: number;
  /** how deep it is among the sections, 1 at the top */
  depth: number;
  /** the keys of the board's clusters it stands for: its own and those of the clusters merged into
   *  it, outermost first */
  keys: string[];
  /** the declarations printed in it directly (the whole graph's numbering, in its order) */
  decls: number[];
  sections: SectionPlan[];
}

/** What the document of a view holds. */
export interface DocPlan {
  /** the declarations at the top of the board's tree, in no cluster: printed first, under no
   *  heading */
  decls: number[];
  sections: SectionPlan[];
  /** how many declarations are printed, and how many sections hold them */
  count: number;
  sectionCount: number;
  /** what the view holds from outside the project, which is not printed: how many, and how many
   *  per library (the first part of the module), the most first */
  outside: { count: number; by: { name: string; count: number }[] };
}

/** The plan of the document of the board that holds `set` (per node of `g`) clustered by `mode`
 *  with the levels `hidden` hidden. A cluster that holds no declaration of its own and one section
 *  only is merged into it, its heading `A.B`, so that the document has no heading chains with
 *  nothing under them; the board merges such a chain into one circle already where it holds nothing
 *  else at all. On a board of a past build, `g` is its past graph (shared/pastgraph.ts), which holds
 *  that build's declarations alone. */
export function planDoc(g: Graph, set: Uint8Array, mode: ClusterMode, hidden: readonly string[]): DocPlan {
  // the board's members in the whole graph's order, as a board's graph has them (shared/board.ts)
  const members: number[] = [];
  for (let i = 0; i < g.n; i++) if (set[i]) members.push(i);
  const tree = clusterTree(mode, members.map((i) => g.nodes[i]), hidden);
  const own: number[][] = tree.clusters.map(() => []);
  const top: number[] = [];
  const by = new Map<string, number>();
  let outside = 0;
  members.forEach((i, k) => {
    if (g.isExt(i)) {
      outside++;
      const lib = g.nodes[i].module.split(".")[0] || g.nodes[i].module;
      by.set(lib, (by.get(lib) ?? 0) + 1);
      return;
    }
    const c = tree.cluster[k];
    (c >= 0 ? own[c] : top).push(i);
  });
  // how much each cluster's subtree prints
  const kids: number[][] = tree.clusters.map(() => []);
  const roots: number[] = [];
  tree.clusters.forEach((c, k) => (c.parent >= 0 ? kids[c.parent] : roots).push(k));
  const printed = new Int32Array(tree.clusters.length);
  for (let k = tree.clusters.length - 1; k >= 0; k--) {
    printed[k] += own[k].length;
    const p = tree.clusters[k].parent;
    if (p >= 0) printed[p] += printed[k];
  }
  const kept = (k: number) => kids[k].filter((j) => printed[j] > 0);

  let sectionCount = 0;
  const section = (k: number, depth: number, above: string | null): SectionPlan => {
    let title = tree.clusters[k].label;
    const keys = [tree.clusters[k].key];
    // nothing of its own and one section: one heading
    for (let next = kept(k); !own[k].length && next.length === 1; next = kept(k)) {
      k = next[0];
      title = `${title}.${tree.clusters[k].label}`;
      keys.push(tree.clusters[k].key);
    }
    sectionCount++;
    const level = Math.min(depth, HEADING_LEVELS);
    if (depth > HEADING_LEVELS && above !== null) title = `${above}.${title}`;
    const s: SectionPlan = { key: tree.clusters[k].key, title, level, depth, keys, decls: own[k], sections: [] };
    s.sections = kept(k).map((j) => section(j, depth + 1, depth >= HEADING_LEVELS ? title : null));
    return s;
  };
  const sections = roots.filter((k) => printed[k] > 0).map((k) => section(k, 1, null));
  return {
    decls: top,
    sections,
    count: top.length + own.reduce((a, d) => a + d.length, 0),
    sectionCount,
    outside: { count: outside, by: [...by].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)) },
  };
}
