module

public import FixtureModule.Defs

/-! A module importing another sees `viaHelper`'s statement only; its TCB still reaches `helper`. -/

namespace FixtureModule

/-- Rests on `viaHelper`, from another module. -/
public theorem use_viaHelper (n : Nat) : viaHelper (n + 1) = 2 * n + 2 := by
  rw [viaHelper_eq]
  omega

end FixtureModule
