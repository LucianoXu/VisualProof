/-! The same theorem written in two files that do not import each other (`A` and `B`), and the same
`local notation` and private definition in each: names a graph must keep apart (test/extract.test.ts). The root module does
not import these, so that what the other tests count stays as it is. -/

namespace Fixture.Twice

/-- Written here and in `B`. -/
theorem same_thm : 2 + 2 = 4 := rfl

local notation "Ψ" => (3 : Nat)

/-- Private to this file; `B` has one of the same name. -/
private def helper : Nat := 1

def usesA : Nat := Ψ + helper

end Fixture.Twice
