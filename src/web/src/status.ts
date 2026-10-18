// The Status colour scheme (CanvasSpec, "Colour schemes", decided 2026-10-08): one colour per
// declaration for where it stands, the most urgent state winning — its file's build failed or was
// never built, it contains sorry, then what reviewers said (commented, stale, approved; which of a
// comment and an approval wins is shared/review.ts's `VERDICT_ORDER`), and last whether it needs
// review at all (not yet reviewed, trusted). A file being compiled shows so while it lasts. What
// agents advise is not among the states: advice is never counted, and the panel shows it apart
// (AgentSpec decision 2).

import type { FileStatus } from "../../shared/build.ts";
import type { ClusterMode } from "../../shared/graph.ts";
import { statusOf } from "../../shared/review.ts";
import type { ReviewData } from "../../shared/review.ts";
import { needsReview } from "../../shared/reviewqueue.ts";
import type { Graph } from "../../shared/viewgraph.ts";

/** The two ways of colouring the canvas's points: by kind, or by where each declaration stands. */
export type Scheme = "kind" | "status";

/** The states, most urgent first; a declaration's code is its index here. The legend lists them in
 *  this order, and the CSS colours are `--status-<state>`. */
export const STATUSES = ["failed", "building", "sorry", "commented", "stale", "approved", "unreviewed", "trusted"] as const;
export type StatusState = (typeof STATUSES)[number];

export const ST_FAILED = 0, ST_BUILDING = 1, ST_SORRY = 2, ST_COMMENTED = 3, ST_STALE = 4, ST_APPROVED = 5, ST_UNREVIEWED = 6, ST_TRUSTED = 7;

/** How the legend and the hover tip name each state. */
export const STATUS_LABEL: Record<StatusState, string> = {
  failed: "failed or not built",
  building: "building",
  sorry: "contains sorry",
  commented: "commented",
  stale: "stale",
  approved: "approved",
  unreviewed: "not yet reviewed",
  trusted: "trusted",
};

/** What each state means, for the legend's tooltips. */
export const STATUS_HINT: Record<StatusState, string> = {
  failed: "Its file failed to compile in the last build, or was never built: shown as it was last built",
  building: "Its file is being compiled right now",
  sorry: "It rests on sorry: its own, or through anything it uses",
  commented: "A reviewer's latest word on its present version is a comment",
  stale: "It has opinions, none on its present version",
  approved: "A reviewer approved its present version, and no reviewer's latest word on it is a comment",
  unreviewed: "Nobody has given an opinion on it yet, and nothing trusts it",
  trusted: "Trusted without review (Mathlib, Lean core, a trusted prefix, the standard axioms), with no opinion on it",
};

/** Where one declaration stands. `file` is its file's build status, when the page is live.
 *
 *  "Contains sorry" is read from the axioms it rests on (sorryAx), which Lean collects through
 *  everything it uses: a declaration that ends up depending on a sorry anywhere below it is shown
 *  so, not only the one that writes it (the owner's decision, 2026-10-08). Out of date, queued and
 *  blocked files are shown as last built, and so by their review. */
export function statusState(d: ReviewData, g: Graph, i: number, file: FileStatus | undefined, sorryAx: boolean): number {
  if (file?.state === "building") return ST_BUILDING;
  if (file?.state === "failed" || file?.state === "unbuilt") return ST_FAILED;
  if (sorryAx) return ST_SORRY;
  const v = g.nodes[i];
  const s = statusOf(d, v.name, v.hash);
  if (s === "commented") return ST_COMMENTED;
  if (s === "stale") return ST_STALE;
  if (s === "approved") return ST_APPROVED;
  // a non-standard axiom needs review whatever trusts it (ReviewSpec decision 3)
  return needsReview(g, d, i) ? ST_UNREVIEWED : ST_TRUSTED;
}

/** Every declaration of `g`'s state, as codes (indices into STATUSES). `files` holds the build
 *  status of the project's files, by module; empty in a snapshot or before the first report. */
export function statusCodes(d: ReviewData, g: Graph, files: Map<string, FileStatus>): Uint8Array {
  const out = new Uint8Array(g.n);
  // whether each set of axioms holds sorryAx, worked out once per set rather than per declaration
  const sorrySets = new Map<number, boolean>();
  for (let i = 0; i < g.n; i++) {
    const ax = g.nodes[i].ax;
    let s = sorrySets.get(ax);
    if (s === undefined) sorrySets.set(ax, (s = g.axiomsOf(i).includes("sorryAx")));
    out[i] = statusState(d, g, i, g.isExt(i) ? undefined : files.get(g.nodes[i].module), s);
  }
  return out;
}

/** How many declarations are in each state, of those `counted` keeps: the legend's progress. */
export function statusCounts(codes: Uint8Array, counted: (i: number) => boolean = () => true): number[] {
  const n = new Array<number>(STATUSES.length).fill(0);
  for (let i = 0; i < codes.length; i++) if (counted(i)) n[codes[i]]++;
  return n;
}

/** A file cluster's own build trouble, as a Status code (failed, building, sorry), or -1: what its
 *  outline shows in the Status scheme. Trouble inherited from below (blocked, out of date because
 *  something under it changed) is left out, so that one failure does not ring every file above it. */
export function fileTrouble(f: FileStatus | undefined): number {
  switch (f?.state) {
    case "failed":
    case "unbuilt":
      return ST_FAILED;
    case "building":
      return ST_BUILDING;
    case "sorry":
      return ST_SORRY;
    default:
      return -1;
  }
}

/** Each cluster's outline in the Status scheme (CanvasSpec, "Files and clusters"): its file's own
 *  trouble (fileTrouble) where the clusters are files, -1 (none, the plain outline) for every other
 *  cluster. Under namespaces a cluster's key is a namespace, which can read like a module's name
 *  without being its file: none has an outline there. -1, not 0, is "none": 0 is failed's code, and
 *  an array left at zeros ringed every namespace in failed's colour (the owner's report of
 *  2026-10-18). */
export function clusterTroubles(clusters: readonly { key: string }[], clustering: ClusterMode, files: ReadonlyMap<string, FileStatus>): Int8Array<ArrayBuffer> {
  const out = new Int8Array(clusters.length).fill(-1);
  if (clustering === "module") clusters.forEach((c, k) => (out[k] = fileTrouble(files.get(c.key))));
  return out;
}
