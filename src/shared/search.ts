// The search (`/`): declarations by name first, then by what their statement says and what their
// docstring says. A reviewer asks "which statements mention Matrix.unitaryGroup?" as often as
// "where is flipAt?", and a docstring is where a paper's name and theorem number are written.
//
// Every word of the query has to be found, each in the name, the statement or the docstring. A
// declaration ranks by the weakest place it needed: all words in the name come first, then those
// that needed the statement, then those that needed the docstring. Each result shows that place
// around the word that needed it, the words marked.
//
// The texts are lowercased once per graph, offset for offset, so a keystroke is a plain substring
// scan, and a query that only adds to the last one looks through what the last one found.
//
// A unit is found by the names it folds too (ViewNode.also): `QOR.Name`, which Lean generated from
// the command that writes `QOR`, finds `QOR`, as a name does, after the declarations found by their
// own names, and the hit says which (`via`).
//
// The page's search box (web/src/search.ts) and the agent API (server/agent.ts) both search so.

export type Where = "name" | "statement" | "doc";
export const PLACES: readonly Where[] = ["name", "statement", "doc"];

/** What the search reads of a declaration. Externals carry neither statement nor docstring. */
export interface Searchable {
  name: string;
  type?: string;
  doc?: string;
  /** the declarations Lean generated from its command, folded into it */
  also?: readonly string[];
}

/** `s` lowercased with every offset kept: the few letters that lowercase to two (`İ`) stay as
 *  they are, so that a place found in the lowercase text is the same place in `s`. */
export function lowerKeepingOffsets(s: string): string {
  const l = s.toLowerCase();
  if (l.length === s.length) return l;
  let out = "";
  for (const c of s) {
    const lc = c.toLowerCase();
    out += lc.length === c.length ? lc : c;
  }
  return out;
}

/** The query's words, lowercased, each once. */
export function queryWords(q: string): string[] {
  return [...new Set(lowerKeepingOffsets(q).split(/\s+/).filter(Boolean))];
}

export class SearchIndex {
  readonly n: number;
  /** per place (name, statement, docstring), each declaration's text, "" where it has none */
  readonly text: readonly (readonly string[])[];
  /** the same, lowercased offset for offset */
  readonly lower: readonly (readonly string[])[];
  /** where the externals start: they rank after the project's declarations of the same fit */
  readonly projectCount: number;
  /** per declaration, the names it folds (Searchable.also), as they are and lowercased */
  readonly also: readonly (readonly string[])[];
  readonly alsoLower: readonly (readonly string[])[];

  constructor(nodes: readonly Searchable[], projectCount = nodes.length) {
    this.n = nodes.length;
    this.projectCount = projectCount;
    this.text = [nodes.map((v) => v.name), nodes.map((v) => v.type ?? ""), nodes.map((v) => v.doc ?? "")];
    this.lower = this.text.map((xs) => xs.map(lowerKeepingOffsets));
    this.also = nodes.map((v) => v.also ?? []);
    this.alsoLower = this.also.map((xs) => xs.map(lowerKeepingOffsets));
  }
}

export interface Hit {
  i: number;
  where: Where;
  /** lower is better, within its place */
  score: number;
  /** the word that needed this place: what its snippet is centred on */
  word: string;
  /** a name hit found through a name the declaration folds (Searchable.also): that name */
  via?: string;
}

export interface Found {
  query: string;
  words: string[];
  /** per place, best first */
  hits: Record<Where, Hit[]>;
  /** every declaration found, in the graph's order: a query that adds to this one searches only these */
  matched: Int32Array;
}

const IDENT = /[\p{L}\p{N}_'!?₀-₉ₐ-ₜ]/u;
const NOT_IDENT = /[^\p{L}\p{N}_'!?₀-₉ₐ-ₜ]/u;

/** Search the index. `within`: the declarations to look at (the last query's `matched`, when this
 *  one only adds to it); all of them when absent. */
export function search(ix: SearchIndex, query: string, within?: Int32Array): Found {
  const words = queryWords(query);
  const hits: Record<Where, Hit[]> = { name: [], statement: [], doc: [] };
  const matched: number[] = [];
  const found: Found = { query, words, hits, matched: new Int32Array(0) };
  if (!words.length) return found;
  // the longest word first: it rules out the most at the first look
  const order = [...words].sort((a, b) => b.length - a.length);
  const [names, stmts, docs] = ix.lower;
  const m = within ? within.length : ix.n;
  for (let k = 0; k < m; k++) {
    const i = within ? within[k] : k;
    const also = ix.alsoLower[i];
    /** the first name it folds that holds `w`, when its own name does not */
    const folded = (w: string) => (names[i].includes(w) ? -1 : also.findIndex((a) => a.includes(w)));
    // the weakest place a word needed (0 name, 1 statement, 2 docstring), the first word that
    // needed it, and how many did
    let tier = 0, word = order[0], need = 0, ok = true;
    for (const w of order) {
      const t = names[i].includes(w) || folded(w) >= 0 ? 0 : stmts[i].includes(w) ? 1 : docs[i].includes(w) ? 2 : -1;
      if (t < 0) {
        ok = false;
        break;
      }
      if (t > tier) [tier, word, need] = [t, w, 1];
      else if (t === tier) need++;
    }
    if (!ok) continue;
    matched.push(i);
    const ext = i >= ix.projectCount;
    let score: number;
    let via: string | undefined;
    if (tier === 0) {
      // as the search always ranked a name: the words in its last component, exactly, at its start,
      // inside it; then the project before the outside world; then the shorter name. A word found
      // in a name it folds counts as found in that name, and ranks after every declaration found by
      // its own name: a generated name (`_aux_FltRegular_CaseI_…_termR_1`) has no dots, so all of it
      // reads as a last component, and would rank its notation before `FltRegular.caseI` for
      // "caseI flt".
      let name = names[i];
      for (const w of order) {
        const a = folded(w);
        if (a >= 0) {
          name = also[a];
          via = ix.also[i][a];
          break;
        }
      }
      const last = name.slice(name.lastIndexOf(".") + 1);
      let fit = 0;
      for (const w of order) fit = Math.max(fit, last === w ? 0 : last.startsWith(w) ? 1 : last.includes(w) ? 2 : 3);
      score = (via !== undefined ? 4000 : 0) + fit * 1000 + (ext ? 500 : 0) + Math.min(400, name.length);
    } else {
      // fewer words that needed this place first (the rest are in the name), then a word found
      // whole rather than inside another, then the shorter text
      const text = (tier === 1 ? stmts : docs)[i];
      const at = text.indexOf(word);
      const whole = at === 0 || !IDENT.test(text[at - 1]);
      score = need * 1e7 + (whole ? 0 : 1e6) + Math.min(999_999, text.length);
    }
    hits[PLACES[tier]].push({ i, where: PLACES[tier], score, word, ...(via !== undefined ? { via } : {}) });
  }
  for (const w of PLACES) hits[w].sort((a, b) => a.score - b.score || a.i - b.i);
  found.matched = Int32Array.from(matched);
  return found;
}

/** Whether `next` can only find what `prev` found: it adds to it (the words grow or more come). */
export function narrows(prev: string, next: string): boolean {
  const a = lowerKeepingOffsets(prev.trim()), b = lowerKeepingOffsets(next.trim());
  return a.length > 0 && b.startsWith(a);
}

/** A piece of shown text, marked where a word of the query is. */
export interface Piece {
  text: string;
  mark: boolean;
}

/** `text` from `from` to `to`, in pieces marked where the words occur (found in `lower`, its
 *  lowercase); runs of white space become one space. */
export function marked(text: string, lower: string, words: readonly string[], from = 0, to = text.length): Piece[] {
  const ranges: [number, number][] = [];
  for (const w of words) {
    for (let at = lower.indexOf(w, Math.max(0, from - w.length + 1)); at >= 0 && at < to; at = lower.indexOf(w, at + 1)) {
      ranges.push([Math.max(from, at), Math.min(to, at + w.length)]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const pieces: Piece[] = [];
  const push = (a: number, b: number, mark: boolean) => {
    if (b > a) pieces.push({ text: text.slice(a, b).replace(/\s+/g, " "), mark });
  };
  let pos = from;
  for (let k = 0; k < ranges.length; k++) {
    let [a, b] = ranges[k];
    // overlapping words are one mark
    while (k + 1 < ranges.length && ranges[k + 1][0] <= b) b = Math.max(b, ranges[++k][1]);
    a = Math.max(a, pos);
    push(pos, a, false);
    push(a, b, true);
    pos = Math.max(pos, b);
  }
  push(pos, to, false);
  return pieces;
}

export interface Snippet {
  pieces: Piece[];
  /** text was left out before it, after it */
  before: boolean;
  after: boolean;
}

const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** A short stretch of `text` around the first `focus`, beginning at a word where one begins
 *  nearby, the words marked. `lead`: how much comes before the focus; `width`: how much in all
 *  (the row cuts what does not fit). */
export function snippet(text: string, lower: string, words: readonly string[], focus: string, width = 96, lead = 28): Snippet {
  const at = Math.max(0, lower.indexOf(focus));
  // close enough to the beginning: from the beginning
  let start = at - lead <= 12 ? 0 : at - lead;
  if (start > 0) {
    // statements name everything in full, with no space for long stretches: a dot or a bracket is
    // as good a place to begin
    const gap = text.slice(start, at).search(NOT_IDENT);
    if (gap >= 0 && gap < 12) start += gap + 1;
    // never between the two halves of a character
    else if (isLowSurrogate(text.charCodeAt(start))) start--;
  }
  let end = Math.min(text.length, Math.max(at + focus.length, start + width));
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end++;
  const pieces = marked(text, lower, words, start, end);
  // the edges of the stretch: no white space where it is not cut
  if (pieces.length && start === 0) pieces[0].text = pieces[0].text.trimStart();
  if (pieces.length && end === text.length) pieces[pieces.length - 1].text = pieces[pieces.length - 1].text.trimEnd();
  return { pieces: pieces.filter((p) => p.text), before: start > 0, after: end < text.length };
}
