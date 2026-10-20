// The document of a view at a past build (ExportSpec decision 16, the owner's of 2026-10-10): what
// the board of that build shows — its declarations the view's scope holds on the past graph, which
// holds that build's alone — in the sections of its cluster structure, each declaration with the text that
// build compiled, its statement where that text is not kept; the head card says the build, its
// commit and how its texts were had, and the title the build. Agents export it by the view's id; the
// page's window and the server no longer refuse it.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildDoc, docNotes, printedDecls } from "../src/shared/doc/build.ts";
import type { DocInput, DocSource } from "../src/shared/doc/build.ts";
import { NOT_KEPT_NOTE, renderLatex } from "../src/shared/doc/latex.ts";
import type { DeclEntry, DocModel, Item, Section } from "../src/shared/doc/model.ts";
import { planDoc } from "../src/shared/doc/sections.ts";
import { DEFAULT_SETTINGS } from "../src/shared/doc/settings.ts";
import type { RawGraph, RawNode, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_BODY, SITE_STMT } from "../src/shared/graph.ts";
import { pastGraph } from "../src/shared/pastgraph.ts";
import type { HistoryDiff, SnapshotNodes } from "../src/shared/pastgraph.ts";
import { evaluate, parseQuery } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import { fullWhen, namesOf } from "../src/shared/titles.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { Exporter } from "../src/server/export.ts";
import { lakeTextHash } from "../src/server/status.ts";
import { ExportModal } from "../src/web/src/exportmodal.ts";
import type { ExportView } from "../src/web/src/exportmodal.ts";
import { site, SOURCE } from "./site.ts";
import type { Json } from "./site.ts";

const T0 = Date.parse("2026-10-09T20:27:00Z");

// ------------------------------------------------------------------- a past build and the graph now

/** The texts the past build compiled: P.Core (kept, by its hash), P.Use (kept, matched by its places);
 *  P.Lost's is not kept. */
const CORE = [
  "namespace P",
  "",
  "/-- The size, as it was then. -/",
  "def size (n : Nat) : Nat := n + 1",
  "",
  "theorem size_pos (n : Nat) : 0 < size n := by",
  "  simp [size]",
  "",
  "/-- A small number. -/",
  "def bounded : { n : Nat // n < 5 } := ⟨3, by decide⟩",
  "",
  "end P",
  "",
].join("\n");
const USE = ["namespace P", "", "def twice (n : Nat) : Nat := size n + size n", "", "end P", ""].join("\n");
const TEXTS: Record<string, { text: string; check: "lake" | "places" }> = { "P.Core": { text: CORE, check: "lake" }, "P.Use": { text: USE, check: "places" } };
const FILES: Record<string, string> = { "P.Core": "P/Core.lean", "P.Use": "P/Use.lean", "P.Lost": "P/Lost.lean", "P.Fresh": "P/Fresh.lean" };

/** Where `word` is declared in `text`: its line to the end of its block, 1-based. */
function place(text: string, word: string): [number, number, number, number] {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => new RegExp(`^(def|theorem) ${word}\\b`).test(l));
  assert.ok(at >= 0, word);
  let end = at;
  while (end + 1 < lines.length && lines[end + 1].trim() && !/^(\/--|def|theorem|end)/.test(lines[end + 1])) end++;
  return [at + 1, 0, end + 1, lines[end].length];
}

/** The snapshot of the past build as the page takes it (GET /api/history/graph), the graph now, and
 *  what changed between them: P.size changed since, P.fresh (in a module of its own) is new since. */
function builds() {
  const node = (name: string, kind: ViewNode["kind"], module: string, more: Partial<ViewNode> = {}): ViewNode => ({ name, kind, module, ax: 0, hash: `v-${name}`, type: `type of ${name}`, ...more });
  const then: ViewNode[] = [
    node("P.size", "def", "P.Core", { range: place(CORE, "size"), doc: "The size, as it was then.", type: "Nat → Nat" }),
    node("P.size_pos", "theorem", "P.Core", { range: place(CORE, "size_pos"), type: "∀ (n : Nat), 0 < P.size n" }),
    node("P.bounded", "def", "P.Core", { range: place(CORE, "bounded"), doc: "A small number." }),
    node("P.twice", "def", "P.Use", { range: place(USE, "twice"), type: "Nat → Nat" }),
    node("P.lost", "def", "P.Lost", { range: [3, 0, 3, 20], type: "Nat" }),
    { name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0, ext: true },
  ];
  const at = (ns: ViewNode[], n: string) => ns.findIndex((v) => v.name === n);
  const thenEdges = [at(then, "P.size_pos"), at(then, "P.size"), SITE_STMT, at(then, "P.twice"), at(then, "P.size"), SITE_BODY, at(then, "P.size"), at(then, "Nat"), SITE_STMT];
  const snap: SnapshotNodes = {
    snapshot: { id: 1, at: new Date(T0).toISOString(), read: "", commit: { hash: "fb28396d1e2c", branch: "main", dirty: true }, toolchain: "leanprover/lean4:v4.33.0", missing: [], counts: { modules: 3, nodes: 5, edges: 3, externals: 1 } },
    modules: [{ name: "P.Core", imports: [] }, { name: "P.Use", imports: ["P.Core"] }, { name: "P.Lost", imports: [] }],
    nodes: then,
    projectCount: 5,
    axioms: [],
    axiomSets: [[]],
    edgeCount: 3,
    sources: { "P.Core": "lake", "P.Use": "places" },
  };
  // now: P.size another version, P.fresh new in P.Fresh, using P.twice
  const nowNodes: ViewNode[] = [...then.slice(0, 5).map((v) => (v.name === "P.size" ? { ...v, hash: "v-P.size-2" } : v)), node("P.fresh", "def", "P.Fresh", { range: [1, 0, 1, 30] }), then[5]];
  const nowEdges = [...thenEdges.map((x, k) => (k % 3 === 2 ? x : x === 5 ? 6 : x)), at(nowNodes, "P.fresh"), at(nowNodes, "P.twice"), SITE_BODY];
  const meta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "pastproj", root: "/nowhere", roots: ["P"], toolchain: "leanprover/lean4:v4.33.1", extractedAt: "", extractMs: 1 },
    modules: Object.keys(FILES).map((name) => ({ name, file: FILES[name], imports: [] })),
    nodes: nowNodes,
    projectCount: 6,
    axioms: [],
    axiomSets: [[]],
    layouts: {},
    edgeCount: nowEdges.length / 3,
  } as unknown as ViewMeta;
  const now = new Graph(meta, new Int32Array(nowEdges));
  const diff: HistoryDiff = { from: 1, to: 2, counts: { added: 1, removed: 0, changed: 1, renamed: 0 }, added: ["P.fresh"], removed: [], changed: ["P.size"], renamed: [] };
  const past = pastGraph(snap, new Int32Array(thenEdges), now, diff);
  const source = (m: string): DocSource | null => (TEXTS[m] ? { lines: TEXTS[m].text.split("\n"), edited: false, contexts: null, hash: null, check: TEXTS[m].check } : null);
  const input = (scope: string, over: Partial<DocInput> = {}): DocInput => ({
    g: past.graph,
    review: emptyReview(),
    view: { id: "v-past", name: null, scope: parseQuery(scope), clustering: "namespace", hidden: [], authors: ["Alice"], version: 1 },
    settings: { ...DEFAULT_SETTINGS },
    source,
    fileOf: (m) => FILES[m] ?? null,
    build: { fingerprint: "s1", commit: { hash: "fb28396d1e2c", branch: "main", dirty: true }, toolchain: "leanprover/lean4:v4.33.0" },
    past: { snapshot: 1, at: snap.snapshot.at, when: fullWhen(snap.snapshot.at) },
    titles: { names: namesOf(now), build: () => "Oct 9 22:27" },
    ...over,
  });
  return { past, now, input };
}

const codeText = (e: DeclEntry) => e.code.lines.map((l) => l.map((t) => t[1]).join("")).join("\n");
const sectionsIn = (xs: readonly Item[]): Section[] => xs.flatMap((x) => (x.t === "section" ? [x.section] : []));
/** A document's sections as [title, level, the names printed directly, by name], depth first: their
 *  order is the board's (test/exportorder.test.ts). */
const outline = (xs: readonly Item[]): [string, number, string[]][] =>
  sectionsIn(xs).flatMap((s) => [[s.title, s.level, s.items.flatMap((x) => (x.t === "decl" ? [x.decl.name] : [])).sort()] as [string, number, string[]], ...outline(s.items)]);
const byName = (doc: DocModel, name: string) => printedDecls(doc).find((e) => e.name === name)!;

test("a past view's document is that build's: its declarations on the past board, in its sections, each with its text then; nothing new since", () => {
  const { past, input } = builds();
  const doc = buildDoc(input("ns(P)"));
  assert.equal(doc.version, 11);
  // the set: what the scope holds on the past graph, which does not hold P.fresh (new since)
  assert.equal(past.graph.byName.get("P.fresh"), undefined, "the past graph holds that build's declarations alone");
  assert.deepEqual(printedDecls(doc).map((e) => e.name).sort(), ["P.bounded", "P.lost", "P.size", "P.size_pos", "P.twice"]);
  assert.equal(doc.count.declarations, 5);
  // sections: by namespace, one, in the order of that build's board
  assert.deepEqual(outline(doc.items), [["P", 1, ["P.bounded", "P.lost", "P.size", "P.size_pos", "P.twice"]]]);
  // by file, with the levels hidden as the view hides them: P.Fresh, which only what is new since
  // is in, is no section
  const plan = planDoc(past.graph, evaluate(parseQuery("ns(P)"), { g: past.graph, review: emptyReview() }), "module", []);
  assert.equal(plan.count, 5);
  const byFile = buildDoc(input("ns(P)", { view: { ...input("ns(P)").view, clustering: "module", hidden: ["P"] } }));
  assert.deepEqual(outline(byFile.items).map(([t]) => t).sort(), ["Core", "Lost", "Use"]);
  // the text of then: P.size as that build compiled it (it is n + 2 now), at that build's line, its
  // docstring as prose and not again in the code
  const size = byName(doc, "P.size");
  assert.equal(codeText(size), "def size (n : Nat) : Nat := n + 1");
  assert.deepEqual([size.line, size.file, size.code.from, size.code.places, size.code.notKept], [4, "P/Core.lean", "source", undefined, undefined]);
  assert.deepEqual(size.doc, [{ t: "p", inl: [{ t: "text", s: "The size, as it was then." }] }]);
  // proofs: a theorem cut after its statement; a definition's found by reading its text, the usage
  // pass's places being the latest build's
  assert.equal(codeText(byName(doc, "P.size_pos")), "theorem size_pos (n : Nat) : 0 < size n := …");
  const bounded = byName(doc, "P.bounded");
  assert.equal(codeText(bounded), "def bounded : { n : Nat // n < 5 } := ⟨3, …⟩");
  assert.deepEqual([bounded.code.textCut, bounded.code.proofsCut], ["past", 1]);
  // a text matched by its places is printed, marked in the model for whoever wants to know
  const twice = byName(doc, "P.twice");
  assert.deepEqual([codeText(twice), twice.code.places], ["def twice (n : Nat) : Nat := size n + size n", true]);
  // a declaration whose text then is not kept: its statement then, said so; never the latest's text
  const lost = byName(doc, "P.lost");
  assert.deepEqual([codeText(lost), lost.code.from, lost.code.notKept], ["def P.lost : Nat", "statement", true]);
  // the head card: the build and its commit, the toolchain then, how the texts were had
  assert.deepEqual(doc.head.past, { snapshot: 1, at: new Date(T0).toISOString(), when: fullWhen(T0), places: 1, notKept: 1 });
  assert.deepEqual(doc.head.commit, { hash: "fb28396d1e2c", branch: "main", dirty: true });
  assert.equal(doc.head.toolchain, "leanprover/lean4:v4.33.0");
  // the title says the build, as the view's does
  assert.equal(doc.head.title, "Namespace P @ Oct 9 22:27");
  assert.equal(doc.view.title, "ns P @ Oct 9 22:27");
  // the export's notes name what the document only counts or says under each
  const notes = docNotes(doc).join("\n");
  assert.match(notes, /The proofs inside the 3 definitions printed were found by reading the text, since it is a past build's/);
  assert.match(notes, /The text of 1 declaration of this build was matched to it by the places the build recorded.*P\.twice/);
  assert.match(notes, /The text of 1 declaration at this build is not kept, and its statement is printed instead: P\.lost\./);
  assert.doesNotMatch(notes, /printed from the graph's statement/, "a text not kept is said as such, not as a statement read for want of a source");
});

test("a past document's LaTeX: the build and its commit on the head card, places counted once, a note under what is not kept", () => {
  const { input } = builds();
  const tex = renderLatex(buildDoc(input("ns(P)")));
  assert.match(tex, /\\vpTitle\{Namespace P @ Oct 9 22:27\}\{Alice\}/);
  assert.ok(tex.includes(`\\vpCardRow{Build}{${fullWhen(T0)}}`), "the build's time, not its fingerprint");
  assert.match(tex, /\\vpCardRow\{Commit\}\{\\vpMono\{fb28396\} on \\vpMono\{main\}, edited\}/);
  assert.match(tex, /\\vpCardRow\{Source text\}\{as this build compiled it; for 1 declaration matched to the build by the places it recorded, its hash not being kept; not kept for 1 declaration, whose statement is printed instead\}/);
  assert.match(tex, /\\vpCardRow\{Toolchain\}\{\\vpMono\{leanprover\/lean4:v4.33.0\}\}/);
  // one note, under the declaration whose text is not kept; none per place-matched declaration
  assert.equal(tex.split("\\vpDeclNote{").length - 1, 1);
  const lost = tex.slice(tex.indexOf("\\begin{vpDecl}{vp:P.2e.lost}"));
  assert.ok(lost.slice(0, lost.indexOf("\\end{vpDecl}")).includes(`\\vpDeclNote{${NOT_KEPT_NOTE}}`));
  assert.ok(!tex.includes("n + 2"), "never the latest build's text");
  // the latest build's card is as before: its fingerprint, its commit in full, no source row
  const { input: latest } = builds();
  const now = renderLatex(buildDoc({ ...latest("ns(P)"), past: undefined, build: { fingerprint: "55f2cfb7", commit: { hash: "e57f4170abc", branch: "main" } } }));
  assert.match(now, /\\vpCardRow\{Build\}\{\\vpMono\{55f2cfb7\}\}/);
  assert.match(now, /\\vpCardRow\{Commit\}\{\\vpMono\{e57f4170abc\} on \\vpMono\{main\}\}/);
  assert.ok(!now.includes("Source text"));
});

test("a past document typesets", { skip: !new Exporter(tmpdir()).available() && "xelatex is not installed" }, async () => {
  const { input } = builds();
  const state = mkdtempSync(join(tmpdir(), "vp-pastdoc-"));
  try {
    const ex = new Exporter(state);
    const doc = buildDoc(input("ns(P)", { view: { ...input("ns(P)").view, clustering: "module" } }));
    const job = ex.compile(renderLatex(doc), docNotes(doc));
    const done = await ex.wait(job.id);
    assert.equal(done?.state, "done", done?.log);
    assert.equal(ex.file(job.id, "pdf")?.body.subarray(0, 5).toString(), "%PDF-");
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------- through the server

/** The site's module M as a build would record it from `text`: each `def` with the doc comment
 *  above it, its range from its line to the end of its block, in namespace N. */
function units(module: string, text: string): RawNode[] {
  const lines = text.split("\n");
  const out: RawNode[] = [];
  lines.forEach((l, i) => {
    const m = /^def (\S+)/.exec(l);
    if (!m) return;
    const doc = /^\/--(.*)-\/$/.exec(lines[i - 1] ?? "")?.[1].trim();
    out.push({ name: `N.${m[1]}`, kind: "def", module, type: "Nat", ax: 0, hash: `k-${m[1]}-${l}`, range: [i + 1, 0, i + 1, [...l].length], ...(doc ? { doc } : {}) });
  });
  return out;
}

function raw(nodes: RawNode[], modules: string[], edges: [number, number, number][]): RawGraph {
  return { schema: 1, roots: ["M"], modules: modules.map((name) => ({ name, imports: [] })), nodes, externals: [], edges, axioms: [], axiomSets: [[]], stats: { folded: 0, metaDropped: 0, ms: 0 } };
}

test("agents export a view kept at a past build by its id, as any view, and a view at the build the Time Machine shows; nothing refuses it", async () => {
  const S = await site({ exporter: true });
  try {
    const h = S.live.history!;
    // build 1: M as it was then (N.a then, N.old, gone since), and Q, whose text is not kept
    const OLD = "namespace N\n/-- Zero, then. -/\ndef a : Nat := 7\ndef old : Nat := a\nend N\n";
    const then = [...units("M", OLD), { name: "N.q", kind: "def" as const, module: "Q", type: "Nat → Nat", ax: 0, hash: "k-q", range: [2, 0, 2, 9] as [number, number, number, number] }];
    h.record(raw(then, ["M", "Q"], [[1, 0, SITE_BODY]]), { at: T0, fingerprint: "s1", commit: { hash: "fb28396d1e2c", branch: "main", dirty: true }, toolchain: "tc-then", missing: [] });
    h.setSources(1, { M: { file: "M.lean", lake: lakeTextHash(OLD), blob: h.sources.put(OLD).blob, check: "lake", from: "tree" }, Q: { file: "Q.lean", lake: "0", why: "its file was edited after the build" } }, 0);
    // build 2: the graph on show
    h.record(raw(units("M", SOURCE), ["M"], [[1, 0, SITE_BODY]]), { at: T0 + 3_600_000, fingerprint: "f", commit: { hash: "e57f4170abc", branch: "main" }, toolchain: "tc", missing: [] });
    h.setSources(2, { M: { file: "M.lean", lake: lakeTextHash(SOURCE), blob: h.sources.put(SOURCE).blob, check: "lake", from: "tree" } }, 0);
    const agent = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };
    // a view at build 1 nobody named, as Zoom in on a past board opens one
    const id = S.live.views.book.open(parseQuery("ns(N)"), "Alice", Date.now(), { version: 1 }).view.id;
    // the model, by the view's id as any view's: that build's document
    const model = await S.ask("GET", `/api/agent/export?view=${id}`, undefined, agent);
    assert.equal(model.status, 200, JSON.stringify(model.json));
    const doc = model.json as Json;
    assert.equal(doc.head.past.snapshot, 1);
    assert.deepEqual([doc.head.past.places, doc.head.past.notKept], [0, 1]);
    assert.deepEqual(doc.head.commit, { hash: "fb28396d1e2c", branch: "main", dirty: true });
    assert.equal(doc.head.toolchain, "tc-then");
    assert.match(doc.head.title, /^Namespace N @ /);
    const printed = (doc.items as Json[]).flatMap((x: Json) => (x.t === "section" ? x.section.items : [x])).filter((x: Json) => x.t === "decl").map((x: Json) => x.decl).sort((a: Json, b: Json) => (a.name < b.name ? -1 : 1)) as Json[];
    // N.b is new since: not of that build, on none of its boards
    assert.deepEqual(printed.map((e) => e.name), ["N.a", "N.old", "N.q"]);
    const text = (e: Json) => e.code.lines.map((l: [string, string][]) => l.map((t) => t[1]).join("")).join("\n");
    assert.deepEqual(printed.map(text), ["def a : Nat := 7", "def old : Nat := a", "def N.q : Nat → Nat"]);
    assert.deepEqual([printed[2].code.notKept, printed[0].code.notKept], [true, undefined]);
    // the window's head says the same title; the Project at a build the Time Machine shows, and at
    // the latest again
    assert.equal((await S.ask("GET", `/api/export/head?view=${id}`)).json?.title, doc.head.title);
    const tm = (await S.ask("GET", "/api/agent/export?view=project&version=1", undefined, agent)).json as Json;
    assert.deepEqual([tm.head.past.snapshot, tm.head.title, tm.count.declarations], [1, "Project", 3]);
    const latest = (await S.ask("GET", `/api/agent/export?view=${id}&version=0`, undefined, agent)).json as Json;
    assert.deepEqual([latest.head.past, latest.head.title, latest.count.declarations], [null, "Namespace N", 2]);
    assert.equal((await S.ask("GET", `/api/export/head?view=${id}&version=0`)).json?.title, "Namespace N");
    assert.equal((await S.ask("GET", `/api/agent/export?view=${id}&version=9`, undefined, agent)).status, 404);
    assert.equal((await S.ask("GET", `/api/agent/export?view=${id}&version=x`, undefined, agent)).status, 400);
    if (!S.app.exporter!.available()) return;
    // typeset, through the agents' API: nothing refuses it
    const started = await S.ask("POST", "/api/agent/export", { view: id }, agent);
    assert.ok(started.status === 202 || started.status === 200, JSON.stringify(started.json));
    let job: Json = started.json!.job;
    for (let k = 0; k < 120 && job.state === "running"; k++) {
      await new Promise((ok) => setTimeout(ok, 250));
      job = (await S.ask("GET", `/api/agent/export/job?id=${job.id}`, undefined, agent)).json!.job;
    }
    assert.equal(job.state, "done", job.log);
    assert.ok(job.notes.some((n: string) => /not kept.*N\.q/.test(n)), job.notes.join("\n"));
    const tex = await (await fetch(`${S.base}/api/agent/export/file?id=${job.id}&what=tex`, { headers: agent })).text();
    assert.match(tex, /\\vpCardRow\{Commit\}\{\\vpMono\{fb28396\} on \\vpMono\{main\}, edited\}/);
    assert.match(tex, /\\vpDeclNote\{/);
  } finally {
    await S.close();
  }
});

test("a past build's document follows that build's board: pins dropped on it reorder the document, and the notes it shows print", async () => {
  const S = await site({ exporter: true });
  try {
    const h = S.live.history!;
    const OLD = "namespace N\ndef a : Nat := 7\ndef old : Nat := a\ndef c : Nat := 1\nend N\n";
    h.record(raw(units("M", OLD), ["M"], [[1, 0, SITE_BODY]]), { at: T0, fingerprint: "s1", commit: { hash: "fb28396d1e2c", branch: "main" }, toolchain: "tc-then", missing: [] });
    h.setSources(1, { M: { file: "M.lean", lake: lakeTextHash(OLD), blob: h.sources.put(OLD).blob, check: "lake", from: "tree" } }, 0);
    h.record(raw(units("M", SOURCE), ["M"], [[1, 0, SITE_BODY]]), { at: T0 + 3_600_000, fingerprint: "f", commit: { hash: "e57f4170abc", branch: "main" }, toolchain: "tc", missing: [] });
    h.setSources(2, { M: { file: "M.lean", lake: lakeTextHash(SOURCE), blob: h.sources.put(SOURCE).blob, check: "lake", from: "tree" } }, 0);
    const agent = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };
    const V = S.live.views;
    const id = V.book.open(parseQuery("ns(N)"), "Alice", Date.now(), { version: 1 }).view.id;
    // a note of the project in N, low in its circle
    assert.equal(V.arrangeNotes([{ op: "pnote", note: { id: "nlow", text: "Start with `N.a`.", places: { namespace: { in: [["N", 0, 0.9]] } }, open: true, by: "Alice", at: new Date().toISOString() } }], null, "Alice"), null);
    const order = async () => {
      const m = await S.ask("GET", `/api/agent/export?view=${id}`, undefined, agent);
      assert.equal(m.status, 200, JSON.stringify(m.json));
      assert.equal(m.json!.head.past.snapshot, 1);
      const sec = (m.json!.items as Json[]).find((x) => x.t === "section")!.section;
      return (sec.items as Json[]).map((x) => (x.t === "decl" ? x.decl.name : x.note.id));
    };
    const pin = (a: number, old: number) =>
      V.book.arrange(id, [
        { op: "pin", mode: "namespace", kind: "node", key: "N.a", at: [0, a] },
        { op: "pin", mode: "namespace", kind: "node", key: "N.old", at: [0, old] },
      ], "Alice", { by: "Alice" });
    // a dropped low, old high: a first; the note, lower still, before it, naming it
    pin(9, -9);
    const first = await order();
    assert.ok(first.indexOf("N.a") < first.indexOf("N.old"), first.join(", "));
    assert.ok(first.includes("note:nlow"));
    // the other way round
    pin(-9, 9);
    const second = await order();
    assert.ok(second.indexOf("N.old") < second.indexOf("N.a"), second.join(", "));
  } finally {
    await S.close();
  }
});

// ------------------------------------------------------------------- the page's window

/** Just enough of an element for the Export window to draw into. */
function box() {
  return { hidden: true, innerHTML: "", classList: { add() {}, remove() {} }, addEventListener() {}, querySelector: () => null, title: "" } as unknown as HTMLElement;
}

test("the Export window of a past board says its build, and offers Generate", async () => {
  const el = box();
  const asked: unknown[] = [];
  const view: ExportView = { id: "v-past", title: "ns P @ Oct 9 22:27", heading: "Namespace P @ Oct 9 22:27", fixed: false, plan: { count: 5, sectionCount: 1, outside: { count: 0, by: [] } }, version: 1, when: "Oct 9 22:27" };
  const modal = new ExportModal(box(), el, {
    view: () => view,
    saved: () => undefined,
    save: () => {},
    head: async (v, version) => (asked.push([v, version]), { title: "Namespace P @ Oct 9 22:27", author: "" }),
    start: async () => "not here",
    poll: async () => "not here",
  });
  modal.open();
  await new Promise((ok) => setTimeout(ok, 0));
  const html = el.innerHTML;
  assert.match(html, /Export the view <b[^>]*>“ns P @ Oct 9 22:27”<\/b> at the build of <b>Oct 9 22:27<\/b>/);
  assert.ok(!/new since/.test(html), "nothing new since is on a past board, nor said");
  assert.match(html, /As of the build of <b>Oct 9 22:27<\/b>\./);
  assert.match(html, /<button class="rv-btn primary" data-ex-go>Generate<\/button>/, "Generate is offered");
  assert.ok(!/past build, which is not exported/.test(html));
  assert.deepEqual(asked, [["v-past", 1]], "the head is asked at the build on show");
});

test("the Export window follows the board on show: another view, or the view at another build, is the one it tells of and exports; a document made of the one before is put away", async () => {
  const el = box();
  const plan = (count: number) => ({ count, sectionCount: 1, outside: { count: 0, by: [] } });
  let view: ExportView = { id: "va", title: "A", heading: "A", fixed: false, plan: plan(3) };
  const asked: unknown[] = [];
  const started: unknown[] = [];
  const modal = new ExportModal(box(), el, {
    view: () => view,
    saved: () => undefined,
    save: () => {},
    head: async (v, version) => (asked.push([v, version]), { title: `Title of ${v}`, author: "" }),
    start: async (body) => (started.push(body), { id: "j1", state: "done", pages: 2, ms: 900 }),
    poll: async () => "not here",
  });
  const tick = () => new Promise((ok) => setTimeout(ok, 0));
  modal.open();
  await tick();
  (modal as unknown as { generate(): Promise<void> }).generate();
  await tick();
  assert.match(el.innerHTML, /Download PDF/);
  // the same view, more on its board: told, the document made kept
  view = { ...view, plan: plan(4) };
  modal.boardChanged();
  assert.match(el.innerHTML, /<b>4<\/b> declarations/);
  assert.match(el.innerHTML, /Download PDF/);
  // another view: its title asked for, the document of the one before gone, Generate exports it
  view = { id: "vb", title: "B", heading: "B", fixed: false, plan: plan(2) };
  modal.boardChanged();
  assert.match(el.innerHTML, /Export the view <b[^>]*>“B”<\/b>/);
  assert.ok(!/Download PDF/.test(el.innerHTML), "A's document is put away");
  await tick();
  assert.match(el.innerHTML, /Title of vb/);
  (modal as unknown as { generate(): Promise<void> }).generate();
  await tick();
  assert.equal((started.at(-1) as { view: string }).view, "vb");
  // the Time Machine's preview of it at another build is another document
  view = { ...view, version: 1, when: "Oct 9 22:27" };
  modal.boardChanged();
  assert.ok(!/Download PDF/.test(el.innerHTML));
  assert.deepEqual(asked, [["va", undefined], ["vb", undefined], ["vb", 1]]);
  // closed, it follows nothing
  modal.close();
  view = { id: "vc", title: "C", heading: "C", fixed: false, plan: plan(1) };
  modal.boardChanged();
  assert.equal(asked.length, 3);
});

test("a typesetting that fails, or a request refused, says why in one sentence", async () => {
  for (const [said, shown] of [
    ["XeLaTeX: Undefined control sequence.", "Typesetting failed: XeLaTeX: Undefined control sequence."],
    ["There is no view vx.", "Typesetting failed: There is no view vx."],
    ["the server could not be reached", "Typesetting failed: the server could not be reached."],
  ]) {
    const el = box();
    const modal = new ExportModal(box(), el, {
      view: () => ({ id: "va", title: "A", heading: "A", fixed: false, plan: { count: 3, sectionCount: 1, outside: { count: 0, by: [] } } }),
      saved: () => undefined,
      save: () => {},
      head: async () => ({ title: "A", author: "" }),
      start: async () => said.startsWith("XeLaTeX") ? { id: "j", state: "failed", error: said } : said,
      poll: async () => "not here",
    });
    modal.open();
    await (modal as unknown as { generate(): Promise<void> }).generate();
    assert.ok(el.innerHTML.includes(`<div class="banner bad">${shown}</div>`), el.innerHTML);
  }
});

test("a document asked for before the window closed is not shown when it opens again, on another view", async () => {
  const el = box();
  const plan = { count: 3, sectionCount: 1, outside: { count: 0, by: [] } };
  let view: ExportView = { id: "va", title: "A", heading: "A", fixed: false, plan };
  let answer: (j: { id: string; state: "done"; pages: number; ms: number }) => void = () => {};
  const modal = new ExportModal(box(), el, {
    view: () => view,
    saved: () => undefined,
    save: () => {},
    head: async () => ({ title: view.title, author: "" }),
    // typesetting A takes a while
    start: () => new Promise((ok) => (answer = ok)),
    poll: async () => "not here",
  });
  modal.open();
  const going = (modal as unknown as { generate(): Promise<void> }).generate();
  modal.close();
  view = { id: "vb", title: "B", heading: "B", fixed: false, plan };
  modal.open();
  answer({ id: "jA", state: "done", pages: 2, ms: 900 });
  await going;
  assert.match(el.innerHTML, /“B”/);
  assert.ok(!/Download PDF|jA/.test(el.innerHTML), "A's document is not B's window's");
});
