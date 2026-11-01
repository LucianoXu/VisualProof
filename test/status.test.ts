// Build status against real Lake builds of a copy of the fixture. Skipped where there is no lake.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { openProject } from "../src/server/project.ts";
import type { Project } from "../src/server/project.ts";
import { BuildTracker, commandsInProc, compiledTextHash, compiling, importable, lakeTextHash, parseImports, probeAll, scanModules, stampOf } from "../src/server/status.ts";
import type { ModuleInfo } from "../src/server/status.ts";
import { copyFixture, leanAtLeast } from "./fixturecopy.ts";
import { isCompiledText } from "../src/shared/build.ts";

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

test("only outputs written are a build: a file the project gains or loses while nothing is written is not (docs/LAKE.md)", async () => {
  const root = mkdtempSync(join(tmpdir(), "vp-active-"));
  try {
    const lib = join(root, ".lake", "build", "lib", "lean");
    mkdirSync(join(root, "P"), { recursive: true });
    mkdirSync(join(lib, "P"), { recursive: true });
    const p = { root, name: "p", toolchain: "tc", roots: ["P"], libDir: lib, files: new Map() } as Project;
    const mod = (name: string, imports: string[] = []): ModuleInfo => ({ name, file: name.split(".").join("/") + ".lean", imports });
    const built = (name: string, at: number) => {
      const base = join(lib, ...name.split("."));
      for (const ext of [".olean", ".trace"]) {
        writeFileSync(base + ext, "");
        utimesSync(base + ext, at / 1000, at / 1000);
      }
    };
    for (const n of ["P", "P.A"]) writeFileSync(join(root, mod(n).file), "");
    const long = Date.now() - 60_000;
    built("P", long);
    built("P.A", long);
    const t = new BuildTracker(p);
    const mods = new Map([["P", mod("P", ["P.A"])], ["P.A", mod("P.A")]]);
    assert.equal((await t.status(mods)).active, false, "the first look is no change");
    // an import of a file not built yet: the project gains a module, nothing is written
    writeFileSync(join(root, "P/B.lean"), "");
    const more = new Map([...mods, ["P.B", mod("P.B")]]);
    more.set("P", mod("P", ["P.A", "P.B"]));
    const s = await t.status(more);
    assert.equal(s.active, false, "no build runs");
    assert.equal(s.files.find((f) => f.module === "P.B")?.state, "unbuilt");
    // taken out again: nothing written either
    assert.equal((await t.status(mods)).active, false);
    // back in the list, with outputs written long ago (a file built before and imported again): no build
    built("P.B", long);
    assert.equal((await t.status(more)).active, false);
    // Lake writes P.B's outputs: a build
    built("P.B", Date.now());
    assert.equal((await t.status(more)).active, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a compile running is seen, from /proc where there is one, else ps: a process `lean … -o <libDir>/M.olean`, one that runs it a moment after it started too", async () => {
  const root = mkdtempSync(join(tmpdir(), "vp-compiling-"));
  const kids: ReturnType<typeof spawn>[] = [];
  try {
    const lib = join(root, ".lake", "build", "lib", "lean");
    const p = { root, name: "p", toolchain: "tc", roots: ["P"], libDir: lib, files: new Map() } as Project;
    const run = (args: string[]) => {
      const k = spawn(process.execPath, args, { stdio: "ignore" });
      kids.push(k);
      return k;
    };
    const until = async (f: () => Promise<boolean>) => {
      for (const end = Date.now() + 5000; Date.now() < end; await new Promise((ok) => setTimeout(ok, 50))) if (await f()) return true;
      return false;
    };
    const sees = (m: string) => async () => (await compiling(p)).has(m);
    assert.equal((await compiling(p)).size, 0);
    // a compile as Lake runs one (here a process whose arguments say so)
    const k = run(["-e", "setTimeout(() => {}, 20000)", "--", "lean", "P/A.lean", "-o", `${lib}/P/A.olean`, "-i", `${lib}/P/A.ilean`]);
    assert.ok(await until(sees("P.A")), "seen");
    // a process that becomes the compile after it started (forked, then running lean): seen too
    const later = join(root, "later.mjs");
    writeFileSync(later, `setTimeout(() => process.exit(0), 20000);`);
    // its own arguments say nothing of the compile: the script does, which it runs after a while
    writeFileSync(join(root, "later.sh"), `sleep 0.6\nexec "${process.execPath}" ${later} -- lean P/B.lean -o ${lib}/P/B.olean\n`);
    const sh = spawn("sh", [join(root, "later.sh")], { stdio: "ignore" });
    kids.push(sh);
    // looked at before it runs lean, and after
    if (process.platform === "linux") commandsInProc();
    assert.ok(await until(sees("P.B")), "seen once it runs lean");
    k.kill();
    assert.ok(await until(async () => !(await compiling(p)).has("P.A")), "a compile over is no longer seen");
    if (process.platform === "linux") assert.ok(commandsInProc() !== null, "/proc is read on Linux");
  } finally {
    for (const k of kids) k.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a look reads each module's files once: the stamp moves with an output written and a source edited, and the status from it is the status", async () => {
  const root = mkdtempSync(join(tmpdir(), "vp-probe-"));
  try {
    const lib = join(root, ".lake", "build", "lib", "lean");
    mkdirSync(join(root, "P"), { recursive: true });
    mkdirSync(join(lib, "P"), { recursive: true });
    const p = { root, name: "p", toolchain: "tc", roots: ["P"], libDir: lib, files: new Map() } as Project;
    const mods = new Map<string, ModuleInfo>([["P", { name: "P", file: "P.lean", imports: ["P.A"] }], ["P.A", { name: "P.A", file: "P/A.lean", imports: [] }]]);
    writeFileSync(join(root, "P.lean"), "import P.A\n");
    writeFileSync(join(root, "P/A.lean"), "def a := 1\n");
    const long = (Date.now() - 60_000) / 1000;
    for (const f of ["P.olean", "P.trace", "P/A.olean", "P/A.trace"]) {
      writeFileSync(join(lib, f), "{}");
      utimesSync(join(lib, f), long, long);
    }
    const s0 = stampOf(probeAll(p, mods));
    assert.equal(stampOf(probeAll(p, mods)), s0, "nothing moved");
    utimesSync(join(lib, "P/A.olean"), long + 5, long + 5);
    const s1 = stampOf(probeAll(p, mods));
    assert.notEqual(s1, s0, "an output written");
    writeFileSync(join(root, "P/A.lean"), "def a := 2\n");
    utimesSync(join(root, "P/A.lean"), long + 9, long + 9);
    assert.notEqual(stampOf(probeAll(p, mods)), s1, "a source edited");
    // the status made from a look is the status made by itself
    const probes = probeAll(p, mods);
    assert.deepEqual(await new BuildTracker(p).status(mods, probes, new Set()), await new BuildTracker(p).status(mods));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Lake's traces, each shape: a compile records the source's hash; a build restored from Lake's artifact cache records none, and its source counts as compiled while not modified since (docs/LAKE.md)", async () => {
  const root = mkdtempSync(join(tmpdir(), "vp-traces-"));
  try {
    const lib = join(root, ".lake/build/lib/lean");
    mkdirSync(lib, { recursive: true });
    const text = "def a : Nat := 1\n";
    const outputs = { o: ["9ad0c4595f4ab6b5.olean"], i: "4b9e5fece5fb37cd.ilean", c: "f75f4dfcfcbbe577.c" };
    // as Lake 4.28 to 4.35 write them (BuildMetadata, schema 2025-09-10)
    const shapes: Record<string, (file: string) => object> = {
      // a compile: the source's hash among the inputs
      Compiled: (file) => ({ schemaVersion: "2025-09-10", depHash: "a21713e86f7921b7", inputs: [["deps", []], [join(root, file), lakeTextHash(text)], ["options", []]], outputs, log: [], synthetic: false }),
      // restored from the local artifact cache (`enableArtifactCache`): `BuildMetadata.ofFetch`
      Local: () => ({ synthetic: true, schemaVersion: "2025-09-10", outputs, log: [], inputs: [], depHash: "12451e0ab6c43dac" }),
      // unpacked from a cache's .ltar (`lake cache get`): the outputs, and the log of the build that
      // made it, here empty (as Physlib's)
      Ltar: () => ({ schemaVersion: "2025-09-10", depHash: "6f5598d56a1c3dbe", outputs }),
      // the same with a log: what it says still holds
      LtarSorry: () => ({ schemaVersion: "2025-09-10", depHash: "0e0a2f7d0c1b9a33", outputs, log: [{ level: "warning", message: "declaration uses `sorry`" }] }),
    };
    const files = new Map(Object.keys(shapes).map((m) => [m, `${m}.lean`]));
    const p: Project = { root, name: "traces", toolchain: "leanprover/lean4:v4.35.0", roots: [...files.keys()], libDir: lib, files };
    const t0 = Date.now() / 1000 - 3600;
    const at = (f: string, s: number) => utimesSync(f, t0 + s, t0 + s);
    for (const [m, shape] of Object.entries(shapes)) {
      writeFileSync(join(root, `${m}.lean`), text);
      writeFileSync(join(lib, `${m}.olean`), "olean");
      writeFileSync(join(lib, `${m}.trace`), JSON.stringify(shape(`${m}.lean`)));
      // the sources first, then what Lake writes
      at(join(root, `${m}.lean`), 0);
      at(join(lib, `${m}.olean`), 10);
      at(join(lib, `${m}.trace`), 10);
    }
    const compiled = (m: string) => compiledTextHash(p, m, `${m}.lean`);
    const states = async () => Object.fromEntries((await new BuildTracker(p).status(scanModules(p), undefined, new Set())).files.map((f) => [f.module, f.state]));
    const h = lakeTextHash(text);
    assert.deepEqual([compiled("Compiled"), compiled("Local"), compiled("Ltar"), compiled("LtarSorry")], [h, h, h, h], "each its text's: the compile by its trace, a restored build by its source not modified since");
    assert.deepEqual(await states(), { Compiled: "ok", Local: "ok", Ltar: "ok", LtarSorry: "sorry" });
    // what the page and the server ask of it (shared/build.ts): the text is the compiled one only
    // where the build records it and it is this one
    assert.deepEqual([isCompiledText(h, h), isCompiledText(h, "0"), isCompiledText(null, h), isCompiledText(undefined, h), isCompiledText(h, null)], [true, false, false, false, false]);

    // saved again unchanged: the compile's trace still says so; a restored build's text was seen
    // compiled under that trace, and is the same text
    for (const m of files.keys()) at(join(root, `${m}.lean`), 20);
    assert.deepEqual([compiled("Compiled"), compiled("Local"), compiled("Ltar")], [h, h, h]);

    // edited: the compile's trace says what was compiled, which is not this; of a restored build
    // nothing says what was, and nothing is claimed
    for (const m of files.keys()) writeFileSync(join(root, `${m}.lean`), text + "def b : Nat := 2\n");
    assert.deepEqual([compiled("Compiled"), compiled("Local"), compiled("Ltar")], [h, null, null]);
    assert.deepEqual(await states(), { Compiled: "stale", Local: "stale", Ltar: "stale", LtarSorry: "stale" });

    // a restored build never seen before, its source modified since its trace was written, even
    // back to what it was: nothing records the text, and it is not taken for the compiled one
    writeFileSync(join(root, "Fresh.lean"), text);
    writeFileSync(join(lib, "Fresh.olean"), "olean");
    writeFileSync(join(lib, "Fresh.trace"), JSON.stringify(shapes.Ltar("Fresh.lean")));
    at(join(lib, "Fresh.trace"), 10);
    at(join(root, "Fresh.lean"), 20);
    assert.equal(compiledTextHash(p, "Fresh", "Fresh.lean"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a build Lake restored from its artifact cache: what the graph reads of each file is its text, until the file is edited; a build compiles it again (docs/LAKE.md)", { skip: !haveLake }, async () => {
  const other = copyFixture("vp-status-restored-");
  const cache = mkdtempSync(join(tmpdir(), "vp-lake-cache-"));
  const env = { ...process.env, LAKE_CACHE_DIR: cache };
  try {
    // as Physlib has it: Lake's artifact cache, every artifact restored into the build folder
    const lakefile = join(other, "lakefile.toml");
    writeFileSync(lakefile, readFileSync(lakefile, "utf8").replace(/^(name = .*)$/m, "$1\nenableArtifactCache = true\nrestoreAllArtifacts = true"));
    execFileSync("lake", ["build"], { cwd: other, stdio: "ignore", env });
    rmSync(join(other, ".lake", "build"), { recursive: true, force: true });
    execFileSync("lake", ["build"], { cwd: other, stdio: "ignore", env });
    const trace = JSON.parse(readFileSync(join(other, ".lake/build/lib/lean/Fixture/Use.trace"), "utf8"));
    assert.equal(trace.synthetic, true, "restored, not compiled");
    assert.deepEqual(trace.inputs ?? [], [], "the trace records no inputs");
    const p = openProject(other, [], false);
    const mods = scanModules(p);
    for (const m of mods.values()) assert.equal(compiledTextHash(p, m.name, m.file), lakeTextHash(readFileSync(join(other, m.file), "utf8")), m.name);
    const states = async () => Object.fromEntries((await new BuildTracker(p).status(scanModules(p))).files.map((f) => [f.module, f.state]));
    // (the trace keeps no log, so a restored `sorry` is not seen here: Fixture.Axioms reads ok)
    assert.equal((await states())["Fixture.Use"], "ok");

    const use = join(other, "Fixture/Use.lean");
    writeFileSync(use, readFileSync(use, "utf8").replace("def helper (n : Nat) : Nat := n + 0", "def helper (n : Nat) : Nat := n + 0 + 0"));
    assert.equal(compiledTextHash(p, "Fixture.Use", "Fixture/Use.lean"), null);
    let s = await states();
    assert.equal(s["Fixture.Use"], "stale");
    assert.equal(s["Fixture.Leaf"], "stale", "what imports it is out of date");

    // Lake finds no artifact for the new text, and compiles it: its trace records the text again
    execFileSync("lake", ["build"], { cwd: other, stdio: "ignore", env });
    assert.equal(compiledTextHash(p, "Fixture.Use", "Fixture/Use.lean"), lakeTextHash(readFileSync(use, "utf8")));
    s = await states();
    assert.equal(s["Fixture.Use"], "ok");
  } finally {
    rmSync(other, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

