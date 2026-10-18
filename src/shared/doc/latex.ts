// The exported document as LaTeX (ExportSpec decisions 6–8 and 13): the document model
// (shared/doc/model.ts) written as semantic macros and environments — what each thing is, a section,
// a declaration, its docstring, its code, a note and its figures — which the style file,
// assets/latex/visualproof.sty, typesets; a user replaces or extends that file to make the document
// their own. The model's order is the board's (the owner's decisions of 2026-10-12), so a section's
// own declarations and notes may follow one of its sections: they are headed again by the section's
// title, "continued", so that nothing reads as the section before's. Only the
// settings that are the document's own (paper, margins, sizes, whether the contents are printed)
// and VisualProof's palette (shared/palette.ts: the code's tokens, so that the document's code
// reads as the page's) are written here. The renderer numbers the sections (three levels; the
// paragraph-level headings below are not numbered), and writes the table of contents from them.
//
// Nothing that reaches the .tex is trusted: names, docstrings, comments, code and the title are
// what people, agents and source files said. Every one of them goes through `escapeLatex` (prose)
// or `escapeVerbatim` (code), which leave no character LaTeX would read as anything but text:
// `\input{/etc/passwd}` prints as written. The server compiles with -no-shell-escape and paranoid
// file access besides (server/export.ts), but the escaping is what keeps a document from doing
// anything at all.
//
// The .tex holds no time of its making (a past build's says when that build finished, which does not
// change): the same document asked for again is the same text, which the server's cache knows by its
// hash.

import { TOKEN_COLORS } from "../palette.ts";
import type { Block, CodeBlock, CodeToken, DeclEntry, DocModel, Figure, Inline, Item, NoteEntry, PaperRef, Reference, Section } from "./model.ts";

/** Code points the text font (Libertinus) may lack and JuliaMono has: superscripts and subscripts,
 *  letterlike symbols (ℕ ℝ), arrows, mathematical operators, technical symbols, enclosed
 *  alphanumerics, box drawing, blocks, geometric shapes, miscellaneous symbols and dingbats, the
 *  mathematical brackets (⟪ ⟫ ⦃ ⦄) and arrows, supplemental operators, and the mathematical
 *  alphanumerics (𝔽 𝒪). They are set in JuliaMono (`\vpSym`) wherever prose holds them. */
const SYMBOL_RANGES: [number, number][] = [
  [0x2070, 0x209f],
  [0x2100, 0x214f],
  [0x2190, 0x23ff],
  [0x2460, 0x27bf],
  [0x27c0, 0x2bff],
  [0x1d400, 0x1d7ff],
];

const isSymbol = (cp: number) => SYMBOL_RANGES.some(([a, b]) => cp >= a && cp <= b);

/** Characters that are never text: C0 and C1 controls, and the line and paragraph separators. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Prose, a name or a line of the head card, as LaTeX that prints exactly that text: the ten
 *  characters LaTeX gives a meaning to are spelt out, control characters dropped, line breaks made
 *  spaces, the ligatures Libertinus would make of `--` and backquotes broken, and symbols the text
 *  font lacks set in JuliaMono. */
export function escapeLatex(s: string): string {
  let out = "";
  let sym = "";
  const flush = () => {
    if (sym) out += `\\vpSym{${sym}}`;
    sym = "";
  };
  for (const ch of String(s).replace(CONTROL, "").replace(/[\r\n\t]+/g, " ")) {
    const cp = ch.codePointAt(0)!;
    if (isSymbol(cp)) {
      sym += ch;
      continue;
    }
    flush();
    switch (ch) {
      case "\\":
        out += "\\textbackslash{}";
        break;
      case "{":
        out += "\\{";
        break;
      case "}":
        out += "\\}";
        break;
      case "$":
        out += "\\$";
        break;
      case "&":
        out += "\\&";
        break;
      case "#":
        out += "\\#";
        break;
      case "%":
        out += "\\%";
        break;
      case "_":
        out += "\\_";
        break;
      case "^":
        out += "\\textasciicircum{}";
        break;
      case "~":
        out += "\\textasciitilde{}";
        break;
      case "`":
        out += "\\textasciigrave{}";
        break;
      case "-":
        // `--` would be a dash: the text keeps its hyphens
        out += out.endsWith("-") ? "{}-" : "-";
        break;
      default:
        out += ch;
    }
  }
  flush();
  return out;
}

/** A piece of code as the text of a line of `vpCode` (fvextra's Verbatim, its command characters
 *  `\ { }`): those three spelt out as macros, tabs made two spaces, control characters dropped.
 *  Everything else is printed as it is, in JuliaMono. */
export function escapeVerbatim(s: string): string {
  return String(s)
    .replace(CONTROL, "")
    .replace(/[\r\n]/g, "")
    .replace(/\t/g, "  ")
    .replace(/[\\{}]/g, (c) => (c === "\\" ? "\\vpBS{}" : c === "{" ? "\\vpLB{}" : "\\vpRB{}"));
}

/** A full Lean name, breakable after each dot. */
export function escapeName(s: string): string {
  return String(s)
    .split(".")
    .map(escapeLatex)
    .join(".\\vpBreak{}");
}

/** A file's path in the project, breakable after each slash. */
export function escapePath(s: string): string {
  return String(s)
    .split("/")
    .map(escapeLatex)
    .join("/\\vpBreak{}");
}

/** An anchor as LaTeX labels and PDF destinations take it: letters, digits and `-` only, every
 *  other character spelt as its code, under a prefix of VisualProof's own: `vp:…`. A section's id
 *  starts `section:`, which no declaration's name does, so the two never meet. */
export function anchor(id: string): string {
  return "vp:" + [...String(id)].map((c) => (/[A-Za-z0-9-]/.test(c) ? c : `.${c.codePointAt(0)!.toString(16)}.`)).join("");
}

/** Text for a PDF bookmark: what a PDF outline shows, never markup. The characters LaTeX gives a
 *  meaning to are left out; the rest is kept, Unicode included. */
export function bookmarkText(s: string): string {
  return String(s).replace(CONTROL, "").replace(/[\\{}$&#^_%~`\r\n\t]/g, " ").replace(/\s+/g, " ").trim() || "?";
}

/** A count as the macros take it: a whole number, never negative. */
const int = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);

/** A colour of the palette as xcolor's HTML model takes it; grey for anything else. */
const hex = (c: string): string => (/^#[0-9a-fA-F]{6}$/.test(c) ? c.slice(1).toUpperCase() : "AEAEB2");

/** The code's palette, as colour definitions after the style file's own. */
function palette(): string[] {
  return Object.entries(TOKEN_COLORS).map(([k, c]) => `\\definecolor{vpTk${k}}{HTML}{${hex(c)}}`);
}

/** The macro each kind of token is printed with; plain text has none. */
const TOKEN_MACRO: Record<string, string> = {
  keyword: "vpTkKeyword",
  type: "vpTkType",
  comment: "vpTkComment",
  doc: "vpTkDoc",
  string: "vpTkString",
  number: "vpTkNumber",
  attr: "vpTkAttr",
  op: "vpTkOp",
  sorry: "vpTkSorry",
  elided: "vpTkElided",
};

/** One token of a line of code. A token's spaces stay outside its macro, so that a long comment
 *  or string can still be broken at them (fvextra breaks lines only between macros). */
function token([kind, text]: CodeToken): string {
  const macro = Object.hasOwn(TOKEN_MACRO, kind) ? TOKEN_MACRO[kind] : null;
  if (!macro) return escapeVerbatim(text);
  return String(text)
    .split(/( +)/)
    .map((part) => (!part ? "" : /^ +$/.test(part) ? part : `\\${macro}{${escapeVerbatim(part)}}`))
    .join("");
}

/** A block of code, in `vpCode`, without line numbers. How the proofs in it were found is not said:
 *  the export's notes say it (shared/doc/build.ts, `docNotes`). */
function code(c: CodeBlock): string {
  if (!c.lines.length) return "";
  // a Verbatim environment reads up to its \end at the start of a line: nothing escaped can be one
  return `\\begin{vpCode}\n${c.lines.map((l) => l.map(token).join("")).join("\n")}\n\\end{vpCode}`;
}

function inline(xs: readonly Inline[]): string {
  return xs
    .map((x) => {
      // a declaration a note names, linked to where the document prints it, with its page
      if (x.t === "decl") return `\\vpMention{${anchor(x.id)}}{${escapeName(x.s)}}`;
      if (x.t === "br") return "\\newline ";
      const t = escapeLatex(x.s);
      return x.t === "code" ? `\\vpInlineCode{${t}}` : x.t === "em" ? `\\emph{${t}}` : x.t === "strong" ? `\\textbf{${t}}` : t;
    })
    .join("");
}

/** Prose (a docstring), block by block. */
function blocks(bs: readonly Block[]): string {
  return bs
    .map((b) => {
      if (b.t === "p") return inline(b.inl);
      if (b.t === "code") return code(b.code);
      return `\\begin{itemize}[nosep, leftmargin=1.2em]\n${b.items.map((it) => `\\item ${inline(it)}`).join("\n")}\n\\end{itemize}`;
    })
    .join("\n\n");
}

/** What is said under the code of a declaration of a past build whose text of then is not kept
 *  (ExportSpec decision 16): its statement as the build recorded it is printed instead. */
export const NOT_KEPT_NOTE = "Its source text at this build is not kept: printed is its statement, as the build recorded it.";

/** A declaration: its head, its full name and place, what it is, its code. `level`: its PDF
 *  bookmark's, one below its section's. */
function decl(d: DeclEntry, level: number, refs: ReadonlyMap<number, Reference> = new Map()): string {
  const id = anchor(d.id);
  const out: string[] = [];
  out.push(`\\vpBookmark{${id}}{${int(level)}}{${escapeLatex(bookmarkText(d.short))}}`);
  out.push(`\\begin{vpDecl}{${id}}{${escapeLatex(d.short)}}{${escapeLatex(d.kind)}}`);
  out.push(`\\vpFullName{${escapeName(d.name)}}`);
  out.push(`\\vpPlace{${escapeName(d.module)}}{${d.file ? escapePath(d.file) : ""}}{${d.line ? int(d.line) : ""}}`);
  if (d.doc) out.push(`\\begin{vpDocstring}`, blocks(d.doc), `\\end{vpDocstring}`);
  out.push(code(d.code));
  if (d.code.notKept) out.push(`\\vpDeclNote{${escapeLatex(NOT_KEPT_NOTE)}}`);
  if (d.papers) out.push(papers(d.papers, refs));
  // the notes attached to it, as its explanation
  for (const e of d.notes ?? []) out.push(note(e, refs));
  out.push(`\\end{vpDecl}`);
  return out.join("\n");
}

/** A note (the owner's decisions of 2026-10-12): its text as prose, then the images and clips it
 *  carries as figures, then the whole PDFs it carries as references. Who wrote it is not said: the
 *  author line names them already. */
function note(e: NoteEntry, refs: ReadonlyMap<number, Reference>): string {
  const out = [`\\begin{vpNote}{${anchor(e.id)}}`];
  if (e.text?.length) out.push(blocks(e.text));
  for (const f of e.figures ?? []) out.push(figure(f, refs));
  if (e.papers) out.push(papers(e.papers, refs));
  out.push(`\\end{vpNote}`);
  return out.join("\n");
}

/** The resolution figures are drawn at for print, in dots per inch. */
export const PRINT_DPI = 300;

/** What a figure is drawn from, beside the document (`figures/<name>`): an image's bytes, a PNG or a
 *  JPEG as it is and any other image turned into a PNG; a clip drawn by the server's clip renderer
 *  (server/poppler.ts) at print resolution — as wide in pixels as its size printed at PRINT_DPI, the
 *  widest the renderer draws where its size is not known. The name says exactly what is drawn (the
 *  file's hash, a clip's page, region and width), so that the .tex alone names the document whole,
 *  as the typesetting's cache knows it. */
export interface FigureAsset {
  name: string;
  file: string;
  /** the file's type, as the library records it */
  type: string;
  page?: number;
  region?: [number, number, number, number];
  /** a clip's width in pixels, as asked of the renderer */
  px?: number;
}

/** The widest a clip is asked to be drawn, in pixels: the renderer's widest. */
const CLIP_PX = 2000;

/** Figure `f`'s asset, the file it shows being of type `type`. */
export function figureAsset(f: Figure, type: string): FigureAsset {
  const sha = f.file.replace(/[^0-9a-f]/g, "").slice(0, 64);
  if (!f.region || !f.page) return { name: `fig-${sha}.${type === "jpeg" ? "jpg" : "png"}`, file: f.file, type };
  const px = f.size ? Math.min(CLIP_PX, Math.max(1, Math.ceil((f.size[0] / 72) * PRINT_DPI))) : CLIP_PX;
  const r = f.region.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 1e4)) as [number, number, number, number];
  return { name: `clip-${sha}-p${int(f.page)}-${r.join("-")}-w${px}.png`, file: f.file, type, page: int(f.page), region: f.region, px };
}

/** Every figure a document prints, each once, as what it is drawn from. */
export function figureAssets(doc: DocModel): FigureAsset[] {
  const types = new Map((doc.references ?? []).map((r) => [r.n, r.type]));
  const out = new Map<string, FigureAsset>();
  const walk = (xs: readonly Item[]) => {
    for (const x of xs) {
      const notes = x.t === "note" ? [x.note] : x.t === "decl" ? x.decl.notes ?? [] : [];
      for (const e of notes)
        for (const f of e.figures ?? []) {
          const a = figureAsset(f, types.get(f.ref) ?? "png");
          out.set(a.name, a);
        }
      if (x.t === "section") walk(x.section.items);
    }
  };
  walk(doc.items);
  return [...out.values()];
}

/** A figure: an image at its own size, a clip at the size the paper prints it (`size`), neither wider
 *  than the text; its caption the file's title and a clip's page, numbered as the references are. */
function figure(f: Figure, refs: ReadonlyMap<number, Reference>): string {
  const r = refs.get(f.ref);
  const a = figureAsset(f, r?.type ?? "png");
  const width = f.size && Number.isFinite(f.size[0]) && f.size[0] > 0 ? `${Math.round(f.size[0] * 10) / 10}pt` : "";
  return `\\vpFigure{figures/${a.name}}{${width}}{${escapeLatex(r?.title ?? "")}}{${f.page ? int(f.page) : ""}}{${int(f.ref)}}`;
}

/** The places in references something is linked to (ExportSpec decision 17), one line each:
 *  "Reference: Theorem 3 [title, p. 12]", the title the cited file's, numbered as the list at the
 *  end. */
function papers(ps: readonly PaperRef[], refs: ReadonlyMap<number, Reference>): string {
  return ps
    .map((p) => {
      const r = refs.get(p.ref);
      return `\\vpPaper{${escapeLatex(p.label)}}{${escapeLatex(r?.title ?? "")}}{${p.page ? int(p.page) : ""}}{${int(p.ref)}}`;
    })
    .join("\n");
}

/** The files the document cites, at its end: each one's title, where it came from — the address it
 *  was fetched from, else the name it was uploaded under — and its hash, which names it for good. */
function references(rs: readonly Reference[]): string {
  const from = (r: Reference) => (r.url ? `\\vpUrl{${escapePath(r.url)}}` : r.name ? `uploaded as ${escapeLatex(r.name)}` : "uploaded");
  const what = (r: Reference) => (r.type === "pdf" ? (r.pages ? `PDF, ${int(r.pages)} page${int(r.pages) === 1 ? "" : "s"}` : "PDF") : `${escapeLatex(r.type.toUpperCase())} image`);
  return [`\\begin{vpReferences}`, ...rs.map((r) => `\\vpReference{${int(r.n)}}{${escapeLatex(r.title)}}{${from(r)}}{${what(r)}}{${escapeLatex(r.sha.slice(0, 16))}}`), `\\end{vpReferences}`].join("\n");
}

/** Each section's number, by id: `1`, `1.2`, `1.2.3` for the first three levels; a paragraph-level
 *  heading has none. */
function numbers(doc: DocModel): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (xs: readonly Item[], prefix: string) =>
    sectionsOf(xs).forEach((s, k) => {
      const n = prefix ? `${prefix}.${k + 1}` : `${k + 1}`;
      if (s.level < 4) out.set(s.id, n);
      walk(s.items, s.level < 3 ? n : "");
    });
  walk(doc.items, "");
  return out;
}

/** The sections among `xs`, in order. */
const sectionsOf = (xs: readonly Item[]): Section[] => xs.flatMap((x) => (x.t === "section" ? [x.section] : []));

/** A section, and what it holds: its heading (the cluster's key beneath it), its declarations, its
 *  sections. `depth` counts from 1 at the top, for the PDF's bookmarks, which nest as the sections
 *  do below the paragraph level too. */
function section(s: Section, depth: number, n: Map<string, string>, refs: ReadonlyMap<number, Reference> = new Map()): string {
  const id = anchor(s.id);
  const level = Math.min(4, Math.max(1, int(s.level)));
  const out = [`\\vpSection{${id}}{${level}}{${n.get(s.id) ?? ""}}{${escapeLatex(s.title)}}{${escapeName(s.key.replace("⟨external⟩", "External"))}}{${int(depth - 1)}}{${escapeLatex(bookmarkText(s.title))}}`];
  // the cluster's papers, under its heading
  if (s.papers) out.push(`\\begin{vpSectionPapers}`, papers(s.papers, refs), `\\end{vpSectionPapers}`);
  // what it holds, in the board's order: its own declarations and notes after one of its sections
  // are headed by its title again, so that they do not read as that section's
  let after = false;
  for (const x of s.items) {
    if (x.t === "section") {
      out.push(section(x.section, depth + 1, n, refs));
      after = true;
      continue;
    }
    if (after) out.push(`\\vpSectionResume{${Math.min(4, level + 1)}}{${escapeLatex(s.title)}}`);
    after = false;
    out.push(x.t === "decl" ? decl(x.decl, depth, refs) : note(x.note, refs));
  }
  return out.join("\n");
}

/** The most declarations a document has for its contents to list them beside the sections. */
export const CONTENTS_DECLS = 60;

/** The table of contents (ExportSpec decision 8), where the settings print it: the sections, each
 *  with its number and page — every level where the document is short (at most CONTENTS_DECLS
 *  declarations), and then its declarations too, under their sections; else the first three
 *  levels. The style sets it in two columns, the body following on the same page. */
function contents(doc: DocModel, n: Map<string, string>): string {
  const short = doc.count.declarations <= CONTENTS_DECLS;
  const out: string[] = ["\\begin{vpContents}"];
  const entry = (d: DeclEntry, level: number) => out.push(`\\vpContentsDecl{${anchor(d.id)}}{${level}}{${escapeLatex(d.short)}}`);
  const decls = (xs: readonly Item[]) => xs.flatMap((x) => (x.t === "decl" ? [x.decl] : []));
  if (short) for (const d of decls(doc.items)) entry(d, 1);
  const walk = (xs: readonly Item[]) => {
    for (const s of sectionsOf(xs)) {
      if (!short && s.level > 3) continue;
      out.push(`\\vpContentsSection{${anchor(s.id)}}{${Math.min(4, Math.max(1, int(s.level)))}}{${n.get(s.id) ?? ""}}{${escapeLatex(s.title)}}`);
      if (short) for (const d of decls(s.items)) entry(d, Math.min(4, s.level) + 1);
      walk(s.items);
    }
  };
  walk(doc.items);
  // the files the references cite, at the end, under "References" (ExportSpec decision 17)
  if (doc.references?.length) out.push(`\\vpContentsSection{vp-references}{1}{}{References}`);
  out.push("\\end{vpContents}");
  return out.join("\n");
}

/** What the view holds from outside the project, in words: `300 declarations from outside the
 *  project (Mathlib 203, Init 97)`, the six largest libraries named. */
function outsideLine(o: DocModel["head"]["outside"]): string {
  const n = int(o.count);
  // in thousands as the Export window counts them ("2,640"), the same in every locale
  const k = (x: number) => x.toLocaleString("en");
  const named = o.by.slice(0, 6).map((b) => `${escapeLatex(b.name)} ${k(int(b.count))}`);
  const rest = o.by.slice(6).reduce((a, b) => a + int(b.count), 0);
  if (rest) named.push(`others ${k(rest)}`);
  return `${k(n)} declaration${n === 1 ? "" : "s"} from outside the project${named.length ? ` (${named.join(", ")})` : ""}, not printed`;
}

/** `n` declarations, in words. */
const decls = (n: number) => `${int(n)} declaration${int(n) === 1 ? "" : "s"}`;

/** What the head card says of a past build's texts (ExportSpec decision 16): that they are the ones
 *  that build compiled, how many were matched to it by its places alone, and how many are not kept,
 *  their statements printed instead. */
function textLine(p: NonNullable<DocModel["head"]["past"]>): string {
  const out = ["as this build compiled it"];
  if (int(p.places)) out.push(`for ${decls(p.places)} matched to the build by the places it recorded, its hash not being kept`);
  if (int(p.notKept)) out.push(`not kept for ${decls(p.notKept)}, whose statement${int(p.notKept) === 1 ? " is" : "s are"} printed instead`);
  return out.join("; ");
}

/** The head card (ExportSpec decision 8): the project, the build and its commit where known, the
 *  toolchain, the trusted boundary, and what the view holds from outside the project. Of a past
 *  build (decision 16): when it finished, its commit by its short hash (and whether its files were
 *  edited from it), and how its texts were had. */
function head(doc: DocModel): string {
  const h = doc.head;
  const row = (label: string, value: string) => `\\vpCardRow{${label}}{${value}}`;
  const mono = (s: string) => `\\vpMono{${escapeLatex(s)}}`;
  const p = h.past;
  const c = h.commit;
  const commit = !c
    ? []
    : p
      ? [row("Commit", `${c.guessed ? "probably " : ""}${mono(c.hash.slice(0, 7))}${c.branch ? ` on ${mono(c.branch)}` : ""}${c.dirty ? ", edited" : ""}`)]
      : [row("Commit", `${mono(c.hash)}${c.branch ? ` on ${mono(c.branch)}` : ""}`)];
  const rows = [
    row("Project", `${escapeLatex(h.project)}${h.roots.length ? ` (${h.roots.map(mono).join(", ")})` : ""}`),
    row("Build", p ? `${p.approx ? "about " : ""}${escapeLatex(p.when)}` : h.fingerprint ? mono(h.fingerprint) : "not known"),
    ...commit,
    ...(p ? [row("Source text", escapeLatex(textLine(p)))] : []),
    row("Toolchain", mono(h.toolchain)),
    row(
      "Trusted without review",
      h.trusted.prefixes.length ? h.trusted.prefixes.map((p) => (p === "@external" ? "everything outside the project" : mono(p))).join(", ") : "nothing by prefix",
    ),
    row("Standard axioms", h.trusted.standardAxioms.map(mono).join(", ")),
    ...(h.outside.count ? [row("Also on this view", outsideLine(h.outside))] : []),
  ];
  return `\\begin{vpCard}\n${rows.join("\n")}\n\\end{vpCard}`;
}

/** The whole .tex. */
export function renderLatex(doc: DocModel): string {
  const s = doc.settings;
  const title = doc.head.title || doc.view.title;
  const n = numbers(doc);
  const out: string[] = [
    "% Made by VisualProof (ExportSpec.md). Typeset with XeLaTeX, twice:",
    "%     xelatex doc.tex && xelatex doc.tex",
    "% The look is visualproof.sty's: replace it, or extend it with a package of your own loaded",
    "% after it. Everything below is the document's content, escaped.",
    `\\documentclass[${s.fontSize === 10 || s.fontSize === 12 ? s.fontSize : 11}pt]{article}`,
    "\\usepackage{visualproof}",
    `\\vpSetup{paper=${s.paper === "letter" ? "letter" : "a4"}, margin=${int(s.margin) || 22}mm, codesize=${Number.isFinite(s.codeSize) ? Math.min(12, Math.max(6, s.codeSize)) : 8.5}pt}`,
    ...palette(),
    `\\vpSetTitle{${escapeLatex(title)}}`,
    `\\hypersetup{pdftitle={${escapeLatex(bookmarkText(title))}}${doc.head.author ? `, pdfauthor={${escapeLatex(bookmarkText(doc.head.author))}}` : ""}, pdfcreator={VisualProof}}`,
    "\\begin{document}",
    `\\vpTitle{${escapeLatex(title)}}{${escapeLatex(doc.head.author)}}`,
    head(doc),
    ...(s.contents ? [contents(doc, n)] : []),
  ];
  // the start — what sits in no cluster, the notes outside every cluster — under no heading, then
  // the sections, all in the board's order
  const refs = new Map((doc.references ?? []).map((r) => [r.n, r]));
  for (const x of doc.items) out.push(x.t === "decl" ? decl(x.decl, 0, refs) : x.t === "note" ? note(x.note, refs) : section(x.section, 1, n, refs));
  // the files the references cite, at the end (ExportSpec decision 17)
  if (doc.references?.length) out.push(references(doc.references));
  out.push("\\end{document}", "");
  return out.join("\n");
}
