// The edges as they travel to a page (shared/edgecodec.ts): packed and unpacked, the same edges.

import assert from "node:assert/strict";
import { test } from "node:test";
import { isPackedEdges, packEdges, unpackEdges } from "../src/shared/edgecodec.ts";

/** The triples as a sorted list, the order of the edges being no part of the graph. */
const triples = (e: Int32Array) => {
  const t: string[] = [];
  for (let k = 0; k < e.length; k += 3) t.push(`${e[k]} ${e[k + 1]} ${e[k + 2]}`);
  return t.sort();
};

test("packed edges unpack to the same edges: every site, repeated pairs, far indices, nodes without edges", () => {
  let seed = 7;
  const rnd = (k: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % k);
  const n = 3_000_000;
  const list: number[] = [];
  for (let e = 0; e < 5000; e++) list.push(rnd(50), rnd(n), 1 + rnd(7));
  // the same pair twice, with two sites; a node's edge to itself; the last node
  list.push(3, 9, 1, 3, 9, 4, 5, 5, 2, n - 1, 0, 7, 0, n - 1, 1);
  const edges = new Int32Array(list);
  const packed = packEdges(edges, n);
  assert.ok(isPackedEdges(packed));
  assert.ok(!isPackedEdges(new Uint8Array(edges.buffer)), "the triples themselves are not taken for packed edges");
  assert.deepEqual(triples(unpackEdges(packed)), triples(edges));
  assert.deepEqual(triples(unpackEdges(packEdges(new Int32Array(0), 4))), []);
  assert.throws(() => unpackEdges(packed.subarray(0, packed.length - 1)), /cut short/);
});
