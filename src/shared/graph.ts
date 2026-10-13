// The data that crosses process boundaries: what the Lean extractor writes, and what the
// server hands the page. Kept free of runtime code so both sides can import it.

import type { ModuleContexts } from "./context.ts";

/** Edge sites, as bits. A reference "in a proof" sits in a subterm whose type is a Prop. A
 *  reference "on grammar" is a statement or a body written with a syntax that only fixes the
 *  grammar (a notation unit flagged `grammar`: `syntax`, `declare_syntax_cat`), or a rule's
 *  dependency on the syntax it interprets: what the tree means is a rule's business, which a use
 *  reaches on its own, so a TCB follows neither proofs nor grammar (TCBSpec.md, decision 2). */
export const SITE_STMT = 1;
export const SITE_BODY = 2;
export const SITE_PROOF = 4;
export const SITE_GRAMMAR = 8;
/** The sites a TCB follows. */
export const SITE_TCB = SITE_STMT | SITE_BODY;

/** `notation`: a syntax extension command — `syntax`, `notation`, `macro`, `macro_rules`, `elab`,
 *  `elab_rules`, `declare_syntax_cat` — as one unit (TCBSpec.md, decision 2). */
export type Kind =
  | "theorem" | "def" | "abbrev" | "instance" | "structure" | "class" | "inductive"
  | "opaque" | "axiom" | "quot" | "constructor" | "recursor" | "notation" | "unknown";

/** Output of extractor/Extract.lean, schema 1. */
export interface RawGraph {
  schema: 1;
  roots: string[];
  modules: { name: string; imports: string[] }[];
  nodes: RawNode[];
  externals: { name: string; kind: Kind; module: string; ax: number }[];
  /** [src, dst, sites]; dst indexes nodes, then externals */
  edges: [number, number, number][];
  axioms: string[];
  axiomSets: number[][];
  /** `generated`: declarations Lean generated from a command, folded into their unit; `notation`:
   *  notation units, `grammar` those of them that only declare syntax; `meta`: the other
   *  meta-level units (elaborators, macros, their helpers) */
  stats: { folded: number; generated?: number; metaDropped: number; notation?: number; grammar?: number; meta?: number; ms: number };
  /** what the usage pass found, once merged in (server/usage.ts); its edges are in `edges` */
  usage?: RawUsage;
  /** the names the nodes' `refs` point at (RawNode.refs); absent from an extraction made before
   *  versions were (2026-10-09) */
  refNames?: string[];
}

/** What the usage pass found besides edges (server/usage.ts): the context each module's
 *  declarations are written in, as the elaborator has it, and the modules it could not
 *  elaborate, which keep the text-based context and have no notation edges. */
export interface RawUsage {
  contexts: Record<string, ModuleContexts>;
  failed: { module: string; error: string }[];
  /** `notationEdges`: from a declaration to the notation its text uses; `nestedEdges`: from a
   *  notation to one its expansion emits; `ruleEdges`: from a declaration to the only rule of a
   *  syntax it is written with, where the info tree does not say that rule ran; `proofSpans`: the
   *  proofs inside definitions' bodies recorded on their units (RawNode.proofs) */
  stats: { modules: number; ran: number; cached: number; notationEdges: number; nestedEdges: number; ruleEdges?: number; proofSpans?: number; ms: number };
}

export interface RawNode {
  name: string;
  kind: Kind;
  module: string;
  type: string;
  ax: number;
  /** the kernel's content hash over its unit: its statement and, for data, its body, the names of
   *  what it refers to included (TCBSpec.md, decision 3) */
  hash: string;
  /** the same content with every constant it names replaced by its place in `refs`, and those
   *  constants as indices into RawGraph.refNames — a constant of the project as its unit's name,
   *  then a space and what it is of that unit (`A.Point mk`). The server makes the version from
   *  them (server/versions.ts), which a pure rename leaves as it is. */
  shape?: string;
  refs?: number[];
  doc?: string;
  /** [line, col, endLine, endCol], lines 1-based, columns 0-based */
  range?: [number, number, number, number];
  /** Lean generated it from a command, so no name of its own is written in the text, and no
   *  declaration that command writes was found to fold it into (always ""; one that has such a
   *  declaration is folded into it and listed in its `also`) */
  gen?: string;
  /** the declarations Lean generated from the command that writes this one — what a declaring
   *  macro writes beside the declaration it names, the lemmas of `@[simps]` — folded into it as its
   *  constructors are: one unit (TCBSpec.md, decision 1), its references, axioms and hash theirs
   *  too. Full names, sorted. Constructors, recursors and the like are not listed. */
  also?: string[];
  /** `grammar`: a notation unit that only declares syntax (TCBSpec.md, decision 2) */
  flags?: string[];
  /** the Lean constant a notation unit is made of, where its name is not one: a rule is called
   *  `<kind>.macro_rules`, its constant `_aux_…_macroRules_…_1`. For `#print` and hovers. */
  leanName?: string;
  /** what a card calls a notation unit: `notation · I · in UnitLemmas` */
  display?: string;
  /** the syntax a macro or elaborator interprets: the units of its kinds (a kind outside the
   *  project by its own name) */
  interprets?: string[];
  /** for a unit that declares syntax: the units of the project that interpret its kind */
  rules?: string[];
  /** its kind also has rules outside the project */
  foreignRules?: true;
  /** where the proofs inside its body are, as the usage pass found them (server/usage.ts): `by`
   *  blocks whose goal is a proposition, the tactics of `decreasing_by`, term-mode proofs written in
   *  the text — never in a signature. [line, col, endLine, endCol] in the compiled text, lines
   *  1-based, columns 0-based in code points, end exclusive; sorted, none overlapping. The exported
   *  document cuts them (ExportSpec decision 8). */
  proofs?: [number, number, number, number][];
}

/** One node as the page sees it. Externals carry `ext` and no card details. */
export interface ViewNode {
  name: string;
  kind: Kind;
  module: string;
  ax: number;
  ext?: true;
  type?: string;
  doc?: string;
  range?: [number, number, number, number];
  /** Lean generated it from a command, and no declaration that command writes was found to fold
   *  it into: it has no name of its own in the text (RawNode.gen) */
  gen?: string;
  /** the declarations Lean generated from its command, folded into it (RawNode.also) */
  also?: string[];
  flags?: string[];
  /** its version (TCBSpec.md, decision 3): what an opinion is bound to, the same across a pure
   *  rename of it or of what it refers to (server/versions.ts) */
  hash?: string;
  /** the kernel's content hash it was made from (RawNode.hash), names included: what opinions
   *  recorded before 2026-10-09 were bound to */
  kernel?: string;
  /** a notation unit's Lean constant, display form, the syntax it interprets and, for a syntax,
   *  its rules (RawNode) */
  leanName?: string;
  display?: string;
  interprets?: string[];
  rules?: string[];
  /** where the proofs inside its body are (RawNode.proofs) */
  proofs?: [number, number, number, number][];
}

export interface Cluster {
  /** full path, unique within a layout, e.g. "Nat.Prime" or "⟨external⟩.Mathlib" */
  key: string;
  /** what the canvas prints: the path relative to the parent */
  label: string;
  parent: number;
  depth: number;
  /** world position (absolute) */
  x: number;
  y: number;
  /** position relative to the parent cluster's origin (the world origin for a top cluster) */
  lx: number;
  ly: number;
  r: number;
  /** nodes inside, at any depth */
  count: number;
  /** true for the cluster holding everything outside the project, and all below it */
  ext: boolean;
}

export interface Layout {
  /** world positions */
  x: number[];
  y: number[];
  /** positions relative to the node's cluster (the world origin when it has none) */
  lx: number[];
  ly: number[];
  /** innermost cluster of each node */
  cluster: number[];
  clusters: Cluster[];
}

export type ClusterMode = "namespace" | "module";

/** Which way of laying out produced a layout. Places remembered under another version (the
 *  server's layout memory, places dropped in a browser) do not carry over. 2: dependency order. */
export const LAYOUT_VERSION = 2;

export interface ViewMeta {
  schema: 1;
  layoutVersion: number;
  project: {
    name: string;
    root: string;
    roots: string[];
    toolchain: string;
    extractedAt: string;
    extractMs: number;
  };
  /** `compiled`: the Lake hash of the text the module's declarations were read from (its build's
   *  source); a source served with another hash is not that text */
  modules: { name: string; file: string | null; imports: string[]; compiled?: string | null }[];
  nodes: ViewNode[];
  /** number of project nodes; nodes[projectCount..] are externals */
  projectCount: number;
  axioms: string[];
  axiomSets: number[][];
  layouts: Record<ClusterMode, Layout>;
  edgeCount: number;
}
