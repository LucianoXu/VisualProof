// A unit's version follows its body wherever Lean compiled it to (TCBSpec decision 3): a recursive
// definition's body is in what Lean generates beside it — structural recursion's `_f`, well-founded
// recursion's `_unary` or `_mutual`, a `partial def`'s `_unsafe_rec` — not in its own value, and an
// opinion on it must go stale when that body changes. Needs lake.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { RawGraph } from "../src/shared/graph.ts";
import { copyFixture, extractor } from "./fixturecopy.ts";

/** the extractor, compiled as the server runs it (test/fixturecopy.ts) */
const EXTRACT = await extractor();

let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}

let dir = "";
let before_: Map<string, string> = new Map();
let after_: Map<string, string> = new Map();

/** Each unit's version as the extractor gives it: its content hash and its shape. */
function versions(): Map<string, string> {
  execFileSync("lake", ["build", "Fixture.Kinds"], { cwd: dir, stdio: "ignore" });
  const out = join(dir, "graph.json");
  execFileSync("lake", ["env", ...EXTRACT, out, join(dir, ".lake/build/lib/lean"), "Fixture.Kinds"], {
    cwd: dir,
    stdio: "ignore",
  });
  const g: RawGraph = JSON.parse(readFileSync(out, "utf8"));
  return new Map(g.nodes.map((n) => [n.name, `${n.hash}/${n.shape}`]));
}

/** One edit to the fixture's source, which must be found exactly once. */
function edit(from: string, to: string) {
  const file = join(dir, "Fixture/Kinds.lean");
  const text = readFileSync(file, "utf8");
  assert.equal(text.split(from).length, 2, `once in Kinds.lean: ${from}`);
  writeFileSync(file, text.replace(from, to));
}

before(() => {
  if (!haveLake) return;
  dir = copyFixture("vp-bodyversion-");
  before_ = versions();
  // a partial def's body, a structural recursion's (a `where` helper), a mutual well-founded one's
  edit("collatz (if n % 2 = 0 then n / 2 else 3 * n + 1) + 1", "collatz (if n % 2 = 0 then n / 2 else 3 * n + 1) + 2");
  edit("| k + 1, acc => go k (acc + k + 1)", "| k + 1, acc => go k (acc + k + 2)");
  edit("| n + 1 => oddW n", "| n + 1 => !oddW n");
  after_ = versions();
});
after(() => dir && rmSync(dir, { recursive: true, force: true }));

const opts = { skip: !haveLake };

test("a recursive body's change is a new version, wherever Lean compiled the body to", opts, () => {
  for (const n of ["Fixture.Kinds.collatz", "Fixture.Kinds.sumTo.go", "Fixture.Kinds.evenW"]) {
    assert.ok(before_.has(n), `no unit ${n}`);
    assert.notEqual(after_.get(n), before_.get(n), `${n}: its body changed, its version did not`);
  }
  // a member of the same mutual block shares the compiled body, as it shares the TCB (decision 6)
  assert.notEqual(after_.get("Fixture.Kinds.oddW"), before_.get("Fixture.Kinds.oddW"));
});

test("what was not edited keeps its version", opts, () => {
  const edited = new Set(["Fixture.Kinds.collatz", "Fixture.Kinds.sumTo.go", "Fixture.Kinds.evenW", "Fixture.Kinds.oddW"]);
  const moved = [...before_].filter(([n, v]) => !edited.has(n) && after_.get(n) !== v).map(([n]) => n);
  assert.deepEqual(moved, []);
});
