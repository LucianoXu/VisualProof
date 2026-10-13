// What a short name in a declaration's source means, read from the file as Lean would read it:
// the namespaces the declaration sits in and the `open` commands in force where it starts
// (shared/scope.ts, which the agents' API reads too). This is the page's own guess, there at once
// and also in a snapshot; where Lean is running, the source window asks it about every name
// (server/hover.ts) and Lean's answer wins.

import type { Scope } from "../../shared/scope.ts";
import type { Graph } from "../../shared/viewgraph.ts";

export { namespacesOf, scopeAt } from "../../shared/scope.ts";
export type { Scope } from "../../shared/scope.ts";

/** How a name written in declaration `self`'s source resolves, as Lean would by default: in the
 *  namespaces around it (its own name's first, innermost first), as written, then in what is
 *  open. Its own name links nowhere. */
export function resolver(g: Graph, self: string, scope: Scope | null): (w: string) => string | null {
  const own = self.split(".").slice(0, -1);
  const spaces: string[] = [];
  for (let k = own.length; k > 0; k--) spaces.push(own.slice(0, k).join("."));
  for (const n of scope?.namespaces ?? []) if (!spaces.includes(n)) spaces.push(n);
  const short = self.split(".").pop();
  return (w: string) => {
    if (w === self || w === short) return null;
    for (const p of spaces) if (g.byName.has(`${p}.${w}`)) return `${p}.${w}`;
    if (g.byName.has(w)) return w;
    if (!scope) return null;
    for (const o of scope.opens) if (g.byName.has(`${o}.${w}`)) return `${o}.${w}`;
    const dot = w.indexOf(".");
    const head = dot < 0 ? w : w.slice(0, dot);
    const alias = scope.aliases.get(head);
    if (alias) {
      const full = alias + (dot < 0 ? "" : w.slice(dot));
      if (g.byName.has(full)) return full;
    }
    return null;
  };
}
