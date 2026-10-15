// The package as npm installs it (scripts/build.mjs): built into a temporary folder laid out as the
// installed package is, it holds everything the server reads beside its code, imports no
// TypeScript, and runs: its usage, and an export of the fixture, which compiles the Lean programs
// and serves the prebuilt page. The export needs lake.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";
import { copyFixture } from "./fixturecopy.ts";

let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}

const REPO = join(import.meta.dirname, "..");
const pkgJson = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
let tmp: string;
let pkg: string;

/** what npm would put in the package, by `files` (README, LICENSE and package.json come anyway) */
function packed(path: string): boolean {
  return (pkgJson.files as string[]).some((f) => path === f.replace(/\/$/, "") || path.startsWith(f.endsWith("/") ? f : `${f}/`));
}

before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vp-package-"));
  pkg = join(tmp, "visualproof");
  execFileSync(process.execPath, [join(REPO, "scripts", "build.mjs"), join(pkg, "dist")], { stdio: "ignore" });
  cpSync(join(REPO, "package.json"), join(pkg, "package.json"));
  for (const f of pkgJson.files as string[]) if (!f.startsWith("dist")) cpSync(join(REPO, f), join(pkg, f), { recursive: true });
  // its dependencies, as npm would install them beside it
  symlinkSync(join(REPO, "node_modules"), join(pkg, "node_modules"), "dir");
});
after(() => rmSync(tmp, { recursive: true, force: true }));

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name)));
}

test("the package holds the server compiled, the page bundled, and what the server reads beside its code", () => {
  assert.equal(pkgJson.bin.visualproof, "dist/server/main.js");
  assert.ok(packed(pkgJson.bin.visualproof));
  const main = readFileSync(join(pkg, pkgJson.bin.visualproof), "utf8");
  assert.ok(main.startsWith("#!/usr/bin/env node\n"), "the bin runs as a command");
  for (const f of [
    "dist/extractor/Extract.lean",
    "dist/extractor/Usage.lean",
    "dist/mcp/visualproof-mcp.mjs",
    "dist/assets/latex/visualproof.sty",
    "dist/assets/fonts/JuliaMono-Regular.ttf",
    "dist/assets/webfonts/source-sans-3-latin-wght-normal.woff2",
    "dist/assets/webfonts/source-serif-4-latin-wght-italic.woff2",
    "dist/assets/webfonts/LICENSE-SourceSerif4.txt",
    "dist/assets/webfonts/jost-latin-wght-normal.woff2",
    "dist/assets/webfonts/ttf/jost-400-normal.ttf",
    "dist/assets/webfonts/ttf/source-sans-3-500-normal.ttf",
    "dist/assets/webfonts/ttf/noto-sans-math.ttf",
    "dist/assets/webfonts/metrics.json",
    "dist/web/index.html",
    "dist/web/style.css",
    "dist/web/bundle/app.js",
    "dist/web/bundle/layout.js",
    "dist/web/bundle/edges.js",
    "dist/web/bundle/pdfworker.js",
    "docs/agent-api/README.md",
    "test/toolchains.json",
  ]) {
    assert.ok(existsSync(join(pkg, f)), `${f} is built`);
    assert.ok(packed(f), `${f} is packed`);
  }
  const js = files(join(pkg, "dist")).filter((f) => f.endsWith(".js"));
  assert.ok(js.length > 50);
  assert.deepEqual(files(join(pkg, "dist")).filter((f) => f.endsWith(".ts")), [], "no TypeScript: Node does not strip types under node_modules");
  for (const f of js) {
    assert.doesNotMatch(readFileSync(join(pkg, "dist", f), "utf8"), /from "\.{1,2}\/[^"]*\.ts"|import\("\.{1,2}\/[^"]*\.ts"\)/, `${f} imports JavaScript`);
  }
  // the page's bundle carries no esbuild of its own to make: esbuild is a development dependency
  assert.ok(!("esbuild" in (pkgJson.dependencies ?? {})));
});

test("the built command runs without TypeScript: its usage, its version, the doctor", () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, ["--no-experimental-strip-types", join(pkg, "dist", "server", "main.js"), ...args], { encoding: "utf8", timeout: 60_000 });
  const r = cli();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: visualproof serve/);
  assert.equal(cli("--version").stdout.trim(), pkgJson.version);
  // the doctor reads the package's own files: its engines, the toolchains supported
  const d = cli("doctor");
  assert.match(d.stdout, new RegExp(`^VisualProof ${pkgJson.version.replace(/\./g, "\\.")}\n  [✓✗] Node `));
  assert.doesNotMatch(d.stderr, /Error/);
});

test("the built command makes an artwork without a browser or TypeScript: the page's drawing code compiled, the fonts and resvg found from the package", () => {
  const dir = join(tmp, "art");
  const project = join(dir, "proj");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "lean-toolchain"), "leanprover/lean4:v4.33.1\n");
  writeFileSync(join(project, "M.lean"), "namespace N\ndef a : Nat := 0\ndef b : Nat := a\nend N\n");
  const graph = { schema: 1, roots: ["M"], modules: [{ name: "M", imports: [] }], nodes: [{ name: "N.a", kind: "def", module: "M", type: "Nat", ax: 0, hash: "ha" }, { name: "N.b", kind: "def", module: "M", type: "Nat", ax: 0, hash: "hb" }], externals: [{ name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0 }], edges: [[1, 0, 1], [0, 2, 1]], axioms: [], axiomSets: [[]], stats: { folded: 0, metaDropped: 0, ms: 1 } };
  writeFileSync(join(dir, "graph.json"), JSON.stringify(graph));
  writeFileSync(join(dir, "recipe.json"), JSON.stringify({ size: { w: 320, h: 240 }, names: { clusters: 0 }, title: "Small" }));
  const r = spawnSync(
    process.execPath,
    ["--no-experimental-strip-types", join(pkg, "dist", "server", "main.js"), "artwork", project, "--root", "M", "--graph", join(dir, "graph.json"), "--recipe", join(dir, "recipe.json"), "-o", join(dir, "Small"), "--cache", join(dir, "cache")],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(readFileSync(join(dir, "Small.svg"), "utf8"), /^<svg /);
  const png = readFileSync(join(dir, "Small.png"));
  assert.deepEqual([png.toString("latin1", 1, 4), png.readUInt32BE(16), png.readUInt32BE(20)], ["PNG", 320, 240]);
});

test("the built command exports the fixture: the Lean programs compiled from the package, the prebuilt page", { skip: !haveLake }, () => {
  const dir = copyFixture("vp-package-fixture-");
  try {
    execFileSync("lake", ["build"], { cwd: dir, stdio: "ignore" });
    const out = join(tmp, "page.html");
    const r = spawnSync(
      process.execPath,
      ["--no-experimental-strip-types", join(pkg, "dist", "server", "main.js"), "export", dir, "-o", out, "--site", join(tmp, "site"), "--cache", join(tmp, "cache"), "--jobs", "0"],
      { encoding: "utf8", timeout: 300_000 },
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    // the page is the prebuilt one, not bundled again: the cache holds no bundle of its own
    const html = readFileSync(out, "utf8");
    const app = readFileSync(join(pkg, "dist", "web", "bundle", "app.js"), "utf8");
    assert.ok(html.includes(app.slice(app.length >> 1, (app.length >> 1) + 400)), "the page carries the prebuilt bundle");
    assert.ok(!existsSync(join(tmp, "cache", "web")), "nothing bundled into the cache");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
