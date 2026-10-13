/-! See `A`. -/

namespace Fixture.Twice

/-- Written here and in `A`. -/
theorem same_thm : 2 + 2 = 4 := by decide

local notation "Ψ" => (5 : Nat)

private def helper : Nat := 2

def usesB : Nat := Ψ + helper

end Fixture.Twice
