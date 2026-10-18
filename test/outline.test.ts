// The cluster tree beside the canvas (web/src/outline.ts): which rows are open, per board.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cluster, Layout } from "../src/shared/graph.ts";
import { Outline } from "../src/web/src/outline.ts";

/** A layout of clusters alone, each `[key, parent index, count]`. */
function layout(cs: [string, number, number][]): Layout {
  const clusters: Cluster[] = cs.map(([key, parent, count]) => ({ key, label: key.split(".").pop()!, parent, depth: key.split(".").length - 1, x: 0, y: 0, lx: 0, ly: 0, r: 1, count, ext: false }));
  return { x: [], y: [], lx: [], ly: [], cluster: [], clusters };
}

/** The tree as it is drawn: each row's label, `+` before an open one's. */
function rows(el: { innerHTML: string }): string[] {
  return [...el.innerHTML.matchAll(/<(?:span|button) class="tw"[^>]*>([^<]*)<\/(?:span|button)><button class="o-label"[^>]*>([^<]*)</g)].map((m) => (m[1] === "▾" ? "+" : "") + m[2]);
}

test("the tree's open rows are each board's: a board shown again has them as left, a new one opens its largest part", () => {
  let click: ((e: unknown) => void) | null = null;
  const el = { innerHTML: "", addEventListener: (_: string, f: (e: unknown) => void) => (click = f) };
  const no = () => false;
  const outline = new Outline(el as unknown as HTMLElement, { select: () => {}, picked: no, toggleFold: () => {}, isFolded: no, isCollapsed: no, stateOf: () => "", trustCell: () => "", trustClicked: () => {}, hide: () => {} });
  // the Project: three top namespaces, none most of the board
  const project = layout([["A", -1, 10], ["A.x", 0, 5], ["B", -1, 10], ["B.y", 2, 5], ["C", -1, 10]]);
  outline.setLayout(project, "project\u0000namespace");
  assert.deepEqual(rows(el), ["A", "B", "C"]);
  // the reader opens B
  const tw = { closest: (s: string) => (s === "[data-c]" ? { dataset: { c: "2" } } : s === ".tw" ? {} : null) };
  click!({ target: tw, shiftKey: false });
  assert.deepEqual(rows(el), ["A", "+B", "y", "C"]);
  // a view of A alone: its one top cluster is the whole board, and opens, whatever was open before
  outline.setLayout(layout([["A", -1, 10], ["A.x", 0, 5]]), "v1\u0000namespace");
  assert.deepEqual(rows(el), ["+A", "x"]);
  // back on the Project, B is open as the reader left it; a new graph (renumbered) keeps it so
  outline.setLayout(project, "project\u0000namespace");
  assert.deepEqual(rows(el), ["A", "+B", "y", "C"]);
  outline.setLayout(layout([["C", -1, 10], ["B", -1, 10], ["B.y", 1, 5], ["A", -1, 10], ["A.x", 3, 5]]), "project\u0000namespace");
  assert.deepEqual(rows(el), ["C", "+B", "y", "A"]);
});
