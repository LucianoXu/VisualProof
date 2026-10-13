// Where the server keeps what it writes (server/dirs.ts): the homes per platform; the site, which one
// server holds at a time, apart from the caches; nothing in the project nor in this repository; and
// the Lean programs built once per toolchain and source, whichever server finishes first.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { SiteBusy, cacheHome, dataHome, lockSite, openSite, projectDirs, projectKey } from "../src/server/dirs.ts";
import type { HomeEnv } from "../src/server/dirs.ts";
import { bundleDir, bundleDirIn, prepare, REPO, SRC } from "../src/server/pipeline.ts";
import { openProject } from "../src/server/project.ts";
import { LeanHover } from "../src/server/hover.ts";
import { copyFixture, fixtureToolchain } from "./fixturecopy.ts";
import { TEST_LEAN } from "./tmpdirs.ts";

let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}
let haveGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  haveGit = false;
}

const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

test("the homes follow the platform, and XDG_DATA_HOME and XDG_CACHE_HOME wherever they are set", () => {
  const at = (platform: NodeJS.Platform, env: Record<string, string> = {}): HomeEnv => ({ platform, env, home: "/home/u" });
  assert.equal(dataHome(at("linux")), "/home/u/.local/share/visualproof");
  assert.equal(cacheHome(at("linux")), "/home/u/.cache/visualproof");
  assert.equal(dataHome(at("darwin")), "/home/u/Library/Application Support/visualproof");
  assert.equal(cacheHome(at("darwin")), "/home/u/Library/Caches/visualproof");
  assert.equal(dataHome(at("win32", { LOCALAPPDATA: "/l" })), join("/l", "visualproof", "data"));
  assert.equal(cacheHome(at("win32", { LOCALAPPDATA: "/l" })), join("/l", "visualproof", "cache"));
  for (const p of ["linux", "darwin", "win32"] as const) {
    assert.equal(dataHome(at(p, { XDG_DATA_HOME: "/x/d" })), "/x/d/visualproof");
    assert.equal(cacheHome(at(p, { XDG_CACHE_HOME: "/x/c" })), "/x/c/visualproof");
  }
});

test("a project's site and caches: by its key under the homes, or where --site and --cache say", () => {
  const h: HomeEnv = { platform: "linux", env: {}, home: "/home/u" };
  const key = projectKey("/work/My Proof");
  assert.match(key, /^My Proof-[0-9a-f]{8}$/);
  assert.notEqual(projectKey("/other/My Proof"), key, "two projects of one name are told apart by their path");
  assert.deepEqual(projectDirs("/work/My Proof", null, null, h), {
    site: `/home/u/.local/share/visualproof/sites/${key}`,
    cache: `/home/u/.cache/visualproof/projects/${key}`,
    lean: "/home/u/.cache/visualproof/lean",
  });
  // --site: relative to the project, or absolute (a deployed server's); --cache: the root of all caches
  assert.equal(projectDirs("/work/My Proof", "review/site", null, h).site, "/work/My Proof/review/site");
  assert.deepEqual(projectDirs("/work/My Proof", "/srv/vp-site", "/var/cache/vp", h), {
    site: "/srv/vp-site",
    cache: `/var/cache/vp/projects/${key}`,
    lean: "/var/cache/vp/lean",
  });
});

test("the page's bundle is in the cache, one folder per checkout of the tool, never in the repository", () => {
  const b = bundleDirIn("/c");
  assert.match(b, /^\/c\/web\/[0-9a-f]{8}$/);
  assert.ok(relative(REPO, bundleDir()).startsWith(".."), "outside the repository");
  assert.ok(relative(SRC, bundleDir()).startsWith(".."), "outside the tool's folder");
  // under the tests, the cache home is a temporary folder (test/setup.ts)
  assert.ok(bundleDir().startsWith(join(tmpdir(), "visualproof-test")), bundleDir());
});

test("a site the server makes says what it is; a folder already there is left as it is", () => {
  const root = mkdtempSync(join(tmpdir(), "vp-site-"));
  made.push(root);
  const site = join(root, "site");
  assert.equal(openSite(site), true);
  assert.deepEqual(readdirSync(site), ["README.md"]);
  assert.match(readFileSync(join(site, "README.md"), "utf8"), /not meant to be committed/);
  assert.match(readFileSync(join(site, "README.md"), "utf8"), /Back it up/);
  // a folder already there (made by hand, or by an earlier version) gets nothing
  const other = join(root, "kept");
  mkdirSync(other);
  assert.equal(openSite(other), false);
  assert.deepEqual(readdirSync(other), []);
});

test("one server holds a site: another living one is refused, a dead one's lock is taken over", async () => {
  const site = mkdtempSync(join(tmpdir(), "vp-site-lock-"));
  made.push(site);
  // this process holds it; a second server (another pid) is refused while this one lives
  const release = lockSite(site);
  assert.equal(readFileSync(join(site, ".lock"), "utf8").trim(), String(process.pid));
  assert.throws(() => lockSite(site, process.pid + 100_000), (e) => e instanceof SiteBusy && e.pid === process.pid);
  // taking it again from the same process is no conflict
  lockSite(site)();
  assert.ok(!existsSync(join(site, ".lock")), "let go");
  release();
  // a lock left by a process that is gone is taken over
  const dead = spawn(process.execPath, ["-e", ""]);
  await new Promise((ok) => dead.on("exit", ok));
  writeFileSync(join(site, ".lock"), `${dead.pid}\n`);
  const mine = lockSite(site);
  assert.equal(readFileSync(join(site, ".lock"), "utf8").trim(), String(process.pid));
  // letting go removes only a lock that is still this process's
  writeFileSync(join(site, ".lock"), "1\n");
  mine();
  assert.equal(readFileSync(join(site, ".lock"), "utf8").trim(), "1");
});

/** Every file under a folder, relative to it, with its size and time. */
function files(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const st = statSync(p);
        out.set(relative(dir, p), `${st.size}:${st.mtimeMs}`);
      }
    }
  };
  walk(dir);
  return out;
}

test("what a server writes: its caches in the cache, the layout's memory in the site, nothing in the project", { skip: !haveLake }, async () => {
  const dir = copyFixture("vp-dirs-");
  const home = mkdtempSync(join(tmpdir(), "vp-dirs-home-"));
  made.push(dir, home);
  execFileSync("lake", ["build"], { cwd: dir, stdio: "ignore" });
  const before = files(dir);
  const project = openProject(dir, [], true);
  const dirs = { ...projectDirs(dir, null, null, { platform: "linux", env: { XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache") }, home }), lean: TEST_LEAN };
  openSite(dirs.site);
  await prepare(project, dirs, null, () => {});
  const hover = new LeanHover(project, dirs.cache);
  try {
    // Lean's language server, started in the project's folder of the cache, with its scratch file
    const d = await hover.describe("Fixture.Basic", "Fixture.Point.size", 120_000);
    assert.ok(!d.error, JSON.stringify(d));
  } finally {
    hover.stop();
  }
  // the project as its owner left it: nothing written, nothing changed
  const now = files(dir);
  assert.deepEqual([...now.keys()].filter((f) => !before.has(f)), [], "nothing new in the project");
  assert.deepEqual([...before].filter(([f, v]) => now.get(f) !== v).map(([f]) => f), [], "nothing changed in the project");
  // the site: its README and the layout's memory; the caches: the extraction, its modules, the view
  // and Lean's folder
  assert.deepEqual([...files(dirs.site).keys()].sort(), ["README.md", "layout-memory.json"]);
  const cache = [...files(dirs.cache).keys()];
  for (const sub of ["extract/", "modules/", "view/"]) assert.ok(cache.some((f) => f.startsWith(sub)), `${sub} in the cache`);
  assert.ok(statSync(join(dirs.cache, "lean-server")).isDirectory(), "Lean's folder in the cache");
  assert.ok(!existsSync(join(dirs.site, "lean-server")), "Lean is never started in the site");
  assert.ok(!cache.some((f) => f.startsWith("history/") || f.startsWith("log/") || f === "views.json" || f === "layout-memory.json"), "nothing of the site among the caches");
  assert.ok(dirs.site.startsWith(join(home, "data", "visualproof", "sites")) && dirs.cache.startsWith(join(home, "cache", "visualproof", "projects")));
});

/** A server started as the command is, until it says a line matching `until` (its answer: the
 *  process and what it said), or until it exits (null). */
function serve(args: string[], until: RegExp): Promise<{ child: ChildProcess; out: string; code: number | null }> {
  const main = join(import.meta.dirname, "..", "src", "server", "main.ts");
  return new Promise((ok) => {
    const child = spawn(process.execPath, [main, "serve", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let done = false;
    const said = (b: Buffer) => {
      out += b;
      if (!done && until.test(out)) {
        done = true;
        ok({ child, out, code: null });
      }
    };
    child.stdout!.on("data", said);
    child.stderr!.on("data", said);
    child.on("exit", (code) => {
      if (!done) {
        done = true;
        ok({ child, out, code });
      }
    });
  });
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((ok) => {
    if (child.exitCode !== null) return ok();
    child.on("exit", () => ok());
    child.kill("SIGTERM");
  });
}

test("the command: the site under the data home, nothing in the project nor the repository, a second server on it refused", { skip: !haveLake || !haveGit }, async () => {
  const dir = copyFixture("vp-dirs-cli-");
  made.push(dir);
  execFileSync("lake", ["build"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  const gitStatus = () => execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--ignored"], { cwd: dir, encoding: "utf8" });
  const statusBefore = gitStatus();
  // the caches' root shared by the runs, so that the extractor is compiled once
  const cacheRoot = join(tmpdir(), "visualproof-test-cli");
  const src = files(SRC);
  const site = projectDirs(dir, null, cacheRoot).site;
  made.push(site);
  const first = await serve([dir, "--port", "0", "--jobs", "0", "--cache", cacheRoot], /extraction \w+ (done|reused)/);
  try {
    assert.equal(first.code, null, first.out);
    // the site under the data home (test/setup.ts), with its README; git sees nothing new in the project
    assert.ok(site.startsWith(join(process.env.XDG_DATA_HOME!, "visualproof", "sites")), site);
    assert.ok(first.out.includes(`site: ${site}`), first.out);
    assert.ok(existsSync(join(site, "README.md")));
    assert.equal(gitStatus(), statusBefore);
    // a second server on the same site is refused, and says why
    const second = await serve([dir, "--port", "0", "--jobs", "0", "--cache", cacheRoot], /^VisualProof —/m);
    assert.equal(second.code, 1, second.out);
    assert.match(second.out, /another VisualProof server \(process \d+\) is using the site/);
  } finally {
    await stop(first.child);
  }
  assert.ok(!existsSync(join(site, ".lock")), "the lock goes with the server");
  // nothing written into the tool's own folder (the page's bundle is in the cache)
  const now = files(SRC);
  assert.deepEqual([...now.keys()].filter((f) => !src.has(f)), [], "nothing new in src/");
  assert.ok(existsSync(join(bundleDirIn(cacheRoot), "app.js")), "the page's bundle in the cache");
  // a lock left by a server that is gone is taken over
  const dead = spawn(process.execPath, ["-e", ""]);
  await new Promise((ok) => dead.on("exit", ok));
  writeFileSync(join(site, ".lock"), `${dead.pid}\n`);
  const third = await serve([dir, "--port", "0", "--jobs", "0", "--cache", cacheRoot], /^VisualProof —/m);
  try {
    assert.equal(third.code, null, third.out);
  } finally {
    await stop(third.child);
  }
});

/** A Lean program, built by a process of its own as a server builds it: the path of its binary, or
 *  "null". */
function buildIn(source: string, leanRoot: string): Promise<string> {
  const extractTs = pathToFileURL(join(import.meta.dirname, "..", "src", "server", "extract.ts")).href;
  const script = `import { leanProgram } from ${JSON.stringify(extractTs)};
const bin = await leanProgram({ dir: "hello", source: ${JSON.stringify(source)}, exe: "vp-hello", root: "Hello" }, ${JSON.stringify(fixtureToolchain())}, ${JSON.stringify(leanRoot)}, () => {});
console.log(String(bin));`;
  return new Promise((ok, fail) => {
    const c = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    c.stdout.on("data", (b: Buffer) => (out += b));
    c.stderr.on("data", (b: Buffer) => (err += b));
    c.on("close", (code) => (code === 0 ? ok(out.trim()) : fail(new Error(err))));
  });
}

test("a Lean program is built once per toolchain and source, beside the others, by whichever server finishes first", { skip: !haveLake }, async () => {
  const root = mkdtempSync(join(tmpdir(), "vp-leanprog-"));
  made.push(root);
  const source = join(root, "Hello.lean");
  writeFileSync(source, "def main : IO Unit := pure ()\n");
  const tcDir = join(root, "lean", "hello", fixtureToolchain().replace(/[^A-Za-z0-9.]+/g, "-"));
  const hash = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 12);
  // two servers at once: one build is moved into place, the other's is dropped, both run the one kept
  const [a, b] = await Promise.all([buildIn(source, join(root, "lean")), buildIn(source, join(root, "lean"))]);
  assert.equal(a, b);
  assert.equal(a, join(tcDir, hash(source), ".lake", "build", "bin", "vp-hello"));
  assert.deepEqual(readdirSync(tcDir), [hash(source)], "no build left half way");
  // another version of the source: a folder of its own beside the first, which stays
  writeFileSync(source, "def main : IO Unit := IO.println \"hello\"\n");
  const c = await buildIn(source, join(root, "lean"));
  assert.equal(c, join(tcDir, hash(source), ".lake", "build", "bin", "vp-hello"));
  assert.equal(readdirSync(tcDir).length, 2);
  // a build that fails leaves nothing behind
  writeFileSync(source, "def main : IO Unit := this is not Lean\n");
  assert.equal(await buildIn(source, join(root, "lean")), "null");
  assert.equal(readdirSync(tcDir).length, 2);
});
