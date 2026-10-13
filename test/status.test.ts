// Build status against real Lake builds of a copy of the fixture. Skipped where there is no lake.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { openProject } from "../src/server/project.ts";
import { BuildTracker, importable, lakeTextHash, parseImports, scanModules } from "../src/server/status.ts";
import { copyFixture, leanAtLeast } from "./fixturecopy.ts";

let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}

let dir = "";
const build = () => {
  try {
    execFileSync("lake", ["build"], { cwd: dir, stdio: "ignore" });
  } catch {
    // a failing build is one of the cases
  }
};
const edit = (file: string, from: string, to: string) => {
  const p = join(dir, file);
  const text = readFileSync(p, "utf8");
  assert.ok(text.includes(from), `${file} lacks ${from}`);
  writeFileSync(p, text.replace(from, to));
};
const states = async () => {
  const p = openProject(dir, [], false);
  const mods = scanModules(p);
  const st = await new BuildTracker(p).status(mods);
  return Object.fromEntries(st.files.map((f) => [f.module, f.state]));
};

before(() => {
  if (!haveLake) return;
  dir = copyFixture("vp-status-");
  build();
});
after(() => dir && rmSync(dir, { recursive: true, force: true }));

test("header imports, comments included", () => {
  const text = "/-- doc -/\n-- note\nimport A.B\n/- block\n  import Nope -/\npublic import C -- trailing\nimport all D\n\ndef x := 1\nimport E";
  assert.deepEqual(parseImports(text), ["A.B", "C", "D"]);
});

test("Lake's text hash, against a trace it wrote", { skip: !haveLake }, () => {
  const trace = JSON.parse(readFileSync(join(dir, ".lake/build/lib/lean/Fixture/Use.trace"), "utf8"));
  const recorded = trace.inputs.find((i: unknown[]) => typeof i[0] === "string" && (i[0] as string).endsWith("Use.lean"))[1];
  assert.equal(lakeTextHash(readFileSync(join(dir, "Fixture/Use.lean"), "utf8")), recorded);
});

test("states follow edits and builds", { skip: !haveLake }, async () => {
  // Fixture.Axioms leaves a proof open on purpose (its axiom set is tested in extract.test.ts)
  const clean = { Fixture: "ok", "Fixture.Basic": "ok", "Fixture.Use": "ok", "Fixture.Leaf": "ok", "Fixture.Axioms": "sorry", "Fixture.Tagged": "ok" };
  assert.deepEqual(await states(), clean);

  // touching a file without changing it is not a change
  const basic = join(dir, "Fixture/Basic.lean");
  writeFileSync(basic, readFileSync(basic, "utf8"));
  assert.equal((await states())["Fixture.Basic"], "ok");

  // an edit makes the file stale, and everything above it
  edit("Fixture/Use.lean", "def helper (n : Nat) : Nat := n + 0", "def helper (n : Nat) : Nat := n + 0 + 0");
  let s = await states();
  assert.equal(s["Fixture.Use"], "stale");
  assert.equal(s["Fixture.Leaf"], "stale");
  assert.equal(s["Fixture.Basic"], "ok");

  // a sorry shows after the build
  edit("Fixture/Use.lean", "theorem helper_eq (n : Nat) : helper n = n := rfl", "theorem helper_eq (n : Nat) : helper n = n := sorry");
  build();
  s = await states();
  assert.equal(s["Fixture.Use"], "sorry");
  assert.equal(s["Fixture.Leaf"], "ok");

  // a failure: the file failed, everything above it blocked, and the build cannot be imported.
  // Before Lean v4.29 Lake keeps a failed file's previous .olean, so nothing on disk tells a failure
  // from an edit not yet built: the file and everything above it are out of date, and the last
  // build still imports
  edit("Fixture/Basic.lean", "p.x + p.y", "p.x + undefinedThing");
  build();
  s = await states();
  const p = openProject(dir, [], false);
  if (leanAtLeast(4, 29)) {
    assert.equal(s["Fixture.Basic"], "failed");
    assert.equal(s["Fixture.Use"], "blocked");
    assert.equal(s["Fixture.Leaf"], "blocked");
    assert.deepEqual(importable(p, scanModules(p)), []);
  } else {
    assert.equal(s["Fixture.Basic"], "stale");
    assert.equal(s["Fixture.Use"], "stale");
    assert.equal(s["Fixture.Leaf"], "stale");
    assert.deepEqual(new Set(importable(p, scanModules(p))), new Set(scanModules(p).keys()));
  }

  // fixed: everything as it was
  edit("Fixture/Basic.lean", "p.x + undefinedThing", "p.x + p.y");
  edit("Fixture/Use.lean", "helper n = n := sorry", "helper n = n := rfl");
  build();
  assert.deepEqual(await states(), clean);
});
