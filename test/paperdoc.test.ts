// The exported document's references (ExportSpec decision 17, AttachmentSpec decision 10): a
// declaration's links print under it and a cluster's under its section, "Reference: Theorem 3
// [title, p. 12]", and the files they cite are listed at the end under "References" with where they
// came from — on a view of a past build too, a link on a declaration renamed since read under its
// name then.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { applyLibrary } from "../src/shared/library.ts";
import type { LibraryEvent } from "../src/shared/library.ts";
import { buildDoc } from "../src/shared/doc/build.ts";
import type { DocInput } from "../src/shared/doc/build.ts";
import type { DeclEntry, Item, Section } from "../src/shared/doc/model.ts";
import { renderLatex } from "../src/shared/doc/latex.ts";
import { DEFAULT_SETTINGS } from "../src/shared/doc/settings.ts";
import { parseQuery } from "../src/shared/query.ts";
import { reviewThen } from "../src/shared/pastgraph.ts";
import { emptyReview } from "../src/shared/review.ts";
import type { ReviewData } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { Exporter } from "../src/server/export.ts";

/** Namespace N with a and b (b uses a), one outside declaration. */
function graph(names = ["N.a", "N.b"]): Graph {
  const nodes: ViewNode[] = [
    { name: names[0], kind: "def", module: "M", ax: 0, hash: "ha", type: "Nat" },
    { name: names[1], kind: "theorem", module: "M", ax: 0, hash: "hb", type: "a = a" },
    { name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0, ext: true },
  ];
  const edges = new Int32Array([1, 0, SITE_STMT, 0, 2, SITE_STMT]);
  const meta: ViewMeta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: "/nowhere", roots: ["M"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [{ name: "M", file: "M.lean", imports: [] }],
    nodes,
    projectCount: 2,
    axioms: [],
    axiomSets: [[]],
    layouts: { namespace: computeLayout("namespace", nodes, edges), module: computeLayout("module", nodes, edges) } as Record<ClusterMode, Layout>,
    edgeCount: 2,
  };
  return new Graph(meta, edges);
}

const A = "a".repeat(64), B = "b".repeat(64);

function review(): ReviewData {
  const d = emptyReview();
  const ev = (e: object, k: number) => applyLibrary(d, { at: `2026-10-11T10:00:0${k}.000Z`, by: "Alice", ...e } as LibraryEvent);
  ev({ op: "file", sha: A, title: "The {Lean} Mathematical Library", type: "pdf", size: 9, pages: 21, url: "https://arxiv.org/pdf/1910.09336" }, 0);
  ev({ op: "file", sha: B, title: "Lecture notes", type: "pdf", size: 9, pages: 4, name: "notes_v2.pdf" }, 1);
  ev({ op: "link", id: "l000000000001", subject: "decl(N.b)", file: B, page: 3, label: "Lemma 2" }, 2);
  ev({ op: "link", id: "l000000000002", subject: "decl(N.b)", file: A, page: 10, label: "Theorem 8" }, 3);
  ev({ op: "link", id: "l000000000003", subject: "ns(N)", file: A, page: 9, label: "Section 3.4" }, 4);
  ev({ op: "link", id: "l000000000004", subject: "decl(N.zzz)", file: A, page: 1, label: "gone" }, 5);
  return d;
}

const sectionsIn = (xs: readonly Item[]): Section[] => xs.flatMap((x) => (x.t === "section" ? [x.section] : []));
const declsIn = (xs: readonly Item[]): DeclEntry[] => xs.flatMap((x) => (x.t === "decl" ? [x.decl] : []));

const input = (g: Graph, d: ReviewData): DocInput => ({
  g,
  review: d,
  view: { id: "v", name: "Example", scope: parseQuery("all"), clustering: "namespace", hidden: [], authors: [] },
  settings: DEFAULT_SETTINGS,
  source: () => null,
  fileOf: () => "M.lean",
  build: { fingerprint: "f", commit: null },
});

test("a declaration's papers print under it and a cluster's under its section, each citing its file, the files listed at the end in the order first cited", () => {
  const doc = buildDoc(input(graph(), review()));
  const section = sectionsIn(doc.items)[0];
  assert.equal(section.key, "N");
  assert.deepEqual(section.papers, [{ label: "Section 3.4", page: 9, ref: 1 }]);
  const b = declsIn(section.items).find((e) => e.name === "N.b")!;
  assert.deepEqual(b.papers, [
    { label: "Lemma 2", page: 3, ref: 2 },
    { label: "Theorem 8", page: 10, ref: 1 },
  ]);
  assert.equal(declsIn(section.items).find((e) => e.name === "N.a")!.papers, undefined);
  assert.deepEqual(doc.references, [
    { n: 1, sha: A, title: "The {Lean} Mathematical Library", type: "pdf", pages: 21, url: "https://arxiv.org/pdf/1910.09336" },
    { n: 2, sha: B, title: "Lecture notes", type: "pdf", pages: 4, name: "notes_v2.pdf" },
  ]);
  const tex = renderLatex(doc);
  assert.match(tex, /\\begin\{vpSectionPapers\}\n\\vpPaper\{Section 3\.4\}\{The \\\{Lean\\\} Mathematical Library\}\{9\}\{1\}\n\\end\{vpSectionPapers\}/);
  assert.match(tex, /\\vpPaper\{Lemma 2\}\{Lecture notes\}\{3\}\{2\}/);
  assert.match(tex, /\\vpReference\{2\}\{Lecture notes\}\{uploaded as notes\\_v2\.pdf\}\{PDF, 4 pages\}\{bbbbbbbbbbbbbbbb\}/);
  assert.match(tex, /\\vpReference\{1\}.*\\vpUrl\{https:/);
  assert.ok(tex.indexOf("\\begin{vpReferences}") > tex.indexOf("\\vpPaper{Lemma 2}"), "at the end");
  // the list's place in the contents is "References" (the owner's decision of 2026-10-11: a reference
  // may be a photo as well as a paper)
  const contents = renderLatex({ ...doc, settings: { ...doc.settings, contents: true } });
  assert.match(contents, /\\vpContentsSection\{vp-references\}\{1\}\{\}\{References\}/);
  assert.ok(!contents.includes("Cited files"));
  // no papers, no list
  const bare = buildDoc(input(graph(), emptyReview()));
  assert.deepEqual(bare.references, []);
  assert.ok(!renderLatex(bare).includes("vpReferences"));
});

test("a view of a past build prints the links of a declaration renamed since under its name then", () => {
  const past = graph(["N.a", "N.old"]);
  const d = review();
  // N.old was renamed N.b since: its links are kept under the name now
  const then = reviewThen(d, new Map([["N.old", "N.b"]]));
  const doc = buildDoc(input(past, then));
  const old = declsIn(sectionsIn(doc.items)[0].items).find((e) => e.name === "N.old")!;
  assert.deepEqual(old.papers?.map((p) => p.label), ["Lemma 2", "Theorem 8"]);
  assert.equal(d.links!.length, 4, "the review itself is left as it is");
});

test("a document with references typesets: each under its declaration and section as \"Reference: …\", the files listed at the end under \"References\"", { skip: !new Exporter(tmpdir()).available() && "xelatex is not installed" }, async () => {
  const state = mkdtempSync(join(tmpdir(), "vp-paperdoc-"));
  try {
    const ex = new Exporter(state);
    const job = ex.compile(renderLatex(buildDoc(input(graph(), review()))));
    const done = await ex.wait(job.id);
    assert.equal(done?.state, "done", done?.log);
    const pdf = ex.file(job.id, "pdf")!.body;
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    // the words as a reader sees them, read back from the PDF
    const text = execFileSync("pdftotext", ["-", "-"], { input: pdf }).toString("utf8");
    assert.match(text, /Reference: Lemma 2 \[Lecture notes, p\. 3\]/);
    assert.match(text, /^References$/m);
    assert.doesNotMatch(text, /Paper:|Cited files/);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
