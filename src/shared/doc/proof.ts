// Proofs are never exported (ExportSpec decision 8): a theorem's source is printed up to its
// statement, and `:= …` stands for the rest. Where its value starts is read off its text here.
//
// The usage pass does not record where a value starts (extractor/Usage.lean tells a value's
// syntax apart while it walks a command, but writes only the uses it found), so the text is read
// as the tokenizer reads it (shared/lexer.ts): comments, docstrings, strings and attributes are
// whole tokens and never searched, and brackets are followed, so that a `:=` inside a binder's
// default value or an attribute's argument is not the value's. The value starts at the first `:=`
// outside every bracket that no `let` or `have` in the statement claims, at a line that starts
// with `|` and has `=>` on it (equations, `theorem f : ∀ n, P n | 0 => …`), or at a `where`. A
// statement never holds a `by` outside brackets: one met before the value's start means the
// reading went wrong (a `have` claimed the wrong `:=`), and nothing is found. Where nothing is
// found, the caller prints the graph's statement instead: a proof is never printed for want of
// finding where it starts.
//
// Proofs inside a definition's value are left out too, and the rest of the definition is always
// printed (decided 2026-10-08). The usage pass records where they are (RawNode.proofs: `by` blocks
// whose goal is a proposition, the tactics of `decreasing_by`, term-mode proofs written in the
// text), and `cutProofs` puts `…` in the place of each. Those places are the compiled text's, so
// the caller uses them only for a text the pass read. Elsewhere — the file changed since it was
// compiled, or the pass is off, still running or failed on the module — `cutByText` finds them by
// reading the text: every `by` block in the value, and the tactics of `decreasing_by`. That reading
// cannot tell a `by` block that builds data from one that proves, and leaves out both; and it cannot
// find a proof written as a term, which it keeps.

import { tokenizeLean } from "../lexer.ts";
import type { Token } from "../lexer.ts";
import type { CodeLine } from "./model.ts";

const OPEN = "([{⦃⟨⟦⟪⦅⦇⁅";
const CLOSE = ")]}⦄⟩⟧⟫⦆⦈⁆";
/** words in a statement's terms that bind with a `:=` of their own */
const BINDS = new Set(["let", "have", "haveI", "letI"]);

/** Where the value of a declaration whose text is `text` starts (an offset into `text`), or null
 *  when it cannot be told: where a theorem's proof starts. */
export function valueStart(text: string): number | null {
  let depth = 0;
  let claimed = 0;
  for (const t of tokenizeLean(text)) {
    if (t.kind === "comment" || t.kind === "doc" || t.kind === "string" || t.kind === "attr") continue;
    if (t.kind === "keyword" || t.kind === "ident") {
      if (depth === 0 && BINDS.has(t.text)) claimed++;
      else if (depth === 0 && t.text === "where") return t.at;
      else if (depth === 0 && t.text === "by") return null;
      continue;
    }
    if (t.kind !== "text" && t.kind !== "op") continue;
    for (let k = 0; k < t.text.length; k++) {
      const c = t.text[k];
      const at = t.at + k;
      if (OPEN.includes(c)) depth++;
      else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
      else if (depth === 0 && c === ":" && t.text[k + 1] === "=") {
        if (claimed > 0) {
          claimed--;
          k++;
          continue;
        }
        return at;
      } else if (depth === 0 && c === "|" && lineStart(text, at) && equation(text, at)) return at;
    }
  }
  return null;
}

/** Whether only spaces come before `at` on its line. */
function lineStart(text: string, at: number): boolean {
  const nl = text.lastIndexOf("\n", at - 1);
  return nl >= 0 && /^[ \t]*$/.test(text.slice(nl + 1, at));
}

/** Whether the line from `at` is an equation's, `| pattern => value`: a `=>` on it. */
function equation(text: string, at: number): boolean {
  const end = text.indexOf("\n", at);
  return text.slice(at, end < 0 ? text.length : end).includes("=>");
}

/** A theorem's text without its proof: up to where its value starts, the spaces before it left
 *  out; null where that place cannot be found. */
export function statementOnly(text: string): string | null {
  const at = valueStart(text);
  return at === null ? null : text.slice(0, at).replace(/\s+$/, "");
}

/** Where a proof is in a file: [line, col, endLine, endCol], lines 1-based, columns 0-based in code
 *  points (as Lean counts them), end exclusive (RawNode.proofs). */
export type ProofSpan = readonly [number, number, number, number];

/** A definition's code with the proofs inside it left out. */
export interface CutCode {
  lines: CodeLine[];
  /** how many proofs were cut */
  cuts: number;
}

/** The UTF-16 offset of code point `col` of `line` (its end where the line is shorter). */
function utf16At(line: string, col: number): number {
  let i = 0;
  for (let cp = 0; cp < col && i < line.length; cp++) i += (line.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
  return i;
}

/** The file's lines `start`..`end` (0-based, inclusive) as highlighted code, each proof span in them
 *  cut and `…` (an `elided` token) put in its place: `field := by decide` reads `field := …`; a
 *  multi-line `by` block is `…` on its first line, the lines after it gone up to its end, where what
 *  follows the proof on its last line joins the first; a `by` in the middle of a term is `…` there.
 *  Everything else is kept as written, comments included, highlighted as the whole text is (the
 *  text is tokenized before it is cut). Spans outside the lines are ignored, one that runs past them
 *  is cut to their end. */
export function cutProofs(lines: readonly string[], start: number, end: number, spans: readonly ProofSpan[]): CutCode {
  const own = lines.slice(start, end + 1);
  const text = own.join("\n");
  const lineStart: number[] = [];
  let at = 0;
  for (const l of own) {
    lineStart.push(at);
    at += l.length + 1;
  }
  const offset = (line: number, col: number): number => {
    const k = line - 1 - start;
    if (k < 0) return 0;
    if (k >= own.length) return text.length;
    return lineStart[k] + utf16At(own[k], col);
  };
  return cutAt(text, spans.map((sp) => [offset(sp[0], sp[1]), offset(sp[2], sp[3])]));
}

/** A definition's text with the proofs in it left out where reading the text finds them
 *  (`textProofs`), cut as `cutProofs` cuts the usage pass's: for a text the pass has not read. */
export function cutByText(text: string): CutCode {
  return cutAt(text, textProofs(text));
}

/** `text` as highlighted code with the spans in it (offsets, end exclusive) cut, `…` in the place of
 *  each. */
function cutAt(text: string, spans: readonly (readonly [number, number])[]): CutCode {
  // the spans sorted and apart (the pass merges them; a span given twice is cut once)
  const cuts: [number, number][] = [];
  for (const s of spans
    .map(([a, b]) => [a, b] as [number, number])
    .filter(([a, b]) => a < b)
    .sort((x, y) => x[0] - y[0])) {
    const last = cuts[cuts.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else cuts.push(s);
  }
  // the tokens outside the cuts, an `elided` one at each cut's start
  const kept: { kind: Token["kind"] | "elided"; text: string }[] = [];
  let ci = 0;
  for (const t of tokenizeLean(text)) {
    let p = t.at;
    const e = t.at + t.text.length;
    while (p < e) {
      while (ci < cuts.length && cuts[ci][1] <= p) ci++;
      const c = cuts[ci];
      if (!c || e <= c[0]) {
        kept.push({ kind: t.kind, text: text.slice(p, e) });
        break;
      }
      if (p < c[0]) kept.push({ kind: t.kind, text: text.slice(p, c[0]) });
      if (p <= c[0]) kept.push({ kind: "elided", text: "…" });
      p = Math.min(e, c[1]);
    }
  }
  // the lines, a new one at each line break that was kept
  const out: CodeLine[] = [[]];
  for (const t of kept)
    t.text.split("\n").forEach((part, k) => {
      if (k) out.push([]);
      if (part) out[out.length - 1].push([t.kind, part]);
    });
  return { lines: out, cuts: cuts.length };
}

/** The words that end a tactic block where they stand at its depth: a definition's termination
 *  clauses, its auxiliary definitions and its derived instances come after its value, and no
 *  tactic is one of them. */
const BLOCK_ENDS = new Set(["termination_by", "decreasing_by", "where", "deriving"]);

/** A piece of a text as `textProofs` reads it: a word, a string or an attribute (`word`); an opening
 *  bracket, a quotation's where a backquote stands just before it; a closing one; a comma; any other
 *  mark. Comments and docstrings are no pieces: they are spaces to the layout. */
interface Piece {
  t: "word" | "open" | "close" | "comma" | "mark";
  text: string;
  at: number;
  end: number;
  quote: boolean;
  /** the first piece of its line: its column, in UTF-16 units; -1 for any other */
  col: number;
}

/** The pieces of `text`, in order. */
function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let line = -1;
  const push = (t: Piece["t"], at: number, end: number) => {
    const start = text.lastIndexOf("\n", at - 1) + 1;
    out.push({ t, text: text.slice(at, end), at, end, quote: t === "open" && text[at - 1] === "`", col: start === line ? -1 : at - start });
    line = start;
  };
  for (const t of tokenizeLean(text)) {
    if (t.kind === "comment" || t.kind === "doc") continue;
    if (t.kind !== "text" && t.kind !== "op") {
      push("word", t.at, t.at + t.text.length);
      continue;
    }
    for (let k = 0; k < t.text.length; ) {
      const c = String.fromCodePoint(t.text.codePointAt(k)!);
      const at = t.at + k;
      k += c.length;
      if (/\s/.test(c)) continue;
      push(OPEN.includes(c) ? "open" : CLOSE.includes(c) ? "close" : c === "," ? "comma" : "mark", at, at + c.length);
    }
  }
  return out;
}

/** Where the proofs in a definition's text are, read off the text alone (offsets, end exclusive):
 *  each `by` block in its value, and the tactics of `decreasing_by` (the keyword stays). A `by` in
 *  the signature is the statement's and stays, as the usage pass leaves it; where the value's start
 *  cannot be read, the whole text is searched. A `by` inside a quotation is a macro's meaning and
 *  stays. A `by` block that builds data is cut as well — the text cannot tell its goal — and a
 *  proof written as a term is not found at all. */
export function textProofs(text: string): [number, number][] {
  const ps = pieces(text);
  const from = valueStart(text) ?? 0;
  const out: [number, number][] = [];
  // the brackets open where the reading is, each whether it is a quotation's
  const open: boolean[] = [];
  for (let k = 0; k < ps.length; ) {
    const p = ps[k];
    if (p.t === "word" && (p.text === "by" || p.text === "decreasing_by") && p.at >= from && !open.includes(true)) {
      const b = tacticBlock(text, ps, k, open.length > 0);
      const start = p.text === "by" ? p.at : b.first;
      if (start !== null && start < b.end) out.push([start, b.end]);
      k = b.next;
      continue;
    }
    if (p.t === "open") open.push(p.quote);
    else if (p.t === "close") open.pop();
    k++;
  }
  return out;
}

/** The tactic block the `by` or `decreasing_by` at `ps[k]` opens, read as Lean lays it out: it runs
 *  to the first piece, at its own bracket depth, that closes the bracket it is in, or is a comma in
 *  that bracket (`enclosed`), a word of BLOCK_ENDS, a `then` or `else` of no `if` in the block, or
 *  the first of a line that starts no further right than the line the block starts on (its tactics'
 *  column less one, where they start on a line of their own further left than that). Where its last
 *  piece ends, where its first piece after the keyword starts (null where it has none), and the
 *  index of the first piece after it. */
function tacticBlock(text: string, ps: readonly Piece[], k: number, enclosed: boolean): { end: number; first: number | null; next: number } {
  const key = ps[k];
  const lineStart = text.lastIndexOf("\n", key.at - 1) + 1;
  let edge = /^[ \t]*/.exec(text.slice(lineStart))![0].length;
  let depth = 0;
  let ifs = 0;
  let end = key.end;
  let first: number | null = null;
  let j = k + 1;
  for (; j < ps.length; j++) {
    const p = ps[j];
    if (first === null && p.col >= 0 && p.col <= edge) edge = p.col - 1;
    if (depth === 0) {
      if (p.t === "close" || (p.t === "comma" && enclosed) || (p.col >= 0 && p.col <= edge)) break;
      if (p.t === "word") {
        if (BLOCK_ENDS.has(p.text) || ((p.text === "then" || p.text === "else") && !ifs)) break;
        if (p.text === "if") ifs++;
        else if (p.text === "else") ifs--;
      }
    }
    if (p.t === "open") depth++;
    else if (p.t === "close") depth--;
    first ??= p.at;
    end = p.end;
  }
  return { end, first, next: j };
}
