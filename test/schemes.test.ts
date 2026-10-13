// The canvas's colour schemes (CanvasSpec, "Colour schemes", decided 2026-10-08): where each
// declaration stands in the Status scheme (web/src/status.ts), the most urgent state winning, and
// which scheme a reader sees where the review has a focus and elsewhere (web/src/store.ts).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileStatus } from "../src/shared/build.ts";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { emptyReview } from "../src/shared/review.ts";
import type { Opinion } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { STATUSES, statusCodes, statusCounts } from "../src/web/src/status.ts";
import { Store } from "../src/web/src/store.ts";

/** Declarations in four files, one of them reaching sorry, and two from outside the project. */
function world() {
  const nodes: ViewNode[] = [
    { name: "P.a", kind: "def", module: "P.A", ax: 0, hash: "a1" },
    { name: "P.b", kind: "def", module: "P.A", ax: 0, hash: "b1" },
    { name: "P.c", kind: "theorem", module: "P.B", ax: 1, hash: "c1" },
    { name: "P.d", kind: "theorem", module: "P.C", ax: 1, hash: "d1" },
    { name: "P.e", kind: "def", module: "P.D", ax: 0, hash: "e1" },
    { name: "P.f", kind: "def", module: "P.D", ax: 0, hash: "f1" },
    { name: "Mathlib.g", kind: "def", module: "Mathlib.X", ax: 0, ext: true },
    { name: "Other.h", kind: "def", module: "Other.Y", ax: 0, ext: true },
  ];
  const meta = { nodes, projectCount: 6, axioms: ["propext", "sorryAx"], axiomSets: [[0], [0, 1]], layouts: {}, edgeCount: 0 } as unknown as ViewMeta;
  return new Graph(meta, new Int32Array(0));
}

const file = (module: string, state: FileStatus["state"]): [string, FileStatus] => [module, { module, file: null, state, warnings: 0 }];
const op = (by: string, verdict: Opinion["verdict"], hash: string): Opinion => ({ by, verdict, hash, at: "2026-10-08T10:00:00Z", ...(verdict === "comment" ? { comment: "no" } : {}) });

test("each declaration takes its most urgent state: build, sorry, then what reviewers said, then whether it needs review", () => {
  const g = world();
  const d = emptyReview();
  // P.a approved and commented on: the comment wins; P.b approved on an earlier version: stale; P.e
  // approved; P.f nobody said anything; Other.h approved though outside the project
  d.opinions["P.a"] = [op("Ann", "approve", "a1"), op("Bob", "comment", "a1")];
  d.opinions["P.b"] = [op("Ann", "approve", "b0")];
  d.opinions["P.e"] = [op("Ann", "approve", "e1")];
  d.opinions["Mathlib.g"] = [];
  d.opinions["Other.h"] = [op("Ann", "approve", "")];
  const name = (codes: Uint8Array) => [...codes].map((c) => STATUSES[c]);

  // no build known (a snapshot): sorry is read from the axioms alone
  assert.deepEqual(name(statusCodes(d, g, new Map())), ["commented", "stale", "sorry", "sorry", "approved", "unreviewed", "trusted", "approved"]);

  // live: a failed file outranks everything in it, a file being built shows so while it lasts, and
  // a declaration reaching a sorry from another file shows it too, in a file that is clean itself
  const files = new Map([file("P.A", "failed"), file("P.B", "ok"), file("P.C", "sorry"), file("P.D", "building")]);
  assert.deepEqual(name(statusCodes(d, g, files)), ["failed", "failed", "sorry", "sorry", "building", "building", "trusted", "approved"]);

  // trusting a prefix of the project makes what nobody reviewed trusted, and leaves opinions as
  // they are: approved outranks trusted, and a sorry below outranks both
  d.trusted.push("P");
  assert.deepEqual(name(statusCodes(d, g, new Map([file("P.B", "ok"), file("P.C", "ok")]))), ["commented", "stale", "sorry", "sorry", "approved", "trusted", "trusted", "approved"]);
  // a never built file is failed too
  assert.equal(STATUSES[statusCodes(d, g, new Map([file("P.A", "unbuilt")]))[0]], "failed");
  // out of date, queued and blocked files are shown as last built: by their review
  for (const st of ["stale", "queued", "blocked"] as const) assert.equal(STATUSES[statusCodes(d, g, new Map([file("P.A", st)]))[0]], "commented", st);
});

test("what the legend counts: every declaration once, in its state, of those it is asked about", () => {
  const g = world();
  const codes = statusCodes(emptyReview(), g, new Map());
  const all = statusCounts(codes);
  assert.equal(all.reduce((a, b) => a + b, 0), g.n);
  assert.equal(all[STATUSES.indexOf("unreviewed")], 5, "the outside world untrusted needs review too");
  assert.equal(all[STATUSES.indexOf("sorry")], 2);
  assert.equal(all[STATUSES.indexOf("trusted")], 1);
  const own = statusCounts(codes, (i) => !g.isExt(i));
  assert.equal(own.reduce((a, b) => a + b, 0), g.projectCount);
  assert.equal(own[STATUSES.indexOf("trusted")], 0);
});

test("a view where the review has a focus opens in Status and every other view in Kind, until the reader chooses, apart for each", () => {
  const s = new Store("/nowhere");
  s.data.scheme = undefined;
  assert.equal(s.schemeFor(true), "status");
  assert.equal(s.schemeFor(false), "kind");
  s.setScheme(false, "status");
  assert.equal(s.schemeFor(false), "status");
  assert.equal(s.schemeFor(true), "status");
  s.setScheme(true, "kind");
  assert.equal(s.schemeFor(true), "kind");
  assert.equal(s.schemeFor(false), "status", "the choice where the review has a focus leaves the others as they were");
  // what a browser kept that is not a scheme is not taken for one
  s.data.scheme = { review: "rainbow" as never };
  assert.equal(s.schemeFor(true), "status");
});
