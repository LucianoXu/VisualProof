// What tells the live loop to look at the build (server/buildwatch.ts): the folders of the modules'
// sources and outputs watched, a look only when something says to, and every second where the
// watches cannot be trusted.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BuildWatch, moduleDirs, SAFETY_MS, shouldLook } from "../src/server/buildwatch.ts";
import type { LookReasons } from "../src/server/buildwatch.ts";
import type { Project } from "../src/server/project.ts";
import type { ModuleInfo } from "../src/server/status.ts";

const until = async (f: () => boolean, ms = 3000) => {
  for (const end = Date.now() + ms; !f() && Date.now() < end; ) await new Promise((ok) => setTimeout(ok, 10));
  return f();
};

test("a look only when something says to: a server at rest looks every SAFETY_MS, and at nothing else", () => {
  const rest: LookReasons = { heard: false, polling: false, running: 0, runsChanged: false, active: false, sinceMove: 60_000, sinceLook: 1000, unread: false, settle: 2500, tick: 1000 };
  assert.equal(shouldLook(rest), false);
  assert.equal(shouldLook({ ...rest, sinceLook: SAFETY_MS }), true, "every SAFETY_MS");
  assert.equal(shouldLook({ ...rest, heard: true }), true, "a watch said something moved");
  assert.equal(shouldLook({ ...rest, polling: true }), true, "the watches cannot be trusted: every tick");
  assert.equal(shouldLook({ ...rest, running: 1 }), true, "a compile runs");
  assert.equal(shouldLook({ ...rest, runsChanged: true }), true, "a compile ended");
  assert.equal(shouldLook({ ...rest, active: true }), true, "a build goes on");
  assert.equal(shouldLook({ ...rest, sinceMove: 4000 }), true, "a build settles");
  assert.equal(shouldLook({ ...rest, sinceMove: 4500 }), false, "and has settled");
  assert.equal(shouldLook({ ...rest, unread: true }), true, "a build still to be read");
});

test("the folders of the modules' sources and outputs are watched: a change in one is heard, a folder not made yet is watched from the one above it", async () => {
  const root = mkdtempSync(join(tmpdir(), "vp-buildwatch-"));
  const w = new BuildWatch();
  try {
    const lib = join(root, ".lake", "build", "lib", "lean");
    mkdirSync(join(root, "P"), { recursive: true });
    mkdirSync(join(lib, "P"), { recursive: true });
    writeFileSync(join(root, "P.lean"), "import P.A\n");
    writeFileSync(join(root, "P", "A.lean"), "");
    const p = { root, name: "p", toolchain: "tc", roots: ["P"], libDir: lib, files: new Map() } as Project;
    const mods = new Map<string, ModuleInfo>([
      ["P", { name: "P", file: "P.lean", imports: ["P.A", "P.Q.B"] }],
      ["P.A", { name: "P.A", file: "P/A.lean", imports: [] }],
      // a module in a folder of its own, not built yet
      ["P.Q.B", { name: "P.Q.B", file: "P/Q/B.lean", imports: [] }],
    ]);
    assert.deepEqual([...moduleDirs(p, mods)].sort(), [root, join(root, "P"), join(root, "P", "Q"), lib, join(lib, "P"), join(lib, "P", "Q")].sort());
    w.watch(moduleDirs(p, mods), root);
    assert.equal(w.polling, null);
    // P/Q and lib/P/Q are not there: P and lib/P watch for them
    assert.equal(w.size, 4);
    w.dirty = false;
    writeFileSync(join(root, "P", "A.lean"), "def a := 1\n");
    assert.ok(await until(() => w.dirty), "a source edited");
    w.dirty = false;
    writeFileSync(join(lib, "P", "A.olean"), "");
    assert.ok(await until(() => w.dirty), "an output written");
    w.dirty = false;
    mkdirSync(join(lib, "P", "Q"));
    assert.ok(await until(() => w.dirty), "the folder of an output not built before, made");
    // watched again: the new folder itself
    w.watch(moduleDirs(p, mods), root);
    assert.equal(w.size, 5);
    w.dirty = false;
    writeFileSync(join(lib, "P", "Q", "B.olean"), "");
    assert.ok(await until(() => w.dirty), "an output written in it");
    // fewer modules: fewer folders
    w.watch(moduleDirs(p, new Map([["P", mods.get("P")!]])), root);
    assert.equal(w.size, 2);
  } finally {
    w.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("watches that miss a change are made again; twice, and the loop looks every second instead, saying why", () => {
  const root = mkdtempSync(join(tmpdir(), "vp-buildwatch-"));
  const said: string[] = [];
  const w = new BuildWatch((l) => said.push(l));
  try {
    w.watch([root], root);
    w.dirty = false;
    w.missed();
    assert.equal(w.polling, null, "once: made again");
    assert.equal(w.size, 0);
    assert.equal(w.dirty, true, "at the next look, at once");
    w.watch([root], root);
    assert.equal(w.size, 1);
    w.missed();
    assert.match(w.polling ?? "", /no watch told of/);
    assert.equal(w.size, 0);
    assert.match(said.join("\n"), /looked at every second/);
    // polling: nothing is watched again
    w.watch([root], root);
    assert.equal(w.size, 0);
  } finally {
    w.close();
    rmSync(root, { recursive: true, force: true });
  }
});
