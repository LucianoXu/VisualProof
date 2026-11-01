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
 *  it copies the source. A token across lines (a comment) is cut into one piece per line.
 *
 *  `first`: the line of the file the text starts at (from 1), for the source window's gutter
 *  (web/src/gutter.ts): each line carries its number as `data-n`, which the style draws beside it,
 *  outside the text. */
export function highlightLines(src: string, isRef?: (name: string, at: number) => RefAnswer, first?: number, decor?: LineDecor): string {
  const lines = tokenLines(tokenizeLean(src));
  const folds = decor?.folds ?? [];
  let ls = 0;
  return src
    .split("\n")
    .map((text, k) => {
      const indent = Math.min(/^ */.exec(text)![0].length, HANG_MAX);
      const start = ls;
      ls += text.length + 1;
      const own = decor?.line?.(k);
      const tokens = lines[k] ?? [];
      const html = folds.length ? foldedHtml(src, tokens, start, start + text.length, folds, isRef) : { html: tokens.map((t) => tokenHtml(t, isRef)).join(""), hidden: null };
      const n = first !== undefined ? ` data-n="${first + k}"` : "";
      const pf = html.hidden !== null ? ` data-pf="${html.hidden}"` : "";
      return `<span class="ln${own?.cls ?? ""}${html.hidden !== null ? " pf-l" : ""}"${n}${pf} style="--in:${indent}">${own?.lead ?? ""}${html.html}${k < lines.length - 1 ? "\n" : ""}</span>`;
    })
    .join("");
}

/** What File mode adds to the lines `highlightLines` draws (web/src/filemode.ts), never to their
 *  text: per line, classes (` hl`: the window's declaration) and what leads it (a mark drawn in the
 *  gutter, an element without text); and the proofs that fold, each `from` and `to` offsets into
 *  the text, end exclusive, apart and in order, with an id. */
export interface LineDecor {
  line?(k: number): { cls?: string; lead?: string } | undefined;
  folds?: readonly { from: number; to: number; id: string }[];
}

/** One line's tokens (the text's `start` to `end`) as HTML with the proofs `folds` in it marked
 *  (ReviewSpec, "The source window", the owner's decision of 2026-11-01): what a proof holds in a
 *  span of its own (`.pf-t`), which the style hides while proofs are folded, and where one starts a
 *  mark that stands for it (`.pf-mark`, drawn by the style: no text). The text is the line's to the
 *  character, hidden or not, so that offsets in it stay offsets in the source. `hidden`: the fold
 *  the whole line is in — begun on a line above, and nothing but spaces after its end here —, which
 *  hides the line itself. */
function foldedHtml(src: string, tokens: Token[], start: number, end: number, folds: NonNullable<LineDecor["folds"]>, isRef?: (name: string, at: number) => RefAnswer): { html: string; hidden: string | null } {
  const over = folds.find((f) => f.from < start && f.to > start);
  const hidden = over && (over.to >= end || !src.slice(over.to, end).trim()) ? over.id : null;
  const out: string[] = [];
  let open: string | null = null;
  const close = () => {
    if (open !== null) out.push("</span>");
    open = null;
  };
  for (const t of tokens) {
    let p = t.at;
    const e = t.at + t.text.length;
    while (p < e) {
      const f = folds.find((x) => x.from <= p && p < x.to);
      const next = f ? Math.min(e, f.to) : Math.min(e, ...folds.filter((x) => x.from > p).map((x) => x.from));
      if (f && open !== f.id) {
        close();
        if (p === f.from) out.push(`<button type="button" class="pf-mark" data-pf-open="${escapeHtml(f.id)}" title="Show this proof" aria-label="Show this proof"></button>`);
        out.push(`<span class="pf-t" data-pf="${escapeHtml(f.id)}">`);
        open = f.id;
      } else if (!f) close();
      out.push(tokenHtml(p === t.at && next === e ? t : { ...t, at: p, text: src.slice(p, next) }, isRef));
      p = next;
    }
  }
  close();
  // a proof that starts where its line ends (after `:=`, on the next line): its mark ends the line
  const at = folds.find((f) => f.from === end && f.to > end);
  if (at && !hidden) out.push(`<button type="button" class="pf-mark" data-pf-open="${escapeHtml(at.id)}" title="Show this proof" aria-label="Show this proof"></button>`);
  return { html: out.join(""), hidden };
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
