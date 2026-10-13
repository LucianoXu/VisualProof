// What a comment on a declaration is (ReviewSpec, "Comments", decided 2026-10-09): plain text, kept
// in the logs as written and given to agents as written, that the page reads as light Markdown —
// quotes, code, bold, italics, declarations' names in backticks (web/src/markdown.ts renders it).
// Two kinds of quote carry a reference the page follows:
//
// - a quote of an earlier opinion is a Markdown quote whose first line, the attribution, links to
//   it: `> [**Alice** (2026-10-09)](opinion:Fermat42.comm#Alice@2026-10-09T08:12:30.123Z):`;
// - a quote of source code is a fenced Lean block under a header that links to the lines:
//   `[Mathlib/NumberTheory/FLT/Four.lean:34–37](source:Fermat42.comm#L34-L37)`.
//
// Both are ordinary Markdown links with a scheme only the page interprets, so that an export or an
// agent reads sensible Markdown and the logs stay text. A part of a reference is percent-encoded
// only where it would end the link or the part, so that names stay readable.
//
// This is the format alone, with no page in it: the references both ways, the blocks a comment is
// made of, what a quote of an opinion keeps, a quote of source lines, and where either goes in the
// text being written; tested in test/comment.test.ts.

/** the longest comment, in UTF-16 units, as the server takes it (server/reviewapi.ts,
 *  server/agent.ts, `invalid` in shared/review.ts) */
export const MAX_COMMENT = 10000;
/** a quote of an opinion keeps at most this many lines of its comment, and this many characters */
export const QUOTE_LINES = 4;
export const QUOTE_CHARS = 300;

export interface OpinionRef {
  kind: "opinion";
  /** the declaration the opinion is on, who gave it and when (ISO), which name it among a
   *  declaration's opinions */
  name: string;
  by: string;
  at: string;
}

export interface SourceRef {
  kind: "source";
  /** the declaration whose source the lines are of, and the lines, from 1, in its file as it was
   *  when they were quoted */
  name: string;
  from: number;
  to: number;
}

export type QuoteRef = OpinionRef | SourceRef;

/** what would end a link or a part of a reference: encoded where it is part of one */
const UNSAFE = /[\s()[\]#@%<>"'`\\\p{Cc}]/gu;
const encode = (s: string) =>
  s.replace(UNSAFE, (c) => [...new TextEncoder().encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join(""));
const decode = (s: string): string | null => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

/** `opinion:<name>#<by>@<at>`: the opinion `by` gave on `name` at `at`. */
export function opinionRef(name: string, by: string, at: string): string {
  return `opinion:${encode(name)}#${encode(by)}@${encode(at)}`;
}

/** `source:<name>#L<from>-L<to>` (one line: `#L<from>`): lines of the file declaration `name` is
 *  in, from 1. */
export function sourceRef(name: string, from: number, to: number): string {
  return `source:${encode(name)}#L${from}${to > from ? `-L${to}` : ""}`;
}

/** what a time in a reference looks like: as the logs write it */
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/;
const fine = (s: string | null, max: number): s is string => s !== null && s.length > 0 && s.length <= max && !/\p{Cc}/u.test(s);

/** A reference read back: an opinion's or source lines', or null for anything else (another
 *  scheme, a part that does not decode, a time that is not one, lines that are not). */
export function parseRef(url: string): QuoteRef | null {
  const op = /^opinion:([^#@\s]+)#([^#@\s]+)@([^#@\s]+)$/.exec(url);
  if (op) {
    const [name, by, at] = [decode(op[1]), decode(op[2]), decode(op[3])];
    if (!fine(name, 2000) || !fine(by, 120) || !fine(at, 40) || !ISO.test(at)) return null;
    return { kind: "opinion", name, by, at };
  }
  const src = /^source:([^#@\s]+)#L([1-9]\d{0,6})(?:-L([1-9]\d{0,6}))?$/.exec(url);
  if (src) {
    const name = decode(src[1]);
    const from = Number(src[2]);
    const to = src[3] === undefined ? from : Number(src[3]);
    if (!fine(name, 2000) || to < from) return null;
    return { kind: "source", name, from, to };
  }
  return null;
}

/** A reference written out again: the one form the page puts in its own attributes. */
export function refText(r: QuoteRef): string {
  return r.kind === "opinion" ? opinionRef(r.name, r.by, r.at) : sourceRef(r.name, r.from, r.to);
}

// ---------------------------------------------------------------- the blocks of a comment

/** One block of a comment: a paragraph's lines; a quote's text, its `>` taken off (blocks again);
 *  a fenced block, with its language, its lines, whether it was closed, and — a code quote — the
 *  header line above it that links to the lines it quotes. */
export type Block =
  | { kind: "para"; lines: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "fence"; lang: string; lines: string[]; closed: boolean; head: { line: string; label: string; ref: SourceRef } | null };

const FENCE = /^ {0,3}(`{3,})([^`]*)$/;
const QUOTE = /^ {0,3}>/;
/** a line that is a link and nothing else: a code quote's header, a quote's attribution */
const LINK_LINE = /^\[([^\]\n]+)\]\(((?:opinion|source):[^()\s]+)\):?\s*$/;

/** A code quote's header: the line, its label and where it links to; null for any other line. */
function sourceHead(line: string): { line: string; label: string; ref: SourceRef } | null {
  const m = LINK_LINE.exec(line);
  const ref = m ? parseRef(m[2]) : null;
  return m && ref?.kind === "source" ? { line, label: m[1], ref } : null;
}

/** A quote's attribution, its first line: who said it, linking to the opinion; null for any
 *  other line. */
export function attribution(line: string): { label: string; ref: OpinionRef } | null {
  const m = LINK_LINE.exec(line);
  const ref = m ? parseRef(m[2]) : null;
  return m && ref?.kind === "opinion" ? { label: m[1], ref } : null;
}

/** The blocks of a comment, as Markdown reads them: a fence runs to a line of at least as many
 *  backticks (or to the end), a quote is the lines that start with `>`, a paragraph runs to a
 *  blank line or to either; a line linking to source lines right above a fence is that fence's
 *  header. Blank lines only separate. */
export function blocks(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const out: Block[] = [];
  const opens = (k: number) => k < lines.length && FENCE.test(lines[k]);
  const fence = (k: number, head: { line: string; label: string; ref: SourceRef } | null): number => {
    const m = FENCE.exec(lines[k])!;
    const n = m[1].length;
    const body: string[] = [];
    let j = k + 1;
    for (; j < lines.length; j++) {
      const c = /^ {0,3}(`{3,})\s*$/.exec(lines[j]);
      if (c && c[1].length >= n) break;
      body.push(lines[j]);
    }
    const closed = j < lines.length;
    out.push({ kind: "fence", lang: m[2].trim().split(/\s+/)[0] ?? "", lines: body, closed, head });
    return closed ? j + 1 : j;
  };
  let k = 0;
  while (k < lines.length) {
    const l = lines[k];
    if (opens(k)) {
      k = fence(k, null);
      continue;
    }
    const head = opens(k + 1) ? sourceHead(l) : null;
    if (head) {
      k = fence(k + 1, head);
      continue;
    }
    if (QUOTE.test(l)) {
      const q: string[] = [];
      for (; k < lines.length && QUOTE.test(lines[k]); k++) q.push(lines[k].replace(/^ {0,3}> ?/, ""));
      out.push({ kind: "quote", lines: q });
      continue;
    }
    if (!l.trim()) {
      k++;
      continue;
    }
    const p: string[] = [];
    for (; k < lines.length && lines[k].trim() && !opens(k) && !QUOTE.test(lines[k]) && !(opens(k + 1) && sourceHead(lines[k])); k++) p.push(lines[k]);
    out.push({ kind: "para", lines: p });
  }
  return out;
}

// ---------------------------------------------------------------- quoting

/** The longest run of backticks in `lines`: a fence around them is longer, so that none of them
 *  closes it. */
const longestTicks = (lines: string[]) => Math.max(0, ...lines.map((l) => Math.max(0, ...(l.match(/`+/g) ?? []).map((t) => t.length))));

/** `s` cut to at most `n` characters, at a space where one is near the end, never inside a
 *  surrogate pair. */
function cut(s: string, n: number): string {
  let at = s.lastIndexOf(" ", n);
  if (at < n * 0.6) at = n;
  if (/[\uD800-\uDBFF]/.test(s[at - 1] ?? "")) at--;
  return s.slice(0, at).trimEnd();
}

/** What a quote keeps of a comment: the commenter's own words — the quotes in it left out (the
 *  opinions they quote are a click away from it), a code quote's code too, under its header —
 *  at most QUOTE_LINES lines and QUOTE_CHARS characters, "…" where it was cut. A fence it cuts
 *  into is closed. */
export function quoteBody(comment: string): string[] {
  const out: string[] = [];
  let lines = 0;
  let chars = 0;
  let cutShort = false;
  const full = () => lines >= QUOTE_LINES || chars >= QUOTE_CHARS;
  /** one line kept, cut where the characters run out */
  const take = (l: string): boolean => {
    if (full()) {
      cutShort = true;
      return false;
    }
    const left = QUOTE_CHARS - chars;
    const s = l.length > left ? `${cut(l, left)}…` : l;
    if (s !== l) cutShort = true;
    out.push(s);
    lines++;
    chars += s.length;
    return true;
  };
  for (const b of blocks(comment)) {
    if (b.kind === "quote") continue;
    if (full()) {
      cutShort = true;
      break;
    }
    if (out.length) out.push("");
    if (b.kind === "para") for (const l of b.lines) take(l);
    else if (b.head) take(b.head.line);
    else {
      const ticks = "`".repeat(Math.max(3, longestTicks(b.lines) + 1));
      out.push(`${ticks}${b.lang}`);
      for (const l of b.lines) if (!take(l)) break;
      out.push(ticks);
    }
  }
  while (out.length && !out[out.length - 1]) out.pop();
  if (cutShort && !out[out.length - 1]?.endsWith("…")) out.push("…");
  return out.length ? out : ["…"];
}

/** An opinion as `quoteOpinion` quotes it. */
export interface Quoted {
  by: string;
  at: string;
  agent?: boolean;
  comment: string;
}

/** A quote of an opinion on declaration `name`, to write a comment under: its attribution — who,
 *  an agent marked so, and the day — linking to it, then what quoteBody keeps of its comment. */
export function quoteOpinion(name: string, o: Quoted): string {
  // what would break the link or the bold is left out of the name shown; the reference has it whole
  const who = o.by.replace(/[[\]*`\\\n]/g, "").trim() || "?";
  const head = `[**${who}** (${o.agent ? "agent, " : ""}${o.at.slice(0, 10)})](${opinionRef(name, o.by, o.at)}):`;
  return [head, ...quoteBody(o.comment)].map((l) => (l ? `> ${l}` : ">")).join("\n");
}

/** The lines `first`–`last` (indices into `lines`, from 0) of the code a source window shows — the
 *  text of declaration `name`, which starts at line `start` (from 0) of `file` — quoted: a header
 *  giving the file and the lines, linking to them, over a fenced Lean block of the lines as they
 *  are written. */
export function quoteCode(q: { file: string; name: string; start: number; lines: string[]; first: number; last: number }): string {
  const body = q.lines.slice(q.first, q.last + 1);
  const from = q.start + q.first + 1;
  const to = q.start + q.last + 1;
  const ticks = "`".repeat(Math.max(3, longestTicks(body) + 1));
  const label = `${q.file.replace(/\[/g, "(").replace(/\]/g, ")")}:${from}${to > from ? `–${to}` : ""}`;
  return `[${label}](${sourceRef(q.name, from, to)})\n${ticks}lean\n${body.join("\n")}\n${ticks}`;
}

/** The lines of `text` a selection from offset `from` to `to` touches, whole (indices from 0), or
 *  null when it holds nothing. Only line breaks count: a line wrapped on the screen is one line.
 *  A selection that starts on a line's break, or ends just after one (a line selected with its
 *  break, as a triple click does), does not take the line it only touches there. */
export function selectedLines(text: string, from: number, to: number): { first: number; last: number } | null {
  if (to < from) [from, to] = [to, from];
  from = Math.max(0, Math.min(from, text.length));
  to = Math.max(0, Math.min(to, text.length));
  if (to <= from) return null;
  const lineAt = (off: number) => {
    let n = 0;
    for (let k = 0; k < off; k++) if (text.charCodeAt(k) === 10) n++;
    return n;
  };
  let first = lineAt(from);
  let last = lineAt(to);
  if (text[from] === "\n" && from + 1 < to) first++;
  if (last > first && text[to - 1] === "\n") last--;
  return { first, last: Math.max(first, last) };
}

/** Where quoted lines `from`–`to` of a file (from 1) are in a declaration's text now — `lines`,
 *  which start at line `start` of the file (from 0) — as indices into `lines`: where they were, if
 *  the text there reads as `quoted` does; else where `quoted` is found in it (the file changed above
 *  it since); else what is left of where they were; null when nothing is. */
export function locateLines(lines: string[], start: number, from: number, to: number, quoted?: string[] | null): [number, number] | null {
  const a = from - 1 - start;
  const b = to - 1 - start;
  if (quoted?.length) {
    const at = (k: number) => quoted.every((q, d) => lines[k + d]?.trimEnd() === q.trimEnd());
    if (a >= 0 && at(a)) return [a, a + quoted.length - 1];
    for (let k = 0; k + quoted.length <= lines.length; k++) if (at(k)) return [k, k + quoted.length - 1];
  }
  const x = Math.max(a, 0);
  const y = Math.min(b, lines.length - 1);
  return x <= y ? [x, y] : null;
}

/** `block` put into a comment being written, `value`, in place of what is selected there
 *  (`from`–`to`), on lines of its own: a blank line before it where text comes before, and after
 *  it a paragraph of its own where the caret goes, for the reader to write on — apart from what
 *  comes after, if anything does. The text, and where the caret goes. */
export function insertBlock(value: string, from: number, to: number, block: string): { value: string; caret: number } {
  const before = value.slice(0, from);
  const rest = value.slice(to).replace(/^\n+/, "");
  const lead = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const head = `${before}${lead}${block}\n\n`;
  return { value: head + (rest ? `\n\n${rest}` : ""), caret: head.length };
}
