// A past build's outside source (HistorySpec decision 24, the owner's of 2026-10-20): outside sources
// are not kept per build. A snapshot records each package's revision as the lake-manifest pinned it
// (those read before 0.7.0 are given theirs from their commit's lake-manifest.json), and its outside
// declarations' places; a past board shows such a declaration's source — its package's file as it is
// now — only where the package is at that revision now (Lean's core: the same toolchain), and says
// otherwise that the build's outside source was not kept. The page reads it as it reads a past text
// (web/src/pastsource.ts).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import type { ClusterMode, Layout, RawGraph, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION } from "../src/shared/graph.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { backfillPackages, History, manifestRevisions, pageGraph } from "../src/server/history.ts";
import { pastOutside, pastSource } from "../src/server/historyapi.ts";
import { OutsideSources } from "../src/server/outside.ts";
import { ownName } from "../src/server/versions.ts";
import { pastGraph } from "../src/shared/pastgraph.ts";
import type { HistoryDiff, SnapshotNodes } from "../src/shared/pastgraph.ts";
import { pastNote, pastText } from "../src/web/src/pastsource.ts";

const tmp = mkdtempSync(join(tmpdir(), "vp-pastoutside-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const T0 = Date.parse("2026-10-20T09:00:00Z");
const REV1 = "1ed178f000000000000000000000000000000000";
const REV2 = "089be84e24e41b7a26860084d1747195cf9299f3";

function put(file: string, text = ""): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const manifest = (rev: string) => JSON.stringify({ packagesDir: ".lake/packages", packages: [{ url: "https://github.com/leanprover-community/mathlib4.git", type: "git", rev, name: "mathlib", configFile: "lakefile.lean" }] });

/** A project on mathlib at REV2 now, with a toolchain of its own whose core has Init.Prelude. */
function project(): { root: string; outside: OutsideSources; now: (m: string) => { file: NonNullable<ReturnType<OutsideSources["find"]>>; toolchain: string } | null } {
  const root = join(tmp, "p");
  const sys = join(tmp, "toolchain");
  const pk = join(root, ".lake", "packages", "mathlib");
  put(join(root, "lake-manifest.json"), manifest(REV2));
  put(join(pk, "lakefile.lean"), "package mathlib\nlean_lib Mathlib\n");
  put(join(pk, "Mathlib", "Logic", "Basic.lean"), "import Mathlib.Init\n\n/-- Not not. -/\ntheorem not_not' : True := trivial\n");
  put(join(pk, ".lake", "build", "lib", "lean", "Mathlib", "Logic", "Basic.olean"));
  put(join(sys, "lib", "lean", "Init", "Prelude.olean"));
  put(join(sys, "src", "lean", "Init", "Prelude.lean"), "prelude\ninductive Nat where\n  | zero\n  | succ (n : Nat)\n");
  const outside = new OutsideSources(root, () => "leanprover/lean4:v4.35.0", () => sys);
  return { root, outside, now: (m) => {
    const file = outside.find(m);
    return file && { file, toolchain: "leanprover/lean4:v4.35.0" };
  } };
}

/** A graph of one project declaration referring to a Mathlib theorem and to Nat, with their places. */
function graph(): RawGraph {
  return {
    schema: 1,
    roots: ["P"],
    modules: [{ name: "P", imports: [] }],
    nodes: [{ name: "P.a", kind: "def", module: "P", type: "Nat", ax: 0, hash: "h", shape: "s", refs: [] }],
    externals: [
      { name: "not_not'", kind: "theorem", module: "Mathlib.Logic.Basic", ax: 0, doc: "Not not.", range: [3, 0, 4, 40] },
      { name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0, range: [2, 0, 4, 18] },
    ],
    edges: [[0, 1, 1], [0, 2, 1]],
    axioms: [],
    axiomSets: [[]],
    stats: { folded: 0, metaDropped: 0, ms: 0 },
    refNames: [],
  };
}

const opts = (at: number, fingerprint: string, toolchain: string, packages?: Record<string, string>) => ({ at, fingerprint, commit: { hash: "abc1234", branch: "main" }, toolchain, missing: [] as string[], ...(packages ? { packages } : {}) });

test("a snapshot records its packages' revisions and its outside declarations' places; a page reads the places back", () => {
  const h = new History(join(tmp, "site-record"));
  const s = h.record(graph(), opts(T0, "f1", "leanprover/lean4:v4.35.0", { mathlib: REV2 })).info;
  assert.deepEqual(s.packages, { revs: { mathlib: REV2 }, from: "read" });
  const g = h.graph(s.id)!;
  assert.deepEqual(g.nodes.find((v) => v.name === "not_not'")?.range, [3, 0, 4, 40]);
  const p = pageGraph(g, ownName);
  assert.deepEqual((p.nodes.find((v) => v.name === "Nat") as { range?: unknown }).range, [2, 0, 4, 18]);
  assert.deepEqual([...h.outsideModulesOf(s.id)].sort(), ["Init.Prelude", "Mathlib.Logic.Basic"]);
});

test("a past build shows an outside declaration's source only where its package is at that build's revision now; the core, where the toolchain is the same", () => {
  const P = project();
  const h = new History(join(tmp, "site-past"));
  const old = h.record(graph(), opts(T0, "f1", "leanprover/lean4:v4.34.0", { mathlib: REV1 })).info;
  const same = h.record(graph(), opts(T0 + 60_000, "f2", "leanprover/lean4:v4.35.0", { mathlib: REV2 })).info;
  // the same revision: the package's file now, matched by its revision
  const ok = pastSource(h, same.id, "Mathlib.Logic.Basic", P.now);
  assert.equal(ok.status, 200);
  const body = ok.body as { file: string; text: string; check: string; outside: { package: string; rev: string; github: { path: string } } };
  assert.equal(body.file, "Mathlib/Logic/Basic.lean");
  assert.equal(body.check, "rev");
  assert.match(body.text, /theorem not_not'/);
  assert.equal(body.outside.rev, REV2);
  assert.equal(body.outside.github.path, "Mathlib/Logic/Basic.lean");
  assert.equal(pastSource(h, same.id, "Init.Prelude", P.now).status, 200, "the same toolchain: Lean's core as it is");
  // another revision: not kept, saying both
  const no = pastSource(h, old.id, "Mathlib.Logic.Basic", P.now);
  assert.equal(no.status, 404);
  const why = (no.body as { why: string; kept: boolean; outside: boolean }).why;
  assert.equal((no.body as { kept: boolean }).kept, false);
  assert.equal((no.body as { outside: boolean }).outside, true);
  assert.match(why, /outside sources are not kept per build, and mathlib was at 1ed178f then and is at 089be84 now/);
  assert.match((pastSource(h, old.id, "Init.Prelude", P.now).body as { why: string }).why, /toolchain, whose core it is in, was leanprover\/lean4:v4\.34\.0 then and is leanprover\/lean4:v4\.35\.0 now/);
  // a build that recorded no revisions: not kept; a module no outside declaration of it is in: not asked
  const none = h.record(graph(), opts(T0 + 120_000, "f3", "leanprover/lean4:v4.35.0")).info;
  assert.match((pastSource(h, none.id, "Mathlib.Logic.Basic", P.now).body as { why: string }).why, /revisions of this build's packages were not recorded/);
  assert.equal(pastSource(h, same.id, "Mathlib.Other", P.now).status, 404);
  assert.doesNotMatch(JSON.stringify(pastSource(h, same.id, "Mathlib.Other", P.now).body), /outside sources/, "not one of the build's outside modules: answered as any module it does not have");
  // straight, as the agents' endpoint and the past document read it
  assert.equal(pastOutside(same, "Mathlib.Logic.Basic", P.now).status, 200);
});

test("the snapshots read before the revisions were recorded are given theirs from their commit's lake-manifest.json; not a dirty or guessed one", () => {
  const root = join(tmp, "repo");
  mkdirSync(root, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  git("init", "-q");
  writeFileSync(join(root, "lake-manifest.json"), manifest(REV1));
  git("add", ".");
  git("commit", "-qm", "one");
  const c1 = git("rev-parse", "HEAD");
  const h = new History(join(tmp, "site-backfill"));
  const at = (k: number) => T0 + k * 60_000;
  const a = h.record(graph(), { ...opts(at(0), "f1", "tc"), commit: { hash: c1, branch: "main" } }).info;
  const dirty = h.record(graph(), { ...opts(at(1), "f2", "tc"), commit: { hash: c1, branch: "main", dirty: true } }).info;
  const guessed = h.record(graph(), { ...opts(at(2), "f3", "tc"), commit: { hash: c1, branch: null, guessed: true } }).info;
  assert.equal(backfillPackages(h, root), 1);
  assert.deepEqual(h.get(a.id)!.packages, { revs: { mathlib: REV1 }, from: "commit" });
  assert.equal(h.get(dirty.id)!.packages, undefined);
  assert.equal(h.get(guessed.id)!.packages, undefined);
  assert.equal(backfillPackages(h, root), 0, "once");
  assert.deepEqual(new History(join(tmp, "site-backfill")).get(a.id)!.packages, { revs: { mathlib: REV1 }, from: "commit" }, "kept");
  assert.equal(manifestRevisions("not json"), null);
  assert.deepEqual(manifestRevisions(JSON.stringify({ packages: [{ name: "a", rev: "x" }, { name: "b" }] })), { a: "x" });
});

test("on a past board an outside declaration's text is read at its place then, under a note saying it is the package as it is now; an old snapshot takes the place now", () => {
  const nowNodes: ViewNode[] = [
    { name: "P.a", kind: "def", module: "P", ax: 0, type: "Nat", hash: "v" },
    { name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0, ext: true, range: [2, 0, 4, 18] },
  ];
  const meta = {
    schema: 1, layoutVersion: LAYOUT_VERSION,
    project: { name: "p", root: "/x", roots: ["P"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [{ name: "P", file: "P.lean", imports: [] }],
    nodes: nowNodes, projectCount: 1, axioms: [], axiomSets: [[]],
    layouts: {} as Record<ClusterMode, Layout>, edgeCount: 0,
  } as ViewMeta;
  const now = new Graph(meta, new Int32Array(0));
  const snap: SnapshotNodes = {
    snapshot: { id: 1, at: new Date(T0).toISOString(), read: new Date(T0).toISOString(), commit: null, toolchain: "tc", missing: [], counts: { modules: 1, nodes: 1, edges: 0, externals: 1 } },
    modules: [{ name: "P", imports: [] }],
    // read before 0.7.0: no place for its outside declaration
    nodes: [nowNodes[0], { name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0, ext: true }],
    projectCount: 1,
    axioms: [],
    axiomSets: [[]],
    edgeCount: 0,
  };
  const diff: HistoryDiff = { from: 1, to: 2, counts: { added: 0, removed: 0, changed: 0, renamed: 0 }, added: [], removed: [], changed: [], renamed: [] };
  const past = pastGraph(snap, new Int32Array(0), now, diff);
  const i = past.graph.byName.get("Nat")!;
  assert.deepEqual(past.graph.nodes[i].range, [2, 0, 4, 18], "the place now, which is the place then where the server shows it");
  const outside = { package: "Lean", core: true, rev: "v4.35.0", github: { repo: "leanprover/lean4", rev: "v4.35.0", path: "src/Init/Prelude.lean" } };
  const text = "prelude\ninductive Nat where\n  | zero\n  | succ (n : Nat)\n";
  const t = pastText(past.graph, i, { file: "Init/Prelude.lean", text, outside })!;
  assert.deepEqual([t.start, t.end], [1, 3]);
  assert.equal(t.where, "Lean v4.35.0 · Init/Prelude.lean:2–4");
  assert.equal(pastText(past.graph, i, { file: "Init/Prelude.lean", text }), null, "an outside declaration's text is its package's, never a project file's");
  assert.match(pastNote("on 20 Oct", null, "rev", outside), /outside sources are not kept per build; this is Lean's core as it is now, the same toolchain as then \(Lean v4\.35\.0\)/);
  assert.match(pastNote("on 20 Oct", null, "rev", { ...outside, package: "mathlib", core: false, rev: REV2 }), /this is mathlib as it is now, at the same revision as then \(mathlib at 089be84\)/);
});
