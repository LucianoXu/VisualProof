// The InfoView asks Lean's language server (server/hover.ts, `goals`, `subterm`; ReviewSpec, "The
// InfoView"): the goals before and after the tactic at a place, through Lean's RPC with each subterm
// numbered, what a subterm is, the expected type of a term, the widgets Lean has there counted and
// never fetched; what the RPC holds let go of; nothing written into the project. Run on every
// toolchain (scripts/test-toolchains.mjs): the shapes of Lean's answers are the toolchain's.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { flatten, goalText } from "../src/shared/goals.ts";
import type { Goal, GoalsAnswer, Tagged } from "../src/shared/goals.ts";
import { LeanHover } from "../src/server/hover.ts";
import { openProject } from "../src/server/project.ts";
import { lakeTextHash } from "../src/server/status.ts";
import { copyFixture } from "./fixturecopy.ts";

let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}

/** A file of proofs the InfoView steps through: written into the fixture's copy, never built (Lean's
 *  server elaborates it from its text against the build of what it imports). */
const STEPS = `import Fixture.Basic

namespace Fixture

theorem steps (p q : Point) (h : p = q) : q.size = p.size := by
  subst h
  rfl

theorem by_cases (n : Nat) : n + 0 = n := by
  cases n with
  | zero => rfl
  | succ k => simp

theorem term_mode (p : Point) : p.x ≤ p.size := Nat.le_add_right _ _

end Fixture
`;

/** A widget at a place: Lean's core's `#widget`, whose JavaScript is never asked for. */
const WIDGET = `import Lean
open Lean Widget

@[widget_module]
def hello : Widget.Module where
  javascript := "export default function () { return null }"

#widget hello
`;

/** Every file under `dir` with its modification time. */
function listing(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(p, statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return out;
}

/** Every subterm number of a tagged text. */
const keys = (t: Tagged): number[] => (typeof t === "string" ? [] : Array.isArray(t) ? t.flatMap(keys) : [t.k, ...keys(t.t)]);

test("the goals at a place: before and after its tactic, tagged; a subterm's type; a term's expected type; a widget counted; nothing written", { skip: !haveLake && "no lake" }, async () => {
  const dir = copyFixture("vp-goals-");
  const state = mkdtempSync(join(tmpdir(), "vp-goals-state-"));
  let started: LeanHover | null = null;
  try {
    execFileSync("lake", ["build"], { cwd: dir, stdio: "ignore" });
    const built = listing(join(dir, ".lake"));
    writeFileSync(join(dir, "Fixture", "Steps.lean"), STEPS);
    writeFileSync(join(dir, "Fixture", "Widget.lean"), WIDGET);
    const hover = new LeanHover(openProject(dir, [], true), state);
    started = hover;
    // what the server tells Lean, to see what it lets go of
    const said: string[] = [];
    const inner = hover as unknown as { notify(m: string, p: unknown): void };
    const notify = inner.notify.bind(hover);
    inner.notify = (m, p) => (said.push(m), notify(m, p));
    const rel = "Fixture/Steps.lean";
    const text = readFileSync(join(dir, rel), "utf8");
    const lines = text.split("\n");
    const hash = lakeTextHash(text);
    const ask = async (line: number, ch: number): Promise<GoalsAnswer> => {
      let a = await hover.goals(rel, text, hash, line, ch, 60000);
      for (let k = 0; a.pending && k < 30; k++) a = await hover.goals(rel, text, hash, line, ch, 60000);
      assert.ok(!a.pending && !a.error, JSON.stringify(a));
      return a;
    };
    const subst = lines.findIndex((l) => l.trim() === "subst h");
    // at `h` of `subst h`: the tactic is the whole of it; before it, h; after it, h substituted away
    const a = await ask(subst, lines[subst].indexOf("h"));
    assert.deepEqual(a.tactic, { line: subst, from: 2, to: 9 });
    assert.equal(a.interactive, true, "Lean's RPC answered");
    assert.equal(a.before?.length, 1);
    const before = a.before![0];
    assert.match(goalText(before), /^p q : Point\nh : p = q\n⊢ q\.size = p\.size$/, goalText(before));
    assert.equal(a.after?.length, 1);
    assert.ok(!goalText(a.after![0]).includes("h : p = q"), goalText(a.after![0]));
    assert.match(flatten(a.after![0].type), /^(p|q)\.size = (p|q)\.size$/);
    // `h` is a term of the tactic's: its expected type, with what is in scope
    assert.equal(flatten(a.term!.type), "p = q");
    // each subterm numbered once across the answer; a hypothesis the tactic takes away marked
    const ks = [...(a.before ?? []), ...(a.after ?? [])].flatMap((g: Goal) => [...g.hyps.flatMap((h) => keys(h.type)), ...keys(g.type)]);
    assert.ok(ks.length >= 4);
    assert.equal(new Set(ks).size, ks.length);
    assert.ok(before.hyps.some((h) => h.d === "removed"), "Lean's diff: what the tactic takes away");
    // what a subterm is: the goal's type, a Prop; its parts, asked by their numbers
    const goalKey = keys(before.type)[0];
    const info = await hover.subterm(rel, text, hash, subst, lines[subst].indexOf("h"), goalKey, 60000);
    assert.equal(info.type, "Prop", JSON.stringify(info));
    assert.match(info.expr ?? "", /size/);
    const eqDoc = await hover.subterm(rel, text, hash, subst, lines[subst].indexOf("h"), 99999, 60000);
    assert.ok(eqDoc.error, "a number the answer does not give is refused");
    // the last tactic: after it, no goals
    const rfl = lines.findIndex((l) => l.trim() === "rfl");
    const r = await ask(rfl, 3);
    assert.equal(r.before?.length, 1);
    assert.deepEqual(r.after, []);
    // a case's arm: its head is no tactic
    const succ = lines.findIndex((l) => l.includes("| succ k => simp"));
    const s = await ask(succ, lines[succ].indexOf("simp"));
    assert.equal(lines[succ].slice(s.tactic!.from, s.tactic!.to), "simp");
    assert.equal(s.before?.length, 1);
    assert.match(flatten(s.before![0].type), /k \+ 1 \+ 0 = k \+ 1|Nat\.succ k \+ 0 = Nat\.succ k/);
    // a term: its expected type, with what is in scope
    const term = lines.findIndex((l) => l.startsWith("theorem term_mode"));
    const t = await ask(term, lines[term].indexOf("Nat.le_add_right"));
    assert.equal(t.before ?? null, null);
    assert.equal(flatten(t.term!.type), "p.x ≤ p.size");
    assert.deepEqual(t.term!.hyps.map((h) => h.names), [["p"]]);
    assert.deepEqual(t.term!.range.slice(0, 2), [term, lines[term].indexOf("Nat.le_add_right")]);
    // a place asked again is answered from what was kept; past what is kept, what Lean holds for
    // the oldest is let go
    const released = () => said.filter((m) => m === "$/lean/rpc/release").length;
    const was = released();
    assert.ok(was >= 1, "what a subterm's popup holds is let go once read");
    for (let c = 0; c < 36; c++) await ask(term, c);
    assert.ok(released() > was, "what Lean holds for an answer let go is released");
    // a widget: counted, never asked for (its JavaScript is the project's code)
    const wrel = "Fixture/Widget.lean";
    const wtext = readFileSync(join(dir, wrel), "utf8");
    const wl = wtext.split("\n").findIndex((l) => l.startsWith("#widget"));
    let w = await hover.goals(wrel, wtext, lakeTextHash(wtext), wl, 3, 60000);
    for (let k = 0; w.pending && k < 30; k++) w = await hover.goals(wrel, wtext, lakeTextHash(wtext), wl, 3, 60000);
    assert.equal(w.widgets, 1, JSON.stringify(w));
    // where Lean's RPC cannot be had, its plain answers: the same goals, untagged
    (hover as unknown as { session(): Promise<null> }).session = async () => null;
    const plain = await ask(subst, lines[subst].indexOf("subst") + 1);
    assert.equal(plain.interactive, false);
    assert.equal(goalText(plain.before![0]), goalText(before));
    assert.equal(goalText(plain.after![0]), goalText(a.after![0]));
    assert.ok(typeof plain.before![0].type === "string");
    hover.stop();
    // nothing under .lake was written or touched
    const afterwards = listing(join(dir, ".lake"));
    assert.deepEqual([...afterwards.keys()].sort(), [...built.keys()].sort(), "files appeared or vanished under .lake");
    for (const [f, t] of built) assert.equal(afterwards.get(f), t, `${f} was written`);
  } finally {
    started?.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});
