// VisualProof's own releases, as a running server follows them (UpdateSpec.md): which versions npm
// has, which of them this server may take by itself (a patch of the minor it runs, UpdateSpec
// decision 3) and which it only tells of (a newer minor, decision 4), the patches downloaded beside
// the installed package (`<cache>/versions/`, decision 5), and the quiet moment a server restarts
// into one (decision 6).
//
// The registry is asked through npm itself, the npm beside the Node that runs the server, so that
// the user's registry, proxy and certificates hold as for any `npm install` (decision 1). What npm
// is asked: the versions of `visualproof` and the engines of the newest ones; nothing of the project.
//
//   <cache>/updates.json          the last check: when, the versions found, the engines asked
//   <cache>/versions/<v>/         a patch downloaded: an npm prefix holding visualproof@<v>
//   <cache>/versions/<v>/ready    written once it was checked to run (`--version` says <v>)
//   <cache>/versions/bad.json     versions set aside (decision 7): each with when and why

import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tracked } from "./children.ts";
import { packageVersion, satisfies } from "./version.ts";

export type UpdateMode = "auto" | "notify" | "off";
export const UPDATE_MODES: UpdateMode[] = ["auto", "notify", "off"];

/** What a page is told of VisualProof's own version (GET /api/updates, the `updates` event): the
 *  running version to everyone; the rest to those let in fully (UpdateSpec decision 11). */
export interface UpdateStatus {
  /** the version this server runs */
  running: string;
  /** the installed package's, where it is another: a patch taken from the cache, or a package
   *  installed while this one ran */
  installed?: string;
  mode?: UpdateMode;
  /** when the registry was last asked */
  checked?: string;
  /** a newer release: `taken` where this server takes it by itself (a patch, under auto), else the
   *  command that installs it; `notes`, its release notes */
  newer?: { version: string; taken: boolean; command?: string; notes: string };
}

/** The package's own folder, holding package.json: the one this code was loaded from. */
export const PACKAGE_ROOT = join(import.meta.dirname, "..", "..");

/** Whether this code is an installed package's (`dist/server/`), not a checkout's (`src/server/`):
 *  only a package is updated (UpdateSpec decision 13). */
export const FROM_PACKAGE = basename(dirname(import.meta.dirname)) === "dist";

// ---------------------------------------------------------------- versions

type Triple = [number, number, number];

/** A release's version, `x.y.z`; null for anything else (a release candidate, `0.0.0-stage`). */
export function stable(v: string): Triple | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function order(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Whether release `a` is newer than `b`. */
export function newerThan(a: string, b: string): boolean {
  const x = stable(a), y = stable(b);
  return !!x && !!y && order(x, y) > 0;
}

/** Whether two releases are of one minor (`0.4.1` and `0.4.3`): what a server takes by itself. */
export function sameMinor(a: string, b: string): boolean {
  const x = stable(a), y = stable(b);
  return !!x && !!y && x[0] === y[0] && x[1] === y[1];
}

/** The newest of `vs` (releases only), or null. */
export function newest(vs: Iterable<string>): string | null {
  let best: string | null = null;
  for (const v of vs) if (stable(v) && (best === null || newerThan(v, best))) best = v;
  return best;
}

/** What a server running `running` may do with the versions npm has: `patch`, the newest release
 *  of its minor beyond it that is not set aside and runs on this Node, which it takes by itself
 *  under auto (UpdateSpec decision 3); `release`, the newest release beyond it that runs here,
 *  which it tells of (decision 4). `engines` says each version's Node range, where known (unknown:
 *  taken as running here). */
export function choose(running: string, versions: string[], o: { bad?: Set<string>; engines?: (v: string) => string | undefined; node?: string } = {}): { patch: string | null; release: string | null } {
  const node = o.node ?? process.versions.node;
  const runs = (v: string) => {
    const e = o.engines?.(v);
    return e === undefined || satisfies(node, e);
  };
  const beyond = versions.filter((v) => newerThan(v, running) && runs(v));
  return {
    patch: newest(beyond.filter((v) => sameMinor(v, running) && !o.bad?.has(v))),
    release: newest(beyond),
  };
}

// ---------------------------------------------------------------- npm

export type NpmResult = { ok: true; out: string } | { ok: false; why: string };
/** npm, asked something: what it printed, or why it failed. */
export type Npm = (args: string[], timeoutMs?: number) => Promise<NpmResult>;

/** The npm beside the Node that runs this server, which installed it; else the one on the PATH. */
export function npmPath(execPath = process.execPath): string {
  const beside = join(dirname(execPath), "npm");
  return existsSync(beside) ? beside : "npm";
}

/** npm as a child of this server (server/children.ts), without its own nags. */
export const npm: Npm = (args, timeoutMs = 120_000) =>
  new Promise((resolve) => {
    const env = { ...process.env, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" };
    tracked(
      execFile(npmPath(), args, { timeout: timeoutMs, maxBuffer: 16 << 20, env, encoding: "utf8" }, (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, out: stdout });
        const said = `${stderr}`.split("\n").find((l) => /npm (error|ERR!)/.test(l) && !/A complete log/.test(l));
        resolve({ ok: false, why: said?.replace(/^npm (error|ERR!)\s*/, "").trim() || (err.killed ? "npm took too long" : err.message.split("\n")[0]) });
      }),
    );
  });

/** The versions of visualproof npm has: every release, or why npm could not say. */
export async function registryVersions(ask: Npm = npm): Promise<{ versions: string[] } | { why: string }> {
  const r = await ask(["view", "visualproof", "versions", "--json"], 60_000);
  if (!r.ok) return { why: r.why };
  try {
    const v = JSON.parse(r.out) as unknown;
    const list = Array.isArray(v) ? v : [v];
    return { versions: list.filter((x): x is string => typeof x === "string") };
  } catch {
    return { why: "npm's answer could not be read" };
  }
}

/** The Node range a version of visualproof runs on (its `engines.node`), or null when npm cannot say. */
export async function registryEngines(v: string, ask: Npm = npm): Promise<string | null> {
  const r = await ask(["view", `visualproof@${v}`, "engines", "--json"], 60_000);
  if (!r.ok) return null;
  try {
    const e = JSON.parse(r.out || "{}") as { node?: unknown };
    return typeof e?.node === "string" ? e.node : "";
  } catch {
    return null;
  }
}

/** The command that installs version `v` where the package at `root` is installed: npm's global
 *  folder (`<prefix>/lib/node_modules/visualproof`), or a prefix of its own
 *  (`<prefix>/node_modules/visualproof`). */
export function installCommand(root: string, v: string, execPath = process.execPath): string {
  const above = dirname(dirname(root));
  if (basename(above) === "lib") {
    const prefix = dirname(above);
    return prefix === dirname(dirname(execPath)) ? `npm install --global visualproof@${v}` : `npm install --global --prefix ${prefix} visualproof@${v}`;
  }
  return `npm install --prefix ${above} visualproof@${v}`;
}

/** Where a release's notes are: the GitHub release made from the changelog's section. */
export function notesOf(v: string, root = PACKAGE_ROOT): string {
  let repo = "https://github.com/LucianoXu/VisualProof";
  try {
    const u = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { repository?: { url?: string } }).repository?.url;
    if (u) repo = u.replace(/^git\+/, "").replace(/\.git$/, "");
  } catch {
    // the project's own address, as package.json has it today
  }
  return `${repo}/releases/tag/v${v}`;
}

/** The version of the package at `root`, or null where none is there. */
export function versionAt(root: string): string | null {
  try {
    const v = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the patches kept

/** The versions downloaded beside the installed package (UpdateSpec decision 5). */
export class Versions {
  readonly root: string;

  constructor(cacheRoot: string) {
    this.root = join(cacheRoot, "versions");
  }

  /** the package of version `v`, as npm installed it into its prefix */
  packageOf(v: string): string {
    return join(this.root, v, "node_modules", "visualproof");
  }

  mainOf(v: string): string {
    return join(this.packageOf(v), "dist", "server", "main.js");
  }

  /** The versions downloaded and checked to run. */
  ready(): string[] {
    let names: string[] = [];
    try {
      names = readdirSync(this.root);
    } catch {
      return [];
    }
    return names.filter((v) => {
      if (!stable(v)) return false;
      try {
        return readFileSync(join(this.root, v, "ready"), "utf8").trim() === v && existsSync(this.mainOf(v));
      } catch {
        return false;
      }
    });
  }

  /** The versions set aside, each with when and why (UpdateSpec decision 7). */
  bad(): Map<string, { at: string; why: string }> {
    try {
      const raw = JSON.parse(readFileSync(join(this.root, "bad.json"), "utf8")) as Record<string, { at?: unknown; why?: unknown }>;
      return new Map(Object.entries(raw).filter(([v, e]) => stable(v) && e && typeof e.why === "string").map(([v, e]) => [v, { at: String(e.at ?? ""), why: String(e.why) }]));
    } catch {
      return new Map();
    }
  }

  markBad(v: string, why: string): void {
    const all = Object.fromEntries(this.bad());
    all[v] = { at: new Date().toISOString(), why };
    mkdirSync(this.root, { recursive: true });
    const f = join(this.root, "bad.json");
    writeFileSync(`${f}.tmp-${process.pid}`, JSON.stringify(all, null, 1));
    renameSync(`${f}.tmp-${process.pid}`, f);
  }

  /** Download version `v` (npm checks what it downloads against the registry's integrity), check
   *  that it runs and says it is `v`, and mark it ready: into a folder of its own first, moved into
   *  place once whole, so that a supervisor never runs one half there. Null when done, else why not. */
  async fetch(v: string, ask: Npm = npm, node = process.execPath): Promise<string | null> {
    if (!stable(v)) return `${v} is not a release`;
    mkdirSync(this.root, { recursive: true });
    const work = join(this.root, `.${v}.tmp-${process.pid}`);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    try {
      const r = await ask(["install", "--prefix", work, "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", `visualproof@${v}`], 600_000);
      if (!r.ok) return `npm could not install it: ${r.why}`;
      const main = join(work, "node_modules", "visualproof", "dist", "server", "main.js");
      if (!existsSync(main)) return "npm installed it without its server";
      const says = spawnSync(node, [main, "--version"], { encoding: "utf8", timeout: 30_000 });
      if (says.status !== 0 || says.stdout.trim() !== v) return `it does not run here (${(says.stderr || says.stdout || String(says.error ?? "")).trim().split("\n")[0] || `status ${says.status}`})`;
      writeFileSync(join(work, "ready"), `${v}\n`);
      rmSync(join(this.root, v), { recursive: true, force: true });
      renameSync(work, join(this.root, v));
      return null;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /** Keep the versions named (the running one and the one before it), and remove the others. */
  prune(keep: Iterable<string>): void {
    const kept = new Set(keep);
    let names: string[] = [];
    try {
      names = readdirSync(this.root);
    } catch {
      return;
    }
    for (const v of names) if (stable(v) && !kept.has(v)) rmSync(join(this.root, v), { recursive: true, force: true });
  }
}

/** The code a supervisor runs (UpdateSpec decision 5): the installed package's, or the newest
 *  version downloaded of its minor that is newer, ready, runs on this Node and is not set aside. */
export function codeToRun(installedRoot: string, versions: Versions, node = process.versions.node): { main: string; version: string; cached: boolean } {
  const installed = versionAt(installedRoot) ?? "0.0.0";
  const bad = versions.bad();
  let best: string | null = null;
  for (const v of versions.ready()) {
    if (!sameMinor(v, installed) || !newerThan(v, installed) || bad.has(v)) continue;
    const engines = (() => {
      try {
        return (JSON.parse(readFileSync(join(versions.packageOf(v), "package.json"), "utf8")) as { engines?: { node?: string } }).engines?.node;
      } catch {
        return undefined;
      }
    })();
    if (engines && !satisfies(node, engines)) continue;
    if (best === null || newerThan(v, best)) best = v;
  }
  return best ? { main: versions.mainOf(best), version: best, cached: true } : { main: join(installedRoot, "dist", "server", "main.js"), version: installed, cached: false };
}

// ---------------------------------------------------------------- a server following its releases

/** VISUALPROOF_UPDATE_TEST_MS, for the tests of the update path alone (scripts/test-updates.mjs):
 *  every wait below that many milliseconds, the longest five times it */
const TEST_MS = Number(process.env.VISUALPROOF_UPDATE_TEST_MS) > 0 ? Number(process.env.VISUALPROOF_UPDATE_TEST_MS) : 0;
/** a day between checks, and up to two hours more, so that servers started together do not ask together */
export const CHECK_EVERY = TEST_MS || 24 * 3600_000;
const JITTER = TEST_MS ? 0 : 2 * 3600_000;
/** the first check, once the server listens */
const FIRST_CHECK = TEST_MS || 30_000;
/** how often the quiet moment is looked for */
const LOOK_EVERY = TEST_MS || 60_000;
/** the longest a patch downloaded waits for a quiet moment (UpdateSpec decision 6) */
export const PATCH_WAIT = TEST_MS * 5 || 24 * 3600_000;
/** the longest a package changed under the running server waits: its files are not the ones it
 *  started with */
export const INSTALLED_WAIT = TEST_MS * 5 || 10 * 60_000;

interface Saved {
  checked: string;
  versions: string[];
  engines: Record<string, string>;
}

export interface UpdatesOptions {
  mode: UpdateMode;
  /** the root of the caches (`--cache`, else the cache home) */
  cacheRoot: string;
  /** whether the server may restart into another version: it runs from a package, under the
   *  supervisor (an IPC channel to it) */
  canRestart: boolean;
  /** whether the registry is asked at all: only from a package (UpdateSpec decision 13) */
  check: boolean;
  /** nobody on a page, nothing running: a moment to restart in (decision 6) */
  quiet: () => boolean;
  /** restart into version `to` (the server tells its pages, stops, and its supervisor starts it) */
  restart: (to: string) => void;
  /** a line for the server's log */
  log: (line: string) => void;
  /** the status changed: the pages are told */
  changed?: () => void;
  running?: string;
  /** the installed package's folder: the supervisor's, where this server runs a patch from the cache */
  installedRoot?: string;
  npm?: Npm;
  node?: string;
  now?: () => number;
}

/** What a server knows and does about its own releases (UpdateSpec decisions 1–7). */
export class Updates {
  readonly mode: UpdateMode;
  readonly running: string;
  readonly installedRoot: string;
  readonly versions: Versions;
  private o: UpdatesOptions;
  private file: string;
  private saved: Saved | null = null;
  private now: () => number;
  /** a patch downloaded and ready, and when it was */
  private pending: { version: string; since: number } | null = null;
  /** the installed package as it was when this server started, and since when it is another */
  private installedAtStart: string | null;
  private installedChanged: number | null = null;
  private downloading = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private restarting = false;

  constructor(o: UpdatesOptions) {
    this.o = o;
    this.mode = o.mode;
    this.running = o.running ?? packageVersion();
    this.installedRoot = o.installedRoot ?? PACKAGE_ROOT;
    this.versions = new Versions(o.cacheRoot);
    this.file = join(o.cacheRoot, "updates.json");
    this.now = o.now ?? Date.now;
    this.installedAtStart = versionAt(this.installedRoot);
    try {
      const s = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Saved>;
      if (typeof s.checked === "string" && Array.isArray(s.versions)) this.saved = { checked: s.checked, versions: s.versions.filter((v) => typeof v === "string"), engines: s.engines && typeof s.engines === "object" ? s.engines : {} };
    } catch {
      // never checked here, or the file is unreadable: asked again
    }
  }

  /** The versions newer than this one that it may take, and tell of, as last found. */
  private found(): { patch: string | null; release: string | null } {
    if (!this.saved) return { patch: null, release: null };
    const e = this.saved.engines;
    return choose(this.running, this.saved.versions, { bad: new Set(this.versions.bad().keys()), engines: (v) => (Object.hasOwn(e, v) ? e[v] : undefined), node: this.o.node });
  }

  /** What a page is told (UpdateSpec decision 11): the version alone where `full` is not. */
  status(full: boolean): UpdateStatus {
    if (!full) return { running: this.running };
    const installed = versionAt(this.installedRoot);
    const { patch, release } = this.found();
    const s: UpdateStatus = { running: this.running, mode: this.mode, ...(installed && installed !== this.running ? { installed } : {}), ...(this.saved ? { checked: this.saved.checked } : {}) };
    // a newer minor, which needs someone, is told before a patch this server takes by itself
    if (release && !sameMinor(release, this.running)) s.newer = { version: release, taken: false, command: installCommand(this.installedRoot, release), notes: notesOf(release, this.installedRoot) };
    else if (patch) s.newer = this.mode === "auto" && this.o.canRestart ? { version: patch, taken: true, notes: notesOf(patch, this.installedRoot) } : { version: patch, taken: false, command: installCommand(this.installedRoot, patch), notes: notesOf(patch, this.installedRoot) };
    return s;
  }

  /** Begin: the first check soon after the server listens (unless one was made in the last hour),
   *  then one a day; the quiet moment looked for every minute. */
  start(): void {
    if (this.mode === "off") return;
    if (this.o.check) {
      const last = this.saved ? Date.parse(this.saved.checked) : NaN;
      const soon = !TEST_MS && Number.isFinite(last) && this.now() - last < 3600_000 ? last + CHECK_EVERY - this.now() : FIRST_CHECK;
      this.later(() => void this.checkLoop(), Math.max(FIRST_CHECK, soon));
    }
    const look = setInterval(() => void this.look(), LOOK_EVERY);
    look.unref();
    this.timers.push(look);
    // a patch downloaded by this server before it restarted for another reason is taken as well
    const kept = this.found().patch;
    if (kept && this.mode === "auto" && this.versions.ready().includes(kept)) this.pending = { version: kept, since: this.now() };
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private later(f: () => void, ms: number): void {
    const t = setTimeout(f, ms);
    t.unref();
    this.timers.push(t);
  }

  private async checkLoop(): Promise<void> {
    await this.check();
    this.later(() => void this.checkLoop(), CHECK_EVERY + Math.random() * JITTER);
  }

  /** Ask the registry (UpdateSpec decision 1): the versions, and the engines of the newest beyond
   *  this one; then, under auto, download the patch this server may take. */
  async check(): Promise<void> {
    const ask = this.o.npm ?? npm;
    const r = await registryVersions(ask);
    if ("why" in r) {
      this.o.log(`updates: the registry could not be asked (${r.why}); asked again in a day`);
      return;
    }
    const engines: Record<string, string> = { ...(this.saved?.engines ?? {}) };
    const bad = new Set(this.versions.bad().keys());
    // the newest beyond this one, in its minor and beyond it: what their Node needs
    const beyond = r.versions.filter((v) => newerThan(v, this.running));
    for (const v of [newest(beyond.filter((x) => sameMinor(x, this.running) && !bad.has(x))), newest(beyond)]) {
      if (!v || Object.hasOwn(engines, v)) continue;
      const e = await registryEngines(v, ask);
      if (e !== null) engines[v] = e;
    }
    this.saved = { checked: new Date(this.now()).toISOString(), versions: r.versions, engines };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp-${process.pid}`, JSON.stringify(this.saved));
      renameSync(`${this.file}.tmp-${process.pid}`, this.file);
    } catch {
      // kept in memory: asked again at the next start
    }
    const { patch, release } = this.found();
    if (release && !sameMinor(release, this.running)) this.o.log(`updates: VisualProof ${release} is out (this is ${this.running}): it is installed by ${installCommand(this.installedRoot, release)}, which this server then restarts into by itself`);
    else if (!patch) {
      const out = newest(beyond);
      this.o.log(out ? `updates: VisualProof ${out} is out, but needs Node ${engines[out] ?? "another"}; this is ${process.versions.node}` : `updates: VisualProof ${this.running} is the latest`);
    }
    if (patch) {
      if (this.mode === "auto" && this.o.canRestart) await this.download(patch);
      else this.o.log(`updates: VisualProof ${patch} is out (this is ${this.running}): ${installCommand(this.installedRoot, patch)}`);
    }
    this.o.changed?.();
  }

  /** Download patch `v` into the cache, unless it is there; once ready, it waits for a quiet moment. */
  private async download(v: string): Promise<void> {
    if (this.downloading || this.pending?.version === v) return;
    this.downloading = true;
    try {
      if (!this.versions.ready().includes(v)) {
        this.o.log(`updates: VisualProof ${v} is out (this is ${this.running}): downloading it into ${this.versions.root}`);
        const why = await this.versions.fetch(v, this.o.npm ?? npm);
        if (why) {
          this.o.log(`updates: VisualProof ${v} could not be downloaded: ${why}; tried again at the next check`);
          return;
        }
      }
      this.pending = { version: v, since: this.now() };
      this.o.log(`updates: VisualProof ${v} is ready; this server restarts into it when nobody is on a page and nothing runs, within a day`);
      // what is kept: the version that runs, and the one ready; the one before goes at the next restart
      this.versions.prune([this.running, v]);
    } finally {
      this.downloading = false;
    }
  }

  /** Every minute: the installed package changed on disk (an `npm install` while this ran), or a
   *  patch is ready; restart into it at a quiet moment, or once it waited its longest. */
  async look(): Promise<void> {
    if (this.restarting || !this.o.canRestart) return;
    const now = this.now();
    const installed = versionAt(this.installedRoot);
    if (installed !== this.installedAtStart) this.installedChanged ??= now;
    else this.installedChanged = null;
    let to: string | null = null;
    if (this.installedChanged !== null) {
      if (installed && (this.o.quiet() || now - this.installedChanged >= INSTALLED_WAIT)) to = codeToRun(this.installedRoot, this.versions, this.o.node).version;
    } else if (this.pending && this.mode === "auto") {
      if (this.o.quiet() || now - this.pending.since >= PATCH_WAIT) to = this.pending.version;
    }
    if (to === null) return;
    this.restarting = true;
    this.o.log(`updates: restarting into VisualProof ${to}`);
    this.o.restart(to);
  }
}
