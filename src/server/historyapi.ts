// The history's endpoints (HistorySpec.md): the snapshots of the graph, one snapshot's graph, what
// changed between two of them and the source text a module's build was compiled from — what the
// Time Machine reads — and the moves: the migrations
// and the suggestions the lost-and-found lists, a move made by hand (Attach to…) and a migration
// undone; the lost-and-found itself, the newest build that had a name (Show in history), and its
// archive. The page asks under /api/history, agents under /api/agent/history, for the same
// answers; a move, an archiving or a putting back is recorded under who asks, a person with a name
// or an agent at level full.
//
// The Time Machine steps from build to build, and a snapshot's graph is large (on a large project,
// megabytes of JSON and a noticeable time to make and compress: Sphere-Packing-Lean's, 7,851 declarations, is 13.7 MB, made
// in 0.6 s): the page takes it in two parts, its declarations as JSON and its
// edges packed as the graph on show's are (shared/edgecodec.ts), each compressed once and kept for
// the last few snapshots asked, under the renames in force, and tagged so that a page that has one
// is answered 304. The parts, a snapshot's whole graph and what changed between two snapshots are
// made off the server's thread (server/historythread.ts), which meanwhile answers others: on
// NavierStokesAndEuler the Time Machine's first look at a build held it 4 s.

import { dirname } from "node:path";
import type { Answer, Ask } from "./agent.ts";
import { MAX_ARCHIVE_KEYS, validKey } from "./lostfound.ts";
import type { AgentEndpoint } from "./agentviews.ts";
import type { History, SnapshotInfo } from "./history.ts";
import { offThread, runJob } from "./historythread.ts";
import type { Done, Job, Parts } from "./historythread.ts";
import type { Identity } from "./versions.ts";
import type { LastHad, LostAnswer } from "../shared/lostfound.ts";
import type { HistoryDiff } from "../shared/pastgraph.ts";
import type { DeployStatus } from "../shared/deploy.ts";
import { outsideSource } from "./outside.ts";
import type { OutsideFile } from "./outside.ts";

/** What the endpoints read: the live server has it all. */
/** Who makes a move: a person or an agent by name, and someone invited by a personal link by the
 *  link's id too (CollabSpec decision 9). */
export interface Mover {
  name: string;
  agent: boolean;
  person?: string;
}

export interface HistoryWorld {
  history: History | null;
  /** the identities the renames in force give (server/versions.ts) */
  identity(): Identity;
  /** the renames in force (to → from), which `identity` follows: what the history's worker makes
   *  them again from (server/historythread.ts). A world without them is answered on the server's
   *  thread. */
  renamed?(): [string, string][] | null;
  /** the renames in force as a key: what a snapshot's graph is kept under (server/live.ts) */
  identityTag?(): string;
  /** the renames recorded from snapshot `from` to snapshot `to`, composed: a name at `from` → its
   *  name at `to` */
  renamesBetween?(from: number, to: number): Map<string, string>;
  /** the migrations and the suggestions not acted on; a move by hand; a migration undone
   *  (server/live.ts) */
  moves?(): unknown;
  moveByHand?(from: string, to: string, who: Mover): { status: number; body: unknown };
  unmove?(id: string, who: Mover): { status: number; body: unknown };
  /** the lost-and-found; the newest build that had a name; entries archived or put back
   *  (server/live.ts, server/lostfound.ts) */
  lostAndFound?(): LostAnswer;
  lastHad?(name: string): LastHad | null;
  archiveEntries?(keys: string[], on: boolean, who: Mover): { status: number; body: unknown };
  /** the branch followed and its builds (DeploySpec), what agents are told beside the snapshots;
   *  null for a workspace */
  following?(): DeployStatus | null;
  /** a module outside the project as it is now — its file in its package or in Lean's core
   *  (server/outside.ts) — and the project's toolchain now: what a past build shows of an outside
   *  declaration where its package is at that build's revision (HistorySpec decision 24); null
   *  where it is not found */
  outsideNow?(module: string): { file: OutsideFile; toolchain: string } | null;
}

const no = (status: number, error: string): Answer => ({ status, body: { error } });
const ok = (body: unknown): Answer => ({ status: 200, body });

/** the parts of the last snapshots asked, per history, by snapshot, build read and renames */
const kept = new WeakMap<History, Map<string, Parts>>();
/** how many snapshots' parts are kept: about a megabyte each, compressed, on a large project (Sphere-Packing-Lean's:
 *  0.7 MB of declarations, 0.5 MB of edges; NavierStokesAndEuler's 5.2 and 4.0 MB) */
const KEEP_PARTS = 8;
/** what changed between two snapshots, as answered last (a step on the Time Machine's timeline asks
 *  it of each build against the latest, every reader the same), by the builds as read and the renames
 *  in force; a few hundred KB at most each */
const diffsKept = new WeakMap<History, Map<string, HistoryDiff>>();
const KEEP_DIFFS = 32;
/** what is being made off the thread, by what it will be kept under: the Time Machine asks a
 *  snapshot's two parts at once, made by one job */
const making = new WeakMap<History, Map<string, Promise<Done>>>();

const mapOf = <K extends object, V>(m: WeakMap<K, Map<string, V>>, k: K): Map<string, V> => {
  let x = m.get(k);
  if (!x) m.set(k, (x = new Map()));
  return x;
};

/** Keep `v` under `key`, the most recently asked last: the oldest goes first. */
function keep<V>(byKey: Map<string, V>, key: string, v: V, most: number): void {
  byKey.delete(key);
  byKey.set(key, v);
  while (byKey.size > most) byKey.delete(byKey.keys().next().value!);
}

/** What a snapshot's parts are kept under: the snapshot, its build as read, the renames in force,
 *  and its texts (once backfilled, they change what the declarations' part says). */
const partsKey = (info: SnapshotInfo, tag: string) => `${info.id}\u0000${info.fingerprint}\u0000${info.read}\u0000${tag}\u0000${JSON.stringify(info.sources ?? null)}`;
const diffKey = (fa: SnapshotInfo, fb: SnapshotInfo, most: number, tag: string) => [fa.id, fa.fingerprint, fa.read, fb.id, fb.fingerprint, fb.read, most, tag].join("\u0000");

/** A job, made once however many ask for it at once (`key`): in the history's worker where the
 *  world says its renames, else on this thread. */
function made(w: HistoryWorld, key: string, job: Job): Promise<Done> {
  const h = w.history!;
  const byKey = mapOf(making, h);
  let p = byKey.get(key);
  if (!p) {
    const here = () => runJob(h, w.identity(), job);
    const renamed = w.renamed?.();
    p = (renamed === undefined ? Promise.resolve().then(here) : offThread(dirname(h.dir), renamed, job, here)).finally(() => byKey.delete(key));
    byKey.set(key, p);
  }
  return p;
}

/** Snapshot `id`'s graph as the page takes it (`part`): its declarations — the answer of /graph
 *  without the edges, and how many there are — or its edges, packed. Made together, once, off the
 *  server's thread. */
export async function snapshotParts(w: HistoryWorld, id: number): Promise<Parts> {
  const h = w.history!;
  const tag = w.identityTag?.() ?? "";
  const key = partsKey(h.get(id)!, tag);
  const byKey = mapOf(kept, h);
  const have = byKey.get(key);
  if (have) {
    keep(byKey, key, have, KEEP_PARTS);
    return have;
  }
  const d = await made(w, `parts\u0000${key}`, { kind: "parts", id });
  if (d.kind !== "parts") throw new Error("not the parts asked for");
  // kept as the job read the snapshot: one read again meanwhile is made again for whoever asks next
  keep(byKey, partsKey(d.info, tag), d.parts, KEEP_PARTS);
  return d.parts;
}

/** Module `module`'s text at snapshot `id`'s build (GET /source; HistorySpec decision 23): the
 *  text its build was compiled from, with its Lake hash and how it was matched to the build, or
 *  why it is not kept. Never another text. */
export function pastSource(h: History, id: number, module: string, outsideNow?: HistoryWorld["outsideNow"]): Answer {
  const s = h.get(id)!;
  const t = h.textOf(id, module);
  const build = { snapshot: id, at: s.at, commit: s.commit };
  // a module of the outside world that build referred to (HistorySpec decision 24)
  if (!t && outsideNow && !h.modulesOf(id).includes(module) && h.outsideModulesOf(id).has(module)) return pastOutside(s, module, outsideNow);
  if (!t) {
    const why = h.sourcesOf(id) === null ? "the texts of this build are still being looked for" : h.modulesOf(id).includes(module) ? "its module has no file of the project" : `the build has no module ${module.slice(0, 300)}`;
    return { status: 404, body: { error: `The text of ${module.slice(0, 300)} at this build is not kept: ${why}.`, kept: false, why, ...build } };
  }
  if (t.text === null) return { status: 404, body: { error: `The text of ${module} at this build is not kept: ${t.ref.why ?? "it was not found"}.`, kept: false, why: t.ref.why ?? null, file: t.ref.file, ...build } };
  return { status: 200, body: { module, file: t.ref.file, text: t.text, lake: t.ref.lake ?? null, check: t.ref.check, from: t.ref.from ?? null, ...build } };
}

/** A short revision, as the answers say it: a commit's first seven characters, a release whole. */
const shortRev = (r: string | null | undefined) => (!r ? "an unrecorded revision" : /^[0-9a-f]{40,64}$/.test(r) ? r.slice(0, 7) : r);

/** Outside module `module`'s text at snapshot `s`'s build (HistorySpec decision 24, the owner's of
 *  2026-10-20): outside sources are not kept per build, so it is the file as it is now where its
 *  package is at the revision that build had — the lake-manifest's `rev` then, recorded with the
 *  snapshot; for Lean's core, its toolchain — and otherwise not kept, said so with both revisions.
 *  `check: "rev"`: matched to the build by its package's revision. */
export function pastOutside(s: SnapshotInfo, module: string, outsideNow: NonNullable<HistoryWorld["outsideNow"]>): Answer {
  const build = { snapshot: s.id, at: s.at, commit: s.commit };
  const no = (why: string, file?: string): Answer => ({ status: 404, body: { error: `The text of ${module.slice(0, 300)} at this build was not kept: ${why}.`, kept: false, why, outside: true, ...(file ? { file } : {}), ...build } });
  const now = outsideNow(module);
  if (!now) return no("outside sources are not kept per build, and its file is not found outside the project now");
  const p = now.file.package;
  const revs = s.packages?.revs;
  const then = p.core ? s.toolchain : revs && Object.hasOwn(revs, p.name) ? revs[p.name] : null;
  const rev = p.core ? now.toolchain : p.rev;
  if (!p.core && !s.packages) return no(`outside sources are not kept per build, and the revisions of this build's packages were not recorded`, now.file.file);
  if (!then || !rev || then !== rev)
    return no(`outside sources are not kept per build, and ${p.core ? `the toolchain, whose core it is in, was ${then} then and is ${rev} now` : `${p.name} was at ${shortRev(then)} then and is at ${shortRev(rev)} now`}`, now.file.file);
  const src = outsideSource(now.file);
  if (!src) return no("outside sources are not kept per build, and its file cannot be read now", now.file.file);
  return { status: 200, body: { module, file: src.file, text: src.text, lake: null, check: "rev", from: "outside", outside: src.outside, ...build } };
}

/** A snapshot named in the query, `id` (or another key): the snapshot, or why not. The latest
 *  build's where it is left out and `dflt` says so. */
function snapshotOf(w: HistoryWorld, a: Ask, key: string, dflt: boolean): number | Answer {
  const h = w.history!;
  const raw = a.query.get(key);
  if (raw === null || raw === "" || raw === "now") {
    const l = h.latest();
    if (dflt && l) return l.id;
    return no(400, `Say which snapshot: ${key}=<its id> (GET /api/history lists them).`);
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || !h.get(id)) return no(404, `There is no snapshot ${raw.slice(0, 40)}.`);
  return id;
}

/** A request under /api/history (or /api/agent/history). `refuse`: why the caller may not move
 *  things (an agent below level full), or null. */
export async function historyAnswer(w: HistoryWorld, a: Ask, refuse: (a: Ask) => Answer | null = () => null): Promise<Answer> {
  const h = w.history;
  if (!h) return no(404, "This server serves a saved graph: it reads no builds, and keeps no history.");
  const path = a.path.replace(/^\/api(\/agent)?\/history/, "").replace(/\/+$/, "");
  if (a.method === "POST" && (path === "/move" || path === "/unmove" || path === "/archive")) {
    const no_ = refuse(a);
    if (no_) return no_;
    const name = a.caller.name?.trim();
    if (!name) return { status: 401, body: { error: `Say who you are first: ${path === "/archive" ? "an archiving" : "a move"} is recorded under your name.`, who: true } };
    // someone invited by a personal link moves under the link's id, in their own log
    const who: Mover = { name, agent: a.caller.kind === "agent", ...(a.caller.person ? { person: a.caller.person } : {}) };
    const b = (a.body && typeof a.body === "object" ? a.body : {}) as Record<string, unknown>;
    const str = (x: unknown) => typeof x === "string" && x.length > 0 && x.length <= 2000;
    if (path === "/move") {
      if (!str(b.from) || !str(b.to)) return no(400, "Send {from, to}: the full name of a declaration that is gone, and of one in the graph.");
      return w.moveByHand ? w.moveByHand(b.from as string, b.to as string, who) : no(404, "not found");
    }
    if (path === "/archive") {
      // one entry, or several at once (a name's every entry)
      const keys = b.keys === undefined ? [b.key] : b.keys;
      if (!Array.isArray(keys) || !keys.length || keys.length > MAX_ARCHIVE_KEYS || !keys.every(validKey) || (b.on !== undefined && typeof b.on !== "boolean"))
        return no(400, `Send {key, on}: an entry's key (GET /api/history/lost lists them) — or {keys: [at most ${MAX_ARCHIVE_KEYS}], on} — on true (the default) to archive, false to put back.`);
      return w.archiveEntries ? w.archiveEntries(keys as string[], b.on !== false, who) : no(404, "not found");
    }
    if (typeof b.id !== "string" || !b.id) return no(400, "Send {id}: a migration's id (GET /api/history/moves lists them).");
    return w.unmove ? w.unmove(b.id, who) : no(404, "not found");
  }
  if (a.method !== "GET") return no(405, "The history is read with GET; a move is made, or undone, with POST /move or /unmove, and an entry archived with POST /archive.");
  if (path === "/moves") return ok(w.moves?.() ?? { migrations: [], suggestions: [] });
  if (path === "/lost") return ok(w.lostAndFound?.() ?? { lost: [], migrations: [], archived: [], aside: { entries: 0, modules: [] }, count: 0 });
  if (path === "/archive") {
    const l = w.lostAndFound?.();
    return ok({ archived: l ? l.archived.map((x) => x.line) : [] });
  }
  if (path === "/last") {
    const name = a.query.get("name") ?? "";
    if (!name || name.length > 2000) return no(400, "Say which declaration: name=<its full name>.");
    const l = w.lastHad?.(name) ?? null;
    return l ? ok(l) : no(404, `No build the history kept had ${name.slice(0, 300)}: it went before the history began, or was never a declaration.`);
  }
  if (path === "") {
    const latest = h.latest();
    // agents are told the branch's builds too (DeploySpec decision 11): the page has them with the
    // build status
    const following = a.path.startsWith("/api/agent/") ? w.following?.() : null;
    return ok({ snapshots: h.list(), current: latest?.id ?? null, diskBytes: h.diskBytes(), ...(following ? { following } : {}) });
  }
  if (path === "/graph") {
    const id = snapshotOf(w, a, "id", true);
    if (typeof id !== "number") return id;
    const part = a.query.get("part");
    if (part === "nodes") return { status: 200, body: null, gz: { type: "application/json", body: (await snapshotParts(w, id)).nodes } };
    if (part === "edges") return { status: 200, body: null, gz: { type: "application/octet-stream", body: (await snapshotParts(w, id)).edges } };
    if (part !== null) return no(400, "part is nodes or edges; leave it out for the whole graph.");
    // the whole graph, which agents ask (105 MB of JSON on NavierStokesAndEuler): made and
    // compressed off the thread, each time
    const d = await made(w, `graph\u0000${partsKey(h.get(id)!, w.identityTag?.() ?? "")}`, { kind: "graph", id });
    if (d.kind !== "graph") throw new Error("not the graph asked for");
    return { status: 200, body: null, gz: { type: "application/json", body: d.gz } };
  }
  if (path === "/source") {
    const id = snapshotOf(w, a, "id", false);
    if (typeof id !== "number") return id;
    const module = a.query.get("module") ?? "";
    if (!module || module.length > 2000) return no(400, "Say which module: module=<its name>.");
    // asked of the world as a method: the live server's reads its own state
    return pastSource(h, id, module, w.outsideNow && ((m) => w.outsideNow!(m)));
  }
  if (path === "/diff") {
    const from = snapshotOf(w, a, "from", false);
    if (typeof from !== "number") return from;
    const to = snapshotOf(w, a, "to", true);
    if (typeof to !== "number") return to;
    const most = Math.min(MOST_DIFF, Math.max(0, Number(a.query.get("most") ?? 2000) || 0));
    return ok(await snapshotDiffOff(w, from, to, most));
  }
  return no(404, "not found");
}

/** the most names a diff lists of each kind: what the Time Machine asks, so that its marks and its
 *  lists have every declaration gone, changed, renamed or added since (web/src/timemachine.ts) */
export const MOST_DIFF = 20000;

/** What changed from snapshot `from` to snapshot `to` (both in the history), at most `most` names of
 *  each kind, as GET /diff answers it: made once, then kept for every reader and for the export of a
 *  view at a past build (server/pastdoc.ts), which makes the same past graph the page does. Made
 *  here, on the server's thread, where it is not kept. */
export function snapshotDiff(w: HistoryWorld, from: number, to: number, most: number): HistoryDiff {
  const h = w.history!;
  const key = diffKey(h.get(from)!, h.get(to)!, most, w.identityTag?.() ?? "");
  const byKey = mapOf(diffsKept, h);
  let body = byKey.get(key);
  if (body === undefined) {
    const d = runJob(h, w.identity(), diffJob(w, from, to, most));
    if (d.kind !== "diff") throw new Error("not the diff asked for");
    body = d.diff;
  }
  keep(byKey, key, body, KEEP_DIFFS);
  return body;
}

/** The same, made off the server's thread where it is not kept (GET /diff). */
async function snapshotDiffOff(w: HistoryWorld, from: number, to: number, most: number): Promise<HistoryDiff> {
  const h = w.history!;
  const tag = w.identityTag?.() ?? "";
  const key = diffKey(h.get(from)!, h.get(to)!, most, tag);
  const byKey = mapOf(diffsKept, h);
  const have = byKey.get(key);
  if (have) {
    keep(byKey, key, have, KEEP_DIFFS);
    return have;
  }
  const d = await made(w, `diff\u0000${key}`, diffJob(w, from, to, most));
  if (d.kind !== "diff") throw new Error("not the diff asked for");
  keep(byKey, diffKey(d.infos[0], d.infos[1], most, tag), d.diff, KEEP_DIFFS);
  return d.diff;
}

/** The job of what changed from `from` to `to`, with the renames recorded between them. */
function diffJob(w: HistoryWorld, from: number, to: number, most: number): Job {
  return { kind: "diff", from, to, most, renames: [...(w.renamesBetween?.(from, to) ?? new Map())] };
}

/** What the history's answers read, from what the agents' API has (server/agent.ts, World): what
 *  is not there answers as a server with nothing of it would. */
export function historyWorld(world: Partial<HistoryWorld>): HistoryWorld {
  return {
    get history() {
      return world.history ?? null;
    },
    identity: () => world.identity?.() ?? ((u: string) => u),
    // the renames, where the world says them or has no identity of its own (each name its own)
    ...(world.renamed || !world.identity ? { renamed: () => world.renamed?.() ?? null } : {}),
    identityTag: () => world.identityTag?.() ?? "",
    renamesBetween: (from, to) => world.renamesBetween?.(from, to) ?? new Map(),
    moves: () => world.moves?.() ?? { migrations: [], suggestions: [] },
    moveByHand: (from, to, who) => world.moveByHand?.(from, to, who) ?? { status: 404, body: { error: "not found" } },
    unmove: (id, who) => world.unmove?.(id, who) ?? { status: 404, body: { error: "not found" } },
    lostAndFound: () => world.lostAndFound?.() ?? { lost: [], migrations: [], archived: [], aside: { entries: 0, modules: [] }, count: 0 },
    lastHad: (name) => world.lastHad?.(name) ?? null,
    archiveEntries: (keys, on, who) => world.archiveEntries?.(keys, on, who) ?? { status: 404, body: { error: "not found" } },
    following: () => world.following?.() ?? null,
    outsideNow: (module) => world.outsideNow?.(module) ?? null,
  };
}

/** The same, as endpoints of the agents' API (server/agent.ts): reading only, at every level. */
export function historyEndpoints(world: Partial<HistoryWorld>, refuseFull: (a: Ask) => Answer | null): AgentEndpoint[] {
  const w = historyWorld(world);
  const run = (a: Ask) => historyAnswer(w, a, refuseFull);
  return [
    {
      method: "GET", path: "/api/agent/history",
      about: "The snapshots of the graph (HistorySpec.md): one per build the server read, oldest first — when the build finished, the commit it was built from, how many declarations, what keeping it took, the renames found against the build before, and how many of its modules' source texts are kept (sources: kept of how many, places of them matched to the build by the places it recorded rather than by their Lake hash). The Time Machine's ticks.",
      params: {},
      returns: "{snapshots: [{id, at, approx?, read, fingerprint, commit: {hash, branch, dirty?, guessed?} | null, toolchain, missing, counts: {modules, nodes, edges, externals}, bytes: {new, all}, imported?, renames?: {high, medium}, sources?: {kept, of, places, bytes: {new, all}}}], current, diskBytes}",
      run,
    },
    {
      method: "GET", path: "/api/agent/history/graph",
      about: "One snapshot's graph, as the page reads the graph on show without its layouts: each project declaration with its statement, doc, place, version (hash, under the renames in force) and the kernel's hash it was read with; the outside declarations it refers to; the edges as one flat list. Large: 0.8 MB of JSON for 300 declarations, 14 MB for 8,000. A declaration's source text at that build: GET /api/agent/source?name=…&snapshot=<id>.",
      params: { id: "a snapshot's id (default: the latest build's)", part: "nodes: the same without its edges (and edgeCount), with sources (the modules whose text is kept, each lake or places), as the page takes it; edges: the edges alone, packed as /api/edges?pack=2 packs them (shared/edgecodec.ts); leave it out for the whole graph" },
      returns: "{snapshot, modules: [{name, imports}], nodes: [{name, kind, module, ax, type, doc?, range?, also?, flags?, hash, kernel?} | {name, kind, module, ax, ext: true}], projectCount, axioms, axiomSets, edges: [src, dst, sites, …]}",
      run,
    },
    {
      method: "GET", path: "/api/agent/history/diff",
      about: "What changed from one snapshot to another (the latest build's by default): the declarations added, removed, renamed, and changed (a new version, so a rename alone is not a change). What a module the later build could not read held is neither added nor removed.",
      params: { from: "a snapshot's id", to: "a snapshot's id (default: the latest build's)", most: "at most this many names per list (default 2000)" },
      returns: "{from, to, counts: {added, removed, changed, renamed}, added, removed, changed, renamed: [[was, is]]}",
      run,
    },
    {
      method: "GET", path: "/api/agent/history/moves",
      about: "The moves: every migration — a rename the server found and carried over by itself (auto), or a move a person or agent made (Attach to…) — with what it carried and whether it was undone; and the suggestions not acted on, renames of medium confidence whose old name is gone and new one is there.",
      params: {},
      returns: "{migrations: [{id, at, from, to, snap?, by, agent?, auto?, rename, review, carried: {opinions, targets, keys, notes, pins, scopes, reviewViews}, views: [{view, ops, scope?}], undone?: {by, agent?, at}}], suggestions: [{from, to, confidence: medium, why, score, snap}]}",
      run,
    },
    {
      method: "POST", path: "/api/agent/history/move", needs: "full",
      about: "Attach what was said of a declaration that is gone (from) to one in the graph (to): its opinions, target mark and key marks move in your review log, its pins, notes' mentions and views' scopes on the views. It says that to is from renamed where to was not there yet in the last build that had from. Recorded under your name, marked as an agent's; undone with /history/unmove.",
      params: { from: "a full name the graph no longer has", to: "a full name in the graph" },
      returns: "{ok, changed, migration?}",
      run,
    },
    {
      method: "POST", path: "/api/agent/history/unmove", needs: "full",
      about: "Undo a migration (GET /api/agent/history/moves lists them): an un-move in your review log takes back exactly what it carried, and its changes to the views are undone. Nothing is deleted.",
      params: { id: "a migration's id, m1, m2, …" },
      returns: "{ok, migration}",
      run,
    },
    {
      method: "GET", path: "/api/agent/history/lost",
      about: "The lost-and-found (HistorySpec decisions 12–14): what people and agents said and marked of declarations the graph no longer has, that no rename carried — opinions with their comments, target marks, key marks, pins on views, notes' mentions — by the name it is under, each name with the newest build that had it and the renames suggested for it; every migration, the server's and those made by hand, undone or not; and what is archived. Nothing in it is deleted: attach a name's entries to a declaration with /history/move, or archive an entry, which only hides it.",
      params: {},
      returns: "{lost: [{name, last: {name, snapshot, at, commit, module} | null, suggestions: [{to, score, why, snap}], entries: [{key, kind: opinion|target|key|pin|note, name, by, agent?, person?, at, verdict?, comment?, target?, member?, view?, title?, mode?, note?, text?}]}], migrations: [{key, id, at, from, to, by, auto?, rename, carried, undone?}], archived: [{key, line: {key, on, by, agent?, at}, entry? | migration?}], aside: {entries, modules}, count}",
      run,
    },
    {
      method: "GET", path: "/api/agent/history/last",
      about: "The newest build whose graph had a declaration of this name, and the module it was in there: where the Time Machine shows it. 404 where no build the history kept had it.",
      params: { name: "a full name" },
      returns: "{name, snapshot, at, approx?, commit, module}",
      run,
    },
    {
      method: "GET", path: "/api/agent/history/archive",
      about: "What is archived of the lost-and-found: each entry's or migration's key with the line that archived it (who, when). The lines are kept in the server's state, one per archiving or putting back; the last of a key is its state.",
      params: {},
      returns: "{archived: [{key, on: true, by, agent?, person?, at}]}",
      run,
    },
    {
      method: "POST", path: "/api/agent/history/archive", needs: "full",
      about: "Archive an entry of the lost-and-found, or a migration — it leaves the list, is kept, and shows under archived for everyone — or put it back (on: false). Nothing about the thing itself changes. Recorded under your name, marked as an agent's.",
      params: { key: "an entry's key, as /history/lost lists it (opinion:…, target:…, key:…, pin:…, note:…, move:m3) — or —", keys: `[keys], at most ${MAX_ARCHIVE_KEYS}`, on: "true (default): archive; false: put back" },
      returns: "{ok, changed, lines: [{key, on, by, agent, at}]}",
      run,
    },
  ];
}
