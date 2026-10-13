// The source texts of past builds (HistorySpec decisions 20–23, server/sourcestore.ts): each text a
// blob named by its SHA-256 and written once; a build's text kept only where its Lake hash is the one
// the build compiled — the file as it is, else the build's commit — and never another; the snapshots
// made before, backfilled from git by that hash where it is known and by the places the snapshot
// recorded where it is not; a past declaration's source for the page and for agents.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import type { RawGraph, RawNode } from "../src/shared/graph.ts";
import { History } from "../src/server/history.ts";
import { pastSource } from "../src/server/historyapi.ts";
import { openProject } from "../src/server/project.ts";
import type { Project } from "../src/server/project.ts";
import { backfillSources, keepSources, misfit, SourceStore } from "../src/server/sourcestore.ts";
import { lakeTextHash } from "../src/server/status.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

const T0 = Date.parse("2026-10-09T10:00:00Z");

test("a text is one blob named by its SHA-256, written once whatever number of builds keep it", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-blobs-"));
  try {
    const store = new SourceStore(dir);
    const a = store.put("def a := 1\n");
    const again = store.put("def a := 1\n");
    const b = store.put("def a := 2\n");
    assert.ok(a.fresh && !again.fresh && b.fresh);
    assert.equal(a.blob, again.blob);
    assert.match(a.blob, /^[0-9a-f]{64}$/);
    assert.deepEqual(readdirSync(store.dir).sort(), [`${a.blob}.gz`, `${b.blob}.gz`].sort());
    // read back as it was, by another store over the same folder too; a blob that is not what its
    // name says is no text
    assert.equal(new SourceStore(dir).text(a.blob), "def a := 1\n");
    assert.equal(new SourceStore(dir).put("def a := 2\n").fresh, false);
    writeFileSync(join(store.dir, `${a.blob}.gz`), gzipSync("tampered"));
    assert.equal(new SourceStore(dir).text(a.blob), null);
    assert.equal(store.text("../etc/passwd"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------- a project in a git repository

/** A module's declarations as the extractor would record them from `text`: each `def` or `theorem`
 *  with the doc comment above it, its range from the doc to its last line (blocks end at a blank
 *  line or `end`), named in namespace `ns`. */
function units(module: string, text: string, ns = ""): RawNode[] {
  const lines = text.split("\n");
  const out: RawNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^(\/--|def |theorem )/.test(lines[i])) continue;
    const start = i;
    let doc: string | undefined;
    if (lines[i].startsWith("/--")) {
      doc = lines[i].replace(/^\/--/, "").replace(/-\/$/, "").trim();
      i++;
    }
    const name = /^(?:def|theorem) (\S+)/.exec(lines[i])![1];
    let end = i;
    while (end + 1 < lines.length && lines[end + 1].trim() && lines[end + 1] !== `end ${ns}`) end++;
    out.push({ name: ns ? `${ns}.${name}` : name, kind: lines[i].startsWith("def") ? "def" : "theorem", module, type: "Nat", ax: 0, hash: `k-${name}-${end}`, range: [start + 1, 0, end + 1, [...lines[end]].length], ...(doc ? { doc } : {}) });
    i = end;
  }
  return out;
}

/** The graph a build of these texts would give. */
function graphOf(texts: Record<string, string>, imports: Record<string, string[]> = {}): RawGraph {
  const modules = Object.keys(texts);
  return {
    schema: 1,
    roots: modules,
    modules: modules.map((m) => ({ name: m, imports: imports[m] ?? [] })),
    nodes: modules.flatMap((m) => units(m, texts[m], m === "C" ? "" : m)),
    externals: [],
    edges: [],
    axioms: [],
    axiomSets: [[]],
    stats: { folded: 0, metaDropped: 0, ms: 0 },
  };
}

const A1 = "namespace A\n\n/-- The first. -/\ndef f : Nat := 1\n\ntheorem t : f = 1 := rfl\n\nend A\n";
// a theorem more, above the others: every place below it moves
const A3 = "namespace A\n\ntheorem z : 0 = 0 := rfl\n\n/-- The first. -/\ndef f : Nat := 1\n\ntheorem t : f = 1 := rfl\n\nend A\n";
const A4 = "namespace A\n\n/-- The first, kept. -/\ndef f : Nat := 1\n\ntheorem t : f = 1 :=\n  rfl\n\nend A\n";
const B1 = "import A\n\nnamespace B\n\ntheorem u : A.f = 1 := A.t\n\nend B\n";
const B2 = "import A\n\nnamespace B\n\ntheorem w : True := trivial\n\ntheorem u : A.f = 1 := A.t\n\nend B\n";
// an edit inside a proof, which moves no place
const C1 = "theorem c : 1 = 1 := by\n  skip\n  rfl\n";
const C2 = "theorem c : 1 = 1 := by\n  trivial\n  rfl\n";

/** A Lean project in a git repository of its own, with what Lake leaves of a build: an `.olean` and
 *  a trace recording the Lake hash of the text each module was compiled from, then. */
function repository() {
  const dir = mkdtempSync(join(tmpdir(), "vp-sources-repo-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" };
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "lean-toolchain"), "leanprover/lean4:v4.33.1\n");
  const lib = join(dir, ".lake", "build", "lib", "lean");
  mkdirSync(lib, { recursive: true });
  const write = (files: Record<string, string>) => {
    for (const [m, text] of Object.entries(files)) writeFileSync(join(dir, `${m}.lean`), text);
  };
  const commit = (msg: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  /** module `m` compiled from `text` at `at` (ms): its `.olean`, and its trace saying the hash */
  const built = (m: string, text: string, at: number) => {
    writeFileSync(join(lib, `${m}.olean`), "olean");
    writeFileSync(join(lib, `${m}.trace`), JSON.stringify({ inputs: [[join(dir, `${m}.lean`), lakeTextHash(text)]], log: [] }));
    for (const f of [`${m}.olean`, `${m}.trace`]) utimesSync(join(lib, f), at / 1000, at / 1000);
  };
  const project = (): Project => openProject(dir, ["B"], false);
  return { dir, git, write, commit, built, project, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a build's text is kept where its Lake hash is the build's: the file, else the build's commit; never another", () => {
  const R = repository();
  try {
    R.write({ A: A1, B: B2, C: C1 });
    const c = R.commit("one");
    // A as compiled; B edited since its build, and its commit has the text compiled; C edited since,
    // with a text its commit does not have either
    R.built("A", A1, T0);
    R.built("B", B2, T0);
    R.built("C", C2, T0);
    R.write({ B: B1 });
    const store = new SourceStore(join(R.dir, "state", "history"));
    const { map, written } = keepSources(R.project(), ["A", "B", "C", "Init.Prelude"], c, store);
    assert.deepEqual([map.A.check, map.A.from, map.A.lake, store.text(map.A.blob!)], ["lake", "tree", lakeTextHash(A1), A1]);
    assert.deepEqual([map.B.check, map.B.from, store.text(map.B.blob!)], ["lake", `git:${c}`, B2], "the edited file falls back to the commit");
    assert.equal(map.C.blob, undefined, "neither the file nor the commit is the text compiled");
    assert.equal(map.C.lake, lakeTextHash(C2));
    assert.match(map.C.why!, /edited after the build/);
    assert.ok(!("Init.Prelude" in map), "a module with no file of the project has no text");
    assert.ok(written > 0);
    // the same files again: nothing written
    assert.equal(keepSources(R.project(), ["A", "B"], c, store).written, 0);
  } finally {
    R.close();
  }
});

test("a build read again keeps the text found before for a file edited since, its hash being the same", () => {
  const R = repository();
  try {
    R.write({ A: A1, B: B1 });
    R.built("A", A1, T0);
    R.built("B", B1, T0);
    const h = new History(join(R.dir, "state"));
    const p = R.project();
    const g = graphOf({ A: A1, B: B1 });
    const first = h.record(g, { at: T0, fingerprint: "f1", commit: null, toolchain: "tc", missing: [], sources: () => keepSources(p, ["A", "B"], null, h.sources) });
    assert.deepEqual(first.info.sources && [first.info.sources.kept, first.info.sources.of, first.info.sources.places], [2, 2, 0]);
    assert.ok(first.info.sources!.bytes.new > 0 && first.info.sources!.bytes.new === first.info.sources!.bytes.all);
    // the usage pass's graph of the same build, read after B was edited (no commit to fall back on)
    R.write({ B: B2 });
    const again = h.record(g, { at: T0, fingerprint: "f2", commit: null, toolchain: "tc", missing: [], sources: () => keepSources(p, ["A", "B"], null, h.sources) });
    assert.ok(again.written && !again.fresh);
    assert.equal(h.textOf(1, "B")!.text, B1, "the text found when it was read first stands");
    assert.equal(again.info.sources!.kept, 2);
    // a reading that looks for no texts keeps those it had
    h.record(g, { at: T0, fingerprint: "f3", commit: null, toolchain: "tc", missing: [] });
    assert.equal(new History(join(R.dir, "state")).textOf(1, "A")!.text, A1);
  } finally {
    R.close();
  }
});

test("the places a snapshot recorded: a text agrees where every declaration starts, ends, is named and documented as then", () => {
  const shape = { imports: [], nodes: units("A", A1, "A") };
  const project = () => false;
  assert.equal(misfit(A1, shape, project), null);
  assert.match(misfit(A3, shape, project)!, /does not (start|end) where it did|not declared where it was|doc comment/);
  assert.match(misfit(A4, shape, project)!, /doc comment differs|does not end/);
  assert.match(misfit(A1.replace("def f", "def g"), shape, project)!, /A.f is not declared where it was/);
  // the project imports are the module's: one more, of a module of the project, is another text
  const header = (imp: string) => `import ${imp}\n${A1}`;
  const imported = { imports: [], nodes: units("A", header("Mathlib"), "A") };
  assert.equal(misfit(header("Mathlib.Other"), imported, project), null, "an import from outside the project is not recorded");
  assert.match(misfit(header("Z"), imported, (m) => m === "Z")!, /imports differ/);
  // an edit inside a proof moves no place: that is why a Lake hash, where known, is the check
  assert.equal(misfit(C2, { imports: [], nodes: units("C", C1) }, project), null);
  // a declaration written under `_root_`
  assert.equal(misfit("theorem _root_.X.y : True := trivial\n", { imports: [], nodes: [{ name: "X.y", kind: "theorem", range: [1, 0, 1, 36] }] }, project), null);
});

test("the backfill: a clean commit, a dirty build whose edit was committed later, and a dirty build never committed", async () => {
  const R = repository();
  const after: string[] = [];
  try {
    const at = [T0, T0 + 60_000, T0 + 120_000];
    R.write({ A: A1, B: B1, C: C1 });
    const c1 = R.commit("one");
    // the server's site, outside the project, as `--site` puts it
    const state = mkdtempSync(join(tmpdir(), "vp-sources-state-"));
    after.push(state);
    const h = new History(state);
    const rec = (texts: Record<string, string>, k: number, commit: { hash: string; dirty?: boolean }) =>
      h.record(graphOf(texts, { B: ["A"] }), { at: at[k], fingerprint: `f${k + 1}`, commit: { branch: "main", ...commit } as never, toolchain: "tc", missing: [] });
    // 1: read clean at c1. 2: B edited, read dirty at c1; its edit committed later (c2), with an
    // edit inside C's proof. 3: A edited, read dirty at c2; that edit is never committed
    rec({ A: A1, B: B1, C: C1 }, 0, { hash: c1 });
    rec({ A: A1, B: B2, C: C1 }, 1, { hash: c1, dirty: true });
    R.write({ B: B2, C: C2 });
    const c2 = R.commit("two");
    rec({ A: A3, B: B2, C: C2 }, 2, { hash: c2, dirty: true });
    R.write({ A: A4 });
    // what the cache still says of the builds' hashes: B not compiled since build 2 (its
    // trace is that build's), A and C compiled since every build; a view of build 3's extraction
    R.built("A", A4, at[2] + 60_000);
    R.built("B", B2, at[1] - 1000);
    R.built("C", C2, at[2] + 60_000);
    mkdirSync(join(state, "view"));
    const compiled = { A: A3, B: B2, C: C2 };
    writeFileSync(join(state, "view", "f3-v9.meta.json.gz"), gzipSync(JSON.stringify({ modules: Object.entries(compiled).map(([name, t]) => ({ name, compiled: lakeTextHash(t) })) })));
    const lines: string[] = [];
    const reports = await backfillSources(h, R.project(), state, (l) => lines.push(l));
    const by = new Map(reports.map((r) => [r.id, r]));
    const t = (id: number, m: string) => h.textOf(id, m)!;
    // 1, clean: every text, by places, from its commit — C's two texts both agree, and the commit wins
    assert.deepEqual([by.get(1)!.places, by.get(1)!.lake], [3, 0]);
    for (const [m, text] of Object.entries({ A: A1, B: B1, C: C1 })) assert.deepEqual([t(1, m).text, t(1, m).ref.from], [text, `git:${c1}`], m);
    // 2, dirty: B's edit, committed later, found by the hash its present trace keeps; C's two texts
    // both agree and nothing says which the build had: not kept
    assert.deepEqual(by.get(2)!.hashes, { view: 0, trace: 1 });
    assert.deepEqual([t(2, "B").text, t(2, "B").ref.check, t(2, "B").ref.from], [B2, "lake", `git:${c2}`]);
    assert.deepEqual([t(2, "A").text, t(2, "A").ref.check], [A1, "places"]);
    assert.equal(t(2, "C").text, null);
    assert.match(t(2, "C").ref.why!, /several texts agree/);
    // 3: hashes from the view of its extraction; A's text was never committed and is gone: not kept
    assert.deepEqual(by.get(3)!.hashes, { view: 3, trace: 0 });
    assert.equal(t(3, "A").text, null);
    assert.match(t(3, "A").ref.why!, /no text with the hash/);
    assert.deepEqual([t(3, "B").text, t(3, "C").text, t(3, "C").ref.check], [B2, C2, "lake"]);
    // how complete each came out, in the index and the log
    assert.deepEqual(h.list().map((s) => [s.id, s.sources?.kept, s.sources?.of, s.sources?.places]), [[1, 3, 3, 3], [2, 2, 3, 1], [3, 2, 3, 0]]);
    assert.ok(lines.some((l) => /snapshot 2 .*2 of 3 module texts kept/.test(l)), lines.join("\n"));
    // once: a snapshot backfilled is not looked at again, and the next start finds nothing to do
    assert.deepEqual(await backfillSources(new History(state), R.project(), state, () => {}), []);
    assert.equal(new History(state).textOf(1, "C")!.text, C1);
    // the repository is as it was: nothing written into it, the working tree as left
    assert.equal(R.git("status", "--porcelain", "--untracked-files=no"), "M A.lean");
    // the page's answer: the text and how it was matched, or why there is none
    const ok = pastSource(h, 1, "B");
    assert.deepEqual([ok.status, (ok.body as Json).text, (ok.body as Json).check, (ok.body as Json).file], [200, B1, "places", "B.lean"]);
    const no = pastSource(h, 3, "A");
    assert.deepEqual([no.status, (no.body as Json).kept], [404, false]);
    assert.match((no.body as Json).error, /not kept: no text with the hash/);
    assert.equal(pastSource(h, 1, "Nope").status, 404);
  } finally {
    R.close();
    for (const d of after) rmSync(d, { recursive: true, force: true });
  }
});

test("the agents' source at a snapshot: the text of then, found by its name now too, and saying when it is not kept", async () => {
  const S = await site();
  try {
    const h = S.live.history!;
    const old = "namespace N\n\n/-- Zero. -/\ndef a : Nat := 0\n\ndef old : Nat := a\nend N\n";
    const g = graphOf({ M: old });
    g.nodes = units("M", old, "N");
    h.record(g, { at: T0, fingerprint: "s1", commit: { hash: "c100000", branch: "main" }, toolchain: "tc", missing: [] });
    h.setSources(1, { M: { file: "M.lean", lake: lakeTextHash(old), blob: h.sources.put(old).blob, check: "lake", from: "tree" } }, 0);
    h.record({ ...g, nodes: g.nodes.map((n) => ({ ...n, hash: `${n.hash}-2` })) }, { at: T0 + 60_000, fingerprint: "s2", commit: null, toolchain: "tc", missing: [] });
    h.setSources(2, { M: { file: "M.lean", lake: "0", why: "its file was edited after the build" } }, 0);
    // N.old is N.b now
    S.live.renamesBetween = () => new Map([["N.old", "N.b"]]);
    const token = S.live.tokens.create({ name: "Claude", by: "Alice", level: "read", days: 1 }).token;
    const ask = (q: string) => S.ask("GET", `/api/agent/source?${q}`, undefined, { authorization: `Bearer ${token}` });
    const then = await ask("name=N.a&snapshot=1");
    assert.equal(then.status, 200, JSON.stringify(then.json));
    assert.deepEqual([then.json!.text, then.json!.line, then.json!.endLine, then.json!.check, then.json!.snapshot.id, then.json!.compiled], ["/-- Zero. -/\ndef a : Nat := 0", 3, 4, "lake", 1, true]);
    assert.match(then.json!.context, /namespace N/);
    const renamed = await ask("name=N.b&snapshot=1");
    assert.deepEqual([renamed.status, renamed.json!.name, renamed.json!.asked, renamed.json!.text], [200, "N.old", "N.b", "def old : Nat := a"]);
    const lost = await ask("name=N.a&snapshot=2");
    assert.deepEqual([lost.status, lost.json!.kept, lost.json!.statement], [404, false, "Nat"]);
    assert.match(lost.json!.error, /not kept: its file was edited after the build/);
    assert.equal((await ask("name=N.a&snapshot=9")).status, 404);
    assert.equal((await ask("name=N.zzz&snapshot=1")).status, 404);
    // without a snapshot, the graph on show's, as before (whose declarations here record no place)
    const now = await ask("name=N.a");
    assert.equal(now.json!.snapshot, undefined);
    assert.match(now.json!.error, /records no place/);
    // the endpoint reference and the MCP tool say so
    const listed = (await S.ask("GET", "/api/agent/endpoints?path=source", undefined, { authorization: `Bearer ${token}` })).json!;
    assert.ok(listed.endpoints[0].params.snapshot);
    const tools = (await S.ask("GET", "/api/agent/mcp/tools", undefined, { authorization: `Bearer ${token}` })).json!.tools as Json[];
    assert.equal(tools.find((t) => t.name === "source")!.inputSchema.properties.snapshot.type, "integer");
  } finally {
    await S.close();
  }
});
