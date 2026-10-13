import Fixture.Basic

/-! Declarations of every kind the extractor keeps or folds, and the constants Lean generates
beneath them, for the comparison across toolchains (test/compat.test.ts). The root module does not
import this one, so that what the other tests count stays as it is. -/

namespace Fixture.Kinds

/-- An abbreviation. -/
abbrev Num := Nat

/-- An opaque constant: a statement can rest on it, its value is not known. -/
opaque secret : Nat

/-- A private helper. -/
private def hidden (n : Nat) : Nat := n + 1

/-- Uses the private helper in its body. -/
def visible (n : Nat) : Nat := hidden n

/-- A simp lemma about it. -/
@[simp] theorem visible_eq (n : Nat) : visible n = n + 1 := rfl

/-- A deprecated alias. -/
@[deprecated visible (since := "2026-01-01")] def visibleOld (n : Nat) : Nat := visible n

/-- A protected name. -/
protected def Num.zero : Num := 0

/-- A structure that extends another: its parent projection is generated. -/
structure Point3 extends Fixture.Point where
  z : Nat

/-- The statement rests on the parent's definitions through the projection. -/
theorem point3_size (p : Point3) : p.toPoint.size = p.x + p.y := rfl

/-- A class, and one that extends it. -/
class HasSize (α : Type) where
  size : α → Nat

class HasBound (α : Type) extends HasSize α where
  bound : Nat

/-- A named instance. -/
instance instHasSizeNat : HasSize Nat := ⟨id⟩

/-- An enumeration with derived instances: each deriving handler writes declarations. -/
inductive Color where
  | red
  | green
  deriving Repr, BEq, DecidableEq, Inhabited, Hashable

/-- An anonymous instance: its name is made by Lean. -/
instance : HasSize Color := ⟨fun _ => 1⟩

/-- An inductive family. -/
inductive Vec (α : Type) : Nat → Type where
  | nil : Vec α 0
  | cons {n : Nat} : α → Vec α n → Vec α (n + 1)

/-- Structural recursion over it. -/
def Vec.length {α : Type} {n : Nat} : Vec α n → Nat
  | .nil => 0
  | .cons _ v => v.length + 1

/-- An inductive predicate. -/
inductive Even : Nat → Prop where
  | zero : Even 0
  | step {n : Nat} : Even n → Even (n + 2)

mutual
/-- Mutual structural recursion: even. -/
def isEven : Nat → Bool
  | 0 => true
  | n + 1 => isOdd n
/-- Mutual structural recursion: odd. -/
def isOdd : Nat → Bool
  | 0 => false
  | n + 1 => isEven n
end

mutual
/-- Mutual well-founded recursion: even. Both bodies go into one generated `_mutual`. -/
def evenW : Nat → Bool
  | 0 => true
  | n + 1 => oddW n
termination_by n => n
/-- Mutual well-founded recursion: odd. -/
def oddW : Nat → Bool
  | 0 => false
  | n + 1 => evenW n
termination_by n => n
end

/-- Well-founded recursion: Lean generates the unary function, the induction principle and the
equation lemmas. -/
def log2 (n : Nat) : Nat := if h : n < 2 then 0 else log2 (n / 2) + 1
termination_by n
decreasing_by omega

/-- A `where` helper. -/
def sumTo (n : Nat) : Nat := go n 0
where
  go : Nat → Nat → Nat
    | 0, acc => acc
    | k + 1, acc => go k (acc + k + 1)

/-- A partial function. -/
partial def collatz (n : Nat) : Nat :=
  if n ≤ 1 then 0 else collatz (if n % 2 = 0 then n / 2 else 3 * n + 1) + 1

mutual
/-- Mutual partial functions: each one's code calls the other's `_unsafe_rec`. -/
partial def ping (n : Nat) : Nat := if n = 0 then 0 else pong (n - 1)
/-- The other half. -/
partial def pong (n : Nat) : Nat := if n = 0 then 1 else ping (n - 1)
end

/-- A noncomputable definition, by choice. -/
noncomputable def chosen : Nat := Classical.choice ⟨0⟩

/-- A statement resting on several of the above. -/
theorem length_nil : (Vec.nil : Vec Color 0).length = sumTo 0 := rfl

/-- Decided by evaluation. -/
theorem two_lt_three : 2 < 3 := by decide

example : isEven 4 = true := rfl

end Fixture.Kinds
