// The Project view's places and pins (docs/agent-api/views.md; AgentSpec decision 4), the endpoints of
// server/agent.ts: where a declaration or a cluster is, as laid out and as pinned, and what is near
// it; pins dropped and let go of as one batch, recorded with what each replaced; and a batch undone,
// by an agent or from a page's Activity. A place is brought inside its parent as a drag would bring
// it. Other views are arranged through server/agentviews.ts.

import type { ClusterMode, Layout } from "../shared/graph.ts";
import { CLUSTER_MODES, invalidOps } from "../shared/places.ts";
import type { PlaceOp } from "../shared/places.ts";
import { PROJECT } from "../shared/views.ts";
import { View } from "./agentgraph.ts";
import type { AgentApi, Answer, Ask } from "./agent.ts";
import { body, clampInt, fail, needAgent, ok, str } from "./agent.ts";

export function place(api: AgentApi, a: Ask): Answer {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const mode = (a.query.get("mode") ?? "namespace") as ClusterMode;
  if (!CLUSTER_MODES.includes(mode)) return fail(400, `mode ${mode} is neither namespace nor module.`, "Leave it out for namespace, the page's default.");
  const hidden = projectHidden(api, mode);
  const L = v.projectLayout(mode, hidden);
  const near = a.query.get("near");
  const point = near === null ? null : near.split(",").map(Number);
  if (point && (point.length !== 2 || !point.every(Number.isFinite))) return fail(400, "near is x,y: two numbers in the parent's coordinates.", "e.g. near=12.5,-40: the siblings nearest that place come first.");
  const cluster = a.query.get("cluster");
  let me: { kind: "node" | "cluster"; index: number; key: string; parent: number; r: number; laidOut: [number, number] };
  if (cluster !== null) {
    const c = L.clusters.findIndex((x) => x.key === cluster);
    if (c < 0) return fail(404, `There is no cluster ${cluster} by ${mode}.`, "Clusters are named by their full path, e.g. a namespace; GET /api/agent/place?name=<declaration> names its cluster.");
    const cl = L.clusters[c];
    me = { kind: "cluster", index: c, key: cl.key, parent: cl.parent, r: cl.r, laidOut: [cl.lx, cl.ly] };
  } else {
    const i = api.find(v, a.query.get("name"));
    if (typeof i !== "number") return i;
    me = { kind: "node", index: i, key: v.g.nodes[i].name, parent: L.cluster[i], r: LEAF_R, laidOut: [L.lx[i], L.ly[i]] };
  }
  const pin = pinOf(api, mode, me.kind, me.key);
  // what else is in the parent, each where it is drawn: its pin, or where the layout put it
  const inside = v.inside(mode, hidden, me.parent);
  const sibs = [
    ...inside.nodes.filter((j) => me.kind !== "node" || j !== me.index).map((j) => ({ kind: "node" as const, key: v.g.nodes[j].name, of: v.g.nodes[j].kind, r: LEAF_R, laidOut: [L.lx[j], L.ly[j]] as [number, number] })),
    ...inside.clusters.filter((k) => me.kind !== "cluster" || k !== me.index).map((k) => ({ kind: "cluster" as const, key: L.clusters[k].key, of: null, r: L.clusters[k].r, laidOut: [L.clusters[k].lx, L.clusters[k].ly] as [number, number] })),
  ].map((x) => {
    const p = pinOf(api, mode, x.kind, x.key);
    return { ...x, pin: p, at: p.at ?? x.laidOut };
  });
  const from = (point as [number, number] | null) ?? pin.at ?? me.laidOut;
  // nearest first: what a pin there would crowd. The gap is the free space between the two
  // circles, were this one at `from`; below zero they overlap
  const gap = (x: { at: [number, number]; r: number }) => Math.hypot(x.at[0] - from[0], x.at[1] - from[1]) - x.r - me.r;
  sibs.sort((x, y) => gap(x) - gap(y));
  const limit = clampInt(a.query.get("limit"), 100, 0, 2000);
  const room = roomIn(L, me.parent, me.r);
  return ok({
    mode,
    kind: me.kind,
    key: me.key,
    parent: { ...parentOf(api, L, me.parent), room: shown(roomIn(L, me.parent, 0)) },
    r: me.r,
    room: shown(room),
    laidOut: me.laidOut,
    pinned: pin.at,
    ...(pin.at ? { pinnedBy: pin.by } : {}),
    siblings: {
      total: sibs.length,
      pinned: sibs.filter((x) => x.pin.at).length,
      nearestTo: from,
      more: Math.max(0, sibs.length - limit),
      list: sibs.slice(0, limit).map((x) => ({
        kind: x.kind,
        key: x.key,
        ...(x.of ? { declKind: x.of } : {}),
        r: x.r,
        at: x.at,
        gap: Math.round(gap(x) * 10) / 10,
        pinned: !!x.pin.at,
        ...(x.pin.at ? { pinnedBy: x.pin.by, laidOut: x.laidOut } : {}),
      })),
    },
  });
}

export function parentOf(api: AgentApi, L: Layout, c: number): { cluster: string | null; r: number | null } {
  return c >= 0 ? { cluster: L.clusters[c].key, r: L.clusters[c].r } : { cluster: null, r: null };
}

/** A pin, and who dropped it as far as the server knows (null: not recorded — it was dropped
 *  before the server kept who). */
/** The levels the Project view hides by `mode` (ViewSpec decision 24); none where the world has
 *  no views. */
export function projectHidden(api: AgentApi, mode: ClusterMode): string[] {
  return api.world.views?.book.get(PROJECT)?.hidden[mode] ?? [];
}

export function pinOf(api: AgentApi, mode: ClusterMode, kind: "node" | "cluster", key: string): { at: [number, number] | null; by: { name: string | null; agent: boolean; at: string } | null } {
  const P = api.world.places.data.layouts[mode];
  const set = kind === "node" ? P.nodes : P.clusters;
  if (!Object.hasOwn(set, key)) return { at: null, by: null };
  const who = api.world.places.authorOf(mode, kind, key);
  return { at: set[key], by: who ? { name: who.by, agent: !!who.agent, at: who.at } : null };
}

export function pins(api: AgentApi, a: Ask): Answer {
  const no = needAgent(a.caller) ?? api.refuse(a.caller, "full");
  if (no) return no;
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const b = body(a);
  const mode = (b.mode ?? "namespace") as ClusterMode;
  if (!CLUSTER_MODES.includes(mode)) return fail(400, "mode is namespace or module.", "Leave it out for namespace, the page's default.");
  if (!Array.isArray(b.pins) || !b.pins.length || b.pins.length > MAX_PINS)
    return fail(400, `pins is a list of 1 to ${MAX_PINS} {name or cluster, at: [x, y] or null}.`, "at is in the parent cluster's coordinates (GET /api/agent/place); null lets go of the pin.");
  const L = v.projectLayout(mode, projectHidden(api, mode));
  const keys = new Map(L.clusters.map((c, k) => [c.key, k]));
  const ops: PlaceOp[] = [];
  for (const p of b.pins as Record<string, unknown>[]) {
    if (!p || typeof p !== "object") return fail(400, "Each pin is {name or cluster, at}.", "e.g. {\"name\": \"A.b\", \"at\": [12, -40]}.");
    let kind: "node" | "cluster", key: string, room: number;
    if (typeof p.cluster === "string") {
      const c = keys.get(p.cluster);
      if (c === undefined) return fail(404, `There is no cluster ${p.cluster} by ${mode}.`, "GET /api/agent/place?name=<declaration> names the cluster it is in.");
      kind = "cluster";
      key = p.cluster;
      room = roomIn(L, L.clusters[c].parent, L.clusters[c].r);
    } else {
      const i = api.find(v, str(p.name));
      if (typeof i !== "number") return i;
      kind = "node";
      key = v.g.nodes[i].name;
      room = roomIn(L, L.cluster[i], LEAF_R);
    }
    if (p.at === null) ops.push({ op: "unpin", mode, kind, key });
    else ops.push({ op: "pin", mode, kind, key, at: inside(p.at, room) });
  }
  const why = invalidOps(ops);
  if (why) return fail(400, `The pins are not right (${why}).`, "at is [x, y], two finite numbers in the parent cluster's coordinates.");
  const done = layout(api, a.caller.name!, true, ops);
  // where each one went: a place beyond the parent's room is brought in, as a drag would be
  return ok({ ...done, placed: ops.map((o) => (o.op === "pin" ? { key: o.key, at: o.at } : o.op === "unpin" ? { key: o.key, at: null } : null)).filter(Boolean) });
}

/** Drop and let go of pins as one batch (AgentSpec decision 4): applied as a page's drop is, and
 *  recorded in the timeline with what each pin was before, so that it can be undone at once. */
export function layout(api: AgentApi, by: string, agent: boolean, ops: PlaceOp[]): { ok: true; id: number | null; count: number } {
  const P = api.world.places.data.layouts;
  const id = (o: Exclude<PlaceOp, { op: "clear" }>) => `${o.mode}\u0000${o.kind}\u0000${o.key}`;
  const pinOf = (o: Exclude<PlaceOp, { op: "clear" }>) => (o.kind === "node" ? P[o.mode].nodes : P[o.mode].clusters)[o.key] ?? null;
  const moves = ops.filter((o): o is Exclude<PlaceOp, { op: "clear" }> => o.op !== "clear");
  const before = new Map<string, { o: Exclude<PlaceOp, { op: "clear" }>; at: [number, number] | null }>();
  for (const o of moves) if (!before.has(id(o))) before.set(id(o), { o, at: pinOf(o) });
  if (!api.world.places.apply(moves, { by, agent })) return { ok: true, id: null, count: 0 };
  api.world.placesChanged(moves, null, by);
  const as = (o: Exclude<PlaceOp, { op: "clear" }>, at: [number, number] | null): PlaceOp =>
    at ? { op: "pin", mode: o.mode, kind: o.kind, key: o.key, at } : { op: "unpin", mode: o.mode, kind: o.kind, key: o.key };
  // what the batch left (each pin once, where it ended), and what puts back what was there
  const after = [...before.values()].map(({ o }) => as(o, pinOf(o)));
  const undo = [...before.values()].map(({ o, at }) => as(o, at));
  const e = api.world.timeline.add({ kind: "layout", by, ...(agent ? { agent: true as const } : {}), count: before.size, ops: after, undo });
  return { ok: true, id: e.id, count: before.size };
}

/** Undo a layout batch: every pin it set goes back to what it was, except where someone moved it
 *  since — that one is left, and the answer (and the timeline) says so. `by` is null for a private
 *  reader's undo (CollabSpec decision 8), recorded without a name. */
export function undo(api: AgentApi, by: string | null, agent: boolean, id: unknown): Answer {
  if (typeof id !== "number" || !Number.isInteger(id)) return fail(400, "id is the layout batch's number.", "POST /api/agent/pins answers with it; GET /api/agent/activity lists layout events.");
  const events = api.world.timeline.events;
  const e = events.find((x) => x.id === id);
  if (!e || e.kind !== "layout") return fail(404, `There is no layout batch #${id}.`, "GET /api/agent/activity lists layout events, each with its id.");
  const done = events.find((x) => x.kind === "undo" && x.of === id);
  if (done) return fail(409, `Layout batch #${id} was undone already, by ${(done as { by: string | null }).by ?? "someone"}.`, "Nothing to do.");
  const P = api.world.places.data.layouts;
  const restore: PlaceOp[] = [];
  const kept: string[] = [];
  e.ops.forEach((o, k) => {
    if (o.op === "clear") return;
    const now = (o.kind === "node" ? P[o.mode].nodes : P[o.mode].clusters)[o.key] ?? null;
    const left = o.op === "pin" ? o.at : null;
    const same = now === left || (!!now && !!left && now[0] === left[0] && now[1] === left[1]);
    if (same) restore.push(e.undo[k]);
    else kept.push(o.key);
  });
  if (restore.length && api.world.places.apply(restore, { by, agent })) api.world.placesChanged(restore, null, by);
  const u = api.world.timeline.add({ kind: "undo", by, ...(agent ? { agent: true as const } : {}), of: id, restored: restore.length, kept });
  return ok({
    ok: true,
    id: u.id,
    restored: restore.length,
    kept,
    ...(kept.length ? { note: `${kept.length} left where they are: someone moved them since.` } : {}),
  });
}

export function undoPost(api: AgentApi, a: Ask): Answer {
  const no = needAgent(a.caller) ?? api.refuse(a.caller, "full");
  if (no) return no;
  return undo(api, a.caller.name!, true, body(a).id);
}

export const MAX_PINS = 500;

/** a declaration's radius as the layout packs it (web/src/scene.ts, LEAF_R) */
export const LEAF_R = 5;

/** How far from its parent's centre something of radius `r` may be placed, as the page keeps a
 *  drop inside its parent's circle (web/src/scene.ts, `inside`): the circle less the room left for
 *  its label. Where the page folded the thing, it is smaller and may go further; this is the
 *  bound for every page. Infinity at the top, where nothing holds it. */
export function roomIn(L: Layout, parent: number, r: number): number {
  if (parent < 0) return Infinity;
  const P = L.clusters[parent];
  return Math.max(0, P.r - (10 + Math.min(14, Math.sqrt(P.count))) - r);
}

/** A room as the API says it: to a tenth, never beyond it; null at the top, where nothing holds it. */
export function shown(room: number): number | null {
  return Number.isFinite(room) ? Math.floor(room * 10) / 10 : null;
}

/** A place brought within `room` of the centre, a hair inside so that rounding keeps it there, as
 *  every page would bring it. Anything not a place is left for invalidOps to refuse. */
export function inside(at: unknown, room: number): [number, number] {
  if (!Array.isArray(at) || at.length !== 2 || !at.every((x) => typeof x === "number" && Number.isFinite(x))) return at as [number, number];
  const [x, y] = at as [number, number];
  const d = Math.hypot(x, y);
  if (d <= room) return [x, y];
  const k = Math.max(0, room - 0.1) / d;
  return [Math.round(x * k * 10) / 10, Math.round(y * k * 10) / 10];
}
