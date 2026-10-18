// When the pairing opens the reference window, why it opens none, and where that window goes
// (AttachmentSpec decisions 8 and 11). Paired with a source window (the owner's decisions of
// 2026-10-11), the two stand side by side, the source on the left and the reference on the right,
// neither covering the other: across the page's width, over the side panels, centred and at most
// PAIR_MAX wide together, their tops and bottoms lined up. A window the reader placed by hand stays
// where they put it, the other beside it, where the two can stand side by side without overlapping;
// where they cannot, the pairing lays the two out afresh as it opens or shows them. Not paired, it
// opens between the side panel and the declaration's panel, where the board is. The decision and the
// geometry alone, tested without a browser (test/pairing.test.ts), but for `pairTop` and
// `betweenPanels`, which read where the page's bars and panels are; web/src/paperlinks.ts,
// paperwin.ts and main.ts use it.

import type { ClusterMode } from "../../shared/graph.ts";
import type { Link } from "../../shared/library.ts";
import { EDGE } from "./floatwin.ts";
import type { Rect, Size } from "./floatwin.ts";
import { windowRegion } from "./monitor.ts";

/** What the pairing does as a source window shows a declaration: opens a link in the reference
 *  window — laid out afresh beside it, or where the reader left the two — keeps what it shows (the
 *  same link, lit already, in sight), or opens nothing: the declaration and the clusters around it
 *  have no link (`unlinked`; the reference window says so too where it is open), or the first is
 *  into a file the library has no record of (`unrecorded`). */
export type PairingStep = { open: Link; afresh: boolean } | { keep: true } | { none: "unlinked" | "unrecorded"; said: boolean };

/** The pairing's step (decision 8): `found` the declaration's links or its innermost linked
 *  cluster's (shared/library.ts, pairedLinks); `open`, `collapsed` and `lit` what the reference
 *  window shows; `again` whether the same declaration was paired last, in the same source window;
 *  `other` whether that window is another than the one paired before. The two windows are laid out
 *  afresh when the pairing opens the reference window or comes to another source window: else the
 *  reader's places stay. A reference window collapsed to its pill is opened again, the reader having
 *  asked for the source again. */
export function pairingStep(o: { found: { links: Link[] } | null; recorded(sha: string): boolean; open: boolean; collapsed: boolean; lit: string | null; again: boolean; other: boolean }): PairingStep {
  if (!o.found?.links.length) return { none: "unlinked", said: o.open };
  const first = o.found.links[0];
  if (o.again && o.open && !o.collapsed && o.lit === first.id && !o.other) return { keep: true };
  if (!o.recorded(first.file)) return { none: "unrecorded", said: false };
  return { open: first, afresh: !o.open || o.other };
}

/** Why the pairing opened nothing beside a source window (decision 8, the owner's of 2026-10-11:
 *  in Safari it opened nothing and said nothing): the reader follows someone, whose reference window
 *  theirs shows (`following`: by name); or the declaration (`unlinked`, `unrecorded`: in a few words)
 *  and the clusters around it under the board's clustering (`mode`) have no link, or only one into a
 *  file the library has no record of. The pairing itself is always on (the owner's decision of
 *  2026-10-11), so it is never why. */
export type Unpaired = { following: string } | { unlinked: string; mode: ClusterMode } | { unrecorded: string };

/** What the source window's head says of it, in a short line. */
export function unpairedLine(u: Unpaired): string {
  if ("following" in u) return `Following ${u.following}: the reference window shows theirs.`;
  if ("unlinked" in u) return `No reference is linked to ${u.unlinked} or to a ${u.mode === "module" ? "folder" : "namespace"} around it.`;
  return `The reference for ${u.unrecorded} is a file the library has no record of.`;
}

/** the gap between the source window and the reference window beside it */
export const DOCK_GAP = 10;
/** the least each of the two takes side by side: a source's lines, a page one can read */
export const PAIR_MIN = { source: 420, paper: 380 } as const;
/** the most the two take together, side by side (the owner's decision of 2026-10-11, after they
 *  were narrow between the panels): room for a source's long lines and a page read at a good size,
 *  short of a screen so wide that the eye travels too far from the code to the paper */
export const PAIR_MAX = 1800;
/** the most a reference window takes when it is not paired */
const LONE_MAX = 900;
/** the smallest the reader can make the reference window, viewport permitting */
export const MIN: Size = { w: 320, h: 220 };

/** An area of the screen, by its edges: where the two paired windows stand. */
export interface Area {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The box of a panel of the page, where it is shown; null where it is hidden. */
function panelBox(q: string): DOMRect | null {
  const r = document.querySelector<HTMLElement>(q)?.getBoundingClientRect();
  return r && r.width && r.height ? r : null;
}

/** Where the paired windows' tops are: under the view bar, which stays in sight with the bar above
 *  it. */
export function pairTop(): number {
  return (panelBox("#viewbar")?.bottom ?? 64) + 8;
}

/** Where the two paired windows stand (the owner's decision of 2026-10-11): across the page's width
 *  less its margins, centred and PAIR_MAX wide at most, over the side panels, which stay where they
 *  are under them and are in sight again once the pair is closed or moved; from `top` to the page's
 *  bottom margin. */
export function pairArea(vp: Size, top: number): Area {
  const w = Math.min(PAIR_MAX, vp.w - 2 * EDGE);
  const left = Math.round((vp.w - w) / 2);
  const a = { left, right: left + w, top: Math.min(top, vp.h - EDGE - MIN.h), bottom: vp.h - EDGE };
  // an upright monitor's prototype (web/src/monitor.ts): within the part the windows open in
  const r = windowRegion(vp);
  return r ? { left: Math.max(a.left, r.x), right: Math.min(a.right, r.x + r.w), top: Math.max(a.top, r.y), bottom: Math.min(a.bottom, r.y + r.h) } : a;
}

/** How wide the source window may be beside the reference window: half the area at most, where that
 *  leaves the reference its least, and never less than the source's own least. */
export function pairedSourceMax(a: Area): number {
  const w = a.right - a.left - DOCK_GAP;
  return Math.max(Math.min(PAIR_MIN.source, w), Math.min(Math.floor(w / 2), w - PAIR_MIN.paper));
}

/** Where the two windows stand side by side in `a`: the source on the left, as wide as its code
 *  wants (`srcW`) between its least and `pairedSourceMax`; the reference on the right, taking the
 *  rest of the width. Both are as tall as the area, so that their tops and bottoms line up (the
 *  owner's decision of 2026-10-11, after the source stood shorter than the reference). Where the
 *  page is too narrow for both at their least, each is at its least (the page's width at most), the
 *  source at the page's left margin and the reference at its right: they overlap by as little as
 *  that allows, the reference in front. */
export function pairRects(srcW: number, a: Area, vp: Size): { source: Rect; paper: Rect } {
  const top = a.top;
  const h = Math.max(MIN.h, a.bottom - a.top);
  const W = a.right - a.left;
  if (W < PAIR_MIN.source + DOCK_GAP + PAIR_MIN.paper) {
    const sw = Math.min(PAIR_MIN.source, vp.w - 2 * EDGE);
    const pw = Math.min(PAIR_MIN.paper, vp.w - 2 * EDGE);
    return { source: { x: EDGE, y: top, w: sw, h }, paper: { x: vp.w - EDGE - pw, y: top, w: pw, h } };
  }
  const sw = Math.max(PAIR_MIN.source, Math.min(srcW, pairedSourceMax(a)));
  return { source: { x: a.left, y: top, w: sw, h }, paper: { x: a.left + sw + DOCK_GAP, y: top, w: W - sw - DOCK_GAP, h } };
}

/** Whether two windows overlap: they share more than an edge. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The room in area `a` beside a window the reader placed (`by`) for the other of the two, at least
 *  `least` wide: across the side of it with the more room (the right, where the two have as much),
 *  from DOCK_GAP beside it to the area's edge; null where neither side has `least`. */
export function roomBeside(by: Rect, least: number, a: Area): { left: number; right: number } | null {
  const right = { left: by.x + by.w + DOCK_GAP, right: a.right };
  const left = { left: a.left, right: by.x - DOCK_GAP };
  const side = right.right - right.left >= left.right - left.left ? right : left;
  return side.right - side.left >= least ? side : null;
}

/** Where the two paired windows stand in area `a` while the reader has placed one or both by hand
 *  (`source`, `paper`: where they put each; null where the page placed it). What the reader placed
 *  stays where they put it, and the other stands beside it, DOCK_GAP away on its side with the more
 *  room, as tall as the area: the reference across all of that side, the source as wide as its
 *  code wants (`srcW`) up to it, at least its least. Where neither side has the other's least, the
 *  reference stands at its least against the area's edge on the side with more room, and the source
 *  where the rule puts it: the reader's drag made them overlap, and the pairing lays them out afresh
 *  as it next shows them (`pairKeeps`). With neither placed, both are where the rule puts them
 *  (`pairRects`); with both, where the reader put them. */
export function pairPlaces(srcW: number, source: Rect | null, paper: Rect | null, a: Area, vp: Size): { source: Rect; paper: Rect } {
  if (source && paper) return { source, paper };
  const top = a.top;
  const h = Math.max(MIN.h, a.bottom - a.top);
  if (source) {
    const r = roomBeside(source, PAIR_MIN.paper, a);
    if (r) return { source, paper: { x: r.left, y: top, w: r.right - r.left, h } };
    const w = Math.min(PAIR_MIN.paper, a.right - a.left);
    const right = a.right - (source.x + source.w) >= source.x - a.left;
    return { source, paper: { x: right ? a.right - w : a.left, y: top, w, h } };
  }
  const rule = pairRects(srcW, a, vp);
  const r = paper && roomBeside(paper, PAIR_MIN.source, a);
  if (!paper || !r) return paper ? { source: rule.source, paper } : rule;
  const w = Math.max(PAIR_MIN.source, Math.min(srcW, r.right - r.left));
  return { source: { x: r.left > paper.x ? r.left : r.right - w, y: top, w, h }, paper };
}

/** Which of the places the reader gave the two paired windows by hand (`source`, `paper`; null where
 *  the page placed it) the pairing keeps as it opens or shows the reference window beside the source
 *  window, so that the two never overlap there (the owner's decision of 2026-10-11): both, where
 *  they do not overlap; else the source's, where it leaves the reference its least beside it; else
 *  the reference's, where it leaves the source its least. A place not kept is let go of, and that
 *  window stands beside the other (`pairPlaces`); with neither kept, the two are laid out afresh by
 *  the rule, which overlaps them only where the page is too narrow for both (`pairRects`). */
export function pairKeeps(source: Rect | null, paper: Rect | null, a: Area): { source: boolean; paper: boolean } {
  if (source && paper && !overlaps(source, paper)) return { source: true, paper: true };
  if (source && roomBeside(source, PAIR_MIN.paper, a)) return { source: true, paper: false };
  if (paper && roomBeside(paper, PAIR_MIN.source, a)) return { source: false, paper: true };
  return { source: false, paper: false };
}

/** Where the window opens when it is not paired: between the side panel and the declaration's
 *  panel, where the board is, so that neither panel is covered; over the screen's right side where
 *  that leaves too little room. */
export function betweenPanels(vp: Size): Rect {
  const top = (panelBox("#viewbar")?.bottom ?? 64) + 8;
  const h = Math.max(MIN.h, vp.h - top - EDGE);
  const left = (panelBox("#side")?.right ?? EDGE) + 8;
  const right = (panelBox("#panel.open")?.left ?? vp.w - EDGE) - 8;
  if (right - left >= 480) {
    const w = Math.min(LONE_MAX, right - left);
    return { x: right - w, y: top, w, h };
  }
  const w = Math.min(LONE_MAX, Math.max(MIN.w, vp.w * 0.45));
  return { x: vp.w - EDGE - w, y: top, w, h };
}
