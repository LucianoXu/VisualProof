#!/usr/bin/env node
// The update path end to end (SPEC/UpdateSpec.md), on this machine and nothing else: the package
// built as two versions of its own (8.0.0 and its patch 8.0.1, then a broken 8.0.2) and published
// to a registry this script serves; 8.0.0 installed from it into a prefix and serving a small
// project under its supervisor; the patch found, downloaded into the cache and taken, the page open
// on it reloading into the new version where it was, with the comment it was writing; the broken
// patch set aside and the version before it serving again; the timeline saying all of it; the
// server stopped by a signal, its lock gone. Not part of `npm test`: it builds the package three
// times and runs npm, in two or three minutes. The page needs Playwright (`npm install --no-save
// playwright && npx playwright install chromium`); without it the page is not checked.
//
//   npm run test:updates [-- --keep]       (--keep: the temporary folder is left, and named)

import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const keepTmp = process.argv.includes("--keep");
const tmp = mkdtempSync(join(tmpdir(), "vp-updates-e2e-"));
const npmCli = existsSync(join(process.execPath, "..", "npm")) ? join(process.execPath, "..", "npm") : "npm";
const say = (l) => console.log(`· ${l}`);
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function until(f, what, ms = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(250);
  }
}

// ---------------------------------------------------------------- three versions of the package

const DEPS = ["d3-hierarchy", "@resvg/resvg-wasm", "pdfjs-dist"];
const tarballs = new Map();

/** The package as version `v`, built from a copy of this checkout that says it is `v` (its page is
 *  bundled with that version), its dependencies bundled so that the registry here needs nothing
 *  else; `broken`: its server ends at once when asked to serve. */
function build(v, broken = false) {
  const src = join(tmp, `src-${v}`);
  for (const p of ["src", "scripts", "tsconfig.json", "tsconfig.build.json", "docs", "test/toolchains.json", "README.md", "LICENSE"]) cpSync(join(REPO, p), join(src, p), { recursive: true });
  const pj = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  writeFileSync(join(src, "package.json"), JSON.stringify({ ...pj, version: v }, null, 2));
  symlinkSync(join(REPO, "node_modules"), join(src, "node_modules"), "dir");
  const pkg = join(tmp, `pkg-${v}`);
  execFileSync(process.execPath, [join(src, "scripts", "build.mjs"), join(pkg, "dist")], { stdio: "ignore" });
  for (const p of ["docs/agent-api", "test/toolchains.json", "README.md", "LICENSE"]) cpSync(join(src, p), join(pkg, p), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ ...pj, version: v, scripts: {}, devDependencies: {}, bundleDependencies: DEPS }, null, 2));
  for (const d of DEPS) cpSync(join(REPO, "node_modules", d), join(pkg, "node_modules", d), { recursive: true, dereference: true });
  if (broken) {
    const main = join(pkg, "dist", "server", "main.js");
    const text = readFileSync(main, "utf8").replace("#!/usr/bin/env node\n", "");
    writeFileSync(main, `#!/usr/bin/env node\nif (process.argv[2] === "serve") { console.error("8.0.2: broken on purpose"); process.exit(1); }\n${text}`);
  }
  execFileSync(npmCli, ["pack", "--ignore-scripts", "--pack-destination", tmp], { cwd: pkg, stdio: "ignore" });
  const file = join(tmp, `visualproof-${v}.tgz`);
  const bytes = readFileSync(file);
  return { v, file, bytes, manifest: { ...JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")), _id: `visualproof@${v}` } };
}

// ---------------------------------------------------------------- a registry of its own

const published = [];
const registry = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/visualproof") {
    const versions = {};
    for (const p of published) {
      versions[p.v] = {
        ...p.manifest,
        dist: {
          tarball: `${base}/visualproof/-/visualproof-${p.v}.tgz`,
          integrity: `sha512-${createHash("sha512").update(p.bytes).digest("base64")}`,
          shasum: createHash("sha1").update(p.bytes).digest("hex"),
        },
      };
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ name: "visualproof", "dist-tags": { latest: published.at(-1).v }, versions }));
  }
  const m = /^\/visualproof\/-\/visualproof-(.+)\.tgz$/.exec(url.pathname);
  const p = m && tarballs.get(m[1]);
  if (p) {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    return res.end(p);
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});
await new Promise((ok) => registry.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${registry.address().port}`;
const env = { ...process.env, npm_config_registry: `${base}/`, npm_config_cache: join(tmp, "npm-cache"), VISUALPROOF_UPDATE_TEST_MS: "1000" };
const publish = (p) => {
  tarballs.set(p.v, p.bytes);
  published.push(p);
};

let server = null;
let browser = null;
let log = "";
try {
  say(`building 8.0.0, 8.0.1 and a broken 8.0.2 in ${tmp}`);
  const [v0, v1, v2] = [build("8.0.0"), build("8.0.1"), build("8.0.2", true)];
  publish(v0);

  // 8.0.0, installed from the registry into a prefix of its own
  const prefix = join(tmp, "installed");
  // not execFileSync: the registry answers from this process
  await new Promise((ok, no) => execFile(npmCli, ["install", "--prefix", prefix, "--no-audit", "--no-fund", "visualproof@8.0.0"], { env }, (e) => (e ? no(e) : ok())));
  const main = join(prefix, "node_modules", "visualproof", "dist", "server", "main.js");
  check(existsSync(main), "8.0.0 installed from the registry into a prefix");

  // a small project, served from a saved extraction: no Lean needed
  const proj = join(tmp, "proj");
  mkdirSync(proj);
  writeFileSync(join(proj, "lean-toolchain"), "leanprover/lean4:v4.33.1\n");
  writeFileSync(join(proj, "M.lean"), "namespace N\ndef a : Nat := 0\ndef b : Nat := a\nend N\n");
  const graph = { schema: 1, roots: ["M"], modules: [{ name: "M", imports: [] }], nodes: [{ name: "N.a", kind: "def", module: "M", type: "Nat", ax: 0, hash: "ha" }, { name: "N.b", kind: "def", module: "M", type: "Nat", ax: 0, hash: "hb" }], externals: [{ name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0 }], edges: [[1, 0, 1], [0, 2, 1]], axioms: [], axiomSets: [[]], stats: { folded: 0, metaDropped: 0, ms: 1 } };
  writeFileSync(join(tmp, "graph.json"), JSON.stringify(graph));
  // a port the system says is free, not one picked from a range: a machine's own services may be on
  // any of them
  const port = await new Promise((ok) => {
    const s = createNetServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });
  const cache = join(tmp, "cache");
  const site = join(tmp, "site");
  server = spawn(process.execPath, [main, "serve", proj, "--root", "M", "--graph", join(tmp, "graph.json"), "--port", String(port), "--site", site, "--cache", cache, "--jobs", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b) => (log += b));
  server.stderr.on("data", (b) => (log += b));
  const page = `http://127.0.0.1:${port}`;
  const updates = async () => {
    try {
      return await (await fetch(`${page}/api/updates`)).json();
    } catch {
      return null;
    }
  };
  await until(async () => (await updates())?.running === "8.0.0", "8.0.0 serving");
  check(/version: 8\.0\.0; updates auto — a patch of 8\.0 taken by itself/.test(log), "it says it runs 8.0.0 under the supervisor, taking the patches of 8.0");

  // the page, on N.b, writing a comment
  let pw = null;
  try {
    pw = await import("playwright");
  } catch {
    say("no Playwright: the page is not checked");
  }
  let tab = null;
  if (pw) {
    browser = await pw.chromium.launch();
    tab = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await tab.goto(`${page}/#mode=plain&s=N.b`);
    await tab.waitForSelector("#loader.gone", { state: "attached", timeout: 60_000 });
    // the welcome of a first visit, declined where it is offered (Esc would clear the selection too:
    // the tour is offered, never started by itself)
    await sleep(1500);
    const notNow = tab.getByRole("button", { name: "Not now" });
    if (await notNow.isVisible()) await notNow.click();
    const box = tab.locator("textarea[data-rv-comment]").first();
    await box.waitFor({ timeout: 30_000 });
    await box.fill("a comment being written");
    // written, and left: nothing is being typed that a reload would cut short
    await box.evaluate((el) => el.blur());
  }

  // the patch is published: found, downloaded, taken — with a page open, after the longest wait
  publish(v1);
  await until(async () => (await updates())?.running === "8.0.1", "8.0.1 serving", 180_000);
  check(/VisualProof 8\.0\.1 is ready/.test(log), "8.0.1 found and downloaded into the cache");
  check(existsSync(join(cache, "versions", "8.0.1", "ready")), "the patch is kept ready in <cache>/versions/8.0.1");
  const u1 = await updates();
  check(u1.installed === "8.0.0", "the installed package is still 8.0.0, told of beside the version running");
  if (tab) {
    await until(async () => (await tab.evaluate(() => document.querySelector("textarea[data-rv-comment]")?.value ?? null)) === "a comment being written", "the page reloaded with its draft", 60_000);
    check(true, "the page reloaded into 8.0.1, its comment as it was being written");
    check((await tab.evaluate(() => location.hash)).includes("N.b"), "the page is where it was: N.b selected");
  }

  // a broken patch: set aside, the version before it serving again
  publish(v2);
  await until(() => existsSync(join(cache, "versions", "bad.json")) && /"8\.0\.2"/.test(readFileSync(join(cache, "versions", "bad.json"), "utf8")), "8.0.2 set aside", 180_000);
  await until(async () => (await updates())?.running === "8.0.1", "8.0.1 serving again", 60_000);
  check(true, "8.0.2, failing as it started, set aside; 8.0.1 serving again");

  const events = (await (await fetch(`${page}/api/activity`)).json()).events.filter((e) => e.kind === "tool");
  check(events.some((e) => e.from === null && e.to === "8.0.0") && events.some((e) => e.from === "8.0.0" && e.to === "8.0.1") && events.some((e) => e.setAside?.version === "8.0.2"), "the timeline records each version, and the one set aside");

  // stopped by a signal: the supervisor passes it on, the server lets the site go
  server.kill("SIGTERM");
  const status = await new Promise((ok) => server.on("exit", (c) => ok(c)));
  check(status === 0, "SIGTERM: the supervisor ends with the server's status 0");
  check(!existsSync(join(site, ".lock")), "the site's lock is gone");
  server = null;
} catch (e) {
  failed++;
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  console.error(`the server's log:\n${log.split("\n").slice(-40).join("\n")}`);
} finally {
  if (server) server.kill("SIGKILL");
  await browser?.close();
  registry.close();
  if (keepTmp) say(`kept ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
