// The usage pass (server/usage.ts, extractor/Usage.lean) on the fixture's notation
// (test/fixture/Fixture/Notation.lean), where every answer is known: the notation units and the
// edges into them with their sites, proofs left out of TCBs, an expansion's notation as a
// dependency of the notation that emitted it, the exact context, the proofs inside definitions
// (where they are, and the exported text without them), the cache. Needs lake.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { RawGraph, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_GRAMMAR, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { contextLines, contextText, exactContext, judgedText, readContext, usedVariables } from "../src/shared/context.ts";
import { Graph, MODE_SITES, shortName } from "../src/shared/viewgraph.ts";
import { offBoard, reviewQueue, reviewSet, whyChain } from "../src/shared/reviewqueue.ts";
import { emptyReview } from "../src/shared/review.ts";
import { packEdges, unpackEdges } from "../src/shared/edgecodec.ts";
import { extract } from "../src/server/extract.ts";
import { buildView, notationStatements } from "../src/server/view.ts";
import type { Extraction } from "../src/server/extract.ts";
import { openProject } from "../src/server/project.ts";
import type { Project } from "../src/server/project.ts";
import { UsagePass, mergeSpans, mergeUsage } from "../src/server/usage.ts";
import { copyFixture } from "./fixturecopy.ts";
import { buildDoc, printedDecls } from "../src/shared/doc/build.ts";
import type { DocSource } from "../src/shared/doc/build.ts";
import { renderLatex } from "../src/shared/doc/latex.ts";
import type { DeclEntry } from "../src/shared/doc/model.ts";
import { DEFAULT_SETTINGS } from "../src/shared/doc/settings.ts";
import { lakeTextHash } from "../src/server/status.ts";
import { testDirs } from "./tmpdirs.ts";

let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}
const opts = { skip: !haveLake };

let dir = "";
let state = "";
let project: Project;
let base: Extraction;
let merged: Extraction;
let g: RawGraph;
/** the fixture's texts as they were compiled (a test below edits one) */
const compiled = new Map<string, string>();
const quiet = () => {};

/** One pass over an extraction, merged: what the server serves once it is done. */
const passOver = async (ex: Extraction, jobs = 2) => {
  const pass = new UsagePass(project, testDirs(state), jobs, quiet);
  const plan = pass.plan(ex.graph);
  const results = await pass.run(plan);
  assert.ok(results, "the pass ran to its end");
  return { pass, plan, merged: mergeUsage(ex, plan, results!, pass.status.failed, pass.status.ms ?? 0) };
};

before(async () => {
  if (!haveLake) return;
  dir = copyFixture("vp-usage-");
  // the root does not import the notation module (it says why): it is built on its own
  execFileSync("lake", ["build", "Fixture.Notation"], { cwd: dir, stdio: "ignore" });
  for (const m of ["Basic", "Notation"]) compiled.set(`Fixture.${m}`, readFileSync(join(dir, `Fixture/${m}.lean`), "utf8"));
  project = openProject(dir, ["Fixture.Notation"]);
  state = join(dir, "state", "fixture");
  base = await extract(project, testDirs(state), quiet);
  ({ merged } = await passOver(base));
  g = merged.graph;
});
after(() => dir && rmSync(dir, { recursive: true, force: true }));

const id = (name: string) => {
  const i = g.nodes.findIndex((n) => n.name === name);
  assert.ok(i >= 0, `no node ${name}`);
  return i;
};
const site = (from: string, to: string) => g.edges.find(([s, d]) => s === id(from) && d === id(to))?.[2] ?? 0;
const reach = (from: string, sites: number) => {
  const seen = new Set([id(from)]);
  const stack = [id(from)];
  while (stack.length) {
    const u = stack.pop()!;
    for (const [s, d, m] of g.edges) if (s === u && m & sites && !seen.has(d)) (seen.add(d), stack.push(d));
  }
  return new Set([...seen].filter((i) => i < g.nodes.length).map((i) => g.nodes[i].name));
};
const tcb = (n: string) => reach(n, SITE_STMT | SITE_BODY);

const DBL = "Fixture.termDbl!_";
const DBL_RULE = "Fixture.termDbl!_.macro_rules";
const QUAD = "Fixture.termQuad!_";
const QUAD_RULE = "Fixture.termQuad!_.macro_rules";
const PICK = "Fixture.termPick!_";
const PICK_1 = "Fixture.termPick!_.macro_rules";
const PICK_2 = "Fixture.termPick!_.macro_rules_2";
const SQ = "Fixture.termSq!_";
const SQ_RULE = "Fixture.termSq!_.elab_rules";
const WRAP = "Fixture.termWrap!_";
const WRAP_RULE = "Fixture.termWrap!_.elab_rules";
const TRIP = "Fixture.tripStx";
/** local notation: private to its module, so qualified with the module's last part */
const BUMP = "Fixture.termBump_.Notation";
const NORM = "Fixture.«term‖_‖ₚ»";
const GRAMMAR = [DBL, QUAD, PICK, SQ, WRAP, TRIP];
const IMPLEMENTATIONS = [DBL_RULE, QUAD_RULE, PICK_1, PICK_2, SQ_RULE, WRAP_RULE, BUMP, NORM];

test("syntax extension commands are units of kind notation; the meta helper a rule calls is a unit", opts, () => {
  for (const n of [...GRAMMAR, ...IMPLEMENTATIONS]) assert.equal(g.nodes[id(n)].kind, "notation", n);
  // a local notation is one command: its parser and its rule, one unit
  assert.deepEqual(g.nodes[id(BUMP)].also, ["Fixture._aux_Fixture_Notation___macroRules__private_Fixture_Notation_0_Fixture_termBump__1"]);
  assert.equal(g.nodes[id("Fixture.twiceOf")].kind, "def");
  assert.ok(g.nodes[id("Fixture.twiceOf")].flags?.includes("meta"));
  // a notation's implementation is what its rule calls
  assert.equal(site(DBL_RULE, "Fixture.twiceOf"), SITE_BODY);
  assert.equal(base.graph.stats.notation, 14);
  assert.equal(base.graph.stats.grammar, 6);
});

test("a notation unit is grammar when it only declares syntax; anything with a macro or elaborator is an implementation", opts, () => {
  for (const n of GRAMMAR) assert.ok(g.nodes[id(n)].flags?.includes("grammar"), n);
  for (const n of IMPLEMENTATIONS) assert.ok(!g.nodes[id(n)].flags?.includes("grammar"), n);
  // a `notation` or a local one bundles its syntax and its rule: an implementation
  assert.ok(!g.nodes[id(NORM)].flags?.includes("grammar"));
  // what each interprets, and what interprets each syntax
  assert.deepEqual(g.nodes[id(DBL_RULE)].interprets, [DBL]);
  assert.deepEqual(g.nodes[id("Fixture.elabTrip")].interprets, [TRIP]);
  assert.deepEqual(g.nodes[id(PICK)].rules?.slice().sort(), [PICK_1, PICK_2]);
  assert.deepEqual(g.nodes[id(TRIP)].rules, ["Fixture.elabTrip"]);
});

test("notation units have stable, readable names; the Lean constant is kept", opts, () => {
  // named after the kind they interpret and the command they are, numbered in source order
  assert.equal(g.nodes[id(DBL_RULE)].leanName, "Fixture._aux_Fixture_Notation___macroRules_Fixture_termDbl!__1");
  assert.equal(g.nodes[id(PICK_2)].leanName, "Fixture._aux_Fixture_Notation___macroRules_Fixture_termPick!__2");
  assert.equal(g.nodes[id(SQ_RULE)].leanName, "Fixture._aux_Fixture_Notation___elabRules_Fixture_termSq!__1");
  // a syntax is its kind: its name is its constant
  assert.equal(g.nodes[id(DBL)].leanName, undefined);
  // what a card calls them
  assert.equal(shortName(g.nodes[id(DBL)]), "syntax · dbl!");
  assert.equal(shortName(g.nodes[id(DBL_RULE)]), "macro_rules · dbl!");
  assert.equal(shortName(g.nodes[id(PICK_2)]), "macro_rules #2 · pick!");
  assert.equal(shortName(g.nodes[id(SQ_RULE)]), "elab_rules · sq!");
  assert.equal(shortName(g.nodes[id(NORM)]), "notation · ‖ … ‖ₚ");
  // the command as written says what a bundle is where its constants cannot: `local notation`
  const nodes = g.nodes.map((v) => ({ ...v })) as ViewNode[];
  notationStatements(project, nodes);
  assert.equal(nodes[id(BUMP)].display, "notation · bump · in Notation");
  assert.equal(nodes[id(BUMP)].leanName, "Fixture.termBump_");
  assert.match(nodes[id(DBL_RULE)].type!, /^macro_rules\n {2}\| `\(dbl! \$x\) => twiceOf x$/);
});

test("a name stays as it is when the module around it changes: a rule elsewhere, other rules before it", opts, async () => {
  const other = mkdtempSync(join(tmpdir(), "vp-usage-names-"));
  try {
    cpSync(dir, other, { recursive: true, filter: (s) => !s.includes("/state") });
    const f = join(other, "Fixture/Notation.lean");
    // a whole new syntax with its rule before the rules of `dbl!`, and a second rule for `sq!`
    writeFileSync(
      f,
      readFileSync(f, "utf8")
        .replace("/-- `dbl! x` is `x + x`. -/", "syntax \"half! \" term:max : term\nmacro_rules | `(half! $x) => `($x / 2)\n\n/-- `dbl! x` is `x + x`. -/")
        .replace(/\nend Fixture\s*$/, "\nmacro_rules | `(sq! $x) => `($x * $x)\n\nend Fixture\n"),
    );
    // a rule for `dbl!` in another module
    writeFileSync(join(other, "Fixture/More.lean"), "import Fixture.Notation\nopen Lean\nnamespace Fixture\nmacro_rules | `(dbl! $x) => `(2 * $x)\nend Fixture\n");
    execFileSync("lake", ["build", "Fixture.Notation", "Fixture.More"], { cwd: other, stdio: "ignore" });
    const p = openProject(other, ["Fixture.More"]);
    const ex = await extract(p, testDirs(join(other, "state", "x")), quiet);
    const names = new Set(ex.graph.nodes.map((v) => v.name));
    for (const n of [DBL_RULE, QUAD_RULE, PICK_1, PICK_2, SQ_RULE]) assert.ok(names.has(n), `${n} kept its name`);
    // the new ones: a second rule for `sq!` in its module, and `dbl!`'s rule elsewhere, by module
    assert.ok(names.has("Fixture.termSq!_.elab_rules") && names.has("Fixture.termSq!_.macro_rules"));
    const more = ex.graph.nodes.find((v) => v.name === "Fixture.termDbl!_.macro_rules.More");
    assert.equal(more?.display, "macro_rules · dbl! · in More");
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test("grammar is outside the TCB; a declaration depends on the rule that interprets its text, with the site", opts, () => {
  // the rule that ran, in the TCB; the syntax at the grammar site, outside it
  assert.equal(site("Fixture.dbl_eq", DBL), SITE_GRAMMAR);
  assert.equal(site("Fixture.dbl_eq", DBL_RULE), SITE_STMT);
  assert.equal(site("Fixture.square", SQ), SITE_GRAMMAR);
  assert.equal(site("Fixture.square", SQ_RULE), SITE_BODY);
  assert.equal(site("Fixture.tripled", TRIP), SITE_GRAMMAR);
  assert.equal(site("Fixture.tripled", "Fixture.elabTrip"), SITE_BODY);
  // a bundle is an implementation, in the TCB
  assert.equal(site("Fixture.bumped", BUMP), SITE_BODY);
  assert.equal(site("Fixture.sized", NORM), SITE_BODY);
  // a `by` block whose goal is data is the body, not a proof
  assert.equal(site("Fixture.picked", PICK), SITE_GRAMMAR);
  assert.equal(site("Fixture.picked", PICK_2), SITE_BODY);
  // its TCB: the rule and what the rule calls, not the syntax
  const t = tcb("Fixture.dbl_eq");
  for (const n of [DBL_RULE, "Fixture.twiceOf"]) assert.ok(t.has(n), n);
  assert.ok(!t.has(DBL));
  assert.ok(tcb("Fixture.tripled").has("Fixture.elabTrip") && !tcb("Fixture.tripled").has(TRIP));
  // no edge into grammar is one a TCB follows
  for (const [s, d, m] of g.edges) if (d < g.nodes.length && GRAMMAR.includes(g.nodes[d].name)) assert.equal(m & (SITE_STMT | SITE_BODY), 0, `${g.nodes[s].name} → ${g.nodes[d].name}`);
  // a rule depends on the syntax it interprets at the grammar site, for the reader; a syntax on
  // nothing that means
  assert.equal(site(DBL_RULE, DBL), SITE_GRAMMAR);
  assert.equal(site("Fixture.elabTrip", TRIP), SITE_GRAMMAR);
  assert.equal(site(DBL, DBL_RULE), 0);
  // the extractor's graph alone has none of the uses: they are the pass's
  assert.ok(!base.graph.edges.some(([s, d]) => base.graph.nodes[s]?.name === "Fixture.dbl_eq" && base.graph.nodes[d]?.name === DBL_RULE));
});

test("a rule that runs where the info tree does not say so is still reached: the only rule of the syntax in the text", opts, () => {
  // `wrap!` expands `dbl!` by hand: only the text names `dbl!`
  assert.equal(site("Fixture.wrapped", WRAP_RULE), SITE_BODY);
  assert.equal(site("Fixture.wrapped", DBL), SITE_GRAMMAR);
  assert.equal(site("Fixture.wrapped", DBL_RULE), SITE_BODY);
  for (const n of [WRAP_RULE, DBL_RULE, "Fixture.twiceOf"]) assert.ok(tcb("Fixture.wrapped").has(n), n);
  assert.ok(g.usage!.stats.ruleEdges! > 0);
});

test("leaving grammar out of the TCB leaves out no implementation the grammar reached", opts, () => {
  // the TCB as it was with grammar in it: grammar edges followed, and a syntax with one rule
  // depending on it
  const n = g.nodes.length;
  const out = new Map<number, number[]>();
  const push = (s: number, d: number) => out.set(s, [...(out.get(s) ?? []), d]);
  for (const [s, d, m] of g.edges) if (m & (SITE_STMT | SITE_BODY | SITE_GRAMMAR)) push(s, d);
  g.nodes.forEach((v, i) => {
    if (v.flags?.includes("grammar") && v.rules?.length === 1) push(i, id(v.rules[0]));
  });
  const withGrammar = (from: number) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) for (const d of out.get(stack.pop()!) ?? []) if (!seen.has(d)) (seen.add(d), stack.push(d));
    return seen;
  };
  for (let i = 0; i < n; i++) {
    const v = g.nodes[i];
    if (v.flags?.includes("grammar")) continue;
    const now = tcb(v.name);
    for (const j of withGrammar(i)) {
      if (j >= n || g.nodes[j].flags?.includes("grammar")) continue;
      assert.ok(now.has(g.nodes[j].name), `${v.name} reached ${g.nodes[j].name} through grammar, and no longer does`);
    }
  }
});

test("a review leaves grammar out: its set, its queue, why a declaration is in it", opts, () => {
  const view = buildView(project, merged, quiet);
  const G = new Graph(view.meta, view.edges);
  const d = emptyReview();
  const root = G.byName.get("Fixture.quadruple")!;
  const set = reviewSet(G, d, root);
  const has = (n: string) => set[G.byName.get(n)!] === 1;
  for (const n of [QUAD_RULE, DBL_RULE, "Fixture.twiceOf"]) assert.ok(has(n), n);
  for (const n of [QUAD, DBL]) assert.ok(!has(n), n);
  const q = reviewQueue(G, d, root, []);
  const queued = [...q.order.map((i) => G.nodes[i].name), ...offBoard(q).map((a) => a.name)];
  assert.ok(!queued.some((n) => GRAMMAR.includes(n)), "the queue holds no grammar");
  assert.equal(whyChain(G, root, G.byName.get(QUAD)!), null);
  assert.deepEqual(whyChain(G, root, G.byName.get(DBL_RULE)!)?.map((i) => G.nodes[i].name), ["Fixture.quadruple", QUAD_RULE, DBL_RULE]);
  // the Uses tool still shows the grammar, to go to it
  assert.equal(G.reach([root], MODE_SITES.deps, "out")[G.byName.get(QUAD)!], 1);
});

test("of a kind's two rules, only the one that ran is depended on", opts, () => {
  assert.equal(site("Fixture.picked", PICK_1), 0);
  assert.ok(tcb("Fixture.picked").has(PICK_2));
  assert.ok(!tcb("Fixture.picked").has(PICK_1));
  // each rule interprets the syntax; the syntax brings neither
  assert.equal(site(PICK, PICK_1), 0);
  assert.equal(site(PICK, PICK_2), 0);
  assert.equal(site(PICK_1, PICK), SITE_GRAMMAR);
  assert.equal(site(PICK_2, PICK), SITE_GRAMMAR);
});

test("notation used only in a proof is an edge at the proof site, outside the TCB", opts, () => {
  assert.equal(site("Fixture.four_mul", QUAD), SITE_PROOF);
  assert.equal(site("Fixture.four_mul", QUAD_RULE), SITE_PROOF);
  assert.ok(!tcb("Fixture.four_mul").has(QUAD) && !tcb("Fixture.four_mul").has(QUAD_RULE));
  assert.ok(reach("Fixture.four_mul", 7).has(QUAD));
});

test("a notation an expansion emits is a dependency of the notation that emitted it", opts, () => {
  assert.equal(site("Fixture.quadruple", QUAD), SITE_GRAMMAR);
  assert.equal(site("Fixture.quadruple", QUAD_RULE), SITE_BODY);
  // `dbl!` was written by the rule of `quad!`, not in `quadruple`
  assert.equal(site("Fixture.quadruple", DBL), 0);
  assert.equal(site("Fixture.quadruple", DBL_RULE), 0);
  assert.equal(site(QUAD_RULE, DBL), SITE_GRAMMAR);
  assert.ok(site(QUAD_RULE, DBL_RULE) & SITE_BODY);
  for (const n of [QUAD_RULE, DBL_RULE, "Fixture.twiceOf"]) assert.ok(tcb("Fixture.quadruple").has(n), n);
  for (const n of [QUAD, DBL]) assert.ok(!tcb("Fixture.quadruple").has(n), n);
});

test("an unexpander only changes how a term shows: what it refers to is not in the TCB", opts, () => {
  const unexp = g.externals.findIndex((x) => x.name === "Lean.PrettyPrinter.UnexpandM");
  assert.ok(unexp >= 0);
  assert.equal(g.edges.find(([s, d]) => s === id(NORM) && d === g.nodes.length + unexp)?.[2], SITE_PROOF);
});

test("the exact context: the elaborator's scope, with the variables Lean included", opts, () => {
  const file = join(dir, "Fixture/Notation.lean");
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const m = g.usage!.contexts["Fixture.Notation"];
  assert.equal(m.hash, lakeTextHash(text));
  const c = exactContext(m, "Fixture.withK", lakeTextHash(text))!;
  assert.ok(c.exact);
  assert.equal(c.namespace, "Fixture");
  assert.deepEqual(c.blocks.map((b) => [b.kind, b.name]), [["namespace", "Fixture"], ["section", "Vars"]]);
  assert.deepEqual(c.opens.map((o) => o.text), ["open Lean"]);
  assert.deepEqual(c.variables.map((v) => [v.text, !!v.used]), [["{α : Type}", true], ["[Inhabited α]", true], ["(k : Nat)", true], ["(unused : Nat)", false]]);
  // the source window marks those, not a guess from the words
  const ctx = contextLines(readContext(lines, 0, c));
  assert.deepEqual([...usedVariables(ctx, [], true)].map((k) => ctx[k].text), ["variable {α : Type}", "variable [Inhabited α]", "variable (k : Nat)"]);
  // local notation in force, after the variables' section opened
  const b = exactContext(m, "Fixture.bumped", lakeTextHash(text))!;
  assert.deepEqual(b.local.map((l) => l.text), ['local notation "bump " x => x + 1']);
  // the text judged: the exact context block, a blank line, the declaration
  const w = g.nodes[id("Fixture.withK")];
  const judged = judgedText(lines, false, w.name, w.range!, c)!.text;
  assert.ok(judged.startsWith(`${contextText(c)}\n\n/-- Takes`), judged);
  assert.match(contextText(c), /^open Lean\nnamespace Fixture\nsection Vars\nvariable \{α : Type\}/);
  // another text than the one elaborated: no exact context, the text is read
  assert.equal(exactContext(m, "Fixture.withK", "0000000000000000"), null);
});

/** The text of a span [line, col, endLine, endCol] (columns in code points) in a compiled module. */
const spanText = (module: string, [l, c, el, ec]: number[]) => {
  const lines = compiled.get(module)!.split("\n");
  const cp = (k: number) => [...lines[k - 1]];
  return l === el ? cp(l).slice(c, ec).join("") : [cp(l).slice(c).join(""), ...lines.slice(l, el - 1), cp(el).slice(0, ec).join("")].join("\n");
};

test("the proofs inside definitions: `by` blocks whose goal is a proposition, decreasing_by, term-mode proofs; never a signature", opts, () => {
  const proofs = (n: string) => (g.nodes[id(n)].proofs ?? []).map((sp) => spanText(g.nodes[id(n)].module, sp));
  // an instance's fields: a tactic proof on several lines, its comment inside it; a lemma's name as
  // a field's whole value
  assert.deepEqual(proofs("Fixture.instLawfulNat"), ["by\n    intro a b c\n    -- by the library\n    exact Nat.add_assoc a b c", "Nat.add_comm"]);
  // a structure instance's field; a term-mode proof as an argument
  assert.deepEqual(proofs("Fixture.onePos"), ["by decide"]);
  assert.deepEqual(proofs("Fixture.twoPos"), ["Nat.lt_of_lt_of_le Nat.zero_lt_one (Nat.le_succ 1)"]);
  assert.deepEqual(proofs("Fixture.bounded"), ["size_le p"]);
  // a `by` block that is data stays, a proof nested in it does not, nor does data nested in it
  assert.deepEqual(proofs("Fixture.three"), ["by decide"]);
  assert.deepEqual(proofs("Fixture.picked"), []);
  // in the middle of a term, on two lines; `decreasing_by`'s tactics, its keyword kept
  assert.deepEqual(proofs("Fixture.firstPlus"), ["by\n    omega"]);
  assert.deepEqual(proofs("Fixture.halve"), ["omega"]);
  // `h.elim` after `:=` is data: `h`, a part of the name Lean splits off, is not cut out of it
  assert.deepEqual(proofs("Fixture.fromFalse"), []);
  assert.deepEqual(proofs("Fixture.instDecidableEqPoint"), ["by cases a; cases b; simp_all", "by intro e; subst e; exact h ⟨rfl, rfl⟩"]);
  // a `by` in a signature is data; a theorem's value is cut whole already; a notation's expansion is
  // its meaning
  for (const n of ["Fixture.Pos", "Fixture.Lawful", "Fixture.dbl_eq", "Fixture.four_mul", DBL_RULE, SQ_RULE]) assert.deepEqual(proofs(n), [], n);
  assert.equal(g.usage!.stats.proofSpans, 10);
  // spans merge when they meet
  assert.deepEqual(mergeSpans([[3, 4, 5, 0], [1, 0, 1, 2], [3, 6, 4, 1], [5, 0, 5, 3], [1, 3, 1, 4]]), [[1, 0, 1, 2], [1, 3, 1, 4], [3, 4, 5, 3]]);
});

test("the exported text of the fixture's definitions: each proof is `…`, the lines it took gone; found by reading the text where the pass has not read it", opts, () => {
  const view = buildView(project, merged, quiet);
  const G = new Graph(view.meta, view.edges);
  const files = new Map(view.meta.modules.map((m) => [m.name, m.file]));
  const source = (m: string): DocSource | null => {
    const text = compiled.get(m);
    return text === undefined ? null : { lines: text.split("\n"), edited: false, contexts: merged.graph.usage!.contexts[m] ?? null, hash: lakeTextHash(text) };
  };
  const names = ["Fixture.instLawfulNat", "Fixture.firstPlus", "Fixture.three", "Fixture.halve", "Fixture.Pos", "Fixture.picked", "Fixture.dbl_eq"];
  // a view of just these
  const these = { id: "v", name: "these", scope: { op: "decl" as const, names }, clustering: "namespace" as const, hidden: [], authors: [] };
  const doc = buildDoc({
    g: G, review: emptyReview(), view: these, settings: { ...DEFAULT_SETTINGS }, source, fileOf: (m) => files.get(m) ?? null,
    build: { fingerprint: merged.fingerprint, commit: null },
  });
  const entries = new Map(printedDecls(doc).map((e) => [e.name, e]));
  const text = (e: DeclEntry) => e.code.lines.map((l) => l.map((t) => t[1]).join("")).join("\n");
  const inst = entries.get("Fixture.instLawfulNat")!;
  assert.equal(text(inst), "instance : Lawful Nat where\n  op := Nat.add\n  op_assoc := …\n  op_comm := … -- a comment after the proof stays");
  assert.equal(inst.code.proofsCut, 2);
  const first = entries.get("Fixture.firstPlus")!;
  assert.equal(text(first), "def firstPlus (xs : Array Nat) (h : 0 < xs.size) : Nat :=\n  xs[0]'(…) + 1");
  assert.equal(text(entries.get("Fixture.three")!), "def three : Fin 5 := by\n  exact ⟨(by exact 3), …⟩");
  assert.equal(text(entries.get("Fixture.halve")!), "def halve (n : Nat) : Nat := if h : n = 0 then 0 else halve (n / 2) + 1\ndecreasing_by …");
  // a signature's `by` and a `by` block that is data are printed; a theorem stops at its statement
  assert.match(text(entries.get("Fixture.Pos")!), /pos : 0 < val := by decide$/);
  assert.equal(text(entries.get("Fixture.picked")!), "def picked : Nat := by exact pick! 5");
  assert.equal(text(entries.get("Fixture.dbl_eq")!), "theorem dbl_eq (n : Nat) : dbl! n = 2 * n := …");
  // in LaTeX, the line after the cut follows the one with the cut, unnumbered
  const tex = renderLatex(doc);
  assert.ok(tex.includes("  op_assoc := \\vpTkElided{…}\n  op_comm := \\vpTkElided{…}"), "the lines of a proof are gone, nothing in their place");
  assert.ok(!tex.includes("\\vpLineNo"));
  // the same definitions where the pass has not read the text: printed whole all the same, the
  // proofs found by reading it. It agrees with the pass on `by` blocks that prove; it leaves out a
  // `by` block that builds data (three, picked), and keeps a term-mode proof (op_comm's)
  const unread = buildDoc({
    g: G, review: emptyReview(), view: these, settings: { ...DEFAULT_SETTINGS }, source: (m) => { const s = source(m); return s && { ...s, contexts: null }; }, fileOf: (m) => files.get(m) ?? null,
    build: { fingerprint: merged.fingerprint, commit: null },
  });
  const read = new Map(printedDecls(unread).map((e) => [e.name, e]));
  assert.equal(text(read.get("Fixture.instLawfulNat")!), "instance : Lawful Nat where\n  op := Nat.add\n  op_assoc := …\n  op_comm := Nat.add_comm -- a comment after the proof stays");
  for (const n of ["Fixture.firstPlus", "Fixture.halve", "Fixture.Pos", "Fixture.dbl_eq"]) assert.equal(text(read.get(n)!), text(entries.get(n)!), n);
  assert.equal(text(read.get("Fixture.three")!), "def three : Fin 5 := …");
  assert.equal(text(read.get("Fixture.picked")!), "def picked : Nat := …");
  assert.deepEqual(names.map((n) => read.get(n)!.code.textCut ?? null), ["unread", "unread", "unread", "unread", null, "unread", null], "definitions only");
});

test("a module the pass cannot elaborate is reported; the others are merged", opts, async () => {
  const pass = new UsagePass(project, testDirs(state), 2, quiet);
  const plan = pass.plan(base.graph);
  plan.todo.push({ module: "Fixture.Gone", file: "Fixture/Gone.lean", key: "k", hash: "h", opts: [] });
  plan.modules.push("Fixture.Gone");
  const results = await pass.run(plan);
  assert.ok(results);
  assert.deepEqual(pass.status.failed.map((f) => f.module), ["Fixture.Gone"]);
  const m = mergeUsage(base, plan, results!, pass.status.failed, 0);
  assert.deepEqual(m.graph.usage!.failed.map((f) => f.module), ["Fixture.Gone"]);
  assert.ok(m.graph.usage!.contexts["Fixture.Notation"]);
  assert.notEqual(m.fingerprint, merged.fingerprint, "what failed is part of what the graph is");
});

test("the cache: an unchanged module is reused, a rebuilt one elaborated again", opts, async () => {
  const again = await passOver(base);
  assert.equal(again.plan.todo.length, 0);
  assert.deepEqual([...again.plan.cached.keys()].sort(), ["Fixture.Basic", "Fixture.Notation"]);
  assert.equal(again.merged.fingerprint, merged.fingerprint);
  assert.deepEqual(again.merged.graph.edges, g.edges);
  // a change to the notation module, built: only it runs again
  const f = join(dir, "Fixture/Notation.lean");
  writeFileSync(f, readFileSync(f, "utf8").replace("end Vars", "/-- One more. -/\ndef sixfold (n : Nat) : Nat := dbl! n + dbl! n + dbl! n\n\nend Vars"));
  execFileSync("lake", ["build", "Fixture.Notation"], { cwd: dir, stdio: "ignore" });
  const ex = await extract(project, testDirs(state), quiet);
  const pass = new UsagePass(project, testDirs(state), 2, quiet);
  const plan = pass.plan(ex.graph);
  assert.deepEqual(plan.todo.map((t) => t.module), ["Fixture.Notation"]);
  assert.deepEqual([...plan.cached.keys()], ["Fixture.Basic"]);
  // a file changed since it was compiled is not elaborated: its places would not be the graph's
  writeFileSync(f, readFileSync(f, "utf8") + "\n-- edited\n");
  const later = new UsagePass(project, testDirs(join(dir, "state", "other")), 2, quiet).plan(ex.graph);
  assert.deepEqual(later.skipped.map((s) => s.module), ["Fixture.Notation"]);
});

test("the grammar site travels to pages packed; a page from before takes it for a proof", () => {
  const edges = new Int32Array([0, 1, SITE_GRAMMAR, 0, 2, SITE_GRAMMAR | SITE_PROOF, 1, 2, SITE_STMT, 2, 0, SITE_BODY | SITE_PROOF]);
  assert.deepEqual([...unpackEdges(packEdges(edges, 3))], [...edges]);
  const before = unpackEdges(packEdges(edges, 3, 1));
  assert.deepEqual([...before], [0, 1, SITE_PROOF, 0, 2, SITE_PROOF, 1, 2, SITE_STMT, 2, 0, SITE_BODY | SITE_PROOF]);
});
