// A declaration's source on a board of a past build (HistorySpec decision 23, web/src/pastsource.ts):
// the text its build was compiled from, read at the place the snapshot recorded — that build's line
// numbers — with the names in it linked to the declarations of that build, resolved on the past
// graph as the past board resolves them; which modules' texts the past graph knows are kept.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { highlightLines } from "../src/web/src/highlight.ts";
import { PAST_GHOST, PAST_RENAMED, pastGraph } from "../src/web/src/past.ts";
import type { HistoryDiff, SnapshotNodes } from "../src/web/src/past.ts";
import { pastNote, pastText } from "../src/web/src/pastsource.ts";
import { resolver } from "../src/web/src/scope.ts";

const T0 = Date.parse("2026-10-09T20:27:21Z");

/** The text module B was compiled from at the past build: B.t's proof uses B.old, gone since, and
 *  A.f, renamed since; B.t sat lower in the file than it does now. */
const B_THEN = [
  "import A",
  "",
  "namespace B",
  "",
  "/-- Then: every `s` is one. -/",
  "theorem t : ∀ s, A.f s = 1 := by",
  "  intro s",
  "  exact old s",
  "",
  "theorem old : True := trivial",
  "",
  "end B",
  "",
].join("\n");

/** The graph on show: A.S, A.g (A.f renamed), B.t, B.u (new since); B.t now at line 3. */
function now(): Graph {
  const nodes: ViewNode[] = [
    { name: "A.S", kind: "structure", module: "A", ax: 0, type: "Type", hash: "vS" },
    { name: "A.g", kind: "def", module: "A", ax: 0, type: "A.S → Nat", hash: "vf" },
    { name: "B.t", kind: "theorem", module: "B", ax: 0, type: "∀ s, A.g s = 0", hash: "vt2", range: [3, 0, 4, 10] },
    { name: "B.u", kind: "theorem", module: "B", ax: 0, type: "B.t", hash: "vu" },
    { name: "Nat", kind: "inductive", module: "Init", ax: 0, ext: true },
  ];
  const meta = {
    schema: 1, layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: "/x", roots: ["B"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [{ name: "A", file: "A.lean", imports: [] }, { name: "B", file: "B.lean", imports: ["A"] }],
    nodes, projectCount: 4, axioms: [], axiomSets: [[]],
    layouts: {} as Record<ClusterMode, Layout>, edgeCount: 2,
  } as ViewMeta;
  return new Graph(meta, new Int32Array([1, 0, SITE_STMT, 2, 1, SITE_STMT]));
}

/** The snapshot of then: A.S, A.f, B.t, B.old; B's text kept, matched by its places; A's not. */
function then(): { nodes: SnapshotNodes; edges: Int32Array; diff: HistoryDiff } {
  const nodes: SnapshotNodes = {
    snapshot: { id: 2, at: new Date(T0).toISOString(), read: new Date(T0).toISOString(), commit: { hash: "fb2839694847e44953455013d845621a8e71acb4", branch: "main", dirty: true }, toolchain: "tc", missing: [], counts: { modules: 2, nodes: 4, edges: 2, externals: 1 } },
    modules: [{ name: "A", imports: [] }, { name: "B", imports: ["A"] }],
    nodes: [
      { name: "A.S", kind: "structure", module: "A", ax: 0, type: "Type", hash: "vS" },
      { name: "A.f", kind: "def", module: "A", ax: 0, type: "A.S → Nat", hash: "vf" },
      { name: "B.t", kind: "theorem", module: "B", ax: 0, type: "∀ s, A.f s = 1", hash: "vt1", doc: "Then: every `s` is one.", range: [5, 0, 8, 13] },
      { name: "B.old", kind: "theorem", module: "B", ax: 0, type: "True", hash: "vo", range: [10, 0, 10, 29] },
      { name: "Nat", kind: "inductive", module: "Init", ax: 0, ext: true },
    ],
    projectCount: 4,
    axioms: [],
    axiomSets: [[]],
    edgeCount: 2,
    sources: { B: "places" },
  };
  const diff: HistoryDiff = { from: 2, to: 4, counts: { added: 1, removed: 1, changed: 1, renamed: 1 }, added: ["B.u"], removed: ["B.old"], changed: ["B.t"], renamed: [["A.f", "A.g"]] };
  return { nodes, edges: new Int32Array([1, 0, SITE_STMT, 2, 1, SITE_STMT]), diff };
}

test("a past build's board has that build's commit, its source the page's to add; none where the commit is not known or only guessed", () => {
  const T = then();
  assert.deepEqual(pastGraph(T.nodes, T.edges, now(), T.diff).graph.meta.project.git, { source: null, commit: "fb2839694847e44953455013d845621a8e71acb4", branch: "main", dirty: true });
  const guessed = { ...T.nodes, snapshot: { ...T.nodes.snapshot, commit: { ...T.nodes.snapshot.commit!, guessed: true as const } } };
  assert.equal(pastGraph(guessed, T.edges, now(), T.diff).graph.meta.project.git, undefined);
  const none = { ...T.nodes, snapshot: { ...T.nodes.snapshot, commit: null } };
  assert.equal(pastGraph(none, T.edges, now(), T.diff).graph.meta.project.git, undefined);
});

test("a past declaration's text: at the place its build recorded, with that build's line numbers", () => {
  const T = then();
  const p = pastGraph(T.nodes, T.edges, now(), T.diff);
  const g = p.graph;
  const t = g.byName.get("B.t")!;
  const shown = pastText(g, t, { file: "B.lean", text: B_THEN })!;
  // lines 5–8 then (the doc comment its range opens with included), not 3–4 as now
  assert.deepEqual([shown.start, shown.end, shown.where], [4, 7, "B.lean:5–8"]);
  assert.equal(shown.text, "/-- Then: every `s` is one. -/\ntheorem t : ∀ s, A.f s = 1 := by\n  intro s\n  exact old s");
  assert.deepEqual(shown.lines, shown.text.split("\n"));
  const old = pastText(g, g.byName.get("B.old")!, { file: "B.lean", text: B_THEN })!;
  assert.deepEqual([old.where, old.text], ["B.lean:10–10", "theorem old : True := trivial"]);
  // nothing for what has no place, or is outside the project
  assert.equal(pastText(g, g.byName.get("A.S")!, { file: "A.lean", text: "" }), null);
  assert.equal(pastText(g, g.byName.get("Nat")!, { file: "x", text: "" }), null);
});

test("names in a past text link to the declarations of that build, resolved on the past graph", () => {
  const T = then();
  const N = now();
  const p = pastGraph(T.nodes, T.edges, N, T.diff);
  const g = p.graph;
  const shown = pastText(g, g.byName.get("B.t")!, { file: "B.lean", text: B_THEN })!;
  // B.old is gone now and A.f renamed since: both are declarations of that build
  assert.ok(p.marks[g.byName.get("B.old")!] & PAST_GHOST);
  assert.ok(p.marks[g.byName.get("A.f")!] & PAST_RENAMED);
  assert.equal(shown.resolve("old"), "B.old");
  assert.equal(shown.resolve("A.f"), "A.f");
  assert.equal(shown.resolve("t"), null, "its own name links nowhere");
  assert.equal(shown.resolve("intro"), null);
  // read on the graph of now, the same names would link to nothing: that is why the past graph
  // resolves them
  const onNow = resolver(N, "B.t", null);
  assert.deepEqual([onNow("old"), onNow("A.f")], [null, null]);
  // highlighted as now, the links being the past graph's names
  const html = highlightLines(shown.text, (w) => shown.resolve(w));
  assert.match(html, /data-ref="B\.old">old</);
  assert.match(html, /data-ref="A\.f">A\.f</);
  assert.equal((html.match(/class="ln"/g) ?? []).length, 4, "a line of the file is a line on show");
  // a declaration new since is not of that build: the past graph does not hold it
  assert.equal(g.byName.get("B.u"), undefined);
});

test("the past graph knows which modules' texts its build kept, and the window says how each was matched", () => {
  const T = then();
  const p = pastGraph(T.nodes, T.edges, now(), T.diff);
  assert.equal(p.kept.get("B"), "places");
  assert.equal(p.kept.has("A"), false, "A's text then is not kept: the panel says so for it alone");
  assert.equal(pastGraph({ ...T.nodes, sources: undefined }, T.edges, now(), T.diff).kept.size, 0, "a snapshot not backfilled yet keeps none");
  assert.match(pastNote("Oct 9, 22:27", "fb2839694847", "places"), /^As built Oct 9, 22:27 · fb28396: .*matched by the places the build recorded/);
  assert.doesNotMatch(pastNote("Oct 9, 22:27", null, "lake"), /places|·/);
});
