// The InfoView (ReviewSpec, "The InfoView"; the owner's decisions of 2026-11-01): what Lean's
// language server says of the goals at a place of a file — before the tactic there, and after it —
// and of the expected type of the term there, as the server gives it (server/hover.ts, read from
// Lean's answers by server/goals.ts) and the page draws it (web/src/infoview.ts). Nothing of it is
// precomputed: the usage pass elaborates without proofs, so only the language server, which
// elaborates the whole file, knows the goals.
//
// Lean is asked at positions alone. Which positions is read here from the text, as Lean would split
// a line into tactics: the tactic a place is in runs from just after the `by` or the separator
// before it (`;`, `<;>`, a case's `=>`, a focusing dot) to the separator after it, at the same depth
// of brackets. Lean's own rule (`goalsAt?`) gives the goals before a tactic at its first character
// and the goals after it from just past its first character to its end, so the goals before are
// asked at the tactic's first character and those after at its end. Where the text is read wrong
// the answer is still Lean's own at that place, as an editor would show it there.

/** Lean's text, with the subterms it can tell more of tagged: a piece of text, pieces one after
 *  another, or a subterm — `k`, the number the server gives it in its answer, by which the page asks
 *  what it is (its type, its doc), and `d`, how it changes across the tactic, as Lean's goal diff
 *  says. Lean's plain answers have no tags. */
export type Tagged = string | Tagged[] | { k: number; t: Tagged; d?: Change };

/** How a subterm changes across the tactic (Lean's `DiffTag`): before it, what will; after it, what
 *  did. */
export type Change = "wasChanged" | "willChange" | "wasInserted" | "willInsert" | "wasDeleted" | "willDelete";
export const CHANGES: readonly Change[] = ["wasChanged", "willChange", "wasInserted", "willInsert", "wasDeleted", "willDelete"];

/** A hypothesis: its names (several of one type, as Lean groups them), its type, its value for a
 *  `let`; whether the tactic adds it (after) or takes it away (before). */
export interface Hyp {
  names: string[];
  type: Tagged;
  val?: Tagged;
  d?: "inserted" | "removed";
}

/** A goal: its case, its hypotheses, what it says (after `⊢`, or `|` in `conv`); whether the tactic
 *  adds it or closes it. */
export interface Goal {
  case?: string;
  hyps: Hyp[];
  type: Tagged;
  /** what Lean writes before the type: "⊢ " (a conv goal: "| ") */
  prefix?: string;
  d?: "inserted" | "removed";
}

/** The expected type of the term at a place, with the hypotheses in scope there, and where the term
 *  is: [line, character, endLine, endCharacter], from 0, in UTF-16 units as Lean counts. */
export interface TermGoal {
  hyps: Hyp[];
  type: Tagged;
  range: [number, number, number, number];
}

/** Where the tactic at a place is, in its line: its first character and the one past its last. */
export interface TacticSpan {
  line: number;
  from: number;
  to: number;
}

/** What the server answers of the goals at a place (GET /api/hover/goals). */
export interface GoalsAnswer {
  /** the tactic the place is in, read from the text; null where the line holds no code */
  tactic?: TacticSpan | null;
  /** Lean's goals before the tactic and after it; null where it has none there (no tactic block) */
  before?: Goal[] | null;
  after?: Goal[] | null;
  /** the expected type of the term at the place; null where there is none */
  term?: TermGoal | null;
  /** widgets Lean has at the place: how many. They are never drawn (SECURITY.md): their JavaScript
   *  is the project's code, and would run in every reader's browser */
  widgets?: number;
  /** the subterms are tagged, and what each is can be asked (Lean's interactive goals, by its RPC);
   *  false: Lean's plain text */
  interactive?: boolean;
  /** Lean has not elaborated that far yet: how far it has (the first line it is still on, from 0) */
  pending?: { line: number; of: number };
  /** why there is no answer: Lean could not be asked, or the file is not the build's */
  error?: string;
  /** the file is not the text the graph was compiled from: no goals are shown (why) */
  off?: string;
  /** the page shows another text than the file holds now: it reads the source again */
  stale?: boolean;
}

/** What Lean says of a subterm of the goals (GET /api/hover/goals/info): the term with its implicit
 *  arguments, its type, and its constant's doc. */
export interface SubtermInfo {
  expr?: string;
  type?: string;
  doc?: string;
  pending?: { line: number; of: number };
  error?: string;
  stale?: boolean;
}

/** A tagged text as plain text. */
export function flatten(t: Tagged): string {
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.map(flatten).join("");
  return flatten(t.t);
}

/** The text of a goal as Lean writes it in its plain answer: the case, each hypothesis, the type. */
export function goalText(g: Goal): string {
  const hyps = g.hyps.map((h) => `${h.names.join(" ")} : ${flatten(h.type)}${h.val !== undefined ? ` := ${flatten(h.val)}` : ""}`);
  return [...(g.case ? [`case ${g.case}`] : []), ...hyps, `${g.prefix ?? "⊢ "}${flatten(g.type)}`].join("\n");
}

const OPEN = "([{⟨⦃⟦";
const CLOSE = ")]}⟩⦄⟧";

/** One line's characters as the tactic reader sees them: the code's extent (comments and the
 *  spaces around it left out), the bracket depth before each character, and where the separators
 *  between tactics are. Strings and comments hold no brackets nor separators. */
function readLine(line: string): { start: number; end: number; depth: number[]; seps: { at: number; len: number; kind: "sep" | "by" | "arrow" | "bar" }[] } {
  const depth: number[] = new Array(line.length + 1).fill(0);
  const seps: { at: number; len: number; kind: "sep" | "by" | "arrow" | "bar" }[] = [];
  let end = line.length;
  let d = 0;
  let i = 0;
  const word = /[\p{L}\p{N}_'!?.₀-₉ₐ-ₜ]/u;
  while (i < line.length) {
    const c = line[i];
    depth[i] = d;
    // a comment ends the line's code
    if ((c === "-" && line[i + 1] === "-") || (c === "/" && line[i + 1] === "-")) {
      if (c === "/") {
        const close = line.indexOf("-/", i + 2);
        if (close >= 0) {
          // a comment closed on the line: what follows it is code
          for (let j = i; j < close + 2; j++) depth[j] = d;
          i = close + 2;
          continue;
        }
      }
      end = i;
      break;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j += line[j] === "\\" ? 2 : 1;
      for (let k = i; k <= Math.min(j, line.length - 1); k++) depth[k] = d;
      i = j + 1;
      continue;
    }
    if (word.test(c) && !(c === "." && !word.test(line[i + 1] ?? ""))) {
      let j = i;
      while (j < line.length && word.test(line[j])) j++;
      if (line.slice(i, j) === "by" && !word.test(line[i - 1] ?? "")) seps.push({ at: i, len: 2, kind: "by" });
      for (let k = i; k < j; k++) depth[k] = d;
      i = j;
      continue;
    }
    if (OPEN.includes(c)) d++;
    else if (CLOSE.includes(c)) d--;
    else if (line.startsWith("<;>", i)) {
      seps.push({ at: i, len: 3, kind: "sep" });
      depth[i + 1] = depth[i + 2] = d;
      i += 3;
      continue;
    } else if (c === ";") seps.push({ at: i, len: 1, kind: "sep" });
    else if (c === "=" && line[i + 1] === ">") {
      seps.push({ at: i, len: 2, kind: "arrow" });
      depth[i + 1] = d;
      i += 2;
      continue;
    } else if (c === "|" && line[i + 1] !== "|" && line[i + 1] !== ">" && line[i - 1] !== "|" && line[i - 1] !== "<") seps.push({ at: i, len: 1, kind: "bar" });
    i++;
  }
  depth[line.length] = d;
  while (end > 0 && /\s/.test(line[end - 1])) end--;
  let start = 0;
  while (start < end && /\s/.test(line[start])) start++;
  return { start, end, depth, seps: seps.filter((s) => s.at < end) };
}

/** The tactic a place of a line is in, as Lean would split the line (above): its first character
 *  and the one past its last, focusing dots left out; null where the line holds no code. A place
 *  past the code's end (the caret after it, a comment) is in the line's last tactic. */
export function tacticSpan(line: string, ch: number): { from: number; to: number } | null {
  const { start, end, depth, seps } = readLine(line);
  if (start >= end) return null;
  const at = Math.max(start, Math.min(ch, end - 1));
  // the innermost `by` whose block holds the place: no bracket closes below its depth between them
  let blockStart = start;
  let D = depth[start];
  for (const s of seps) {
    if (s.kind !== "by" || s.at + s.len > at) continue;
    let inside = true;
    for (let j = s.at; j < at; j++) if (depth[j + 1] < depth[s.at]) inside = false;
    if (inside && s.at + s.len >= blockStart) {
      blockStart = s.at + s.len;
      D = depth[s.at];
    }
  }
  // its separators at the block's depth, read from its start: `;` and `<;>`; a match arm's `|` where
  // arms are (after `with`, or another arm), not an absolute value's; and a `=>` that ends a case's
  // head (`| succ n ih =>`, `case h =>`, `next =>`), not a `fun x =>`, whose body is a term. A `|`
  // begins the head its `=>` ends, so the head is read from it
  const cuts: { at: number; past: number }[] = [];
  let last = blockStart;
  let armed = false;
  for (const s of seps) {
    if (s.kind === "by" || s.at < blockStart || depth[s.at] !== D) continue;
    const before = line.slice(last, s.at).trim();
    if (s.kind === "sep") cuts.push({ at: s.at, past: s.at + s.len });
    else if (s.kind === "bar") {
      if (!(armed || before === "" || /(^|\s)with$/.test(before))) continue;
      armed = true;
      cuts.push({ at: s.at, past: s.at });
    } else if (/^(\||case\b|next\b)/.test(before)) cuts.push({ at: s.at, past: s.at + s.len });
    else continue;
    last = cuts[cuts.length - 1].past;
  }
  let from = blockStart;
  let to = end;
  for (const c of cuts) {
    if (c.at < at && c.past <= at) from = Math.max(from, c.past);
    else if (c.at >= at) {
      to = Math.min(to, c.at);
      break;
    }
  }
  // a bracket that closes the block ends it
  for (let j = at; j < to; j++)
    if (CLOSE.includes(line[j]) && depth[j] <= D && depth[j + 1] < D) {
      to = j;
      break;
    }
  // spaces, and the focusing dots at its head (`· simp`), are not the tactic
  while (from < to && /[\s·.]/.test(line[from]) && !(line[from] === "." && /[\p{L}_]/u.test(line[from + 1] ?? ""))) from++;
  while (to > from && /\s/.test(line[to - 1])) to--;
  if (from >= to) return { from: Math.min(Math.max(start, at), end), to: Math.min(Math.max(start, at), end) };
  return { from, to };
}

/** Whether each line of `text` holds code: something outside comments and docstrings, which spread
 *  over lines. */
export function codeLines(text: string): boolean[] {
  const lines = text.split("\n");
  const out = lines.map(() => false);
  let inComment = 0;
  lines.forEach((l, k) => {
    let i = 0;
    while (i < l.length) {
      if (inComment) {
        if (l.startsWith("-/", i)) {
          inComment--;
          i += 2;
        } else if (l.startsWith("/-", i)) {
          inComment++;
          i += 2;
        } else i++;
        continue;
      }
      if (l.startsWith("/-", i)) {
        inComment++;
        i += 2;
        continue;
      }
      if (l.startsWith("--", i)) break;
      if (l[i] === '"') {
        out[k] = true;
        let j = i + 1;
        while (j < l.length && l[j] !== '"') j += l[j] === "\\" ? 2 : 1;
        i = j + 1;
        continue;
      }
      if (!/\s/.test(l[i])) out[k] = true;
      i++;
    }
  });
  return out;
}

/** The next line of code after line `k` of `text` (`dir` 1), or before it (-1), and where its code
 *  starts: what ↑ and ↓ step to in the InfoView; null past the text's ends. */
export function stepLine(text: string, k: number, dir: 1 | -1): { line: number; ch: number } | null {
  const has = codeLines(text);
  const lines = text.split("\n");
  for (let j = k + dir; j >= 0 && j < lines.length; j += dir) if (has[j]) return { line: j, ch: /^\s*/.exec(lines[j])![0].length };
  return null;
}

/** One goal as Lean writes it in its plain answer (`$/lean/plainGoal`, `plainTermGoal`): an optional
 *  `case` line, hypotheses `a b : T` (or `x : T := v`), then `⊢ T` (`| T` in `conv`); what does not
 *  fit on a line goes on, indented, on the next. */
export function parsePlainGoal(s: string): Goal {
  const entries: string[] = [];
  for (const l of s.split("\n")) {
    if (entries.length && (/^\s/.test(l) || l === "")) entries[entries.length - 1] += `\n${l}`;
    else entries.push(l);
  }
  const g: Goal = { hyps: [], type: "" };
  for (const e of entries) {
    if (!g.case && !g.hyps.length && e.startsWith("case ")) g.case = e.slice(5).trim();
    else if (e.startsWith("⊢") || e.startsWith("| ")) {
      const p = e.startsWith("⊢") ? (e.startsWith("⊢ ") ? "⊢ " : "⊢") : "| ";
      g.prefix = p === "⊢" ? "⊢ " : p;
      g.type = e.slice(p.length).replace(/^\n\s*/, "");
    } else {
      const m = / :(?= |\n|$)/.exec(e);
      if (!m) continue;
      const names = e.slice(0, m.index).split(/\s+/).filter(Boolean);
      let type = e.slice(m.index + 2).replace(/^ |^\n\s*/, "");
      let val: string | undefined;
      // a `let`'s value, after a `:=` outside brackets
      let depth = 0;
      for (let i = 0; i < type.length; i++) {
        const c = type[i];
        if (OPEN.includes(c)) depth++;
        else if (CLOSE.includes(c)) depth--;
        else if (depth === 0 && type.startsWith(" := ", i)) {
          val = type.slice(i + 4);
          type = type.slice(0, i);
          break;
        }
      }
      g.hyps.push({ names, type, ...(val !== undefined ? { val } : {}) });
    }
  }
  return g;
}
