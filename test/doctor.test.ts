// `visualproof doctor` (server/doctor.ts): the Node versions VisualProof runs on, the toolchains it
// supports, what a machine lacks and what to do about it, a project's build and site; and the
// default libraries of a lakefile.lean, read as text (server/project.ts).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { doctor, printReport, satisfies, supportedToolchains, toolchainName, toolchainSupport } from "../src/server/doctor.ts";
import type { Run } from "../src/server/doctor.ts";
import { openProject, readLakefileLean } from "../src/server/project.ts";

const REPO = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "vp-doctor-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("the Node versions in engines are those with both type stripping and import.meta.main", () => {
  const range = pkg.engines.node;
  assert.ok(satisfies(process.versions.node, range), "the Node running the tests");
  for (const v of ["22.18.0", "22.23.3", "24.2.0", "24.15.0", "26.1.0"]) assert.ok(satisfies(v, range), v);
  // before 22.18 no type stripping by default; 23.x and 24.0 to 24.1 have no import.meta.main, so
  // `visualproof` would end at once, doing nothing
  for (const v of ["20.19.0", "22.17.1", "23.6.0", "23.11.1", "24.0.0", "24.1.0"]) assert.ok(!satisfies(v, range), v);
  assert.ok(satisfies("1.2.3", "1.2.3") && satisfies("1.5.0", ">=1.2.0 <2.0.0") && !satisfies("2.0.0", ">=1.2.0 <2.0.0"));
});

test("toolchains as elan names them, and where each stands against the supported ones", () => {
  for (const t of ["leanprover/lean4:v4.33.1", "v4.33.1", "4.33.1", "leanprover--lean4---v4.33.1", "leanprover/lean4:v4.33.1 (default)"]) {
    assert.equal(toolchainName(t), "leanprover/lean4:v4.33.1", t);
  }
  const listed = JSON.parse(readFileSync(join(REPO, "test", "toolchains.json"), "utf8"));
  const s = supportedToolchains();
  assert.equal(s.floor, listed.floor);
  assert.ok(listed.toolchains.includes(s.newest));
  const r = { floor: "v4.28.0", newest: "v4.35.0" };
  assert.equal(toolchainSupport("leanprover/lean4:v4.27.0", r), "old");
  for (const t of ["v4.28.0", "leanprover/lean4:v4.33.0-rc2", "leanprover/lean4:v4.35.0-rc4", "v4.35.0"]) assert.equal(toolchainSupport(t, r), "tested", t);
  assert.equal(toolchainSupport("leanprover/lean4:v4.36.0-rc1", r), "new");
  assert.equal(toolchainSupport("leanprover/lean4-nightly:nightly-2026-10-01", r), "other");
});

test("a lakefile.lean's libraries, read as text: their roots and globs, which are the default ones; comments and other targets left out", () => {
  const cedar = `/- Copyright -/
import Lake
open Lake DSL

meta if get_config? env = some "dev" then -- dev is so not everyone has to build it
require "leanprover" / "doc-gen4" @ git "v4.34.1"

require "leanprover-community" / "batteries" @ git "v4.34.0"

package Cedar

@[default_target]
lean_lib Cedar where
  defaultFacets := #[LeanLib.staticFacet]

@[default_target]
lean_lib SymCC where
  defaultFacets := #[LeanLib.staticFacet]

lean_lib DiffTest where

lean_exe CedarUnitTests where
  root := \`UnitTest.Main
`;
  assert.deepEqual(readLakefileLean(cedar), { name: "Cedar", defaultTargets: ["Cedar", "SymCC"], libs: [{ name: "Cedar" }, { name: "SymCC" }, { name: "DiffTest" }] });
  const roots = `package «my-proj» where
  leanOptions := #[⟨\`autoImplicit, false⟩]

-- @[default_target] lean_lib Commented
/- @[default_target]
   lean_lib AlsoCommented /- nested -/ -/
@[default_target, test_driver] lean_lib «Lib» where
  roots := #[\`Lib.Main, \`«Lib».Extra]
  globs := #[.submodules \`Lib]

@[default_target]
lean_exe tool where
  root := \`Main
`;
  assert.deepEqual(readLakefileLean(roots), { name: "my-proj", defaultTargets: ["Lib"], libs: [{ name: "Lib", roots: ["Lib.Main", "Lib.Extra"], globs: ["Lib.+"] }] });
  assert.deepEqual(readLakefileLean("package Foo\nlean_lib Foo\n"), { name: "Foo", libs: [{ name: "Foo" }] });
  // and a project with one is opened by them, where a lakefile.lean once needed --root
  const dir = join(tmp, "leanlib");
  mkdirSync(dir);
  writeFileSync(join(dir, "lean-toolchain"), "leanprover/lean4:v4.31.0\n");
  writeFileSync(join(dir, "lakefile.lean"), cedar);
  const p = openProject(dir, [], false);
  assert.deepEqual([p.name, p.roots], ["Cedar", ["Cedar", "SymCC"]]);
  assert.deepEqual(openProject(dir, ["Cedar.Spec"], false).roots, ["Cedar.Spec"], "--root still wins");
});

/** a machine as the doctor sees it: the programs it has, and what they say */
function machine(have: Record<string, string>): Run {
  return (cmd, args) => have[[cmd, ...args].join(" ")] ?? (cmd in have ? have[cmd] : null);
}
const full = machine({
  "elan --version": "elan 4.2.1 (3d5138e15 2026-03-18)",
  "elan toolchain list": "leanprover/lean4:v4.31.0\nleanprover/lean4:v4.33.1 (default)\n",
  pdfinfo: "pdfinfo version 24.02.0",
  pdftotext: "pdftotext version 24.02.0",
  pdftoppm: "pdftoppm version 24.02.0",
  xelatex: "XeTeX 3.141592653-2.6-0.999995 (TeX Live 2023/Debian)",
  git: "git version 2.43.0",
});

function project(name: string, toolchain: string, built: boolean): string {
  const dir = join(tmp, name);
  mkdirSync(join(dir, ".lake", "build", "lib", "lean"), { recursive: true });
  writeFileSync(join(dir, "lean-toolchain"), `${toolchain}\n`);
  writeFileSync(join(dir, "lakefile.toml"), `name = "${name}"\ndefaultTargets = ["${name}"]\n\n[[require]]\nname = "mathlib"\n`);
  if (built) writeFileSync(join(dir, ".lake", "build", "lib", "lean", `${name}.olean`), "");
  return dir;
}

test("the machine: what is missing fails, warns or is only said, each with what to do", () => {
  const ok = doctor({ path: null, roots: [], site: null, cache: null, run: full, node: "24.15.0", platform: "linux" });
  assert.deepEqual(ok.checks.map((c) => c.level), ["ok", "ok", "ok", "ok"]);
  assert.equal(ok.ready, null);
  assert.match(printReport(ok, null), /To check a project too: visualproof doctor <lean-project>/);

  const bare = doctor({ path: null, roots: [], site: null, cache: null, run: () => null, node: "23.11.1", platform: "darwin" });
  const by = (re: RegExp) => bare.checks.find((c) => re.test(c.what))!;
  assert.equal(by(/^Node/).level, "fail");
  assert.equal(by(/^elan/).level, "fail");
  assert.match(by(/^elan/).fix!, /github\.com\/leanprover\/elan/);
  assert.equal(by(/^Poppler/).level, "warn");
  assert.equal(by(/^Poppler/).fix, "brew install poppler");
  assert.equal(by(/^XeLaTeX/).level, "info");
  assert.equal(by(/^git/).level, "info");
  const text = printReport(bare, null);
  assert.match(text, /✗ Node 23\.11\.1: VisualProof needs \^22\.18\.0 or >=24\.2\.0/);
  assert.doesNotMatch(text, /To check a project too/, "the machine first");
  const linux = doctor({ path: null, roots: [], site: null, cache: null, run: () => null, node: "24.15.0", platform: "linux" });
  assert.match(linux.checks.find((c) => /^Poppler/.test(c.what))!.fix!, /apt install poppler-utils/);
});

test("a project: its toolchain, its build, its site; ready only when nothing failed", () => {
  // a machine with memory enough for the usage pass on Mathlib (the memory is its own test's)
  const plenty = { available: 64 * 2 ** 30, total: 64 * 2 ** 30 };
  const site = join(tmp, "site");
  const cache = join(tmp, "cache");
  const unbuilt = project("Unbuilt", "leanprover/lean4:v4.33.1", false);
  const r = doctor({ path: unbuilt, roots: [], site, cache, run: full, node: "24.15.0", memory: plenty });
  const build = r.checks.find((c) => /built/.test(c.what))!;
  assert.equal(build.level, "fail");
  assert.match(build.what, /not built: Unbuilt \(\.lake\/build\/lib\/lean\/Unbuilt\.olean is missing; from lakefile\.toml\)/);
  assert.equal(build.fix, `in ${unbuilt}: lake exe cache get && lake build`, "on Mathlib: its cache first");
  assert.equal(r.ready, null);

  const built = project("Built", "leanprover/lean4:v4.31.0", true);
  const ok = doctor({ path: built, roots: [], site, cache, run: full, node: "24.15.0", memory: plenty });
  assert.deepEqual(ok.checks.filter((c) => c.level !== "ok"), []);
  assert.equal(ok.ready, `visualproof serve ${built} --site ${site} --cache ${cache}`);
  assert.match(printReport(ok, built), /\n\nReady: visualproof serve /);

  // a toolchain not installed: elan downloads it on first use; older than supported fails
  const fresh = project("Fresh", "leanprover/lean4:v4.34.1", true);
  const f = doctor({ path: fresh, roots: [], site, cache, run: full, node: "24.15.0", memory: plenty });
  assert.deepEqual(f.checks.filter((c) => c.level !== "ok").map((c) => [c.level, c.fix]), [["warn", "elan toolchain install leanprover/lean4:v4.34.1"]]);
  assert.ok(f.ready);
  const old = project("Old", "leanprover/lean4:v4.20.0", true);
  assert.equal(doctor({ path: old, roots: [], site, cache, run: full, node: "24.15.0", memory: plenty }).ready, null);

  // a site a living server holds is said, and is no failure
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, ".lock"), `${process.pid}\n`);
  const held = doctor({ path: built, roots: [], site, cache, run: full, node: "24.15.0", memory: plenty });
  assert.match(held.checks.at(-1)!.what, new RegExp(`a server \\(process ${process.pid}\\) is serving it`));
  assert.ok(held.ready);
  rmSync(join(site, ".lock"));

  // not a project at all
  const none = doctor({ path: tmp, roots: [], site, cache, run: full, node: "24.15.0", memory: plenty });
  assert.match(none.checks.at(-1)!.what, /no lean-toolchain/);
  assert.equal(none.ready, null);
});

test("a project on Mathlib: the memory the usage pass's workers may hold, against what the machine has, with the --jobs that fits", () => {
  const GB = 2 ** 30;
  const site = join(tmp, "site-mem");
  const cache = join(tmp, "cache-mem");
  const built = project("Heavy", "leanprover/lean4:v4.31.0", true);
  const at = (available: number, total = 32 * GB) => doctor({ path: built, roots: [], site, cache, run: full, node: "24.15.0", memory: { available, total } }).checks.find((c) => /^memory/.test(c.what))!;
  const ok = at(60 * GB, 64 * GB);
  assert.equal(ok.level, "ok");
  assert.match(ok.what, /^memory: 60 GB available of 64 GB: enough for the usage pass at 8 at a time$/);
  const short = at(20 * GB);
  assert.equal(short.level, "warn");
  assert.match(short.what, /up to 6\.0 GB each, 48 GB at 8 at a time \(the default --jobs\); it starts fewer while less than 2\.0 GB is available/);
  assert.equal(short.fix, "serve with --jobs 3");
  assert.equal(at(1 * GB).fix, "serve with --jobs 1");
  // a warning, no failure: it is ready all the same
  assert.ok(doctor({ path: built, roots: [], site, cache, run: full, node: "24.15.0", memory: { available: 20 * GB, total: 32 * GB } }).ready);
  // off Mathlib, a worker holds little: no advice
  const light = join(tmp, "Light");
  mkdirSync(join(light, ".lake", "build", "lib", "lean"), { recursive: true });
  writeFileSync(join(light, "lean-toolchain"), "leanprover/lean4:v4.31.0\n");
  writeFileSync(join(light, "lakefile.toml"), `name = "Light"\ndefaultTargets = ["Light"]\n`);
  writeFileSync(join(light, ".lake", "build", "lib", "lean", "Light.olean"), "");
  const l = doctor({ path: light, roots: [], site, cache, run: full, node: "24.15.0", memory: { available: 2 * GB, total: 4 * GB } }).checks.find((c) => /^memory/.test(c.what))!;
  assert.deepEqual([l.level, l.what], ["ok", "memory: 2.0 GB available of 4.0 GB"]);
});

test("the command: its version, its usage asked for, the doctor's status", () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(REPO, "src", "server", "main.ts"), ...args], { encoding: "utf8", timeout: 60_000 });
  const v = cli("--version");
  assert.deepEqual([v.status, v.stdout.trim()], [0, pkg.version]);
  const h = cli("--help");
  assert.equal(h.status, 0);
  assert.match(h.stdout, /visualproof doctor \[<lean-project>\]/);
  assert.equal(cli("nonsense").status, 2);
  const d = cli("doctor", tmp);
  assert.equal(d.status, 1);
  assert.match(d.stdout, /✗ no lean-toolchain in /);
});
