// A note on the canvas (CanvasSpec, "Notes", the owner's decisions of 2026-10-11): a small round icon
// at its place — the spot its place records — that shows what the note carries, and, expanded, its card
// (its text, what it carries, who wrote it) at an offset from the icon, joined to it by a thin leader
// line. The card keeps its size on the screen whatever the zoom, so its offset is kept in pixels of
// the screen (shared/sticky.ts, NoteCard), per note and shared as its open state is; it is never the
// note's place, which only a drag on the icon changes. This file is the geometry and the rules the
// page draws by (web/src/sticky.ts), the same in the tests: boxes are in pixels of the screen, y down.
//
// Icons scale with what they belong to (the owner's decisions of 2026-10-12): a note in a cluster, or
// attached to a declaration, is its clickable icon only while its cluster — for an attached note the
// cluster that holds its declaration — is large enough on the screen to hold a card, and below that a
// dot the size of a declaration's point, coloured by what it carries, shrinking with the zoom as
// points do; between the two it is a blend over a short range of zoom, never a jump in time. One rule
// for every note that belongs to something on the board. An attached note's offset from its
// declaration is a place on the board, in its units, so it comes closer on the screen as the zoom
// goes out. On the ring and on the canvas an icon keeps its size whatever the zoom.
//
// While the icon of a note attached to a declaration is dragged, a circle round the declaration shows
// where it stays attached (the owner's decision of 2026-10-12): its reach on the board, held on the
// screen between 48 and 160 px whatever the zoom, so that zoomed out a short move does not leave it
// and zoomed in a short move does; out of it, the note is dragged as a free note is, and another
// declaration under it takes it wherever it is.
//
// The notes layer stacks, bottom to top (NOTE_Z): the leaders, the icons and dots with the folded
// clusters' markers, the cards — the one pressed or opened last in front —, what would hold a dragged
// note, and the icon being dragged. An expanded note's card covers the icons under it; its own it
// never covers, since a card hangs clear of its icon.

import type { FitBox } from "./ring.ts";
import { AUTO_COLLAPSE_PX, CARD_REACH, DECL_AT, DECL_REACH, keptDecl, noteLook, ZONE_MAX_PX, ZONE_MIN_PX } from "./sticky.ts";
import type { NoteCard, NoteCarry } from "./sticky.ts";

/** the icon's diameter on the screen, in pixels: something to point at and click, small enough to
 *  sit in a cluster without covering what is around its place */
export const ICON_PX = 24;
export const ICON_R = ICON_PX / 2;
/** where a card hangs by default: its corner nearest the icon this far to the right of and above the
 *  icon's centre, which leaves a short leader between the two */
export const CARD_GAP = 20;
/** on the ring, how far out from the icon's centre the side of its card that faces the middle is */
const RING_HANG = ICON_R + 14;
/** the least room between a card and its icon: a card never covers its own icon */
const ICON_CLEAR = ICON_R + 4;

/** What a note's icon shows (the owner's decision of 2026-10-11): what it carries, and nothing else —
 *  a note where it carries nothing, an image where it carries images alone, a paper where it carries
 *  a PDF or a clip of one. Its text never counts, so that an icon does not depend on how the text
 *  came about. */
export type IconKind = "note" | "image" | "paper";

/** A file a note carries, as its icon reads it: its type (shared/library.ts, FileRecord). */
export interface IconFile {
  type: string;
}

/** The icon of a note that carries `carries` (`fileOf`: the library's record of a file, null where it
 *  has none, which counts as a paper). */
export function iconKind(carries: readonly NoteCarry[] | undefined, fileOf: (sha: string) => IconFile | null): IconKind {
  const cs = carries ?? [];
  if (!cs.length) return "note";
  return cs.every((c) => !c.region && (fileOf(c.file)?.type ?? "pdf") !== "pdf") ? "image" : "paper";
}

/** The count on a note's icon: how many things it carries — files and clips alike, as its tooltip
 *  lists them — where that is more than one; null for one or none. */
export function carryCount(carries: readonly NoteCarry[] | undefined): number | null {
  const n = carries?.length ?? 0;
  return n > 1 ? n : null;
}

/** What of a note shows (CanvasSpec, "Notes"): nothing in a folded cluster or in one the board does
 *  not draw (`hidden`: a fold counts it); else its icon, always, and its card — "open" — where the
 *  note is expanded and its cluster is large enough on the screen to hold the card (`clusterPx`, its
 *  radius in pixels; null on the canvas, never too small: shared/sticky.ts, noteLook). Zoomed out,
 *  the card is hidden and the icon stays — "shut", as a note collapsed by its own state shows. */
export function noteShows(open: boolean, clusterPx: number | null, hidden = false): "open" | "shut" | "hidden" {
  return hidden ? "hidden" : noteLook(open, clusterPx);
}

// ---------------------------------------------------------------- icons and dots

/** A declaration's point across, in board units (web/src/scene.ts, LEAF_R, twice), and how large it
 *  must be on the screen to be pointed at (web/src/canvas.ts, NODE_MIN_PX): the canvas's rule for
 *  pointing at declarations, from a zoom of 0.6, which a note is attached by a drop under. */
export const POINT_UNITS = 10;
export const POINT_MIN_PX = 6;

/** A declaration's point's radius on the screen at zoom `k`, as the canvas draws it (web/src/canvas.ts,
 *  dotPx): smaller as the zoom goes out, never under 1.3 px nor over 5. A note's dot is as large. */
export const pointPx = (k: number): number => Math.max(1.3, Math.min(5, 3 * Math.sqrt(k)));

/** Whether declarations can be pointed at on the screen at zoom `k` (the canvas's rule). */
export const declsPointable = (k: number): boolean => POINT_UNITS * k >= POINT_MIN_PX;

/** Over how much zoom a note's icon turns into its dot, in doublings of the zoom: from the zoom at
 *  which what it belongs to is clearly visible down to that zoom over √2, about 41 % — short enough to
 *  read as one change, long enough that it is never a jump. */
export const BLEND_OCTAVES = 0.5;

/** What a note belongs to on the board, as its icon scales with it: a circle, by its radius in board
 *  units (`r`) — the cluster it is in, or the cluster that holds the declaration it is attached to
 *  (levelOf) —, or nothing that scales — on the ring, or a view note on the canvas — null. */
export type NoteLevel = { r: number } | null;

/** What a note belongs to on the board (the owner's decision of 2026-10-12: one rule for every note
 *  that belongs to something there): a note in a cluster, its cluster; a note attached to a
 *  declaration, the cluster that holds the declaration — at the top level the whole board, whose
 *  extent the ring's radius is (`top`; null: none, and the note keeps its icon) —; on the ring or the
 *  canvas, nothing. `c` is the cluster (-1 for none), `radius` its radius drawn. */
export function levelOf(at: "cluster" | "decl" | "ring" | "world", c: number, radius: (c: number) => number, top: number | null): NoteLevel {
  if (at === "ring" || at === "world") return null;
  if (c >= 0) return { r: radius(c) };
  return at === "decl" && top !== null ? { r: top } : null;
}

/** How much of a note's icon shows at zoom `k`, from 0 (its dot) to 1 (its icon): 1 while the circle
 *  it belongs to is at least AUTO_COLLAPSE_PX round on the screen, the threshold that already decides
 *  whether a card can show, and on the ring or the canvas; 0 at BLEND_OCTAVES of zoom below that and
 *  further out; between, in proportion to the zoom's logarithm, so that it follows the zoom as the
 *  edges do. */
export function iconShare(level: NoteLevel, k: number): number {
  if (!level) return 1;
  const px = level.r * k;
  if (px >= AUTO_COLLAPSE_PX) return 1;
  if (!(px > 0)) return 0;
  return Math.max(0, Math.min(1, 1 + Math.log2(px / AUTO_COLLAPSE_PX) / BLEND_OCTAVES));
}

/** A note's mark's radius on the screen at zoom `k`, `t` of its icon showing (iconShare): its icon's,
 *  ICON_R, at 1; a declaration's point's at 0 (pointPx); between, in proportion. */
export const markR = (t: number, k: number): number => pointPx(k) + (ICON_R - pointPx(k)) * t;

/** Where a note attached to a declaration is in the board's world: its offset (NoteDecl.at, in the
 *  board's units) from the declaration's point at `point` — a place on the board, as a node's is, so
 *  that its distance on the screen is the offset times the zoom. Its icon and its dot alike are drawn
 *  there. */
export const declSpot = (point: readonly [number, number], at: readonly [number, number]): [number, number] => [point[0] + at[0], point[1] + at[1]];

/** What a click on a note's mark does: below its icon (`t` < 1, a dot or turning into one) it flies to
 *  the note, near enough to read it; on the icon it opens or collapses the note — but where its card
 *  is hidden by the zoom though it is expanded (`auto`: on the ring), it flies there too. */
export const markClick = (t: number, auto: boolean): "fly" | "toggle" => (t < 1 || auto ? "fly" : "toggle");

/** How a note shows at zoom `k` (the owner's decision of 2026-10-12): `t`, how much of its icon
 *  (iconShare), and `look` — hidden where a fold or the board hides it; its card where it is
 *  expanded and its icon shows whole (a card shows only while its icon does); else its mark alone. */
export function markLook(open: boolean, level: NoteLevel, k: number, hidden = false): { look: "open" | "shut" | "hidden"; t: number } {
  const t = iconShare(level, k);
  return { look: hidden ? "hidden" : open && t >= 1 ? "open" : "shut", t };
}

/** How far from the point, on the screen, a note let go on a declaration sits at least: room for the
 *  icon (12 px round), the point (at most 5 px round), the diamond on its rim and a leader between
 *  them long enough to read as one, at the zoom it was let go at */
export const DECL_CLEAR_PX = 40;

/** The radius on the screen, in pixels, at zoom `k`, of the circle round a declaration in which a
 *  note attached to it stays attached while its icon is dragged (the owner's decision of 2026-10-12):
 *  the reach, DECL_REACH units, as the zoom draws it, held between ZONE_MIN_PX and ZONE_MAX_PX — so
 *  that zoomed in, a short move takes the note off its declaration, and zoomed out, the circle still
 *  shows round the icon and a short move does not. 48 px below a zoom of 0.75, 64 × the zoom up to
 *  2.5, 160 px above. */
export const zonePx = (k: number): number => Math.max(ZONE_MIN_PX, Math.min(ZONE_MAX_PX, DECL_REACH * k));

/** Whether an icon at `icon`, in the board's world, is inside the circle round the point at `point`
 *  at zoom `k` (zonePx). */
export const inZone = (icon: readonly [number, number], point: readonly [number, number], k: number): boolean => Math.hypot(icon[0] - point[0], icon[1] - point[1]) * k <= zonePx(k);

/** The declaration a note is attached to once its icon is let go at `icon`, in the board's world, at
 *  zoom `k` (the owner's decisions of 2026-10-12): another declaration under it (`under`: the canvas's
 *  own hit, where declarations can be pointed at), wherever that is, which wins over the circle and
 *  over the cluster around it; else the one it is attached to already (`own`), where the icon is
 *  inside the circle round its point (inZone) — there it stays (`stay`); else none, and it is placed
 *  as a free note is (a cluster, the ring, the canvas). Each is given with its point in the world. The
 *  declaration, and the offset the note keeps from it in the board's units (keptDecl): where it was
 *  let go, on that side of the point, pushed out to DECL_CLEAR_PX on the screen at this zoom so that
 *  it clears the point as the reader sees it, DECL_NEAR at least and never further out than
 *  DECL_REACH. An icon let go inside the circle is kept where it was let go, or pushed out to clear
 *  the point and still inside: the circle is never smaller than the push nor larger than the farthest
 *  offset kept (shared/sticky.ts, DECL_FAR). */
export function declDrop(icon: readonly [number, number], under: { j: number; at: readonly [number, number] } | null, own: { j: number; at: readonly [number, number] } | null, k: number): { j: number; d: [number, number]; stay: boolean } | null {
  // its own point under the icon is inside its circle: it stays
  const other = under && under.j !== own?.j ? under : null;
  const pick = other ?? (own && (under || inZone(icon, own.at, k)) ? own : null);
  if (!pick) return null;
  // let go right on the point, it has no side: up and to the right, as by default, pushed out as far
  // as any drop, so that it is inside the circle zoomed in too, where the default offset is not
  const dx = icon[0] - pick.at[0], dy = icon[1] - pick.at[1];
  const d: [number, number] = Math.hypot(dx, dy) >= 0.1 ? [dx, dy] : [DECL_AT[0] / Math.hypot(...DECL_AT), DECL_AT[1] / Math.hypot(...DECL_AT)];
  return { j: pick.j, d: keptDecl(d, DECL_CLEAR_PX / k), stay: pick === own };
}

/** The leader of a note attached to a declaration, and the mark at the declaration's end: a thin
 *  dashed line from the icon's edge (`r`, its radius now) toward the point, ending at a small diamond
 *  that sits on the point's rim (`pr`, the point's radius), so that the point keeps its colour. The
 *  diamond and the room around it scale with the icon (`s`, its scale: shared with the line's width
 *  by the page), so that they shrink as the icon turns into its dot. All on the screen: the point at
 *  `p`, the icon at `i`. Null where they are too near for a line. */
export function declLeader(p: readonly [number, number], i: readonly [number, number], r: number, pr: number, s = 1): { line: [number, number, number, number]; mark: [number, number] } | null {
  const dx = i[0] - p[0], dy = i[1] - p[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const dr = DIAMOND_R * s;
  const m = pr + dr + s;
  if (!(len > r + m + dr + 2 * s)) return null;
  return { line: [i[0] - ux * r, i[1] - uy * r, p[0] + ux * (m + dr), p[1] + uy * (m + dr)], mark: [p[0] + ux * m, p[1] + uy * m] };
}

/** the diamond's half-diagonal at the declaration's end of an attached note's leader, in pixels, at
 *  the icon's full size */
export const DIAMOND_R = 3.5;

// ---------------------------------------------------------------- stacking

/** How the notes layer stacks, bottom to top (the owner's decision of 2026-10-12: an expanded note's
 *  card covers icons; web/style.css holds the same numbers): the leaders — a card's, an attached
 *  note's to its declaration, and its diamond —, under every mark so that no line crosses an icon;
 *  the icons and dots, and the folded clusters' note markers, which stand on the board as the icons
 *  do; the cards, those pressed or opened last in front of the others (`card` + their rank, up to
 *  STACK_MOST); what would hold a dragged note, lit over the cards so that a declaration or a circle
 *  under one still shows; and the icon being dragged, over everything, so that it stays in sight. */
export const NOTE_Z = { leader: 1, mark: 2, card: 3, target: 68, dragged: 69 } as const;
/** how many cards keep their place in front, the last pressed or opened first; one pressed longer ago
 *  goes back among the others. The frontmost card's z-index, NOTE_Z.card + STACK_MOST, stays under
 *  NOTE_Z.target. */
export const STACK_MOST = 64;

/** The cards' order in front after note `id` is pressed or opened (`order`: the notes in front, the
 *  frontmost last): `id` to the front, the oldest beyond STACK_MOST let go. */
export function raiseCard(order: readonly string[], id: string): string[] {
  const out = order.filter((x) => x !== id);
  out.push(id);
  return out.length > STACK_MOST ? out.slice(out.length - STACK_MOST) : out;
}

/** A card's place in the stack (its z-index on the layer): NOTE_Z.card for one never brought to the
 *  front (among them, the order the layer holds them in), above that by its rank in `order`. */
export const cardZ = (order: readonly string[], id: string): number => NOTE_Z.card + order.indexOf(id) + 1;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The box of a card `w` × `h` hanging at offset `off` from an icon at (x, y). */
export const cardBox = (x: number, y: number, off: NoteCard, w: number, h: number): Box => ({ x0: x + off[0] - w / 2, y0: y + off[1] - h / 2, x1: x + off[0] + w / 2, y1: y + off[1] + h / 2 });

/** Where a card hangs by default: up and to the right of its icon, its nearest corner CARD_GAP from
 *  the icon's centre each way, so that it grows away from the icon as what it shows grows. */
export const defaultCard = (w: number, h: number): NoteCard => [CARD_GAP + w / 2, -(CARD_GAP + h / 2)];

/** Where a card hangs by default from an icon on the ring at angle `a` (radians, in the board's
 *  coordinates, whose y grows downwards as the screen's does): outward, the side that faces the
 *  middle touching a point a little beyond the icon on the ray, as a note's box on the ring always
 *  touched the ring (shared/ring.ts, ringBox). */
export const ringCard = (a: number, w: number, h: number): NoteCard => [(RING_HANG + w / 2) * Math.cos(a), (RING_HANG + h / 2) * Math.sin(a)];

/** An offset moved outwards along its own direction until the card is clear of its icon: a card
 *  never covers the icon that is its note's place. */
export function clearOfIcon(off: NoteCard, w: number, h: number): NoteCard {
  const [dx, dy] = off;
  const nx = w / 2 + ICON_CLEAR, ny = h / 2 + ICON_CLEAR;
  if (Math.abs(dx) >= nx || Math.abs(dy) >= ny) return off;
  if (!dx && !dy) return defaultCard(w, h);
  const t = Math.min(dx ? nx / Math.abs(dx) : Infinity, dy ? ny / Math.abs(dy) : Infinity);
  return [dx * t, dy * t];
}

/** The offset a card dragged to centre `centre` keeps from its icon at `icon`: clear of the icon,
 *  within CARD_REACH, in whole pixels. */
export function keptCard(icon: [number, number], centre: [number, number], w: number, h: number): NoteCard {
  const [dx, dy] = clearOfIcon([centre[0] - icon[0], centre[1] - icon[1]], w, h);
  const within = (v: number) => Math.round(Math.max(-CARD_REACH, Math.min(CARD_REACH, v)));
  return [within(dx), within(dy)];
}

const area = (a: Box, b: Box): number => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** The ways a card can hang from its icon: as its offset says, mirrored across, up and down, both. */
const FLIPS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/** Where a card `w` × `h` hangs from an icon at `icon` with offset `off`: as the offset says, or
 *  mirrored across, up and down, or both — the first of those that lies wholly in `room` (the screen
 *  the bars and panels leave), and, where `avoid` is given (the icon's own cluster's name, for a card
 *  hanging as by default), the first of those that also keeps off it; where none lies wholly in the
 *  room, the one that has the most of it there. Its box, and which way it hangs (0–3, as FLIPS). */
export function hangCard(icon: [number, number], off: NoteCard, w: number, h: number, room: Box, avoid: Box | null = null): { box: Box; flip: number } {
  let best: { box: Box; flip: number; out: number; covers: boolean } | null = null;
  for (let f = 0; f < FLIPS.length; f++) {
    const box = cardBox(icon[0], icon[1], [off[0] * FLIPS[f][0], off[1] * FLIPS[f][1]], w, h);
    // what lies outside the room, under half a pixel being none
    const outside = w * h - area(box, room);
    const out = outside > 0.5 ? outside : 0;
    const covers = !!avoid && area(box, avoid) > 0;
    if (!best || out < best.out || (out === best.out && best.covers && !covers)) best = { box, flip: f, out, covers };
    if (!out && !covers) break;
  }
  return { box: best!.box, flip: best!.flip };
}

/** The leader between an icon at (x, y) and its card's box: from the icon's edge to the point of the
 *  card nearest the icon's centre; null where they touch. */
export function leaderLine(x: number, y: number, b: Box): [number, number, number, number] | null {
  const px = Math.max(b.x0, Math.min(b.x1, x)), py = Math.max(b.y0, Math.min(b.y1, y));
  const d = Math.hypot(px - x, py - y);
  if (d <= ICON_R + 1) return null;
  return [x + ((px - x) / d) * ICON_R, y + ((py - y) / d) * ICON_R, px, py];
}

/** What would hold a note let go where it is dragged now, lit while it is dragged: another
 *  declaration it would be attached to (declDrop), the cluster it would be put in (the circle drawn
 *  for it), the ring, for a note of the project at the top level, or nothing, for a view note, which
 *  stays on the canvas there. A note attached to a declaration and let go inside the circle round it
 *  (zonePx) stays, and that circle is what the page lights instead. `to` is where it would go in a
 *  cluster or on the ring, as the page puts a free note let go (web/src/sticky.ts, placeFor); `stands`
 *  the circle drawn for each key of a project note's place, `index` the layout's cluster of a view
 *  note's key. */
export type DropTarget = { at: "decl"; j: number } | { at: "cluster"; c: number } | { at: "ring" } | null;
export function dropTarget(
  to: { kind: "project"; place: { in: [string, number, number][] } | { ring: number } } | { kind: "view"; place: { in: [string, number, number][] } } | null,
  stands: (key: string) => number | undefined,
  index: (key: string) => number,
): DropTarget {
  if (!to) return null;
  if (to.kind === "project") {
    if (!("in" in to.place)) return { at: "ring" };
    const c = stands(to.place.in[0][0]);
    return c !== undefined && c >= 0 ? { at: "cluster", c } : { at: "ring" };
  }
  const key = to.place.in[0]?.[0];
  const c = key === undefined ? -1 : index(key);
  return c >= 0 ? { at: "cluster", c } : null;
}

/** A note as framing the board reads it: a point in the world — its place, or, attached to a
 *  declaration, its spot beside it (declSpot) —, its mark at the zoom asked about (`mark`: its centre
 *  from that point and its radius, in pixels of the screen; by default its icon on the point), and,
 *  where it shows expanded at that zoom (`card`), its card's offset from the mark and its size there. */
export interface FitNote {
  x: number;
  y: number;
  mark?: (k: number) => { d: [number, number]; r: number };
  card: ((k: number) => { off: NoteCard; w: number; h: number } | null) | null;
}

/** What Fit to screen holds of the notes at zoom `k`: each mark — its icon where the icon shows at
 *  that zoom, else its dot — and with `cards` each card that shows at that zoom, as it hangs
 *  unflipped: a view that holds it leaves it on the screen as it is. */
export function noteBoxes(notes: readonly FitNote[], k: number, cards: boolean): FitBox[] {
  const out: FitBox[] = [];
  for (const n of notes) {
    const { d, r } = n.mark ? n.mark(k) : { d: [0, 0], r: ICON_R };
    out.push({ x: n.x, y: n.y, dx0: d[0] - r, dy0: d[1] - r, dx1: d[0] + r, dy1: d[1] + r });
    const c = cards && n.card ? n.card(k) : null;
    if (c) out.push({ x: n.x, y: n.y, dx0: d[0] + c.off[0] - c.w / 2, dy0: d[1] + c.off[1] - c.h / 2, dx1: d[0] + c.off[0] + c.w / 2, dy1: d[1] + c.off[1] + c.h / 2 });
  }
  return out;
}
