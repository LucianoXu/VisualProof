// VisualProof's own releases, as a running server follows them (UpdateSpec.md): which versions npm
// has, which of them this server may take by itself (a patch of the minor it runs, UpdateSpec
// decision 3) and which it only tells of (a newer minor, decision 4), the patches downloaded beside
// the installed package (`versions/` in the caches' root, decision 5), and the quiet moment a server restarts
// into one (decision 6).
//
// The registry is asked through npm itself, the npm beside the Node that runs the server, so that
// the user's registry, proxy and certificates hold as for any `npm install` (decision 1). What npm
// is asked: the versions of `visualproof` and the engines of the newest ones; nothing of the project.
//
// In the root of the caches (`--cache`, else the cache home), which every server of the user may
// share — so that each folder below is one server's to make and every server's to read:
//
//   updates.json                   the last check: when, the versions found, the engines asked
//   versions/                      this user's alone (0700): it holds code the servers run
//   versions/<v>/                  a patch downloaded: an npm prefix holding visualproof@<v>
//   versions/<v>/ready             written once it was checked to run (`--version` says <v>) on a
//                                  Node its engines allow
//   versions/<v>/running-<pid>     a server running it: never removed while that process lives
//   versions/.<v>.tmp-<pid>        a download under way (that process's; removed once it is gone)
//   versions/bad.json              versions set aside (decision 7): each with when and why

import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { childEnv, tracked } from "./children.ts";
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
  /** the versions set aside on this machine (UpdateSpec decision 7): when, and why */
  setAside?: { version: string; at: string; why: string }[];
  /** a checkout's server (UpdateSpec decision 13): its updates are git's; nothing is asked, so
   *  there is no mode */
  checkout?: true;
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
export function choose(running: string, versions: string[], o: { bad?: Set<string>; engines?: (v: string) => string | undefined; deprecated?: Set<string>; node?: string } = {}): { patch: string | null; release: string | null } {
  const node = o.node ?? process.versions.node;
  const runs = (v: string) => {
    const e = o.engines?.(v);
    return e === undefined || satisfies(node, e);
  };
  // a release its publisher deprecated (`npm deprecate`) is neither taken nor told of
  const beyond = versions.filter((v) => newerThan(v, running) && runs(v) && !o.deprecated?.has(v));
  return {
    patch: newest(beyond.filter((v) => sameMinor(v, running) && !o.bad?.has(v))),
    release: newest(beyond),
  };
}

// ---------------------------------------------------------------- npm

export type NpmResult = { ok: true; out: string } | { ok: false; why: string };
/** npm, asked something: what it printed, or why it failed. */
export type Npm = (args: string[], timeoutMs?: number) => Promise<NpmResult>;

/** npm as the Node that runs this server runs it: npm's own script under this Node, not the `npm`
 *  command, which runs under whatever Node is first on the PATH; else that command. The script is
 *  where the `npm` beside this Node leads (a link to it, as every layout below makes one), else
 *  where Node's own layouts keep it, beside this Node's binary or the one a link of it leads to:
 *  `<prefix>/lib/node_modules/npm` (Node's installers, nvm, a Homebrew prefix), or the keg's
 *  `<Cellar>/node/<version>/libexec/lib/node_modules/npm` (Homebrew's node formula, whose binary
 *  `process.execPath` names in the Cellar). */
export function npmCommand(execPath = process.execPath): { cmd: string; args: string[] } {
  const real = (p: string): string | null => {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  };
  const bins = [...new Set([dirname(execPath), dirname(real(execPath) ?? execPath)])];
  const tail = ["node_modules", "npm", "bin", "npm-cli.js"];
  const candidates = [
    ...bins.map((b) => real(join(b, "npm"))).filter((p): p is string => !!p && p.endsWith("npm-cli.js")),
    ...bins.flatMap((b) => [join(b, "..", "lib", ...tail), join(b, "..", "libexec", "lib", ...tail)]),
  ];
  const cli = candidates.find((c) => existsSync(c));
  return cli ? { cmd: execPath, args: [cli] } : { cmd: "npm", args: [] };
}

/** npm as a child of this server (server/children.ts), run in `cwd` (the versions' folder, so that
 *  no `.npmrc` of the project's folder, nor of wherever the server was started, applies), without
 *  its own nags and without the server's own variables. */
export function npmIn(cwd: string): Npm {
  return (args, timeoutMs = 120_000) =>
    new Promise((resolve) => {
      const { cmd, args: pre } = npmCommand();
      const env = childEnv({ npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" });
      tracked(
        execFile(cmd, [...pre, ...args], { cwd, timeout: timeoutMs, maxBuffer: 16 << 20, env, encoding: "utf8" }, (err, stdout, stderr) => {
          if (!err) return resolve({ ok: true, out: stdout });
          const said = `${stderr}`.split("\n").find((l) => /npm (error|ERR!)/.test(l) && !/A complete log/.test(l));
          resolve({ ok: false, why: said?.replace(/^npm (error|ERR!)\s*/, "").trim() || (err.killed ? "npm took too long" : err.message.split("\n")[0]) });
        }),
      );
    });
}

/** The versions of visualproof npm has: every release, or why npm could not say. */
export async function registryVersions(ask: Npm): Promise<{ versions: string[] } | { why: string }> {
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
export async function registryEngines(v: string, ask: Npm): Promise<string | null> {
  return (await registryInfo(v, ask))?.engines ?? null;
}

/** What npm says of a version's `engines` and `deprecated` (`npm view visualproof@<v> engines
 *  deprecated --json`), as it says it: the engines object alone where the version is not deprecated,
 *  the message alone where it has no engines, both by name where it has both. The Node range ("":
 *  anywhere), and the deprecation's message or null. */
export function readInfo(out: string): { engines: string; deprecated: string | null } | null {
  let v: unknown;
  try {
    v = out.trim() ? JSON.parse(out) : {};
  } catch {
    return null;
  }
  const node = (e: unknown) => (e && typeof e === "object" && typeof (e as { node?: unknown }).node === "string" ? (e as { node: string }).node : "");
  if (typeof v === "string") return { engines: "", deprecated: v };
  if (!v || typeof v !== "object") return null;
  if ("engines" in v || "deprecated" in v) {
    const d = (v as { deprecated?: unknown }).deprecated;
    return { engines: node((v as { engines?: unknown }).engines), deprecated: typeof d === "string" && d ? d : null };
  }
  return { engines: node(v), deprecated: null };
}

/** A version's Node range and deprecation, or null when npm cannot say. */
export async function registryInfo(v: string, ask: Npm): Promise<{ engines: string; deprecated: string | null } | null> {
  const r = await ask(["view", `visualproof@${v}`, "engines", "deprecated", "--json"], 60_000);
  return r.ok ? readInfo(r.out) : null;
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

/** Failures of one kind recorded for a version: the last one's when and why, and how many. */
interface Strikes {
  at: string;
  why: string;
  times: number;
}

/** What is recorded of a version's failures (Versions.records). */
interface Failures {
  early?: Strikes;
  sites?: Record<string, Strikes>;
  takenBack?: string;
}

/** Whether process `pid` lives (EPERM: it does, another user's). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether a folder is this user's alone to write: owned by them, neither group nor others may write
 *  it (UpdateSpec decision 12). Where there are no users (Windows), any. */
function private_(dir: string): boolean {
  try {
    const st = statSync(dir);
    if (typeof process.getuid !== "function") return st.isDirectory();
    return st.isDirectory() && st.uid === process.getuid() && (st.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

/** Run the server's code at `main` with `--version`, as a child the server stops with itself: what
 *  it says, or why it said nothing. */
function versionOf(node: string, main: string): Promise<{ out: string } | { why: string }> {
  return new Promise((resolve) => {
    tracked(
      execFile(node, [main, "--version"], { timeout: 30_000, encoding: "utf8", env: childEnv() }, (err, stdout, stderr) => {
        if (!err) return resolve({ out: stdout.trim() });
        resolve({ why: (stderr || stdout || err.message).trim().split("\n")[0] || (err.killed ? "it took too long" : "it failed") });
      }),
    );
  });
}

/** The versions downloaded beside the installed package (UpdateSpec decision 5), in a folder every
 *  server of the user may share: each one downloads into a folder of its own and moves it into
 *  place only where none is there yet, marks the version it runs, and removes only what no living
 *  server runs, of its own minor, older than the one it would step back to. */
export class Versions {
  readonly root: string;

  constructor(cacheRoot: string) {
    this.root = join(cacheRoot, "versions");
  }

  /** The folder made where it is not, this user's alone (0700); why it cannot be used, else null. */
  ensure(): string | null {
    try {
      if (!existsSync(this.root)) {
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
        chmodSync(this.root, 0o700);
      }
    } catch (e) {
      return `${this.root} cannot be made: ${(e as Error).message}`;
    }
    return private_(this.root) ? null : `${this.root} is not this user's alone (another owns it, or others may write it): no patch is taken from it`;
  }

  /** the package of version `v`, as npm installed it into its prefix */
  packageOf(v: string): string {
    return join(this.root, v, "node_modules", "visualproof");
  }

  mainOf(v: string): string {
    return join(this.packageOf(v), "dist", "server", "main.js");
  }

  /** The versions downloaded and checked to run, in folders this user alone may write. */
  ready(): string[] {
    if (!private_(this.root)) return [];
    let names: string[] = [];
    try {
      names = readdirSync(this.root);
    } catch {
      return [];
    }
    return names.filter((v) => {
      if (!stable(v) || !private_(join(this.root, v))) return false;
      try {
        return readFileSync(join(this.root, v, "ready"), "utf8").trim() === v && existsSync(this.mainOf(v));
      } catch {
        return false;
      }
    });
  }

  /** What the servers sharing this folder recorded of each version's failures (UpdateSpec decision
   *  7): before it served (`early`: about the version, whichever site saw it), soon after it served
   *  (`sites`: by the site that saw it, which may be about that project alone), and when it was taken
   *  back (the fault was found elsewhere). What was recorded is kept, taken back or not. */
  records(): Map<string, Failures> {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(join(this.root, "bad.json"), "utf8")) as Record<string, unknown>;
    } catch {
      return new Map();
    }
    const strikes = (e: unknown): Strikes | undefined => {
      const x = e as { at?: unknown; why?: unknown; times?: unknown } | null;
      if (!x || typeof x !== "object" || typeof x.why !== "string") return undefined;
      return { at: String(x.at ?? ""), why: x.why, times: Number.isInteger(x.times) && (x.times as number) > 0 ? (x.times as number) : 1 };
    };
    const out = new Map<string, Failures>();
    for (const [v, e] of Object.entries(raw)) {
      if (!stable(v) || !e || typeof e !== "object") continue;
      const r = e as { early?: unknown; sites?: unknown; takenBack?: unknown; why?: unknown };
      // a record of before (one mark per version) reads as a failure before it served
      const early = strikes(r.early) ?? (typeof r.why === "string" ? strikes(r) : undefined);
      const sites: Record<string, Strikes> = {};
      if (r.sites && typeof r.sites === "object") for (const [k, x] of Object.entries(r.sites)) if (strikes(x)) sites[k] = strikes(x)!;
      out.set(v, { ...(early ? { early } : {}), ...(Object.keys(sites).length ? { sites } : {}), ...(typeof r.takenBack === "string" ? { takenBack: r.takenBack } : {}) });
    }
    return out;
  }

  /** Whether `v` is set aside now for a server of `site` (null: whichever site; only what is
   *  shared): a failure before it served, or soon after on this site, or soon after on two sites,
   *  each for a day after it, and for good once recorded SET_ASIDE_TIMES times; nothing recorded
   *  before it was taken back. Why, where it is; else null. */
  heldWhy(v: string, site: string | null, now = Date.now(), r = this.records().get(v)): string | null {
    if (!r) return null;
    const back = r.takenBack ? Date.parse(r.takenBack) : -Infinity;
    const holds = (x: Strikes | undefined) => {
      if (!x) return false;
      const at = Date.parse(x.at);
      if (Number.isFinite(at) && at <= back) return false;
      return x.times >= SET_ASIDE_TIMES || !Number.isFinite(at) || now - at < SET_ASIDE_FOR;
    };
    if (holds(r.early)) return r.early!.why;
    const sites = Object.entries(r.sites ?? {}).filter(([, x]) => holds(x));
    const mine = site === null ? undefined : sites.find(([k]) => k === site);
    if (mine) return mine[1].why;
    if (sites.length >= 2) return `${sites[0][1].why}, on ${sites.length} sites`;
    return null;
  }

  /** The versions set aside now for a server of `site` (heldWhy). */
  setAside(now = Date.now(), site: string | null = null): Set<string> {
    const out = new Set<string>();
    for (const [v, r] of this.records()) if (this.heldWhy(v, site, now, r) !== null) out.add(v);
    return out;
  }

  /** What is set aside now for `site`, with when and why: what servers and the doctor say. */
  reasons(now = Date.now(), site: string | null = null): { version: string; at: string; why: string }[] {
    const out: { version: string; at: string; why: string }[] = [];
    for (const [v, r] of this.records()) {
      const why = this.heldWhy(v, site, now, r);
      if (why === null) continue;
      const ats = [r.early?.at, ...Object.values(r.sites ?? {}).map((x) => x.at)].filter((x): x is string => !!x).sort();
      out.push({ version: v, at: ats.at(-1) ?? "", why });
    }
    return out;
  }

  /** Write the records, as one file moved into place; false where it cannot be written (a full
   *  disk): the caller goes on, without the record. */
  private writeRecords(all: Map<string, Failures>): boolean {
    if (this.ensure()) return false;
    const f = join(this.root, "bad.json");
    try {
      writeFileSync(`${f}.tmp-${process.pid}`, JSON.stringify(Object.fromEntries(all), null, 1));
      renameSync(`${f}.tmp-${process.pid}`, f);
      return true;
    } catch {
      try {
        unlinkSync(`${f}.tmp-${process.pid}`);
      } catch {
        // not there
      }
      return false;
    }
  }

  /** Record a failure of `v`: before it served (`site` null, shared by every site), or soon after
   *  it served on `site`. False where the record could not be written. */
  markBad(v: string, why: string, site: string | null = null, now = Date.now()): boolean {
    const all = this.records();
    const r: Failures = { ...(all.get(v) ?? {}) };
    const add = (x: Strikes | undefined): Strikes => ({ at: new Date(now).toISOString(), why, times: (x?.times ?? 0) + 1 });
    if (site === null) r.early = add(r.early);
    else r.sites = { ...(r.sites ?? {}), [site]: add(r.sites?.[site]) };
    all.set(v, r);
    return this.writeRecords(all);
  }

  /** Take `v` back from those set aside: the fault was found elsewhere. What was recorded stays,
   *  counted toward its setting aside for good. False where it could not be written. */
  unmarkBad(v: string, now = Date.now()): boolean {
    const all = this.records();
    const r = all.get(v);
    if (!r) return true;
    all.set(v, { ...r, takenBack: new Date(now).toISOString() });
    return this.writeRecords(all);
  }

  /** Where a site's server stopped taking patches (UpdateSpec decision 7): its versions up to
   *  `upTo` are not run for it, so that it runs the installed package until a newer patch is out. */
  paused(site: string | null): { upTo: string; at: string; why: string } | null {
    if (site === null) return null;
    try {
      const all = JSON.parse(readFileSync(join(this.root, "paused.json"), "utf8")) as Record<string, { upTo?: unknown; at?: unknown; why?: unknown }>;
      const p = Object.hasOwn(all, site) ? all[site] : null;
      return p && typeof p.upTo === "string" && stable(p.upTo) ? { upTo: p.upTo, at: String(p.at ?? ""), why: String(p.why ?? "") } : null;
    } catch {
      return null;
    }
  }

  /** Stop taking `site`'s patches up to `upTo` (they failed, and so did the version before them):
   *  it runs the installed package until a newer patch is out. False where it cannot be written. */
  pause(site: string, upTo: string, why: string, now = Date.now()): boolean {
    if (this.ensure()) return false;
    const f = join(this.root, "paused.json");
    let all: Record<string, unknown> = {};
    try {
      all = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
    } catch {
      // none yet
    }
    all[site] = { upTo, at: new Date(now).toISOString(), why };
    try {
      writeFileSync(`${f}.tmp-${process.pid}`, JSON.stringify(all, null, 1));
      renameSync(`${f}.tmp-${process.pid}`, f);
      return true;
    } catch {
      return false;
    }
  }

  /** The versions the last check found deprecated by their publisher (updates.json, in the caches'
   *  root): never run. */
  deprecated(): Set<string> {
    try {
      const d = (JSON.parse(readFileSync(join(dirname(this.root), "updates.json"), "utf8")) as { deprecated?: unknown }).deprecated;
      return new Set(d && typeof d === "object" ? Object.keys(d) : []);
    } catch {
      return new Set();
    }
  }

  /** Mark version `v` as run by process `pid` (the supervisor, as it starts it); false where it
   *  cannot be marked. */
  markRunning(v: string, pid: number): boolean {
    try {
      writeFileSync(join(this.root, v, `running-${pid}`), `${pid}\n`);
      return true;
    } catch {
      return false;
    }
  }

  /** The mark of process `pid` on `v` taken off: it ended. */
  unmarkRunning(v: string, pid: number): void {
    try {
      unlinkSync(join(this.root, v, `running-${pid}`));
    } catch {
      // gone already
    }
  }

  /** Whether a living server runs version `v`, or downloads it. */
  inUse(v: string): boolean {
    let names: string[] = [];
    try {
      names = readdirSync(join(this.root, v));
    } catch {
      return false;
    }
    return names.some((n) => {
      const m = /^running-(\d+)$/.exec(n);
      return !!m && alive(Number(m[1]));
    });
  }

  /** Download version `v` (npm checks what it downloads against the registry's integrity), check
   *  that it runs on this Node (its engines) and says it is `v`, and mark it ready: into a folder of
   *  its own first, moved into place only where no other server put one meanwhile (whose finished
   *  copy is as good). Null when it is ready, else why not. */
  async fetch(v: string, ask: Npm, node = process.execPath, nodeVersion = process.versions.node): Promise<string | null> {
    if (!stable(v)) return `${v} is not a release`;
    const bad = this.ensure();
    if (bad) return bad;
    if (this.ready().includes(v)) return null;
    this.sweep();
    const work = join(this.root, `.${v}.tmp-${process.pid}`);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { mode: 0o700 });
    try {
      const r = await ask(["install", `--prefix=${work}`, "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", `visualproof@${v}`], 600_000);
      if (!r.ok) return `npm could not install it: ${r.why}`;
      const pkg = join(work, "node_modules", "visualproof");
      const main = join(pkg, "dist", "server", "main.js");
      if (!existsSync(main)) return "npm installed it without its server";
      let engines: string | undefined;
      try {
        engines = (JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as { engines?: { node?: string } }).engines?.node;
      } catch {
        return "its package.json cannot be read";
      }
      if (!satisfies(nodeVersion, engines)) return `it needs Node ${engines}; this is ${nodeVersion}`;
      const says = await versionOf(node, main);
      if ("why" in says || says.out !== v) return `it does not run here (${"why" in says ? says.why : `it says it is ${says.out || "nothing"}`})`;
      writeFileSync(join(work, "ready"), `${v}\n`);
      try {
        renameSync(work, join(this.root, v));
      } catch {
        // another server's copy is there: as good, once it is whole
        if (!this.ready().includes(v)) return `${join(this.root, v)} is there, and not ready`;
      }
      return null;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /** Remove the downloads left by servers that died midway. */
  sweep(): void {
    let names: string[] = [];
    try {
      names = readdirSync(this.root);
    } catch {
      return;
    }
    for (const n of names) {
      const m = /^\.(.+)\.tmp-(\d+)$/.exec(n);
      if (m && !alive(Number(m[2]))) rmSync(join(this.root, n), { recursive: true, force: true });
    }
  }

  /** Remove the versions of `running`'s minor older than the one it would step back to (the newest
   *  ready one before it), that no living server runs; other minors are other servers' to keep. */
  prune(running: string): void {
    this.sweep();
    const mine = this.ready().filter((v) => sameMinor(v, running));
    const before = newest(mine.filter((v) => newerThan(running, v)));
    for (const v of mine) {
      if (!newerThan(running, v) || v === before || this.inUse(v)) continue;
      rmSync(join(this.root, v), { recursive: true, force: true });
    }
  }
}

/** What chooses the code a supervisor runs, beside the folders. */
export interface RunOptions {
  node?: string;
  /** --updates: under notify, the installed package alone (decision 2) */
  mode?: UpdateMode;
  /** the site the server serves: what is set aside for it, where its patches are paused */
  site?: string | null;
  /** versions set aside meanwhile that could not be recorded (a full disk) */
  also?: Set<string>;
  now?: number;
}

/** The code a supervisor runs (UpdateSpec decision 5): the installed package's, or — under auto —
 *  the newest version downloaded of its minor that is newer, ready, runs on this Node, is neither
 *  set aside for this site nor deprecated, and is past where this site's patches were paused. */
export function codeToRun(installedRoot: string, versions: Versions, o: RunOptions = {}): { main: string; version: string; cached: boolean } {
  const installed = versionAt(installedRoot) ?? "0.0.0";
  const own = { main: join(installedRoot, "dist", "server", "main.js"), version: installed, cached: false };
  if (o.mode !== undefined && o.mode !== "auto") return own;
  const site = o.site ?? null;
  const bad = versions.setAside(o.now ?? Date.now(), site);
  const deprecated = versions.deprecated();
  const paused = versions.paused(site);
  let best: string | null = null;
  for (const v of versions.ready()) {
    if (!sameMinor(v, installed) || !newerThan(v, installed) || bad.has(v) || o.also?.has(v) || deprecated.has(v)) continue;
    if (paused && !newerThan(v, paused.upTo)) continue;
    const engines = (() => {
      try {
        return (JSON.parse(readFileSync(join(versions.packageOf(v), "package.json"), "utf8")) as { engines?: { node?: string } }).engines?.node;
      } catch {
        return undefined;
      }
    })();
    if (!satisfies(o.node ?? process.versions.node, engines)) continue;
    if (best === null || newerThan(v, best)) best = v;
  }
  return best ? { main: versions.mainOf(best), version: best, cached: true } : own;
}

// ---------------------------------------------------------------- a server following its releases

/** VISUALPROOF_UPDATE_TEST_MS, for the tests of the update path alone (scripts/test-updates.mjs):
 *  every wait below that many milliseconds, the longest five times it. Honoured only where npm's
 *  registry is one on this machine (npm_config_registry a loopback address), as the test's is and a
 *  server's never is. */
const TEST_MS = Number(process.env.VISUALPROOF_UPDATE_TEST_MS) > 0 && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(process.env.npm_config_registry ?? "") ? Number(process.env.VISUALPROOF_UPDATE_TEST_MS) : 0;
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
/** a version that failed is set aside for a day, then tried again; for good after three times */
export const SET_ASIDE_FOR = TEST_MS * 600 || 24 * 3600_000;
export const SET_ASIDE_TIMES = 3;

interface Saved {
  checked: string;
  versions: string[];
  engines: Record<string, string>;
  /** the versions found deprecated, with the publisher's message */
  deprecated?: Record<string, string>;
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
  /** a checkout's server, which follows no releases (UpdateSpec decision 13) */
  checkout?: boolean;
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
  /** the site this server serves: what is set aside or paused for it (UpdateSpec decision 7) */
  site?: string | null;
  npm?: Npm;
  node?: string;
  /** the Node binary this server runs on, which the supervisor starts the next one with */
  execPath?: string;
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
  /** npm, run in the versions' folder (else the caches' root, where that folder cannot be used) */
  private npm: Npm;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private restarting = false;
  /** said once: the Node this server runs on is gone */
  private nodeGone = false;

  constructor(o: UpdatesOptions) {
    this.o = o;
    this.mode = o.mode;
    this.running = o.running ?? packageVersion();
    this.installedRoot = o.installedRoot ?? PACKAGE_ROOT;
    this.versions = new Versions(o.cacheRoot);
    this.file = join(o.cacheRoot, "updates.json");
    this.now = o.now ?? Date.now;
    this.installedAtStart = versionAt(this.installedRoot);
    this.npm = o.npm ?? npmIn(this.versions.ensure() === null ? this.versions.root : o.cacheRoot);
    try {
      const s = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Saved>;
      if (typeof s.checked === "string" && Array.isArray(s.versions)) this.saved = { checked: s.checked, versions: s.versions.filter((v) => typeof v === "string"), engines: s.engines && typeof s.engines === "object" ? s.engines : {}, ...(s.deprecated && typeof s.deprecated === "object" ? { deprecated: s.deprecated } : {}) };
    } catch {
      // never checked here, or the file is unreadable: asked again
    }
  }

  /** The versions newer than this one that it may take, and tell of, as last found. */
  /** The patch this server may take and the release it may tell of, as the last check found them:
   *  only versions whose engines and deprecation npm said (one it could not say of waits for the
   *  next check), neither set aside for this site nor at or below where its patches are paused. */
  private found(): { patch: string | null; release: string | null } {
    if (!this.saved) return { patch: null, release: null };
    const e = this.saved.engines;
    const paused = this.versions.paused(this.o.site ?? null);
    const known = this.saved.versions.filter((v) => Object.hasOwn(e, v));
    const r = choose(this.running, known, { bad: this.versions.setAside(this.now(), this.o.site ?? null), engines: (v) => e[v], deprecated: new Set(Object.keys(this.saved.deprecated ?? {})), node: this.o.node });
    return { ...r, patch: r.patch && paused && !newerThan(r.patch, paused.upTo) ? null : r.patch };
  }

  /** What a page is told (UpdateSpec decision 11): the version alone where `full` is not. */
  status(full: boolean): UpdateStatus {
    if (!full) return { running: this.running };
    if (this.o.checkout) return { running: this.running, checkout: true };
    const installed = versionAt(this.installedRoot);
    const { patch, release } = this.found();
    const s: UpdateStatus = { running: this.running, mode: this.mode, ...(installed && installed !== this.running ? { installed } : {}), ...(this.saved ? { checked: this.saved.checked } : {}) };
    // a newer minor, which needs someone, is told before a patch this server takes by itself
    if (release && !sameMinor(release, this.running)) s.newer = { version: release, taken: false, command: installCommand(this.installedRoot, release), notes: notesOf(release, this.installedRoot) };
    else if (patch) s.newer = this.mode === "auto" && this.o.canRestart ? { version: patch, taken: true, notes: notesOf(patch, this.installedRoot) } : { version: patch, taken: false, command: installCommand(this.installedRoot, patch), notes: notesOf(patch, this.installedRoot) };
    const bad = this.versions.reasons(this.now(), this.o.site ?? null);
    if (bad.length) s.setAside = bad;
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

  /** A check, then the next a day on, whatever this one met. */
  private async checkLoop(): Promise<void> {
    try {
      await this.check();
    } catch (e) {
      this.o.log(`updates: the check failed: ${e instanceof Error ? e.message : String(e)}; asked again in a day`);
    } finally {
      this.later(() => void this.checkLoop(), CHECK_EVERY + Math.random() * JITTER);
    }
  }

  /** Ask the registry (UpdateSpec decision 1): the versions, and the engines of the newest beyond
   *  this one; then, under auto, download the patch this server may take. */
  async check(): Promise<void> {
    const ask = this.npm;
    const r = await registryVersions(ask);
    if ("why" in r) {
      this.o.log(`updates: the registry could not be asked (${r.why}); asked again in a day`);
      return;
    }
    const engines: Record<string, string> = {};
    const deprecated: Record<string, string> = {};
    /** versions npm could not say of: not taken now, asked again at the next check */
    const unknown = new Set<string>();
    const bad = this.versions.setAside(this.now(), this.o.site ?? null);
    // the newest beyond this one, in its minor and beyond it: what their Node needs, and whether
    // their publisher deprecated them — asked afresh, newest first, until one is fit (a few at most)
    const beyond = r.versions.filter((v) => newerThan(v, this.running));
    const descending = (vs: string[]) => [...vs].sort((a, b) => (newerThan(a, b) ? -1 : newerThan(b, a) ? 1 : 0));
    for (const list of [descending(beyond.filter((x) => sameMinor(x, this.running) && !bad.has(x))), descending(beyond)]) {
      for (const v of list.slice(0, 5)) {
        if (unknown.has(v)) break;
        if (!Object.hasOwn(engines, v)) {
          const info = await registryInfo(v, ask);
          if (info === null) {
            // nothing older is taken in its place: it may be the newest, which a later check finds
            unknown.add(v);
            break;
          }
          engines[v] = info.engines;
          if (info.deprecated) deprecated[v] = info.deprecated;
        }
        if (!Object.hasOwn(deprecated, v) && satisfies(this.o.node ?? process.versions.node, engines[v])) break;
      }
    }
    this.saved = { checked: new Date(this.now()).toISOString(), versions: r.versions, engines, ...(Object.keys(deprecated).length ? { deprecated } : {}) };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp-${process.pid}`, JSON.stringify(this.saved));
      renameSync(`${this.file}.tmp-${process.pid}`, this.file);
    } catch {
      // kept in memory: asked again at the next start
    }
    const { patch, release } = this.found();
    if (release && !sameMinor(release, this.running)) this.o.log(`updates: VisualProof ${release} is out (this is ${this.running}; ${notesOf(release, this.installedRoot)}): it is installed by ${installCommand(this.installedRoot, release)}, which this server then restarts into by itself`);
    else if (!patch) {
      const out = newest(beyond);
      const why = !out
        ? ""
        : bad.has(out)
          ? `set aside here: ${this.versions.heldWhy(out, this.o.site ?? null, this.now()) ?? "it failed"}`
          : unknown.has(out) || !Object.hasOwn(engines, out)
            ? "npm could not say what it needs; asked again at the next check"
            : Object.hasOwn(deprecated, out)
              ? `deprecated: ${deprecated[out]}`
              : `it needs Node ${engines[out]}; this is ${this.o.node ?? process.versions.node}`;
      this.o.log(out ? `updates: VisualProof ${out} is out, not taken: ${why}` : `updates: VisualProof ${this.running} is the latest`);
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
        const why = await this.versions.fetch(v, this.npm);
        if (why) {
          this.o.log(`updates: VisualProof ${v} could not be downloaded: ${why}; tried again at the next check`);
          return;
        }
      }
      this.pending = { version: v, since: this.now() };
      this.o.log(`updates: VisualProof ${v} is ready; this server restarts into it when nobody is on a page and nothing runs, within a day`);
      // what goes: this minor's versions older than the one this server would step back to
      this.versions.prune(this.running);
    } finally {
      this.downloading = false;
    }
  }

  /** Every minute: the installed package changed on disk (an `npm install` while this ran), or a
   *  patch is ready; restart into it at a quiet moment, or once it waited its longest — where the
   *  supervisor would run it (codeToRun says the same), and where this Node is still there to run it. */
  async look(): Promise<void> {
    if (this.restarting || !this.o.canRestart) return;
    const now = this.now();
    const installed = versionAt(this.installedRoot);
    if (installed !== this.installedAtStart) this.installedChanged ??= now;
    else this.installedChanged = null;
    const runs = (): string => codeToRun(this.installedRoot, this.versions, { node: this.o.node, mode: this.mode, site: this.o.site ?? null }).version;
    let to: string | null = null;
    if (this.installedChanged !== null) {
      if (!installed || !(this.o.quiet() || now - this.installedChanged >= INSTALLED_WAIT)) return;
      to = runs();
      // a package changed under the server, which runs a patch from the cache it still runs: its
      // files are not those that changed, and nothing changes for it
      if (to === this.running && PACKAGE_ROOT !== this.installedRoot) {
        this.installedAtStart = installed;
        this.installedChanged = null;
        return;
      }
    } else if (this.pending && this.mode === "auto") {
      if (!(this.o.quiet() || now - this.pending.since >= PATCH_WAIT)) return;
      to = this.pending.version;
      // what the supervisor would run is another: a newer one ready meanwhile is restarted into;
      // else (the download's own engines, set aside, paused) no restart, which would start this
      // one again
      const would = runs();
      if (would !== to) {
        if (!newerThan(would, this.running)) {
          this.o.log(`updates: VisualProof ${to} is downloaded, but the supervisor would run ${would}: not restarted`);
          this.pending = null;
          return;
        }
        to = would;
      }
    }
    if (to === null) return;
    // the Node this server runs on is gone (an upgrade of it removed it): nothing could start again
    if (!existsSync(this.o.execPath ?? process.execPath)) {
      if (!this.nodeGone) this.o.log(`updates: ${this.o.execPath ?? process.execPath} is gone (Node upgraded?): this server keeps running VisualProof ${this.running}; restart it to take ${to}`);
      this.nodeGone = true;
      return;
    }
    this.restarting = true;
    this.o.log(`updates: restarting into VisualProof ${to}`);
    this.o.restart(to);
  }
}
