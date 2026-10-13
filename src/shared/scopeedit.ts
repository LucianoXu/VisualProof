// A view's scope changed by one part from the canvas's menu (ViewSpec, "The canvas's menu",
// decided 2026-10-09): "Remove from this view" is `scope except part`, "Add to view" is
// `scope or part`, a part being a declaration, `decl(X)`, or a cluster as the selection's cluster
// picks write it, `ns(P) except external` or `file(P)` (web/src/selection.ts, clusterSet). The
// scope stays short as the reader removes and adds: a declaration joins the `decl(…)` that ends the
// scope with the same word (or that is the scope), and adding back what was taken out undoes the taking out rather than
// piling a second part on the first. What is written is always exactly the set asked for; where a
// caller can tell that a shorter scope holds the same set (`same`, evaluated on its graph and
// review), that one is written, and a scope that holds the set asked for already is left as it is.

import { sameQuery } from "./query.ts";
import type { Query } from "./query.ts";

/** Whether two scopes hold the same set on the graph and review at hand. */
export type SameSet = (a: Query, b: Query) => boolean;

/** A declaration's one name, when the part is `decl(X)`. */
const single = (q: Query): string | null => (q.op === "decl" && q.names.length === 1 ? q.names[0] : null);

/** `q` without `name` in its trailing `decl(…)` (`a <op> decl(…)`): the `decl` shorter by one, or
 *  `a` when it held that name alone; null when `q` does not end so. */
function dropName(q: Query, op: "or" | "except", name: string): Query | null {
  if (q.op !== op || q.b.op !== "decl" || !q.b.names.includes(name)) return null;
  const names = q.b.names.filter((n) => n !== name);
  return names.length ? { op, a: q.a, b: { op: "decl", names } } : q.a;
}

/** `q <op> decl(name)`, the name joining a trailing `decl(…)` of the same op. */
function addName(q: Query, op: "or" | "except", name: string): Query {
  if (q.op === op && q.b.op === "decl") return q.b.names.includes(name) ? q : { op, a: q.a, b: { op: "decl", names: [...q.b.names, name] } };
  return { op, a: q, b: { op: "decl", names: [name] } };
}

/** The scope that holds `part` too: `scope or part`, as short as it can be written. */
export function scopeWith(scope: Query, part: Query, same?: SameSet): Query {
  const next = withPart(scope, part, same);
  return same?.(scope, next) ? scope : next;
}

/** The scope that leaves `part` out: `scope except part`, as short as it can be written. */
export function scopeWithout(scope: Query, part: Query, same?: SameSet): Query {
  const next = withoutPart(scope, part, same);
  return same?.(scope, next) ? scope : next;
}

function withPart(scope: Query, part: Query, same?: SameSet): Query {
  const name = single(part);
  // a scope of declarations by name takes one more
  if (name !== null && scope.op === "decl") return scope.names.includes(name) ? scope : { op: "decl", names: [...scope.names, name] };
  if (name !== null) {
    // what was taken out comes back: the name leaves the `except decl(…)` that took it out
    const back = dropName(scope, "except", name);
    if (back) {
      if (same?.(back, addName(back, "or", name))) return back;
      return addName(back, "or", name);
    }
    return addName(scope, "or", name);
  }
  // a cluster taken out comes back: what the scope was, and the cluster with it
  if (scope.op === "except" && sameQuery(scope.b, part)) {
    if (same?.(scope.a, { op: "or", a: scope.a, b: part })) return scope.a;
    return { op: "or", a: scope.a, b: part };
  }
  return { op: "or", a: scope, b: part };
}

function withoutPart(scope: Query, part: Query, same?: SameSet): Query {
  const name = single(part);
  // a scope of declarations by name loses one, while one is left
  if (name !== null && scope.op === "decl" && scope.names.length > 1) return { op: "decl", names: scope.names.filter((n) => n !== name) };
  if (name !== null) {
    // what was added goes: the name leaves the `or decl(…)` that added it
    const back = dropName(scope, "or", name);
    if (back) {
      if (same?.(back, addName(back, "except", name))) return back;
      return addName(back, "except", name);
    }
    return addName(scope, "except", name);
  }
  if (scope.op === "or" && sameQuery(scope.b, part)) {
    if (same?.(scope.a, { op: "except", a: scope.a, b: part })) return scope.a;
    return { op: "except", a: scope.a, b: part };
  }
  return { op: "except", a: scope, b: part };
}
