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

/-- `hidden_def X : T := v` declares `X : T`, equal to `v` only through the lemma `X_def`, as
Mathlib's `irreducible_def` writes it: `X` is the value of an opaque constant (`wrapped`) that
holds the value (`definition`), both named by the macro's hygiene (`definition._@.Fixture.Tagged.…`),
their range the whole command; `X` and `X_def` both have the name in the text. -/
macro doc:(docComment)? "hidden_def " x:ident " : " t:term " := " v:term : command => do
  let xDef := Lean.mkIdentFrom x (x.getId.appendAfter "_def")
  `(def definition : $t := $v
    opaque wrapped : Subtype (Eq @definition) := ⟨_, rfl⟩
    $[$doc:docComment]? def $x : $t := wrapped.val
    theorem $xDef : $x = definition := wrapped.2.symm)

/-- A number above zero, whose value only its lemma tells. The proof in it is abstracted beside
the hidden constants, under their hygienic names (`definition._proof_1._@…`). -/
hidden_def positive : { n : Nat // 0 < n } := ⟨3, by decide⟩

end Fixture

-- the same command in the namespace of a declaration: what it hides is named beneath
-- `Fixture.Pair`, and is still `corner`'s
namespace Fixture.Pair

/-- A corner of the plane. -/
hidden_def corner : Point := ⟨1, 2⟩

end Fixture.Pair
