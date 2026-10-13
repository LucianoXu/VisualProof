// Prose for the exported document (shared/doc/model.ts): docstrings are Markdown, of which the
// document keeps what the page's panel renders (web/src/highlight.ts, renderDoc):
// paragraphs, code spans and fenced code blocks (highlighted as Lean), strong and emphasis — and
// lists, which docstrings use. Everything else stays text, as written: a `$…$` is not mathematics
// here, since no renderer may read what a writer typed as markup of its own. A note's text
// (`noteBlocks`) keeps what its card shows: its line breaks, and the declarations it names.

import { tokenizeLean, tokenLines } from "../lexer.ts";
import type { Block, CodeBlock, CodeLine, Inline } from "./model.ts";

/** Lean source as a block of highlighted lines (shared/lexer.ts). */
export function codeOf(text: string, from: CodeBlock["from"] = "source"): CodeBlock {
  const lines: CodeLine[] = tokenLines(tokenizeLean(text)).map((l) => l.map((t) => [t.kind, t.text]));
  return { lines, proofElided: false, from };
}

/** A paragraph's text as inline pieces: `code`, **strong**, *emphasis* or _emphasis_. Markers that
 *  do not close are text. */
export function inlines(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (t: "text" | "code" | "em" | "strong", s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (t === "text" && last?.t === "text") last.s += s;
    else out.push({ t, s });
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "`") {
      // a code span: as many backquotes close it as opened it
      let n = 1;
      while (text[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const end = text.indexOf(fence, i + n);
      if (end > i) {
        push("code", text.slice(i + n, end).replace(/^ (.*) $/s, "$1"));
        i = end + n;
        continue;
      }
      push("text", fence);
      i += n;
      continue;
    }
    if (c === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        push("strong", text.slice(i + 2, end));
        i = end + 2;
        continue;
      }
    }
    // emphasis opens before a letter and closes after one: `a * b` and `snake_case` stay text
    if ((c === "*" || c === "_") && /\S/.test(text[i + 1] ?? "") && (c === "*" || !/[\p{L}\p{N}]/u.test(text[i - 1] ?? ""))) {
      const end = text.indexOf(c, i + 1);
      if (end > i + 1 && /\S/.test(text[end - 1]) && (c === "*" || !/[\p{L}\p{N}]/u.test(text[end + 1] ?? ""))) {
        push("em", text.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    push("text", c);
    i++;
  }
  return out;
}

/** Markdown as blocks: fenced code (as Lean), lists of `-`, `*` or `+` items, paragraphs. Lines of a
 *  paragraph are joined with a space. */
export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  let items: string[] | null = null;
  const flush = () => {
    if (para.length) out.push({ t: "p", inl: inlines(para.join(" ").trim()) });
    para = [];
    if (items?.length) out.push({ t: "list", items: items.map((x) => inlines(x.trim())) });
    items = null;
  };
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (k++; k < lines.length && !lines[k].trim().startsWith(fence[1]); k++) body.push(lines[k]);
      out.push({ t: "code", code: codeOf(body.join("\n")) });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (item) {
      if (para.length) flush();
      (items ??= []).push(item[1]);
      continue;
    }
    // a line under a list item, indented, goes on with it
    if (items && /^\s+\S/.test(line)) {
      items[items.length - 1] += " " + line.trim();
      continue;
    }
    if (items) flush();
    para.push(line.trim());
  }
  flush();
  return out;
}

/** A note's text as blocks (the owner's decisions of 2026-10-12): its little Markdown carried over as
 *  the page shows it — fenced code, `code`, **bold**, *italics* — paragraphs parted by a blank line
 *  and the line breaks within one kept, as the note's card keeps them (it lists nothing: a line that
 *  starts with `-` is that line). A full declaration's name in backticks that `mention` knows (the
 *  id of the entry the document prints it as) is a `decl`, which the renderer links to where it is
 *  printed; any other is code. */
export function noteBlocks(text: string, mention: (name: string) => string | null): Block[] {
  const out: Block[] = [];
  const para = (lines: string[]) => {
    const inl: Inline[] = [];
    lines.forEach((line, k) => {
      if (k) inl.push({ t: "br", s: "" });
      for (const x of inlines(line)) {
        const id = x.t === "code" ? mention(x.s.trim()) : null;
        inl.push(id ? { t: "decl", s: x.s.trim(), id } : x);
      }
    });
    if (inl.length) out.push({ t: "p", inl });
  };
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let run: string[] = [];
  for (let k = 0; k < lines.length; k++) {
    const fence = /^\s*(```+|~~~+)/.exec(lines[k]);
    if (fence) {
      para(run);
      run = [];
      const body: string[] = [];
      for (k++; k < lines.length && !lines[k].trim().startsWith(fence[1]); k++) body.push(lines[k]);
      out.push({ t: "code", code: codeOf(body.join("\n")) });
      continue;
    }
    if (!lines[k].trim()) {
      para(run);
      run = [];
      continue;
    }
    run.push(lines[k].trim());
  }
  para(run);
  return out;
}
