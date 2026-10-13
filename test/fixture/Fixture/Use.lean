import Fixture.Basic

namespace Fixture

def double (p : Point) : Point := ⟨2 * p.x, 2 * p.y⟩

/-- A helper used only inside a proof. -/
def helper (n : Nat) : Nat := n + 0

theorem helper_eq (n : Nat) : helper n = n := rfl

/-- The statement mentions `double` and `Point.size`; the proof uses `helper_eq`. -/
theorem main_thm (p : Point) : (double p).size = 2 * p.size := by
  have := helper_eq 0
  simp [double, Point.size]
  omega

end Fixture
