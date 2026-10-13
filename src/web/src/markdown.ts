// Light Markdown, rendered from escaped text: comments on declarations (ReviewSpec, "Comments",
// decided 2026-10-09) and an agent's messages in its conversation (AgentSpec decision 8). Nothing
// written becomes HTML of its own: the text is escaped first, and only the marks below make
// elements. No link is the writer's: a declaration's name in backticks links to it, and the two
// references of shared/comment.ts — a quoted opinion, quoted source lines — become controls the page
// follows; any other [text](url) stays text, `javascript:` and all.
//
// A comment: paragraphs, their line breaks kept; quotes (`>`), a quote of an opinion headed by its
// attribution, which goes to the opinion; fenced code, Lean highlighted as in the source window
// (```lean, and every code quote), a code quote headed by its file and lines, which open the source
// there; `code`; **bold**; *italics* and _italics_. A name in backticks links where it is a
// declaration's full name, or one generated from a command (it goes to the command's unit), or a
// short name that reads as one in the declaration commented on, as Lean resolves a name in the
// namespaces around it (web/src/scope.ts); anything else stays code. Names in Lean code do not
// link: what they mean depends on the `open`s of the file they were written in, which the comment
// does not carry, and a wrong link is worse than none — a code quote's header opens the source,
// where they link as Lean says.

import { attribution, blocks, parseRef, refText } from "../../shared/comment.ts";
import type { QuoteRef } from "../../shared/comment.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { escapeHtml, highlightLean } from "./highlight.ts";
import { resolver } from "./scope.ts";

/** a name of a declaration, written bare: two components at least */
const BARE_NAME = /(?<![\w.'])[A-Za-z_À-ɏ][\w'!?À-ɏ]*(?:\.[\w'!?À-ɏ]+)+/g;
/** what a name in backticks may be to link: a Lean name, dotted or not */
const NAME = /^[\p{L}\p{N}_'!?.«»₀-₉ₐ-ₜ]+$/u;
/** a link of one of the page's own schemes, inside a line */
const REF_LINK = /\[([^\]\n]+)\]\(((?:opinion|source):[^()\s]+)\)/g;
/** quotes nest at most this deep; deeper, their text is shown as written */
const MAX_DEPTH = 4;

/** Escaped text with **bold**, *italics* and _italics_; with `bare`, names of declarations written
 *  without backticks link too (`link`). */
function emphasis(text: string, link: (name: string, inner: string) => string, bare: boolean): string {
  const html = escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>");
  return bare ? html.replace(BARE_NAME, (name) => link(name, name)) : html;
}

/** One line or paragraph: `code` (a link where `link` makes one of it), the page's own references
 *  where `refs` says how to draw them, emphasis around them. */
function inline(text: string, link: (name: string, inner: string) => string, bare: boolean, refs?: (label: string, r: QuoteRef) => string): string {
  return text
    .split(/(`[^`\n]+`)/)
    .map((piece, j) => {
      if (j % 2 === 1) {
        const code = piece.slice(1, -1);
        return link(code.trim(), `<code>${escapeHtml(code)}</code>`);
      }
      if (!refs) return emphasis(piece, link, bare);
      let html = "";
      let at = 0;
      for (const m of piece.matchAll(REF_LINK)) {
        const r = parseRef(m[2]);
        if (!r) continue;
        html += emphasis(piece.slice(at, m.index), link, bare) + refs(m[1], r);
        at = m.index! + m[0].length;
      }
      return html + emphasis(piece.slice(at), link, bare);
    })
    .join("");
}

/** An agent's message in its conversation as HTML: escaped first, then a little Markdown — fenced
 *  code, `code`, **bold**, *italics* — and declarations' names, in backticks or bare, as links. */
export function renderMarkdown(text: string, resolve: (name: string) => string | null): string {
  const link = (name: string, inner: string) => {
    const full = resolve(name);
    return full ? `<a href="#" class="tk-decl" data-decl="${escapeHtml(full)}" title="${escapeHtml(full)}">${inner}</a>` : inner;
  };
  return text
    .split("```")
    .map((part, k) => {
      if (k % 2 === 1) {
        // a fenced block: its first line may name a language
        const body = part.replace(/^[\w+-]*\n/, "").replace(/\n$/, "");
        return `<pre class="tk-pre"><code>${escapeHtml(body)}</code></pre>`;
      }
      return inline(part, link, true);
    })
    .join("");
}

/** What a comment's links are resolved in: the graph's names, and what Lean generated from a
 *  command, folded into its unit. */
export type CommentGraph = Pick<Graph, "nodes" | "byName" | "foldedInto">;

/** A reference as the control the page follows: an opinion's, which goes to it; source lines',
 *  which open the source there. `label` is the writer's, escaped with its emphasis. */
function refButton(label: string, r: QuoteRef, cls: string): string {
  const title = r.kind === "opinion" ? `Go to ${r.by}'s opinion on ${r.name}` : `Open the source of ${r.name} at line${r.to > r.from ? `s ${r.from}–${r.to}` : ` ${r.from}`}`;
  return `<button type="button" class="${cls}" data-md-${r.kind === "opinion" ? "op" : "src"}="${escapeHtml(refText(r))}" title="${escapeHtml(title)}">${emphasis(label, (_, inner) => inner, false)}</button>`;
}

/** A comment on declaration `on` (null: on none the graph has) as HTML. */
export function renderComment(text: string, on: string | null, g: CommentGraph): string {
  const near = on ? resolver(g as Graph, on, null) : null;
  // a name in backticks: a full name, one folded into a unit, or a short name read where the
  // comment is
  const decl = (w: string): string | null => {
    if (!NAME.test(w)) return null;
    if (g.byName.has(w)) return w;
    const unit = g.foldedInto.get(w);
    if (unit !== undefined) return g.nodes[unit].name;
    return near?.(w) ?? null;
  };
  const link = (name: string, inner: string) => {
    const full = decl(name);
    return full ? `<button type="button" class="md-ref" data-ref="${escapeHtml(full)}" title="${escapeHtml(full)}">${inner}</button>` : inner;
  };
  const refs = (label: string, r: QuoteRef) => refButton(label, r, r.kind === "opinion" ? "md-op" : "md-src");
  const render = (src: string, depth: number): string =>
    blocks(src)
      .map((b) => {
        if (b.kind === "para") return `<p>${inline(b.lines.join("\n"), link, false, refs)}</p>`;
        if (b.kind === "quote") {
          if (depth >= MAX_DEPTH) return `<p>${escapeHtml(b.lines.map((l) => `> ${l}`).join("\n"))}</p>`;
          // a quote of an opinion: its attribution, which goes there, over what it quotes
          const by = attribution(b.lines[0]);
          if (by) return `<blockquote class="md-q quoted">${refButton(by.label, by.ref, "md-op md-by")}${render(b.lines.slice(1).join("\n"), depth + 1)}</blockquote>`;
          return `<blockquote class="md-q">${render(b.lines.join("\n"), depth + 1)}</blockquote>`;
        }
        // code: Lean highlighted, as in the source window
        const code = b.lines.join("\n");
        const lean = /^lean4?$/i.test(b.lang) || (b.head !== null && !b.lang);
        const pre = `<pre class="code md-code">${lean ? highlightLean(code) : escapeHtml(code)}</pre>`;
        return b.head ? `<div class="md-cq">${refButton(b.head.label, b.head.ref, "md-src md-cq-h")}${pre}</div>` : pre;
      })
      .join("");
  return render(text, 0);
}
