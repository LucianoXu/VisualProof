// Where a declaration outside the project is written (server/outside.ts; ReviewSpec, "The source
// window", the owner's decision of 2026-10-20): the package of the lake-manifest whose build holds
// its module's `.olean`, under the source folder its lakefile gives (the library's `srcDir` under the
// package's), resolved inside the package's folder; Lean's core in the toolchain's `src/lean/`. Only
// a module the graph names reaches it, and no name makes a path out of a package. A tree of files
// stands for a project here: nothing of it is Lean.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { modulePath, OutsideSources, outsideSource, toolchainTag, whereOf } from "../src/server/outside.ts";
import { outsideLink, packageWords } from "../src/shared/outside.ts";

const tmp = mkdtempSync(join(tmpdir(), "vp-outside-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

function put(file: string, text = ""): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** A project with three packages — `mathlib` on GitHub (its sources at its root), `deep`, whose
 *  library's sources are in `src/lib` and whose repository holds it in a folder of its own, and a
 *  path dependency — and a toolchain of its own, whose core has `Init.Core` and Lake's `Lake.Load`. */
function project(name: string): { root: string; sys: string } {
  const root = join(tmp, name);
  const sys = join(tmp, `${name}-toolchain`);
  const pk = join(root, ".lake", "packages");
  put(
    join(root, "lake-manifest.json"),
    JSON.stringify({
      version: "1.1.0",
      packagesDir: ".lake/packages",
      packages: [
        { url: "https://github.com/leanprover-community/mathlib4.git", type: "git", subDir: null, rev: "089be84e24e41b7a26860084d1747195cf9299f3", name: "mathlib", configFile: "lakefile.lean" },
        { url: "https://gitlab.example.org/a/deep", type: "git", subDir: null, rev: "1111111111111111111111111111111111111111", name: "deep", configFile: "lakefile.toml" },
        { url: "git@github.com:acme/mono.git", type: "git", subDir: "lean/sub", rev: "2222222222222222222222222222222222222222", name: "sub", configFile: "lakefile.toml" },
        { type: "path", dir: "./vendor/local", name: "local", configFile: "lakefile.toml" },
      ],
    }),
  );
  put(join(pk, "mathlib", "lakefile.lean"), `import Lake\nopen Lake DSL\n\npackage mathlib where\n  leanOptions := #[]\n\n@[default_target]\nlean_lib Mathlib where\n\nlean_exe cache where\n  root := \`Cache.Main\n  srcDir := "scripts"\n`);
  put(join(pk, "mathlib", "Mathlib", "Logic", "Basic.lean"), "theorem Mathlib.x : True := trivial\n");
  put(join(pk, "mathlib", ".lake", "build", "lib", "lean", "Mathlib", "Logic", "Basic.olean"));
  // a library whose sources are in src/lib, a package whose own srcDir is src
  put(join(pk, "deep", "lakefile.toml"), `name = "deep"\nsrcDir = "src"\n\n[[lean_lib]]\nname = "Deep"\nsrcDir = "lib"\n\n[[lean_lib]]\nname = "Other"\n`);
  put(join(pk, "deep", "src", "lib", "Deep", "A.lean"), "def Deep.a := 1\n");
  // the same module name under the package's own folder: the library's folder wins
  put(join(pk, "deep", "src", "Deep", "A.lean"), "def wrong := 1\n");
  put(join(pk, "deep", "src", "Other", "B.lean"), "def Other.b := 1\n");
  put(join(pk, "deep", ".lake", "build", "lib", "lean", "Deep", "A.olean"));
  put(join(pk, "deep", ".lake", "build", "lib", "lean", "Other", "B.olean"));
  // a package in a folder of its repository, built in a folder of its own
  put(join(pk, "sub", "lean", "sub", "lakefile.toml"), `name = "sub"\nbuildDir = "out"\n\n[[lean_lib]]\nname = "Sub"\n`);
  put(join(pk, "sub", "lean", "sub", "Sub", "C.lean"), "def Sub.c := 1\n");
  put(join(pk, "sub", "lean", "sub", "out", "lib", "lean", "Sub", "C.olean"));
  // a path dependency
  put(join(root, "vendor", "local", "lakefile.toml"), `name = "local"\n\n[[lean_lib]]\nname = "Local"\n`);
  put(join(root, "vendor", "local", "Local.lean"), "def Local.d := 1\n");
  put(join(root, "vendor", "local", ".lake", "build", "lib", "lean", "Local.olean"));
  // the toolchain
  put(join(sys, "lib", "lean", "Init", "Core.olean"));
  put(join(sys, "src", "lean", "Init", "Core.lean"), "prelude\ndef Init.c := 1\n");
  put(join(sys, "lib", "lean", "Lake", "Load.olean"));
  put(join(sys, "src", "lean", "lake", "Lake", "Load.lean"), "def Lake.load := 1\n");
  return { root, sys };
}

test("a module's file: in the package whose build holds its .olean, under its library's source folder, as Lake lays it out", () => {
  const { root, sys } = project("layout");
  const o = new OutsideSources(root, () => "leanprover/lean4:v4.35.0", () => sys);
  const m = o.find("Mathlib.Logic.Basic")!;
  assert.equal(m.file, "Mathlib/Logic/Basic.lean");
  assert.deepEqual(m.package, { name: "mathlib", core: false, rev: "089be84e24e41b7a26860084d1747195cf9299f3" });
  assert.deepEqual(m.github, { repo: "leanprover-community/mathlib4", rev: "089be84e24e41b7a26860084d1747195cf9299f3", path: "Mathlib/Logic/Basic.lean" });
  const deep = o.find("Deep.A")!;
  assert.equal(deep.file, "src/lib/Deep/A.lean", "the library's srcDir, under the package's");
  assert.equal(deep.github, null, "not on GitHub: no link");
  assert.equal(o.find("Other.B")!.file, "src/Other/B.lean", "a library without a srcDir of its own: the package's");
  const sub = o.find("Sub.C")!;
  assert.equal(sub.file, "Sub/C.lean", "built in its own buildDir");
  assert.deepEqual(sub.github, { repo: "acme/mono", rev: "2222222222222222222222222222222222222222", path: "lean/sub/Sub/C.lean" }, "the folder of its repository it is in, then its file");
  const loc = o.find("Local")!;
  assert.equal(loc.file, "Local.lean");
  assert.deepEqual(loc.package, { name: "local", core: false, rev: null });
  assert.equal(loc.github, null);
  // Lean's core, from the toolchain, at its release in leanprover/lean4, whose src/ it is
  const core = o.find("Init.Core")!;
  assert.deepEqual(core.package, { name: "Lean", core: true, rev: "v4.35.0" });
  assert.equal(core.file, "Init/Core.lean");
  assert.deepEqual(core.github, { repo: "leanprover/lean4", rev: "v4.35.0", path: "src/Init/Core.lean" });
  assert.equal(o.find("Lake.Load")!.github!.path, "src/lake/Lake/Load.lean", "Lake's own sources");
  assert.deepEqual(o.revisions(), { mathlib: "089be84e24e41b7a26860084d1747195cf9299f3", deep: "1111111111111111111111111111111111111111", sub: "2222222222222222222222222222222222222222" });
});

test("nothing outside a package's folder is read: no .olean, no file, a symbolic link out of it, a name that is not a module's", () => {
  const { root, sys } = project("closed");
  const pk = join(root, ".lake", "packages");
  const secret = join(tmp, "secret.lean");
  put(secret, "the key\n");
  // a module built, whose file is a link out of the package
  put(join(pk, "mathlib", ".lake", "build", "lib", "lean", "Mathlib", "Leak.olean"));
  symlinkSync(secret, join(pk, "mathlib", "Mathlib", "Leak.lean"));
  // a source with no .olean: not a module Lean has
  put(join(pk, "mathlib", "Mathlib", "Unbuilt.lean"));
  const o = new OutsideSources(root, () => "leanprover/lean4:v4.35.0", () => sys);
  assert.equal(o.find("Mathlib.Leak"), null, "a link out of the package");
  assert.equal(o.find("Mathlib.Unbuilt"), null, "no .olean");
  assert.equal(o.find("Mathlib.Nothing"), null);
  for (const bad of ["..", "Mathlib...Logic", "Mathlib.«..».x", "Mathlib.«a/b»", "", "Mathlib.«x\u0000»"]) {
    assert.equal(modulePath(bad), null, bad);
    assert.equal(o.find(bad), null, bad);
  }
  assert.deepEqual(modulePath("Mathlib.«Foo-Bar».Baz"), ["Mathlib", "Foo-Bar", "Baz"], "a part in guillemets is its file's name");
  // a link inside the package is the package's
  symlinkSync(join(pk, "mathlib", "Mathlib", "Logic", "Basic.lean"), join(pk, "mathlib", "Mathlib", "Alias.lean"));
  put(join(pk, "mathlib", ".lake", "build", "lib", "lean", "Mathlib", "Alias.olean"));
  assert.equal(new OutsideSources(root, () => "leanprover/lean4:v4.35.0", () => sys).find("Mathlib.Alias")!.file, "Mathlib/Logic/Basic.lean");
});

test("a toolchain whose folder is not found has no core; one that is no release has no link", () => {
  const { root, sys } = project("toolchains");
  assert.equal(new OutsideSources(root, () => "leanprover/lean4:v4.35.0", () => null).find("Init.Core"), null);
  const nightly = new OutsideSources(root, () => "leanprover/lean4-nightly:nightly-2026-10-01", () => sys).find("Init.Core")!;
  assert.equal(nightly.package.rev, null);
  assert.equal(nightly.github, null);
  assert.equal(toolchainTag("leanprover/lean4:v4.34.0-rc2"), "v4.34.0-rc2");
  assert.equal(toolchainTag("v4.28.0"), "v4.28.0");
  assert.equal(toolchainTag("leanprover/lean4-pr-releases:pr-release-1234"), null);
});

test("the manifest and the toolchain are read again when they change: a branch followed builds a new commit", () => {
  const { root, sys } = project("again");
  let tc = "leanprover/lean4:v4.35.0";
  const o = new OutsideSources(root, () => tc, () => sys);
  assert.equal(o.find("Mathlib.Logic.Basic")!.package.rev, "089be84e24e41b7a26860084d1747195cf9299f3");
  const file = join(root, "lake-manifest.json");
  put(file, JSON.stringify({ packagesDir: ".lake/packages", packages: [{ url: "https://github.com/leanprover-community/mathlib4", type: "git", rev: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "mathlib", configFile: "lakefile.lean" }] }));
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(o.find("Mathlib.Logic.Basic")!.package.rev, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(o.find("Deep.A"), null, "a package no longer listed");
  tc = "leanprover/lean4:v4.36.0";
  assert.equal(o.find("Init.Core")!.package.rev, "v4.36.0");
});

test("what the page and the agents are told: the file, its text and hash, the package, its revision and the link at it", () => {
  const { root, sys } = project("told");
  const o = new OutsideSources(root, () => "leanprover/lean4:v4.35.0", () => sys);
  const f = o.find("Mathlib.Logic.Basic")!;
  const s = outsideSource(f)!;
  assert.equal(s.file, "Mathlib/Logic/Basic.lean");
  assert.equal(s.text, "theorem Mathlib.x : True := trivial\n");
  assert.match(s.hash, /^[0-9a-f]+$/);
  assert.deepEqual(s.outside, { package: "mathlib", core: false, rev: "089be84e24e41b7a26860084d1747195cf9299f3", github: f.github });
  assert.equal(whereOf(f, true).changed, true);
  assert.equal(packageWords(s.outside), "mathlib at 089be84");
  assert.equal(packageWords(whereOf(o.find("Init.Core")!)), "Lean v4.35.0");
  assert.equal(outsideLink(s.outside, 3, 5), "https://github.com/leanprover-community/mathlib4/blob/089be84e24e41b7a26860084d1747195cf9299f3/Mathlib/Logic/Basic.lean#L3-L5");
  assert.equal(outsideLink(whereOf(o.find("Init.Core")!), 2, 2), "https://github.com/leanprover/lean4/blob/v4.35.0/src/Init/Core.lean#L2");
  assert.equal(outsideLink(whereOf(o.find("Deep.A")!), 1, 1), null);
});
