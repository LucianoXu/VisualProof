// The cluster tree beside the canvas (web/src/outline.ts): which rows are open, per board, and
// which rows are written again. It is rendered again at every selection, fold and review change. On
// a project of tens of thousands of declarations it holds over a thousand rows (NavierStokesAndEuler:
// 1,390, 19,000 elements), and writing them whole cost each click a quarter of a second: parsing
// them, then laying them out. Only the rows that changed are written; the others are left as they
// are, the same elements.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cluster, Layout } from "../src/shared/graph.ts";
import { Outline, rowsToWrite } from "../src/web/src/outline.ts";

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
  const el = { innerHTML: "", children: [], addEventListener: (_: string, f: (e: unknown) => void) => (click = f) };
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

test("rowsToWrite: the rows that changed, or all of them", () => {
  const a = ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"];
  assert.deepEqual(rowsToWrite(a, a, a.length), []);
  assert.deepEqual(rowsToWrite(a, a.map((r, i) => (i === 5 ? "r5 on" : r)), a.length), [5]);
  assert.deepEqual(rowsToWrite(a, a.map((r, i) => (i === 1 || i === 6 ? `${r} on` : r)), a.length), [1, 6]);
  // more than a quarter changed (a level folded): written whole
  assert.equal(rowsToWrite(a, a.map((r, i) => (i < 3 ? `${r} on` : r)), a.length), null);
  // other rows (one opened), nothing written yet, or the element holding something else
  assert.equal(rowsToWrite(a, [...a, "r8"], a.length), null);
  assert.equal(rowsToWrite([], a, 0), null);
  assert.equal(rowsToWrite(a, a, 3), null);
});

/** Just enough of the DOM for the outline: an element whose HTML is rows, a template. */
class Row {
  html: string;
  box: Box;
  constructor(html: string, box: Box) {
    this.html = html;
    this.box = box;
  }
  replaceWith(n: Row): void {
    const i = this.box.children.indexOf(this);
    n.box = this.box;
    this.box.children[i] = n;
  }
}
const split = (html: string, box: Box) => html.split(/(?=<div class="o-row)/).filter(Boolean).map((h) => new Row(h, box));
class Box {
  children: Row[] = [];
  writes = 0;
  addEventListener(): void {}
  set innerHTML(html: string) {
    this.writes++;
    this.children = split(html, this);
  }
}

test("the outline writes only the rows that changed", (t) => {
  const g = globalThis as Record<string, unknown>;
  // no focus on the page to keep (web/src/keepfocus.ts)
  g.HTMLElement = class {};
  g.document = {
    activeElement: null,
    createElement: () => {
      const t = { content: null as Row | null };
      return Object.defineProperty(t, "innerHTML", { set: (h: string) => (t.content = split(h, new Box())[0]) });
    },
  };
  t.after(() => {
    delete g.document;
    delete g.HTMLElement;
  });
  const cluster = (key: string): Cluster => ({ key, label: key, parent: -1, depth: 0, x: 0, y: 0, lx: 0, ly: 0, r: 10, count: 1, ext: false });
  const layout: Layout = { x: [], y: [], lx: [], ly: [], cluster: [], clusters: ["A", "B", "C", "D", "E", "F", "G", "H"].map(cluster) };
  let picked = -1;
  let folded = new Set<number>();
  const box = new Box();
  const outline = new Outline(box as unknown as HTMLElement, {
    select() {},
    picked: (c) => c === picked,
    toggleFold() {},
    isFolded: (c) => folded.has(c),
    isCollapsed: (c) => folded.has(c),
    stateOf: () => "",
    trustCell: () => "",
    trustClicked() {},
    hide() {},
  });
  outline.setLayout(layout, "project\u0000namespace");
  assert.equal(box.writes, 1);
  assert.equal(box.children.length, 8);
  const before = [...box.children];

  // a selection that is no cluster: nothing written
  outline.render();
  assert.equal(box.writes, 1);
  assert.deepEqual(box.children, before);

  // a cluster picked: its row alone, the others the same elements
  picked = 2;
  outline.render();
  assert.equal(box.writes, 1);
  assert.notEqual(box.children[2], before[2]);
  assert.match(box.children[2].html, /class="o-row on" data-c="2"/);
  for (const i of [0, 1, 3, 4, 5, 6, 7]) assert.equal(box.children[i], before[i]);

  // most of them folded: written whole
  folded = new Set([0, 1, 3, 4, 5]);
  outline.render();
  assert.equal(box.writes, 2);
  assert.equal(box.children.filter((r) => /o-row folded/.test(r.html)).length, 5);
});
