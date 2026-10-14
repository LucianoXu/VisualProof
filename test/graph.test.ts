// The closures the modes draw, on a graph small enough to check by hand.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { Graph } from "../src/shared/viewgraph.ts";

//   thm ──stmt──▶ P ──body──▶ D ──proof──▶ L (a lemma inside a subtype proof)
//    │                        └──body───▶ X (external)
//    └──proof──▶ helper ──stmt──▶ H
const names = ["thm", "P", "D", "L", "helper", "H", "X"];
const kinds = ["theorem", "def", "def", "theorem", "theorem", "def", "def"] as const;
const nodes: ViewNode[] = names.map((name, i) => ({ name, kind: kinds[i], module: "M", ax: 0, ...(name === "X" ? { ext: true as const } : {}) }));
const E = [
  [0, 1, SITE_STMT],
  [1, 2, SITE_BODY],
  [2, 3, SITE_PROOF],
  [2, 6, SITE_BODY],
  [0, 4, SITE_PROOF],
  [4, 5, SITE_STMT],
];
const meta = { nodes, projectCount: 6, axioms: [], axiomSets: [[]] } as unknown as ViewMeta;
const g = new Graph(meta, new Int32Array(E.flat()));
const set = (s: Uint8Array) => names.filter((_, i) => s[i]);

test("TCB follows statements and bodies, never proofs", () => {
  assert.deepEqual(set(g.closure("tcb", [0])), ["thm", "P", "D", "X"]);
});

test("Dependency follows everything", () => {
  assert.deepEqual(set(g.closure("deps", [0])), names);
});

test("Direct is one step, through statements, bodies and proofs alike", () => {
  assert.deepEqual(set(g.closure("refs", [0])), ["thm", "P", "helper"]);
  assert.deepEqual(set(g.closure("refs", [2])), ["D", "L", "X"]);
});

test("Application walks the edges backwards", () => {
  assert.deepEqual(set(g.closure("apps", [3])), ["thm", "P", "D", "L"]);
});

test("Plain lights only what was picked", () => {
  assert.deepEqual(set(g.closure("plain", [2, 5])), ["D", "H"]);
});
