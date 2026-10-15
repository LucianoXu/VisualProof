// What a view nobody named is called (the owner's decision of 2026-10-10): a short title, said as the
// selection's chips say a pick ("TCB of ns Fermat42"), wherever a title shows — a tab, the Views menu,
// Activity, presence, the exported document, the agents' answers — with the full description of the
// scope (shared/query.ts, `describe`) and the query behind it where the page shows the title. A name
// people gave is never changed: shared/views.ts, viewTitle, uses it as it is.
//
// A namespace, a file or a declaration is named by its last part and as many of its parents as tell
// it apart from the project's other names of its kind (`TitleNames`, made from the graph on show); a
// cluster's set is read as the cluster (`ns Fermat42`, not "namespace Fermat42 except the outside world", the
// outside world being left out of a namespace's cluster by default); the conditions on a scope are
// condensed (`− trusted`, `+ helper`, `in ★T`, `, only theorems`); a title is about 30
// characters and never more than `TITLE_MAX`, conditions that do not fit said by an ellipsis.

import { readKeys, reviewScope, sameQuery } from "./query.ts";
import type { Combinator, Query, Roots } from "./query.ts";
import type { Graph } from "./viewgraph.ts";

/** the most characters a title made from a scope has */
export const TITLE_MAX = 48;

/** A name's parts: what its dots separate, a part in «» kept whole though it holds one. */
export function nameParts(name: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of name) {
    if (ch === "«") depth++;
    else if (ch === "»") depth = Math.max(0, depth - 1);
    if (ch === "." && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** How many parts a name is said by at least: its last, or the last two where the last says little
 *  alone (a number, two letters), as the chips do. */
function least(parts: string[]): number {
  const tail = parts[parts.length - 1];
  return parts.length > 1 && (/^\d+$/.test(tail) || tail.length <= 2) ? 2 : 1;
}

/** A name's last part, as a chip says it ("FLT", not "Mathlib.NumberTheory.FLT"). */
export function lastPart(name: string): string {
  const parts = nameParts(name);
  return parts.slice(-least(parts)).join(".");
}

/** The shortest name of each kind that tells it apart from the project's other names of that kind:
 *  its last part, and as many of its parents as no other name of the kind ends with. */
export interface TitleNames {
  decl(name: string): string;
  ns(prefix: string): string;
  file(prefix: string): string;
}

/** The names of one kind, and how many of them end with each run of last parts: made when first
 *  asked for. */
class Kind {
  private make: () => Iterable<string>;
  private names: Set<string> | null = null;
  private ends = new Map<string, number>();
  private said = new Map<string, string>();

  constructor(make: () => Iterable<string>) {
    this.make = make;
  }

  short(name: string): string {
    let s = this.said.get(name);
    if (s !== undefined) return s;
    if (!this.names) {
      this.names = new Set(this.make());
      for (const n of this.names) {
        const parts = nameParts(n);
        let end = "";
        for (let k = parts.length - 1; k >= 0; k--) {
          end = end ? `${parts[k]}.${end}` : parts[k];
          this.ends.set(end, (this.ends.get(end) ?? 0) + 1);
        }
      }
    }
    const parts = nameParts(name);
    const own = this.names.has(name) ? 1 : 0;
    s = name;
    for (let k = least(parts); k < parts.length; k++) {
      const end = parts.slice(-k).join(".");
      if ((this.ends.get(end) ?? 0) <= own) {
        s = end;
        break;
      }
    }
    this.said.set(name, s);
    return s;
  }
}

/** The names a title tells apart: the declarations (the outside world's too), the project's
 *  namespaces (every prefix of a declaration's name) and its files and folders (every module and
 *  every prefix of one). */
export function titleNames(decls: () => Iterable<string>, namespaces: () => Iterable<string>, files: () => Iterable<string>): TitleNames {
  const d = new Kind(decls), n = new Kind(namespaces), f = new Kind(files);
  return { decl: (x) => d.short(x), ns: (x) => n.short(x), file: (x) => f.short(x) };
}

const made = new WeakMap<Graph, TitleNames>();

/** The names of graph `g` (the graph on show), made once per graph. */
export function namesOf(g: Graph): TitleNames {
  let t = made.get(g);
  if (!t) {
    const prefixes = (names: Iterable<string>, whole: boolean) => {
      const out = new Set<string>();
      for (const name of names) {
        const parts = nameParts(name);
        let p = "";
        for (let k = 0; k < parts.length - (whole ? 0 : 1); k++) out.add((p = p ? `${p}.${parts[k]}` : parts[k]));
      }
      return out;
    };
    t = titleNames(
      () => g.nodes.map((v) => v.name),
      () => prefixes(g.nodes.slice(0, g.projectCount).map((v) => v.name), false),
      () => prefixes(g.meta.modules.map((m) => m.name), true),
    );
    made.set(g, t);
  }
  return t;
}

/** Without the graph: each name by its last part. */
const PLAIN: TitleNames = { decl: lastPart, ns: lastPart, file: lastPart };

/** A build in a few words, for a title: "Oct 9 22:27", in the time of whoever reads it. */
export function briefWhen(at: string | number): string {
  const d = new Date(at);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A build in full, for a document that is read later and elsewhere (ExportSpec decision 16): "Oct 9,
 *  2026, 22:27 (UTC+2)", in the time of whoever writes it, which it names. */
export function fullWhen(at: string | number): string {
  const d = new Date(at);
  const off = -d.getTimezoneOffset();
  const zone = off ? `UTC${off > 0 ? "+" : "-"}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? `:${String(Math.abs(off) % 60).padStart(2, "0")}` : ""}` : "UTC";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} (${zone})`;
}

// ---------------------------------------------------------------- a scope in a few words

// a Map, not an object: `constructor` is a kind, and an object's own property besides
const PLURAL = new Map<string, string>([["theorem", "theorems"], ["def", "defs"], ["abbrev", "abbrevs"], ["instance", "instances"], ["structure", "structures"], ["class", "classes"], ["inductive", "inductives"], ["opaque", "opaques"], ["axiom", "axioms"], ["notation", "notations"], ["constructor", "constructors"], ["recursor", "recursors"]]);
const SIGN: Record<Combinator, string> = { and: "∩", or: "+", except: "−" };
const or = (xs: string[]) => xs.join(" or ");

/** The target whose review set a query is (shared/query.ts, reviewScope), or null. */
function reviewOf(q: Query): string | null {
  if (q.op !== "or" || q.a.op !== "except" || q.a.a.op !== "tcb" || !Array.isArray(q.a.a.of) || q.a.a.of.length !== 1) return null;
  const t = q.a.a.of[0];
  return sameQuery(q, reviewScope(t)) ? t : null;
}

/** A cluster's set, as a cluster pick writes it (web/src/selection.ts, clusterSet), in a few words —
 *  a namespace's without what is outside the project, which is how a namespace is read — or null. */
function clusterWords(q: Query, N: TitleNames): string | null {
  if (q.op === "external") return "outside world";
  if (q.op === "file") return `file ${N.file(q.prefix)}`;
  if (q.op === "except" && q.a.op === "ns" && q.b.op === "external") return `ns ${N.ns(q.a.prefix)}`;
  if (q.op === "and" && q.a.op === "file" && q.b.op === "external") return `file ${lastPart(q.a.prefix)} (outside)`;
  if (q.op === "except" && q.a.op === "and" && q.a.a.op === "ns" && q.a.b.op === "external" && q.b.op === "decl" && q.b.names.length === 1 && q.b.names[0] === q.a.a.prefix) return `ns ${lastPart(q.a.a.prefix)} (outside)`;
  return null;
}

/** Whether a query is read as one set, never split into a set and its conditions: a cluster's, a
 *  Keys pick, a target's review set. */
const whole = (q: Query, N: TitleNames) => !!readKeys(q) || reviewOf(q) !== null || clusterWords(q, N) !== null;

const isCombination = (q: Query) => q.op === "and" || q.op === "or" || q.op === "except";

function names(xs: string[], N: TitleNames): string {
  const shown = xs.slice(0, 2).map(N.decl).join(", ");
  return xs.length > 2 ? `${shown} +${xs.length - 2}` : shown;
}

function roots(of: Roots, N: TitleNames): string {
  if (of === "selection") return "selection";
  if (Array.isArray(of)) return names(of, N);
  return clusterWords(of, N) ?? wrapped(of, N);
}

/** A set in a few words, in parentheses where it is a combination. */
function wrapped(q: Query, N: TitleNames): string {
  const s = said(q, N);
  return isCombination(q) && !whole(q, N) ? `(${s})` : s;
}

/** What a condition `and` keeps, where it is a filter rather than a set: "theorems", "stale". */
function filterWords(q: Query): string | null {
  switch (q.op) {
    case "kind":
      return or(q.kinds.map((k) => PLURAL.get(k) ?? k));
    case "status":
      return or(q.statuses);
    case "advice":
      return or(q.verdicts.map((v) => (v === "approve" ? "agent-approved" : "agent-commented")));
    case "sorry":
      return "with sorry";
    case "nonstandard":
      return "on non-standard axioms";
    case "trusted":
      return "trusted";
    case "external":
      return "outside";
    default:
      return null;
  }
}

/** A set in a few words, as a chip says it. */
function said(q: Query, N: TitleNames): string {
  const k = readKeys(q);
  if (k) {
    const what = typeof k.from === "string" ? N.decl(k.from) : roots(k.from, N);
    // every target's, or the one clicked: what it rests on; another target's: that target's keys in
    // its TCB
    if (k.keys === "targets" || (k.keys.length === 1 && k.keys[0] === k.from)) return `keys ${what} rests on`;
    return `keys of ${names(k.keys, N)} in TCB of ${what}`;
  }
  const review = reviewOf(q);
  if (review !== null) return `review ★${N.decl(review)}`;
  const cluster = clusterWords(q, N);
  if (cluster) return cluster;
  switch (q.op) {
    case "all":
      return "everything";
    case "selection":
      return "selection";
    case "decl":
      return names(q.names, N);
    case "key":
      return q.of === "targets" ? "keys of all targets" : `keys of ${names(q.of, N)}`;
    case "tcb":
      return `TCB of ${roots(q.of, N)}`;
    case "uses":
      return `what ${roots(q.of, N)} uses`;
    case "refs":
      return `what ${roots(q.of, N)} uses directly`;
    case "usedBy":
      return `what uses ${roots(q.of, N)}`;
    case "ns":
      return `ns ${N.ns(q.prefix)}`;
    case "file":
      return `file ${N.file(q.prefix)}`;
    case "sorry":
      return "what uses sorry";
    case "trusted":
    case "external":
    case "nonstandard":
    case "kind":
    case "status":
    case "advice":
      return filterWords(q)!;
    case "and":
    case "or":
    case "except":
      return `${said(q.a, N)} ${SIGN[q.op]} ${wrapped(q.b, N)}`;
  }
}

/** A condition in a few words, with what joins it to what it follows: "− trusted", " in ns Fermat42",
 *  " in ★T" (within a target's review set), ", only theorems". */
function conditionWords(op: Combinator, q: Query, N: TitleNames): string {
  if (op === "except") return ` − ${q.op === "external" ? "outside" : wrapped(q, N)}`;
  if (op === "or") return ` + ${wrapped(q, N)}`;
  const review = reviewOf(q);
  if (review !== null) return ` in ★${N.decl(review)}`;
  const f = filterWords(q);
  return f ? `, only ${f}` : ` in ${wrapped(q, N)}`;
}

/** Text cut to `max` characters at most, an ellipsis where it was cut. */
export function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** A scope in a few words (`names`: the graph on show's, else each name by its last part): the set
 *  it starts from, then its conditions as long as they fit in `max` characters, an ellipsis for the
 *  rest. */
export function scopeTitle(q: Query, names: TitleNames | null = null, max = TITLE_MAX): string {
  const N = names ?? PLAIN;
  // the set it starts from, and the conditions applied to it in turn (shared/query.ts, chainOf),
  // a set read whole never split
  const conditions: { op: Combinator; q: Query }[] = [];
  let x = q;
  while ((x.op === "and" || x.op === "or" || x.op === "except") && !whole(x, N)) {
    conditions.unshift({ op: x.op, q: x.b });
    x = x.a;
  }
  let out = cut(said(x, N), conditions.length ? max - 2 : max);
  for (let k = 0; k < conditions.length; k++) {
    const next = out + conditionWords(conditions[k].op, conditions[k].q, N);
    // room is left for the ellipsis while more conditions follow
    if (next.length > (k < conditions.length - 1 ? max - 2 : max)) return `${out} …`;
    out = next;
  }
  return out;
}

/** A build added to a title, " @ Oct 9 22:27": what a view kept at a past build is called, and what
 *  Save as new view names the view it makes (HistorySpec decision 19). */
export function atBuild(title: string, when: string): string {
  return `${cut(title, TITLE_MAX - when.length - 3)} @ ${when}`;
}

/** A title without the build a name made by Save as new view ends with (" @ Oct 9 22:27", or the
 *  older " · Oct 9, 22:27"), and the number that kept it apart: a view saved from it is named for
 *  its own build. */
export function withoutBuild(title: string): string {
  return title.replace(/ (?:@ [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}|@ build \d+|· [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2})(?: \(\d+\))?$/, "");
}
