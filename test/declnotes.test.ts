// Notes attached to declarations, and icons that scale with what they belong to (the owner's
// decisions of 2026-10-12; AttachmentSpec decisions 12–19, CanvasSpec "Notes"): the `decl` field
// kept by every operation, the switch between kinds and the store; its offset a place on the board,
// in its units; attaching and detaching by a drop; shown wherever the declaration is, under both
// clusterings, a visitor counting and a past board reading that build's names; renames followed, and
// the ring when the declaration is gone (the owner's decision of 2026-10-30); agents attaching and detaching; the dot/icon rule, one
// for a cluster's notes and the notes attached to its declarations (shared/notecard.ts); the layer's
// stacking, cards over icons.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { noteEndpoints } from "../src/server/agentnotes.ts";
import type { Answer, World } from "../src/server/agent.ts";
import { refusal } from "../src/server/agent.ts";
import { Presence } from "../src/server/presence.ts";
import { Views } from "../src/server/views.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { clusterTree, computeLayout } from "../src/shared/layout.ts";
import { AUTO_COLLAPSE_PX } from "../src/shared/sticky.ts";
import { BLEND_OCTAVES, cardZ, DECL_CLEAR_PX, declDrop, declLeader, declsPointable, declSpot, dropTarget, ICON_R, iconShare, inZone, levelOf, markClick, markLook, markR, NOTE_Z, noteBoxes, pointPx, POINT_MIN_PX, POINT_UNITS, raiseCard, STACK_MOST, zonePx } from "../src/shared/notecard.ts";
import { declOf, declPlace, derivesOn, existsIn, itemsShownOn, itemSpot, itemWhy, noteBoard, placeIn, viewSpot } from "../src/shared/noteplace.ts";
import { applyProjectNoteOp, asProjectNote, asViewNote, cleanProjectNotes, invalidProjectNoteOps } from "../src/shared/projectnotes.ts";
import type { ProjectNote, ProjectNoteOp } from "../src/shared/projectnotes.ts";
import { parseQuery } from "../src/shared/query.ts";
import { emptyReview } from "../src/shared/review.ts";
import { applyNoteOp, cleanNotes, DECL_AT, DECL_FAR, DECL_NEAR, DECL_REACH, invalidNoteOp, keptDecl, placeAt, ZONE_MAX_PX, ZONE_MIN_PX, ZOOM_LEAST, ZOOM_MOST } from "../src/shared/sticky.ts";
import type { NoteDecl, NoteOp, PlaceCluster, StickyNote } from "../src/shared/sticky.ts";
import type { NewEvent, StoredEvent } from "../src/shared/timeline.ts";
import { PROJECT, ViewBook } from "../src/shared/views.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Four declarations: namespaces N.A (t, d) and N.B (e, x); folders N.A (t, e) and N.C (d, x). */
const NODES: ViewNode[] = [
  { name: "N.A.t", kind: "theorem", module: "N.A", ax: 0 },
  { name: "N.A.d", kind: "def", module: "N.C", ax: 0 },
  { name: "N.B.e", kind: "def", module: "N.A", ax: 0 },
  { name: "N.B.x", kind: "def", module: "N.C", ax: 0 },
];
const DECL: NoteDecl = { name: "N.A.t", at: [30, -40] };
const pnote = (id: string, over: Partial<ProjectNote> = {}): ProjectNote => ({ id, text: `note ${id}`, places: {}, open: true, by: "Alice", at: "2026-10-12T10:00:00.000Z", ...over });
const vnote = (id: string, over: Partial<StickyNote> = {}): StickyNote => ({ id, text: `note ${id}`, place: { mode: "namespace", in: [["N.B", 1, 2]], world: [0, 0] }, open: true, by: "Alice", at: "2026-10-12T10:00:00.000Z", ...over });
/** A board of `nodes` by `mode`, laid out as the tree has it. */
const board = (nodes: ViewNode[], mode: ClusterMode) => noteBoard(clusterTree(mode, nodes) as unknown as Layout, mode, nodes);

test("the decl field: kept by every operation, the switch between kinds and the store; refused where it cannot be read", () => {
  // a project note attached, then everything else done to it
  const notes: ProjectNote[] = [];
  assert.equal(invalidProjectNoteOps([{ op: "pnote", note: pnote("p", { decl: DECL }) }]), null);
  applyProjectNoteOp(notes, { op: "pnote", note: pnote("p", { decl: DECL, places: { namespace: { in: [["N.A", 0.1, 0.1]] } } }) });
  const ops: ProjectNoteOp[] = [
    { op: "pnote-edit", id: "p", text: "edited", carries: [{ file: "a".repeat(64) }] },
    { op: "pnote-move", id: "p", mode: "module", place: { in: [["N.A", 0, 0]] } },
    { op: "pnote-move", id: "p", mode: "namespace", place: null },
    { op: "pnote-open", id: "p", open: false },
    { op: "pnote-card", id: "p", card: [40, -60] },
  ];
  for (const o of ops) {
    assert.equal(invalidProjectNoteOps([o]), null);
    applyProjectNoteOp(notes, o);
    assert.deepEqual(notes[0].decl, DECL, o.op);
  }
  // its own operation moves it, and takes it away
  assert.ok(applyProjectNoteOp(notes, { op: "pnote-decl", id: "p", decl: { name: "N.B.e", at: [0, 40] } }));
  assert.deepEqual(notes[0].decl, { name: "N.B.e", at: [0, 40] });
  assert.equal(applyProjectNoteOp(notes, { op: "pnote-decl", id: "p", decl: { name: "N.B.e", at: [0, 40] } }), false, "the same again changes nothing");
  // the store: read back as written, an offset kept within DECL_FAR in the board's units, to a
  // tenth of a unit; one beyond it brought within it, still attached
  assert.deepEqual(cleanProjectNotes(JSON.parse(JSON.stringify(notes)))[0].decl, { name: "N.B.e", at: [0, 40] });
  assert.deepEqual(cleanProjectNotes([{ ...notes[0], decl: { name: "N.A.t", at: [3, 4] } }])[0].decl, { name: "N.A.t", at: [7.2, 9.6] }, "too near the point: pushed out to DECL_NEAR");
  assert.deepEqual(cleanProjectNotes([{ ...notes[0], decl: { name: "N.A.t", at: [96, 0] } }])[0].decl, { name: "N.A.t", at: [96, 0] }, "beyond the reach, within DECL_FAR: kept as it is");
  assert.deepEqual(cleanProjectNotes([{ ...notes[0], decl: { name: "N.A.t", at: [DECL_FAR + 600, 0] } }])[0].decl, { name: "N.A.t", at: [DECL_FAR, 0] }, "beyond DECL_FAR: brought within, still attached");
  assert.equal(cleanProjectNotes([{ ...notes[0], decl: { name: "", at: [0, 0] } }])[0].decl, undefined, "a decl that cannot be read is dropped, the note kept");
  // the switch keeps it, both ways
  const v = asViewNote(notes[0], { mode: "namespace", in: [], world: [1, 2] });
  assert.deepEqual(v.decl, notes[0].decl);
  assert.deepEqual(asProjectNote(v, "module", { ring: 10 }).decl, notes[0].decl);
  // and the book's switch, which every page applies
  const book = new ViewBook([], [pnote("q", { decl: DECL })]);
  const r = book.switchNote("q", PROJECT, "view", { mode: "namespace", in: [], world: [0, 0] }, "namespace");
  assert.ok(typeof r !== "string");
  assert.deepEqual(book.project().notes![0].decl, DECL);
  assert.ok(typeof book.switchNote("q", PROJECT, "project", { in: [["N.A", 0, 0]] }, "namespace") !== "string");
  assert.deepEqual(book.notes[0].decl, DECL);
  assert.equal(applyProjectNoteOp(notes, { op: "pnote-decl", id: "p", decl: null }), true);
  assert.equal(notes[0].decl, undefined);
  // a view note: the same
  const vs: StickyNote[] = [];
  applyNoteOp(vs, { op: "note", note: vnote("v", { decl: DECL }) });
  const vops: NoteOp[] = [
    { op: "note-edit", id: "v", text: "x" },
    { op: "note-move", id: "v", place: { mode: "module", in: [], world: [5, 5] } },
    { op: "note-open", id: "v", open: false },
    { op: "note-card", id: "v", card: null },
  ];
  for (const o of vops) {
    assert.equal(invalidNoteOp(o as unknown as Record<string, unknown>), null);
    applyNoteOp(vs, o);
    assert.deepEqual(vs[0].decl, DECL, o.op);
  }
  assert.deepEqual(cleanNotes(JSON.parse(JSON.stringify(vs)))[0].decl, DECL);
  applyNoteOp(vs, { op: "note-decl", id: "v", decl: null });
  assert.equal(vs[0].decl, undefined);
  // refused: no name, a name over lines, an offset beyond DECL_FAR, not a pair
  for (const decl of [{ name: "", at: [0, 0] }, { name: "a\nb", at: [0, 0] }, { name: "N.A.t", at: [DECL_FAR + 5, 0] }, { name: "N.A.t", at: [1] }, "N.A.t"])
    assert.notEqual(invalidProjectNoteOps([{ op: "pnote-decl", id: "p", decl }]), null, JSON.stringify(decl));
});

test("the offset is a place on the board, in its units: it scales with the zoom; the default and how far it is kept", () => {
  // the note's spot is its declaration's point and its offset, in the board's world; on the screen
  // its distance from the point is the offset times the zoom, as a node's from another is
  const point: [number, number] = [500, -200];
  const at: [number, number] = [30, -40];
  assert.deepEqual(declSpot(point, at), [530, -240]);
  const onScreen = (w: [number, number], k: number, cam: [number, number] = [480, -180]) => [(w[0] - cam[0]) * k + 720, (w[1] - cam[1]) * k + 450];
  for (const k of [0.05, 0.3, 1, 4, 12]) {
    const [px, py] = onScreen(point, k), [ix, iy] = onScreen(declSpot(point, at), k);
    assert.ok(Math.abs(Math.hypot(ix - px, iy - py) - 50 * k) < 1e-9, `${k}: 50 units are ${50 * k} px`);
  }
  // zoomed out, it comes closer on the screen: half the zoom, half the distance
  assert.ok(Math.abs(Math.hypot(onScreen(declSpot(point, at), 0.5)[0] - onScreen(point, 0.5)[0], onScreen(declSpot(point, at), 0.5)[1] - onScreen(point, 0.5)[1]) * 2 - 50) < 1e-9);
  // the default: up and to the right, about three declarations away (a point is 10 units across)
  assert.deepEqual(DECL_AT, [24, -24]);
  assert.ok(Math.hypot(...DECL_AT) > 3 * POINT_UNITS && Math.hypot(...DECL_AT) < 4 * POINT_UNITS);
  // at the zoom a click on a declaration flies to (1.1), the default leaves room for the leader
  assert.ok(declLeader([0, 0], [DECL_AT[0] * 1.1, DECL_AT[1] * 1.1], ICON_R, pointPx(1.1)));
  // kept: along its direction, between DECL_NEAR and DECL_FAR units, to a tenth of a unit; right on
  // the point, the default
  assert.deepEqual([DECL_NEAR, DECL_REACH, DECL_FAR], [12, 64, 2400]);
  assert.deepEqual(keptDecl([0, 0]), DECL_AT);
  assert.deepEqual(keptDecl([3, 4]), [7.2, 9.6]);
  assert.deepEqual(keptDecl([300, 400]), [300, 400]);
  assert.deepEqual(keptDecl([3000, 4000]), [1440, 1920]);
  assert.deepEqual(keptDecl([30.44, -40.66]), [30.4, -40.7]);
  // a drop's push out from the point is never further than the reach
  assert.deepEqual(keptDecl([1, 0], 500), [DECL_REACH, 0]);
  // refused beyond DECL_FAR, in units; within it, taken
  assert.equal(invalidNoteOp({ op: "note-decl", id: "v", decl: { name: "N.A.t", at: [DECL_FAR, 0] } }), null);
  assert.notEqual(invalidNoteOp({ op: "note-decl", id: "v", decl: { name: "N.A.t", at: [DECL_FAR + 1, 0] } }), null);
});

test("the circle round an attached note's declaration while it is dragged: the reach on the screen, held between 48 and 160 px", () => {
  assert.deepEqual([ZONE_MIN_PX, ZONE_MAX_PX], [48, 160]);
  // zoomed in, never huge: 160 px from a zoom of 2.5; at the most zoom, 160 px for 64 units' 768
  for (const k of [2.5, 4, 8, ZOOM_MOST]) assert.equal(zonePx(k), 160, `${k}`);
  // zoomed out, never tiny: 48 px up to a zoom of 0.75, where 64 units are 19 px at 0.3 and 1.3 at 0.02
  for (const k of [ZOOM_LEAST, 0.1, 0.3, 0.6, 0.75]) assert.equal(zonePx(k), 48, `${k}`);
  // between, the reach as the zoom draws it
  for (const k of [0.8, 1, 1.1, 2]) assert.ok(Math.abs(zonePx(k) - DECL_REACH * k) < 1e-9, `${k}`);
  // at every zoom: within the clamp, and consistent with the offsets kept — the farthest point of
  // the circle is an offset kept as it is, and a drop's push out from the point stays inside it
  for (let k = ZOOM_LEAST; k <= ZOOM_MOST; k *= 1.05) {
    const r = zonePx(k);
    assert.ok(r >= ZONE_MIN_PX && r <= ZONE_MAX_PX, `${k}`);
    assert.ok(r / k <= DECL_FAR + 1e-9, `${k}: the circle's ${r / k} units are within DECL_FAR`);
    const edge = keptDecl([r / k / Math.SQRT2, -r / k / Math.SQRT2]);
    assert.ok(Math.abs(Math.hypot(...edge) - Math.max(DECL_NEAR, r / k)) < 0.1, `${k}: the circle's edge kept where it is`);
    for (const icon of [[1, 0], [0.01, 0]] as [number, number][]) {
      const pushed = declDrop(icon, null, { j: 0, at: [0, 0] }, k)!;
      assert.ok(pushed.stay && Math.hypot(...pushed.d) * k <= r + 0.1 * k, `${k}: pushed out to ${Math.hypot(...pushed.d) * k} px, inside ${r}`);
    }
  }
  // inside or out, by the icon's centre on the board
  assert.ok(inZone([40, 30], [0, 0], 1), "50 units at a zoom of 1: 50 px, inside 64");
  assert.ok(!inZone([40, 30], [0, 0], 4), "50 units at a zoom of 4: 200 px, out of 160");
  assert.ok(inZone([80, 60], [0, 0], 0.3), "100 units at a zoom of 0.3: 30 px, inside 48");
});

test("attach and detach by a drop: another declaration under the icon wins; inside the circle round its own it stays; out of it it is placed as a free note is", () => {
  // where it is let go, in the board's world
  const icon: [number, number] = [100, 100];
  // let go on a declaration: attached on the side it was let go, pushed out until it clears the point
  // on the screen at the zoom it was let go at (DECL_CLEAR_PX), and DECL_NEAR at least
  assert.equal(DECL_CLEAR_PX, 40);
  assert.deepEqual(declDrop(icon, { j: 3, at: [104, 100] }, null, 1), { j: 3, d: [-40, 0], stay: false });
  assert.deepEqual(declDrop(icon, { j: 3, at: [104, 100] }, null, 2), { j: 3, d: [-20, 0], stay: false }, "zoomed in, nearer on the board, as far on the screen");
  assert.deepEqual(declDrop(icon, { j: 3, at: [104, 100] }, null, 8), { j: 3, d: [-DECL_NEAR, 0], stay: false }, "never nearer than DECL_NEAR");
  assert.deepEqual(declDrop(icon, { j: 3, at: [104, 100] }, null, 0.6), { j: 3, d: [-DECL_REACH, 0], stay: false }, "pushed out never further than DECL_REACH");
  // another declaration under the icon wins over the circle round its own, inside it or not
  assert.deepEqual(declDrop(icon, { j: 3, at: [104, 100] }, { j: 1, at: [130, 100] }, 1), { j: 3, d: [-40, 0], stay: false }, "inside the circle (30 px of 64)");
  assert.deepEqual(declDrop(icon, { j: 3, at: [104, 100] }, { j: 1, at: [900, 100] }, 1), { j: 3, d: [-40, 0], stay: false }, "far out of it");
  // its own under the icon: inside its circle, it stays, pushed out
  assert.deepEqual(declDrop(icon, { j: 1, at: [104, 100] }, { j: 1, at: [104, 100] }, 1), { j: 1, d: [-40, 0], stay: true });
  // let go right on a point: up and to the right, as by default, as far out as any drop — zoomed in,
  // nearer than the default, which would be out of the circle there
  assert.deepEqual(declDrop(icon, { j: 3, at: [100, 100] }, null, 1), { j: 3, d: [28.3, -28.3], stay: false });
  assert.deepEqual(declDrop(icon, null, { j: 1, at: [100, 100] }, 8), { j: 1, d: [8.5, -8.5], stay: true });
  assert.ok(Math.hypot(...DECL_AT) * 8 > zonePx(8));
  // inside the circle round its own: it stays attached, at the offset it was let go at
  assert.deepEqual(declDrop(icon, null, { j: 1, at: [130, 140] }, 1), { j: 1, d: [-30, -40], stay: true }, "50 px of 64");
  assert.deepEqual(declDrop(icon, null, { j: 1, at: [100 + DECL_REACH, 100] }, 1), { j: 1, d: [-DECL_REACH, 0], stay: true }, "on the edge");
  assert.deepEqual(declDrop(icon, null, { j: 1, at: [130, 140] }, 3), { j: 1, d: [-30, -40], stay: true }, "150 px of 160");
  // zoomed out, the circle is 48 px: further than the reach on the board, and still kept as let go
  assert.deepEqual(declDrop(icon, null, { j: 1, at: [220, 100] }, 0.3), { j: 1, d: [-120, 0], stay: true }, "120 units, 36 px of 48");
  assert.deepEqual(declDrop(icon, null, { j: 1, at: [100 + 2000, 100] }, ZOOM_LEAST), { j: 1, d: [-2000, 0], stay: true }, "the least zoom: 2,000 units, 40 px of 48");
  // out of the circle: detached, placed as a free note is — zoomed in, a short way out is enough
  assert.equal(declDrop(icon, null, { j: 1, at: [130, 140] }, 4), null, "50 units at 4: 200 px, out of 160");
  assert.equal(declDrop(icon, null, { j: 1, at: [100, 100 + 41] }, ZOOM_MOST), null, "41 units at 12: 492 px, out of 160");
  for (const k of [0.6, 1, 2]) assert.equal(declDrop(icon, null, { j: 1, at: [100 + zonePx(k) / k + 1, 100] }, k), null, `${k}`);
  assert.equal(declDrop(icon, null, { j: 1, at: [100 + 161, 100] }, 0.3), null, "zoomed out: 161 units at 0.3, just out of 48 px");
  // a free note: only a declaration under it takes it, with no circle
  assert.equal(declDrop(icon, null, null, 1), null);
  assert.deepEqual(declDrop(icon, { j: 3, at: [104, 100] }, null, 1)?.stay, false);
  // what a page sends for a drop, applied: attached with its places beside the declaration under
  // both clusterings; detached into a cluster's free space, its place there
  const notes = [pnote("n", { places: { namespace: { ring: 90 } } })];
  for (const o of [
    { op: "pnote-decl", id: "n", decl: { name: "N.A.t", at: [18, -18] } },
    { op: "pnote-move", id: "n", mode: "namespace", place: { in: [["N.A", 0.2, -0.2], ["N", 0.3, -0.1]] } },
    { op: "pnote-move", id: "n", mode: "module", place: { in: [["N.A", 0.1, 0.1]] } },
  ] as ProjectNoteOp[])
    applyProjectNoteOp(notes, o);
  assert.deepEqual([notes[0].decl?.name, notes[0].places.namespace, notes[0].places.module], ["N.A.t", { in: [["N.A", 0.2, -0.2], ["N", 0.3, -0.1]] }, { in: [["N.A", 0.1, 0.1]] }]);
  for (const o of [{ op: "pnote-decl", id: "n", decl: null }, { op: "pnote-move", id: "n", mode: "namespace", place: { in: [["N.B", 0.5, 0]] } }] as ProjectNoteOp[]) applyProjectNoteOp(notes, o);
  assert.deepEqual([notes[0].decl, notes[0].places.namespace], [undefined, { in: [["N.B", 0.5, 0]] }]);
  // the fallback beside a declaration under the other clustering, read on a layout at rest
  const L = computeLayout("module", NODES, new Int32Array(0));
  const p = declPlace(L, 0, [9, -9])!;
  assert.equal(p.in[0][0], "N.A", "N.A.t is in the folder N.A");
  assert.ok(p.in.every(([, x, y]) => Math.hypot(x, y) <= 1), "each spot inside its circle");
  // a drop draws its leader to the point and a diamond on the point's rim; too near for one, none
  const g = declLeader([0, 0], [30, -40], ICON_R, 3)!;
  assert.deepEqual(g.mark.map((v) => Math.round(v * 10) / 10), [4.5, -6]);
  assert.equal(declLeader([0, 0], [10, 0], ICON_R, 3), null);
  // the diamond scales with the icon as it turns into its dot: nearer the rim, as small
  const half = declLeader([0, 0], [30, -40], markR(0.5, 1), 3, markR(0.5, 1) / ICON_R)!;
  assert.ok(Math.hypot(...half.mark) < Math.hypot(...g.mark) && Math.hypot(...half.mark) > 3);
});

test("out of the circle, an attached note is dragged as a free note is: the cluster under it, the ring, or the canvas; inside, the circle wins over the cluster round it", () => {
  // N round the board; N.A holds N.A.t, whose point is at (100, 0); N.B beside it
  const L: Layout = {
    x: [], y: [], lx: [], ly: [], cluster: [1, 1, 2, 2],
    clusters: [
      { key: "N", label: "N", parent: -1, depth: 0, x: 0, y: 0, lx: 0, ly: 0, r: 400, count: 0, ext: false },
      { key: "N.A", label: "N.A", parent: 0, depth: 1, x: 100, y: 0, lx: 0, ly: 0, r: 150, count: 0, ext: false },
      { key: "N.B", label: "N.B", parent: 0, depth: 1, x: -200, y: 0, lx: 0, ly: 0, r: 100, count: 0, ext: false },
    ],
  };
  const nb = noteBoard(L, "namespace", NODES);
  const drawn: PlaceCluster[] = L.clusters.map((c) => ({ key: c.key, parent: c.parent, depth: c.depth, x: c.x, y: c.y, r: c.r, open: true }));
  const stands = (key: string) => nb.stands.get(key);
  const index = (key: string) => L.clusters.findIndex((c) => c.key === key);
  const own = { j: 0, at: [100, 0] as [number, number] };
  /** What a page does with the icon let go at `icon` at zoom `k` (web/src/sticky.ts, dropFor and
   *  aimFor): attached where declDrop says, else where a free note let go there goes, lit as it is. */
  const letGo = (icon: [number, number], k: number, kind: "project" | "view" = "project", under: { j: number; at: [number, number] } | null = null) => {
    const at = declDrop(icon, under, own, k);
    if (at) return at;
    if (kind === "view") return dropTarget({ kind, place: placeAt("namespace", icon, drawn) }, stands, index);
    const inside = placeIn(icon, drawn, nb);
    return dropTarget({ kind, place: inside ?? { ring: 0 } }, stands, index);
  };
  // zoomed in (4: the circle 160 px, 40 units): 50 units off, still in N.A's free space — detached
  // into N.A, lit; 30 units off, inside the circle — it stays, at that offset
  assert.deepEqual(letGo([150, 0], 4), { at: "cluster", c: 1 });
  assert.deepEqual(letGo([130, 0], 4), { j: 0, d: [30, 0], stay: true });
  // out into N's free space, out of N.A: N; past every cluster: the ring; a view note there: nothing,
  // it stays on the canvas
  assert.deepEqual(letGo([100, 250], 4), { at: "cluster", c: 0 });
  assert.deepEqual(letGo([600, 0], 4), { at: "ring" });
  assert.deepEqual(letGo([600, 0], 4, "view"), null);
  assert.deepEqual(letGo([150, 0], 4, "view"), { at: "cluster", c: 1 });
  // zoomed out (0.3: the circle 48 px, 160 units), the circle reaches past N.A into N.B's side of N:
  // inside it, the circle wins over the clusters round it; just out of it, N
  assert.deepEqual(letGo([-40, 0], 0.3), { j: 0, d: [-140, 0], stay: true });
  assert.deepEqual(letGo([-70, 0], 0.3), { at: "cluster", c: 0 });
  // another declaration under the icon takes it, out of the circle or inside it
  assert.deepEqual(letGo([-200, 10], 4, "project", { j: 2, at: [-200, 0] }), { j: 2, d: [0, 12], stay: false });
  assert.deepEqual(letGo([110, 10], 4, "project", { j: 1, at: [110, 0] }), { j: 1, d: [0, 12], stay: false });
  // a drop kept attached is a valid offset, whatever the zoom
  for (const k of [ZOOM_LEAST, 0.3, 1, 4, ZOOM_MOST]) {
    const r = zonePx(k) / k;
    const kept = declDrop([100 + r * 0.6, -r * 0.75], null, own, k)!;
    assert.ok(kept.stay, `${k}`);
    assert.equal(invalidNoteOp({ op: "note-decl", id: "v", decl: { name: "N.A.t", at: kept.d } }), null, `${k}`);
    assert.equal(invalidProjectNoteOps([{ op: "pnote-decl", id: "p", decl: { name: "N.A.t", at: kept.d } }]), null, `${k}`);
  }
  // a free note: no circle — let go on a declaration it is attached, elsewhere placed as ever
  assert.deepEqual(declDrop([110, 10], { j: 1, at: [110, 0] }, null, 4), { j: 1, d: [0, 12], stay: false });
  assert.equal(declDrop([101, 0], null, null, 4), null);
});

test("shown wherever the declaration is, under both clusterings: a visitor counts, a past board reads its build's names, a board without it does not show it", () => {
  const ex = existsIn(NODES);
  // attached to N.A.t, its fallback in N.B
  const n = pnote("a", { decl: DECL, places: { namespace: { in: [["N.B", 0.5, 0]] } } });
  // a view holding N.A.t alone, by namespace and by file: shown, by the attachment, at the declaration
  for (const mode of ["namespace", "module"] as ClusterMode[]) {
    const b = board([NODES[0]], mode);
    assert.equal(itemWhy(n, { all: false }, b, ex, new Map()), "decl", mode);
    assert.deepEqual(itemSpot(n, b, ex), { at: "decl", j: 0, name: "N.A.t", d: [30, -40] }, mode);
  }
  // the Project: at the declaration too, under either clustering
  assert.deepEqual(itemSpot(n, board(NODES, "module"), ex), { at: "decl", j: 0, name: "N.A.t", d: [30, -40] });
  // a view holding N.B, its fallback's cluster, but not N.A.t: not shown — its place is the declaration
  const nb = board(NODES.slice(2), "namespace");
  assert.equal(itemWhy(n, { all: false }, nb, ex, new Map()), null);
  assert.equal(itemWhy(n, { all: false, items: { add: ["a"], remove: [] } }, nb, ex, new Map()), "added");
  assert.deepEqual(itemSpot(n, nb, ex), { at: "ring", angle: null, about: null }, "added there, on the ring");
  // taken out, not shown even where it holds the declaration
  assert.equal(itemWhy(n, { all: false, items: { add: [], remove: ["a"] } }, board(NODES, "namespace"), ex, new Map()), null);
  // a visitor counts
  const withVisitor = { ...nb, visiting: new Set(["N.A.t"]) };
  assert.equal(itemWhy(n, { all: false }, withVisitor, ex, new Map()), "decl");
  assert.deepEqual(itemSpot(n, withVisitor, ex), { at: "decl", j: -1, name: "N.A.t", d: [30, -40] });
  // a board of a past build: the declaration renamed since is read by its name then
  const past: ViewNode[] = [{ ...NODES[0], name: "N.A.old" }, ...NODES.slice(1)];
  const pb = { ...board(past, "namespace"), then: new Map([["N.A.t", "N.A.old"]]) };
  assert.deepEqual(itemSpot(n, pb, existsIn(past)), { at: "decl", j: 0, name: "N.A.old", d: [30, -40] });
  assert.deepEqual(itemsShownOn([n], { all: false }, "namespace", [past[0]], past, [], new Map([["N.A.old", "N.A.t"]])).map((x) => x.id), ["a"], "the export's authors count it on that build");
  assert.equal(derivesOn("namespace", [past[0]], existsIn(past), [], new Map([["N.A.old", "N.A.t"]]))(n), true);
  // a view note: at the declaration under every clustering, else where its place puts it
  const v = vnote("v", { decl: DECL });
  const all = board(NODES, "module");
  assert.deepEqual(viewSpot(v, all, () => -1), { at: "decl", j: 0, name: "N.A.t", d: [30, -40] });
  assert.equal(viewSpot(v, nb, (k) => (k === "N.B" ? 0 : -1)).at, "offset", "its declaration off the board: its place");
});

test("renames followed; the declaration gone with no rename, the note is on the ring, still attached, toward the nearest cluster of its places, back at the declaration when it returns", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-declnotes-"));
  try {
    const events: StoredEvent[] = [];
    const sent: { event: string; data: Json }[] = [];
    const views = new Views(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data: data as Json }), { add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: "" } as StoredEvent), events.at(-1)!) });
    views.arrangeNotes([{ op: "pnote", note: pnote("p", { decl: DECL, places: { namespace: { in: [["N.A", 0.2, 0.2], ["N", 0, 0]] } } }) }], null, "Alice");
    views.arrange(PROJECT, [{ op: "note", note: vnote("v", { decl: DECL }) }], null, "Alice");
    const before = events.length;
    // a rename: both follow it, at the same offset, as no event of the timeline (a move is none)
    const moved = views.moveDeclaration("N.A.t", "N.A.t2", "VisualProof");
    assert.deepEqual(views.book.notes[0].decl, { name: "N.A.t2", at: [30, -40] });
    assert.deepEqual(views.book.project().notes![0].decl, { name: "N.A.t2", at: [30, -40] });
    assert.equal(events.length, before);
    assert.ok(sent.some((s) => s.event === "note-ops" && s.data.ops.some((o: Json) => o.op === "pnote-decl")), "every page told");
    // kept in views.json, and read back
    assert.deepEqual(new Views(dir, LAYOUT_VERSION, () => {}).book.notes[0].decl, { name: "N.A.t2", at: [30, -40] });
    // undone: back where it was, both kinds
    views.unmoveDeclaration("N.A.t", "N.A.t2", moved, "Alice");
    assert.equal(views.book.notes[0].decl?.name, "N.A.t");
    assert.equal(views.book.project().notes![0].decl?.name, "N.A.t");
    // gone with no rename (the owner's decision of 2026-10-30): on the ring, still attached, toward
    // the innermost cluster of its places that is left, shown where its places show it
    const gone = NODES.slice(1);
    const ex = existsIn(gone);
    const n = views.book.notes[0];
    assert.equal(declOf(n, board(gone, "namespace"), ex), "gone");
    assert.deepEqual(itemSpot(n, board(gone, "namespace"), ex), { at: "ring", angle: null, about: { mode: "namespace", key: "N.A" }, gone: "N.A.t" });
    assert.equal(itemWhy(n, { all: false }, board(gone, "namespace"), ex, new Map()), "cluster");
    assert.deepEqual(n.decl, { name: "N.A.t", at: [30, -40] }, "still attached");
    // N.A gone too: toward N, around it
    const less = NODES.slice(2).map((d) => ({ ...d, name: d.name.replace("N.B.", "N.") }));
    assert.deepEqual(itemSpot(n, board(less, "namespace"), existsIn(less)), { at: "ring", angle: null, about: { mode: "namespace", key: "N" }, gone: "N.A.t" });
    // with no place under the board's clustering, toward its cluster under the other
    const placedByModule = { ...n, places: { module: { in: [["N.A", 0.1, 0.1]] as [string, number, number][] } } };
    assert.deepEqual(itemSpot(placedByModule, board(gone, "namespace"), ex), { at: "ring", angle: null, about: { mode: "module", key: "N.A" }, gone: "N.A.t" });
    // none of its clusters left either: the ring, in the order written, toward what it carries a file
    // linked to where it does
    const far = [{ name: "M.z", kind: "def", module: "M", ax: 0 }] as ViewNode[];
    assert.deepEqual(itemSpot(n, board(far, "namespace"), existsIn(far)), { at: "ring", angle: null, about: null, gone: "N.A.t" });
    assert.deepEqual(itemSpot(n, board(far, "namespace"), existsIn(far), ["decl(M.z)"]), { at: "ring", angle: null, about: { links: ["decl(M.z)"] }, gone: "N.A.t" });
    // a view note alike, toward the cluster its place had it in; where the graph is not asked, its
    // place stands as before
    const v = views.book.project().notes![0];
    const index = (nodes: ViewNode[]) => {
      const L = clusterTree("namespace", nodes) as unknown as Layout;
      const keys = new Map(L.clusters.map((c, k) => [c.key, k]));
      return (key: string) => keys.get(key) ?? -1;
    };
    assert.deepEqual(viewSpot(v, board(gone, "namespace"), index(gone), ex), { at: "ring", angle: null, about: { mode: "namespace", key: "N.B" }, gone: "N.A.t" });
    assert.equal(viewSpot(v, board(gone, "namespace"), index(gone)).at, "offset");
    // it comes back: at the declaration again, both kinds
    const back = board(NODES, "namespace");
    assert.equal(itemSpot(n, back, existsIn(NODES)).at, "decl");
    assert.equal(viewSpot(v, back, index(NODES), existsIn(NODES)).at, "decl");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The agents' notes on the small project, laid out as the server lays it out. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "vp-declnotes-agents-"));
  const nodes = NODES.map((n) => ({ ...n, hash: `h-${n.name}` }));
  const edges = new Int32Array([0, 1, SITE_STMT, 2, 3, SITE_STMT]);
  const meta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: dir, roots: ["N"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [],
    nodes,
    projectCount: nodes.length,
    axioms: [],
    axiomSets: [[]],
    layouts: { namespace: computeLayout("namespace", nodes, edges), module: computeLayout("module", nodes, edges) } as Record<ClusterMode, Layout>,
    edgeCount: 2,
  } as ViewMeta;
  const timeline = { events: [] as StoredEvent[], add: (e: NewEvent) => (timeline.events.push({ ...e, id: timeline.events.length + 1, at: "" } as StoredEvent), timeline.events.at(-1)!) };
  const views = new Views(dir, LAYOUT_VERSION, () => {}, timeline);
  const w = {
    project: { root: dir, files: new Map(), toolchain: "tc" },
    graph: { version: 1, prep: { metaGz: gzipSync(JSON.stringify(meta)), edgesGz: gzipSync(Buffer.from(edges.buffer)) } },
    review: { data: emptyReview(), append: () => ({ status: 403, error: "not here" }) },
    timeline,
    places: views.places,
    presence: new Presence(() => {}),
    placesChanged: () => {},
    views,
  } as unknown as World;
  const ask = (level: "read" | "advise" | "full", method: "GET" | "POST", path: string, params: Json = {}): Answer => {
    const e = noteEndpoints(w, (_c, need) => refusal(level, need)).find((x) => x.method === method && x.path === path)!;
    const caller = { name: "Claude", kind: "agent" as const };
    return e.run(method === "GET" ? { method, path, query: new URLSearchParams(params), body: null, caller } : { method, path, query: new URLSearchParams(), body: params, caller }) as Answer;
  };
  return { views, ask, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("agents attach and detach notes of both kinds through the note endpoints", () => {
  const W = world();
  try {
    const body = (a: Answer) => a.body as Json;
    // written attached: by name alone (the default offset), its places beside it under both clusterings
    const made = W.ask("advise", "POST", "/api/agent/note", { text: "the swap is here", decl: "N.A.t" });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.deepEqual(body(made).decl, { name: "N.A.t", at: DECL_AT });
    assert.deepEqual(body(made).here, { decl: "N.A.t", at: DECL_AT });
    assert.deepEqual([body(made).places.namespace.cluster, body(made).places.module.cluster], ["N.A", "N.A"]);
    const id = body(made).id as string;
    // listed with it, and why: attached to a declaration on the board
    const listed = body(W.ask("read", "GET", "/api/agent/notes")).notes.find((n: Json) => n.id === id);
    assert.deepEqual([listed.decl.name, listed.why], ["N.A.t", "project"]);
    const nb = W.views.book.create("N.A.t alone", "Alice", { scope: parseQuery("decl(N.A.t)") });
    assert.ok(typeof nb !== "string");
    assert.equal(body(W.ask("read", "GET", "/api/agent/notes", { view: nb.id })).notes.find((n: Json) => n.id === id)?.why, "decl");
    // moved to another declaration with an offset; then detached, at its places again
    const mv = W.ask("advise", "POST", "/api/agent/note/move", { id, decl: { name: "N.B.x", at: [-40, 10] } });
    assert.equal(mv.status, 200, JSON.stringify(mv.body));
    assert.deepEqual(W.views.book.notes.find((n) => n.id === id)!.decl, { name: "N.B.x", at: [-40, 10] });
    const fallback = W.views.book.notes.find((n) => n.id === id)!.places.module;
    assert.deepEqual(fallback && "in" in fallback ? fallback.in[0][0] : null, "N.C", "its fallback beside N.B.x, in the folder N.C");
    assert.equal(body(W.ask("advise", "POST", "/api/agent/note/move", { id, decl: null })).decl, null);
    // a place given detaches it too
    W.ask("advise", "POST", "/api/agent/note/move", { id, decl: "N.A.t" });
    const placed = W.ask("advise", "POST", "/api/agent/note/move", { id, ring: 45 });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    assert.deepEqual([body(placed).decl, body(placed).places.namespace], [null, { ring: 45 }]);
    // detach, as the MCP tool says it
    W.ask("advise", "POST", "/api/agent/note/move", { id, decl: "N.A.t" });
    assert.equal(body(W.ask("advise", "POST", "/api/agent/note/move", { id, detach: true })).decl, null);
    // an edit keeps it, and so does a card moved alone
    W.ask("advise", "POST", "/api/agent/note/move", { id, decl: "N.A.t" });
    assert.equal(W.ask("advise", "POST", "/api/agent/note/edit", { id, text: "still here" }).status, 200);
    assert.equal(W.ask("advise", "POST", "/api/agent/note/move", { id, card: [80, -40] }).status, 200);
    assert.equal(W.views.book.notes.find((n) => n.id === id)!.decl?.name, "N.A.t");
    // made the Project's own and back: attached all along
    assert.equal(W.ask("advise", "POST", "/api/agent/note/edit", { id, kind: "view", view: PROJECT }).status, 200);
    assert.equal(W.views.book.project().notes!.find((n) => n.id === id)!.decl?.name, "N.A.t");
    assert.equal(W.ask("advise", "POST", "/api/agent/note/edit", { id, kind: "project", view: PROJECT }).status, 200);
    assert.equal(W.views.book.notes.find((n) => n.id === id)!.decl?.name, "N.A.t");
    // a view's own note, attached
    const own = W.ask("advise", "POST", "/api/agent/note", { view: PROJECT, text: "the Project's own", decl: { name: "N.B.e", at: [0, 40] } });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.deepEqual(body(own).here, { decl: "N.B.e", at: [0, 40] });
    assert.equal(body(W.ask("advise", "POST", "/api/agent/note/move", { id: body(own).id, view: PROJECT, decl: null })).decl, null);
    // refused: an unknown declaration, two places at once, a read token
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { text: "x", decl: "N.nope" }).status, 404);
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { text: "x", decl: "N.A.t", ring: 10 }).status, 400);
    assert.equal(W.ask("read", "POST", "/api/agent/note/move", { id, decl: null }).status, 403);
  } finally {
    W.done();
  }
});

test("the dot/icon rule: one threshold for a cluster's notes and the notes attached to its declarations, a blend over zoom, ring and canvas notes fixed, clicks on dots", () => {
  // a cluster: its icon while its circle is AUTO_COLLAPSE_PX round on the screen, the card's own threshold
  const r = 200;
  assert.equal(iconShare({ r }, AUTO_COLLAPSE_PX / r), 1);
  assert.ok(iconShare({ r }, (AUTO_COLLAPSE_PX - 1) / r) < 1);
  assert.equal(iconShare({ r }, AUTO_COLLAPSE_PX / r / 2 ** BLEND_OCTAVES), 0);
  assert.equal(iconShare({ r }, 0.001), 0);
  // attached to a declaration: what it belongs to is the cluster that holds the declaration, so its
  // icon turns into a dot at the very zoom a note in that cluster does, and back
  const radius = (c: number) => [r, 35][c];
  for (const c of [0, 1]) {
    const inCluster = levelOf("cluster", c, radius, 900);
    const attached = levelOf("decl", c, radius, 900);
    assert.deepEqual(attached, inCluster);
    for (let k = 0.05; k < 12; k *= 1.07) {
      assert.equal(iconShare(attached, k), iconShare(inCluster, k), `${c} at ${k}`);
      assert.deepEqual(markLook(true, attached, k), markLook(true, inCluster, k));
    }
  }
  // a small cluster's attached note is a dot where a large one's is an icon, whatever declarations do
  assert.equal(iconShare(levelOf("decl", 0, radius, 900), 0.7), 1);
  assert.ok(iconShare(levelOf("decl", 1, radius, 900), 0.7) < 1);
  assert.equal(iconShare(levelOf("decl", 1, radius, 900), AUTO_COLLAPSE_PX / 35), 1);
  // a declaration at the top level belongs to the whole board, whose extent the ring's radius is
  assert.deepEqual(levelOf("decl", -1, radius, 900), { r: 900 });
  assert.equal(levelOf("decl", -1, radius, null), null);
  // the canvas's rule for pointing at declarations still decides where a drop can attach
  const k0 = POINT_MIN_PX / POINT_UNITS;
  assert.equal(k0, 0.6);
  assert.ok(declsPointable(k0) && !declsPointable(0.59));
  // the blend follows the zoom: halfway in the zoom's logarithm, half; never back as it goes in
  const kc = AUTO_COLLAPSE_PX / r;
  assert.ok(Math.abs(iconShare({ r }, kc / 2 ** (BLEND_OCTAVES / 2)) - 0.5) < 1e-9);
  let was = -1;
  for (let k = kc / 2; k <= kc * 1.2; k *= 1.01) {
    const t = iconShare({ r }, k);
    assert.ok(t >= was, `never back: ${k}`);
    assert.ok(t - was < 0.1 || was < 0, `no jump: ${k}`);
    was = t;
  }
  // its size: a declaration's point at 0, an icon at 1; the point shrinks with the zoom as points do
  assert.equal(markR(0, 0.25), pointPx(0.25));
  assert.equal(markR(1, 0.25), ICON_R);
  assert.ok(pointPx(0.1) < pointPx(0.4));
  // ring and canvas notes keep their icon whatever the zoom
  assert.equal(levelOf("ring", -1, radius, 900), null);
  assert.equal(levelOf("world", -1, radius, 900), null);
  for (const k of [0.001, 0.05, 1, 12]) assert.equal(iconShare(null, k), 1);
  // its card only while its icon shows whole
  assert.deepEqual(markLook(true, { r }, (AUTO_COLLAPSE_PX - 1) / r, false).look, "shut");
  assert.deepEqual(markLook(true, { r }, AUTO_COLLAPSE_PX / r, false).look, "open");
  assert.deepEqual(markLook(true, { r }, 1, true).look, "hidden");
  // a click on a dot, or an icon still turning into one, flies there; on the icon it toggles; on an
  // icon whose card the zoom hides (on the ring), it flies
  assert.equal(markClick(0, false), "fly");
  assert.equal(markClick(0.8, false), "fly");
  assert.equal(markClick(1, false), "toggle");
  assert.equal(markClick(1, true), "fly");
  // Fit frames the dot where the icon would not show at the zoom tried, the icon and its card where it does
  const fit = (k: number) => noteBoxes([{ x: 0, y: 0, mark: (z) => ({ d: [0, 0], r: markR(iconShare({ r }, z), z) }), card: (z) => (iconShare({ r }, z) >= 1 ? { off: [0, -100], w: 200, h: 80 } : null) }], k, true);
  assert.equal(fit(0.1).length, 1);
  assert.ok(fit(0.1)[0].dx1 < ICON_R);
  assert.equal(fit(1).length, 2);
  assert.equal(fit(1)[0].dx1, ICON_R);
});

test("the layer's stacking: cards over icons and dots, the card pressed or opened last in front, the dragged icon over everything", () => {
  // the order, bottom to top
  assert.ok(NOTE_Z.leader < NOTE_Z.mark && NOTE_Z.mark < NOTE_Z.card, "the leaders under the icons and dots, those under the cards");
  assert.ok(NOTE_Z.card + STACK_MOST < NOTE_Z.target, "every card under what would hold a dragged note");
  assert.ok(NOTE_Z.target < NOTE_Z.dragged, "the icon dragged over everything");
  // the cards: the one pressed or opened last in front, the others keeping their order
  let order: string[] = [];
  for (const id of ["a", "b", "c"]) order = raiseCard(order, id);
  assert.deepEqual(order, ["a", "b", "c"]);
  order = raiseCard(order, "a");
  assert.deepEqual(order, ["b", "c", "a"]);
  assert.ok(cardZ(order, "a") > cardZ(order, "c") && cardZ(order, "c") > cardZ(order, "b"));
  assert.equal(cardZ(order, "z"), NOTE_Z.card, "one never brought forward, among the rest");
  assert.ok(cardZ(order, "b") > NOTE_Z.mark, "any card over every icon and dot");
  // at most STACK_MOST keep their place in front, the oldest let go
  for (let k = 0; k < STACK_MOST + 5; k++) order = raiseCard(order, `n${k}`);
  assert.equal(order.length, STACK_MOST);
  assert.equal(order.at(-1), `n${STACK_MOST + 4}`);
  assert.ok(!order.includes("a"));
  assert.ok(Math.max(...order.map((id) => cardZ(order, id))) < NOTE_Z.target);
  // the page's style stacks the parts so
  const css = readFileSync(new URL("../src/web/style.css", import.meta.url), "utf8");
  const z = (sel: string) => {
    const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[^}]*?z-index: (\\d+)`));
    assert.ok(m, sel);
    return Number(m![1]);
  };
  assert.equal(z(".sk-lead"), NOTE_Z.leader);
  assert.equal(z(".sk-dlead"), NOTE_Z.leader);
  assert.equal(z(".sk-dmark"), NOTE_Z.leader);
  assert.equal(z(".sk-ico"), NOTE_Z.mark);
  assert.equal(z(".sticky-mark"), NOTE_Z.mark);
  assert.equal(z(".sk-card"), NOTE_Z.card);
  assert.equal(z(".sticky-halo"), NOTE_Z.target);
  assert.equal(z(".sticky.moving .sk-ico"), NOTE_Z.dragged);
  assert.doesNotMatch(css, /\.sticky\.front/, "no other way to the front");
  // and the page brings a card forward by its rank, on a press and when it is opened
  const page = readFileSync(new URL("../src/web/src/sticky.ts", import.meta.url), "utf8");
  assert.match(page, /d\.card\.style\.zIndex = this\.stack\.includes\(id\) \? String\(cardZ\(this\.stack, id\)\) : ""/);
  assert.match(page, /if \(opened\) this\.raise\(n\.id\);/);
  assert.match(page, /\/\/ the note pressed: its card over the others'\n\s*this\.raise\(d\.note\.id\);/);
});
