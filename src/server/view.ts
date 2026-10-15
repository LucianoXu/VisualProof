// The extractor's graph, turned into what the page loads: card data, both layouts, and the
// edges as a flat binary array.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClusterMode, GitSource, Layout, RawGraph, ViewMeta, ViewNode } from "../shared/graph.ts";
import { LAYOUT_VERSION } from "../shared/graph.ts";
import type { Extraction } from "./extract.ts";
import { gitSource } from "./history.ts";
import type { LayoutMemory } from "../shared/layout.ts";
import { layOutHere, layOutOffThread } from "./layoutthread.ts";
import type { Project } from "./project.ts";
import { compiledTextHash } from "./status.ts";
import { versionBase, versions } from "./versions.ts";

export interface View {
  meta: ViewMeta;
  /** [src, dst, sites] × edgeCount, little-endian int32 */
  edges: Int32Array;
}

const MODES: ClusterMode[] = ["namespace", "module"];

/** The view of an extraction, laid out here (a test, a command run once). */
export function buildView(
  p: Project,
  ex: Extraction,
  log: (s: string) => void,
  memory: Partial<Record<ClusterMode, LayoutMemory>> | null = null,
): View {
  const { nodes, edges } = viewParts(p, ex);
  const layouts = {} as Record<ClusterMode, Layout>;
  for (const mode of MODES) {
    const t0 = performance.now();
    layouts[mode] = layOutHere(mode, nodes, edges, memory?.[mode] ?? null);
    log(`layout by ${mode}: ${layouts[mode].clusters.length} clusters, ${Math.round(performance.now() - t0)} ms`);
  }
  return assemble(p, ex, nodes, edges, layouts);
}

/** The same, both clusterings laid out at once off the server's thread (server/layoutthread.ts),
 *  which meanwhile goes on answering. */
export async function buildViewOffThread(
  p: Project,
  ex: Extraction,
  log: (s: string) => void,
  memory: Partial<Record<ClusterMode, LayoutMemory>> | null = null,
): Promise<View> {
  const { nodes, edges } = viewParts(p, ex);
  const laid = await Promise.all(
    MODES.map(async (mode) => {
      const t0 = performance.now();
      const layout = await layOutOffThread(mode, nodes, edges, memory?.[mode] ?? null);
      log(`layout by ${mode}: ${layout.clusters.length} clusters, ${Math.round(performance.now() - t0)} ms, off the server's thread`);
      return layout;
    }),
  );
  return assemble(p, ex, nodes, edges, { namespace: laid[0], module: laid[1] });
}

/** The declarations as the page reads them, the outside ones after the project's, and the edges
 *  packed. */
function viewParts(p: Project, ex: Extraction): { nodes: ViewNode[]; edges: Int32Array } {
  const g: RawGraph = ex.graph;
  // what an opinion is bound to: the version, which a pure rename leaves as it is, made here as if
  // nothing were renamed (the server makes it again under the renames in force: server/versions.ts)
  const vs = versions(versionBase(g));
  const nodes: ViewNode[] = g.nodes.map((n, i) => {
    const v: ViewNode = { name: n.name, kind: n.kind, module: n.module, ax: n.ax, type: n.type, hash: vs[i] };
    if (vs[i] !== n.hash) v.kernel = n.hash;
    if (n.doc) v.doc = n.doc;
    if (n.range) v.range = n.range;
    if (n.gen !== undefined) v.gen = n.gen;
    if (n.also?.length) v.also = n.also;
    if (n.flags?.length) v.flags = n.flags;
    if (n.leanName) v.leanName = n.leanName;
    if (n.display) v.display = n.display;
    if (n.interprets?.length) v.interprets = n.interprets;
    if (n.rules?.length) v.rules = n.rules;
    if (n.proofs?.length) v.proofs = n.proofs;
    return v;
  });
  for (const e of g.externals) nodes.push({ name: e.name, kind: e.kind, module: e.module, ax: e.ax, ext: true });
  notationStatements(p, nodes);

  const edges = new Int32Array(g.edges.length * 3);
  g.edges.forEach(([s, d, m], i) => {
    edges[3 * i] = s;
    edges[3 * i + 1] = d;
    edges[3 * i + 2] = m;
  });

  return { nodes, edges };
}

/** The project's git source and commit as it is read, where it is a git repository. */
function gitOf(root: string): { git?: GitSource } {
  const git = gitSource(root);
  return git ? { git } : {};
}

function assemble(p: Project, ex: Extraction, nodes: ViewNode[], edges: Int32Array, layouts: Record<ClusterMode, Layout>): View {
  const g: RawGraph = ex.graph;
  const meta: ViewMeta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: {
      name: p.name,
      root: p.root,
      roots: p.roots,
      ...(p.targets ? { targets: p.targets } : {}),
      toolchain: p.toolchain,
      extractedAt: ex.at,
      extractMs: g.stats.ms,
      ...gitOf(p.root),
    },
    modules: g.modules.map((m) => {
      const file = p.files.get(m.name) ?? null;
      return { name: m.name, file, imports: m.imports, compiled: file ? compiledTextHash(p, m.name, file) : null };
    }),
    nodes,
    projectCount: g.nodes.length,
    axioms: g.axioms,
    axiomSets: g.axiomSets,
    layouts,
    edgeCount: g.edges.length,
  };
  return { meta, edges };
}

/** At most this many lines of a notation command make its statement. */
const NOTATION_LINES = 6;

/** A notation unit's statement is its command, as written (TCBSpec.md, decision 2): what Lean
 *  elaborated it into (a `ParserDescr`, a `Macro`) says nothing a reader can check. Its first
 *  lines, its doc comment left out. */
export function notationStatements(p: Project, nodes: ViewNode[]): void {
  const files = new Map<string, string[] | null>();
  for (const v of nodes) {
    if (v.kind !== "notation" || v.ext || !v.range) continue;
    let lines = files.get(v.module);
    if (lines === undefined) {
      const rel = p.files.get(v.module);
      try {
        lines = rel ? readFileSync(join(p.root, rel), "utf8").split("\n") : null;
      } catch {
        lines = null;
      }
      files.set(v.module, lines);
    }
    if (!lines) continue;
    const text = commandLines(lines, v.range);
    if (!text) continue;
    v.type = text;
    // the command as written says what it is where its constants cannot (`infixl`, a `notation`
    // without an unexpander)
    const kw = COMMAND.exec(text)?.[1];
    if (kw && v.display && /^(?:notation|macro|elab) ·/.test(v.display)) v.display = v.display.replace(/^\S+/, kw);
  }
}

/** The keyword of a syntax extension command, past its attributes and modifiers. */
const COMMAND = /^\s*(?:@\[[^\]]*\]\s*)?(?:(?:local|scoped|private|protected)\s+)*(notation|infixl|infixr|infix|prefix|postfix|macro|elab)\b/;

/** The lines of a command at `range` ([line, col, endLine, endCol], 1-based lines), its doc comment
 *  left out, at most NOTATION_LINES of them. */
export function commandLines(lines: string[], range: readonly number[]): string | null {
  let first = range[0] - 1;
  const last = Math.min(lines.length - 1, range[2] - 1);
  // a doc comment opens the range: what follows its `-/` is the command
  if (/^\s*\/--/.test(lines[first] ?? "")) {
    while (first <= last && !/-\/\s*$/.test(lines[first])) first++;
    first++;
  }
  const body = lines.slice(first, last + 1);
  while (body.length && !body[body.length - 1].trim()) body.pop();
  if (!body.length) return null;
  return body.length > NOTATION_LINES ? body.slice(0, NOTATION_LINES).join("\n") + "\n  …" : body.join("\n");
}
