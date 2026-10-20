// The extractor's semantics on the fixture, where every answer is known. Needs lake.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { RawGraph } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { versionBase, versions } from "../src/server/versions.ts";
import { History } from "../src/server/history.ts";
import { copyFixture, extractor, fixtureToolchain } from "./fixturecopy.ts";
import { OutsideSources } from "../src/server/outside.ts";
import { findRenames } from "../src/server/renames.ts";

/** the extractor, compiled as the server runs it (test/fixturecopy.ts) */
const EXTRACT = await extractor();

let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}

let dir = "";
let g: RawGraph;
const extractInto = (out: string, cache?: string) =>
  execFileSync("lake", ["env", ...EXTRACT, out, join(dir, ".lake/build/lib/lean"), "Fixture", ...(cache ? ["--cache", cache] : [])], {
    cwd: dir,
    stdio: "ignore",
  });

before(() => {
  if (!haveLake) return;
  dir = copyFixture("vp-extract-");
  execFileSync("lake", ["build"], { cwd: dir, stdio: "ignore" });
  extractInto(join(dir, "graph.json"));
  g = JSON.parse(readFileSync(join(dir, "graph.json"), "utf8"));
});
after(() => dir && rmSync(dir, { recursive: true, force: true }));

const id = (name: string) => {
  const i = g.nodes.findIndex((n) => n.name === name);
  assert.ok(i >= 0, `no node ${name}`);
  return i;
};
const nameOf = (i: number) => (i < g.nodes.length ? g.nodes[i].name : g.externals[i - g.nodes.length].name);
const reach = (from: string, sites: number) => {
  const seen = new Set([id(from)]);
  const stack = [id(from)];
  while (stack.length) {
    const u = stack.pop()!;
    for (const [s, d, m] of g.edges) if (s === u && m & sites && !seen.has(d)) (seen.add(d), stack.push(d));
  }
  return new Set([...seen].filter((i) => i < g.nodes.length).map(nameOf));
};
const tcb = (n: string) => reach(n, SITE_STMT | SITE_BODY);

const opts = { skip: !haveLake };

test("a project reached through a symbolic link is the project: its modules are told apart by their real paths", opts, () => {
  // as a temporary folder is on macOS (/var is /private/var), or a project under a linked folder:
  // Lean's search path and the command line spell the build directory differently
  const links = mkdtempSync(join(tmpdir(), "vp-extract-link-"));
  try {
    const linked = join(links, "project");
    symlinkSync(dir, linked, "dir");
    const out = join(links, "graph.json");
    execFileSync("lake", ["env", ...EXTRACT, out, join(linked, ".lake/build/lib/lean"), "Fixture"], { cwd: linked, stdio: "ignore" });
    const via = JSON.parse(readFileSync(out, "utf8")) as RawGraph;
    assert.deepEqual(via.nodes.map((n) => n.name), g.nodes.map((n) => n.name));
    assert.equal(via.edges.length, g.edges.length);
  } finally {
    rmSync(links, { recursive: true, force: true });
  }
});

test("an outside declaration has its doc and its place in its own source, which the server finds: Lean's core, in the toolchain", opts, () => {
  // the source window shows it (ReviewSpec, "The source window", the owner's decision of 2026-10-20)
  const ranged = g.externals.filter((e) => e.range);
  assert.ok(ranged.length >= g.externals.length * 0.95, `${ranged.length} of ${g.externals.length} outside declarations have a place`);
  const nat = g.externals.find((e) => e.name === "Nat")!;
  assert.match(nat.doc ?? "", /natural numbers/);
  const o = new OutsideSources(dir, fixtureToolchain);
  const unnamed: string[] = [];
  for (const e of ranged) {
    const f = o.find(e.module);
    assert.ok(f, `no file for ${e.module}`);
    assert.equal(f.package.core, true, `${e.module} is Lean's`);
    const lines = readFileSync(f.path, "utf8").split("\n");
    const [from, , to] = e.range!;
    assert.ok(from >= 1 && to >= from && to <= lines.length, `${e.name}: lines ${from}–${to} of ${lines.length}`);
    // its place is its declaration, the name written there (an instance's may have none of its own)
    if (e.kind !== "instance" && !lines.slice(from - 1, to).join("\n").includes(e.name.split(".").pop()!)) unnamed.push(e.name);
  }
  assert.deepEqual(unnamed, [], "places that do not name their declaration");
  const at = nat.range!;
  assert.match(readFileSync(o.find("Init.Prelude")!.path, "utf8").split("\n").slice(at[0] - 1, at[2]).join("\n"), /^inductive Nat where/m);
});

test("generated constants are folded, user declarations kept", opts, () => {
  const names = new Set(g.nodes.map((n) => n.name));
  for (const n of ["Fixture.Point", "Fixture.Point.size", "Fixture.bounded", "Fixture.classify", "Fixture.main_thm", "Fixture.Pair"]) assert.ok(names.has(n), n);
  for (const n of g.nodes) assert.ok(!/match_\d|proof_\d|\.mk$|\.rec$|casesOn|eq_\d/.test(n.name), `generated ${n.name} became a node`);
  assert.equal(g.nodes.find((n) => n.name.startsWith("Fixture.instInhabited"))?.kind, "instance");
});

test("TCB of a theorem: its statement's definitions, not its proof's", opts, () => {
  assert.deepEqual(tcb("Fixture.main_thm"), new Set(["Fixture.main_thm", "Fixture.double", "Fixture.Point.size", "Fixture.Point"]));
});

test("a lemma inside a definition's subtype proof is not trusted", opts, () => {
  const t = tcb("Fixture.leaf");
  assert.ok(t.has("Fixture.bounded") && t.has("Fixture.Point.size"));
  assert.ok(!t.has("Fixture.size_le"));
  const edge = g.edges.find(([s, d]) => s === id("Fixture.bounded") && d === id("Fixture.size_le"));
  assert.equal(edge?.[2], SITE_PROOF);
});

test("proof dependencies are still edges, for the Dependency mode", opts, () => {
  assert.ok(reach("Fixture.main_thm", 7).has("Fixture.helper_eq"));
});

const axiomsOf = (i: number) => g.axiomSets[i < g.nodes.length ? g.nodes[i].ax : g.externals[i - g.nodes.length].ax].map((k) => g.axioms[k]).sort();

test("axioms used only inside proofs are collected, through other proofs too", opts, () => {
  assert.deepEqual(axiomsOf(id("Fixture.size_comm")), ["Fixture.bad"]);
  assert.deepEqual(axiomsOf(id("Fixture.size_succ_pos")), ["sorryAx"]);
  // through the proof of `size_comm`, used in its own proof
  assert.deepEqual(axiomsOf(id("Fixture.size_twice")), ["Fixture.bad"]);
  // through its statement's `succSize`, whose subtype proof is the open `size_succ_pos`
  assert.deepEqual(axiomsOf(id("Fixture.succSize_val")), ["sorryAx"]);
  assert.deepEqual(axiomsOf(id("Fixture.main_thm")), ["Quot.sound", "propext"]);
  // a type, through its constructor's fields
  assert.deepEqual(axiomsOf(id("Fixture.Sized")), ["sorryAx"]);
  // the axiom sets see into proofs; the TCB still does not
  assert.deepEqual(tcb("Fixture.succSize_val"), new Set(["Fixture.succSize_val", "Fixture.succSize", "Fixture.Point.size", "Fixture.Point"]));
});

test("every axiom set is the one #print axioms gives", opts, () => {
  const all = Array.from({ length: g.nodes.length + g.externals.length }, (_, i) => i);
  const asked = all.flatMap((i) => [nameOf(i), ...(i < g.nodes.length ? g.nodes[i].also ?? [] : [])]);
  writeFileSync(join(dir, "PrintAxioms.lean"), "import Fixture\n" + asked.map((n) => `#print axioms ${n}\n`).join(""));
  const out = execFileSync("lake", ["env", "lean", "PrintAxioms.lean"], { cwd: dir, encoding: "utf8" });
  const lean = new Map<string, string[]>();
  for (const [, name, list] of out.matchAll(/^'(.*)' (?:depends on axioms: \[(.*)\]|does not depend on any axioms)$/gm))
    lean.set(name, list ? list.split(", ").sort() : []);
  for (const i of all) {
    const name = nameOf(i);
    // a unit's set is joined over it: the declaration and what Lean generated from its command
    const unit = [name, ...(i < g.nodes.length ? g.nodes[i].also ?? [] : [])];
    const sets = unit.map((n) => lean.get(n));
    assert.ok(sets.every(Boolean), `#print axioms said nothing about ${unit.find((n) => !lean.has(n))}`);
    const want = [...new Set(sets.flat() as string[])].sort();
    const kind = i < g.nodes.length ? g.nodes[i].kind : g.externals[i - g.nodes.length].kind;
    // Lean computes the sets of a module's constants in one pass, and a type it first meets through
    // its own constructor is kept before that constructor is done, without its fields' axioms
    // (Mathlib's `Subgroup`). The extractor follows the fields: for a type it may say more than
    // `#print axioms`, never less.
    if (["inductive", "structure", "class"].includes(kind)) assert.ok(want.every((a) => axiomsOf(i).includes(a)), name);
    else assert.deepEqual(axiomsOf(i), want, name);
  }
});

test("a declaration Lean generated from a command folds into the one the command writes: one unit", opts, () => {
  const names = new Set(g.nodes.map((n) => n.name));
  for (const n of ["Fixture.Pair.Tag", "Fixture.Pair.Tag_ne", "Fixture.Pair.instDecidableEqTag"]) assert.ok(!names.has(n), `${n} is folded`);
  const pair = g.nodes[id("Fixture.Pair")];
  // the generated ones, sorted; not the constructors and recursors, which fold as always
  assert.deepEqual(pair.also, ["Fixture.Pair.Tag", "Fixture.Pair.Tag_ne", "Fixture.Pair.instDecidableEqTag"]);
  assert.equal(g.stats.generated, 3);
  assert.ok(g.nodes.every((n) => n.gen === undefined), "every generated declaration found its unit");
  // a reference to the generated type, by its constructor, is one to the unit
  assert.deepEqual(tcb("Fixture.firstTag"), new Set(["Fixture.firstTag", "Fixture.Pair"]));
  assert.equal(g.edges.find(([s, d]) => s === id("Fixture.firstTag") && d === id("Fixture.Pair"))?.[2], SITE_STMT | SITE_BODY);
  // what the generated lemma refers to is the unit's, at the same sites: `Ne` in its statement,
  // the axiom `bad` in its proof; and its axiom is the unit's, though `Pair` alone has none
  const out = (n: string) => new Map(g.edges.filter(([s]) => s === id(n)).map(([, d, m]) => [nameOf(d), m]));
  assert.ok(((out("Fixture.Pair").get("Ne") ?? 0) & SITE_STMT) !== 0);
  assert.equal(out("Fixture.Pair").get("Fixture.bad"), SITE_PROOF);
  assert.deepEqual(axiomsOf(id("Fixture.Pair")), ["Fixture.bad"]);
});

test("instances of classes whose instances are all equal are left out of a TCB as proofs are; those that carry data stay", opts, () => {
  const inst = g.nodes.find((n) => n.name.startsWith("Fixture.instDecidableEqPoint"))!.name;
  assert.ok(!tcb("Fixture.same").has(inst), "a DecidableEq instance is not trusted");
  assert.equal(g.edges.find(([s, d]) => s === id("Fixture.same") && d === id(inst))?.[2], SITE_PROOF, "but still used");
  assert.ok(tcb("Fixture.origin").has("Fixture.instInhabitedPoint"), "Inhabited carries its default value");
});

test("a unit's hash covers what its command generated: a change there makes it a new version", opts, () => {
  // the same text where Pair is written; the macro now generates another lemma
  const other = mkdtempSync(join(tmpdir(), "vp-extract-hash-"));
  try {
    cpSync(dir, other, { recursive: true });
    const f = join(other, "Fixture/Tagged.lean");
    writeFileSync(f, readFileSync(f, "utf8").replace("theorem $lemma : $left ≠ $right", "theorem $lemma : $right ≠ $left"));
    execFileSync("lake", ["build"], { cwd: other, stdio: "ignore" });
    execFileSync("lake", ["env", ...EXTRACT, join(other, "g.json"), join(other, ".lake/build/lib/lean"), "Fixture"], { cwd: other, stdio: "ignore" });
    const h = JSON.parse(readFileSync(join(other, "g.json"), "utf8")) as RawGraph;
    const hashOf = (x: RawGraph, n: string) => x.nodes.find((v) => v.name === n)?.hash;
    assert.notEqual(hashOf(h, "Fixture.Pair"), hashOf(g, "Fixture.Pair"));
    assert.equal(hashOf(h, "Fixture.firstTag"), hashOf(g, "Fixture.firstTag"), "what only uses it keeps its version");
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test("a version is the same across a pure rename, of the declaration or of what it refers to; a real edit makes a new one", opts, () => {
  const extractCopy = (edit: (text: string) => string) => {
    const other = mkdtempSync(join(tmpdir(), "vp-extract-rename-"));
    try {
      cpSync(dir, other, { recursive: true });
      for (const f of ["Basic", "Use", "Leaf", "Axioms", "Tagged"]) {
        const p = join(other, `Fixture/${f}.lean`);
        writeFileSync(p, edit(readFileSync(p, "utf8")));
      }
      execFileSync("lake", ["build"], { cwd: other, stdio: "ignore" });
      execFileSync("lake", ["env", ...EXTRACT, join(other, "g.json"), join(other, ".lake/build/lib/lean"), "Fixture"], { cwd: other, stdio: "ignore" });
      return JSON.parse(readFileSync(join(other, "g.json"), "utf8")) as RawGraph;
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  };
  // `Point` is `Pt` everywhere: the structure, its function, its instances, what uses them
  const renamed = extractCopy((t) => t.replace(/\bPoint\b/g, "Pt"));
  const was: Record<string, string> = { "Fixture.Pt": "Fixture.Point", "Fixture.Pt.size": "Fixture.Point.size", "Fixture.instInhabitedPt": "Fixture.instInhabitedPoint", "Fixture.instDecidableEqPt": "Fixture.instDecidableEqPoint" };
  const identity = (u: string) => was[u] ?? u;
  const before = versions(versionBase(g));
  const after = versions(versionBase(renamed), identity);
  const at = (x: RawGraph, n: string) => x.nodes.findIndex((v) => v.name === n);
  let kernelChanged = 0;
  for (const [i, v] of renamed.nodes.entries()) {
    const j = at(g, was[v.name] ?? v.name);
    assert.ok(j >= 0, `${v.name} has no counterpart`);
    assert.equal(after[i], before[j], `${v.name}: a pure rename keeps the version`);
    if (v.hash !== g.nodes[j].hash) kernelChanged++;
  }
  // the kernel's hash names what it refers to: under it, all of these would have gone stale
  assert.ok(kernelChanged >= 10, `only ${kernelChanged} kernel hashes changed`);
  // the renames are found: kept as two builds of the history, paired at high confidence, nothing
  // else taken for one
  const hdir = mkdtempSync(join(tmpdir(), "vp-extract-history-"));
  try {
    const h = new History(hdir);
    const opts = (at: number) => ({ at, fingerprint: `f${at}`, commit: null, toolchain: "tc", missing: [] });
    h.record(g, opts(1000));
    const r = h.record(renamed, opts(2000));
    const pairs = findRenames(r.before!, h.graph(r.info.id)!, (u) => u);
    assert.deepEqual(pairs.map((p) => [p.from, p.to, p.confidence]).sort(), Object.entries(was).map(([to, from]) => [from, to, "high"]).sort());
  } finally {
    rmSync(hdir, { recursive: true, force: true });
  }
  // not mapped through the rename, what refers to it is a new version, as before
  const unmapped = versions(versionBase(renamed));
  assert.notEqual(unmapped[at(renamed, "Fixture.size_le")], before[at(g, "Fixture.size_le")]);
  // a real edit: a new version of what changed, and of nothing that only uses it
  const edited = extractCopy((t) => t.replace("⟨2 * p.x, 2 * p.y⟩", "⟨p.x * 2, p.y * 2⟩"));
  const e = versions(versionBase(edited));
  assert.notEqual(e[at(edited, "Fixture.double")], before[at(g, "Fixture.double")]);
  assert.equal(e[at(edited, "Fixture.main_thm")], before[at(g, "Fixture.main_thm")]);
});

test("every unit has a name of its own: a declaration two files write, local notation, private names", opts, () => {
  // Fixture/Twice/A.lean and B.lean do not import each other; each writes the same theorem, a
  // `local notation "Ψ"` and a private `helper`
  execFileSync("lake", ["build", "Fixture.Twice"], { cwd: dir, stdio: "ignore" });
  const err = spawnSync("lake", ["env", ...EXTRACT, join(dir, "twice.json"), join(dir, ".lake/build/lib/lean"), "Fixture.Twice"], { cwd: dir, encoding: "utf8" }).stderr;
  const t = JSON.parse(readFileSync(join(dir, "twice.json"), "utf8")) as RawGraph;
  const names = t.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length, `names shared: ${names.join(", ")}`);
  // the theorem once, where the environment has it, and the other place said
  assert.equal(names.filter((n) => n === "Fixture.Twice.same_thm").length, 1);
  assert.match(err, /Fixture\.Twice\.same_thm is declared in Fixture\.Twice\.B and in Fixture\.Twice\.A/);
  // local notation is qualified with its module's last part; its Lean constant stays
  const psi = t.nodes.filter((n) => n.kind === "notation");
  assert.deepEqual(psi.map((n) => n.name).sort(), ["Fixture.Twice.termΨ.A", "Fixture.Twice.termΨ.B"]);
  assert.ok(psi.every((n) => n.leanName === "Fixture.Twice.termΨ" && / · in [AB]$/.test(n.display ?? "")));
  // two private declarations of one name: the guard numbers the second and says so
  assert.deepEqual(names.filter((n) => n.startsWith("Fixture.Twice.helper")).sort(), ["Fixture.Twice.helper", "Fixture.Twice.helper_2"]);
  assert.match(err, /Fixture\.Twice\.helper names a unit of Fixture\.Twice\.A and one of Fixture\.Twice\.B; the second is called Fixture\.Twice\.helper_2/);
  // every edge between them lands on its own unit
  const uses = (from: string) => t.edges.filter(([s]) => s === names.indexOf(from)).map(([, d]) => (d < names.length ? names[d] : ""));
  assert.ok(uses("Fixture.Twice.usesA").includes("Fixture.Twice.helper") && uses("Fixture.Twice.usesB").includes("Fixture.Twice.helper_2"));
});

test("a cached re-extraction gives the same graph", opts, () => {
  const cache = join(dir, "cache");
  extractInto(join(dir, "a.json"), cache);
  extractInto(join(dir, "b.json"), cache);
  const strip = (f: string) => {
    const x = JSON.parse(readFileSync(join(dir, f), "utf8"));
    delete x.stats;
    return x;
  };
  assert.deepEqual(strip("a.json"), strip("b.json"));
  assert.deepEqual({ ...strip("a.json") }, { ...strip("graph.json") });
});
