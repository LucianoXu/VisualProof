// Agents and views (ViewSpec decision 10, AgentSpec decision 9): the endpoints of the agents' API
// that read, open, make and change views — boards everyone shares — within what `--agents` allows.
// Opening a view (a query nobody keeps) is reading; everything else a person does from the Views
// menu and ⚙ Board — making a view, duplicating, renaming, deleting it, changing its scope,
// arranging it (its clustering, folds and pins), laying it out afresh, linking a target to it — is
// level full, under the agent's name: in the timeline what is an
// event there (a view made, renamed, deleted, linked or laid out afresh), on the board's notes the
// rest.
//
// The endpoints are those of server/agent.ts, in its shape, so that its table takes them as they
// are (`...viewEndpoints(this.world, …)`, with what refuses an agent level full: the server's
// `--agents`, or its token's level); the views are the world's (server/views.ts). What an agent
// opens is where it is: people following it see that view, and a view nobody keeps lives while the
// agent is there (presence).
//
// A board an agent arranges is laid out here exactly as the pages lay it out (shared/board.ts), so
// that a place it gives is in the board's own coordinates; a pin beyond its parent's room is brought
// inside, as a drag would be. An agent hides levels of a board and shows them again as people do
// (ViewSpec decision 24), the pins of what moves to another parent kept where they are.

import { gunzipSync } from "node:zlib";
import { boardLayout, boardSet, layoutKey, pastSetKey, reframePins, snapshotOfKey, wholeLayout } from "../shared/board.ts";
import type { BoardMemory, BoardSet } from "../shared/board.ts";
import type { PresenceView } from "../shared/collab.ts";
import type { ClusterMode, Layout, ViewMeta } from "../shared/graph.ts";
import { clusterKeys } from "../shared/layout.ts";
import { CLUSTER_MODES } from "../shared/places.ts";
import { printQuery } from "../shared/query.ts";
import { briefWhen, namesOf } from "../shared/titles.ts";
import { Graph } from "../shared/viewgraph.ts";
import { fixedScope, MAX_HIDDEN, PROJECT, summary, validVersion, versionRefused, viewDescription, viewFocus, viewTitle } from "../shared/views.ts";
import { applyItemOp, itemIn, itemOp } from "../shared/items.ts";
import type { ItemOp, ViewItems } from "../shared/items.ts";
import { derivesOn, existsIn } from "../shared/noteplace.ts";
import { noteExcerpt } from "../shared/sticky.ts";
import type { TitleContext, ViewData, ViewOp } from "../shared/views.ts";
import type { Answer, Ask, Caller, Need, World } from "./agent.ts";
import { fail, whoOf } from "./agent.ts";
import type { AgentWho } from "./presence.ts";
import { readQuery } from "./views.ts";
import type { Views } from "./views.ts";

/** An endpoint as server/agent.ts lists them. */
export interface AgentEndpoint {
  method: "GET" | "POST";
  path: string;
  about: string;
  /** a line for the entry, where it names the endpoint (server/agententry.ts, ENTRY) */
  brief?: string;
  params: Record<string, string>;
  returns: string;
  needs?: Need;
  run(a: Ask): Answer | Promise<Answer>;
}

const ok = (body: unknown): Answer => ({ status: 200, body });
const MAX_PINS = 500;
const MAX_FOLDS = 2000;
/** a declaration's radius as the layout packs it (web/src/scene.ts, LEAF_R) */
const LEAF_R = 5;

/** The graph on show, read once per version. */
const graphs = new WeakMap<object, { meta: ViewMeta; g: Graph }>();
export function graphOf(world: Pick<World, "graph">): { meta: ViewMeta; g: Graph } | null {
  const w = world.graph;
  if (!w) return null;
  let r = graphs.get(w.prep);
  if (!r) {
    const meta: ViewMeta = JSON.parse(gunzipSync(w.prep.metaGz).toString("utf8"));
    const g = new Graph(meta, new Int32Array(new Uint8Array(gunzipSync(w.prep.edgesGz)).buffer));
    graphs.set(w.prep, (r = { meta, g }));
  }
  return r;
}

/** What the server's titles of views are told with (shared/views.ts, viewTitle): the names of the
 *  graph on show, and the builds the history kept, in the server's time. */
export function titleContext(world: Pick<World, "graph" | "history">): TitleContext {
  const G = graphOf(world);
  return {
    names: G ? namesOf(G.g) : null,
    build: (id) => {
      const s = world.history?.get(id);
      return s ? briefWhen(s.at) : null;
    },
  };
}

/** View `v`'s focus now (ViewSpec decision 28; shared/views.ts, viewFocus): as set, else the target
 *  it is linked to, else the one target its board holds on the graph on show, else null. */
export function focusOf(world: Pick<World, "graph" | "review">, v: ViewData): string | null {
  const targets = world.review.data.targets;
  return viewFocus(v, (n) => Object.hasOwn(targets, n), () => {
    const G = graphOf(world);
    if (!G) return [];
    const bs = boardSet(G.g, world.review.data, v.scope);
    return Object.keys(targets).filter((n) => {
      const i = G.g.byName.get(n);
      return i !== undefined && bs.set[i] === 1;
    });
  });
}

/** Why a layout's memory a page hands over (POST /api/views/memory) does not fit view `v`'s board
 *  by `mode`, with the status to answer; null when it fits. It must be for the set the board holds
 *  now, on the graph and review the server has, under the levels it hides (layoutKey), and speak of
 *  that set and of clusters a layout of it can have: a memory decides where everything is for
 *  everyone on the board. A view kept at a past build (`past`, its snapshot) is a board of that
 *  build's graph, which the pages make from the snapshot and the server does not: its memory must be
 *  one of that build's (shared/board.ts, pastSetKey), never the latest's, and the pages that recall it
 *  check it against the board they make. */
export function memoryProblem(world: Pick<World, "graph" | "review">, v: ViewData, mode: ClusterMode, m: BoardMemory, past: number | null = null): { status: number; error: string } | null {
  if (past !== null) return snapshotOfKey(m.set) === past ? null : { status: 409, error: `This view shows the build of snapshot ${past}: its memory is one of that build's (its set starts with ${pastSetKey(past, "")}).` };
  if (snapshotOfKey(m.set) !== null) return { status: 409, error: "This view shows the latest build: a memory of a past build's board is not its." };
  const G = graphOf(world);
  if (!G) return { status: 503, error: "The graph has not been read yet." };
  const bs = boardSet(G.g, world.review.data, v.scope);
  if (bs.whole) return { status: 400, error: "This board is the project's own layout: it keeps no memory of its own." };
  const key = layoutKey(bs.key, v.hidden[mode]);
  if (m.set !== key) return { status: 409, error: `This memory is for a set the board does not hold now, or other hidden levels (it is ${key}).` };
  const g = bs.sub!.graph;
  const nodes = Object.keys(m.mem.nodes);
  if (nodes.length !== g.n || nodes.some((k) => !g.byName.has(k))) return { status: 400, error: "This memory does not place exactly what the board holds." };
  const keys = clusterKeys(mode, g.nodes);
  for (const k of Object.keys(m.mem.clusters)) if (!keys.has(k)) return { status: 400, error: `This board has no cluster ${k.slice(0, 200)} by ${mode}.` };
  for (const k of nodes) {
    const c = m.mem.nodes[k][2];
    if (c !== "" && !keys.has(c)) return { status: 400, error: `This board has no cluster ${c.slice(0, 200)} by ${mode}.` };
  }
  return null;
}

/** How far from its parent's centre something of radius `r` may be placed (as server/agentplaces.ts
 *  and the page keep a drop inside its parent's circle); Infinity at the top. */
function roomIn(L: Layout, parent: number, r: number): number {
  if (parent < 0) return Infinity;
  const P = L.clusters[parent];
  return Math.max(0, P.r - (10 + Math.min(14, Math.sqrt(P.count))) - r);
}

/** A place brought within `room` of the centre, a hair inside so that rounding keeps it there. */
function inside(at: [number, number], room: number): [number, number] {
  const d = Math.hypot(at[0], at[1]);
  if (d <= room) return at;
  const k = Math.max(0, room - 0.1) / d;
  return [Math.round(at[0] * k * 10) / 10, Math.round(at[1] * k * 10) / 10];
}

/** The agents' endpoints about views. `world` is the live server's, which carries its views. */
export function viewEndpoints(world: World, refuseFull: (c: Caller) => Answer | null): AgentEndpoint[] {
  const body = (a: Ask) => (a.body && typeof a.body === "object" && !Array.isArray(a.body) ? (a.body as Record<string, unknown>) : {});
  /** Writes say who makes them, and that it is an agent; changing a view needs level full. */
  const who = (a: Ask, full = false): Answer | null => {
    if (a.caller.kind !== "agent") return fail(400, "This API records what agents do: say you are one.", "Send X-VisualProof-Kind: agent with every request, beside X-VisualProof-Name.");
    if (!a.caller.name) return fail(401, "Say who you are first.", "Send X-VisualProof-Name: <your name>, e.g. Claude.", { who: true });
    return full ? refuseFull(a.caller) : null;
  };
  const graph = () => graphOf(world) ?? fail(503, "The graph has not been read yet.", "The server is reading the project; ask again in a few seconds.", { retryAfter: 5 }, { "retry-after": "5" });
  const find = (V: Views, id: unknown): ViewData | Answer =>
    (typeof id === "string" && V.book.get(id)) || fail(404, `There is no view ${String(id)}.`, "GET /api/agent/views lists them; POST /api/agent/views/open opens one on a query.");
  /** What a view holds: declarations of the project, and of the outside world. */
  const holds = (bs: BoardSet, g: Graph) => {
    let own = 0;
    for (let i = 0; i < g.projectCount; i++) own += bs.set[i];
    return { project: own, outside: bs.count - own };
  };
  const isTarget = (name: string) => Object.hasOwn(world.review.data.targets, name);
  /** A view as agents read it: its short title, as the pages show it, what its scope holds in full,
   *  the targets linked to it (`targets`, ViewSpec decision 29) and its focus now (`focus`, decision
   *  28). */
  const shown = (v: ViewData) => ({ ...summary(v), focus: focusOf(world, v), title: viewTitle(v, titleContext(world)), description: viewDescription(v) });
  /** The agent is on view `v` now: people following it see it, and a view nobody keeps lives. */
  const there = (name: AgentWho, v: ViewData) => {
    const was: PresenceView = world.presence.agentView(name) ?? { mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };
    const tabs = [...new Set([...was.tabs, v.id])].slice(-20);
    world.presence.agentBeat(name, { ...was, cam: null, clusterMode: v.clustering, view: v.id, scope: v.kept ? null : printQuery(v.scope), tabs });
  };
  /** A view's board by its clustering, laid out as the pages lay it out, under the levels it hides
   *  (or `hidden`, without handing anything over); its memory handed over when this was the first to
   *  lay it out for its set. */
  const board = (V: Views, v: ViewData, mode: ClusterMode, meta: ViewMeta, g: Graph, hidden?: string[]): { bs: BoardSet; L: Layout; g: Graph } => {
    const bs = boardSet(g, world.review.data, v.scope);
    const levels = hidden ?? v.hidden[mode];
    if (bs.whole) return { bs, L: wholeLayout(meta.layouts[mode], g.nodes, mode, levels), g };
    const mem = V.book.memoryOf(v.id, mode);
    const { layout, next } = boardLayout(bs.sub!.graph, mode, bs.key, mem, levels);
    // a view kept at a past build is a board of that build's graph, which only the pages lay out:
    // a layout of the latest build's is never handed over as its memory
    if (next && !hidden && V.pastOf(v) === null) V.setMemory(v.id, mode, mem?.set ?? null, next);
    return { bs, L: layout, g: bs.sub!.graph };
  };

  const list = (): Answer => {
    const V = world.views;
    const on = new Map<string, string[]>();
    for (const p of V.peers())
      if (p.view?.view && p.name) on.set(p.view.view, [...new Set([...(on.get(p.view.view) ?? []), p.agent ? `${p.name} (agent)` : p.name])]);
    const unreadable = V.unreadableList();
    return ok({
      views: V.book.list().map((v) => ({ ...shown(v), on: on.get(v.id) ?? [] })),
      ...(unreadable.length ? { unreadable } : {}),
      note: "Kept views are listed for everyone; one nobody kept lives while a page or an agent has it open. A target's view is the one whose targets name it (a view may be several targets'); a target none names has no view — marking a target makes none, and a view deleted leaves its targets with none: POST /api/agent/view {review: <target>} then opens a temporary view of its TCB, linked to it while it lasts. focus is where the review works on each." +
        (unreadable.length ? " `unreadable`: kept views the server cannot read now (it keeps them as they are, untouched)." : ""),
    });
  };

  const view = (a: Ask): Answer => {
    const V = world.views;
    const G = graph();
    if (!("g" in G)) return G;
    const v = find(V, a.query.get("id"));
    if (!("id" in v)) return v;
    const mode = (a.query.get("mode") ?? v.clustering) as ClusterMode;
    if (!CLUSTER_MODES.includes(mode)) return fail(400, "mode is namespace or module.", "Leave it out for the view's own clustering.");
    const { bs, L, g } = board(V, v, mode, G.meta, G.g);
    const members = a.query.get("members") === "1";
    const pins = v.pins[mode];
    return ok({
      view: shown(v),
      holds: holds(bs, G.g),
      // the notes of the project added to it and taken out of it (the owner's decision of
      // 2026-10-11): what it shows besides what its scope gives, and what it does not
      items: itemsShown(v),
      mode,
      folds: v.folds[mode],
      hidden: v.hidden[mode],
      pins: { nodes: Object.keys(pins.nodes).length, clusters: Object.keys(pins.clusters).length },
      // the clusters as this board has them, the outermost first: what can be folded or moved
      clusters: L.clusters
        .map((c) => ({ key: c.key, depth: c.depth, count: c.count, r: c.r, parent: c.parent >= 0 ? L.clusters[c.parent].key : null, room: c.parent >= 0 ? Math.floor(roomIn(L, c.parent, c.r) * 10) / 10 : null, at: [c.lx, c.ly], pinned: pins.clusters[c.key] ?? null }))
        .filter((c) => c.depth <= 2)
        .slice(0, 400),
      ...(members ? { members: g.nodes.slice(0, 5000).map((n) => n.name), more: Math.max(0, g.n - 5000) } : {}),
    });
  };

  const open = (a: Ask): Answer => {
    const no = who(a);
    if (no) return no;
    const V = world.views;
    const b = body(a);
    const q = readQuery(b.scope);
    if (typeof q === "string") return fail(400, q, "e.g. {\"scope\": \"tcb(fermatLastTheoremFour) except trusted\"}; GET /api/agent/views lists the language's words in its note.");
    // at a past build: the view on that query that shows it (the owner's decision of 2026-10-09)
    const version = b.version === 0 ? null : b.version;
    if (version !== undefined && version !== null && (!validVersion(version) || V.snapshotAt(version) === null))
      return fail(404, `There is no snapshot ${String(version)}.`, "GET /api/agent/history lists the snapshots; null (or leaving it out) is the latest build.");
    if (b.clustering !== undefined && b.clustering !== "namespace" && b.clustering !== "module") return fail(400, "The clustering is namespace or module.", "It is a new view's; an open one keeps its own.");
    // a new view's focus (ViewSpec decision 28): the target it is made from
    if (b.focus !== undefined && b.focus !== null && (typeof b.focus !== "string" || !isTarget(b.focus))) return fail(400, "focus is a target's full name.", "GET /api/agent/targets lists them; it is a new view's, an open one keeps its own.");
    const { view: v, change } = V.book.open(q, a.caller.name, Date.now(), { agent: true, ...(typeof version === "number" ? { version } : {}), ...(b.clustering ? { clustering: b.clustering as ClusterMode } : {}), ...(typeof b.focus === "string" ? { focus: b.focus } : {}) });
    if (change) V.changed([change], true);
    there(whoOf(a.caller), v);
    const G = graphOf(world);
    return ok({
      view: shown(v),
      ...(G ? { holds: holds(boardSet(G.g, world.review.data, v.scope), G.g) } : {}),
      note:
        (v.kept ? "A kept view." : "Nobody keeps this view: it lives while you or a page has it open. Arrange or name it to keep it for everyone.") +
        (v.version !== undefined ? ` It shows the build of snapshot ${v.version} on the pages, arranged there as any view, its review the latest build's, and its exported document is that build's (GET /api/agent/export); what it holds here is the latest build's.` : ""),
    });
  };

  const create = (a: Ask): Answer => {
    const no = who(a, true);
    if (no) return no;
    const V = world.views;
    const b = body(a);
    const q = b.scope === undefined ? undefined : readQuery(b.scope);
    if (typeof q === "string") return fail(400, q, "Send the scope as its text, e.g. ns(Fermat42) except trusted.");
    if (b.clustering !== undefined && !CLUSTER_MODES.includes(b.clustering as ClusterMode)) return fail(400, "clustering is namespace or module.", "Leave it out for namespace.");
    // the build it shows (HistorySpec decision 19): a snapshot the history has, or null (0, from a
    // tool whose arguments cannot say null) for the latest
    const version = b.version === 0 ? null : b.version;
    if (version !== undefined && version !== null && (!validVersion(version) || V.snapshotAt(version) === null))
      return fail(404, `There is no snapshot ${String(version)}.`, "GET /api/agent/history lists the snapshots; null (or leaving it out) is the latest build.");
    const v = V.book.create(typeof b.name === "string" ? b.name.trim() : "", a.caller.name, { scope: q, clustering: b.clustering as ClusterMode | undefined, from: typeof b.from === "string" ? b.from : undefined, version: version as number | null | undefined, agent: true });
    if (typeof v === "string") return fail(400, v, "Send {name, scope} (a name of 1 to 80 characters), or {name, from: <view id>} for a copy.");
    V.changed([{ id: v.id, what: "kept", by: a.caller.name }], true);
    there(whoOf(a.caller), v);
    return ok({ view: shown(v) });
  };

  const scope = (a: Ask): Answer => {
    const no = who(a, true);
    if (no) return no;
    const V = world.views;
    const b = body(a);
    const v = find(V, b.id);
    if (!("id" in v)) return v;
    const q = readQuery(b.scope);
    if (typeof q === "string") return fail(400, q, "Send the scope as its text or its JSON form.");
    const c = V.book.setScope(v.id, q, a.caller.name);
    if (typeof c === "string") return fail(400, c, fixedScope(v) ? "POST views/duplicate {id: \"project\"} makes a copy of it to rescope." : "");
    if (c) V.changed(c, true);
    there(whoOf(a.caller), v);
    const G = graphOf(world);
    return ok({ ok: true, view: shown(v), ...(G ? { holds: holds(boardSet(G.g, world.review.data, v.scope), G.g) } : {}) });
  };

  const arrange = (a: Ask): Answer => {
    const no = who(a, true);
    if (no) return no;
    const V = world.views;
    const G = graph();
    if (!("g" in G)) return G;
    const b = body(a);
    const v = find(V, b.id);
    if (!("id" in v)) return v;
    const me = a.caller.name!;
    // folds and pins are in the clustering the view has after; everything is checked before
    // anything changes, so that a refused request leaves the view as it was
    if (b.clustering !== undefined && !CLUSTER_MODES.includes(b.clustering as ClusterMode)) return fail(400, "clustering is namespace or module.", "Leave it out to keep the view's own.");
    const mode = (b.clustering as ClusterMode | undefined) ?? v.clustering;
    const before = board(V, v, mode, G.meta, G.g);
    const ops: ViewOp[] = [];
    // the build it is kept at (HistorySpec decision 19), for everyone on it: a snapshot's id, or
    // null (0, from a tool whose arguments cannot say null) for the latest again
    const version = b.version === 0 ? null : b.version;
    if (version !== undefined) {
      if (version !== null && !validVersion(version)) return fail(400, "version is a snapshot's id, or null for the latest build.", "GET /api/agent/history lists the snapshots.");
      const refused = version !== null ? versionRefused(v) : null;
      if (refused) return fail(400, refused, "POST /api/agent/views/create {name, from: <this view>, version} keeps it in a view of its own.");
      if ((v.version ?? null) !== version) ops.push({ op: "version", snapshot: version as number | null });
    }
    // levels hidden and shown first: the folds and pins asked for are on the board as it is after,
    // and the pins already there of what moves to another parent stay where they are
    const now = new Set(v.hidden[mode]);
    const was = new Map(before.L.clusters.map((c) => [c.key, c]));
    for (const [field, on] of [["hide", true], ["show", false]] as const) {
      const xs = b[field];
      if (xs === undefined) continue;
      if (!Array.isArray(xs) || xs.length > MAX_HIDDEN || !xs.every((x) => typeof x === "string")) return fail(400, `${field} is a list of cluster keys.`, "GET /api/agent/views/view?id=… lists this board's clusters and the levels it hides.");
      for (const key of xs as string[]) {
        if (on && !was.has(key) && !now.has(key)) return fail(404, `This board has no cluster ${key} by ${mode}.`, "GET /api/agent/views/view?id=… lists its clusters; a merged chain is hidden by its key, the deepest level's.");
        if (!on && !now.has(key)) return fail(404, `This board does not hide ${key} by ${mode}.`, "GET /api/agent/views/view?id=… lists the levels it hides (hidden).");
        if (on === now.has(key)) continue;
        if (on) now.add(key);
        else now.delete(key);
        ops.push({ op: "hide", mode, key, on });
      }
    }
    const { L, g } = ops.length ? board(V, v, mode, G.meta, G.g, [...now]) : before;
    if (ops.length) ops.push(...reframePins(g, before.L, L, v.pins[mode], mode));
    const keys = new Map(L.clusters.map((c, k) => [c.key, k]));
    for (const [field, on] of [["fold", true], ["unfold", false]] as const) {
      const xs = b[field];
      if (xs === undefined) continue;
      if (!Array.isArray(xs) || xs.length > MAX_FOLDS || !xs.every((x) => typeof x === "string")) return fail(400, `${field} is a list of cluster keys.`, "GET /api/agent/views/view?id=… lists this board's clusters.");
      for (const key of xs as string[]) {
        if (!keys.has(key)) return fail(404, `This board has no cluster ${key} by ${mode}.`, "GET /api/agent/views/view?id=… lists its clusters; a board laid out on its own has clusters of its own.");
        ops.push({ op: "fold", mode, key, on });
      }
    }
    if (b.pins !== undefined) {
      if (!Array.isArray(b.pins) || b.pins.length > MAX_PINS) return fail(400, `pins is a list of at most ${MAX_PINS} {name or cluster, at: [x, y] or null}.`, "at is in the parent cluster's coordinates on this board.");
      for (const p of b.pins as Record<string, unknown>[]) {
        if (!p || typeof p !== "object") return fail(400, "Each pin is {name or cluster, at}.", "e.g. {\"name\": \"A.b\", \"at\": [12, -40]}.");
        let kind: "node" | "cluster", key: string, room: number;
        if (typeof p.cluster === "string") {
          const c = keys.get(p.cluster);
          if (c === undefined) return fail(404, `This board has no cluster ${p.cluster} by ${mode}.`, "GET /api/agent/views/view?id=… lists its clusters.");
          kind = "cluster";
          key = p.cluster;
          room = roomIn(L, L.clusters[c].parent, L.clusters[c].r);
        } else {
          const i = typeof p.name === "string" ? g.byName.get(p.name) : undefined;
          if (i === undefined) return fail(404, `${String(p.name)} is not on this board.`, "A pin is for a declaration the view's scope holds (GET /api/agent/views/view?id=…&members=1).");
          kind = "node";
          key = p.name as string;
          room = roomIn(L, L.cluster[i], LEAF_R);
        }
        if (p.at === null) ops.push({ op: "unpin", mode, kind, key });
        else if (Array.isArray(p.at) && p.at.length === 2 && p.at.every((x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 1e7))
          ops.push({ op: "pin", mode, kind, key, at: inside(p.at as [number, number], room) });
        else return fail(400, "at is [x, y], two finite numbers in the parent cluster's coordinates, or null to let go.", "");
      }
    }
    if (mode !== v.clustering) {
      const c = V.book.setClustering(v.id, mode, me);
      if (typeof c === "string") return fail(400, c, "clustering is namespace or module.");
      if (c) V.changed([c], true);
    }
    there(whoOf(a.caller), v);
    if (!ops.length) return ok({ ok: true, view: shown(v), changed: 0, hidden: v.hidden[mode] });
    const err = V.arrange(v.id, ops, null, me, true);
    if (err) return fail(400, err, "");
    return ok({
      ok: true,
      view: shown(v),
      changed: ops.length,
      hidden: v.hidden[mode],
      placed: ops.flatMap((o): { key: string; at: [number, number] | null }[] => (o.op === "pin" ? [{ key: o.key, at: o.at }] : o.op === "unpin" ? [{ key: o.key, at: null }] : [])),
      ...(v.id === PROJECT ? { note: "On the Project, POST /api/agent/pins makes a batch that can be undone; this does not." } : {}),
    });
  };

  /** A view's own focus set, for everyone on it (ViewSpec decision 28): a target, or none (null);
   *  each person's own focus there stays as it is. */
  const focus = (a: Ask): Answer => {
    const no = who(a, true);
    if (no) return no;
    const V = world.views;
    const b = body(a);
    const v = find(V, b.id);
    if (!("id" in v)) return v;
    // left out (a tool's arguments cannot say null) is none
    const f = b.focus ?? null;
    if (f !== null && (typeof f !== "string" || !isTarget(f))) return fail(400, "focus is a target's full name, or null for none.", "GET /api/agent/targets lists the targets.");
    const c = V.book.setFocus(v.id, f as string | null, a.caller.name);
    if (typeof c === "string") return fail(400, c, "");
    if (c) V.changed(c, true);
    there(whoOf(a.caller), v);
    return ok({ ok: true, changed: !!c, view: shown(v) });
  };

  /** A target linked to a view, for everyone (ViewSpec decision 29): clicking the target opens it; a
   *  view linked to other targets takes it too, and keeps its focus (the owner's decision of
   *  2026-10-11), a view's first target being its focus to begin with; the view it was linked to keeps
   *  its scope and arrangement. */
  const link = (a: Ask): Answer => {
    const no = who(a, true);
    if (no) return no;
    const V = world.views;
    const b = body(a);
    const v = find(V, b.id);
    if (!("id" in v)) return v;
    if (typeof b.target !== "string" || !isTarget(b.target)) return fail(400, "target is a target's full name.", "GET /api/agent/targets lists the targets.");
    const was = V.book.viewOf(b.target)?.id ?? null;
    const c = V.book.link(v.id, b.target, a.caller.name);
    if (typeof c === "string") return fail(409, c, "The Project and a view kept at a past build are no target's; any other view may be linked to several.");
    if (c) V.changed(c, true);
    there(whoOf(a.caller), v);
    return ok({ ok: true, changed: !!c, view: shown(v), ...(c && was !== v.id && was ? { left: was } : {}) });
  };

  /** A view's lists as agents read them: each note added to it and taken out of it, by id with its
   *  first words; on the Project, which holds every note, none. */
  const itemsShown = (v: ViewData): { all?: true; add: { id: string; text: string }[]; remove: { id: string; text: string }[] } => {
    if (fixedScope(v)) return { all: true, add: [], remove: [] };
    const words = (id: string) => ({ id, text: noteExcerpt(world.views.book.notes.find((n) => n.id === id)?.text ?? "", 80) });
    return { add: (v.items?.add ?? []).map(words), remove: (v.items?.remove ?? []).map(words) };
  };

  /** Notes of the project added to a view, or taken out of it, for everyone on it (the owner's
   *  decision of 2026-10-11, shared/items.ts), at the level a scope change needs: each on the view's
   *  add list only where its scope does not give it, on its remove list only where it does, as the
   *  page's Add to view ▸ and Remove from this view do. The Project holds every note: there a note is
   *  deleted, not taken out. */
  const items = (a: Ask): Answer => {
    const no = who(a, true);
    if (no) return no;
    const V = world.views;
    const G = graph();
    if (!("g" in G)) return G;
    const b = body(a);
    const v = find(V, b.id);
    if (!("id" in v)) return v;
    if (fixedScope(v)) return fail(400, "The Project holds every note of the project: there a note is deleted, not added or taken out.", "POST /api/agent/note/delete deletes one, for everyone; add it to or take it out of another view.");
    const ids = (x: unknown): string[] | null => (x === undefined ? [] : Array.isArray(x) && x.length <= 200 && x.every((id) => typeof id === "string") ? (x as string[]) : null);
    const add = ids(b.add), remove = ids(b.remove);
    if (!add || !remove || (!add.length && !remove.length)) return fail(400, "Send add, remove or both: lists of notes of the project, by id (at most 200 each).", 'e.g. {"id": "v1a2b3c", "add": ["n0123456789ab"]}; GET /api/agent/notes?all=1 lists the notes.');
    const note = (id: string) => V.book.notes.find((n) => n.id === id);
    const stray = [...add, ...remove].find((id) => !note(id));
    if (stray) return fail(404, `There is no note ${stray.slice(0, 40)} of the project.`, "GET /api/agent/notes?all=1 lists them; a view's own note is not an item.");
    // what the view's scope gives, on the graph on show (a view kept at a past build too, as what it
    // holds is read here)
    const set = boardSet(G.g, world.review.data, v.scope).set;
    const gives = derivesOn(v.clustering, G.g.nodes.filter((_, i) => set[i]), existsIn(G.g.nodes), world.review.data.links);
    const lists: { items?: ViewItems } = { ...(v.items ? { items: structuredClone(v.items) } : {}) };
    const ops: ItemOp[] = [];
    for (const [to, list] of [["add", add], ["remove", remove]] as const)
      for (const id of list) {
        const op = itemOp(lists.items, id, to, gives(note(id)!));
        if (op && applyItemOp(lists, op)) ops.push(op);
      }
    if (ops.length) {
      const err = V.arrange(v.id, ops, null, a.caller.name, true);
      if (err) return fail(400, err, "");
    }
    there(whoOf(a.caller), v);
    const now = V.book.get(v.id) ?? v;
    const shows = (id: string) => {
      const listed = itemIn(now.items, id);
      return listed !== "remove" && (listed === "add" || gives(note(id)!));
    };
    return ok({ ok: true, changed: ops.length > 0, view: shown(now), items: itemsShown(now), notes: [...new Set([...add, ...remove])].map((id) => ({ id, shown: shows(id) })) });
  };

  /** A copy of a view, a board of the agent's own to arrange, named as the page's Duplicate names
   *  one ("<title> (copy)", numbered while that is taken) unless a name is given. */
  const duplicate = (a: Ask): Answer => {
    const no = who(a, true);
    if (no) return no;
    const V = world.views;
    const b = body(a);
    const v = find(V, b.id);
    if (!("id" in v)) return v;
    let name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : "";
    if (!name) {
      const ctx = titleContext(world);
      const taken = new Set(V.book.list().map((x) => viewTitle(x, ctx)));
      const base = `${viewTitle(v, ctx).slice(0, 60)} (copy)`;
      name = base;
      for (let k = 2; taken.has(name); k++) name = `${base} ${k}`;
    }
    const c = V.book.create(name, a.caller.name, { from: v.id, agent: true });
    if (typeof c === "string") return fail(400, c, "A name is 1 to 80 characters, without line breaks.");
    V.changed([{ id: c.id, what: "kept", by: a.caller.name }], true);
    there(whoOf(a.caller), c);
    return ok({ view: shown(c), from: v.id });
  };

  /** A view named, renamed, or (null) its name taken away; naming a view nobody kept keeps it. */
  const rename = (a: Ask): Answer => {
    const no = who(a, true);
    if (no) return no;
    const V = world.views;
    const b = body(a);
    const v = find(V, b.id);
    if (!("id" in v)) return v;
    if (b.name !== null && typeof b.name !== "string") return fail(400, "name is the view's new name, or null to take its name away.", "A name is 1 to 80 characters, without line breaks.");
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : null;
    const r = V.book.rename(v.id, name, a.caller.name);
    if (typeof r === "string") return fail(400, r, "The Project keeps its name; a name is 1 to 80 characters.");
    V.changed(r, true);
    return ok({ ok: true, changed: r.length > 0, view: shown(v) });
  };

  /** A kept view deleted, for everyone (never the Project): its pins, folds and layout go with it;
   *  its scope can be opened again. A view targets are linked to is deleted as any is, and those
   *  targets have no view after (`unlinked`; the owner's decisions of 2026-10-11): a click on one
   *  opens a temporary view of its TCB, until someone keeps that view or links it to another. */
  const remove = (a: Ask): Answer => {
    const no = who(a, true);
    if (no) return no;
    const V = world.views;
    const v = find(V, body(a).id);
    if (!("id" in v)) return v;
    const title = viewTitle(v, titleContext(world));
    const scope = printQuery(v.scope);
    const targets = v.targets ?? [];
    const c = V.book.remove(v.id, a.caller.name);
    if (typeof c === "string") return fail(400, c, "The Project is always there; a view nobody keeps goes by itself when the last page closes it.");
    V.changed([c], true);
    return ok({
      ok: true,
      deleted: v.id,
      title,
      scope,
      ...(targets.length ? { unlinked: targets } : {}),
      note:
        `Pages on it went back to the Project. POST /api/agent/views/create {"name": …, "scope": ${JSON.stringify(scope)}} makes it again, without its arrangement.` +
        (targets.length ? ` ${targets.join(", ")} ${targets.length === 1 ? "has" : "have"} no view now: a click on one (or POST /api/agent/view {"review": …}) opens a temporary view of its TCB, linked to it while it lasts; views/link links it to another view.` : ""),
    });
  };

  /** A view laid out afresh, for everyone on it: its pins and its layout's memory go (the
   *  Project's graph is laid out anew), its folds stay. */
  const relayout = (a: Ask): Answer => {
    const no = who(a, true);
    if (no) return no;
    const V = world.views;
    const v = find(V, body(a).id);
    if (!("id" in v)) return v;
    const pins = CLUSTER_MODES.reduce((n, m) => n + Object.keys(v.pins[m].nodes).length + Object.keys(v.pins[m].clusters).length, 0);
    const err = V.relayout(v.id, a.caller.name!, true);
    if (err) return fail(404, err, "GET /api/agent/views lists them.");
    there(whoOf(a.caller), v);
    return ok({ ok: true, view: shown(v), dropped: pins, note: "Every pin of this view was dropped, for everyone; that is not undone. The timeline says you did it." });
  };

  return [
    {
      method: "GET" as const, path: "/api/agent/views", brief: "the views (POST /api/agent/views/open {scope}: one on a query)", about: "The views — boards everyone shares: the Project (everything), each target's view (the one it is linked to, which may be several targets'; a target none is linked to has none: a click on it opens a temporary view of its TCB), the views people made or arranged, and the open ones nobody keeps — with who is on each.",
      params: {},
      returns: "{views: [{id, title (short, as the page shows it), description (its scope in full), name, scope, clustering, kept, targets? (the targets linked to it, the first linked first), focus (its focus now, or null), by, at, version?, on: [names]}], note}",
      run: () => list(),
    },
    {
      method: "GET", path: "/api/agent/views/view", about: "One view: its scope, what it holds, its folds, the levels it hides and its pins, and its clusters as this board has them (in its own coordinates, for folding and pinning). A view kept at a past build says which (view.version, a snapshot's id: GET /api/agent/history); the pages show that build's graph on it, arranged as any view but not reviewed, and its exported document is that build's (GET /api/agent/export), while what it holds and its clusters here are the latest build's.",
      params: { id: "the view's id", mode: "namespace or module (default: the view's clustering)", members: "1: the names of the declarations it holds (at most 5,000)" },
      returns: "{view, holds: {project, outside}, items: {add: [{id, text}], remove: [{id, text}], all?: true on the Project, which holds every note}, mode, folds, hidden: [keys of the levels it hides], pins: {nodes, clusters}, clusters: [{key, depth, count, r, parent, room, at, pinned}], members?}",
      run: (a) => view(a),
    },
    {
      method: "POST", path: "/api/agent/views/items", needs: "full", about: "Add notes of the project to a view, or take them out of it, for everyone on it, as the note's menu does (Add to view ▸, Remove from this view): items belong to views as declarations do. The Project shows every note; another view shows what follows from its scope — a note in a cluster on its board, on the ring about a cluster under the other clustering on it, or carrying a file linked to a declaration or a cluster it holds (a note that names a declaration in backticks is not connected to it) — and what was added to it, less what was taken out. A note is put on the view's add list only where its scope does not give it, on its remove list only where it does. Not on the Project (deleting a note is note/delete). Activity records each, as a scope change.",
      params: { id: "the view's id (not the Project)", add: "[note ids]: notes of the project the view is to show", remove: "[note ids]: notes it is not to show" },
      returns: "{ok, changed, view, items: {add: [{id, text}], remove: [{id, text}]}, notes: [{id, shown}]}",
      run: (a) => items(a),
    },
    {
      method: "POST", path: "/api/agent/views/open", about: "Open the view on a query — the open one with the same scope and build, or a new one nobody keeps — and be on it: people following you see it. With version, it shows that build, as what is made from a board of a past build does (Zoom in on a view kept at a build). The query language: all, tcb(A), uses(A), usedBy(A), decl(A, B), ns(P), file(P), trusted, external, kind(theorem), status(unreviewed|approved|commented|stale), advice(approve|comment), sorry, nonstandard, key(T) (key(targets): every target's), joined by and, or, except.",
      params: { scope: "the query, as text (e.g. \"tcb(A.b) except trusted except external\") or its JSON form", version: "a snapshot's id (GET /api/agent/history): the build it shows; null or left out for the latest", clustering: "namespace (default) or module: a new view's", focus: "a target's full name: a new view's focus, the target it is made from (as a target's Key view is)" },
      returns: "{view, holds: {project, outside}, note}",
      run: (a) => open(a),
    },
    {
      method: "POST", path: "/api/agent/views/create", needs: "full", about: "Make a view for everyone, named: on a scope, or a copy of another view (its scope, clustering, pins, folds, notes added and taken out — of the Project, the notes its scope would not give, as added — and the build it is kept at). With version, it shows that build: the Time Machine's Save as new view.",
      params: { name: "1 to 80 characters", scope: "the query (default all; with from, the copy holds it instead)", clustering: "namespace (default) or module", from: "a view's id, to copy it", version: "a snapshot's id (GET /api/agent/history): the build it shows; null for the latest (default: the copied view's, else the latest)" },
      returns: "{view}",
      run: (a) => create(a),
    },
    {
      method: "POST", path: "/api/agent/views/scope", needs: "full", about: "Change what a view holds, for everyone on it (they are told who did).",
      params: { id: "the view's id", scope: "the query" },
      returns: "{ok, view, holds}",
      run: (a) => scope(a),
    },
    {
      method: "POST", path: "/api/agent/views/arrange", needs: "full", about: "Arrange a view, for everyone on it: its clustering, levels of its cluster tree hidden or shown again (a hidden cluster's sub-clusters and declarations sit in its parent; a fold on it goes; the exported document's sections follow), clusters folded or opened, pins dropped or let go (in its own coordinates, on the board as it is after the levels hidden or shown; a place beyond the parent's room is brought inside), and the build it is kept at (version: the pages show that snapshot's graph on it, arranged as any view, not reviewed, its exported document that build's; the timeline records it). Arranging a view nobody keeps keeps it. The Project and the views linked to targets always show the latest build.",
      params: { id: "the view's id", clustering: "namespace or module", hide: "[cluster keys]: levels to hide, by this clustering", show: "[cluster keys]: hidden levels to show again", fold: "[cluster keys]", unfold: "[cluster keys]", pins: `[{name or cluster, at: [x, y] or null}], at most ${MAX_PINS}`, version: "a snapshot's id (GET /api/agent/history) to keep the view at that build, or null for the latest again" },
      returns: "{ok, view, changed, hidden: [keys of the levels hidden now], placed: [{key, at}], note?}",
      run: (a) => arrange(a),
    },
    {
      method: "POST", path: "/api/agent/views/focus", needs: "full", about: "Set a view's own focus, for everyone on it (ViewSpec decision 28): the target the review is on there — its strip, key marks and why a declaration is in its TCB, the whole review set counted whatever the board holds. Each person's own focus there stays theirs.",
      params: { id: "the view's id", focus: "a target's full name, or null (or left out) for none" },
      returns: "{ok, changed, view}",
      run: (a) => focus(a),
    },
    {
      method: "POST", path: "/api/agent/views/link", needs: "full", about: "Link a target to a view, for everyone (ViewSpec decision 29): clicking the target anywhere opens that view, which shows a small star by its name. A view may be linked to several targets: its focus is the first one's to begin with, and a target linked after leaves it as it is. A target is linked to one view: the view it was linked to keeps its scope and arrangement and only stops being the target's. Linking keeps a view nobody kept. Not the Project, nor a view kept at a past build.",
      params: { id: "the view's id", target: "a target's full name" },
      returns: "{ok, changed, view, left?: the view it was linked to before}",
      run: (a) => link(a),
    },
    {
      method: "POST", path: "/api/agent/views/duplicate", needs: "full", about: "Duplicate a view, as the Views menu does: a kept copy with its scope, clustering, pins, folds and what it shows of the project's notes (its added and taken-out notes; of the Project, every note its scope would not give, as added) — a board of your own to arrange, or to scope otherwise. You are on it after.",
      params: { id: "the view's id", name: "optional: 1 to 80 characters (default \"<its title> (copy)\")" },
      returns: "{view, from}",
      run: (a) => duplicate(a),
    },
    {
      method: "POST", path: "/api/agent/views/rename", needs: "full", about: "Name or rename a view, for everyone (naming one nobody keeps keeps it); null takes a kept view's name away. The Project keeps its name.",
      params: { id: "the view's id", name: "1 to 80 characters, or null" },
      returns: "{ok, changed, view}",
      run: (a) => rename(a),
    },
    {
      method: "POST", path: "/api/agent/views/delete", needs: "full", about: "Delete a kept view for everyone, with its pins, folds and layout; its scope can be opened again. A view targets are linked to is deleted too, and those targets then have no view (unlinked): view {review} on one opens a temporary view of its TCB, linked to it while it lasts, and views/link links it to another; the timeline says the deletion and the unlinks in one event. The Project cannot be deleted; a view nobody keeps goes by itself.",
      params: { id: "the view's id" },
      returns: "{ok, deleted, title, scope, unlinked?: the targets it was linked to, which have no view now, note}",
      run: (a) => remove(a),
    },
    {
      method: "POST", path: "/api/agent/views/relayout", needs: "full", about: "Lay a view out afresh, as ⚙ Board's Re-layout does: every pin of it is dropped for everyone (not undone) and it is laid out compactly again; its folds stay. On the Project, the server lays the whole graph out anew.",
      params: { id: "the view's id (project for the Project)" },
      returns: "{ok, view, dropped: how many pins went, note}",
      run: (a) => relayout(a),
    },
  ];
}
