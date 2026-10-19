// The toolchains' matrix (scripts/test-toolchains.mjs, and in CI .github/workflows/toolchains.yml)
// runs once per toolchain the tests whose answers can depend on it, and only those: the test files
// that import test/fixturecopy.ts (toolchainTests), read from the sources rather than kept as a
// list. What makes them every such test is checked here: the toolchain under test reaches a test
// through test/fixturecopy.ts alone, a test that runs Lake, Lean or elan itself is among them, and
// CI runs them, on a change to any of them too.
//
// Measured on 2026-10-19, before the matrix was cut down to them: the whole suite on v4.28.0 and on
// v4.35.0, every lake, lean and elan it started logged with the test file it was started for. The
// ten files that import test/fixturecopy.ts ran Lake on the toolchain under test; doctor.test.ts
// ran elan's own `--version` and `toolchain list`; no other file ran any; and every test of every
// file ended the same on both.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chosenToolchains, toolchainTests } from "../scripts/test-toolchains.mjs";
import { toolchainSupport } from "../src/server/doctor.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

/** The code of src/ and test/ (the fixture and the golden aside), as paths from the repository. */
function code(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      const f = `${d}/${e.name}`;
      if (e.isDirectory() && f !== "test/fixture" && f !== "test/golden") walk(f);
      else if (e.isFile() && /\.(ts|mts|mjs|js)$/.test(e.name)) out.push(f);
    }
  };
  walk("src");
  walk("test");
  return out;
}

test("the toolchains' matrix runs the tests that import test/fixturecopy.ts, and they are every test the toolchain can change", () => {
  const set = toolchainTests();
  // what the matrix is for: the extraction against its golden, the usage pass, the build status,
  // Lean's hovers, a branch built
  for (const f of ["compat", "extract", "usage", "status", "hover", "deploylive"]) assert.ok(set.includes(`test/${f}.test.ts`), f);
  assert.ok(!set.includes("test/matrix.test.ts") && !set.includes("test/server.test.ts"));
  // the toolchain under test is read there alone: a test reading it elsewhere would answer by it
  // without being run on each
  const name = ["VP", "TOOLCHAIN"].join("_");
  for (const f of code()) if (f !== "test/fixturecopy.ts") assert.ok(!read(f).includes(name), `${f} reads ${name}: only test/fixturecopy.ts may`);
  // a test that runs Lake, Lean or elan itself builds what it runs them on with test/fixturecopy.ts
  const runsLean = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*["'`](?:lake|lean|elan)["'`]/;
  const tests = readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`);
  for (const f of tests) if (runsLean.test(read(f))) assert.ok(set.includes(f), `${f} runs Lean or Lake: it builds its project with test/fixturecopy.ts, which puts it in the matrix`);
  // CI runs them on every toolchain of the list, the newest releases' too, and on a pull request
  // that changes one of them
  const ci = read(".github/workflows/toolchains.yml");
  assert.equal(ci.match(/node --test --import \.\/test\/setup\.ts \$\(node scripts\/test-toolchains\.mjs --files\)/g)?.length, 2);
  assert.match(ci, /jq -c \.toolchains test\/toolchains\.json/);
  for (const f of set) assert.ok(ci.includes(`      - ${f}\n`), `toolchains.yml runs on a change to ${f}`);
});

test("locally the oldest and the newest toolchain of the list, every one when asked, or those named", () => {
  const listed = JSON.parse(read("test/toolchains.json")) as { floor: string; toolchains: string[] };
  const [oldest, newest, ...more] = chosenToolchains([], false);
  assert.deepEqual([oldest, more], [listed.floor, []]);
  assert.ok(listed.toolchains.includes(newest));
  for (const t of listed.toolchains) assert.equal(toolchainSupport(t, { floor: oldest, newest }), "tested", t);
  assert.deepEqual(chosenToolchains([], true), listed.toolchains);
  assert.deepEqual(chosenToolchains(["v4.31.0"], true), ["v4.31.0"]);
});
