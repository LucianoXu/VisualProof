// The page's rendering of Lean source (the source and signature panes, hover cards, docs): the
// tokens of shared/lexer.ts as HTML, with the names of the graph's declarations as links. The
// exported document renders the same tokens as LaTeX (shared/doc/latex.ts).

import { tokenizeLean, tokenLines, wordKind } from "../../shared/lexer.ts";
import type { Token } from "../../shared/lexer.ts";

export { KEYWORDS } from "../../shared/lexer.ts";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** What a name links to: true (itself), a full name, nothing; or, for a name with dots whose parts
 *  mean different things (`o.elim`: a variable, then `Option.elim`), one answer per part. */
export type RefAnswer = boolean | string | null | undefined | (string | null)[];

/** `isRef`: names of declarations in the graph, given with their offset in `src`; they become
 *  links (`data-ref`) to them — to the name it returns when it returns one (a short name resolved
 *  to its full one). */
export function highlightLean(src: string, isRef?: (name: string, at: number) => RefAnswer): string {
  return tokenizeLean(src)
    .map((t) => tokenHtml(t, isRef))
    .join("");
}

/** One token as HTML: a word a link where `isRef` says, the others by their kind. */
function tokenHtml(t: Token, isRef?: (name: string, at: number) => RefAnswer): string {
  const span = (cls: string, text: string) => `<span class="tk-${cls}">${escapeHtml(text)}</span>`;
  const link = (word: string, to: string) =>
    `<span class="tk-ref${/^[A-Z]/.test(word) ? " tk-type" : ""}" data-ref="${escapeHtml(to)}">${escapeHtml(word)}</span>`;
  const plain = (word: string) => {
    const k = wordKind(word);
    return k === "ident" ? escapeHtml(word) : span(k, word);
  };
  switch (t.kind) {
    case "text":
      return escapeHtml(t.text);
    case "keyword":
    case "type":
    case "ident":
    case "sorry": {
      const word = t.text;
      const ref = isRef?.(word, t.at);
      const parts = word.split(".");
      if (Array.isArray(ref) && ref.length === parts.length) return parts.map((p, k) => (ref[k] ? link(p, ref[k]) : plain(p))).join(".");
      if (ref && !Array.isArray(ref)) return link(word, typeof ref === "string" ? ref : word);
      return plain(word);
    }
    default:
      return span(t.kind, t.text);
  }
}

/** the most indentation a wrapped line's continuations keep: a deeply indented line in a narrow
 *  window keeps room for its text */
const HANG_MAX = 24;

/** Lean highlighted as `highlightLean` does, each line in an element of its own (`.ln`) that carries
 *  its indentation (`--in`, in characters, at most HANG_MAX), so that a line wrapped to the window's
 *  width hangs its continuations a few characters further in (web/style.css). The text is the
 *  source's to the character, its line breaks included — each at the end of its line's element —
 *  so that offsets in it are offsets in the source (web/src/sourcewin.ts, positionAt) and copying
 *  it copies the source. A token across lines (a comment) is cut into one piece per line. */
export function highlightLines(src: string, isRef?: (name: string, at: number) => RefAnswer): string {
  const lines = tokenLines(tokenizeLean(src));
  return src
    .split("\n")
    .map((text, k) => {
      const indent = Math.min(/^ */.exec(text)![0].length, HANG_MAX);
      const html = (lines[k] ?? []).map((t) => tokenHtml(t, isRef)).join("");
      return `<span class="ln" style="--in:${indent}">${html}${k < lines.length - 1 ? "\n" : ""}</span>`;
    })
    .join("");
}

/** Docstrings are Markdown; this renders the part that matters in a side panel: paragraphs,
 *  code spans and blocks, emphasis. Everything is escaped first. */
/** Lean's hover text (markdown): code blocks highlighted, `***` as rules, the rest as a doc. */
export function renderHover(md: string, isRef?: (name: string, at: number) => RefAnswer): string {
  let html = "";
  let at = 0;
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  const prose = (t: string) => {
    for (const part of t.split(/^\s*\*\*\*\s*$/m)) {
      if (part.trim()) html += renderDoc(part);
      html += "<hr>";
    }
    html = html.replace(/(<hr>)+$/, "");
  };
  for (let m = fence.exec(md); m; m = fence.exec(md)) {
    prose(md.slice(at, m.index));
    html += `<pre class="code">${highlightLean(m[1].replace(/\n$/, ""), isRef)}</pre>`;
    at = m.index + m[0].length;
  }
  prose(md.slice(at));
  return html.replace(/^(<hr>)+/, "");
}

export function renderDoc(md: string): string {
  const blocks = md.trim().split(/\n```/);
  let html = "";
  blocks.forEach((b, k) => {
    if (k % 2 === 1) {
      const nl = b.indexOf("\n");
      html += `<pre class="code">${highlightLean(b.slice(nl + 1))}</pre>`;
      return;
    }
    for (const para of b.split(/\n\s*\n/)) {
      if (!para.trim()) continue;
      let t = escapeHtml(para.trim());
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
      html += `<p>${t}</p>`;
    }
  });
  return html;
}
