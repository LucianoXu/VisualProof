// One query language for what is on a board and for what lights up (ViewSpec decision 4): a view's
// scope is a query with fixed roots (`tcb(fermatLastTheoremFour) except trusted`), and so is what the
// reader selected, which is what is lit: one part per click, joined by `or`
// (`decl(A.b) or tcb(ns(A.C) except external)`, web/src/selection.ts). The same query has a structured form (a
// JSON tree, what the server stores and agents may send) and a short text form (what the address,
// agents and the scope chips carry); the two are parsed and printed both ways, and the text printed
// is canonical, so two scopes are the same when their texts are.
//
// The text form, left to right:
//
//   all | selection | decl(A, B) | tcb(A) | uses(A, B) | usedBy(selection)
//   tcb(ns(Fermat42) except external)   a closure of the set a query holds
//   ns(Fermat42)                 declarations whose name is under the prefix
//   file(Mathlib.NumberTheory)   declarations of the modules under the prefix
//   trusted | external | sorry | nonstandard
//   kind(theorem, def) | status(unreviewed, stale) | advice(comment)
//   key(fermatLastTheoremFour)   the target and the declarations marked key for it
//   key(targets)                 the same for every target
//   X and Y | X or Y | X except Y        left to right, one level; parentheses group
//
// A name that holds a space, a parenthesis, a comma or a quote — or is the word `selection`, or
// `targets` inside key(…) — is written as a JSON string. Inside a closure's parentheses, what starts with a parenthesis, with a
// word and a parenthesis (`ns(`), or joins with and, or, except is a query; a query that is one
// plain word is written in parentheses there (`tcb((external))`). Words are read without regard to case (`usedby`); `namespace` and
// `module` may stand for `ns` and `file`.

import type { Kind } from "./graph.ts";
import { adviceOf, keyMarks, STANDARD_AXIOMS, statusOf, trusted, under } from "./review.ts";
import type { ReviewData, Verdict } from "./review.ts";
import type { Graph, Mode } from "./viewgraph.ts";

/** The roots of a closure: declarations by name, the reader's selection, or the set a query holds
 *  (a cluster selected under a tool: `tcb(ns(P) except external)`, web/src/selection.ts). */
export type Roots = string[] | "selection" | Query;

/** A review status as a condition names it: `unreviewed` is what shared/review.ts calls "none". */
export type ReviewStatus = "unreviewed" | "approved" | "commented" | "stale";

export type Query =
  | { op: "all" }
  | { op: "selection" }
  | { op: "decl"; names: string[] }
  | { op: "tcb" | "uses" | "usedBy"; of: Roots }
  | { op: "ns" | "file"; prefix: string }
  | { op: "trusted" | "external" | "sorry" | "nonstandard" }
  | { op: "kind"; kinds: Kind[] }
  | { op: "status"; statuses: ReviewStatus[] }
  /** what an agent advises on the present version (AgentSpec decision 2) */
  | { op: "advice"; verdicts: Verdict[] }
  /** the key declarations of targets (ExportSpec decision 4): each target, and the members of its
   *  review marked key for it; `targets` for every target the review has, whichever they
   *  are when it is read (the Keys step of Rests on where the review has no focus, ViewSpec decision 20) */
  | { op: "key"; of: string[] | "targets" }
  | { op: "and" | "or" | "except"; a: Query; b: Query };

export type Combinator = "and" | "or" | "except";

export const KINDS: Kind[] = ["theorem", "def", "abbrev", "instance", "structure", "class", "inductive", "opaque", "axiom", "quot", "constructor", "recursor", "notation", "unknown"];
export const STATUSES: ReviewStatus[] = ["unreviewed", "approved", "commented", "stale"];
const VERDICTS: Verdict[] = ["approve", "comment"];
const CLOSURES = ["tcb", "uses", "usedBy"] as const;
const PLAIN = ["all", "selection", "trusted", "external", "sorry", "nonstandard"] as const;
const COMBINATORS: Combinator[] = ["and", "or", "except"];
/** words for the same thing, read as the first */
const ALIASES: Record<string, string> = { usedby: "usedBy", namespace: "ns", module: "file", decls: "decl" };

/** Lighting up (ViewSpec decision 4): the tools that are closures of the graph, as queries relative
 *  to the selection (the Keys step of Rests on is keysQuery). */
export const LIGHT: Record<Mode, Query> = {
  plain: { op: "selection" },
  tcb: { op: "tcb", of: "selection" },
  deps: { op: "uses", of: "selection" },
  apps: { op: "usedBy", of: "selection" },
};

/** Which closure each closure word is, as the graph computes it (shared/viewgraph.ts). */
const CLOSURE_MODE: Record<(typeof CLOSURES)[number], Mode> = { tcb: "tcb", uses: "deps", usedBy: "apps" };

// ---------------------------------------------------------------- how large a query may be

/** How large a query may be: one set of bounds for its text and its JSON form, checked when either
 *  is read (parseQuery, cleanQuery), so that what one form takes the other takes too — a scope
 *  saved from its text is read back from its JSON at the next start. The bounds hold what a scope
 *  or a selection needs with room to spare (900 picks of a selection fit), and keep reading,
 *  printing and evaluating any query a matter of milliseconds: a closure walks the whole graph, and
 *  every function on a query is recursive. */
export const QUERY_LIMITS = {
  /** characters of its canonical text (printQuery), which is what the JSON form stands for */
  text: 20_000,
  /** nesting: a closure of a query, and a combination on the right of and, or, except — what the
   *  text writes in parentheses — each one level deeper (`tcb(ns(A) except (B or C))`: 2) */
  depth: 32,
  /** its parts: all, decl(…), tcb(…), ns(…), kind(…), … wherever they stand */
  terms: 1_000,
  /** names and prefixes, all together */
  names: 2_000,
  /** characters of one name or prefix */
  name: 2_000,
  /** closures (tcb, uses, usedBy), each a walk of the graph; each target of a `key(…)` counts as
   *  one too, since its review set is walked to keep only the marks still in it. `key(targets)`
   *  counts as one: how many targets there are is the project's, not the query's, and every
   *  `key(targets)` of a query shares the same walks (evaluateIn) */
  closures: 64,
};

/** Parentheses within parentheses the reader of the text follows: twice the depth, since a
 *  closure of one plain word takes two (`tcb((all))`), with a margin. Only a guard for the stack;
 *  what a query may hold is QUERY_LIMITS, checked on what was read. */
const MAX_PARENS = 2 * QUERY_LIMITS.depth + 8;

/** Why a query is larger than QUERY_LIMITS allows, or null. Called on a tree already bounded in
 *  size by whoever built it, so that its recursion is shallow. */
export function beyondLimits(q: Query): string | null {
  let terms = 0, names = 0, closures = 0, longest = 0;
  const name = (s: string) => {
    names++;
    longest = Math.max(longest, s.length);
  };
  const depth = (x: Query): number => {
    switch (x.op) {
      case "and":
      case "or":
      case "except":
        return Math.max(depth(x.a), depth(x.b) + (COMBINATORS.includes(x.b.op as Combinator) ? 1 : 0));
      case "tcb":
      case "uses":
      case "usedBy":
        closures++;
        if (x.of !== "selection" && !Array.isArray(x.of)) {
          terms++;
          return 1 + depth(x.of);
        }
        if (Array.isArray(x.of)) x.of.forEach(name);
        terms++;
        return 0;
      case "decl":
        x.names.forEach(name);
        terms++;
        return 0;
      case "key":
        if (x.of === "targets") closures++;
        else {
          x.of.forEach(name);
          closures += x.of.length;
        }
        terms++;
        return 0;
      case "ns":
      case "file":
        name(x.prefix);
        terms++;
        return 0;
      default:
        terms++;
        return 0;
    }
  };
  const L = QUERY_LIMITS;
  const d = depth(q);
  if (d > L.depth) return `the query nests ${d} levels deep, more than ${L.depth}`;
  if (terms > L.terms) return `the query has ${terms} parts, more than ${L.terms.toLocaleString("en")}`;
  if (names > L.names) return `the query names ${names} declarations or prefixes, more than ${L.names.toLocaleString("en")}`;
  if (longest > L.name) return `a name in the query is longer than ${L.name.toLocaleString("en")} characters`;
  if (closures > L.closures) return `the query has ${closures} closures (tcb, uses, usedBy), more than ${L.closures}`;
  const length = printQuery(q).length;
  if (length > L.text) return `the query is ${length.toLocaleString("en")} characters long as printed, more than ${L.text.toLocaleString("en")}`;
  return null;
}

// ---------------------------------------------------------------- the text form

export class QueryError extends Error {
  /** where in the text it went wrong */
  readonly at: number;
  constructor(message: string, at: number) {
    super(message);
    this.at = at;
  }
}

type Token = { t: "(" | ")" | ","; at: number } | { t: "word"; v: string; at: number } | { t: "string"; v: string; at: number };

function tokens(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "(" || c === ")" || c === ",") {
      out.push({ t: c, at: i });
      i++;
    } else if (c === '"') {
      // a JSON string: escapes as JSON has them
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (j >= text.length) throw new QueryError("a quoted name is not closed", i);
      let v: unknown;
      try {
        v = JSON.parse(text.slice(i, j + 1));
      } catch {
        throw new QueryError("a quoted name is not a JSON string", i);
      }
      out.push({ t: "string", v: v as string, at: i });
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s(),"]/.test(text[j])) j++;
      out.push({ t: "word", v: text.slice(i, j), at: i });
      i = j;
    }
  }
  return out;
}

/** The query a text says, within QUERY_LIMITS; throws a QueryError that says where it went wrong,
 *  or what is too large. */
export function parseQuery(text: string): Query {
  if (text.length > QUERY_LIMITS.text) throw new QueryError(`the query is longer than ${QUERY_LIMITS.text.toLocaleString("en")} characters`, 0);
  let q: Query;
  try {
    q = parse(text);
  } catch (e) {
    // the reader follows parentheses by recursion; a guard stops it long before the stack ends,
    // but whatever runs out of stack is a query too large, said as one (a 400, not a 500)
    if (e instanceof RangeError) throw new QueryError("the query is nested too deeply to read", 0);
    throw e;
  }
  const why = beyondLimits(q);
  if (why) throw new QueryError(why, 0);
  return q;
}

function parse(text: string): Query {
  const ts = tokens(text);
  let k = 0;
  // what has been read so far, against the bounds: the reader stops as soon as one is passed, so
  // that what it builds stays small enough for everything after it
  let parens = 0, terms = 0, names = 0;
  const nest = <T>(at: number, read: () => T): T => {
    if (++parens > MAX_PARENS) throw new QueryError(`the query nests more than ${QUERY_LIMITS.depth} levels deep`, at);
    const r = read();
    parens--;
    return r;
  };
  const end = text.length;
  const peek = () => ts[k];
  const where = () => ts[k]?.at ?? end;
  const word = (t: Token | undefined) => (t && t.t === "word" ? ALIASES[t.v.toLowerCase()] ?? t.v : null);
  const keyword = (t: Token | undefined) => {
    const w = word(t);
    if (w === null) return null;
    const lower = w.toLowerCase();
    // keywords are read without regard to case; `usedBy` keeps its capital
    return lower === "usedby" ? "usedBy" : lower;
  };

  const text1 = (t: Token) => ("v" in t ? t.v : t.t);
  const args = (): Token[] => {
    if (peek()?.t !== "(") throw new QueryError(`${text1(ts[k - 1])} takes its arguments in parentheses, e.g. ${text1(ts[k - 1])}(A.b)`, where());
    k++;
    const out: Token[] = [];
    if (peek()?.t === ")") {
      k++;
      return out;
    }
    for (;;) {
      const t = peek();
      if (!t || (t.t !== "word" && t.t !== "string")) throw new QueryError("a name or a word was expected", where());
      if (++names > QUERY_LIMITS.names) throw new QueryError(`the query names more than ${QUERY_LIMITS.names.toLocaleString("en")} declarations or prefixes`, t.at);
      if (t.v.length > QUERY_LIMITS.name) throw new QueryError(`a name is longer than ${QUERY_LIMITS.name.toLocaleString("en")} characters`, t.at);
      out.push(t);
      k++;
      const sep = peek();
      if (sep?.t === ")") {
        k++;
        return out;
      }
      if (sep?.t !== ",") throw new QueryError("a comma or a closing parenthesis was expected", where());
      k++;
    }
  };
  const choose = <T extends string>(xs: Token[], allowed: readonly T[], what: string): T[] => {
    if (!xs.length) throw new QueryError(`${what}: give at least one`, where());
    return xs.map((x) => {
      const v = x.t === "word" ? x.v.toLowerCase() : null;
      const hit = allowed.find((a) => a.toLowerCase() === v);
      if (!hit) throw new QueryError(`${text1(x)} is not one of ${allowed.join(", ")}`, x.at);
      return hit;
    });
  };

  const atom = (): Query => {
    const t = peek();
    if (!t) throw new QueryError("the query ends too early", end);
    if (t.t === "(") {
      k++;
      const q = nest(t.at, expr);
      if (peek()?.t !== ")") throw new QueryError("a closing parenthesis was expected", where());
      k++;
      return q;
    }
    const w = keyword(t);
    if (w === null) throw new QueryError(t.t === "string" ? "a quoted name stands only inside decl(…), tcb(…), uses(…) or usedBy(…)" : `${t.t} is out of place`, t.at);
    if (++terms > QUERY_LIMITS.terms) throw new QueryError(`the query has more than ${QUERY_LIMITS.terms.toLocaleString("en")} parts`, t.at);
    k++;
    if ((PLAIN as readonly string[]).includes(w)) return { op: w } as Query;
    if ((CLOSURES as readonly string[]).includes(w)) {
      // a query inside: it starts with a parenthesis or a word and its parenthesis, or a name is
      // joined to something (a list of names never is)
      const [a, b] = [ts[k + 1], ts[k + 2]];
      const join = keyword(b);
      if (peek()?.t === "(" && (a?.t === "(" || (a?.t === "word" && (b?.t === "(" || (join !== null && (COMBINATORS as string[]).includes(join)))))) {
        k++;
        const of = nest(t.at, expr);
        if (peek()?.t !== ")") throw new QueryError("a closing parenthesis was expected", where());
        k++;
        return { op: w as (typeof CLOSURES)[number], of };
      }
      const xs = args();
      if (xs.length === 1 && xs[0].t === "word" && xs[0].v === "selection") return { op: w as (typeof CLOSURES)[number], of: "selection" };
      if (!xs.length) throw new QueryError(`${w}: give the declarations it starts from`, where());
      return { op: w as (typeof CLOSURES)[number], of: xs.map(text1) };
    }
    if (w === "decl") {
      const xs = args();
      if (!xs.length) throw new QueryError("decl: give at least one name", where());
      return { op: "decl", names: xs.map(text1) };
    }
    if (w === "key") {
      const xs = args();
      if (!xs.length) throw new QueryError("key: give at least one target", where());
      if (xs.length === 1 && xs[0].t === "word" && xs[0].v === "targets") return { op: "key", of: "targets" };
      return { op: "key", of: xs.map(text1) };
    }
    if (w === "ns" || w === "file") {
      const xs = args();
      if (xs.length !== 1) throw new QueryError(`${w}: give one prefix`, where());
      return { op: w, prefix: text1(xs[0]) };
    }
    if (w === "kind") return { op: "kind", kinds: choose(args(), KINDS, "kind") };
    if (w === "status") return { op: "status", statuses: choose(args(), STATUSES, "status") };
    if (w === "advice") return { op: "advice", verdicts: choose(args(), VERDICTS, "advice") };
    throw new QueryError(`${text1(t)} is not a word of the query language (all, tcb, uses, usedBy, decl, key, ns, file, trusted, external, kind, status, advice, sorry, nonstandard)`, t.at);
  };

  const expr = (): Query => {
    let q = atom();
    for (;;) {
      const op = keyword(peek());
      if (!op || !(COMBINATORS as string[]).includes(op)) return q;
      k++;
      q = { op: op as Combinator, a: q, b: atom() };
    }
  };

  const q = expr();
  if (k < ts.length) throw new QueryError(`"${text1(ts[k])}" was not expected here; join conditions with and, or, except`, ts[k].at);
  return q;
}

/** A name as the text form writes it: bare where that reads back the same, quoted otherwise. */
function arg(s: string): string {
  return /^[^\s(),"]+$/.test(s) && s !== "selection" ? s : JSON.stringify(s);
}

/** The canonical text of a query. */
export function printQuery(q: Query): string {
  switch (q.op) {
    case "all":
    case "selection":
    case "trusted":
    case "external":
    case "sorry":
    case "nonstandard":
      return q.op;
    case "decl":
      return `decl(${q.names.map(arg).join(", ")})`;
    case "key":
      // a target named `targets` is a name, quoted: the bare word is every target
      return `key(${q.of === "targets" ? "targets" : q.of.map((t) => (t === "targets" ? JSON.stringify(t) : arg(t))).join(", ")})`;
    case "tcb":
    case "uses":
    case "usedBy": {
      if (q.of === "selection" || Array.isArray(q.of)) return `${q.op}(${q.of === "selection" ? "selection" : q.of.map(arg).join(", ")})`;
      // a query of one plain word would read as a name
      const inner = printQuery(q.of);
      return `${q.op}(${(PLAIN as readonly string[]).includes(q.of.op) ? `(${inner})` : inner})`;
    }
    case "ns":
    case "file":
      return `${q.op}(${arg(q.prefix)})`;
    case "kind":
      return `kind(${q.kinds.join(", ")})`;
    case "status":
      return `status(${q.statuses.join(", ")})`;
    case "advice":
      return `advice(${q.verdicts.join(", ")})`;
    case "and":
    case "or":
    case "except": {
      // read left to right: only a combination on the right needs its parentheses
      const b = COMBINATORS.includes(q.b.op as Combinator) ? `(${printQuery(q.b)})` : printQuery(q.b);
      return `${printQuery(q.a)} ${q.op} ${b}`;
    }
  }
}

/** A query sent as JSON, checked and bounded as its text would be (QUERY_LIMITS); null when it is
 *  not one. Text is parsed. */
export function cleanQuery(x: unknown): Query | null {
  return typeof x === "string" ? readText(x) : readJson(x);
}

function readText(x: string): Query | null {
  try {
    return parseQuery(x);
  } catch {
    return null;
  }
}

/** Why a query's JSON form is not one, or is too large; null when it is fine. */
export function invalidQuery(x: unknown): string | null {
  if (typeof x === "string") {
    try {
      parseQuery(x);
      return null;
    } catch (e) {
      return e instanceof QueryError ? e.message : String(e);
    }
  }
  const q = readJson(x, true);
  return typeof q === "string" ? q : null;
}

function readJson(x: unknown): Query | null;
function readJson(x: unknown, why: true): Query | string;
function readJson(x: unknown, why = false): Query | string | null {
  // whatever names a text could hold, a JSON string can (an empty one included: `decl("")`); a
  // list longer than a query may name is refused before it is looked at
  const str = (s: unknown) => typeof s === "string";
  let large: string | null = null;
  const names = (xs: unknown): xs is string[] => {
    if (Array.isArray(xs) && xs.length > QUERY_LIMITS.names) large = `the query names more than ${QUERY_LIMITS.names.toLocaleString("en")} declarations or prefixes`;
    return Array.isArray(xs) && xs.length > 0 && xs.length <= QUERY_LIMITS.names && xs.every(str);
  };
  // a JSON tree can be as deep as it likes: the walk stops once it has seen more parts than a
  // query may have, so that its own recursion, and everything's after it, stays shallow
  let nodes = 0;
  const walk = (v: unknown): Query | null => {
    if (!v || typeof v !== "object" || ++nodes > 2 * QUERY_LIMITS.terms + 1) return null;
    const o = v as Record<string, unknown>;
    switch (o.op) {
      case "all":
      case "selection":
      case "trusted":
      case "external":
      case "sorry":
      case "nonstandard":
        return { op: o.op };
      case "decl":
        return names(o.names) ? { op: "decl", names: [...o.names] } : null;
      case "key":
        if (o.of === "targets") return { op: "key", of: "targets" };
        return names(o.of) ? { op: "key", of: [...o.of] } : null;
      case "tcb":
      case "uses":
      case "usedBy": {
        if (o.of === "selection") return { op: o.op, of: "selection" };
        if (o.of && typeof o.of === "object" && !Array.isArray(o.of)) {
          const of = walk(o.of);
          return of ? { op: o.op, of } : null;
        }
        return names(o.of) ? { op: o.op, of: [...o.of] } : null;
      }
      case "ns":
      case "file":
        return str(o.prefix) ? { op: o.op, prefix: o.prefix as string } : null;
      case "kind":
        return Array.isArray(o.kinds) && o.kinds.length && o.kinds.every((k) => KINDS.includes(k as Kind)) ? { op: "kind", kinds: [...(o.kinds as Kind[])] } : null;
      case "status":
        return Array.isArray(o.statuses) && o.statuses.length && o.statuses.every((s) => STATUSES.includes(s as ReviewStatus))
          ? { op: "status", statuses: [...(o.statuses as ReviewStatus[])] }
          : null;
      case "advice":
        return Array.isArray(o.verdicts) && o.verdicts.length && o.verdicts.every((s) => VERDICTS.includes(s as Verdict)) ? { op: "advice", verdicts: [...(o.verdicts as Verdict[])] } : null;
      case "and":
      case "or":
      case "except": {
        const a = walk(o.a), b = a && walk(o.b);
        return a && b ? { op: o.op, a, b } : null;
      }
      default:
        return null;
    }
  };
  const q = walk(x);
  if (nodes > 2 * QUERY_LIMITS.terms + 1) large = `the query has more than ${QUERY_LIMITS.terms.toLocaleString("en")} parts`;
  if (!q) return why ? large ?? "it is neither a query's text nor its JSON form" : null;
  const over = beyondLimits(q);
  return over ? (why ? over : null) : q;
}

/** Whether two queries say the same: their canonical texts are one. */
export function sameQuery(a: Query, b: Query): boolean {
  return printQuery(a) === printQuery(b);
}

// ---------------------------------------------------------------- reading a query

/** A scope as the chips show it: the first set, and the conditions applied to it in turn. */
export interface Condition {
  op: Combinator;
  q: Query;
}

export function chainOf(q: Query): { base: Query; conditions: Condition[] } {
  const conditions: Condition[] = [];
  let x = q;
  while (x.op === "and" || x.op === "or" || x.op === "except") {
    conditions.unshift({ op: x.op, q: x.b });
    x = x.a;
  }
  return { base: x, conditions };
}

export function fromChain(base: Query, conditions: Condition[]): Query {
  return conditions.reduce<Query>((a, c) => ({ op: c.op, a, b: c.q }), base);
}

/** What a view opened from a board holds (Zoom in): `q` among what the board holds — the board's
 *  whole scope, not only the conditions it ends with, so that the view holds exactly what was lit
 *  there (on a board of a target's review set, what is in the target's TCB). On a board of everything, or one that is
 *  `q` already, `q` itself. (Whether `q` holds anything the board leaves out is a question of sets:
 *  shared/board.ts, zoomScope.) */
export function within(q: Query, board: Query): Query {
  return board.op === "all" || sameQuery(q, board) ? q : { op: "and", a: q, b: board };
}

/** Every declaration a query names (its roots and decl lists), once each. */
export function namesIn(q: Query): string[] {
  const out = new Set<string>();
  const walk = (x: Query) => {
    if (x.op === "decl") x.names.forEach((n) => out.add(n));
    else if (x.op === "key" && x.of !== "targets") x.of.forEach((n) => out.add(n));
    else if (x.op === "tcb" || x.op === "uses" || x.op === "usedBy") {
      if (Array.isArray(x.of)) x.of.forEach((n) => out.add(n));
      else if (x.of !== "selection") walk(x.of);
    } else if (x.op === "and" || x.op === "or" || x.op === "except") {
      walk(x.a);
      walk(x.b);
    }
  };
  walk(q);
  return [...out];
}

/** Whether the query reads the review (trust, statuses, advice): its set changes with opinions. */
export function readsReview(q: Query): boolean {
  if (q.op === "trusted" || q.op === "status" || q.op === "advice" || q.op === "key") return true;
  if ((q.op === "tcb" || q.op === "uses" || q.op === "usedBy") && q.of !== "selection" && !Array.isArray(q.of)) return readsReview(q.of);
  if (q.op === "and" || q.op === "or" || q.op === "except") return readsReview(q.a) || readsReview(q.b);
  return false;
}

/** The query with the selection replaced by `names`: what is lit now, as a scope (Zoom in). */
export function withSelection(q: Query, names: string[]): Query {
  switch (q.op) {
    case "selection":
      return { op: "decl", names: [...names] };
    case "tcb":
    case "uses":
    case "usedBy":
      if (q.of === "selection") return { op: q.op, of: [...names] };
      return Array.isArray(q.of) ? q : { op: q.op, of: withSelection(q.of, names) };
    case "and":
    case "or":
    case "except":
      return { op: q.op, a: withSelection(q.a, names), b: withSelection(q.b, names) };
    default:
      return q;
  }
}

/** A target's review set (ReviewSpec decision 3): what its review counts (decided 2026-10-08,
 *  shared/reviewqueue.ts) — its TCB without what is trusted, an untrusted outside declaration
 *  included, and the non-standard axioms it rests on through statements, bodies or proofs, which
 *  no prefix trusts: `tcb(T) except trusted or (uses(T) and kind(axiom) and nonstandard)`. */
export function reviewScope(target: string): Query {
  const axioms: Query = { op: "and", a: { op: "and", a: { op: "uses", of: [target] }, b: { op: "kind", kinds: ["axiom"] } }, b: { op: "nonstandard" } };
  return fromChain({ op: "tcb", of: [target] }, [
    { op: "except", q: { op: "trusted" } },
    { op: "or", q: axioms },
  ]);
}

/** What the Keys step of Rests on selects (ViewSpec decision 20): what was clicked — a declaration,
 *  or the set a cluster holds — and the key declarations in its TCB, of the targets `keys` names
 *  (`targets`: every target). That is `decl(X) or (tcb(X) and key(T…))`, written
 *  `tcb(X) and (key(T…) or decl(X))`: the same set, since a TCB holds what it starts from, as one
 *  part that a selection's `or`s never split (web/src/selection.ts, picksOf). */
export function keysQuery(from: string | Query, keys: string[] | "targets"): Query {
  const self: Query = typeof from === "string" ? { op: "decl", names: [from] } : from;
  return { op: "and", a: { op: "tcb", of: typeof from === "string" ? [from] : from }, b: { op: "or", a: { op: "key", of: keys === "targets" ? keys : [...keys] }, b: self } };
}

/** What a query of the Keys step starts from, and whose key declarations it holds; null for any
 *  other query. */
export function readKeys(q: Query): { from: string | Query; keys: string[] | "targets" } | null {
  if (q.op !== "and" || q.a.op !== "tcb" || q.b.op !== "or" || q.b.a.op !== "key") return null;
  const of = q.a.of;
  const from = of === "selection" ? null : Array.isArray(of) ? (of.length === 1 ? of[0] : null) : of;
  return from !== null && sameQuery(keysQuery(from, q.b.a.of), q) ? { from, keys: q.b.a.of } : null;
}

/** Whether the board leaves the outside world out: a condition `except external` on its chain. */
export function withoutOutside(q: Query): boolean {
  return chainOf(q).conditions.some((c) => c.op === "except" && c.q.op === "external");
}

/** The scope with the outside world in (every `except external` taken off its chain) or out (one
 *  added at the end): what the External switch did, now a condition of the board. */
export function setOutside(q: Query, on: boolean): Query {
  const { base, conditions } = chainOf(q);
  const rest = conditions.filter((c) => !(c.op === "except" && c.q.op === "external"));
  return fromChain(base, on ? rest : [...rest, { op: "except", q: { op: "external" } }]);
}

// ---------------------------------------------------------------- in words

const last = (name: string) => {
  const parts = name.split(".");
  const tail = parts[parts.length - 1];
  return /^\d+$/.test(tail) || tail.length <= 2 ? parts.slice(-2).join(".") : tail;
};
const list = (names: string[]) => (names.length > 2 ? `${names.slice(0, 2).map(last).join(", ")} +${names.length - 2}` : names.map(last).join(", "));
const roots = (of: Roots): string => (of === "selection" ? "the selection" : Array.isArray(of) ? list(of) : describe(of));
const or = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}` : xs[0]);
// a Map, not an object: `constructor` is a kind, and an object's own property besides
const PLURAL = new Map<string, string>([["theorem", "theorems"], ["def", "definitions"], ["abbrev", "abbreviations"], ["instance", "instances"], ["structure", "structures"], ["class", "classes"], ["inductive", "inductive types"], ["opaque", "opaque constants"], ["axiom", "axioms"], ["notation", "notations"]]);

/** A set in a few words, for a chip: "TCB of fermatLastTheoremFour", "everything". */
export function describe(q: Query): string {
  // the Keys step's one part (keysQuery), said as what it is rather than as its and and or
  const k = readKeys(q);
  if (k) {
    const what = typeof k.from === "string" ? last(k.from) : describe(k.from);
    const whose = k.keys === "targets" || (k.keys.length === 1 && k.keys[0] === k.from) ? "" : `of ${list(k.keys)} that `;
    return `key declarations ${whose}${what} rests on`;
  }
  switch (q.op) {
    case "all":
      return "everything";
    case "selection":
      return "the selection";
    case "decl":
      return list(q.names);
    case "key":
      return q.of === "targets" ? "key declarations of every target" : `key declarations of ${list(q.of)}`;
    case "tcb":
      return `TCB of ${roots(q.of)}`;
    case "uses":
      return `what ${roots(q.of)} uses`;
    case "usedBy":
      return `what uses ${roots(q.of)}`;
    case "ns":
      return `namespace ${q.prefix}`;
    case "file":
      return `files under ${q.prefix}`;
    case "trusted":
      return "what is trusted";
    case "external":
      return "the outside world";
    case "sorry":
      return "what uses sorry";
    case "nonstandard":
      return "what rests on non-standard axioms";
    case "kind":
      return or(q.kinds.map((k) => PLURAL.get(k) ?? k));
    case "status":
      return or(q.statuses.map((s) => (s === "unreviewed" ? "not yet reviewed" : s)));
    case "advice":
      return `what an agent ${or(q.verdicts.map((v) => (v === "approve" ? "approves" : "comments on")))}`;
    case "and":
    case "or":
    case "except":
      // read left to right, as the text is: a combination on the right in parentheses
      return `${describe(q.a)} ${q.op} ${COMBINATORS.includes(q.b.op as Combinator) ? `(${describe(q.b)})` : describe(q.b)}`;
  }
}

/** A condition in a few words, as its chip reads: "without the outside world", "only theorems". */
export function describeCondition(c: Condition): string {
  const q = c.q;
  if (c.op === "except" && q.op === "external") return "without the outside world";
  if (c.op === "except" && q.op === "trusted") return "except what is trusted";
  if (c.op === "and") {
    if (q.op === "sorry") return "only with sorry";
    if (q.op === "nonstandard") return "only with non-standard axioms";
    if (q.op === "ns") return `only in namespace ${q.prefix}`;
    if (q.op === "file") return `only in files under ${q.prefix}`;
    if (q.op === "kind" || q.op === "status" || q.op === "advice" || q.op === "key") return `only ${describe(q)}`;
    return `and ${describe(q)}`;
  }
  if (c.op === "except") return `except ${describe(q)}`;
  return `or ${describe(q)}`;
}

// ---------------------------------------------------------------- evaluating

/** What a query is evaluated against: the graph, the review it reads, and the selection lighting
 *  up is relative to (numbered in `g`). */
export interface QueryContext {
  g: Graph;
  review: ReviewData;
  selection?: number[];
}

/** The declarations of `ctx.g` a query holds, as a 0/1 array. Names the graph does not hold stand
 *  for nothing. */
export function evaluate(q: Query, ctx: QueryContext): Uint8Array {
  return evaluateIn(q, ctx, new Map());
}

/** `evaluate`, with the closures this evaluation has walked so far, by what each is of: the same
 *  closure asked twice in one query (`uses(usedBy(X)) or usedBy(X)`) walks the graph once. With
 *  QUERY_LIMITS bounding how many a query holds, no query costs more than a few dozen walks. */
function evaluateIn(q: Query, ctx: QueryContext, walks: Map<string, Uint8Array>): Uint8Array {
  const { g, review: d } = ctx;
  const n = g.n;
  const out = new Uint8Array(n);
  const each = (f: (i: number) => boolean) => {
    for (let i = 0; i < n; i++) if (f(i)) out[i] = 1;
    return out;
  };
  const idx = (names: string[]) => names.map((x) => g.byName.get(x)).filter((i): i is number => i !== undefined);
  const roots = (of: Roots) => {
    if (of === "selection") return (ctx.selection ?? []).filter((i) => i >= 0 && i < n);
    if (Array.isArray(of)) return idx(of);
    const set = evaluateIn(of, ctx, walks);
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (set[i]) out.push(i);
    return out;
  };
  switch (q.op) {
    case "all":
      return out.fill(1);
    case "selection":
      for (const i of roots("selection")) out[i] = 1;
      return out;
    case "decl":
      for (const i of idx(q.names)) out[i] = 1;
      return out;
    case "key":
      // each target, and what was marked key for it that its review still holds (its Review
      // view's set, shared/reviewqueue.ts): a mark on what has left the review counts for nothing
      for (const t of q.of === "targets" ? Object.keys(d.targets) : q.of) {
        const root = g.byName.get(t);
        if (root === undefined) continue;
        out[root] = 1;
        const marks = keyMarks(d, t).map((x) => g.byName.get(x)).filter((i): i is number => i !== undefined);
        if (!marks.length) continue;
        const set = evaluateIn(reviewScope(t), ctx, walks);
        for (const i of marks) if (set[i]) out[i] = 1;
      }
      return out;
    case "tcb":
    case "uses":
    case "usedBy": {
      const key = `${q.op}\u0000${q.of === "selection" ? "\u0001" : Array.isArray(q.of) ? JSON.stringify(q.of) : printQuery(q.of)}`;
      let walked = walks.get(key);
      if (!walked) {
        const r = roots(q.of);
        walked = r.length ? g.closure(CLOSURE_MODE[q.op], r) : out;
        walks.set(key, walked);
      }
      // a copy: what combines it below writes into the set it is given
      return walked.slice();
    }
    case "ns":
      return each((i) => under(g.nodes[i].name, q.prefix));
    case "file":
      return each((i) => under(g.nodes[i].module, q.prefix));
    case "trusted":
      return each((i) => trusted(d, g.nodes[i].name, g.nodes[i].module, g.isExt(i)));
    case "external":
      return each((i) => g.isExt(i));
    case "sorry":
      return each((i) => g.axiomsOf(i).includes("sorryAx"));
    case "nonstandard":
      return each((i) => g.axiomsOf(i).some((a) => !STANDARD_AXIOMS.includes(a)));
    case "kind": {
      const ks = new Set<string>(q.kinds);
      return each((i) => ks.has(g.nodes[i].kind));
    }
    case "status": {
      const ss = new Set<string>(q.statuses.map((s) => (s === "unreviewed" ? "none" : s)));
      return each((i) => ss.has(statusOf(d, g.nodes[i].name, g.nodes[i].hash)));
    }
    case "advice": {
      const vs = new Set<string>(q.verdicts);
      return each((i) => {
        const a = adviceOf(d, g.nodes[i].name, g.nodes[i].hash);
        return a !== null && vs.has(a);
      });
    }
    case "and":
    case "or":
    case "except": {
      const a = evaluateIn(q.a, ctx, walks);
      const b = evaluateIn(q.b, ctx, walks);
      for (let i = 0; i < n; i++) a[i] = q.op === "and" ? a[i] & b[i] : q.op === "or" ? a[i] | b[i] : a[i] & (1 - b[i]);
      return a;
    }
  }
}
