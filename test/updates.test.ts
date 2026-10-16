// VisualProof following its own releases (UpdateSpec.md, server/updates.ts, server/supervise.ts,
// web/src/reload.ts): which versions a server takes by itself and which it only tells of, the
// registry read through npm, the patches kept in the cache, the quiet moment, the supervisor's
// restarts and what it sets aside, the page reloading into a new version keeping what it holds,
// and what each reader is told.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { choose, codeToRun, installCommand, newerThan, notesOf, registryEngines, registryVersions, sameMinor, stable, Updates, Versions } from "../src/server/updates.ts";
import type { Npm } from "../src/server/updates.ts";
import { RESTART_STATUS, signalStatus, supervise } from "../src/server/supervise.ts";
import { satisfies } from "../src/server/version.ts";
import { keep, Reloader, takeKept } from "../src/web/src/reload.ts";
import type { Kept, KeptStorage } from "../src/web/src/reload.ts";
import { site, stream } from "./site.ts";

const tmp = mkdtempSync(join(tmpdir(), "vp-updates-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const fresh = (name: string) => {
  const d = join(tmp, `${name}-${n++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

/** a package of version `v` at `root`, as npm leaves one: its package.json and its server */
function pkg(root: string, v: string, engines = "^22.18.0 || >=24.2.0"): string {
  mkdirSync(join(root, "dist", "server"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "visualproof", version: v, engines: { node: engines }, repository: { url: "git+https://github.com/LucianoXu/VisualProof.git" } }));
  writeFileSync(join(root, "dist", "server", "main.js"), "");
  return root;
}

/** a patch downloaded and ready in the cache, its folders the user's alone, as a server makes them */
function ready(cache: string, v: string, engines?: string): void {
  pkg(join(cache, "versions", v, "node_modules", "visualproof"), v, engines);
  writeFileSync(join(cache, "versions", v, "ready"), `${v}\n`);
  chmodSync(join(cache, "versions"), 0o700);
  chmodSync(join(cache, "versions", v), 0o700);
}

test("releases: only x.y.z; newer, and of one minor", () => {
  assert.deepEqual(stable("0.4.1"), [0, 4, 1]);
  for (const v of ["0.0.0-stage", "0.5.0-rc.1", "v0.4.1", "0.4"]) assert.equal(stable(v), null, v);
  assert.ok(newerThan("0.4.10", "0.4.9") && !newerThan("0.4.1", "0.4.1") && !newerThan("0.5.0-rc.1", "0.4.1"));
  assert.ok(sameMinor("0.4.1", "0.4.7") && !sameMinor("0.4.1", "0.5.0") && !sameMinor("1.4.1", "0.4.1"));
});

test("Node ranges as npm reads them: every operator, x-ranges, hyphens, alternatives; empty is anywhere", () => {
  const yes = (v: string, r: string) => assert.ok(satisfies(v, r), `${v} in ${JSON.stringify(r)}`);
  const no = (v: string, r: string) => assert.ok(!satisfies(v, r), `${v} not in ${JSON.stringify(r)}`);
  for (const r of ["", "  ", "*", "x", ">=22", ">= 22.0.0", ">=22.0", "22", "22.x", "22.18.*", "^22.18.0", "~22.18.0", "~22", "^22", ">22.17", ">=22 <23", "22.18.0 - 22.20.0", "22 - 24", "<23", "<=22", "<=22.18", "=22.18.0", "22.18.0", ">=20 || >=24.2.0", "^20 || ^22.18.0 || >=24.2.0", "v22.18.0"]) yes("22.18.0", r);
  for (const r of [">=24", ">= 24", ">22", "23", "^24", "~22.19", "<22.18.0", "<22", "<=22.17", "22.19.0 - 24", "24 - 26", ">=24 || <20", "^22.19.0", "=22.18.1", "lots of nonsense", ">=x.y", ">*"]) no("22.18.0", r);
  // node-semver's desugaring at zero: ^0.2.3 is <0.3.0, ^0.0.3 is <0.0.4
  yes("0.2.9", "^0.2.3");
  no("0.3.0", "^0.2.3");
  no("0.0.4", "^0.0.3");
  yes("0.0.9", "^0.0");
  no("0.1.0", "^0.0");
  // the engines this package writes, as the doctor reads them
  yes("24.15.0", "^22.18.0 || >=24.2.0");
  no("24.1.0", "^22.18.0 || >=24.2.0");
  // an empty range, or none, is a release that runs anywhere: still taken, still told of
  assert.deepEqual(choose("0.4.0", ["0.4.1", "0.5.0"], { engines: () => "", node: "22.18.0" }), { patch: "0.4.1", release: "0.5.0" });
  assert.deepEqual(choose("0.4.0", ["0.4.1", "0.5.0"], { engines: (v) => (v === "0.5.0" ? ">=24" : ">= 22"), node: "24.15.0" }), { patch: "0.4.1", release: "0.5.0" });
  assert.deepEqual(choose("0.4.0", ["0.4.1", "0.5.0"], { engines: (v) => (v === "0.5.0" ? ">=24" : ">= 22"), node: "22.18.0" }), { patch: "0.4.1", release: "0.4.1" });
});

test("what a server may take by itself (a patch of its minor) and what it tells of (any newer release)", () => {
  const vs = ["0.0.0-stage", "0.3.0", "0.4.0", "0.4.1", "0.4.2", "0.5.0", "0.5.1-rc.1", "0.6.0-rc.1"];
  assert.deepEqual(choose("0.4.0", vs), { patch: "0.4.2", release: "0.5.0" });
  assert.deepEqual(choose("0.4.2", vs), { patch: null, release: "0.5.0" });
  assert.deepEqual(choose("0.5.0", vs), { patch: null, release: null });
  // a patch set aside is not taken again; one whose Node is not this one is neither taken nor told of
  assert.deepEqual(choose("0.4.0", vs, { bad: new Set(["0.4.2"]) }), { patch: "0.4.1", release: "0.5.0" });
  const engines = (v: string) => (v === "0.5.0" ? ">=26.0.0" : "^22.18.0 || >=24.2.0");
  assert.deepEqual(choose("0.4.0", vs, { engines, node: "24.15.0" }), { patch: "0.4.2", release: "0.4.2" });
});

test("the registry, read through npm: the versions, a version's engines; npm failing says why", async () => {
  const asked: string[][] = [];
  const ask: Npm = async (args) => {
    asked.push(args);
    if (args[1] === "visualproof") return { ok: true, out: '[\n  "0.3.0",\n  "0.4.0"\n]\n' };
    if (args[1] === "visualproof@0.4.0") return { ok: true, out: '{ "node": ">=24.2.0" }' };
    return { ok: false, why: "404 No match found for version 9.9.9" };
  };
  assert.deepEqual(await registryVersions(ask), { versions: ["0.3.0", "0.4.0"] });
  assert.deepEqual(asked[0], ["view", "visualproof", "versions", "--json"]);
  assert.equal(await registryEngines("0.4.0", ask), ">=24.2.0");
  assert.equal(await registryEngines("9.9.9", ask), null);
  // one version only: npm says it bare
  assert.deepEqual(await registryVersions(async () => ({ ok: true, out: '"0.1.0"' })), { versions: ["0.1.0"] });
  assert.deepEqual(await registryVersions(async () => ({ ok: false, why: "ENOTFOUND registry.npmjs.org" })), { why: "ENOTFOUND registry.npmjs.org" });
});

test("the command that installs a release where this one is installed; its notes", () => {
  assert.equal(installCommand("/home/u/.nvm/versions/node/v24.15.0/lib/node_modules/visualproof", "0.5.0", "/home/u/.nvm/versions/node/v24.15.0/bin/node"), "npm install --global visualproof@0.5.0");
  assert.equal(installCommand("/usr/local/lib/node_modules/visualproof", "0.5.0", "/home/u/.nvm/versions/node/v24.15.0/bin/node"), "npm install --global --prefix /usr/local visualproof@0.5.0");
  assert.equal(installCommand("/srv/vp/node_modules/visualproof", "0.5.0"), "npm install --prefix /srv/vp visualproof@0.5.0");
  const root = pkg(fresh("notes"), "0.4.0");
  assert.equal(notesOf("0.5.0", root), "https://github.com/LucianoXu/VisualProof/releases/tag/v0.5.0");
});

test("the code a supervisor runs: the newest ready patch of the installed minor, else the installed package", () => {
  const root = pkg(fresh("installed"), "0.4.0");
  const cache = fresh("cache");
  const versions = new Versions(cache);
  assert.deepEqual(codeToRun(root, versions), { main: join(root, "dist", "server", "main.js"), version: "0.4.0", cached: false });
  ready(cache, "0.4.2");
  ready(cache, "0.4.3", ">=99.0.0");
  ready(cache, "0.5.0");
  // half there: no `ready`
  pkg(join(cache, "versions", "0.4.4", "node_modules", "visualproof"), "0.4.4");
  assert.deepEqual(codeToRun(root, versions), { main: versions.mainOf("0.4.2"), version: "0.4.2", cached: true });
  versions.markBad("0.4.2", "exited with status 1 before it served");
  assert.equal(codeToRun(root, versions).version, "0.4.0");
  assert.equal(versions.bad().get("0.4.2")!.why, "exited with status 1 before it served");
  // a newer package installed meanwhile wins over the patches of the minor before
  pkg(root, "0.5.1");
  assert.deepEqual(codeToRun(root, versions), { main: join(root, "dist", "server", "main.js"), version: "0.5.1", cached: false });
});

test("the versions folder is shared by the user's servers: what one runs, or would step back to, is never removed; other minors are left", async () => {
  const cache = fresh("share");
  const versions = new Versions(cache);
  for (const v of ["0.4.1", "0.4.2", "0.4.3", "0.4.4", "0.5.0", "0.5.1"]) ready(cache, v);
  // another living server runs 0.4.1; a dead one ran 0.4.2
  const dead = spawn(process.execPath, ["-e", ""]);
  await new Promise((ok) => dead.on("exit", ok));
  writeFileSync(join(cache, "versions", "0.4.1", `running-${process.pid}`), "");
  writeFileSync(join(cache, "versions", "0.4.2", `running-${dead.pid}`), "");
  assert.ok(versions.inUse("0.4.1") && !versions.inUse("0.4.2"));
  // downloads left midway: a dead server's goes, a living one's stays
  mkdirSync(join(cache, "versions", `.0.4.5.tmp-${dead.pid}`));
  mkdirSync(join(cache, "versions", `.0.4.6.tmp-${process.pid}`));
  // a server running 0.4.4: it would step back to 0.4.3; 0.4.2 goes; 0.4.1 is run by another; 0.5.x is not its minor
  versions.prune("0.4.4");
  assert.deepEqual(versions.ready().sort(), ["0.4.1", "0.4.3", "0.4.4", "0.5.0", "0.5.1"]);
  assert.ok(!existsSync(join(cache, "versions", `.0.4.5.tmp-${dead.pid}`)) && existsSync(join(cache, "versions", `.0.4.6.tmp-${process.pid}`)));
});

test("the versions folder is the user's alone: made 0700, refused where another may write it", () => {
  const cache = fresh("perm");
  const versions = new Versions(cache);
  assert.equal(versions.ensure(), null);
  assert.equal(statSync(versions.root).mode & 0o777, 0o700);
  ready(cache, "0.4.1");
  chmodSync(join(versions.root, "0.4.1"), 0o777);
  assert.deepEqual(versions.ready(), [], "a version others may write is not run");
  chmodSync(join(versions.root, "0.4.1"), 0o755);
  assert.deepEqual(versions.ready(), ["0.4.1"]);
  chmodSync(versions.root, 0o777);
  assert.match(versions.ensure()!, /not this user's alone/);
  assert.deepEqual(versions.ready(), []);
  chmodSync(versions.root, 0o700);
});

test("a patch downloaded through npm, checked to run, and kept ready; one that does not say its version is not", async () => {
  const cache = fresh("fetch");
  const versions = new Versions(cache);
  const install = (says: string, engines?: string, meanwhile?: () => void): Npm => async (args) => {
    const prefix = args.find((a) => a.startsWith("--prefix="))!.slice("--prefix=".length);
    const root = join(prefix, "node_modules", "visualproof");
    pkg(root, args.at(-1)!.split("@")[1], engines);
    writeFileSync(join(root, "dist", "server", "main.js"), `console.log(${JSON.stringify(says)})`);
    meanwhile?.();
    return { ok: true, out: "" };
  };
  assert.equal(await versions.fetch("0.4.1", install("0.4.1")), null);
  assert.deepEqual(versions.ready(), ["0.4.1"]);
  assert.match((await versions.fetch("0.4.2", install("0.4.0")))!, /does not run here \(it says it is 0\.4\.0\)/);
  assert.match((await versions.fetch("0.4.3", async () => ({ ok: false, why: "ETARGET" })))!, /npm could not install it: ETARGET/);
  // its engines are checked before it is marked ready
  assert.match((await versions.fetch("0.4.4", install("0.4.4", ">=99")))!, /needs Node >=99/);
  // another server put its copy in place meanwhile: as good
  assert.equal(await versions.fetch("0.4.5", install("0.4.5", undefined, () => ready(cache, "0.4.5"))), null);
  assert.deepEqual(versions.ready().sort(), ["0.4.1", "0.4.5"]);
});

test("a server under auto downloads the patch it may take, restarts into it at a quiet moment, and tells of a newer minor", async () => {
  const root = pkg(fresh("srv"), "0.4.0");
  const cache = fresh("srv-cache");
  const logs: string[] = [];
  let quiet = false;
  let t = Date.parse("2026-10-20T10:00:00Z");
  const restarts: string[] = [];
  const ask: Npm = async (args) => (args[1] === "visualproof" ? { ok: true, out: JSON.stringify(["0.4.0", "0.4.1", "0.5.0"]) } : { ok: true, out: '{"node": ">=1.0.0"}' });
  const u = new Updates({ mode: "auto", cacheRoot: cache, canRestart: true, check: true, quiet: () => quiet, restart: (to) => restarts.push(to), log: (l) => logs.push(l), running: "0.4.0", installedRoot: root, npm: ask, now: () => t });
  // the fetch runs npm, then the package's --version: here a stand-in that is ready already
  u.versions.fetch = async (v) => (ready(cache, v), null);
  await u.check();
  assert.ok(logs.some((l) => /VisualProof 0\.5\.0 is out \(this is 0\.4\.0; https:\/\/github\.com\/LucianoXu\/VisualProof\/releases\/tag\/v0\.5\.0\): it is installed by npm install --prefix .* visualproof@0\.5\.0, which this server then restarts into/.test(l)), logs.join("\n"));
  assert.ok(logs.some((l) => /0\.4\.1 is ready/.test(l)), logs.join("\n"));
  const full = u.status(true);
  assert.deepEqual([full.running, full.mode, full.newer?.version, full.newer?.taken, full.newer?.command], ["0.4.0", "auto", "0.5.0", false, installCommand(root, "0.5.0")]);
  assert.deepEqual(u.status(false), { running: "0.4.0" });
  assert.deepEqual(JSON.parse(readFileSync(join(cache, "updates.json"), "utf8")).versions, ["0.4.0", "0.4.1", "0.5.0"]);
  // someone is on a page: it waits; nobody is: it restarts
  await u.look();
  assert.deepEqual(restarts, []);
  quiet = true;
  await u.look();
  assert.deepEqual(restarts, ["0.4.1"]);
});

test("a patch waits at most a day for a quiet moment; a package installed under the server ten minutes; notify downloads nothing", async () => {
  const root = pkg(fresh("wait"), "0.4.0");
  const cache = fresh("wait-cache");
  ready(cache, "0.4.1");
  writeFileSync(join(cache, "updates.json"), JSON.stringify({ checked: "2026-10-20T09:00:00.000Z", versions: ["0.4.0", "0.4.1"], engines: {} }));
  let t = Date.parse("2026-10-20T10:00:00Z");
  const restarts: string[] = [];
  const o = { cacheRoot: cache, canRestart: true, check: false, quiet: () => false, restart: (to: string) => restarts.push(to), log: () => {}, running: "0.4.0", installedRoot: root, now: () => t };
  const u = new Updates({ ...o, mode: "auto" });
  u.start();
  u.stop();
  await u.look();
  t += 24 * 3600_000;
  await u.look();
  assert.deepEqual(restarts, ["0.4.1"]);
  // patch only under auto: notify tells, with the command
  const v = new Updates({ ...o, mode: "notify" });
  v.start();
  v.stop();
  assert.deepEqual([v.status(true).newer?.taken, v.status(true).newer?.command?.endsWith("visualproof@0.4.1")], [false, true]);
  await v.look();
  assert.deepEqual(restarts, ["0.4.1"]);
  // npm install -g over the running server: restarted into within ten minutes, under notify too
  pkg(root, "0.5.0");
  await v.look();
  t += 10 * 60_000;
  await v.look();
  assert.deepEqual(restarts, ["0.4.1", "0.5.0"]);
});

/** a child process as the supervisor sees one: it says it listens, and exits with what the test says */
function fakeChild(): ChildProcess & { listen(): void; exit(status: number | null, signal?: NodeJS.Signals): void } {
  const c = new EventEmitter() as unknown as ChildProcess & { listen(): void; exit(status: number | null, signal?: NodeJS.Signals): void };
  c.kill = () => true;
  c.listen = () => c.emit("message", { vp: "listening", version: "x" });
  c.exit = (status, signal) => c.emit("exit", status, signal ?? null);
  return c;
}

test("the supervisor: a restart starts the newest code again; a patch that fails as it starts is set aside, and the one before it runs", async () => {
  const root = pkg(fresh("sup"), "0.4.0");
  const cache = fresh("sup-cache");
  const started: { main: string; aside?: string }[] = [];
  const children: ReturnType<typeof fakeChild>[] = [];
  const run = (main: string, _argv: string[], env: NodeJS.ProcessEnv) => {
    started.push({ main, ...(env.VISUALPROOF_SET_ASIDE ? { aside: JSON.parse(env.VISUALPROOF_SET_ASIDE).version } : {}) });
    assert.equal(env.VISUALPROOF_SUPERVISED, "1");
    assert.equal(env.VISUALPROOF_INSTALLED, root);
    const c = fakeChild();
    children.push(c);
    return c;
  };
  const done = supervise({ installedRoot: root, cacheRoot: cache, argv: ["serve", "."], run, log: () => {} });
  const versions = new Versions(cache);
  children[0].listen();
  // a patch is ready: the server asks to be started again, in it
  ready(cache, "0.4.1");
  children[0].exit(RESTART_STATUS);
  await new Promise((r) => setImmediate(r));
  assert.equal(started[1].main, versions.mainOf("0.4.1"));
  // it fails before it serves: set aside, and the installed one started, told so
  children[1].exit(1);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started[2], { main: join(root, "dist", "server", "main.js"), aside: "0.4.1" });
  assert.match(versions.bad().get("0.4.1")!.why, /exited with status 1 before it served/);
  // the one before it fails as soon: the fault was not 8.0.1's, which is taken back; the supervisor ends
  children[2].listen();
  children[2].exit(3);
  assert.equal(await done, 3);
  assert.equal(versions.bad().size, 0);
});

test("the supervisor: a patch failing once after it served is started again, set aside the second time; a SIGKILL never counts; statuses as shells say them", async () => {
  const root = pkg(fresh("strikes"), "0.4.0");
  const cache = fresh("strikes-cache");
  ready(cache, "0.4.1");
  const versions = new Versions(cache);
  const started: string[] = [];
  const children: ReturnType<typeof fakeChild>[] = [];
  const done = supervise({ installedRoot: root, cacheRoot: cache, argv: ["serve"], log: () => {}, run: (main) => (started.push(main), children.push(fakeChild()), children.at(-1)!) });
  const tick = () => new Promise((r) => setImmediate(r));
  children[0].listen();
  children[0].exit(null, "SIGKILL");
  await tick();
  children[1].listen();
  children[1].exit(1);
  await tick();
  assert.equal(versions.bad().size, 0, "a SIGKILL, then one failure: not set aside yet");
  children[2].listen();
  children[2].exit(null, "SIGSEGV");
  await tick();
  assert.match(versions.bad().get("0.4.1")!.why, /was ended by SIGSEGV twice soon after it started/);
  assert.deepEqual(started.map((m) => m.includes("versions")), [true, true, true, false]);
  // the installed one serves; a SIGINT passed on ends it; its status is the child's
  children[3].listen();
  process.emit("SIGINT", "SIGINT");
  children[3].exit(null, "SIGINT");
  assert.equal(await done, 130);
  assert.deepEqual([signalStatus("SIGTERM"), signalStatus("SIGSEGV")], [143, 139]);
});

test("a version set aside is tried again a day on, and for good after the third time", () => {
  const cache = fresh("aside");
  const versions = new Versions(cache);
  versions.markBad("0.4.1", "exited with status 1 before it served");
  const t = Date.now();
  assert.ok(versions.setAside(t).has("0.4.1"));
  assert.ok(!versions.setAside(t + 25 * 3600_000).has("0.4.1"));
  versions.markBad("0.4.1", "again");
  versions.markBad("0.4.1", "and again");
  assert.equal(versions.bad().get("0.4.1")!.times, 3);
  assert.ok(versions.setAside(t + 25 * 3600_000).has("0.4.1"));
  versions.unmarkBad("0.4.1");
  assert.equal(versions.bad().size, 0);
});

test("a server never restarts into what the supervisor would not run, nor where its Node is gone; a check that throws does not end the checks", async () => {
  const root = pkg(fresh("guard"), "0.4.0");
  const cache = fresh("guard-cache");
  // the registry said it runs here; the download says it needs another Node
  ready(cache, "0.4.1", ">=99");
  writeFileSync(join(cache, "updates.json"), JSON.stringify({ checked: new Date().toISOString(), versions: ["0.4.0", "0.4.1"], engines: { "0.4.1": "" } }));
  const logs: string[] = [];
  const restarts: string[] = [];
  const o = { mode: "auto" as const, cacheRoot: cache, canRestart: true, check: false, quiet: () => true, restart: (to: string) => restarts.push(to), log: (l: string) => logs.push(l), running: "0.4.0", installedRoot: root };
  const u = new Updates(o);
  u.start();
  u.stop();
  await u.look();
  assert.deepEqual(restarts, []);
  assert.ok(logs.some((l) => /0\.4\.1 is downloaded, but the supervisor would run 0\.4\.0: not restarted/.test(l)), logs.join("\n"));
  // the download fits: but the Node binary is gone
  ready(cache, "0.4.1");
  const v = new Updates({ ...o, execPath: "/nowhere/bin/node" });
  v.start();
  v.stop();
  await v.look();
  await v.look();
  assert.deepEqual(restarts, []);
  assert.equal(logs.filter((l) => /\/nowhere\/bin\/node is gone/.test(l)).length, 1);
  // npm throwing: the check says so, and the next one is set
  const w = new Updates({ ...o, check: true, npm: async () => { throw new Error("spawn EACCES"); } });
  await (w as unknown as { checkLoop(): Promise<void> }).checkLoop();
  w.stop();
  assert.ok(logs.some((l) => /the check failed: spawn EACCES; asked again in a day/.test(l)), logs.join("\n"));
  // what full readers are told of what is set aside
  new Versions(cache).markBad("0.4.1", "exited with status 1 before it served");
  assert.deepEqual(u.status(true).setAside?.map((x) => [x.version, x.why]), [["0.4.1", "exited with status 1 before it served"]]);
  assert.equal(u.status(false).setAside, undefined);
});

test("the supervisor never sets aside a patch for what is not its code: the site busy, the port taken", async () => {
  const root = pkg(fresh("env"), "0.4.0");
  const cache = fresh("env-cache");
  ready(cache, "0.4.1");
  const children: ReturnType<typeof fakeChild>[] = [];
  const done = supervise({ installedRoot: root, cacheRoot: cache, argv: ["serve"], log: () => {}, run: () => (children.push(fakeChild()), children.at(-1)!) });
  children[0].emit("message", { vp: "environment" });
  children[0].exit(1);
  assert.equal(await done, 1);
  assert.equal(new Versions(cache).bad().size, 0);
});

/** sessionStorage as a test keeps it */
const memory = (): KeptStorage & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

test("the page reloads into its server's new version, keeping what it holds, once nothing would be cut short", async () => {
  const storage = memory();
  const kept: Kept = { root: "/p", at: Date.now(), sources: { following: { name: "N.a", collapsed: false }, pinned: [{ name: "N.b", collapsed: true }] }, review: [["N.a", "a comment"]], talk: [["claude", "hello"]], notes: [["n1", true]] };
  let busy: string | null = "text being typed";
  const offered: (string | null)[] = [];
  let reloads = 0;
  const r = new Reloader({ busy: () => busy, kept: () => kept, offer: (v) => offered.push(v), reload: () => reloads++, storage }, "0.4.0");
  r.hello({ version: "0.4.0", instance: "a" });
  assert.deepEqual([offered, reloads], [[], 0]);
  // another version: offered while the reader types, reloaded once they stop
  r.hello({ version: "0.4.1", instance: "b" });
  assert.deepEqual([offered, reloads], [["0.4.1"], 0]);
  busy = null;
  await new Promise((ok) => setTimeout(ok, 1100));
  assert.equal(reloads, 1);
  // what was kept is the reloaded page's, once, for its project, while fresh
  assert.equal(takeKept("/other", Date.now(), storage), null);
  keep(kept, storage);
  assert.deepEqual(takeKept("/p", Date.now(), storage), kept);
  assert.equal(takeKept("/p", Date.now(), storage), null);
  keep(kept, storage);
  assert.equal(takeKept("/p", Date.now() + 11 * 60_000, storage), null);
  // a step back to the page's version meanwhile: nothing waits
  busy = "a drag";
  r.hello({ version: "0.4.2", instance: "c" });
  r.hello({ version: "0.4.0", instance: "d" });
  assert.deepEqual(offered.slice(-2), ["0.4.2", null]);
  await new Promise((ok) => setTimeout(ok, 1100));
  assert.equal(reloads, 1);
  // a bundle without a version (a test's) never reloads
  new Reloader({ busy: () => null, kept: () => kept, offer: () => {}, reload: () => reloads++ }, null).hello({ version: "9.9.9", instance: "e" });
  assert.equal(reloads, 1);
});

test("which server answers: hello names its version and process, the graph its process; the version alone to a read-only reader", async () => {
  const S = await site({ key: "k".repeat(43), publicRead: true });
  try {
    S.live.updateStatus = (full) => (full ? { running: "0.4.0", mode: "auto", newer: { version: "0.5.0", taken: false, command: "npm install --global visualproof@0.5.0", notes: "https://example.org" } } : { running: "0.4.0" });
    const guest = stream(S.port, "/api/events?session=gggggggg1111", { authorization: `Bearer ${"k".repeat(43)}` });
    const reader = stream(S.port, "/api/events?session=rrrrrrrr2222");
    await guest.until(() => !!guest.last("updates"));
    await reader.until(() => !!reader.last("updates"));
    const hello = guest.last("hello") as { server: { version: string; instance: string } };
    assert.deepEqual(hello.server, { version: S.live.toolVersion, instance: S.live.instance });
    assert.equal((guest.last("graph") as { instance: string }).instance, S.live.instance);
    assert.equal((guest.last("updates") as { newer?: { version: string } }).newer?.version, "0.5.0");
    assert.deepEqual(reader.last("updates"), { running: "0.4.0" });
    // GET /api/updates: a read-only reader too, the version alone; the meta of another process is superseded
    assert.deepEqual((await S.ask("GET", "/api/updates")).json, { running: S.live.toolVersion });
    // the status, without the log and where the review is kept
    const st = (await S.ask("GET", "/api/status")).json!;
    assert.deepEqual([st.log, st.review.folder, typeof st.state], [undefined, undefined, "string"]);
    const full = (await S.ask("GET", "/api/status", undefined, { authorization: `Bearer ${"k".repeat(43)}` })).json!;
    assert.ok(Array.isArray(full.log) && typeof full.review.folder === "string");
    // an agent's stream is told the version alone, as GET /api/updates tells it
    const agent = stream(S.port, "/api/events?session=aaaaaaaa3333", { authorization: `Bearer ${"k".repeat(43)}`, "x-visualproof-kind": "agent", "x-visualproof-name": "Claude" });
    await agent.until(() => !!agent.last("updates"));
    assert.deepEqual(agent.last("updates"), { running: "0.4.0" });
    agent.close();
    const meta = await S.ask("GET", `/api/meta?v=1&i=another`, undefined, { authorization: `Bearer ${"k".repeat(43)}` });
    assert.deepEqual([meta.status, meta.json!.instance], [409, S.live.instance]);
    // the server stops into another version: every page is told, and its stream ended
    S.live.end({ update: { from: "0.4.0", to: "0.4.1" } });
    await guest.until(() => !!guest.last("update"));
    assert.deepEqual(guest.last("update"), { from: "0.4.0", to: "0.4.1" });
    guest.close();
    reader.close();
  } finally {
    await S.close();
  }
});
