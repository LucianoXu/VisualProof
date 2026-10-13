/-
VisualProof usage pass: one module of a built Lean project, elaborated → which notation each of its
commands is written in, and the context each is written in (TCBSpec.md, decisions 2 and 4).

Run with the target project's LEAN_PATH, one process per module (a process cannot import twice):

    vp-usage <source.lean> <Module> <out.json> <project-modules.txt> [-Dname=value]...

`project-modules.txt` lists the project's modules, one per line: a syntax kind or an implementation
declared in one of them (or in the module itself) is the project's; notation from outside the
project is not recorded at all, whatever the review's trusted prefixes say (TCBSpec.md, decision 2
and its implementation notes). The `-D` options are those Lake compiled the module with (its trace
records them), so that the module elaborates as it did in the build.

The module is elaborated under exactly its imports, with its proofs left out (variant Bk of the
spike): the values of `theorem`, `lemma` and `example`, and `decreasing_by`, become `sorry`; a `by`
block anywhere else is kept and told apart by its goal (a proposition is a proof, anything else is
data); `#` commands are skipped; `c₁ in c₂` runs as `section c₁ c₂ end`, as Lean expands it, so that
`c₂` is recorded with its context. The program only reads. It writes `out.json` and nothing else:
no `.olean`, no `.ilean`.

Output, one JSON object:
  module, ms      the module, and where the time went (import, elaboration, total)
  errors          commands that did not elaborate: [{line, message}] (the rest is still recorded)
  contexts        the distinct contexts commands are written in, each in the shape of
                  shared/scope.ts's FileContext: namespace, blocks, opens, variables, universes,
                  options, local — as the elaborator's scope has them before the command, every
                  entry with the line of the command that put it there
  cmds            the commands that declare a constant or use project notation:
                  {line, endLine, consts, ctx, incl, uses, proofs?}
    consts        the constants the command declared (user names; internal ones left out, but for
                  the `_aux_` declarations of syntax extensions)
    ctx           its context, an index into `contexts`
    incl          constant → the indices of the `variables` of its context Lean included in it
    uses          [kind, impl, site, line, col, by]: a project syntax kind parsed in its text, or a
                  macro or elaborator that ran on it (`impl`, with the kind it ran for), "" where
                  there is none; `site` 1 = statement, 2 = definition body, 4 = proof; where; and
                  `by`, the index in `uses` of the project implementation whose expansion emitted
                  it, or -1 when it is written in the text
    proofs        where the proofs inside its definitions' bodies are, for the exported document to
                  cut (ExportSpec decision 8): [line, col, endLine, endCol], columns in code points,
                  end exclusive, sorted and merged — `by` blocks whose goal is a proposition, the
                  tactics of `decreasing_by`, term-mode proofs as written; none in a signature or a
                  quotation. Absent when there are none.
-/
import Lean

open Lean Elab Command Parser System

namespace VisualProof.Usage

/-! ## Sites, as Extract.lean has them -/

def stmt : Nat := 1
def body : Nat := 2
def proof : Nat := 4

/-! ## Syntax -/

def kindLast : Name → String
  | .str _ s => s
  | _ => ""

def isQuotKind (k : Name) : Bool :=
  let s := kindLast k
  s == "quot" || s == "quotSeq" || s == "dynamicQuot" || s == "precheckedQuot"

/-- A declaration whose value is a proof, or never a unit (`example`). -/
def isTheoremKind (k : Name) : Bool :=
  k == ``Lean.Parser.Command.theorem || kindLast k == "lemma" || k == ``Lean.Parser.Command.example

def declValKinds : List Name :=
  [``Lean.Parser.Command.declValSimple, ``Lean.Parser.Command.declValEqns,
   ``Lean.Parser.Command.whereStructInst]

def sigKinds : List Name := [``Lean.Parser.Command.declSig, ``Lean.Parser.Command.optDeclSig]

/-- Syntax extension commands: never stripped, whatever their quotations hold. -/
def extCmdKinds : List Name :=
  [``Lean.Parser.Command.syntax, ``Lean.Parser.Command.syntaxAbbrev, ``Lean.Parser.Command.syntaxCat,
   ``Lean.Parser.Command.notation, ``Lean.Parser.Command.macro, ``Lean.Parser.Command.elab,
   ``Lean.Parser.Command.mixfix, ``Lean.Parser.Command.macro_rules, ``Lean.Parser.Command.elab_rules]

partial def firstKind? (stx : Syntax) (k : Name) : Option Syntax :=
  if stx.getKind == k then some stx else stx.getArgs.findSome? (firstKind? · k)

/-- Whether a command is of `local` or `scoped` attribute kind: `local notation`, `scoped instance`,
    `attribute [local simp] …`. What it declares holds while its section or namespace is open. -/
partial def localKind? (stx : Syntax) : Option Syntax :=
  if stx.getKind == ``Lean.Parser.Term.local || stx.getKind == ``Lean.Parser.Term.scoped then some stx
  else if isQuotKind stx.getKind then none
  else stx.getArgs.findSome? localKind?

/-- The first atom of a command, its doc comment skipped. -/
partial def firstAtom (stx : Syntax) : String :=
  match stx with
  | .atom _ v => v
  | .node _ k args =>
    if k == ``Lean.Parser.Command.docComment then "" else
    args.foldl (fun acc a => if acc.isEmpty then firstAtom a else acc) ""
  | _ => ""

/-- Whether a piece of syntax was written in the file, rather than made by an expansion: its own
    first token (an atom of its node, or of the groups directly under it) carries the parser's
    position. A notation an expansion emits has the expansion's synthetic position on its tokens,
    though what it was handed (`$x`) keeps the reader's; so the node's own tokens are asked, not its
    first one, which may be such an argument. -/
partial def written (stx : Syntax) : Bool :=
  match ownAtom? stx with
  | some (.atom (.original ..) _) => true
  | some _ => false
  | none => stx.getHeadInfo matches .original ..
where
  ownAtom? (s : Syntax) : Option Syntax :=
    s.getArgs.findSome? fun a => match a with
      | .atom .. => some a
      | .node _ k _ => if k == nullKind || k == groupKind then ownAtom? a else none
      | _ => none

/-! ## Regions of a command, from its syntax

A position in a command is in its statement, its definition body or a proof. `by` blocks are
decided by their goal once elaborated (`ByBlock`); until then they count as proof. -/

inductive Region where
  | site (s : Nat)
  /-- the `k`-th `by` block of the command, inside a part of site `outer` -/
  | byBlock (k : Nat) (outer : Nat)
  deriving Inhabited

structure Iv where
  s : Nat
  e : Nat
  r : Region

/-- A `by` block of a command: the `k`-th, where it is, the site of the part it is in, and whether
    it is inside a quotation (syntax a macro builds, not a term of the command). -/
structure ByIv where
  k : Nat
  s : Nat
  e : Nat
  outer : Nat
  quot : Bool

structure ParseOut where
  /-- every syntax kind parsed, with its position -/
  kinds : Array (Name × Nat) := #[]
  ivs : Array Iv := #[]
  byBlocks : Nat := 0
  bys : Array ByIv := #[]
  /-- the tactics of a definition's `decreasing_by`: a proof, cut from the exported text -/
  decr : Array (Nat × Nat) := #[]

partial def walkStx (stx : Syntax) (r : Region) (inThm : Bool) (inQuot : Bool := false) : StateM ParseOut Unit := do
  match stx with
  | .node _ k args =>
    let pos? := (stx.getPos? (canonicalOnly := false)).map (·.byteIdx)
    let tail? := (stx.getTailPos? (canonicalOnly := false)).map (·.byteIdx)
    let inThm := inThm || isTheoremKind k
    let outer := match r with | .site s => s | .byBlock _ o => o
    let isProof := match r with | .site s => s == proof | _ => false
    let mut r' := r
    if isProof then pure ()
    else if k == ``Lean.Parser.Term.byTactic then
      let n := (← get).byBlocks
      r' := .byBlock n outer
      modify fun s => { s with byBlocks := n + 1 }
      if let (some a, some b) := (pos?, tail?) then
        modify fun s => { s with bys := s.bys.push { k := n, s := a, e := b, outer, quot := inQuot } }
    else if k == ``Lean.Parser.Termination.decreasingBy || k == ``Lean.Parser.Termination.terminationBy then
      -- `decreasing_by tacs`: the tactics are a proof, the keyword stays
      if k == ``Lean.Parser.Termination.decreasingBy && outer == body && !inQuot then
        let tacs := stx[1]
        if let (some a, some b) := (tacs.getPos? (canonicalOnly := false), tacs.getTailPos? (canonicalOnly := false)) then
          modify fun s => { s with decr := s.decr.push (a.byteIdx, b.byteIdx) }
      r' := .site proof
    else if declValKinds.contains k then r' := .site (if inThm then proof else body)
    else if sigKinds.contains k || k == ``Lean.Parser.Command.declaration then r' := .site stmt
    let changed := match r, r' with
      | .site x, .site y => x != y
      | .byBlock x _, .byBlock y _ => x != y
      | _, _ => true
    if let (true, some a, some b) := (changed, pos?, tail?) then
      modify fun s => { s with ivs := s.ivs.push ⟨a, b, r'⟩ }
    if k != nullKind && !isQuotKind k then
      modify fun s => { s with kinds := s.kinds.push (k, pos?.getD 0) }
    let inQuot := inQuot || isQuotKind k
    for a in args do walkStx a r' inThm inQuot
  | _ => pure ()

/-- The site of a position, once the command's `by` blocks are known to be data (`byData`). -/
def siteAt (ivs : Array Iv) (byData : Std.HashSet Nat) (p : Nat) : Nat := Id.run do
  let mut best : Region := .site stmt
  let mut bestLen := 1000000000
  for iv in ivs do
    if iv.s ≤ p && p < iv.e && iv.e - iv.s < bestLen then
      best := iv.r; bestLen := iv.e - iv.s
  return match best with
    | .site s => s
    | .byBlock k outer => if byData.contains k then outer else proof

/-- Whether a position is in a definition's body, or in a `by` block there (data or proof: the
    block's goal says which). -/
def inBody (ivs : Array Iv) (p : Nat) : Bool := Id.run do
  let mut best : Region := .site stmt
  let mut bestLen := 1000000000
  for iv in ivs do
    if iv.s ≤ p && p < iv.e && iv.e - iv.s < bestLen then
      best := iv.r; bestLen := iv.e - iv.s
  return match best with
    | .site s => s == body
    | .byBlock _ outer => outer == body

def byBlockAt (ivs : Array Iv) (p : Nat) : Option Nat := Id.run do
  let mut best : Option Nat := none
  let mut bestLen := 1000000000
  for iv in ivs do
    if let .byBlock k _ := iv.r then
      if iv.s ≤ p && p < iv.e && iv.e - iv.s < bestLen then
        best := some k; bestLen := iv.e - iv.s
  return best

/-! ## Proofs left out -/

structure Templates where
  sorryVal : Syntax
  decrSorry : Syntax

partial def setAllInfo (info : SourceInfo) : Syntax → Syntax
  | .node _ k args => .node info k (args.map (setAllInfo info))
  | .atom _ v => .atom info v
  | .ident _ raw n pre => .ident info raw n pre
  | s => s

def mkTemplates (env : Environment) : IO Templates := do
  let parse (s : String) : IO Syntax := match runParserCategory env `command s with
    | .ok stx => pure stx
    | .error e => throw (IO.userError s!"template: {e}")
  let t ← parse "theorem t : True := sorry"
  let d ← parse "def f (n : Nat) : Nat := n\ndecreasing_by sorry"
  let some sv := firstKind? t ``Lean.Parser.Command.declValSimple | throw (IO.userError "declValSimple")
  let some db := firstKind? d ``Lean.Parser.Termination.decreasingBy | throw (IO.userError "decreasingBy")
  return { sorryVal := sv, decrSorry := db }

/-- The command with its proofs replaced by `sorry`: the value of a theorem, lemma or example and a
    `decreasing_by` clause. `by` blocks elsewhere are kept, in a signature as in a definition's
    value: whether one is a proof is told by its goal once elaborated. Quotations are left alone. -/
partial def strip (t : Templates) (stx : Syntax) (inThm : Bool) : Syntax :=
  match stx with
  | .node info k args =>
    if isQuotKind k then stx else
    let ref := SourceInfo.fromRef stx (canonical := false)
    if k == ``Lean.Parser.Termination.decreasingBy then setAllInfo ref t.decrSorry else
    let inThm := inThm || isTheoremKind k
    if inThm && declValKinds.contains k then setAllInfo ref t.sorryVal
    else .node info k (args.map (strip t · inThm))
  | _ => stx

/-! ## Running commands -/

def liftCmd (ictx : InputContext) (st : Command.State) (x : CommandElabM α) (pos : Nat := 0) :
    IO (α × Command.State) := do
  let ctx : Command.Context := {
    cmdPos := ⟨pos⟩, fileName := ictx.fileName, fileMap := ictx.fileMap, snap? := none,
    cancelTk? := none }
  match ← (x ctx |>.run st).toIO' with
  | .error e => throw (IO.userError s!"internal: {← e.toMessageData.toString}")
  | .ok r => return r

/-! ## The project -/

/-- Which names are the project's: declared in a module of the project, or in this one. -/
structure Project where
  mask : Array Bool

def Project.has (p : Project) (env : Environment) (n : Name) : Bool :=
  match env.getModuleIdxFor? n with
  | some idx => p.mask[idx.toNat]?.getD false
  | none => env.contains n

def userName (n : Name) : Name := (privateToUserName? n).getD n

def nameStr (n : Name) : String := if n.isAnonymous then "" else (userName n).toString

/-! ## Info trees: the macros and elaborators that ran -/

structure Use where
  kind : Name
  impl : Name
  site : Nat
  pos : Nat
  by_ : Int

structure InfoOut where
  uses : Array Use := #[]
  /-- `by` blocks of the command whose goal is not a proposition -/
  byData : Std.HashSet Nat := {}
  /-- the same, and those nested in another block's tactics, each told apart by its own goal: which
      blocks are cut from the exported text (`byData` keeps the sites the TCB has always had) -/
  spanData : Std.HashSet Nat := {}
  /-- term-mode proofs in a definition's body, as written: [start, end) -/
  termProofs : Array (Nat × Nat) := #[]

abbrev PathElt := ContextInfo × TermInfo × IO.Ref (Option Bool)

/-- Whether some enclosing term is a proof, memoised along the path. -/
def underProof (path : Array PathElt) : IO Bool := do
  for (ci, ti, r) in path do
    let v ← match ← r.get with
      | some v => pure v
      | none => do
        let v ← try ci.runMetaM ti.lctx (do Meta.isProof (← instantiateMVars ti.expr)) catch _ => pure false
        r.set (some v); pure v
    if v then return true
  return false

structure WalkCtx where
  proj : Project
  ivs : Array Iv
  /-- the file's text, as bytes -/
  bytes : ByteArray := .empty
  /-- the use of the project implementation whose expansion this is under, or -1 -/
  encl : Int := -1
  inTac : Bool := false
  /-- the `by` block the enclosing tactic is in -/
  curBy : Option Nat := none
  /-- under a term-mode proof recorded already -/
  inCut : Bool := false

/-- Up to two of the tokens a piece of syntax is written with. -/
partial def tokens2 (stx : Syntax) (acc : Nat := 0) : Nat :=
  if acc ≥ 2 then acc else match stx with
    | .atom .. | .ident .. => acc + 1
    | .node _ _ args => args.foldl (fun n a => tokens2 a n) acc
    | _ => acc

/-- Whether `:=` comes right before byte `p`, white space between. -/
def afterAssign (bytes : ByteArray) (p : Nat) : Bool := Id.run do
  let mut i := min p bytes.size
  while i > 0 && (bytes.get! (i - 1) == 32 || bytes.get! (i - 1) == 10 || bytes.get! (i - 1) == 13 || bytes.get! (i - 1) == 9) do
    i := i - 1
  return i ≥ 2 && bytes.get! (i - 2) == 58 && bytes.get! (i - 1) == 61

/-- Whether byte `i` of the text is `.`. -/
def dotAt (bytes : ByteArray) (i : Nat) : Bool := i < bytes.size && bytes.get! i == 46

/-- Where a term that may be a proof inside a definition's body is written: its first and last
    tokens as the parser read them (a term an expansion made has no place of its own, and its
    synthetic one may span what is not it), in the body. A single token — a lemma's or a hypothesis'
    name, `rfl` — counts only as a whole value (`field := Nat.add_comm`): elsewhere it is a name,
    not the text of a proof. Nor is a part of a name: the receiver of dot notation that Lean splits
    off a written name (`DFunLike.coe_injective` of `DFunLike.coe_injective.addCommMonoid`). -/
def cutRange? (c : WalkCtx) (stx : Syntax) : Option (Nat × Nat) := do
  let .original _ a _ _ := stx.getHeadInfo | none
  let .original _ _ _ b := stx.getTailInfo | none
  let (a, b) := (a.byteIdx, b.byteIdx)
  if !(a < b && written stx && inBody c.ivs a) then none
  -- parentheses are the proof's punctuation, not the proof: from v4.35 Lean records them as a
  -- term of their own, whose cut would take them away; the term inside them is cut instead
  if stx.isOfKind ``Lean.Parser.Term.paren then none
  if stx.isIdent && ((a > 0 && dotAt c.bytes (a - 1)) || dotAt c.bytes b) then none
  if tokens2 stx < 2 && !afterAssign c.bytes a then none
  return (a, b)

partial def walkInfo (c : WalkCtx) (ctx? : Option ContextInfo) (t : InfoTree) (pos : Nat)
    (path : Array PathElt) : StateRefT InfoOut IO Unit := do
  match t with
  | .context pci t => walkInfo c (pci.mergeIntoOuter? ctx?) t pos path
  | .node info children =>
    let some ci := ctx? | return
    let env := ci.env
    let pos := (info.stx.getPos? (canonicalOnly := false)).map (·.byteIdx) |>.getD pos
    let mut path := path
    let mut cut := false
    if let .ofTermInfo ti := info then
      let r ← IO.mkRef none
      path := path.push (ci, ti, r)
      -- a term-mode proof in a definition's body, written in the text: cut from the exported text
      if !c.inCut && !ti.isBinder then
        if let some (a, b) := cutRange? c info.stx then
          let v ← try ci.runMetaM ti.lctx (do Meta.isProof (← instantiateMVars ti.expr)) catch _ => pure false
          r.set (some v)
          if v then
            modify fun s => { s with termProofs := s.termProofs.push (a, b) }
            cut := true
    -- the outermost tactic of a `by` block: a goal that is not a proposition makes it data; so for
    -- the first tactic of a block nested in another's tactics, for the cut alone
    let blk := if info matches .ofTacticInfo _ then byBlockAt c.ivs pos else none
    if let .ofTacticInfo ti := info then
      if !c.inTac || (blk.isSome && blk != c.curBy) then
        if let some g := ti.goalsBefore.head? then
          let ci' : ContextInfo := { ci with mctx := ti.mctxBefore }
          let isPrf ← try ci'.runMetaM {} (g.withContext do Meta.isProp (← instantiateMVars (← g.getType)))
            catch _ => pure true
          if !isPrf then
            if let some k := blk then
              if !c.inTac then modify fun s => { s with byData := s.byData.insert k }
              modify fun s => { s with spanData := s.spanData.insert k }
    let site : StateRefT InfoOut IO Nat := do
      let s := siteAt c.ivs (← get).byData pos
      if s != proof && (← underProof path) then return proof else return s
    let mut c' := { c with inTac := c.inTac || info matches .ofTacticInfo _, inCut := c.inCut || cut }
    if info matches .ofTacticInfo _ then c' := { c' with curBy := blk }
    let record (kind impl : Name) (stx : Syntax) : StateRefT InfoOut IO Int := do
      let s ← site
      let by_ := if written stx then -1 else c.encl
      let k := (← get).uses.size
      modify fun o => { o with uses := o.uses.push { kind, impl, site := s, pos, by_ } }
      return k
    let elabInfo? : Option ElabInfo := match info with
      | .ofTermInfo i => some i.toElabInfo
      | .ofPartialTermInfo i => some i.toElabInfo
      | .ofCommandInfo i => some i.toElabInfo
      | .ofTacticInfo i => some i.toElabInfo
      | _ => none
    if let some ei := elabInfo? then
      let k := ei.stx.getKind
      let projImpl := c.proj.has env ei.elaborator
      let projKind := c.proj.has env k
      if projImpl || projKind then
        let u ← record (if projKind then k else .anonymous) (if projImpl then ei.elaborator else .anonymous) ei.stx
        -- what the implementation's expansion holds is its own, unless it was written in the text
        if projImpl then c' := { c' with encl := u }
    if let .ofMacroExpansionInfo mi := info then
      let k := mi.stx.getKind
      if c.proj.has env k then
        -- usually the expansion of a macro whose term or command info, just above, already named it
        let same := match (← get).uses[c.encl.toNat]? with
          | some u => c.encl ≥ 0 && u.kind == k && u.pos == pos
          | none => false
        if !same then
          let u ← record k .anonymous mi.stx
          c' := { c' with encl := u }
    for ch in children do walkInfo c' ctx? ch pos path
  | .hole _ => pure ()

/-! ## Context -/

/-- A block the command sits in: what `namespace` and `section` opened, by the scopes they pushed. -/
structure Block where
  kind : String
  name : String
  line : Nat
  noncomputable_ : Bool

/-- A command that holds while its section is open: local and scoped notation, instances and
    attributes, `open scoped`, `include` and `omit`. -/
structure LocalEntry where
  depth : Nat
  line : Nat
  text : String
  in_ : Bool

def lineOf (ictx : InputContext) (pos : Nat) : Nat := (ictx.fileMap.toPosition ⟨pos⟩).line

/-- The file's text from byte `a` to `b` on one line: white space, line breaks included, as one
    space; at most `max` characters. -/
def textAt (ictx : InputContext) (a b : Nat) (max : Nat := 400) : String :=
  let s := String.Pos.Raw.extract ictx.fileMap.source ⟨a⟩ ⟨b⟩
  let (one, _) := s.foldl (init := ("", true)) fun (acc, sp) c =>
    if c == ' ' || c == '\n' || c == '\t' || c == '\r' then (acc, true)
    else ((if sp && !acc.isEmpty then acc.push ' ' else acc).push c, false)
  if one.length > max then (one.take max).toString ++ "…" else one

/-- A piece of syntax as written, on one line; as Lean prints it when it has no place in the file. -/
def textOf (ictx : InputContext) (stx : Syntax) : String :=
  match stx.getPos? (canonicalOnly := false), stx.getTailPos? (canonicalOnly := false) with
  | some a, some b => textAt ictx a.byteIdx b.byteIdx
  | _, _ => toString stx.prettyPrint

/-- Where a command's text starts once its doc comment is skipped. -/
partial def firstTokenPos? (stx : Syntax) : Option Nat :=
  match stx with
  | .atom .. | .ident .. => (stx.getPos? (canonicalOnly := false)).map (·.byteIdx)
  | .node _ k args => if k == ``Lean.Parser.Command.docComment then none else args.findSome? firstTokenPos?
  | _ => none

/-- A command as written, its doc comment left out, on one line. -/
def commandText (ictx : InputContext) (stx : Syntax) : String :=
  match firstTokenPos? stx, stx.getTailPos? (canonicalOnly := false) with
  | some a, some b => textAt ictx a b.byteIdx
  | _, _ => textOf ictx stx

def openText (o : OpenDecl) : String :=
  match o with
  | .simple ns [] => s!"open {ns}"
  | .simple ns ex => s!"open {ns} hiding {" ".intercalate (ex.map toString)}"
  | .explicit id decl =>
    if decl.getPrefix.isAnonymous then s!"open {decl}"
    else if decl.componentsRev.head? == id.componentsRev.head? && decl.getPrefix != .anonymous then
      s!"open {decl.getPrefix} ({id})"
    else s!"open {decl.getPrefix} renaming {decl.componentsRev.head?.getD .anonymous} → {id}"

/-- How many variables a `variable` binder introduces: its names, or one for an instance binder. -/
def binderVars (b : Syntax) : Nat :=
  if b.getKind == ``Lean.Parser.Term.instBinder then 1
  else max 1 b[1].getArgs.size

/-- The variables in scope as Lean elaborates them for a declaration (`runTermElabM`, auto-bound
    ones first), then which of a constant's leading binders are those: each, in order, a variable
    of the same binder kind and type, and of the same name unless it is an anonymous instance.
    The answer is the indices of the binders of `varDecls` included. A declaration's own binder of
    the same name, kind and type as a variable it did not take would be taken for it (a reading of
    names, as Lean records nothing of what it included). -/
def includedBinders (scope : Scope) (consts : Array (Name × Expr)) : CommandElabM (Array (Name × Array Nat)) := do
  if scope.varDecls.isEmpty || consts.isEmpty then return #[]
  -- binder index of each variable, in varUIds order
  let mut owner : Array Nat := #[]
  for h : i in [0:scope.varDecls.size] do
    for _ in [0:binderVars scope.varDecls[i].raw] do owner := owner.push i
  let norm (e : Expr) : Expr := e.replace fun
    | .sort _ => some (.sort .zero)
    | .const n _ => some (.const n [])
    | .mdata _ b => some b
    | _ => none
  try
    runTermElabM fun xs => do
      let off := xs.size - scope.varUIds.size
      let mut vars : Array (Name × BinderInfo × Expr × Option Nat) := #[]
      for h : k in [0:xs.size] do
        let d ← xs[k].fvarId!.getDecl
        let b := if k < off then none else owner[k - off]?
        vars := vars.push (d.userName.eraseMacroScopes, d.binderInfo, norm (← instantiateMVars d.type), b)
      let mut out := #[]
      for (c, ty) in consts do
        let mut ty := ty
        let mut subst : Array Expr := #[]
        let mut j := 0
        let mut got : Array Nat := #[]
        while true do
          let .forallE n dom b bi := ty | break
          let dom := norm (dom.instantiateRev subst)
          let n := n.eraseMacroScopes
          let mut hit : Option Nat := none
          for h : j' in [j:vars.size] do
            let (vn, vbi, vty, _) := vars[j']
            if vbi != bi then continue
            let named := !(bi.isInstImplicit && (vn.isAnonymous || vn == `inst))
            if named && vn != n then continue
            if vty == dom then hit := some j'; break
          let some j' := hit | break
          if let (_, _, _, some bi) := vars[j']! then
            if !got.contains bi then got := got.push bi
          subst := subst.push xs[j']!
          j := j' + 1
          ty := b
        if !got.isEmpty then out := out.push (c, got)
      return out
  catch _ => return #[]

/-! ## One module -/

structure RunState where
  st : Command.State
  proj : Project
  baseOpts : Options
  /-- options this program sets for itself, not the module's: never shown as its context -/
  ownOpts : Options
  blocks : Array Block := #[]
  locals : Array LocalEntry := #[]
  /-- what put each piece of the scope there: the line of the command, and whether it was `… in` -/
  intro : Std.HashMap String (Nat × Bool) := {}
  /-- inside the `section` a `c₁ in c₂` runs in: what is introduced holds for `c₂` alone -/
  inIn : Bool := false
  contexts : Array Json := #[]
  ctxIdx : Std.HashMap String Nat := {}
  cmds : Array Json := #[]
  errors : Array Json := #[]
  elabMs : Float := 0
  templates : Templates
  /-- the file's text, as bytes -/
  bytes : ByteArray := .empty

abbrev RunM := StateRefT RunState IO

def nowMs : IO Float := return (← IO.monoNanosNow).toFloat / 1e6

def isHashCmd (stx : Syntax) : Bool := (firstAtom stx).startsWith "#"

/-- The keys of a scope's pieces, by which `RunState.intro` remembers where each was put. -/
def scopeKeys (s : Scope) (baseOpts ownOpts : Options) : Array String := Id.run do
  let mut out := #[]
  for o in s.openDecls do out := out.push s!"open {openText o}"
  for u in s.levelNames do out := out.push s!"univ {u}"
  for (k, v) in s.opts do
    if baseOpts.find? k != some v && ownOpts.find? k != some v then out := out.push s!"opt {k} {v}"
  return out

/-- The context a command is written in, from the scope before it (shared/scope.ts, FileContext). -/
def contextJson (ictx : InputContext) (rs : RunState) (blocks : Array Block) (locals : Array LocalEntry)
    (s : Scope) : Json := Id.run do
  let intro (key : String) : List (String × Json) :=
    match rs.intro[key]? with
    | some (l, inn) => [("line", toJson l)] ++ (if inn then [("in", Json.bool true)] else [])
    | none => [("line", toJson 0)]
  let cmd (key text : String) : Json := Json.mkObj (intro key ++ [("text", toJson text)])
  -- `namespace A.B` opens a scope for each part, all on its line: one block, as written
  let mut merged : Array Block := #[]
  for b in blocks do
    match merged.back? with
    | some p =>
      if p.kind == "namespace" && b.kind == "namespace" && p.line == b.line then
        merged := merged.pop.push { p with name := p.name ++ "." ++ b.name }
      else merged := merged.push b
    | none => merged := merged.push b
  let mut blocksJ : Array Json := #[]
  for b in merged do
    blocksJ := blocksJ.push <| Json.mkObj <|
      [("kind", toJson b.kind), ("name", if b.name.isEmpty then Json.null else toJson b.name),
       ("line", toJson b.line)] ++ (if b.noncomputable_ then [("noncomputable", Json.bool true)] else [])
  let opens := s.openDecls.reverse.toArray.map fun o =>
    let ns := match o with | .simple ns _ => ns | .explicit _ d => d.getPrefix
    let t := openText o
    Json.mkObj (intro s!"open {t}" ++ [("text", toJson t), ("namespaces", toJson #[ns.toString])])
  let mut vars : Array Json := #[]
  let mut uid := 0
  for b in s.varDecls do
    let n := binderVars b.raw
    let names := (s.varUIds.extract uid (uid + n)).toList.filterMap fun x =>
      let v := x.eraseMacroScopes
      if v.isAnonymous then none else some (toJson v.toString)
    uid := uid + n
    let pos := (b.raw.getPos? (canonicalOnly := false)).map (·.byteIdx)
    let line := pos.map (lineOf ictx) |>.getD 0
    let inn : Bool := match pos with
      | some p => (rs.intro[s!"var {p}"]?.map (·.2)).getD false
      | none => false
    vars := vars.push <| Json.mkObj <|
      [("line", toJson line), ("text", toJson (textOf ictx b.raw)), ("binds", Json.arr names.toArray)]
        ++ (if inn then [("in", Json.bool true)] else [])
  let univs := s.levelNames.reverse.toArray.map fun u => cmd s!"univ {u}" u.toString
  let mut opts : Array Json := #[]
  for (k, v) in s.opts do
    if rs.baseOpts.find? k != some v && rs.ownOpts.find? k != some v then
      opts := opts.push (cmd s!"opt {k} {v}" s!"{k} {v}")
  let mut local_ : Array Json := locals.map fun l =>
    Json.mkObj ([("line", toJson l.line), ("text", toJson l.text)] ++ (if l.in_ then [("in", Json.bool true)] else []))
  let ns := s.currNamespace
  return Json.mkObj [
    ("namespace", toJson (if ns.isAnonymous then "" else ns.toString)),
    ("blocks", Json.arr blocksJ), ("opens", Json.arr opens), ("variables", Json.arr vars),
    ("universes", Json.arr univs), ("options", Json.arr opts), ("local", Json.arr local_)]

/-- After a command: the blocks it opened or closed, and where each new piece of the scope came
    from. -/
def noteScope (ictx : InputContext) (before : List Scope) (line : Nat) (stx : Syntax) : RunM Unit := do
  let rs ← get
  let after := rs.st.scopes
  let mut blocks := rs.blocks
  -- `end` pops, `namespace` and `section` push; `namespace A.B` pushes two scopes on one line
  while blocks.size + 1 > after.length do blocks := blocks.pop
  if after.length > before.length then
    let fresh := (after.take (after.length - before.length)).reverse
    let mut parent := before.head!
    for s in fresh do
      let isNs := s.currNamespace != parent.currNamespace
      blocks := blocks.push { kind := if isNs then "namespace" else "section", name := s.header, line,
                              noncomputable_ := s.isNoncomputable && !parent.isNoncomputable }
      parent := s
  let bScope := before.head!
  let aScope := after.head!
  let old : Std.HashSet String := Std.HashSet.ofArray (scopeKeys bScope rs.baseOpts rs.ownOpts)
  let mut intro := rs.intro
  for k in scopeKeys aScope rs.baseOpts rs.ownOpts do
    if !old.contains k then intro := intro.insert k (line, rs.inIn)
  for b in aScope.varDecls do
    if let some p := b.raw.getPos? (canonicalOnly := false) then
      let k := s!"var {p.byteIdx}"
      if !intro.contains k then intro := intro.insert k (line, rs.inIn)
  -- local and scoped commands hold while the scope they were written in is open
  let mut locals := rs.locals.filter (·.depth ≤ after.length)
  let isOpenScoped := stx.getKind == ``Lean.Parser.Command.open && (firstKind? stx ``Lean.Parser.Command.openScoped).isSome
  -- `include` and `omit` as written: the scope keeps only the variables' internal names, and an
  -- instance binder has none
  let isInclude := stx.getKind == ``Lean.Parser.Command.«include» || stx.getKind == ``Lean.Parser.Command.«omit»
  if (localKind? stx).isSome || isOpenScoped || isInclude then
    locals := locals.push { depth := after.length, line, text := commandText ictx stx, in_ := rs.inIn }
  set { rs with blocks, intro, locals }

/-- Suffixes of constants the compiler generates next to a declaration (as Extract.lean has them):
    never a unit, nor folded into one by name. -/
def generatedSuffixes : List String :=
  ["recOn", "casesOn", "noConfusion", "noConfusionType", "ctorElim", "ctorElimType", "below",
   "brecOn", "binductionOn", "ibelow", "ctorIdx", "toCtorIdx", "ofNat", "ofNat_ctorIdx",
   "sizeOf_spec", "injEq", "inj", "eq_def", "induct", "mutual_induct", "fun_cases",
   "induct_unfolding", "ext_iff", "congr_simp", "elim"]

/-- The constants a command declared that a unit can be made of: the declarations it writes and
    those Lean generates from it under names of their own (what a declaring macro writes), and the
    `_aux_` declarations of a syntax extension. Constructors, recursors, projections, matchers and
    the like are left out: they fold into their type, as Extract.lean has it. User names. -/
def newConsts (env0 env1 : Environment) : Array Name :=
  env1.constants.map₂.foldl (init := #[]) fun acc n ci =>
    if env0.contains n then acc else
    let u := userName n
    let last := match u with | .str _ s => s | _ => ""
    let keep :=
      if u.hasMacroScopes then false
      else if last.startsWith "_aux_" then true
      else if u.isInternalDetail || generatedSuffixes.contains last then false
      else !(ci matches .ctorInfo _ || ci matches .recInfo _ || isAuxRecursor env1 n || isNoConfusion env1 n
             || Meta.isMatcherCore env1 n || (env1.getProjectionFnInfo? n).isSome)
    if keep then acc.push n else acc

/-- Spans [start, end) sorted, those that overlap or touch made one. -/
def mergeSpans (xs : Array (Nat × Nat)) : Array (Nat × Nat) := Id.run do
  let mut out : Array (Nat × Nat) := #[]
  for (a, b) in xs.qsort (fun x y => x.1 < y.1 || (x.1 == y.1 && x.2 > y.2)) do
    match out.back? with
    | some (a', b') => if a ≤ b' then out := out.pop.push (a', max b b') else out := out.push (a, b)
    | none => out := out.push (a, b)
  return out

def errorsOf (msgs : MessageLog) : IO (Array String) := do
  let mut out := #[]
  for m in msgs.toList do
    if m.severity == .error then
      let s ← m.data.toString
      out := out.push (s.take 300).toString
  return out

partial def processCmd (ictx : InputContext) (stx : Syntax) (record : Bool := true) : RunM Unit := do
  let k := stx.getKind
  let pos := (stx.getPos?.map (·.byteIdx)).getD 0
  let line := lineOf ictx pos
  -- `c₁ in c₂`: as Lean does, `section c₁ c₂ end`, with c₂ recorded with its context
  if k == ``Lean.Parser.Command.in then
    let run (x : CommandElabM Unit) : RunM Unit := do
      let s ← get
      let (_, st) ← liftCmd ictx s.st x pos
      set { s with st }
    let before := (← get).st.scopes
    run (do elabCommand (← `(command| section)))
    -- the inner section is no block of the context: what it holds is marked `in` instead
    let blocks := (← get).blocks
    let wasIn := (← get).inIn
    modify fun s => { s with inIn := true }
    processCmd ictx stx[0] (record := false)
    modify fun s => { s with inIn := wasIn }
    processCmd ictx stx[2] record
    run (do elabCommand (← `(command| end)))
    modify fun s => { s with blocks, locals := s.locals.filter (·.depth ≤ before.length) }
    return
  if isHashCmd stx then return
  let s ← get
  let scope := s.st.scopes.head!
  let before := s.st.scopes
  let (blocks0, locals0) := (s.blocks, s.locals)
  let isExt := extCmdKinds.contains k
  let ((), po) := (walkStx stx (.site stmt) false).run {}
  let cmd := if isExt then stx else strip s.templates stx false
  let env0 := s.st.env
  let st0 := { s.st with messages := {}, infoState := { enabled := true, trees := {} } }
  let t0 ← nowMs
  let (_, st1) ← liftCmd ictx st0 (elabCommandTopLevel cmd) pos
  let t1 ← nowMs
  let errs ← errorsOf st1.messages
  -- the scope after it, the messages as they were (this program reports its own)
  set { s with st := { st1 with messages := s.st.messages, infoState := { enabled := false } },
               elabMs := s.elabMs + (t1 - t0) }
  if !errs.isEmpty then
    modify fun r => { r with errors := r.errors.push (Json.mkObj [("line", toJson line), ("message", toJson errs[0]!)]) }
  noteScope ictx before line stx
  if !record then return
  let env := st1.env
  let proj := s.proj
  -- what ran, from the info trees
  let wc : WalkCtx := { proj, ivs := po.ivs, bytes := s.bytes }
  let ((), io) ← (st1.infoState.trees.toArray.forM fun tr => walkInfo wc none tr pos #[]).run {}
  -- the kinds parsed in the text: where one also ran, its site is the one elaboration found (a
  -- term that is a proof inside a definition's value)
  let mut ranAt : Std.HashMap (Name × Nat) Nat := {}
  for u in io.uses do
    if !u.kind.isAnonymous then ranAt := ranAt.insert (u.kind, u.pos) u.site
  let mut uses : Array Use := #[]
  for (kd, p) in po.kinds do
    if proj.has env kd then
      let site := ranAt[(kd, p)]?.getD (siteAt po.ivs io.byData p)
      uses := uses.push { kind := kd, impl := .anonymous, site, pos := p, by_ := -1 }
  let base := uses.size
  for u in io.uses do
    uses := uses.push { u with by_ := if u.by_ < 0 then -1 else u.by_ + base }
  let consts := newConsts env0 env
  if consts.isEmpty && uses.isEmpty then return
  -- the same use twice is one: by kind, implementation, site, line and emitter
  let mut seen : Std.HashMap String Nat := {}
  let mut keep : Array Json := #[]
  let mut remap : Array Int := #[]
  for u in uses do
    let p := ictx.fileMap.toPosition ⟨u.pos⟩
    let emitter : Int := if u.by_ < 0 then -1 else (remap[u.by_.toNat]?.getD (-1))
    let key := s!"{u.kind}|{u.impl}|{u.site}|{p.line}|{p.column}|{emitter}"
    match seen[key]? with
    | some i => remap := remap.push i
    | none =>
      seen := seen.insert key keep.size
      remap := remap.push keep.size
      keep := keep.push (Json.arr #[toJson (nameStr u.kind), toJson (nameStr u.impl), toJson u.site,
        toJson p.line, toJson p.column, toJson emitter])
  -- the context, shared between the commands written in the same one
  let rs ← get
  let cj := contextJson ictx rs blocks0 locals0 scope
  let ckey := cj.compress
  let ci ← match rs.ctxIdx[ckey]? with
    | some i => pure i
    | none => do
      modify fun r => { r with contexts := r.contexts.push cj, ctxIdx := r.ctxIdx.insert ckey r.contexts.size }
      pure rs.contexts.size
  -- the variables each constant took
  let typed := consts.filterMap fun c => (env.find? c).map fun info => (c, info.type)
  let incl ← if scope.varDecls.isEmpty then pure #[] else do
    let stScope := { st0 with env, messages := {}, infoState := { enabled := false } }
    let (r, _) ← (liftCmd ictx stScope (includedBinders scope typed) pos : IO _)
    pure r
  let tail := (stx.getTailPos?.map (·.byteIdx)).getD pos
  -- the proofs inside its definitions' bodies: `by` blocks whose goal is a proposition, the tactics
  -- of `decreasing_by`, term-mode proofs written in the text; never in a signature, nor in a
  -- quotation; nested and overlapping ones merged
  let mut spans : Array (Nat × Nat) := po.decr ++ io.termProofs
  for b in po.bys do
    if b.outer == body && !b.quot && !io.spanData.contains b.k then spans := spans.push (b.s, b.e)
  let proofs := (mergeSpans spans).map fun (a, b) =>
    let p := ictx.fileMap.toPosition ⟨a⟩
    let q := ictx.fileMap.toPosition ⟨b⟩
    Json.arr #[toJson p.line, toJson p.column, toJson q.line, toJson q.column]
  let j := Json.mkObj <| [
    ("line", toJson line), ("endLine", toJson (lineOf ictx tail)),
    ("consts", toJson (consts.map nameStr)), ("ctx", toJson ci),
    ("incl", Json.mkObj (incl.toList.map fun (c, bs) => (nameStr c, toJson bs))),
    ("uses", Json.arr keep)] ++ (if proofs.isEmpty then [] else [("proofs", Json.arr proofs)])
  modify fun r => { r with cmds := r.cmds.push j }

def run (src : FilePath) (mod : Name) (out : FilePath) (projectMods : Std.HashSet Name)
    (opts : Options) : IO Unit := do
  let t0 ← nowMs
  let input ← IO.FS.readFile src
  let ictx := Parser.mkInputContext input src.toString
  let (header, pstate, msgs) ← Parser.parseHeader ictx
  let (env, msgs) ← Elab.processHeader header opts msgs ictx (trustLevel := 1024) (mainModule := mod)
  if msgs.hasErrors then
    let es ← errorsOf msgs
    throw (IO.userError s!"the imports of {mod} could not be loaded: {"; ".intercalate es.toList}")
  let tImp ← nowMs
  -- the options as Lake gave them, parsed now that what declares them is imported
  let baseOpts ← Language.Lean.reparseOptions opts
  -- this program's own: no parallel elaboration, which would leave the info trees unfinished; no
  -- linters, which cost time and say nothing of what a command means
  let ownOpts : Options := ({} : Options) |>.setBool `Elab.async false |>.setBool `linter.all false
  let runOpts := baseOpts |>.setBool `Elab.async false |>.setBool `linter.all false
  let mask := env.header.moduleNames.map (projectMods.contains ·)
  let rs : RunState := {
    st := Command.mkState env {} runOpts, proj := { mask }, baseOpts, ownOpts,
    templates := ← mkTemplates env, bytes := input.toUTF8 }
  let ((), rs) ← (show RunM Unit from do
    let mut ps := pstate
    repeat
      let s ← get
      let scope := s.st.scopes.head!
      let pmctx : ParserModuleContext :=
        { env := s.st.env, options := scope.opts, currNamespace := scope.currNamespace, openDecls := scope.openDecls }
      let (cmd, ps', _) := Parser.parseCommand ictx pmctx ps {}
      ps := ps'
      if isTerminalCommand cmd then break
      try processCmd ictx cmd
      catch e =>
        let line := lineOf ictx ((cmd.getPos?.map (·.byteIdx)).getD 0)
        modify fun r => { r with errors := r.errors.push (Json.mkObj [("line", toJson line), ("message", toJson (toString e))]) }).run rs
  let tEnd ← nowMs
  let doc := Json.mkObj [
    ("module", toJson mod.toString),
    ("ms", Json.mkObj [("import", toJson (tImp - t0).round), ("elab", toJson rs.elabMs.round),
                       ("total", toJson (tEnd - t0).round)]),
    ("errors", Json.arr rs.errors), ("contexts", Json.arr rs.contexts), ("cmds", Json.arr rs.cmds)]
  IO.FS.writeFile out doc.compress

end VisualProof.Usage

open VisualProof.Usage in
unsafe def main (args : List String) : IO UInt32 := do
  let (dashD, pos) := args.partition (·.startsWith "-D")
  match pos with
  | [src, mod, out, modsFile] =>
    -- as `lean -Dname=value` gives them: strings, parsed once their declarations are imported
    let mut opts : Options := {}
    for d in dashD do
      match (d.drop 2).toString.splitOn "=" with
      | name :: rest@(_ :: _) => opts := opts.insert name.toName (.ofString ("=".intercalate rest))
      | _ => IO.eprintln s!"vp-usage: ignored {d}"
    initSearchPath (← findSysroot)
    Lean.enableInitializersExecution
    let mods := (← IO.FS.lines modsFile).filter (!·.isEmpty) |>.map String.toName
    try
      run src mod.toName out (Std.HashSet.ofArray mods) opts
      return 0
    catch e =>
      IO.eprintln s!"vp-usage: {e}"
      return 1
  | _ =>
    IO.eprintln "usage: vp-usage <source.lean> <Module> <out.json> <project-modules.txt> [-Dname=value]..."
    return 2
