// What the Time Machine and the agents read of the history (server/historyapi.ts) — a snapshot's
// graph in the page's two parts, its whole graph, what changed between two snapshots — made off the
// server's thread. On NavierStokesAndEuler (52,648 declarations, 5 M edges) the Time Machine's first
// look at a build held every request for 4 s: the snapshot read from its files (1 s), its two parts
// made and compressed (1.6 s), what changed since (0.8 s). A worker reads the history from the site's
// files as the server's own does, and only reads them; it keeps what it read while the history's
// index stays as it was (every snapshot written, read again or given its texts adds a line to it),
// answers one job at a time, and goes after a while without one, its memory with it. Should no worker
// start, or one fail, the job is done here: slower to answer others meanwhile, never wrong. This
// module is its own worker, as server/layoutthread.ts is.

import { statSync } from "node:fs";
import { join } from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { gzipSync } from "node:zlib";
import { packEdges } from "../shared/edgecodec.ts";
import { identityIn } from "../shared/moves.ts";
import type { HistoryDiff } from "../shared/pastgraph.ts";
import { History, diffGraphs, pageGraph } from "./history.ts";
import type { SnapshotInfo } from "./history.ts";
import { ownName } from "./versions.ts";
import type { Identity } from "./versions.ts";

/** A job: snapshot `id`'s two parts, or its whole graph (compressed); or what changed from snapshot
 *  `from` to `to`, at most `most` names of each kind, `renames` the renames recorded between them
 *  (server/live.ts, renamesBetween). */
export type Job =
  | { kind: "parts"; id: number }
  | { kind: "graph"; id: number }
  | { kind: "diff"; from: number; to: number; most: number; renames: [string, string][] };

/** A snapshot's graph in the page's two parts, compressed: its declarations as JSON, its edges
 *  packed (shared/edgecodec.ts). */
export interface Parts {
  nodes: Buffer;
  edges: Buffer;
}

/** A job done, with the snapshots as it read them: what it is kept under (server/historyapi.ts). */
export type Done =
  | { kind: "parts"; info: SnapshotInfo; parts: Parts }
  | { kind: "graph"; info: SnapshotInfo; gz: Buffer }
  | { kind: "diff"; infos: [SnapshotInfo, SnapshotInfo]; diff: HistoryDiff };

/** The modules whose text snapshot `id` keeps, each with how it was matched to its build
 *  (server/sourcestore.ts): what the page says of a declaration's source then before it asks. */
function keptTexts(h: History, id: number): Record<string, "lake" | "places"> {
  const out: Record<string, "lake" | "places"> = {};
  for (const [m, r] of Object.entries(h.sourcesOf(id) ?? {})) if (r.blob && r.check) out[m] = r.check;
  return out;
}

/** Do a job on history `h`, under `identity` (the renames in force), here. */
export function runJob(h: History, identity: Identity, job: Job): Done {
  if (job.kind === "diff") {
    const [a, b] = [h.graph(job.from), h.graph(job.to)];
    if (!a || !b) throw new Error(`There is no snapshot ${a ? job.to : job.from}.`);
    const diff = { from: job.from, to: job.to, ...diffGraphs(a, b, identity, new Map(job.renames), job.most) };
    return { kind: "diff", infos: [a.info, b.info], diff };
  }
  const g = h.graph(job.id);
  if (!g) throw new Error(`There is no snapshot ${job.id}.`);
  if (job.kind === "graph") return { kind: "graph", info: g.info, gz: gzipSync(JSON.stringify(pageGraph(g, identity))) };
  const { edges: _flat, ...rest } = pageGraph({ ...g, edges: [] }, identity);
  const E = new Int32Array(3 * g.edges.length);
  for (let k = 0; k < g.edges.length; k++) {
    const [s, d, m] = g.edges[k];
    E[3 * k] = s;
    E[3 * k + 1] = d;
    E[3 * k + 2] = m;
  }
  const nodes = gzipSync(JSON.stringify({ ...rest, edgeCount: g.edges.length, sources: keptTexts(h, job.id) }));
  return { kind: "parts", info: g.info, parts: { nodes, edges: gzipSync(packEdges(E, g.nodes.length, 2), { level: 9 }) } };
}

/** The identity of a unit under renames `renamed` (shared/moves.ts), as the server's own is
 *  (server/live.ts, identity): to → from, made again without a prototype. */
export function identityOf(renamed: [string, string][] | null): Identity {
  if (!renamed) return ownName;
  const r: Record<string, string> = Object.create(null);
  for (const [to, from] of renamed) r[to] = from;
  return (u) => identityIn(r, u);
}

/** What the worker is asked: a job on the history of site `site`, under the renames in force. */
interface Ask {
  n: number;
  site: string;
  renamed: [string, string][] | null;
  job: Job;
}

/** what is answered back: the job done, or why not */
type Answer = { n: number; done: Done } | { n: number; error: string };

/** how long the worker stays without a job: the Time Machine steps from build to build, each a job
 *  or three */
const IDLE_MS = 60_000;

let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let asked = 0;
/** how many jobs were done in the worker and how many here, since the start (the tests read it) */
export const jobsDone = { worker: 0, here: 0 };
/** the jobs out, by number: each with what does it here, should the worker fail */
const out = new Map<number, { ok: (d: Done) => void; fail: (e: unknown) => void; here: () => Done }>();

/** Every job out done here instead, and the worker forgotten: it stopped, or failed. */
function lost(w: Worker): void {
  if (worker !== w) return;
  worker = null;
  const jobs = [...out.values()];
  out.clear();
  for (const j of jobs) {
    try {
      j.ok(j.here());
    } catch (e) {
      j.fail(e);
    }
  }
}

function spawn(): Worker | null {
  if (worker) return worker;
  let w: Worker;
  try {
    w = new Worker(new URL(import.meta.url), { workerData: { vpHistory: true } });
  } catch {
    return null;
  }
  w.on("message", (a: Answer) => {
    const j = out.get(a.n);
    out.delete(a.n);
    if (j) {
      if ("done" in a) {
        jobsDone.worker++;
        j.ok(revive(a.done));
      } else {
        // what the worker could not do is no worker's failure: tried here, it says why
        try {
          j.ok(j.here());
        } catch (e) {
          j.fail(e);
        }
      }
    }
    if (!out.size) rest(w);
  });
  w.on("error", () => lost(w));
  w.on("exit", () => lost(w));
  // held only while a job is out (offThread): an idle worker keeps no process running. After its
  // listeners, which hold it again as they are added
  w.unref();
  worker = w;
  return w;
}

/** The worker holds nothing any more, and goes after IDLE_MS without a job. */
function rest(w: Worker): void {
  w.unref();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (out.size || !worker) return;
    const w = worker;
    worker = null;
    void w.terminate();
  }, IDLE_MS);
  idleTimer.unref();
}

/** Buffers come back from the worker as bytes: Buffers again. */
function revive(d: Done): Done {
  const buf = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);
  if (d.kind === "parts") return { ...d, parts: { nodes: buf(d.parts.nodes), edges: buf(d.parts.edges) } };
  if (d.kind === "graph") return { ...d, gz: buf(d.gz) };
  return d;
}

/** Do a job on the history of site `site` in the worker, under the renames in force `renamed`;
 *  `here` does it on this thread, where no worker can. */
export function offThread(site: string, renamed: [string, string][] | null, job: Job, doHere: () => Done): Promise<Done> {
  const here = () => (jobsDone.here++, doHere());
  return new Promise<Done>((ok, fail) => {
    const w = spawn();
    if (!w) {
      try {
        return ok(here());
      } catch (e) {
        return fail(e);
      }
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const n = ++asked;
    out.set(n, { ok, fail, here });
    w.ref();
    w.postMessage({ n, site, renamed, job } satisfies Ask);
  });
}

// in a worker: the jobs asked, one at a time, on the history as its files are now
if (!isMainThread && (workerData as { vpHistory?: boolean } | null)?.vpHistory) {
  let held: { site: string; stamp: string; h: History } | null = null;
  /** the history of `site`, read again when its index changed since the last job */
  const historyOf = (site: string): History => {
    let stamp = "";
    try {
      const st = statSync(join(site, "history", "index.jsonl"));
      stamp = `${st.size}:${st.mtimeMs}:${st.ino}`;
    } catch {
      // no history yet: nothing to keep
    }
    if (!held || held.site !== site || held.stamp !== stamp || !stamp) held = { site, stamp, h: new History(site) };
    return held.h;
  };
  parentPort!.on("message", (a: Ask) => {
    let answer: Answer;
    try {
      answer = { n: a.n, done: runJob(historyOf(a.site), identityOf(a.renamed), a.job) };
    } catch (e) {
      answer = { n: a.n, error: e instanceof Error ? e.message : String(e) };
    }
    const d = "done" in answer ? answer.done : null;
    const bytes = d?.kind === "parts" ? [d.parts.nodes, d.parts.edges] : d?.kind === "graph" ? [d.gz] : [];
    // the compressed bytes are handed over, not copied, where they are a buffer of their own
    const transfer = bytes.filter((b) => b.byteOffset === 0 && b.byteLength === b.buffer.byteLength).map((b) => b.buffer as ArrayBuffer);
    parentPort!.postMessage(answer, transfer);
  });
}
