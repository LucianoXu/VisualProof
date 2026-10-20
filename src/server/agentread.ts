// Reading declarations (docs/agent-api/reading.md), the endpoints of server/agent.ts an agent reads
// the project by: the search; a declaration, or several at once, with the answers of the other
// endpoints for it (`include`); its source as compiled, or at a past build; the context it is written
// in; what it uses and what uses it; a module of the project, with its doc comments. Only the files
// the graph was read from are read.

import { contextText, readContext } from "../shared/context.ts";
import { compiledExcerpt, excerptOf } from "../shared/excerpt.ts";
import { tokenizeLean } from "../shared/lexer.ts";
import { SITE_BODY, SITE_GRAMMAR, SITE_PROOF, SITE_STMT } from "../shared/graph.ts";
import { advice, current, keyFor, STANDARD_AXIOMS, statusOf } from "../shared/review.ts";
import { contextAt, namespacesOf } from "../shared/scope.ts";
import { PLACES, search, snippet } from "../shared/search.ts";
import { ALL_SITES } from "../shared/viewgraph.ts";
import { View } from "./agentgraph.ts";
import { MAX_WAIT, describeOf, leanHome, printOf } from "./agentlean.ts";
import type { AgentApi, Answer, Ask, Caller } from "./agent.ts";
import { clampInt, fail, flag, ok } from "./agent.ts";

/** A module of the project (AgentSpec, after the trial of decision 7): its file's doc comments
 *  (`/-! … -/`, where a project keeps the reasons behind its definitions) and every declaration
 *  in it in the order of the file, so that what sits beside a declaration — a variant, a weaker
 *  form — can be found without reading the file. */
export function moduleGet(api: AgentApi, a: Ask): Answer {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  let name = (a.query.get("name") ?? "").trim();
  const of = a.query.get("of");
  if (!name && of) {
    const i = api.find(v, of, "of");
    if (typeof i !== "number") return i;
    name = v.g.nodes[i].module;
  }
  if (!name) return fail(400, "name is missing.", "Give name=<a module of the project> (a declaration's module, as GET declaration says it), or of=<a declaration>.");
  const m = v.modules.get(name);
  if (!m) {
    const last = name.split(".").pop()!.toLowerCase();
    const near = [...v.modules.keys()].filter((x) => x.toLowerCase().split(".").pop() === last || x.toLowerCase() === name.toLowerCase()).slice(0, 5);
    return fail(404, `${name} is not a module of the project's graph.`, near.length ? `Did you mean ${near[0]}?` : "A declaration's answer gives its module (GET /api/agent/declaration?name=…).", { didYouMean: near });
  }
  const g = v.g;
  const decls: { i: number; line: number }[] = [];
  for (let i = 0; i < g.projectCount; i++) if (g.nodes[i].module === name) decls.push({ i, line: g.nodes[i].range?.[0] ?? Infinity });
  decls.sort((x, y) => x.line - y.line || (g.nodes[x.i].name < g.nodes[y.i].name ? -1 : 1));
  const f = api.file(v, name);
  const docs: { line: number; endLine: number; text: string }[] = [];
  let docChars = 0, cut = false;
  if (f) {
    const text = f.lines.join("\n");
    const starts = [0];
    for (let k = 0; k < text.length; k++) if (text[k] === "\n") starts.push(k + 1);
    const lineOf = (at: number) => {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= at) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    };
    for (const t of tokenizeLean(text)) {
      if (t.kind !== "doc" || !t.text.startsWith("/-!")) continue;
      const body = t.text.replace(/^\/-!/, "").replace(/-\/$/, "").replace(/^[ \t]*\n?/, "").trimEnd();
      if (docChars + body.length > MAX_MODULE_DOCS) {
        cut = true;
        break;
      }
      docChars += body.length;
      docs.push({ line: lineOf(t.at), endLine: lineOf(t.at + t.text.length - 1), text: body });
    }
  }
  return ok({
    name,
    file: m.file,
    ...(f ? { compiled: !f.edited, ...(f.edited ? { note: "The file changed since it was compiled: its doc comments are read from the present text, its declarations are the compiled ones." } : {}) } : {}),
    imports: m.imports,
    importedBy: [...v.modules].filter(([, x]) => x.imports.includes(name)).map(([k]) => k).sort(),
    docs,
    ...(cut ? { docsCut: `Doc comments past ${MAX_MODULE_DOCS.toLocaleString("en")} characters are left out; GET /api/agent/source of a declaration further down shows its text.` } : {}),
    count: decls.length,
    declarations: decls.map(({ i }) => {
      const n = g.nodes[i];
      return { name: n.name, kind: n.kind, line: n.range?.[0] ?? null, ...(n.display ? { display: n.display } : {}), ...(g.isGrammar(i) ? { grammar: true } : {}), ...(n.also?.length ? { also: n.also.length } : {}) };
    }),
  });
}

export function searchGet(api: AgentApi, a: Ask): Answer {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const q = (a.query.get("q") ?? "").trim();
  if (q.length < 2) return fail(400, "q is missing or shorter than two characters.", "GET /api/agent/search?q=<words>: every word must be found in the name, the statement or the docstring.");
  const limit = clampInt(a.query.get("limit"), 20, 1, 200);
  const f = search(v.index, q);
  const hits = PLACES.flatMap((w) => f.hits[w]);
  return ok({
    query: q,
    counts: { name: f.hits.name.length, statement: f.hits.statement.length, doc: f.hits.doc.length },
    hits: hits.slice(0, limit).map((h) => {
      const p = h.where === "statement" ? 1 : h.where === "doc" ? 2 : null;
      const s = p === null ? null : snippet(v.index.text[p][h.i], v.index.lower[p][h.i], f.words, h.word, 160, 50);
      return {
        ...api.brief(v, h.i),
        where: h.where,
        // found by a name Lean generated from its command, folded into it
        ...(h.via !== undefined ? { via: h.via } : {}),
        ...(s ? { snippet: (s.before ? "…" : "") + s.pieces.map((x) => x.text).join("") + (s.after ? "…" : "") } : {}),
      };
    }),
    more: Math.max(0, hits.length - limit),
  });
}

export async function declaration(api: AgentApi, a: Ask): Promise<Answer> {
  // several at once: as GET declarations answers them
  if (a.query.has("names")) return declarations(api, a);
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const include = parts(a.query.get("include"));
  if (!Array.isArray(include)) return include;
  const i = api.find(v, a.query.get("name"));
  if (typeof i !== "number") return i;
  return ok({ ...(await withParts(api, v, i, a, include, Date.now() + clampInt(a.query.get("wait"), 20_000, 1000, MAX_WAIT))), ...api.folded(v, a.query.get("name"), i) });
}

/** Several declarations at once, each answered as GET declaration would (with the same
 *  `include`); a name that is not there is answered on its own and does not refuse the others. */
export async function declarations(api: AgentApi, a: Ask): Promise<Answer> {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const include = parts(a.query.get("include"));
  if (!Array.isArray(include)) return include;
  const names = [...new Set(a.query.getAll("names").flatMap(splitNames))];
  if (!names.length) return fail(400, "names is missing.", `Give names=<full name>,<full name>,… (at most ${MAX_NAMES}).`);
  if (names.length > MAX_NAMES) return fail(400, `${names.length} names: at most ${MAX_NAMES} are read at once.`, "Ask again for the rest.");
  // Lean's parts share the request's wait: one name's slow answer leaves less for the next
  const deadline = Date.now() + clampInt(a.query.get("wait"), 20_000, 1000, MAX_WAIT);
  const out: Record<string, unknown>[] = [];
  for (const name of names) {
    const i = api.find(v, name);
    out.push(typeof i === "number" ? { ...(await withParts(api, v, i, a, include, deadline)), ...api.folded(v, name, i) } : { name, status: i.status, ...(i.body as object) });
  }
  return ok({ count: names.length, found: out.filter((x) => x.status === undefined).length, declarations: out });
}

/** A declaration's answer with the parts asked for, each what its own endpoint answers — or, where
 *  that part could not be answered, its error with its `status`, listed in `failed`. */
export async function withParts(api: AgentApi, v: View, i: number, a: Ask, include: Part[], deadline: number): Promise<Record<string, unknown>> {
  const out = declarationOf(api, v, i, a.caller);
  const failed: Record<string, number> = {};
  const own = leanHome(api, v, v.g.nodes[i].leanName ?? v.g.nodes[i].name, i, "its own");
  for (const p of include) {
    const left = deadline - Date.now();
    // Lean's parts wait for what is left of the request's wait
    const r =
      p === "source" ? sourceOf(api, v, i)
      : p === "context" ? contextOf(api, v, i)
      : p === "uses" || p === "users" ? refs(api, v, i, p, a.query)
      : !("module" in own) ? own
      : left < 500 ? fail(503, "Not asked: the request's wait ran out.", "Ask for this part again.", { retryAfter: 1 })
      : p === "describe" ? await describeOf(api, v, own, left)
      : await printOf(api, v, own, flag(a.query.get("proofs")), left);
    if (r.status === 200) out[p] = r.body;
    else {
      out[p] = { status: r.status, ...(r.body as object) };
      failed[p] = r.status;
    }
  }
  if (Object.keys(failed).length) out.failed = failed;
  return out;
}

/** Everything about one declaration, as GET declaration answers it without parts. */
export function declarationOf(api: AgentApi, v: View, i: number, me: Caller): Record<string, unknown> {
  const g = v.g;
  const n = g.nodes[i];
  const d = api.world.review.data;
  const ext = g.isExt(i);
  const axioms = g.axiomsOf(i);
  const t = api.trust(v, i);
  const targets = Object.keys(d.targets)
    .sort()
    .filter((x) => {
      const r = g.byName.get(x);
      return r !== undefined && v.tcb(r)[i] === 1;
    });
  const users = new Set<number>();
  for (let e = g.inStart[i]; e < g.inStart[i + 1]; e++) if (g.inSrc[e] !== i) users.add(g.inSrc[e]);
  const uses = new Set<number>();
  for (let e = g.outStart[i]; e < g.outStart[i + 1]; e++) if (g.outDst[e] !== i) uses.add(g.outDst[e]);
  const all = g.reach([i], ALL_SITES, "in").reduce((s, x) => s + x, 0) - 1;
  const tcb = v.tcb(i);
  let tcbOwn = 0, tcbExt = 0;
  for (let j = 0; j < g.n; j++) if (tcb[j] && j !== i) g.isExt(j) ? tcbExt++ : tcbOwn++;
  const file = ext ? null : v.modules.get(n.module)?.file ?? null;
  const f = ext ? null : api.file(v, n.module);
  return {
    name: n.name,
    kind: n.kind,
    module: n.module,
    external: ext,
    file,
    range: n.range ? { line: n.range[0], col: n.range[1], endLine: n.range[2], endCol: n.range[3] } : null,
    statement: n.type ?? null,
    doc: n.doc ?? null,
    // what Lean generated from the command that writes it, folded into it: one unit, whose
    // references, axioms and hash are theirs too
    also: n.also ?? [],
    // a notation unit: the Lean constant it is made of (for #print and hovers), what the page calls
    // it, whether it only declares grammar (and is in no TCB), what it interprets or what
    // interprets it
    ...(n.leanName ? { leanName: n.leanName } : {}),
    ...(n.display ? { display: n.display } : {}),
    ...(v.g.isGrammar(i) ? { grammar: true, interpretedBy: n.rules ?? [] } : {}),
    ...(n.interprets?.length ? { interprets: n.interprets } : {}),
    flags: n.flags ?? [],
    axioms,
    nonStandardAxioms: axioms.filter((x) => !STANDARD_AXIOMS.includes(x)),
    hash: n.hash ?? null,
    // the kernel's own content hash, names included, which a rename changes (server/versions.ts)
    ...(n.kernel ? { kernel: n.kernel } : {}),
    // the file is not what was compiled: the graph, and an opinion's hash, are about the compiled text
    editedSinceCompiled: f ? f.edited : null,
    review: {
      status: statusOf(d, n.name, n.hash),
      trusted: t.trusted,
      trustedBy: t.trustedBy,
      needsReview: !t.trusted,
      opinions: current(d, n.name).map((o) => api.opinion(o, n.hash, me)),
      advice: advice(d, n.name).map((o) => api.opinion(o, n.hash, me)),
      youAdvised: api.advised(v, i, me),
    },
    isTarget: !!d.targets[n.name],
    // the targets it is marked key for (ExportSpec decision 1)
    keyFor: keyFor(d, n.name),
    inTcbOf: targets,
    tcbSize: { project: tcbOwn, external: tcbExt },
    // how many it refers to by name (GET uses lists them); `uses` is the name of that part
    usesDirect: uses.size,
    usedBy: { direct: users.size, all },
  };
}

export function source(api: AgentApi, a: Ask): Answer {
  // a past build's text (HistorySpec decision 23), which needs no graph on show
  const snap = a.query.get("snapshot");
  if (snap !== null && snap !== "") return pastSource(api, a.query.get("name"), snap);
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const i = api.find(v, a.query.get("name"));
  if (typeof i !== "number") return i;
  const r = sourceOf(api, v, i);
  return r.status === 200 ? ok({ ...(r.body as object), ...api.folded(v, a.query.get("name"), i) }) : r;
}

export function sourceOf(api: AgentApi, v: View, i: number): Answer {
  const n = v.g.nodes[i];
  if (v.g.isExt(i)) return fail(404, `${n.name} is outside the project (${n.module}): there is no source here.`, `Ask Lean about it: GET /api/agent/describe or /api/agent/print?name=${encodeURIComponent(n.name)}.`);
  if (!n.range) return fail(404, `The graph records no place for ${n.name} in its file.`, "GET /api/agent/declaration gives its statement; /api/agent/print what Lean elaborated.");
  const f = api.file(v, n.module);
  if (!f) return fail(404, `The file of ${n.module} cannot be read.`, "GET /api/agent/declaration gives its statement.");
  const at = excerptOf(f.lines, f.edited, n.name, n.range);
  if (!at) return fail(404, `${n.name} is no longer in ${f.rel}: the file changed since it was compiled.`, "Wait for the build; GET /api/agent/declaration gives the compiled statement.");
  return ok({
    name: n.name,
    module: n.module,
    file: f.rel,
    compiled: !f.edited,
    ...(n.gen !== undefined
      ? { generatedNote: `Lean generated ${n.name} from a command, and no declaration that command writes was found to fold it into: it is not written in the source, and this is the command's text. GET /api/agent/print gives what Lean made of it.` }
      : {}),
    ...(n.also?.length
      ? { also: n.also, alsoNote: `Lean generated these from the same command; they are part of ${n.name}'s unit, and its hash covers them. GET /api/agent/print?name=<one of them> shows what Lean made.` }
      : {}),
    ...(f.edited
      ? { note: "The file changed since it was compiled: this is the present text, found by name. The graph and the content hash are about the compiled text, so advice on it waits until the file is compiled again." }
      : {}),
    // what is in force where it is written, as Lean (shared/context.ts): advice records it with
    // the text, a blank line between them
    context: contextText(readContext(f.lines, at.start, api.exact(n.module, n.name, f))),
    text: f.lines.slice(at.start, at.end + 1).join("\n"),
  });
}

/** Declaration `name`'s source at the build of snapshot `raw` (HistorySpec decision 23): found in
 *  that build's graph by its name then, by its name now through the renames since, or as a name
 *  Lean generated from a command; read from the text its module's build was compiled from, the
 *  context it is written in read from that text. A text not kept is said so, never stood in for
 *  by another. */
export function pastSource(api: AgentApi, name: string | null, raw: string): Answer {
  const h = api.world.history;
  if (!h) return fail(404, "This server keeps no history: it serves a saved graph.", "Leave snapshot out for the source as it was compiled last.");
  const id = Number(raw);
  const s = Number.isInteger(id) ? h.get(id) : null;
  if (!s) return fail(404, `There is no snapshot ${raw.slice(0, 40)}.`, "GET /api/agent/history lists them.");
  const want = name?.trim();
  if (!want) return fail(400, "name is missing.", "Give name=<a declaration's full name> and snapshot=<a snapshot's id>.");
  const g = h.graph(id)!;
  const own = (k: number) => k < g.projectCount;
  let i = g.nodes.findIndex((n, k) => own(k) && n.name === want);
  if (i < 0) {
    // renamed since: its name then
    const latest = h.latest();
    for (const [then, now] of latest ? api.world.renamesBetween?.(id, latest.id) ?? [] : [])
      if (now === want) i = g.nodes.findIndex((n, k) => own(k) && n.name === then);
  }
  if (i < 0) i = g.nodes.findIndex((n, k) => own(k) && !!n.also?.includes(want));
  const build = { id, at: s.at, commit: s.commit };
  if (i < 0) {
    if (g.nodes.some((n, k) => !own(k) && n.name === want)) return fail(404, `${want} is outside the project: there is no source here.`, `Ask Lean about it: GET /api/agent/describe?name=${encodeURIComponent(want)}.`);
    return fail(404, `There is no declaration ${want} in the graph of snapshot ${id}.`, `GET /api/agent/history/last?name=${encodeURIComponent(want)} finds the newest build that had it.`, { snapshot: build });
  }
  const n = g.nodes[i];
  const renamed = n.name !== want ? { asked: want } : {};
  if (!n.range) return fail(404, `Snapshot ${id} records no place for ${n.name} in its file.`, `GET /api/agent/history/graph?id=${id} gives its statement then.`, { snapshot: build });
  const t = h.textOf(id, n.module);
  if (!t || t.text === null) {
    const why = t?.ref.why ?? (h.sourcesOf(id) === null ? "the texts of that build are still being looked for" : "its module has no file of the project");
    return fail(404, `The source of ${n.name} at snapshot ${id} is not kept: ${why}.`, `Its statement and doc then are below; GET /api/agent/history/graph?id=${id} gives the whole graph then.`, {
      kept: false,
      name: n.name,
      ...renamed,
      module: n.module,
      snapshot: build,
      statement: n.type,
      ...(n.doc ? { doc: n.doc } : {}),
    });
  }
  const lines = t.text.split("\n");
  const at = compiledExcerpt(lines, n.range);
  return ok({
    name: n.name,
    ...renamed,
    module: n.module,
    file: t.ref.file,
    snapshot: build,
    compiled: true,
    check: t.ref.check,
    note:
      t.ref.check === "places"
        ? "The text this build was compiled from, matched by the places the build recorded — its imports, where each declaration starts and ends, its doc comments and names — since its Lake hash was not kept (a build from before the history kept texts). A past build is not reviewed: advice is given on the latest build."
        : "The text this build was compiled from: its Lake hash is the one the build recorded. A past build is not reviewed: advice is given on the latest build.",
    line: at.start + 1,
    endLine: at.end + 1,
    context: contextText(readContext(lines, at.start, null)),
    text: lines.slice(at.start, at.end + 1).join("\n"),
  });
}

export function context(api: AgentApi, a: Ask): Answer {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const i = api.find(v, a.query.get("name"));
  if (typeof i !== "number") return i;
  const r = contextOf(api, v, i);
  return r.status === 200 ? ok({ ...(r.body as object), ...api.folded(v, a.query.get("name"), i) }) : r;
}

/** What is in force where a declaration is written, read from its file up to its text: the
 *  namespaces and sections around it, opens, variables, universes, options, local commands. */
export function contextOf(api: AgentApi, v: View, i: number): Answer {
  const n = v.g.nodes[i];
  if (v.g.isExt(i)) return fail(404, `${n.name} is outside the project (${n.module}): there is no file here to read.`, `Ask Lean about it: GET /api/agent/print?name=${encodeURIComponent(n.name)}.`);
  if (!n.range) return fail(404, `The graph records no place for ${n.name} in its file.`, "GET /api/agent/print shows what Lean elaborated, every name in full.");
  const f = api.file(v, n.module);
  if (!f) return fail(404, `The file of ${n.module} cannot be read.`, "GET /api/agent/print shows what Lean elaborated, every name in full.");
  const at = excerptOf(f.lines, f.edited, n.name, n.range);
  if (!at) return fail(404, `${n.name} is no longer in ${f.rel}: the file changed since it was compiled.`, "Wait for the build; GET /api/agent/declaration gives the compiled statement.");
  const spaces = namespacesOf(v.g);
  const exact = api.exact(n.module, n.name, f);
  return ok({
    name: n.name,
    module: n.module,
    file: f.rel,
    compiled: !f.edited,
    ...(f.edited ? { note: "The file changed since it was compiled: this is read from the present text, up to where the declaration is found by name now." } : {}),
    line: at.start + 1,
    imports: v.modules.get(n.module)?.imports ?? [],
    // the elaborator's scope where the usage pass read it (opens resolved, variables Lean included
    // marked used), else the file's text read up to the declaration
    precision: exact ? "elaborated" : "text",
    ...(exact ?? contextAt(f.lines, at.start, (x) => spaces.has(x))),
  });
}

export function refsGet(api: AgentApi, a: Ask, dir: "uses" | "users"): Answer {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const i = api.find(v, a.query.get("name"));
  if (typeof i !== "number") return i;
  const r = refs(api, v, i, dir, a.query);
  return r.status === 200 ? ok({ ...(r.body as object), ...api.folded(v, a.query.get("name"), i) }) : r;
}

/** What a declaration refers to by name (`uses`), or what refers to it (`users`), with where each
 *  reference sits — in the statement, a definition's body, a proof (of the declaration that makes
 *  it) — and whether what it names is trusted. Statement first, then body, then proof; the
 *  project before the outside world; then by name. Paged. */
export function refs(api: AgentApi, v: View, i: number, dir: "uses" | "users", q: URLSearchParams): Answer {
  const g = v.g;
  const where = q.get("where");
  const only = where === null || where === "" ? 0 : WHERE[where];
  if (only === undefined) return fail(400, `where is statement, body, proof or grammar, not ${where}.`, "Leave it out for every reference.");
  const start = dir === "uses" ? g.outStart : g.inStart;
  const adj = dir === "uses" ? g.outDst : g.inSrc;
  const site = dir === "uses" ? g.outSite : g.inSite;
  // a declaration may refer to another from several places: one row, every place
  const sites = new Map<number, number>();
  for (let e = start[i]; e < start[i + 1]; e++) if (adj[e] !== i) sites.set(adj[e], (sites.get(adj[e]) ?? 0) | site[e]);
  const counts = { total: sites.size, statement: 0, body: 0, proof: 0, project: 0, external: 0, trusted: 0 };
  const rows: { j: number; s: number; first: number; trusted: boolean; trustedBy: string[] }[] = [];
  for (const [j, s] of sites) {
    const t = api.trust(v, j);
    if (s & SITE_STMT) counts.statement++;
    if (s & SITE_BODY) counts.body++;
    if (s & SITE_PROOF) counts.proof++;
    g.isExt(j) ? counts.external++ : counts.project++;
    if (t.trusted) counts.trusted++;
    if (!only || s & only) rows.push({ j, s, first: s & SITE_STMT ? 0 : s & SITE_BODY ? 1 : 2, ...t });
  }
  rows.sort((x, y) => x.first - y.first || Number(g.isExt(x.j)) - Number(g.isExt(y.j)) || (g.nodes[x.j].name < g.nodes[y.j].name ? -1 : 1));
  const offset = clampInt(q.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(q.get("limit"), 100, 1, 1000);
  return ok({
    name: g.nodes[i].name,
    direction: dir,
    note:
      (dir === "uses" ? `What ${g.nodes[i].name} refers to by name; where: the parts of it each reference sits in.` : `What refers to ${g.nodes[i].name} by name; where: the parts of each of them the reference sits in.`) +
      " A reference to a constructor, field, matcher or other generated constant is one to the declaration that owns it." +
      " The notation a text is written in is listed too, as units of kind notation: the rule that ran, where it is used, and the syntax, at the grammar site (grammar: true), which no TCB holds.",
    counts,
    ...(only ? { where } : {}),
    offset,
    limit,
    total: rows.length,
    next: offset + limit < rows.length ? offset + limit : null,
    refs: rows.slice(offset, offset + limit).map((r) => ({
      ...api.brief(v, r.j),
      where: Object.keys(WHERE).filter((w) => r.s & WHERE[w]),
      trusted: r.trusted,
      ...(r.trusted ? { trustedBy: r.trustedBy } : {}),
    })),
  });
}

/** the most of a module's doc comments one answer carries, in UTF-16 units */
export const MAX_MODULE_DOCS = 60_000;

/** the most declarations one request reads, and the most advice one request gives */
export const MAX_NAMES = 25;

/** what a declaration's answer can carry besides itself, each what its own endpoint answers */
export const PARTS = ["source", "context", "uses", "users", "describe", "print"] as const;

export type Part = (typeof PARTS)[number];

/** where a reference sits, by its site bit */
export const WHERE: Record<string, number> = { statement: SITE_STMT, body: SITE_BODY, proof: SITE_PROOF, grammar: SITE_GRAMMAR };

/** The parts asked for with a declaration (`include=source,context,…`), or why they are refused. */
export function parts(s: string | null): Part[] | Answer {
  if (s === null || !s.trim()) return [];
  const asked = s.split(",").map((x) => x.trim()).filter(Boolean);
  const bad = asked.filter((x) => !(PARTS as readonly string[]).includes(x));
  if (bad.length) return fail(400, `include: ${bad.join(", ")} is not a part.`, `The parts are ${PARTS.join(", ")}, separated by commas.`);
  return [...new Set(asked)] as Part[];
}

/** Names separated by commas, as `names=a,b,c` gives them; a comma inside «…» is part of a name. */
export function splitNames(s: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (const c of s) {
    if (c === "«") quoted = true;
    else if (c === "»") quoted = false;
    if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
