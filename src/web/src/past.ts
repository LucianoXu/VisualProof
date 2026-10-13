// The Time Machine's model (HistorySpec decisions 16–19), without the page: the ruler — a tick per
// build at equal intervals, which ticks are long, how wide it is drawn and where it scrolls — and
// which build a drag or a step lands on, which build the reader is going to and which the board shows
// meanwhile (`Seek`), and how a board of a past graph is laid out and marked. The past graph a
// snapshot makes — that build's declarations alone, each marked against the graph on show — is
// shared/pastgraph.ts's, which the server makes too to print a view of a past build. web/src/timemachine.ts draws it and fetches what it reads; the tests read it here.

import type { ClusterMode, Layout, ViewNode } from "../../shared/graph.ts";
import { memoryOf } from "../../shared/layout.ts";
import type { LayoutMemory } from "../../shared/layout.ts";
import { PAST_CHANGED, PAST_GHOST, PAST_RENAMED } from "../../shared/pastgraph.ts";
import type { PastGraph, Snapshot } from "../../shared/pastgraph.ts";

// the past graph and its marks are shared with the server, which prints a view of a past build from
// the same graph (shared/pastgraph.ts)
export { PAST_CHANGED, PAST_GHOST, PAST_RENAMED, pastGraph, reviewThen } from "../../shared/pastgraph.ts";
export type { HistoryDiff, PastGraph, Snapshot, SnapshotNodes } from "../../shared/pastgraph.ts";

// ------------------------------------------------------------------------------------- timeline

/** A build on the timeline. A *major* one is the first build of a commit: its commit is not the
 *  commit of the build before it (the first build of all is major); a build of the same commit again,
 *  with the sources edited or not, is minor. Where neither build knows its commit (a project that is
 *  no git repository), the first build of a day is major. */
export interface Tick {
  id: number;
  /** its build time (ms) */
  at: number;
  approx: boolean;
  major: boolean;
  /** the first build of its day, in the reader's time: the ruler's line breaks before it */
  day: boolean;
}

/** The timeline (the owner's decision of 2026-10-10, as the Mac's Time Machine has it): a tick per
 *  snapshot, oldest first, each one step from the next whatever time lies between them, so that
 *  builds minutes apart are as easy to reach as builds days apart. */
export interface Timeline {
  ticks: Tick[];
}

/** a day in the reader's time, to compare two builds' */
const dayOf = (t: number) => new Date(t).toDateString();

export function timeline(snaps: readonly Snapshot[]): Timeline {
  const sorted = [...snaps].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
  const ticks = sorted.map((s, k): Tick => {
    const at = Date.parse(s.at);
    const before = k > 0 ? sorted[k - 1] : null;
    const day = !before || dayOf(at) !== dayOf(Date.parse(before.at));
    const major = !before || (s.commit || before.commit ? s.commit?.hash !== before.commit?.hash : day);
    return { id: s.id, at, approx: !!s.approx, major, day };
  });
  return { ticks };
}

/** How the ruler is drawn: the ticks `step` pixels apart along a strip `strip` wide, inset `pad` at
 *  either end, seen through a window `width` wide — the whole strip where it fits, else the part of
 *  it the reader scrolled to (`scroll`, from the strip's left). */
export interface Ruler {
  n: number;
  step: number;
  width: number;
  strip: number;
}

/** The ruler's measures, in pixels: the inset at either end; the closest two ticks are drawn, which
 *  keeps every tick one a pointer can land on and its hollow head clear of the next; the farthest,
 *  so that a few builds do not stretch across the bar; the narrowest the ruler is, so that it stays
 *  something to grab. */
export const RULER = { pad: 7, minStep: 8, maxStep: 22, minWidth: 90 };

/** The ruler of `n` builds in `room` pixels. Few builds are drawn at most `maxStep` apart, the ruler
 *  only as wide as they need (and `minWidth` at least, the ticks spread across it); where `n` builds
 *  do not fit `minStep` apart, the ruler takes the whole room and its strip scrolls. */
export function ruler(n: number, room: number): Ruler {
  const { pad, minStep, maxStep, minWidth } = RULER;
  if (n <= 1) {
    const w = Math.min(room, minWidth);
    return { n, step: 0, width: w, strip: w };
  }
  let step = Math.max(minStep, Math.min(maxStep, (room - 2 * pad) / (n - 1)));
  let width = Math.min(room, (n - 1) * step + 2 * pad);
  if (width < minWidth && room > width) {
    width = Math.min(room, minWidth);
    step = (width - 2 * pad) / (n - 1);
  }
  return { n, step, width, strip: Math.max(width, (n - 1) * step + 2 * pad) };
}

/** Where the `i`th tick is on the strip; a lone one stands in the middle. */
export function tickX(r: Ruler, i: number): number {
  return r.n <= 1 ? r.width / 2 : RULER.pad + i * r.step;
}

/** How far the strip scrolls at most. */
export const maxScroll = (r: Ruler): number => Math.max(0, r.strip - r.width);

/** The scroll that shows the `i`th tick with a margin of two steps (a quarter of the window at most)
 *  on either side, moving as little as it can from `scroll`. */
export function keepInView(r: Ruler, scroll: number, i: number): number {
  const x = tickX(r, i);
  const margin = Math.min(2 * r.step, r.width / 4);
  let s = Math.min(Math.max(0, scroll), maxScroll(r));
  if (x - margin < s) s = x - margin;
  else if (x + margin > s + r.width) s = x + margin - r.width;
  return Math.min(Math.max(0, s), maxScroll(r));
}

/** The tick nearest to a place on the strip (pixels from its left): where a drag lands. */
export function nearestTick(t: Timeline, r: Ruler, x: number): number | null {
  const n = t.ticks.length;
  if (!n) return null;
  const i = n === 1 ? 0 : Math.round((x - RULER.pad) / r.step);
  return t.ticks[Math.min(n - 1, Math.max(0, i))].id;
}

/** The snapshot one step from `id` (← −1, → +1), in build order; null past either end. */
export function step(t: Timeline, id: number, dir: -1 | 1): number | null {
  const k = t.ticks.findIndex((x) => x.id === id);
  if (k < 0) return t.ticks.length ? t.ticks[dir < 0 ? 0 : t.ticks.length - 1].id : null;
  return t.ticks[k + dir]?.id ?? null;
}

// ------------------------------------------------------------------------------------- browsing

/** how many builds beyond the one aimed at, in the way the reader goes, are laid out ahead */
export const AHEAD = 2;

/** Where the reader is going on the timeline, and what the board shows meanwhile (the owner's
 *  decision of 2026-10-09: a drag loads the builds it crosses, not only the one it is let go on).
 *  The reader aims at a build — the one under the pointer as it drags, a step, the build a followed
 *  reader is at — and the board shows it once it is ready, keeping the build it shows until then.
 *  The latest aim wins: a build the reader has left is never shown, though its load finishes after a
 *  later one's, and what is in flight for it is stopped unless it is of use ahead — the builds
 *  beside the one aimed at are fetched, and the two beyond it in the way the reader goes laid out,
 *  so that a slow drag finds the next ones ready. */
export class Seek {
  /** the builds, oldest first (the timeline's ticks) */
  order: readonly number[] = [];
  /** the build aimed at: the bar shows it, presence carries it */
  target: number | null = null;
  /** the build the board shows */
  shown: number | null = null;
  /** which way the reader last went: −1 back, +1 on */
  dir: -1 | 1 = -1;
  /** whether the reader browses (the Time Machine is open): only then is anything wanted ahead */
  browsing = false;

  /** Start at the build the board shows (the Time Machine opened), or stop (left: null, or the build
   *  the view is kept at): nothing aimed at but it. */
  reset(at: number | null, browsing: boolean): void {
    this.target = this.shown = at;
    this.browsing = browsing;
  }

  /** Aim at a build. */
  aim(id: number): void {
    const a = this.target === null ? -1 : this.order.indexOf(this.target);
    const b = this.order.indexOf(id);
    if (a >= 0 && b >= 0 && a !== b) this.dir = b < a ? -1 : 1;
    this.target = id;
  }

  /** A build's graph and layout are ready: true where the board is to show it now — it is the build
   *  aimed at, and not on show (the board shows it from now on); false for one the reader has left,
   *  which is dropped, and for the one on show. */
  ready(id: number): boolean {
    if (id !== this.target || id === this.shown) return false;
    this.shown = id;
    return true;
  }

  /** The board does not show the build aimed at yet. */
  get waiting(): boolean {
    return this.target !== null && this.target !== this.shown;
  }

  /** The build beside the one aimed at, `dir` away; null past either end, or while not browsing. */
  beside(dir: -1 | 1): number | null {
    if (!this.browsing || this.target === null) return null;
    const k = this.order.indexOf(this.target);
    return k < 0 ? null : this.order[k + dir] ?? null;
  }

  /** The builds beyond the one aimed at, in the way the reader goes, nearest first: laid out ahead. */
  get beyond(): number[] {
    const out: number[] = [];
    if (!this.browsing || this.target === null) return out;
    const k = this.order.indexOf(this.target);
    for (let d = 1; k >= 0 && d <= AHEAD; d++) {
      const id = this.order[k + d * this.dir];
      if (id === undefined) break;
      out.push(id);
    }
    return out;
  }

  /** How much what is fetched for a build is wanted: 2 the build aimed at, or the one shown; 1 a
   *  build beside the one aimed at or beyond it, fetched ahead; 0 none — what is in flight for it is
   *  stopped. */
  fetchWant(id: number): 0 | 1 | 2 {
    if (id === this.target || id === this.shown) return 2;
    return id === this.beside(-1) || id === this.beside(1) || this.beyond.includes(id) ? 1 : 0;
  }

  /** How much a build's layout is wanted, the more the sooner: 3 the build aimed at, or the one
   *  shown; then the builds beyond it, the nearest first; 0 none — dropped before it starts, stopped
   *  where it runs. */
  layoutWant(id: number): number {
    if (id === this.target || id === this.shown) return AHEAD + 1;
    const k = this.beyond.indexOf(id);
    return k < 0 ? 0 : AHEAD - k;
  }
}

/** The latest build's snapshot: the graph on show. */
export function latestOf(snaps: readonly Snapshot[]): Snapshot | null {
  let best: Snapshot | null = null;
  for (const s of snaps) if (!best || s.at > best.at || (s.at === best.at && s.id > best.id)) best = s;
  return best;
}

// ------------------------------------------------------------------------------------ the graph

/** The memory a past board is laid out from where it has none of its own (shared/layout.ts,
 *  stabilize): the layout of the board of now, so that what both have stays where it is; a
 *  declaration renamed since is remembered under its name then. */
export function pastMemory(layout: Layout, nodes: ViewNode[], nowName: ReadonlyMap<string, string>): LayoutMemory {
  return renamedMemory(memoryOf(layout, nodes), nowName);
}

/** A memory of the board of now read for a past build: a declaration renamed since remembered under
 *  its name then too. `mem` is left as it is (the page keeps it for every build): a copy where a
 *  rename adds a name, else `mem` itself. */
export function renamedMemory(mem: LayoutMemory, nowName: ReadonlyMap<string, string>): LayoutMemory {
  let out: LayoutMemory | null = null;
  for (const [then, now] of nowName) {
    if (!mem.nodes[now] || mem.nodes[then]) continue;
    out ??= { nodes: { ...mem.nodes }, clusters: mem.clusters };
    out.nodes[then] = mem.nodes[now];
  }
  return out ?? mem;
}

/** The key of a past board's layout as the Time Machine keeps it: the snapshot, what the board holds,
 *  the clustering, the levels it hides and the memory it is laid out from. */
export function pastLayoutKey(snapshot: number, set: string, mode: ClusterMode, hidden: readonly string[], memory: string): string {
  return [snapshot, set, mode, [...hidden].sort().join("\u0001"), memory].join("\u0000");
}

/** A declaration's marks in words, for its card, the tooltip and the panel. */
export function markWords(marks: number, now?: string): string[] {
  const out: string[] = [];
  if (marks & PAST_GHOST) out.push("gone now");
  if (marks & PAST_RENAMED) out.push(now ? `now ${now}` : "renamed since");
  if (marks & PAST_CHANGED) out.push("changed since");
  return out;
}

/** The marks of the declarations of a board (`toFull`: board → past graph), in the board's
 *  numbering, and the names now of those renamed. */
export function boardMarks(p: PastGraph, n: number, toFull: (j: number) => number): { marks: Uint8Array; now: Map<number, string> } {
  const marks = new Uint8Array(n);
  const now = new Map<number, string>();
  for (let j = 0; j < n; j++) {
    const i = toFull(j);
    marks[j] = p.marks[i];
    if (p.marks[i] & PAST_RENAMED) now.set(j, p.nowName.get(p.graph.nodes[i].name)!);
  }
  return { marks, now };
}
