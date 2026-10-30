// Where a view's board draws what its exported document prints (the owner's decisions of 2026-10-12:
// the board is the outline of the document; shared/doc/order.ts orders by it), read on the server as
// a page draws the board at rest, so that an export from the page, from an agent or of a past build
// follows the board everyone on it sees.
//
// The board is laid out as the page lays it out (shared/board.ts): the server's layout for a board of
// the whole project, else the view's layout memory recalled — the server keeps it, as the pages hand
// it over — and, where no page has laid the board out for what it holds now (a view never opened, a
// new build, a review that changed what a scope holds), laid out from that memory by the same pure
// functions the page runs, which gives the picture the next page will show; nothing is handed over,
// since exporting only reads. A board of a past build is laid out as the Time Machine lays it out
// (web/src/timemachine.ts): from the view's memory of that build, else from its memory or the latest
// build's layout of the whole project, a declaration renamed since read under its name then. The
// view's pins are then applied by the page's own scene (web/src/scene.ts, which is pure): what is
// dropped stays where it was dropped and its neighbours make room, as the page draws them.
//
// What a page draws that the server does not read: folds, which gather a cluster's contents into a
// disc and slide its neighbours inward — the document prints everything whatever is folded, so its
// order is the board's with nothing folded; a reader's visitors and their temporary clusters, which
// are theirs alone; the easing of things still moving; and a drag not let go yet. A note on the ring
// is read where it points — the angle it was let go at, else that of what it is about — on the
// innermost ring, as when the board is zoomed in so far that one ring holds every note; one that
// points nowhere is at the top of the ring, in the order notes were written.

import { boardSet, edgesOf, layoutKey, pastSetKey, recalled, wholeLayout, boardLayout } from "../shared/board.ts";
import type { BoardMemory } from "../shared/board.ts";
import type { BoardNote, BoardSpots } from "../shared/doc/order.ts";
import type { Layout } from "../shared/graph.ts";
import { computeLayout, memoryOf, stabilize } from "../shared/layout.ts";
import { declSpot } from "../shared/notecard.ts";
import { aboutMembers, existsIn, itemSpot, itemWhy, linkedOn, linksByFile, noteBoard, viewSpot } from "../shared/noteplace.ts";
import type { NoteSpot } from "../shared/noteplace.ts";
import type { ProjectNote } from "../shared/projectnotes.ts";
import type { ReviewData } from "../shared/review.ts";
import { aboutAngle, ringAround, ringRadians } from "../shared/ring.ts";
import type { StickyNote } from "../shared/sticky.ts";
import type { Graph } from "../shared/viewgraph.ts";
import { fixedScope } from "../shared/views.ts";
import type { ViewData } from "../shared/views.ts";
import { renamedMemory } from "../web/src/past.ts";
import { Scene } from "../web/src/scene.ts";

/** A board as the server reads it for a document. */
export interface BoardSource {
  /** the graph the board is of: the latest build's, or a past build's past graph */
  g: Graph;
  /** the review as that board reads it (a past board's under the names then too) */
  review: ReviewData;
  rec: ViewData;
  /** the view's layout memory by its clustering, as the server keeps it */
  memory: BoardMemory | null;
  /** the server's layout of the whole latest build by the view's clustering, where there is one: a
   *  board of the whole project is drawn on it, and a past board may be laid out from it */
  whole?: Layout;
  /** of a past build: its snapshot, the name now of each declaration renamed since, and the latest
   *  build's graph and review, on which the page decides whether the view's board of now is the whole
   *  project */
  past?: { snapshot: number; nowName: ReadonlyMap<string, string>; now: Graph; nowReview: ReviewData };
  /** the notes of the project */
  notes: readonly ProjectNote[];
}

/** a declaration on the ring's edge, as the page counts it there (web/src/sticky.ts, ringNow) */
const LEAF_RING_R = 8;
/** the most declarations the centre of what a note on the ring is about is taken over, every so
 *  many of them beyond, as the page samples them (web/src/sticky.ts) */
const ABOUT_MOST = 4000;

/** The board of view `b.rec` as its page draws it at rest, nothing folded: where each declaration,
 *  circle and note is (shared/doc/order.ts). */
export function boardSpots(b: BoardSource): BoardSpots {
  const { g, review, rec } = b;
  const mode = rec.clustering;
  const hidden = rec.hidden[mode] ?? [];
  const bs = boardSet(g, review, rec.scope);
  const G = bs.sub ? bs.sub.graph : g;
  let L: Layout;
  let fresh = false;
  if (b.past) {
    const key = pastSetKey(b.past.snapshot, layoutKey(bs.key, hidden));
    const quick = recalled(G, mode, key, b.memory, hidden);
    if (quick) L = quick.layout;
    else {
      // laid out from the view's memory; with none, from the latest build's layout where the view's
      // board of now is the whole project (the Time Machine's `wholeNow`), else afresh
      const whole = !b.memory && !!b.whole && boardSet(b.past.now, b.past.nowReview, rec.scope).whole;
      const base = b.memory ? b.memory.mem : whole ? memoryOf(wholeLayout(b.whole!, b.past.now.nodes, mode, hidden), b.past.now.nodes) : null;
      L = stabilize(computeLayout(mode, G.nodes, edgesOf(G), hidden), G.nodes, base && renamedMemory(base, b.past.nowName));
      fresh = true;
    }
  } else if (bs.whole && b.whole) L = wholeLayout(b.whole, G.nodes, mode, hidden);
  else {
    const quick = recalled(G, mode, layoutKey(bs.key, hidden), b.memory, hidden);
    L = quick ? quick.layout : boardLayout(G, mode, bs.key, b.memory, hidden).layout;
    fresh = !quick;
  }

  // the pins applied as the page applies them, nothing folded
  const S = new Scene(L);
  S.restore(rec.pins[mode] ?? { nodes: {}, clusters: {} }, [], (i) => G.nodes[i].name);
  const decls = new Map<string, [number, number]>();
  for (let i = 0; i < G.n; i++) decls.set(G.nodes[i].name, [S.nwx[i], S.nwy[i]]);
  const clusters = new Map<string, [number, number]>();
  L.clusters.forEach((c, k) => clusters.set(c.key, [S.cwx[k], S.cwy[k]]));

  // the notes the view shows, each where the page draws its icon (web/src/sticky.ts, render)
  const nb = noteBoard(L, mode, G.nodes);
  const exists = existsIn(g.nodes);
  const links = linksByFile(review.links);
  const view = { all: fixedScope(rec), items: rec.items };
  const index = new Map(L.clusters.map((c, k) => [c.key, k]));
  const chain = (c: number): string[] => {
    const out: string[] = [];
    for (let x = c; x >= 0; x = L.clusters[x].parent) out.push(L.clusters[x].key);
    return out;
  };
  let ring: ReturnType<typeof ringAround> | undefined;
  const ringOf = () =>
    (ring ??= ringAround([...S.rootC.map((c) => ({ x: S.cwx[c], y: S.cwy[c], r: S.drawnR[c] })), ...S.rootN.map((i) => ({ x: S.nwx[i], y: S.nwy[i], r: LEAF_RING_R }))]));
  /** Where a note on the ring is read: where it points on the innermost ring, else its top. */
  const onRing = (spot: Extract<NoteSpot, { at: "ring" }> | null): [number, number] => {
    const R = ringOf();
    if (!R) return [0, 0];
    let a: number | null = spot && spot.angle !== null ? ringRadians(spot.angle) : null;
    if (a === null && spot?.about) {
      let about = aboutMembers(nb, spot.about);
      if (about.length > ABOUT_MOST) about = about.filter((_, k) => k % Math.ceil(about.length / ABOUT_MOST) === 0);
      if (about.length) {
        let x = 0, y = 0;
        for (const j of about) [x, y] = [x + S.nwx[j], y + S.nwy[j]];
        a = aboutAngle(R, [x / about.length, y / about.length]);
      }
    }
    const t = a ?? -Math.PI / 2;
    return [R.x + R.r * Math.cos(t), R.y + R.r * Math.sin(t)];
  };
  const notes: BoardNote[] = [];
  const seen = new Set<string>();
  const place = (note: ProjectNote | StickyNote, kind: "project" | "view", spot: NoteSpot | null) => {
    if (!spot || seen.has(note.id)) return;
    seen.add(note.id);
    // attached to a declaration the board holds: printed after it, its icon at its offset from the
    // point, a place on the board in its units, as the page draws it
    const on = note.decl && nb.index.get(note.decl.name);
    if (note.decl && on !== undefined) {
      notes.push({ note, kind, at: declSpot([S.nwx[on], S.nwy[on]], note.decl.at), in: chain(L.cluster[on]), on: note.decl.name });
      return;
    }
    switch (spot.at) {
      case "cluster": {
        // a fraction of the radius drawn
        const R = S.drawnR[spot.c];
        notes.push({ note, kind, at: [S.cwx[spot.c] + spot.f[0] * R, S.cwy[spot.c] + spot.f[1] * R], in: chain(spot.c) });
        return;
      }
      case "offset": {
        // kept inside its circle, however the circle changed since it was put there
        const R = S.drawnR[spot.c];
        const len = Math.hypot(spot.d[0], spot.d[1]);
        const f = len > R ? R / len : 1;
        notes.push({ note, kind, at: [S.cwx[spot.c] + spot.d[0] * f, S.cwy[spot.c] + spot.d[1] * f], in: chain(spot.c) });
        return;
      }
      case "world":
        notes.push({ note, kind, at: [spot.x, spot.y], in: [] });
        return;
      case "ring":
        notes.push({ note, kind, at: onRing(spot), in: [] });
        return;
      default:
        // a place this reading does not know: at the start, at the top of the ring
        notes.push({ note, kind, at: onRing(null), in: [] });
    }
  };
  for (const n of b.notes) {
    const why = itemWhy(n, view, nb, exists, links);
    place(n, "project", why ? itemSpot(n, nb, exists, linkedOn(n, nb, links)) : null);
  }
  for (const n of rec.notes ?? []) place(n, "view", viewSpot(n, nb, (key) => index.get(key) ?? -1, exists));
  // in the order they were written, which is the order of those level on the board: the notes that
  // point nowhere on the ring, at its top
  notes.sort((x, y) => (x.note.at < y.note.at ? -1 : x.note.at > y.note.at ? 1 : 0));
  return { decls, clusters, notes, ...(fresh ? { fresh: true } : {}) };
}
