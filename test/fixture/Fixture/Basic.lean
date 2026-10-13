/-! Definitions a statement can rest on, and some that it must not. -/

namespace Fixture

/-- A point in the plane. -/
structure Point where
  x : Nat
  y : Nat

/-- Taxicab size. -/
def Point.size (p : Point) : Nat := p.x + p.y

theorem size_le (p : Point) : p.x ≤ p.size := Nat.le_add_right _ _

/-- Data whose invariant is proved by a lemma: the lemma sits in a proof position. -/
def bounded (p : Point) : { n : Nat // p.x ≤ n } := ⟨p.size, size_le p⟩

/-- Defined by pattern matching, so it owns a matcher. -/
def classify : Nat → Bool
  | 0 => false
  | _ + 1 => true

instance : Inhabited Point := ⟨⟨0, 0⟩⟩

/-- Equality of points decided by hand: an instance of a class whose instances are all equal. -/
instance : DecidableEq Point := fun a b =>
  if h : a.x = b.x ∧ a.y = b.y then isTrue (by cases a; cases b; simp_all)
  else isFalse (by intro e; subst e; exact h ⟨rfl, rfl⟩)

/-- Whether two points are the same: the instance it decides with is left out of its TCB, as a
proof is. -/
def same (p q : Point) : Bool := decide (p = q)

/-- A default point: `Inhabited` carries data, its default value, so its instance stays. -/
def origin : Point := default

end Fixture
