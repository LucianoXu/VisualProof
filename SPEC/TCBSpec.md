# VisualProof TCB Spec

What a declaration of the graph (a unit) is and exactly what a theorem's TCB holds, beside SPEC.md's
"Definition of TCB"; ReviewSpec.md says what of it needs review. "TCB" names the part of the trust
specific to a theorem: Lean's kernel and toolchain, and the libraries outside the project, are
assumed — what is trusted (ReviewSpec decision 3) is in a TCB, but never counted in its size
(decision 7).

## Decisions

1. **A unit is a command written in the source**, named by the declaration it writes. What Lean
   generates from a command (what a declaring macro writes beside the declaration it names, the
   lemmas of `@[simps]`) folds into that declaration, as constructors and recursors fold into their
   type. Dependencies are read from the elaborated terms (instances, coercions, what unification
   filled in) and attributed to the commands that wrote them. A TCB is transitive through
   statements and definition bodies; references inside proofs are left out wherever they occur.
2. **The project's notation is in the TCB.** A unit depends on the project's syntax extensions its
   statement or body is written in (not its proofs'). A notation's TCB is its implementation: its
   `macro_rules` or `elab_rules` (or the macro or elaborator a `notation`, `macro` or `elab`
   bundles, or a declaration registered with `@[macro]`, `@[term_elab]`, `@[command_elab]`) and the
   code they call; it is reviewed once, not at each use.
   - **Notation from outside the project is never recorded**: Lean's and Mathlib's notation reaches
     no TCB, whatever is trusted.
   - **Grammar is out**: a bare `syntax` or `declare_syntax_cat` only fixes the form of the tree;
     its meaning is the elaborator's that interprets it (the rule that ran, or a parent elaborator
     that reads helper syntax itself), which is in already. Such a unit stays a node; no TCB reaches
     it.
   - **Unexpanders and delaborators** only change how a term is shown: out.
3. **A unit's version is its kernel content, names aside**: a hash over every constant the unit
   produces (type; a definition's value; an inductive type's constructors; a theorem's statement
   only), with the names it refers to mapped through the renames in force (HistorySpec decisions 6
   and 10) to an identity a rename does not change. A pure rename, of the declaration or of what it
   refers to, stales nothing; any other change to its statement or, for data, its body is a new
   version. A notation implementation that changes what a use elaborates to, or an instance
   resolved differently, stales the use though its text did not change.
4. **The context is part of what is read**: what is in force where a declaration is written
   (namespace, `open`s, `variable`s, universes, local notation and instances, options) is shown
   with its text, and an opinion records it with the text judged.
5. **Instances of classes whose instances are all equal are left out** wherever used: classes of
   which `Subsingleton` holds (`Decidable`, `DecidableEq`, `Fintype`, `Unique`, …). Another instance
   cannot change what a statement says, and the kernel checks one exists, so it is left out as a
   proof is. Instances of classes carrying data stay: they are what an operation means (`a + b`, a
   monad's bind, `Inhabited`'s default).
6. **A `mutual` block's members rest on each other.** A declaration written in a `mutual` block
   rests on every other member Lean lists in the block (`all`): a definition or `partial def` in its
   body, a theorem in its proof. Lean compiles the bodies together (structural recursion through
   each member's `_f`, well-founded recursion through one shared `_mutual`, a `partial def` through
   the others' `_unsafe_rec`), so a member never names the others.
7. **A TCB's size counts what is not trusted** (the owner's decision of 2026-10-17). Wherever the
   page or the documentation says how large a TCB is, it counts the TCB's declarations that are not
   trusted in ReviewSpec decision 3's sense — the standard axioms, and what a trusted prefix covers
   (`Mathlib`, `Init`, `Lean`, `Std`, `Batteries` by default, or `@external`), save a non-standard
   axiom — the project's and any untrusted one outside it. The trusted declarations stay in the
   TCB: they are lit on a board that holds them and told apart beside the number as "+N trusted",
   never added into it; the panel's Its TCB lists what is counted, and its Counts give what a
   declaration uses the same way, so that the two compare. A theorem stated with many of Mathlib's
   definitions does not show hundreds of declarations to read.

## Implementation notes

- **Units** (extractor/Extract.lean, step 2b). A declaration is generated from a command when its
  selection range is its whole range; it folds into the smallest written range of its module that
  holds its own, its references the unit's at the same sites. The unit lists it in `also` (full
  names, sorted; constructors and recursors unlisted); one with no such owner stays a node,
  `gen: ""`. What a generated all-equal instance (`deriving DecidableEq`), an unexpander or a
  delaborator refers to comes in at the proof site only.
- **A unit's axioms**: `#print axioms`, joined over the unit and its `also`.
- **A unit's version** (decision 3; server/versions.ts). The extractor reads the content of the unit,
  then of each `also` in name order, as `hash` (the kernel's content hash, names included) and as
  `shape`: the same terms with every constant they name replaced by its index in the unit's `refs`,
  binder names left out. A project reference is written as its unit's name, a space, and what it is
  of that unit (`A.Point mk`); an outside one by its own name; all once in `refNames`. The server
  maps unit names through the renames in force and hashes them with the shape (SHA-256, 16 hex
  digits): the version, served as `hash`, the kernel's as `kernel`. Without a shape (an older
  extraction) the version is the kernel's hash.
- **Opinions recorded under the kernel's hash** (older logs) are bound at replay to the version of
  the content that hash was taken of, where a graph the server has read (on show, or a history
  snapshot) holds the declaration with that hash; else they stay on an earlier version. The log is
  never rewritten.
- **Instances** (decision 5). For each constant applied, its instance-implicit binders' classes (the
  head of the binder's type; `DecidableEq α` unfolds to `Decidable (a = b)`) are asked once per
  class, `Subsingleton (C xs)` at arbitrary arguments, with a small budget; such an argument's
  references get the proof site. The class is asked, not each use (`OrderBot α` is a subsingleton
  only over a partial order: its instances stay). A failure, a timeout, a head that is not a
  constant, or an argument past the written binders keeps the instance.
- **How a command's notation is found** (decision 2). Neither `.olean` nor `.ilean` records it. The
  usage pass reads per command both the project syntax kinds parsed in its text and the project
  macros and elaborators that ran (the info tree's `MacroExpansionInfo` and `.elaborator`s). Both
  are needed: the parse alone names rules that never ran and cannot tell which nested notation an
  expansion emitted; the info trees alone miss helper syntax a parent elaborator reads itself.
- **Notation units** (step 2c). Meta-level declarations are units (flagged `meta`); a `partial def`
  is followed through its `_unsafe_rec`. What a syntax extension command (`syntax`, `notation`,
  `macro`, `macro_rules`, `elab`, `elab_rules`, `declare_syntax_cat`, `local` and `scoped` ones
  too) generates shares its range and makes one unit of kind `notation`, the rest in `also`. Only
  the project's modules are walked.
- **Grammar** (step 2d). A notation unit folding only parser declarations (`ParserDescr`, a
  category) is flagged `grammar`. An edge into it from a statement or body has its own site,
  `grammar` (8, `SITE_GRAMMAR`; proof uses stay proofs), which every TCB walk (`SITE_STMT |
  SITE_BODY`) skips with no code of its own, while the page and the agents still say where a syntax
  is used. Packed for pages a site takes four bits (edge format `VPE2`; `VPE1` reads grammar as
  proof).
- **What interprets what.** Each macro and elaborator of the project (a notation unit, or a
  declaration registered with `@[macro]`, `@[term_elab]`, `@[command_elab]` or `@[tactic]`) lists the
  kinds it is registered for (`interprets`) and depends on their syntax at the grammar site. A use
  reaches the rule itself, never through its syntax: the rule that ran, else the only rule of the
  syntax its text parses (`expandMacros` leaves the run out of the info tree). An overloaded kind's
  rules are reached only where recorded. test/usage.test.ts checks that leaving grammar out leaves
  out no implementation.
- **Names.** A notation unit is named after what it declares or interprets; Lean's `_aux_` constant
  is kept as `leanName`. A `syntax`, `notation`, `macro` or `elab` takes its kind's name; a category
  `<category>.syntax_cat`; a rule `<kind>.macro_rules` or `<kind>.elab_rules` (the first kind by
  name when it has alternatives for several; an outside kind under the rule's own namespace), with
  `.<module's last part>` when the rule is not in the module of the kind's syntax (always for an
  outside kind), and `_2`, `_3`, … in source order for several rules of one kind in one module. A
  `local` kind (`local notation "Φ"` in several files) qualifies its unit and rules with the
  module's last part (flt-regular's `termZetaUnit.CaseI`; cards add `· in CaseI`). Edits elsewhere
  leave a name as it is; a name another unit has is not taken.
- **Every unit's name is its own**: the server, the review, the views and the history know a
  declaration by name alone. A constant two modules list (one theorem in two files that do not import
  each other) is one unit, where the environment places it, with a warning. A name two units would
  still share (private declarations in such modules) gets `_2`, `_3`, … in module order. Cards show
  `display`: the command and the kind's atoms with `…` between.
- **Edges from the uses** (server/usage.ts, `mergeUsage`). A use in a statement or definition body
  is an edge at that site; one in a proof (a theorem's value, a `by` block whose goal is a
  proposition, a term whose type is one) at the proof site. A command outside `declaration` syntax
  counts as statement. Notation an expansion emitted (its tokens carry the expansion's synthetic
  position) is a dependency of the rule that emitted it (recorded, else the only rule of its syntax,
  else the declaration); an implementation that only passes it on is credited with it, which
  over-approximates its own TCB, never a use's. In a command that writes several units (`mutual`),
  a use goes to the unit whose range holds it, to all when none does.
- **The usage pass** (extractor/Usage.lean) elaborates each module in a process of its own (a
  process cannot import twice), under exactly its imports and its trace's options, theorem values
  and `decreasing_by` as `sorry`, other `by` blocks told apart by their goal. It writes nothing into
  the project. Results are cached in `<cache>/usage/`, keyed by the module's `.olean` hash, compiled
  text, options, imports' keys and the worker's own text. A module it cannot elaborate (reported)
  or a file changed since compiled keeps the text-based context and no notation edges. The
  extractor's graph is served first, the merged one (fingerprint with `MERGE_VERSION`) next.
- **Proof spans** (ExportSpec decision 8): per unit, `[line, col, endLine, endCol]` in the compiled
  text (columns in code points), nested and overlapping ones merged (`RawNode.proofs`): the `by`
  blocks of a body whose goal is a proposition, the tactics of `decreasing_by`, and the body's
  term-mode proofs (`Meta.isProof`) whose first and last tokens are the parser's (never an
  expansion's synthetic place), longer than one token or a whole value after `:=`, and not a name
  part dot notation split off. Signatures, structure fields and quotations hold none.
- **Context** (decision 4) comes from `readContext` (shared/context.ts) alone; the export prints
  none. Where the usage pass elaborated the file's present text, it is the elaborator's scope before
  the command (`FileContext` with `exact`; `open`s resolved, options only where they differ from
  the build's), each item with the line that put it there, and the variables the declaration
  included (matched against its type's leading binders) are marked. Elsewhere it is read from the
  text (shared/scope.ts, `contextAt`), and the `variable`s whose names occur in the declaration are
  marked, a hint.
- **The text judged** is the context block, a blank line, then the excerpt (the excerpt alone where
  nothing is in force), bound by the server for people and agents alike; the page works out the same
  for What changed. An opinion that recorded the excerpt alone shows the context as added.
