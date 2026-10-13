import Fixture.Basic

/-! Axioms reached only inside proofs: no TCB shows them, every axiom set must. -/

namespace Fixture

/-- An axiom no statement mentions. -/
axiom bad : False

/-- An honest statement with a proof from `bad`. -/
theorem size_comm (p : Point) : p.size = p.y + p.x := bad.elim

/-- A proof left open. -/
theorem size_succ_pos (p : Point) : 0 < p.size + 1 := by sorry

/-- Reaches `bad` only through the proof of `size_comm`, which it uses in its own proof. -/
theorem size_twice (p : Point) : p.size + p.size = p.size + (p.y + p.x) := by
  rw [← size_comm]

/-- Data whose invariant is the open `size_succ_pos`, in a proof position. -/
def succSize (p : Point) : { n : Nat // 0 < n } := ⟨p.size + 1, size_succ_pos p⟩

/-- The statement mentions `succSize`, which mentions `size_succ_pos` only inside a proof. -/
theorem succSize_val (p : Point) : (succSize p).val = p.size + 1 := rfl

/-- A type reaches what its constructor's fields do: here the open proof, through `succSize`. -/
structure Sized where
  p : Point
  val_eq : (succSize p).val = p.size + 1

end Fixture
