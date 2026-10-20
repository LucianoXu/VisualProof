// The exported document (ExportSpec decisions 5–15): where a theorem's proof starts, so that it is
// never printed (shared/doc/proof.ts); prose from Markdown (shared/doc/markdown.ts); the palette
// the document shares with the page (shared/palette.ts); the document of a view the builder makes
// from the fixture's sources (shared/doc/build.ts, shared/doc/sections.ts) — its head card with what
// the view holds from outside the project, counted and not printed; its sections from the view's
// cluster structure, hidden levels taken out; the board's order, never what depends on what
// (test/exportorder.test.ts has the rest of it); no appendix, nothing of the review, no context and no line numbers; proofs left out
// (those inside definitions too, where the usage pass found them, `cutProofs`, or where reading the
// text finds them, `cutByText`) and definitions printed whole either way — and, where XeLaTeX is
// installed, that model typeset; the agents' model endpoint, by view. Its title is the view's and its
// author line the people who left a trace on the view (ExportSpec decisions 14 and 15,
// shared/doc/authors.ts), no longer settings.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import type { ModuleContexts } from "../src/shared/context.ts";
import { readContext } from "../src/shared/context.ts";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { authorLine, authorsOf, reviewTraces, viewTraces } from "../src/shared/doc/authors.ts";
import { buildDoc, DocInputError, docNotes, printedDecls } from "../src/shared/doc/build.ts";
import type { DocInput, DocSource, DocView } from "../src/shared/doc/build.ts";
import { anchor, renderLatex } from "../src/shared/doc/latex.ts";
import { inlines, parseMarkdown } from "../src/shared/doc/markdown.ts";
import type { DeclEntry, DocModel, Item, Section } from "../src/shared/doc/model.ts";
import { cutByText, cutProofs, statementOnly, textProofs, valueStart } from "../src/shared/doc/proof.ts";
import { MAX_DOC_DECLS, planDoc, tooMuch } from "../src/shared/doc/sections.ts";
import { freshSpots } from "../src/shared/doc/order.ts";
import type { BoardSpots } from "../src/shared/doc/order.ts";
import { DEFAULT_SETTINGS, readSettings } from "../src/shared/doc/settings.ts";
import { KEY_COLOR, KIND_COLORS, STAR_COLOR, STATUS_COLORS, TOKEN_COLORS } from "../src/shared/palette.ts";
import { evaluate, parseQuery, reviewScope } from "../src/shared/query.ts";
import { emptyReview, record } from "../src/shared/review.ts";
import type { ReviewData } from "../src/shared/review.ts";
import type { StoredEvent } from "../src/shared/timeline.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { docTitle, noAuthors, PROJECT } from "../src/shared/views.ts";
import type { PinAuthors, ViewData } from "../src/shared/views.ts";
import { AgentApi } from "../src/server/agent.ts";
import type { Caller, World } from "../src/server/agent.ts";
import { Exporter } from "../src/server/export.ts";
import { ReviewStore } from "../src/server/review.ts";
import { lakeTextHash } from "../src/server/status.ts";
import { Views } from "../src/server/views.ts";

// ------------------------------------------------------------------- proofs left out

test("a theorem's proof starts at its value: comments, strings, binders and attributes are not it", () => {
  const cut = (text: string) => statementOnly(text);
  assert.equal(cut("theorem t (n : Nat) : n + 0 = n := by\n  simp"), "theorem t (n : Nat) : n + 0 = n");
  assert.equal(cut("theorem t : True :=\n  trivial"), "theorem t : True");
  assert.equal(cut("theorem t\n    (h : a = b) :\n    b = a\n    := h.symm"), "theorem t\n    (h : a = b) :\n    b = a");
  // a := in a docstring, a comment, a string, an attribute, a binder's default value
  assert.equal(
    cut('/-- `x := 1` is not it -/\n@[simp, aesop safe (rule_sets := [X])]\ntheorem t (x : Nat := 3) -- y := 2\n  : f "a := b" x = x := by rfl'),
    '/-- `x := 1` is not it -/\n@[simp, aesop safe (rule_sets := [X])]\ntheorem t (x : Nat := 3) -- y := 2\n  : f "a := b" x = x',
  );
  // brackets of every kind, and a `let` in the statement with a := of its own
  assert.equal(cut("theorem t : ⟪ a := b ⟫ ∧ ⦃x := 1⦄ = ⟨c, d⟩ := by simp"), "theorem t : ⟪ a := b ⟫ ∧ ⦃x := 1⦄ = ⟨c, d⟩");
  assert.equal(cut("theorem t : let x := 3; x = 3 := rfl"), "theorem t : let x := 3; x = 3");
  // equations: the value is the first line that starts with | and has =>
  assert.equal(cut("theorem t : ∀ n : Nat, P n\n  | 0 => base\n  | n + 1 => step n"), "theorem t : ∀ n : Nat, P n");
  // an absolute value at the start of a line is the statement's
  assert.equal(cut("theorem t :\n    |x - y|\n      ≤ ε := by\n  linarith"), "theorem t :\n    |x - y|\n      ≤ ε");
  assert.equal(cut("theorem t : P where\n  foo := 1"), "theorem t : P");
  // a proof term inside the statement's brackets is the statement's
  assert.equal(cut("theorem t : f ⟨v, by omega⟩ = 1 := by simp"), "theorem t : f ⟨v, by omega⟩ = 1");
  // where the reading goes wrong, nothing: a `by` outside brackets before any value
  assert.equal(valueStart("theorem t : have h := 1; P by simp"), null);
  assert.equal(valueStart("theorem t : P"), null);
});

test("proofs inside a definition are cut where the usage pass found them", () => {
  const file = [
    "-- line 1",
    "instance : Lawful Nat where",
    "  op := Nat.add",
    "  op_assoc := by",
    "    intro a b c",
    "    -- by the library",
    "    exact Nat.add_assoc a b c",
    "  op_comm := Nat.add_comm -- a comment after the proof stays",
    "  op_zero := ⟨⟪𝔽⟫, by simp⟩ -- 𝔽 is two UTF-16 units",
    "  big := f (by",
    "    omega) \"⟨by⟩\" + 1",
  ];
  const text = (c: ReturnType<typeof cutProofs>) => c.lines.map((l) => l.map((t) => t[1]).join("")).join("\n");
  // the spans as the pass records them: columns in code points (𝔽 is two UTF-16 units), end exclusive
  const cut = cutProofs(file, 1, 10, [[4, 14, 7, 29], [8, 13, 8, 25], [9, 19, 9, 26], [10, 12, 11, 9]]);
  assert.equal(cut.cuts, 4);
  assert.equal(
    text(cut),
    [
      "instance : Lawful Nat where",
      "  op := Nat.add",
      "  op_assoc := …",
      "  op_comm := … -- a comment after the proof stays",
      "  op_zero := ⟨⟪𝔽⟫, …⟩ -- 𝔽 is two UTF-16 units",
      "  big := f (…) \"⟨by⟩\" + 1",
    ].join("\n"),
  );
  // `…` is an elided token; the rest is highlighted as the whole text was (the string stays one)
  assert.deepEqual(cut.lines[2], [["text", "  "], ["ident", "op_assoc"], ["text", " := "], ["elided", "…"]]);
  assert.ok(cut.lines[5].some((t) => t[0] === "string" && t[1] === '"⟨by⟩"'));
  assert.ok(cut.lines[3].some((t) => t[0] === "comment"), "a comment after a proof stays");
  // nested and overlapping spans are one cut; spans outside the lines are left alone
  const nested = cutProofs(file, 1, 10, [[4, 14, 7, 29], [5, 4, 5, 15], [6, 0, 8, 2], [12, 0, 12, 4]]);
  assert.equal(nested.cuts, 1);
  assert.equal(text(nested).split("\n")[2], "  op_assoc := …op_comm := Nat.add_comm -- a comment after the proof stays");
  // nothing to cut: the text as it is
  const none = cutProofs(file, 1, 2, []);
  assert.deepEqual([text(none), none.cuts], ["instance : Lawful Nat where\n  op := Nat.add", 0]);
});

test("where the pass's places cannot be used, reading the text finds the proofs: every `by` block of the value, decreasing_by's tactics", () => {
  const cut = (src: string) => {
    const c = cutByText(src);
    return c.lines.map((l) => l.map((t) => t[1]).join("")).join("\n");
  };
  // an instance's fields: a tactic block on several lines, its comment inside it, ends where the
  // next field starts; a term-mode proof cannot be told from data, and stays
  assert.equal(
    cut("instance : Lawful Nat where\n  op := Nat.add\n  op_assoc := by\n    intro a b c\n    -- by the library\n    exact Nat.add_assoc a b c\n  op_comm := Nat.add_comm -- a comment after the proof stays"),
    "instance : Lawful Nat where\n  op := Nat.add\n  op_assoc := …\n  op_comm := Nat.add_comm -- a comment after the proof stays",
  );
  // in brackets: up to the bracket's end or the next comma at its depth; a string is never read
  assert.equal(cut("def onePos : Pos := { val := 1, pos := by decide }"), "def onePos : Pos := { val := 1, pos := … }");
  assert.equal(cut('def big : Nat :=\n  f (by\n    omega) "⟨by⟩" + 1'), 'def big : Nat :=\n  f (…) "⟨by⟩" + 1');
  assert.equal(cut("def x : Fin 3 := ⟨by simp [a, b], 2⟩"), "def x : Fin 3 := ⟨…, 2⟩");
  // equations: each one's block ends where the next starts; an `if`'s branches end a block of none
  assert.equal(cut("def g : Nat → Nat\n  | 0 => by exact 1\n  | n + 1 => 2"), "def g : Nat → Nat\n  | 0 => …\n  | n + 1 => 2");
  assert.equal(cut("def h (n : Nat) : Fin 5 := if c then by simp else ⟨0, by decide⟩"), "def h (n : Nat) : Fin 5 := if c then … else ⟨0, …⟩");
  assert.equal(cut("def k : Nat := by\n  if h : c then exact 1 else exact 2"), "def k : Nat := …");
  // `decreasing_by` keeps its keyword; `termination_by` is a measure, kept, a `by` in it cut
  assert.equal(cut("def halve (n : Nat) : Nat := if h : n = 0 then 0 else halve (n / 2) + 1\ndecreasing_by omega"), "def halve (n : Nat) : Nat := if h : n = 0 then 0 else halve (n / 2) + 1\ndecreasing_by …");
  assert.equal(
    cut("def f (n : Nat) : Nat := by\n  exact go n\ntermination_by n\ndecreasing_by\n  simp_wf\n  omega\nwhere go := id"),
    "def f (n : Nat) : Nat := …\ntermination_by n\ndecreasing_by\n  …\nwhere go := id",
  );
  // a `by` in the signature is the statement's, as the pass has it; one in a quotation is a macro's
  // meaning; where no value can be read, there is nothing to cut
  assert.equal(cut("def f (n : Nat) (h : n < 5 := by omega) : Fin 5 := ⟨n, h⟩"), "def f (n : Nat) (h : n < 5 := by omega) : Fin 5 := ⟨n, h⟩");
  assert.equal(cut("def m : MacroM Syntax := `(by simp)"), "def m : MacroM Syntax := `(by simp)");
  assert.deepEqual(textProofs("opaque f : Nat"), []);
  // the known imperfection: a `by` block that builds data is left out too, with what is nested in it
  assert.equal(cut("def three : Fin 5 := by\n  exact ⟨(by exact 3), by decide⟩"), "def three : Fin 5 := …");
  // a block whose tactics start a line no further right than the line it starts on runs on: the
  // reading leaves out too much rather than print a proof
  assert.equal(cut("  foo := by\n  simp\n  bar := 3"), "  foo := …");
  // the pieces cut are tokens; `…` is an elided one, the rest highlighted as the whole text is
  assert.deepEqual(cutByText("instance : P where\n  p := by simp").lines[1], [["text", "  "], ["ident", "p"], ["text", " := "], ["elided", "…"]]);
  assert.equal(cutByText("def a := ⟨by simp, by simp⟩").cuts, 2);
});

// ------------------------------------------------------------------- prose

test("prose: paragraphs, code spans and blocks, emphasis, lists; everything else is text", () => {
  assert.deepEqual(inlines("a `x := 1` **b** *c* _d_ snake_case 2 * 3 $x$"), [
    { t: "text", s: "a " },
    { t: "code", s: "x := 1" },
    { t: "text", s: " " },
    { t: "strong", s: "b" },
    { t: "text", s: " " },
    { t: "em", s: "c" },
    { t: "text", s: " " },
    { t: "em", s: "d" },
    { t: "text", s: " snake_case 2 * 3 $x$" },
  ]);
  assert.deepEqual(inlines("an `unclosed span"), [{ t: "text", s: "an `unclosed span" }]);
  const md = parseMarkdown("First line\nsecond line.\n\n- one\n- two\n  more\n\n```lean\ndef f := 1\n```\nAfter.");
  assert.equal(md.length, 4);
  assert.deepEqual(md[0], { t: "p", inl: [{ t: "text", s: "First line second line." }] });
  assert.deepEqual(md[1], { t: "list", items: [[{ t: "text", s: "one" }], [{ t: "text", s: "two more" }]] });
  assert.equal(md[2].t, "code");
  if (md[2].t === "code") assert.deepEqual(md[2].code.lines, [[["keyword", "def"], ["text", " "], ["ident", "f"], ["text", " := "], ["number", "1"]]]);
  assert.deepEqual(md[3], { t: "p", inl: [{ t: "text", s: "After." }] });
});

// ------------------------------------------------------------------- the palette

test("the document's palette is the page's: every colour as web/style.css has it in light", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "src", "web", "style.css"), "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const value = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root)?.[1]?.toLowerCase();
  for (const [k, c] of Object.entries(KIND_COLORS)) assert.equal(value(`k-${k}`), c, `--k-${k}`);
  for (const [k, c] of Object.entries(STATUS_COLORS)) assert.equal(value(`status-${k}`), c, `--status-${k}`);
  for (const [k, c] of Object.entries(TOKEN_COLORS)) if (k !== "sorry") assert.equal(value(`tk-${k}`), c, `--tk-${k}`);
  assert.equal(value("target-star"), STAR_COLOR);
  assert.equal(value("key-mark"), KEY_COLOR);
});

test("a comment is a calm blue in both review palettes, light and dark, and the two palettes stay apart (2026-10-09)", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "src", "web", "style.css"), "utf8");
  const block = (head: string) => css.slice(css.indexOf(head), css.indexOf("\n}", css.indexOf(head)));
  const value = (b: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(b)?.[1]?.toLowerCase();
  const light = block(":root {");
  const dark = block(':root[data-theme="dark"] {');
  const blue = (c: string | undefined) => {
    assert.ok(c, "defined");
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
    return b > g && g > r && b - r > 100;
  };
  // the Status scheme's, in light (the document's too) and a step lighter in dark; the panel's
  assert.equal(value(light, "status-commented"), STATUS_COLORS.commented);
  for (const c of [value(light, "status-commented"), value(dark, "status-commented"), value(light, "rv-commented")]) assert.ok(blue(c), `${c} is blue`);
  assert.notEqual(value(dark, "status-commented"), value(light, "status-commented"));
  assert.notEqual(value(light, "rv-commented"), value(light, "status-commented"), "two palettes, on purpose (CanvasSpec)");
  // what is wrong or goes away keeps a red of its own; nothing is named after a dispute
  assert.equal(value(light, "bad"), "#e5484d");
  assert.doesNotMatch(css, /disput/i);
});


// ------------------------------------------------------------------- the builder, on the fixture

const FIXTURE = join(import.meta.dirname, "fixture");
/** A declaration of the fixture whose name a writer could have meant as LaTeX. */
const ODD = "Fixture.«odd}\\input{/etc/passwd}%»";

/** The fixture's Basic and Use modules as a graph of their own, with each declaration's compiled
 *  place found in its file: main_thm (statement: double and Point.size; proof: helper_eq) and
 *  size_le (statement: Point.size; proof: Nat.le_add_right), and two declarations of the outside
 *  world. By namespace, Fixture holds all but Point and Point.size, which are Fixture.Point. */
function fixture() {
  const files: Record<string, string> = { "Fixture.Basic": "Fixture/Basic.lean", "Fixture.Use": "Fixture/Use.lean" };
  const text = (m: string) => readFileSync(join(FIXTURE, files[m]), "utf8");
  const place = (m: string, word: string): [number, number, number, number] => {
    const lines = text(m).split("\n");
    const at = lines.findIndex((l) => new RegExp(`^(theorem|def|structure|instance) ${word.replace(/\./g, "\\.")}\\b`).test(l));
    assert.ok(at >= 0, word);
    let end = at;
    while (end + 1 < lines.length && lines[end + 1].trim() && !/^(\/--|theorem|def|structure|instance|end)/.test(lines[end + 1])) end++;
    return [at + 1, 0, end + 1, lines[end].length];
  };
  const decl = (name: string, kind: ViewNode["kind"], module: string, word: string, doc?: string): ViewNode => ({
    name, kind, module, ax: 0, hash: `h-${name}`, type: `type of ${name}`, range: place(module, word), ...(doc ? { doc } : {}),
  });
  const nodes: ViewNode[] = [
    decl("Fixture.Point", "structure", "Fixture.Basic", "Point", "A point in the plane."),
    decl("Fixture.Point.size", "def", "Fixture.Basic", "Point.size", "Taxicab size."),
    decl("Fixture.size_le", "theorem", "Fixture.Basic", "size_le"),
    decl("Fixture.double", "def", "Fixture.Use", "double"),
    decl("Fixture.helper", "def", "Fixture.Use", "helper", "A helper used only inside a proof."),
    decl("Fixture.helper_eq", "theorem", "Fixture.Use", "helper_eq"),
    decl("Fixture.main_thm", "theorem", "Fixture.Use", "main_thm", "The statement mentions `double` and `Point.size`; the proof uses `helper_eq`."),
    // its invariant's proof, `size_le p`, where the usage pass finds it
    { ...decl("Fixture.bounded", "def", "Fixture.Basic", "bounded", "Data whose invariant is proved by a lemma."), proofs: [[16, 61, 16, 70]] },
    // a name a writer could make LaTeX of, with no source to read: printed from the graph
    { name: ODD, kind: "def", module: "Fixture.Use", ax: 0, hash: "h-odd", type: "Nat → \\write18{rm -rf /} 100% #1 $x$ ^^5c" },
    // from outside, with its place in Lean's core (since 0.7.0)
    { name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0, ext: true, doc: "The natural numbers.", range: [2, 0, 5, 18] },
    { name: "Nat.le_add_right", kind: "theorem", module: "Init.Data", ax: 0, ext: true },
  ];
  const at = (n: string) => nodes.findIndex((v) => v.name === n);
  const edges: number[] = [];
  const use = (a: string, b: string, site: number) => edges.push(at(a), at(b), site);
  use("Fixture.main_thm", "Fixture.double", SITE_STMT);
  use("Fixture.main_thm", "Fixture.Point.size", SITE_STMT);
  use("Fixture.main_thm", "Fixture.helper_eq", SITE_PROOF);
  use("Fixture.double", "Fixture.Point", SITE_STMT);
  use("Fixture.double", "Nat", SITE_BODY);
  use("Fixture.Point.size", "Fixture.Point", SITE_STMT);
  use("Fixture.Point.size", "Nat", SITE_STMT);
  use("Fixture.Point", "Nat", SITE_STMT);
  use("Fixture.helper_eq", "Fixture.helper", SITE_STMT);
  use("Fixture.size_le", "Fixture.Point.size", SITE_STMT);
  use("Fixture.size_le", "Nat.le_add_right", SITE_PROOF);
  const meta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: FIXTURE, roots: ["Fixture"], toolchain: "leanprover/lean4:v4.33.1", extractedAt: "2026-10-08T08:00:00.000Z", extractMs: 1 },
    modules: Object.entries(files).map(([name, file]) => ({ name, file, imports: [], compiled: lakeTextHash(text(name)) })),
    nodes,
    projectCount: 9,
    axioms: [],
    axiomSets: [[]],
    layouts: {},
    edgeCount: edges.length / 3,
  } as unknown as ViewMeta;
  const g = new Graph(meta, new Int32Array(edges));
  const d: ReviewData = emptyReview();
  const t = (k: number) => `2026-10-08T09:${String(k).padStart(2, "0")}:00.000Z`;
  record(d, { op: "target", name: "Fixture.main_thm", by: "Alice", on: true }, "tc", t(0));
  record(d, { op: "key", target: "Fixture.main_thm", name: "Fixture.double", by: "Alice", on: true }, "tc", t(2));
  record(d, { op: "opinion", name: "Fixture.Point.size", by: "Alice", verdict: "approve", hash: "h-Fixture.Point.size" }, "tc", t(6));
  record(d, { op: "opinion", name: "Fixture.double", by: "Bob", verdict: "comment", comment: "Should it be 3 * p.x?", hash: "h-Fixture.double" }, "tc", t(7));
  // the usage pass's record of a module: the context it read each declaration in (here as the text
  // reads it), for the text it read — what says that the proofs inside its definitions were looked for
  const passRecord = (m: string): ModuleContexts => {
    const lines = text(m).split("\n");
    const own = nodes.filter((v) => v.module === m && v.range);
    return { hash: lakeTextHash(text(m)), contexts: own.map((v) => readContext(lines, v.range![0] - 1)), decls: Object.fromEntries(own.map((v, k) => [v.name, [k]])) };
  };
  const source = (m: string): DocSource | null => (files[m] ? { lines: text(m).split("\n"), edited: false, contexts: passRecord(m), hash: lakeTextHash(text(m)) } : null);
  /** a view of `scope`, by namespace unless said otherwise */
  const view = (scope: string, over: Partial<DocView> = {}): DocView => ({ id: "v1", name: null, scope: parseQuery(scope), clustering: "namespace", hidden: [], authors: [], ...over });
  const input = (over: Partial<DocInput> = {}): DocInput => ({
    g,
    review: d,
    view: view("all"),
    settings: { ...DEFAULT_SETTINGS },
    source,
    fileOf: (m) => files[m] ?? null,
    build: { fingerprint: "55f2cfb7deadbeef", commit: { hash: "e404003", branch: "main" } },
    ...over,
  });
  return { g, d, input, source, view };
}

const codeText = (e: DeclEntry) => e.code.lines.map((l) => l.map((t) => t[1]).join("")).join("\n");
/** That what a document holds, and each of its sections, comes in the order of board `spots`: the
 *  lowest first, ties left to right (shared/doc/order.ts). */
function bottomFirst(xs: readonly Item[], spots: BoardSpots): void {
  const at = (x: Item): [number, number] | null =>
    x.t === "decl" ? spots.decls.get(x.decl.name) ?? null : x.t === "section" ? spots.clusters.get(x.section.key) ?? null : null;
  const placed = xs.map(at).filter((p): p is [number, number] => p !== null);
  for (let k = 1; k < placed.length; k++) {
    const [a, b] = [placed[k - 1], placed[k]];
    const dy = Math.round(a[1] * 10) - Math.round(b[1] * 10);
    assert.ok(dy > 0 || (dy === 0 && Math.round(a[0] * 10) <= Math.round(b[0] * 10)), `out of the board's order at ${k}: ${a} then ${b}`);
  }
  for (const x of xs) if (x.t === "section") bottomFirst(x.section.items, spots);
}

/** The sections among what a section or the document holds. */
const sectionsIn = (xs: readonly Item[]): Section[] => xs.flatMap((x) => (x.t === "section" ? [x.section] : []));
/** The declarations printed directly among what a section or the document holds, in order. */
const declsIn = (xs: readonly Item[]): DeclEntry[] => xs.flatMap((x) => (x.t === "decl" ? [x.decl] : []));
/** A document's sections as [title, level, key, the names printed directly], depth first. */
const outline = (xs: readonly Item[]): [string, number, string, string[]][] =>
  sectionsIn(xs).flatMap((s) => [[s.title, s.level, s.key, declsIn(s.items).map((e) => e.name)] as [string, number, string, string[]], ...outline(s.items)]);

test("the document of a view: the head card with what it leaves out, sections from its clusters, what a declaration uses before it", () => {
  const { input } = fixture();
  const doc = buildDoc(input());
  // plain JSON, as an agent reads it, and nothing of targets, presets, contents or an appendix
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc);
  assert.equal(doc.version, 11);
  assert.deepEqual(Object.keys(doc).sort(), ["count", "head", "items", "references", "settings", "version", "view"]);
  assert.deepEqual(doc.view, { id: "v1", title: "everything", scope: "all", clustering: "namespace", hidden: [] });
  // the head card: the project, the build and its commit, the toolchain, the trusted boundary, and
  // what the view holds from outside the project, counted per library; no time, and no past build
  assert.deepEqual(Object.keys(doc.head).sort(), ["author", "commit", "fingerprint", "outside", "past", "project", "roots", "title", "toolchain", "trusted"]);
  assert.equal(doc.head.past, null);
  assert.equal(doc.head.title, "Everything", "the view's title, as a title is written");
  assert.deepEqual(doc.head.outside, { count: 2, by: [{ name: "Init", count: 2 }] });
  assert.deepEqual(doc.head.commit, { hash: "e404003", branch: "main" });
  assert.deepEqual(doc.head.trusted.standardAxioms, ["Classical.choice", "Quot.sound", "propext"]);
  // every declaration of the project is printed, nothing from outside it
  assert.deepEqual(doc.count, { declarations: 9, sections: 2, notes: 0 });
  assert.ok(!printedDecls(doc).some((e) => e.name.startsWith("Nat")));
  // the sections: Fixture, and within it Point (a structure and its namespace are one cluster);
  // within a section, the board's order, the lowest first — here a fresh layout's, which puts what is
  // used lower: no dependency order is read
  assert.deepEqual(
    outline(doc.items).map(([t, l, k, names]) => [t, l, k, [...names].sort()]),
    [
      ["Fixture", 1, "Fixture", ["Fixture.bounded", "Fixture.double", "Fixture.helper", "Fixture.helper_eq", "Fixture.main_thm", "Fixture.size_le", ODD].sort()],
      ["Point", 2, "Fixture.Point", ["Fixture.Point", "Fixture.Point.size"]],
    ],
  );
  bottomFirst(doc.items, freshSpots(fixture().g, evaluate(parseQuery("all"), { g: fixture().g, review: fixture().d }), "namespace", []));
  assert.deepEqual(declsIn(doc.items), []);
  // a declaration is what it is and its code: nothing of keys, of what it rests on, of the review
  const size = printedDecls(doc).find((e) => e.name === "Fixture.Point.size")!;
  assert.deepEqual(Object.keys(size).sort(), ["code", "doc", "file", "id", "kind", "line", "module", "name", "short"]);
  // by file: the modules are the sections, the one used first
  const byFile = buildDoc(input({ view: { ...input().view, clustering: "module" } }));
  assert.deepEqual(outline(byFile.items).map(([t, l]) => [t, l]), [["Fixture", 1], ["Basic", 2], ["Use", 2]]);
  assert.deepEqual(declsIn(sectionsIn(sectionsIn(byFile.items)[0].items)[0].items).map((e) => e.name), ["Fixture.Point", "Fixture.Point.size", "Fixture.bounded", "Fixture.size_le"]);
});

test("an outside declaration key for a target is printed as the project's are, from its package's source; the rest of the outside world is counted", () => {
  const { d, input, source } = fixture();
  // the owner's decision of 2026-10-20 (ExportSpec decision 8): key declarations may be outside
  record(d, { op: "key", target: "Fixture.main_thm", name: "Nat", by: "Alice", on: true }, "tc", "2026-10-08T09:30:00.000Z");
  const PRELUDE = "prelude\n/-- The natural numbers. -/\ninductive Nat where\n  | zero\n  | succ (n : Nat)\n";
  const withCore = (over: Partial<DocInput> = {}) =>
    input({
      source: (m) => (m === "Init.Prelude" ? { lines: PRELUDE.split("\n"), edited: false, contexts: null, hash: null } : source(m)),
      outside: (m) => (m === "Init.Prelude" ? { file: "Init/Prelude.lean", package: "Lean" } : null),
      ...over,
    });
  const doc = buildDoc(withCore());
  const nat = printedDecls(doc).find((e) => e.name === "Nat")!;
  assert.deepEqual([nat.external, nat.package, nat.file, nat.line, nat.module], [true, "Lean", "Init/Prelude.lean", 2, "Init.Prelude"]);
  assert.equal(codeText(nat), "inductive Nat where\n  | zero\n  | succ (n : Nat)", "its source, its docstring printed as prose");
  assert.deepEqual(nat.doc, parseMarkdown("The natural numbers."));
  assert.deepEqual(doc.head.outside, { count: 1, by: [{ name: "Init", count: 1 }] }, "the rest, counted");
  assert.equal(doc.count.declarations, 10);
  // in the section of its cluster on the board: the outside world's
  assert.ok(outline(doc.items).some(([title, , , names]) => title === "External" && names.includes("Nat")));
  // typeset, its place names its package
  assert.ok(renderLatex(doc).includes("\\vpPlace{Init.\\vpBreak{}Prelude}{Init/\\vpBreak{}Prelude.lean (Lean)}{2}"));
  // the project's declarations say nothing of it
  assert.ok(!Object.hasOwn(printedDecls(doc).find((e) => e.name === "Fixture.double")!, "external"));
  // its source not found: its name alone, which the export's notes say
  const bare = buildDoc(input());
  const n2 = printedDecls(bare).find((e) => e.name === "Nat")!;
  assert.deepEqual([codeText(n2), n2.external, n2.package, n2.file, n2.line], ["Nat", true, undefined, null, null]);
  assert.ok(docNotes(bare).some((l) => /1 key declaration from outside the project is printed by name alone, their source not found: Nat\./.test(l)), docNotes(bare).join("\n"));
  // not key, not printed: counted
  const unkeyed = buildDoc(withCore({ review: emptyReview() }));
  assert.ok(!printedDecls(unkeyed).some((e) => e.external));
  assert.deepEqual(unkeyed.head.outside, { count: 2, by: [{ name: "Init", count: 2 }] });
  // the plan says so too, as the Export window does
  const { g } = fixture();
  assert.equal(planDoc(g, new Uint8Array(g.n).fill(1), "namespace", [], new Uint8Array(g.n).fill(1)).keyOutside, 2);
});

test("the sections follow the view's hidden levels: what a hidden level holds is printed in its parent's section, the top level's under no heading", () => {
  const { input, view } = fixture();
  const point = buildDoc(input({ view: view("all", { hidden: ["Fixture.Point"] }) }));
  // Point and Point.size among the rest, in the board's order
  assert.deepEqual(
    outline(point.items).map(([t, l, k, names]) => [t, l, k, [...names].sort()]),
    [["Fixture", 1, "Fixture", ["Fixture.Point", "Fixture.Point.size", "Fixture.bounded", "Fixture.double", "Fixture.helper", "Fixture.helper_eq", "Fixture.main_thm", "Fixture.size_le", ODD].sort()]],
  );
  assert.deepEqual(point.view.hidden, ["Fixture.Point"]);
  // the top level hidden: its declarations are the document's first, under no heading, and its
  // section's sections are the top ones
  const top = buildDoc(input({ view: view("all", { hidden: ["Fixture"] }) }));
  assert.equal(declsIn(top.items).length, 7);
  assert.deepEqual(outline(top.items).map(([t, l, k, names]) => [t, l, k, [...names].sort()]), [["Point", 1, "Fixture.Point", ["Fixture.Point", "Fixture.Point.size"]]]);
  assert.deepEqual(top.count, { declarations: 9, sections: 1, notes: 0 });
  const tex = renderLatex(top);
  const first = declsIn(top.items)[0];
  assert.ok(tex.includes(`\\end{vpContents}\n\\vpBookmark{${anchor(first.id)}}{0}`), "first, before any section");
  assert.ok(tex.indexOf("\\vpSection{") > tex.lastIndexOf("\\begin{vpDecl}{vp:Fixture.2e.size.5f.le}"), "the start before the sections");
  assert.match(tex, /\\vpSection\{vp:section\.3a\.Fixture\.2e\.Point\}\{1\}\{1\}\{Point\}\{Fixture\.\\vpBreak\{\}Point\}\{0\}\{Point\}/);
});

test("the plan: sections nested by depth, a paragraph-level heading below the third, a lone section merged; what is printed, not in which order", () => {
  // L.Zz is the foundation L.Aa rests on; D.E.F.G.H.I nests deeper than four levels; M.N is a chain
  // the board merges; outside declarations are counted per library
  const names = ["L.Aa.app", "L.Zz.found", "L.Zz.more", "D.top", "D.E.e", "D.E.F.f", "D.E.F.G.g", "D.E.F.G.H.h", "D.E.F.G.H.I.i", "M.N.n", "M.N.n2"];
  const nodes: ViewNode[] = names.map((name) => ({ name, kind: "def", module: `Mod.${name}`, ax: 0 }));
  nodes.push({ name: "Ext.a", kind: "def", module: "Mathlib.A", ax: 0, ext: true }, { name: "Ext.b", kind: "def", module: "Mathlib.B", ax: 0, ext: true }, { name: "Ext.c", kind: "def", module: "Batteries.C", ax: 0, ext: true });
  const at = (n: string) => nodes.findIndex((v) => v.name === n);
  const edges = [at("L.Aa.app"), at("L.Zz.found"), SITE_STMT, at("L.Zz.more"), at("L.Zz.found"), SITE_BODY];
  const g = new Graph({ nodes, projectCount: names.length, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: 2 } as unknown as ViewMeta, Int32Array.from(edges));
  const plan = planDoc(g, new Uint8Array(g.n).fill(1), "namespace", []);
  // siblings by title: the plan says what is printed, in the tree's order; the order is the board's
  // (shared/doc/order.ts), not what Aa uses of Zz
  const rows = (ss: typeof plan.sections): [string, number, number][] =>
    [...ss].sort((a, b) => (a.title < b.title ? -1 : 1)).flatMap((s) => [[s.title, s.level, s.depth] as [string, number, number], ...rows(s.sections)]);
  assert.deepEqual(rows(plan.sections), [
    ["D", 1, 1],
    ["E", 2, 2],
    ["F", 3, 3],
    ["G", 4, 4],
    ["G.H", 4, 5],
    ["G.H.I", 4, 6],
    ["L", 1, 1],
    ["Aa", 2, 2],
    ["Zz", 2, 2],
    // the board merges M into M.N, one circle with nothing else: one heading, standing for both
    ["M.N", 1, 1],
  ]);
  assert.deepEqual(plan.sections.find((s) => s.title === "L")!.sections.find((s) => s.title === "Zz")!.decls.map((i) => g.nodes[i].name).sort(), ["L.Zz.found", "L.Zz.more"]);
  assert.deepEqual(plan.sections.find((s) => s.title === "M.N")!.keys, ["M.N"]);
  assert.deepEqual(plan.outside, { count: 3, by: [{ name: "Mathlib", count: 2 }, { name: "Batteries", count: 1 }] });
  assert.deepEqual([plan.count, plan.sectionCount], [11, 10]);
  // what is too much or nothing is said, and refused by the builder
  assert.equal(tooMuch(5), null);
  assert.match(tooMuch(0) ?? "", /no declaration of the project/);
  assert.match(tooMuch(MAX_DOC_DECLS + 1) ?? "", /at most 2,000/);
  const { input, view } = fixture();
  assert.throws(() => buildDoc(input({ view: view("external") })), (e: Error) => e instanceof DocInputError && /no declaration of the project/.test(e.message));
  // the view's set is what its scope holds, on the review: a set the board holds, whatever is folded
  const { g: fg, d } = fixture();
  const keyed = planDoc(fg, evaluate(parseQuery("key(Fixture.main_thm)"), { g: fg, review: d }), "namespace", []);
  assert.equal(keyed.count, 2);
});

test("nothing of the review is in the document: no status, no opinion, no progress, nobody's word, no explanation", () => {
  const { input } = fixture();
  const doc = buildDoc(input());
  const json = JSON.stringify(doc);
  const tex = renderLatex(doc);
  // "comment" alone is code's (a comment in Lean), so the review's word is its status, commented
  for (const word of ["status", "opinion", "verdict", "approve", "commented", "stale", "unreviewed", "progress", "keyFor"]) {
    assert.ok(!json.toLowerCase().includes(word.toLowerCase()), `the model says ${word}`);
    assert.ok(!tex.toLowerCase().includes(word.toLowerCase()), `the .tex says ${word}`);
  }
  for (const said of ["Should it be 3 * p.x?", "Alice", "Bob"]) assert.ok(!json.includes(said) && !tex.includes(said), said);
  assert.ok(!/explanation|"about"|rests? on|appendix|support/i.test(json) && !/explanation|rests? on|appendix|support index/i.test(tex));
  for (const macro of ["\\vpProgress", "\\vpOpinion", "\\vpStatus", "\\vpPart", "\\vpAppendix", "\\vpIndex", "\\vpMembers", "\\vpSeeAlso", "\\vpIncluded", "\\vpKeyFor"]) assert.ok(!tex.includes(macro), macro);
});

test("no context and no line numbers: the code alone, wherever a proof was cut too", () => {
  const { input } = fixture();
  const doc = buildDoc(input());
  for (const e of printedDecls(doc)) {
    assert.ok(!("context" in e), e.name);
    assert.ok(!("firstLine" in e.code) && !("numbers" in e.code), e.name);
  }
  const bounded = printedDecls(doc).find((e) => e.name === "Fixture.bounded")!;
  assert.equal(bounded.code.proofsCut, 1);
  const tex = renderLatex(doc);
  for (const no of ["firstnumber", "numbers=", "\\vpLineNo", "vpContext", "namespace Fixture", "\\vpCodeLabel"]) assert.ok(!tex.includes(no), no);
  assert.match(tex, /\\begin\{vpCode\}\n\\vpTkKeyword\{def\} bounded/);
});

test("proofs are never printed; definitions keep their bodies; the docstring shown is not repeated", () => {
  const { input } = fixture();
  const all = printedDecls(buildDoc(input()));
  const main = all.find((e) => e.name === "Fixture.main_thm")!;
  assert.equal(main.code.proofElided, true);
  assert.match(codeText(main), /^theorem main_thm \(p : Point\) : \(double p\)\.size = 2 \* p\.size := …$/);
  for (const tactic of ["simp", "omega", "have", "helper_eq"]) assert.ok(!codeText(main).includes(tactic), tactic);
  assert.equal(main.code.lines.at(-1)!.at(-1)![0], "elided");
  assert.equal(codeText(all.find((e) => e.name === "Fixture.size_le")!), "theorem size_le (p : Point) : p.x ≤ p.size := …");
  // no theorem anywhere in the document carries its proof
  for (const e of all.filter((x) => x.kind === "theorem")) assert.equal(e.code.proofElided, true, e.name);
  // a definition keeps its body
  const size = all.find((e) => e.name === "Fixture.Point.size")!;
  assert.equal(codeText(size), "def Point.size (p : Point) : Nat := p.x + p.y");
  assert.equal(size.line, 11);
  // its docstring is what it is, as prose; the code leaves it out
  assert.deepEqual(size.doc, [{ t: "p", inl: [{ t: "text", s: "Taxicab size." }] }]);
  assert.equal(all.find((e) => e.name === "Fixture.double")!.doc, null);
  // a source that cannot be read: the graph's statement, still without a proof
  const bare = printedDecls(buildDoc(input({ source: () => null })));
  const m2 = bare.find((e) => e.name === "Fixture.main_thm")!;
  assert.equal(m2.code.from, "statement");
  assert.equal(codeText(m2), "theorem Fixture.main_thm : type of Fixture.main_thm := …");
});

test("definitions are printed whole: their proofs cut where the pass found them, else where reading the text finds them", () => {
  const { input, source, view } = fixture();
  const these = view("decl(Fixture.bounded, Fixture.size_le, Fixture.Point.size, Fixture.Point)");
  const entries = (over: Partial<DocInput> = {}) => printedDecls(buildDoc(input({ view: these, ...over })));
  const one = (over: Partial<DocInput>, name = "Fixture.bounded") => entries(over).find((e) => e.name === name)!;
  // the pass read this text: its places, a term-mode proof among them
  const b = one({});
  assert.equal(codeText(b), "def bounded (p : Point) : { n : Nat // p.x ≤ n } := ⟨p.size, …⟩");
  assert.deepEqual([b.code.proofsCut, b.code.proofElided, b.code.textCut], [1, false, undefined]);
  assert.ok(!codeText(b).includes("size_le"));
  const size = one({}, "Fixture.Point.size");
  assert.deepEqual([codeText(size), size.code.proofsCut, size.code.textCut], ["def Point.size (p : Point) : Nat := p.x + p.y", undefined, undefined]);
  // the file changed since it was compiled: the pass's places are not this text's. The definitions
  // are printed whole all the same, their `by` blocks cut — one that builds data too (Point.size,
  // edited to compute its value by tactics) — and the reader is told nothing in the document
  const edited = (m: string): DocSource | null => {
    const s = source(m);
    if (!s) return s;
    const lines = s.lines.map((l) => l.replace("⟨p.size, size_le p⟩", "⟨p.size, by exact size_le p⟩").replace("Nat := p.x + p.y", "Nat := by exact p.x + p.y"));
    return { ...s, edited: true, lines: ["-- an edit", ...lines], hash: "0000000000000000" };
  };
  const e = one({ source: edited });
  assert.equal(codeText(e), "def bounded (p : Point) : { n : Nat // p.x ≤ n } := ⟨p.size, …⟩");
  assert.deepEqual([e.code.textCut, e.code.from, e.code.proofsCut, e.code.proofElided], ["edited", "edited", 1, false]);
  const data = one({ source: edited }, "Fixture.Point.size");
  assert.deepEqual([codeText(data), data.code.textCut], ["def Point.size (p : Point) : Nat := …", "edited"]);
  // the usage pass has not read the module (off, still running, failed on it), or read another
  // text, or not this declaration: the definition whole; a proof written as a term is kept
  const unreadSources: ((m: string) => DocSource | null)[] = [
    (m) => { const s = source(m); return s && { ...s, contexts: null }; },
    (m) => { const s = source(m); return s && { ...s, contexts: s.contexts && { ...s.contexts, hash: "another text" } }; },
    (m) => { const s = source(m); return s && { ...s, contexts: s.contexts && { ...s.contexts, decls: {} } }; },
  ];
  for (const src of unreadSources) {
    const u = one({ source: src });
    assert.equal(codeText(u), "def bounded (p : Point) : { n : Nat // p.x ≤ n } := ⟨p.size, size_le p⟩");
    assert.deepEqual([u.code.textCut, u.code.proofsCut, u.code.from], ["unread", undefined, "source"]);
  }
  // theorems are cut at their statement however the definitions are read; a structure is printed whole
  for (const over of [{}, { source: edited }, { source: unreadSources[0] }]) {
    const all = entries(over);
    assert.equal(codeText(all.find((x) => x.name === "Fixture.size_le")!), "theorem size_le (p : Point) : p.x ≤ p.size := …");
    assert.match(codeText(all.find((x) => x.name === "Fixture.Point")!), /^structure Point where\n  x : Nat\n  y : Nat$/);
  }
  // the document carries no note of how the proofs were found; the export's notes say it
  const doc = buildDoc(input({ view: view("decl(Fixture.bounded, Fixture.size_le, Fixture.Point.size)"), source: edited }));
  const tex = renderLatex(doc);
  for (const no of ["vpValueElided", "edited", "usage pass", "reading"]) assert.ok(!tex.includes(no), no);
  assert.ok(tex.includes("⟨p.size, \\vpTkElided{…}⟩"));
  const notes = docNotes(doc);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^The proofs inside 2 definitions were found by reading the text rather than where the usage pass found them, since their file changed since it was compiled: Fixture\.Point\.size, Fixture\.bounded\. Reading the text leaves out every `by` block, one that builds data too, and keeps a proof written as a term\.$/);
  assert.match(docNotes(buildDoc(input({ view: view("decl(Fixture.bounded)"), source: unreadSources[0] })))[0], /^The proofs inside 1 definition were found .* since the usage pass has not read them/);
  assert.deepEqual(docNotes(buildDoc(input())).filter((n) => !n.includes(ODD)), [], "nothing to say where the pass's places were used");
  assert.match(docNotes(buildDoc(input({ view: view("decl(Fixture.bounded)"), source: () => null }))).join("\n"), /1 declaration of the project is printed from the graph's statement rather than from the source: Fixture\.bounded\./);
});

test("the settings decide the style; the title and the author line are the view's; what was a setting is taken and ignored", () => {
  const { input, view } = fixture();
  const lean = buildDoc(input({ settings: { ...DEFAULT_SETTINGS, contents: false } }));
  const leanTex = renderLatex(lean);
  assert.ok(!leanTex.includes("vpContents"));
  assert.match(leanTex, /\\end\{vpCard\}\n\\vpSection\{/, "the first section right after the head card");
  assert.match(renderLatex(buildDoc(input())), /\\end\{vpCard\}\n\\begin\{vpContents\}/, "the contents by default");
  // the head: the view's title as it is named, and the people who left a trace on it as one line
  const named = buildDoc(input({ view: view("all", { name: "my reading list", authors: ["Alice", "Bob", "Carol"] }) }));
  assert.deepEqual([named.head.title, named.head.author, named.view.title], ["my reading list", "Alice, Bob and Carol", "my reading list"]);
  assert.match(renderLatex(named), /\\vpTitle\{my reading list\}\{Alice, Bob and Carol\}/);
  assert.match(renderLatex(named), /pdfauthor=\{Alice, Bob and Carol\}/);
  assert.equal(buildDoc(input()).head.author, "", "nobody: no author line");
  assert.match(renderLatex(buildDoc(input())), /\\vpTitle\{Everything\}\{\}/);
  assert.deepEqual(readSettings({ paper: "letter", codeSize: 9.3 }), { settings: { ...DEFAULT_SETTINGS, paper: "letter", codeSize: 9.5 } });
  assert.match((readSettings({ contents: "no" }) as { error: string }).error, /contents is true or false/);
  // what was a setting until 2026-10-08, the appendix until 2026-10-09, and the title and the author
  // line since 2026-10-09, are taken and ignored, whatever they say
  assert.deepEqual(readSettings({ scheme: "status", lineNumbers: true, context: false, figure: true, supportIndex: false }), { settings: { ...DEFAULT_SETTINGS } });
  assert.deepEqual(readSettings({ title: "Mine", author: "Alice & Bob", paper: "letter" }), { settings: { ...DEFAULT_SETTINGS, paper: "letter" } });
  assert.deepEqual(readSettings({ title: "a\nb", author: 7 }), { settings: { ...DEFAULT_SETTINGS } });
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), ["codeSize", "contents", "fontSize", "margin", "paper"]);
  assert.match((readSettings({ colour: "red" }) as { error: string }).error, /not a setting/);
  assert.match((readSettings({ margin: 2 }) as { error: string }).error, /margin/);
  assert.match((readSettings([1]) as { error: string }).error, /object/);
});

test("a document's title is its view's, as the view is named: a short title made from its scope takes a capital, a name never changes", () => {
  const v = (scope: string, more: Partial<ViewData> = {}) => ({ id: "v9", name: null, scope: parseQuery(scope), ...more });
  // as people named it, even in lower case; the Project
  assert.equal(docTitle(v("all", { name: "my reading list" })), "my reading list");
  assert.equal(docTitle(v("key(A.flt_regular)", { name: "FLT: what to read" })), "FLT: what to read");
  assert.equal(docTitle({ id: PROJECT, name: null, scope: parseQuery("all") }), "Project");
  // made from its scope (the short title, shared/titles.ts): in lower case only because it is made,
  // so a capital, as a title is written, and a namespace in full
  assert.equal(docTitle(v("key(A.flt_regular)")), "Keys of flt_regular");
  assert.equal(docTitle(v("ns(FltRegular) except trusted")), "Namespace FltRegular − trusted");
  assert.equal(docTitle(v("uses(A.f)")), "What A.f uses");
  assert.equal(docTitle(v("tcb(A.x) and (key(A.t) or decl(A.x))")), "Keys of A.t in TCB of A.x", "a Keys pick zoomed in");
  assert.equal(docTitle(v("tcb(A.flt_regular) except trusted")), "TCB of flt_regular − trusted");
  // a target's view is titled by its scope, its link said by no word (the owner's decision of
  // 2026-10-12): its review set, or the TCB a click gives one with none
  assert.equal(docTitle({ id: "review:A.flt_regular", name: null, targets: ["A.flt_regular"], scope: reviewScope("A.flt_regular") }), "Review ★flt_regular");
  assert.equal(docTitle({ id: "v8", name: null, targets: ["A.flt_regular"], scope: parseQuery("tcb(A.flt_regular)") }), "TCB of flt_regular");
  // a view kept at a past build makes that build's document, and its title says the build, as the
  // view's does (ExportSpec decision 16); a name people gave stays as they wrote it
  assert.equal(docTitle(v("tcb(A.flt_regular) except trusted", { version: 3 }), { build: () => "Oct 9 22:27" }), "TCB of flt_regular − trusted @ Oct 9 22:27");
  assert.equal(docTitle(v("ns(FltRegular)", { version: 3 }), { build: () => "Oct 9 22:27" }), "Namespace FltRegular @ Oct 9 22:27");
  assert.equal(docTitle(v("all", { name: "Project @ Oct 9 22:27", version: 3 }), { build: () => "Oct 9 22:27" }), "Project @ Oct 9 22:27");
  assert.equal(docTitle(v("all", { name: "Reading list", version: 3 }), { build: () => "Oct 9 22:27" }), "Reading list");
  // one that begins with a declaration's name keeps it as Lean writes it
  assert.equal(docTitle(v("decl(A.flt_regular, A.helper)")), "flt_regular, helper");
  assert.equal(docTitle(v("decl(A.x) or decl(A.y)")), "A.x + A.y");
});

test("the author line: the people who left a trace on the view, in the order of their first, under the name they go by now", () => {
  const at = (m: number) => `2026-10-09T10:${String(m).padStart(2, "0")}:00.000Z`;
  const IVY = "0a1b2c3d4e"; // someone invited by a personal link, called "Ivy (old)" when she rescoped
  const place = { mode: "namespace" as const, in: [], world: [0, 0] as [number, number] };
  const v: ViewData = {
    id: "vX",
    name: "Reading list",
    scope: parseQuery("all"),
    clustering: "namespace",
    pins: { namespace: { nodes: { "A.a": [1, 1], "A.b": [2, 2], "A.c": [3, 3] }, clusters: {} }, module: { nodes: {}, clusters: { A: [0, 0] } } },
    folds: { namespace: [], module: [] },
    hidden: { namespace: [], module: [] },
    notes: [
      { id: "n1", text: "Read this first", place, open: true, by: "Nora", at: at(5), edited: { by: "Ivy (old)", person: IVY, at: at(9) } },
      { id: "n2", text: "An agent's", place, open: true, by: "Claude", agent: true, at: at(1) },
      { id: "n3", text: "A private reader's", place, open: true, by: null, at: at(2) },
    ],
    by: "Maker",
    at: at(0),
    kept: true,
  };
  const pins: PinAuthors = noAuthors();
  pins.namespace.nodes = {
    "A.a": { by: "Pia", at: at(3) },
    "A.b": { by: "Claude", agent: true, at: at(4) },
    "A.c": { by: null, at: at(1) },
    // a pin that is not kept now: its author is no trace
    "A.gone": { by: "Gus", at: at(1) },
  };
  pins.module.clusters = { A: { by: "Maker", at: at(12) } };
  const view = ({ of, ...e }: { at: string; by: string | null; what: "created" | "renamed" | "scope" | "relayout" | "version"; agent?: true; person?: string; of?: string }): StoredEvent => ({ id: 0, kind: "view", view: of ?? "vX", name: "Reading list", scope: "all", ...e });
  const note = (e: { at: string; by: string | null; what: "created" | "edited" | "deleted" }): StoredEvent => ({ id: 0, kind: "note", view: "vX", title: "Reading list", note: "n9", text: "…", ...e });
  const events: StoredEvent[] = [
    view({ at: at(2), by: "Rena", what: "renamed" }),
    // invited by a personal link, renamed since: shown by the name she goes by now
    view({ at: at(6), by: "Ivy (old)", person: IVY, what: "scope" }),
    // a private reader's re-layout carries no name; an agent's is no trace
    view({ at: at(7), by: null, what: "relayout" }),
    view({ at: at(8), by: "Claude", agent: true, what: "relayout" }),
    // a note written and deleted since: written all the same; deleting one is no trace
    note({ at: at(10), by: "Dee", what: "created" }),
    note({ at: at(11), by: "Del", what: "deleted" }),
    // another view's, one from before this view was made (another of the same id), the server's own
    view({ at: at(1), by: "Otto", what: "renamed", of: "vY" }),
    view({ at: "2026-10-08T09:00:00.000Z", by: "Bea", what: "relayout" }),
    view({ at: at(13), by: "VisualProof", what: "scope" }),
  ];
  const nameOf = (id: string) => (id === IVY ? "Ivy" : null);
  const names = authorsOf(viewTraces(v, pins, events), nameOf, ["VisualProof"]);
  assert.deepEqual(names, ["Maker", "Rena", "Pia", "Nora", "Ivy", "Dee"]);
  assert.equal(authorLine(names), "Maker, Rena, Pia, Nora, Ivy and Dee");
  assert.deepEqual([authorLine([]), authorLine(["Ann"]), authorLine(["Ann", "Bo"])], ["", "Ann", "Ann and Bo"]);
  // the order is the first trace's: a later one moves nobody up
  const early = authorsOf(viewTraces(v, pins, [...events, view({ at: at(0), by: "Dee", what: "version" })]), nameOf, ["VisualProof"]);
  assert.deepEqual(early, ["Maker", "Dee", "Rena", "Pia", "Nora", "Ivy"]);
  // a view nobody keeps is what its query looks like: who opened it made nothing
  assert.deepEqual(authorsOf(viewTraces({ ...v, kept: false, notes: [] }, undefined, []), nameOf), []);
  // the Project, with nothing recorded on it: nobody
  const project: ViewData = { ...v, id: PROJECT, name: null, by: null, at: new Date(0).toISOString(), notes: [] };
  assert.deepEqual(authorsOf(viewTraces(project, undefined, events.filter((e) => e.kind !== "view" || e.view !== "vX")), nameOf), []);
  // made by an agent: marked on the record, or, on a record made before the mark, known by the
  // name it acted under on this view as an agent
  assert.deepEqual(authorsOf(viewTraces({ ...v, by: "Claude", agent: true, notes: [] }, undefined, []), nameOf), []);
  assert.deepEqual(authorsOf(viewTraces({ ...v, by: "Claude", notes: [] }, undefined, [view({ at: at(0), by: "Claude", agent: true, what: "created" })]), nameOf), []);
  // a guest and a person who go by one name are printed once
  assert.deepEqual(authorsOf(viewTraces({ ...v, by: "Ivy", notes: [] }, undefined, [view({ at: at(2), by: "Ivy (old)", person: IVY, what: "renamed" })]), nameOf), ["Ivy"]);
});

test("names are escaped as every other: nothing a name or a heading says acts as LaTeX", () => {
  const { input, view } = fixture();
  const doc = buildDoc(input({ view: view(`decl(${JSON.stringify(ODD)}, Fixture.double)`) }));
  assert.deepEqual(printedDecls(doc).map((e) => e.name).sort(), ["Fixture.double", ODD].sort());
  const tex = renderLatex(doc);
  for (const h of ["\\input{", "\\write18{"]) assert.ok(!tex.includes(h), h);
  assert.match(tex, /«odd\\\}\\textbackslash\{\}input\\\{\/etc\/passwd\\\}\\%»/);
  assert.match(tex, /\\vpBS\{\}write18\\vpLB\{\}rm -rf \/\\vpRB\{\}/);
});

test("the fixture's documents, typeset: by namespace with a level hidden, and by file", { skip: !new Exporter(tmpdir()).available() && "xelatex is not installed" }, async () => {
  const { input, view } = fixture();
  const state = mkdtempSync(join(tmpdir(), "vp-doc-"));
  try {
    const ex = new Exporter(state);
    for (const v of [view("all", { hidden: ["Fixture.Point"] }), view("all", { clustering: "module" })]) {
      const doc = buildDoc(input({ view: { ...v, name: "Ivy's & Bob's {list} #1", authors: ["Alice & Bob", "Ivy"] } }));
      const job = ex.compile(renderLatex(doc));
      const done = await ex.wait(job.id);
      assert.equal(done?.state, "done", done?.log);
      assert.ok((done?.pages ?? 0) >= 2, `${done?.pages} pages`);
      assert.equal(ex.file(job.id, "pdf")?.body.subarray(0, 5).toString(), "%PDF-");
    }
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------- through the server

test("agents read the document of a view as its model, by the view's id; the old shapes are refused, saying what to ask", async () => {
  const { g } = fixture();
  const dir = mkdtempSync(join(tmpdir(), "vp-doc-api-"));
  try {
    mkdirSync(join(dir, "Fixture"));
    for (const f of ["Basic", "Use"]) writeFileSync(join(dir, "Fixture", `${f}.lean`), readFileSync(join(FIXTURE, "Fixture", `${f}.lean`)));
    const review = new ReviewStore(dir, join(dir, "review"));
    const alice = { name: "Alice", agent: false };
    review.append(alice, { op: "target", name: "Fixture.main_thm", by: "Alice", on: true }, "tc");
    review.append(alice, { op: "key", target: "Fixture.main_thm", name: "Fixture.double", by: "Alice", on: true }, "tc");
    const meta = { ...g.meta, project: { ...g.meta.project, root: dir } };
    const edges: number[] = [];
    for (let i = 0; i < g.n; i++) for (let e = g.outStart[i]; e < g.outStart[i + 1]; e++) edges.push(i, g.outDst[e], g.outSite[e]);
    const views = new Views(join(dir, "state"), LAYOUT_VERSION, () => {});
    const key = views.book.open(parseQuery("key(Fixture.main_thm)"), "Claude", Date.now(), { agent: true }).view;
    views.book.arrange(key.id, [{ op: "hide", mode: "namespace", key: "Fixture", on: true }], "Claude", { by: "Claude", agent: true });
    // someone invited by a personal link pins on it, under the name she went by then
    const IVY = "0a1b2c3d4e";
    views.book.arrange(key.id, [{ op: "pin", mode: "namespace", kind: "node", key: "Fixture.double", at: [3, 3] }], "Ivy (old)", { by: "Ivy (old)", person: IVY });
    const w = {
      project: { root: dir, files: new Map([["Fixture.Basic", "Fixture/Basic.lean"], ["Fixture.Use", "Fixture/Use.lean"]]), toolchain: "tc" },
      graph: { version: 1, fingerprint: "f00d", prep: { metaGz: gzipSync(JSON.stringify(meta)), edgesGz: gzipSync(Buffer.from(Int32Array.from(edges).buffer)) } },
      review,
      views,
      timeline: { events: [], add: (e: object) => ({ ...e, id: 1, at: "" }) },
      presence: { agentBeat: () => {}, agentView: () => null, drop: () => {} },
      people: () => [{ id: IVY, name: "Ivy", was: ["Ivy (old)"] }],
    } as unknown as World;
    const api = new AgentApi(w, null, "read");
    const claude: Caller = { name: "Claude", kind: "agent" };
    const ask = (path: string, q: Record<string, string>) => api.handle({ method: "GET", path, query: new URLSearchParams(q), body: null, caller: claude });
    const a = await ask("/api/agent/export", { view: "project", settings: JSON.stringify({ paper: "letter" }) });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const doc = a.body as DocModel;
    assert.equal(doc.head.fingerprint, "f00d");
    assert.equal(doc.settings.paper, "letter");
    // Alice reviewed declarations the Project prints: she is its author (ExportSpec decision 15)
    assert.deepEqual([doc.view.title, doc.head.title, doc.head.author, doc.count.declarations], ["Project", "Project", "Alice", 9]);
    // a target's key document is its Key view, here with its top level hidden: the target and the
    // declaration marked key for it, in no section
    const k = (await ask("/api/agent/export", { view: key.id })).body as DocModel;
    assert.deepEqual([declsIn(k.items).map((e) => e.name), sectionsIn(k.items), k.view.hidden], [["Fixture.double", "Fixture.main_thm"], [], ["Fixture"]]);
    assert.equal(k.head.title, "Keys of main_thm");
    // its author line: Alice, who reviewed what it prints, then Ivy, by the name she goes by now; not
    // the agent that made and arranged it
    assert.equal(k.head.author, "Alice and Ivy");
    // a title and an author line asked for are taken and ignored: they are the view's
    const asked = (await ask("/api/agent/export", { view: key.id, settings: JSON.stringify({ title: "Mine", author: "Bob" }) })).body as DocModel;
    assert.deepEqual([asked.head.title, asked.head.author, Object.hasOwn(asked.settings, "title")], ["Keys of main_thm", "Alice and Ivy", false]);
    // what is refused, and what it is told
    assert.equal((await ask("/api/agent/export", { view: "nope" })).status, 404);
    assert.equal((await ask("/api/agent/export", {})).status, 400);
    const old = await ask("/api/agent/export", { targets: "Fixture.main_thm", preset: "full" });
    assert.equal(old.status, 400);
    assert.match((old.body as { error: string }).error, /targets, preset are no longer taken/);
    assert.match((old.body as { hint: string }).hint, /Key view.*key\(<target>\).*full review set is a view of its scope, tcb\(<target>\) except trusted/);
    assert.equal((await ask("/api/agent/export", { view: "project", settings: "{bad" })).status, 400);
    assert.equal((await ask("/api/agent/export", { view: "project", settings: JSON.stringify({ paper: "a3" }) })).status, 400);
    const none = views.book.open(parseQuery("external"), "Claude").view;
    const empty = await ask("/api/agent/export", { view: none.id });
    assert.equal(empty.status, 400);
    assert.match((empty.body as { error: string }).error, /nothing to print/);
    // every export endpoint is in the reference, at any level: exporting only reads; no outline
    const index = (await api.handle({ method: "GET", path: "/api/agent/endpoints", query: new URLSearchParams(), body: null, caller: claude })).body as { endpoints: { path: string; method: string; needs?: string }[] };
    const ours = index.endpoints.filter((e) => e.path.startsWith("/api/agent/export"));
    assert.deepEqual(ours.map((e) => `${e.method} ${e.path}`).sort(), ["GET /api/agent/export", "GET /api/agent/export/file", "GET /api/agent/export/job", "POST /api/agent/export"]);
    assert.ok(ours.every((e) => !e.needs));
    // a server that does not typeset says so
    const start = await api.handle({ method: "POST", path: "/api/agent/export", query: new URLSearchParams(), body: { view: "project" }, caller: claude });
    assert.equal(start.status, 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("who reviewed what a document prints is among its authors: an opinion, approval or comment, a key mark, a target mark (the owner's decision, 2026-10-10)", () => {
  const d = emptyReview();
  const at = (m: number) => `2026-10-09T10:${String(m).padStart(2, "0")}:00.000Z`;
  d.opinions["A.held"] = [
    { by: "Olivia", verdict: "comment", comment: "off by one", at: at(5) },
    { by: "Claude", verdict: "comment", comment: "advice", at: at(1), agent: true },
  ] as never;
  d.opinions["A.other"] = [{ by: "Zed", verdict: "approve", at: at(0) }] as never;
  d.keys["A.target"] = { "A.held": { by: "Kim", at: at(7) } } as never;
  d.targets["A.held"] = { by: "Tara", at: at(9) } as never;
  const traces = reviewTraces(d, ["A.held", "A.unreviewed"]);
  // what is said of a declaration the view does not hold makes no author; an agent's advice neither
  assert.deepEqual(authorsOf(traces, () => null), ["Olivia", "Kim", "Tara"]);
  // with what was done to the view, in the order of the first trace
  assert.deepEqual(authorsOf([{ by: "Maker", at: at(6) }, ...traces], () => null), ["Olivia", "Maker", "Kim", "Tara"]);
});
