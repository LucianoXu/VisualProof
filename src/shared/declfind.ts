// A declaration by the name someone gives (the agents' API, server/agent.ts; the artwork command,
// server/artcmd.ts): the graph's own name; else the declaration a name it folds is folded into — a
// declaration Lean generated from a command, or a constructor, recursor, field, equation lemma of
// one — else, where none is, the names likely meant.

import { search } from "./search.ts";
import type { SearchIndex } from "./search.ts";
import type { Graph } from "./viewgraph.ts";

/** the last components of names Lean generates beside a declaration (extractor/Extract.lean,
 *  `generatedSuffixes`, and the like) */
export const GENERATED_LAST = /^(?:rec|recOn|casesOn|noConfusion|noConfusionType|ctorElim|ctorElimType|below|brecOn|binductionOn|ibelow|ctorIdx|toCtorIdx|ofNat|ofNat_ctorIdx|sizeOf_spec|injEq|inj|eq_def|induct|mutual_induct|fun_cases|induct_unfolding|ext_iff|congr_simp|mk|elim|(?:eq|match|proof)_\d+|_.*)$/;

/** The edit distance between two short strings, or `most + 1` once it is more than `most`. */
export function editDistance(a: string, b: string, most: number): number {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > most) return most + 1;
    prev = row;
  }
  return Math.min(prev[b.length], most + 1);
}

/** The declaration a name the graph has no node for is folded into: a declaration Lean generated
 *  from a command (ViewNode.also), or a constructor, recursor, field, equation lemma… of a
 *  declaration or of one so generated, which is a name one component below it. A name one
 *  component below a declaration that is a typo or two away from a declaration beside it is
 *  taken for that typo, not for something folded, unless its last component is one Lean
 *  generates. */
export function foldedAt(g: Graph, name: string): number | undefined {
  const direct = g.foldedInto.get(name);
  if (direct !== undefined) return direct;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const head = name.slice(0, dot), last = name.slice(dot + 1);
  const at = g.byName.get(head) ?? g.foldedInto.get(head);
  if (at === undefined || !last) return undefined;
  if (!GENERATED_LAST.test(last)) {
    const most = last.length < 5 ? 1 : 2;
    const near = (n: string) => n.length > head.length + 1 && n.startsWith(head + ".") && !n.includes(".", head.length + 1) && editDistance(n.slice(head.length + 1).toLowerCase(), last.toLowerCase(), most) <= most;
    for (const n of g.nodes) if (near(n.name)) return undefined;
    for (const n of g.foldedInto.keys()) if (near(n)) return undefined;
  }
  return at;
}

/** Up to five names like `name`: the same name in another case; then the same last component,
 *  or one a typo or two away, in the same namespace first; then what the search finds. */
export function guessNames(g: Graph, index: SearchIndex, name: string): string[] {
  const dot = name.lastIndexOf(".");
  const last = name.slice(dot + 1).toLowerCase();
  const ns = dot < 0 ? "" : name.slice(0, dot);
  const scored = new Map<string, number>();
  const offer = (n: string, score: number) => {
    if ((scored.get(n) ?? Infinity) > score) scored.set(n, score);
  };
  const lower = name.toLowerCase();
  const most = last.length < 5 ? 1 : 2;
  // the graph's declarations, and the names Lean generated from a command that they fold
  for (const name of [...g.nodes.map((n) => n.name), ...g.foldedInto.keys()]) {
    if (name.toLowerCase() === lower) offer(name, -1);
    const k = name.lastIndexOf(".");
    const d = editDistance(name.slice(k + 1).toLowerCase(), last, most);
    if (d <= most) offer(name, 2 * d + (name.slice(0, Math.max(0, k)) === ns ? 0 : 1));
  }
  let rank = 0;
  for (const q of [name.slice(dot + 1), name.replace(/\./g, " ")]) {
    if (q.trim().length < 2) continue;
    const f = search(index, q);
    for (const h of [...f.hits.name, ...f.hits.statement].slice(0, 10)) offer(g.nodes[h.i].name, 10 + rank++);
  }
  return [...scored]
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([n]) => n);
}

/** The declaration `name` names, its own or the one it is folded into; undefined where none is. */
export function declAt(g: Graph, name: string): number | undefined {
  const n = name.trim();
  return g.byName.get(n) ?? foldedAt(g, n);
}
