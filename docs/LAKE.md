# What Lake leaves behind

VisualProof never runs Lake; it reads what the owner's builds leave in `.lake/build/lib/lean`.
Observed on Lake 4.33.1 with a scratch copy of `test/fixture` (2026-10-06).

| Event | `Foo.olean` | `Foo.trace` | Downstream modules |
|---|---|---|---|
| successful build | written | written; `log` keeps warnings, `inputs` the source hash | rebuilt |
| build with `sorry` | written | `log` has `declaration uses 'sorry'` at level `warning` | rebuilt |
| failed build | **deleted** | **left as it was** (the last success) | not rebuilt, keep their old `.olean` |

- The error text of a failed build is printed and stored nowhere.
- There is no build lock (the only lock guards `lakefile.olean`). A compile in progress is visible
  as a process `lean <src> -o <libDir>/Foo.olean …`; the trace's first log line records that same
  command.
- Lake decides a rebuild by content hash, not mtime. The source hash in `inputs` is
  `Hash.ofText`: line endings normalised to LF, then `mixHash 1723 (String.hash s)`, where
  `String.hash` is MurmurHash64A with seed 11 and `mixHash` is `lean_uint64_mix_hash` from
  `lean.h`. `server/status.ts` reproduces it (checked against a real trace).

Consequences for the status shown:

- missing `.olean` with a trace present, and no compile running: the last build of that file failed;
- modules importing a failed one: blocked, showing their previous build;
- source hash differs from the traced one: stale; everything importing it is stale too;
- a `lean -o` process for the file: building.
