// Targets and their TCB (docs/agent-api/tcb.md), the endpoints of server/agent.ts: the targets and how
// far each review has come, a target's review set in review order, its key declarations and what
// each rests on, why a declaration is in a TCB; and, at level full, what people mark from the page —
// targets, key declarations, prefixes trusted — recorded as the agent's (AgentSpec decision 9).

import { SITE_STMT } from "../shared/graph.ts";
import { advice, adviceOf, covers, fresh, statusOf } from "../shared/review.ts";
import { keyCounts, keyFirst, keyParts, statusCounts, topDown } from "../shared/keys.ts";
import { offBoard, whyChain } from "../shared/reviewqueue.ts";
import type { Queue } from "../shared/reviewqueue.ts";
import { View } from "./agentgraph.ts";
import { MAX_OPINIONS } from "./agentadvice.ts";
import type { AgentApi, Answer, Ask, Caller } from "./agent.ts";
import { body, clampInt, fail, flag, needAgent, ok, str } from "./agent.ts";

export function targets(api: AgentApi, a: Ask): Answer {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const d = api.world.review.data;
  return ok({
    targets: Object.entries(d.targets)
      .sort((x, y) => (x[0] < y[0] ? -1 : 1))
      .map(([name, t]) => {
        const i = v.g.byName.get(name);
        return {
          name,
          markedBy: t.by,
          ...(t.agent ? { markedByAgent: true } : {}),
          at: t.at,
          inGraph: i !== undefined,
          ...(i !== undefined ? { counts: counts(api, v, i, v.order(i, d), a.caller) } : {}),
        };
      }),
  });
}

/** How far a target's review has come, people's (as the page counts it) and agents' apart: every
 *  member of its queue, the axioms the graph has no declaration for included; and its key
 *  declarations alone (ExportSpec decision 4), those that need review, the target among them, the
 *  trusted ones counted apart. */
export function counts(api: AgentApi, v: View, root: number, q: Queue, me: Caller) {
  const d = api.world.review.data;
  const c = { needReview: 0, approved: 0, commented: 0, stale: 0, unreviewed: 0, advised: 0, agentComments: 0, advisedByYou: 0 };
  const count = (name: string, hash: string | undefined) => {
    c.needReview++;
    const s = statusOf(d, name, hash);
    if (s === "approved") c.approved++;
    else if (s === "commented") c.commented++;
    else if (s === "stale") c.stale++;
    else c.unreviewed++;
    const adv = adviceOf(d, name, hash);
    if (adv) c.advised++;
    if (adv === "comment") c.agentComments++;
    if (api.advisedOn(name, hash, me)) c.advisedByYou++;
  };
  for (const i of q.order) count(v.g.nodes[i].name, v.g.nodes[i].hash);
  for (const x of offBoard(q)) count(x.name, undefined);
  // the key declarations counted, without the key graph's walk (every target's, in `targets`)
  return { ...c, key: keyCounts(v.g, d, keyParts(v.g, d, root, q.order, v.tcb(root))) };
}

export function tcb(api: AgentApi, a: Ask): Answer {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const root = api.find(v, a.query.get("target"), "target");
  if (typeof root !== "number") return root;
  const d = api.world.review.data;
  const g = v.g;
  const q = v.order(root, d);
  const order = q.order;
  const include = a.query.get("include")?.trim() || "review";
  if (include !== "review" && include !== "trusted" && include !== "all")
    return fail(400, `include is review, trusted or all, not ${include}.`, "review (the default): the members that need review, in review order; trusted: the members trusted without review; all: both, review's first.");
  const keyParam = a.query.get("key")?.trim() || null;
  if (keyParam !== null && keyParam !== "first" && keyParam !== "only")
    return fail(400, `key is first or only, not ${keyParam}.`, "first: the key declarations first (the trusted ones first), then the rest in review order; only: the key declarations alone.");
  if (keyParam && include !== "review") return fail(400, "key lists the key declarations with what needs review, the trusted ones among them, marked trusted.", "Leave include out with key.");
  const kg = api.keys(v, root);
  const isKey = new Set(kg.keys);
  const todo = flag(a.query.get("todo"));
  if (todo && include !== "review") return fail(400, "todo=1 lists what needs review and you have not advised on; the trusted members need no review.", "Leave todo out with include=trusted or all.");
  if (todo && (a.caller.kind !== "agent" || !a.caller.name))
    return fail(400, "todo=1 lists what you have not advised on: say who you are.", "Send X-VisualProof-Name and X-VisualProof-Kind: agent.");
  // the trusted members: the project's own first (a layer trusted by name is worth knowing), then
  // by what trusts them, then by name
  const tcb = v.tcb(root);
  const trustedRows: { i: number; by: string[] }[] = [];
  for (let j = 0; j < g.n; j++) {
    if (!tcb[j]) continue;
    const t = api.trust(v, j);
    if (t.trusted) trustedRows.push({ i: j, by: t.trustedBy });
  }
  trustedRows.sort((x, y) => Number(g.isExt(x.i)) - Number(g.isExt(y.i)) || (x.by[0] < y.by[0] ? -1 : x.by[0] > y.by[0] ? 1 : 0) || (g.nodes[x.i].name < g.nodes[y.i].name ? -1 : 1));
  // a Map: a prefix may be called `constructor`
  const byPrefix = new Map<string, number>();
  let ownTrusted = 0;
  for (const r of trustedRows) {
    byPrefix.set(r.by[0], (byPrefix.get(r.by[0]) ?? 0) + 1);
    if (!g.isExt(r.i)) ownTrusted++;
  }
  type Row = { review: true; i: number; k: number } | { review: false; i: number; k: number; by: string[] };
  // the key declarations first (or alone), the trusted ones among them (ExportSpec decision 1):
  // positions are still those of the review order, a trusted one's that of the trusted list
  const listed = keyParam === "only" ? kg.keys : keyParam === "first" ? keyFirst(order, kg.keys) : order;
  const at = new Map(order.map((i, k) => [i, k]));
  const trustedAt = new Map(trustedRows.map((r, k) => [r.i, k]));
  const row = (i: number): Row => (at.has(i) ? { review: true, i, k: at.get(i)! } : { review: false, i, k: trustedAt.get(i) ?? 0, by: api.trust(v, i).trustedBy });
  const rows: Row[] = [
    // a trusted key declaration needs no review: not among what todo=1 leaves to advise on
    ...(include === "trusted" ? [] : listed.map(row).filter((r) => !todo || (r.review && !api.advised(v, r.i, a.caller)))),
    ...(include === "review" ? [] : trustedRows.map((r, k) => ({ review: false as const, i: r.i, k, by: r.by }))),
  ];
  const offset = clampInt(a.query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(a.query.get("limit"), 50, 1, 500);
  const page = rows.slice(offset, offset + limit);
  return ok({
    target: g.nodes[root].name,
    isTarget: !!d.targets[g.nodes[root].name],
    order:
      include === "trusted"
        ? "trusted: the project's own first, then by the prefix that trusts them, then by name"
        : (keyParam === "only"
            ? "the key declarations alone, the trusted ones first (by the trusted list's position), then in review order; "
            : keyParam === "first"
              ? "the key declarations first, the trusted ones first (by the trusted list's position), then the rest, each in review order; "
              : "") +
          "review: the target's review set — the non-standard axioms it rests on first; then bottom-up: what a declaration uses comes before it; declarations that use each other together; then what more targets rest on; then by name" +
          (include === "all" ? ". Then the trusted members: the project's own first, then by the prefix that trusts them, then by name" : ""),
    counts: counts(api, v, root, q, a.caller),
    trustedNotCounted: trustedRows.length,
    // what the target rests on beyond Lean's three standard axioms, through statements, bodies or
    // proofs: each needs review; one without a declaration in the graph is counted beside the list
    axioms: q.axioms.map((x) => ({
      name: x.name,
      inGraph: x.node !== null,
      status: statusOf(d, x.name, x.node === null ? undefined : g.nodes[x.node].hash),
      usedIn: x.via.map((j) => g.nodes[j].name),
    })),
    ...(include !== "review" ? { trusted: { project: ownTrusted, external: trustedRows.length - ownTrusted, byPrefix: Object.fromEntries(byPrefix) } } : {}),
    ...(todo ? { todo: true } : {}),
    ...(keyParam ? { key: keyParam } : {}),
    include,
    offset,
    limit,
    total: rows.length,
    next: offset + limit < rows.length ? offset + limit : null,
    members: page.map((r) => {
      const n = g.nodes[r.i];
      if (!r.review) return { position: r.k + 1, ...api.brief(v, r.i), ...(isKey.has(r.i) ? { key: true } : {}), trusted: true, trustedBy: r.by };
      return {
        position: r.k + 1,
        ...api.brief(v, r.i),
        ...(isKey.has(r.i) ? { key: true } : {}),
        status: statusOf(d, n.name, n.hash),
        advice: advice(d, n.name)
          .filter((o) => fresh(o, n.hash))
          .map((o) => ({ by: o.by, verdict: o.verdict })),
        youAdvised: api.advised(v, r.i, a.caller),
      };
    }),
  });
}

/** A target's key declarations (ExportSpec decisions 1 and 3), top-down: each with what it rests
 *  on beyond itself — its support, by review status, and the key declarations it rests on — and
 *  the key graph's edges. A trusted one (the owner's decision of 2026-10-19) says what trusts it,
 *  and has no status: it needs no review. */
export function keysGet(api: AgentApi, a: Ask): Answer {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const root = api.find(v, a.query.get("target"), "target");
  if (typeof root !== "number") return root;
  const g = v.g;
  const d = api.world.review.data;
  const target = g.nodes[root].name;
  const members = a.query.get("members") === null || flag(a.query.get("members"));
  const q = v.order(root, d);
  const kg = api.keys(v, root);
  const name = (j: number) => g.nodes[kg.keys[j]].name;
  const marks = Object.hasOwn(d.keys, target) ? d.keys[target] : null;
  const rests = kg.keys.map(() => [] as number[]);
  for (const [x, y] of kg.edges) rests[x].push(y);
  const top = topDown(kg);
  const rank = new Map(top.map((j, k) => [j, k]));
  // marks on what the TCB no longer holds: kept, counted for nothing until it is back
  const inKeys = new Set(kg.keys.map((i) => g.nodes[i].name));
  const outside = marks ? Object.keys(marks).filter((x) => !inKeys.has(x)).sort() : [];
  const trusted = new Set(kg.trusted);
  return ok({
    target,
    isTarget: Object.hasOwn(d.targets, target),
    order: "top-down: the target, then each key declaration a layer below every key declaration that rests on it; within a layer, later in review order first",
    note: "A member that is not key is supported by a key declaration when a chain of statement and body references leads to it from there through members of the TCB that are not key, trusted ones too; a support counts the members that need review. The key graph has an edge from one key declaration to another reached that way. A non-standard axiom the target rests on through proofs alone is the target's support (viaProof). A trusted key declaration needs no review: counts.key counts the others, its trusted apart.",
    counts: { key: keyCounts(g, d, kg), all: statusCounts(g, d, q.order), offBoardAxioms: offBoard(q).length },
    keys: top.map((j) => {
      const i = kg.keys[j];
      const n = g.nodes[i];
      const mark = i !== root && marks && Object.hasOwn(marks, n.name) ? marks[n.name] : null;
      return {
        ...api.brief(v, i),
        ...(i === root ? { target: true } : { markedBy: mark?.by ?? null, ...(mark?.agent ? { markedByAgent: true } : {}), markedAt: mark?.at ?? null }),
        ...(trusted.has(i) ? { trusted: true, trustedBy: api.trust(v, i).trustedBy } : { status: statusOf(d, n.name, n.hash) }),
        doc: n.doc ?? null,
        restsOn: rests[j].sort((p, r) => rank.get(p)! - rank.get(r)!).map(name),
        support: { ...statusCounts(g, d, kg.support[j]), ...(members ? { members: kg.support[j].map((m) => g.nodes[m].name) } : {}) },
      };
    }),
    edges: kg.edges.map(([x, y]) => [name(x), name(y)]),
    viaProof: kg.viaProof.map((i) => g.nodes[i].name),
    ...(outside.length ? { marksOutsideTcb: outside } : {}),
  });
}

export function why(api: AgentApi, a: Ask): Answer {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const root = api.find(v, a.query.get("target"), "target");
  if (typeof root !== "number") return root;
  const i = api.find(v, a.query.get("name"));
  if (typeof i !== "number") return i;
  const g = v.g;
  const path = whyChain(g, root, i);
  const q = v.order(root, api.world.review.data);
  if (!path) {
    // a non-standard axiom reached through a proof: in the review, not in the TCB
    const ax = q.axioms.find((x) => x.node === i);
    if (ax)
      return ok({ target: g.nodes[root].name, name: g.nodes[i].name, inTcb: false, inReview: true, chain: null, usedIn: ax.via.map((j) => g.nodes[j].name), reviewPosition: { position: q.order.indexOf(i) + 1, of: q.order.length }, note: "A non-standard axiom the target rests on (through a proof): it needs review, whatever is trusted." });
    return ok({ target: g.nodes[root].name, name: g.nodes[i].name, inTcb: false, chain: null, note: "Not in the TCB: nothing in the target's statement, nor in the body of a definition it reaches, refers to it (references inside proofs do not count)." });
  }
  // where each reference sits in the declaration that makes it
  const via = (u: number, w: number) => {
    let s = 0;
    for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) if (g.outDst[e] === w) s |= g.outSite[e];
    return s & SITE_STMT ? "statement" : "body";
  };
  const order = q.order;
  const at = order.indexOf(i);
  return ok({
    target: g.nodes[root].name,
    name: g.nodes[i].name,
    inTcb: true,
    chain: path.map((j, k) => ({ ...api.brief(v, j), ...(k ? { usedIn: `the ${via(path[k - 1], j)} of ${g.nodes[path[k - 1]].name}` } : {}) })),
    reviewPosition: at >= 0 ? { position: at + 1, of: order.length } : null,
  });
}

/** Record, as the agent's, what a person records from the page (AgentSpec decision 9): checked
 *  and bound as the page's requests are (server/reviewapi.ts), appended to the agent's own log
 *  under its name and marked, so that the page and the timeline say it was an agent's. The answer
 *  is the event written, or that nothing changed. */
export function record(api: AgentApi, me: Caller, op: Record<string, unknown>, hint?: (status: number) => string | null): Answer {
  const r = api.reviews.post(op, { name: me.name!, agent: true });
  const b = r.body as { error?: string; hint?: string; change?: unknown; event?: Record<string, unknown> };
  if (r.status !== 200) return fail(r.status, b.error ?? "Refused.", hint?.(r.status) ?? b.hint ?? "GET /api/agent describes this endpoint.");
  if (!b.change) return ok({ ok: true, changed: false, note: "Nothing changed: it was so already." });
  return ok({ ok: true, changed: true, recorded: b.event });
}

/** The writes of level full say who makes them, that it is an agent, and that its level allows. */
export function full(api: AgentApi, a: Ask): Answer | null {
  return needAgent(a.caller) ?? api.refuse(a.caller, "full");
}

/** `on` as a request gives it: true unless it says false. */
export function onOf(api: AgentApi, b: Record<string, unknown>): boolean | Answer {
  if (b.on === undefined) return true;
  return typeof b.on === "boolean" ? b.on : fail(400, "on is true or false.", "Leave it out to mark; false takes the mark off.");
}

/** A target marked, or taken off (ReviewSpec decision 4): a theorem whose TCB people review,
 *  with no view until it is clicked or linked (ViewSpec decision 29). A target no longer in the
 *  graph can still be taken off. */
export function targetPost(api: AgentApi, a: Ask): Answer {
  const no = full(api, a);
  if (no) return no;
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const b = body(a);
  const on = onOf(api, b);
  if (typeof on !== "boolean") return on;
  const d = api.world.review.data;
  let name = str(b.name)?.trim() ?? "";
  if (on || !Object.hasOwn(d.targets, name)) {
    const i = api.find(v, name);
    if (typeof i !== "number") return i;
    name = v.g.nodes[i].name;
  }
  const r = record(api, a.caller, { op: "target", name, on }, (s) => (s === 404 ? "A target is a declaration of the project (GET /api/agent/search finds one), most often a theorem." : null));
  if (r.status !== 200 || !on) return r;
  return ok({ ...(r.body as object), view: api.world.views.book.viewOf(name)?.id ?? null, next: `POST /api/agent/view {"review": ${JSON.stringify(name)}} puts you on its view (a temporary view of its TCB, linked to it, where it has none); GET /api/agent/tcb?target=${name} lists its review set.` });
}

/** Key declarations of a target marked or unmarked (ExportSpec decision 1): one (`name`), or up
 *  to MAX_OPINIONS at once (`names`), each answered on its own. */
export function keyPost(api: AgentApi, a: Ask): Answer {
  const no = full(api, a);
  if (no) return no;
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const b = body(a);
  const on = onOf(api, b);
  if (typeof on !== "boolean") return on;
  const d = api.world.review.data;
  const t = api.find(v, str(b.target), "target");
  if (typeof t !== "number") return t;
  const target = v.g.nodes[t].name;
  if (on && !Object.hasOwn(d.targets, target)) return fail(409, `${target} is not a target.`, `Key declarations are a target's: POST /api/agent/target {"name": ${JSON.stringify(target)}} marks it first.`);
  const one = (raw: unknown): Answer => {
    let name = str(raw)?.trim() ?? "";
    // a mark on what has left the graph can still be taken off, by the name it was given
    if (on || !Object.hasOwn(d.keys, target) || !Object.hasOwn(d.keys[target], name)) {
      const i = api.find(v, name);
      if (typeof i !== "number") return i;
      name = v.g.nodes[i].name;
    }
    return record(api, a.caller, { op: "key", target, name, on }, (s) => (s === 409 ? `A key declaration is one of its target's TCB, trusted or not: GET /api/agent/tcb?target=${target}&include=all lists it.` : null));
  };
  if (b.names === undefined) return one(b.name);
  if (!Array.isArray(b.names) || !b.names.length || b.names.length > MAX_OPINIONS)
    return fail(400, `names is a list of 1 to ${MAX_OPINIONS} declarations' full names.`, 'Send {"target": …, "names": […], "on": true}, or one with name.');
  const results = b.names.map((x, k) => {
    const r = one(x);
    return { index: k, name: typeof x === "string" ? x : null, status: r.status, ...(r.body as object) };
  });
  const done = results.filter((r) => r.status === 200);
  return ok({ ok: true, target, on, changed: done.filter((r) => (r as { changed?: boolean }).changed).length, unchanged: done.filter((r) => !(r as { changed?: boolean }).changed).length, refused: results.length - done.length, results });
}

/** A prefix trusted without review, or no longer (ReviewSpec decision 3): a module or a
 *  namespace, or `@external` for the whole outside world. What it covers is counted. */
export function trustPost(api: AgentApi, a: Ask): Answer {
  const no = full(api, a);
  if (no) return no;
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const b = body(a);
  const on = onOf(api, b);
  if (typeof on !== "boolean") return on;
  const prefix = str(b.prefix)?.trim() ?? "";
  const r = record(api, a.caller, { op: "trust", prefix, on }, (s) => (s === 400 ? "A module or a namespace, e.g. Mathlib.Order or Nat; @external for the whole outside world. GET /api/agent/tcb?target=…&include=trusted shows what is trusted and by which prefix." : null));
  if (r.status !== 200) return r;
  const g = v.g;
  const covered = { project: 0, outside: 0 };
  for (let i = 0; i < g.n; i++) if (covers(prefix, g.nodes[i].name, g.nodes[i].module, g.isExt(i))) covered[g.isExt(i) ? "outside" : "project"]++;
  return ok({ ...(r.body as object), prefix, on, covers: covered, trusted: api.world.review.data.trusted });
}
