# Advice and the pre-review

Advice (one or many at once), the comment format, and a pre-review's steps.

## `POST /api/agent/opinion` (needs advise)

```json
{ "name": "MyProject.Example.halve", "verdict": "comment",
  "comment": "The docstring says it rounds down, but the body adds 1 before dividing by 2: halve 3 = 2." }
→ { "ok": true, "recorded": { "name": "…", "verdict": "comment", …, "hash": "…", "judged": "source" },
    "counted": false, … }
```

- `verdict`: `approve` or `comment`; `comment`, required for a comment: ≤ 10,000 characters, kept
  as written (format below).
- Judge what a declaration says, never a proof: for `theorem main : Claim n` the claim is spelled
  out in `Claim` — advise on it, and on the theorem whether it states the claim as it should.
- Your later opinion on a declaration replaces your earlier one (all stay in the file).
- `judged`: `source` (its context, a blank line, the source, as `GET source` gives them:
  [reading](reading.md)), or `statement` where there is no source.
- A folded name is advised as its declaration: `recorded.name` is that, with `asked`, `foldedInto`.
- 409: file changed since compiled, or a line of your review log unreadable.
- `{"opinions": […]}` instead: answered exactly as `POST opinions`.

MCP: `opinion` (`name`, `verdict`, `comment`; or `opinions: […]`).

## `POST /api/agent/opinions` (needs advise)

`{"opinions": [{name, verdict, comment}, …]}`, up to 100. Each is checked and recorded as by
`POST opinion` and answered on its own: one refused (unknown name, comment without text, file
changed) refuses nothing else. 200 when the batch could be read:

```json
{ "ok": true, "recorded": 1, "refused": 3, "counted": false, "note": "…",
  "results": [ { "index": 0, "name": "relativeUnitsWithGenerator", "status": 200, "recorded": { … } },
    { "index": 1, "name": "relativeUnitsWithGeneratr", "status": 404, "error": "…", "hint": "…",
      "didYouMean": [ "relativeUnitsWithGenerator" ] }, … ] }
```

## Comments: the format

A comment (people's or yours) is plain text, read back as written (`declaration`, `declarations`,
`activity`); the page renders light Markdown:

- paragraphs (line breaks kept), quotes (`> `), `code`, fenced code (```` ```lean ```` highlighted),
  `**bold**`, `*italics*`. Nothing else: HTML shows as text, and so does a link `[text](url)` of any
  scheme but the two below;
- a full name in backticks links to the declaration; a short name only where it names one in the
  namespaces around the declaration commented on; never in fenced code;
- **a quote of an opinion**: a quote whose first line links to it (as the page's Quote writes it;
  a click goes there):

  ```
  > [**Alice** (2026-10-09)](opinion:MyProject.Example.halve#Alice@2026-10-09T08:12:30.123Z):
  > The docstring says it rounds down.

  Your reply.
  ```

  `opinion:<declaration>#<by>@<at>`, `by` and `at` exactly as a read gives them;
- **a quote of source lines**: a fenced Lean block under a header linking to lines (from 1) of the
  declaration's file (a click opens the source there):

  ````
  [MyProject/Example.lean:12–13](source:MyProject.Example.halve#L12-L13)
  ```lean
  def halve (n : Nat) : Nat :=
    (n + 1) / 2
  ```
  ````

  `source:<declaration>#L<from>-L<to>` (`#L<from>` for one line).

In a reference, percent-encode only what would end the link or the part: whitespace, `(`, `)`,
`[`, `]`, `#`, `@`, `%`, `<`, `>`, quotes, backslash, backtick (`Ann%20Lee`); the rest, Unicode
included, as is.

## A pre-review of a target's TCB

Paths are under `/api/agent`.

1. `GET /api/agent` — check your level (`you.may.advise`).
2. `GET targets` — pick a target; note its counts.
3. `POST view {"review": "<target>"}` — you are on its view, which followers see (`reviewView`;
   `temporary` for a target with none; [following](following.md)).
4. `GET tcb?target=<t>&include=trusted` — what the TCB rests on without review, and which prefix
   trusts it (a project layer trusted by name first).
5. `GET keys?target=<t>` — the key declarations and what each rests on;
   `GET tcb?target=<t>&todo=1&key=first&limit=50` — what you have not advised on yet, key
   declarations first, each bottom-up; page with `offset` / `next` ([tcb](tcb.md)).
6. For each member, in order (or several with `declarations?names=…`):
   - `POST view {"sel": "<name>", "source": true}`;
   - `GET declaration?name=…&include=source,context,uses` — statement, doc, axioms, opinions,
     source, context, references ([reading](reading.md));
   - `GET print?name=…` where the text hides what Lean made of it (a macro's output, a Prop-valued
     definition's proposition, auto-bound arguments); `describe` or `print` for a folded or an
     external name; `GET why` when it is unclear why it matters;
   - `POST opinion` — `approve` with reasons, or `comment` saying exactly what is wrong or unclear
     (a wrong direction, an off-by-one, a missing hypothesis, a definition not saying what its name
     and docstring claim); `POST opinions` for several;
   - a `nonStandardAxioms` entry (e.g. `sorryAx`) is worth a note.
7. `POST note` ([notes](notes.md)) for what is not one declaration's fault: on the target's view
   (`GET views`: its `targets` name it) beside where to start, or a note of the project there.
8. `GET tcb?target=<t>` — `counts.agentComments`: what people will start with.
9. `POST view {"leave": true}`.

Your advice never changes the counts; people see your comments first and decide
([following](following.md)).
