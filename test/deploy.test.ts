// Following a branch (server/deploy.ts, SPEC/DeploySpec.md), its pieces: the addresses and branches
// followed, the programs' environment, and the deployment — the clone, the latest-only queue, a
// failed build, a build cut short and done again, a build past its time, a commit that is no Lean
// project, Mathlib's cache, the user's or the deployment's own — against real git on bare
// repositories of a temporary folder, with a Lake of the test's own whose every build does what its
// commit's BUILD file says.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { askRemote, branchProblem, branchToFollow, buildEnv, BuildLog, DeployBusy, deployFolder, Deployment, deploySite, ensureClone, isGitAddress, limitInWords, lockDeployment, noPrompts, gitEnv, parseBuildHours, parseRemote, recordedDefault, sharedMathlibCache } from "../src/server/deploy.ts";
import type { DeploymentOptions, Remote } from "../src/server/deploy.ts";
import { openProject } from "../src/server/project.ts";
import { stopChildren } from "../src/server/children.ts";
import { githubBlob, slimDeploy } from "../src/shared/deploy.ts";
import { deployHtml, deployWaiting, stepPill, took } from "../src/web/src/buildpop.ts";

const ROOT = mkdtempSync(join(tmpdir(), "vp-deploy-"));
// a test that failed midway may leave its Lake waiting: stopped, so that the run ends
after(async () => {
  await stopChildren(500);
  rmSync(ROOT, { recursive: true, force: true });
});

const G = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" };
function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env: G });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

let repos = 0;
/** A bare repository on this machine, and a working copy that pushes to its main. */
function repo() {
  const dir = join(ROOT, `r${++repos}`);
  mkdirSync(dir);
  const bare = join(dir, "remote.git");
  const work = join(dir, "work");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env: G });
  spawnSync("git", ["init", "-q", "-b", "main", work], { env: G });
  git(work, "remote", "add", "origin", bare);
  const commit = (files: Record<string, string | null>, msg = "c"): string => {
    for (const [f, text] of Object.entries(files)) {
      if (text === null) rmSync(join(work, f), { force: true });
      else writeFileSync(join(work, f), text);
    }
    git(work, "add", "-A");
    git(work, "commit", "-q", "--allow-empty", "-m", msg);
    git(work, "push", "-q", "origin", "main");
    return git(work, "rev-parse", "HEAD");
  };
  return { dir, url: `file://${bare}`, commit };
}

/** The test's Lake: it says what it was asked, and Mathlib's cache where it was asked to keep it; a
 *  build waits while the commit has a SLOW file until GO is there (a minute at most), writes an
 *  `.olean`, and fails where BUILD says so, naming its file by its path on this machine. */
const BIN = join(ROOT, "bin");
mkdirSync(BIN);
const LAKE = join(BIN, "lake");
const LAKE_LOG = join(ROOT, "lake.log");
const GO = join(ROOT, "go");
writeFileSync(
  LAKE,
  `#!/bin/sh
echo "lake $*" >> "${LAKE_LOG}"
if [ "$1" = "exe" ]; then echo "cache: 3 files in \${MATHLIB_CACHE_DIR:-the shared cache}"; exit 0; fi
n=0
if [ -f SLOW ]; then while [ ! -f "${GO}" ] && [ $n -lt 1200 ]; do sleep 0.05; n=$((n+1)); done; fi
mkdir -p .lake/build/lib/lean
date +%s%N > .lake/build/lib/lean/M.olean
if grep -q fail BUILD 2>/dev/null; then echo "error: $PWD/M.lean:1:0: unknown identifier 'oops'" >&2; exit 1; fi
echo "✔ [1/1] Built M"
`,
);
chmodSync(LAKE, 0o755);
const lakeSaid = () => (existsSync(LAKE_LOG) ? readFileSync(LAKE_LOG, "utf8") : "");

const PROJECT = { "lean-toolchain": "leanprover/lean4:v4.33.1\n", "M.lean": "def x := 1\n", BUILD: "ok\n", ".gitignore": ".lake\n" };

/** What a test may give a deployment besides its folder. */
type More = Partial<Pick<DeploymentOptions, "ask" | "buildMs" | "mathlibCache">>;

/** A deployment of `r`'s main in a cache of its own, its clone made. */
async function deployment(r: ReturnType<typeof repo>, more: More = {}) {
  const remote = parseRemote(r.url) as Remote;
  const cache = join(r.dir, "cache");
  const folder = deployFolder(cache, remote, "main");
  const c = await ensureClone(remote, "main", folder, () => {});
  assert.ok("commit" in c, JSON.stringify(c));
  return make(remote, folder, c.commit, more);
}

function make(remote: Remote, folder: ReturnType<typeof deployFolder>, head: string, more: More = {}) {
  const project = openProject(folder.checkout, ["M"], false);
  const seen = { starting: 0, toolchain: 0, log: [] as string[] };
  const d = new Deployment({
    remote,
    branch: "main",
    folder,
    project,
    roots: ["M"],
    everyMs: 3600_000,
    head,
    lake: LAKE,
    ...more,
    hooks: { reading: () => false, starting: () => seen.starting++, toolchainChanged: () => seen.toolchain++, changed: () => {}, log: (l) => seen.log.push(l) },
  });
  return { d, folder, project, seen, remote };
}

// generous: a machine under load runs git and the test's Lake slowly
const until = async (f: () => boolean, ms = 60_000) => {
  for (const end = Date.now() + ms; !f() && Date.now() < end; ) await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(f(), "waited in vain");
};

// ---------------------------------------------------------------- addresses and branches

test("the addresses followed, and those refused", () => {
  const ok = (a: string) => {
    const r = parseRemote(a);
    assert.ok(!("error" in r), `${a}: ${"error" in r ? r.error : ""}`);
    return r as Remote;
  };
  const no = (a: string, why: RegExp) => {
    const r = parseRemote(a);
    assert.ok("error" in r, `${a} was taken`);
    assert.match((r as { error: string }).error, why);
  };
  assert.deepEqual(ok("https://github.com/leanprover-community/flt-regular"), { url: "https://github.com/leanprover-community/flt-regular", kind: "https", source: "github.com/leanprover-community/flt-regular", github: "leanprover-community/flt-regular", name: "flt-regular" });
  assert.equal(ok("https://github.com/A/B.git").github, "A/B");
  assert.equal(ok("git@github.com:A/B.git").kind, "ssh");
  assert.equal(ok("git@github.com:A/B.git").github, "A/B");
  assert.equal(ok("git@github.com:A/B.git").source, "github.com/A/B");
  assert.equal(ok("ssh://git@gitlab.example.org:2222/team/proj.git").github, null);
  assert.equal(ok("ssh://git@gitlab.example.org:2222/team/proj.git").name, "proj");
  assert.equal(ok("https://gitlab.com/a/b/c").github, null);
  assert.equal(ok("file:///srv/git/proj.git").kind, "file");
  assert.equal(ok("file:///srv/git/proj.git").source, null);
  no("http://github.com/A/B", /https/);
  no("git://github.com/A/B", /not followed/);
  no("ext::sh -c touch% /tmp/x", /no spaces|not followed|not a git address/);
  no("ext::ssh -oProxyCommand=x a", /no spaces/);
  no("https://user:secret@github.com/A/B", /no user name, password or token/);
  no("https://ghp_token@github.com/A/B", /no user name, password or token/);
  no("ssh://git:pw@host/A", /no user name, password or token/);
  no("-uhttps://github.com/A/B", /start with -/);
  no("host:-oProxyCommand", /start with -/);
  no("-oProxyCommand=x:y", /start with -/);
  no("https://github.com/A/../B", /path/);
  no("https://github.com/A/B?x=1", /query/);
  no("file://host/srv/x", /this machine/);
  no("https://github.com/", /path/);
  // a folder is a folder
  for (const p of ["/srv/proj", "./a:b", "proj", "../x", "C:\\proj", "a/b:c"]) assert.equal(isGitAddress(p), false, p);
  for (const a of ["https://x/y", "git@h:p", "h:p", "file:///x", "ext::x"]) assert.equal(isGitAddress(a), true, a);
});

test("branches as git takes them, and nothing git would read otherwise", () => {
  for (const b of ["main", "feat/x", "release-0.5", "v1.2"]) assert.equal(branchProblem(b), null, b);
  for (const b of ["-x", "a..b", "@{-1}", "a b", "HEAD", "a:b", "x~1", "", "refs/heads/../x", "a\nb"]) assert.ok(branchProblem(b), b);
});

test("nothing that git or Lake starts waits on a prompt; git works on the clone alone", () => {
  const e = noPrompts({ PATH: "/bin" }, null);
  assert.equal(e.GIT_TERMINAL_PROMPT, "0");
  assert.equal(e.GIT_ASKPASS, "");
  assert.equal(e.SSH_ASKPASS_REQUIRE, "never");
  assert.equal(e.GCM_INTERACTIVE, "never");
  assert.equal(e.GIT_SSH_COMMAND, "ssh -o BatchMode=yes");
  // the user's ssh command, the environment's first, git's configured one next
  assert.equal(noPrompts({ GIT_SSH_COMMAND: "ssh -i /k" }, "ssh -i /c").GIT_SSH_COMMAND, "ssh -i /k -o BatchMode=yes");
  assert.equal(noPrompts({}, "ssh -i /c").GIT_SSH_COMMAND, "ssh -i /c -o BatchMode=yes");
  // a GIT_SSH program takes no options of ours
  assert.equal(noPrompts({ GIT_SSH: "/usr/bin/plink" }, null).GIT_SSH_COMMAND, undefined);
  const was = { ...process.env };
  try {
    Object.assign(process.env, { GIT_DIR: "/elsewhere/.git", GIT_WORK_TREE: "/elsewhere", VISUALPROOF_SUPERVISED: "1", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.sshCommand", GIT_CONFIG_VALUE_0: "evil" });
    const env = gitEnv(parseRemote("https://github.com/A/B") as Remote);
    for (const k of ["GIT_DIR", "GIT_WORK_TREE", "VISUALPROOF_SUPERVISED", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) assert.equal(env[k], undefined, k);
    assert.equal(env.GIT_ALLOW_PROTOCOL, "https");
    assert.equal(gitEnv(parseRemote("git@github.com:A/B") as Remote).GIT_ALLOW_PROTOCOL, "ssh");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in was)) delete process.env[k];
  }
});

test("Mathlib's cache: the user's, as their builds find it, unless the deployment has its own", () => {
  // as Mathlib's cache program reads it (Cache/IO.lean, CACHEDIR)
  assert.equal(sharedMathlibCache({}, "/h"), "/h/.cache/mathlib");
  assert.equal(sharedMathlibCache({ XDG_CACHE_HOME: "/x" }, "/h"), "/x/mathlib");
  assert.equal(sharedMathlibCache({ XDG_CACHE_HOME: "/x", MATHLIB_CACHE_DIR: "/m" }, "/h"), "/m");
  const was = { ...process.env };
  try {
    Object.assign(process.env, { MATHLIB_CACHE_DIR: "/users/cache", XDG_CACHE_HOME: "/xdg" });
    // shared: Lake's environment is the server's
    assert.equal(buildEnv().MATHLIB_CACHE_DIR, "/users/cache");
    // its own: that folder, whatever the server's environment says; XDG_CACHE_HOME, which Lake's
    // cache and git's credential cache are found by too, as it was
    const own = buildEnv("/c/deploy/b-1/mathlib-cache");
    assert.equal(own.MATHLIB_CACHE_DIR, "/c/deploy/b-1/mathlib-cache");
    assert.equal(own.XDG_CACHE_HOME, "/xdg");
    assert.equal(own.GIT_TERMINAL_PROMPT, "0");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in was)) delete process.env[k];
    Object.assign(process.env, was);
  }
});

test("--build-timeout: hours, fractions too, within bounds; the limit said readably", () => {
  for (const [v, h] of [["6", 6], ["1.5", 1.5], ["0.05", 0.05], ["168", 168], ["24", 24]] as const) assert.equal(parseBuildHours(v), h, v);
  for (const v of ["0", "0.04", "168.5", "1000", "-1", "6h", "1e2", ".5", "", "Infinity", "NaN", " 6"]) {
    const r = parseBuildHours(v);
    assert.equal(typeof r, "object", v);
    assert.match((r as { error: string }).error, /^--build-timeout .*: say after how many hours a build is stopped, from 0\.05 \(3 min\) to 168 \(a week\)/, v);
  }
  const h = 3600_000;
  assert.equal(limitInWords(6 * h), "6 hours");
  assert.equal(limitInWords(h), "1 hour");
  assert.equal(limitInWords(1.5 * h), "1 h 30 min");
  assert.equal(limitInWords(0.05 * h), "3 min");
  assert.equal(limitInWords(0.07 * h), "4 min 12 s");
  assert.equal(limitInWords(168 * h), "168 hours");
  assert.equal(limitInWords(500), "0.5 s");
  assert.equal(limitInWords(45_000), "45 s");
});

test("a deployment's folders: per address and branch, its site wherever the cache is", () => {
  const r = parseRemote("https://github.com/A/flt-regular") as Remote;
  const f = deployFolder("/c", r, "main");
  assert.match(f.dir, /^\/c\/deploy\/flt-regular-[0-9a-f]{8}$/);
  assert.equal(f.checkout, join(f.dir, "flt-regular"));
  // Mathlib's cache, where it is the deployment's own: removed with its folder
  assert.equal(f.mathlib, join(f.dir, "mathlib-cache"));
  assert.notEqual(deployFolder("/c", r, "dev").dir, f.dir);
  assert.equal(deploySite(r, "main", { platform: "linux", env: {}, home: "/h" }).split("/").pop(), f.dir.split("/").pop());
  assert.match(deploySite(r, "main", { platform: "linux", env: {}, home: "/h" }), /^\/h\/\.local\/share\/visualproof\/sites\/flt-regular-/);
});

// ---------------------------------------------------------------- the remote and the clone

test("the remote asked: a branch's head, its default branch, a branch it has not", async () => {
  const r = repo();
  const a = r.commit(PROJECT);
  const remote = parseRemote(r.url) as Remote;
  assert.deepEqual(await askRemote(remote, "main", gitEnv(remote)), { head: a, branch: "main" });
  assert.deepEqual(await askRemote(remote, null, gitEnv(remote)), { head: a, branch: "main" });
  assert.match(((await askRemote(remote, "dev", gitEnv(remote))) as { error: string }).error, /no branch dev/);
  const cache = join(r.dir, "cache");
  assert.equal(await branchToFollow(remote, null, cache), "main");
  assert.equal(recordedDefault(cache, r.url), "main");
  assert.equal(await branchToFollow(remote, "dev", cache), "dev");
  const gone = parseRemote(`file://${join(r.dir, "nowhere.git")}`) as Remote;
  assert.ok("error" in (await askRemote(gone, "main", gitEnv(gone))));
});

test("the clone: made once, whole, at the branch's head; one server follows a branch per cache", async () => {
  const r = repo();
  const a = r.commit(PROJECT);
  const remote = parseRemote(r.url) as Remote;
  const folder = deployFolder(join(r.dir, "cache"), remote, "main");
  assert.deepEqual(await ensureClone(remote, "main", folder, () => {}), { commit: a, made: true });
  assert.equal(git(folder.checkout, "rev-parse", "HEAD"), a);
  assert.equal(git(folder.checkout, "remote", "get-url", "origin"), r.url);
  assert.deepEqual(await ensureClone(remote, "main", folder, () => {}), { commit: a, made: false });
  const none = await ensureClone(remote, "dev", deployFolder(join(r.dir, "cache"), remote, "dev"), () => {});
  assert.ok("error" in none && /dev/.test(none.error));
  assert.equal(existsSync(deployFolder(join(r.dir, "cache"), remote, "dev").checkout), false);
  const release = lockDeployment(folder, remote, "main");
  release();
  // another living process holds it
  writeFileSync(join(folder.dir, ".lock"), `${process.ppid}\n`);
  assert.throws(() => lockDeployment(folder, remote, "main"), DeployBusy);
});

// ---------------------------------------------------------------- the deployment

test("the first build: nothing is read before it; its commit is the build's", async () => {
  const r = repo();
  const a = r.commit(PROJECT);
  const { d, folder, seen } = await deployment(r);
  assert.equal(d.holds(), true);
  assert.equal(d.commit(), null);
  await d.poll();
  await d.settled();
  assert.equal(d.holds(), false);
  assert.deepEqual(d.commit(), { hash: a, branch: "main" });
  assert.equal(seen.starting, 1);
  const s = d.status(true);
  assert.equal(s.built, a);
  assert.equal(s.last?.ok, true);
  assert.equal(s.last?.exit, 0);
  assert.equal(s.building, null);
  assert.equal(s.next, null);
  assert.equal(s.asked?.head, a);
  assert.match(lakeSaid(), /lake build M/);
  assert.ok(existsSync(join(folder.logs, `${a}.log`)));
  // asked again, nothing new: nothing built again
  await d.poll();
  await d.settled();
  assert.deepEqual(d.tried, [a]);
});

test("a push during a build: only the newest commit pushed meanwhile is built after it", async () => {
  rmSync(GO, { force: true });
  const r = repo();
  const a = r.commit({ ...PROJECT, SLOW: "" });
  const { d, folder } = await deployment(r);
  void d.poll();
  await until(() => d.status(true).building?.step === "build");
  assert.equal(d.holds(), true);
  assert.equal(d.busy, true);
  // what the build says now, to those let in fully
  assert.match(d.status(true).building?.tail ?? "", /\$ lake build M$/);
  assert.equal(d.status(false).building?.tail, undefined);
  assert.equal(d.status(false).building?.commit, a);
  const b = r.commit({ "M.lean": "def x := 2\n" });
  const c = r.commit({ "M.lean": "def x := 3\n" });
  await d.poll();
  assert.equal(d.status(true).next, c);
  await d.poll();
  writeFileSync(GO, "");
  await d.settled();
  assert.deepEqual(d.tried, [a, c]);
  assert.ok(!d.tried.includes(b));
  assert.equal(d.status(true).built, c);
  assert.equal(git(folder.checkout, "rev-parse", "HEAD"), c);
  assert.equal(readFileSync(join(folder.checkout, "M.lean"), "utf8"), "def x := 3\n");
  // what the build wrote is kept across checkouts
  assert.ok(existsSync(join(folder.checkout, ".lake", "build", "lib", "lean", "M.olean")));
});

test("a failing build: shown with its end of log, not tried again, the tree its build's", async () => {
  const r = repo();
  r.commit(PROJECT);
  const { d, folder } = await deployment(r);
  await d.poll();
  await d.settled();
  const bad = r.commit({ BUILD: "fail\n" });
  await d.poll();
  await d.settled();
  const s = d.status(true);
  assert.equal(s.last?.ok, false);
  assert.equal(s.last?.exit, 1);
  assert.equal(s.last?.retry, undefined);
  assert.equal(s.built, bad);
  assert.equal(d.holds(), false);
  assert.deepEqual(d.commit(), { hash: bad, branch: "main" });
  // the clone's folder is `.`: no path of this machine reaches a page
  assert.match(s.last!.tail!, /error: \.\/M\.lean:1:0: unknown identifier/);
  assert.ok(!s.last!.tail!.includes(folder.checkout));
  // a read-only reader is not given the log
  assert.equal(d.status(false).last?.tail, undefined);
  assert.equal(slimDeploy(s).last?.tail, undefined);
  await d.poll();
  await d.settled();
  assert.equal(d.tried.filter((c) => c === bad).length, 1);
});

test("a commit that is no Lean project: the tree goes back to the last build", async () => {
  const r = repo();
  const a = r.commit(PROJECT);
  const { d, folder, project } = await deployment(r);
  await d.poll();
  await d.settled();
  const gone = r.commit({ "lean-toolchain": null });
  await d.poll();
  await d.settled();
  const s = d.status(true);
  assert.equal(s.last?.commit, gone);
  assert.equal(s.last?.ok, false);
  assert.match(s.last?.error ?? "", /no Lean project/);
  assert.equal(s.built, a);
  assert.equal(git(folder.checkout, "rev-parse", "HEAD"), a);
  assert.equal(d.holds(), false);
  assert.equal(project.toolchain, "leanprover/lean4:v4.33.1");
  await d.poll();
  await d.settled();
  assert.equal(d.tried.filter((c) => c === gone).length, 1);
});

test("a commit that cannot be fetched is tried again at the next look; the tree is left as it is", async () => {
  const r = repo();
  r.commit(PROJECT);
  const ghost = "0123456789abcdef0123456789abcdef01234567";
  const { d } = await deployment(r, { ask: async () => ({ head: ghost }) });
  await d.poll();
  await d.settled();
  const s = d.status(true);
  assert.equal(s.last?.ok, false);
  assert.equal(s.last?.retry, true);
  assert.equal(s.built, null);
  assert.equal(d.holds(), true);
  await d.poll();
  await d.settled();
  assert.deepEqual(d.tried, [ghost, ghost]);
});

test("a build cut short (a restart) is done again by the next server; Mathlib's cache comes first", async () => {
  rmSync(GO, { force: true });
  rmSync(LAKE_LOG, { force: true });
  const r = repo();
  const a = r.commit({ ...PROJECT, SLOW: "", "lake-manifest.json": JSON.stringify({ version: "1.1.0", packages: [{ name: "mathlib", type: "git" }] }) });
  const first = await deployment(r);
  void first.d.poll();
  await until(() => /lake build M/.test(lakeSaid()));
  assert.match(lakeSaid(), /lake exe cache get\nlake build M/);
  // the server stops: its programs are stopped with it
  first.d.stop();
  await stopChildren(500);
  await first.d.running;
  const state = JSON.parse(readFileSync(first.folder.state, "utf8"));
  assert.equal(state.building.commit, a);
  assert.equal(state.outputs, null);
  // the next server: it holds the tree, and builds it again
  writeFileSync(GO, "");
  const next = make(first.remote, first.folder, a);
  assert.equal(next.d.holds(), true);
  assert.match(next.seen.log.join("\n"), /cut short/);
  await next.d.poll();
  await next.d.settled();
  assert.deepEqual(next.d.tried, [a]);
  assert.equal(next.d.holds(), false);
  assert.equal(next.d.status(true).last?.ok, true);
  // and once built, a restart reads it at once
  const third = make(first.remote, first.folder, a);
  assert.equal(third.d.holds(), false);
  await third.d.poll();
  await third.d.settled();
  assert.deepEqual(third.d.tried, []);
});

test("a build past --build-timeout is stopped and failed, the limit said; its commit is not tried again", async () => {
  rmSync(GO, { force: true });
  const r = repo();
  const a = r.commit({ ...PROJECT, SLOW: "" });
  const { d, folder, remote } = await deployment(r, { buildMs: 1500 });
  await d.poll();
  await d.settled();
  const s = d.status(true);
  assert.equal(s.last?.commit, a);
  assert.equal(s.last?.ok, false);
  assert.equal(s.last?.retry, undefined);
  // stopped by a signal: no status of Lake's own
  assert.equal(s.last?.exit, null);
  assert.equal(s.last?.error, "it took longer than 1.5 s (--build-timeout): stopped");
  assert.match(readFileSync(join(folder.logs, `${a}.log`), "utf8"), /\nlake build took longer than 1\.5 s \(--build-timeout\): stopped\n$/);
  // the tree is that build's, read as a failed build's is
  assert.equal(s.built, a);
  assert.equal(d.holds(), false);
  await d.poll();
  await d.settled();
  assert.deepEqual(d.tried, [a]);
  // the default: six hours
  assert.equal(make(remote, folder, a).d.buildMs, 6 * 3600_000);
});

test("Mathlib's cache: the deployment's own in its folder with --mathlib-cache own, else the user's", async () => {
  const manifest = JSON.stringify({ version: "1.1.0", packages: [{ name: "mathlib", type: "git" }] });
  const r = repo();
  const a = r.commit({ ...PROJECT, "lake-manifest.json": manifest });
  const own = await deployment(r, { mathlibCache: "own" });
  await own.d.poll();
  await own.d.settled();
  assert.equal(own.d.status(true).last?.ok, true);
  const said = readFileSync(join(own.folder.logs, `${a}.log`), "utf8");
  // the command as it was run, the folder beside the clone
  assert.match(said, /^\$ MATHLIB_CACHE_DIR=\.\.\/mathlib-cache lake exe cache get$/m);
  assert.ok(said.includes(`cache: 3 files in ${own.folder.mathlib}\n`), said);
  assert.equal(join(own.folder.checkout, "..", "mathlib-cache"), own.folder.mathlib);
  // the default: the user's, as the server's environment says
  const r2 = repo();
  const b = r2.commit({ ...PROJECT, "lake-manifest.json": manifest });
  const shared = await deployment(r2);
  await shared.d.poll();
  await shared.d.settled();
  const log = readFileSync(join(shared.folder.logs, `${b}.log`), "utf8");
  assert.match(log, /^\$ lake exe cache get$/m);
  assert.ok(log.includes(`cache: 3 files in ${process.env.MATHLIB_CACHE_DIR || "the shared cache"}\n`), log);
});

test("a commit that changes the toolchain: the project and Lean follow it", async () => {
  const r = repo();
  r.commit(PROJECT);
  const { d, project, seen } = await deployment(r);
  await d.poll();
  await d.settled();
  r.commit({ "lean-toolchain": "leanprover/lean4:v4.34.1\n" });
  await d.poll();
  await d.settled();
  assert.equal(project.toolchain, "leanprover/lean4:v4.34.1");
  assert.equal(seen.toolchain, 1);
});

// ---------------------------------------------------------------- what the page says

test("the popover, the pill and the loading page say the branch's builds", () => {
  const base = { source: "github.com/A/B", github: "A/B", branch: "main", every: 120, asked: { at: "2026-10-18T10:00:00Z", head: "b".repeat(40) }, building: null, next: null, built: "a".repeat(40) };
  const now = new Date("2026-10-18T12:00:00Z");
  const failed = { ...base, last: { commit: "c".repeat(40), ok: false, at: "2026-10-18T10:01:00Z", ms: 75_000, exit: 1, tail: "error: ./M.lean:1:0: <oops>" } };
  const html = deployHtml(failed, now);
  assert.match(html, /Following <b>main<\/b> of <a href="https:\/\/github.com\/A\/B\/tree\/main"/);
  assert.match(html, /asked every 2 min/);
  assert.match(html, /The build of <a class="mono" href="https:\/\/github.com\/A\/B\/commit\/c{40}"[^>]*>ccccccc<\/a> failed/);
  assert.match(html, /after 1 min 15 s: lake build exited with 1/);
  assert.match(html, /The board shows the build of/);
  assert.match(html, /&lt;oops&gt;/);
  const building = { ...base, building: { commit: "d".repeat(40), since: "2026-10-18T11:59:00Z", step: "cache" as const }, next: "e".repeat(40), last: null };
  assert.match(deployHtml(building, now), /Building .*ddddddd.* getting Mathlib's cache/);
  assert.match(deployHtml(building, now), /Then .*eeeeeee.*commits pushed before it are not built/);
  assert.equal(stepPill(building.building), "Mathlib's cache ddddddd");
  // a repository on this machine, no GitHub
  assert.match(deployHtml({ ...base, source: null, github: null, last: null }, now), /of a repository on this machine/);
  assert.equal(took(700), "0.7 s");
  assert.equal(took(3_725_000), "1 h 2 min");
  // the first start, never a dead end
  const first = { ...base, built: null, last: null };
  assert.match(deployWaiting({ ...first, building: { commit: "d".repeat(40), since: "", step: "build" } }, { state: "extracting", progress: { done: 3, total: 8 } }).title, /^The first build of github.com\/A\/B \(main\) at ddddddd: lake build, 3 of 8 files… The board appears once it is done\.$/);
  const notYet = deployWaiting({ ...first, last: { commit: "c".repeat(40), ok: false, at: "", ms: 1, retry: true, error: "it could not be fetched: Permission denied (publickey)" } }, { state: "extracting" });
  assert.match(notYet.title, /could not be made: it could not be fetched: Permission denied \(publickey\)\. It is tried again at the next look at the remote, every 2 min\./);
  const nothing = deployWaiting({ ...failed, built: "c".repeat(40) }, { state: "error", error: "No part of this build can be read" });
  assert.match(nothing.title, /left nothing that can be read: lake build exited with 1\. The next commit pushed to main is built/);
  assert.equal(nothing.log, failed.last.tail);
  assert.equal(githubBlob("A/B", "c".repeat(40), "Fixture/Leaf Two.lean", 3, 7), `https://github.com/A/B/blob/${"c".repeat(40)}/Fixture/Leaf%20Two.lean#L3-L7`);
  assert.equal(githubBlob("A/B", "c", "M.lean", 3, 3), "https://github.com/A/B/blob/c/M.lean#L3");
});

test("a build's log names the clone '.', by the path given and by the path resolved", () => {
  // macOS: the temporary folder is /var/…, which Lean prints resolved, /private/var/…
  const real = join(ROOT, "real-clone");
  mkdirSync(real, { recursive: true });
  const link = join(ROOT, "linked-clone");
  symlinkSync(real, link);
  const log = new BuildLog(join(ROOT, "log-names"), "c0ffee", link);
  // resolved all the way: on macOS ROOT itself is under /var
  log.text(`$ lake build M\nerror: ${realpathSync(real)}/M.lean:1:0: unknown identifier 'oops'\n${link}/N.lean: built\n`);
  log.close();
  assert.equal(log.tail(), "$ lake build M\nerror: ./M.lean:1:0: unknown identifier 'oops'\n./N.lean: built");
});
