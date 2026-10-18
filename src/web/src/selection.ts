// What the reader selects (decided 2026-10-07): a list of picks. A pick is one thing clicked under
// one tool — a declaration x under Selection, Uses, TCB, Direct or Used by is decl(x), uses(x),
// tcb(x), refs(x) or usedBy(x), and under Keys x with the key declarations in its TCB
// (shared/query.ts, keysQuery); a
// cluster is the same tools over all of its declarations — and the selection is the union of its
// picks, itself a query of shared/query.ts: `pick or pick or …`. What is lit is that set, evaluated
// on the whole graph and cut to what the board holds (shared/board.ts, lightUp), so a pick means the
// same declarations on every board and a view of it holds what was lit. The mode is the tool: how
// the next click selects.
//
// Uses, TCB, Keys and Direct are one mode, Rests on, at the granularities of what a declaration
// rests on (decided 2026-10-08, ViewSpec decision 20): everything it uses, proofs included, ⊇ its
// TCB ⊇ the key declarations in its TCB; and what it uses directly (one step, the owner's decision
// of 2026-10-14). Each is a tool of its own, a step of that mode.
//
// Everything here is without the page, so that it can be tested: what a pick's query is and what
// it says in words, reading picks back from a query (an address, a reader followed, an agent), what
// a click or a shift-click does to the list, and how key 2 steps through Rests on. main.ts keeps the
// list and the thing the panel tells of; web/src/selbar.ts shows the list.

import type { Cluster, ClusterMode, Layout } from "../../shared/graph.ts";
import { renameInQuery } from "../../shared/moves.ts";
import { describe, keysQuery, parseQuery, printQuery, readKeys } from "../../shared/query.ts";
import type { Query } from "../../shared/query.ts";
import type { TitleNames } from "../../shared/titles.ts";
import type { Mode } from "../../shared/viewgraph.ts";

/** A tool: how a click selects (the mode buttons, keys 1–3): a closure of the graph, or the Keys step
 *  of Rests on. */
export type Tool = Mode | "keys";

/** Every tool, as the address and presence name them (web/src/state.ts). */
export const TOOLS: Tool[] = ["plain", "deps", "tcb", "keys", "refs", "apps"];

/** Whose key declarations a Keys pick holds (ViewSpec decision 20): a target's, by name — the
 *  focus of the board it is made on, or the target clicked — or null for every target's. */
export type KeysOf = string | null;

/** What a pick starts from: a declaration by name, or a cluster by key in the clustering it is a
 *  cluster of (null for the outside world as a whole, a cluster in either). */
export type Root = { decl: string } | { cluster: string; by: ClusterMode | null };

/** One thing clicked under one tool. `root` is null for a part of a selection written by hand (in
 *  an address, by an agent) that no click makes: it is lit, it has no ring. */
export interface Pick {
  tool: Tool;
  root: Root | null;
  q: Query;
}

/** What the panel tells of: a declaration by name, or a cluster by key. */
export type Shown = { decl: string } | { cluster: string };

const CLOSURE = { tcb: "tcb", deps: "uses", refs: "refs", apps: "usedBy" } as const;
const TOOL_OF: Record<string, Tool> = { tcb: "tcb", uses: "deps", refs: "refs", usedBy: "apps" };
const EXT = "⟨external⟩";

const keysOf = (k: KeysOf): string[] | "targets" => (k === null ? "targets" : [k]);

/** A declaration clicked under a tool; under Keys, with the key declarations of `keys`. */
export function declPick(tool: Tool, name: string, keys: KeysOf = null): Pick {
  const q: Query = tool === "plain" ? { op: "decl", names: [name] } : tool === "keys" ? keysQuery(name, keysOf(keys)) : { op: CLOSURE[tool], of: [name] };
  return { tool, root: { decl: name }, q };
}

/** A cluster's set under a tool. */
function onSet(tool: Tool, set: Query, keys: KeysOf): Query {
  return tool === "plain" ? set : tool === "keys" ? keysQuery(set, keysOf(keys)) : { op: CLOSURE[tool], of: set };
}

/** The declarations a cluster holds, as a query, exactly as the cluster tree puts them (the layout,
 *  shared/layout.ts): by namespace, the project's names under its key (an outside declaration may
 *  share the namespace); by file, the modules under it; outside the project, the same among the
 *  outside world — by namespace the names under its first component, that one name itself not
 *  included (it sits in the outside world's own cluster). */
export function clusterSet(key: string, mode: ClusterMode): Query {
  const external: Query = { op: "external" };
  if (key === EXT) return external;
  if (!key.startsWith(EXT + ".")) return mode === "module" ? { op: "file", prefix: key } : { op: "except", a: { op: "ns", prefix: key }, b: external };
  const p = key.slice(EXT.length + 1);
  if (mode === "module") return { op: "and", a: { op: "file", prefix: p }, b: external };
  return { op: "except", a: { op: "and", a: { op: "ns", prefix: p }, b: external }, b: { op: "decl", names: [p] } };
}

/** A cluster clicked under a tool; under Keys, with the key declarations of `keys`. */
export function clusterPick(tool: Tool, cl: Cluster, mode: ClusterMode, keys: KeysOf = null): Pick {
  return { tool, root: { cluster: cl.key, by: cl.key === EXT ? null : mode }, q: onSet(tool, clusterSet(cl.key, mode), keys) };
}

/** The cluster a query stands for, when it is a cluster's set (or one written by hand as `ns(P)`). */
function clusterOf(q: Query): Root | null {
  if (q.op === "external") return { cluster: EXT, by: null };
  if (q.op === "ns") return { cluster: q.prefix, by: "namespace" };
  const text = printQuery(q);
  const head = q.op === "file" ? q : q.op === "except" || q.op === "and" ? (q.a.op === "and" ? q.a.a : q.a) : null;
  if (!head || (head.op !== "ns" && head.op !== "file")) return null;
  const mode: ClusterMode = head.op === "file" ? "module" : "namespace";
  for (const key of [head.prefix, `${EXT}.${head.prefix}`]) if (printQuery(clusterSet(key, mode)) === text) return { cluster: key, by: mode };
  return null;
}

/** A part of a selection as a pick: a click's, when it reads as one; else a pick with no root. */
export function pickOf(q: Query): Pick {
  if (q.op === "decl" && q.names.length === 1) return { tool: "plain", root: { decl: q.names[0] }, q };
  const k = readKeys(q);
  if (k) return { tool: "keys", root: typeof k.from === "string" ? { decl: k.from } : clusterOf(k.from), q };
  if (q.op === "tcb" || q.op === "refs" || q.op === "usedBy" || q.op === "uses") {
    const root = Array.isArray(q.of) ? (q.of.length === 1 ? { decl: q.of[0] } : null) : q.of === "selection" ? null : clusterOf(q.of);
    return { tool: TOOL_OF[q.op], root, q };
  }
  return { tool: "plain", root: clusterOf(q), q };
}

/** The selection's query: its picks joined by `or`; null when nothing is selected. */
export function selectionQuery(picks: Pick[]): Query | null {
  return picks.length ? picks.slice(1).reduce<Query>((a, p) => ({ op: "or", a, b: p.q }), picks[0].q) : null;
}

export function selectionText(picks: Pick[]): string | null {
  const q = selectionQuery(picks);
  return q && printQuery(q);
}

/** The picks of a selection's query: the parts its `or`s join (left to right, as it is printed). */
export function picksOf(q: Query): Pick[] {
  return q.op === "or" ? [...picksOf(q.a), pickOf(q.b)] : [pickOf(q)];
}

/** The picks a selection's text says; none when it says nothing readable. */
export function readSelection(text: string | null | undefined): Pick[] {
  if (!text) return [];
  try {
    return picksOf(parseQuery(text));
  } catch {
    return [];
  }
}

/** Whether two picks are the same: the same query. */
export function samePick(a: Pick, b: Pick): boolean {
  return printQuery(a.q) === printQuery(b.q);
}

const isCluster = (p: Pick) => !!p.root && "cluster" in p.root;

/** The last part of a name or key, as a chip says it ("FLT", not "Mathlib.NumberTheory.FLT"); a part that
 *  says little alone (a number, two letters) keeps the one before it. */
function short(name: string): string {
  const parts = name.split(".");
  const tail = parts[parts.length - 1];
  return /^\d+$/.test(tail) || tail.length <= 2 ? parts.slice(-2).join(".") : tail;
}

/** A pick in a few words, as its chip says it: "Minimal", "TCB of not_fermat_42", "ns Fermat42".
 *  With `names` (shared/titles.ts, the graph on show's), a name is said as a view's title says it:
 *  with the parents that tell it apart from the project's others of its kind ("what
 *  Dim24.MainTheorem uses" beside Dim8's; ViewSpec decision 25). */
export function pickWords(p: Pick, names?: TitleNames): string {
  const r = p.root;
  let what: string;
  if (!r) return describe(p.q);
  if ("decl" in r) what = names?.decl(r.decl) ?? short(r.decl);
  else if (r.cluster === EXT) what = "the outside world";
  else {
    const ext = r.cluster.startsWith(EXT + ".");
    const by = r.by === "module" ? "file" : "ns";
    // the outside world's namespaces and folders are not the project's: said by their last part
    const told = ext || !names ? short(ext ? r.cluster.slice(EXT.length + 1) : r.cluster) : names[by](r.cluster);
    what = `${by} ${told}${ext ? " (outside)" : ""}`;
  }
  if (p.tool === "keys") return `keys ${what} rests on`;
  return p.tool === "tcb" ? `TCB of ${what}` : p.tool === "deps" ? `what ${what} uses` : p.tool === "refs" ? `what ${what} uses directly` : p.tool === "apps" ? `what uses ${what}` : what;
}

/** What the panel tells of when a pick was the last clicked: its root. */
export function shownOf(p: Pick | undefined): Shown | null {
  const r = p?.root;
  return !r ? null : "decl" in r ? { decl: r.decl } : { cluster: r.cluster };
}

/** Whether two things the panel may tell of are one. */
export const sameShown = (a: Shown | null, b: Shown | null): boolean =>
  a === b || (!!a && !!b && ("decl" in a ? "decl" in b && a.decl === b.decl : "cluster" in b && a.cluster === b.cluster));

/** Whether a set holds every member of another, which holds at least one. */
function within(a: Uint8Array, b: Uint8Array): boolean {
  let any = false;
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    if (!b[i]) return false;
    any = true;
  }
  return any;
}

/** What a click does to the selection (`picks`, and `shown`, what the panel tells of). Without
 *  shift, or under any tool but Selection, the selection becomes the one pick clicked. With shift,
 *  under Selection, exactly one pick changes: it goes when it is a pick, and comes otherwise — a
 *  cluster then taking the place of the picks it covers, since the union is what counts; something
 *  a cluster picked covers already changes nothing, and `covered` says which cluster. `setOf` is
 *  what a query lights up on the board (shared/board.ts, lightUp). */
export function click(
  picks: Pick[],
  shown: Shown | null,
  p: Pick,
  shift: boolean,
  setOf: (q: Query) => Uint8Array,
): { picks: Pick[]; shown: Shown | null; covered: Pick | null } {
  if (!shift || p.tool !== "plain") return { picks: [p], shown: shownOf(p), covered: null };
  const k = picks.findIndex((x) => samePick(x, p));
  if (k >= 0) return remove(picks, shown, k);
  const mine = setOf(p.q);
  const by = picks.find((x) => isCluster(x) && within(mine, setOf(x.q)));
  if (by) return { picks, shown, covered: by };
  const rest = isCluster(p) ? picks.filter((x) => !within(setOf(x.q), mine)) : picks;
  return { picks: [...rest, p], shown: shownOf(p), covered: null };
}

/** Take the `k`th pick out (shift-click, or its chip's ×). The panel stays where it is, unless it
 *  told of that pick: then it tells of the last pick left, if that has a root. */
export function remove(picks: Pick[], shown: Shown | null, k: number): { picks: Pick[]; shown: Shown | null; covered: null } {
  const rest = picks.filter((_, j) => j !== k);
  const told = sameShown(shown, shownOf(picks[k]));
  return { picks: rest, shown: told ? shownOf(rest[rest.length - 1]) : shown, covered: null };
}

/** A pick's root under another tool: a declaration's, or a cluster's set; null for a pick with no
 *  root (a part of a query written by hand), which no tool can be given again. Under Keys, `keys`
 *  says whose key declarations, for that root. */
export function withTool(p: Pick, tool: Tool, keys: (r: Root) => KeysOf = () => null): Pick | null {
  const r = p.root;
  if (!r) return null;
  if ("decl" in r) return declPick(tool, r.decl, keys(r));
  return { tool, root: r, q: onSet(tool, clusterSet(r.cluster, r.by ?? "namespace"), keys(r)) };
}

/** What the selection becomes when the tool changes (the owner's decision, 2026-10-07, after
 *  using it): the pick last clicked — the one the panel tells of, else the last — alone, under the
 *  new tool. From Selection to another tool only the last pick stays; back to Selection, only the
 *  one thing clicked; from one step of Rests on to another, the same thing at the new step. Under
 *  Keys, `keys` says whose key declarations (withTool). Unchanged (the same array) when nothing is
 *  selected, or when that pick has no root. */
export function retool(picks: Pick[], shown: Shown | null, tool: Tool, keys: (r: Root) => KeysOf = () => null): { picks: Pick[]; shown: Shown | null } {
  if (!picks.length) return { picks, shown };
  const last = picks.find((p) => sameShown(shownOf(p), shown)) ?? picks[picks.length - 1];
  const next = withTool(last, tool, keys);
  return next ? { picks: [next], shown: shownOf(next) } : { picks, shown };
}

/** The selection once a build renamed what it is on (HistorySpec decision 10; the manual's "Live": a
 *  new graph keeps the selection): a declaration picked, or told of in the panel, that the graph no
 *  longer has, and that the renames in force lead on to one it has, is that one. `renamed` maps each
 *  name to the one before it (ReviewData.renamed, shared/moves.ts); `has` says what the graph has.
 *  The same array and object where nothing it names was renamed. */
export function followRenames(picks: Pick[], shown: Shown | null, renamed: Readonly<Record<string, string>> | undefined, has: (name: string) => boolean): { picks: Pick[]; shown: Shown | null } {
  if (!renamed) return { picks, shown };
  const ahead = new Map<string, string>();
  for (const [to, from] of Object.entries(renamed)) ahead.set(from, to);
  /** its name now, where it is gone and a rename leads on to one the graph has; else null */
  const now = (name: string): string | null => {
    if (has(name)) return null;
    let n = name;
    // a chain is as long as the renames of one declaration; a loop (a log edited by hand) is cut short
    for (let k = 0; k < 1000 && ahead.has(n); k++) {
      n = ahead.get(n)!;
      if (has(n)) return n;
    }
    return null;
  };
  let changed = false;
  const next = picks.map((p) => {
    const from = p.root && "decl" in p.root ? p.root.decl : null;
    const to = from === null ? null : now(from);
    if (to === null) return p;
    changed = true;
    return { ...p, root: { decl: to }, q: renameInQuery(p.q, from!, to) };
  });
  const to = shown && "decl" in shown ? now(shown.decl) : null;
  return { picks: changed ? next : picks, shown: to === null ? shown : { decl: to } };
}

/** The edges a selection draws (canvas.ts, MODE_SITES): a TCB's statement and body edges when every
 *  pick is a TCB, else every edge between what is lit. (While the tool is Keys the canvas draws the
 *  key graph's edges instead: shared/keys.ts, litKeyEdges.) */
export function edgeMode(picks: Pick[]): Mode {
  return picks.length && picks.every((p) => p.tool === "tcb") ? "tcb" : "plain";
}

// ---------------------------------------------------------------- Rests on and its steps

/** The steps of Rests on, as its switch shows them: from everything used to the few key
 *  declarations, then what it uses directly (decided 2026-10-08 and 2026-10-14, ViewSpec decision 20). */
export const STEPS: Tool[] = ["deps", "tcb", "keys", "refs"];

/** Whether a tool is a step of Rests on. */
export const restsOn = (t: Tool): boolean => STEPS.includes(t);

/** The step Rests on is entered at, with key 2 or its button: the step last used, TCB for a reader
 *  who never chose. */
export function enterStep(last: Tool | null | undefined): Tool {
  return last && restsOn(last) ? last : "tcb";
}

/** What key 2 makes the tool: Rests on at the step last used (enterStep) from any other mode; within
 *  Rests on, the next step — TCB, Keys, Uses, Direct, TCB again. */
export function keyTwo(now: Tool, last: Tool | null | undefined): Tool {
  if (!restsOn(now)) return enterStep(last);
  const cycle: Tool[] = ["tcb", "keys", "deps", "refs"];
  return cycle[(cycle.indexOf(now) + 1) % cycle.length];
}

// ---------------------------------------------------------------- clusters on the board

const indexes = new WeakMap<Layout, Map<string, number>>();

/** A cluster of the layout by its key; -1 when the layout has none (another clustering, a board
 *  that does not hold it). */
export function clusterIndex(layout: Layout, key: string): number {
  let m = indexes.get(layout);
  if (!m) indexes.set(layout, (m = new Map(layout.clusters.map((c, k) => [c.key, k]))));
  return m.get(key) ?? -1;
}

/** Where a pick's cluster is on a board of clustering `mode`: its index, or -1 when it is not a
 *  cluster there. */
export function clusterOn(r: Root, layout: Layout, mode: ClusterMode): number {
  return "cluster" in r && (r.by === null || r.by === mode) ? clusterIndex(layout, r.cluster) : -1;
}

/** The declarations a cluster holds, at any depth, in the layout's numbering. */
export function clusterMembers(layout: Layout, c: number): number[] {
  const out: number[] = [];
  const depth = layout.clusters[c].depth;
  for (let j = 0; j < layout.cluster.length; j++) {
    let x = layout.cluster[j];
    while (x >= 0 && layout.clusters[x].depth > depth) x = layout.clusters[x].parent;
    if (x === c) out.push(j);
  }
  return out;
}

/** What a cluster is, in a few words: a namespace, a folder or a file, of the project or outside it.
 *  `isModule` says whether a key is one of the project's modules. */
export function clusterWhat(cl: Cluster, mode: ClusterMode, isModule: (key: string) => boolean, hasKids: boolean): string {
  if (cl.key === EXT) return "the outside world";
  if (mode === "namespace") return cl.ext ? "namespace, outside the project" : "namespace";
  if (cl.ext) return "folder, outside the project";
  if (!isModule(cl.key)) return "folder";
  return hasKids ? "file and folder" : "file";
}
