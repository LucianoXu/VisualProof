module

/-! The module system: a module exports its `public` declarations' statements, the bodies of the
`@[expose]` ones, and nothing of its private ones. The extractor reads every level, so a body is
followed into a TCB whether it is exported or not. -/

namespace FixtureModule

/-- A helper: in a module, a declaration is private unless made public. -/
def helper (n : Nat) : Nat := n * 2

/-- A public definition whose body, not exported, uses the private helper. -/
public def viaHelper (n : Nat) : Nat := helper n

/-- An exposed definition: its body is exported too. -/
@[expose] public def triple (n : Nat) : Nat := n + n + n

/-- A public theorem whose statement rests on `viaHelper`, and through its body on `helper`. -/
public theorem viaHelper_eq (n : Nat) : viaHelper n = 2 * n := by
  simp only [viaHelper, helper]
  omega

public section

/-- Public by its section. -/
def inSection (n : Nat) : Nat := triple n

end

end FixtureModule
