// Versions (TCBSpec.md decision 3, as revised on 2026-10-09; server/versions.ts): a declaration's
// version is its shape with its references mapped through the renames in force, so that a pure
// rename stales nothing; an opinion recorded under the kernel's hash before is bound to the version
// of that content. The extractor's side, on the fixture, is in test/extract.test.ts.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { test } from "node:test";
import type { RawGraph, ViewMeta } from "../src/shared/graph.ts";
import { logFileName, statusOf } from "../src/shared/review.ts";
import { ReviewStore } from "../src/server/review.ts";
import { rebinder, refIdentity, versionBase, versions, withVersions } from "../src/server/versions.ts";

/** A graph of three units: `A.t` states something of `A.f`, which is built from `A.S` and its
 *  constructor. */
function graph(names: { S: string; f: string; t: string }, fBody = "s0"): RawGraph {
  const node = (name: string, hash: string, shape: string, refs: number[]) => ({ name, kind: "def" as const, module: "A", type: "", ax: 0, hash, shape, refs });
  return {
    schema: 1,
    roots: ["A"],
    modules: [{ name: "A", imports: [] }],
    nodes: [node(names.S, `k-${names.S}`, "s-S", [0, 1]), node(names.f, `k-${names.f}-${fBody}`, fBody, [0, 2, 3]), node(names.t, `k-${names.t}-${names.f}`, "s-t", [3, 4])],
    externals: [],
    edges: [],
    axioms: [],
    axiomSets: [[]],
    stats: { folded: 0, metaDropped: 0, ms: 0 },
    refNames: ["Nat", names.S, `${names.S} mk`, names.f, "Eq"],
  };
}

test("a pure rename keeps every version; a real change makes a new one of what changed alone", () => {
  const g0 = graph({ S: "A.S", f: "A.f", t: "A.t" });
  const g1 = graph({ S: "A.T", f: "A.g", t: "A.t" });
  const was: Record<string, string> = { "A.T": "A.S", "A.g": "A.f" };
  const v0 = versions(versionBase(g0));
  const v1 = versions(versionBase(g1), (u) => was[u] ?? u);
  assert.deepEqual(v1, v0, "renamed, and what refers to them: the same versions");
  assert.notEqual(versions(versionBase(g1))[2], v0[2], "without the renames, what refers to them looks changed");
  const g2 = graph({ S: "A.S", f: "A.f", t: "A.t" }, "s1");
  const v2 = versions(versionBase(g2));
  assert.notEqual(v2[1], v0[1], "a real change is a new version");
  assert.equal(v2[2], v0[2], "and what only uses it keeps its own");
  assert.match(v0[0], /^[0-9a-f]{16}$/);
  // a constant of a unit is read through the unit's identity, its part kept
  assert.equal(refIdentity("A.T mk", (u) => was[u] ?? u), "A.S mk");
  // an extraction from before versions: the kernel's hash stands for the version
  const old = graph({ S: "A.S", f: "A.f", t: "A.t" });
  for (const n of old.nodes) delete n.shape;
  assert.deepEqual(versions(versionBase(old)), old.nodes.map((n) => n.hash));
});

test("the page's graph carries versions and the kernel's hashes; nothing to do when they are the same", () => {
  const g = graph({ S: "A.T", f: "A.g", t: "A.t" });
  const meta = { projectCount: 3, nodes: [...g.nodes.map((n) => ({ name: n.name, kind: n.kind, module: n.module, ax: 0, hash: n.hash })), { name: "Nat", kind: "inductive", module: "Init", ax: 0, ext: true }] } as unknown as ViewMeta;
  const was: Record<string, string> = { "A.T": "A.S", "A.g": "A.f" };
  const gz = withVersions(gzipSync(JSON.stringify(meta)), versionBase(g), (u) => was[u] ?? u)!;
  const m: ViewMeta = JSON.parse(gunzipSync(gz).toString("utf8"));
  assert.deepEqual(m.nodes.slice(0, 3).map((v) => v.hash), versions(versionBase(graph({ S: "A.S", f: "A.f", t: "A.t" }))));
  assert.deepEqual(m.nodes.slice(0, 3).map((v) => v.kernel), g.nodes.map((n) => n.hash));
  assert.equal(m.nodes[3].hash, undefined, "an outside declaration has none");
  assert.equal(withVersions(gz, versionBase(g), (u) => was[u] ?? u), null);
});

test("an opinion recorded under the kernel's hash is bound to its version; the review still goes as deltas after", () => {
  const root = mkdtempSync(join(tmpdir(), "vp-versions-"));
  try {
    const dir = join(root, ".visualproof", "log");
    mkdirSync(dir, { recursive: true });
    const g = graph({ S: "A.S", f: "A.f", t: "A.t" });
    const vs = versions(versionBase(g));
    // Alice approved A.f and A.t before versions, and A.S on content that is not there now
    const lines = [
      { op: "opinion", name: "A.f", by: "Alice", verdict: "approve", at: "2026-10-08T10:00:00.000Z", hash: "k-A.f-s0", text: "def f" },
      { op: "opinion", name: "A.t", by: "Alice", verdict: "approve", at: "2026-10-08T10:01:00.000Z", hash: "k-A.t-A.f", text: "theorem t" },
      { op: "opinion", name: "A.S", by: "Alice", verdict: "approve", at: "2026-10-08T10:02:00.000Z", hash: "k-old", text: "structure S" },
    ];
    writeFileSync(join(dir, logFileName("Alice", false)), lines.map((l) => JSON.stringify(l) + "\n").join(""));
    const store = new ReviewStore(root, ".visualproof");
    assert.equal(statusOf(store.data, "A.f", vs[1]), "stale", "read as written, the kernel's hash is no version");
    const kernel = new Map(g.nodes.map((n, i) => [n.name, [n.hash, vs[i]]]));
    const c = store.setReading(rebinder((name, h) => (kernel.get(name)?.[0] === h ? kernel.get(name)![1] : null)));
    assert.equal(c.events, null, "the whole review is replayed");
    assert.equal(statusOf(store.data, "A.f", vs[1]), "approved");
    assert.equal(statusOf(store.data, "A.t", vs[2]), "approved");
    assert.equal(statusOf(store.data, "A.S", vs[0]), "stale", "content no graph has is left as it was");
    // a new opinion after: one event, as before
    const r = store.append({ name: "Bob", agent: false }, { op: "opinion", name: "A.t", by: "Bob", verdict: "approve", hash: vs[2], text: "theorem t" }, "tc");
    assert.ok("change" in r && r.change && r.change.events?.length === 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
