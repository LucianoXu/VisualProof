// Following a branch of a git repository (SPEC/DeploySpec.md): `visualproof serve <git URL>`.
// The server keeps a clone of its own in the cache, one per URL and branch, never anyone's
// workspace; asks the remote for the branch's head every so often (`git ls-remote`); and builds
// each new head itself — fetched, checked out detached, Mathlib's cache got where the project is on
// Mathlib, `lake build` — one build at a time, in programs of their own (never the server's
// process), the newest head seen meanwhile the only one built after it. The live loop
// (server/live.ts) reads the build as it reads a workspace's, but only between builds: while one
// changes the tree, nothing is read from it, and the board on show stays the last build's.
//
// What is kept, in the deployment's folder of the cache (`<cache>/deploy/<repo>-<hash>/`): the
// clone (`clone/<repo>/`, whatever the repository is called), `state.json` (the commit the tree's
// outputs are of, the one checked out, the build going on, the last one that ended, the newest head
// seen), each build's log (`logs/`), and `.lock`: one server follows a branch with a cache at a
// time. A build cut short (a restart into a patch, a stop) is done again by the next server, Lake
// keeping what it finished.
//
// Git and Lake are run with argument arrays, never a shell; the address is checked against the
// schemes followed, the branch by git (`check-ref-format --branch`); nothing that git or Lake starts
// waits on a prompt; the credentials are git's own (an SSH key, a deploy key, a credential helper),
// and VisualProof keeps none.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import type { DeployBuild, DeployStatus, DeployStep } from "../shared/deploy.ts";
import { shortCommit, slimDeploy } from "../shared/deploy.ts";
import { childEnv, DETACH, end, grouped } from "./children.ts";
import { dataHome, lockSite, SiteBusy } from "./dirs.ts";
import type { HomeEnv } from "./dirs.ts";
import { buildTime, sourceAddress } from "./history.ts";
import { openProject, ProjectError } from "./project.ts";
import type { Project } from "./project.ts";

/** How often the remote is asked by default (DeploySpec decision 3). */
export const DEFAULT_POLL_MINUTES = 2;
/** the least `--poll` takes, in minutes */
export const MIN_POLL_MINUTES = 0.05;
/** a question to the remote is given up after this long */
const ASK_MS = 60_000;
/** a fetch, a checkout */
const GIT_MS = 10 * 60_000;
/** Mathlib's cache (`lake exe cache get`): it compiles the cache program first */
const CACHE_MS = 30 * 60_000;
/** `--build-timeout`: the hours of `lake build` past which the build is stopped and failed
 *  (DeploySpec decision 14), by default and the least and most it takes: fractions of an hour too */
export const DEFAULT_BUILD_HOURS = 6;
export const MIN_BUILD_HOURS = 0.05;
export const MAX_BUILD_HOURS = 168;
/** the most of a build's log kept for the pages, in lines and characters */
const TAIL_LINES = 60;
const TAIL_CHARS = 8000;
/** the lines of the build going on the pages are shown */
const LIVE_LINES = 6;
/** build logs kept, the newest */
const LOGS_KEPT = 30;

// ---------------------------------------------------------------- the address and the branch

/** A remote, as the server follows it. */
export interface Remote {
  /** the address as it was given, which git is handed */
  url: string;
  /** what git's protocol is: https, ssh (ssh:// or scp-like) or a repository on this machine */
  kind: "https" | "ssh" | "file";
  /** its host and path as a page may show it (server/history.ts, sourceAddress); null for a
   *  repository on this machine */
  source: string | null;
  /** `owner/repo` where the remote is github.com */
  github: string | null;
  /** the repository's name, for folders: its path's last part without `.git` */
  name: string;
}

/** Whether a project's place on the command line is a git address rather than a folder: a URL
 *  (`scheme://…`), or git's scp-like `[user@]host:path` (a colon before any slash). Anything else is
 *  a folder; a folder whose name has a colon is written `./a:b`. */
export function isGitAddress(arg: string): boolean {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(arg)) return true;
  return /^[^/\\:\s]+:/.test(arg) && !/^[A-Za-z]:[\\/]/.test(arg);
}

const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
const PATH = /^[\w.~/@+-]+$/;

/** A git address checked against what is followed (DeploySpec decision 10): `https://` without a
 *  user name or password in it, `ssh://` and scp-like (`git@host:path`), and `file://` for a
 *  repository on this machine; never `http://` (nothing checks what comes), `git://`, `ext::` or any
 *  other. The address, or why it is refused. */
export function parseRemote(arg: string): Remote | { error: string } {
  const no = (why: string) => ({ error: `${arg.slice(0, 200)}: ${why}` });
  if (!arg || arg.length > 2000 || /[\s\0-\x1f\x7f]/.test(arg)) return no("an address has no spaces or control characters");
  if (arg.startsWith("-")) return no("an address does not start with -");
  if (/(^|[/:])\.\.?(\/|$)/.test(arg)) return no("not a repository's path: no . or .. in it");
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(arg)?.[1].toLowerCase();
  let kind: Remote["kind"];
  let host = "";
  let path: string;
  if (scheme) {
    if (scheme === "http") return no("http:// is not followed: nothing checks what comes over it. Give the https:// address");
    if (scheme !== "https" && scheme !== "ssh" && scheme !== "file") return no(`${scheme}:// is not followed: give an https:// or ssh:// address, git's scp-like one (git@host:owner/repo.git), or file:// for a repository on this machine`);
    let u: URL;
    try {
      u = new URL(arg);
    } catch {
      return no("not an address");
    }
    if (u.search || u.hash) return no("an address has no query or fragment");
    if (scheme === "file") {
      if (u.host) return no("file:// names a repository on this machine: file:///its/absolute/path");
      kind = "file";
      path = decodeURIComponent(u.pathname);
      if (!path.startsWith("/") || path === "/") return no("file:// takes the repository's absolute path");
    } else {
      if (u.password || (scheme === "https" && u.username))
        return no("no user name, password or token in the address: VisualProof keeps no credential. Let git find it (an SSH key, a deploy key, a credential helper)");
      if (u.username && !/^[A-Za-z0-9._-]+$/.test(u.username)) return no("not a user name git takes");
      host = u.hostname;
      if (!HOST.test(host) && !/^\[[0-9A-Fa-f:.]+\]$/.test(host)) return no("not a host name");
      kind = scheme === "https" ? "https" : "ssh";
      path = decodeURIComponent(u.pathname);
    }
  } else {
    // scp-like, as git reads it: [user@]host:path
    const m = /^(?:([A-Za-z0-9._][A-Za-z0-9._-]*)@)?([^@/:]+):(.+)$/.exec(arg);
    if (!m) return no("not a git address: give https://host/owner/repo, ssh://… or git@host:owner/repo");
    if (!HOST.test(m[2])) return no("not a host name");
    host = m[2];
    path = m[3];
    if (path.startsWith("-")) return no("a path does not start with -");
    kind = "ssh";
  }
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  if (!parts.length || !PATH.test(path) || parts.some((p) => p === "..")) return no("not a repository's path");
  const name = (parts[parts.length - 1].replace(/\.git$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "") || "repository").slice(0, 60);
  const gh = kind !== "file" && /^(www\.)?github\.com$/i.test(host) && parts.length === 2 ? `${parts[0]}/${parts[1].replace(/\.git$/, "")}` : null;
  return { url: arg, kind, source: kind === "file" ? null : sourceAddress(arg), github: gh, name };
}

/** Why `name` is no branch to follow, or null: git's own check (`git check-ref-format --branch`),
 *  after refusing what that check would read otherwise (`@{-1}`, the branch checked out before). */
export function branchProblem(name: string): string | null {
  const no = `${name.slice(0, 200)} is not a branch name git takes (git check-ref-format --branch)`;
  if (!name || name.length > 255 || name.startsWith("-") || name.includes("@{") || /[\s\0-\x1f\x7f]/.test(name)) return no;
  const r = spawnSync("git", ["check-ref-format", "--branch", name], { cwd: tmpdir(), encoding: "utf8", timeout: 10_000, env: gitBase() });
  if (r.error) return `git could not be run (${r.error.message}): following a branch needs git`;
  return r.status === 0 && r.stdout.trim() === name ? null : no;
}

// ---------------------------------------------------------------- how long a build may take

/** `--build-timeout <hours>` read (DeploySpec decision 14): the hours, or why they are refused. */
export function parseBuildHours(v: string): number | { error: string } {
  const h = Number(v);
  if (/^\d+(\.\d+)?$/.test(v) && h >= MIN_BUILD_HOURS && h <= MAX_BUILD_HOURS) return h;
  return { error: `--build-timeout ${v.slice(0, 40)}: say after how many hours a build is stopped, from ${MIN_BUILD_HOURS} (3 min) to ${MAX_BUILD_HOURS} (a week); 1.5 is an hour and a half` };
}

/** A build's limit as it is said: `6 hours`, `1 hour`, `1 h 30 min`, `3 min`, `4 min 12 s`. */
export function limitInWords(ms: number): string {
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(1))} s`;
  const s = Math.round(ms / 1000);
  if (s % 3600 === 0) return s === 3600 ? "1 hour" : `${s / 3600} hours`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : "", r ? `${r} s` : ""].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- where it is kept

/** A deployment's name among the others: the repository's name and a hash of the address and the
 *  branch. */
export function deployKey(remote: Remote, branch: string): string {
  return `${remote.name}-${createHash("sha1").update(`${remote.url}\0${branch}`).digest("hex").slice(0, 8)}`;
}

/** A deployment's folder in the caches' root: the clone (the project the server shows), what is
 *  known of its builds, their logs, and Mathlib's cache where it is the deployment's own. */
export interface DeployFolder {
  dir: string;
  checkout: string;
  state: string;
  logs: string;
  mathlib: string;
}

/** What the deployment's folder keeps of its own beside the clone of 0.5.0, which was named after
 *  its repository there (DeploySpec decision 2): a repository named so is moved out of their way. */
const OWN = /^(?:logs|mathlib-cache|state\.json(?:\.tmp-\d+)?)$/;

/** The deployment's folder: the clone in `clone/<repo>/`, apart from what the folder keeps of its
 *  own, whatever the repository is called (DeploySpec decision 2); a clone made by 0.5.0, named
 *  after its repository beside them, is kept where it is — never cloned again — unless its name is
 *  one of theirs (ensureClone moves it). */
export function deployFolder(cacheRoot: string, remote: Remote, branch: string): DeployFolder {
  const dir = join(cacheRoot, "deploy", deployKey(remote, branch));
  const was = join(dir, remote.name);
  const checkout = !OWN.test(remote.name) && existsSync(join(was, ".git")) ? was : join(dir, "clone", remote.name);
  return { dir, checkout, state: join(dir, "state.json"), logs: join(dir, "logs"), mathlib: join(dir, "mathlib-cache") };
}

/** The site of a deployment, without `--site`: under the data home by the address and the branch,
 *  so that the review stays where it is whatever `--cache` says. */
export function deploySite(remote: Remote, branch: string, h?: HomeEnv): string {
  return join(dataHome(h), "sites", deployKey(remote, branch));
}

/** The remotes' default branches as last asked (`<cache>/deploy/remotes.json`): a server started
 *  without `--branch` and without the network follows the branch it followed. */
function remotesFile(cacheRoot: string): string {
  return join(cacheRoot, "deploy", "remotes.json");
}

export function recordedDefault(cacheRoot: string, url: string): string | null {
  try {
    const all = JSON.parse(readFileSync(remotesFile(cacheRoot), "utf8")) as Record<string, { branch?: unknown }>;
    const b = Object.hasOwn(all, url) ? all[url].branch : null;
    return typeof b === "string" && !branchProblem(b) ? b : null;
  } catch {
    return null;
  }
}

function recordDefault(cacheRoot: string, url: string, branch: string): void {
  const file = remotesFile(cacheRoot);
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // none yet
  }
  all[url] = { branch, at: new Date().toISOString() };
  try {
    mkdirSync(join(cacheRoot, "deploy"), { recursive: true });
    writeFileSync(`${file}.tmp-${process.pid}`, JSON.stringify(all, null, 1) + "\n");
    renameSync(`${file}.tmp-${process.pid}`, file);
  } catch {
    // a record to spare the network at the next start; not a reason to fail
  }
}

// ---------------------------------------------------------------- the programs' environment

/** What tells git which repository to work on, where the server's own environment has it (a hook's,
 *  a test's): never handed on, so that git works on the clone alone. */
const REPO_VARS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_PREFIX", "GIT_QUARANTINE_PATH", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"];

/** The server's environment without what is the server's alone (`VISUALPROOF_*`, server/children.ts)
 *  and without what would point git elsewhere. */
function gitBase(): NodeJS.ProcessEnv {
  const env = childEnv();
  for (const k of REPO_VARS) delete env[k];
  for (const k of Object.keys(env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)) delete env[k];
  return env;
}

let sshConfigured: string | null | undefined;
/** The ssh command git is configured with (`core.sshCommand`, the user's or the system's), read once. */
function configuredSsh(): string | null {
  if (sshConfigured !== undefined) return sshConfigured;
  const r = spawnSync("git", ["config", "--get", "core.sshCommand"], { cwd: tmpdir(), encoding: "utf8", timeout: 10_000, env: gitBase() });
  return (sshConfigured = r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null);
}

/** No prompt is ever waited on (DeploySpec decision 9): git asks no terminal and runs no askpass
 *  (`GIT_TERMINAL_PROMPT=0`, an empty `GIT_ASKPASS`), the credential manager is not interactive, and
 *  ssh runs in batch mode — the ssh command git would run (`GIT_SSH_COMMAND`, else `core.sshCommand`,
 *  else `ssh`) with `-o BatchMode=yes` after it; a `GIT_SSH` program is left as it is. Credentials
 *  are git's own: helpers, keys and agents work as for any git. The programs run without a
 *  terminal of their own besides (server/children.ts, `grouped`). */
export function noPrompts(env: NodeJS.ProcessEnv, ssh: string | null = configuredSsh()): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS_REQUIRE: "never", GCM_INTERACTIVE: "never" };
  const own = env.GIT_SSH_COMMAND || ssh || (env.GIT_SSH ? null : "ssh");
  if (own) out.GIT_SSH_COMMAND = `${own} -o BatchMode=yes`;
  return out;
}

/** git's environment, for the remote `remote`: no prompts, and only its protocol allowed
 *  (`GIT_ALLOW_PROTOCOL`), whatever a redirect or a configuration says. */
export function gitEnv(remote: Remote): NodeJS.ProcessEnv {
  return { ...noPrompts(gitBase()), GIT_ALLOW_PROTOCOL: remote.kind };
}

/** Where a deployment's `lake exe cache get` keeps Mathlib's files (DeploySpec decision 2): the
 *  user's cache, shared by their builds (the default), or the deployment's own, in its folder. */
export type MathlibCache = "shared" | "own";
export const MATHLIB_CACHES: readonly MathlibCache[] = ["shared", "own"];

/** Mathlib's cache as the user's builds find it, as Mathlib's cache program reads it
 *  (`Cache/IO.lean`, `CACHEDIR`): `MATHLIB_CACHE_DIR`, else `$XDG_CACHE_HOME/mathlib`, else
 *  `~/.cache/mathlib`. */
export function sharedMathlibCache(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.MATHLIB_CACHE_DIR || join(env.XDG_CACHE_HOME || join(home, ".cache"), "mathlib");
}

/** Lake's environment for a build: the server's without what is its own — no access key or token
 *  of VisualProof's is in it — and no prompts for the git it runs for the dependencies. With
 *  `mathlib`, Mathlib's cache is that folder (`MATHLIB_CACHE_DIR`, which every Mathlib since
 *  February 2025, Lean v4.17, reads: every supported toolchain's); `XDG_CACHE_HOME`, which an older
 *  one read, is left as it is, since Lake's cache and git's credential cache are found by it too. */
export function buildEnv(mathlib: string | null = null): NodeJS.ProcessEnv {
  const env = noPrompts(gitBase());
  if (mathlib) env.MATHLIB_CACHE_DIR = mathlib;
  return env;
}

// ---------------------------------------------------------------- running a program

export interface Ran {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** its standard output, and both outputs together: their ends */
  stdout: string;
  out: string;
  timedOut: boolean;
  /** it could not be started */
  error?: string;
}

/** Run `cmd` with `args` — an array, never through a shell — as a group of its own (what it starts
 *  ends with it: server/children.ts), stopped past `timeoutMs`; what it writes goes to `onText` as
 *  it comes. Never rejects. */
export function run(cmd: string, args: string[], o: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs: number; onText?: (text: string) => void; keep?: number }): Promise<Ran> {
  return new Promise((done) => {
    const keep = o.keep ?? 20_000;
    let stdout = "", out = "", timedOut = false, finished = false;
    let child: ChildProcess;
    try {
      child = grouped(spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"], detached: DETACH }));
    } catch (e) {
      return done({ code: null, signal: null, stdout, out, timedOut, error: e instanceof Error ? e.message : String(e) });
    }
    const take = (b: Buffer, own: boolean) => {
      const t = b.toString();
      if (own) stdout = (stdout + t).slice(-keep);
      out = (out + t).slice(-keep);
      o.onText?.(t);
    };
    child.stdout!.on("data", (b: Buffer) => take(b, true));
    child.stderr!.on("data", (b: Buffer) => take(b, false));
    const timer = setTimeout(() => {
      timedOut = true;
      end(child);
      setTimeout(() => end(child, "SIGKILL"), 5000).unref();
    }, o.timeoutMs);
    const finish = (r: Ran) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done(r);
    };
    child.on("error", (e) => finish({ code: null, signal: null, stdout, out, timedOut, error: e.message }));
    child.on("close", (code, signal) => finish({ code, signal, stdout, out, timedOut }));
  });
}

/** What git said went wrong, in a line: its last `fatal:` or `error:` line, else its last line. */
function gitWhy(r: Ran): string {
  if (r.error) return `git could not be run: ${r.error}`;
  if (r.timedOut) return "git did not finish in time";
  const lines = r.out.split("\n").map((l) => l.trim()).filter(Boolean);
  const said = [...lines].reverse().find((l) => /^(fatal|error):/.test(l)) ?? lines[lines.length - 1] ?? `git exited with ${r.code}`;
  return said.replace(/^(fatal|error):\s*/, "").slice(0, 400);
}

const git = (args: string[], env: NodeJS.ProcessEnv, ms = GIT_MS, onText?: (t: string) => void) => run("git", args, { env, timeoutMs: ms, cwd: tmpdir(), onText });

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The head of `branch` on the remote; without a branch, the remote's default branch and its head
 *  (`git ls-remote --symref HEAD`). Only that branch is ever asked of: never a pull request's ref, nor
 *  a fork's. */
export async function askRemote(remote: Remote, branch: string | null, env: NodeJS.ProcessEnv): Promise<{ head: string; branch: string } | { error: string }> {
  const r = await git(branch ? ["ls-remote", "--", remote.url, `refs/heads/${branch}`] : ["ls-remote", "--symref", "--", remote.url, "HEAD"], env, ASK_MS);
  if (r.code !== 0 || r.error || r.timedOut) return { error: r.timedOut ? "the remote did not answer within a minute" : gitWhy(r) };
  const lines = r.stdout.split("\n");
  if (!branch) {
    const ref = lines.map((l) => /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(l)).find(Boolean)?.[1];
    if (!ref || branchProblem(ref)) return { error: "the remote names no default branch: say which to follow, --branch <name>" };
    const head = lines.map((l) => /^([0-9a-f]+)\tHEAD$/.exec(l)).find(Boolean)?.[1];
    return head && SHA.test(head) ? { head, branch: ref } : { error: `the remote's ${ref} has no commit` };
  }
  // the pattern matches refs that end so: the branch's own ref alone
  const head = lines.map((l) => l.split("\t")).find((p) => p[1] === `refs/heads/${branch}`)?.[0];
  return head && SHA.test(head) ? { head, branch } : { error: `the remote has no branch ${branch}` };
}

/** The branch to follow: `given`, else the remote's default as it says it now, else as it said it
 *  last (the network may be away at a restart). */
export async function branchToFollow(remote: Remote, given: string | null, cacheRoot: string): Promise<string | { error: string }> {
  if (given) return given;
  const a = await askRemote(remote, null, gitEnv(remote));
  if ("head" in a) {
    recordDefault(cacheRoot, remote.url, a.branch);
    return a.branch;
  }
  return recordedDefault(cacheRoot, remote.url) ?? { error: `cannot learn the remote's default branch (${a.error}): give --branch <name>` };
}

/** The deployment's clone, made at the first start (DeploySpec decision 2): an empty repository
 *  whose `origin` is the address, the branch fetched alone, its head checked out detached. It is
 *  made in a folder of its own and moved into place once whole, so that a start cut short leaves
 *  nothing half made. The commit checked out, or why there is none. */
export async function ensureClone(remote: Remote, branch: string, folder: DeployFolder, log: (l: string) => void): Promise<{ commit: string; made: boolean } | { error: string }> {
  const env = gitEnv(remote);
  // a clone of 0.5.0 named as what its folder keeps of its own (a repository called logs): moved
  // into the clone's place, what it built with it
  const was = join(folder.dir, remote.name);
  if (was !== folder.checkout && OWN.test(remote.name) && existsSync(join(was, ".git")) && !existsSync(folder.checkout)) {
    mkdirSync(dirname(folder.checkout), { recursive: true });
    renameSync(was, folder.checkout);
    log(`the clone moved to ${folder.checkout}: its folder keeps a ${remote.name} of its own`);
  }
  if (existsSync(join(folder.checkout, ".git"))) {
    const r = await git(["-C", folder.checkout, "rev-parse", "--verify", "HEAD^{commit}"], env);
    const c = r.stdout.trim();
    if (r.code === 0 && SHA.test(c)) return { commit: c, made: false };
    return { error: `the clone ${folder.checkout} cannot be read (${gitWhy(r)}): remove it, and it is made again` };
  }
  const place = dirname(folder.checkout);
  mkdirSync(place, { recursive: true });
  // what a start that died midway left
  for (const f of readdirSync(place)) {
    const m = new RegExp(`^${basename(folder.checkout).replace(/[.]/g, "\\.")}\\.tmp-(\\d+)$`).exec(f);
    if (m && !alive(Number(m[1]))) rmSync(join(place, f), { recursive: true, force: true });
  }
  const tmp = `${folder.checkout}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  const t0 = Date.now();
  log(`cloning ${remote.source ?? remote.url} (${branch}) into ${folder.checkout}…`);
  const steps: string[][] = [
    ["init", "--quiet", tmp],
    ["-C", tmp, "remote", "add", "origin", "--", remote.url],
    ["-C", tmp, "fetch", "--no-tags", "--no-recurse-submodules", "--quiet", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
  ];
  for (const s of steps) {
    const r = await git(s, env);
    if (r.code !== 0) {
      rmSync(tmp, { recursive: true, force: true });
      return { error: `cannot clone ${remote.source ?? remote.url} (${branch}): ${gitWhy(r)}` };
    }
  }
  const rp = await git(["-C", tmp, "rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`], env);
  const commit = rp.stdout.trim();
  const co = SHA.test(commit) ? await git(["-C", tmp, "-c", "advice.detachedHead=false", "checkout", "--quiet", "--force", "--detach", commit], env) : rp;
  if (co.code !== 0 || !SHA.test(commit)) {
    rmSync(tmp, { recursive: true, force: true });
    return { error: `cannot check out ${branch} of ${remote.source ?? remote.url}: ${gitWhy(co)}` };
  }
  renameSync(tmp, folder.checkout);
  log(`cloned in ${((Date.now() - t0) / 1000).toFixed(1)} s, at ${shortCommit(commit)}`);
  return { commit, made: true };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Another server follows the branch with this cache. */
export class DeployBusy extends Error {}

/** Take the deployment for this process (`.lock`, as a site is taken: server/dirs.ts). */
export function lockDeployment(folder: DeployFolder, remote: Remote, branch: string): () => void {
  mkdirSync(folder.dir, { recursive: true });
  try {
    return lockSite(folder.dir);
  } catch (e) {
    if (e instanceof SiteBusy) throw new DeployBusy(`another VisualProof server (process ${e.pid}) follows ${branch} of ${remote.source ?? remote.url} with this cache (${folder.dir}): stop it first, or give this one a --cache of its own`);
    throw e;
  }
}

/** Whether the project is on Mathlib: its manifest names it (DeploySpec decision 4). */
export function onMathlib(root: string): boolean {
  try {
    const m = JSON.parse(readFileSync(join(root, "lake-manifest.json"), "utf8")) as { packages?: { name?: unknown }[] };
    return Array.isArray(m.packages) && m.packages.some((p) => typeof p?.name === "string" && p.name.toLowerCase() === "mathlib");
  } catch {
    return false;
  }
}

/** Whether the Mathlib checked out in the project reads `MATHLIB_CACHE_DIR` (since February 2025,
 *  #21480; every supported toolchain's does): its cache program's source says so (`Cache/IO.lean`,
 *  `CACHEDIR`). One before keeps its cache by `XDG_CACHE_HOME` alone: the user's. */
export function mathlibReadsCacheDir(root: string): boolean {
  let packages = join(".lake", "packages");
  try {
    const m = JSON.parse(readFileSync(join(root, "lake-manifest.json"), "utf8")) as { packagesDir?: unknown };
    if (typeof m.packagesDir === "string" && m.packagesDir) packages = m.packagesDir;
  } catch {
    // Lake's default
  }
  try {
    return readFileSync(join(root, packages, "mathlib", "Cache", "IO.lean"), "utf8").includes('"MATHLIB_CACHE_DIR"');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- a build's log

/** What a build's log names more briefly for the pages (DeploySpec decision 11, SECURITY.md), the
 *  longest path first: the clone's folder `.`, the deployment's folder that holds it (its logs, its
 *  own Mathlib cache) from it (`../..`), and the home `~` — each as given and as resolved, since Lean
 *  prints paths resolved (macOS's /var is /private/var), git and Lake the ones given. A home reached
 *  through a symlink, or a folder under it that is one, prints resolved too: the folders elan and
 *  Lake use under it — `~/.elan` (or `$ELAN_HOME`), `~/.cache` (or `$XDG_CACHE_HOME`; Lake's cache,
 *  Mathlib's), `$MATHLIB_CACHE_DIR` where it is set — read by the path given, under `~`, whatever
 *  they resolve to (here `~/.elan` → `/data/.elan`: `/data/.elan/toolchains/…/bin/lean` reads
 *  `~/.elan/toolchains/…/bin/lean`). A folder outside the home keeps the path given. */
export function logNames(root: string, o: { folder?: string; home?: string; env?: NodeJS.ProcessEnv } = {}): [from: string, to: string][] {
  const home = o.home ?? homedir();
  const env = o.env ?? process.env;
  // a folder not there yet (the clone before the first build's) as its nearest folder resolves
  const resolved = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      const up = dirname(p);
      return up === p ? p : join(resolved(up), basename(p));
    }
  };
  const names = new Map<string, string>();
  const name = (path: string, as: string) => {
    for (const from of [path, resolved(path)]) if (from.length > 1 && !names.has(from)) names.set(from, as);
  };
  name(root, ".");
  if (o.folder) name(o.folder, relative(root, o.folder) || ".");
  if (home && home.length > 1) {
    const brief = (p: string) => (p === home ? "~" : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
    for (const d of [env.ELAN_HOME || join(home, ".elan"), env.XDG_CACHE_HOME || join(home, ".cache"), env.MATHLIB_CACHE_DIR]) if (d) name(d, brief(d));
    name(home, "~");
  }
  return [...names].sort((a, b) => b[0].length - a[0].length);
}

/** What names a text's paths as `names` (the longest first) says, each where it is a whole path or
 *  begins one (not `/home/ann` in `/home/anne`, nor in `/mnt/home/ann`), once: what is put in stays. */
export function pathNamer(names: readonly [string, string][]): (text: string) => string {
  if (!names.length) return (text) => text;
  const to = new Map(names);
  const any = names.map(([from]) => from.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")).join("|");
  const re = new RegExp(`(?<![\\w.~+@-])(?:${any})(?![\\w.~+@-])`, "g");
  return (text) => text.replace(re, (m) => to.get(m) ?? m);
}

/** A build's log: everything its programs wrote, in `logs/<commit>.log` of the deployment (a build
 *  done again writes it again), and its end for the pages, its paths named briefly (`logNames`: the
 *  clone's folder `.`, the home `~`), colours and redrawn lines taken out. */
export class BuildLog {
  readonly file: string;
  private fd: number | null = null;
  private lines: string[] = [];
  private partial = "";
  /** the paths the pages are given by another name (logNames) */
  private named: (text: string) => string;

  constructor(dir: string, commit: string, root: string, o: { folder?: string; home?: string; env?: NodeJS.ProcessEnv } = {}) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `${commit}.log`);
    this.named = pathNamer(logNames(root, o));
    try {
      this.fd = openSync(this.file, "w", 0o600);
    } catch {
      // a log that cannot be written: its end is still kept for the pages
    }
    prune(dir, LOGS_KEPT);
  }

  /** a line of VisualProof's own: the step, the command */
  say(line: string): void {
    this.text(`${line}\n`);
  }

  text(t: string): void {
    if (this.fd !== null) {
      try {
        writeSync(this.fd, t);
      } catch {
        this.fd = null;
      }
    }
    const parts = (this.partial + t).split("\n");
    this.partial = parts.pop() ?? "";
    for (const p of parts) this.push(p);
  }

  private push(raw: string): void {
    // a line redrawn in place (a progress bar) is its last state
    const line = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").split("\r").pop()!.trimEnd();
    if (!line) return;
    this.lines.push(line);
    if (this.lines.length > TAIL_LINES * 2) this.lines.splice(0, this.lines.length - TAIL_LINES);
  }

  /** its end, as the pages are given it: its last `n` lines, the one being written included */
  tail(n = TAIL_LINES): string {
    const last = this.partial.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").split("\r").pop()!.trimEnd();
    const t = this.named([...this.lines, ...(last ? [last] : [])].slice(-n).join("\n"));
    return t.length > TAIL_CHARS ? `…${t.slice(-TAIL_CHARS)}` : t;
  }

  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

/** Keep the newest `keep` files of `dir`. */
function prune(dir: string, keep: number): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keep)) unlinkSync(join(dir, f));
  } catch {
    // housekeeping
  }
}

// ---------------------------------------------------------------- the deployment

/** What `state.json` keeps (DeploySpec, "On disk"). */
interface DeployState {
  version: 1;
  url: string;
  branch: string;
  /** the commit whose build last wrote outputs in the tree, or built it whole: what the tree's
   *  outputs are of, which the board reads — a failed build that wrote none is not built (the
   *  owner's decision of 2026-10-19) */
  outputs: { commit: string; at: string } | null;
  /** the commit whose `lake build` last ran in the tree, whatever came of it: what the tree is
   *  checked out at between builds (0.5.0 kept none: its `outputs` were this) */
  ran: string | null;
  /** a build that changed the tree and has not ended: one found here at a start was cut short */
  building: { commit: string; since: string } | null;
  /** the last commit tried, whatever came of it but a try that could not be made */
  done: string | null;
  last: DeployBuild | null;
  /** the newest head seen on the remote */
  head: { commit: string; at: string } | null;
}

/** What the deployment needs of the server. */
export interface DeployHooks {
  /** the server reads the tree now (an extraction, a graph being served): it is changed only after */
  reading(): boolean;
  /** a build starts changing the tree: what the server runs on the build before is stopped (the
   *  usage pass: what it finished is kept) */
  starting(): void;
  /** the toolchain changed with the commit: Lean's language server starts again with the new one */
  toolchainChanged(): void;
  /** something the pages are told of changed */
  changed(): void;
  /** a line for the server's log */
  log(line: string): void;
  /** a build ended, whatever came of it: the tree is read again once it settles (what the build
   *  before left half done, the usage pass cut short, is done then) */
  ended?(): void;
}

export interface DeploymentOptions {
  remote: Remote;
  branch: string;
  folder: DeployFolder;
  /** the project the server shows, the clone: refreshed in place as each commit says it */
  project: Project;
  /** `--root`: what is built and read; none, the default targets */
  roots: string[];
  /** how often the remote is asked */
  everyMs: number;
  /** `lake build` past which a build is stopped and failed (`--build-timeout`); by default
   *  DEFAULT_BUILD_HOURS */
  buildMs?: number;
  /** Mathlib's cache: the user's (the default) or the deployment's own (`--mathlib-cache`) */
  mathlibCache?: MathlibCache;
  hooks: DeployHooks;
  /** the commit the clone was made at, at the first start */
  head?: string | null;
  /** Lake's program: a test gives its own */
  lake?: string;
  /** how the remote is asked: a test gives its own */
  ask?: () => Promise<{ head: string } | { error: string }>;
}

/** A branch followed and built (DeploySpec decisions 3–8): the remote asked every `everyMs`, each
 *  new head built in turn, the newest seen meanwhile the only one built after the build going on. */
export class Deployment {
  readonly remote: Remote;
  readonly branch: string;
  readonly folder: DeployFolder;
  private o: DeploymentOptions;
  private state: DeployState;
  /** the newest head seen: what is built next */
  private want: string | null;
  /** the last commit tried */
  private done: string | null;
  /** a commit whose try could not be made: tried again at the next look at the remote, not before */
  private later: string | null = null;
  /** the tree is not one build's: a build was cut short, and nothing is read until one ends */
  private interrupted: boolean;
  private building: { commit: string; since: string; step: DeployStep } | null = null;
  private asked: DeployStatus["asked"] = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private asking: Promise<void> | null = null;
  /** the build going on */
  running: Promise<void> | null = null;
  private env: NodeJS.ProcessEnv;
  private lakeEnv: NodeJS.ProcessEnv;
  /** `lake build` past which a build is stopped (DeploySpec decision 14) */
  readonly buildMs: number;
  /** every build tried since the start, in order: what the tests read */
  readonly tried: string[] = [];
  /** the log of the build going on */
  private log: BuildLog | null = null;

  constructor(o: DeploymentOptions) {
    this.o = o;
    this.remote = o.remote;
    this.branch = o.branch;
    this.folder = o.folder;
    this.env = gitEnv(o.remote);
    this.lakeEnv = buildEnv(o.mathlibCache === "own" ? o.folder.mathlib : null);
    this.buildMs = o.buildMs ?? DEFAULT_BUILD_HOURS * 3600_000;
    this.state = this.read();
    const head = this.headNow();
    // the tree is one build's only where the commit checked out is the one whose build last ran in
    // it and no build was going on
    this.interrupted = this.state.building !== null || (this.state.ran !== null && head !== null && head !== this.state.ran);
    this.want = this.state.head?.commit ?? this.state.building?.commit ?? o.head ?? head;
    this.done = this.interrupted ? null : this.state.done;
    if (this.state.building) o.hooks.log(`build: the build of ${shortCommit(this.state.building.commit)} was cut short (a restart, a stop): it is done again`);
  }

  private read(): DeployState {
    const fresh: DeployState = { version: 1, url: this.remote.url, branch: this.branch, outputs: null, ran: null, building: null, done: null, last: null, head: null };
    try {
      const s = JSON.parse(readFileSync(this.folder.state, "utf8")) as Partial<DeployState>;
      // 0.5.0's: the commit whose build last ran is the one its outputs were said to be of
      return { ...fresh, ...s, ran: s.ran ?? s.outputs?.commit ?? null, version: 1, url: this.remote.url, branch: this.branch };
    } catch {
      return fresh;
    }
  }

  private save(): void {
    const tmp = `${this.folder.state}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify(this.state, null, 1) + "\n");
      renameSync(tmp, this.folder.state);
    } catch (e) {
      this.o.hooks.log(`build: ${this.folder.state} cannot be written: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** the commit checked out in the clone */
  private headNow(): string | null {
    const r = spawnSync("git", ["-C", this.folder.checkout, "rev-parse", "--verify", "HEAD^{commit}"], { encoding: "utf8", timeout: 10_000, env: this.env });
    const c = r.status === 0 ? r.stdout.trim() : "";
    return SHA.test(c) ? c : null;
  }

  /** Ask the remote at once, then every `everyMs`. */
  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.o.everyMs);
    this.timer.unref?.();
  }

  /** No more asking or building; a build going on is stopped with the server's programs
   *  (server/children.ts) and recorded as cut short, to be done again at the next start. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.timer = this.retry = null;
  }

  /** Whether the tree is not to be read now: a build changes it, one was cut short, or none was ever
   *  made. */
  holds(): boolean {
    return this.building !== null || this.interrupted || this.state.outputs === null;
  }

  /** a build is going on, which a restart would cut short (UpdateSpec decision 6) */
  get busy(): boolean {
    return this.running !== null;
  }

  /** The commit what the tree's outputs were built from, and the branch: the history's for each
   *  build it reads (HistorySpec decision 4) — the last whose build wrote outputs, not a failed one
   *  that wrote none (DeploySpec decision 6). */
  commit(): { hash: string; branch: string } | null {
    return this.state.outputs ? { hash: this.state.outputs.commit, branch: this.branch } : null;
  }

  /** What the pages and agents are told; without the build's log for a read-only reader. */
  status(full: boolean): DeployStatus {
    const s: DeployStatus = {
      source: this.remote.source,
      github: this.remote.github,
      branch: this.branch,
      every: Math.round(this.o.everyMs / 1000),
      asked: this.asked,
      // what the build going on says now (the cache's download, Lake's last lines)
      building: this.building && { ...this.building, ...(this.log ? { tail: this.log.tail(LIVE_LINES) } : {}) },
      // a commit waiting for its try to be made again is said by the last build's
      next: this.building && this.want && this.want !== this.done && this.want !== this.building.commit ? this.want : null,
      last: this.state.last,
      built: this.state.outputs?.commit ?? null,
    };
    return full ? s : slimDeploy(s);
  }

  /** Ask the remote for the branch's head; a new one is built once the build going on ends. A
   *  question asked while one is on its way waits for it. */
  poll(): Promise<void> {
    this.asking ??= (async () => {
      try {
        const a = this.o.ask ? await this.o.ask() : await askRemote(this.remote, this.branch, this.env);
        const at = new Date().toISOString();
        if (this.stopped) return;
        if ("error" in a) {
          if (this.asked?.error !== a.error) this.o.hooks.log(`build: the remote cannot be asked: ${a.error}`);
          this.asked = { at, head: this.asked?.head ?? null, error: a.error };
        } else {
          this.asked = { at, head: a.head };
          if (a.head !== this.state.head?.commit) {
            this.state.head = { commit: a.head, at };
            this.save();
          }
          if (a.head !== this.want) {
            if (this.want) this.o.hooks.log(`build: ${this.branch} is at ${shortCommit(a.head)} now${this.running ? `: built once the build of ${shortCommit(this.building?.commit ?? "")} ends` : ""}`);
            this.want = a.head;
          }
        }
        this.later = null;
        this.o.hooks.changed();
        this.kick();
      } finally {
        this.asking = null;
      }
    })();
    return this.asking;
  }

  /** Start the build of the newest head where none is going on and it is not built yet; while the
   *  server reads the tree, a moment later. */
  private kick(): void {
    if (this.stopped || this.running || !this.want || this.want === this.done || this.want === this.later) return;
    if (this.o.hooks.reading()) {
      this.retry ??= setTimeout(() => {
        this.retry = null;
        this.kick();
      }, 300);
      return;
    }
    const commit = this.want;
    this.tried.push(commit);
    this.running = this.attempt(commit)
      .catch((e) => this.o.hooks.log(`build: ${shortCommit(commit)}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`))
      .finally(() => {
        this.running = null;
        this.building = null;
        this.o.hooks.changed();
        this.kick();
      });
  }

  /** The commit built next where none is going on: the newest head seen, where it was not tried
   *  (the server's first lines say it). */
  toBuild(): string | null {
    return this.want && this.want !== this.done && this.want !== this.later ? this.want : null;
  }

  /** Until the build going on and those waiting are done: what the tests wait for. */
  async settled(): Promise<void> {
    while (this.running || this.asking || this.retry) await (this.running ?? this.asking ?? new Promise((ok) => setTimeout(ok, 50)));
  }

  private step(s: DeployStep): void {
    if (this.building) this.building = { ...this.building, step: s };
    this.o.hooks.changed();
  }

  /** The build of `commit` (DeploySpec decisions 4–7): fetched where the clone has it not, checked
   *  out detached and cleaned (the build outputs kept), the project read again as it says it,
   *  Mathlib's cache got where it is on Mathlib, `lake build`. A try that could not change or build
   *  the tree leaves it as the last build had it. */
  private async attempt(commit: string): Promise<void> {
    const t0 = Date.now();
    const since = new Date(t0).toISOString();
    // before anything is awaited: from here the tree is not read (holds)
    this.building = { commit, since, step: "fetch" };
    this.o.hooks.changed();
    const short = shortCommit(commit);
    const say = this.o.hooks.log;
    const log = (this.log = new BuildLog(this.folder.logs, commit, this.folder.checkout, { folder: this.folder.dir }));
    const g = (args: string[], ms = GIT_MS) => {
      log.say(`$ git ${args.join(" ")}`);
      return git(["-C", this.folder.checkout, ...args], this.env, ms, (t) => log.text(t));
    };
    const ended = (b: Omit<DeployBuild, "commit" | "at" | "ms">) => this.ended(commit, t0, { ...b, tail: log.tail() }, log);
    try {
      say(`build: ${short}: ${this.state.outputs ? "" : "the first build: "}fetching`);
      if (!(await this.has(commit))) {
        const f = await g(["fetch", "--no-tags", "--no-recurse-submodules", "--quiet", "origin", `+refs/heads/${this.branch}:refs/remotes/origin/${this.branch}`]);
        if (this.stopped) return;
        if (f.code !== 0) return ended({ ok: false, retry: true, error: `it could not be fetched: ${gitWhy(f)}` });
        if (!(await this.has(commit))) return ended({ ok: false, retry: true, error: "the branch moved on before it could be fetched: its newest commit is built next" });
      }
      // a graph being made ready to serve as the fetch went on (the usage pass's) is let finish: the
      // tree changes from here
      while (this.o.hooks.reading() && !this.stopped) await new Promise((ok) => setTimeout(ok, 100));
      if (this.stopped) return;
      // the build is recorded as going on, so that one cut short is done again (DeploySpec
      // decision 8)
      this.step("checkout");
      this.o.hooks.starting();
      this.state.building = { commit, since };
      this.save();
      const co = await g(["-c", "advice.detachedHead=false", "checkout", "--quiet", "--force", "--detach", commit]);
      const cl = co.code === 0 ? await g(["clean", "-ffdq", "-e", ".lake"]) : co;
      if (this.stopped) return;
      if (cl.code !== 0) {
        await this.restore(log);
        return ended({ ok: false, retry: true, error: `it could not be checked out: ${gitWhy(cl)}` });
      }
      try {
        this.adopt(openProject(this.folder.checkout, this.o.roots, false));
      } catch (e) {
        if (!(e instanceof ProjectError)) throw e;
        await this.restore(log);
        return ended({ ok: false, error: `it is no Lean project VisualProof can read: ${e.message}` });
      }
      const lake = this.o.lake ?? "lake";
      if (onMathlib(this.folder.checkout)) {
        this.step("cache");
        say(`build: ${short}: getting Mathlib's cache`);
        for (let n = 1; n <= 2 && !this.stopped; n++) {
          // the deployment's own cache, beside the clone in its folder (DeploySpec decision 2)
          log.say(`$ ${this.o.mathlibCache === "own" ? `MATHLIB_CACHE_DIR=${relative(this.folder.checkout, this.folder.mathlib)} ` : ""}lake exe cache get`);
          const c = await run(lake, ["exe", "cache", "get"], { cwd: this.folder.checkout, env: this.lakeEnv, timeoutMs: CACHE_MS, onText: (t) => log.text(t) });
          if (c.code === 0) {
            await this.cleanMathlibCache(lake, log);
            break;
          }
          // Lake builds what the cache did not give
          log.say(`Mathlib's cache could not be had (${c.error ?? (c.timedOut ? "it took too long" : `exit ${c.code}`)})${n === 1 ? ": trying again" : ": lake build builds what it lacks"}`);
        }
      }
      if (this.stopped) return;
      this.step("build");
      say(`build: ${short}: lake build${this.o.roots.length ? ` ${this.o.roots.join(" ")}` : ""}`);
      log.say(`$ lake build${this.o.roots.length ? ` ${this.o.roots.join(" ")}` : ""}`);
      // the project's newest `.olean` before the build: whether it wrote any (as the history tells a
      // new build: HistorySpec decision 4)
      const before = buildTime(this.o.project);
      const b = await run(lake, ["build", ...this.o.roots], { cwd: this.folder.checkout, env: this.lakeEnv, timeoutMs: this.buildMs, onText: (t) => log.text(t) });
      // cut short by the server's stop: done again at the next start
      if (this.stopped) return;
      if (b.error) {
        await this.restore(log);
        return ended({ ok: false, retry: true, error: `lake could not be run: ${b.error}` });
      }
      const ok = b.code === 0 && !b.timedOut;
      // the tree is this build's, whatever came of it: checked out at its commit, its failed files
      // shown as such; its outputs are, where it built the commit or wrote any. A failed build that
      // wrote none leaves the board on the last build that did, which is what is said built (the
      // owner's decision of 2026-10-19)
      this.state.ran = commit;
      if (ok || buildTime(this.o.project) > before) this.state.outputs = { commit, at: new Date().toISOString() };
      this.state.building = null;
      this.interrupted = false;
      // the modules a library's globs give, now that they are built
      try {
        this.adopt(openProject(this.folder.checkout, this.o.roots, false));
      } catch {
        // read as it was after the checkout
      }
      // stopped past the limit: failed, and not tried again (DeploySpec decision 14)
      if (b.timedOut) log.say(`lake build took longer than ${limitInWords(this.buildMs)} (--build-timeout): stopped`);
      return ended({ ok, exit: b.code, ...(b.timedOut ? { error: `it took longer than ${limitInWords(this.buildMs)} (--build-timeout): stopped` } : {}) });
    } catch (e) {
      if (this.stopped) return;
      if (this.state.building) await this.restore(log);
      return ended({ ok: false, retry: true, error: e instanceof Error ? e.message : String(e) });
    } finally {
      log.close();
      this.log = null;
    }
  }

  /** The deployment's own Mathlib cache keeps the version checked out alone (DeploySpec decision 2,
   *  the owner's decision of 2026-10-19): after each `lake exe cache get` that succeeded, `lake exe
   *  cache clean` deletes the files (`<hash>.ltar`) the Mathlib checked out does not link, which
   *  are what `get` fetches. Never the user's cache: only where the deployment has its own, and the
   *  Mathlib checked out reads it (one before February 2025 would clean the user's). */
  private async cleanMathlibCache(lake: string, log: BuildLog): Promise<void> {
    if (this.o.mathlibCache !== "own" || this.lakeEnv.MATHLIB_CACHE_DIR !== this.folder.mathlib) return;
    if (!mathlibReadsCacheDir(this.folder.checkout)) {
      log.say("Mathlib's cache is not cleaned: this Mathlib does not read MATHLIB_CACHE_DIR (it is older than February 2025), and keeps its cache with the user's");
      return;
    }
    log.say(`$ MATHLIB_CACHE_DIR=${relative(this.folder.checkout, this.folder.mathlib)} lake exe cache clean`);
    const k = await run(lake, ["exe", "cache", "clean"], { cwd: this.folder.checkout, env: this.lakeEnv, timeoutMs: CACHE_MS, onText: (t) => log.text(t) });
    if (k.code !== 0) log.say(`Mathlib's cache could not be cleaned (${k.error ?? (k.timedOut ? "it took too long" : `exit ${k.code}`)}): what it holds of other versions stays until the next build`);
  }

  /** Whether the clone has `commit`. */
  private async has(commit: string): Promise<boolean> {
    const r = await git(["-C", this.folder.checkout, "cat-file", "-e", `${commit}^{commit}`], this.env, ASK_MS);
    return r.code === 0;
  }

  /** The tree as the last build left it, after a try that changed it and did not build it: checked
   *  out at that build's commit again, so that what is read of it, and a restart, are that build's.
   *  Where that cannot be done, the tree stays held until a build ends. */
  private async restore(log: BuildLog): Promise<void> {
    const was = this.state.ran;
    if (was) {
      log.say(`back to ${shortCommit(was)}, the last build's commit`);
      const co = await git(["-C", this.folder.checkout, "-c", "advice.detachedHead=false", "checkout", "--quiet", "--force", "--detach", was], this.env);
      if (co.code !== 0) {
        log.say(`it could not be checked out again: ${gitWhy(co)}`);
        this.interrupted = true;
        return;
      }
      try {
        this.adopt(openProject(this.folder.checkout, this.o.roots, false));
      } catch {
        // it was read at that build
      }
    }
    // no build to go back to: nothing is read until one is made (holds)
    this.state.building = null;
    this.interrupted = false;
  }

  /** The project as the commit checked out says it, taken into the server's own in place: its
   *  toolchain, its name, its roots. */
  private adopt(fresh: Project): void {
    const p = this.o.project;
    const was = p.toolchain;
    Object.assign(p, { ...fresh, root: p.root });
    if (fresh.toolchain !== was) {
      this.o.hooks.log(`build: the toolchain is ${fresh.toolchain} now (it was ${was})`);
      this.o.hooks.toolchainChanged();
    }
  }

  /** A try ended: recorded, said, and — unless it could not be made — not tried again. */
  private ended(commit: string, t0: number, b: Omit<DeployBuild, "commit" | "at" | "ms">, log: BuildLog): void {
    const ms = Date.now() - t0;
    const build: DeployBuild = { commit, at: new Date().toISOString(), ms, ...b };
    this.state.last = build;
    if (!b.retry) this.state.done = this.done = commit;
    else this.later = commit;
    this.save();
    this.o.hooks.ended?.();
    const secs = ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
    const short = shortCommit(commit);
    if (b.ok) this.o.hooks.log(`build: ${short} built in ${secs}`);
    else this.o.hooks.log(`build: ${short} failed after ${secs}: ${b.error ?? `lake build exited with ${b.exit}`}${b.retry ? "; tried again at the next look at the remote" : ""} (its log: ${log.file})`);
  }
}
