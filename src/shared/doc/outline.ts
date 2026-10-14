// The document's outline (ExportSpec decision 18, the linear form): what the document of a view
// prints, in its order, without the text — its sections, numbered as the PDF numbers them, the
// declarations and the notes in each, and the notes attached to a declaration after it. The page
// draws the board as this outline (web/src/linear.ts); it is made from the same plan and the same
// order the document is (shared/doc/sections.ts, shared/doc/order.ts), so that the two agree.

import type { Graph } from "../viewgraph.ts";
import type { BoardSpots, OrderedSection, Placed } from "./order.ts";
import { orderDoc } from "./order.ts";
import type { DocPlan } from "./sections.ts";

/** A note as the outline names it: its id, whose it is, and its first words. */
export interface OutlineNote {
  t: "note";
  id: string;
  kind: "project" | "view";
  words: string;
}

/** A declaration of the project, by its full name, and the notes attached to it, which the document
 *  prints right after it. */
export interface OutlineDecl {
  t: "decl";
  name: string;
  notes?: OutlineNote[];
}

/** A section: its cluster's key (the deepest of a merged chain), every key it stands for, its
 *  heading, its number (`1.2`; null at the paragraph level, as the PDF prints it) and level, and
 *  what it holds in order. */
export interface OutlineSection {
  t: "section";
  key: string;
  keys: string[];
  title: string;
  number: string | null;
  level: number;
  items: OutlineItem[];
}

export type OutlineItem = OutlineDecl | OutlineNote | OutlineSection;

export interface Outline {
  items: OutlineItem[];
  /** how many declarations and sections it holds */
  count: { declarations: number; sections: number };
  /** no page had laid the board out for what it holds now: laid out by the server, as a page will */
  fresh?: true;
}

/** A note's first words: its first line, Markdown marks taken out, at most 60 characters. */
export function firstWords(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const plain = line.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 60 ? `${plain.slice(0, 59).trimEnd()}…` : plain;
}

/** The outline of the document of `plan` (of graph `g`) in the order of the board `spots` gives. */
export function outlineOf(plan: DocPlan, g: Graph, spots: BoardSpots): Outline {
  const order = orderDoc(plan, g, spots);
  const note = (k: number): OutlineNote => {
    const n = spots.notes[k];
    return { t: "note", id: n.note.id, kind: n.kind, words: firstWords(n.note.text) };
  };
  const item = (p: Placed, prefix: string, at: { k: number }): OutlineItem => {
    if (p.t === "note") return note(p.k);
    if (p.t === "decl") {
      const ks = order.attached.get(p.i);
      return { t: "decl", name: g.nodes[p.i].name, ...(ks?.length ? { notes: ks.map(note) } : {}) };
    }
    return section(p.s, prefix, at);
  };
  // numbered as the PDF numbers its headings (shared/doc/latex.ts): the first three levels, each
  // within the one above; a paragraph-level heading has none
  const section = (o: OrderedSection, prefix: string, at: { k: number }): OutlineSection => {
    const p = o.plan;
    at.k++;
    const number = p.level < 4 ? (prefix ? `${prefix}.${at.k}` : `${at.k}`) : null;
    const inner = { k: 0 };
    const items = o.items.map((x) => item(x, p.level < 3 ? (number ?? "") : "", inner));
    return { t: "section", key: p.key, keys: [...p.keys], title: p.title, number, level: p.level, items };
  };
  const top = { k: 0 };
  return {
    items: order.items.map((x) => item(x, "", top)),
    count: { declarations: plan.count, sections: plan.sectionCount },
    ...(spots.fresh ? { fresh: true as const } : {}),
  };
}
