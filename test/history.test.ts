// The history (HistorySpec.md, server/history.ts): a snapshot of the graph at every build, its
// modules kept by their content's hash so that one that did not change is stored once; the
// extractions a cache held before, imported as the first snapshots; what changed between two.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RawGraph, RawNode } from "../src/shared/graph.ts";
import { diffGraphs, History, pageGraph, snapVersion, uniqueNames } from "../src/server/history.ts";
import type { Project } from "../src/server/project.ts";
import { ownName } from "../src/server/versions.ts";

const T0 = Date.parse("2026-10-09T10:00:00Z");

/** A graph of modules `A` (a structure and a function on it) and `B` (a theorem about it), and one
 *  declaration from outside; `edit` changes what it says of each unit. */
function graph(o: { f?: string; extraB?: boolean; renameF?: string } = {}): RawGraph {
  const f = o.renameF ?? "A.f";
  const node = (name: string, module: string, shape: string, refs: number[], hash = `k-${name}-${shape}`): RawNode => ({ name, kind: "def", module, type: `${name} : Nat`, ax: 0, hash, shape, refs });
  const nodes = [node("A.S", "A", "sS", [0]), node(f, "A", o.f ?? "sf", [0, 1]), node("B.t", "B", "st", [2, 3])];
  if (o.extraB) nodes.push(node("B.u", "B", "su", [0]));
  return {
    schema: 1,
    roots: ["B"],
    modules: [{ name: "A", imports: [] }, { name: "B", imports: ["A"] }],
    nodes,
    externals: [{ name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 1 }],
    edges: [[1, 0, 1], [1, nodes.length, 1], [2, 1, 1], [2, 0, 4]],
    axioms: ["propext"],
    axiomSets: [[], [0]],
    stats: { folded: 0, metaDropped: 0, ms: 0 },
    refNames: ["Nat", "A.S", "A.S mk", f],
  };
}

const commit = { hash: "abc1234", branch: "main" };
const opts = (at: number, fingerprint: string) => ({ at, fingerprint, commit, toolchain: "tc", missing: [] as string[] });

test("a snapshot per build, each module kept by its content: one that did not change is stored once", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-history-"));
  try {
    const h = new History(dir);
    const files = () => readdirSync(join(dir, "history", "modules")).length;
    const a = h.record(graph(), opts(T0, "f1"));
    assert.ok(a.fresh && a.written);
    assert.equal(a.before, null, "nothing before the first");
    assert.equal(files(), 3, "two modules and the outside declarations");
    // the next build changes module B alone: one file more, and only it is written
    const b = h.record(graph({ extraB: true }), opts(T0 + 60_000, "f2"));
    assert.ok(b.fresh);
    assert.equal(files(), 4);
    assert.ok(b.info.bytes.new > 0 && b.info.bytes.new < b.info.bytes.all, `${JSON.stringify(b.info.bytes)}`);
    assert.equal(b.before?.info.id, a.info.id, "it follows the build before");
    // the same build read again (the usage pass's graph, a newer extractor) replaces its manifest
    const c = h.record(graph({ extraB: true, f: "sf2" }), opts(T0 + 60_000, "f3"));
    assert.equal(c.info.id, b.info.id);
    assert.ok(!c.fresh && c.written);
    assert.equal(c.before?.info.fingerprint, "f2", "found against what that build was read as before");
    // the same extraction again, or a read of the build with fewer modules, changes nothing
    assert.equal(h.record(graph({ extraB: true, f: "sf2" }), opts(T0 + 60_000, "f3")).written, false);
    const partial = graph();
    partial.modules = partial.modules.slice(0, 1);
    assert.equal(h.record(partial, opts(T0 + 60_000, "f4")).written, false);
    assert.deepEqual(h.list().map((s) => [s.id, s.fingerprint, s.counts.nodes]), [[1, "f1", 3], [2, "f3", 4]]);
    // kept for good, and read back as the graph it was
    const again = new History(dir);
    assert.deepEqual(again.list().map((s) => s.id), [1, 2]);
    const g = again.graph(1)!;
    assert.deepEqual(g.nodes.map((v) => v.name), ["A.S", "A.f", "B.t", "Nat"]);
    const name = (i: number) => g.nodes[i].name;
    assert.deepEqual(g.edges.map(([s, d, m]) => [name(s), name(d), m]).sort(), [["A.f", "A.S", 1], ["A.f", "Nat", 1], ["B.t", "A.S", 4], ["B.t", "A.f", 1]]);
    assert.deepEqual(g.nodes[1].refs, ["Nat", "A.S"]);
    assert.deepEqual(g.nodes[3].ax, ["propext"]);
    // as a page reads it: versions, the kernel's hashes beside them, axioms by set
    const p = pageGraph(g, ownName);
    assert.equal((p.nodes[1] as { hash?: string }).hash, snapVersion(g.nodes[1]));
    assert.equal((p.nodes[1] as { kernel?: string }).kernel, "k-A.f-sf");
    assert.deepEqual(p.axiomSets[p.nodes[3].ax], [0]);
    assert.equal(p.edges.length, 12);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("what changed between two snapshots: added, removed, changed, renamed; what could not be read is not gone", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-history-"));
  try {
    const h = new History(dir);
    h.record(graph(), opts(T0, "f1"));
    h.record(graph({ renameF: "A.g", extraB: true }), opts(T0 + 1, "f2"));
    const d = diffGraphs(h.graph(1)!, h.graph(2)!, ownName);
    assert.deepEqual(d.added, ["A.g", "B.u"]);
    assert.deepEqual(d.removed, ["A.f"]);
    assert.deepEqual(d.changed, ["B.t"], "it refers to A.g now");
    // with the rename recorded, and its identity: a rename, and nothing changed
    const r = diffGraphs(h.graph(1)!, h.graph(2)!, (u) => (u === "A.g" ? "A.f" : u), new Map([["A.f", "A.g"]]));
    assert.deepEqual([r.added, r.removed, r.changed, r.renamed], [["B.u"], [], [], [["A.f", "A.g"]]]);
    assert.deepEqual(r.counts, { added: 1, removed: 0, changed: 0, renamed: 1 });
    // a module the later build could not read: what it held is neither removed nor added
    const partial = graph();
    partial.modules = partial.modules.slice(0, 1);
    partial.nodes = partial.nodes.slice(0, 2);
    partial.edges = [[1, 0, 1], [1, 2, 1]];
    h.record(partial, { ...opts(T0 + 2, "f3"), missing: ["B"] });
    assert.deepEqual(diffGraphs(h.graph(1)!, h.graph(3)!, ownName).counts, { added: 0, removed: 0, changed: 0, renamed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the extractions kept before the history are its first snapshots, one per build; names made unique", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-history-"));
  try {
    const ex = join(dir, "extract");
    mkdirSync(ex);
    const put = (fp: string, g: RawGraph, at: number) => {
      const f = join(ex, `${fp}.json`);
      writeFileSync(f, JSON.stringify(g));
      utimesSync(f, at / 1000, at / 1000);
    };
    // a build read by the extractor, then the usage pass's merged graph a moment later; a later
    // build; and a graph made before every unit had a name of its own (two `A.n` in two modules)
    const old = graph();
    for (const n of old.nodes) delete n.shape;
    const merged = { ...old, usage: { contexts: {}, failed: [], stats: { modules: 2, ran: 0, cached: 2, notationEdges: 0, nestedEdges: 0, ms: 0 } } };
    put("1111111111111111", old, T0);
    put("2222222222222222", merged, T0 + 5_000);
    const dup = graph({ extraB: true });
    dup.nodes[0] = { ...dup.nodes[0], name: "X.n" };
    dup.nodes[3] = { ...dup.nodes[3], name: "X.n" };
    put("3333333333333333", dup, T0 + 3_600_000);
    const project = { root: dir, libDir: join(dir, "lib"), toolchain: "tc" } as Project;
    const h = new History(join(dir, "state"));
    const lines: string[] = [];
    assert.equal(h.importExtractions(ex, project, (l) => lines.push(l)), 2);
    const l = h.list();
    assert.deepEqual(l.map((s) => s.fingerprint), ["2222222222222222", "3333333333333333"], "the merged graph stands for its build");
    assert.ok(l.every((s) => s.imported && s.approx), "a build time known from the extraction only");
    assert.equal(l[0].at, new Date(T0).toISOString());
    assert.deepEqual(h.graph(l[1].id)!.nodes.slice(0, 4).map((v) => v.name).sort(), ["A.f", "B.t", "X.n.A", "X.n.B"]);
    // what a snapshot from before versions is compared by: the kernel's hash
    assert.equal(snapVersion(h.graph(l[0].id)!.nodes[0]), "k-A.S-sS");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("names made unique: a unit given twice is one, with the edges of both", () => {
  const g = graph();
  g.nodes.push({ ...g.nodes[1] });
  // the outside declaration comes after the units: one more unit moves it to 4
  g.edges = [[1, 0, 1], [1, 4, 1], [2, 1, 1], [2, 0, 4], [3, 0, 2]];
  const u = uniqueNames(g);
  assert.deepEqual(u.nodes.map((n) => n.name), ["A.S", "A.f", "B.t"]);
  assert.deepEqual(u.edges.filter(([s, d]) => s === 1 && d === 0), [[1, 0, 3]]);
  assert.ok(u.edges.some(([s, d]) => s === 1 && d === 3), "the outside declaration moved down by one");
});
