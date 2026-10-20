// A declaration's source at a past build (HistorySpec decision 23, the owner's of 2026-10-10), as the
// source window shows it on a board of a past graph: the text that build was compiled from (GET
// /api/history/source), read at the place the snapshot recorded — that build's place, its line
// numbers its own — with the names in it resolved on the past graph, as the past board resolves them.
// Nothing here asks Lean, which knows only the latest build: what a name shows is what the snapshot
// knows of it, its statement and doc.
//
// A declaration outside the project is not kept per build (HistorySpec decision 24, the owner's of
// 2026-10-20): the server answers its package's file as it is now where that package is at the
// revision the build had (`check: "rev"`), and says that build's outside source was not kept
// elsewhere.
//
// This is the model alone, with no page in it, so that it is tested without a browser
// (test/pastsource.test.ts); web/src/sourcewin.ts draws it.

import { compiledExcerpt } from "../../shared/excerpt.ts";
import type { OutsideWhere } from "../../shared/outside.ts";
import { packageWords } from "../../shared/outside.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { namespacesOf, resolver, scopeAt } from "./scope.ts";

/** A module's text at a past build, as the server answers it: the text, its file, its Lake hash
 *  where the build recorded one, and how the text was matched to the build (server/sourcestore.ts). */
export interface PastSource {
  module: string;
  file: string;
  text: string;
  lake: string | null;
  /** `rev`: a module outside the project, its package's file now, at the same revision as then */
  check: "lake" | "places" | "rev";
  /** where the text was found (HistorySpec, "On disk"): the working tree as the build was read
   *  (`tree`), a commit (`git:<hash>`), the texts kept already (`kept`) */
  from?: string | null;
  snapshot: number;
  /** a module outside the project: its package (shared/outside.ts) */
  outside?: OutsideWhere;
}

/** What the server says where a module's text at a past build is not kept. */
export interface PastSourceMissing {
  missing: true;
  /** why, in words; null where the server could not be reached */
  why: string | null;
  file?: string;
  /** a module outside the project, whose source that build was not kept */
  outside?: true;
}

/** A declaration's text at a past build. */
export interface PastText {
  file: string;
  /** its first and last line in that build's file, from 0, inclusive */
  start: number;
  end: number;
  /** the lines shown */
  lines: string[];
  text: string;
  /** where it is, as the window's title bar says it: `Mathlib/NumberTheory/FLT/Four.lean:34–37` */
  where: string;
  /** what a name written in it links to: a declaration of the past graph, or nothing */
  resolve: (w: string) => string | null;
}

/** Declaration `i` of past graph `g` in its module's text at that build: at the place the snapshot
 *  recorded (with the doc comment and attributes above it), the names in it resolved on `g` from
 *  the namespaces around it and what the file opens before it; null where the snapshot recorded no
 *  place for it. */
export function pastText(g: Graph, i: number, src: Pick<PastSource, "file" | "text" | "outside">): PastText | null {
  const v = g.nodes[i];
  if (!v.range || g.isExt(i) !== !!src.outside) return null;
  const all = src.text.split("\n");
  const at = compiledExcerpt(all, v.range);
  const lines = all.slice(at.start, at.end + 1);
  const spaces = namespacesOf(g);
  return {
    file: src.file,
    start: at.start,
    end: at.end,
    lines,
    text: lines.join("\n"),
    where: `${src.outside ? `${packageWords(src.outside)} · ` : ""}${src.file}:${at.start + 1}–${at.end + 1}`,
    resolve: resolver(g, v.name, scopeAt(all, at.start, (n) => spaces.has(n))),
  };
}

/** What the window says above a past build's text: the build, and how its text was matched to it
 *  where its Lake hash was not kept. */
export function pastNote(when: string, commit: string | null, check: PastSource["check"], outside?: OutsideWhere): string {
  const build = `As built ${when}${commit ? ` · ${commit.slice(0, 7)}` : ""}`;
  if (check === "rev" && outside)
    return `${build}: outside sources are not kept per build; this is ${outside.core ? "Lean's core" : outside.package} as it is now, ${outside.core ? "the same toolchain" : "at the same revision"} as then (${packageWords(outside)}). Lean typing info and interaction unavailable.`;
  return check === "places"
    ? `${build}: the text it was compiled from, matched by the places the build recorded, since its hash was not kept. Lean typing info and interaction unavailable.`
    : `${build}: the text it was compiled from. Lean typing info and interaction unavailable.`;
}
