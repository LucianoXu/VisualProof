// The past graph (HistorySpec decisions 17 and 19): a snapshot of the history as a graph of its own,
// each declaration marked against the graph on show, and the review as that graph reads it. The
// page's Time Machine draws boards of it (web/src/past.ts, web/src/timemachine.ts); the server makes
// the same graph to print a view of a past build (server/pastdoc.ts, ExportSpec decision 16), so
// that the document holds what the board shows.
//
// A past graph holds that build's declarations and nothing else (the owner's decision of
// 2026-10-10): what was added since is not of that build, and is on none of its boards. A declaration
// renamed since stands under its name then, and knows its name now. Its marks: *ghost*, gone now with
// no rename carrying it; *changed*, another version now; *renamed*. The versions compared are both
// made under the renames in force, by the server (`/diff`), which reads what an earlier one refers to
// under its names now.
//
// A board of a past build is a board of that graph and nothing else: its scope evaluated on it
// (shared/board.ts, boardSet), what is lit computed on it, its numbering its own.

import type { GitSource, ViewMeta, ViewNode } from "./graph.ts";
import { byName } from "./review.ts";
import type { KeyMark, Opinion, ReviewData, Target } from "./review.ts";
import { Graph } from "./viewgraph.ts";

/** gone now, and no rename since carried it */
export const PAST_GHOST = 1;
/** another version now */
export const PAST_CHANGED = 4;
/** renamed since: shown under its name then */
export const PAST_RENAMED = 8;

/** A snapshot as GET /api/history lists it (server/history.ts, SnapshotInfo). */
export interface Snapshot {
  id: number;
  /** when its build finished; `approx` where only its extraction says */
  at: string;
  approx?: true;
  read: string;
  commit: { hash: string; branch: string | null; dirty?: boolean; guessed?: true } | null;
  toolchain: string;
  missing: string[];
  counts: { modules: number; nodes: number; edges: number; externals: number };
  imported?: true;
  renames?: { high: number; medium: number };
  /** how many of its modules' source texts are kept, of how many, and how many of those were
   *  matched to the build by its places alone (server/sourcestore.ts) */
  sources?: { kept: number; of: number; places: number; bytes: { new: number; all: number } };
}

/** What changed from a snapshot to the latest (GET /api/history/diff): names of now in `added`,
 *  `changed` and the second of each `renamed` pair, names then in `removed` and the first. */
export interface HistoryDiff {
  from: number;
  to: number;
  counts: { added: number; removed: number; changed: number; renamed: number };
  added: string[];
  removed: string[];
  changed: string[];
  renamed: [string, string][];
}

/** A snapshot's declarations as the page takes them (GET /api/history/graph?part=nodes). */
export interface SnapshotNodes {
  snapshot: Snapshot;
  modules: { name: string; imports: string[] }[];
  nodes: ViewNode[];
  projectCount: number;
  axioms: string[];
  axiomSets: number[][];
  edgeCount: number;
  /** the modules whose source text at that build is kept, each with how it was matched to the build */
  sources?: Record<string, "lake" | "places">;
}

/** A past graph: the snapshot's declarations, the project's then the outside world; per declaration
 *  its marks (PAST_*), and for one renamed since its name now. */
export interface PastGraph {
  snapshot: Snapshot;
  graph: Graph;
  marks: Uint8Array;
  /** name then → name now, for those renamed since */
  nowName: Map<string, string>;
  /** name now → name then */
  thenName: Map<string, string>;
  /** the modules whose source text at that build is kept, and how it was matched to the build
   *  (HistorySpec decision 23): where a module is not here, its text then is not kept */
  kept: ReadonlyMap<string, "lake" | "places">;
}

/** The git commit of a past build; none where it is not known, or only guessed. Its source is the
 *  project's, which the page has now (web/src/pageart.ts, GET /api/git). */
function gitThen(commit: Snapshot["commit"]): { git?: GitSource } {
  if (!commit || commit.guessed) return { git: undefined };
  return { git: { source: null, commit: commit.hash, branch: commit.branch, ...(commit.dirty ? { dirty: true as const } : {}) } };
}

/** The past graph of snapshot `snap` (its declarations and its edges, as /graph's parts give them),
 *  marked by `diff` (from it to the latest), with the project's description of `now`. */
export function pastGraph(snap: SnapshotNodes, edges: Int32Array, now: Graph, diff: HistoryDiff): PastGraph {
  const P = snap.projectCount;
  const nowName = new Map(diff.renamed);
  const thenName = new Map(diff.renamed.map(([a, b]) => [b, a]));
  const removed = new Set(diff.removed);
  const changed = new Set(diff.changed.map((n) => thenName.get(n) ?? n));
  const nodes = snap.nodes;
  const meta: ViewMeta = {
    schema: 1,
    layoutVersion: now.meta.layoutVersion,
    // the commit of that build, where it is known
    project: { ...now.meta.project, extractedAt: snap.snapshot.at, ...gitThen(snap.snapshot.commit) },
    modules: snap.modules.map((m) => ({ name: m.name, file: null, imports: m.imports })),
    nodes,
    projectCount: P,
    axioms: snap.axioms,
    axiomSets: snap.axiomSets,
    layouts: {} as ViewMeta["layouts"],
    edgeCount: edges.length / 3,
  };
  const graph = new Graph(meta, Int32Array.from(edges));
  // a declaration renamed since answers to its name now too: a view's record, the review, a pin, a
  // note and a selection speak the names of now (a move carries them, HistorySpec decision 8), and
  // reach it at this build by them; a name now that another declaration had then stays that one's
  for (const [then, now] of nowName) {
    const i = graph.byName.get(then);
    if (i !== undefined && !graph.byName.has(now)) graph.byName.set(now, i);
  }
  const marks = new Uint8Array(graph.n);
  for (let i = 0; i < P; i++) {
    const name = nodes[i].name;
    if (removed.has(name)) marks[i] |= PAST_GHOST;
    if (changed.has(name)) marks[i] |= PAST_CHANGED;
    if (nowName.has(name)) marks[i] |= PAST_RENAMED;
  }
  return { snapshot: snap.snapshot, graph, marks, nowName, thenName, kept: new Map(Object.entries(snap.sources ?? {})) };
}

/** The review as a past graph reads it (`nowName`: name then → name now, of what was renamed since):
 *  what was said of a declaration renamed since is kept under its name now (a move carried it), and
 *  is read under its name then too — its opinions, its target mark, its key marks as a member and as
 *  a target — so that what reads the review by a declaration's name on that graph (its status, the
 *  review box, the queues, a scope's conditions) finds it. `d` itself is left as it is. */
export function reviewThen(d: ReviewData, nowName: ReadonlyMap<string, string>): ReviewData {
  if (!nowName.size) return d;
  const opinions = Object.assign(byName<Opinion[]>(), d.opinions);
  const targets = Object.assign(byName<Target>(), d.targets);
  const keys = byName<Record<string, KeyMark>>();
  const add = <T>(into: Record<string, T>, from: Record<string, T>) => {
    for (const [then, now] of nowName) if (Object.hasOwn(from, now) && !Object.hasOwn(from, then)) into[then] = from[now];
  };
  add(opinions, d.opinions);
  add(targets, d.targets);
  for (const [t, marks] of Object.entries(d.keys)) {
    const m = Object.assign(byName<KeyMark>(), marks);
    add(m, marks);
    keys[t] = m;
  }
  add(keys, { ...d.keys, ...keys });
  // a link on a declaration renamed since is read under its name then too (AttachmentSpec decision
  // 6): the past board's panel lists it, and the past build's document prints it
  const thenOf = new Map([...nowName].map(([then, now]) => [`decl(${now})`, `decl(${then})`]));
  const links = d.links?.flatMap((l) => (thenOf.has(l.subject) ? [l, { ...l, subject: thenOf.get(l.subject)! }] : [l]));
  return { ...d, opinions, targets, keys, ...(links ? { links } : {}) };
}
