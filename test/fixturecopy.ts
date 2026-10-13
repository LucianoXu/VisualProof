// The fixture (test/fixture) copied where a test may build and change it, with the toolchain under
// test: the fixture's own, or the one VP_TOOLCHAIN names. scripts/test-toolchains.mjs runs the whole
// suite once per toolchain of test/toolchains.json; a test whose answer depends on the Lean version
// asks `leanAtLeast` and says why.

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

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
