// The Time Machine (HistorySpec decisions 15–19): the project's graph as it was at a past build, on
// the view on show. While it is open the tab row gives way to its bar — the view's name; a ruler
// with a tick per build, equally spaced, long where a new commit was first built (the owner's
// decision of 2026-10-10); what changed against now, whose counts open the lists; a small chart of
// the declarations over time; Keep this version in this view, and Save as new view — and the view
// cannot be switched until it is left (Esc or ✕). Where a reader is in it is their own, as their
// camera is: presence carries it, and someone
// following them opens the same build (web/src/pagefollow.ts).
//
// It is also where a view kept at a past build (`ViewData.version`) takes its graph from: the views
// ask it for the past graph of a view (`past`, `prepare`), which is the Time Machine's on the view it
// is open on, else the build the view is kept at, else none — the graph of now. Browsing is a
// preview (the owner's decision of 2026-10-10): at the view's own build the board is the view's,
// arranged as it is anywhere; at another, it is the view's scope and arrangement on that build's
// graph, which nobody arranges there (web/src/views.ts, `preview`), since the arrangement is the
// view's at its own build. Keep this version, or Save as new view, makes a build one to arrange.
//
// A step must stay quick though a snapshot's graph is large (on a large project, megabytes compressed,
// and long to lay out by namespace: Sphere-Packing-Lean's, 1.1 MB, in about 1.5 s): the snapshots read are
// kept here, each fetched in two parts
// the server keeps compressed (server/historyapi.ts), and laid out off the page's thread
// (web/src/layoutworker.ts, in turn: web/src/layoutqueue.ts), each layout kept; the builds beside the
// one aimed at are fetched, and the one beyond laid out, while the reader looks.
//
// A drag loads the builds it crosses (the owner's decision of 2026-10-09): the build under the pointer
// is aimed at as the pointer reaches its tick, and shown as soon as it is ready while the drag goes
// on; the board keeps the build it shows until then, and the bar marks the one loading. The latest
// aim wins (web/src/past.ts, `Seek`): a build left is never shown after a later one, its fetches are
// aborted and its layout dropped, or stopped, unless it is of use ahead.

import { boardSet, edgesOf, layoutKey, pastSetKey, wholeLayout } from "../../shared/board.ts";
import type { BoardMemory, BoardSet } from "../../shared/board.ts";
import { unpackEdges } from "../../shared/edgecodec.ts";
import type { ClusterMode, Layout, ViewMeta } from "../../shared/graph.ts";
import { memoryOf } from "../../shared/layout.ts";
import type { LayoutMemory } from "../../shared/layout.ts";
import { printQuery, readsReview } from "../../shared/query.ts";
import type { Author, ReviewData } from "../../shared/review.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { versionRefused } from "../../shared/views.ts";
import type { ViewData } from "../../shared/views.ts";
import { escapeHtml } from "./highlight.ts";
import { LayoutQueue } from "./layoutqueue.ts";
import type { LayoutWorker } from "./layoutqueue.ts";
import { keepInView, latestOf, maxScroll, nearestTick, onNewBuild, pastGraph, pastLayoutKey, renamedMemory, reviewThen, ruler, RULER, Seek, step, tickX, timeline, unreadWords } from "./past.ts";
import type { HistoryDiff, PastGraph, Ruler, Snapshot, SnapshotNodes, Timeline } from "./past.ts";
import type { Board, PastSource } from "./views.ts";

/** Where the Time Machine opens (the hook the build-status popover and the lost-and-found call):
 *  at a snapshot (the latest by default), on a declaration there. */
export interface TimeMachineAt {
  snapshot?: number;
  name?: string;
}

export interface TimeMachineHooks {
  /** the graph on show, the latest build's, with its layouts */
  present(): Graph;
  meta(): ViewMeta;
  review(): ReviewData;
  /** whose own review `mine(…)` reads (web/src/pagescheme.ts, mineAuthor) */
  me?(): Author | null;
  /** the board on show */
  board(): Board | null;
  /** what a view is called, and what the page says of it under the pointer: its scope in full */
  title(id: string): string;
  tip?(id: string): string;
  /** the board on show again: its graph changed (a step, the mode left) */
  redraw(): Promise<void>;
  /** the server's layout memory of a view's board, read and never handed over */
  memory(id: string, mode: ClusterMode): Promise<BoardMemory | null>;
  /** the browsed build, or the mode, changed: the others are told, the page follows */
  changed(): void;
  /** go to a declaration of the board on show by name; false where the board does not hold it */
  go(name: string): boolean;
  say(text: string): void;
  /** keep the view on show at a build (null: the latest), for everyone on it; save a copy of it kept
   *  at a build, and show it. Each resolves to why it was refused, or null. */
  keep(snapshot: number | null): Promise<string | null>;
  saveAs(snapshot: number): Promise<string | null>;
  /** why this page keeps no build and saves no view (a read-only page, CollabSpec decision 11): the
   *  bar's actions are then not offered; null where they are */
  frozen?(): string | null;
  /** whether the reader follows someone, whose build presence brings: a new build does not move them
   *  on by itself (HistorySpec decision 18) */
  following?(): boolean;
  /** the latest build is another: `from` the one before, `to` the new one (its renames are the
   *  selection's to follow, web/src/pageselection.ts) */
  newBuild?(from: number, to: number): void;
}

/** An answer that is not what was asked for (a server that cannot say it) is refused here, so that
 *  what reads it never reads half of one. */
const checked = <T>(what: string, ok: (x: T) => boolean) => (x: T): T | Promise<T> => (x && ok(x) ? x : Promise.reject(new Error(`${what}: not what was asked for`)));

/** The history's endpoints, as the page reads them (server/historyapi.ts). */
const api = {
  list: (): Promise<{ snapshots: Snapshot[]; current: number | null }> =>
    fetch("/api/history")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`history ${r.status}`))))
      .then(checked<{ snapshots: Snapshot[]; current: number | null }>("history", (x) => Array.isArray(x.snapshots))),
  nodes: (id: number, signal: AbortSignal): Promise<SnapshotNodes> =>
    fetch(`/api/history/graph?id=${id}&part=nodes`, { signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`snapshot ${id}: ${r.status}`))))
      .then(checked<SnapshotNodes>(`snapshot ${id}`, (x) => Array.isArray(x.nodes) && Array.isArray(x.modules))),
  edges: (id: number, signal: AbortSignal): Promise<Int32Array> =>
    fetch(`/api/history/graph?id=${id}&part=edges`, { signal })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`snapshot ${id}: ${r.status}`))))
      .then((b) => unpackEdges(new Uint8Array(b))),
  diff: (id: number, signal: AbortSignal): Promise<HistoryDiff> =>
    fetch(`/api/history/diff?from=${id}&most=20000`, { signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`diff ${id}: ${r.status}`))))
      .then(checked<HistoryDiff>(`diff ${id}`, (x) => !!x.counts && Array.isArray(x.added) && Array.isArray(x.renamed))),
};

/** A short print of a board's layout memory, by what it holds: two views whose memories are the same
 *  (a copy's, which the server clones) lay out a past board alike. */
function memoryPrint(m: BoardMemory | null): string {
  if (!m) return "";
  let h1 = 2166136261, h2 = 374761393;
  const add = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ c, 2246822519);
    }
  };
  for (const [k, v] of Object.entries(m.mem.nodes)) add(`${k}\u0000${v.join("\u0000")}\u0001`);
  for (const [k, v] of Object.entries(m.mem.clusters)) add(`${k}\u0000${v.join("\u0000")}\u0001`);
  return `${m.set}\u0000${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** A fetch aborted, or a layout skipped: nobody wants it any more, and nothing is said of it. */
const givenUp = (e: unknown): boolean => e instanceof Error && (e.name === "AbortError" || e.name === "Skipped");

/** how many snapshots' graphs, and how many layouts, the page keeps */
const KEEP_GRAPHS = 5;
const KEEP_LAYOUTS = 16;
/** how long a build loads before the bar marks it busy: a quick one never blinks the mark */
const BUSY_AFTER_MS = 150;
/** how long the pointer rests on a build, dragging, before a build ready at once is drawn */
const DWELL_MS = 90;
/** a drag held this close to the end of a ruler that scrolls (or past it) scrolls it on, a build per
 *  `EDGE_MS` */
const EDGE_PX = 12;
const EDGE_MS = 60;
/** the busy mark's turn, in phase with the clock: drawn again (the bar is, part by part), it goes on
 *  where it was rather than starting over */
const SPIN_MS = 900;
const spinPhase = () => `animation-delay:-${Math.round(performance.now() % SPIN_MS)}ms`;

/** A map that keeps its last `max` entries, the most recently used last. */
class Recent<K, V> {
  private m = new Map<K, V>();
  private max: number;
  constructor(max: number) {
    this.max = max;
  }
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): V {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
    return v;
  }
  delete(k: K): void {
    this.m.delete(k);
  }
  /** Forget `k` where it is still `v` (a failed promise, not one asked for again since). */
  drop(k: K, v: V): void {
    if (this.m.get(k) === v) this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const CLOCK = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/></svg>`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A build's time in a few words: "Oct 8, 14:15". */
export function buildWhen(at: string | number): string {
  const d = new Date(at);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The lists the diff's counts open. */
type ListKind = "added" | "removed" | "changed" | "renamed";
const LIST_WORDS: Record<ListKind, [string, string]> = {
  added: ["new", "added since: of the latest build, on no board of this one"],
  removed: ["gone", "there then, gone now"],
  changed: ["changed", "another version now"],
  renamed: ["renamed", "under another name now"],
};

export class TimeMachine {
  /** open: the bar shows, the view on show shows a build of the history */
  active = false;
  /** the view it is open on */
  view: string | null = null;
  /** every snapshot, oldest build first, and the timeline they make */
  snaps: Snapshot[] = [];
  private line: Timeline | null = null;
  private listed: Promise<void> | null = null;
  private hooks: TimeMachineHooks;
  private bar: HTMLElement;
  private list: HTMLElement;
  private kept: HTMLElement;
  /** a snapshot's graph in parts, and what changed from it to the latest */
  private parts = new Recent<number, Promise<{ nodes: SnapshotNodes; edges: Int32Array }>>(KEEP_GRAPHS);
  private diffs = new Map<number, Promise<HistoryDiff>>();
  /** what is being fetched for a build, to be aborted where nobody wants it any more */
  private fetching = new Map<number, AbortController>();
  /** the past graphs made against the graph on show (`against`), and the one the board shows, kept
   *  whatever else is read meanwhile */
  private pasts = new Recent<number, PastGraph>(KEEP_GRAPHS);
  private pinned: PastGraph | null = null;
  private making = new Map<number, Promise<PastGraph | null>>();
  /** why a build's graph could not be read */
  private why = new Map<number, string>();
  private against: Graph | null = null;
  private layouts = new Recent<string, Promise<Layout>>(KEEP_LAYOUTS);
  private queue: LayoutQueue | null = null;
  /** the server's layout memory of a view's board, read once while the Time Machine is open */
  private memories = new Map<string, Promise<BoardMemory | null>>();
  /** what the boards of now hold, by scope (whether a view's is the whole project), and the latest
   *  build's layout of the whole project as a memory, for the graph on show (`nowFor`): read at
   *  every build shown, made once */
  private nowBoards = new Map<string, BoardSet>();
  private nowMems = new Map<string, LayoutMemory>();
  private nowFor: Graph | null = null;
  /** the build aimed at and the build the board shows (latest wins) */
  private seek = new Seek();
  /** the build aimed at that could not be read: the bar says so */
  private failed: number | null = null;
  /** the board drawn again, one at a time: another asked for meanwhile follows it */
  private drawing: Promise<void> | null = null;
  private redo = false;
  /** a drag on the timeline is going on */
  private dragging = false;
  /** the ruler as last drawn; where its strip is scrolled to (from its left), and the build and the
   *  width the scroll was last brought round to: it follows the build aimed at, unless a drag moves
   *  it (only at the ruler's ends) or the reader scrolled it by hand */
  private ruler: Ruler | null = null;
  private scroll = 0;
  private scrolledFor: { id: number | null; width: number } | null = null;
  /** the bar's busy mark, shown once a build has been loading a moment (none for a quick one) */
  private busyTimer: ReturnType<typeof setTimeout> | null = null;
  private listOpen: ListKind | null = null;

  constructor(bar: HTMLElement, list: HTMLElement, kept: HTMLElement, hooks: TimeMachineHooks) {
    this.bar = bar;
    this.list = list;
    this.kept = kept;
    this.hooks = hooks;
    bar.addEventListener("click", (e) => void this.clicked(e));
    list.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>("[data-tm-go]");
      if (row && !this.hooks.go(row.dataset.tmGo!)) this.hooks.say(`${row.dataset.tmGo} is not on this view at that build.`);
      if (t.closest("[data-tm-close]")) this.closeList();
    });
    kept.addEventListener("click", (e) => {
      const rec = this.hooks.board()?.rec;
      if ((e.target as HTMLElement).closest("[data-tm-open]") && rec?.version !== undefined) void this.open({ snapshot: rec.version });
    });
    // a press elsewhere closes a list
    window.addEventListener("pointerdown", (e) => {
      if (this.listOpen && !list.contains(e.target as Node) && !(e.target as Element).closest?.("[data-tm-list]")) this.closeList();
    }, { capture: true });
    this.bindLine();
    window.addEventListener("resize", () => this.active && this.render());
  }

  /** The build the reader is at: the one aimed at — under the pointer, stepped to — which the bar
   *  shows and presence carries, though the board may still show the one before (`shown`). */
  get snapshot(): number | null {
    return this.active ? this.seek.target : null;
  }

  /** The build the board shows. */
  get shown(): number | null {
    return this.active ? this.seek.shown : null;
  }

  // ---------------------------------------------------------------- the snapshots

  /** The snapshots, read once and again when the server says a build was read (`refresh`). A reader
   *  at the latest build goes on to a new one (onNewBuild): the board stays the board of now, which
   *  the new graph replaces as it comes, and those following are told. */
  load(refresh = false): Promise<void> {
    if (!this.listed || refresh)
      this.listed = api.list().then(
        (r) => {
          const before = this.latest;
          this.snaps = [...r.snapshots].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
          this.line = timeline(this.snaps);
          this.seek.order = this.line.ticks.map((t) => t.id);
          const latest = this.latest;
          if (before !== null && latest !== null && latest !== before) this.hooks.newBuild?.(before, latest);
          if (!this.active) return;
          const to = onNewBuild(this.seek.target, before, latest, { kept: this.hooks.board()?.rec.version, following: !!this.hooks.following?.() });
          if (to === null) return;
          this.seek.reset(to, true);
          this.pinned = null;
          this.hooks.changed();
        },
        () => {
          this.listed = null;
        },
      );
    return this.listed ?? Promise.resolve();
  }

  /** The latest build's snapshot: the graph on show. */
  get latest(): number | null {
    return latestOf(this.snaps)?.id ?? null;
  }

  /** The server read a build (`history`, a snapshot written): the list is read again, and what was
   *  measured against the latest is measured again. */
  async historyChanged(): Promise<void> {
    this.forget();
    this.parts.clear();
    await this.load(true);
    if (this.active) {
      this.render();
      await this.redrawn();
      this.again();
    }
  }

  /** A new graph on show (a build, or the same one with its versions made again): what was added,
   *  gone and changed since a snapshot is measured against it again. */
  presentChanged(): void {
    this.forget();
    void this.load(true).then(() => {
      if (!this.active) return;
      this.render();
      this.again();
    });
  }

  /** The build aimed at, still loading when what it was being made from was forgotten: made again. */
  private again(): void {
    const id = this.seek.target;
    if (this.active && id !== null && this.seek.waiting) void this.show(id);
  }

  /** What was made against the graph on show and the latest build is forgotten; the layouts waiting
   *  for it are dropped (the fetches go on: a snapshot's parts are the same whatever is on show). */
  private forget(): void {
    this.against = null;
    this.nowFor = null;
    this.nowBoards.clear();
    this.nowMems.clear();
    this.pinned = null;
    this.pasts.clear();
    this.making.clear();
    this.diffs.clear();
    this.settled.clear();
    this.layouts.clear();
    this.memories.clear();
    this.queue?.clear();
  }

  // ---------------------------------------------------------------- the past graphs, for the views

  /** The snapshot view `rec` shows: the one the board shows, on the view the Time Machine is open
   *  on; else the build it is kept at; null for the graph of now (the latest build's). */
  snapshotFor(rec: ViewData): number | null {
    const at = this.active && rec.id === this.view ? this.seek.shown : rec.version ?? null;
    if (at === null || !this.snaps.length || at === this.latest) return null;
    return this.snaps.some((s) => s.id === at) ? at : null;
  }

  /** Whether a board of view `rec` of `past` (null: the graph on show) shows the view at another
   *  build than its own — the build it is kept at, else the latest — and so is a preview of it, which
   *  nothing arranges (the views' `preview`): the Time Machine browsing it, or its build while that
   *  cannot be read. */
  preview(rec: ViewData, past: PastGraph | null): boolean {
    const own = rec.version === undefined || rec.version === this.latest ? null : rec.version;
    return (past?.snapshot.id ?? null) !== own;
  }

  /** The past graph view `rec` shows, where it shows one and it is at hand (the views' `past`). */
  sourceFor(rec: ViewData): PastSource | null {
    const id = this.snapshotFor(rec);
    if (id === null) return null;
    const past = this.pastOf(id);
    if (!past) return null;
    return { past, layout: (b, mode, mem) => this.layoutOf(past, b, mode, mem) };
  }

  /** Have view `rec`'s past graph at hand (the views' `prepare`): the snapshots, then its graph. */
  async prepare(rec: ViewData): Promise<void> {
    if (rec.version === undefined && !(this.active && rec.id === this.view)) return;
    await this.load();
    // a build this page has not heard of (it was away when the server read it, and the history's
    // news did not reach it): the list is read again, rather than the view shown at the latest
    if (rec.version !== undefined && !this.snaps.some((s) => s.id === rec.version)) await this.load(true);
    const id = this.snapshotFor(rec);
    if (id !== null && !(await this.make(id))) this.sayWhy(id);
  }

  private pastOf(id: number): PastGraph | null {
    if (this.against !== this.hooks.present()) {
      this.pasts.clear();
      this.making.clear();
      this.layouts.clear();
      this.pinned = null;
      this.against = this.hooks.present();
    }
    return this.pasts.get(id) ?? (this.pinned?.snapshot.id === id ? this.pinned : null);
  }

  /** Snapshot `id`'s past graph, made against the graph on show; null where it cannot be read (why
   *  is kept, for `sayWhy`), or where nobody wants it any more. */
  private make(id: number): Promise<PastGraph | null> {
    const have = this.pastOf(id);
    if (have) return Promise.resolve(have);
    let p = this.making.get(id);
    if (!p) {
      const now = this.hooks.present();
      p = Promise.all([this.partsOf(id), this.diffOf(id)]).then(
        ([{ nodes, edges }, diff]) => {
          if (this.hooks.present() !== now) return null;
          const past = pastGraph(nodes, edges, now, diff);
          this.pasts.set(id, past);
          this.why.delete(id);
          return past;
        },
        (e: Error) => {
          if (!givenUp(e)) this.why.set(id, e.message);
          return null;
        },
      );
      const made = p;
      void p.finally(() => {
        if (this.making.get(id) === made) this.making.delete(id);
      });
      this.making.set(id, p);
    }
    return p;
  }

  /** Say why a build's graph could not be read, where it could not. */
  private sayWhy(id: number): void {
    const why = this.why.get(id);
    if (why) this.hooks.say(`That build's graph could not be read: ${why}`);
  }

  /** What a build's fetches are aborted by. */
  private signal(id: number): AbortSignal {
    let c = this.fetching.get(id);
    if (!c || c.signal.aborted) this.fetching.set(id, (c = new AbortController()));
    return c.signal;
  }

  private partsOf(id: number) {
    let p = this.parts.get(id);
    if (!p) {
      const signal = this.signal(id);
      const q: Promise<{ nodes: SnapshotNodes; edges: Int32Array }> = Promise.all([api.nodes(id, signal), api.edges(id, signal)]).then(([nodes, edges]) => ({ nodes, edges }));
      q.catch(() => this.parts.drop(id, q));
      this.parts.set(id, (p = q));
    }
    return p;
  }

  private diffOf(id: number): Promise<HistoryDiff> {
    let p = this.diffs.get(id);
    if (!p) {
      const q = api.diff(id, this.signal(id));
      q.then(
        (x) => {
          if (this.diffs.get(id) !== q || this.settled.has(id)) return;
          this.settled.set(id, x);
          if (this.active && this.seek.target === id) this.render();
        },
        () => {
          if (this.diffs.get(id) === q) this.diffs.delete(id);
        },
      );
      this.diffs.set(id, (p = q));
    }
    return p;
  }

  /** A board of a past graph that no memory recalls, laid out (the views' `past`): computeLayout,
   *  then stabilize from `mem` — the view's memory, of whatever build — or, where the view has none,
   *  from the latest build's layout, the server's for a view of the whole project and afresh for any
   *  other, so that what both builds hold stays in place. Off the page's thread, in turn with the
   *  others (the build aimed at first), and kept. */
  private layoutOf(past: PastGraph, b: Board, mode: ClusterMode, mem: BoardMemory | null): Promise<Layout> {
    const hidden = b.rec.hidden[mode];
    const whole = !mem && this.boardOfNow(b.rec).whole;
    // what it is laid out from says which board it keeps in place: two views whose memories are the
    // same (a copy of a view, Save as new view) lay a past board out alike
    const key = pastLayoutKey(past.snapshot.id, b.bs.key, mode, hidden, mem ? memoryPrint(mem) : whole ? "whole" : "");
    let L = this.layouts.get(key);
    if (!L) {
      const base = mem ? mem.mem : whole ? this.wholeNow(mode, hidden) : null;
      this.queue ??= new LayoutQueue(
        (id) => (this.active ? this.seek.layoutWant(id) : 1),
        () => (typeof Worker === "undefined" ? null : (new Worker("/layout.js", { type: "module" }) as unknown as LayoutWorker)),
        undefined,
        // the build aimed at and the next one beyond, side by side, where the machine has the cores
        typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 0) >= 4 ? 2 : 1,
      );
      const graph = b.graph;
      const asked: Promise<Layout> = this.queue.lay(past.snapshot.id, () => ({
        mode,
        nodes: graph.nodes.map((v) => ({ name: v.name, module: v.module, ...(v.ext ? { ext: true as const } : {}) })),
        edges: edgesOf(graph),
        hidden: [...hidden],
        // a declaration renamed since is remembered under its name then
        mem: base && renamedMemory(base, past.nowName),
      }));
      asked.catch(() => this.layouts.drop(key, asked));
      this.layouts.set(key, (L = asked));
    }
    return L;
  }

  /** The latest build's layout of the whole project by `mode`, with the levels `hidden` taken out, as
   *  a memory: made once per graph on show. */
  private wholeNow(mode: ClusterMode, hidden: readonly string[]): LayoutMemory {
    const now = this.hooks.present();
    this.sameNow(now);
    const k = `${mode}\u0000${[...hidden].sort().join("\u0001")}`;
    let m = this.nowMems.get(k);
    if (!m) this.nowMems.set(k, (m = memoryOf(wholeLayout(this.hooks.meta().layouts[mode], now.nodes, mode, hidden), now.nodes)));
    return m;
  }

  /** The server's memory of view `rec`'s board by `mode`, as the views read it: what a build laid out
   *  ahead is laid out from (once while the Time Machine is open). */
  private memoryOf(rec: ViewData, mode: ClusterMode): Promise<BoardMemory | null> {
    const k = `${rec.id}\u0000${mode}`;
    let m = this.active ? this.memories.get(k) : undefined;
    if (!m) {
      m = this.hooks.memory(rec.id, mode);
      if (this.active) this.memories.set(k, m);
    }
    return m;
  }

  /** What is kept of the boards of now is of graph `now`: else forgotten. */
  private sameNow(now: Graph): void {
    if (this.nowFor === now) return;
    this.nowBoards.clear();
    this.nowMems.clear();
    this.nowFor = now;
  }

  /** What view `rec`'s board of now holds: made once per graph on show and scope, unless the scope
   *  reads the review (which changes in place). */
  private boardOfNow(rec: ViewData): BoardSet {
    const now = this.hooks.present();
    if (readsReview(rec.scope)) return boardSet(now, this.hooks.review(), rec.scope, this.hooks.me?.() ?? null);
    this.sameNow(now);
    const k = printQuery(rec.scope);
    let bs = this.nowBoards.get(k);
    if (!bs) this.nowBoards.set(k, (bs = boardSet(now, this.hooks.review(), rec.scope, this.hooks.me?.() ?? null)));
    return bs;
  }

  /** A build's board laid out for the view on show, as the views will ask for it when it is shown:
   *  from the view's memory as the server keeps it. */
  private async layoutFor(past: PastGraph): Promise<Layout | null> {
    const b = this.hooks.board();
    if (!b) return null;
    const mode = b.rec.clustering;
    const bs = boardSet(past.graph, reviewThen(this.hooks.review(), past.nowName), b.rec.scope, this.hooks.me?.() ?? null);
    const graph = bs.sub ? bs.sub.graph : past.graph;
    const mem = await this.memoryOf(b.rec, mode);
    // the build the view is kept at: its memory recalls it, nothing is laid out
    if (mem?.set === pastSetKey(past.snapshot.id, layoutKey(bs.key, b.rec.hidden[mode]))) return null;
    return this.layoutOf(past, { ...b, bs, graph, full: past.graph } as Board, mode, mem);
  }

  // ---------------------------------------------------------------- the mode

  /** Open the Time Machine on the view on show (the hook web/src/pageviews.ts wires): at `snapshot`, the
   *  latest by default; on `name` there. */
  async open(at: TimeMachineAt = {}): Promise<boolean> {
    const b = this.hooks.board();
    if (!b) return false;
    await this.load();
    if (!this.snaps.length) {
      this.hooks.say("The history holds no build yet: the Time Machine opens once the server has read one.");
      return false;
    }
    const id = at.snapshot !== undefined && this.snaps.some((s) => s.id === at.snapshot) ? at.snapshot : this.latest!;
    if (at.snapshot !== undefined && id !== at.snapshot) this.hooks.say(`There is no snapshot ${at.snapshot}: the Time Machine opens at the latest build.`);
    const fresh = !this.active;
    if (fresh) {
      // it starts from the build the board shows: the one the view is kept at, else the latest
      const v = b.rec.version;
      this.seek.reset(v !== undefined && this.snaps.some((s) => s.id === v) ? v : this.latest, true);
      this.memories.clear();
      // the ruler opens on its newest builds, then brings the one aimed at into sight
      this.scroll = Infinity;
      this.scrolledFor = null;
    }
    this.active = true;
    this.view = b.id;
    document.body.classList.add("tm");
    this.bar.hidden = false;
    if (fresh) this.renderKept();
    const going = this.show(id);
    // the board on show, a preview now unless it shows the view's own build
    if (fresh) await this.redrawn();
    await going;
    if (at.name && !this.hooks.go(at.name)) this.hooks.say(`${at.name} is not on this view at that build.`);
    return true;
  }

  /** Leave it: the view shows the graph of now again (or the build it is kept at). What is in flight
   *  for the builds browsed is given up. `redraw` false: the board on show is another view's
   *  already (Save as new view, Zoom in: shown before the Time Machine is left), and stays. */
  async close(redraw = true): Promise<void> {
    if (!this.active) return;
    const v = this.hooks.board()?.rec.version;
    this.seek.reset(v ?? null, false);
    this.prune();
    this.active = false;
    this.view = null;
    this.failed = null;
    this.memories.clear();
    this.busy(false);
    this.closeList();
    document.body.classList.remove("tm");
    this.bar.hidden = true;
    this.hooks.changed();
    if (redraw) await this.redrawn();
    this.renderKept();
  }

  /** Leave for another view (Save as new view, a view made from the board here): it is shown first,
   *  while the Time Machine is still open, and the Time Machine is left once it is, the board of now
   *  never drawn between (the owner's decision of 2026-10-09). Where it could not be shown the Time
   *  Machine stays. Resolves to what `show` did. */
  async leaveFor<T>(show: () => Promise<T>): Promise<T> {
    const r = await show();
    if (this.active && r === true) await this.close(false);
    return r;
  }

  /** Go to a build — a step, the build under the pointer as it drags, where a followed reader is: the
   *  bar at once, the board as soon as the build's graph and layout are ready, unless the reader
   *  has gone on meanwhile (the latest wins). Resolves once it is shown, or given up. */
  async show(id: number): Promise<void> {
    if (!this.active) return;
    this.seek.aim(id);
    const aimed = performance.now();
    this.failed = null;
    this.prune();
    this.render();
    this.hooks.changed();
    const ok = await this.ready(id);
    if (!this.active) return;
    if (ok === "failed" && this.seek.target === id) {
      this.failed = id;
      this.sayWhy(id);
    }
    // while the pointer drags, a build ready at once is shown once the pointer has rested on it a
    // moment: drawing a board holds the page a few hundred milliseconds, which a fast drag across
    // builds read before would pay at every tick it crosses
    const rest = this.dragging && ok === true ? DWELL_MS - (performance.now() - aimed) : 0;
    if (rest > 0 && this.seek.target === id && this.seek.shown !== id) {
      await new Promise((r) => setTimeout(r, rest));
      if (!this.active) return;
    }
    if (ok === true && this.seek.ready(id)) {
      // the board shows it from now on, whatever else is read meanwhile
      this.pinned = id === this.latest ? null : this.pastOf(id);
      this.render();
      await this.redrawn();
    } else if (this.seek.target === id) this.render();
  }

  /** Have build `id` ready to show on the view on show: its graph, and its board laid out. "failed"
   *  where its graph cannot be read; false where nobody wants it any more. Once its graph is there,
   *  the builds beside it are fetched, and the two beyond it laid out (`ahead`). */
  private async ready(id: number): Promise<boolean | "failed"> {
    if (id === this.latest) {
      this.ahead();
      return true;
    }
    const past = await this.make(id);
    if (!this.active || this.seek.layoutWant(id) === 0) return false;
    if (!past) return this.why.has(id) ? "failed" : false;
    this.ahead();
    try {
      await this.layoutFor(past);
    } catch (e) {
      if (givenUp(e)) return false;
      // the layout failed: the views lay it out again when it is shown, and say so
    }
    return true;
  }

  /** What is wanted changed (the reader aimed elsewhere, or left): what is in flight for a build
   *  nobody wants is given up — its fetches aborted, its layout dropped or stopped. */
  private prune(): void {
    for (const [id, c] of this.fetching)
      if (this.seek.fetchWant(id) === 0) {
        c.abort();
        this.fetching.delete(id);
      }
    this.queue?.prune();
  }

  /** The board on show drawn again; one at a time, the last asked for last. */
  private redrawn(): Promise<void> {
    if (this.drawing) {
      this.redo = true;
      return this.drawing;
    }
    const run = async () => {
      try {
        do {
          this.redo = false;
          await this.hooks.redraw();
        } while (this.redo);
      } finally {
        this.drawing = null;
      }
    };
    return (this.drawing = run());
  }

  /** One build back (−1) or on (+1), from the one aimed at. */
  step(dir: -1 | 1): void {
    if (!this.active || !this.line || this.snapshot === null) return;
    const id = step(this.line, this.snapshot, dir);
    if (id !== null && id !== this.snapshot) void this.show(id);
  }

  /** The first or the last build. */
  end(last: boolean): void {
    const t = this.line?.ticks;
    if (this.active && t?.length) void this.show(t[last ? t.length - 1 : 0].id);
  }

  /** The builds beyond the one aimed at, in the way the reader goes, fetched and laid out while the
   *  reader looks or drags, the nearest first; the one behind it fetched. A build passed is given up
   *  (`prune`). */
  private ahead(): void {
    for (const next of this.seek.beyond) {
      if (next === this.latest) continue;
      void this.make(next).then((past) => {
        if (past && this.active && this.seek.layoutWant(next) > 0) void this.layoutFor(past)?.catch(() => {});
      });
    }
    const behind = this.seek.beside(-this.seek.dir as -1 | 1);
    if (behind !== null && behind !== this.latest) {
      // fetched only: its graph is made where the reader goes back there
      void this.partsOf(behind).catch(() => {});
      void this.diffOf(behind).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- the bar

  /** The bar's parts, made once: drawn again part by part, so that the timeline a drag holds stays
   *  the element it holds. */
  private skeleton(): void {
    if (this.bar.querySelector(".tm-line")) return;
    this.bar.innerHTML =
      `<span class="tm-icon" title="The Time Machine: this view as it was at a past build, a preview to arrange once kept">${CLOCK}</span><span class="tm-view"></span>` +
      `<div class="tm-line" role="slider" tabindex="0" aria-label="Build" title="A tick per build, oldest on the left: long where a new commit was first built, short where the same commit was built again; the line breaks between days. Drag, or ← →"></div>` +
      `<span class="tm-when"></span><span class="tm-sum"></span><span class="tm-growth" title="Declarations at each build"></span><span class="tm-acts"></span>` +
      `<button class="tm-x" data-tm-close title="Leave the Time Machine (Esc)" aria-label="Leave the Time Machine">✕</button>`;
  }

  /** The bar, as the build aimed at and its diff against now are, and the build the board shows. */
  render(): void {
    if (!this.active) return;
    this.skeleton();
    const b = this.hooks.board();
    const id = this.snapshot;
    const s = this.snaps.find((x) => x.id === id) ?? null;
    const loading = this.seek.waiting && this.failed !== id;
    const shownAt = this.snaps.find((x) => x.id === this.seek.shown);
    const latest = id === this.latest;
    const rec = b?.rec;
    const refused = rec ? versionRefused(rec) : null;
    const keptHere = rec?.version !== undefined && rec.version === this.snapshot;
    const commit = s?.commit ? `${s.commit.hash.slice(0, 7)}${s.commit.dirty ? "+" : ""}` : "";
    const when = s ? `${s.approx ? "about " : ""}${buildWhen(s.at)}` : "";
    const whenTip = s
      ? `Built ${new Date(s.at).toLocaleString()}${s.approx ? " (about: when it was read)" : ""}` +
        (s.commit ? ` · commit ${s.commit.hash.slice(0, 12)}${s.commit.branch ? ` on ${s.commit.branch}` : ""}${s.commit.dirty ? ", with .lean files changed since" : ""}${s.commit.guessed ? " (the last commit before it)" : ""}` : "") +
        ` · ${s.counts.nodes.toLocaleString()} declarations`
      : "";
    const part = (sel: string) => this.bar.querySelector<HTMLElement>(sel)!;
    const title = b ? this.hooks.title(b.id) : "";
    part(".tm-view").textContent = title;
    part(".tm-view").title = b ? this.hooks.tip?.(b.id) ?? title : "";
    const line = part(".tm-line");
    this.drawLine();
    line.setAttribute("aria-valuemax", String(this.snaps.length));
    line.setAttribute("aria-valuenow", String(this.snaps.findIndex((x) => x.id === id) + 1));
    line.setAttribute("aria-valuetext", when);
    line.setAttribute("aria-busy", String(loading));
    // the build aimed at; while it loads, a busy mark (shown after a moment: none for a quick one),
    // and the build the board shows meanwhile in the tooltip
    const meanwhile = shownAt ? `the board shows the build of ${buildWhen(shownAt.at)} until it is ready` : "the board shows the build before until it is ready";
    part(".tm-when").innerHTML =
      `${escapeHtml(when)}${commit ? ` <span class="mono">${escapeHtml(commit)}</span>` : ""}${latest ? ` <span class="tm-latest">latest</span>` : ""}` +
      (loading ? ` <span class="tm-wait" title="Loading this build: ${escapeHtml(meanwhile)}"><i class="tm-spin" style="${spinPhase()}"></i>loading</span>` : "") +
      (this.failed === id && this.seek.waiting ? ` <span class="tm-wait tm-failed" title="${escapeHtml(this.why.get(id!) ?? "")}">could not be read</span>` : "");
    part(".tm-when").title = loading ? `${whenTip} · loading: ${meanwhile}` : whenTip;
    this.busy(loading);
    part(".tm-sum").innerHTML = this.summaryHtml(id);
    part(".tm-growth").innerHTML = this.growthSvg(id);
    const frozen = this.hooks.frozen?.() ?? null;
    part(".tm-acts").innerHTML = frozen
      ? `<button class="tm-btn" disabled title="${escapeHtml(frozen)}">Keep this version</button><button class="tm-btn" disabled title="${escapeHtml(frozen)}">Save as new view</button>`
      : (keptHere
        ? `<button class="tm-btn" data-tm-latest title="This view shows this build for everyone on it: show the latest again, for everyone">Latest again</button>`
        : `<button class="tm-btn" data-tm-keep${refused ? ` disabled title="${escapeHtml(refused)}"` : ` title="Show this build on this view, for everyone on it, with a clock on its tab: arranged as any view, not reviewed"`}>Keep this version</button>`) +
      `<button class="tm-btn" data-tm-save title="A new view, kept at this build: this one's scope and arrangement, yours to arrange">Save as new view</button>`;
    if (this.listOpen) this.renderList();
  }

  /** The bar's busy mark, from a moment after a build starts loading until the board shows it: a quick
   *  one never blinks it. */
  private busy(on: boolean): void {
    if (!on) {
      if (this.busyTimer) clearTimeout(this.busyTimer);
      this.busyTimer = null;
      this.bar.classList.remove("busy");
      return;
    }
    if (this.busyTimer || this.bar.classList.contains("busy")) return;
    this.busyTimer = setTimeout(() => {
      this.busyTimer = null;
      if (this.active && this.seek.waiting && this.failed !== this.seek.target) this.bar.classList.add("busy");
    }, BUSY_AFTER_MS);
  }

  /** The ruler drawn again, as the build aimed at and the one the board shows are, its strip scrolled
   *  so that the build aimed at is in sight: brought round to it when the reader aims at another build
   *  (or the room changed), except while a drag goes on, which scrolls it only at the ruler's ends. */
  private drawLine(): void {
    const line = this.bar.querySelector<HTMLElement>(".tm-line");
    const t = this.line;
    if (!line) return;
    const id = this.snapshot;
    const r = ruler(t?.ticks.length ?? 0, this.lineWidth());
    this.ruler = r;
    const k = t ? t.ticks.findIndex((x) => x.id === id) : -1;
    const was = this.scrolledFor;
    if (!this.dragging && k >= 0 && (!was || was.id !== id || was.width !== r.width)) this.scroll = keepInView(r, this.scroll, k);
    this.scroll = Math.min(Math.max(0, this.scroll), maxScroll(r));
    this.scrolledFor = { id, width: r.width };
    // the ends fade where there are builds beyond them
    line.classList.toggle("more-l", this.scroll > 0.5);
    line.classList.toggle("more-r", this.scroll < maxScroll(r) - 0.5);
    line.innerHTML = this.lineSvg(r, id, this.seek.waiting && this.failed !== id);
  }

  /** The ruler: a tick per build, a step apart — long for the first build of a commit, short for a
   *  rebuild, an approximate one dashed with a hollow head — the one the board shows strong, the one
   *  aimed at under the handle, with a busy ring while it loads; the line under them breaks between
   *  days. Only what is in sight is drawn; each tick says its build under the pointer. */
  private lineSvg(r: Ruler, id: number | null, loading: boolean): string {
    const t = this.line;
    const W = r.width, H = 22;
    if (!t || !t.ticks.length) return `<svg width="${W}" height="${H}"></svg>`;
    const s = this.scroll;
    const X = (i: number) => tickX(r, i) - s;
    const f = (v: number) => v.toFixed(1);
    const seen = (x: number) => x > -r.step - 6 && x < W + r.step + 6;
    // the line, a piece per day, a gap between days
    const n = t.ticks.length;
    const gap = Math.min(6, r.step / 2);
    let axis = "";
    for (let a = 0; a < n; ) {
      let z = a;
      while (z + 1 < n && !t.ticks[z + 1].day) z++;
      const x1 = a === 0 ? (n === 1 ? 1 - s : X(0) - RULER.pad + 1) : (X(a - 1) + X(a) + gap) / 2;
      const x2 = z === n - 1 ? (n === 1 ? W - 1 - s : X(n - 1) + RULER.pad - 1) : (X(z) + X(z + 1) - gap) / 2;
      if (x2 > 0 && x1 < W) axis += `<line class="tm-axis" x1="${f(x1)}" x2="${f(x2)}" y1="10.5" y2="10.5"/>`;
      a = z + 1;
    }
    const shown = this.seek.shown;
    let ticks = "";
    let hits = "";
    t.ticks.forEach((k, i) => {
      const x = X(i);
      if (!seen(x)) return;
      // strong: the build the board shows; tall: the one aimed at, still loading
      const on = k.id === shown;
      const aim = loading && k.id === id;
      const [y1, y2] = on || aim ? [1.5, 19.5] : k.major ? [4, 17] : [7.5, 13.5];
      ticks += `<line class="tm-tick${k.major ? " major" : ""}${k.approx ? " approx" : ""}${on ? " on" : ""}${aim ? " aim" : ""}" x1="${f(x)}" x2="${f(x)}" y1="${y1}" y2="${y2}"/>` + (k.approx ? `<circle class="tm-tick-o" cx="${f(x)}" cy="10.5" r="2.4"/>` : "");
      // what the build is, under the pointer: the width of a step around its tick
      const w = n === 1 ? W : Math.max(r.step, 6);
      hits += `<rect class="tm-hit" x="${f(x - w / 2)}" y="0" width="${f(w)}" height="${H}"><title>${escapeHtml(this.tickWords(k.id, k.major))}</title></rect>`;
    });
    const i = t.ticks.findIndex((k) => k.id === id);
    const at = i >= 0 ? f(X(i)) : null;
    const mark = at !== null ? `<path class="tm-mark${loading ? " aim" : ""}" d="M${at} 19 l-4.5 -5 h9 z"/>` : "";
    const ring = at !== null && loading ? `<circle class="tm-busy" cx="${at}" cy="10.5" r="5" style="${spinPhase()}"/>` : "";
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${axis}${ticks}${ring}${mark}${hits}</svg>`;
  }

  /** A build in a few words, for its tick: when, its commit, and whether it was the first build of
   *  that commit. */
  private tickWords(id: number, major: boolean): string {
    const s = this.snaps.find((x) => x.id === id);
    if (!s) return "";
    const commit = s.commit ? ` · ${s.commit.hash.slice(0, 7)}${s.commit.dirty ? "+" : ""}` : "";
    const what = s.commit ? (major ? "a new commit" : "the same commit built again") : major ? "the first build of the day" : "";
    return `${s.approx ? "about " : ""}${buildWhen(s.at)}${commit}${what ? ` — ${what}` : ""}`;
  }

  /** How wide the timeline is drawn: what the bar leaves it. */
  private lineWidth(): number {
    const w = document.documentElement.clientWidth || innerWidth;
    return Math.round(Math.min(300, Math.max(150, w * 0.15)));
  }

  /** The declarations at each build, small, a build per step as on the ruler, the one browsed
   *  dotted. */
  private growthSvg(id: number | null): string {
    const t = this.line;
    const W = 54, H = 22;
    if (!t || !this.snaps.length) return "";
    const counts = this.snaps.map((s) => s.counts.nodes);
    const lo = Math.min(...counts), hi = Math.max(...counts);
    const y = (n: number) => (hi === lo ? H / 2 : H - 3 - ((n - lo) / (hi - lo)) * (H - 6)).toFixed(1);
    const n = t.ticks.length;
    const x = (i: number) => (n === 1 ? W / 2 : 2 + (i / (n - 1)) * (W - 4)).toFixed(1);
    const pts = t.ticks.map((k, i) => `${x(i)},${y(this.snaps.find((s) => s.id === k.id)!.counts.nodes)}`).join(" ");
    const i = t.ticks.findIndex((k) => k.id === id);
    const s = i >= 0 ? this.snaps.find((x) => x.id === t.ticks[i].id)! : null;
    return (
      `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><polyline class="tm-growth-l" points="${pts}"/>` +
      (s ? `<circle class="tm-growth-d" cx="${x(i)}" cy="${y(s.counts.nodes)}" r="2.6"><title>${s.counts.nodes.toLocaleString()} declarations</title></circle>` : "") +
      `<title>${lo.toLocaleString()} to ${hi.toLocaleString()} declarations</title></svg>`
    );
  }

  /** What changed from the build browsed to now, each count opening its list; the latest says so.
   *  Then, for a build that could not read some files (a failed one, what imports it), that it could
   *  not: what they held is on none of its boards and counts as no change (HistorySpec decision 6).
   *  Last, so that where the bar is short of room the counts keep theirs. */
  private summaryHtml(id: number | null): string {
    if (id === null) return "";
    const u = unreadWords(this.snaps.find((x) => x.id === id)?.missing ?? []);
    const unread = u ? `<span class="tm-unread" title="${escapeHtml(u.tip)}">${escapeHtml(u.label)}</span>` : "";
    return this.changesHtml(id) + unread;
  }

  /** What changed from the build browsed to now (summaryHtml). */
  private changesHtml(id: number): string {
    if (id === this.latest) return `<span class="muted">the graph on show</span>`;
    const known = this.settled.get(id);
    if (!known) {
      // drawn again when it comes (diffOf), unless the reader went on: then it is aborted
      void this.diffOf(id).catch(() => {});
      return `<span class="muted">…</span>`;
    }
    const c = known.counts;
    // what did not happen is left out: the bar has little room
    const n = (k: ListKind, v: number, sign: string) =>
      v ? `<button class="tm-n tm-${k}${this.listOpen === k ? " on" : ""}" data-tm-list="${k}" title="${v.toLocaleString()} ${LIST_WORDS[k][1]} — click for the list"><i></i>${sign}${v.toLocaleString()}<span class="tm-w${sign ? " signed" : ""}"> ${LIST_WORDS[k][0]}</span></button>` : "";
    const all = n("added", c.added, "+") + n("removed", c.removed, "−") + n("changed", c.changed, "") + n("renamed", c.renamed, "");
    return all || `<span class="muted" title="The same declarations, the same versions">no change since</span>`;
  }

  /** the diffs that came, by snapshot */
  private settled = new Map<number, HistoryDiff>();

  /** A list the summary's counts open: the names, each going to its declaration on the board. */
  private renderList(): void {
    const k = this.listOpen;
    const id = this.snapshot;
    const d = id !== null ? this.settled.get(id) : undefined;
    if (!k || !d) return this.closeList();
    const MAX = 400;
    const all = d[k] as string[] | [string, string][];
    const rows = all.slice(0, MAX).map((x) => {
      // a renamed one is gone to under its name then, the rest under the name they have on the board
      const [then, now] = Array.isArray(x) ? x : [d.renamed.find((p) => p[1] === x)?.[0] ?? x, x];
      const label = Array.isArray(x) ? `${escapeHtml(then)} <span class="muted">→</span> ${escapeHtml(now)}` : escapeHtml(now);
      // what was added since is not of this build: no board of it holds it (the owner's decision,
      // 2026-10-10), so its row only says its name
      if (k === "added") return `<span class="tm-row mono" title="Added since this build: it is on the latest build, not on this one">${label}</span>`;
      return `<button class="tm-row mono" data-tm-go="${escapeHtml(then)}" title="Go to it, on this view at that build">${label}</button>`;
    });
    const total = d.counts[k];
    this.list.innerHTML =
      `<div class="tm-list-h"><b>${total.toLocaleString()} ${LIST_WORDS[k][0]}</b> <span class="muted">${LIST_WORDS[k][1]}</span><button class="icon" data-tm-close title="Close" aria-label="Close">✕</button></div>` +
      `<div class="tm-rows">${rows.join("")}</div>` +
      (total > rows.length ? `<div class="muted tm-more">and ${(total - rows.length).toLocaleString()} more</div>` : "");
    this.list.hidden = false;
    const btn = this.bar.querySelector<HTMLElement>(`[data-tm-list="${k}"]`);
    const r = btn?.getBoundingClientRect();
    const w = Math.min(420, innerWidth - 24);
    this.list.style.width = `${w}px`;
    this.list.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, (r?.left ?? 0) - 20))}px`;
    this.list.style.top = `${(r?.bottom ?? 100) + 8}px`;
  }

  private closeList(): void {
    if (!this.listOpen && this.list.hidden) return;
    this.listOpen = null;
    this.list.hidden = true;
    if (this.active) this.bar.querySelectorAll(".tm-n.on").forEach((b) => b.classList.remove("on"));
  }

  /** Whether a list is open: Esc closes it first. */
  get listShown(): boolean {
    return !this.list.hidden;
  }

  closeListNow(): void {
    this.closeList();
  }

  /** The note on a view kept at a past build, while the Time Machine is not open on it. */
  renderKept(): void {
    const rec = this.hooks.board()?.rec;
    const v = rec?.version;
    if (v === undefined || this.active) {
      this.kept.hidden = true;
      return;
    }
    const s = this.snaps.find((x) => x.id === v);
    this.kept.innerHTML =
      `${CLOCK}<span>Kept at the build of <b>${s ? escapeHtml(buildWhen(s.at)) : `snapshot ${v}`}</b>${s?.commit ? ` <span class="mono">${escapeHtml(s.commit.hash.slice(0, 7))}</span>` : ""}, for everyone on this view — the review is the latest build's</span>` +
      `<button class="tm-btn" data-tm-open title="Browse the builds from here (t)">Time Machine</button>`;
    this.kept.hidden = false;
  }

  private async clicked(e: MouseEvent): Promise<void> {
    const t = e.target as HTMLElement;
    if (t.closest("[data-tm-close]")) return this.close();
    const list = t.closest<HTMLButtonElement>("[data-tm-list]");
    if (list && !list.disabled) {
      const k = list.dataset.tmList as ListKind;
      if (this.listOpen === k) return this.closeList();
      this.listOpen = k;
      this.render();
      return;
    }
    const id = this.snapshot;
    if (id === null) return;
    if (t.closest("[data-tm-keep]:not(:disabled)")) {
      const why = await this.hooks.keep(id);
      if (why) this.hooks.say(why);
      this.render();
      return;
    }
    if (t.closest("[data-tm-latest]")) {
      const why = await this.hooks.keep(null);
      if (why) this.hooks.say(why);
      this.render();
      return;
    }
    if (t.closest("[data-tm-save]")) {
      const why = await this.hooks.saveAs(id);
      if (why) this.hooks.say(why);
    }
  }

  /** Dragging the timeline (the owner's decision of 2026-10-09): as the pointer reaches another
   *  build's tick, that build is aimed at — the bar shows it at once, the board as soon as it is ready,
   *  while the drag goes on — and letting go leaves it there; a click goes to the nearest. Only a
   *  change of tick does anything: a move within one is a rectangle read and a nearest tick. A ruler
   *  whose builds do not all fit scrolls: a drag held at either end of it (or past it) scrolls on, a
   *  build at a time, aiming at the one under the pointer; the wheel scrolls it without aiming. */
  private bindLine(): void {
    let dragging: number | null = null;
    let lastX = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** where the pointer is on the ruler's window, in its pixels, and the window's width */
    const place = (clientX: number): { x: number; w: number } | null => {
      const svg = this.bar.querySelector<SVGElement>(".tm-line svg");
      if (!svg || !this.ruler) return null;
      const b = svg.getBoundingClientRect();
      return { x: ((clientX - b.left) / Math.max(1, b.width)) * this.ruler.width, w: this.ruler.width };
    };
    const at = (clientX: number): number | null => {
      const p = place(clientX);
      if (!p || !this.line || !this.ruler) return null;
      // a pointer at either end, or past it, is on the tick a pad inside it, out of the end's fade
      return nearestTick(this.line, this.ruler, this.scroll + Math.min(p.w - RULER.pad, Math.max(RULER.pad, p.x)));
    };
    const aim = (clientX: number) => {
      const id = at(clientX);
      if (id !== null && id !== this.snapshot) void this.show(id);
    };
    /** which way a drag at the pointer scrolls the strip: −1 to older builds, +1 to newer, 0 not */
    const edge = (): -1 | 0 | 1 => {
      const p = place(lastX);
      if (!p || dragging === null || !this.ruler) return 0;
      if (p.x < EDGE_PX && this.scroll > 0) return -1;
      if (p.x > p.w - EDGE_PX && this.scroll < maxScroll(this.ruler)) return 1;
      return 0;
    };
    const roll = () => {
      const d = edge();
      if (!d || !this.ruler) {
        timer = null;
        return;
      }
      this.scroll += d * this.ruler.step;
      this.drawLine();
      aim(lastX);
      timer = setTimeout(roll, EDGE_MS);
    };
    const rollIfAtEdge = () => {
      if (!timer && edge()) timer = setTimeout(roll, EDGE_MS);
    };
    this.bar.addEventListener("pointerdown", (e) => {
      const line = (e.target as Element).closest?.(".tm-line");
      if (!line || e.button !== 0 || !this.active) return;
      dragging = e.pointerId;
      this.dragging = true;
      lastX = e.clientX;
      (line as HTMLElement).setPointerCapture(e.pointerId);
      aim(e.clientX);
      rollIfAtEdge();
    });
    this.bar.addEventListener("pointermove", (e) => {
      if (dragging !== e.pointerId) return;
      lastX = e.clientX;
      aim(e.clientX);
      rollIfAtEdge();
    });
    const end = (e: PointerEvent) => {
      if (dragging !== e.pointerId) return;
      dragging = null;
      this.dragging = false;
      if (timer) clearTimeout(timer);
      timer = null;
      // let go: the build under the pointer, shown already or as soon as it is ready
      if (e.type === "pointerup") aim(e.clientX);
    };
    this.bar.addEventListener("pointerup", end);
    this.bar.addEventListener("pointercancel", end);
    // the wheel, or a trackpad's sideways swipe, scrolls a ruler that does not fit: the build aimed
    // at stays, out of sight maybe, until the reader aims again
    this.bar.addEventListener(
      "wheel",
      (e) => {
        if (!this.active || !this.ruler || !maxScroll(this.ruler) || !(e.target as Element).closest?.(".tm-line")) return;
        e.preventDefault();
        this.scroll += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        this.drawLine();
      },
      { passive: false },
    );
  }
}
