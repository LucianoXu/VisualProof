// The exported document's order (the owner's decisions of 2026-10-12): the board is the outline of
// the document. Within a section, everything the board draws in that cluster — its sub-clusters by
// their circle's centre, its declarations by their point, its notes by their icon — comes in the
// order of its height on the view's board, the lowest first, ties left to right; the top-level
// sections are ordered so too, and so is what the document starts with, under no heading: the
// declarations in no cluster and the notes on the ring or on the canvas outside every cluster. Since
// the layout puts what is used more lower down (CanvasSpec, "Dependency order"), the default reads
// foundations first; a reader reorders the document by dragging things on the board. Nothing here
// reads what depends on what.
//
// Where each thing is drawn is the board's (server/boardspots.ts reads it as the page draws it: the
// view's layout memory, its pins and its hidden levels); this file only orders what it is told, so
// that the same positions always give the same document. A note attached to a declaration the
// document prints goes right after it, as its explanation; a note in a cluster goes to the section
// of the nearest cluster around it that the document prints; any other note, to the start.

import type { ClusterMode } from "../graph.ts";
import { boardLayout, subgraph } from "../board.ts";
import type { ProjectNote } from "../projectnotes.ts";
import type { StickyNote } from "../sticky.ts";
import type { Graph } from "../viewgraph.ts";
import type { DocPlan, SectionPlan } from "./sections.ts";

/** A note the view shows, where its board draws it. */
export interface BoardNote {
  note: ProjectNote | StickyNote;
  /** a note of the project, or the view's own */
  kind: "project" | "view";
  /** its icon, in the board's world (y grows downwards, as on the screen) */
  at: [number, number];
  /** the circles around it, by key, innermost first; none at the top level — on the ring, or on the
   *  canvas outside every cluster */
  in: string[];
  /** the declaration it is attached to (its `decl`), where the board holds that declaration */
  on?: string;
}

/** Where the view's board draws what its document prints, in the board's world, everything unfolded:
 *  each declaration's point by its full name, each circle's centre by its key (a chain of clusters
 *  merged into one circle by the deepest key, as the layout names it), and the notes the view shows. */
export interface BoardSpots {
  decls: ReadonlyMap<string, [number, number]>;
  clusters: ReadonlyMap<string, [number, number]>;
  notes: readonly BoardNote[];
  /** no page had laid this board out for what it holds now: the server laid it out as a page will
   *  (server/boardspots.ts), from the view's memory, and the export's notes say so */
  fresh?: boolean;
}

/** One thing of a section, or of the document's start, as the order places it: a declaration (the
 *  whole graph's numbering), a note (by its index among `BoardSpots.notes`), a section. */
export type Placed = { t: "decl"; i: number } | { t: "note"; k: number } | { t: "section"; s: OrderedSection };

export interface OrderedSection {
  plan: SectionPlan;
  items: Placed[];
}

/** The document's outline in the board's order: its start then its sections (`items`), and the notes
 *  attached to each declaration it prints, in their order, by the declaration's number. */
export interface Ordered {
  items: Placed[];
  attached: Map<number, number[]>;
}

/** A height on the board, read to a tenth of a unit, which the layout rounds its places to: two
 *  things on one row of a cluster's lattice are level, and go left to right. */
const tenth = (v: number) => Math.round(v * 10);

/** The board's order of things at `at` (null where the board does not say: last, as given): the
 *  lowest first, ties left to right, then as given. */
export function boardOrder<T>(xs: readonly T[], at: (x: T) => readonly [number, number] | null): T[] {
  const keyed = xs.map((x, k) => ({ x, k, p: at(x) }));
  keyed.sort((a, b) => {
    if (!a.p || !b.p) return a.p ? -1 : b.p ? 1 : a.k - b.k;
    return tenth(b.p[1]) - tenth(a.p[1]) || tenth(a.p[0]) - tenth(b.p[0]) || a.k - b.k;
  });
  return keyed.map((e) => e.x);
}

/** The outline of the document of `plan` (of graph `g`) in the order of the board `spots` describes. */
export function orderDoc(plan: DocPlan, g: Graph, spots: BoardSpots): Ordered {
  // the declarations the document prints, by name: where an attached note goes
  const printed = new Map<string, number>();
  const sectionOf = new Map<string, SectionPlan>();
  const walk = (s: SectionPlan) => {
    for (const k of s.keys) sectionOf.set(k, s);
    for (const i of s.decls) printed.set(g.nodes[i].name, i);
    s.sections.forEach(walk);
  };
  plan.sections.forEach(walk);
  for (const i of plan.decls) printed.set(g.nodes[i].name, i);

  const attached = new Map<number, number[]>();
  const inSection = new Map<SectionPlan, number[]>();
  const atStart: number[] = [];
  spots.notes.forEach((n, k) => {
    const on = n.on !== undefined ? printed.get(n.on) : undefined;
    if (on !== undefined) {
      const list = attached.get(on) ?? [];
      list.push(k);
      attached.set(on, list);
      return;
    }
    // the nearest cluster around it that the document prints; none, the start
    const s = n.in.map((key) => sectionOf.get(key)).find((x) => x !== undefined);
    if (!s) {
      atStart.push(k);
      return;
    }
    const list = inSection.get(s) ?? [];
    list.push(k);
    inSection.set(s, list);
  });
  for (const [i, ks] of attached) attached.set(i, boardOrder(ks, (k) => spots.notes[k].at));

  const declAt = (i: number) => spots.decls.get(g.nodes[i].name) ?? null;
  // a section's circle; where the board names none (a board laid out otherwise), the middle of what
  // it prints
  const sectionAt = (s: SectionPlan): [number, number] | null => {
    const c = spots.clusters.get(s.key);
    if (c) return c;
    let x = 0, y = 0, n = 0;
    const sum = (t: SectionPlan) => {
      for (const i of t.decls) {
        const p = declAt(i);
        if (p) [x, y, n] = [x + p[0], y + p[1], n + 1];
      }
      t.sections.forEach(sum);
    };
    sum(s);
    return n ? [x / n, y / n] : null;
  };
  const at = (p: Placed) => (p.t === "decl" ? declAt(p.i) : p.t === "note" ? spots.notes[p.k].at : sectionAt(p.s.plan));
  const section = (s: SectionPlan): OrderedSection => ({
    plan: s,
    items: boardOrder<Placed>([...s.decls.map((i): Placed => ({ t: "decl", i })), ...(inSection.get(s) ?? []).map((k): Placed => ({ t: "note", k })), ...s.sections.map((t): Placed => ({ t: "section", s: section(t) }))], at),
  });
  // the start, then the top-level sections: the start has no heading of its own to come back to
  const start = boardOrder<Placed>([...plan.decls.map((i): Placed => ({ t: "decl", i })), ...atStart.map((k): Placed => ({ t: "note", k }))], at);
  const sections = boardOrder<Placed>(plan.sections.map((s): Placed => ({ t: "section", s: section(s) })), at);
  return { items: [...start, ...sections], attached };
}

/** The board of `set` (per node of `g`) by `mode` with the levels `hidden` hidden as a fresh layout
 *  draws it, with nothing pinned and no notes: what a board nobody arranged looks like, laid out on
 *  its own. What the builder orders by where it is told nothing of the board (shared/doc/build.ts). */
export function freshSpots(g: Graph, set: Uint8Array, mode: ClusterMode, hidden: readonly string[]): BoardSpots {
  const sub = subgraph(g, set).graph;
  const L = boardLayout(sub, mode, "fresh", null, hidden).layout;
  const decls = new Map<string, [number, number]>();
  sub.nodes.forEach((v, i) => decls.set(v.name, [L.x[i], L.y[i]]));
  return { decls, clusters: new Map(L.clusters.map((c) => [c.key, [c.x, c.y] as [number, number]])), notes: [] };
}
