// An extraction's file read in pieces (server/graphfile.ts): the same graph as read whole, wherever
// a piece ends; the edges packed; the view made of either the same.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readGraphFile } from "../src/server/graphfile.ts";
import type { RawGraph } from "../src/shared/graph.ts";

/** A small graph with what a scan could trip on: brackets, quotes, backslashes and commas inside
 *  strings, text of several bytes a character, empty arrays, nested arrays and objects. */
function graph(): RawGraph {
  const node = (name: string, type: string, extra: object = {}) => ({ name, kind: "theorem" as const, module: "M.A", type, ax: 0, hash: "00ff", shape: "s", refs: [0, 1], ...extra });
  return {
    schema: 1,
    roots: ["M"],
    modules: [{ name: "M.A", imports: [] }, { name: "M.B", imports: ["M.A"] }],
    nodes: [
      node("M.a", "∀ (s : ℂ), f s = 0 → s.re = 1 / 2"),
      node("M.«b,]}»", 'a "quoted" \\ back\\\\slash [1, {2}] ] } , :', { doc: "line\nbreak\ttab \u0001", range: [1, 0, 2, 3] }),
      node("M.c", "", { also: [], flags: ["grammar"], proofs: [[1, 2, 3, 4], [5, 6, 7, 8]] }),
    ],
    externals: [{ name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 1 }],
    edges: [[0, 1, 1], [0, 3, 2], [2, 0, 4], [1, 2147483647, 7]],
    axioms: ["propext"],
    axiomSets: [[], [0]],
    stats: { folded: 3, metaDropped: 0, ms: 12 },
    refNames: ["M.a", "Nat"],
    usage: { contexts: { "M.A": { deep: [{ "}": "]" }] } as never }, failed: [], stats: { modules: 2, ran: 2, cached: 0, notationEdges: 0, nestedEdges: 0, ms: 1 } },
  };
}

test("a graph's file read in pieces is the graph read whole, wherever a piece ends", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-graphfile-"));
  try {
    const g = graph();
    for (const [label, text] of [["compact", JSON.stringify(g)], ["indented", JSON.stringify(g, null, 2)]] as const) {
      const file = join(dir, `${label}.json`);
      writeFileSync(file, text);
      const whole = readGraphFile(file);
      assert.deepEqual(whole.graph, g);
      assert.equal(whole.graph.packed, undefined, "a file read whole keeps its edges as they are written");
      const sha = createHash("sha256").update(text).digest("hex");
      assert.equal(whole.sha256, sha);
      // pieces of every small size: every byte of the file is once the last of a piece
      for (const piece of [1, 2, 3, 5, 7, 16, 61, 1024, 1 << 20]) {
        const read = readGraphFile(file, 0, piece);
        const { packed, ...rest } = read.graph;
        assert.deepEqual(rest, { ...g, edges: [] }, `${label}, pieces of ${piece}`);
        assert.deepEqual([...packed!], g.edges.flat(), `${label}, pieces of ${piece}: the edges`);
        assert.equal(read.sha256, sha);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file cut short is refused, not read as a smaller graph", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-graphfile-"));
  try {
    const text = JSON.stringify(graph());
    const file = join(dir, "cut.json");
    writeFileSync(file, text.slice(0, text.length - 40));
    assert.throws(() => readGraphFile(file, 0, 64), /not a whole JSON file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
