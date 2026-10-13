// A small Lean 4 tokenizer: comments, docstrings, strings, keywords, numbers, attributes, a few
// operators, `sorry`. Enough to read by; it is not the elaborator's view of the text. The page
// renders its tokens as HTML (web/src/highlight.ts), the exported document as LaTeX
// (shared/doc/latex.ts), so that the two highlight alike.

export const KEYWORDS = new Set(
  (
    "theorem lemma def abbrev instance structure class inductive axiom opaque example where " +
    "extends deriving with match fun λ let in have show from by at calc do if then else for " +
    "return namespace section end open variable universe import noncomputable private " +
    "protected partial unsafe mutual termination_by decreasing_by local scoped attribute " +
    "macro syntax notation infix infixl infixr prefix postfix set_option omit include irreducible_def " +
    "macro_rules elab_rules elab declare_syntax_cat " +
    "Type Prop Sort forall exists ∀ ∃ Π Σ"
  ).split(/\s+/),
);

/** What a token is. `ident`: a name that is no keyword and starts with a lower-case letter; `type`:
 *  one that starts with a capital (a type, by Lean's conventions); `text`: everything else
 *  (spaces, punctuation). */
export type TokenKind = "keyword" | "type" | "ident" | "comment" | "doc" | "string" | "number" | "attr" | "op" | "sorry" | "text";

export interface Token {
  kind: TokenKind;
  text: string;
  /** where it starts in the source, in UTF-16 units */
  at: number;
}

/** The kind of a word, as a token of its own. */
export function wordKind(word: string): TokenKind {
  return word === "sorry" || word === "admit" ? "sorry" : KEYWORDS.has(word) ? "keyword" : /^[A-Z]/.test(word) ? "type" : "ident";
}

/** `src` as tokens, in order; their texts joined are `src`. A name with dots is one token. */
export function tokenizeLean(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  let text = -1;
  const push = (kind: TokenKind, from: number, to: number) => {
    if (text >= 0) {
      out.push({ kind: "text", text: src.slice(text, from), at: text });
      text = -1;
    }
    out.push({ kind, text: src.slice(from, to), at: from });
  };
  while (i < n) {
    const ch = src[i];
    // block comment, nested
    if (ch === "/" && src[i + 1] === "-") {
      let depth = 0;
      let j = i;
      while (j < n) {
        if (src[j] === "/" && src[j + 1] === "-") {
          depth++;
          j += 2;
        } else if (src[j] === "-" && src[j + 1] === "/") {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else j++;
      }
      push(src.startsWith("/--", i) || src.startsWith("/-!", i) ? "doc" : "comment", i, j);
      i = j;
      continue;
    }
    if (ch === "-" && src[i + 1] === "-") {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? n : j;
      push("comment", i, end);
      i = end;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      const end = Math.min(n, j + 1);
      push("string", i, end);
      i = end;
      continue;
    }
    if (/[0-9]/.test(ch) && !/[\p{L}_]/u.test(src[i - 1] ?? "")) {
      let j = i;
      while (j < n && /[0-9a-fA-Fx_.]/.test(src[j])) j++;
      push("number", i, j);
      i = j;
      continue;
    }
    if (/[\p{L}_«]/u.test(ch)) {
      let j = i;
      if (ch === "«") j = src.indexOf("»", i) + 1 || n;
      while (j < n && /[\p{L}\p{N}_'!?.₀-₉ₐ-ₜ«»]/u.test(src[j])) {
        if (src[j] === "«") j = src.indexOf("»", j) + 1 || n;
        else j++;
      }
      // a trailing dot belongs to the next token
      while (j > i + 1 && src[j - 1] === ".") j--;
      push(wordKind(src.slice(i, j)), i, j);
      i = j;
      continue;
    }
    if (ch === "@" && src[i + 1] === "[") {
      const j = src.indexOf("]", i);
      const end = j < 0 ? n : j + 1;
      push("attr", i, end);
      i = end;
      continue;
    }
    if ("∀∃λ→↔∧∨¬≤≥≠∘×".includes(ch)) {
      push("op", i, i + 1);
      i++;
      continue;
    }
    if (text < 0) text = i;
    i++;
  }
  if (text >= 0) out.push({ kind: "text", text: src.slice(text), at: text });
  return out;
}

/** Tokens split into lines: a token across a line break (a block comment, a docstring, a string)
 *  becomes one piece per line, of the same kind. No line holds a newline; empty pieces are dropped. */
export function tokenLines(tokens: readonly Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const t of tokens) {
    const parts = t.text.split("\n");
    let at = t.at;
    parts.forEach((p, k) => {
      if (k) lines.push([]);
      if (p) lines[lines.length - 1].push({ kind: t.kind, text: p, at });
      at += p.length + 1;
    });
  }
  return lines;
}
