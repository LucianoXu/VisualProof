// The usage pass (TCBSpec.md, decisions 2 and 4): every module of the graph elaborated once more,
// under exactly its imports and with its proofs left out (extractor/Usage.lean), to find which
// notation each command is written in and the context it is written in, as the elaborator has
// them. Its findings are merged into the extractor's graph: edges from each unit to the notation
// units its text uses — the macros and elaborators that interpret it, in the TCB, and the grammar,
// outside it (SITE_GRAMMAR) — edges between notation units where one's expansion emits another,
// and the contexts.
//
// The pass also records where the proofs inside definitions' bodies are (`proofs`, per command,
// then per unit): the exported document cuts them (ExportSpec decision 8).
//
// One process per module: a process cannot import twice. `jobs` run at once; import is bound by
// memory bandwidth, and each worker holds hundreds of MB of its own besides the `.olean` files they
// all map (on Sphere-Packing-Lean about 150 MB of its own, 1.2 to 1.6 GB resident with them). A module's result is cached in the
// project's cache directory under a key
// made of its `.olean` hash, the text it was compiled from, the options Lake compiled it with, and
// the keys of the project modules it imports: after a build only the modules whose key changed run
// again. A module that cannot be elaborated is reported and keeps the text-based context and no
// notation edges; the others are not held back by it.

import { spawn } from "node:child_process";
import { tracked } from "./children.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleContexts } from "../shared/context.ts";
import type { FileContext } from "../shared/scope.ts";
import type { RawGraph, RawUsage } from "../shared/graph.ts";
import { SITE_BODY, SITE_GRAMMAR, SITE_PROOF, SITE_TCB } from "../shared/graph.ts";
import { USAGE, USAGE_PROGRAM, leanProgram, prune } from "./extract.ts";
import type { Dirs } from "./dirs.ts";
import type { Extraction } from "./extract.ts";
import type { Project } from "./project.ts";
import { compiledTextHash, lakeTextHash } from "./status.ts";

/** How many workers run at once unless `--jobs` says otherwise: past about a quarter of the cores,
 *  more workers gain less and less (Sphere-Packing-Lean's cold pass on 32 cores: 320 s with 4, 195 s with
 *  8, 148 s with 16). */
export const DEFAULT_JOBS = 8;
/** A worker still running after this long is stopped, and its module reported as failed. */
const WORKER_TIMEOUT_MS = 10 * 60_000;
/** Mixed into the fingerprint of a merged graph: bumped when the merge changes, so that graphs
 *  merged before are not served as if made by this one. 3: the units' proof spans. (A change to
 *  extractor/Usage.lean changes every module's key by itself: its text is in the salt.) */
const MERGE_VERSION = 3;

/** A use, as the worker writes it: a project syntax kind parsed in a command's text, or a macro or
 *  elaborator that ran on it (with the kind it ran for); its site (1 statement, 2 body, 4 proof);
 *  where, as line (1-based) and column; and the index of the use whose expansion emitted it, -1
 *  when it is written in the text. */
type Use = [kind: string, impl: string, site: number, line: number, col: number, by: number];

/** Where a proof is: [line, col, endLine, endCol], lines 1-based, columns 0-based in code points,
 *  end exclusive (RawNode.proofs). */
type Span = [number, number, number, number];

/** A command that declares a constant or uses project notation. */
interface UsageCmd {
  line: number;
  endLine: number;
  consts: string[];
  ctx: number;
  /** constant → the indices of its context's variables Lean included in it */
  incl: Record<string, number[]>;
  uses: Use[];
  /** the proofs inside its definitions' bodies, sorted and merged; absent when there are none */
  proofs?: Span[];
}

/** What the worker writes for one module (extractor/Usage.lean). */
export interface ModuleUsage {
  module: string;
  ms: { import: number; elab: number; total: number };
  errors: { line: number; message: string }[];
  /** as FileContext, without `namespaces` (derived from `namespace`) */
  contexts: Omit<FileContext, "namespaces">[];
  cmds: UsageCmd[];
}

/** A module's result, under the key it was made for; only a success is cached. `hash`: the Lake
 *  hash of the text it elaborated, the module's compiled text. */
interface Entry {
  key: string;
  hash: string | null;
  usage?: ModuleUsage;
  error?: string;
}

export interface PassStatus {
  state: "off" | "idle" | "running" | "done" | "cancelled";
  jobs: number;
  /** modules of the graph, those to elaborate now, done of those, and reused from the cache */
  total: number;
  todo: number;
  done: number;
  cached: number;
  /** modules that could not be elaborated, and why */
  failed: { module: string; error: string }[];
  startedAt: string | null;
  ms: number | null;
}

/** What a pass over one extraction has to do. */
export interface Plan {
  /** the graph's modules that have a source file */
  modules: string[];
  keys: Map<string, string>;
  /** results reused, by module */
  cached: Map<string, Entry>;
  todo: { module: string; file: string; key: string; hash: string; opts: string[] }[];
  /** modules that cannot be elaborated now: what was compiled is not there to read */
  skipped: { module: string; error: string }[];
}

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** The `-D` options Lake compiled a module with, from its trace (docs/LAKE.md). */
export function traceOptions(p: Project, module: string): string[] {
  try {
    const t = JSON.parse(readFileSync(join(p.libDir, ...module.split(".")) + ".trace", "utf8"));
    const out: string[] = [];
    for (const inp of t.inputs ?? []) {
      if (!Array.isArray(inp)) continue;
      if (inp[0] === "options" && Array.isArray(inp[1])) for (const o of inp[1]) if (Array.isArray(o) && typeof o[0] === "string" && o[0].startsWith("-D")) out.push(o[0]);
      // `Module.leanArgs: #[…]`: options given to this module alone
      if (typeof inp[0] === "string" && inp[0].startsWith("Module.leanArgs: ")) for (const m of inp[0].matchAll(/"(-D[^"]+)"/g)) out.push(m[1]);
    }
    return out;
  } catch {
    return [];
  }
}

/** The environment Lake gives the project's programs (`lake env`): its LEAN_PATH, its toolchain.
 *  Asked once per pass, and every worker started with it, rather than through `lake env` each. */
function lakeEnv(root: string): Promise<NodeJS.ProcessEnv> {
  return new Promise((resolveP, reject) => {
    const child = tracked(spawn("lake", ["env", "env", "-0"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }));
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => (err = (err + b).slice(-2000)));
    child.on("error", (e) => reject(new Error(`could not start lake: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`lake env exited with ${code}: ${err}`));
      const env: NodeJS.ProcessEnv = {};
      for (const kv of Buffer.concat(out).toString("utf8").split("\0")) {
        const at = kv.indexOf("=");
        if (at > 0) env[kv.slice(0, at)] = kv.slice(at + 1);
      }
      resolveP(env);
    });
  });
}

export class UsagePass {
  readonly project: Project;
  readonly dir: string;
  /** the Lean programs' root (server/dirs.ts), where the worker is compiled */
  readonly lean: string;
  readonly jobs: number;
  private log: (l: string) => void;
  status: PassStatus;
  /** the run going on, to stop when a newer build supersedes it */
  private current: { cancelled: boolean; children: Set<ReturnType<typeof spawn>> } | null = null;

  constructor(project: Project, dirs: Pick<Dirs, "cache" | "lean">, jobs: number, log: (l: string) => void) {
    this.project = project;
    this.dir = join(dirs.cache, "usage");
    this.lean = dirs.lean;
    this.jobs = jobs;
    this.log = log;
    this.status = { state: jobs > 0 ? "idle" : "off", jobs, total: 0, todo: 0, done: 0, cached: 0, failed: [], startedAt: null, ms: null };
  }

  get enabled(): boolean {
    return this.jobs > 0;
  }

  /** What every result depends on besides its module: this worker, the toolchain, the
   *  dependencies (pinned by the manifest). */
  private salt(): string {
    const manifest = join(this.project.root, "lake-manifest.json");
    return sha(Buffer.concat([readFileSync(USAGE), Buffer.from(this.project.toolchain), existsSync(manifest) ? readFileSync(manifest) : Buffer.alloc(0)])).slice(0, 16);
  }

  private file(module: string): string {
    return join(this.dir, `${module}.json`);
  }

  private read(module: string, key: string): Entry | null {
    try {
      const e: Entry = JSON.parse(readFileSync(this.file(module), "utf8"));
      return e.key === key && e.usage ? e : null;
    } catch {
      return null;
    }
  }

  /** Which modules of the extraction's graph to elaborate, and which results hold already. */
  plan(graph: RawGraph): Plan {
    const p = this.project;
    const salt = this.salt();
    const imports = new Map(graph.modules.map((m) => [m.name, m.imports]));
    const keys = new Map<string, string>();
    const missing = new Map<string, string>();
    // a module's key: its build, and its imports' keys (an import's change can change what it means)
    const keyOf = (m: string, seen: Set<string>): string | null => {
      const known = keys.get(m);
      if (known) return known;
      if (missing.has(m) || seen.has(m)) return null;
      seen.add(m);
      const base = join(p.libDir, ...m.split("."));
      let own: string;
      try {
        own = readFileSync(base + ".olean.hash", "utf8").trim();
      } catch {
        missing.set(m, "it has no build");
        return null;
      }
      const deps: string[] = [];
      for (const i of imports.get(m) ?? []) {
        const k = keyOf(i, seen);
        if (!k) {
          missing.set(m, `${i}, which it imports, has no build`);
          return null;
        }
        deps.push(k);
      }
      const file = p.files.get(m);
      const compiled = file ? compiledTextHash(p, m, file) : null;
      const k = sha([salt, own, compiled ?? "", traceOptions(p, m).join(" "), deps.join(",")].join("|")).slice(0, 24);
      keys.set(m, k);
      return k;
    };
    const plan: Plan = { modules: [], keys, cached: new Map(), todo: [], skipped: [] };
    for (const m of graph.modules) {
      const file = p.files.get(m.name);
      if (!file) continue;
      plan.modules.push(m.name);
      const key = keyOf(m.name, new Set());
      if (!key) {
        plan.skipped.push({ module: m.name, error: `not elaborated: ${missing.get(m.name) ?? "it has no build"}` });
        continue;
      }
      const hit = this.read(m.name, key);
      if (hit) {
        plan.cached.set(m.name, hit);
        continue;
      }
      // what is there to read must be what was compiled: the pass's places and contexts are about
      // that text, as the graph is
      const compiled = compiledTextHash(p, m.name, file);
      let now: string | null = null;
      try {
        now = lakeTextHash(readFileSync(join(p.root, file), "utf8"));
      } catch {
        // deleted since the build
      }
      if (!compiled || now !== compiled) {
        plan.skipped.push({ module: m.name, error: "not elaborated: its file changed since it was compiled" });
        continue;
      }
      plan.todo.push({ module: m.name, file, key, hash: compiled, opts: traceOptions(p, m.name) });
    }
    return plan;
  }

  /** Stop the run going on: its workers are killed, what they finished stays cached. */
  cancel(): void {
    const c = this.current;
    if (!c) return;
    c.cancelled = true;
    for (const ch of c.children) ch.kill("SIGTERM");
    this.status = { ...this.status, state: "cancelled" };
  }

  /** Elaborate what the plan says, `jobs` at a time; every result, cached or new, by module, and
   *  the failures. Null when cancelled. */
  async run(plan: Plan, onProgress: () => void = () => {}): Promise<Map<string, Entry> | null> {
    this.cancel();
    const run = { cancelled: false, children: new Set<ReturnType<typeof spawn>>() };
    this.current = run;
    const t0 = Date.now();
    const results = new Map(plan.cached);
    const failed = plan.skipped.slice();
    this.status = { state: "running", jobs: this.jobs, total: plan.modules.length, todo: plan.todo.length, done: 0, cached: plan.cached.size, failed, startedAt: new Date(t0).toISOString(), ms: null };
    if (plan.todo.length) {
      mkdirSync(this.dir, { recursive: true });
      const bin = await leanProgram(USAGE_PROGRAM, this.project.toolchain, this.lean, this.log);
      let env: NodeJS.ProcessEnv | null = null;
      let why = bin ? null : "the usage worker could not be built";
      if (bin) {
        try {
          env = await lakeEnv(this.project.root);
        } catch (e) {
          why = e instanceof Error ? e.message : String(e);
        }
      }
      if (!bin || !env) {
        for (const t of plan.todo) failed.push({ module: t.module, error: why! });
      } else {
        const modsFile = join(this.dir, "project-modules.txt");
        writeFileSync(modsFile, plan.modules.join("\n") + "\n");
        const queue = plan.todo.slice();
        const worker = async () => {
          while (queue.length && !run.cancelled) {
            const t = queue.shift()!;
            const e = await this.one(run, bin, env!, modsFile, t);
            if (run.cancelled) return;
            if (e.usage) results.set(t.module, e);
            else failed.push({ module: t.module, error: e.error ?? "failed" });
            this.status.done++;
            onProgress();
          }
        };
        await Promise.all(Array.from({ length: Math.min(this.jobs, queue.length) }, worker));
      }
    }
    if (run.cancelled) return null;
    this.current = null;
    this.status = { ...this.status, state: "done", failed, ms: Date.now() - t0 };
    return results;
  }

  /** One worker on one module: its result, cached under its key. A failure is not cached: almost
   *  every one is the build's state at that moment (an import Lake is rewriting, a file being
   *  edited), and the module is tried again at the next pass. */
  private one(run: { cancelled: boolean; children: Set<ReturnType<typeof spawn>> }, bin: string, env: NodeJS.ProcessEnv, modsFile: string, t: Plan["todo"][number]): Promise<Entry> {
    // the text must be the compiled one when the worker reads it, and still be when it is done: an
    // edit in between would file another text's places under the compiled text's key
    const source = join(this.project.root, t.file);
    const unchanged = () => {
      try {
        return lakeTextHash(readFileSync(source, "utf8")) === t.hash;
      } catch {
        return false;
      }
    };
    const edited: Entry = { key: t.key, hash: t.hash, error: "not elaborated: its file changed since it was compiled" };
    if (!unchanged()) return Promise.resolve(edited);
    return new Promise((resolveP) => {
      const tmp = `${this.file(t.module)}.tmp-${process.pid}`;
      const args = [source, t.module, tmp, modsFile, ...t.opts];
      // run from the project's cache directory: nothing a worker might write could land in the project
      const child = spawn(bin, args, { cwd: this.dir, env, stdio: ["ignore", "ignore", "pipe"] });
      run.children.add(child);
      let err = "";
      child.stderr.on("data", (b: Buffer) => (err = (err + b).slice(-2000)));
      const timer = setTimeout(() => child.kill("SIGKILL"), WORKER_TIMEOUT_MS);
      const done = (e: Entry, keep: boolean) => {
        clearTimeout(timer);
        run.children.delete(child);
        rmSync(tmp, { force: true });
        if (keep && !run.cancelled) {
          writeFileSync(`${this.file(t.module)}.tmp`, JSON.stringify(e));
          renameSync(`${this.file(t.module)}.tmp`, this.file(t.module));
        }
        resolveP(e);
      };
      child.on("error", (e) => done({ key: t.key, hash: t.hash, error: `could not start the worker: ${e.message}` }, false));
      child.on("close", (code, signal) => {
        if (code === 0) {
          if (!unchanged()) return done(edited, false);
          try {
            const usage: ModuleUsage = JSON.parse(readFileSync(tmp, "utf8"));
            return done({ key: t.key, hash: t.hash, usage }, true);
          } catch (e) {
            return done({ key: t.key, hash: t.hash, error: `unreadable output: ${e instanceof Error ? e.message : String(e)}` }, false);
          }
        }
        const msg = (err.trim().split("\n").pop() ?? "").replace(/^vp-usage: /, "").slice(0, 500);
        if (signal) return done({ key: t.key, hash: t.hash, error: `stopped (${signal})${msg ? `: ${msg}` : ""}` }, false);
        done({ key: t.key, hash: t.hash, error: msg || `exited with ${code}` }, false);
      });
    });
  }

  /** A fingerprint of a plan's results: what a merged graph is made of besides its extraction. */
  static digest(plan: Plan, failed: { module: string }[]): string {
    const parts = [...plan.keys.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([m, k]) => `${m}=${k}`);
    return sha(`merge ${MERGE_VERSION}\0${parts.join("\n")}\0${failed.map((f) => f.module).sort().join(",")}`).slice(0, 16);
  }
}

/** The extraction with the pass's findings merged in (`results` by module, `failed` the modules
 *  without one): a new graph, under a fingerprint that names both. */
export function mergeUsage(ex: Extraction, plan: Plan, results: Map<string, Entry>, failed: { module: string; error: string }[], ms: number): Extraction {
  const graph = ex.graph;
  const n = graph.nodes.length;
  // a unit by any name it answers to: its own, its Lean constant's, and those of what its command
  // generated
  const unitOf = new Map<string, number>();
  graph.nodes.forEach((v, i) => {
    unitOf.set(v.name, i);
    if (v.leanName) unitOf.set(v.leanName, i);
    for (const a of v.also ?? []) if (!unitOf.has(a)) unitOf.set(a, i);
  });
  const grammar = (i: number) => !!graph.nodes[i].flags?.includes("grammar");
  // the only rule of a syntax that only declares grammar, where it has one
  const onlyRule = (i: number): number | undefined => {
    const v = graph.nodes[i];
    if (!grammar(i) || v.foreignRules || v.rules?.length !== 1) return undefined;
    return unitOf.get(v.rules[0]);
  };
  const edges = graph.edges.map((e) => [...e] as [number, number, number]);
  const at = new Map<number, number>();
  edges.forEach(([s, d], k) => at.set(s * (n + graph.externals.length) + d, k));
  let notationEdges = 0, nestedEdges = 0, ruleEdges = 0;
  const add = (src: number, dst: number, site0: number, nested: boolean, rule = false) => {
    if (src === dst) return;
    // into a unit that only declares grammar, what is not a proof is grammar: no TCB follows it
    const site = grammar(dst) && site0 & SITE_TCB ? (site0 & SITE_PROOF) | SITE_GRAMMAR : site0;
    const key = src * (n + graph.externals.length) + dst;
    const k = at.get(key);
    if (k !== undefined) {
      edges[k][2] |= site;
      return;
    }
    at.set(key, edges.length);
    edges.push([src, dst, site]);
    if (rule) ruleEdges++;
    else if (nested) nestedEdges++;
    else notationEdges++;
  };
  const isNotation = (i: number | undefined): i is number => i !== undefined && graph.nodes[i].kind === "notation";
  // a macro or elaborator that ran is the project's (the worker records no other): a notation unit,
  // or a declaration registered for the kind (`@[term_elab k] def …`)
  const ran = (impl: string): number | undefined => (impl ? unitOf.get(impl) : undefined);
  const contexts: Record<string, ModuleContexts> = {};
  // each unit's proof spans
  const proofs = new Map<number, Span[]>();
  // in module order, whatever order the results came in: the same results make the same graph
  for (const [module, e] of [...results].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const u = e.usage!;
    const decls: Record<string, number[]> = {};
    for (const cmd of u.cmds) {
      const units = [...new Set(cmd.consts.map((c) => unitOf.get(c)).filter((i): i is number => i !== undefined))];
      // the context each unit is written in, and the variables Lean included in it: those of the
      // constant the unit is named after, else of everything of the unit the command declared
      for (const i of units) {
        const own = cmd.incl[graph.nodes[i].leanName ?? graph.nodes[i].name];
        const incl = own ?? [...new Set(cmd.consts.filter((c) => unitOf.get(c) === i).flatMap((c) => cmd.incl[c] ?? []))];
        decls[graph.nodes[i].name] ??= [cmd.ctx, ...incl.sort((a, b) => a - b)];
      }
      if (!units.length) continue;
      // which unit of the command a use belongs to: the one whose text holds it (a `mutual` block
      // writes several); every unit of the command when none does
      const holders = (line: number, col: number): number[] => {
        const inside = units.filter((i) => {
          const r = graph.nodes[i].range;
          return !!r && (line > r[0] || (line === r[0] && col >= r[1])) && (line < r[2] || (line === r[2] && col <= r[3]));
        });
        return inside.length ? inside : units;
      };
      // a proof belongs to the unit whose text holds it
      for (const sp of cmd.proofs ?? []) for (const i of holders(sp[0], sp[1])) proofs.set(i, [...(proofs.get(i) ?? []), sp]);
      // what interprets a use of a kind: the rule that ran; where none is recorded (a parent
      // expanded it by hand, `expandMacros`), the only rule of its syntax, which every use of the
      // kind runs — so that leaving grammar out of the TCB never leaves its meaning out
      const meaning = (kind: string, impl: string): { at: number; rule: boolean } | undefined => {
        const r = ran(impl);
        if (r !== undefined) return { at: r, rule: false };
        const k = unitOf.get(kind);
        if (k === undefined || !isNotation(k)) return undefined;
        if (!grammar(k)) return { at: k, rule: false };
        const only = onlyRule(k);
        return only === undefined ? undefined : { at: only, rule: true };
      };
      for (const [kind, impl, site, line, col, by] of cmd.uses) {
        const k = unitOf.get(kind);
        const m = meaning(kind, impl);
        const targets: { at: number; rule: boolean }[] = [];
        if (isNotation(k)) targets.push({ at: k, rule: false });
        if (m && m.at !== k) targets.push(m);
        if (!targets.length) continue;
        // emitted by an expansion: a dependency of what emitted it (the rule that ran, else the only
        // rule of its syntax), not of the declaration; one whose rule is not known leaves it to the
        // declaration, which reaches it then
        const emitter = by >= 0 ? cmd.uses[by] : null;
        const from = emitter ? meaning(emitter[0], emitter[1])?.at : undefined;
        for (const t of targets) {
          if (from !== undefined) add(from, t.at, SITE_BODY, true);
          else for (const src of holders(line, col)) add(src, t.at, site, false, t.rule);
        }
      }
    }
    if (e.hash) contexts[module] = { hash: e.hash, contexts: u.contexts.map(withNamespaces), decls };
  }
  let proofSpans = 0;
  const nodes = graph.nodes.map((v, i) => {
    const ps = proofs.get(i);
    if (!ps) return v;
    const merged = mergeSpans(ps);
    proofSpans += merged.length;
    return { ...v, proofs: merged };
  });
  const usage: RawUsage = {
    contexts,
    failed: failed.slice().sort((a, b) => (a.module < b.module ? -1 : 1)),
    stats: { modules: plan.modules.length, ran: plan.todo.length, cached: plan.cached.size, notationEdges, nestedEdges, ruleEdges, proofSpans, ms },
  };
  const fingerprint = sha(`${ex.fingerprint}\0${UsagePass.digest(plan, failed)}`).slice(0, 16);
  return { graph: { ...graph, nodes, edges, usage }, fingerprint, at: new Date().toISOString(), cached: false };
}

/** Spans sorted, those that overlap or touch made one. */
export function mergeSpans(xs: readonly Span[]): Span[] {
  const before = (a: number, b: number, c: number, d: number) => a < c || (a === c && b < d);
  const out: Span[] = [];
  for (const s of xs.slice().sort((x, y) => (before(x[0], x[1], y[0], y[1]) ? -1 : before(y[0], y[1], x[0], x[1]) ? 1 : 0))) {
    const last = out[out.length - 1];
    if (last && !before(last[2], last[3], s[0], s[1])) {
      if (before(last[2], last[3], s[2], s[3])) [last[2], last[3]] = [s[2], s[3]];
    } else out.push([...s]);
  }
  return out;
}

/** A context as the worker writes it, with the namespaces around it as shared/scope.ts lists them
 *  (innermost first), and marked as the elaborator's. */
function withNamespaces(c: Omit<FileContext, "namespaces">): FileContext {
  const parts = c.namespace.split(".").filter(Boolean);
  const namespaces: string[] = [];
  for (let k = parts.length; k > 0; k--) namespaces.push(parts.slice(0, k).join("."));
  return { ...c, namespaces, exact: true };
}

/** A merged extraction filed in the project's cache beside the extractor's, so that a re-layout
 *  (`prepare` with `reuse`) finds it by its fingerprint. The extractor's and the merged ones of the
 *  last two builds are kept. */
export function saveMerged(cacheDir: string, ex: Extraction): void {
  const dir = join(cacheDir, "extract");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${ex.fingerprint}.json`);
  if (existsSync(file)) return;
  writeFileSync(`${file}.tmp`, JSON.stringify(ex.graph));
  renameSync(`${file}.tmp`, file);
  prune(dir, /^[0-9a-f]{16}\.json$/, 4);
}
