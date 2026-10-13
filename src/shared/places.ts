// Shared pins (CollabSpec decision 2), as the server keeps them and the pages change them: per way
// of clustering, a node's or cluster's place in its parent's coordinates under the name the page
// knows it by. Operations are applied the same way on both sides; the last drop wins, and a drop
// moves its pin to the end, so that the order is the order things were dropped in.

import type { ClusterMode } from "./graph.ts";

export interface Pins {
  nodes: Record<string, [number, number]>;
  clusters: Record<string, [number, number]>;
}

export type PlaceOp =
  | { op: "pin"; mode: ClusterMode; kind: "node" | "cluster"; key: string; at: [number, number] }
  | { op: "unpin"; mode: ClusterMode; kind: "node" | "cluster"; key: string }
  | { op: "clear" };

export interface PlacesData {
  layoutVersion: number;
  layouts: Record<ClusterMode, Pins>;
}

export const CLUSTER_MODES: ClusterMode[] = ["namespace", "module"];

export const emptyLayouts = (): Record<ClusterMode, Pins> => ({ namespace: { nodes: {}, clusters: {} }, module: { nodes: {}, clusters: {} } });

/** Why a list of operations is refused, or null. */
export function invalidOps(ops: unknown): string | null {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 2000) return "ops";
  for (const o of ops as Record<string, unknown>[]) {
    if (!o || typeof o !== "object") return "op";
    if (o.op === "clear") continue;
    if (o.op !== "pin" && o.op !== "unpin") return "op";
    if (!CLUSTER_MODES.includes(o.mode as ClusterMode)) return "mode";
    if (o.kind !== "node" && o.kind !== "cluster") return "kind";
    if (typeof o.key !== "string" || !o.key || o.key.length > 2000) return "key";
    if (o.op === "pin") {
      const at = o.at;
      if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e7)) return "at";
    }
  }
  return null;
}

/** Apply operations to `layouts` in place; true when anything changed. */
export function applyOps(layouts: Record<ClusterMode, Pins>, ops: PlaceOp[]): boolean {
  let changed = false;
  for (const o of ops) {
    if (o.op === "clear") {
      for (const m of CLUSTER_MODES) {
        const p = layouts[m];
        if (Object.keys(p.nodes).length + Object.keys(p.clusters).length) changed = true;
        layouts[m] = { nodes: {}, clusters: {} };
      }
      continue;
    }
    const set = o.kind === "node" ? layouts[o.mode].nodes : layouts[o.mode].clusters;
    if (o.op === "unpin") {
      if (o.key in set) {
        delete set[o.key];
        changed = true;
      }
      continue;
    }
    const at: [number, number] = [Math.round(o.at[0] * 10) / 10, Math.round(o.at[1] * 10) / 10];
    const was = set[o.key];
    if (was && was[0] === at[0] && was[1] === at[1] && Object.keys(set).pop() === o.key) continue;
    // dropped again: to the end, as the latest drop
    delete set[o.key];
    set[o.key] = at;
    changed = true;
  }
  return changed;
}

/** The operations that turn `before` into `after` (one way of clustering), in drop order. */
export function diffPins(mode: ClusterMode, before: Pins, after: Pins): PlaceOp[] {
  const ops: PlaceOp[] = [];
  for (const kind of ["cluster", "node"] as const) {
    const b = kind === "node" ? before.nodes : before.clusters;
    const a = kind === "node" ? after.nodes : after.clusters;
    for (const key of Object.keys(b)) if (!(key in a)) ops.push({ op: "unpin", mode, kind, key });
    for (const [key, at] of Object.entries(a)) {
      const was = b[key];
      if (!was || was[0] !== at[0] || was[1] !== at[1]) ops.push({ op: "pin", mode, kind, key, at });
    }
  }
  return ops;
}
