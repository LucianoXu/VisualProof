/-
VisualProof extractor: a built Lean project → one JSON graph.

Run inside the target project's environment, so the target's own toolchain reads its own
`.olean` files:

    cd <target> && lake env lean --run <this file> <out.json> <project-lib-dir> <root-module>...

`project-lib-dir` is the target's `.lake/build/lib/lean`: a module is part of the project when its
`.olean` lives there, everything else (Mathlib, core, other packages) is external.

The program only reads. It never builds and never writes anywhere but `out.json`.

Output, schema 1:
  nodes     the units of the project: the declarations written in its source (TCBSpec.md,
            decision 1). Constants the compiler generates (constructors, recursors, matchers,
            `proof_n`, equation lemmas, projections, …) are folded into the declaration that owns
            them, and so are the declarations Lean generates from a command (what a declaring macro
            writes beside the declaration it names, the lemmas of `@[simps]`): those are listed in the unit's `also`. Meta-level
            declarations (elaborators, macros and the helpers they call) are units like any
            other; a syntax extension command (`syntax`, `notation`, `macro`, `macro_rules`,
            `elab`, `elab_rules`, `declare_syntax_cat`) is one unit of kind `notation`, made of
            the parser and `_aux_` declarations it generates (decision 2), under a name of its
            own: the syntax kind it declares, or `<kind>.macro_rules` and the like for a rule
            (`leanName` is the Lean constant, `display` what a card calls it).
  externals constants outside the project that a node refers to directly, folded the same way.
  edges     [src, dst, sites], `sites` a bit set: 1 = statement, 2 = definition body,
            4 = inside a proof, 8 = on grammar: into a notation unit that only declares syntax
            (flagged `grammar`), which no TCB follows. A macro or elaborator depends on the
            syntax it interprets at site 8 (`interprets`). Which notation a declaration is
            written in is not here: the usage pass (extractor/Usage.lean) finds it, and the
            server adds those edges. A reference is "inside a proof" when the subterm it occurs in
            has a type that is a proposition (`Meta.isProof`), or is an instance argument of a
            class whose instances are all equal (`instArgs`); by proof irrelevance, and
            by that equality, such a reference cannot change what a statement means.
  axioms    every axiom reachable from some node, through everything including proofs;
            `axiomSets[i]` is a list of indices into it, and each node's `ax` points there.
            A node's set is the one `#print axioms` gives for it (for a type, see `axiomMask`),
            joined over its unit: the node and what it folds in `also`.
  versions  each node's `hash` is the kernel's content hash over its unit (decision 3 before
            2026-10-09); its `shape` is the same content with every constant it names replaced by
            its place in the node's `refs`, indices into `refNames`: a constant of the project as
            its unit's name, then a space and what it is of that unit (`A.Point mk`), one from
            outside by its own name. The server maps those names through the renames in force
            and hashes them with the shape: the version an opinion is bound to.
-/
import Lean

open Lean Meta

namespace VisualProof

/-- Where a reference occurs. -/
abbrev Site := UInt8
def stmt : Site := 1
def body : Site := 2
def proof : Site := 4
/-- Where a statement or a body is written with a syntax that only fixes the grammar (`syntax`,
    `declare_syntax_cat`): what the tree means is its rule's business, which a use reaches on its
    own, so a TCB does not follow it, as it does not follow a proof (TCBSpec.md, decision 2). -/
def grammar : Site := 8

/-- A reference seen through a generated constant keeps its position, unless either step
    passes through a proof. -/
def combine (outer inner : Site) : Site :=
  if outer == proof || inner == proof then proof else outer

/-- Declarations that exist for the elaborator, not for the kernel's terms: parsers, macros,
    elaborators, delaborators, simprocs, and the code they run in (`MacroM`, `MetaM`, syntax).
    No statement refers to them, but notation is read through them (TCBSpec.md, decision 2), so
    they are units like any other, flagged `meta`. -/
def metaHeads : List Name :=
  [``Lean.ParserDescr, ``Lean.TrailingParserDescr, ``Lean.Macro, ``Lean.Parser.Parser,
   ``Lean.Parser.TrailingParser, ``Lean.Elab.Term.TermElab, ``Lean.Elab.Tactic.Tactic,
   ``Lean.Elab.Command.CommandElab, ``Lean.PrettyPrinter.Delaborator.Delab,
   ``Lean.PrettyPrinter.Unexpander, ``Lean.Meta.Simp.Simproc, ``Lean.Meta.Simp.DSimproc,
   ``Lean.Elab.Term.Do.ToCodeBlock.Catch, ``Lean.MacroM, ``Lean.Meta.MetaM, ``Lean.Core.CoreM,
   ``Lean.Syntax, ``Lean.TSyntax, ``Lean.Parser.Category]

def isMetaDecl (ci : ConstantInfo) : Bool :=
  match ci.type.getForallBody.getAppFn.constName? with
  | some h => metaHeads.contains h || (`Lean.Elab).isPrefixOf h || (`Lean.Parser).isPrefixOf h
  | none => false

/-- What a syntax extension command generates: the parser of a syntax kind (`ParserDescr`), a
    syntax category, and the `_aux_` declarations of `macro_rules`, `elab_rules` and `notation`
    (the macro, the elaborator, the unexpander). The constants one command generates make one
    unit of kind `notation` (TCBSpec.md, decision 2). -/
def isNotationConst (ci : ConstantInfo) : Bool :=
  let u := (privateToUserName? ci.name).getD ci.name
  let generatedAux := match u with
    | .str _ s => s.startsWith "_aux_"
    | _ => false
  generatedAux || match ci.type.getForallBody.getAppFn.constName? with
    | some h => h == ``Lean.ParserDescr || h == ``Lean.TrailingParserDescr || h == ``Lean.Parser.Category
    | none => false

/-- Suffixes of constants the compiler generates next to a user declaration, which still carry
    a declaration range (so the range test alone does not catch them). -/
def generatedSuffixes : List String :=
  ["recOn", "casesOn", "noConfusion", "noConfusionType", "ctorElim", "ctorElimType", "below",
   "brecOn", "binductionOn", "ibelow", "ctorIdx", "toCtorIdx", "ofNat", "ofNat_ctorIdx",
   "sizeOf_spec", "injEq", "inj", "eq_def", "induct", "mutual_induct", "fun_cases",
   "induct_unfolding", "ext_iff", "congr_simp"]

structure St where
  /-- `env.header.moduleNames`, read once: in v4.33 it builds a new array on every call -/
  modNames : Array Name := #[]
  /-- project constant → owning node (itself when it is a node) -/
  owner : Std.HashMap Name Name := {}
  /-- per-constant references, computed once -/
  refs : Std.HashMap Name (Array (Name × Site)) := {}
  /-- transitive axiom mask per constant -/
  axMask : Std.HashMap Name Nat := {}
  axioms : Array Name := #[]
  /-- printed statements, per node -/
  pp : Std.HashMap Name String := {}
  /-- modules whose cache entry is out of date: something of theirs was computed this run -/
  dirty : Std.HashSet Name := {}

abbrev M := StateRefT St MetaM

/-- `isProof`, conservative: a term whose type cannot be inferred counts as data, so a failure
    can only enlarge a TCB, never hide part of it. -/
def isProofSafe (e : Expr) : MetaM Bool := do
  if let .const c _ := e.getAppFn then
    if let some (.thmInfo _) := (← getEnv).find? c then return true
  try isProof e catch _ => return false

/-- What the walk keeps for the whole run: whether a class's instances are all equal
    (`subsingletonClass`), by its name; and which arguments of a constant are instances of such a
    class (`instArgs`), by the constant's name. -/
structure WalkCache where
  classes : IO.Ref (Std.HashMap Name Bool)
  instArgs : IO.Ref (Std.HashMap Name (Array Bool))

def WalkCache.new : IO WalkCache := return { classes := ← IO.mkRef {}, instArgs := ← IO.mkRef {} }

/-- Whether all instances of class `c` are equal (TCBSpec.md, decision 5): `Subsingleton (c xs)`
    holds for arbitrary arguments `xs`, as of `Decidable p`, `Fintype α`, `Unique α`. Asked once
    per class, with a small budget; no when it cannot be told. It is the class that is asked, not
    each of its uses: `OrderBot α` is a subsingleton when `α` is partially ordered, not over any
    `≤`, so its instances, and the `⊥` they carry, stay. -/
def subsingletonClass (cache : WalkCache) (c : Name) : MetaM Bool := do
  if let some b := (← cache.classes.get)[c]? then return b
  let b ← try
      let some ci := (← getEnv).find? c | pure false
      forallTelescope ci.type fun xs _ => do
        let ty := mkAppN (.const c (ci.levelParams.map mkLevelParam)) xs
        let u ← getLevel ty
        withOptions (fun o => (o.set `synthInstance.maxHeartbeats (2000 : Nat)).set `synthInstance.maxSize (64 : Nat)) do
          return (← synthInstance? (mkApp (.const ``Subsingleton [u]) ty)).isSome
    catch _ => pure false
  cache.classes.modify (·.insert c b)
  return b

/-- Whether instances of type `ty` are all equal, by its class: the head of what it says under
    its binders (`DecidableEq α` unfolds to `∀ a b, Decidable (a = b)`, of class `Decidable`).
    A pi type of such instances is one too. -/
def subsingletonType (cache : WalkCache) (ty : Expr) : MetaM Bool := do
  try forallTelescopeReducing ty fun _ b => do
      match b.getAppFn with
      | .const c _ => subsingletonClass cache c
      | _ => return false
  catch _ => return false

/-- Whether declaration `c` is an instance of a class whose instances are all equal
    (`instance [DecidableEq α] : DecidableEq (List α)`). -/
def subsingletonDecl (cache : WalkCache) (c : Name) : MetaM Bool := do
  let env ← getEnv
  let some ci := env.find? c | return false
  if !Meta.isInstanceCore env c then return false
  subsingletonType cache ci.type

/-- Which arguments of `f` are instances of a class whose instances are all equal (TCBSpec.md,
    decision 5): instance-implicit binders of the constant's type whose class is such a class
    (`[DecidableEq α]`, `[Fintype α]`, `[Decidable p]`). Which instance was chosen there cannot
    change what a statement says, and the kernel checks that there is one, so the walk leaves it
    out as it does a proof. A class that carries data (`Add`, `Monad`, `Inhabited` and its default
    value) is no such class, and its instances stay. Read once per constant from the binders its
    type is written with; for anything but a constant (a local function, a projection), and past
    those binders, none: conservative, as `isProofSafe` is, a failure keeps the instance. -/
def instArgs (cache : WalkCache) (f : Expr) : MetaM (Array Bool) := do
  let .const c _ := f | return #[]
  if let some a := (← cache.instArgs.get)[c]? then return a
  let some ci := (← getEnv).find? c | return #[]
  let out ← try
      forallTelescope ci.type fun xs _ => xs.mapM fun x => do
        if !(← x.fvarId!.getBinderInfo).isInstImplicit then return false
        subsingletonType cache (← x.fvarId!.getType)
    catch _ => pure #[]
  cache.instArgs.modify (·.insert c out)
  return out

/-- References of one expression, each tagged with its site. A subterm met again at the same site
    adds nothing, and is not walked again (`seen`): Lean's terms share their subterms, and a term
    can hold one many times over, so that walking it as a tree takes time, and asks Lean the type
    of subterms, in proportion to its size written out, which can be exponential in its size in
    memory. -/
partial def walk (cache : WalkCache) (seen : IO.Ref (Std.HashSet (Expr × Site))) (e : Expr) (site : Site) (acc : IO.Ref (Array (Name × Site))) : MetaM Unit := do
  let note (c : Name) (s : Site) : MetaM Unit := acc.modify (·.push (c, s))
  match e with
  | .bvar .. | .fvar .. | .mvar .. | .sort .. | .lit .. => pure ()
  | .mdata _ b => walk cache seen b site acc
  | _ =>
    if (← seen.get).contains (e, site) then return
    seen.modify (·.insert (e, site))
    if site != proof && (← isProofSafe e) then
      for c in e.getUsedConstants do note c proof
      return
    match e with
    | .const c _ => note c site
    | .app .. =>
      let f := e.getAppFn
      let args := e.getAppArgs
      walk cache seen f site acc
      let inst ← instArgs cache f
      for h : k in [0:args.size] do
        let a := args[k]
        -- an instance of a class whose instances are all equal counts as a proof does
        if site != proof && inst[k]?.getD false then
          for c in a.getUsedConstants do note c proof
        else walk cache seen a site acc
    | .lam n t b bi | .forallE n t b bi =>
      walk cache seen t site acc
      withLocalDecl n bi t fun x => walk cache seen (b.instantiate1 x) site acc
    | .letE n t v b _ =>
      walk cache seen t site acc
      walk cache seen v site acc
      withLetDecl n t v fun x => walk cache seen (b.instantiate1 x) site acc
    | .proj s _ b =>
      note s site
      walk cache seen b site acc
    | _ => pure ()

def walkTop (cache : WalkCache) (e : Expr) (site : Site) : MetaM (Array (Name × Site)) := do
  let acc ← IO.mkRef #[]
  if site == proof then
    return e.getUsedConstants.map (·, proof)
  walk cache (← IO.mkRef {}) e site acc
  acc.get

/-- The references a constant makes on its own, before any folding. -/
def ownRefs (cache : WalkCache) (ci : ConstantInfo) : MetaM (Array (Name × Site)) := do
  let env ← getEnv
  let ty ← walkTop cache ci.type stmt
  match ci with
  | .thmInfo v => return ty ++ (← walkTop cache v.value proof)
  | .defnInfo v =>
    -- auxiliary recursors are one recursor application; every constant they name is a genuine
    -- reference. (Matchers are not: their case trees carry `HEq` casts, which are proofs.)
    if isAuxRecursor env ci.name then
      return ty ++ v.value.getUsedConstants.map (·, body)
    return ty ++ (← walkTop cache v.value body)
  | .opaqueInfo _ =>
    -- a `partial def` is an opaque constant whose code is its `_unsafe_rec` twin: what the code
    -- calls is what it runs (a notation's implementation, TCBSpec.md decision 2). Any other
    -- opaque the kernel cannot unfold: its value means nothing to a statement.
    if let some (.defnInfo r) := env.find? (ci.name ++ `_unsafe_rec) then
      return ty ++ (← walkTop cache r.value body)
    return ty
  | .inductInfo v =>
    let mut out := ty
    for c in v.ctors do
      if let some cci := env.find? c then out := out ++ (← walkTop cache cci.type stmt)
    return out
  | _ => return ty

def moduleOf (modNames : Array Name) (env : Environment) (c : Name) : Name :=
  match env.getModuleIdxFor? c with
  | some i => modNames[i.toNat]!
  | none => .anonymous

def refsOf (cache : WalkCache) (c : Name) : M (Array (Name × Site)) := do
  if let some r := (← get).refs[c]? then return r
  let env ← getEnv
  let some ci := env.find? c | return #[]
  let r ← ownRefs cache ci
  -- what Lean inferred on the way (the types of subterms, under binders opened for this constant
  -- alone) serves no other constant: kept, it grows with every constant walked, to tens of GB on
  -- a large project
  modifyThe Meta.State fun s => { s with cache := {} }
  modify fun s => { s with refs := s.refs.insert c r, dirty := s.dirty.insert (moduleOf s.modNames env c) }
  return r

/-! ## The per-module cache

A module's references and printed statements depend on its own `.olean` and on everything it
imports. So a module's key mixes the hash Lake wrote next to its `.olean` with the keys of the
project modules it imports, and a salt for the rest (toolchain, dependencies, this extractor).
An unchanged leaf of a large project is then read back instead of elaborated again; an edit to a
base module invalidates everything above it, as Lake's own rebuild does. -/

partial def nameComps : Name → List Json → List Json
  | .anonymous, acc => acc
  | .str p s, acc => nameComps p (Json.str s :: acc)
  | .num p k, acc => nameComps p (toJson k :: acc)

/-- A name as its components; numbers stay numbers (private names carry one). -/
def encName (n : Name) : Json := Json.arr (nameComps n []).toArray

def decName (j : Json) : Option Name := do
  let arr ← j.getArr?.toOption
  arr.foldlM (init := Name.anonymous) fun n c =>
    match c with
    | .str s => some (n.str s)
    | _ => c.getNat?.toOption.map (n.num ·)

def cacheFile (dir : System.FilePath) (m : Name) : System.FilePath := dir / s!"{m}.json"

def writeModuleCache (dir : System.FilePath) (m : Name) (key : String) (consts : Array Name) : M Unit := do
  let st ← get
  let mut index : Std.HashMap Name Nat := {}
  let mut names : Array Json := #[]
  let mut rows : Array Json := #[]
  for c in consts do
    let refs? := st.refs[c]?
    let pp? := st.pp[c]?
    if refs?.isNone && pp?.isNone then continue
    for n in c :: ((refs?.getD #[]).map (·.1)).toList do
      unless index.contains n do
        index := index.insert n names.size
        names := names.push (encName n)
    let refsJs := match refs? with
      | some rs => Json.arr (rs.foldl (fun a (t, s) => a.push (toJson index[t]!) |>.push (toJson s.toNat)) #[])
      | none => Json.null
    rows := rows.push (Json.arr #[toJson index[c]!, refsJs, (pp?.map Json.str).getD Json.null])
  IO.FS.writeFile (cacheFile dir m)
    (Json.mkObj [("key", key), ("names", Json.arr names), ("consts", Json.arr rows)]).compress

/-- Load a module's cache entry if its key still matches. -/
def readModuleCache (dir : System.FilePath) (m : Name) (key : String) : M Bool := do
  let some text ← (try some <$> IO.FS.readFile (cacheFile dir m) catch _ => pure none) | return false
  let .ok j := Json.parse text | return false
  unless (j.getObjValAs? String "key").toOption == some key do return false
  let .ok names := j.getObjValAs? (Array Json) "names" | return false
  let .ok rows := j.getObjValAs? (Array Json) "consts" | return false
  let decoded := names.map decName
  let name? (x : Json) : Option Name := do decoded[(← x.getNat?.toOption)]?.join
  for row in rows do
    let .ok cells := row.getArr? | return false
    let some c := cells[0]? >>= name? | return false
    if let some (Json.arr flat) := cells[1]? then
      let mut refs : Array (Name × Site) := #[]
      for k in [0:flat.size / 2] do
        let some t := name? flat[2 * k]! | return false
        let .ok site := flat[2 * k + 1]!.getNat? | return false
        refs := refs.push (t, site.toUInt8)
      modify fun s => { s with refs := s.refs.insert c refs }
    if let some (Json.str t) := cells[2]? then
      modify fun s => { s with pp := s.pp.insert c t }
  return true

/-- Generated constants that stand for the type they belong to. -/
def isStructural (env : Environment) (c : Name) : Bool :=
  env.find? c matches some (.ctorInfo _) || env.find? c matches some (.recInfo _)
  || isAuxRecursor env c || isNoConfusion env c || (env.getProjectionFnInfo? c).isSome

/-- The user-facing constant an external reference stands for: a constructor stands for its
    type, a recursor or matcher for the declaration it was generated from. -/
partial def foldExternal (env : Environment) (c : Name) : Name := Id.run do
  match env.find? c with
  | some (.ctorInfo v) => return foldExternal env v.induct
  | some (.recInfo _) => return foldExternal env c.getPrefix
  | _ => pure ()
  if isAuxRecursor env c || isNoConfusion env c || isMatcherCore env c then
    return foldExternal env c.getPrefix
  if let some info := env.getProjectionFnInfo? c then
    if let some (.ctorInfo v) := env.find? info.ctorName then return foldExternal env v.induct
  let u := (privateToUserName? c).getD c
  -- a private one (a lemma Lean generated in the project for `PSum.casesOn`) by its name as written
  let p := if (env.find? c.getPrefix).isSome then c.getPrefix else u.getPrefix
  if (u.isInternalDetail || generatedSuffixes.contains (u.getString!)) && !p.isAnonymous
      && (env.find? p).isSome then
    return foldExternal env p
  return c

/-- What `#print axioms` follows out of a constant (`Lean.CollectAxioms.collect`): its type, the
    value of a definition, a theorem or an opaque, and the constructors of an inductive type.
    Not `ConstantInfo.value?`: it gives a theorem's value only when asked with `allowOpaque`, and
    without it every axiom and `sorry` used only inside a proof would go unseen. -/
def axiomDeps (ci : ConstantInfo) : Array Name :=
  match ci with
  | .defnInfo v => v.type.getUsedConstants ++ v.value.getUsedConstants
  | .thmInfo v => v.type.getUsedConstants ++ v.value.getUsedConstants
  | .opaqueInfo v => v.type.getUsedConstants ++ v.value.getUsedConstants
  | .inductInfo v => v.type.getUsedConstants ++ v.ctors.toArray
  | .quotInfo _ => #[]
  | _ => ci.type.getUsedConstants  -- an axiom, a constructor, a recursor

/-- A constant whose axioms are being collected: what it refers to, how far through that it is,
    and what it has found so far. -/
structure AxFrame where
  c : Name
  num : Nat
  deps : Array Name
  next : Nat := 0
  low : Nat
  mask : Nat

/-- Transitive axioms of a constant, as a bit set over `St.axioms`: everything `#print axioms`
    follows, proofs included. Every constant is walked once for the whole run and its set kept.
    The walk finds strongly connected components (Tarjan), because references go round in cycles
    (an inductive type and its constructors, mutual types, unsafe recursion): a constant met again
    while still open would otherwise be kept with what was found up to then, and every later
    declaration reaching it through the kept set would miss the rest. Lean's own sets, computed
    once per module, have exactly that gap for a few types (Mathlib's `Subgroup` shows no axioms,
    its constructor `propext`), so for a type this can say more than `#print axioms`, never less.
    Iterative, because chains through Mathlib's proofs are deeper than the interpreter's stack. -/
def axiomMask (root : Name) : M Nat := do
  if let some m := (← get).axMask[root]? then return m
  let env ← getEnv
  -- taken out of the state, so the walk updates them in place rather than copying them
  let (done, axioms) ← modifyGet fun s => ((s.axMask, s.axioms), { s with axMask := {}, axioms := #[] })
  let mut done := done
  let mut axioms := axioms
  let mut nums : Std.HashMap Name Nat := {}
  let mut open_ : Array Name := #[]  -- visited, component not yet complete
  let mut frames : Array AxFrame := #[]
  let mut todo : Option Name := some root
  while true do
    if let some c := todo then
      todo := none
      let num := nums.size
      nums := nums.insert c num
      open_ := open_.push c
      let ci? := env.find? c
      let mut mask := 0
      if let some (.axiomInfo _) := ci? then
        let i := (axioms.idxOf? c).getD axioms.size
        if i == axioms.size then axioms := axioms.push c
        mask := 1 <<< i
      frames := frames.push { c, num, deps := (ci?.map axiomDeps).getD #[], low := num, mask }
    let some f := frames.back? | break
    if h : f.next < f.deps.size then
      let d := f.deps[f.next]
      let mut f := { f with next := f.next + 1 }
      if let some m := done[d]? then f := { f with mask := f.mask ||| m }
      -- seen in this walk and not done: it is open, on a cycle through `f`
      else if let some n := nums[d]? then f := { f with low := min f.low n }
      else todo := some d
      frames := frames.set! (frames.size - 1) f
    else
      frames := frames.pop
      if f.low == f.num then
        -- `f` closes a component: every member reaches every other, so all share its set
        while h : open_.size > 0 do
          let x := open_[open_.size - 1]
          open_ := open_.pop
          done := done.insert x f.mask
          if x == f.c then break
      if let some p := frames.back? then
        frames := frames.set! (frames.size - 1) { p with mask := p.mask ||| f.mask, low := min p.low f.low }
  modify fun s => { s with axMask := done, axioms }
  return done[root]?.getD 0

def kindOf (env : Environment) (ci : ConstantInfo) : String :=
  match ci with
  | .thmInfo _ => "theorem"
  | .axiomInfo _ => "axiom"
  | .opaqueInfo _ => "opaque"
  | .quotInfo _ => "quot"
  | .ctorInfo _ => "constructor"
  | .recInfo _ => "recursor"
  | .inductInfo _ =>
    if isClass env ci.name then "class"
    else if isStructure env ci.name then "structure" else "inductive"
  | .defnInfo _ =>
    if Meta.isInstanceCore env ci.name then "instance"
    else if getReducibilityStatusCore env ci.name matches .reducible then "abbrev"
    else "def"

def flagsOf (env : Environment) (ci : ConstantInfo) : Array String := Id.run do
  let mut f := #[]
  if ci.isUnsafe then f := f.push "unsafe"
  if ci.isPartial then f := f.push "partial"
  if isPrivateName ci.name then f := f.push "private"
  if isNoncomputable env ci.name then f := f.push "noncomputable"
  if isExtern env ci.name then f := f.push "extern"
  if (Compiler.implementedByAttr.getParam? env ci.name).isSome then f := f.push "implemented_by"
  if Meta.isInstanceCore env ci.name && !(ci matches .defnInfo _) then f := f.push "instance"
  if isMetaDecl ci then f := f.push "meta"
  return f

/-- What a review label is given on: the statement, and for data also the body. A theorem's
    proof is the kernel's business, so it is not part of the hash. -/
def contentHash (env : Environment) (ci : ConstantInfo) : UInt64 := Id.run do
  let mut h := ci.type.hash
  match ci with
  | .defnInfo v => h := mixHash h v.value.hash
  | .inductInfo v =>
    for c in v.ctors do
      if let some cci := env.find? c then h := mixHash h cci.type.hash
  | _ => pure ()
  return h

/-- A unit's content with the names it mentions taken out (TCBSpec.md, decision 3, as revised on
    2026-10-09): what `contentHash` reads, hashed with every constant it names — a reference, a
    projection's structure — replaced by its place in `refs`, the constants in the order first met.
    The server maps each of `refs` to an identity that a rename does not change and hashes the two
    together (server/versions.ts): that is the version an opinion is bound to, which a pure rename
    leaves as it is and a real change does not. Binder names are left out, as the kernel's hash
    leaves them out; a subterm shared in the term is hashed once. -/
structure ShapeSt where
  idx : Std.HashMap Name UInt64 := {}
  refs : Array Name := #[]
  memo : Std.HashMap Expr UInt64 := {}

/-- A constant's place in `refs`. -/
def refIdx (c : Name) : StateM ShapeSt UInt64 := do
  if let some i := (← get).idx[c]? then return i
  let i := (← get).refs.size.toUInt64
  modify fun s => { s with idx := s.idx.insert c i, refs := s.refs.push c }
  return i

partial def shapeOf (e : Expr) : StateM ShapeSt UInt64 := do
  match e with
  | .bvar i => return mixHash 11 (hash i)
  | .fvar _ | .mvar _ => return 13
  | .sort u => return mixHash 17 (hash u)
  | .lit l => return mixHash 19 (hash l)
  | .const c ls => return mixHash 23 (mixHash (← refIdx c) (hash ls))
  | .mdata _ b => shapeOf b
  | _ =>
    if let some h := (← get).memo[e]? then return h
    let h ← match e with
      | .app f a => do
        let hf ← shapeOf f
        let ha ← shapeOf a
        pure (mixHash 29 (mixHash hf ha))
      | .lam _ t b bi => do
        let ht ← shapeOf t
        let hb ← shapeOf b
        pure (mixHash 31 (mixHash (mixHash ht hb) bi.toUInt64))
      | .forallE _ t b bi => do
        let ht ← shapeOf t
        let hb ← shapeOf b
        pure (mixHash 37 (mixHash (mixHash ht hb) bi.toUInt64))
      | .letE _ t v b _ => do
        let ht ← shapeOf t
        let hv ← shapeOf v
        let hb ← shapeOf b
        pure (mixHash 41 (mixHash ht (mixHash hv hb)))
      | .proj s i b => do
        let hs ← refIdx s
        let hb ← shapeOf b
        pure (mixHash 43 (mixHash hs (mixHash (hash i) hb)))
      | _ => pure 0
    modify fun st => { st with memo := st.memo.insert e h }
    return h

/-- A unit's shape and references: the content of its declaration and of what it folds (`also`),
    in that order, under one numbering. -/
def unitShape (env : Environment) (cs : List Name) : UInt64 × Array Name :=
  let go : StateM ShapeSt UInt64 := do
    let mut h : UInt64 := 7
    for c in cs do
      let some ci := env.find? c | continue
      h := mixHash h (← shapeOf ci.type)
      match ci with
      | .defnInfo v => h := mixHash h (← shapeOf v.value)
      | .inductInfo v =>
        for k in v.ctors do
          if let some cci := env.find? k then h := mixHash h (← shapeOf cci.type)
      | _ => pure ()
    return h
  let (h, st) := go.run {}
  (h, st.refs)

/-- What a unit's declarations are compiled into: the generated constants they reach that the
    edges look through (a recursive body's `_f`, `_unary` or `_mutual`, a matcher, a `partial def`'s
    `_unsafe_rec`), never another unit, a constant standing for its type, or a proof. A recursive
    definition's body is there, not in its own value, so these are part of its version (TCBSpec.md,
    decision 3): a change of the body is a new version. In the order first met. -/
def compiledOf (env : Environment) (inProject : Name → Bool) (owner genOwner : Std.HashMap Name Name)
    (cs : List Name) : Array Name := Id.run do
  let refs (ci : ConstantInfo) : Array Name :=
    let used := ci.type.getUsedConstants ++ (match ci with
      | .defnInfo v => v.value.getUsedConstants
      | _ => #[])
    -- a `partial def` is an opaque constant whose code is its `_unsafe_rec` twin
    if ci matches .opaqueInfo _ then used.push (ci.name ++ `_unsafe_rec) else used
  let mut seen : Std.HashSet Name := cs.foldl (·.insert ·) {}
  let mut out : Array Name := #[]
  let mut work : Array Name := #[]
  for c in cs.reverse do
    if let some ci := env.find? c then work := work ++ (refs ci).reverse
  while h : work.size > 0 do
    let d := work[work.size - 1]
    work := work.pop
    if seen.contains d || !inProject d then continue
    seen := seen.insert d
    let some o := owner[d]? | continue
    if d == o || isStructural env d || genOwner.contains d then continue
    let some ci := env.find? d | continue
    -- a proof Lean abstracted out of a body (`proof_n`, an equation lemma) is the kernel's business
    if ci matches .thmInfo _ then continue
    out := out.push d
    work := work ++ (refs ci).reverse
  return out

def hex (n : UInt64) : String :=
  let s := String.ofList (Nat.toDigits 16 n.toNat)
  "".pushn '0' (16 - s.length) ++ s

/-- The tokens of a syntax as its parser describes it, in order: its atoms, and `…` where a term,
    an identifier or another syntax goes. -/
partial def parserTokens (env : Environment) (e : Expr) (acc : Array String) : Array String :=
  let args := e.getAppArgs
  let atom (s : String) := acc.push (s.trimAscii.toString)
  match e.getAppFn.constName?, args with
  | some ``Lean.ParserDescr.symbol, #[.lit (.strVal s)] => atom s
  | some ``Lean.ParserDescr.nonReservedSymbol, #[.lit (.strVal s), _] => atom s
  | some ``Lean.ParserDescr.unicodeSymbol, #[.lit (.strVal s), _] => atom s
  | some ``Lean.ParserDescr.unicodeSymbol, #[.lit (.strVal s), _, _] => atom s
  | some ``Lean.ParserDescr.cat, _ | some ``Lean.ParserDescr.const, _ | some ``Lean.ParserDescr.parser, _ => acc.push "…"
  | some c, #[] =>
    match (env.find? c).bind (·.type.getAppFn.constName?) with
    | some ``Lean.ParserDescr | some ``Lean.TrailingParserDescr => acc.push "…"
    | _ => acc
  | _, _ => args.foldl (fun a x => parserTokens env x a) acc

/-- What a card calls a syntax kind: its atoms, `…` for what goes between them (`declare_type …
    where`), at most 40 characters; its name's last part where its parser is not to be read. -/
def kindLabel (env : Environment) (k : Name) : String := Id.run do
  let fallback := match k with | .str _ s => s | _ => k.toString
  let some (.defnInfo v) := env.find? k | return fallback
  let mut toks : Array String := #[]
  for t in parserTokens env v.value #[] do
    if t.isEmpty || (t == "…" && toks.back? == some "…") then continue
    toks := toks.push t
  while toks.back? == some "…" do toks := toks.pop
  while toks[0]? == some "…" do toks := toks.extract 1 toks.size
  let s := " ".intercalate toks.toList
  if s.isEmpty then return fallback
  return if s.length > 40 then (s.take 39).toString ++ "…" else s

def run (out : System.FilePath) (projectDir : String) (roots : Array Name)
    (cache : Option System.FilePath) (salt : String) : M Unit := do
  let env ← getEnv
  let t0 ← IO.monoMsNow
  let modNames := env.header.moduleNames
  modify fun s => { s with modNames }
  -- 1. project modules: those whose .olean lives in the project's own build directory. Both paths
  -- are made real first: the search path may spell a folder one way and the command line another
  -- (a temporary folder on macOS, /var → /private/var; a project reached through a symbolic link)
  let real (p : System.FilePath) : IO String := do
    try return (← IO.FS.realPath p).toString catch _ => return p.toString
  let sep := System.FilePath.pathSeparator.toString
  let dir ← real projectDir
  let dir := if dir.endsWith sep then dir else dir ++ sep
  let mut projMods : Array (Name × Nat) := #[]
  for h : i in [0:modNames.size] do
    let m := modNames[i]
    let path ← try (some <$> findOLean m) catch _ => pure none
    if let some p := path then
      if (← real p).startsWith dir then projMods := projMods.push (m, i)
  let projSet : Std.HashSet Name := projMods.foldl (·.insert ·.1) {}
  let inProject (c : Name) : Bool :=
    match env.getModuleIdxFor? c with
    | some i => projSet.contains modNames[i.toNat]!
    | none => false

  -- 1b. the cache: module keys in import order (moduleNames lists imports first), then load
  let mut keys : Std.HashMap Name String := {}
  let mut hits := 0
  if let some dir := cache then
    IO.FS.createDirAll dir
    for (m, idx) in projMods do
      let olean ← findOLean m
      let some own ← (try some <$> IO.FS.readFile (olean.toString ++ ".hash") catch _ => pure none)
        | continue
      let deps := env.header.moduleData[idx]!.imports.filter (projSet.contains ·.module)
      let depKeys := deps.filterMap (keys[·.module]?)
      if depKeys.size < deps.size then continue
      let key := hex (hash (salt ++ "|" ++ own.trimAscii.toString ++ "|" ++ ",".intercalate depKeys.toList))
      keys := keys.insert m key
      if ← readModuleCache dir m key then hits := hits + 1
    IO.eprintln s!"[extract] cache: {hits}/{projMods.size} modules reused ({(← IO.monoMsNow) - t0} ms)"

  -- 2. classify project constants: a node, or folded into one. Meta-level declarations are
  -- nodes too (decision 2): what a syntax extension command generates is grouped below (2c)
  let mut nodes : Array Name := #[]
  let mut auxs : Array Name := #[]
  let mut notations : Std.HashSet Name := {}
  -- a constant that two modules list: importing both keeps one, which the environment places in
  -- one of them. It is taken once, from there. Lean realises equation lemmas so in every module
  -- that asks for them; the same declaration written in two files that do not import each other
  -- is said, with both places
  let mut elsewhere : Array (Name × Name) := #[]
  for (m, idx) in projMods do
    for c in env.header.moduleData[idx]!.constNames do
      if (env.getModuleIdxFor? c |>.map (·.toNat)) != some idx then
        elsewhere := elsewhere.push (c, m)
        continue
      let some ci := env.find? c | continue
      let u := (privateToUserName? c).getD c
      let ranged := (← findDeclarationRanges? c).isSome
      if isNotationConst ci && ranged then
        notations := notations.insert c; nodes := nodes.push c; continue
      let generated :=
        ci matches .ctorInfo _ || ci matches .recInfo _ || isAuxRecursor env c
        || isNoConfusion env c || isMatcherCore env c || (env.getProjectionFnInfo? c).isSome
        || u.isInternalDetail || generatedSuffixes.contains u.getString!
        || (u.getString! == "elim" && (env.find? c.getPrefix matches some (.ctorInfo _)))
      if generated || !(ranged || Meta.isInstanceCore env c) then auxs := auxs.push c
      else nodes := nodes.push c
  let written : Std.HashSet Name := nodes.foldl (·.insert ·) {}
  for (c, m) in elsewhere do
    if written.contains c then
      IO.eprintln s!"[extract] warning: {c} is declared in {m} and in {moduleOf modNames env c}; the graph keeps the one in {moduleOf modNames env c}"
  -- by the name as written: a private constant's own prefixes are its module's mangling
  let hasExternalPrefix (c : Name) : Bool := Id.run do
    let mut p := ((privateToUserName? c).getD c).getPrefix
    while !p.isAnonymous do
      if (env.find? p).isSome && !inProject p then return true
      p := p.getPrefix
    return false
  let mut owner : Std.HashMap Name Name := nodes.foldl (fun m c => m.insert c c) {}
  -- an aux constant belongs to the nearest enclosing node: constructors and projections to
  -- their type, everything else to the longest name prefix that is a node (a matcher of an
  -- `_aux_` macro to it, the code of a `partial def` to the definition)
  let byUser : Std.HashMap Name Name :=
    nodes.foldl (fun m c => m.insert ((privateToUserName? c).getD c) c) {}
  for c in auxs do
    let start := match env.find? c with
      | some (.ctorInfo v) => v.induct
      | _ => match env.getProjectionFnInfo? c with
        | some info => match env.find? info.ctorName with
          | some (.ctorInfo v) => v.induct
          | _ => c.getPrefix
        | none => c.getPrefix
    let mut p := (privateToUserName? start).getD start
    let mut found : Option Name := none
    while !p.isAnonymous && found.isNone do
      found := byUser[p]?
      p := p.getPrefix
    match found with
    | some o => owner := owner.insert c o
    | none =>
      -- generated in this project for a declaration outside it (an equation lemma Lean
      -- realised on demand): it is external, and references to it fold like external ones;
      -- anything else that belongs to no declaration stands for itself
      if hasExternalPrefix c then pure ()
      else nodes := nodes.push c; owner := owner.insert c c

  -- 2b. units (TCBSpec.md, decision 1). A declaration Lean generated from a command (what a declaring
  -- command writes beside the declaration it names, the lemmas of `@[simps]`) has no name of its own in the text: its
  -- selection range is its whole range, where a written one's is its name. It belongs to the
  -- declaration that command writes, the smallest range of a written declaration of its module
  -- that holds its own, and folds into it as a constructor folds into its type. One for which no
  -- such declaration is found stays a node of its own, marked `gen`. What syntax extension
  -- commands generate is left to 2c: such a command writes no declaration.
  let modName (c : Name) : String :=
    match env.getModuleIdxFor? c with
    | some i => modNames[i.toNat]!.toString
    | none => ""
  let generatedAt (r : DeclarationRanges) : Bool :=
    r.selectionRange.pos == r.range.pos && r.selectionRange.endPos == r.range.endPos
  let posLe (a b : Position) : Bool := a.line < b.line || (a.line == b.line && a.column ≤ b.column)
  let mut rngs : Array (Option DeclarationRanges) := #[]
  for c in nodes do rngs := rngs.push (← findDeclarationRanges? c)
  let mut ofModule : Std.HashMap String (Array Nat) := {}
  for h : j in [0:nodes.size] do
    ofModule := ofModule.insert (modName nodes[j]) ((ofModule.getD (modName nodes[j]) #[]).push j)
  -- generated declaration → the declaration its command writes
  let mut genOwner : Std.HashMap Name Name := {}
  let mut genLost : Std.HashSet Name := {}
  for h : i in [0:nodes.size] do
    let some r := rngs[i]! | continue
    if !generatedAt r || notations.contains nodes[i] then continue
    let mut best : Option (Nat × Nat) := none
    for j in ofModule.getD (modName nodes[i]) #[] do
      let some rj := rngs[j]! | continue
      if j == i || generatedAt rj || notations.contains nodes[j]! then continue
      if !(posLe rj.range.pos r.range.pos && posLe r.range.endPos rj.range.endPos) then continue
      let span := (rj.range.endPos.line - rj.range.pos.line) * 100000
        + (rj.range.endPos.column + 100000 - rj.range.pos.column)
      if best.all (fun (_, s) => span < s) then best := some (j, span)
    match best with
    | some (j, _) => genOwner := genOwner.insert nodes[i] nodes[j]!
    | none => genLost := genLost.insert nodes[i]
  -- 2c. notation units (decision 2): the constants one syntax extension command generates share
  -- its range, and make one unit of kind `notation`. It is named after the syntax kind it
  -- declares (`syntax`, `notation`, `macro`, `elab`), else after its first `_aux_` declaration
  -- (`macro_rules`, `elab_rules`), else after its category's quotation parser
  -- (`declare_syntax_cat`); the rest is listed in its `also`.
  let rank (c : Name) : Nat :=
    match env.find? c with
    | some ci =>
      match ci.type.getForallBody.getAppFn.constName? with
      | some h =>
        if h == ``Lean.Parser.Category then 3
        else if (h == ``Lean.ParserDescr || h == ``Lean.TrailingParserDescr) then
          (if c.getString! == "quot" then 2 else 0)
        else 1
      | none => 1
    | none => 1
  let mut byCommand : Std.HashMap String (Array Nat) := {}
  for h : i in [0:nodes.size] do
    if !notations.contains nodes[i] then continue
    let key := match rngs[i]! with
      | some r => s!"{modName nodes[i]}:{r.range.pos.line}:{r.range.pos.column}:{r.range.endPos.line}:{r.range.endPos.column}"
      | none => s!"{nodes[i]}"
    byCommand := byCommand.insert key ((byCommand.getD key #[]).push i)
  let generatedCount := genOwner.size
  let mut notationUnits : Std.HashSet Name := {}
  for (_, members) in byCommand do
    let sorted := members.qsort fun a b =>
      rank nodes[a]! < rank nodes[b]! || (rank nodes[a]! == rank nodes[b]! && nodes[a]!.toString < nodes[b]!.toString)
    let rep := nodes[sorted[0]!]!
    notationUnits := notationUnits.insert rep
    for k in sorted.extract 1 sorted.size do genOwner := genOwner.insert nodes[k]! rep
  -- what a generated declaration owned (its constructors, its equation lemmas) ends at its unit
  owner := owner.fold (fun m c o => m.insert c (genOwner.getD o o)) {}
  let mut also : Std.HashMap Name (Array Name) := {}
  for (c, o) in genOwner do also := also.insert o ((also.getD o #[]).push c)
  let userName (c : Name) : Name := (privateToUserName? c).getD c
  also := also.fold (fun m o xs => m.insert o (xs.qsort (fun a b => (userName a).toString < (userName b).toString))) {}
  nodes := nodes.filter (!genOwner.contains ·)
  let nodeIdx : Std.HashMap Name Nat := nodes.size.fold (fun i _ m => m.insert nodes[i]! i) {}
  -- 2d. what a notation unit is (decision 2, as revised on 2026-10-08). Meaning lives in the
  -- macros and elaborators and the code they call; a command that only declares syntax (`syntax`,
  -- `declare_syntax_cat`) fixes the grammar, whose trees the rule that ran, or a parent
  -- elaborator, interprets. Such a unit is `grammar`: a node, but edges into it carry the grammar
  -- site, which no TCB follows. A macro or elaborator depends on the syntax it interprets at that
  -- site, for the reader to see them side by side; nothing depends on a rule through its syntax:
  -- a use reaches the rule itself (server/usage.ts).
  let headOf (c : Name) : Name := ((env.find? c).bind (·.type.getForallBody.getAppFn.constName?)).getD .anonymous
  let lastOf (c : Name) : String := match c with | .str _ s => s | _ => ""
  let isKindDecl (c : Name) : Bool :=
    (headOf c == ``Lean.ParserDescr || headOf c == ``Lean.TrailingParserDescr) && lastOf c != "quot"
  let isParserHead (h : Name) : Bool :=
    h == ``Lean.ParserDescr || h == ``Lean.TrailingParserDescr || h == ``Lean.Parser.Category
  -- every macro and elaborator of the project, with the kinds it is registered for
  let mut kindsOfImpl : Std.HashMap Name (Array Name) := {}
  let mut rulesOfKind : Std.HashMap Name (Array Name) := {}
  for k in Parser.getSyntaxNodeKinds env do
    let impls :=
      (Elab.macroAttribute.getEntries env k).map (·.declName)
      ++ (Elab.Term.termElabAttribute.getEntries env k).map (·.declName)
      ++ (Elab.Command.commandElabAttribute.getEntries env k).map (·.declName)
      ++ (Elab.Tactic.tacticElabAttribute.getEntries env k).map (·.declName)
    for r in impls do
      if inProject r then kindsOfImpl := kindsOfImpl.insert r ((kindsOfImpl.getD r #[]).push k)
    if inProject k then rulesOfKind := rulesOfKind.insert k impls.toArray
  let mut grammarUnits : Std.HashSet Name := {}
  -- unit → the kinds it interprets, the command it is, and its name and display
  let mut interprets : Std.HashMap Name (Array Name) := {}
  let mut command : Std.HashMap Name String := {}
  for n in nodes do
    let members := n :: (also.getD n #[]).toList
    let mut ks : Array Name := #[]
    for m in members do
      for k in kindsOfImpl.getD m #[] do
        if !ks.contains k && !members.contains k then ks := ks.push k
    if !ks.isEmpty then interprets := interprets.insert n (ks.qsort (·.toString < ·.toString))
    if !notationUnits.contains n then continue
    let heads := members.map headOf
    let declares := members.any isKindDecl
    let elab_ := heads.any fun h => h == ``Lean.Elab.Term.TermElab || h == ``Lean.Elab.Command.CommandElab || h == ``Lean.Elab.Tactic.Tactic
    let cmd :=
      if heads.all isParserHead then
        (if heads.contains ``Lean.Parser.Category then "syntax_cat" else "syntax")
      else if declares then
        (if heads.contains ``Lean.PrettyPrinter.Unexpander then "notation" else if elab_ then "elab" else "macro")
      else if elab_ then "elab_rules"
      else if heads.contains ``Lean.Macro then "macro_rules"
      else "notation"
    if cmd == "syntax" || cmd == "syntax_cat" then grammarUnits := grammarUnits.insert n
    command := command.insert n cmd
  -- names: a unit is called after what it declares or interprets, not after Lean's `_aux_` name,
  -- whose counter and module prefix say nothing a reader can use. A syntax, `notation`, `macro`
  -- or `elab` keeps its kind's name; a category is `<cat>.syntax_cat`; a rule is
  -- `<kind>.macro_rules` (`elab_rules`), the kind it interprets (the first by name when it has
  -- several; one outside the project under the rule's own namespace), qualified with its module's
  -- last part when that is not the module of the kind's syntax, and numbered `_2`, `_3`, … in
  -- source order where one module has several rules for the kind. An edit elsewhere leaves it as
  -- it is. A kind declared `local` is private to its module, so several modules may each declare
  -- one of the same name (`local notation "Φ" => …` in every file that wants it): its unit, and the
  -- rules that interpret it, are qualified with its module's last part too
  -- (`MyProject.Perm.termΦ.Frame`), which no edit in another module changes. A
  -- public kind's name is unique already.
  let tailOf (c : Name) : String := lastOf (modNames[(env.getModuleIdxFor? c).map (·.toNat) |>.getD 0]!)
  let kindName (k : Name) : Name := if isPrivateName k then (userName k).str (tailOf k) else userName k
  let mut display : Std.HashMap Name String := {}
  let mut named : Std.HashMap Name Name := {}
  let mut byBase : Std.HashMap Name (Array (Name × Nat)) := {}
  let mut labelOf : Std.HashMap Name String := {}
  for n in nodes do
    let some cmd := command[n]? | continue
    let members := n :: (also.getD n #[]).toList
    let modTail := lastOf (modNames[(env.getModuleIdxFor? n).map (·.toNat) |>.getD 0]!)
    let line := ((← findDeclarationRanges? n).map (·.range.pos.line)).getD 0
    if cmd == "syntax_cat" then
      let base := match members.find? (lastOf · == "quot") with
        | some q => userName q.getPrefix
        | none => userName n
      named := named.insert n (base.str "syntax_cat")
      display := display.insert n s!"syntax_cat · {lastOf base}"
    else if let some k := members.find? isKindDecl then
      let label := kindLabel env k
      labelOf := labelOf.insert n label
      if isPrivateName k then named := named.insert n (kindName k)
      display := display.insert n s!"{cmd} · {label}{if isPrivateName k then s!" · in {tailOf k}" else ""}"
    else if let some k := (interprets.getD n #[])[0]? then
      let own := (env.getModuleIdxFor? k) == (env.getModuleIdxFor? n)
      let kName := if inProject k then kindName k else (userName n).getPrefix.str (lastOf k)
      let base := if own then kName.str cmd else (kName.str cmd).str modTail
      byBase := byBase.insert base ((byBase.getD base #[]).push (n, line))
      labelOf := labelOf.insert n (kindLabel env k)
  for (base, units) in byBase do
    let sorted := units.qsort fun a b => a.2 < b.2 || (a.2 == b.2 && a.1.toString < b.1.toString)
    for h : j in [0:sorted.size] do
      let (n, _) := sorted[j]
      let name := if j == 0 then base else match base with
        | .str p s => p.str s!"{s}_{j + 1}"
        | b => b
      named := named.insert n name
      let cmd := command.getD n "notation"
      let where_ := match base with
        | .str (.str _ c) m => if c == cmd then s!" · in {m}" else ""
        | _ => ""
      display := display.insert n s!"{cmd}{if j == 0 then "" else s!" #{j + 1}"} · {labelOf.getD n ""}{where_}"
  -- a name another unit has already is not taken: that unit keeps its own, Lean's
  let taken : Std.HashSet String := nodes.foldl (fun s c => if named.contains c then s else s.insert (userName c).toString) {}
  named := named.filter fun _ nm => !taken.contains nm.toString
  -- every unit's name is its own: the server, the review and the views know a declaration by its
  -- name alone. The rules above should leave none shared; should two units still meet on
  -- one (two private declarations of the same name in modules that do not import each other), the
  -- later one in module order is numbered and the extraction says so
  let mut nameOf : Std.HashMap Name String := {}
  let mut usedNames : Std.HashMap String Name := {}
  for n in nodes do
    let base := named[n]?.getD (userName n)
    let mut nm := base.toString
    let mut k := 2
    while usedNames.contains nm do
      nm := (match base with | .str p s => p.str s!"{s}_{k}" | b => b.str s!"_{k}").toString
      k := k + 1
    if k > 2 then
      IO.eprintln s!"[extract] warning: {base} names a unit of {modName (usedNames.getD base.toString n)} and one of {modName n}; the second is called {nm}"
    usedNames := usedNames.insert nm n
    nameOf := nameOf.insert n nm
  -- what a unit's interpreting depends on, at the grammar site; the units that interpret a kind
  let mut interpretRefs : Std.HashMap Name (Array (Name × Site)) := {}
  let mut rules := 0
  for (n, ks) in interprets do
    for k in ks do
      if owner.contains k then
        interpretRefs := interpretRefs.insert n ((interpretRefs.getD n #[]).push (k, grammar))
        rules := rules + 1
  IO.eprintln s!"[extract] {projMods.size} project modules, {nodes.size} nodes ({notationUnits.size} notation, {grammarUnits.size} of them grammar), {auxs.size} folded, {generatedCount} generated from a command folded, {genOwner.size - generatedCount} folded into notation units, {rules} syntax rules ({(← IO.monoMsNow) - t0} ms)"

  -- 3. edges: a unit's own references, seen through the generated constants it owns; those of
  -- the declarations it folds are its own, at the same sites
  let insts ← WalkCache.new
  let mut extIdx : Std.HashMap Name Nat := {}
  let mut exts : Array Name := #[]
  let mut edges : Array Json := #[]
  let mut done := 0
  for n in nodes do
    let mut acc : Std.HashMap Name Site := {}
    let mut work : Array (Name × Site) := (← refsOf insts n) ++ interpretRefs.getD n #[]
    -- a declaration written in a `mutual` block is compiled from the whole block, so its value
    -- reaches the others' bodies only through what Lean generates (each one's `_f` in structural
    -- recursion, one shared `_mutual` in well-founded recursion, inlined before v4.29, the others'
    -- `_unsafe_rec` in a `partial def`'s code) and never by their names: it rests on each of them,
    -- in its body, a theorem in its proof
    match env.find? n with
    | some (.defnInfo v) => for m in v.all do if m != n then work := work.push (m, body)
    | some (.thmInfo v) => for m in v.all do if m != n then work := work.push (m, proof)
    | some (.opaqueInfo v) =>
      if (env.find? (n ++ `_unsafe_rec)).isSome then
        for m in v.all do if m != n then work := work.push (m, body)
    | _ => pure ()
    for a in also.getD n #[] do
      let rs ← refsOf insts a
      -- a derived instance of a class whose instances are all equal (a `deriving DecidableEq`)
      -- is left out as a proof is, whatever it refers to (decision 5); so is what a notation's
      -- unexpander or delaborator refers to: it changes how a term is shown, never what it means
      if (← subsingletonDecl insts a) || headOf a == ``Lean.PrettyPrinter.Unexpander
          || headOf a == ``Lean.PrettyPrinter.Delaborator.Delab then
        work := work ++ rs.map fun (d, _) => (d, proof)
      else work := work ++ rs
    let mut seen : Std.HashSet (Name × Site) := {}
    while h : work.size > 0 do
      let (d, s) := work[work.size - 1]
      work := work.pop
      if inProject d && owner.contains d then
        match owner[d]? with
        | some o =>
          if d == o || isStructural env d || genOwner.contains d then
            -- a declaration, a constructor / recursor / projection standing for its type, or a
            -- declaration generated from the command that writes its unit
            if o != n then acc := acc.insert o ((acc[o]?.getD 0) ||| s)
          else if !seen.contains (d, s) then
            -- any other generated constant is looked through, whoever it was generated for:
            -- Lean shares a matcher or an abstracted proof between declarations of the same
            -- shape, so its owner by name is not who uses it
            seen := seen.insert (d, s)
            for (d', s') in ← refsOf insts d do work := work.push (d', combine s s')
        | none => pure ()
      else
        let e := foldExternal env d
        acc := acc.insert e ((acc[e]?.getD 0) ||| s)
    let src := nodeIdx[n]!
    for (t, s0) in acc do
      -- into a unit that only declares syntax, what is not a proof is grammar
      let s := if grammarUnits.contains t && s0 &&& (stmt ||| body) != 0 then (s0 &&& (proof ||| grammar)) ||| grammar else s0
      let dst ← match nodeIdx[t]? with
        | some i => pure i
        | none =>
          if inProject t then continue
          match extIdx[t]? with
          | some j => pure (nodes.size + j)
          | none =>
            extIdx := extIdx.insert t exts.size
            exts := exts.push t
            pure (nodes.size + exts.size - 1)
      edges := edges.push (Json.arr #[src, dst, s.toNat])
    done := done + 1
    if done % 1000 == 0 then
      IO.eprintln s!"[extract] edges: {done}/{nodes.size} ({(← IO.monoMsNow) - t0} ms)"
  IO.eprintln s!"[extract] {edges.size} edges, {exts.size} externals ({(← IO.monoMsNow) - t0} ms)"

  -- 4. axioms, through everything, joined over each unit
  let mut axSetIdx : Std.HashMap Nat Nat := {}
  let mut axSets : Array Nat := #[]
  let mut nodeAx : Array Nat := #[]
  for c in nodes ++ exts do
    let mut m ← axiomMask c
    for a in also.getD c #[] do m := m ||| (← axiomMask a)
    match axSetIdx[m]? with
    | some i => nodeAx := nodeAx.push i
    | none =>
      axSetIdx := axSetIdx.insert m axSets.size
      nodeAx := nodeAx.push axSets.size
      axSets := axSets.push m
  IO.eprintln s!"[extract] axioms: {(← get).axioms.size} distinct, {axSets.size} sets, {(← get).axMask.size} constants walked ({(← IO.monoMsNow) - t0} ms)"

  -- 5. what a card shows
  let mut nodeJs : Array Json := #[]
  -- the names the units' `refs` point at, each once: a unit refers to some thirty constants
  let mut refIndex : Std.HashMap String Nat := {}
  let mut refNames : Array String := #[]
  for h : i in [0:nodes.size] do
    let c := nodes[i]
    let some ci := env.find? c | continue
    let u := (privateToUserName? c).getD c
    let ty ← match (← get).pp[c]? with
      | some t => pure t
      | none =>
        let t ← try (toString <$> withOptions (·.set `format.width (100 : Nat)) (ppExpr ci.type))
          catch _ => pure "<failed to print>"
        -- what printing it inferred serves no other statement (as in `refsOf`)
        modifyThe Meta.State fun s => { s with cache := {} }
        modify fun s => { s with pp := s.pp.insert c t, dirty := s.dirty.insert (moduleOf s.modNames env c) }
        pure t
    let doc ← findDocString? env c
    let rng ← findDeclarationRanges? c
    -- a unit's version is the kernel's (TCBSpec.md, decision 3): its own content hash, then those
    -- of what it folds, in name order, so a change anywhere in what its command made is a change
    let folded := also.getD c #[]
    -- and of what its declarations are compiled into, where a recursive body is (compiledOf)
    let compiled := compiledOf env inProject owner genOwner (c :: folded.toList)
    let mut h := contentHash env ci
    for a in folded ++ compiled do
      if let some aci := env.find? a then h := mixHash h (contentHash env aci)
    -- the same content with the names it mentions taken out, and those names in order: what the
    -- server makes the version from (decision 3, as revised on 2026-10-09)
    let (shape, refs) := unitShape env (c :: folded.toList ++ compiled.toList)
    let name := nameOf.getD c u.toString
    -- a constant of the project is written by its unit's name, then, after a space, what it is of
    -- that unit (`Fixture.Point mk`; nothing for the unit itself), so that the server maps it
    -- through a rename of the unit whatever the constant is; one from outside by its own name
    let refName (r : Name) : String := match owner[r]? with
      | some o =>
        let uo := (userName o).toString
        let ur := (userName r).toString
        let rest := if r == o then "" else if ur.startsWith uo then (ur.drop uo.length).toString else ur
        let own := nameOf.getD o uo
        if rest.isEmpty then own else s!"{own} {(rest.dropWhile (· == '.')).toString}"
      | none => (userName r).toString
    let mut refIdxs : Array Nat := #[]
    for r in refs do
      let s := refName r
      match refIndex[s]? with
      | some k => refIdxs := refIdxs.push k
      | none =>
        refIndex := refIndex.insert s refNames.size
        refIdxs := refIdxs.push refNames.size
        refNames := refNames.push s
    let mut fields : List (String × Json) :=
      [("name", name), ("kind", if notationUnits.contains c then "notation" else kindOf env ci), ("module", modName c),
       ("type", ty), ("ax", nodeAx[i]!), ("hash", hex h), ("shape", hex shape), ("refs", toJson refIdxs)]
    if name != u.toString then fields := fields ++ [("leanName", Json.str u.toString)]
    if let some d := display[c]? then fields := fields ++ [("display", Json.str d)]
    -- the kinds it interprets, by their units' names (an outside kind by its own); for a syntax, the
    -- units that interpret it
    let unitName (x : Name) : String := match owner[x]? with
      | some o => nameOf.getD o (userName o).toString
      | none => x.toString
    if let some ks := interprets[c]? then fields := fields ++ [("interprets", toJson (ks.map unitName))]
    let rs := (c :: folded.toList).filter isKindDecl |>.flatMap (fun k => (rulesOfKind.getD k #[]).toList)
    let ruleUnits := (rs.filterMap (owner[·]?)).filter (· != c) |>.eraseDups
    if !rs.isEmpty then
      fields := fields ++ [("rules", toJson (ruleUnits.map unitName))]
      -- a kind with rules outside the project: no rule of it is the only one
      if rs.any (!inProject ·) then fields := fields ++ [("foreignRules", Json.bool true)]
    if let some d := doc then fields := fields ++ [("doc", Json.str d)]
    if let some r := rng then
      fields := fields ++ [("range", Json.arr #[r.range.pos.line, r.range.pos.column,
        r.range.endPos.line, r.range.endPos.column])]
    if genLost.contains c then fields := fields ++ [("gen", Json.str "")]
    if !folded.isEmpty then fields := fields ++ [("also", toJson (folded.map fun a => (userName a).toString))]
    let fl := flagsOf env ci ++ (if grammarUnits.contains c then #["grammar"] else #[])
    if !fl.isEmpty then fields := fields ++ [("flags", toJson fl)]
    nodeJs := nodeJs.push (Json.mkObj fields)
  let mut extJs : Array Json := #[]
  for h : j in [0:exts.size] do
    let c := exts[j]
    let kind := match env.find? c with
      | some ci => kindOf env ci
      | none => "unknown"
    extJs := extJs.push (Json.mkObj [("name", c.toString), ("kind", kind),
      ("module", modName c), ("ax", nodeAx[nodes.size + j]!)])
  let metaUnits : Nat := nodes.foldl (init := 0) fun k c =>
    if !notationUnits.contains c && ((env.find? c).map isMetaDecl).getD false then k + 1 else k
  let axioms := (← get).axioms
  let axSetJs := axSets.map fun m => toJson ((List.range axioms.size).filter (fun k => m.testBit k))
  let modJs := projMods.map fun (m, idx) =>
    Json.mkObj [("name", m.toString),
      ("imports", toJson (env.header.moduleData[idx]!.imports.filterMap fun im =>
        if projSet.contains im.module then some im.module.toString else none))]
  let doc := Json.mkObj [
    ("schema", 1), ("roots", toJson (roots.map toString)),
    ("modules", Json.arr modJs), ("nodes", Json.arr nodeJs), ("externals", Json.arr extJs),
    ("edges", Json.arr edges), ("axioms", toJson (axioms.map toString)),
    ("axiomSets", Json.arr axSetJs), ("refNames", toJson refNames),
    ("stats", Json.mkObj [("folded", auxs.size), ("generated", generatedCount), ("metaDropped", 0),
      ("notation", notationUnits.size), ("grammar", grammarUnits.size),
      ("meta", metaUnits),
      ("ms", (← IO.monoMsNow) - t0)])]
  IO.FS.writeFile out doc.compress
  IO.eprintln s!"[extract] wrote {out} ({(← IO.monoMsNow) - t0} ms)"
  if let some dir := cache then
    let dirty := (← get).dirty
    let mut written := 0
    for (m, idx) in projMods do
      if let some key := keys[m]? then
        if dirty.contains m then
          writeModuleCache dir m key env.header.moduleData[idx]!.constNames
          written := written + 1
    IO.eprintln s!"[extract] cache: {written} module(s) written ({(← IO.monoMsNow) - t0} ms)"

end VisualProof

def main (args : List String) : IO UInt32 := do
  -- options may come anywhere: --cache <dir>, --salt <text>
  let rec split : List String → List String → Option String → String → List String × Option String × String
    | [], pos, c, sa => (pos.reverse, c, sa)
    | "--cache" :: d :: rest, pos, _, sa => split rest pos (some d) sa
    | "--salt" :: v :: rest, pos, c, _ => split rest pos c v
    | a :: rest, pos, c, sa => split rest (a :: pos) c sa
  let (pos, cache, salt) := split args [] none ""
  match pos with
  | out :: projectDir :: roots@(_ :: _) =>
    initSearchPath (← findSysroot)
    let roots := roots.toArray.map String.toName
    -- extension state (instances, classes, matchers) is only built when extensions load, and
    -- loading them may run imported initializers
    unsafe enableInitializersExecution
    let env ← importModules (roots.map ({ module := · })) {} (trustLevel := 1024) (loadExts := true)
    let ctx : Core.Context := { fileName := "<visualproof>", fileMap := default, maxHeartbeats := 0 }
    let _ ← ((VisualProof.run out projectDir roots (cache.map (⟨·⟩)) salt).run' {} : MetaM Unit).toIO ctx { env }
    return 0
  | _ =>
    IO.eprintln "usage: lean --run Extract.lean <out.json> <project-lib-dir> <root-module>... [--cache dir] [--salt text]"
    return 2
