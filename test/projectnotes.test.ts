// The project's notes and where a note is (AttachmentSpec decisions 13–20, the owner's of 2026-10-11;
// shared/projectnotes.ts, shared/noteplace.ts, shared/ring.ts): a note is the project's unless it is
// made a view's own; one place per clustering, a spot kept as a fraction of its cluster's radius; the
// ring around the board for what has no cluster there; which boards show a note (shared/items.ts and
// test/items.test.ts for what a view adds and takes out, and links); a cluster renamed
// by a build carries its notes; folds and hidden levels; the switch between kinds; view notes on the
// ring under the other clustering; export authors; the agents' API.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { noteEndpoints } from "../src/server/agentnotes.ts";
import type { Answer, Ask, World } from "../src/server/agent.ts";
import { refusal } from "../src/server/agent.ts";
import { Presence } from "../src/server/presence.ts";
import { Views } from "../src/server/views.ts";
import { authorsOf, viewTraces } from "../src/shared/doc/authors.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { clusterKeys, clusterTree, computeLayout } from "../src/shared/layout.ts";
import { carriedNotes, holderOf, itemSpot, itemsShownOn, itemWhy, keyChain, membersOf, noteBoard, placeIn, spotIn, viewSpot } from "../src/shared/noteplace.ts";
import { applyProjectNoteOp, cleanProjectNotes, invalidProjectNoteOps } from "../src/shared/projectnotes.ts";
import type { ProjectNote, ProjectNoteOp } from "../src/shared/projectnotes.ts";
import { emptyReview } from "../src/shared/review.ts";
import { aboutAngle, angleOf, fitFrame, packRings, RING_GAP_PX, RING_NEAR, RING_REACH, RING_STEP_PX, ringAround, ringBox, ringDegrees, ringPx, ringRadians } from "../src/shared/ring.ts";
import type { RingItem, RingSpot } from "../src/shared/ring.ts";
import type { FitBox } from "../src/shared/ring.ts";
import type { PlaceCluster, StickyNote } from "../src/shared/sticky.ts";
import type { NewEvent, StoredEvent } from "../src/shared/timeline.ts";
import { PROJECT, ViewBook } from "../src/shared/views.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Four declarations: namespaces N.A (t, d) and N.B (e, x); folders N.A (t, e) and N.C (d, x) — a
 *  folder with a namespace's key that holds other declarations. */
const NODES: ViewNode[] = [
  { name: "N.A.t", kind: "theorem", module: "N.A", ax: 0 },
  { name: "N.A.d", kind: "def", module: "N.C", ax: 0 },
  { name: "N.B.e", kind: "def", module: "N.A", ax: 0 },
  { name: "N.B.x", kind: "def", module: "N.C", ax: 0 },
];
const exists = (nodes: ViewNode[]) => (m: ClusterMode, key: string) => clusterKeys(m, nodes).has(key);

/** A layout by hand: clusters [key, parent, x, y, r] in world coordinates, and each node's cluster. */
function layout(clusters: [string, number, number, number, number][], cluster: number[]): Layout {
  const depth = (c: number): number => (clusters[c][1] < 0 ? 0 : depth(clusters[c][1]) + 1);
  return {
    x: [], y: [], lx: [], ly: [], cluster,
    clusters: clusters.map(([key, parent, x, y, r], c) => ({ key, label: key, parent, depth: depth(c), x, y, lx: 0, ly: 0, r, count: 0, ext: false })),
  };
}
const drawn = (L: Layout): PlaceCluster[] => L.clusters.map((c) => ({ key: c.key, parent: c.parent, depth: c.depth, x: c.x, y: c.y, r: c.r, open: true }));

/** The Project by namespace: N around N.A and N.B. */
const WHOLE = layout([["N", -1, 0, 0, 100], ["N.A", 0, 30, 0, 40], ["N.B", 0, -40, 0, 30]], [1, 1, 2, 2]);
const pnote = (id: string, places: ProjectNote["places"], over: Partial<ProjectNote> = {}): ProjectNote => ({ id, text: `note ${id}`, places, open: true, by: "Alice", at: `2026-10-11T10:00:0${id.length % 10}.000Z`, ...over });

test("a note of the project keeps its spot as a fraction of its cluster's radius: the same spot of the circle on every board", () => {
  const nb = noteBoard(WHOLE, "namespace", NODES);
  // let go at (50, -10), in N.A: half its radius to the right, a quarter up; and in N around it
  const p = placeIn([50, -10], drawn(WHOLE), nb)!;
  assert.deepEqual(p, { in: [["N.A", 0.5, -0.25], ["N", 0.5, -0.1]] });
  // far out of its circle, it is brought inside
  assert.deepEqual(spotIn("N.B", [-40, -60], drawn(WHOLE), nb), { in: [["N.B", 0, -1], ["N", -0.4, -0.6]] });
  // where no cluster is: no place in one — the page puts it on the ring at that angle
  assert.equal(placeIn([500, 500], drawn(WHOLE), nb), null);
  const n = pnote("n1", { namespace: p });
  const ex = exists(NODES);
  assert.deepEqual(itemSpot(n, nb, ex), { at: "cluster", c: 1, f: [0.5, -0.25] });
  // a view of N.A alone: N and N.A merge into one circle (a chain), far away and larger, which
  // counts as each of them; the note is at the same spot of it
  const narrow = layout([["N.A", -1, 500, 500, 80]], [0, 0]);
  const nn = noteBoard(narrow, "namespace", NODES.slice(0, 2));
  assert.equal(nn.stands.get("N"), 0, "a chain merged into one circle counts as that circle");
  const s = itemSpot(n, nn, ex);
  assert.deepEqual(s, { at: "cluster", c: 0, f: [0.5, -0.25] });
  const C = narrow.clusters[0];
  assert.deepEqual([C.x + 0.5 * C.r, C.y - 0.25 * C.r], [540, 480]);
  // a note put in N alone is in the merged circle, at its spot in N
  assert.deepEqual(itemSpot(pnote("n2", { namespace: { in: [["N", 0.2, 0.3]] } }), nn, ex), { at: "cluster", c: 0, f: [0.2, 0.3] });
});

test("one place per clustering: moving a note under one leaves the other as it was; none yet under the other", () => {
  const notes: ProjectNote[] = [];
  const add: ProjectNoteOp = { op: "pnote", note: pnote("n1", { namespace: { in: [["N.A", 0.5, -0.25], ["N", 0.5, -0.1]] } }) };
  assert.equal(invalidProjectNoteOps([add]), null);
  assert.ok(applyProjectNoteOp(notes, add));
  assert.equal(notes[0].places.module, undefined, "no place by file until someone puts it there");
  // put somewhere by file: that is its place by file, its place by namespace untouched
  applyProjectNoteOp(notes, { op: "pnote-move", id: "n1", mode: "module", place: { in: [["N.C", -0.3, 0.6], ["N", 0.1, 0.2]] } });
  assert.deepEqual(notes[0].places.namespace, { in: [["N.A", 0.5, -0.25], ["N", 0.5, -0.1]] });
  assert.deepEqual(notes[0].places.module, { in: [["N.C", -0.3, 0.6], ["N", 0.1, 0.2]] });
  // let go at the top level by namespace: the ring, at that angle; by file it stays in N.C
  applyProjectNoteOp(notes, { op: "pnote-move", id: "n1", mode: "namespace", place: { ring: 450 } });
  assert.deepEqual(notes[0].places, { namespace: { ring: 90 }, module: { in: [["N.C", -0.3, 0.6], ["N", 0.1, 0.2]] } });
  // a page's move says nothing of who: only the server records a carry as its edit
  assert.equal(notes[0].edited, undefined);
  // what cannot be taken
  assert.notEqual(invalidProjectNoteOps([{ op: "pnote-move", id: "n1", mode: "flat", place: null }]), null);
  assert.notEqual(invalidProjectNoteOps([{ op: "pnote-move", id: "n1", mode: "module", place: { in: [] } }]), null);
  assert.notEqual(invalidProjectNoteOps([{ op: "pnote-move", id: "n1", mode: "module", place: { ring: "top" } }]), null);
  assert.notEqual(invalidProjectNoteOps([{ op: "pnote", note: { ...pnote("n2", {}), carries: [{ file: "x" }] } }]), null, "what it carries is files of the library by hash");
  assert.equal(invalidProjectNoteOps([{ op: "pnote", note: { ...pnote("n2", {}), carries: [{ file: "a".repeat(64), page: 3, region: [0.1, 0.1, 0.5, 0.4] }] } }]), null);
  // read back from a file
  const back = cleanProjectNotes([...notes, { id: "bad", text: "", places: {}, open: true }, { ...notes[0] }]);
  assert.deepEqual(back.map((n) => n.id), ["n1"]);
});

test("the ring: just outside every cluster; a note at the angle of what it is about, else in writing order from the top, spaced", () => {
  const ring = ringAround([{ x: 0, y: 0, r: 100 }, { x: 300, y: 0, r: 50 }])!;
  assert.deepEqual([ring.x, ring.y], [125, 0]);
  assert.ok(ring.r > 225 && ring.r < 240, `just outside the farthest circle: ${ring.r}`);
  // degrees clockwise from the top, and back
  assert.equal(ringDegrees(ringRadians(90)), 90);
  assert.equal(angleOf(ring, ring.x, ring.y - 10), 0, "straight up: the top");
  assert.equal(angleOf(ring, ring.x + 10, ring.y), 90, "the right");
  // the centre of what it is about: its angle, unless it is too near the middle to point anywhere
  assert.equal(aboutAngle(ring, [ring.x, ring.y + 100]), Math.PI / 2);
  assert.equal(aboutAngle(ring, [ring.x + RING_NEAR * ring.r * 0.9, ring.y]), null);
  assert.equal(aboutAngle(ring, null), null);
  // spaced: two that want the same angle are pushed apart, in their order, by their size on the screen
  const icon = (want: number | null, order: string): RingItem => ({ want, order, icon: 24 });
  const two = packRings([icon(0, "b"), icon(0, "a")], 400);
  assert.ok(two[1].a < two[0].a, "the one written first comes first, clockwise");
  assert.ok((two[0].a - two[1].a) * 400 >= 24 + RING_GAP_PX - 1e-6, `apart by what they take along the ring: ${(two[0].a - two[1].a) * 400}`);
  // those that point nowhere go from the top, clockwise, in the order written
  const loose = packRings([icon(null, "3"), icon(null, "1"), icon(null, "2")], 600);
  assert.ok(Math.abs(loose[1].a + Math.PI / 2) < 0.05, "the first at the top");
  assert.ok(loose[1].a < loose[2].a && loose[2].a < loose[0].a, "then clockwise");
  // an expanded note takes its card's extent across the ray where cards show on the ring
  const card = (want: number, order: string): RingItem => ({ want, order, icon: 24, open: [200, 80] });
  const cards = packRings([card(-Math.PI / 2, "a"), card(-Math.PI / 2, "b")], 400);
  assert.ok((cards[1].a - cards[0].a) * 400 >= 200 + RING_GAP_PX - 1e-6, "at the top, by the cards' width");
  const shut = packRings([card(-Math.PI / 2, "a"), card(-Math.PI / 2, "b")], 100);
  assert.ok(Math.abs(2 * 100 * Math.sin((shut[1].a - shut[0].a) / 2) - (24 + RING_GAP_PX)) < 1e-6, "zoomed out, the cards hidden: by the icons alone, the gap on the screen");
  // the box sits outside the ring, touching its point with the side that faces the middle
  assert.deepEqual(ringBox(100, 100, 0, 120, 24), [100, 88], "on the right: to its right");
  assert.deepEqual(ringBox(100, 100, -Math.PI / 2, 120, 24).map(Math.round), [40, 76], "at the top: above it");
});

/** The notes on each ring, by ring: their angles in order round it. */
function byRing(spots: RingSpot[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  spots.forEach((s, k) => out.set(s.ring, [...(out.get(s.ring) ?? []), k]));
  return out;
}

/** Whether every two neighbours on each ring keep RING_GAP_PX between their icons on the screen, in
 *  a straight line. */
function gapsKept(spots: RingSpot[], rpx: number): boolean {
  for (const [j, ks] of byRing(spots)) {
    if (ks.length < 2) continue;
    const as = ks.map((k) => spots[k].a).sort((a, b) => a - b);
    for (let i = 0; i < as.length; i++) {
      const d = i + 1 < as.length ? as[i + 1] - as[i] : as[0] + 2 * Math.PI - as[i];
      if (2 * ringPx(rpx, j) * Math.sin(Math.min(d, Math.PI) / 2) < 24 + RING_GAP_PX - 1e-6) return false;
    }
  }
  return true;
}

test("more rings instead of crowding: a fixed gap between notes on a ring, the rest on rings further out a fixed step apart, inner rings first, angle order kept", () => {
  const icon = (want: number | null, order: string): RingItem => ({ want, order, icon: 24 });
  // eleven notes that point nowhere, as the live Project's files are: one ring holds them at a
  // normal zoom, from the top clockwise in the order written
  const loose = Array.from({ length: 11 }, (_, k) => icon(null, `2026-10-11T10:${String(k).padStart(2, "0")}`));
  const near = packRings(loose, 400);
  assert.ok(near.every((s) => s.ring === 0), "one ring at a normal zoom");
  assert.ok(gapsKept(near, 400));
  // zoomed out, the ring holds only as many as fit at the gap; the rest go on the next ring out
  for (const rpx of [60, 40, 25, 12, 5]) {
    const at = packRings(loose, rpx);
    assert.ok(gapsKept(at, rpx), `the gap kept at ${rpx} px`);
    const rings = byRing(at);
    // inner rings first: every ring in use but the last is as full as the gap lets it be, at the
    // zoom the rings were decided at (a twelfth of a doubling at most below this one)
    const used = Math.max(...rings.keys());
    const fits = (r: number) => (r < 15 ? 1 : Math.floor(Math.PI / Math.asin(15 / r)));
    for (let j = 0; j < used; j++) {
      const n = rings.get(j)!.length;
      assert.ok(n >= fits(ringPx(rpx * 2 ** (-1 / 12), j)), `ring ${j} holds what fits at ${rpx} px: ${n}`);
    }
    // in the order written, ring after ring: no note sits inside one written before it
    for (let k = 1; k < loose.length; k++) assert.ok(at[k].ring >= at[k - 1].ring, `ring after ring at ${rpx} px`);
    // on each ring from the top, clockwise, in the order written
    for (const ks of rings.values()) for (let i = 1; i < ks.length; i++) assert.ok(at[ks[i]].a > at[ks[i - 1]].a);
  }
  // those that point nowhere fill the room the others leave on the inner ring, from the top
  // clockwise, before any goes further out: six about places near the top right, thirteen about
  // nothing, on a ring that holds fifteen
  const mixed = [...[0.3, 0.6, 0.9, 1.2, 1.5, 1.8].map((a, k) => icon(a - Math.PI / 2, `a${k}`)), ...Array.from({ length: 13 }, (_, k) => icon(null, `b${String(k).padStart(2, "0")}`))];
  const mx = packRings(mixed, 80);
  assert.ok(gapsKept(mx, 80));
  assert.ok(mx.slice(0, 6).every((s) => s.ring === 0), "those about places keep the inner ring");
  assert.ok(mx.filter((s) => s.ring === 0).length >= 14, `the inner ring full: ${mx.filter((s) => s.ring === 0).length}`);
  for (let k = 7; k < 19; k++) assert.ok(mx[k].ring >= mx[k - 1].ring, "those about nothing ring after ring, in the order written");
  assert.equal(RING_STEP_PX, 32, "each ring 32 px of the screen outside the one inside it");
  assert.equal(ringPx(40, 2) - ringPx(40, 1), RING_STEP_PX);
  // notes about something: a crowd at one angle goes out near its angle, each within RING_REACH of
  // it, the newest first; a note alone stays on the inner ring at its own angle
  const crowd = [...Array.from({ length: 12 }, (_, k) => icon(0, `a${String(k).padStart(2, "0")}`)), icon(Math.PI, "b")];
  for (const rpx of [800, 200, 100, 50]) {
    const at = packRings(crowd, rpx);
    assert.ok(gapsKept(at, rpx), `the gap kept at ${rpx} px`);
    for (let k = 0; k < 12; k++) assert.ok(Math.abs(at[k].a) <= RING_REACH + 1e-6, `near its angle at ${rpx} px: ${at[k].a}`);
    assert.deepEqual([at[12].ring, at[12].a], [0, Math.PI], "the one alone stays where it points");
    // the older of the crowd are never further out than the newer
    for (let k = 1; k < 12; k++) assert.ok(at[k].ring >= at[k - 1].ring, `the newest go out first at ${rpx} px`);
  }
  assert.ok(packRings(crowd, 800).every((s) => s.ring === 0));
  assert.ok(packRings(crowd, 100).some((s) => s.ring > 0));
  // angle order kept on each ring: notes at three angles, packed tight
  const three = [0.2, 1.4, -2.0].flatMap((a, j) => Array.from({ length: 6 }, (_, k) => icon(a, `${j}${k}`)));
  const at = packRings(three, 70);
  for (const ks of byRing(at).values()) {
    const seq = [...ks].sort((x, y) => at[x].a - at[y].a);
    for (let i = 1; i < seq.length; i++) assert.ok(three[seq[i - 1]].want! <= three[seq[i]].want! || three[seq[i - 1]].order < three[seq[i]].order, "in their order round the ring");
  }
});

test("the rings are calm while zooming: zooming out a note only ever moves out, and only when it must; zooming in brings it back; the same at the same zoom", () => {
  // notes about a few places, some crowded, and some that point nowhere, written in a mixed order
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const items: RingItem[] = Array.from({ length: 30 }, (_, k) => {
    const r = rnd();
    return { want: r < 0.3 ? null : r < 0.6 ? 0.3 + rnd() * 0.2 : rnd() * 2 * Math.PI - Math.PI, order: `${Math.floor(rnd() * 1000)}`.padStart(4, "0") + k, icon: 24 };
  });
  const zooms: number[] = [];
  for (let rpx = 900; rpx >= 6; rpx *= 0.97) zooms.push(rpx);
  const out = zooms.map((rpx) => packRings(items, rpx));
  for (let z = 1; z < zooms.length; z++) {
    assert.ok(gapsKept(out[z], zooms[z]), `the gap kept at ${zooms[z]} px`);
    out[z].forEach((s, k) => assert.ok(s.ring >= out[z - 1][k].ring, `note ${k} moved in while zooming out, at ${zooms[z]} px`));
  }
  // all on one ring zoomed in, several zoomed out
  assert.ok(out[0].every((s) => s.ring === 0));
  assert.ok(out.at(-1)!.some((s) => s.ring >= 2));
  // zoomed back in, step by step, the same as on the way out
  for (let z = zooms.length - 1; z >= 0; z--) assert.deepEqual(packRings(items, zooms[z]), out[z]);
  // a move is decided at a zoom and holds a little either side of it: no flicker at a pixel's change
  const a = packRings(items, 100).map((s) => s.ring), b = packRings(items, 100.5).map((s) => s.ring);
  assert.deepEqual(a, b);
});

test("Fit to screen frames the outermost ring in use, each note where the rings put it at the zoom it settles on", () => {
  // a board 200 wide with its ring, and 120 notes that point nowhere: at the zoom Fit settles on,
  // one ring cannot hold them all
  const board: FitBox[] = [{ x: -100, y: -100, dx0: 0, dy0: 0, dx1: 0, dy1: 0 }, { x: 100, y: 100, dx0: 0, dy0: 0, dx1: 0, dy1: 0 }];
  const ring = ringAround([{ x: 0, y: 0, r: 100 }])!;
  const items: RingItem[] = Array.from({ length: 120 }, (_, k) => ({ want: null, order: String(k).padStart(3, "0"), icon: 24 }));
  const boxes = (k: number): FitBox[] =>
    packRings(items, ring.r * k).map(({ ring: j, a }) => {
      const r = ring.r + (j * RING_STEP_PX) / k;
      return { x: ring.x + r * Math.cos(a), y: ring.y + r * Math.sin(a), dx0: -12, dy0: -12, dx1: 12, dy1: 12 };
    });
  const f = fitFrame((k) => [...board, ...boxes(k)], 600, 600, 4)!;
  const spots = packRings(items, ring.r * f.k);
  const outer = Math.max(...spots.map((s) => s.ring));
  assert.ok(outer >= 1, `more than one ring at the zoom Fit settles on: ${outer + 1}`);
  // every icon inside the room, those on the outermost ring among them, and one of them at its edge
  let edge = 0;
  for (const b of boxes(f.k)) {
    const [x0, y0, x1, y1] = [b.x * f.k + b.dx0 - f.x * f.k, b.y * f.k + b.dy0 - f.y * f.k, b.x * f.k + b.dx1 - f.x * f.k, b.y * f.k + b.dy1 - f.y * f.k];
    assert.ok(x0 >= -300 - 1e-6 && x1 <= 300 + 1e-6 && y0 >= -300 - 1e-6 && y1 <= 300 + 1e-6, JSON.stringify([x0, y0, x1, y1]));
    edge = Math.max(edge, -x0, x1, -y0, y1);
  }
  assert.ok(edge > 295, `framed no further out than it needs: ${edge}`);
});

test("which boards show a note: the Project every one; another its cluster where the board holds it, on the ring where its other cluster does; at the top level under both, the Project alone", () => {
  const ex = exists(NODES);
  const inA = pnote("a", { namespace: { in: [["N.A", 0.5, 0], ["N", 0.2, 0]] } });
  const ring = pnote("r", { namespace: { ring: 45 } });
  const top = pnote("t", {});
  const both = pnote("b", { namespace: { in: [["N.A", 0, 0]] }, module: { in: [["N.C", 0, 0]] } });
  const board = (nodes: ViewNode[], mode: ClusterMode) => {
    const L = mode === "namespace" ? clusterTree("namespace", nodes) : clusterTree("module", nodes);
    return noteBoard(L, mode, nodes);
  };
  const shown = (b: ReturnType<typeof board>, all = false) => [inA, ring, top, both].filter((n) => itemWhy(n, { all }, b, ex, new Map())).map((n) => n.id);
  // the Project, by either clustering: every one, wherever it sits
  assert.deepEqual(shown(board(NODES, "namespace"), true), ["a", "r", "t", "b"]);
  assert.deepEqual(shown(board([NODES[3]], "module"), true), ["a", "r", "t", "b"]);
  // another view of everything: what its scope gives — not the ring note, whose cluster under the
  // other clustering it has none, nor the note at the top level under both, which is the Project's
  assert.deepEqual(shown(board(NODES, "namespace")), ["a", "b"]);
  // a view of N.B alone: none of them
  assert.deepEqual(shown(board(NODES.slice(2), "namespace")), []);
  // by file: the note in N.A has no place there — on the ring where its namespace has a declaration
  const files = board(NODES, "module");
  assert.deepEqual(itemSpot(inA, files, ex), { at: "ring", angle: null, about: { mode: "namespace", key: "N.A" } });
  // never in the folder N.A that has its namespace's key
  assert.deepEqual(membersOf(files, "namespace", "N.A"), [0, 1], "what it is about: N.A.t and N.A.d, not the folder's N.B.e");
  // by file, a view of the folder N.C only holding N.B.x: the namespace N.A is not there; the note in
  // N.C by file is
  assert.deepEqual(shown(board([NODES[3]], "module")), ["b"]);
  // by file, a view holding N.A.d (folder N.C): the note in N.A shows on the ring, about N.A
  assert.deepEqual(shown(board([NODES[1]], "module")), ["a", "b"]);
  // where the Project shows a note at the top level under both: on the ring, at the angle where it
  // was let go, else in the order notes were written
  assert.deepEqual(itemSpot(ring, files, ex), { at: "ring", angle: null, about: null });
  assert.deepEqual(itemSpot(ring, board(NODES, "namespace"), ex), { at: "ring", angle: 45, about: null });
  // what the export counts, from what a board holds alone: the Project every note
  assert.deepEqual(itemsShownOn([inA, ring, top, both], { all: false }, "namespace", NODES.slice(2), NODES, []).map((n) => n.id), []);
  assert.deepEqual(itemsShownOn([inA, ring, top, both], { all: false }, "namespace", NODES, NODES, []).map((n) => n.id), ["a", "b"]);
  assert.deepEqual(itemsShownOn([inA, ring, top, both], { all: true }, "namespace", NODES.slice(2), NODES, []).map((n) => n.id), ["a", "r", "t", "b"]);
});

test("a cluster renamed by a build carries its notes; otherwise the nearest cluster around it that is left; never one of the other clustering", () => {
  const n = (name: string, module: string) => ({ name, module });
  const before = [n("A.Old.x", "P.Q"), n("A.Old.y", "P.Q"), n("A.Old.Sub.z", "P.Q"), n("A.Keep.w", "P.R")];
  const inOld = pnote("o", { namespace: { in: [["A.Old", 0.1, 0.2], ["A", 0.3, 0.4]] }, module: { in: [["P.Q", -0.5, 0], ["P", 0, 0.5]] } });
  // a namespace renamed: every declaration A.Old.rest is A.New.rest now, found as renames
  const renamed = new Map([["A.Old.x", "A.New.x"], ["A.Old.y", "A.New.y"], ["A.Old.Sub.z", "A.New.Sub.z"]]);
  const after = [n("A.New.x", "P.Q"), n("A.New.y", "P.Q"), n("A.New.Sub.z", "P.Q"), n("A.Keep.w", "P.R")];
  assert.deepEqual(carriedNotes([inOld], before, after, renamed), [{ id: "o", mode: "namespace", from: "A.Old", to: "A.New", place: { in: [["A.New", 0.1, 0.2], ["A", 0.3, 0.4]] } }]);
  // a folder renamed: the same names in other modules
  const moved = [n("A.Old.x", "P.Z"), n("A.Old.y", "P.Z"), n("A.Old.Sub.z", "P.Z"), n("A.Keep.w", "P.R")];
  assert.deepEqual(carriedNotes([inOld], before, moved, new Map()), [{ id: "o", mode: "module", from: "P.Q", to: "P.Z", place: { in: [["P.Z", -0.5, 0], ["P", 0, 0.5]] } }]);
  // split between two: not carried; it is in the nearest cluster around it that is left
  const split = [n("A.One.x", "P.Q"), n("A.Two.y", "P.Q"), n("A.Two.Sub.z", "P.Q"), n("A.Keep.w", "P.R")];
  const parts = new Map([["A.Old.x", "A.One.x"], ["A.Old.y", "A.Two.y"], ["A.Old.Sub.z", "A.Two.Sub.z"]]);
  assert.deepEqual(carriedNotes([inOld], before, split, parts), []);
  const ex = (m: ClusterMode, key: string) => clusterKeys(m, split as ViewNode[]).has(key);
  assert.deepEqual(holderOf(inOld.places.namespace, "namespace", ex), { key: "A", at: 1 });
  // gone with nothing left of it: the top level, on the ring
  assert.equal(holderOf({ in: [["Z.Q", 0, 0]] }, "namespace", ex), null);
  // never matched by key across clusterings: a namespace N.A, a folder N.A that holds other things
  const files = noteBoard(clusterTree("module", NODES), "module", NODES);
  const s = itemSpot(pnote("k", { namespace: { in: [["N.A", 0, 0]] } }), files, exists(NODES));
  assert.equal(s?.at, "ring");
  // a view note too: by file it is on the ring, about its namespace
  const v: StickyNote = { id: "v", text: "x", place: { mode: "namespace", in: [["N.A", 3, 4], ["N", 1, 1]], world: [10, 10] }, open: true, by: "B", at: "" };
  const index = (key: string) => files.keys.indexOf(key);
  assert.deepEqual(viewSpot(v, files, index), { at: "ring", angle: null, about: { mode: "namespace", key: "N.A" } });
  assert.ok(index("N.A") >= 0, "though a folder of that key is drawn");
  // by namespace it is where it always was
  const names = noteBoard(clusterTree("namespace", NODES), "namespace", NODES);
  assert.deepEqual(viewSpot(v, names, (key) => names.keys.indexOf(key)), { at: "offset", c: names.keys.indexOf("N.A"), d: [3, 4] });
});

test("folds and hidden levels: a note in a hidden level is in the nearest drawn cluster around it, at its spot there; a chain is one circle", () => {
  const nodes: ViewNode[] = ["A.B.C.x", "A.B.D.y", "A.E.z"].map((name) => ({ name, kind: "def", module: "M", ax: 0 }));
  const shownTree = clusterTree("namespace", nodes);
  const hidden = clusterTree("namespace", nodes, ["A.B"]);
  assert.ok(!hidden.clusters.some((c) => c.key === "A.B"), "A.B hidden");
  const nb = noteBoard(hidden, "namespace", nodes);
  const A = nb.keys.indexOf("A");
  assert.equal(nb.stands.get("A.B"), A, "a hidden level stands in its parent");
  const ex = exists(nodes);
  // put in A.B (drawn on another board), at its spot there and in A around it
  const n = pnote("h", { namespace: { in: [["A.B", 0.4, 0.4], ["A", -0.2, 0.6]] } });
  assert.deepEqual(itemSpot(n, nb, ex), { at: "cluster", c: A, f: [-0.2, 0.6] });
  // on the board that draws it: in A.B
  const nb2 = noteBoard(shownTree, "namespace", nodes);
  assert.deepEqual(itemSpot(n, nb2, ex), { at: "cluster", c: nb2.keys.indexOf("A.B"), f: [0.4, 0.4] });
  // A hidden too (the top level): its declarations at the top level, the note on the ring about A.B
  const top = noteBoard(clusterTree("namespace", nodes, ["A.B", "A"]), "namespace", nodes);
  assert.deepEqual(itemSpot(n, top, ex), { at: "ring", angle: null, about: { mode: "namespace", key: "A.B" } });
  // a key chain: every key around one
  assert.deepEqual(keyChain("A.B.«x.y»"), ["A.B.«x.y»", "A.B", "A"]);
  // placed on the board that hides A.B: no spot is kept in A.B, which has no circle there
  const L = computeLayout("namespace", nodes, new Int32Array(0), ["A.B"]);
  const nbL = noteBoard(L, "namespace", nodes);
  const cl = drawn(L);
  const c = cl.find((x) => x.key === "A.B.C")!;
  const p = placeIn([c.x, c.y], cl, nbL)!;
  assert.deepEqual(p && "in" in p ? p.in.map((e) => e[0]) : null, ["A.B.C", "A"]);
});

test("Fit to screen frames the notes on the ring and at the top level, which keep their size on the screen", () => {
  // a board 200 wide and a note on the ring at its right, 500 by 120 pixels
  const board: FitBox[] = [{ x: -100, y: -100, dx0: 0, dy0: 0, dx1: 0, dy1: 0 }, { x: 100, y: 100, dx0: 0, dy0: 0, dx1: 0, dy1: 0 }];
  const ring = ringAround([{ x: 0, y: 0, r: 100 }])!;
  const note = (): FitBox => {
    const [x0, y0] = ringBox(0, 0, 0, 500, 120);
    return { x: ring.x + ring.r, y: ring.y, dx0: x0, dy0: y0, dx1: x0 + 500, dy1: y0 + 120 };
  };
  const alone = fitFrame(() => board, 1000, 600, 4)!;
  assert.ok(Math.abs(alone.k - 3) < 1e-9, `the board alone: as large as the room's height allows (${alone.k})`);
  const f = fitFrame(() => [...board, note()], 1000, 600, 4)!;
  assert.ok(f.k < alone.k, `zoomed out to make room for the note: ${f.k}`);
  // at that zoom, the board and the note are both inside the room, centred
  const at = (b: FitBox) => [b.x * f.k + b.dx0 - f.x * f.k, b.y * f.k + b.dy0 - f.y * f.k, b.x * f.k + b.dx1 - f.x * f.k, b.y * f.k + b.dy1 - f.y * f.k];
  for (const b of [...board, note()]) {
    const [x0, y0, x1, y1] = at(b);
    assert.ok(x0 >= -500 - 1e-6 && x1 <= 500 + 1e-6 && y0 >= -300 - 1e-6 && y1 <= 300 + 1e-6, JSON.stringify([x0, y0, x1, y1]));
  }
  assert.ok(Math.abs(at(note())[2] - 500) < 1, "the note at the room's edge: no more zoomed out than it needs");
  // the notes are asked for at each zoom tried; notes alone wider than the room: none fits
  assert.equal(fitFrame(() => [...board, { x: 0, y: 0, dx0: 0, dy0: 0, dx1: 1200, dy1: 10 }], 1000, 600, 4), null);
});

/** A server's views in a site directory of their own, with the timeline they write. */
function server(dir: string) {
  const sent: { event: string; data: Json }[] = [];
  const events: StoredEvent[] = [];
  const timeline = { events, add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: new Date().toISOString() } as StoredEvent), events[events.length - 1]) };
  const views = new Views(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data: data as Json }), timeline);
  const ask = (path: string, body: unknown, name: string | null = "Alice", method = "POST") =>
    views.handle({ method, path, query: new URLSearchParams(), body, caller: { name, kind: "person" } } as Ask, "full");
  return { views, sent, events, ask };
}

test("the project's notes are kept beside the views, shared as their operations are; written, edited and deleted are the timeline's", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-pnotes-"));
  try {
    const S = server(dir);
    const add: ProjectNoteOp = { op: "pnote", note: pnote("n1", { namespace: { in: [["N.A", 0.5, 0]] } }, { by: "Mallory", text: "see `N.A.t`" }) };
    assert.equal(S.ask("/api/views/notes", { ops: [add] }).status, 200);
    // stamped by who sends it, not the name it carries; sent to every page
    assert.equal(S.views.book.notes[0].by, "Alice");
    const out = S.sent.find((s) => s.event === "note-ops")!.data;
    assert.equal(out.ops[0].note.by, "Alice");
    const page: ProjectNote[] = [];
    for (const o of out.ops) applyProjectNoteOp(page, o);
    assert.deepEqual(page, S.views.book.notes);
    // kept in views.json, beside the views, and read back
    assert.equal(JSON.parse(readFileSync(join(dir, "views.json"), "utf8")).notes[0].id, "n1");
    assert.deepEqual(new Views(dir, LAYOUT_VERSION, () => {}).book.notes, S.views.book.notes);
    // the list, for a page that loads
    assert.equal((S.ask("/api/views/notes", null, "Alice", "GET").body as Json).notes.length, 1);
    // moved and opened without a name; written, edited and deleted need one
    assert.equal(S.ask("/api/views/notes", { ops: [{ op: "pnote-open", id: "n1", open: false }] }, null).status, 200);
    assert.equal(S.ask("/api/views/notes", { ops: [{ op: "pnote-edit", id: "n1", text: "x" }] }, null).status, 401);
    S.ask("/api/views/notes", { ops: [{ op: "pnote-edit", id: "n1", text: "see `N.A.t` first" }] }, "Bob");
    S.ask("/api/views/notes", { ops: [{ op: "pnote-move", id: "n1", mode: "module", place: { ring: 180 } }] }, "Bob");
    S.ask("/api/views/notes", { ops: [{ op: "pnote-delete", id: "n1" }] }, "Carol");
    assert.deepEqual(
      S.events.filter((e) => e.kind === "note").map((e) => [(e as Json).what, (e as Json).by, (e as Json).view]),
      [["created", "Alice", ""], ["edited", "Bob", ""], ["deleted", "Carol", ""]],
      "opening and moving are not events",
    );
    // a declaration renamed: the project's notes name the new one, and undoing it names the old again
    S.ask("/api/views/notes", { ops: [{ op: "pnote", note: pnote("n2", {}, { text: "see `N.A.t`" }) }] });
    const moved = S.views.moveDeclaration("N.A.t", "N.A.t2", "VisualProof");
    assert.equal(S.views.book.notes[0].text, "see `N.A.t2`");
    assert.deepEqual(moved.find((m) => m.view === "")?.ops.map((o) => o.op), ["pnote-edit"]);
    S.views.unmoveDeclaration("N.A.t", "N.A.t2", moved, "Alice");
    assert.equal(S.views.book.notes[0].text, "see `N.A.t`");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a build that renamed a note's cluster carries it, as an edit by VisualProof the timeline records", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-pnotes-"));
  try {
    const S = server(dir);
    S.views.arrangeNotes([{ op: "pnote", note: pnote("n1", { namespace: { in: [["A.Old", 0.1, 0.2], ["A", 0, 0]] } }) }], null, "Alice");
    const before = [{ name: "A.Old.x", module: "P" }, { name: "A.Old.y", module: "P" }];
    const after = [{ name: "A.New.x", module: "P" }, { name: "A.New.y", module: "P" }];
    assert.equal(S.views.carryNotes(before, after, new Map([["A.Old.x", "A.New.x"], ["A.Old.y", "A.New.y"]]), "VisualProof"), 1);
    const n = S.views.book.notes[0];
    assert.deepEqual(n.places.namespace, { in: [["A.New", 0.1, 0.2], ["A", 0, 0]] });
    assert.equal(n.edited?.by, "VisualProof");
    assert.deepEqual((S.events.at(-1) as Json).carried, { mode: "namespace", from: "A.Old", to: "A.New" });
    assert.equal(S.sent.filter((s) => s.event === "note-ops").at(-1)!.data.by, "VisualProof");
    // and the export's authors leave VisualProof out
    assert.deepEqual(authorsOf(viewTraces(S.views.book.project(), undefined, [], S.views.book.notes), () => null, ["VisualProof"]), ["Alice"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a note is made a view's own and the project's again, keeping its text, its author and where it is; nobody becomes its author", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-pnotes-"));
  try {
    const S = server(dir);
    S.views.arrangeNotes([{ op: "pnote", note: pnote("n1", { namespace: { in: [["N.A", 0.5, 0]] }, module: { ring: 10 } }, { carries: [{ file: "b".repeat(64) }] }) }], null, "Alice");
    S.views.arrangeNotes([{ op: "pnote-edit", id: "n1", text: "edited" }], null, "Bob");
    const temp = S.views.book.open({ op: "ns", prefix: "N.A" }, "Carol").view;
    const before = S.events.length;
    // Only in this view: at the spot it has on that board
    const place = { mode: "namespace" as const, in: [["N.A", 20, 0] as [string, number, number]], world: [50, 0] as [number, number] };
    const r = S.ask("/api/views/note-kind", { id: temp.id, note: "n1", to: "view", place, mode: "namespace" }, "Carol");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(S.views.book.notes.length, 0);
    const v = S.views.book.get(temp.id)!.notes![0];
    assert.deepEqual([v.id, v.text, v.by, v.edited?.by, v.place, v.carries?.length], ["n1", "edited", "Alice", "Bob", place, 1]);
    assert.ok(S.views.book.get(temp.id)!.kept, "a note made a view's is work on it: the view is kept");
    // the pages hear both sides
    assert.deepEqual(S.sent.slice(-3).map((s) => s.event).filter((e) => e !== "views"), ["note-ops", "view-ops"]);
    // In every view: at its place under that board's clustering, none under the other
    const back = S.ask("/api/views/note-kind", { id: temp.id, note: "n1", to: "project", place: { in: [["N.A", 0.5, 0]] }, mode: "namespace" }, "Dave");
    assert.equal(back.status, 200, JSON.stringify(back.body));
    const p = S.views.book.notes[0];
    assert.deepEqual([p.id, p.text, p.by, p.edited?.by, p.places], ["n1", "edited", "Alice", "Bob", { namespace: { in: [["N.A", 0.5, 0]] } }]);
    assert.equal(S.views.book.get(temp.id)!.notes!.length, 0);
    // no timeline event for a switch, but the view saved for everyone
    assert.deepEqual(S.events.slice(before).map((e) => e.kind), ["view"]);
    // refused: no such note, a place of the wrong kind, without a name
    assert.equal(S.ask("/api/views/note-kind", { id: temp.id, note: "nope", to: "view", place, mode: "namespace" }).status, 400);
    assert.equal(S.ask("/api/views/note-kind", { id: temp.id, note: "n1", to: "view", place: { ring: 3 }, mode: "namespace" }).status, 400);
    assert.equal(S.ask("/api/views/note-kind", { id: temp.id, note: "n1", to: "view", place, mode: "namespace" }, null).status, 401);
    // a copy of a view has its own notes, not the project's
    const book = new ViewBook([], [pnote("p", {})]);
    book.arrange(PROJECT, [{ op: "note", note: { id: "v1", text: "mine", place, open: true, by: "A", at: "" } }], "A");
    const copy = book.create("Copy", "A", { from: PROJECT });
    assert.ok(typeof copy !== "string");
    assert.deepEqual(copy.notes!.map((n) => n.id), ["v1"]);
    assert.equal(book.notes.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a view's authors count the project's notes its board shows, and its own", () => {
  const shown = itemsShownOn([pnote("in", { namespace: { in: [["N.A", 0, 0]] } }, { by: "Alice", at: "2026-10-11T09:00:00.000Z" }), pnote("out", { namespace: { in: [["N.B", 0, 0]] } }, { by: "Bob" })], { all: false }, "namespace", NODES.slice(0, 2), NODES, []);
  assert.deepEqual(shown.map((n) => n.id), ["in"]);
  const v = { id: "v1", by: "Carol", at: "2026-10-11T08:00:00.000Z", kept: true, notes: [{ id: "o", text: "x", place: { mode: "namespace" as const, in: [], world: [0, 0] as [number, number] }, open: true, by: "Dave", at: "2026-10-11T11:00:00.000Z" }], pins: { namespace: { nodes: {}, clusters: {} }, module: { nodes: {}, clusters: {} } } };
  assert.deepEqual(authorsOf(viewTraces(v, undefined, [], shown), () => null), ["Carol", "Alice", "Dave"]);
});

/** The agents' notes on a small project, laid out as the server lays it out. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "vp-pnotes-agents-"));
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
  const events: StoredEvent[] = [];
  const timeline = { events, add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: new Date().toISOString() } as StoredEvent), events.at(-1)!) };
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
  const ask = (level: "read" | "advise" | "full", method: "GET" | "POST", path: string, params: Json = {}, name = "Claude"): Answer => {
    const e = noteEndpoints(w, (_c, need) => refusal(level, need)).find((x) => x.method === method && x.path === path)!;
    const caller = { name, kind: "agent" as const };
    return e.run(method === "GET" ? { method, path, query: new URLSearchParams(params), body: null, caller } : { method, path, query: new URLSearchParams(), body: params, caller }) as Answer;
  };
  return { meta, views, events, ask, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("an agent writes a note of the project at a cluster, beside a declaration or on the ring, and moves it under one clustering", () => {
  const W = world();
  try {
    const body = (a: Answer) => a.body as Json;
    // a cluster by key and clustering, at a fraction of its radius
    const inA = W.ask("advise", "POST", "/api/agent/note", { cluster: "N.A", clustering: "namespace", at: [0.5, -0.5], text: "the swap is in `N.A.t`" });
    assert.equal(inA.status, 200, JSON.stringify(inA.body));
    assert.deepEqual([body(inA).kind, body(inA).places.namespace.cluster, body(inA).places.namespace.at, body(inA).places.module, body(inA).here], ["project", "N.A", [0.5, -0.5], null, { cluster: "N.A", at: [0.5, -0.5] }]);
    assert.equal(W.views.book.get(PROJECT)!.notes, undefined, "no view's note");
    // beside a declaration, in its cluster by file
    const beside = W.ask("advise", "POST", "/api/agent/note", { name: "N.B.e", clustering: "module", text: "e is built here" });
    assert.equal(beside.status, 200, JSON.stringify(beside.body));
    assert.equal(body(beside).places.module.cluster, "N.A", "the folder N.A, where N.B.e is");
    assert.ok(Math.hypot(...(body(beside).places.module.at as [number, number])) <= 1);
    // on the ring at an angle; on the ring wherever it goes
    assert.deepEqual(body(W.ask("advise", "POST", "/api/agent/note", { ring: 90, text: "the whole project" })).places, { namespace: { ring: 90 }, module: null });
    assert.deepEqual(body(W.ask("advise", "POST", "/api/agent/note", { ring: true, clustering: "module", text: "anywhere" })).places, { namespace: null, module: null });
    // a spot far out of its circle is brought inside it, as the page brings one let go; an angle
    // beyond what a place holds is refused, never kept to be lost when the file is read back
    const far = body(W.ask("advise", "POST", "/api/agent/note", { cluster: "N.A", at: [30, 40], text: "far out" }));
    assert.deepEqual(far.places.namespace.at, [0.6, 0.8]);
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { ring: 1e6, text: "x" }).status, 400);
    assert.deepEqual(cleanProjectNotes(JSON.parse(JSON.stringify(W.views.book.notes))).length, W.views.book.notes.length, "every note read back");
    // refused: an unknown cluster, a cluster of the other clustering's key alone, nowhere said
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { cluster: "N.C", clustering: "namespace", text: "x" }).status, 404, "N.C is a folder, not a namespace");
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { cluster: "N.C", clustering: "module", text: "x" }).status, 200);
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { text: "x" }).status, 400);
    // listed on a view of N.B alone: not the note in N.A
    const nb = W.views.book.create("N.B", "Alice", { scope: { op: "ns", prefix: "N.B" } });
    assert.ok(typeof nb !== "string");
    const listed = body(W.ask("read", "GET", "/api/agent/notes", { view: nb.id }));
    assert.ok(!listed.notes.some((n: Json) => n.id === body(inA).id));
    assert.ok(body(W.ask("read", "GET", "/api/agent/notes", { view: nb.id, all: "1" })).notes.some((n: Json) => n.id === body(inA).id && n.here === null));
    // moved under the module clustering alone
    const mv = W.ask("advise", "POST", "/api/agent/note/move", { id: body(inA).id, clustering: "module", cluster: "N.C", at: [0, 0.5] });
    assert.equal(mv.status, 200, JSON.stringify(mv.body));
    assert.deepEqual([body(mv).places.namespace.cluster, body(mv).places.module.cluster], ["N.A", "N.C"]);
    // made the own note of a view whose board does not show it: refused, and nothing else changed
    assert.equal(W.ask("advise", "POST", "/api/agent/note/edit", { id: body(inA).id, kind: "view", view: nb.id, text: "changed" }).status, 409);
    assert.equal(W.views.book.notes.find((n) => n.id === body(inA).id)!.text, "the swap is in `N.A.t`");
    // made this view's own, where it is on its board, and back
    const proj = W.views.book.project();
    const own = W.ask("advise", "POST", "/api/agent/note/edit", { id: body(inA).id, kind: "view", view: PROJECT });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.deepEqual([body(own).kind, body(own).view, proj.notes![0].by, proj.notes![0].text], ["view", PROJECT, "Claude", "the swap is in `N.A.t`"]);
    const again = W.ask("advise", "POST", "/api/agent/note/edit", { id: body(inA).id, kind: "project", view: PROJECT });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(body(again).places.namespace.cluster, "N.A");
    // levels: a read token writes nothing; at advise another's note is not changed; at full it is
    assert.equal(W.ask("read", "POST", "/api/agent/note", { ring: 0, text: "x" }).status, 403);
    W.views.arrangeNotes([{ op: "pnote", note: pnote("nAlice", {}) }], null, "Alice");
    for (const [path, p] of [["/api/agent/note/edit", { text: "y" }], ["/api/agent/note/move", { ring: 10 }], ["/api/agent/note/delete", {}]] as const) {
      assert.equal(W.ask("advise", "POST", path, { id: "nAlice", ...p }).status, 403, path);
      assert.equal(W.ask("advise", "POST", path, { id: "nAlice", ...p }, "Alice").status, 403, `${path}: a person's name in an agent's request is no person's note`);
    }
    assert.equal(W.ask("full", "POST", "/api/agent/note/move", { id: "nAlice", ring: 10 }).status, 200);
    assert.equal(W.ask("full", "POST", "/api/agent/note/delete", { id: "nAlice" }).status, 200);
    assert.deepEqual(W.events.filter((e) => e.kind === "note").map((e) => [(e as Json).what, (e as Json).view, (e as Json).agent ?? false]).at(-1), ["deleted", "", true]);
  } finally {
    W.done();
  }
});

test("agents read a note card's offset in the listings and set it with note/move or note/edit, at the levels moving a note has", () => {
  const W = world();
  try {
    const body = (a: Answer) => a.body as Json;
    // written with a card where it hangs: read back in the listing
    const made = W.ask("advise", "POST", "/api/agent/note", { cluster: "N.A", text: "look here", card: [100, -40] });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const id = body(made).id as string;
    const card = () => body(W.ask("read", "GET", "/api/agent/notes")).notes.find((n: Json) => n.id === id).card;
    assert.deepEqual(card(), [100, -40]);
    // moved alone: the card, not the note's places, and no event of the timeline
    const places = structuredClone(W.views.book.notes.find((n) => n.id === id)!.places);
    const events = W.events.length;
    const mv = W.ask("advise", "POST", "/api/agent/note/move", { id, card: [-50.4, 60.6] });
    assert.equal(mv.status, 200, JSON.stringify(mv.body));
    assert.deepEqual([card(), W.views.book.notes.find((n) => n.id === id)!.places], [[-50, 61], places]);
    assert.equal(W.events.length, events, "where a card hangs is no event");
    // with its place too; then back to the default by an edit
    assert.equal(W.ask("advise", "POST", "/api/agent/note/move", { id, ring: 30, card: [0, 80] }).status, 200);
    assert.deepEqual([card(), W.views.book.notes.find((n) => n.id === id)!.places.namespace], [[0, 80], { ring: 30 }]);
    assert.equal(W.ask("advise", "POST", "/api/agent/note/edit", { id, card: null }).status, 200);
    assert.equal(card(), null);
    // beyond its reach, refused
    assert.equal(W.ask("advise", "POST", "/api/agent/note/move", { id, card: [9999, 0] }).status, 400);
    // another's note: at full only, as moving it
    W.views.arrangeNotes([{ op: "pnote", note: pnote("nAlice", {}) }], null, "Alice");
    assert.equal(W.ask("advise", "POST", "/api/agent/note/move", { id: "nAlice", card: [10, 10] }).status, 403);
    assert.equal(W.ask("advise", "POST", "/api/agent/note/edit", { id: "nAlice", card: [10, 10] }).status, 403);
    assert.equal(W.ask("full", "POST", "/api/agent/note/edit", { id: "nAlice", card: [10, 10] }).status, 200);
    assert.deepEqual(W.views.book.notes.find((n) => n.id === "nAlice")!.card, [10, 10]);
    // a view's own note too
    const own = body(W.ask("advise", "POST", "/api/agent/note", { view: PROJECT, at: [0, 0], text: "the Project's own" }));
    assert.equal(own.card, null);
    assert.equal(W.ask("advise", "POST", "/api/agent/note/move", { id: own.id, view: PROJECT, card: [-30, -30] }).status, 200);
    assert.deepEqual(W.views.book.project().notes!.find((n) => n.id === own.id)!.card, [-30, -30]);
  } finally {
    W.done();
  }
});
