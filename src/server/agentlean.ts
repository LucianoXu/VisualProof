// What Lean itself says of a name, the endpoints of server/agent.ts that ask Lean's language server
// (server/hover.ts): its hover (describe) and what `#print` shows of it (print), asked where a module
// of the project's graph is imported, and only there — the module is chosen from the graph, and only
// a name that passes isDeclName is ever written into Lean source.

import { isDeclName } from "./hover.ts";
import { View } from "./agentgraph.ts";
import type { AgentApi, Answer, Ask } from "./agent.ts";
import { clampInt, fail, flag, ok } from "./agent.ts";

/** The name Lean is asked about and the module imported to ask it: `module` when given (a module
 *  of the project's graph), else the declaration's own; for a name the graph does not hold — a
 *  constructor, a field, something a macro generated, all folded into the declaration that owns
 *  them — the module of the nearest declaration its name is under; else the project's root
 *  module, which imports all of it. A declaration of the outside world is asked about where a
 *  module of the project imports it (View.homeOf): only the graph's own modules (meta.modules)
 *  are ever imported. Only a name that passes isDeclName gets this far: it is written into Lean
 *  source. */
export function leanTarget(api: AgentApi, v: View, q: URLSearchParams): LeanTarget | Answer {
  const name = (q.get("name") ?? "").trim();
  if (!name) return fail(400, "name is missing.", "Give name=<a full Lean name>; GET /api/agent/search?q=<words> finds a declaration.");
  if (!isDeclName(name)) return fail(400, "name is not a Lean name.", "Give a full dotted name and nothing else, e.g. Nat.Prime.eq_one_or_self_of_dvd.");
  const given = q.get("module")?.trim() || null;
  if (given) {
    if (!isDeclName(given) || !v.modules.has(given))
      return fail(400, `${given.slice(0, 300)} is not a module of the project's graph.`, "Give one of the project's modules, or leave module out: the declaration's own is used (for one of the outside world, a module of the project that imports it).");
    return { name, module: given, chosen: "given" };
  }
  const i = v.g.byName.get(name);
  // a notation unit is asked about by its Lean constant: its name is not one
  if (i !== undefined) {
    const lean = v.g.nodes[i].leanName;
    const t = leanHome(api, v, lean ?? name, i, "its own");
    return lean && "module" in t ? { ...t, unit: name } : t;
  }
  // generated from the command that writes a declaration: asked where that one is
  const u = v.g.foldedInto.get(name);
  if (u !== undefined) return leanHome(api, v, name, u, `that of ${v.g.nodes[u].name}, the declaration its command writes`, v.g.nodes[u].name);
  for (let k = name.lastIndexOf("."); k > 0; k = name.lastIndexOf(".", k - 1)) {
    const j = v.g.byName.get(name.slice(0, k));
    if (j !== undefined) return leanHome(api, v, name, j, `that of ${v.g.nodes[j].name}, the declaration it is under`, v.g.nodes[j].name);
  }
  if (v.root) return { name, module: v.root, chosen: "the project's root module, which imports all of it" };
  return api.find(v, name) as Answer;
}

/** Lean asked about `name` where declaration `j` is known: its own module (`own` says so), or for
 *  one of the outside world a module of the project that imports it (View.homeOf). */
export function leanHome(api: AgentApi, v: View, name: string, j: number, own: string, under?: string): LeanTarget | Answer {
  if (!v.g.isExt(j)) return { name, module: v.g.nodes[j].module, chosen: own, ...(under ? { under } : {}) };
  const h = v.homeOf(j);
  if (!h) return fail(404, `There is no module of the project to ask Lean about ${name} in.`, "Give module=<a module of the project that imports it>.");
  return { name, module: h.module, chosen: h.why, ...(under ? { under } : {}) };
}

/** Lean says it knows no such name where the module is imported: what was meant, from the graph. */
export function unknownToLean(api: AgentApi, v: View, t: LeanTarget, said?: string): Answer {
  const guesses = [...(t.under ? [t.under] : []), ...api.guess(v, t.name)].filter((x, k, xs) => xs.indexOf(x) === k).slice(0, 5);
  return fail(
    404,
    `Lean knows no ${t.name} where ${t.module} is imported.`,
    t.under
      ? `GET /api/agent/print?name=${encodeURIComponent(t.under)} lists what ${t.under} holds (a structure's fields and constructor); or give the module that declares the name.`
      : guesses.length ? `Did you mean ${guesses[0]}? Or give the module that declares it.` : "Give the module that declares it, or check the name with GET /api/agent/search.",
    { didYouMean: guesses, ...(said ? { lean: said } : {}) },
  );
}

/** Lean is still loading a module's imports: ask again. */
export function loading(api: AgentApi, module: string, pending: unknown): Answer {
  return fail(503, `Lean is still loading the imports of ${module}.`, "Ask again in a few seconds (Retry-After); the first question about a module can take a minute.", { pending, retryAfter: 5 }, { "retry-after": "5" });
}

export async function describe(api: AgentApi, a: Ask): Promise<Answer> {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const t = leanTarget(api, v, a.query);
  if (!("module" in t)) return t;
  return describeOf(api, v, t, clampInt(a.query.get("wait"), 20_000, 1000, MAX_WAIT));
}

export async function describeOf(api: AgentApi, v: View, t: LeanTarget, wait: number): Promise<Answer> {
  if (!api.lean) return fail(503, "There is no Lean to ask here.", "GET /api/agent/declaration gives the statement and docstring from the graph.");
  const r = await api.lean.describe(t.module, t.name, wait);
  if (r.pending) return loading(api, t.module, r.pending);
  if (r.error) return fail(502, `Lean could not answer: ${r.error}`, "GET /api/agent/declaration gives the statement and docstring from the graph.");
  if (!r.contents) return unknownToLean(api, v, t, r.refused);
  return ok({ name: t.name, ...(t.unit ? { unit: t.unit } : {}), module: t.module, moduleChosen: t.chosen, inGraph: !!t.unit || v.g.byName.has(t.name), lean: r.contents });
}

export async function print(api: AgentApi, a: Ask): Promise<Answer> {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const t = leanTarget(api, v, a.query);
  if (!("module" in t)) return t;
  return printOf(api, v, t, flag(a.query.get("proofs")), clampInt(a.query.get("wait"), 20_000, 1000, MAX_WAIT));
}

/** What `#print` shows: the elaborated declaration with its value, every name in full. */
export async function printOf(api: AgentApi, v: View, t: LeanTarget, proofs: boolean, wait: number): Promise<Answer> {
  if (!api.lean) return fail(503, "There is no Lean to ask here.", "GET /api/agent/source gives the declaration's text.");
  const r = await api.lean.print(t.module, t.name, proofs, wait);
  if (r.pending) return loading(api, t.module, r.pending);
  if (r.error || !r.messages) return fail(502, `Lean could not answer: ${r.error ?? "no messages"}`, "GET /api/agent/source gives the declaration's text.");
  const errors = r.messages.filter((m) => m.severity === "error");
  if (errors.length) {
    if (errors.some((m) => /unknown (constant|identifier)/i.test(m.text))) return unknownToLean(api, v, t, errors[0].text);
    return fail(422, `Lean could not print ${t.name}: ${errors[0].text.slice(0, 500)}`, "GET /api/agent/describe gives its signature; /api/agent/source its text.", { lean: errors.map((m) => m.text.slice(0, 2000)) });
  }
  let text = r.messages.filter((m) => m.severity === "information").map((m) => m.text).join("\n\n");
  const length = text.length;
  // cut at a line's end where there is one near the bound
  if (length > MAX_PRINT) {
    const nl = text.lastIndexOf("\n", MAX_PRINT);
    text = text.slice(0, nl > MAX_PRINT * 0.8 ? nl : MAX_PRINT);
  }
  const warnings = r.messages.filter((m) => m.severity === "warning").map((m) => m.text);
  // what the value is made of that the same command generated (a `module`'s code, a structure's
  // projections): not shown here, and only asked for by name
  const unit = v.g.byName.get(t.unit ?? t.name) ?? v.g.foldedInto.get(t.name);
  const seeAlso = unit === undefined ? [] : (v.g.nodes[unit].also ?? []).filter((x) => x !== t.name && text.includes(x)).slice(0, 20);
  return ok({
    name: t.name,
    // asked by a notation unit's name: `name` is its Lean constant, what Lean answered about
    ...(t.unit ? { unit: t.unit } : {}),
    module: t.module,
    moduleChosen: t.chosen,
    inGraph: !!t.unit || v.g.byName.has(t.name),
    proofs,
    lean: text,
    ...(length > text.length ? { truncated: { shown: text.length, length }, note: proofs ? "Cut short: leave proofs out to see the statement and the definitions' values whole." : "Cut short." } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(seeAlso.length ? { seeAlso, seeAlsoNote: `This refers to ${seeAlso.join(", ")}, which Lean generated from the same command: GET /api/agent/print?name=<each> shows ${seeAlso.length > 1 ? "them" : "it"}.` } : {}),
  });
}

/** the longest Lean is waited for, per question (per request, where one asks several) */
export const MAX_WAIT = 60_000;

/** the most of what `#print` says that an answer carries, in UTF-16 units: a theorem's proof term,
 *  printed with `proofs=1`, can run to megabytes */
export const MAX_PRINT = 50_000;

/** What Lean is asked about: a name, the module imported to ask, why that module, and the
 *  declaration of the graph the name is under, where it is not one itself. */
export interface LeanTarget {
  name: string;
  module: string;
  chosen: string;
  under?: string;
  /** the notation unit asked about, where its Lean constant (`name`) is asked instead */
  unit?: string;
}
