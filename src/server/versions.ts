// Versions (TCBSpec.md, decision 3, as the owner revised it on 2026-10-09). An opinion is bound to
// one version of a declaration. The kernel's content hash names what the declaration refers to, so
// renaming a constant made every declaration that uses it look changed, and their approvals stale.
// A version is made instead from what the extractor gives beside that hash: the same content with
// the names taken out (`shape`), and those names in order (`refs`), each mapped to an identity a
// rename does not change — a unit's name taken back through the renames in force (the moves of the
// review that say a declaration was renamed, HistorySpec.md) to the first name it had. A pure rename
// of a declaration, or of what it refers to, leaves its version as it is; any other change to its
// statement or, for data, its body makes a new one, as the kernel's hash did.
//
// Opinions recorded before versions carry the kernel's hash. The replay binds each to the version
// of the content that hash was taken of (`rebinder`), where a graph the server has read holds that
// declaration with that hash, so that no approval goes stale by the change of scheme.

import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { RawGraph, ViewMeta } from "../shared/graph.ts";
import type { ReviewEvent } from "../shared/review.ts";

/** A unit's name taken back through the renames in force, to the first it had; a name never
 *  renamed is its own. */
export type Identity = (unit: string) => string;
export const ownName: Identity = (u) => u;

/** What versions are made of, per project node of a graph: its name, the kernel's hash, its shape
 *  and its references (indices into `refNames`). A node of an extraction from before versions has
 *  no shape, and its version is the kernel's hash. Kept beside the graph on show, so that its
 *  versions can be made again when the renames change. */
export interface VersionBase {
  names: string[];
  kernel: string[];
  shape: (string | null)[];
  refs: (number[] | null)[];
  refNames: string[];
}

export function versionBase(g: RawGraph): VersionBase {
  return {
    names: g.nodes.map((n) => n.name),
    kernel: g.nodes.map((n) => n.hash),
    shape: g.nodes.map((n) => (g.refNames && n.shape && n.refs ? n.shape : null)),
    refs: g.nodes.map((n) => (g.refNames && n.shape && n.refs ? n.refs : null)),
    refNames: g.refNames ?? [],
  };
}

/** A reference as the version reads it: a unit's name mapped through `identity`, and what follows
 *  the space (`A.Point mk`: the constructor of the unit `A.Point`) kept. */
export function refIdentity(ref: string, identity: Identity): string {
  const sp = ref.indexOf(" ");
  return sp < 0 ? identity(ref) : identity(ref.slice(0, sp)) + ref.slice(sp);
}

/** The version of one content: its shape, and its references mapped (16 hex digits, as the
 *  kernel's hash was written). */
export function versionOf(shape: string, refs: readonly string[]): string {
  const h = createHash("sha256").update(shape);
  for (const r of refs) h.update("\0").update(r);
  return h.digest("hex").slice(0, 16);
}

/** Every project node's version under `identity`. Each name of `refNames` is mapped once. */
export function versions(b: VersionBase, identity: Identity = ownName): string[] {
  const mapped: (string | undefined)[] = new Array(b.refNames.length);
  const ref = (k: number) => (mapped[k] ??= refIdentity(b.refNames[k], identity));
  return b.names.map((_, i) => {
    const shape = b.shape[i];
    const refs = b.refs[i];
    return shape !== null && refs !== null ? versionOf(shape, refs.map(ref)) : b.kernel[i];
  });
}

/** The page's graph with each project node's `hash` its version under `identity` and `kernel` the
 *  kernel's hash; null when every version is the one it has already. */
export function withVersions(metaGz: Buffer, b: VersionBase, identity: Identity): Buffer | null {
  const meta: ViewMeta = JSON.parse(gunzipSync(metaGz).toString("utf8"));
  const vs = versions(b, identity);
  let changed = false;
  for (let i = 0; i < meta.projectCount && i < vs.length; i++) {
    const v = meta.nodes[i];
    if (v.name !== b.names[i]) throw new Error(`versions: node ${i} is ${v.name} in the page's graph and ${b.names[i]} in the extraction`);
    if (v.hash === vs[i]) continue;
    v.hash = vs[i];
    if (b.shape[i] !== null) v.kernel = b.kernel[i];
    changed = true;
  }
  return changed ? gzipSync(JSON.stringify(meta)) : null;
}

/** What the replay reads an opinion as: one recorded under the kernel's content hash, before
 *  versions, is bound to the version of the content that hash was taken of — `lookup(name, hash)`
 *  gives it where a graph the server has read holds the declaration with that hash (the one on
 *  show, the snapshots of the history), and null where none does: the opinion is then as it was
 *  written, on a version that is not there now. An opinion recorded under a version is never a
 *  kernel's hash of its declaration, and is left as it is. */
export function rebinder(lookup: (name: string, kernel: string) => string | null): (e: ReviewEvent) => ReviewEvent {
  return (e) => {
    if (e.op !== "opinion" || !e.hash) return e;
    const v = lookup(e.name, e.hash);
    return v && v !== e.hash ? { ...e, hash: v } : e;
  };
}
