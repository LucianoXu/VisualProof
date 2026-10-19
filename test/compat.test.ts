// The extractor on the whole fixture, whatever toolchain builds it (test/fixturecopy.ts), against a
// golden taken with the fixture's own toolchain (test/golden/fixture-graph.json). What is the
// project's must come out the same on every Lean version the tool supports: its units, the edges
// between them, their axioms and their TCBs. What Lean's library and its generated code put in may
// differ: the constants it folds into a unit, the references a unit's versions are made of, the
// edges out of the project, the constants outside it, the counts. But only as test/golden/known-differences.json says, with the
// toolchains each difference holds for and why. `npm run golden:update` takes the golden again,
// on purpose and with the fixture's own toolchain. Needs lake.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import type { RawGraph } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_STMT } from "../src/shared/graph.ts";
import { EXTRACTOR } from "../src/server/extract.ts";
import { FIXTURE_TOOLCHAIN, copyFixture, extractor, fixtureToolchain } from "./fixturecopy.ts";

/** the extractor, compiled as the server runs it (test/fixturecopy.ts) */
const EXTRACT = await extractor();

let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}
const opts = { skip: !haveLake };

/** every library of the fixture: the root, the notation and the kinds it does not import, and the
 *  module system's */
const ROOTS = ["Fixture", "Fixture.Notation", "Fixture.Kinds", "FixtureModule"];
const GOLDEN = join(import.meta.dirname, "golden", "fixture-graph.json");
const KNOWN = join(import.meta.dirname, "golden", "known-differences.json");
const UPDATE = process.env.VP_GOLDEN_UPDATE === "1";

/** The extraction in names instead of indices, in two parts: `strict`, what is the project's;
 *  `lenient`, what Lean's library and its generated code decide (the constants folded into a unit,
 *  its references, the edges out of the project, the constants outside it, the counts). Keys
 *  sorted, so that the golden reads as a diff. */
interface Normal {
  strict: Record<string, unknown>;
  lenient: Record<string, unknown>;
}

function normalize(g: RawGraph): Normal {
  const n = g.nodes.length;
  const nameOf = (i: number) => (i < n ? g.nodes[i].name : `ext:${g.externals[i - n].name}`);
  const axioms = (ax: number) => (g.axiomSets[ax] ?? []).map((a) => g.axioms[a]).sort();
  const strict: Record<string, unknown> = {};
  const lenient: Record<string, unknown> = {};
  const out = new Map<number, [number, number][]>();
  for (const [s, d, m] of g.edges) {
    (d < n ? strict : lenient)[`edge ${nameOf(s)} -> ${nameOf(d)}`] = m;
    if (!out.has(s)) out.set(s, []);
    out.get(s)!.push([d, m]);
  }
  g.nodes.forEach((node, i) => {
    // the hash and the shape are versions of the unit: they follow what Lean compiled it to. What
    // a unit folds in is the unit's, but which constants Lean generates for it is Lean's: `deriving
    // Inhabited` wrote a `default` beside the instance before v4.31
    const { name, hash: _hash, shape: _shape, refs, ax, also, ...rest } = node;
    strict[`node ${name}`] = { ...rest, axioms: axioms(ax) };
    if (also) lenient[`also ${name}`] = [...also].sort();
    // the TCB as the page computes it (shared/viewgraph.ts): the statement's and the bodies' edges
    const seen = new Set([i]);
    const stack = [i];
    while (stack.length) {
      const u = stack.pop()!;
      for (const [d, m] of out.get(u) ?? []) if (d < n && m & (SITE_STMT | SITE_BODY) && !seen.has(d)) (seen.add(d), stack.push(d));
    }
    strict[`tcb ${name}`] = [...seen].map(nameOf).sort();
    if (refs) lenient[`refs ${name}`] = refs.map((r) => g.refNames?.[r] ?? `#${r}`);
  });
  for (const x of g.externals) lenient[`ext ${x.name}`] = { kind: x.kind, module: x.module, axioms: axioms(x.ax) };
  strict.roots = g.roots;
  strict.modules = [...g.modules].map((m) => ({ name: m.name, imports: [...m.imports].sort() })).sort((a, b) => a.name.localeCompare(b.name));
  for (const [k, v] of Object.entries(g.stats)) if (k !== "ms") lenient[`stats.${k}`] = v;
  const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { strict: sorted(strict), lenient: sorted(lenient) };
}

/** The keys whose values differ, either way. */
function differing(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

/** One line per difference, the golden's value first. */
function told(keys: string[], golden: Record<string, unknown>, now: Record<string, unknown>): string {
  const show = (v: unknown) => (v === undefined ? "(none)" : JSON.stringify(v).slice(0, 240));
  return keys.map((k) => `  ${k}\n    golden: ${show(golden[k])}\n    now:    ${show(now[k])}`).join("\n");
}

/** test/golden/known-differences.json: lenient differences allowed for a range of toolchains */
interface Known {
  /** the first toolchain it holds for and the last, both included; no `to`, every later one */
  from: string;
  to?: string;
  /** keys as `normalize` writes them; `*` stands for any characters */
  keys: string[];
  why: string;
}

const versionOf = (tc: string) => (/v?(\d+)\.(\d+)\.(\d+)/.exec(tc) ?? []).slice(1, 4).map(Number);
const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const holds = (k: Known, tc: string) => cmp(versionOf(tc), versionOf(k.from)) >= 0 && (!k.to || cmp(versionOf(tc), versionOf(k.to)) <= 0);
const pattern = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

let dir = "";
let g: RawGraph;
let now: Normal;

before(() => {
  if (!haveLake) return;
  dir = copyFixture("vp-compat-");
  execFileSync("lake", ["build", ...ROOTS], { cwd: dir, stdio: "ignore" });
  const out = join(dir, "graph.json");
  execFileSync("lake", ["env", ...EXTRACT, out, join(dir, ".lake/build/lib/lean"), ...ROOTS], { cwd: dir, stdio: "ignore" });
  g = JSON.parse(readFileSync(out, "utf8"));
  now = normalize(g);
});
after(() => dir && rmSync(dir, { recursive: true, force: true }));

test("the project's part of the extraction is the golden's, on every toolchain", opts, (t) => {
  if (UPDATE) {
    assert.equal(fixtureToolchain(), FIXTURE_TOOLCHAIN, "the golden is taken with the fixture's own toolchain");
    mkdirSync(dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, JSON.stringify({ toolchain: FIXTURE_TOOLCHAIN, roots: ROOTS, ...now }, null, 1) + "\n");
    t.diagnostic(`wrote ${GOLDEN}`);
    return;
  }
  const golden: Normal & { toolchain: string } = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const diff = differing(golden.strict, now.strict);
  assert.equal(diff.length, 0, `${fixtureToolchain()} changes the project's part of the extraction (golden: ${golden.toolchain}):\n${told(diff, golden.strict, now.strict)}`);
});

test("what Lean puts in differs from the golden only as known-differences.json says", opts, (t) => {
  if (UPDATE) return;
  const golden: Normal & { toolchain: string } = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const known: Known[] = JSON.parse(readFileSync(KNOWN, "utf8")).differences;
  const tc = fixtureToolchain();
  const here = known.filter((k) => holds(k, tc));
  const allowed = here.flatMap((k) => k.keys.map(pattern));
  const diff = differing(golden.lenient, now.lenient);
  const unknown = diff.filter((k) => !allowed.some((p) => p.test(k)));
  assert.equal(unknown.length, 0, `${tc} differs from the golden (${golden.toolchain}) where known-differences.json allows nothing; list each with why, or fix the extractor:\n${told(unknown, golden.lenient, now.lenient)}`);
  for (const k of here) if (!k.keys.some((p) => diff.some((d) => pattern(p).test(d)))) t.diagnostic(`known difference no longer seen on ${tc}: ${k.why}`);
  if (diff.length) t.diagnostic(`${diff.length} known differences on ${tc}`);
});

test("the extractor interpreted, as the server runs it where it cannot compile it, reads what compiled it reads", opts, () => {
  if (UPDATE) return;
  const out = join(dir, "interpreted.json");
  execFileSync("lake", ["env", "lean", "--run", EXTRACTOR, out, join(dir, ".lake/build/lib/lean"), ...ROOTS], { cwd: dir, stdio: "ignore" });
  assert.deepEqual(normalize(JSON.parse(readFileSync(out, "utf8"))), now);
});

// --------------------------------------------------- what the golden holds, said in so many words

const node = (name: string) => {
  const found = g.nodes.find((x) => x.name === name);
  assert.ok(found, `no node ${name}`);
  return found;
};
const tcbOf = (name: string) => now.strict[`tcb ${name}`] as string[];
const axiomsOf = (name: string) => (now.strict[`node ${name}`] as { axioms: string[] }).axioms;

test("the module system: a body is followed into the TCB whether its module exports it or not", opts, () => {
  // `viaHelper` is public, its body is not exported, and `helper` is private to its module: the
  // extractor reads every level of the .olean files, so the theorem in another module reaches both
  assert.deepEqual(tcbOf("FixtureModule.use_viaHelper"), ["FixtureModule.helper", "FixtureModule.use_viaHelper", "FixtureModule.viaHelper"]);
  assert.deepEqual(node("FixtureModule.helper").flags, ["private"]);
  assert.equal(node("FixtureModule.inSection").kind, "def");
  assert.deepEqual(tcbOf("FixtureModule.inSection"), ["FixtureModule.inSection", "FixtureModule.triple"]);
  assert.deepEqual(axiomsOf("FixtureModule.use_viaHelper"), ["Quot.sound", "propext"]);
});

test("kinds: opaque, private, protected, abbreviations, classes and structures that extend", opts, () => {
  assert.equal(node("Fixture.Kinds.secret").kind, "opaque");
  // a partial function is compiled to an opaque constant
  assert.equal(node("Fixture.Kinds.collatz").kind, "opaque");
  assert.deepEqual(node("Fixture.Kinds.hidden").flags, ["private"]);
  assert.deepEqual(tcbOf("Fixture.Kinds.visible"), ["Fixture.Kinds.hidden", "Fixture.Kinds.visible"]);
  assert.equal(node("Fixture.Kinds.Num.zero").kind, "def");
  assert.equal(node("Fixture.Kinds.Num").kind, "abbrev");
  assert.equal(node("Fixture.Kinds.HasBound").kind, "class");
  assert.deepEqual(tcbOf("Fixture.Kinds.point3_size"), ["Fixture.Kinds.Point3", "Fixture.Kinds.point3_size", "Fixture.Point", "Fixture.Point.size"]);
  assert.deepEqual(node("Fixture.Kinds.chosen").flags, ["noncomputable"]);
  assert.deepEqual(axiomsOf("Fixture.Kinds.chosen"), ["Classical.choice"]);
});

test("what Lean generates is folded: recursion, `where`, derived instances; an anonymous instance has Lean's name", opts, () => {
  // well-founded recursion (`_unary`, `induct`, equation lemmas), structural recursion (`below`,
  // `brecOn`, `_f`) and matchers are no units of their own
  const generated = g.nodes.map((x) => x.name).filter((x) => /_unary|\.induct|\.eq_\d|\.eq_def|match_\d|brecOn|\.below|\._f$/.test(x));
  assert.deepEqual(generated, []);
  // a `where` helper is a declaration of its own, in its owner's TCB
  assert.deepEqual(tcbOf("Fixture.Kinds.sumTo"), ["Fixture.Kinds.sumTo", "Fixture.Kinds.sumTo.go"]);
  for (const x of ["Fixture.Kinds.isEven", "Fixture.Kinds.isOdd", "Fixture.Kinds.log2", "Fixture.Kinds.Vec.length"]) assert.equal(node(x).kind, "def", x);
  // the instances `deriving` writes belong to the type
  const also = node("Fixture.Kinds.Color").also ?? [];
  for (const i of ["instBEqColor", "instDecidableEqColor", "instHashableColor", "instInhabitedColor", "instReprColor"]) {
    assert.ok(also.includes(`Fixture.Kinds.${i}`), i);
    assert.ok(!g.nodes.some((x) => x.name === `Fixture.Kinds.${i}`), `${i} is a unit of its own`);
  }
  assert.equal(node("Fixture.Kinds.instHasSizeColor").kind, "instance");
  assert.equal(node("Fixture.Kinds.instHasSizeNat").kind, "instance");
});

test("a definition in a mutual block rests on the whole block, however Lean compiles it", opts, () => {
  // structural recursion goes through each member's `_f` (inlined before v4.29), well-founded
  // recursion through one shared `_mutual`, a `partial def`'s code through the other's
  // `_unsafe_rec`: none names the other member
  for (const [a, b] of [["isEven", "isOdd"], ["evenW", "oddW"], ["ping", "pong"]]) {
    assert.ok(tcbOf(`Fixture.Kinds.${a}`).includes(`Fixture.Kinds.${b}`), `${b} in the TCB of ${a}`);
    assert.ok(tcbOf(`Fixture.Kinds.${b}`).includes(`Fixture.Kinds.${a}`), `${a} in the TCB of ${b}`);
  }
});
