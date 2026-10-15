// The history (HistorySpec.md, decided by the owner on 2026-10-09): a snapshot of the graph at every
// build the server reads, kept for good in `<site>/history/`, so that the page can show the
// project as it was at a build and say what changed since (the Time Machine), and so that the
// declarations that vanished from one build to the next can be paired with those that appeared
// (server/renames.ts).
//
// A snapshot is a manifest: when the build finished (the newest `.olean` of the project), the
// commit it was built from where the project is a git repository (read-only queries), and, per
// module, the content hash of what the extractor read from it. A module's content — its units with
// what a card shows of them, their versions' parts (TCBSpec decision 3) and the edges out of them,
// by name — is a file of its own named by that hash, so a module that did not change between two
// builds is stored once. The declarations outside the project the snapshot refers to are one such
// file too. What the usage pass found besides edges (contexts, proof spans) is not kept: it is for
// reading the source as it is now. The source text each module's build was compiled from is kept as
// git keeps it, a blob per text named by its SHA-256 (server/sourcestore.ts), and the manifest says
// which blob each module's is.
//
//   history/modules/<sha>.json.gz     one module's content, or a snapshot's outside declarations
//   history/sources/<sha256>.gz       one text of a project file (server/sourcestore.ts)
//   history/snapshots/<id>.json.gz    a snapshot's manifest: module → content hash, and module →
//                                     the text its build compiled (`sources`)
//   history/index.jsonl               one line per snapshot (SnapshotInfo), appended; the last line
//                                     of an id is what it is (a build read again supersedes)
//
// One build is one snapshot. The extractor's graph is served first and the usage pass's merged one
// after it; a server restarted, or a newer extractor, reads the same build again: each of these has
// the same build time, and replaces the snapshot's manifest rather than adding one. Nothing is ever
// deleted.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { GitSource, Kind, RawGraph, RawNode } from "../shared/graph.ts";
import type { Project } from "./project.ts";
import { SourceStore, summarize } from "./sourcestore.ts";
import type { ModuleShape, SourceMap, SourceRef, SourcesSummary } from "./sourcestore.ts";
import { ownName, refIdentity, versionOf } from "./versions.ts";
import type { Identity } from "./versions.ts";

/** A snapshot as the list of them tells it (GET /api/history). */
export interface SnapshotInfo {
  id: number;
  /** when its build finished: the newest `.olean` of the project; for one imported from an
   *  extraction made before the history, when that extraction was made, where no build since says
   *  better (`approx`) */
  at: string;
  approx?: true;
  /** when the server read it, last */
  read: string;
  /** the extraction it was taken from, last */
  fingerprint: string;
  /** the commit checked out when it was read, and whether `.lean` files differed from it (`dirty`);
   *  for an imported one the last commit before it was made (`guessed`) */
  commit: { hash: string; branch: string | null; dirty?: boolean; guessed?: true } | null;
  toolchain: string;
  /** modules the build had that could not be read (a failed file, or one on a failed file): their
   *  declarations are not gone, only not known at this build */
  missing: string[];
  counts: { modules: number; nodes: number; edges: number; externals: number };
  /** gzipped bytes: written for this snapshot (what no snapshot had), and of all its files */
  bytes: { new: number; all: number };
  /** made from an extraction found in the project's cache when the history began */
  imported?: true;
  /** the renames found against the snapshot before (server/renames.ts) */
  renames?: { high: number; medium: number };
  /** the source texts its build was compiled from, kept (server/sourcestore.ts): absent until they
   *  are, for a snapshot made before the history kept them and not backfilled yet */
  sources?: SourcesSummary;
}

/** A unit as a snapshot keeps it: what a card shows, the versions' parts, its axioms by name. */
export interface SnapNode {
  name: string;
  kind: Kind;
  module: string;
  type: string;
  ax: string[];
  /** the kernel's content hash (RawNode.hash) */
  hash: string;
  shape?: string;
  refs?: string[];
  doc?: string;
  range?: [number, number, number, number];
  also?: string[];
  flags?: string[];
  leanName?: string;
  display?: string;
  interprets?: string[];
  rules?: string[];
  gen?: string;
}

/** One module's content: its units in the extractor's order, and the edges out of them — the
 *  names they refer to, sorted, once each (`targets`), and per unit that refers to any, its place
 *  among the units then a target's place and the sites, for each (`out`; a third smaller than
 *  writing each edge out). */
interface ModuleRecord {
  module: string;
  imports: string[];
  nodes: SnapNode[];
  targets: string[];
  out: number[][];
}

interface ExternalRecord {
  name: string;
  kind: Kind;
  module: string;
  ax: string[];
}

interface Manifest {
  id: number;
  /** module → its content's hash */
  modules: Record<string, string>;
  /** the outside declarations' file */
  externals: string;
  /** module → the text its build was compiled from (server/sourcestore.ts); absent from a manifest
   *  written before the history kept texts, until the backfill gives it one */
  sources?: SourceMap;
}

/** A snapshot's graph, as the history API serves it and the renames compare it. */
export interface SnapGraph {
  info: SnapshotInfo;
  modules: { name: string; imports: string[] }[];
  /** the project's units, then the outside declarations (`ext`) */
  nodes: (SnapNode & { ext?: true })[];
  projectCount: number;
  /** [src, dst, sites], indices into nodes */
  edges: [number, number, number][];
}

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** When the project's build finished: its newest `.olean`, in ms; 0 where there is none. */
export function buildTime(p: Project): number {
  let newest = 0;
  const walk = (dir: string) => {
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const f = join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(".olean")) newest = Math.max(newest, statSync(f).mtimeMs);
    }
  };
  walk(p.libDir);
  return newest;
}

/** Git, read-only and taking no lock: its answer, or null where git or the repository is not there. */
function git(root: string, ...args: string[]): string | null {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "ignore"] });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The commit checked out now, and whether a `.lean` file differs from it. */
export function commitNow(root: string): SnapshotInfo["commit"] {
  const hash = git(root, "rev-parse", "HEAD");
  if (!hash || !/^[0-9a-f]{7,64}$/.test(hash)) return null;
  const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD");
  const status = git(root, "status", "--porcelain", "--untracked-files=no", "--", "*.lean");
  return { hash, branch: branch && branch !== "HEAD" ? branch : null, ...(status ? { dirty: true } : {}) };
}

/** The project's git source and the commit checked out, as a page may show them (an artwork's foot,
 *  ExportSpec decision 19): the remote's address (`origin`, else the first) with no user name or
 *  password (sourceAddress); null where the project is not a git repository. Read-only, as `git`. */
export function gitSource(root: string): GitSource | null {
  const c = commitNow(root);
  if (!c) return null;
  const remotes = (git(root, "remote") ?? "").split("\n").filter(Boolean);
  const name = remotes.includes("origin") ? "origin" : remotes[0];
  const url = name ? git(root, "remote", "get-url", name) : null;
  return { source: url ? sourceAddress(url) : null, commit: c.hash, branch: c.branch, ...(c.dirty ? { dirty: true as const } : {}) };
}

/** A remote's address as a page shows it: its host and path, without the scheme, a user name, a
 *  password, a port or `.git` — `git@github.com:A/B.git` and `https://user:token@github.com/A/B`
 *  both read `github.com/A/B`. Null for a path on this machine, or what is no address. */
export function sourceAddress(url: string): string | null {
  const u = url.trim();
  let host: string, path: string;
  // scp-like, [user@]host:path, but not a Windows drive
  const scp = /^(?:[^@/\s]+@)?([A-Za-z0-9.-]+):(?!\/\/)(\S+)$/.exec(u);
  if (scp && !/^[A-Za-z]:[\\/]/.test(u)) [host, path] = [scp[1], scp[2]];
  else {
    let p: URL;
    try {
      p = new URL(u);
    } catch {
      return null;
    }
    if (!["https:", "http:", "ssh:", "git:"].includes(p.protocol) || !p.hostname) return null;
    [host, path] = [p.hostname, decodeURIComponent(p.pathname)];
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !path || !/^[\w.~/-]+$/.test(path)) return null;
  return `${host}/${path}`;
}

/** The last commit made before `at`: what an imported extraction was probably built from. */
function commitBefore(root: string, at: string): SnapshotInfo["commit"] {
  const hash = git(root, "log", "-1", "--format=%H", `--before=${at}`);
  return hash && /^[0-9a-f]{7,64}$/.test(hash) ? { hash, branch: null, guessed: true } : null;
}

/** An extraction whose names are not all its own (made before every unit had one, TCBSpec
 *  "Names"): a unit given twice, with the same place, is kept once and the edges of both are its;
 *  units of different modules that share a name are qualified with their modules' last parts, as
 *  local notation now is, and any name still shared is numbered. */
export function uniqueNames(g: RawGraph): RawGraph {
  const groups = new Map<string, number[]>();
  g.nodes.forEach((n, i) => groups.set(n.name, [...(groups.get(n.name) ?? []), i]));
  if (groups.size === g.nodes.length) return g;
  const same = new Map<number, number>();
  const names = g.nodes.map((n) => n.name);
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const kept: number[] = [];
    for (const i of idx) {
      const twin = kept.find((k) => g.nodes[k].module === g.nodes[i].module && JSON.stringify(g.nodes[k].range) === JSON.stringify(g.nodes[i].range));
      if (twin !== undefined) same.set(i, twin);
      else kept.push(i);
    }
    if (kept.length > 1) for (const k of kept) names[k] = `${g.nodes[k].name}.${g.nodes[k].module.split(".").pop()}`;
  }
  const taken = new Set<string>();
  const keep: number[] = [];
  const at = new Map<number, number>();
  g.nodes.forEach((_, i) => {
    if (same.has(i)) return;
    let nm = names[i];
    for (let k = 2; taken.has(nm); k++) nm = `${names[i]}_${k}`;
    taken.add(nm);
    names[i] = nm;
    at.set(i, keep.length);
    keep.push(i);
  });
  for (const [i, twin] of same) at.set(i, at.get(twin)!);
  const n = g.nodes.length;
  const to = (d: number) => (d < n ? at.get(d)! : keep.length + (d - n));
  const sites = new Map<string, number>();
  for (const [s, d, m] of g.edges) {
    const key = `${to(s)},${to(d)}`;
    sites.set(key, (sites.get(key) ?? 0) | m);
  }
  return {
    ...g,
    nodes: keep.map((i) => ({ ...g.nodes[i], name: names[i] })),
    edges: [...sites].map(([k, m]) => [...k.split(",").map(Number), m] as [number, number, number]),
  };
}

/** One module's content and the outside declarations, from an extraction. */
function records(g: RawGraph): { modules: ModuleRecord[]; externals: ExternalRecord[]; edges: number } {
  const axNames = (k: number) => (g.axiomSets[k] ?? []).map((a) => g.axioms[a]);
  const n = g.nodes.length;
  const nameOf = (d: number) => (d < n ? g.nodes[d].name : g.externals[d - n].name);
  const byModule = new Map<string, ModuleRecord>();
  const edgesOf = new Map<string, [number, string, number][]>();
  for (const m of g.modules) byModule.set(m.name, { module: m.name, imports: [...m.imports].sort(), nodes: [], targets: [], out: [] });
  const local = new Int32Array(n);
  g.nodes.forEach((v, i) => {
    let r = byModule.get(v.module);
    if (!r) byModule.set(v.module, (r = { module: v.module, imports: [], nodes: [], targets: [], out: [] }));
    local[i] = r.nodes.length;
    r.nodes.push(snapNode(v, g, axNames(v.ax)));
  });
  let edges = 0;
  for (const [s, d, m] of g.edges) {
    if (s >= n) continue;
    const mod = g.nodes[s].module;
    let es = edgesOf.get(mod);
    if (!es) edgesOf.set(mod, (es = []));
    es.push([local[s], nameOf(d), m]);
    edges++;
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  for (const [mod, es] of edgesOf) {
    const r = byModule.get(mod)!;
    es.sort((a, b) => a[0] - b[0] || cmp(a[1], b[1]) || a[2] - b[2]);
    r.targets = [...new Set(es.map((e) => e[1]))].sort(cmp);
    const at = new Map(r.targets.map((t, k) => [t, k]));
    for (const [src, dst, m] of es) {
      const last = r.out[r.out.length - 1];
      if (last && last[0] === src) last.push(at.get(dst)!, m);
      else r.out.push([src, at.get(dst)!, m]);
    }
  }
  const externals = g.externals.map((e) => ({ name: e.name, kind: e.kind, module: e.module, ax: axNames(e.ax) })).sort((a, b) => (a.name < b.name ? -1 : 1));
  return { modules: [...byModule.values()].sort((a, b) => (a.module < b.module ? -1 : 1)), externals, edges };
}

function snapNode(v: RawNode, g: RawGraph, ax: string[]): SnapNode {
  const s: SnapNode = { name: v.name, kind: v.kind, module: v.module, type: v.type, ax, hash: v.hash };
  if (v.shape && v.refs && g.refNames) {
    s.shape = v.shape;
    s.refs = v.refs.map((k) => g.refNames![k]);
  }
  if (v.doc) s.doc = v.doc;
  if (v.range) s.range = v.range;
  if (v.also?.length) s.also = v.also;
  if (v.flags?.length) s.flags = v.flags;
  if (v.leanName) s.leanName = v.leanName;
  if (v.display) s.display = v.display;
  if (v.interprets?.length) s.interprets = v.interprets;
  if (v.rules?.length) s.rules = v.rules;
  if (v.gen !== undefined) s.gen = v.gen;
  return s;
}

/** A snapshot node's version under `identity` (TCBSpec decision 3): from its shape where it has
 *  one, else the kernel's hash it was read with. */
export function snapVersion(v: SnapNode, identity: Identity = ownName): string {
  return v.shape && v.refs ? versionOf(v.shape, v.refs.map((r) => refIdentity(r, identity))) : v.hash;
}

export class History {
  readonly dir: string;
  private modDir: string;
  private snapDir: string;
  private indexFile: string;
  /** every snapshot, by id, as the index last says it */
  private infos = new Map<number, SnapshotInfo>();
  /** module files known to be on disk, and their gzipped sizes */
  private sizes = new Map<string, number>();
  /** snapshot graphs read lately (the Time Machine asks for a few, the renames for the last) */
  private cache = new Map<number, SnapGraph>();
  /** the extractions each snapshot was read from, every one: what the backfill of its texts looks
   *  for the views of (server/sourcestore.ts) */
  private reads = new Map<number, Set<string>>();
  /** the source texts' blobs (server/sourcestore.ts) */
  readonly sources: SourceStore;
  /** the texts each snapshot's manifest lists, as read last (null: none yet) */
  private texts = new Map<number, SourceMap | null>();

  constructor(siteDir: string) {
    this.dir = join(siteDir, "history");
    this.modDir = join(this.dir, "modules");
    this.snapDir = join(this.dir, "snapshots");
    this.indexFile = join(this.dir, "index.jsonl");
    this.sources = new SourceStore(this.dir);
    if (existsSync(this.indexFile)) {
      for (const line of readFileSync(this.indexFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const s = JSON.parse(line) as SnapshotInfo;
          if (Number.isInteger(s.id)) this.infos.set(s.id, s);
          if (Number.isInteger(s.id) && s.fingerprint) this.readOf(s.id).add(s.fingerprint);
        } catch {
          // a line cut short (the server stopped while writing): its snapshot is read again later
        }
      }
    }
  }

  private readOf(id: number): Set<string> {
    let r = this.reads.get(id);
    if (!r) this.reads.set(id, (r = new Set()));
    return r;
  }

  get empty(): boolean {
    return this.infos.size === 0;
  }

  /** Every snapshot, oldest build first. */
  list(): SnapshotInfo[] {
    return [...this.infos.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
  }

  get(id: number): SnapshotInfo | null {
    return this.infos.get(id) ?? null;
  }

  /** The latest build's snapshot. */
  latest(): SnapshotInfo | null {
    const l = this.list();
    return l.length ? l[l.length - 1] : null;
  }

  /** What the history holds on disk, in bytes. */
  diskBytes(): number {
    let total = 0;
    for (const d of [this.modDir, this.snapDir, this.sources.dir]) {
      try {
        for (const f of readdirSync(d)) total += statSync(join(d, f)).size;
      } catch {
        // nothing there yet
      }
    }
    try {
      total += statSync(this.indexFile).size;
    } catch {
      // nothing there yet
    }
    return total;
  }

  /** Keep a snapshot of an extraction: a new one for a new build, or the build's own again (the
   *  merged graph after the extractor's, a newer extractor, a restart), its manifest replaced and
   *  the one before kept beside it. A read of a build that holds fewer modules than the snapshot of
   *  it (part of the sources changed since the build, so that some modules could not be imported)
   *  changes nothing. The snapshot; whether it is a new build; and the graph the history had last
   *  for what this one follows — the build's own before it was read again, else the latest build's —
   *  which the renames are found against. `sources` finds the texts the build was compiled from, as
   *  they are at this reading (server/sourcestore.ts, `keepSources`), and the bytes their blobs
   *  written now took: asked only where the snapshot is written; a build read again keeps the text
   *  it was found to have before for a module whose file was edited since, its Lake hash being the
   *  same. */
  record(g: RawGraph, o: { at: number; fingerprint: string; commit: SnapshotInfo["commit"]; toolchain: string; missing: string[]; imported?: boolean; approx?: boolean; read?: string; sources?: () => { map: SourceMap; written: number } }): { info: SnapshotInfo; fresh: boolean; written: boolean; before: SnapGraph | null } {
    mkdirSync(this.modDir, { recursive: true });
    mkdirSync(this.snapDir, { recursive: true });
    const at = new Date(o.at).toISOString();
    const same = [...this.infos.values()].find((s) => s.at === at);
    const prior = same ?? this.list().filter((s) => s.at < at).pop() ?? null;
    if (same && (same.fingerprint === o.fingerprint || g.modules.length < same.counts.modules)) return { info: same, fresh: false, written: false, before: null };
    const before = prior ? this.graph(prior.id) : null;
    const id = same?.id ?? Math.max(0, ...this.infos.keys()) + 1;
    const { modules, externals, edges } = records(uniqueNames(g));
    let fresh = 0;
    let all = 0;
    const put = (content: string): string => {
      const h = sha(content);
      let size = this.sizes.get(h);
      if (size === undefined) {
        const f = join(this.modDir, `${h}.json.gz`);
        if (existsSync(f)) size = statSync(f).size;
        else {
          const gz = gzipSync(content);
          writeFileSync(`${f}.tmp`, gz);
          renameSync(`${f}.tmp`, f);
          size = gz.length;
          fresh += size;
        }
        this.sizes.set(h, size);
      }
      all += size;
      return h;
    };
    const manifest: Manifest = { id, modules: {}, externals: put(JSON.stringify({ externals })) };
    for (const r of modules) manifest.modules[r.module] = put(JSON.stringify(r));
    // the texts: as found at this reading, with those found when the build was read before; a
    // reading that looked for none keeps those
    const was = same ? this.sourcesOf(same.id) : null;
    let texts: SourcesSummary | undefined;
    if (o.sources) {
      const found = o.sources();
      manifest.sources = carried(found.map, was);
      const s = summarize(manifest.sources, this.sources, found.written);
      texts = { ...s, bytes: { ...s.bytes, new: (same?.sources?.bytes.new ?? 0) + found.written } };
    } else if (was) {
      manifest.sources = was;
      texts = same?.sources;
    }
    const mf = join(this.snapDir, `${id}.json.gz`);
    // the build read before: its manifest stays, named by the extraction it was taken from
    if (same && existsSync(mf)) renameSync(mf, join(this.snapDir, `${id}-${same.fingerprint}.json.gz`));
    writeFileSync(`${mf}.tmp`, gzipSync(JSON.stringify(manifest)));
    renameSync(`${mf}.tmp`, mf);
    const info: SnapshotInfo = {
      id,
      at,
      ...(o.approx ? { approx: true as const } : {}),
      read: o.read ?? new Date().toISOString(),
      fingerprint: o.fingerprint,
      commit: o.commit,
      toolchain: o.toolchain,
      missing: [...o.missing].sort(),
      counts: { modules: modules.length, nodes: g.nodes.length, edges, externals: externals.length },
      // a build read again keeps what it wrote the first time, and adds what it writes now
      bytes: { new: (same?.bytes.new ?? 0) + fresh, all },
      ...(o.imported || same?.imported ? { imported: true as const } : {}),
      ...(same?.renames ? { renames: same.renames } : {}),
      ...(texts ? { sources: texts } : {}),
    };
    this.save(info);
    this.readOf(id).add(o.fingerprint);
    this.texts.delete(id);
    this.cache.delete(id);
    // what was looked for and not found may be in this one
    for (const [k, v] of this.found) if (v === null) this.found.delete(k);
    this.holders = null;
    this.index(manifest);
    return { info, fresh: !same, written: true, before };
  }

  /** Say more of a snapshot (the renames found against the one before, its texts backfilled). */
  annotate(id: number, more: Partial<Pick<SnapshotInfo, "renames" | "sources">>): void {
    const s = this.infos.get(id);
    if (s) this.save({ ...s, ...more });
  }

  /** The texts snapshot `id`'s build was compiled from, as its manifest lists them; null where it
   *  lists none (made before the history kept texts, and not backfilled yet), or there is no such
   *  snapshot. */
  sourcesOf(id: number): SourceMap | null {
    if (!this.infos.has(id)) return null;
    if (!this.texts.has(id)) this.texts.set(id, this.manifest(id)?.sources ?? null);
    return this.texts.get(id)!;
  }

  /** Give snapshot `id`'s manifest the texts its build was compiled from (the backfill, which wrote
   *  `written` gzipped bytes of blobs for them): the manifest is written again with them and
   *  nothing else changed, and its line in the index says how complete they are. A manifest that
   *  has texts already keeps them (a reading of the build kept them meanwhile): false. */
  setSources(id: number, map: SourceMap, written: number): boolean {
    const m = this.manifest(id);
    if (!m || m.sources) return false;
    m.sources = map;
    const mf = join(this.snapDir, `${id}.json.gz`);
    writeFileSync(`${mf}.tmp`, gzipSync(JSON.stringify(m)));
    renameSync(`${mf}.tmp`, mf);
    this.texts.set(id, map);
    this.annotate(id, { sources: summarize(map, this.sources, written) });
    return true;
  }

  /** Module `module`'s text at snapshot `id`'s build: what the manifest says of it, and the text
   *  where one is kept; null where the manifest says nothing of the module. */
  textOf(id: number, module: string): { ref: SourceRef; text: string | null } | null {
    const map = this.sourcesOf(id);
    const ref = map && Object.hasOwn(map, module) ? map[module] : null;
    if (!ref) return null;
    const text = ref.blob ? this.sources.text(ref.blob) : null;
    return { ref: ref.blob && text === null ? { ...ref, blob: undefined, why: "its kept text cannot be read" } : ref, text };
  }

  /** The modules snapshot `id` holds. */
  modulesOf(id: number): string[] {
    return Object.keys(this.manifest(id)?.modules ?? {}).sort();
  }

  /** What snapshot `id` recorded of module `module` that a text compiled into it must agree with:
   *  its project imports, and its declarations' names, kinds, ranges and docs; null where it has
   *  no such module. */
  moduleShape(id: number, module: string): ModuleShape | null {
    const h = this.manifest(id)?.modules[module];
    if (!h) return null;
    const r = this.readGz<ModuleRecord>(join(this.modDir, `${h}.json.gz`));
    return { imports: r.imports, nodes: r.nodes };
  }

  /** The extractions snapshot `id` was read from, the first first. */
  readsOf(id: number): string[] {
    return [...(this.reads.get(id) ?? [])];
  }

  private save(info: SnapshotInfo): void {
    this.infos.set(info.id, info);
    appendFileSync(this.indexFile, JSON.stringify(info) + "\n");
  }

  private readGz<T>(file: string): T {
    return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as T;
  }

  /** A snapshot's graph; null where there is no such snapshot. */
  graph(id: number): SnapGraph | null {
    const info = this.infos.get(id);
    if (!info) return null;
    const hit = this.cache.get(id);
    if (hit) {
      // most recently used last: the cache keeps a few
      this.cache.delete(id);
      this.cache.set(id, hit);
      return hit;
    }
    const m = this.readGz<Manifest>(join(this.snapDir, `${id}.json.gz`));
    const recs = Object.values(m.modules).map((h) => this.readGz<ModuleRecord>(join(this.modDir, `${h}.json.gz`)));
    const { externals } = this.readGz<{ externals: ExternalRecord[] }>(join(this.modDir, `${m.externals}.json.gz`));
    const nodes: SnapGraph["nodes"] = [];
    const starts: number[] = [];
    for (const r of recs) {
      starts.push(nodes.length);
      nodes.push(...r.nodes);
    }
    const projectCount = nodes.length;
    for (const e of externals) nodes.push({ name: e.name, kind: e.kind, module: e.module, type: "", ax: e.ax, hash: "", ext: true });
    const index = new Map(nodes.map((v, i) => [v.name, i]));
    const edges: [number, number, number][] = [];
    recs.forEach((r, k) => {
      const to = r.targets.map((t) => index.get(t));
      for (const row of r.out)
        for (let j = 1; j + 1 < row.length; j += 2) {
          const d = to[row[j]];
          if (d !== undefined) edges.push([starts[k] + row[0], d, row[j + 1]]);
        }
    });
    const g: SnapGraph = { info, modules: recs.map((r) => ({ name: r.module, imports: r.imports })), nodes, projectCount, edges };
    this.cache.set(id, g);
    while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!);
    return g;
  }

  /** The version, under `identity`, of the content declaration `name` had where its kernel's hash
   *  was `kernel`, in some snapshot whose units have their versions' parts (server/versions.ts,
   *  `rebinder`); null where none has it. */
  versionOfKernel(name: string, kernel: string, identity: Identity): string | null {
    const key = `${name}\0${kernel}`;
    let v = this.found.get(key);
    if (v === undefined) {
      v = null;
      for (const h of this.blobsOf(name)) {
        const r = this.readGz<ModuleRecord>(join(this.modDir, `${h}.json.gz`));
        const x = r.nodes.find((n) => n.name === name && n.hash === kernel && n.shape);
        if (x) {
          v = x;
          break;
        }
      }
      this.found.set(key, v);
    }
    return v ? snapVersion(v, identity) : null;
  }

  /** The newest build whose snapshot has a declaration named `name`, and the module it was in there
   *  (the lost-and-found's Show in history): found from the module files that hold the name
   *  (`blobsOf`) and the manifests that list them, without reading a graph. Null where no snapshot
   *  has it: it went before the history began, or was never a declaration. */
  lastHad(name: string): { id: number; module: string } | null {
    const blobs = this.blobsOf(name);
    if (!blobs.length) return null;
    if (!this.holders) {
      // each snapshot's manifest as it is now: a build read again lists the files of its last read
      this.holders = new Map();
      for (const s of this.infos.values())
        for (const [module, h] of Object.entries(this.manifest(s.id)?.modules ?? {})) {
          const at = this.holders.get(h);
          if (at) at.push({ id: s.id, module });
          else this.holders.set(h, [{ id: s.id, module }]);
        }
    }
    let best: { info: SnapshotInfo; module: string } | null = null;
    for (const h of blobs)
      for (const { id, module } of this.holders.get(h) ?? []) {
        const info = this.infos.get(id)!;
        if (!best || info.at > best.info.at || (info.at === best.info.at && info.id > best.info.id)) best = { info, module };
      }
    return best ? { id: best.info.id, module: best.module } : null;
  }

  /** Whether snapshot `id`'s build had a declaration named `name`: as `lastHad` finds it, without
   *  reading a graph. */
  hadAt(name: string, id: number): boolean {
    this.lastHad(name);
    return this.blobsOf(name).some((h) => this.holders?.get(h)?.some((x) => x.id === id));
  }

  /** which snapshots list each module file, and as which module: made when first asked, again
   *  after a snapshot is written */
  private holders: Map<string, { id: number; module: string }[]> | null = null;

  /** what `versionOfKernel` found, by name and kernel's hash (null: nothing, until the next snapshot) */
  private found = new Map<string, SnapNode | null>();
  /** which module files hold a declaration of each name: read once, when first asked */
  private names: Map<string, string[]> | null = null;

  private blobsOf(name: string): string[] {
    if (!this.names) {
      this.names = new Map();
      for (const s of this.infos.values()) this.index(this.manifest(s.id));
    }
    return this.names.get(name) ?? [];
  }

  private manifest(id: number): Manifest | null {
    try {
      return this.readGz<Manifest>(join(this.snapDir, `${id}.json.gz`));
    } catch {
      return null;
    }
  }

  private indexed = new Set<string>();

  private index(m: Manifest | null): void {
    if (!m || !this.names) return;
    for (const h of Object.values(m.modules)) {
      if (this.indexed.has(h)) continue;
      this.indexed.add(h);
      for (const n of this.readGz<ModuleRecord>(join(this.modDir, `${h}.json.gz`)).nodes) {
        const at = this.names.get(n.name);
        if (at) at.push(h);
        else this.names.set(n.name, [h]);
      }
    }
  }

  /** Make the first snapshots from the extractions the project's cache holds from before the history
   *  (`<cache>/extract/`): one per build. The extractor's graph and the usage pass's merged one of
   *  a build hold the same declarations and were made within moments: the merged one is kept. A
   *  build's time is when its extraction was made, unless no `.olean` changed since — then the
   *  build is the one there now, and its time is known. How many snapshots were made. */
  importExtractions(dir: string, p: Project, log: (l: string) => void): number {
    let files: { f: string; t: number }[] = [];
    try {
      files = readdirSync(dir)
        .filter((f) => /^[0-9a-f]{16}\.json$/.test(f))
        .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => a.t - b.t);
    } catch {
      return 0;
    }
    const built = buildTime(p);
    // one entry per build: consecutive extractions of the same declarations within two minutes
    const builds: { t: number; f: string; g: RawGraph; key: string }[] = [];
    for (const { f, t } of files) {
      let g: RawGraph;
      try {
        g = JSON.parse(readFileSync(join(dir, f), "utf8")) as RawGraph;
      } catch {
        continue;
      }
      const key = sha(g.nodes.map((n) => n.name).sort().join("\n"));
      const last = builds[builds.length - 1];
      if (last && last.key === key && t - last.t < 120_000) {
        if (g.usage && !last.g.usage) builds[builds.length - 1] = { t: last.t, f, g, key };
        continue;
      }
      builds.push({ t, f, g, key });
    }
    let made = 0;
    let before = new Set<string>();
    for (const b of builds) {
      // no build since this extraction: it read the build there now
      const exact = built > 0 && built <= b.t;
      const at = exact ? built : b.t;
      const iso = new Date(b.t).toISOString();
      // a module the build before had, which is built now, and which this one lacks, could not be
      // read then (a file failed, or was being written): its declarations did not go
      const have = new Set(b.g.modules.map((m) => m.name));
      const missing = [...before].filter((m) => !have.has(m) && existsSync(join(p.libDir, ...m.split(".")) + ".olean"));
      before = new Set([...have, ...missing]);
      const r = this.record(b.g, {
        at,
        fingerprint: b.f.slice(0, 16),
        commit: commitBefore(p.root, iso),
        toolchain: p.toolchain,
        missing,
        imported: true,
        approx: !exact,
        read: iso,
      });
      if (!r.written) {
        log(`history: ${b.f} read the build of snapshot ${r.info.id} again, with fewer modules: left as it is`);
        continue;
      }
      log(`history: imported ${b.f} as snapshot ${r.info.id} (${r.info.counts.nodes} declarations, ${(r.info.bytes.all / 1024).toFixed(0)} KB)`);
      made++;
    }
    return made;
  }
}

/** What changed from one snapshot's graph to another's (the Time Machine's summary against now):
 *  the project's declarations added, removed, renamed (`renamed`: a name of `a` → its name in `b`,
 *  the renames recorded between them) and changed — a new version, under `identity`, of the same
 *  declaration. Two contents are compared by their versions where both have their parts, else by
 *  the kernel's hashes; what `a`'s refers to is read under its names in `b` first, so that a rename
 *  of it is no change, also one the renames in force do not hold (a rename that touched nothing
 *  said is recorded in the history alone, HistorySpec decision 10). What a module the later build
 *  could not read (`missing`) held is neither removed nor added: it is not known there. Each list
 *  sorted, at most `most` names; the counts are whole. */
export function diffGraphs(a: SnapGraph, b: SnapGraph, identity: Identity, renamed: ReadonlyMap<string, string> = new Map(), most = 2000) {
  const inB = new Map<string, SnapNode>();
  for (let i = 0; i < b.projectCount; i++) inB.set(b.nodes[i].name, b.nodes[i]);
  const unknownB = new Set(b.info.missing);
  const unknownA = new Set(a.info.missing);
  const added: string[] = [], removed: string[] = [], changed: string[] = [], moves: [string, string][] = [];
  const reached = new Set<string>();
  const before: Identity = renamed.size ? (u) => identity(renamed.get(u) ?? u) : identity;
  const same = (x: SnapNode, y: SnapNode) => (x.shape && y.shape ? snapVersion(x, before) === snapVersion(y, identity) : x.hash === y.hash);
  for (let i = 0; i < a.projectCount; i++) {
    const x = a.nodes[i];
    const to = renamed.get(x.name) ?? x.name;
    const y = inB.get(to);
    if (!y) {
      if (!unknownB.has(x.module)) removed.push(x.name);
      continue;
    }
    reached.add(to);
    if (to !== x.name) moves.push([x.name, to]);
    if (!same(x, y)) changed.push(to);
  }
  for (const [name, y] of inB) if (!reached.has(name) && !unknownA.has(y.module)) added.push(name);
  const cut = <T>(xs: T[]) => xs.slice(0, most);
  const byName = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return {
    counts: { added: added.length, removed: removed.length, changed: changed.length, renamed: moves.length },
    added: cut(added.sort(byName)),
    removed: cut(removed.sort(byName)),
    changed: cut(changed.sort(byName)),
    renamed: cut(moves.sort((p, q) => byName(p[0], q[0]))),
  };
}

/** A snapshot's graph as a page reads it: the shape of the graph on show (ViewMeta) without its
 *  layouts — modules, nodes (each project node's `hash` its version under `identity`, `kernel` the
 *  kernel's hash it was read with), axioms and their sets — and its edges as one flat list of
 *  [src, dst, sites] triples. */
export function pageGraph(g: SnapGraph, identity: Identity) {
  const axioms: string[] = [];
  const axIdx = new Map<string, number>();
  const sets: number[][] = [];
  const setIdx = new Map<string, number>();
  const axOf = (names: string[]) => {
    const ids = names.map((a) => axIdx.get(a) ?? (axIdx.set(a, axioms.length), axioms.push(a) - 1)).sort((x, y) => x - y);
    const key = ids.join(",");
    let k = setIdx.get(key);
    if (k === undefined) setIdx.set(key, (k = sets.push(ids) - 1));
    return k;
  };
  const nodes = g.nodes.map((v) => {
    if (v.ext) return { name: v.name, kind: v.kind, module: v.module, ax: axOf(v.ax), ext: true as const };
    const { ax, hash, shape: _s, refs: _r, ...rest } = v;
    return { ...rest, ax: axOf(ax), hash: snapVersion(v, identity), ...(v.shape ? { kernel: hash } : {}) };
  });
  return { snapshot: g.info, modules: g.modules, nodes, projectCount: g.projectCount, axioms, axiomSets: sets, edges: g.edges.flat() };
}

/** The texts a build read again was found to have now (`map`), and what was found when it was read
 *  before (`was`): where a module's file was edited since, the text found before is still the
 *  build's, its Lake hash being the same; the rest is as found now. */
function carried(map: SourceMap, was: SourceMap | null): SourceMap {
  if (!was) return map;
  const out: SourceMap = { ...map };
  for (const [m, r] of Object.entries(map)) {
    const w = Object.hasOwn(was, m) ? was[m] : null;
    if (!r.blob && w?.blob && w.lake && w.lake === r.lake) out[m] = w;
  }
  return out;
}
