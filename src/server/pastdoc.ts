// The builds a view of a past build is printed from (ExportSpec decision 16, the owner's of
// 2026-10-10): a view's board at a past build is a board of the past graph (HistorySpec decision 17),
// which the page makes from the snapshot and what changed since (shared/pastgraph.ts); the server
// makes the same graph here from the same answers (server/historyapi.ts), so that the document holds
// exactly what the board shows, and reads each module's text of that build from the history's blobs
// (server/sourcestore.ts, HistorySpec decisions 20–23). A text that is not kept is said so, never
// stood in for by the latest build's. A module outside the project is not kept per build: its text
// is its package's file now where that package is at the revision the build had, else not kept
// (decision 24; server/historyapi.ts, `pastOutside`).
//
// A snapshot's graph takes about a second to read back, and the past graph made from it a fraction
// more: the last few builds printed are kept, each with the texts read for it, so that a second
// export of the same build — another view of it, the same one with other settings — reads nothing
// again.

import type { DocSource } from "../shared/doc/build.ts";
import type { ViewNode } from "../shared/graph.ts";
import { pastGraph } from "../shared/pastgraph.ts";
import type { PastGraph } from "../shared/pastgraph.ts";
import type { Graph } from "../shared/viewgraph.ts";
import { pageGraph } from "./history.ts";
import type { SnapshotInfo } from "./history.ts";
import { MOST_DIFF, pastOutside, snapshotDiff } from "./historyapi.ts";
import type { HistoryWorld } from "./historyapi.ts";

/** A past build as its documents read it. */
export interface PastBuild {
  info: SnapshotInfo;
  /** its past graph, against the graph on show it was made with */
  past: PastGraph;
  /** a module's file, as that build's texts say it, else as the graph on show does */
  fileOf(module: string): string | null;
  /** a module's text of that build, read once; null where it is not kept */
  source(module: string): DocSource | null;
  /** a module outside the project whose text of that build is its package's file now (HistorySpec
   *  decision 24): its file there and the package; null where it is not kept */
  outside(module: string): { file: string; package: string } | null;
}

/** how many past builds are kept: a past graph and the texts read for a large view are large on a
 *  large project (Sphere-Packing-Lean's past graph: 13.7 MB of JSON) */
const KEEP = 2;

export class PastBuilds {
  private w: HistoryWorld;
  private kept = new Map<string, PastBuild>();

  constructor(w: HistoryWorld) {
    this.w = w;
  }

  /** Snapshot `id`'s build, against the graph on show `now` (`version`, its version, which changes
   *  with the renames in force too; `files`, its modules' files); null where the history has no such
   *  snapshot. Made once while the builds and the graph on show stay as they are. */
  get(id: number, now: Graph, version: number, files: (module: string) => string | null): PastBuild | null {
    const h = this.w.history;
    const info = h?.get(id);
    const latest = h?.latest();
    if (!h || !info || !latest) return null;
    // a build read again, the latest one, the graph on show, the renames in force or the texts found
    // since make another past build
    const key = [id, info.fingerprint, info.read, JSON.stringify(info.sources ?? null), latest.id, latest.fingerprint, latest.read, version, this.w.identityTag?.() ?? ""].join("\u0000");
    const have = this.kept.get(key);
    if (have) {
      // most recently used last: the oldest goes first
      this.kept.delete(key);
      this.kept.set(key, have);
      return have;
    }
    const snap = h.graph(id)!;
    // the snapshot's graph and what changed since, as the page takes them (GET /api/history/graph,
    // /diff): the same past graph
    const pg = pageGraph(snap, this.w.identity());
    const diff = snapshotDiff(this.w, id, latest.id, MOST_DIFF);
    const kept: Record<string, "lake" | "places"> = {};
    const refs = h.sourcesOf(id) ?? {};
    for (const [m, r] of Object.entries(refs)) if (r.blob && r.check) kept[m] = r.check;
    const past = pastGraph(
      { snapshot: info, modules: pg.modules, nodes: pg.nodes as ViewNode[], projectCount: pg.projectCount, axioms: pg.axioms, axiomSets: pg.axiomSets, edgeCount: snap.edges.length, sources: kept },
      Int32Array.from(pg.edges),
      now,
      diff,
    );
    const texts = new Map<string, DocSource | null>();
    // the outside world's texts of that build: its packages' files now, where at its revisions
    const outsideTexts = new Map<string, { file: string; package: string; lines: string[] } | null>();
    const w = this.w;
    const outsideNow = w.outsideNow && ((m: string) => w.outsideNow!(m));
    const outside = (m: string) => {
      if (!outsideTexts.has(m)) {
        const r = outsideNow && h.outsideModulesOf(id).has(m) ? pastOutside(info, m, outsideNow) : null;
        const body = r?.status === 200 ? (r.body as { file: string; text: string; outside: { package: string } }) : null;
        outsideTexts.set(m, body && { file: body.file, package: body.outside.package, lines: body.text.split("\n") });
      }
      return outsideTexts.get(m)!;
    };
    const b: PastBuild = {
      info,
      past,
      fileOf: (m) => (Object.hasOwn(refs, m) ? refs[m].file : files(m)),
      source: (m) => {
        if (!texts.has(m)) {
          const t = h.textOf(id, m);
          const o = t ? null : outside(m);
          texts.set(m, t && t.text !== null ? { lines: t.text.split("\n"), edited: false, contexts: null, hash: null, check: t.ref.check ?? "lake" } : o ? { lines: o.lines, edited: false, contexts: null, hash: null } : null);
        }
        return texts.get(m)!;
      },
      outside: (m) => {
        const o = outside(m);
        return o && { file: o.file, package: o.package };
      },
    };
    this.kept.set(key, b);
    while (this.kept.size > KEEP) this.kept.delete(this.kept.keys().next().value!);
    return b;
  }
}
