// A project's modules to read, as its lakefile names them (server/project.ts): the default targets,
// each library standing for the modules Lake builds of it, by its globs (`A`, `A.+` its
// submodules, `A.*` both), else its roots, else its name; matched against what was built.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { ProjectError, libModules, openProject, readLakefileLean, readLakefileToml, targetsInWords } from "../src/server/project.ts";

const tmp = mkdtempSync(join(tmpdir(), "vp-lakefile-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("a lakefile.toml's libraries: their names, roots and globs, an array over several lines too", () => {
  const toml = `name = "NavierStokesAndEuler"
version = "0.1.0"
defaultTargets = ["NavierStokes", "Euler", "ComparatorChallenges"]

[[require]]
name = "mathlib"
rev = "v4.34.0-rc2"

[[lean_lib]]
name = "NavierStokes"
globs = ["NavierStokes", "NavierStokes.+"]

[[lean_lib]]
name = "Euler"
leanOptions = { autoImplicit = false, warningAsError = true }
globs = ["Euler", "Euler.+"]

[[lean_lib]]
name = "ComparatorChallenges"
globs = [
  "ComparatorChallenges.+",
]

[[lean_lib]]
name = "Plain"
roots = ["Plain.A", "Plain.B"]

[[lean_exe]]
name = "tool"
root = "Main"
`;
  assert.deepEqual(readLakefileToml(toml), {
    name: "NavierStokesAndEuler",
    defaultTargets: ["NavierStokes", "Euler", "ComparatorChallenges"],
    libs: [
      { name: "NavierStokes", globs: ["NavierStokes", "NavierStokes.+"] },
      { name: "Euler", globs: ["Euler", "Euler.+"] },
      { name: "ComparatorChallenges", globs: ["ComparatorChallenges.+"] },
      { name: "Plain", roots: ["Plain.A", "Plain.B"] },
    ],
  });
});

test("a lakefile.lean's globs, in each way Lean writes them", () => {
  const lean = `import Lake
open Lake DSL

package proj

@[default_target]
lean_lib Proj where
  globs := #[.andSubmodules \`Proj, Glob.one \`Extra, .submodules \`«Odd Name»]

lean_lib Tests where
  globs := #[.submodules \`Tests]
`;
  assert.deepEqual(readLakefileLean(lean), {
    name: "proj",
    defaultTargets: ["Proj"],
    libs: [
      { name: "Proj", globs: ["Proj.*", "Extra", "Odd Name.+"] },
      { name: "Tests", globs: ["Tests.+"] },
    ],
  });
});

test("the modules a library builds: its globs, else its roots, else its name", () => {
  const known = ["A", "A.B", "A.B.C", "AB.X", "Z"];
  assert.deepEqual(libModules({ name: "L", globs: ["A.+"] }, known), ["A.B", "A.B.C"], "submodules: not A, nor AB");
  assert.deepEqual(libModules({ name: "L", globs: ["A.*"] }, known), ["A", "A.B", "A.B.C"]);
  assert.deepEqual(libModules({ name: "L", globs: ["Q.*"] }, known), [], "nothing of it there");
  assert.deepEqual(libModules({ name: "L", globs: ["A", "Z", "A.+"] }, known), ["A", "Z", "A.B", "A.B.C"]);
  assert.deepEqual(libModules({ name: "L", roots: ["Z", "Missing"] }, known), ["Z", "Missing"], "a module named alone is kept, to be said missing");
  assert.deepEqual(libModules({ name: "Z" }, known), ["Z"]);
});

/** A project with these sources, and these of them built. */
function project(name: string, lakefile: string, sources: string[], built: string[]): string {
  const root = join(tmp, name);
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  write("lean-toolchain", "leanprover/lean4:v4.34.0-rc2\n");
  write(lakefile.startsWith("import") ? "lakefile.lean" : "lakefile.toml", lakefile);
  for (const m of sources) write(`${m.split(".").join("/")}.lean`, "");
  for (const m of built) write(`.lake/build/lib/lean/${m.split(".").join("/")}.olean`, "");
  return root;
}

const nse = `name = "NSE"
defaultTargets = ["NavierStokes", "ComparatorChallenges"]

[[lean_lib]]
name = "NavierStokes"
globs = ["NavierStokes", "NavierStokes.+"]

[[lean_lib]]
name = "ComparatorChallenges"
globs = ["ComparatorChallenges.+"]
`;

test("a project whose libraries stand for their modules: every module they build is read", () => {
  const srcs = ["NavierStokes", "NavierStokes.Defs", "NavierStokes.Blowup.Main", "ComparatorChallenges.Torus", "ComparatorChallenges.Whole", "Scratch"];
  // a built module whose source is gone is not read again
  const root = project("nse", nse, srcs, [...srcs.filter((m) => m !== "Scratch"), "NavierStokes.Removed"]);
  const p = openProject(root, [], true);
  assert.deepEqual(p.targets, ["NavierStokes", "ComparatorChallenges"]);
  assert.deepEqual(p.roots, ["NavierStokes", "NavierStokes.Blowup.Main", "NavierStokes.Defs", "ComparatorChallenges.Torus", "ComparatorChallenges.Whole"]);
  assert.equal(targetsInWords(p), "NavierStokes, ComparatorChallenges: 5 modules");
  // --root still wins, and says what it reads
  const q = openProject(root, ["NavierStokes.Defs"], true);
  assert.deepEqual([q.roots, q.targets], [["NavierStokes.Defs"], ["NavierStokes.Defs"]]);
  assert.equal(targetsInWords(q), "NavierStokes.Defs");
});

test("a project not built yet: its libraries' modules from where their sources sit, each said missing", () => {
  const root = project("unbuilt", nse, ["NavierStokes", "NavierStokes.Defs", "ComparatorChallenges.Torus"], []);
  const p = openProject(root, [], false);
  assert.deepEqual(p.roots, ["NavierStokes", "NavierStokes.Defs", "ComparatorChallenges.Torus"]);
  assert.throws(() => openProject(root, [], true), (e: unknown) => e instanceof ProjectError && /NavierStokes has not been built/.test(e.message));
  // a library with nothing of it anywhere is still named, to be said unbuilt
  const bare = project("bare", nse, [], []);
  assert.deepEqual(openProject(bare, [], false).roots, ["NavierStokes", "ComparatorChallenges"]);
});

test("a default target that is no library is a module, as before", () => {
  const root = project("plain", 'name = "plain"\ndefaultTargets = ["Plain"]\n', ["Plain", "Plain.A"], ["Plain", "Plain.A"]);
  const p = openProject(root, [], true);
  assert.deepEqual([p.roots, p.targets, targetsInWords(p)], [["Plain"], ["Plain"], "Plain"]);
});
