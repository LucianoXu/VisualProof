# Words

The terms the other topics use.

- **Declaration**: a Lean constant of the project (`kind`: def, theorem, structure, inductive,
  class, instance, abbrev, opaque, axiom, notation, …) or outside it (`external: true`, no source).
- **Unit**: a declaration of the graph is a command as written; what Lean generates from it unnamed
  in the text (what a project's declaring command writes beside the declaration it names, `@[simps]`
  lemmas) is part of it, in `also`, its references, axioms and content hash included.
- **Folded names**: constructors, structure fields and projections, recursors, matchers, equation
  lemmas, `also` names are not graph declarations; a reference to one is to its owner. Asked for,
  an `also` name or a name one component below a declaration or `also` name
  (`systemOfUnits.units`) is that declaration, unless a typo or two from a declaration beside it
  (generated last parts like `mk`, `rec`, `eq_1` fold even then); the answer adds `asked`,
  `foldedInto`, `foldedNote`. `describe` and `print` take the folded name.
- **Notation** (`kind: notation`): a project syntax extension command (`syntax`, `notation`,
  `macro`, `macro_rules`, `elab`, `elab_rules`, `declare_syntax_cat`; `local`, `scoped` too) as one
  unit, its parser and `_aux_` macro or elaborator folded in. Statement: the command's text;
  `display`: the page's name (`notation · I · in UnitLemmas`); `leanName`: its Lean constant where
  its name is not one. Names: rules `<kind>.macro_rules`, `<kind>.elab_rules` (`_2`, … for later
  rules of the kind in the module; `.<Module>` if not in the syntax's module), a syntax its kind, a
  category `<category>.syntax_cat`. `describe` and `print` of a unit ask about its constant
  (`unit` in the answer).
- **Grammar** (`grammar: true`, flag `grammar`): a notation unit only declaring syntax (`syntax`,
  `declare_syntax_cat`): in no TCB, no review; references to it are `where: grammar`, which a TCB
  does not follow. A declaration depends on the macros and elaborators that actually ran on its
  statement or body (of an overloaded kind's rules, that one; with no run in the info tree, the only
  rule of a syntax its text parses): notation units with an implementation, declarations registered
  `@[macro]`, `@[term_elab]`, `@[command_elab]`; and on the meta code they call (ordinary units,
  flagged `meta`). Notation an expansion emits is a dependency of the rule emitting it. A rule
  lists the syntax it `interprets`; a grammar unit, its `interpretedBy`. Unexpanders, delaborators:
  in no TCB. Notation from outside the project is never recorded: no use listed, in no TCB.
- **`where`** a reference sits, one or several: `statement` (the type), `body` (a definition's
  value), `proof` (a subterm whose type is a proposition).
- **TCB of T**: everything T's *statement* reaches through statement and body references, T
  included; proof references never count. Includes the notation units interpreting their text
  (never grammar) and the code they call. [Targets and their TCB](tcb.md).
- **Instances of classes whose instances are all equal** (`Decidable`, `DecidableEq`, `Fintype`,
  `Unique`, …): in no TCB; such an instance argument is a `proof` reference. Instances of classes
  carrying data (`Add`, `Monad`, `Inhabited`, …) stay.
- **Needs review**: a TCB member not *trusted*. Trusted: under a trusted prefix (by module, or by
  name for the project's own; default `Batteries`, `Init`, `Lean`, `Mathlib`, `Std`), and the
  standard axioms `propext`, `Classical.choice`, `Quot.sound`.
- **Review order**: bottom-up (what a declaration uses before it; mutual users together), then
  what more targets rest on, then name. A review judges a declaration assuming what it uses means
  what it says.
- **Status** (people's): `commented` if some reviewer's latest opinion on the present version is a
  comment; else `approved` if one approves; else `stale` if it has opinions, none on the present
  version; else `none`.
- **Target**: a theorem whose TCB is reviewed; marked by people, or agents at level full
  (`markedByAgent`).
- **Key declaration**: a review member that matters for reading the target (central definitions,
  the structures under them, the main theorem), marked per target as targets are; the target always
  is one. A non-key member is **supported by** a key declaration reaching it by statement and body
  references through non-key members; the **key graph** links key declarations reached so. People
  review key declarations first.
