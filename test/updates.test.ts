// VisualProof following its own releases (UpdateSpec.md, server/updates.ts, server/supervise.ts,
// web/src/reload.ts): which versions a server takes by itself and which it only tells of, the
// registry read through npm, the patches kept in the cache, the quiet moment, the supervisor's
// restarts and what it sets aside, the page reloading into a new version keeping what it holds,
// and what each reader is told.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { choose, codeToRun, installCommand, newerThan, notesOf, npmCommand, readInfo, registryEngines, registryVersions, sameMinor, stable, Updates, Versions } from "../src/server/updates.ts";
import { doctor } from "../src/server/doctor.ts";
import type { Npm } from "../src/server/updates.ts";
import { RESTART_STATUS, signalStatus, supervise } from "../src/server/supervise.ts";
import { satisfies } from "../src/server/version.ts";
import { childEnv, DETACH, grouped, stopChildren } from "../src/server/children.ts";
import { keep, Reloader, takeKept } from "../src/web/src/reload.ts";
import type { Kept, KeptStorage } from "../src/web/src/reload.ts";
import { site, stream } from "./site.ts";
import type { Json } from "./site.ts";

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
  // what npm cannot read is no range, whatever its other alternatives say; an operator is one word;
  // numbers have no leading zero
  for (const r of [">=22 || garbage", "> = 22", "< = 23", "022.18.0", ">=022", "22.018.0", "22.18-rc.1", "1.2.3-01"]) no("22.18.0", r);
  // prereleases, as npm orders them
  no("22.18.0", "<=22.18.0-rc.1");
  no("22.18.0", "<22.18.0-rc.1");
  yes("22.18.0", ">=22.18.0-rc.1");
  yes("22.18.0", ">22.18.0-rc.1");
  yes("22.18.0", "22.18.0-rc.1 - 22.18.0");
  no("22.18.0", "=22.18.0-rc.1");
  yes("22.18.0-rc.2", ">=22.18.0-rc.1");
  no("22.18.0-rc.1", ">=22.18.0-rc.2");
  yes("22.18.0-rc.10", ">22.18.0-rc.9");
  yes("22.18.0-rc.1", ">22.18.0-beta");
  // a prerelease Node, as npm checks engines (includePrerelease): taken as any version
  yes("24.0.0-rc.1", ">=22");
  yes("22.18.0-rc.2", ">=22.17.0");
  yes("22.0.0-rc.1", "22");
  no("24.0.0-nightly20260901", "^22.18.0 || >=24.2.0");
  yes("24.3.0-nightly20260901", "^22.18.0 || >=24.2.0");
  no("23.0.0-rc.1", "^22");
  no("24.2.0-rc.1", ">=24.2.0");
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

test("a release its publisher deprecated is neither taken nor told of: npm's three shapes of an answer read", async () => {
  assert.deepEqual(readInfo('{\n  "node": ">=24"\n}\n'), { engines: ">=24", deprecated: null });
  assert.deepEqual(readInfo('{ "engines": { "node": ">= 6" }, "deprecated": "broken: use 0.4.3" }'), { engines: ">= 6", deprecated: "broken: use 0.4.3" });
  assert.deepEqual(readInfo('"broken"'), { engines: "", deprecated: "broken" });
  assert.deepEqual(readInfo(""), { engines: "", deprecated: null });
  assert.equal(readInfo("not json"), null);
  assert.deepEqual(choose("0.4.0", ["0.4.1", "0.4.2", "0.5.0"], { deprecated: new Set(["0.4.2", "0.5.0"]) }), { patch: "0.4.1", release: "0.4.1" });
  // a server asks the newest first, and the next once that one is deprecated
  const root = pkg(fresh("deprecated"), "0.4.0");
  const cache = fresh("deprecated-cache");
  const asked: string[] = [];
  const ask: Npm = async (args) => {
    asked.push(args[1]);
    if (args[1] === "visualproof") return { ok: true, out: JSON.stringify(["0.4.0", "0.4.1", "0.4.2"]) };
    return { ok: true, out: args[1] === "visualproof@0.4.2" ? '{ "engines": { "node": ">=22" }, "deprecated": "broken" }' : '{ "node": ">=22" }' };
  };
  const logs: string[] = [];
  const u = new Updates({ mode: "notify", cacheRoot: cache, canRestart: true, check: true, quiet: () => false, restart: () => {}, log: (l) => logs.push(l), running: "0.4.0", installedRoot: root, npm: ask });
  await u.check();
  assert.deepEqual(asked, ["visualproof", "visualproof@0.4.2", "visualproof@0.4.1", "visualproof@0.4.0"], "the newest, the next, and the one it runs");
  assert.equal(u.status(true).newer?.version, "0.4.1");
});

test("a version npm could not say the engines or deprecation of is not taken now, and asked again at the next check, once per check", async () => {
  const root = pkg(fresh("unknown"), "0.4.0");
  const cache = fresh("unknown-cache");
  let fail = true;
  const asked: string[] = [];
  const ask: Npm = async (args) => {
    asked.push(args[1]);
    if (args[1] === "visualproof") return { ok: true, out: JSON.stringify(["0.4.0", "0.4.1"]) };
    return fail ? { ok: false, why: "ETIMEDOUT" } : { ok: true, out: '{ "node": ">=22" }' };
  };
  const logs: string[] = [];
  const u = new Updates({ mode: "notify", cacheRoot: cache, canRestart: false, check: true, quiet: () => false, restart: () => {}, log: (l) => logs.push(l), running: "0.4.0", installedRoot: root, npm: ask });
  await u.check();
  assert.deepEqual(asked, ["visualproof", "visualproof@0.4.1", "visualproof@0.4.0"], "each asked once: the newest, and the one it runs");
  assert.equal(u.status(true).newer, undefined);
  assert.ok(logs.some((l) => /0\.4\.1 is out, not taken: npm could not say what it needs/.test(l)), logs.join("\n"));
  fail = false;
  await u.check();
  assert.equal(u.status(true).newer?.version, "0.4.1");
});

test("npm's script found where Node's layouts keep it: beside the binary, Homebrew's keg (libexec) and its links", () => {
  const brew = fresh("brew");
  const keg = join(brew, "Cellar", "node", "24.1.0");
  mkdirSync(join(keg, "bin"), { recursive: true });
  writeFileSync(join(keg, "bin", "node"), "");
  const cli = join(keg, "libexec", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(cli, "");
  // process.execPath in the Cellar: the keg's libexec
  assert.deepEqual(npmCommand(join(keg, "bin", "node")), { cmd: join(keg, "bin", "node"), args: [cli] });
  // the prefix's bin/node, a link into the Cellar; bin/npm a link to the script
  mkdirSync(join(brew, "bin"));
  symlinkSync(join(keg, "bin", "node"), join(brew, "bin", "node"));
  // found through the link's own folder: compared resolved (macOS's /var is /private/var)
  assert.deepEqual(npmCommand(join(brew, "bin", "node")).args.map((p) => realpathSync(p)), [realpathSync(cli)]);
  symlinkSync(join("..", "libexec", "lib", "node_modules", "npm", "bin", "npm-cli.js"), join(keg, "bin", "npm"));
  assert.deepEqual(npmCommand(join(keg, "bin", "node")).args.map((p) => realpathSync(p)), [realpathSync(cli)]);
  // nvm's, the installers': lib/node_modules beside the binary
  const nvm = fresh("nvm");
  mkdirSync(join(nvm, "bin"));
  writeFileSync(join(nvm, "bin", "node"), "");
  const nvmCli = join(nvm, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  mkdirSync(dirname(nvmCli), { recursive: true });
  writeFileSync(nvmCli, "");
  assert.deepEqual(npmCommand(join(nvm, "bin", "node")).args, [nvmCli]);
  // none: the npm on the PATH
  assert.deepEqual(npmCommand(join(fresh("bare"), "node")), { cmd: "npm", args: [] });
});

test("the doctor says what is set aside now, not what expired", () => {
  const cache = fresh("doctor-cache");
  const versions = new Versions(cache);
  versions.markBad("0.4.7", "exited with status 1 before it served", null, Date.now() - 2 * 24 * 3600_000);
  versions.markBad("0.4.8", "exited with status 2 before it served");
  const r = doctor({ path: null, roots: [], site: null, cache, run: () => null, node: "24.15.0", platform: "linux", fromPackage: true });
  assert.match(r.updates, /set aside here: 0\.4\.8 \(exited with status 2 before it served\)/);
  assert.doesNotMatch(r.updates, /0\.4\.7/);
  assert.equal(doctor({ path: null, roots: [], site: null, cache, run: () => null, node: "24.15.0", platform: "linux", fromPackage: true, updates: "off" }).updates, "not asked (VISUALPROOF_UPDATES=off)");
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
  assert.equal(versions.heldWhy("0.4.2", null), "exited with status 1 before it served");
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
  // a checkout's server follows no releases, and says so rather than a mode
  const co = new Updates({ mode: "auto", cacheRoot: cache, canRestart: false, check: false, checkout: true, quiet: () => true, restart: () => {}, log: () => {}, running: "0.4.0", installedRoot: root });
  assert.deepEqual([co.status(true), co.status(false)], [{ running: "0.4.0", checkout: true }, { running: "0.4.0" }]);
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
  writeFileSync(join(cache, "updates.json"), JSON.stringify({ checked: "2026-10-20T09:00:00.000Z", versions: ["0.4.0", "0.4.1"], engines: { "0.4.1": "" } }));
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
  // a living process's id, as a child's would be, and not the supervisor's own
  Object.defineProperty(c, "pid", { value: process.ppid });
  c.listen = () => c.emit("message", { vp: "listening", version: "x" });
  c.exit = (status, signal) => c.emit("exit", status, signal ?? null);
  return c;
}

const tick = () => new Promise((r) => setImmediate(r));

/** a supervisor over fake children: what it started, the children, and its end */
function supervised(root: string, cache: string, o: { site?: string; mode?: "auto" | "notify" } = {}) {
  const started: { main: string; aside?: string }[] = [];
  const children: ReturnType<typeof fakeChild>[] = [];
  const logs: string[] = [];
  const done = supervise({
    installedRoot: root, cacheRoot: cache, argv: ["serve", "."], log: (l) => logs.push(l), backoff: () => 0, ...o,
    run: (main, _argv, env) => {
      started.push({ main, ...(env.VISUALPROOF_SET_ASIDE ? { aside: JSON.parse(env.VISUALPROOF_SET_ASIDE).version } : {}) });
      assert.equal(env.VISUALPROOF_SUPERVISED, "1");
      assert.equal(env.VISUALPROOF_INSTALLED, root);
      children.push(fakeChild());
      return children.at(-1)!;
    },
  });
  return { started, children, logs, done, last: () => children.at(-1)! };
}

test("the supervisor: a restart starts the newest code again, marked as it starts; a patch that fails as it starts is set aside for every site, and the one before it runs", async () => {
  const root = pkg(fresh("sup"), "0.4.0");
  const cache = fresh("sup-cache");
  const S = supervised(root, cache, { site: "/sites/a" });
  const versions = new Versions(cache);
  S.children[0].listen();
  // a patch is ready: the server asks to be started again, in it; the version is marked as it starts
  ready(cache, "0.4.1");
  S.children[0].exit(RESTART_STATUS);
  await tick();
  assert.equal(S.started[1].main, versions.mainOf("0.4.1"));
  assert.ok(versions.inUse("0.4.1"), "marked by the supervisor as the version starts");
  // it fails before it serves: set aside for every site, the mark taken off, the installed one started, told so
  S.children[1].exit(1);
  await tick();
  assert.ok(!versions.inUse("0.4.1"));
  assert.deepEqual(S.started[2], { main: join(root, "dist", "server", "main.js"), aside: "0.4.1" });
  assert.equal(versions.heldWhy("0.4.1", "/sites/other"), "exited with status 1 before it served");
  S.children[2].listen();
  process.emit("SIGTERM", "SIGTERM");
  S.children[2].exit(0);
  assert.equal(await S.done, 0);
});

test("the one before a patch set aside failing as soon: the patch taken back (its record kept), this site's patches paused, the installed package run from then on until a newer one", async () => {
  const root = pkg(fresh("loop"), "0.4.0");
  const cache = fresh("loop-cache");
  ready(cache, "0.4.1");
  const versions = new Versions(cache);
  // systemd starts the supervisor: the patch fails as it starts (a full disk, say), so does the installed one
  const first = supervised(root, cache, { site: "/sites/a" });
  first.children[0].exit(1);
  await tick();
  first.children[1].exit(1);
  assert.equal(await first.done, 1);
  assert.equal(versions.heldWhy("0.4.1", "/sites/a"), null, "taken back");
  assert.equal(versions.records().get("0.4.1")!.early!.times, 1, "its record kept");
  assert.equal(versions.paused("/sites/a")!.upTo, "0.4.1");
  // systemd starts it again: the installed package, not the patch; a stable state, whatever follows
  const second = supervised(root, cache, { site: "/sites/a" });
  assert.equal(second.started[0].main, join(root, "dist", "server", "main.js"));
  second.children[0].listen();
  // another site is not paused; a newer patch lifts the pause
  assert.equal(codeToRun(root, versions, { site: "/sites/b" }).version, "0.4.1");
  ready(cache, "0.4.2");
  assert.equal(codeToRun(root, versions, { site: "/sites/a" }).version, "0.4.2");
  process.emit("SIGTERM", "SIGTERM");
  second.children[0].exit(null, "SIGTERM");
  assert.equal(await second.done, 0);
});

test("the supervisor: a patch failing soon after it served is started again, set aside for its site the second time (for all once two sites saw it); SIGKILL never counts, SIGABRT only before it served", async () => {
  const root = pkg(fresh("strikes"), "0.4.0");
  const cache = fresh("strikes-cache");
  ready(cache, "0.4.1");
  const versions = new Versions(cache);
  const S = supervised(root, cache, { site: "/sites/a" });
  // killed as it starts, and once it served: started again, nothing recorded
  S.last().exit(null, "SIGKILL");
  await tick();
  S.last().listen();
  S.last().exit(null, "SIGKILL");
  await tick();
  // out of memory once it served (V8's SIGABRT): started again
  S.last().listen();
  S.last().exit(null, "SIGABRT");
  await tick();
  S.last().listen();
  S.last().exit(1);
  await tick();
  assert.equal(versions.records().size, 0, "SIGKILL, SIGABRT after it served, one failure: nothing recorded");
  S.last().listen();
  S.last().exit(null, "SIGSEGV");
  await tick();
  assert.match(versions.heldWhy("0.4.1", "/sites/a")!, /was ended by SIGSEGV twice soon after it started/);
  assert.equal(versions.heldWhy("0.4.1", "/sites/b"), null, "another site's project may not fail it");
  assert.deepEqual(S.started.map((x) => x.main.includes("versions")), [true, true, true, true, true, false]);
  versions.markBad("0.4.1", "exited with status 1 twice soon after it started", "/sites/b");
  assert.match(versions.heldWhy("0.4.1", "/sites/c")!, /on 2 sites/);
  // a stop asked while the server restarts: 0, whatever the child does then
  S.last().listen();
  process.emit("SIGINT", "SIGINT");
  S.last().exit(RESTART_STATUS);
  assert.equal(await S.done, 0);
  assert.equal(S.started.length, 6, "nothing started after the stop");
  assert.deepEqual([signalStatus("SIGTERM"), signalStatus("SIGSEGV"), signalStatus("SIGINT")], [143, 139, 130]);
});

test("the supervisor: SIGABRT before it served sets a patch aside; a mark that cannot be written still steps back; under notify, the installed package alone; a deprecated patch never runs", async () => {
  const root = pkg(fresh("abort"), "0.4.0");
  const cache = fresh("abort-cache");
  ready(cache, "0.4.1");
  const versions = new Versions(cache);
  const S = supervised(root, cache, { site: "/sites/a" });
  S.last().exit(null, "SIGABRT");
  await tick();
  assert.match(versions.heldWhy("0.4.1", null)!, /was ended by SIGABRT before it served/);
  S.last().listen();
  process.emit("SIGTERM", "SIGTERM");
  S.last().exit(0);
  await S.done;
  // a full disk: the record cannot be written, the patch is set aside all the same
  ready(cache, "0.4.2");
  chmodSync(versions.root, 0o500);
  try {
    const T = supervised(root, cache, { site: "/sites/a" });
    assert.ok(T.started[0].main.includes("0.4.2"));
    T.last().exit(1);
    await tick();
    assert.equal(T.started[1].main, join(root, "dist", "server", "main.js"));
    assert.ok(T.logs.some((l) => /could not record it/.test(l)), T.logs.join("\n"));
    T.last().listen();
    process.emit("SIGTERM", "SIGTERM");
    T.last().exit(0);
    await T.done;
  } finally {
    chmodSync(versions.root, 0o700);
  }
  // notify: the installed package, the patch ready or not
  assert.equal(codeToRun(root, versions, { mode: "notify" }).version, "0.4.0");
  assert.equal(codeToRun(root, versions, { mode: "auto" }).version, "0.4.2");
  // deprecated by its publisher, as the last check found: never run
  writeFileSync(join(cache, "updates.json"), JSON.stringify({ checked: new Date().toISOString(), versions: ["0.4.2"], engines: { "0.4.2": "" }, deprecated: { "0.4.2": "broken" } }));
  assert.equal(codeToRun(root, versions, { mode: "auto" }).version, "0.4.0");
});

test("npm deprecate withdraws a patch servers took: one server's finding is kept by the others, a server running it steps back, only an answer undeprecates", async () => {
  const root = pkg(fresh("withdraw"), "0.4.0");
  const cache = fresh("withdraw-cache");
  ready(cache, "0.4.1");
  let answer: "deprecated" | "fine" | "fail" = "deprecated";
  const ask: Npm = async (args) => {
    if (args[1] === "visualproof") return { ok: true, out: JSON.stringify(["0.4.0", "0.4.1"]) };
    if (args[1] === "visualproof@0.4.1") return answer === "fail" ? { ok: false, why: "ETIMEDOUT" } : { ok: true, out: answer === "deprecated" ? '{ "engines": { "node": ">=22" }, "deprecated": "broken" }' : '{ "node": ">=22" }' };
    return { ok: true, out: '{ "node": ">=22" }' };
  };
  const versions = new Versions(cache);
  const logs: string[] = [];
  const restarts: string[] = [];
  const o = { mode: "auto" as const, cacheRoot: cache, canRestart: true, check: true, quiet: () => true, restart: (to: string) => restarts.push(to), log: (l: string) => logs.push(l), installedRoot: root, npm: ask, site: "/sites/a" };
  // A runs the installed 0.4.0, and finds 0.4.1 deprecated
  const A = new Updates({ ...o, running: "0.4.0" });
  await A.check();
  assert.equal(codeToRun(root, versions).version, "0.4.0");
  // B runs 0.4.1 from the cache: its check asks of the version it runs, keeps A's finding, and steps back
  const B = new Updates({ ...o, running: "0.4.1" });
  await B.check();
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(cache, "updates.json"), "utf8")).deprecated), ["0.4.1"]);
  assert.equal(codeToRun(root, versions).version, "0.4.0");
  assert.ok(logs.some((l) => /0\.4\.1, which this server runs, is deprecated by its publisher \(broken\): it steps back to 0\.4\.0/.test(l)), logs.join("\n"));
  await B.look();
  assert.deepEqual(restarts, ["0.4.0"]);
  // a check that gets no answer drops nothing
  answer = "fail";
  await new Updates({ ...o, running: "0.4.0" }).check();
  assert.equal(codeToRun(root, versions).version, "0.4.0");
  // an answer that it is not deprecated (any more) clears it
  answer = "fine";
  await new Updates({ ...o, running: "0.4.0" }).check();
  assert.equal(codeToRun(root, versions).version, "0.4.1");
});

test("what the supervisor set aside without a record is never restarted into; records that are not objects read as none; a pause is told, and lasts a day", async () => {
  const root = pkg(fresh("unrec"), "0.4.0");
  const cache = fresh("unrec-cache");
  ready(cache, "0.4.1");
  writeFileSync(join(cache, "updates.json"), JSON.stringify({ checked: new Date().toISOString(), versions: ["0.4.0", "0.4.1"], engines: { "0.4.1": "" } }));
  const restarts: string[] = [];
  const o = { mode: "auto" as const, cacheRoot: cache, canRestart: true, check: false, quiet: () => true, restart: (to: string) => restarts.push(to), log: () => {}, running: "0.4.0", installedRoot: root, site: "/sites/a" };
  const u = new Updates({ ...o, also: new Set(["0.4.1"]) });
  u.start();
  u.stop();
  await u.look();
  assert.deepEqual(restarts, []);
  assert.equal(u.status(true).newer, undefined);
  // null, a list: no record, no pause; a pause written over it
  const versions = new Versions(cache);
  writeFileSync(join(versions.root, "bad.json"), "null");
  writeFileSync(join(versions.root, "paused.json"), "[1]");
  assert.equal(versions.records().size, 0);
  assert.equal(versions.paused("/sites/a"), null);
  const t = Date.now();
  assert.ok(versions.pause("/sites/a", "0.4.1", "0.4.1, and the version before it, failed as they started", t));
  // told to full readers, and by the log of a check; gone a day on
  const logs: string[] = [];
  const p = new Updates({ ...o, check: true, npm: async (args) => ({ ok: true, out: args[1] === "visualproof" ? '["0.4.0", "0.4.1"]' : '{ "node": ">=22" }' }), log: (l) => logs.push(l) });
  await p.check();
  assert.equal(p.status(true).paused?.upTo, "0.4.1");
  assert.equal(p.status(false).paused, undefined);
  assert.ok(logs.some((l) => /0\.4\.1 is out, not taken: this site's patches up to 0\.4\.1 are paused/.test(l)), logs.join("\n"));
  assert.equal(versions.paused("/sites/a", t + 25 * 3600_000), null);
  assert.equal(codeToRun(root, versions, { site: "/sites/a", now: t + 25 * 3600_000 }).version, "0.4.0", "the clock of codeToRun is the set-asides'; the pause reads the real one");
});

test("out-of-memory kills at boot are started again after a wait, and never make the supervisor give up nor pause the patch", async () => {
  const root = pkg(fresh("oom"), "0.4.0");
  const cache = fresh("oom-cache");
  ready(cache, "0.4.1");
  const S = supervised(root, cache, { site: "/sites/a" });
  for (let i = 0; i < 8; i++) {
    S.last().exit(null, "SIGKILL");
    await tick();
  }
  assert.equal(S.started.length, 9);
  assert.ok(S.started.every((x) => x.main.includes("0.4.1")), "the patch, every time");
  assert.equal(new Versions(cache).paused("/sites/a"), null);
  S.last().listen();
  process.emit("SIGTERM", "SIGTERM");
  S.last().exit(0);
  assert.equal(await S.done, 0);
});

test("a version set aside is tried again a day on, and for good after the third time; taking it back keeps what was recorded", () => {
  const cache = fresh("aside");
  const versions = new Versions(cache);
  const t = Date.now();
  versions.markBad("0.4.1", "exited with status 1 before it served", null, t);
  assert.ok(versions.setAside(t).has("0.4.1"));
  assert.ok(!versions.setAside(t + 25 * 3600_000).has("0.4.1"));
  assert.deepEqual(versions.reasons(t + 25 * 3600_000), [], "expired: neither said nor held");
  versions.unmarkBad("0.4.1", t + 1);
  assert.ok(!versions.setAside(t + 2).has("0.4.1"));
  versions.markBad("0.4.1", "again", null, t + 3);
  versions.markBad("0.4.1", "and again", null, t + 4);
  assert.equal(versions.records().get("0.4.1")!.early!.times, 3, "counted across the taking back");
  assert.ok(versions.setAside(t + 25 * 3600_000).has("0.4.1"), "for good");
  assert.deepEqual(versions.reasons(t + 5).map((r) => [r.version, r.why]), [["0.4.1", "and again"]]);
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
  // a newer one ready meanwhile than the one pending: restarted into that
  ready(cache, "0.4.1");
  ready(cache, "0.4.2");
  const n = new Updates(o);
  n.start();
  n.stop();
  await n.look();
  assert.deepEqual(restarts, ["0.4.2"]);
  rmSync(join(cache, "versions", "0.4.2"), { recursive: true, force: true });
  restarts.length = 0;
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
  assert.equal(new Versions(cache).records().size, 0);
});

test("stopping ends what the server's programs started: a group is ended whole; they are given none of the server's own variables", { skip: process.platform === "win32" }, async () => {
  process.env.VISUALPROOF_SECRET_TEST = "1";
  try {
    assert.equal(childEnv().VISUALPROOF_SECRET_TEST, undefined);
    assert.equal(childEnv({ X: "y" }).X, "y");
  } finally {
    delete process.env.VISUALPROOF_SECRET_TEST;
  }
  const dir = fresh("group");
  const pidFile = join(dir, "grandchild");
  // a program that starts another and waits on it, as lake starts lean
  const leader = grouped(spawn("sh", ["-c", `sleep 60 & echo $! > ${pidFile}; wait`], { detached: DETACH, stdio: "ignore", env: childEnv() }));
  await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "");
  const grandchild = Number(readFileSync(pidFile, "utf8").trim());
  const lives = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  assert.ok(lives(grandchild));
  await stopChildren(2000);
  await until(() => !lives(grandchild));
  assert.equal(leader.signalCode ?? "SIGTERM", "SIGTERM");
});

/** wait for `f`, a few seconds at most */
async function until(f: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

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
  const r = new Reloader({ busy: () => busy, kept: () => kept, offer: (v) => offered.push(v), reload: () => reloads++, storage }, "0.4.0", 0);
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

test("a tab whose storage is refused keeps what it reloaded for in its name, and reloads once; pages back from a restart reload apart", async () => {
  const refused: KeptStorage = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); }, removeItem: () => {} };
  const g = globalThis as { name?: string };
  const before = g.name;
  try {
    let reloads = 0;
    const page = () => new Reloader({ busy: () => null, kept: () => ({ root: "/p", at: 0, sources: { following: null, pinned: [] }, review: [], talk: [], notes: [] }), offer: () => {}, reload: () => reloads++, storage: refused }, "0.4.0", 0);
    page().hello({ version: "0.4.1", instance: "a" });
    assert.equal(reloads, 1);
    assert.equal(g.name, "visualproof-reloaded-for:0.4.1");
    // the reloaded page is still of 0.4.0 (a bundle that says another version): no second reload
    page().hello({ version: "0.4.1", instance: "a" });
    assert.equal(reloads, 1);
    // spread: not at once, within the spread
    const spread = new Reloader({ busy: () => null, kept: () => ({ root: "/p", at: 0, sources: { following: null, pinned: [] }, review: [], talk: [], notes: [] }), offer: () => {}, reload: () => reloads++, storage: memory() }, "0.4.0", 300);
    spread.hello({ version: "0.4.2", instance: "b" });
    assert.equal(reloads, 1);
    await new Promise((ok) => setTimeout(ok, 350));
    assert.equal(reloads, 2);
  } finally {
    g.name = before;
  }
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
    // a version set aside, in Activity: why, to those told all alone
    S.live.timeline.add({ kind: "tool", from: "0.4.0", to: "0.4.0", setAside: { version: "0.4.1", why: "exited with status 1 before it served (/home/x/.cache)" } });
    const aside = (r: Json) => (r.events as Json[]).find((e) => e.kind === "tool")!.setAside;
    assert.deepEqual(aside((await S.ask("GET", "/api/activity")).json!), { version: "0.4.1" });
    assert.match(aside((await S.ask("GET", "/api/activity", undefined, { authorization: `Bearer ${"k".repeat(43)}` })).json!).why, /before it served/);
    const agentActivity = (await S.ask("GET", "/api/agent/activity", undefined, { authorization: `Bearer ${"k".repeat(43)}`, "x-visualproof-kind": "agent", "x-visualproof-name": "Claude" })).json!;
    assert.deepEqual(aside(agentActivity), { version: "0.4.1" });
    await reader.until(() => reader.events.some((e) => e.event === "activity" && e.data.kind === "tool"));
    assert.deepEqual(reader.events.find((e) => e.event === "activity" && e.data.kind === "tool")!.data.setAside, { version: "0.4.1" });
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
