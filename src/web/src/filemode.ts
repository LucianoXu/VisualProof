// File mode of the source window (ReviewSpec, "The source window", the owner's decisions of
// 2026-11-01): the whole file the window's declaration is in, as a mode of the window, not a window
// of another kind. What it draws of the file, worked out apart from the page:
//
// - **the declarations of the file**, each where the window would show it — at its compiled place
//   where the text is the one compiled, else found by name in the present text (shared/excerpt.ts) —
//   in the order of the file (`fileDecls`); outside the project, those the graph holds;
// - **the pieces it is drawn in** (`chunksOf`): each declaration's lines one piece, the lines between
//   cut into pieces of a few dozen lines, so that a file of thousands of lines is laid out where it is
//   read (each piece's layout skipped off the screen, web/style.css), the review box goes under the
//   window's declaration's piece, and Lean is asked about the names of a piece as it comes into
//   sight;
// - **where a reading position is** (`declAt`), for the sticky header that names it;
// - **the proofs it folds** (`proofFolds`): a theorem's value, read off its text as the exported
//   document reads it (shared/doc/proof.ts, valueStart), and the proofs inside a definition's body
//   where the usage pass found them in this very text (RawNode.proofs, ExportSpec decision 8);
// - **the mark each declaration has in the gutter** (`fileMark`), in the Status scheme's colours.
//
// web/src/sourcewin.ts draws it; test/filemode.test.ts holds it.

import { compiledExcerpt, excerptOf } from "../../shared/excerpt.ts";
import { valueStart } from "../../shared/doc/proof.ts";
import { statusOf } from "../../shared/review.ts";
import type { ReviewData } from "../../shared/review.ts";
import { needsReview } from "../../shared/reviewqueue.ts";
import type { Graph } from "../../shared/viewgraph.ts";

/** The window's two modes: the declaration with its context, or the whole file it is in. */
export type SourceMode = "decl" | "file";

/** A declaration of the file on show. */
export interface FileDecl {
  /** the declaration, in the window's graph */
  i: number;
  /** its first and last line in the text shown, from 0, inclusive: with its docstring and
   *  attributes, as the window shows it in Declaration mode */
  start: number;
  end: number;
  /** the line its command starts on, past its docstring and attributes: where its mark is */
  head: number;
}

/** each graph's declarations by module, in the graph's order */
const byModule = new WeakMap<Graph, Map<string, number[]>>();

/** The declarations of graph `g` in module `module`: the project's, or outside it those of that
 *  module the graph holds. */
export function moduleDecls(g: Graph, module: string): number[] {
  let m = byModule.get(g);
  if (!m) {
    m = new Map();
    for (let i = 0; i < g.n; i++) {
      const k = g.nodes[i].module;
      const list = m.get(k);
      if (list) list.push(i);
      else m.set(k, [i]);
    }
    byModule.set(g, m);
  }
  return m.get(module) ?? [];
}

/** Whether a line holds nothing of a command's own: blank, a line comment, an attribute alone. */
const preamble = (l: string) => /^\s*(?:$|--|@\[[^\]]*\]\s*$)/.test(l);

/** The line a declaration's command starts on, from `start` to `end`: past a docstring that opens
 *  it and the attribute and comment lines after it; `start` where there is nothing of the kind. */
export function headLine(lines: readonly string[], start: number, end: number): number {
  let k = start;
  if (/^\s*\/--/.test(lines[k] ?? "")) {
    const first = lines[k].indexOf("/--");
    // the docstring's close, on its first line or below
    while (k <= end && lines[k].indexOf("-/", k === start ? first + 3 : 0) < 0) k++;
    if (k > end) return start;
    // something written after it on its line: the command starts there
    const rest = lines[k].slice(lines[k].indexOf("-/", k === start ? first + 3 : 0) + 2);
    if (rest.trim()) return k;
    k++;
  }
  while (k < end && preamble(lines[k])) k++;
  return k <= end ? k : start;
}

/** The declarations of `g` in `module` as they are in the file's `lines`, in the order of the file
 *  (by their first line, then their names): at their compiled places where the text is the one
 *  compiled (`edited` false: a past build's text is that build's), else found by name; one without
 *  a place, or not found, is left out. A declaration Lean generated (`gen`) has no text of its own,
 *  and is left out too. */
export function fileDecls(g: Graph, module: string, lines: string[], edited: boolean): FileDecl[] {
  const out: FileDecl[] = [];
  for (const i of moduleDecls(g, module)) {
    const v = g.nodes[i];
    if (!v.range || v.gen !== undefined) continue;
    const at = edited ? excerptOf(lines, true, v.name, v.range) : compiledExcerpt(lines, v.range);
    if (!at || at.start >= lines.length) continue;
    out.push({ i, start: at.start, end: at.end, head: headLine(lines, at.start, at.end) });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end || (g.nodes[a.i].name < g.nodes[b.i].name ? -1 : 1));
}

/** A piece of the file drawn as a code block of its own: lines `start` to `end`, from 0, inclusive. */
export interface Chunk {
  start: number;
  end: number;
}

/** the most lines of a piece between declarations */
export const CHUNK_LINES = 60;

/** The file's `n` lines cut into pieces, in order, covering all of them: each declaration's lines
 *  one piece — declarations whose lines meet or overlap (a `mutual` block, a declaration inside
 *  another's) one piece together — and the lines between them pieces of at most `max` lines. */
export function chunksOf(decls: readonly FileDecl[], n: number, max = CHUNK_LINES): Chunk[] {
  const out: Chunk[] = [];
  const gap = (from: number, to: number) => {
    for (let s = from; s <= to; s += max) out.push({ start: s, end: Math.min(to, s + max - 1) });
  };
  let at = 0;
  let k = 0;
  while (k < decls.length) {
    const start = Math.max(at, decls[k].start);
    let end = Math.max(start, decls[k].end);
    k++;
    while (k < decls.length && decls[k].start <= end) end = Math.max(end, decls[k++].end);
    end = Math.min(end, n - 1);
    if (start > end) continue;
    if (start > at) gap(at, start - 1);
    out.push({ start, end });
    at = end + 1;
  }
  if (at < n) gap(at, n - 1);
  return out;
}

/** The declaration whose lines hold `line`: the innermost — the one starting last — where several
 *  do; null between declarations. */
export function declAt(decls: readonly FileDecl[], line: number): FileDecl | null {
  let best: FileDecl | null = null;
  for (const d of decls) {
    if (d.start > line) break;
    if (d.end >= line && (!best || d.start >= best.start)) best = d;
  }
  return best;
}

/** A proof as File mode folds it: from (line, UTF-16 column) to (line, column), end exclusive, in
 *  the file; `decl`, the index of its declaration in the file's declarations. */
export interface Fold {
  from: [number, number];
  to: [number, number];
  decl: number;
}

/** the kinds whose value can hold a proof the usage pass records (shared/doc/build.ts) */
const VALUE_KINDS = new Set(["def", "abbrev", "instance", "opaque"]);
/** what a folded proof shows in its place: a proof no longer than this is shown as it is */
export const FOLD_MARK = "⋯ proof";

/** The UTF-16 offset of code point `col` of `line` (its end where the line is shorter): Lean counts
 *  columns in code points, the page in UTF-16. */
function utf16At(line: string, col: number): number {
  let i = 0;
  for (let cp = 0; cp < col && i < line.length; cp++) i += (line.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
  return i;
}

/** The proofs File mode folds in the file's `lines`, in the order of the file, none overlapping:
 *  of each theorem, its value — from the first word after its `:=` (or its first equation, its
 *  `where`) to the end of its text, read off the text as the exported document reads it
 *  (shared/doc/proof.ts), so that what it states stays in sight; of each definition, the proofs
 *  inside its body where the usage pass found them in this very text (`passRead`: the text is the
 *  one compiled, and the pass read it; ExportSpec decision 8) — elsewhere none, reading the text
 *  telling a `by` that builds data from one that proves no better than a guess. A proof no longer
 *  than the mark that would stand for it is left as it is: folding it would only hide it. */
export function proofFolds(g: Graph, decls: readonly FileDecl[], lines: readonly string[], passRead: (i: number) => boolean): Fold[] {
  const out: Fold[] = [];
  /** a span of the file, from offset `a` to `b` of the text of lines `start`..: as a fold, where it
   *  is longer than the mark */
  const add = (d: number, start: number, text: string, a: number, b: number) => {
    // trailing spaces and line breaks are not the proof's
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b - a <= FOLD_MARK.length) return;
    const pos = (o: number): [number, number] => {
      let line = start, at = 0;
      for (let nl = text.indexOf("\n"); nl >= 0 && nl < o; nl = text.indexOf("\n", at)) {
        line++;
        at = nl + 1;
      }
      return [line, o - at];
    };
    out.push({ from: pos(a), to: pos(b), decl: d });
  };
  decls.forEach((fd, d) => {
    const v = g.nodes[fd.i];
    const text = lines.slice(fd.start, fd.end + 1).join("\n");
    if (v.kind === "theorem") {
      const at = valueStart(text);
      if (at === null) return;
      // after `:=` and the spaces on its line: the `:=` stays, as the statement's end, and the mark
      // that stands for the proof comes after it on its line, where the proof starts on the next
      let from = text.startsWith(":=", at) ? at + 2 : at;
      while (from < text.length && (text[from] === " " || text[from] === "\t")) from++;
      add(d, fd.start, text, from, text.length);
      return;
    }
    if (!VALUE_KINDS.has(v.kind) || !v.proofs?.length || !passRead(fd.i)) return;
    // the pass's spans: lines from 1, columns in code points; offsets into this declaration's text
    const starts: number[] = [];
    let o = 0;
    for (let l = fd.start; l <= fd.end; l++) {
      starts.push(o);
      o += lines[l].length + 1;
    }
    const off = (line: number, col: number): number | null => {
      const k = line - 1 - fd.start;
      return k < 0 || k >= starts.length ? null : starts[k] + utf16At(lines[line - 1], col);
    };
    for (const [l0, c0, l1, c1] of v.proofs) {
      const a = off(l0, c0), b = off(l1, c1);
      if (a !== null && b !== null && a < b) add(d, fd.start, text, a, b);
    }
  });
  // in the order of the file, and apart: a proof inside another (a declaration inside another's
  // lines) is folded with it
  out.sort((x, y) => x.from[0] - y.from[0] || x.from[1] - y.from[1]);
  const apart: Fold[] = [];
  const before = (p: [number, number], q: [number, number]) => p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]);
  for (const f of out) {
    const last = apart[apart.length - 1];
    if (last && before(f.from, last.to)) {
      if (before(last.to, f.to)) last.to = f.to;
    } else apart.push({ ...f, from: [...f.from], to: [...f.to] });
  }
  return apart;
}

/** A declaration's mark in the gutter of File mode: Status's review states (CanvasSpec, "Colour
 *  schemes"), and `free` for one in no target's review set (a proposal of 2026-11-01: a hollow
 *  ring, there being nothing a target needs of it). */
export type FileMark = "commented" | "stale" | "approved" | "unreviewed" | "trusted" | "free";

/** How a mark is said, in its tooltip. */
export const FILE_MARK_LABEL: Record<FileMark, string> = {
  commented: "commented",
  stale: "stale",
  approved: "approved",
  unreviewed: "not yet reviewed",
  trusted: "trusted",
  free: "in no target's review set",
};

/** Declaration `i`'s mark: what reviewers said of its present version, as Status says it — a
 *  comment, else an approval, else stale where every opinion is on an earlier version; with none,
 *  trusted where nothing needs its review, else not yet reviewed where some target's review set
 *  holds it (`inReview`; null where the page does not know, as without targets), else free. */
export function fileMark(d: ReviewData, g: Graph, i: number, inReview: ((i: number) => boolean) | null): FileMark {
  const v = g.nodes[i];
  const s = statusOf(d, v.name, v.hash);
  if (s === "commented" || s === "stale" || s === "approved") return s;
  if (!needsReview(g, d, i)) return "trusted";
  return !inReview || inReview(i) ? "unreviewed" : "free";
}

/** Whether a declaration's text in a file changed since it was compiled is still its compiled text:
 *  its lines now (`now`, found by name) are those at its compiled place in the compiled text. Then
 *  its mark, which is about the compiled version, is shown; elsewhere not. */
export function sameText(compiled: readonly string[], range: readonly number[], lines: readonly string[], now: Pick<FileDecl, "start" | "end">): boolean {
  const at = compiledExcerpt(compiled as string[], range);
  if (at.end - at.start !== now.end - now.start) return false;
  for (let k = 0; k <= at.end - at.start; k++) if (compiled[at.start + k] !== lines[now.start + k]) return false;
  return true;
}
