// The fixture (test/fixture) copied where a test may build and change it, with the toolchain under
// test: the fixture's own, or the one VP_TOOLCHAIN names, read here alone. scripts/test-toolchains.mjs
// runs the test files that import this one once per toolchain of test/toolchains.json, the rest of
// the suite once (test/matrix.test.ts); a test whose answer depends on the Lean version asks
// `leanAtLeast` and says why.

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { EXTRACT_PROGRAM, EXTRACTOR, leanProgram } from "../src/server/extract.ts";
import { TEST_LEAN } from "./tmpdirs.ts";

export const FIXTURE = join(import.meta.dirname, "fixture");

/** The fixture's own toolchain, as its lean-toolchain writes it: the one the golden is taken with. */
export const FIXTURE_TOOLCHAIN = readFileSync(join(FIXTURE, "lean-toolchain"), "utf8").trim();

/** The toolchain the fixture is built with: VP_TOOLCHAIN (`v4.28.0` or a full name) or its own. */
export function fixtureToolchain(): string {
  const env = process.env.VP_TOOLCHAIN?.trim();
  if (!env) return FIXTURE_TOOLCHAIN;
  return env.includes(":") ? env : `leanprover/lean4:${env}`;
}

/** A fresh copy of the fixture in a temporary folder, without its build, set to the toolchain under
 *  test. */
export function copyFixture(prefix = "vp-fixture-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cpSync(FIXTURE, dir, { recursive: true, filter: (src) => !relative(FIXTURE, src).split(sep).includes(".lake") });
  writeFileSync(join(dir, "lean-toolchain"), fixtureToolchain() + "\n");
  return dir;
}

/** The Lean version under test as [major, minor, patch]; a release candidate counts as its release. */
export function leanVersion(): [number, number, number] {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(fixtureToolchain());
  if (!m) throw new Error(`no version in the toolchain ${fixtureToolchain()}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Whether the Lean version under test is this one or later. */
export function leanAtLeast(major: number, minor: number, patch = 0): boolean {
  const v = leanVersion();
  const w = [major, minor, patch];
  for (let i = 0; i < 3; i++) if (v[i] !== w[i]) return v[i] > w[i];
  return true;
}

/** The extractor as a test runs it after `lake env`, as the server runs it: compiled with the
 *  toolchain under test (server/extract.ts, `leanProgram`: once per toolchain and version of its
 *  source, among the tests' Lean programs, test/tmpdirs.ts), else its source interpreted (`lean
 *  --run`), as the server does where it cannot be built. Compiled, the fixture's extraction takes
 *  0.3 s; interpreted, 28 s on v4.28.0 and 9 s on v4.35.0, which made the oldest toolchains' runs of
 *  scripts/test-toolchains.mjs four times the newest's. test/compat.test.ts compares the two. */
export async function extractor(): Promise<string[]> {
  const bin = await leanProgram(EXTRACT_PROGRAM, fixtureToolchain(), TEST_LEAN, () => {});
  return bin ? [bin] : ["lean", "--run", EXTRACTOR];
}
