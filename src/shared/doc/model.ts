// The exported document's model (ExportSpec decision 6): what the document holds, independent of
// how it is rendered. The builder (shared/doc/build.ts) makes it from the graph, a view and the
// sources; a renderer turns it into something to read — the LaTeX renderer (shared/doc/latex.ts)
// today, an HTML one or another engine later, without touching the builder. It is plain JSON,
// versioned: the agents' API serves it as it is (GET /api/agent/export), and a renderer reads
// nothing else.
//
// It holds nothing of the review (ExportSpec decision 8): no status, no opinion, no progress. A
// document is about what the formalization says, and a reviewer's word on it is the page's. What
// explains it does belong (decision 17, AttachmentSpec decision 10): the places in papers a
// declaration or a cluster is linked to, and the files they cite; and, since the owner's decisions
// of 2026-10-12, the notes the view shows, as the document's prose, with the images and clips they
// carry as figures.
//
// Its order is the board's (the owner's decisions of 2026-10-12): what a section holds — its
// declarations, its notes and its sections — comes in one list, in the order the board draws them
// from the bottom up, whatever depends on what.
//
// Nothing in it is trusted: names, docstrings, comments and code are what people, agents and
// source files said, and a renderer escapes every one of them.

import type { ClusterMode } from "../graph.ts";
import type { TokenKind } from "../lexer.ts";
import type { DocSettings } from "./settings.ts";

/** Bumped when the model changes shape: a renderer reads only the versions it knows. 2: proofs
 *  inside definitions left out. 3: nothing of the review, no context and no line numbers, the head
 *  card without times. 4: no figure and no legend; a definition's value always printed, the proofs
 *  in it found by reading its text where the usage pass's places cannot be used (`textCut`). 5: a
 *  declaration's `doc` its docstring alone; nothing of what it rests on. 6 (2026-10-09): the document
 *  of a view (`view`), in sections from its cluster structure, the outside world counted on the head
 *  card (`head.outside`); no targets' parts, preset, content, appendix or key marks. 7 (2026-10-09):
 *  the title the view's and the author line its people's (`head.title`, `head.author`), no longer
 *  settings. 8 (2026-10-10): the document of a view at a past build (`head.past`), its texts that
 *  build's, a declaration whose text of then is not kept printed as its statement (`code.notKept`),
 *  a text matched to its build by its places marked (`code.places`). 9 (2026-10-11): the papers a
 *  declaration and a section are linked to (`papers`), and the files they cite (`references`). 10
 *  (2026-10-12): the board's order, a section's declarations, notes and sections in one list
 *  (`items`), the document's first ones too; the notes the view shows (`NoteEntry`), a declaration's
 *  own under it (`DeclEntry.notes`), their images and clips as figures; a declaration a note names
 *  linked where the document prints it (an inline `decl`). */
export const DOC_VERSION = 10;

/** One token of highlighted code: its kind (shared/lexer.ts) and its text, never a newline. A
 *  pair, so that a long listing stays small as JSON. `elided` stands for a proof left out: `:= …`
 *  after a theorem's statement, `…` in the place of a proof inside a definition. */
export type CodeToken = [TokenKind | "elided", string];

/** A line of code: its tokens, in order. */
export type CodeLine = CodeToken[];

export interface CodeBlock {
  lines: CodeLine[];
  /** a theorem's proof was left out (ExportSpec decision 8): the text stops after its statement,
   *  and an `elided` token (`:= …`) stands for the rest */
  proofElided: boolean;
  /** proofs inside a definition's value left out (ExportSpec decision 8): how many, each an
   *  `elided` token `…` in its place; absent where none was */
  proofsCut?: number;
  /** a definition whose proofs were found by reading its text (shared/doc/proof.ts, `cutByText`),
   *  since the usage pass's places are not this text's: its file changed since it was compiled
   *  (`edited`), the pass has not read it (`unread`: it is off, still running, or failed on the
   *  module), or the text is a past build's (`past`: the pass reads the latest build alone). Its
   *  `by` blocks are left out, data too, and a proof written as a term stays. Absent where the
   *  pass's places were used, and for anything but a definition. The document does not say it; the
   *  export's notes do. */
  textCut?: "edited" | "unread" | "past";
  /** where the text comes from: the compiled source (of a past build, the text that build compiled,
   *  as the history keeps it); the present source, in a file changed since it was compiled; the
   *  graph's statement, where there is no source to read (outside the project, a file that cannot be
   *  read, a past build's text not kept) */
  from: "source" | "edited" | "statement";
  /** a past build's text, matched to the build by the places it recorded (its imports, where each
   *  declaration starts and ends, its doc comments and names) since its hash was not kept
   *  (HistorySpec decisions 21 and 22). The document counts these on its head card, not one by one;
   *  absent where the text's hash is the build's, and on the latest build */
  places?: true;
  /** a past build whose text of the declaration is not kept (HistorySpec decision 21): its statement
   *  as the build recorded it is printed (`from: "statement"`), and the document says, under it,
   *  that its text of that build is not kept. Never the latest build's text in its place. */
  notKept?: true;
}

/** Prose, from Markdown (a docstring, a note): a small subset, as the page renders it. `br` is a line
 *  break a note keeps (its `s` empty); `decl` a declaration's full name a note writes in backticks,
 *  which the document prints, by its entry's id. */
export type Inline = { t: "text" | "code" | "em" | "strong" | "br"; s: string } | { t: "decl"; s: string; id: string };
export type Block = { t: "p"; inl: Inline[] } | { t: "code"; code: CodeBlock } | { t: "list"; items: Inline[][] };

/** A link into a reference, as the document prints it under what it explains ("Reference: Theorem 3
 *  [title, p. 12]"): its label, the page, and the file it cites, by its number among the
 *  references. */
export interface PaperRef {
  label: string;
  page?: number;
  /** 1-based, into `DocModel.references` */
  ref: number;
}

/** A file the document cites (ExportSpec decision 17): its title, where it came from, its hash. */
export interface Reference {
  n: number;
  sha: string;
  title: string;
  type: string;
  pages?: number;
  /** the address it was fetched from, or the name it was uploaded under */
  url?: string;
  name?: string;
}

/** An image or a clip a note carries, printed as a figure: its caption is the file's title, and a
 *  clip's page. */
export interface Figure {
  /** the file it shows, by its number among the references (1-based, into `DocModel.references`) */
  ref: number;
  /** the file's hash, which the typesetting draws it from */
  file: string;
  /** a clip's page */
  page?: number;
  /** a clip's region of the page, in the page's fractions (left, top, right, bottom); none for an
   *  image, shown whole */
  region?: [number, number, number, number];
  /** a clip's size as the paper prints it, in points (the region of the page at the page's own
   *  size); none for an image, and where the page's size is not known */
  size?: [number, number];
}

/** A note the view shows, printed as prose (the owner's decisions of 2026-10-12): its text, the
 *  images and clips it carries as figures, the whole PDFs as references. */
export interface NoteEntry {
  /** its anchor: `note:` and the note's id, which no name is */
  id: string;
  /** a note of the project, or the view's own */
  kind: "project" | "view";
  /** its text, its Markdown carried over; null where it says only the title of the one file it
   *  carries, which prints as what it carries */
  text: Block[] | null;
  /** the images and clips it carries, in the order it carries them; absent where none */
  figures?: Figure[];
  /** the whole PDFs it carries, and the files it cannot show as figures, as references; absent
   *  where none */
  papers?: PaperRef[];
}

/** What a section holds, or the document's start, in the board's order: a declaration, a note, a
 *  section. The start holds no section: the sections follow it. */
export type Item = { t: "decl"; decl: DeclEntry } | { t: "note"; note: NoteEntry } | { t: "section"; section: Section };

/** A declaration printed in the document. */
export interface DeclEntry {
  /** its anchor in the document, unique within it: its full name */
  id: string;
  name: string;
  /** the name as a card titles it (shared/viewgraph.ts, shortName) */
  short: string;
  kind: string;
  module: string;
  /** its file in the project, relative */
  file: string | null;
  /** where it starts in that file, 1-based */
  line: number | null;
  /** what it is, for a reader: its docstring, as prose; null where it has none */
  doc: Block[] | null;
  code: CodeBlock;
  /** the places in papers it is linked to, in the order they were made; absent where none is */
  papers?: PaperRef[];
  /** the notes attached to it, printed right after it as its explanation; absent where none is */
  notes?: NoteEntry[];
}

/** A section: a cluster of the view's board that holds something printed (ExportSpec decision 13). */
export interface Section {
  /** its anchor */
  id: string;
  /** the cluster's key (its full path) */
  key: string;
  /** its heading, as the board labels the cluster (shared/doc/sections.ts, SectionPlan) */
  title: string;
  /** its heading's level: 1 a section, 2 a subsection, 3 a subsubsection, 4 a paragraph-level
   *  heading, which every deeper level takes too */
  level: number;
  /** what it holds — its declarations, its notes and its sections — in the board's order, from the
   *  bottom up */
  items: Item[];
  /** the places in papers the cluster is linked to; absent where none is */
  papers?: PaperRef[];
}

/** The document. */
export interface DocModel {
  version: typeof DOC_VERSION;
  settings: DocSettings;
  /** the view it is the document of, as it was when it was made */
  view: {
    id: string;
    title: string;
    /** its scope's text (shared/query.ts) */
    scope: string;
    clustering: ClusterMode;
    /** the levels it hides by that clustering (ViewSpec decision 24) */
    hidden: string[];
  };
  /** the head card (ExportSpec decision 8) */
  head: {
    /** the view's title, as it is named (ExportSpec decision 14; shared/views.ts, docTitle) */
    title: string;
    /** the people who left a trace on the view, in the order of their first, as the line under the
     *  title prints them (decision 15; shared/doc/authors.ts); "" where nobody named did */
    author: string;
    project: string;
    roots: string[];
    /** the build's fingerprint, as the server names the graph */
    fingerprint: string | null;
    /** the project's commit where it is a git repository; of a past build, the commit it was built
     *  from, `dirty` where its `.lean` files differed from it, `guessed` where only the time says it
     *  (HistorySpec decision 4) */
    commit: { hash: string; branch: string | null; dirty?: true; guessed?: true } | null;
    toolchain: string;
    /** the past build the document is of (ExportSpec decision 16), or null for the latest: its
     *  snapshot, when it finished (and in words, in the server's time; `approx` where only its
     *  extraction says when), and how many of the declarations printed have their text of then
     *  matched to the build by its places (`places`) or not kept (`notKept`) */
    past: { snapshot: number; at: string; when: string; approx?: true; places: number; notKept: number } | null;
    /** what is trusted without review: the trusted prefixes (`@external` for the whole outside
     *  world) and the standard axioms */
    trusted: { prefixes: string[]; standardAxioms: string[] };
    /** what the view holds from outside the project, which is not printed: how many, and how many
     *  per library, the most first */
    outside: { count: number; by: { name: string; count: number }[] };
  };
  /** the document's start, under no heading — the declarations at the top of the view's cluster
   *  tree, in no cluster, and the notes on the ring or on the canvas outside every cluster, in the
   *  board's order — then its sections, in the board's order */
  items: Item[];
  /** how many declarations it prints, in how many sections, and how many notes */
  count: { declarations: number; sections: number; notes: number };
  /** the files its papers cite, in the order first cited, listed at its end; absent from a model of
   *  before version 9 */
  references?: Reference[];
}
