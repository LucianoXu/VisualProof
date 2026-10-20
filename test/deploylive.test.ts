// Following a branch end to end (SPEC/DeploySpec.md): a bare repository made from a copy of the
// fixture, followed by a live server in this process — its clone made, each commit pushed built by
// real Lake on the toolchain under test and read by the live loop, as the pages and agents see it: a
// commit built and shown, a failing commit, two quick pushes of which the newest alone is built.
// Skipped where there is no lake.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { App } from "../src/server/app.ts";
import { AgentApi } from "../src/server/agent.ts";
import { deployFolder, Deployment, ensureClone, parseRemote } from "../src/server/deploy.ts";
import type { Remote } from "../src/server/deploy.ts";
import { LeanHover } from "../src/server/hover.ts";
import { Identities } from "../src/server/identity.ts";
import { Live } from "../src/server/live.ts";
import { openProject } from "../src/server/project.ts";
import { ReviewStore } from "../src/server/review.ts";
import { copyFixture, leanAtLeast } from "./fixturecopy.ts";
import { stream } from "./site.ts";
import type { Json } from "./site.ts";
import { testDirs } from "./tmpdirs.ts";

let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}

const G = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" };
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env: G });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

let root = "";
let work = "";
let live: Live;
let d: Deployment;
let hover: LeanHover;
let server: Server;
let base = "";

/** Commit what `edit` does in the working copy, and push it to the remote's main. */
const push = (msg: string, edit: () => void): string => {
  edit();
  git(work, "commit", "-qam", msg);
  git(work, "push", "-q", "origin", "main");
  return git(work, "rev-parse", "HEAD");
};
const append = (file: string, text: string) => writeFileSync(join(work, file), readFileSync(join(work, file), "utf8") + text);
const get = async (path: string): Promise<Json> => (await fetch(base + path, { headers: { "x-visualproof-kind": "agent", "x-visualproof-name": "T" } })).json();
// the first build of a toolchain compiles the extractor for it: minutes, on a machine under load
const until = async (f: () => boolean | Promise<boolean>, ms = 600_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((ok) => setTimeout(ok, 100))) if (await f()) return;
  assert.fail("waited in vain");
};
/** The remote asked, what it says built, and the graph of the last build read. */
const follow = async (commit: string) => {
  await d.poll();
  await d.settled();
  await until(() => live.graph?.commit === commit && !live.reading && live.deploy?.holds() === false);
};

let first = "";

before(async () => {
  if (!haveLake) return;
  root = mkdtempSync(join(tmpdir(), "vp-deploylive-"));
  work = copyFixture("vp-deploylive-work-");
  writeFileSync(join(work, ".gitignore"), ".lake\n");
  const bare = join(root, "remote.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env: G });
  spawnSync("git", ["init", "-q", "-b", "main", work], { env: G });
  git(work, "add", "-A");
  git(work, "commit", "-qm", "the fixture");
  git(work, "remote", "add", "origin", bare);
  git(work, "push", "-q", "origin", "main");
  first = git(work, "rev-parse", "HEAD");
  const remote = parseRemote(`file://${bare}`) as Remote;
  const folder = deployFolder(join(root, "cache"), remote, "main");
  const c = await ensureClone(remote, "main", folder, () => {});
  assert.ok("commit" in c);
  const project = openProject(folder.checkout, [], false);
  const site = join(root, "site");
  mkdirSync(site);
  const dirs = testDirs(site);
  // no usage pass: what is followed is the build
  live = new Live(project, dirs, null, new ReviewStore(project.root, site), null, 0);
  hover = new LeanHover(project, dirs.cache);
  d = new Deployment({
    remote,
    branch: "main",
    folder,
    project,
    roots: [],
    everyMs: 3600_000,
    head: c.commit,
    hooks: { reading: () => live.reading, starting: () => live.usage.cancel(), toolchainChanged: () => hover.toolchainChanged(), changed: () => {}, log: () => {}, ended: () => live.reread() },
  });
  live.deploy = d;
  const app = new App(live, hover, new Identities(null), new AgentApi(live, hover, "full"), null);
  app.gitFreshMs = 0;
  server = createServer((req, res) => app.handle(req, res));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  live.start();
});

after(async () => {
  if (!haveLake) return;
  d.stop();
  live.stop();
  hover.stop();
  live.tokens.close();
  live.invites.close();
  live.readOnly.close();
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
  rmSync(root, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

test("before the first build nothing is read, and the page is told what is being done", { skip: !haveLake }, async () => {
  const st = await get("/api/status");
  assert.notEqual(st.state, "ready");
  assert.equal(st.deploy.built, null);
  assert.equal(st.deploy.branch, "main");
  assert.equal(live.graph, null);
});

test("a commit pushed is built and shown: its graph, its snapshot, its commit", { skip: !haveLake }, async () => {
  const events = stream(Number(new URL(base).port), "/api/events");
  await follow(first);
  const st = await get("/api/status");
  assert.equal(st.state, "ready");
  assert.equal(st.graph.commit, first);
  assert.equal(st.deploy.built, first);
  assert.equal(st.deploy.last.ok, true);
  assert.equal(st.build.counts.failed, 0);
  const h = await get("/api/history");
  assert.deepEqual(h.snapshots.map((s: Json) => s.commit), [{ hash: first, branch: "main" }]);
  // agents are told the branch's builds with the history; the artwork's foot the build's commit
  assert.equal((await get("/api/agent/history")).following.built, first);
  assert.equal(h.following, undefined);
  assert.deepEqual((await get("/api/git")).git, { source: null, commit: first, branch: "main" });
  // pages are told the branch's builds as their stream opens
  await events.until(() => !!events.last("deploy"));
  assert.equal(events.last("deploy")?.built, first);
  events.close();
});

test("a failing commit: its files failed, the build's end of log, what could be read of it", { skip: !haveLake }, async () => {
  const bad = push("break Leaf, touch Basic", () => {
    append("Fixture/Basic.lean", "\n-- touched\n");
    append("Fixture/Leaf.lean", "\ntheorem broken_here : (1 : Nat) = 2 := rfl\n");
  });
  await follow(bad);
  const st = await get("/api/status");
  assert.equal(st.deploy.last.commit, bad);
  assert.equal(st.deploy.last.ok, false);
  assert.equal(st.deploy.last.exit, 1);
  assert.match(st.deploy.last.tail, /Fixture\/Leaf\.lean:\d+:\d+: .*\n/);
  // its paths named from the clone's folder and the home, whatever links lead there (DeploySpec
  // decision 11): no path of the machine — the home's, elan's toolchains' (~/.elan → /data/.elan on
  // a machine whose home has its tools on another disk), the temporary folder the clone is in
  const elan = join(homedir(), ".elan");
  for (const p of new Set([homedir(), realpathSync(homedir()), ...(existsSync(elan) ? [realpathSync(elan)] : []), realpathSync(tmpdir())]))
    assert.ok(!st.deploy.last.tail.includes(`${p}/`), `the end of the log names ${p}: ${st.deploy.last.tail.slice(0, 2000)}`);
  const h = await get("/api/history");
  assert.equal(h.snapshots.at(-1).commit.hash, bad);
  // before v4.29 Lake keeps a failed file's .olean: it shows as out of date, read as last built
  // (the manual's Live)
  const leaf = st.build.files.find((f: Json) => f.module === "Fixture.Leaf");
  if (leanAtLeast(4, 29)) {
    assert.equal(leaf?.state, "failed");
    assert.ok(st.graph.missing.includes("Fixture.Leaf"));
    assert.ok(h.snapshots.at(-1).missing.includes("Fixture.Leaf"));
  } else assert.equal(leaf?.state, "stale");
});

test("two quick pushes: the newest alone is built, and is the next build of the history", { skip: !haveLake }, async () => {
  const fixed = push("fix Leaf", () => {
    const f = join(work, "Fixture/Leaf.lean");
    writeFileSync(f, readFileSync(f, "utf8").replace("(1 : Nat) = 2 := rfl", "(1 : Nat) = 1 := rfl"));
  });
  const newest = push("touch Basic again", () => append("Fixture/Basic.lean", "\n-- again\n"));
  await follow(newest);
  assert.ok(!d.tried.includes(fixed));
  assert.equal(d.tried.at(-1), newest);
  const st = await get("/api/status");
  assert.equal(st.deploy.last.ok, true);
  assert.equal(st.build.counts.failed, 0);
  assert.deepEqual(st.graph.missing, []);
  const h = await get("/api/history");
  const commits = h.snapshots.map((s: Json) => s.commit.hash);
  assert.equal(commits.at(-1), newest);
  assert.ok(!commits.includes(fixed));
  // the build's source texts are its commit's: the history keeps them
  const leaf = await get(`/api/history/source?id=${h.snapshots.at(-1).id}&module=Fixture.Leaf`);
  assert.match(leaf.text, /\(1 : Nat\) = 1 := rfl/);
  assert.equal(leaf.from, "tree");
});

test("a failing commit that compiled nothing: failed, not built — the board, the history and the agents keep the build before", { skip: !haveLake }, async () => {
  const was = d.status(true).built!;
  const shown = live.graph!.version;
  const snapshots = (await get("/api/history")).snapshots.length;
  // Leaf alone changed, and fails: nothing is compiled
  const broken = push("break Leaf alone", () => append("Fixture/Leaf.lean", "\ntheorem broken_again : (1 : Nat) = 2 := rfl\n"));
  await d.poll();
  await d.settled();
  // the tree is read again once it settles: a new graph where what can be read of it changed (Lake
  // since v4.29 removes a failed file's .olean), else the same one kept
  const t0 = Date.now();
  await until(() => ((live.graph?.version ?? 0) > shown || Date.now() - t0 > 8000) && !live.reading);
  const st = await get("/api/status");
  assert.equal(st.deploy.last.commit, broken);
  assert.equal(st.deploy.last.ok, false);
  // what is said built is the commit whose build the board reads (DeploySpec decision 6)
  assert.equal(st.deploy.built, was);
  assert.equal(st.graph.commit, was);
  const h = await get("/api/history");
  assert.equal(h.snapshots.length, snapshots);
  assert.equal(h.snapshots.at(-1).commit.hash, was);
  assert.equal((await get("/api/agent/history")).following.built, was);
  assert.equal((await get("/api/git")).git.commit, was);
});
