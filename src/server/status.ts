// The compilation status of every project file, read from the outside.
//
// What Lake leaves behind, as observed on Lake 4.33 (see docs/LAKE.md):
//   - a successful build writes Foo.olean and Foo.trace; the trace's `log` keeps the warnings,
//     `declaration uses 'sorry'` among them;
//   - a failed build deletes Foo.olean and leaves the previous Foo.trace untouched; the error
//     text is printed and not stored anywhere;
//   - modules downstream of a failure are not rebuilt and keep their old .olean;
//   - there is no build lock. A compile in progress is a `lean … -o <libDir>/Foo.olean` process;
//   - the trace records the hash of the source it was built from. Lake rebuilds when that hash
//     changes, not when the mtime does, so "stale" here compares the same hash (`lakeTextHash`).

import { execFile } from "node:child_process";
import { tracked } from "./children.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BuildStatus, FileState, FileStatus } from "../shared/build.ts";
import type { Project } from "./project.ts";

export type { BuildStatus, FileState, FileStatus };

const IMPORT_RE = /^\s*(?:public\s+|private\s+)?(?:meta\s+)?import\s+(?:all\s+)?([^\s-]+)/;

/** The imports in a file's header: everything up to the first line that is not blank, a
 *  comment, `module`, `prelude` or an import. */
export function parseImports(text: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of text.split("\n")) {
    // strip comments: block comments may span lines, line comments end the line
    let rest = raw;
    let code = "";
    while (rest) {
      if (inBlock) {
        const end = rest.indexOf("-/");
        if (end < 0) break;
        inBlock = false;
        rest = rest.slice(end + 2);
        continue;
      }
      const block = rest.indexOf("/-");
      const line = rest.indexOf("--");
      if (line >= 0 && (block < 0 || line < block)) {
        code += rest.slice(0, line);
        break;
      }
      if (block >= 0) {
        code += rest.slice(0, block);
        rest = rest.slice(block + 2);
        inBlock = true;
        continue;
      }
      code += rest;
      break;
    }
    const line = code.trim();
    if (!line || line === "module" || line === "prelude") continue;
    const m = IMPORT_RE.exec(line);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

export interface ModuleInfo {
  name: string;
  file: string;
  imports: string[];
}

/** Project modules reachable from the roots, by their source headers: this works even when the
 *  build is broken, which is when it matters. */
export function scanModules(p: Project): Map<string, ModuleInfo> {
  const mods = new Map<string, ModuleInfo>();
  const todo = [...p.roots];
  while (todo.length) {
    const name = todo.pop()!;
    if (mods.has(name)) continue;
    const file = p.files.get(name);
    if (!file) continue; // outside the project
    let imports: string[] = [];
    try {
      imports = parseImports(readFileSync(join(p.root, file), "utf8"));
    } catch {
      // deleted between the scan and now: it has no imports
    }
    const own = imports.filter((m) => p.files.has(m));
    mods.set(name, { name, file, imports: own });
    todo.push(...own);
  }
  return mods;
}

/** Modules a lean process is compiling right now, for this project's build directory: a process
 *  `lean <src> -o <libDir>/Foo.olean …` (docs/LAKE.md). Asked every second the server runs. */
export function compiling(p: Project): Promise<Set<string>> {
  const fromProc = commandsInProc();
  if (fromProc) return Promise.resolve(compiledBy(p, fromProc));
  return new Promise((resolve) => {
    tracked(
      execFile("ps", ["axo", "command"], { maxBuffer: 16 << 20 }, (err, stdout) => {
        if (err) return resolve(new Set());
        resolve(compiledBy(p, stdout.split("\n")));
      }),
    );
  });
}

/** The modules the command lines `cmds` compile into the project's build directory. */
function compiledBy(p: Project, cmds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const marker = ` -o ${p.libDir}/`;
  for (const line of cmds) {
    const at = line.indexOf(marker);
    if (at < 0) continue;
    const rest = line.slice(at + marker.length);
    const path = rest.slice(0, rest.indexOf(".olean"));
    if (path) out.add(path.split("/").join("."));
  }
  return out;
}

/** The processes /proc lists, by pid: when each was first seen, and its command line where it
 *  could be a compile (one with ` -o `), else "". */
const procs = new Map<number, { seen: number; cmd: string }>();
/** a process this young is read again: one forked a moment ago may not have run its program yet */
const YOUNG_MS = 2500;
/** whether /proc can be read here (Linux): null until tried */
let procOk: boolean | null = null;

/** The command lines of the processes running, from /proc, where there is one (Linux): a listing
 *  of it, and the command line of each process new since the last look, rather than `ps` every
 *  second — which read every process's files, in a process of its own, 1.5 % of a core with 600
 *  processes running. Null where there is no /proc. */
export function commandsInProc(now = Date.now()): string[] | null {
  if (procOk === false) return null;
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    procOk = false;
    return null;
  }
  const alive = new Set<number>();
  const cmds: string[] = [];
  for (const n of names) {
    const c = n.charCodeAt(0);
    if (c < 48 || c > 57) continue;
    const pid = Number(n);
    alive.add(pid);
    let e = procs.get(pid);
    if (!e || now - e.seen < YOUNG_MS) {
      let cmd = "";
      try {
        // NUL between its arguments, as ps prints them: spaces
        cmd = readFileSync(`/proc/${n}/cmdline`, "utf8").replace(/\0+$/, "").replaceAll("\0", " ");
      } catch {
        // gone meanwhile, or not ours to read
      }
      e = { seen: e?.seen ?? now, cmd: cmd.includes(" -o ") ? cmd : "" };
      procs.set(pid, e);
    }
    if (e.cmd) cmds.push(e.cmd);
  }
  for (const pid of procs.keys()) if (!alive.has(pid)) procs.delete(pid);
  if (procOk === null) procOk = alive.size > 0;
  return procOk ? cmds : null;
}

const M = 0xc6a4a7935bd1e995n;
const MASK = (1n << 64n) - 1n;

/** Lean's `String.hash`: MurmurHash64A over the UTF-8 bytes, seed 11. */
function murmur64(buf: Buffer, seed: bigint): bigint {
  let h = (seed ^ (BigInt(buf.length) * M)) & MASK;
  const n8 = buf.length & ~7;
  for (let i = 0; i < n8; i += 8) {
    let k = buf.readBigUInt64LE(i);
    k = (k * M) & MASK;
    k ^= k >> 47n;
    k = (k * M) & MASK;
    h ^= k;
    h = (h * M) & MASK;
  }
  const rem = buf.length & 7;
  if (rem) {
    for (let j = rem - 1; j >= 0; j--) h ^= BigInt(buf[n8 + j]) << BigInt(8 * j);
    h = (h * M) & MASK;
  }
  h ^= h >> 47n;
  h = (h * M) & MASK;
  h ^= h >> 47n;
  return h;
}

/** `lean_uint64_mix_hash` from lean.h. */
function mixHash(h: bigint, k: bigint): bigint {
  k = (k * M) & MASK;
  k ^= k >> 47n;
  k ^= M;
  h ^= k;
  return (h * M) & MASK;
}

/** Lake's `Hash.ofText`: line endings normalised, then `mixHash nil (hash s)` with nil = 1723. */
export function lakeTextHash(text: string): string {
  const h = mixHash(1723n, murmur64(Buffer.from(text.replace(/\r\n/g, "\n"), "utf8"), 11n));
  return h.toString(16).padStart(16, "0");
}

const srcHashCache = new Map<string, { key: string; hash: string }>();

/** The Lake hash of a source file, recomputed only when its mtime or size moves, and its mtime. */
function sourceHash(file: string): { hash: string; at: number } | null {
  try {
    const st = statSync(file, { throwIfNoEntry: false });
    if (!st) return null;
    const key = `${st.mtimeMs}:${st.size}`;
    const hit = srcHashCache.get(file);
    if (hit && hit.key === key) return { hash: hit.hash, at: st.mtimeMs };
    const hash = lakeTextHash(readFileSync(file, "utf8"));
    srcHashCache.set(file, { key, hash });
    return { hash, at: st.mtimeMs };
  } catch {
    return null;
  }
}

function mtime(f: string): number | null {
  try {
    return statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? null;
  } catch {
    return null;
  }
}

interface TraceInfo {
  warnings: number;
  sorry: boolean;
  /** the Lake hash of the source the last successful build compiled */
  builtFrom: string | null;
}

/** What a look finds of a module's files: its outputs' times, its source's time and Lake hash, and
 *  what its trace says. */
export interface Probe extends TraceInfo {
  olean: number | null;
  trace: number | null;
  /** the Lake hash of the source as it is now, and its time */
  source: string | null;
  sourceAt: number | null;
}

const traceCache = new Map<string, TraceInfo & { mtime: number }>();

function readTrace(file: string, at: number, source: string): TraceInfo {
  const hit = traceCache.get(file);
  if (hit && hit.mtime === at) return hit;
  const v = { mtime: at, warnings: 0, sorry: false, builtFrom: null as string | null };
  try {
    const t = JSON.parse(readFileSync(file, "utf8"));
    for (const e of (t.log ?? []) as { level: string; message: string }[]) {
      if (e.level === "warning" || e.level === "error") v.warnings++;
      if (/declaration uses '?`?sorry/.test(e.message)) v.sorry = true;
    }
    for (const inp of t.inputs ?? []) {
      if (Array.isArray(inp) && typeof inp[0] === "string" && inp[0].endsWith(source)) v.builtFrom = inp[1];
    }
  } catch {
    // a trace being written: read it next time
  }
  traceCache.set(file, v);
  return v;
}

function probe(p: Project, m: ModuleInfo): Probe {
  const base = join(p.libDir, ...m.name.split("."));
  const trace = mtime(base + ".trace");
  const t = trace !== null ? readTrace(base + ".trace", trace, "/" + m.file) : { warnings: 0, sorry: false, builtFrom: null };
  const src = sourceHash(join(p.root, m.file));
  return { olean: mtime(base + ".olean"), trace, source: src?.hash ?? null, sourceAt: src?.at ?? null, ...t };
}

/** A look at every module's files: three times each (its outputs', its source's), read once. */
export function probeAll(p: Project, mods: Map<string, ModuleInfo>): Map<string, Probe> {
  const out = new Map<string, Probe>();
  for (const m of mods.values()) out.set(m.name, probe(p, m));
  return out;
}

/** A fingerprint of what a look found of the outputs and the sources: an edit is not a build, but it
 *  changes what the status says. */
export function stampOf(probes: Map<string, Probe>): string {
  const parts: string[] = [];
  for (const [name, pr] of probes) parts.push(`${name}:${pr.olean}:${pr.trace}:${pr.sourceAt}`);
  return parts.join("|");
}

/** The same of the outputs alone: what a build wrote, which is all a followed branch's tree is read
 *  for (DeploySpec decision 5). */
export function outputsOf(probes: Map<string, Probe>): string {
  const parts: string[] = [];
  for (const [name, pr] of probes) parts.push(`${name}:${pr.olean}:${pr.trace}`);
  return parts.join("|");
}

/** The Lake hash of the text a module's present build was compiled from, if it has a build: what
 *  the graph says about the module's declarations (their places in the file among them) is about
 *  that text. */
export function compiledTextHash(p: Project, module: string, file: string): string | null {
  const base = join(p.libDir, ...module.split("."));
  const trace = mtime(base + ".trace");
  if (trace === null || mtime(base + ".olean") === null) return null;
  return readTrace(base + ".trace", trace, "/" + file).builtFrom;
}

export class BuildTracker {
  private p: Project;
  /** when outputs were last seen changing, to bridge the gaps between compile processes */
  private lastChange = 0;
  /** each module's outputs as last seen (outputsMoved), and when; null before the first look */
  private seen: Map<string, string> | null = null;
  private seenAt = 0;
  private buildStart = 0;
  private expected: Set<string> | null = null;

  constructor(p: Project) {
    this.p = p;
  }

  /** The status of every module: from a look at their files (`probes`, made now where not given)
   *  and the compiles running (`running`, asked now where not given). */
  async status(mods: Map<string, ModuleInfo>, probes: Map<string, Probe> = probeAll(this.p, mods), running?: Set<string>): Promise<BuildStatus> {
    const p = this.p;
    running ??= await compiling(p);
    // a module the look did not find (one the list gained since): looked at now
    for (const m of mods.values()) if (!probes.has(m.name)) probes.set(m.name, probe(p, m));
    const now = Date.now();
    if (this.outputsMoved(mods, now, probes)) this.lastChange = now;
    const active = running.size > 0 || now - this.lastChange < 2500;

    // own state first, then what imports say about it
    const own = new Map<string, FileState>();
    for (const m of mods.values()) {
      const pr = probes.get(m.name)!;
      if (running.has(m.name)) own.set(m.name, "building");
      else if (pr.olean === null) own.set(m.name, pr.trace !== null ? "failed" : "unbuilt");
      else if (pr.builtFrom !== null && pr.source !== null && pr.builtFrom !== pr.source) own.set(m.name, "stale");
      else own.set(m.name, pr.sorry ? "sorry" : "ok");
    }
    const broken = (s: FileState | undefined) => s === "failed" || s === "unbuilt";
    const changed = (s: FileState | undefined) => s === "stale" || s === "building";
    // a file is blocked by any broken file under it, and out of date if a file under it changed
    // since its own build: Lake will rebuild it once the one underneath is rebuilt
    const memo = new Map<string, { broken: Set<string>; changed: Set<string> }>();
    const below = (name: string, seen: Set<string>): { broken: Set<string>; changed: Set<string> } => {
      const hit = memo.get(name);
      if (hit) return hit;
      const out = { broken: new Set<string>(), changed: new Set<string>() };
      if (seen.has(name)) return out;
      seen.add(name);
      for (const i of mods.get(name)?.imports ?? []) {
        if (broken(own.get(i))) out.broken.add(i);
        if (changed(own.get(i))) out.changed.add(i);
        const sub = below(i, seen);
        for (const b of sub.broken) out.broken.add(b);
        for (const c of sub.changed) out.changed.add(c);
      }
      memo.set(name, out);
      return out;
    };

    const files: FileStatus[] = [];
    for (const m of mods.values()) {
      const pr = probes.get(m.name)!;
      let state = own.get(m.name)!;
      const under = below(m.name, new Set());
      let because: string[] | undefined;
      if (state === "ok" || state === "sorry" || state === "stale") {
        if (under.broken.size) {
          state = "blocked";
          because = [...under.broken].sort();
        } else if (under.changed.size && state !== "stale") {
          state = "stale";
          because = [...under.changed].sort();
        }
      }
      if (active && (state === "stale" || state === "blocked")) state = "queued";
      files.push({
        module: m.name,
        file: m.file,
        state,
        warnings: pr.warnings,
        ...(because ? { because } : {}),
        ...(pr.olean !== null ? { builtAt: Math.round(pr.olean) } : {}),
      });
    }

    // progress: when a build starts, remember what it has to do; count what it has done since
    let progress: BuildStatus["progress"] = null;
    if (active) {
      if (!this.expected) {
        this.buildStart = now - 3000;
        this.expected = new Set(files.filter((f) => f.state !== "ok" && f.state !== "sorry").map((f) => f.module));
      }
      for (const f of files) if (f.state === "building" || f.state === "queued") this.expected.add(f.module);
      let done = 0;
      for (const name of this.expected) {
        const o = probes.get(name)?.olean ?? 0;
        if (o >= this.buildStart && !running.has(name)) done++;
      }
      progress = { done, total: this.expected.size, current: [...running].sort() };
    } else {
      this.expected = null;
    }

    const counts = { ok: 0, sorry: 0, failed: 0, unbuilt: 0, building: 0, queued: 0, stale: 0, blocked: 0 } as Record<FileState, number>;
    for (const f of files) counts[f.state]++;
    return { active, progress, files, counts };
  }

  /** Whether the build's outputs moved since the last look: only outputs moving count as a build.
   *  An edit to a source is not one, nor a file the project gains or loses while nothing is written
   *  (an import added of a file not built yet, one taken out): a module new to the list moved only
   *  where what it has was written since the last look. The first look is no change. */
  private outputsMoved(mods: Map<string, ModuleInfo>, now: number, probes: Map<string, Probe>): boolean {
    const was = this.seen;
    const since = this.seenAt;
    const next = new Map<string, string>();
    let moved = false;
    for (const m of mods.values()) {
      const { olean, trace } = probes.get(m.name)!;
      const s = `${olean}:${trace}`;
      next.set(m.name, s);
      if (!was) continue;
      const before = was.get(m.name);
      if (before === undefined ? Math.max(olean ?? 0, trace ?? 0) > since : before !== s) moved = true;
    }
    this.seen = next;
    this.seenAt = now;
    return moved;
  }
}

/** The modules that can be imported right now: built, with everything under them built. */
export function importable(p: Project, mods: Map<string, ModuleInfo>): string[] {
  const ok = new Map<string, boolean>();
  const check = (name: string, seen: Set<string>): boolean => {
    const hit = ok.get(name);
    if (hit !== undefined) return hit;
    if (seen.has(name)) return true;
    seen.add(name);
    const has = existsSync(join(p.libDir, ...name.split(".")) + ".olean");
    const res = has && (mods.get(name)?.imports ?? []).every((i) => check(i, seen));
    ok.set(name, res);
    return res;
  };
  return [...mods.keys()].filter((m) => check(m, new Set()));
}
