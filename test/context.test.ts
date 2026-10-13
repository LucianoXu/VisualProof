// The context a declaration is read in, as a block of Lean (shared/context.ts): what the source
// window shows above the code, and what an opinion records with the text it judged.

import assert from "node:assert/strict";
import { test } from "node:test";
import { binderNames, contextLines, contextText, judgedText, readContext, usedVariables } from "../src/shared/context.ts";

const file = `/-! A module doc that says
namespace NotReally
open Nothing
-/
namespace A.B
universe u
open X
open scoped Matrix
open Y (f g)
open Z hiding h
open W renaming p → q, r → s
set_option autoImplicit false

noncomputable section Inner
variable {α : Type u} [DecidableEq α]
  (R : α → α) -- a comment
variable (unused : Nat)
local notation "‖" a "‖" => R a
local infixl:65 " ⊕ " => fun a b => a
scoped instance : Inhabited Nat := ⟨0⟩
attribute [local simp] Nat.add_comm
local macro "twice" : term => \`(2)

section
variable (gone : Nat)
end

open Classical in
set_option maxHeartbeats 400000 in
/-- The one asked about. -/
def asked (x : α) : α := R x
end Inner

namespace C
end C

def later := 1
end A.B
`.split("\n");

const at = (prefix: string) => file.findIndex((l) => l.startsWith(prefix));

test("the context block: namespaces and sections as nested, every form of open, open … in, variables, local commands, options", () => {
  const c = readContext(file, at("/-- The one asked about."));
  assert.equal(
    contextText(c),
    [
      "namespace A.B",
      "universe u",
      "open X",
      "open scoped Matrix",
      "open Y (f g)",
      "open Z hiding h",
      "open W renaming p → q, r → s",
      "set_option autoImplicit false",
      "noncomputable section Inner",
      "variable {α : Type u} [DecidableEq α] (R : α → α)",
      "variable (unused : Nat)",
      'local notation "‖" a "‖" => R a',
      'local infixl:65 " ⊕ " => fun a b => a',
      "scoped instance : Inhabited Nat := ⟨0⟩",
      "attribute [local simp] Nat.add_comm",
      'local macro "twice" : term => `(2)',
      // what holds for this declaration alone comes last, right above it
      "open Classical in",
      "set_option maxHeartbeats 400000 in",
    ].join("\n"),
  );
  // each line says what it is and where it is written
  const lines = contextLines(c);
  assert.deepEqual(lines[0], { line: 5, kind: "namespace", text: "namespace A.B" });
  assert.deepEqual(lines.find((l) => l.kind === "section"), { line: 14, kind: "section", text: "noncomputable section Inner" });
  assert.deepEqual(lines.find((l) => l.kind === "variable")?.binds, ["α", "R"]);
});

test("what ended is gone: a section's commands, a namespace closed, an `open … in` used up", () => {
  const c = contextText(readContext(file, at("def later")));
  assert.equal(c, ["namespace A.B", "universe u", "open X", "open scoped Matrix", "open Y (f g)", "open Z hiding h", "open W renaming p → q, r → s", "set_option autoImplicit false"].join("\n"));
  // at the top of a file nothing is in force
  assert.equal(contextText(readContext(file, 0)), "");
  assert.equal(contextText(readContext(file, at("namespace A.B"))), "");
});

test("the variables a declaration seems to use: a name of theirs in its statement or its text, and the instances about them", () => {
  const lines = contextLines(readContext(file, at("/-- The one asked about.")));
  const used = usedVariables(lines, ["{α : Type u} → [inst : DecidableEq α] → (α → α) → α → α", "def asked (x : α) : α := R x"]);
  assert.deepEqual([...used].map((k) => lines[k].text), ["variable {α : Type u} [DecidableEq α] (R : α → α)"]);
  // a name inside another word, or after a dot, is not the variable
  assert.deepEqual([...usedVariables(lines, ["unusedThing x.unused"])], []);
  assert.deepEqual(binderNames("{α β : Type} [inst : Monad m] [Add α] (f : α → β := id) ⦃x⦄"), ["α", "β", "inst", "f"]);
});

test("what an opinion judges: the context, a blank line, then the text; read from the present text when the file was edited", () => {
  const range = [at("def asked") + 1, 0, at("def asked") + 1, 30];
  const t = judgedText(file, false, "A.B.asked", range)!;
  assert.ok(t.text.startsWith("namespace A.B\nuniverse u\n"));
  assert.ok(t.text.endsWith("set_option maxHeartbeats 400000 in\n\n/-- The one asked about. -/\ndef asked (x : α) : α := R x"));
  // an `open` added above it since it was compiled is part of what is read now
  const edited = [...file.slice(0, at("open Classical in")), "open Extra", ...file.slice(at("open Classical in"))];
  const e = judgedText(edited, true, "A.B.asked", range)!;
  assert.equal(e.edited, true);
  assert.match(e.text, /\nopen Extra\nopen Classical in\n/);
});
