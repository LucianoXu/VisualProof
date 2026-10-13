// A note on the canvas as the owner decided it on 2026-10-11 (CanvasSpec, "Notes"; shared/notecard.ts):
// a round icon at its place that says what the note is, and, expanded, its card hanging from it at an
// offset kept in pixels of the screen, per note and shared as its open state is — flipped to stay on
// the screen, never covering its icon, and never the note's place. While its icon is dragged, what
// would hold it is lit; zoomed out, the card is hidden and the icon stays; Fit to screen frames the
// icons, and the cards where they fit.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Ask } from "../src/server/agent.ts";
import { Views } from "../src/server/views.ts";
import type { Layout, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION } from "../src/shared/graph.ts";
import { CARD_GAP, cardBox, carryCount, clearOfIcon, defaultCard, dropTarget, hangCard, ICON_R, iconKind, keptCard, leaderLine, noteBoxes, noteShows, ringCard } from "../src/shared/notecard.ts";
import type { Box, IconFile } from "../src/shared/notecard.ts";
import { noteBoard, placeIn } from "../src/shared/noteplace.ts";
import { applyProjectNoteOp, asProjectNote, asViewNote, cleanProjectNotes, invalidProjectNoteOps } from "../src/shared/projectnotes.ts";
import type { ProjectNote } from "../src/shared/projectnotes.ts";
import { fitFrame } from "../src/shared/ring.ts";
import type { FitBox } from "../src/shared/ring.ts";
import { AUTO_COLLAPSE_PX, applyNoteOp, CARD_REACH, cleanNotes, invalidNoteOp, placeAt } from "../src/shared/sticky.ts";
import type { PlaceCluster, StickyNote } from "../src/shared/sticky.ts";
import type { NewEvent, StoredEvent } from "../src/shared/timeline.ts";
import { PROJECT } from "../src/shared/views.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const IMG = "a".repeat(64), PNG = "b".repeat(64), PDF = "c".repeat(64), GONE = "d".repeat(64);
const FILES: Record<string, IconFile> = { [IMG]: { type: "png" }, [PNG]: { type: "png" }, [PDF]: { type: "pdf" } };
const fileOf = (sha: string) => FILES[sha] ?? null;

test("a note's icon says what it carries and nothing else — a note, an image, a paper — with a count where it carries more than one thing", () => {
  assert.equal(iconKind(undefined, fileOf), "note");
  assert.equal(iconKind([], fileOf), "note");
  // images alone: an image, however many
  assert.equal(iconKind([{ file: IMG }], fileOf), "image");
  assert.equal(iconKind([{ file: PNG }, { file: IMG }], fileOf), "image");
  // any PDF or clip: a paper
  assert.equal(iconKind([{ file: PDF }], fileOf), "paper");
  assert.equal(iconKind([{ file: PDF, page: 10, region: [0.1, 0.1, 0.9, 0.4] }], fileOf), "paper");
  assert.equal(iconKind([{ file: IMG }, { file: PDF }], fileOf), "paper");
  assert.equal(iconKind([{ file: IMG }, { file: PDF, page: 3, region: [0, 0, 1, 0.2] }], fileOf), "paper");
  // a file the library has no record of counts as a paper
  assert.equal(iconKind([{ file: GONE }, { file: IMG }], fileOf), "paper");
  // the text never counts: there is no text to give it, and no mark for words of its own
  assert.equal(iconKind.length, 2);
  // the count: what it carries, files and clips alike, where more than one
  assert.equal(carryCount(undefined), null);
  assert.equal(carryCount([]), null);
  assert.equal(carryCount([{ file: PDF }]), null);
  assert.equal(carryCount([{ file: PDF }, { file: IMG }]), 2);
  assert.equal(carryCount([{ file: PDF, page: 2, region: [0, 0, 1, 0.5] }, { file: PDF, page: 3, region: [0, 0, 1, 0.5] }, { file: IMG }]), 3);
});

const ROOM: Box = { x0: 0, y0: 0, x1: 1000, y1: 700 };

test("a card hangs up and to the right by default, flipped to stay on the screen and off its cluster's name, and never covers its icon", () => {
  const [w, h] = [200, 80];
  const off = defaultCard(w, h);
  // its corner nearest the icon CARD_GAP right of and above the icon's centre
  const at = hangCard([500, 400], off, w, h, ROOM);
  assert.equal(at.flip, 0);
  assert.deepEqual(at.box, { x0: 500 + CARD_GAP, y0: 400 - CARD_GAP - h, x1: 500 + CARD_GAP + w, y1: 400 - CARD_GAP });
  // near the right edge: mirrored across; near the top: below; in the top right corner: both
  assert.equal(hangCard([900, 400], off, w, h, ROOM).flip, 1);
  assert.ok(hangCard([900, 400], off, w, h, ROOM).box.x1 <= 900 - CARD_GAP);
  assert.equal(hangCard([500, 50], off, w, h, ROOM).flip, 2);
  assert.equal(hangCard([900, 50], off, w, h, ROOM).flip, 3);
  // where the screen has room for it nowhere, the way that has the most of it there
  const tight = hangCard([60, 60], off, w, h, { x0: 0, y0: 0, x1: 300, y1: 200 });
  assert.equal(tight.flip, 2, "below and to the right, where most of it is on the screen");
  // off its cluster's name where it can: the name above and to the right of the icon sends it left
  const name: Box = { x0: 480, y0: 290, x1: 620, y1: 310 };
  assert.equal(hangCard([500, 400], off, w, h, ROOM, name).flip, 1);
  // ...but staying on the screen comes first
  assert.equal(hangCard([150, 400], off, w, h, ROOM, { x0: 150, y0: 200, x1: 400, y1: 380 }).flip, 2);
  // a card never covers its icon: an offset that would is pushed out along its own direction
  for (const o of [[0, 0], [10, -5], [-30, 2], [0, 30]] as [number, number][]) {
    const c = clearOfIcon(o, w, h);
    const b = cardBox(0, 0, c, w, h);
    const covers = b.x0 < ICON_R && b.x1 > -ICON_R && b.y0 < ICON_R && b.y1 > -ICON_R;
    assert.ok(!covers, `${o} → ${c}`);
    if (o[0] || o[1]) assert.ok(c[0] * o[0] >= 0 && c[1] * o[1] >= 0, "the same way out");
  }
  // the leader runs from the icon's edge to the card's nearest point
  const [x0, y0, x1, y1] = leaderLine(500, 400, at.box)!;
  assert.ok(Math.abs(Math.hypot(x0 - 500, y0 - 400) - ICON_R) < 1e-9);
  assert.deepEqual([x1, y1], [500 + CARD_GAP, 400 - CARD_GAP]);
  // on the ring it hangs outward: to the right at three o'clock, above at noon
  const right = cardBox(0, 0, ringCard(0, w, h), w, h);
  assert.ok(right.x0 > ICON_R && Math.abs((right.y0 + right.y1) / 2) < 1e-9);
  const top = cardBox(0, 0, ringCard(-Math.PI / 2, w, h), w, h);
  assert.ok(top.y1 < -ICON_R && Math.abs((top.x0 + top.x1) / 2) < 1e-9);
});

test("a card dragged keeps its offset from the icon, in whole pixels of the screen, clear of the icon and within reach", () => {
  // let go with its centre 150 px right of and 90 px above the icon
  assert.deepEqual(keptCard([400, 300], [550.4, 209.6], 200, 80), [150, -90]);
  // dropped on its icon: pushed clear of it
  const on = keptCard([400, 300], [410, 300], 200, 80);
  assert.ok(Math.abs(on[0]) >= 100 + ICON_R, `${on}`);
  // dragged far: within CARD_REACH either way
  assert.deepEqual(keptCard([0, 0], [5000, -9000], 200, 80), [CARD_REACH, -CARD_REACH]);
  // the offset it keeps is as the card hangs where it was let go, whichever way it was flipped then
  const kept = keptCard([900, 400], [700, 330], 200, 80);
  assert.deepEqual(kept, [-200, -70]);
  assert.deepEqual(hangCard([900, 400], kept, 200, 80, ROOM).box, cardBox(900, 400, kept, 200, 80));
});

/** A server's views in a site directory of their own, with the timeline they write. */
function server(dir: string) {
  const sent: { event: string; data: Json }[] = [];
  const events: StoredEvent[] = [];
  const timeline = { events, add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: new Date().toISOString() } as StoredEvent), events[events.length - 1]) };
  const views = new Views(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data: data as Json }), timeline);
  const ask = (path: string, body: unknown, name: string | null = "Alice") =>
    views.handle({ method: "POST", path, query: new URLSearchParams(), body, caller: { name, kind: "person" } } as Ask, "full");
  return { views, sent, events, ask };
}

const pnote = (id: string, over: Partial<ProjectNote> = {}): ProjectNote => ({ id, text: `note ${id}`, places: { namespace: { in: [["N.A", 0.5, -0.25], ["N", 0.5, -0.1]] }, module: { ring: 90 } }, open: true, by: "Alice", at: "2026-10-11T10:00:00.000Z", ...over });
const vnote = (id: string, over: Partial<StickyNote> = {}): StickyNote => ({ id, text: `note ${id}`, place: { mode: "namespace", in: [["A.B", 3, 4], ["A", 13, 24]], world: [113, 224] }, open: true, by: "Alice", at: "2026-10-11T10:00:00.000Z", ...over });

test("a card's offset is the note's own and shared, as its open state is: no name, no event, kept and read back, and never its place", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-card-"));
  try {
    const S = server(dir);
    assert.equal(S.ask("/api/views/notes", { ops: [{ op: "pnote", note: pnote("n1") }] }).status, 200);
    const places = structuredClone(S.views.book.notes[0].places);
    // a card dragged: its offset, sent by a reader without a name, as opening a note is
    assert.equal(S.ask("/api/views/notes", { ops: [{ op: "pnote-card", id: "n1", card: [180.4, -95.6] }] }, null).status, 200);
    assert.deepEqual(S.views.book.notes[0].card, [180, -96], "whole pixels");
    // the card's offset never moves the note: its places stay as they were, under both clusterings
    assert.deepEqual(S.views.book.notes[0].places, places);
    // every page is told, and applies it the same way
    const out = S.sent.filter((s) => s.event === "note-ops").at(-1)!.data;
    const page = [pnote("n1")];
    for (const o of out.ops) applyProjectNoteOp(page, o);
    assert.deepEqual(page[0].card, [180, -96]);
    assert.deepEqual(page[0].places, places);
    // no event of the timeline: only writing, editing and deleting are
    assert.deepEqual(S.events.filter((e) => e.kind === "note").map((e) => (e as Json).what), ["created"]);
    // kept in views.json and read back
    assert.deepEqual(new Views(dir, LAYOUT_VERSION, () => {}).book.notes[0].card, [180, -96]);
    // back to the default; the same again changes nothing
    S.ask("/api/views/notes", { ops: [{ op: "pnote-card", id: "n1", card: null }] }, null);
    assert.equal(S.views.book.notes[0].card, undefined);
    assert.equal(applyProjectNoteOp(S.views.book.notes, { op: "pnote-card", id: "n1", card: null }), false);
    // out of reach, or not a pair: refused
    for (const card of [[CARD_REACH + 1, 0], [0], ["1", 2], [NaN, 0], { x: 1, y: 2 }]) assert.ok(invalidProjectNoteOps([{ op: "pnote-card", id: "n1", card }]), JSON.stringify(card));
    assert.equal(S.ask("/api/views/notes", { ops: [{ op: "pnote-card", id: "n1", card: [9999, 0] }] }).status, 400);
    // a view's own note has one too, changed by the view's operations
    assert.equal(S.ask("/api/views/arrange", { id: PROJECT, ops: [{ op: "note", note: vnote("v1") }] }).status, 200);
    assert.equal(S.ask("/api/views/arrange", { id: PROJECT, ops: [{ op: "note-card", id: "v1", card: [-150, 60] }] }, null).status, 200);
    const v = S.views.book.project().notes!.find((n) => n.id === "v1")!;
    assert.deepEqual(v.card, [-150, 60]);
    assert.deepEqual(v.place, vnote("v1").place, "its place as it was");
    assert.ok(invalidNoteOp({ op: "note-card", id: "v1", card: [0, -601] }));
    const mine = [vnote("v1")];
    assert.equal(applyNoteOp(mine, { op: "note-card", id: "v1", card: [-150, 60] }), true);
    assert.equal(applyNoteOp(mine, { op: "note-card", id: "v1", card: [-150, 60] }), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // made the other kind, a note keeps where its card hangs; read back with care
  const p = pnote("n2", { card: [120, -80] });
  assert.deepEqual(asViewNote(p, vnote("x").place).card, [120, -80]);
  assert.deepEqual(asProjectNote(vnote("v2", { card: [-40, 90] }), "namespace", { ring: 0 }).card, [-40, 90]);
  assert.deepEqual(cleanProjectNotes([{ ...pnote("n3"), card: [1e9, 0] }, { ...pnote("n4"), card: [10.6, -20] }]).map((n) => n.card), [undefined, [11, -20]]);
  assert.deepEqual(cleanNotes([{ ...vnote("v3"), card: "far" }]).map((n) => n.card), [undefined]);
});

/** A layout by hand: clusters [key, parent, x, y, r] in world coordinates, and each node's cluster. */
function layout(clusters: [string, number, number, number, number][], cluster: number[]): Layout {
  const depth = (c: number): number => (clusters[c][1] < 0 ? 0 : depth(clusters[c][1]) + 1);
  return {
    x: [], y: [], lx: [], ly: [], cluster,
    clusters: clusters.map(([key, parent, x, y, r], c) => ({ key, label: key, parent, depth: depth(c), x, y, lx: 0, ly: 0, r, count: 0, ext: false })),
  };
}
const NODES: ViewNode[] = [
  { name: "N.A.t", kind: "theorem", module: "N.A", ax: 0 },
  { name: "N.A.d", kind: "def", module: "N.C", ax: 0 },
  { name: "N.B.e", kind: "def", module: "N.A", ax: 0 },
  { name: "N.B.x", kind: "def", module: "N.C", ax: 0 },
];

test("while its icon is dragged, what would hold the note is lit: the cluster it would go in, the ring for a project note at the top level, nothing for a view note there", () => {
  const L = layout([["N", -1, 0, 0, 100], ["N.A", 0, 30, 0, 40], ["N.B", 0, -40, 0, 30]], [1, 1, 2, 2]);
  const nb = noteBoard(L, "namespace", NODES);
  const drawn: PlaceCluster[] = L.clusters.map((c) => ({ key: c.key, parent: c.parent, depth: c.depth, x: c.x, y: c.y, r: c.r, open: true }));
  const index = (key: string) => L.clusters.findIndex((c) => c.key === key);
  const stands = (key: string) => nb.stands.get(key);
  // a project note over N.A: N.A lit, as the place it would take says
  const inA = placeIn([40, 5], drawn, nb)!;
  assert.deepEqual(dropTarget({ kind: "project", place: inA }, stands, index), { at: "cluster", c: 1 });
  // over N, outside its sub-clusters: N
  assert.deepEqual(dropTarget({ kind: "project", place: placeIn([0, 80], drawn, nb)! }, stands, index), { at: "cluster", c: 0 });
  // where no cluster is: the ring
  assert.equal(placeIn([400, 0], drawn, nb), null);
  assert.deepEqual(dropTarget({ kind: "project", place: { ring: 90 } }, stands, index), { at: "ring" });
  // a view note over N.B: N.B; at the top level it is on the canvas, and nothing is lit
  assert.deepEqual(dropTarget({ kind: "view", place: placeAt("namespace", [-40, 5], drawn) }, stands, index), { at: "cluster", c: 2 });
  assert.equal(dropTarget({ kind: "view", place: placeAt("namespace", [400, 0], drawn) }, stands, index), null);
  // nowhere to go (the board not drawn yet): nothing
  assert.equal(dropTarget(null, stands, index), null);
});

test("zoomed out, a note's card is hidden and its icon stays; a fold hides both", () => {
  // expanded, in a cluster large enough on the screen: its icon and its card
  assert.equal(noteShows(true, AUTO_COLLAPSE_PX), "open");
  // its cluster under 120 px on the screen: the icon alone, whatever its state
  assert.equal(noteShows(true, AUTO_COLLAPSE_PX - 1), "shut");
  // collapsed: the icon alone at any zoom
  assert.equal(noteShows(false, 2000), "shut");
  // a view note on the canvas is never hidden for the zoom
  assert.equal(noteShows(true, null), "open");
  // in a folded cluster, or one the board does not draw: neither, the fold counts it
  assert.equal(noteShows(true, 2000, true), "hidden");
});

test("Fit to screen frames the notes' icons, and their cards where they fit", () => {
  // the board: 200 × 100 in the world; a note's icon on its right edge, its card hanging to the right
  const board: FitBox[] = [
    { x: -100, y: -50, dx0: 0, dy0: 0, dx1: 0, dy1: 0 },
    { x: 100, y: 50, dx0: 0, dy0: 0, dx1: 0, dy1: 0 },
  ];
  const card = { off: [CARD_GAP + 150, -(CARD_GAP + 40)] as [number, number], w: 300, h: 80 };
  const icon = { x: 100, y: 0, card: () => card };
  const alone = fitFrame(() => board, 800, 600, 4)!;
  assert.equal(alone.k, 4);
  // icons alone: the icon's box, ICON_R around its point
  const icons = noteBoxes([icon], 4, false);
  assert.deepEqual(icons, [{ x: 100, y: 0, dx0: -ICON_R, dy0: -ICON_R, dx1: ICON_R, dy1: ICON_R }]);
  const withIcons = fitFrame((k) => [...board, ...noteBoxes([icon], k, false)], 800, 600, 4)!;
  assert.ok(withIcons.k < alone.k, "zoomed out a little for the icon on the board's edge");
  // with the cards: further out, the card inside the room
  const withCards = fitFrame((k) => [...board, ...noteBoxes([icon], k, true)], 800, 600, 4)!;
  assert.ok(withCards.k < withIcons.k);
  const right = 100 * withCards.k + card.off[0] + card.w / 2 - withCards.x * withCards.k;
  assert.ok(Math.abs(right - 400) < 1, `the card's right edge at the room's: ${right}`);
  // a card shown only at zooms where its note is expanded: none asked for, none framed
  assert.deepEqual(noteBoxes([{ x: 0, y: 0, card: () => null }], 1, true).length, 1);
  // a card larger than the room: the cards cannot be framed, the icons can (the canvas then frames
  // those, web/src/canvas.ts fit)
  const huge = { x: 100, y: 0, card: () => ({ off: [0, -700] as [number, number], w: 300, h: 1200 }) };
  assert.equal(fitFrame((k) => [...board, ...noteBoxes([huge], k, true)], 800, 600, 4), null);
  assert.ok(fitFrame((k) => [...board, ...noteBoxes([huge], k, false)], 800, 600, 4));
});
