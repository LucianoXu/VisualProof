# Targets and their TCB

Targets, the members of a target's TCB that need review, its key declarations, why something is in
a TCB, and references (`uses`, `users`): any level. Then marking targets and keys, and trust (needs
full). Terms: [Words](words.md). MCP: `review` (`targets`, `tcb`, `keys`, `why`); `refs` (`uses`,
`users`); `mark` (`target`, `key`); `trust`.

## `GET /api/agent/targets`

```json
{"targets": [{"name": "Hilbert91", "markedBy": "Bob", "at": "…", "inGraph": true,
   "counts": {"needReview": 16, "approved": 1, "commented": 0, "stale": 0, "unreviewed": 15,
              "advised": 2, "agentComments": 0, "advisedByYou": 2,
              "key": {"total": 4, "approved": 1, "commented": 0, "stale": 0, "unreviewed": 3, "trusted": 0}}},
  {"name": "FltRegular.caseI", "markedBy": "Alice's AI", "markedByAgent": true, …}, …]}
```

`approved` … `unreviewed`: people's statuses, summing to `needReview`. `advised`, `agentComments`,
`advisedByYou`: agents' advice on present versions, counted apart. `key`: the second level of
progress, the key declarations needing review (the target among them), `trusted` the others.

## `GET /api/agent/tcb?target=&include=&todo=&key=&offset=&limit=`

The members of `target`'s TCB that need review, in review order; any declaration may be the target
(`isTarget`: whether it is marked). `limit` 1–500, default 50; `next`: the next `offset`, null at
the end.

| parameter | effect |
|---|---|
| `todo=1` | only members you have not advised on in their present version (to resume a pre-review); with `include=review` only; 400 if you do not say who you are |
| `key=first`, `key=only` | key declarations first, then the rest; or alone (the review list's ◆ Key); trusted keys first (`trusted: true`), then review order |
| `include` | `review` (default); `trusted`: the trusted members; `all`: those needing review, then the trusted, `position` counting within each |

```json
{"target": "Hilbert91", "isTarget": true, "order": "review: …", "counts": {"needReview": 16, …},
 "trustedNotCounted": 195, "axioms": [], "include": "review", "offset": 0, "limit": 50, "total": 16, "next": null,
 "members": [{"position": 2, "name": "RelativeUnits", "kind": "def", "module": "…", "key": true,
              "status": "approved", "advice": [], "youAdvised": false},
             {"position": 7, …, "advice": [{"by": "Claude", "verdict": "approve"}], "youAdvised": true}, …]}
```

- `position`: place in the whole review order (also with `todo`, `key`; a trusted one's, in the
  trusted list); `total`: what the filter keeps. The target comes last.
- No "next to review", for people or agents: the review set is read as a list.
- `axioms`: every non-standard axiom the target rests on, through statements, bodies or proofs,
  as `#print axioms` finds them (`sorryAx` included); each `{name, inGraph, status, usedIn}`,
  `usedIn` its users. They need review whatever
  is trusted, come first, count in `needReview`; `why` answers `inTcb: false, inReview: true` and
  `usedIn` for them.
- `include=trusted`: each member's `trustedBy`, the prefixes covering it (`"@external"`: the whole
  outside world) or `"standard axiom"`; the project's own first, then by prefix, then by name.
  `trusted` sums them: `{project, external, byPrefix: {"Init": 6, …}}`.

## `GET /api/agent/keys?target=&members=`

A target's key declarations top-down: the target, then each a layer below every key declaration
resting on it (within a layer, later in review order first). Each with `doc`, `restsOn` (the key
declarations it rests on directly), its `support` (members needing review it reaches through
non-key members) by status, and `status` or, trusted, `trustedBy`; plus the key graph's `edges`.
`members=0`: support counts only, no names.

```json
{"target": "Hilbert91", "isTarget": true, "order": "top-down: …", "note": "…",
 "counts": {"key": {"total": 4, "approved": 1, …}, "all": {"total": 16, …}, "offBoardAxioms": 0},
 "keys": [{"name": "Hilbert91", "target": true, "status": "none", "doc": null, "restsOn": ["RelativeUnits", …], …},
   {"name": "systemOfUnits.IsFundamental", "kind": "def", "markedBy": "Alice", "markedAt": "…", "restsOn": ["systemOfUnits"],
    "support": {"total": 5, "unreviewed": 5, …, "members": ["CyclotomicIntegers", …]}, …}, …],
 "edges": [["systemOfUnits.IsFundamental", "systemOfUnits"], …], "viaProof": []}
```

`viaProof`: non-standard axioms the target rests on through proofs alone (no statement or body
reaches them), part of its support. `marksOutsideTcb`, when any: marks on what left the TCB, kept,
counted for nothing.

## `GET /api/agent/why?target=&name=`

The shortest chain of statement and body references from the target to the declaration.

```json
{"target": "Hilbert91", "name": "CyclotomicIntegers", "inTcb": true,
 "chain": [{"name": "Hilbert91", "kind": "theorem", "module": "…"},
   {"name": "relativeUnitsModule", "kind": "instance", …, "usedIn": "the statement of Hilbert91"},
   {"name": "CyclotomicIntegers", …, "usedIn": "the statement of relativeUnitsModule"}],
 "reviewPosition": {"position": 1, "of": 16}}
```

`inTcb: false`, `chain` null: nothing in the statement, nor in the body of a definition it reaches,
refers to it.

## `GET /api/agent/uses?name=&where=&offset=&limit=` and `GET /api/agent/users?…`

`uses`: what the declaration refers to by name; `users`: what refers to it. Each reference with
`where` it sits (in the declaration for `uses`, in the user for `users`): `statement`, `body`,
`proof`, or `grammar` (syntax that only declares grammar). Order: statement, body, then proof and
grammar; the project before the outside world; then name. `where=statement|body|proof|grammar`
filters; `counts` cover all (statement, body, proof; grammar only in `total`). `limit` 1–1000,
default 100; `next`: the next `offset`. A folded name counts as its owner; references to itself are
left out.

```json
{"name": "flt_regular", "direction": "uses", "note": "…", "offset": 0, "limit": 4, "total": 65, "next": 4,
 "counts": {"total": 65, "statement": 8, "body": 0, "proof": 65, "project": 3, "external": 62, "trusted": 62},
 "refs": [{"name": "Fact", "kind": "class", "module": "Mathlib.Logic.Basic", "external": true,
           "where": ["statement", "proof"], "trusted": true, "trustedBy": ["Mathlib"]}, …]}
```

**Notation** in `uses`: units of `kind: notation` (with `display`). The macro or elaborator that ran
on the text is at `statement` or `body`; the syntax the text parses with (helper syntax a parent
notation consumes included) at `where: ["grammar"]`, `grammar: true`, outside the TCB. Notation used
only in proofs: `where: ["proof"]`, not in the TCB. `where=grammar` lists just the grammar. A
rule's `uses`: the syntax it interprets (grammar), the meta code it calls, the notation its
expansion emits.

## Marking targets and keys, and trust (level full)

At level full you do what a person can in the page; below it, 403 naming the level. Each is
checked as the page's requests are and recorded under your name in your review log, `"agent":
true`, marked in the timeline.

Names resolve as everywhere (`didYouMean`, folded names); `on` defaults to true. `changed` says
whether anything did (`recorded`: the event written); where it was so already, nothing is.

| request | what |
|---|---|
| `POST /api/agent/target {name, on}` | mark a project declaration as a target (☆ Target) or take it off. Marking makes no view: `view` (its linked view) is `null` after marking; `next`: the request that puts you on its view, a temporary view of its TCB where it has none. Taken off, its view (if any) stays, unlinked; marked again, nothing relinks it |
| `POST /api/agent/key {target, name, on}` or `{target, names: […], on}` | mark or unmark key declarations of a target's TCB, trusted ones too; `names` up to 100, each answered on its own (`results`, with `status`). 409 if `target` is not a target, or the name not in its TCB; the target is always key (400) |
| `POST /api/agent/trust {prefix, on}` | trust without review, or stop trusting (a default too): a module or namespace, a whole dotted component, or `@external` (everything outside the project). Answers `covers` (`{project, outside}`) and `trusted`, the list after |

```json
{"ok": true, "changed": true,
 "recorded": {"op": "target", "at": "…", "by": "Alice's AI", "name": "FltRegular.caseI", "on": true, "agent": true},
 "view": null, "next": "POST /api/agent/view {\"review\": \"FltRegular.caseI\"} puts you on its view …"}
```

Views, pins and undoing a layout: [Views](views.md).
