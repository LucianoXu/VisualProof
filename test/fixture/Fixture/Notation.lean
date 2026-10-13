import Lean
import Fixture.Basic

/-! Notation written in the project (TCBSpec.md, decision 2), for test/usage.test.ts: a syntax with
its rule, a rule that emits another notation, a kind with two rules of which one fires, an
`elab_rules`, an elaborator that expands the macros in its argument by hand, an elaborator written as
a declaration registered for its kind, a `notation` with an unexpander, local notation, and a meta
helper a rule calls; declarations written with them in their
statements, their bodies, a `by` block that is data, and a proof only.

The root module does not import this one, so that what the other tests count stays as it is: the
usage test builds and reads it on its own. -/

open Lean

namespace Fixture

/-- A meta helper: the rule of `dbl!` calls it. -/
def twiceOf (t : TSyntax `term) : MacroM (TSyntax `term) := `($t + $t)

/-- `dbl! x` is `x + x`. -/
syntax "dbl! " term:max : term

macro_rules
  | `(dbl! $x) => twiceOf x

/-- `quad! x` is `dbl! (dbl! x)`: its rule emits another notation of the project. -/
syntax "quad! " term:max : term

macro_rules
  | `(quad! $x) => `(dbl! (dbl! $x))

/-- `pick! x`: two rules, the later tried first. -/
syntax "pick! " term:max : term

/-- The general rule: `x * 3`. -/
macro_rules
  | `(pick! $x) => `($x * 3)

/-- The rule for a numeral, `n + 1`: it fires on numerals, and passes anything else to the first. -/
macro_rules
  | `(pick! $n:num) => `($n + 1)

/-- `sq! x` is `x * x`, elaborated. -/
syntax "sq! " term:max : term

elab_rules : term
  | `(sq! $x) => do
    let e ← Elab.Term.elabTerm x (some (mkConst ``Nat))
    return mkApp2 (mkConst ``Nat.mul) e e

/-- `wrap! x` elaborates `x` after expanding the macros in it by hand: the rules that run inside
leave no trace in the info tree, only in the text. -/
syntax "wrap! " term:max : term

elab_rules : term
  | `(wrap! $x) => do
    let x' ← Elab.liftMacroM (expandMacros x)
    Elab.Term.elabTerm x' none

/-- `trip! x` is `3 * x`, elaborated by a declaration registered for its kind. -/
syntax (name := tripStx) "trip! " term:max : term

/-- The elaborator of `trip!`, written as a declaration with an attribute. -/
@[term_elab tripStx] def elabTrip : Elab.Term.TermElab := fun stx _ => match stx with
  | `(trip! $x) => do
    let e ← Elab.Term.elabTerm x (some (mkConst ``Nat))
    return mkApp2 (mkConst ``Nat.mul) (mkNatLit 3) e
  | _ => Elab.throwUnsupportedSyntax

/-- `‖p‖ₚ` is `p.size`, with an unexpander that prints it back: it only changes how a term shows. -/
notation "‖" p "‖ₚ" => Point.size p

/-- Written with `dbl!` in its statement. -/
theorem dbl_eq (n : Nat) : dbl! n = 2 * n := by omega

/-- Written with `quad!` in its proof only. -/
theorem four_mul (n : Nat) : n + n + (n + n) = 4 * n := by
  have h : quad! n = 4 * n := by omega
  exact h

/-- Written with `quad!` in its body: `dbl!` comes from the rule of `quad!`, not from here. -/
def quadruple (n : Nat) : Nat := quad! n

/-- Only the numeral rule of `pick!` runs, in a `by` block whose goal is data. -/
def picked : Nat := by exact pick! 5

/-- An elaborated notation in a body. -/
def square (n : Nat) : Nat := sq! n

/-- `dbl!` inside `wrap!`: the rule of `dbl!` runs in the hand expansion, and only the text says so. -/
def wrapped (n : Nat) : Nat := wrap! (dbl! n)

/-- Written with a syntax whose elaborator is a declaration registered for it. -/
def tripled (n : Nat) : Nat := trip! n

/-- Written with a `notation`, which bundles its syntax and its rule. -/
def sized (p : Point) : Nat := ‖p‖ₚ

section Vars

variable {α : Type} [Inhabited α] (k : Nat) (unused : Nat)

/-- Takes `α`, its instance, and `k`; not `unused`. -/
def withK (x : α) : α × Nat := (if k = 0 then default else x, k)

local notation "bump " x => x + 1

/-- Written with the local notation. -/
def bumped (n : Nat) : Nat := bump n

end Vars

/-! Proofs inside definitions (ExportSpec decision 8), for the spans the pass records: `by` fields of
an instance, one on several lines; a field's term-mode proof; a structure instance's `by` field; a
term-mode proof; a `by` block that is data, with data and a proof nested in it; a `by` in the middle
of a term; data by dot notation on a proof; `decreasing_by`; and a `by` in a signature, which is
data. -/

/-- A positive number: a `by` in a signature is the statement's, never cut. -/
structure Pos where
  val : Nat
  pos : 0 < val := by decide

/-- An operation with a law. -/
class Lawful (α : Type) where
  op : α → α → α
  op_assoc : ∀ a b c : α, op (op a b) c = op a (op b c)
  op_comm : ∀ a b : α, op a b = op b a

instance : Lawful Nat where
  op := Nat.add
  op_assoc := by
    intro a b c
    -- by the library
    exact Nat.add_assoc a b c
  op_comm := Nat.add_comm -- a comment after the proof stays

/-- A structure instance with a `by` field. -/
def onePos : Pos := { val := 1, pos := by decide }

/-- A term-mode proof. -/
def twoPos : Pos := ⟨2, Nat.lt_of_lt_of_le Nat.zero_lt_one (Nat.le_succ 1)⟩

/-- A `by` block that is data, with data and a proof nested in it. -/
def three : Fin 5 := by
  exact ⟨(by exact 3), by decide⟩

/-- A `by` in the middle of a term, on two lines. -/
def firstPlus (xs : Array Nat) (h : 0 < xs.size) : Nat :=
  xs[0]'(by
    omega) + 1

/-- Data by dot notation on a proof: the proof's name is not cut out of the name. -/
def fromFalse (h : False) : Nat := h.elim

/-- A `decreasing_by` proof. -/
def halve (n : Nat) : Nat := if h : n = 0 then 0 else halve (n / 2) + 1
decreasing_by omega

end Fixture
