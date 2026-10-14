// The linear form (ExportSpec decision 18, web/src/linear.ts): the outline on one line, the first at
// the top, a section's rows inside its span; a drag moves a row among its siblings only, and a drop
// asks the board to put it between its new neighbours — a declaration or a section pinned, a note
// moved — and reads the outline again.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Outline } from "../src/shared/doc/outline.ts";

/** A page just enough for the form: an element, a 2D context that draws nothing, and the canvas's
 *  numbering: declarations by name, clusters by key. */
function setup(outline: Outline, frozen: string | null = null) {
  const g = globalThis as Record<string, unknown>;
  g.window ??= { addEventListener() {}, devicePixelRatio: 1 };
  g.requestAnimationFrame ??= () => 1;
  g.getComputedStyle ??= () => ({ getPropertyValue: () => "" });
  g.document ??= { body: {}, getElementById: () => null };
  const el = { hidden: true, width: 0, height: 0, style: {} as Record<string, string>, addEventListener() {}, setPointerCapture() {}, getContext: () => new Proxy({}, { get: () => () => {} }) };
  const names = ["A.a1", "A.a2", "A.B.b1", "top"];
  const byName = new Map(names.map((n, i) => [n, i]));
  const calls: unknown[] = [];
  const canvas = {
    layout: { clusters: [{ key: "A" }, { key: "A.B" }] },
    screen: { w: 1000, h: 800, insets: { left: 0, right: 0, top: 0, bottom: 0 } },
    toScreen: (x: number, y: number) => [x, y],
    posOf: () => [0, 0],
    clusterDisc: () => [0, 0, 10],
    colourOf: () => "red",
    atRest: () => ({}),
    orderSpot: () => [1, 2],
    restToNow: (_k: string | null, s: [number, number]) => s,
    pinInOrder: (a: unknown, p: unknown, n: unknown) => (calls.push(["pin", a, p, n]), true),
  };
  const said: string[] = [];
  let asked = 0;
  return import("../src/web/src/linear.ts").then(({ LinearForm }) => {
    const f = new LinearForm(el as never, canvas as never, {
      outline: async () => (asked++, structuredClone(outline)),
      graph: () => ({ byName, outStart: new Int32Array(names.length + 1), outDst: new Int32Array(0), outSite: new Uint8Array(0) }) as never,
      noteSpot: () => [5, 5],
      lit: () => false,
      selectDecl: (i) => calls.push(["select", i]),
      selectSection: (c) => calls.push(["section", c]),
      frozen: () => frozen,
      moves: () => true,
      edges: () => ({ show: false, proofs: false }),
      moveNote: (id, key, w) => (calls.push(["note", id, key, w]), true),
      say: (t) => said.push(t),
      changed: () => {},
    });
    return { f: f as unknown as Record<string, any>, calls, said, asked: () => asked };
  });
}

const OUTLINE: Outline = {
  items: [
    { t: "decl", name: "top" },
    { t: "section", key: "A", keys: ["A"], title: "A", number: "1", level: 1, items: [
      { t: "decl", name: "A.a1", notes: [{ t: "note", id: "on1", kind: "project", words: "On a1." }] },
      { t: "section", key: "A.B", keys: ["A.B"], title: "B", number: "1.1", level: 2, items: [{ t: "decl", name: "A.B.b1" }] },
      { t: "note", id: "n", kind: "view", words: "In A." },
      { t: "decl", name: "A.a2" },
    ] },
  ],
  count: { declarations: 4, sections: 2 },
};

test("the outline on one line: the first at the top, a section's rows inside its span, numbered; a note attached to a declaration under it, indented", async () => {
  const { f } = await setup(OUTLINE);
  await f.show("reader");
  const rows = f.rows as { kind: string; name: string; label: string; depth: number; y0: number; y1: number; cy: number; attached?: true }[];
  assert.deepEqual(rows.map((r) => r.name), ["top", "A", "A.a1", "on1", "A.B", "A.B.b1", "n", "A.a2"]);
  for (let k = 1; k < rows.length; k++) assert.ok(rows[k].y0 >= rows[k - 1].y0, "down the line in order");
  const A = rows[1], B = rows[4];
  assert.equal(A.label, "1  A");
  assert.equal(B.label, "1.1  B");
  for (const r of rows.slice(2)) assert.ok(r.y0 >= A.y0 && r.y1 <= A.y1, `${r.name} inside A`);
  assert.ok(rows[5].y0 >= B.y0 && rows[5].y1 <= B.y1, "b1 inside B");
  assert.ok(B.y0 > A.y0 && B.y1 < A.y1, "B's circle inside A's");
  assert.deepEqual([rows[3].attached, rows[3].depth, rows[2].depth], [true, 2, 1]);
});

test("a row moves among its siblings only: a section's own rows, its sections and notes among them; at the top, the start and the sections apart", async () => {
  const { f } = await setup(OUTLINE);
  await f.show("reader");
  const row = (name: string) => f.rows.find((r: { name: string }) => r.name === name);
  const sibs = (name: string) => f.siblings(row(name)).map((r: { name: string }) => r.name);
  assert.deepEqual(sibs("A.a2"), ["A.a1", "A.B", "n", "A.a2"]);
  assert.deepEqual(sibs("n"), ["A.a1", "A.B", "n", "A.a2"]);
  assert.deepEqual(sibs("top"), ["top"]);
  assert.deepEqual(sibs("A"), ["A"]);
  assert.deepEqual(sibs("A.B.b1"), ["A.B.b1"]);
});

test("a drop puts it on the board between its new neighbours: a declaration pinned, a note moved in its cluster; the outline follows at once and is read again", async () => {
  const { f, calls, asked } = await setup(OUTLINE);
  await f.show("reader");
  const row = (name: string) => f.rows.find((r: { name: string }) => r.name === name);
  // a2 to the top of A: before a1, nothing before it
  f.place({ row: row("A.a2"), at: 0 });
  assert.deepEqual(calls.at(-1), ["pin", { kind: "node", k: 1 }, null, { kind: "node", k: 0 }]);
  assert.deepEqual(f.rows.map((r: { name: string }) => r.name).slice(2, 4), ["A.a2", "A.a1"], "drawn there at once");
  // the note between a2 and a1
  f.place({ row: row("n"), at: 1 });
  assert.deepEqual(calls.at(-1), ["note", "n", "A", [1, 2]]);
  // the section B first: pinned by its circle, a2 after it
  f.place({ row: row("A.B"), at: 0 });
  const last = calls.at(-1) as unknown[];
  assert.deepEqual(last.slice(0, 2), ["pin", { kind: "cluster", k: 1, move: 1 }]);
  // where it already is: nothing
  const n = calls.length;
  f.place({ row: row("A.B"), at: 0 });
  assert.equal(calls.length, n);
  await new Promise((ok) => setTimeout(ok, 400));
  assert.ok(asked() >= 2, "the outline is read again");
});

test("on a board nothing arranges (a snapshot, a read-only page, a past build's preview) a drag moves nothing, and says why", async () => {
  const { f, calls, said } = await setup(OUTLINE, "This page is read-only: it changes nothing that is shared.");
  await f.show("reader");
  f.t = 1;
  const row = f.rows.find((r: { name: string }) => r.name === "A.a2");
  f.press = { x: 0, y: 0, row, moved: true, moves: true, camY: 0 };
  f.drop = { row, at: 0, y: 0 };
  f.up({ shiftKey: false });
  assert.deepEqual(calls.filter((c) => (c as unknown[])[0] === "pin"), []);
  assert.deepEqual(said, ["This page is read-only: it changes nothing that is shared."]);
});
