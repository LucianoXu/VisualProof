// Which lines of a file are a declaration's source. When the file is the one the graph was read
// from, its compiled place says so exactly (with the docstring and attributes above it). When the
// file changed since, that place means nothing any more: the declaration is looked for by name in
// the present text, and the reader is told it is not what was compiled.

/** A declaration's text in its file; `edited`: found by name in a file changed since it was
 *  compiled, so not the text the graph and the content hash are about. */
export interface DeclarationText {
  text: string;
  edited: boolean;
}

export interface Excerpt {
  /** first and last line, 0-based, inclusive */
  start: number;
  end: number;
}

const DECL = /^\s*(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|partial|unsafe|nonrec|scoped|local)\s+)*(?:theorem|lemma|def|abbrev|instance|structure|class|inductive|axiom|opaque|example|irreducible_def)\s+(\S+)/;
/** a line that starts what comes after a declaration */
const NEXT = /^(?:@\[|\/--|\/-!|--|#|(?:(?:private|protected|noncomputable|partial|unsafe|nonrec|scoped|local)\s+)*(?:theorem|lemma|def|abbrev|instance|structure|class|inductive|axiom|opaque|example|irreducible_def|namespace|section|end|open|variable|universe|attribute|set_option|mutual|macro|syntax|notation|infix|infixl|infixr|prefix|postfix|elab|deriving)\b)/;

/** Pull what belongs to the declaration from directly above `line`: attribute lines, line
 *  comments, and a whole docstring — never across a blank line, and never a line that has more on it
 *  than attributes (`@[simp] theorem id_apply … := rfl` is the declaration before, not part of this
 *  one; a blank line and that once let declarations show their neighbour's text, and record it as
 *  what a reviewer judged). Lean's own range starts at the docstring already. */
function withPreamble(lines: string[], line: number): number {
  let start = line;
  while (start > 0 && line - start < 40) {
    const above = lines[start - 1];
    if (/^\s*@\[[^\]]*\]\s*$/.test(above) || /^\s*--/.test(above)) {
      start--;
      continue;
    }
    // a docstring that ends right above: the whole of it, from its `/--`
    if (/-\/\s*$/.test(above)) {
      let k = start - 1;
      while (k > 0 && line - k < 60 && !/^\s*\/-/.test(lines[k])) k--;
      if (/^\s*\/--/.test(lines[k])) {
        start = k;
        continue;
      }
    }
    break;
  }
  return start;
}

/** The excerpt at the compiled place `range` = [line, column, endLine], 1-based lines. */
export function compiledExcerpt(lines: string[], range: readonly number[]): Excerpt {
  const l0 = Math.max(0, range[0] - 1);
  const l1 = Math.min(lines.length - 1, Math.max(l0, range[2] - 1));
  return { start: withPreamble(lines, l0), end: l1 };
}

/** Where declaration `name` is in its file's `lines`: at its compiled place `range` when the file
 *  is the text that was compiled, else found by name; null when it is not there any more. */
export function excerptOf(lines: string[], edited: boolean, name: string, range: readonly number[]): Excerpt | null {
  return edited ? findExcerpt(lines, name, range[0]) : compiledExcerpt(lines, range);
}

/** A declaration's text in its file, as the source window shows it (with its context above it,
 *  shared/context.ts, it is what an opinion records). `edited`: the file is not the text that
 *  was compiled. */
export function declarationText(lines: string[], edited: boolean, name: string, range: readonly number[]): DeclarationText | null {
  const at = excerptOf(lines, edited, name, range);
  return at && { text: lines.slice(at.start, at.end + 1).join("\n"), edited };
}

/** The declaration `name` looked for in `lines`, nearest `near` (a 1-based line) when several
 *  match; null when it is not there. */
export function findExcerpt(lines: string[], name: string, near?: number): Excerpt | null {
  const parts = name.split(".");
  const short = parts[parts.length - 1].replace(/^«|»$/g, "");
  const tail2 = parts.slice(-2).join(".");
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const m = DECL.exec(lines[i]);
    if (!m) continue;
    const declared = m[1].replace(/[«»]/g, "");
    // declared as `short` inside its namespace, or with part of its namespace in front
    if (declared !== short && declared !== tail2.replace(/[«»]/g, "") && declared !== name && !name.endsWith("." + declared)) continue;
    const score = near ? Math.abs(i + 1 - near) : i;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return null;
  let end = best;
  for (let i = best + 1; i < lines.length && i < best + 400; i++) {
    if (NEXT.test(lines[i])) break;
    end = i;
  }
  // trailing blank lines are not the declaration
  while (end > best && !lines[end].trim()) end--;
  return { start: withPreamble(lines, best), end };
}
