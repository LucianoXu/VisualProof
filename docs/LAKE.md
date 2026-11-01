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

## A build restored from Lake's artifact cache

With `enableArtifactCache` (and `restoreAllArtifacts`, which copies the artifacts into the build
folder), `lake build` takes a module's outputs from Lake's cache when its input hash — the source's
hash mixed with its imports', its options, the toolchain's — is there, filled by `lake cache get`
(Physlib's `lake exe get_cache`) or by an earlier build. Its trace then records the outputs and that
input hash (`depHash`), and nothing else (read in Lake 4.28 to 4.35: `BuildMetadata.ofFetch`,
`Module.unpackLtar`; checked on the fixture at both ends and on Physlib at `a8823c7`):

| How it was restored | The trace |
|---|---|
| from the local cache (`ofFetch`) | `{"schemaVersion": "2025-09-10", "depHash", "inputs": [], "outputs", "log": [], "synthetic": true}` |
| from a cache's `.ltar` (`lake cache get`) | `{"schemaVersion": "2025-09-10", "depHash", "outputs", "log"}`, the log the build that made it left (`leantar` 0.1.19 and 0.1.20 keep these alone; since 4.33 the archive has no `depHash`, `-s`, and Lake writes the input hash in) |

No source hash; from the local cache, no log either (its warnings, `sorry`). The input hash cannot be taken apart, and making it
again means doing all Lake does. What Lake does record is when it checked: it writes the trace once it
has hashed the source into the input hash the outputs were found under. So `server/status.ts`
(`compiledFrom`) counts a restored module as compiled from its source while the source has not been
modified since its trace was written, and, modified, while it is a text the server saw compiled under
the same trace (a file saved or checked out again unchanged: Lake, finding the same input hash, leaves
the trace as it is). Otherwise nothing is claimed: the file is out of date, the usage pass skips it,
an opinion on it is refused, its text is not kept, until a build compiles it and its trace records the
source again. A file edited while `lake build` restores it can carry an earlier time than the trace:
Lake itself sees that only at the next build. Without `restoreAllArtifacts` the build folder holds
no `.olean` at all, and VisualProof cannot read the build.

Consequences for the status shown:

- missing `.olean` with a trace present, and no compile running: the last build of that file failed;
- modules importing a failed one: blocked, showing their previous build;
- source hash differs from the traced one: stale; everything importing it is stale too;
- a restored module's source modified since its trace, not seen compiled before: stale;
- a `lean -o` process for the file: building.
