// The exported document's builder (ExportSpec decisions 6, 8, 12 and 13): a pure function of the
// graph, a view, the sources and the settings, giving the model a renderer reads
// (shared/doc/model.ts). The server builds it for POST /api/export and for the agents' export
// endpoints; tests build it from a graph of their own.
//
// The view is the specification: what its board holds is what the document holds, and its board is
// the document's outline (the owner's decisions of 2026-10-12). Every declaration of the project the
// board holds is printed, whatever is folded, and what it holds from outside the project is counted
// on the head card instead; the sections are the board's cluster structure, its hidden levels taken
// out (shared/doc/sections.ts); everything comes in the board's order, the lowest first
// (shared/doc/order.ts), from where the server reads the board as the page draws it. The notes the
// view shows are the document's prose — a note attached to a declaration under it, one in a cluster
// in its section, the others at the start — with the images and clips they carry as figures and the
// whole PDFs as references. A definition is always printed in full and a proof never
// (shared/doc/proof.ts): neither a theorem's, nor one inside a definition. Nothing of the review is
// read but what the view's scope reads to say what it holds, and the trusted prefixes: no status,
// no opinion is printed. Its title is the view's, as the view is named, and its author line the
// people who left a trace on the view (ExportSpec decisions 14 and 15), whom the server finds
// (shared/doc/authors.ts) and the view brings; no setting gives either.
//
// A view of a past build makes that build's document (ExportSpec decision 16): its graph is the past
// graph its board is of (shared/pastgraph.ts), that build's declarations alone; each declaration's
// text is the one that build compiled, as the history keeps it, its proofs found by reading it (the
// usage pass reads the latest build alone); where that text is not kept, its statement then is
// printed, and the document says so under it. The head card says the
// build and its commit, and how many texts were matched to the build by their places alone.

import type { ClusterMode } from "../graph.ts";
import type { ModuleContexts } from "../context.ts";
import { excerptOf } from "../excerpt.ts";
import { evaluate, printQuery } from "../query.ts";
import type { Query } from "../query.ts";
import { STANDARD_AXIOMS } from "../review.ts";
import type { ReviewData } from "../review.ts";
import type { Graph } from "../viewgraph.ts";
import { namesOf } from "../titles.ts";
import { docTitle, viewTitle } from "../views.ts";
import type { TitleContext } from "../views.ts";
import { authorLine } from "./authors.ts";
import { codeOf, noteBlocks, parseMarkdown } from "./markdown.ts";
import type { CodeBlock, DeclEntry, DocModel, Figure, Item, NoteEntry, PaperRef, Reference, Section } from "./model.ts";
import { addedNames, clusterSubject, declSubject, fileOf, linksOf } from "../library.ts";
import type { FileRecord, FileType } from "../library.ts";
import { DOC_VERSION } from "./model.ts";
import { freshSpots, orderDoc } from "./order.ts";
import type { BoardNote, BoardSpots, OrderedSection, Placed } from "./order.ts";
import { cutByText, cutProofs, statementOnly } from "./proof.ts";
import { planDoc, tooMuch } from "./sections.ts";
import type { SectionPlan } from "./sections.ts";
import type { DocSettings } from "./settings.ts";

/** A module's file as the builder reads it: its lines as they are now, whether that is not the
 *  text it was compiled from (the declaration is then found by name), and the usage pass's
 *  record of it with the Lake hash of the text read (what says where the proofs inside its
 *  definitions are). Of a past build, the text that build compiled, as the history keeps it, never
 *  edited, with no record of the pass's, and how it was matched to the build (`check`: its Lake
 *  hash, or the places the build recorded; HistorySpec decisions 21 and 22). */
export interface DocSource {
  lines: string[];
  edited: boolean;
  contexts: ModuleContexts | null;
  hash: string | null;
  check?: "lake" | "places";
}

/** The view a document is made of: its board's scope, clustering and hidden levels by it, what it is
 *  called (its name, or what it is: the Project, its scope), and the people
 *  who left a trace on it, in the order of their first (shared/doc/authors.ts, `authorsOf`). */
export interface DocView {
  id: string;
  /** what people named it; null where nobody did */
  name: string | null;
  /** the targets linked to it (ViewSpec decision 29), which its title does not say */
  targets?: string[];
  scope: Query;
  clustering: ClusterMode;
  hidden: string[];
  authors: string[];
  /** the build the document is of, as the view's title says it (ViewSpec decision 25): a snapshot's
   *  id; absent for the latest build */
  version?: number;
}

/** A past build whose document a view of it makes (ExportSpec decision 16): its snapshot, and when
 *  it finished (and in words, as the head card prints it; `approx` where only its extraction says). */
export interface DocPast {
  snapshot: number;
  at: string;
  when: string;
  approx?: boolean;
}

/** What the builder knows of the library's files besides their records, for the figures a note's
 *  images and clips make (the server reads it before building): whether this server has a file's
 *  bytes, whether it can draw an image of the library, of a type, into a document, and the size of a
 *  PDF's page in points. A file it cannot show as a figure prints as a reference instead. */
export interface DocFiles {
  has(sha: string): boolean;
  drawable(sha: string, type: FileType): boolean;
  pageSize(sha: string, page: number): { w: number; h: number } | null;
}

/** What the builder reads. */
export interface DocInput {
  /** the graph the view's board is of: the latest build's, or a past build's (`past`) */
  g: Graph;
  /** the review as that board reads it (shared/pastgraph.ts, reviewThen, on a past one) */
  review: ReviewData;
  view: DocView;
  settings: DocSettings;
  /** a module's source, or null where there is none to read (of a past build: none kept) */
  source(module: string): DocSource | null;
  /** a module's file in the project, relative; null outside it */
  fileOf(module: string): string | null;
  /** the build: its fingerprint and the project's commit where known, and its toolchain where it is
   *  not the graph's (a past build's) */
  build: { fingerprint: string | null; commit: DocModel["head"]["commit"]; toolchain?: string };
  /** a past build, whose document this is; absent for the latest */
  past?: DocPast;
  /** what the title is told with (shared/views.ts): the names of the graph on show and the builds
   *  in words, as the view's title is everywhere; the names of `g` where it is left out */
  titles?: TitleContext;
  /** where the view's board draws what the document prints, and the notes it shows (shared/doc/
   *  order.ts): what the document is ordered by. The server reads it as the page draws the board
   *  (server/boardspots.ts); left out, the board is laid out afresh, nothing pinned and no note */
  board?: BoardSpots;
  /** the library's files as the figures need them; left out, every file is here and drawable, and
   *  no page's size is known */
  files?: DocFiles;
}

/** A view the builder cannot make a document of: it holds nothing of the project, or more than a
 *  document holds. The server answers it 400, with its message. */
export class DocInputError extends Error {}

/** The kinds whose value can hold a proof the document cuts: definitions (a `module` or a `module
 *  type` unit among them). A structure's, a class's or an inductive type's text is its statement (a
 *  `by` in a field's default is data), a theorem's value is cut whole, a notation unit's expansion
 *  is its meaning: each is printed as written. */
const VALUE_KINDS = new Set(["def", "abbrev", "instance", "opaque"]);

/** Whether the usage pass read declaration `name` in the text `src` holds now (the compiled one):
 *  then its proof spans say where its proofs are, and none means none. */
function passRead(src: DocSource, name: string): boolean {
  return !src.edited && !!src.hash && src.contexts?.hash === src.hash && Object.hasOwn(src.contexts.decls, name);
}

/** The document of a view. Throws DocInputError where the view makes none (tooMuch). */
export function buildDoc(input: DocInput): DocModel {
  const { g, review: d, settings: s, view } = input;
  const past = input.past ?? null;
  const set = evaluate(view.scope, { g, review: d });
  const plan = planDoc(g, set, view.clustering, view.hidden);
  const why = tooMuch(plan.count);
  if (why) throw new DocInputError(why);
  // the board's order: what it draws lowest first
  const board = input.board ?? freshSpots(g, set, view.clustering, view.hidden);
  const order = orderDoc(plan, g, board);

  const sources = new Map<string, DocSource | null>();
  const sourceOf = (module: string) => {
    if (!sources.has(module)) sources.set(module, input.source(module));
    return sources.get(module)!;
  };

  /** The files the papers, the notes and their figures cite (ExportSpec decision 17), numbered as
   *  they are first cited: the entries are made in the order the document prints them. */
  const references: Reference[] = [];
  const refOf = new Map<string, number>();
  const cite = (f: FileRecord): number => {
    let n = refOf.get(f.sha);
    if (n === undefined) {
      n = references.length + 1;
      refOf.set(f.sha, n);
      references.push({ n, sha: f.sha, title: f.title, type: f.type, ...(f.pages ? { pages: f.pages } : {}), ...(f.url ? { url: f.url } : {}), ...(f.name ? { name: f.name } : {}) });
    }
    return n;
  };
  /** The places in papers a subject is linked to, each citing its file. */
  const papersOf = (subject: string): PaperRef[] | undefined => {
    const out = linksOf(d, subject).flatMap((l): PaperRef[] => {
      const f = fileOf(d, l.file);
      return f ? [{ label: l.label, ...(l.page ? { page: l.page } : {}), ref: cite(f) }] : [];
    });
    return out.length ? out : undefined;
  };

  // the declarations the document prints, by name, and the name a note may write for one: its own,
  // or one Lean generated from its command (folded into it)
  const printedNames = new Set<string>();
  for (const p of [plan.decls, ...sectionDecls(plan.sections)]) for (const i of p) printedNames.add(g.nodes[i].name);
  const mention = (name: string): string | null => {
    if (printedNames.has(name)) return name;
    const unit = g.foldedInto.get(name);
    return unit !== undefined && printedNames.has(g.nodes[unit].name) ? g.nodes[unit].name : null;
  };
  const files = input.files;
  /** A note as the document prints it: its text, unless it says only the title of the one file it
   *  carries; the images and clips it carries as figures, where they can be drawn; the whole PDFs,
   *  and what cannot be drawn, as references. A file the library has no record of is left out. */
  const noteEntry = (b: BoardNote): NoteEntry => {
    const n = b.note;
    const carries = n.carries ?? [];
    const only = carries.length === 1 ? fileOf(d, carries[0].file) : null;
    const text = only && saysTitle(n.text, only) ? null : noteBlocks(n.text, mention);
    const figures: Figure[] = [];
    const papers: PaperRef[] = [];
    for (const c of carries) {
      const f = fileOf(d, c.file);
      if (!f) continue;
      const ref = cite(f);
      const here = files?.has(f.sha) ?? true;
      if (here && f.type === "pdf" && c.region && c.page) {
        const p = files?.pageSize(f.sha, c.page) ?? null;
        const [x0, y0, x1, y1] = c.region;
        figures.push({ ref, file: f.sha, page: c.page, region: [x0, y0, x1, y1], ...(p ? { size: [round1((x1 - x0) * p.w), round1((y1 - y0) * p.h)] as [number, number] } : {}) });
      } else if (here && f.type !== "pdf" && (files?.drawable(f.sha, f.type) ?? true)) figures.push({ ref, file: f.sha });
      else papers.push({ label: "", ...(c.page ? { page: c.page } : {}), ref });
    }
    return { id: `note:${n.id}`, kind: b.kind, text, ...(figures.length ? { figures } : {}), ...(papers.length ? { papers } : {}) };
  };

  /** A declaration's entry: what it is (its docstring), its code, the papers it is linked to. */
  const entry = (i: number): DeclEntry => {
    const v = g.nodes[i];
    const doc = v.doc?.trim() ? parseMarkdown(v.doc) : null;
    // the docstring shown as prose is not repeated in the code
    const code = codeFor(i, doc !== null);
    const papers = papersOf(declSubject(v.name));
    return { id: v.name, name: v.name, short: g.short(i), kind: v.kind, module: v.module, file: input.fileOf(v.module), line: v.range ? v.range[0] : null, doc, code, ...(papers ? { papers } : {}) };
  };

  /** A declaration's code: its source where it can be read (a theorem's up to its statement, a
   *  definition's whole with the proofs in it cut), else the statement the graph holds. `dropDoc`:
   *  the docstring it starts with is shown as prose, so the code leaves it out. A definition's
   *  proofs are cut where the usage pass found them when it read this very text; elsewhere (its file
   *  changed since it was compiled, or the pass has not read it) where reading the text finds them,
   *  which leaves out every `by` block, data too, and keeps a proof written as a term. Its value is
   *  printed either way: the reader sees what it is, whatever the pass knows. Of a past build, the
   *  text it compiled, its proofs found by reading it; where that text is not kept, its statement
   *  then, marked so, and never the latest build's text in its place. */
  const codeFor = (i: number, dropDoc: boolean): CodeBlock => {
    const v = g.nodes[i];
    const theorem = v.kind === "theorem";
    const fromGraph = (): CodeBlock => {
      // a notation unit's statement is its command's text
      const head = g.isExt(i) ? v.name : `${v.kind} ${v.name}`;
      const text = v.kind === "notation" ? v.type ?? v.name : v.type ? `${head} : ${v.type}` : head;
      const c = codeOf(text, "statement");
      if (theorem) elide(c);
      return c;
    };
    const src = g.isExt(i) || !v.range ? null : sourceOf(v.module);
    const at = src ? excerptOf(src.lines, src.edited, v.name, v.range!) : null;
    // a past build's text that is not kept (HistorySpec decision 21): its statement then, said so
    if (!src && past && !g.isExt(i) && v.range) return { ...fromGraph(), notKept: true };
    if (!src || !at) return fromGraph();
    // the docstring above it, shown as prose already
    const start = dropDoc ? afterDoc(src.lines, at.start, at.end) : at.start;
    const text = src.lines.slice(start, at.end + 1).join("\n");
    const from = src.edited ? "edited" : "source";
    // a past build's text matched to it by its places: the head card counts them
    const placed = (c: CodeBlock): CodeBlock => (src.check === "places" ? { ...c, places: true } : c);
    if (theorem) {
      const st = statementOnly(text);
      // where the statement's end cannot be found, the graph's statement: never the proof
      if (st === null) return fromGraph();
      const code = codeOf(st, from);
      elide(code);
      return placed(code);
    }
    if (!VALUE_KINDS.has(v.kind)) return placed(codeOf(text, from));
    if (passRead(src, v.name)) {
      // the proofs inside a definition, where the usage pass found them in this text
      const cut = v.proofs?.length ? cutProofs(src.lines, start, at.end, v.proofs) : null;
      return cut?.cuts ? { lines: cut.lines, proofElided: false, from: "source", proofsCut: cut.cuts } : codeOf(text, from);
    }
    // the pass's places are not this text's (a past build's never are): the proofs as reading the
    // text finds them
    const cut = cutByText(text);
    return placed({ lines: cut.lines, proofElided: false, from, ...(cut.cuts ? { proofsCut: cut.cuts } : {}), textCut: past ? "past" : src.edited ? "edited" : "unread" });
  };

  // a declaration, then the notes attached to it, as its explanation
  const declItem = (i: number): DeclEntry => {
    const e = entry(i);
    const ks = order.attached.get(i);
    if (ks) e.notes = ks.map((k) => noteEntry(board.notes[k]));
    return e;
  };
  const items = (ps: Placed[]): Item[] =>
    ps.map((p): Item => (p.t === "decl" ? { t: "decl", decl: declItem(p.i) } : p.t === "note" ? { t: "note", note: noteEntry(board.notes[p.k]) } : { t: "section", section: section(p.s) }));
  // a section's papers are its cluster's, printed under its heading, before what it holds
  const section = (o: OrderedSection): Section => {
    const p = o.plan;
    const papers = papersOf(clusterSubject(p.key, view.clustering));
    return { id: `section:${p.key}`, key: p.key, title: p.title, level: p.level, ...(papers ? { papers } : {}), items: items(o.items) };
  };

  const meta = g.meta;
  // the names a title made from the scope tells apart: the graph on show's, as the view's title
  // everywhere, else the graph's (shared/titles.ts)
  const titles = input.titles ?? { names: namesOf(g) };
  const body = items(order.items);
  const printed = printedOf(body);
  return {
    version: DOC_VERSION,
    settings: s,
    view: { id: view.id, title: viewTitle(view, titles), scope: printQuery(view.scope), clustering: view.clustering, hidden: [...view.hidden] },
    head: {
      // the view's title and its people (ExportSpec decisions 14 and 15): no setting gives either
      title: docTitle(view, titles),
      author: authorLine(view.authors),
      project: meta.project.name,
      roots: meta.project.roots,
      fingerprint: input.build.fingerprint,
      commit: input.build.commit,
      toolchain: input.build.toolchain ?? meta.project.toolchain,
      past: past
        ? {
            snapshot: past.snapshot,
            at: past.at,
            when: past.when,
            ...(past.approx ? { approx: true as const } : {}),
            places: printed.filter((e) => e.code.places).length,
            notKept: printed.filter((e) => e.code.notKept).length,
          }
        : null,
      trusted: { prefixes: [...d.trusted], standardAxioms: [...STANDARD_AXIOMS] },
      outside: plan.outside,
    },
    items: body,
    count: { declarations: plan.count, sections: plan.sectionCount, notes: printedNotes({ items: body }).length },
    references,
  };
}

/** The declarations of the plan's sections, each section's in turn. */
function sectionDecls(ss: readonly SectionPlan[]): number[][] {
  return ss.flatMap((s) => [s.decls, ...sectionDecls(s.sections)]);
}

/** A number to a tenth: a size in points, as the model keeps it. */
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Whether a note's text says only the title of file `f`, the one it carries — its title, or the name
 *  it was added under, with or without its extension, as a note made for a file says it (the owner's
 *  decisions of 2026-10-12: such a note prints as what it carries, not as prose repeating the title). */
function saysTitle(text: string, f: FileRecord): boolean {
  const plain = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const said = plain(text);
  return [f.title, ...addedNames(f)].some((t) => plain(t) === said);
}

/** Every declaration a document prints, in the order it prints them. */
export function printedDecls(doc: Pick<DocModel, "items">): DeclEntry[] {
  return printedOf(doc.items);
}

function printedOf(items: readonly Item[]): DeclEntry[] {
  const all: DeclEntry[] = [];
  const walk = (xs: readonly Item[]) => {
    for (const x of xs) {
      if (x.t === "decl") all.push(x.decl);
      else if (x.t === "section") walk(x.section.items);
    }
  };
  walk(items);
  return all;
}

/** Every note a document prints, in the order it prints them: those attached to a declaration after
 *  it. */
export function printedNotes(doc: Pick<DocModel, "items">): NoteEntry[] {
  const all: NoteEntry[] = [];
  const walk = (xs: readonly Item[]) => {
    for (const x of xs) {
      if (x.t === "note") all.push(x.note);
      else if (x.t === "decl") all.push(...(x.decl.notes ?? []));
      else walk(x.section.items);
    }
  };
  walk(doc.items);
  return all;
}

/** the most names a note lists */
const NOTE_NAMES = 20;

/** What an export says about how its document was made, besides the document (ExportSpec decision
 *  8): the definitions whose proofs were found by reading their text rather than where the usage
 *  pass found them, and why; the declarations of the project printed from the graph's statement
 *  rather than their source. The document itself says none of it; the export's job carries it, for
 *  whoever wants to know. Of a past build (decision 16), which declarations' texts were matched to
 *  it by their places, and which are not kept, by name: the document counts the one on its head
 *  card and says the other under each. Empty where there is nothing to say. */
export function docNotes(doc: DocModel): string[] {
  const all = printedDecls(doc);
  const names = (es: DeclEntry[]) => {
    const shown = es.slice(0, NOTE_NAMES).map((e) => e.name).join(", ");
    return es.length > NOTE_NAMES ? `${shown} and ${es.length - NOTE_NAMES} more` : shown;
  };
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const out: string[] = [];
  const why = { edited: "their file changed since it was compiled", unread: "the usage pass has not read them (it is off, still running, or failed on their module)" };
  const reading = "Reading the text leaves out every `by` block, one that builds data too, and keeps a proof written as a term.";
  for (const k of ["edited", "unread"] as const) {
    const es = all.filter((e) => e.code.textCut === k);
    if (es.length) out.push(`The proofs inside ${count(es.length, "definition", "definitions")} were found by reading the text rather than where the usage pass found them, since ${why[k]}: ${names(es)}. ${reading}`);
  }
  // of a past build every definition is read so: counted, not named
  const past = all.filter((e) => e.code.textCut === "past").length;
  if (past) out.push(`The proofs inside ${past === 1 ? "the definition" : `the ${past} definitions`} printed were found by reading the text, since it is a past build's and the usage pass reads the latest build alone. ${reading}`);
  const placed = all.filter((e) => e.code.places);
  if (placed.length)
    out.push(
      `The text of ${count(placed.length, "declaration", "declarations")} of this build was matched to it by the places the build recorded — its imports, where each declaration starts and ends, its doc comments and names — since its hash was not kept: ${names(placed)}.`,
    );
  const gone = all.filter((e) => e.code.notKept);
  if (gone.length) out.push(`The text of ${count(gone.length, "declaration", "declarations")} at this build is not kept, and ${gone.length === 1 ? "its statement is" : "their statements are"} printed instead: ${names(gone)}.`);
  const bare = all.filter((e) => e.code.from === "statement" && !e.code.notKept);
  if (bare.length) out.push(`${count(bare.length, "declaration of the project is", "declarations of the project are")} printed from the graph's statement rather than from the source: ${names(bare)}.`);
  return out;
}

/** A theorem's proof left out: `:= …` after the statement's last line. */
function elide(c: CodeBlock): void {
  if (!c.lines.length) c.lines.push([]);
  c.lines[c.lines.length - 1].push(["text", " "], ["elided", ":= …"]);
  c.proofElided = true;
}

/** Where a declaration's text starts once the docstring it opens with is left out: after the
 *  line the docstring closes on, if the excerpt from `start` opens with one and nothing else is
 *  written on that line (`/-- … -/ def f …` keeps it); else `start`. */
function afterDoc(lines: string[], start: number, end: number): number {
  if (!/^\s*\/--/.test(lines[start] ?? "")) return start;
  for (let k = start; k <= end; k++) {
    const close = lines[k].indexOf("-/", k === start ? lines[k].indexOf("/--") + 3 : 0);
    if (close < 0) continue;
    // something written after it on its line, or nothing after it at all: the docstring stays
    return lines[k].slice(close + 2).trim() || k === end ? start : k + 1;
  }
  return start;
}
