// VisualProof following its own releases (UpdateSpec.md, server/updates.ts, server/supervise.ts,
// web/src/reload.ts): which versions a server takes by itself and which it only tells of, the
// registry read through npm, the patches kept in the cache, the quiet moment, the supervisor's
// restarts and what it sets aside, the page reloading into a new version keeping what it holds,
// and what each reader is told.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { choose, codeToRun, installCommand, newerThan, notesOf, registryEngines, registryVersions, sameMinor, stable, Updates, Versions } from "../src/server/updates.ts";
import type { Npm } from "../src/server/updates.ts";
import { RESTART_STATUS, supervise } from "../src/server/supervise.ts";
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

/** a patch downloaded and ready in the cache */
function ready(cache: string, v: string, engines?: string): void {
  pkg(join(cache, "versions", v, "node_modules", "visualproof"), v, engines);
  writeFileSync(join(cache, "versions", v, "ready"), `${v}\n`);
}

test("releases: only x.y.z; newer, and of one minor", () => {
  assert.deepEqual(stable("0.4.1"), [0, 4, 1]);
  for (const v of ["0.0.0-stage", "0.5.0-rc.1", "v0.4.1", "0.4"]) assert.equal(stable(v), null, v);
  assert.ok(newerThan("0.4.10", "0.4.9") && !newerThan("0.4.1", "0.4.1") && !newerThan("0.5.0-rc.1", "0.4.1"));
  assert.ok(sameMinor("0.4.1", "0.4.7") && !sameMinor("0.4.1", "0.5.0") && !sameMinor("1.4.1", "0.4.1"));
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
  versions.prune(["0.5.0"]);
  assert.deepEqual(versions.ready(), ["0.5.0"]);
});

test("a patch downloaded through npm, checked to run, and kept ready; one that does not say its version is not", async () => {
  const cache = fresh("fetch");
  const versions = new Versions(cache);
  const install = (says: string): Npm => async (args) => {
    const prefix = args[args.indexOf("--prefix") + 1];
    const root = join(prefix, "node_modules", "visualproof");
    pkg(root, args.at(-1)!.split("@")[1]);
    writeFileSync(join(root, "dist", "server", "main.js"), `console.log(${JSON.stringify(says)})`);
    return { ok: true, out: "" };
  };
  assert.equal(await versions.fetch("0.4.1", install("0.4.1")), null);
  assert.deepEqual(versions.ready(), ["0.4.1"]);
  assert.match((await versions.fetch("0.4.2", install("0.4.0")))!, /does not run here/);
  assert.match((await versions.fetch("0.4.3", async () => ({ ok: false, why: "ETARGET" })))!, /npm could not install it: ETARGET/);
  assert.deepEqual(versions.ready(), ["0.4.1"]);
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
  assert.ok(logs.some((l) => /VisualProof 0\.5\.0 is out \(this is 0\.4\.0\): it is installed by npm install --prefix .* visualproof@0\.5\.0, which this server then restarts into/.test(l)), logs.join("\n"));
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
  // the installed one ends: so does the supervisor, with its status
  children[2].listen();
  children[2].exit(3);
  assert.equal(await done, 3);
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
