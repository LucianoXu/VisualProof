// The linear form (ExportSpec decision 18, web/src/linear.ts): the outline on one line, the first at
// the top, a section's rows inside its span; a drag moves a row among its siblings only, and a drop
// asks the board to put it between its new neighbours — a declaration or a section pinned, a note
// moved — and reads the outline again. A section of many items starts folded, one row standing for
// what it holds; the wheel zooms as far as the board's.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Outline } from "../src/shared/doc/outline.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { spotBetween } from "../src/shared/doc/order.ts";
import { ZOOM_LEAST } from "../src/shared/sticky.ts";

/** A page just enough for the form: an element, a 2D context that draws nothing, and the canvas's
 *  numbering: declarations by name, clusters by key. */
type At = { nx: number[]; ny: number[]; cx: number[]; cy: number[]; r: number[] };
function setup(
  outline: Outline,
  frozen: string | null = null,
  opts: { names?: string[]; sites?: number; keyLinks?: number[]; lit?: (i: number) => boolean; edges?: [number, number, number?][]; at?: At; noteAt?: (id: string) => [number, number]; clamp?: (S: At) => void; texts?: Record<string, string>; open?: string[] } = {},
) {
  const g = globalThis as Record<string, unknown>;
  g.window ??= { addEventListener() {}, devicePixelRatio: 1 };
  g.requestAnimationFrame ??= () => 1;
  g.getComputedStyle ??= () => ({ getPropertyValue: () => "" });
  g.document ??= { body: {}, getElementById: () => null };
  // a 2D context that draws nothing, its letters 6 px wide
  const ctx = new Proxy({}, { get: (_t, key) => (key === "measureText" ? (t: string) => ({ width: 6 * t.length }) : () => {}) });
  const el = { hidden: true, width: 0, height: 0, style: {} as Record<string, string>, addEventListener() {}, setPointerCapture() {}, getContext: () => ctx };
  const names = opts.names ?? ["A.a1", "A.a2", "A.B.b1", "top"];
  // the edges, from the one that uses, as the graph packs them
  const outStart = new Int32Array(names.length + 1);
  const sorted = [...(opts.edges ?? [])].sort((a, b) => a[0] - b[0]);
  for (const [u] of sorted) outStart[u + 1]++;
  for (let i = 0; i < names.length; i++) outStart[i + 1] += outStart[i];
  const outDst = Int32Array.from(sorted.map(([, t]) => t));
  const outSite = Uint8Array.from(sorted.map((e) => e[2] ?? SITE_STMT));
  const byName = new Map(names.map((n, i) => [n, i]));
  const calls: unknown[] = [];
  const canvas = {
    layout: { clusters: [{ key: "A" }, { key: "A.B" }] },
    screen: { w: 1000, h: 800, insets: { left: 0, right: 0, top: 0, bottom: 0 } },
    toScreen: (x: number, y: number) => [x, y],
    posOf: () => [0, 0],
    clusterDisc: () => [0, 0, 10],
    colourOf: () => "red",
    // the board at rest, the first of the document the lowest (largest y): by default declaration
    // i at (10 i, 100 - 10 i)
    atRest: (): At => structuredClone(opts.at ?? { nx: names.map((_, i) => 10 * i), ny: names.map((_, i) => 100 - 10 * i), cx: [0, 50], cy: [0, 50], r: [40, 20] }),
    // the board with these pinned too: each where it is put, then `clamp` (the board bringing a
    // drop inside its parent)
    atRestWith(moves: { a: { kind: string; k: number }; spot: [number, number] }[], R: At): At {
      const S = structuredClone(R);
      for (const { a, spot } of moves) {
        if (a.kind === "node") [S.nx[a.k], S.ny[a.k]] = spot;
        else [S.cx[a.k], S.cy[a.k]] = spot;
      }
      opts.clamp?.(S);
      return S;
    },
    orderSpot(a: { kind: string; k: number; x: number; y: number }, p: typeof a | null, n: typeof a | null, R: At) {
      const disc = (b: typeof a) => (b.kind === "spot" ? { x: b.x, y: b.y, r: 5 } : b.kind === "node" ? { x: R.nx[b.k], y: R.ny[b.k], r: 5 } : { x: R.cx[b.k], y: R.cy[b.k], r: R.r[b.k] });
      return spotBetween(disc(a), p && disc(p), n && disc(n));
    },
    restToNow: (_k: string | null, s: [number, number]) => s,
    pinInOrder: (a: unknown, p: unknown, n: unknown) => (calls.push(["pin", a, p, n]), true),
    pinAtSpots: (moves: unknown) => (calls.push(["spots", moves]), true),
  };
  const said: string[] = [];
  let asked = 0;
  return import("../src/web/src/linear.ts").then(({ LinearForm }) => {
    const f = new LinearForm(el as never, canvas as never, {
      outline: async () => (asked++, structuredClone(outline)),
      graph: () => ({ byName, outStart, outDst, outSite }) as never,
      noteSpot: (id: string) => opts.noteAt?.(id) ?? [5, 5],
      lit: opts.lit ?? (() => false),
      // as the board lights an edge: between two lit, of the sites `opts.sites` (all by default)
      edgeLit: (u: number, v: number, site: number) => !!opts.lit?.(u) && !!opts.lit?.(v) && (site & (opts.sites ?? 0xff)) !== 0,
      keyLinks: () => opts.keyLinks ?? null,
      selectDecl: (i) => calls.push(["select", i]),
      selectSection: (c) => calls.push(["section", c]),
      frozen: () => frozen,
      edges: () => false,
      moveNote: (id, key, w, detach) => (calls.push(detach ? ["note", id, key, w, "detach"] : ["note", id, key, w]), true),
      noteText: (id) => opts.texts?.[id] ?? null,
      noteOpen: (id) => !!opts.open?.includes(id),
      toggleNote: (id) => calls.push(["toggle", id]),
      menu: (on, x, y, spot) => calls.push(["menu", on, spot]),
      say: (t) => said.push(t),
      changed: () => {},
    });
    return { f: f as unknown as Record<string, any>, calls, said, asked: () => asked };
  });
}

/** OUTLINE's board at rest, as its document reads it: in A, a1 lowest, then B, the note n, a2; the
 *  note on1, attached to a1, beside it. */
const BOARD: { at: At; noteAt: (id: string) => [number, number] } = {
  at: { nx: [0, 0, 50, 200], ny: [100, 40, 80, 0], cx: [0, 50], cy: [70, 80], r: [60, 10] },
  noteAt: (id) => (id === "on1" ? [2, 99] : [5, 60]),
};

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
  // the start of the document, under its heading here, then the sections
  assert.deepEqual(rows.map((r) => r.name), ["\u0000start", "top", "A", "A.a1", "on1", "A.B", "A.B.b1", "n", "A.a2"]);
  assert.equal(rows[0].label, "In no section");
  for (let k = 1; k < rows.length; k++) assert.ok(rows[k].y0 >= rows[k - 1].y0, "down the line in order");
  const A = rows[2], B = rows[5];
  assert.equal(A.label, "1  A");
  assert.equal(B.label, "1.1  B");
  for (const r of rows.slice(3)) assert.ok(r.y0 >= A.y0 && r.y1 <= A.y1, `${r.name} inside A`);
  assert.ok(rows[6].y0 >= B.y0 && rows[6].y1 <= B.y1, "b1 inside B");
  assert.ok(B.y0 > A.y0 && B.y1 < A.y1, "B's circle inside A's");
  assert.deepEqual([rows[4].attached, rows[4].depth, rows[3].depth], [true, 2, 1]);
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

test("let go, the section's order is made so on the board: each row it passed takes the place the row at its index had, declarations and circles pinned in one change, a note moved; drawn there at once; the outline read again", async () => {
  const fresh = () => setup(OUTLINE, null, BOARD);
  {
    // a2 to the top of A: a2 to a1's place, a1 to B's, B to the note's, the note to a2's
    const { f, calls, asked } = await fresh();
    await f.show("reader");
    const row = (name: string) => f.rows.find((r: { name: string }) => r.name === name);
    assert.equal(f.place({ row: row("A.a2"), at: 0 }), true);
    assert.deepEqual(calls.slice(-2), [
      ["spots", [{ a: { kind: "node", k: 1 }, spot: [0, 100] }, { a: { kind: "node", k: 0 }, spot: [50, 80] }, { a: { kind: "cluster", k: 1, move: 1 }, spot: [5, 60] }]],
      ["note", "n", "A", [0, 40]],
    ]);
    assert.deepEqual(f.rows.map((r: { name: string }) => r.name).slice(3, 5), ["A.a2", "A.a1"], "drawn there at once");
    await new Promise((ok) => setTimeout(ok, 400));
    assert.ok(asked() >= 2, "the outline is read again");
  }
  {
    // the section B first: to a1's place, a1 to B's
    const { f, calls } = await fresh();
    await f.show("reader");
    const row = (name: string) => f.rows.find((r: { name: string }) => r.name === name);
    f.place({ row: row("A.B"), at: 0 });
    assert.deepEqual(calls.at(-1), ["spots", [{ a: { kind: "cluster", k: 1, move: 1 }, spot: [0, 100] }, { a: { kind: "node", k: 0 }, spot: [50, 80] }]]);
    // where it already is: nothing
    const n = calls.length;
    assert.equal(f.place({ row: row("A.B"), at: 0 }), false);
    assert.equal(calls.length, n);
  }
});

test("where the board would not give the order dropped (a circle brought back inside its parent) in any way, nothing moves and the reader is told", async () => {
  // nothing in A can go lower than 75: B to the front cannot be made
  const { f, calls, said } = await setup(OUTLINE, null, { ...BOARD, clamp: (S) => (S.cy[1] = Math.min(S.cy[1], 75)) });
  await f.show("reader");
  const row = (name: string) => f.rows.find((r: { name: string }) => r.name === name);
  assert.equal(f.place({ row: row("A.B"), at: 0 }), false);
  assert.deepEqual(calls.filter((c) => (c as unknown[])[0] === "spots"), []);
  assert.deepEqual(said, ["There is no room for it there on the board: move it on the board."]);
});

test("on a board nothing arranges (a snapshot, a read-only page, a past build's preview) a drag moves nothing, and says why", async () => {
  const { f, calls, said } = await setup(OUTLINE, "This page is read-only: it changes nothing that is shared.");
  await f.show("reader");
  f.t = 1;
  const row = f.rows.find((r: { name: string }) => r.name === "A.a2");
  f.lift(row, 0, 0);
  f.drag.at = 0;
  f.press = { x: 0, y: 0, row, moved: true, moves: true, camY: 0 };
  f.up({ shiftKey: false });
  assert.deepEqual(calls.filter((c) => (c as unknown[])[0] === "pin"), []);
  assert.deepEqual(said, ["This page is read-only: it changes nothing that is shared."]);
});

/** A declaration at the start of the document, then a section of `n` declarations, `A.a0` …. */
function many(n: number): { outline: Outline; names: string[] } {
  const names = [...Array.from({ length: n }, (_, i) => `A.a${i}`), "top"];
  return {
    names,
    outline: {
      items: [
        { t: "decl", name: "top" },
        { t: "section", key: "A", keys: ["A"], title: "A", number: "1", level: 1, items: names.slice(0, n).map((name) => ({ t: "decl" as const, name })) },
      ],
      count: { declarations: n + 1, sections: 1 },
    },
  };
}

test("a section of more than ten items starts folded, one row standing for what it holds; its ▸ opens it, its heading kept where it was, and what the reader folds or opens stays so", async () => {
  const { outline, names } = many(11);
  const { f } = await setup(outline, null, { names });
  await f.show("reader");
  assert.deepEqual(f.rows.map((r: { name: string }) => r.name), ["\u0000start", "top", "A"]);
  const A = f.rows[2];
  assert.equal(A.members.length, 11);
  assert.equal(A.y1 - A.y0, 22, "one row");
  f.fold(A);
  assert.equal(f.rows.length, 14, "opened: its heading and its eleven, after the start's two");
  assert.equal(f.folds.get("A"), false);
  f.setOutline(structuredClone(outline));
  assert.equal(f.rows.length, 14, "kept open when the outline comes again");
  f.fold(f.rows[2]);
  assert.deepEqual(f.rows.map((r: { name: string }) => r.name), ["\u0000start", "top", "A"]);
  // ten items or fewer: open
  const ten = many(10);
  const g = await setup(ten.outline, null, { names: ten.names });
  await g.f.show("reader");
  assert.equal(g.f.rows.length, 13);
});

test("the form opens on the selection: a folded section it is in opens", async () => {
  const { outline, names } = many(12);
  const { f } = await setup(outline, null, { names, lit: (i) => i === 5 });
  await f.show("reader");
  assert.ok(f.rows.some((r: { name: string }) => r.name === "A.a5"), "A opened on a5");
  assert.equal(f.folds.get("A"), false);
});

test("the edges of a folded section's members end at its row, once per pair of rows, none inside it; each from the one that uses, orange, to the one used, blue", async () => {
  const { outline, names } = many(12);
  const top = names.length - 1;
  // top uses a0 and a1; a0 uses a1 (inside A)
  const { f } = await setup(outline, null, { names, edges: [[top, 0], [top, 1], [0, 1]] });
  await f.show("reader");
  const drawn: { grad: number[]; stops: string[] }[] = [];
  const c = new Proxy({} as Record<string, unknown>, {
    get: (_t, key) =>
      key === "createLinearGradient"
        ? (...grad: number[]) => {
            const stops: string[] = [];
            drawn.push({ grad, stops });
            return { addColorStop: (_at: number, colour: string) => stops.push(colour) };
          }
        : () => {},
    set: () => true,
  });
  f.arcs(c, (r: { cy: number }) => [0, r.cy], 1, (v: string) => v);
  assert.equal(drawn.length, 1, "top to A, once");
  const [T, A] = [f.rows[1], f.rows[2]];
  assert.deepEqual(drawn[0].grad, [0, T.cy, 0, A.cy], "from top, which uses, to A");
  assert.deepEqual(drawn[0].stops, ["--edge-from", "--edge-to"]);
});

test("the wheel zooms about the pointer as far out as the board's", async () => {
  const { f } = await setup(OUTLINE);
  await f.show("reader");
  f.t = 1;
  for (let k = 0; k < 40; k++) f.wheel({ deltaY: 400, offsetY: 300, ctrlKey: false, preventDefault() {} });
  assert.equal(f.cam.k, ZOOM_LEAST);
});

test("the start of the document has a heading of its own here, which folds as a section does, past ten items; it is neither moved nor selected, and its rows move among themselves", async () => {
  const names = [...Array.from({ length: 11 }, (_, i) => `s${i}`)];
  const outline: Outline = { items: names.map((name) => ({ t: "decl" as const, name })), count: { declarations: 11, sections: 0 } };
  const { f } = await setup(outline, null, { names });
  await f.show("reader");
  assert.deepEqual(f.rows.map((r: { name: string }) => r.name), ["\u0000start"]);
  const start = f.rows[0];
  assert.deepEqual([start.start, start.members.length, start.k], [true, 11, -1]);
  f.fold(start);
  assert.equal(f.rows.length, 12);
  assert.deepEqual(f.siblings(f.rows[1]).map((r: { name: string }) => r.name), names, "the start's rows among themselves, the heading not one of them");
  f.t = 1;
  f.down({ button: 0, offsetX: 1000, offsetY: 24 + 11, pointerId: 1 });
  assert.equal(f.press.moves, false, "the heading is not taken along");
});

test("a row taken up follows the pointer, off the line too; its siblings make room where it would go; let go, it is put there and everything settles on the line", async () => {
  const { f, calls } = await setup(OUTLINE, null, BOARD);
  await f.show("reader");
  f.t = 1;
  const row = (name: string) => f.rows.find((r: { name: string }) => r.name === name);
  const a2 = row("A.a2"), a1 = row("A.a1");
  // A's rows: a1 (with its note), B (with b1), n, a2; a2 taken by its point, up above a1
  const top = 24; // the line's top on the screen: insets.top + 24
  const sy = (y: number) => top + (y - f.cam.y);
  f.lift(a2, 300, sy(a2.cy));
  f.follow(340, sy(a1.y0) - 2);
  assert.equal(f.drag.at, 0, "before a1");
  const off = (name: string) => f.off.get(`${row(name).kind}:${name}`);
  assert.equal(off("A.a2").dx, 40, "off the line, with the pointer");
  for (const name of ["A.a1", "on1", "A.B", "A.B.b1", "n"]) assert.equal(off(name).ty, 22, `${name} makes room`);
  f.press = { x: 300, y: sy(a2.cy), row: a2, moved: true, moves: true, camY: f.cam.y };
  f.up({ shiftKey: false });
  assert.deepEqual((calls.at(-2) as unknown[])[0], "spots");
  assert.deepEqual(calls.at(-1), ["note", "n", "A", [0, 40]]);
  assert.equal(f.drag, null);
  for (const o of f.off.values()) assert.deepEqual([o.ty, o.tx], [0, 0], "settling on the line");
  assert.equal(off("A.a2").dx, 40, "from where it was let go");
});

test("the form comes in its 480 ms however few frames the screen draws meanwhile", async () => {
  const { f } = await setup(OUTLINE, null, BOARD);
  await f.show("reader");
  assert.equal(f.t, 0);
  // two frames, 300 ms apart: most of the way, then there
  f.draw(f.last + 300);
  assert.ok(f.t > 0.6 && f.t < 1, `${f.t}`);
  f.draw(f.last + 300);
  assert.equal(f.t, 1, "come: the pointer is heard");
  // a frame stamped before the ease began moves nothing back
  f.hide("reader");
  f.draw(f.last - 5);
  assert.equal(f.t, 1);
});

test("a row taken up takes what goes with it along: a section its rows, a declaration its notes", async () => {
  const { f } = await setup(OUTLINE, null, BOARD);
  await f.show("reader");
  f.t = 1;
  const row = (name: string) => f.rows.find((r: { name: string }) => r.name === name);
  const off = (name: string) => f.off.get(`${row(name).kind}:${name}`);
  const sy = (y: number) => 24 + (y - f.cam.y);
  // B (with b1) up above a1: b1 comes with it, as far
  const b = row("A.B"), a1 = row("A.a1");
  f.lift(b, 300, sy(b.cy));
  f.follow(320, sy(a1.y0) - 2);
  assert.equal(f.drag.at, 0);
  assert.deepEqual([off("A.B.b1").dy, off("A.B.b1").dx], [off("A.B").dy, off("A.B").dx], "b1 with B");
  assert.ok(off("A.B").dy < 0);
  f.cancel();
  // a1 (with its note on1) down below a2: on1 comes with it; the others make room for both
  f.lift(a1, 300, sy(a1.cy));
  const a2 = row("A.a2");
  f.follow(300, sy(a2.y1) + 30);
  assert.equal(off("on1").dy, off("A.a1").dy, "its note with it");
  assert.equal(off("n").ty, -(row("on1").y1 - a1.y0), "the rows passed make room for a1 and its note");
});

test("let go among declarations alone, each row between where it was and where it went takes the place the one at its index had: the order exactly so, no row on another, the rest unmoved, in one change", async () => {
  const { outline, names } = many(5);
  const { f, calls } = await setup(outline, null, { names });
  await f.show("reader");
  const row = (name: string) => f.rows.find((r: { name: string }) => r.name === name);
  // a3 up between a0 and a1: a0, a3, a1, a2, a4
  assert.equal(f.place({ row: row("A.a3"), at: 1 }), true);
  assert.deepEqual(calls.at(-1), [
    "spots",
    [
      { a: { kind: "node", k: 3 }, spot: [10, 90] },
      { a: { kind: "node", k: 1 }, spot: [20, 80] },
      { a: { kind: "node", k: 2 }, spot: [30, 70] },
    ],
  ]);
  assert.deepEqual(f.siblings(row("A.a0")).map((r: { name: string }) => r.name), ["A.a0", "A.a3", "A.a1", "A.a2", "A.a4"]);
});

test("the right click opens the board's menu on the row the pointer is on; a note written from it goes right after the row, a section's first in it, clear of its neighbours", async () => {
  const { f, calls } = await setup(OUTLINE, null, BOARD);
  await f.show("reader");
  f.t = 1;
  const row = (name: string) => f.rows.find((r: { name: string }) => r.name === name);
  // the line at x 400 (insets.left + 40% of 1000), a label at 416 + 14 a level, letters 6 px wide
  const click = (name: string, x = 440) => {
    // the line's top at 24 on the screen: insets.top + 24, the camera at the top, zoom 1
    f.context({ preventDefault() {}, offsetX: x, offsetY: 24 + row(name).y0 + 2, clientX: x, clientY: 0 });
    return calls.at(-1);
  };
  assert.deepEqual(click("A.a1"), ["menu", { kind: "decl", i: 0 }, [0, 90]], "after a1: halfway to B, the next");
  assert.deepEqual(click("A.a1", 395), ["menu", { kind: "decl", i: 0 }, [0, 90]], "on its point");
  assert.deepEqual(click("A.a1", 20), ["menu", null, null], "on the arcs' side: the board's");
  assert.deepEqual(click("A.a1", 600), ["menu", null, null], "past its name: the board's");
  assert.deepEqual(click("A.B"), ["menu", { kind: "cluster", c: 1, key: "A.B", folded: false }, [50, 85]], "B's first: halfway from b1 to B's bottom");
  assert.deepEqual(click("n"), ["menu", { kind: "note", id: "n" }, [5, 50]], "after n: halfway to a2");
  assert.deepEqual(click("A"), ["menu", { kind: "cluster", c: 0, key: "A", folded: false }, [0, 115]], "A's first: halfway from a1 to A's bottom");
  assert.deepEqual(click("A.a2"), ["menu", { kind: "decl", i: 1 }, [0, 25]], "after the last: halfway to A's top");
});

test("a note attached to a declaration is dragged on its own, among its section's rows where it is read; let go elsewhere, it is attached no more, put between its new neighbours", async () => {
  const { f, calls } = await setup(OUTLINE, null, BOARD);
  await f.show("reader");
  const row = (name: string) => f.rows.find((r: { name: string }) => r.name === name);
  assert.deepEqual(f.siblings(row("on1")).map((r: { name: string }) => r.name), ["A.a1", "on1", "A.B", "n", "A.a2"]);
  // right back after a1: nothing
  assert.equal(f.place({ row: row("on1"), at: 1 }), false);
  // between n and a2
  assert.equal(f.place({ row: row("on1"), at: 4 }), true);
  assert.deepEqual(calls.at(-1), ["note", "on1", "A", [2, 50], "detach"]);
  assert.deepEqual(f.siblings(row("A.a1")).map((r: { name: string }) => r.name), ["A.a1", "A.B", "n", "on1", "A.a2"], "a note of the section now");
  assert.equal(row("on1").attached, undefined);
});

test("a note opens and closes by a click, for everyone, as on the board; open, its text is set in lines under its row, the longest cut", async () => {
  const { f, calls } = await setup(OUTLINE, null, { ...BOARD, open: ["n"], texts: { n: "word ".repeat(400) } });
  await f.show("reader");
  f.t = 1;
  const n = f.rows.find((r: { name: string }) => r.name === "n");
  assert.equal(n.lines.length, 14);
  assert.ok(n.lines.at(-1).endsWith("…"));
  assert.equal(n.y1 - n.y0, 14 * 16 + 8, "its lines are its row");
  f.press = { x: 300, y: 0, row: n, moved: false, moves: false, camY: 0 };
  f.up({ shiftKey: false });
  assert.deepEqual(calls.at(-1), ["toggle", "n"]);
});

test("what the pointer is on is the row whose point and name it is over, lit: what a click selects and a drag takes; past the name, nothing", async () => {
  const { f } = await setup(OUTLINE, null, BOARD);
  await f.show("reader");
  f.t = 1;
  const a1 = f.rows.find((r: { name: string }) => r.name === "A.a1");
  const y = 24 + a1.y0 + 2;
  // a1's label at 430, "a1" 12 px wide: its name ends at 442
  assert.equal(f.rowAt(440, y), a1);
  assert.equal(f.rowAt(449, y), a1, "a little past it");
  assert.equal(f.rowAt(460, y), null);
  assert.equal(f.rowAt(380, y), null, "left of the line");
  f.move({ offsetX: 440, offsetY: y });
  assert.equal(f.hover, "decl:A.a1");
  f.move({ offsetX: 700, offsetY: y });
  assert.equal(f.hover, null);
  f.down({ button: 0, offsetX: 440, offsetY: y, pointerId: 1 });
  assert.deepEqual([f.press.row, f.press.moves], [a1, true], "taken along by a drag");
});

test("an arc is lit as the board lights its edge: between two lit declarations, of what the mode follows — not one that only ends at the lit; none of a proof's (proof edges are no more); under Keys, the key graph's links, dashed", async () => {
  const { outline, names } = many(3);
  const top = names.length - 1;
  // top uses a0 in its statement and a1 in its proof; a0 uses a1; a2 uses a0
  const edges: [number, number, number][] = [[top, 0, SITE_STMT], [top, 1, SITE_PROOF], [0, 1, SITE_BODY], [2, 0, SITE_STMT]];
  // TCB of top lit: top, a0, a1
  const lit = (i: number) => i === top || i === 0 || i === 1;
  const { f } = await setup(outline, null, { names, edges, lit, sites: SITE_STMT | SITE_BODY });
  await f.show("reader");
  const pairs = (keys?: number[]) => {
    f.hooks.keyLinks = () => keys ?? null;
    return f.arcPairs().map((p: { a: { name: string }; b: { name: string }; lit: boolean; key?: true }) => `${p.a.name}→${p.b.name}${p.lit ? " lit" : ""}${p.key ? " key" : ""}`).sort();
  };
  assert.deepEqual(pairs(), ["A.a0→A.a1 lit", "A.a2→A.a0", "top→A.a0 lit"]);
  assert.deepEqual(pairs([top, 1]), ["A.a0→A.a1 lit", "A.a2→A.a0", "top→A.a0 lit", "top→A.a1 lit key"]);
});

test("shown as a followed reader's, the form is the follower's own once following ends: ⋯ and the key put it away, and so may the follower's own Export window closing; the window's own form goes with it alone", async () => {
  const { f } = await setup(OUTLINE);
  // following someone whose board is drawn so
  await f.show("followed");
  assert.deepEqual([f.shown, f.asked, f.followed], [true, true, true]);
  // their form put away, and with it one the follower had asked for themselves
  await f.show("reader");
  f.hide("reader", "followed");
  assert.equal(f.shown, false);
  // following ended with it shown: the key puts it away, the reader's own asking with it
  await f.show("followed");
  await f.show("reader");
  f.toggle();
  assert.deepEqual([f.shown, f.asked], [false, false]);
  // the follower's own Export window opened over it and closed: the window's alone goes (web/src/
  // main.ts says whether the one following left goes too)
  await f.show("followed");
  await f.show("export");
  f.hide("export");
  assert.deepEqual([f.shown, f.followed], [true, true]);
  await f.show("export");
  f.hide("export", "followed");
  assert.equal(f.shown, false);
  // the Export window open, the followed reader's put away: the window's stays
  await f.show("export");
  await f.show("followed");
  f.hide("reader", "followed");
  assert.deepEqual([f.shown, f.asked], [true, false]);
});
