import Fixture.Axioms

/-! One command that writes several declarations, as a project's own declaring commands do: the one
it names is written in the text, the others Lean generates beneath it. -/

namespace Fixture

/-- `tagged T` declares `T` and, beneath it, the inductive `T.Tag` it is made of and a lemma about
it. Only `T` has a name in the text: the others are made with names of their own (`mkIdent`), so
their selection range is the whole command. The lemma's proof rests on the axiom `bad`, which
nothing written in the text mentions. -/
macro "tagged " t:ident : command => do
  let tag := Lean.mkIdent (t.getId ++ `Tag)
  let lemma := Lean.mkIdent (t.getId ++ `Tag_ne)
  -- the constructors' names are written unhygienic too, so that they are `T.Tag.left`
  let (l, r) := (Lean.mkIdent `left, Lean.mkIdent `right)
  let left := Lean.mkIdent (t.getId ++ `Tag ++ `left)
  let right := Lean.mkIdent (t.getId ++ `Tag ++ `right)
  `(inductive $tag where
      | $l:ident
      | $r:ident
      deriving DecidableEq
    def $t : Type := $tag
    theorem $lemma : $left ≠ $right := Fixture.bad.elim)

-- two tags, with one command
tagged Pair

/-- Uses the generated type by its constructor: the reference is one to the unit `Pair`. -/
def firstTag : Pair.Tag := .left

end Fixture
