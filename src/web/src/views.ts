// The views as this page holds them (ViewSpec.md): the list every page shares, the records of the
// views the reader has open (scope, clustering, pins and folds — the board, shared), and each one's
// board: what its scope holds in the graph on show and how that is laid out (shared/board.ts).
// One graph is loaded; a board is computed from it here, on the page, and kept while its set
// stays, so that going back to a tab is instant.
//
// A board laid out on its own (not the whole project) is laid out from its layout's memory, which
// the server keeps for everyone: the memory made for the set on show is recalled exactly, so every
// page shows the same picture; a page whose set is new lays it out from the memory before and hands
// the new one over. When another page handed one over first, its picture is taken instead. The
// levels a board hides are part of what its memory is made for (shared/board.ts, layoutKey); a
// whole-project board that hides some is the server's layout with their circles taken out, and
// keeps no memory.
//
// A board may be of a past graph (HistorySpec decisions 17 and 19): a view kept at a past build, or
// one the Time Machine shows at another. It is a board like any other (the owner's decision of
// 2026-10-10): its scope evaluated on that graph, laid out from its memory — kept for everyone under
// the snapshot's id (shared/board.ts, pastSetKey), so that it is never taken for a board of the
// latest build's — and arranged by the same operations. Where it must be laid out, it is laid out by
// web/src/timemachine.ts (`past`), off the page's thread, from the view's memory or the latest
// build's layout, so that what both builds hold stays in place.
//
// A board that shows a view at another build than its own — the Time Machine browsing it, or its
// build when that could not be read — is a preview (`preview`): the view's scope and arrangement on
// that build's graph. Nothing is arranged on it and no memory is handed over from it, since the
// view's own board is another.

import { boardLayout, boardSet, layoutKey, pastSetKey, recalled, wholeLayout } from "../../shared/board.ts";
import type { BoardMemory, BoardSet } from "../../shared/board.ts";
import type { ClusterMode, Layout, ViewMeta } from "../../shared/graph.ts";
import type { PresenceView } from "../../shared/collab.ts";
import { memoryOf } from "../../shared/layout.ts";
import { parseQuery, printQuery, readsReview } from "../../shared/query.ts";
import type { ReviewData } from "../../shared/review.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { namesOf } from "../../shared/titles.ts";
import { applyItemOp } from "../../shared/items.ts";
import type { ItemOp } from "../../shared/items.ts";
import { applyViewOps, PROJECT, titleOfScope, viewDescription, viewTitle } from "../../shared/views.ts";
import type { Change, TitleContext, ViewData, ViewOp, ViewSummary } from "../../shared/views.ts";
import type { ViewAnswer, ViewsApi } from "./data.ts";
import { reviewThen } from "./past.ts";
import type { PastGraph } from "./past.ts";

/** Where a board of a past graph comes from (web/src/timemachine.ts): the graph, and the layout of a
 *  board of it that no memory recalls, made from `mem` (the view's memory, of whatever build) or,
 *  where there is none, from the latest build's layout. */
export interface PastSource {
  past: PastGraph;
  layout(b: Board, mode: ClusterMode, mem: BoardMemory | null): Promise<Layout>;
}

/** A view's board: its record, what its scope holds now, and its layouts. */
export interface Board {
  id: string;
  /** the view's record, shared: changed in place as operations come */
  rec: ViewData;
  /** the scope's text the board was computed for */
  scope: string;
  bs: BoardSet;
  /** the whole graph the board was taken from: what is lit is computed on it (shared/board.ts,
   *  lightUp) */
  full: Graph;
  /** the graph the canvas shows */
  graph: Graph;
  /** whole-graph node → board node (-1 when it is not on the board), and back */
  toView(i: number): number;
  toFull(j: number): number;
  layouts: Partial<Record<ClusterMode, Layout>>;
  /** per clustering, what its layout was made for: the set and the levels hidden (layoutKey) */
  keys: Partial<Record<ClusterMode, string>>;
  /** per clustering, the set of the memory the layout was made from (null: none), and the memory it
   *  made when that was not its set */
  from: Partial<Record<ClusterMode, string | null>>;
  made: Partial<Record<ClusterMode, BoardMemory>>;
  /** a board of a past graph: where it comes from */
  past?: PastSource;
  /** the view at another build than its own (see the head of this file): nothing arranges it */
  preview: boolean;
}

export interface ViewsHooks {
  /** the graph on show: the latest build's */
  graph(): Graph;
  /** whether the server takes a layout's memory from this page now: it is handed over under a name
   *  (or by a private reader), as arranging is (server/views.ts); a page without one keeps its
   *  layout to itself rather than be refused */
  handsOver?(): boolean;
  meta(): ViewMeta;
  review(): ReviewData;
  /** the past graph a view shows instead, where it shows one and it is at hand (web/src/timemachine.ts) */
  past?(rec: ViewData): PastSource | null;
  /** have that past graph at hand: a board waits for it */
  prepare?(rec: ViewData): Promise<void>;
  /** a build of the history in a few words ("Oct 9 22:27"), for the title of a view kept at it; null
   *  where it is not known */
  build?(snapshot: number): string | null;
  /** whether a board of view `rec` of `past` (null: the latest build's graph) shows the view at
   *  another build than its own */
  preview?(rec: ViewData, past: PastGraph | null): boolean;
}

/** A board laid out on its own, from a memory kept for everyone: every board but a whole one of the
 *  latest build, which is the server's layout. */
const ownLayout = (b: Board): boolean => !b.bs.whole || !!b.past;

export class Views {
  /** every view on the server, as the list tells them */
  summaries: ViewSummary[] = [];
  private api: ViewsApi;
  private hooks: ViewsHooks;
  private recs = new Map<string, ViewData>();
  private boards = new Map<string, Board>();
  /** the memories this page holds, and which set the server's is for, per view and clustering */
  private mems = new Map<string, Partial<Record<ClusterMode, BoardMemory>>>();
  private serverMem = new Map<string, Partial<Record<ClusterMode, string | null>>>();
  private pending = new Map<string, Promise<Layout>>();

  constructor(api: ViewsApi, hooks: ViewsHooks) {
    this.api = api;
    this.hooks = hooks;
  }

  async load(): Promise<void> {
    this.summaries = await this.api.list();
  }

  summary(id: string): ViewSummary | undefined {
    return this.summaries.find((v) => v.id === id);
  }

  /** The view target `target` is linked to (ViewSpec decision 29), by its id; undefined where the
   *  list holds none: it has no view, or it was marked a moment ago. */
  linkedTo(target: string): string | undefined {
    return this.summaries.find((v) => v.targets?.includes(target))?.id;
  }

  /** What a title is told with (shared/views.ts, viewTitle): the names of the graph on show, which
   *  tell a namespace, a file or a declaration apart from the others, and the builds. */
  titles(): TitleContext {
    return { names: namesOf(this.hooks.graph()), build: (id) => this.hooks.build?.(id) ?? null };
  }

  /** What a view is called, from its record or the list. */
  title(id: string): string {
    const r = this.recs.get(id);
    if (r) return viewTitle(r, this.titles());
    const s = this.summary(id);
    if (!s) return id === PROJECT ? "Project" : "A view";
    try {
      return viewTitle({ ...s, scope: parseQuery(s.scope) }, this.titles());
    } catch {
      return s.name ?? s.scope;
    }
  }

  /** What the page says under the pointer where it shows a view's title: its name where people gave
   *  one, what its scope holds in full, and the query (the owner's decision of 2026-10-10: the title
   *  is short, the description whole). `q`: the query of a view the list does not hold (a tab). */
  tip(id: string, q?: string): string {
    const r = this.recs.get(id);
    const s = this.summary(id);
    const name = r?.name ?? s?.name ?? null;
    const text = r ? printQuery(r.scope) : s?.scope ?? q ?? null;
    if (!text) return this.title(id);
    let description: string;
    try {
      description = viewDescription({ scope: r?.scope ?? parseQuery(text) });
    } catch {
      description = "";
    }
    return [name, description, text].filter((x) => x).join("\n");
  }

  /** The view a reader is on, as an id or a query. */
  whereIs(v: PresenceView): { id: string | null; scope: string | null } {
    return v.view ? { id: v.view, scope: v.scope } : { id: PROJECT, scope: null };
  }

  /** What a reader is on, in words: a view by its title, from its id or its query. */
  nameOf(v: PresenceView): string | null {
    const { id, scope } = this.whereIs(v);
    if (id && this.summary(id)) return this.title(id);
    return scope ? titleOfScope(scope, this.titles()) : null;
  }

  rec(id: string): ViewData | undefined {
    return this.recs.get(id);
  }

  /** A view's record, read from the server when this page does not hold it (or `fresh`: again,
   *  after the page was away); null when it is gone. */
  async record(id: string, fresh = false): Promise<ViewData | null> {
    const have = this.recs.get(id);
    if (have && !fresh) return have;
    const r = await this.api.get(id);
    if (!r) {
      this.recs.delete(id);
      this.boards.delete(id);
      return null;
    }
    // a board keeps the same record, brought up to date (its scope is looked at when it is asked for)
    if (have) {
      Object.assign(have, r.view);
      // a record without notes has none: those this page held went while it was away
      if (!r.view.notes) delete have.notes;
    }
    else this.recs.set(id, r.view);
    const sm = this.serverMem.get(id) ?? {};
    for (const m of ["namespace", "module"] as ClusterMode[]) sm[m] = r.memory[m] ?? null;
    this.serverMem.set(id, sm);
    const b = this.boards.get(id);
    // the server's memory is not what a layout here was made from: it is laid out again
    if (b && ownLayout(b)) for (const m of ["namespace", "module"] as ClusterMode[]) if (b.layouts[m] && (b.made[m]?.set ?? b.from[m] ?? null) !== (sm[m] ?? null)) delete b.layouts[m];
    return this.recs.get(id)!;
  }

  /** The view on a query: an open one with the same scope and build, or a new one nobody keeps —
   *  at `at.version` (a past build: what is made from a board of a past build keeps it), clustered
   *  as `at.clustering` and focused on `at.focus` (ViewSpec decision 28) where it is new. */
  async open(scope: string, at: { version?: number | null; clustering?: ClusterMode; focus?: string } = {}): Promise<ViewData | string> {
    const r = await this.api.post("open", { scope, ...(at.version !== undefined && at.version !== null ? { version: at.version } : {}), ...(at.clustering ? { clustering: at.clustering } : {}), ...(at.focus ? { focus: at.focus } : {}) });
    if (!r.view) return r.error ?? "The view could not be opened.";
    this.recs.set(r.view.id, r.view);
    return r.view;
  }

  /** The view a click on target `target` opens (ViewSpec decision 29): the one it is linked to, else
   *  a view nobody keeps of its TCB, linked to it while it lasts (the owner's decision of 2026-10-11;
   *  shared/views.ts, `openTarget`). */
  async openTarget(target: string): Promise<ViewData | string> {
    const r = await this.api.post("target", { target });
    if (!r.view) return r.error ?? "Its view could not be opened.";
    this.recs.set(r.view.id, r.view);
    return r.view;
  }

  /** Forget a view's record and board: read again when it is next shown (the page was away). */
  drop(id: string): void {
    this.recs.delete(id);
    this.boards.delete(id);
  }

  post(action: string, body: Record<string, unknown>): Promise<ViewAnswer> {
    return this.api.post(action, body);
  }

  // ---------------------------------------------------------------- boards

  /** Have what view `id`'s board is made of: a past graph it shows, fetched (web/src/timemachine.ts). */
  async prepare(id: string): Promise<void> {
    const rec = this.recs.get(id);
    if (rec && this.hooks.prepare) await this.hooks.prepare(rec);
  }

  /** The board of a view this page holds the record of; computed once per graph, review and scope:
   *  of the graph on show, or of the past graph it shows — its scope evaluated on that graph, as on
   *  any. */
  board(id: string): Board | null {
    const rec = this.recs.get(id);
    if (!rec) return null;
    const scope = printQuery(rec.scope);
    const past = this.hooks.past?.(rec) ?? null;
    const full = past ? past.past.graph : this.hooks.graph();
    const preview = this.hooks.preview?.(rec, past?.past ?? null) ?? false;
    const have = this.boards.get(id);
    if (have && have.scope === scope && have.full === full && have.preview === preview) return have;
    return this.make(id, rec, scope, boardSet(full, this.reviewOf(past), rec.scope), past, preview);
  }

  /** The review as a board of `past` (null: the graph on show) reads it: by its names then too. */
  private reviewOf(past: PastSource | null): ReviewData {
    const d = this.hooks.review();
    return past ? reviewThen(d, past.past.nowName) : d;
  }

  private make(id: string, rec: ViewData, scope: string, bs: BoardSet, past: PastSource | null, preview: boolean): Board {
    const g = past ? past.past.graph : this.hooks.graph();
    const sub = bs.sub;
    const b: Board = {
      id,
      rec,
      scope,
      bs,
      full: g,
      graph: sub ? sub.graph : g,
      // the whole project's layout holds every declaration: one the scope leaves out (the outside
      // world, hidden) keeps its number there, though it is never lit (lightUp cuts what is lit to
      // the board)
      toView: sub ? (i) => (i >= 0 && i < sub.toSub.length ? sub.toSub[i] : -1) : (i) => i,
      toFull: sub ? (j) => sub.toFull[j] : (j) => j,
      layouts: {},
      keys: {},
      from: {},
      made: {},
      ...(past ? { past } : {}),
      preview,
    };
    this.boards.set(id, b);
    return b;
  }

  /** What a board's layout by `mode` is made for now: its set and the levels it hides, under the
   *  snapshot's id for a board of a past build. */
  key(b: Board, mode: ClusterMode): string {
    const k = layoutKey(b.bs.key, b.rec.hidden[mode]);
    return b.past ? pastSetKey(b.past.past.snapshot.id, k) : k;
  }

  /** A board's layout by `mode`: the server's for the whole project of the latest build (its hidden
   *  levels taken out), else laid out here from the board's memory (see the head of this file). */
  layout(b: Board, mode: ClusterMode): Promise<Layout> {
    const now = this.key(b, mode);
    const have = b.layouts[mode];
    if (have && b.keys[mode] === now) return Promise.resolve(have);
    if (!ownLayout(b)) {
      const L = wholeLayout(this.hooks.meta().layouts[mode], b.graph.nodes, mode, b.rec.hidden[mode]);
      b.layouts[mode] = L;
      b.keys[mode] = now;
      return Promise.resolve(L);
    }
    const key = `${b.id}\u0000${mode}\u0000${now}`;
    let p = this.pending.get(key);
    if (!p) {
      p = this.lay(b, mode).finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }

  private async lay(b: Board, mode: ClusterMode): Promise<Layout> {
    const mine = this.mems.get(b.id) ?? {};
    this.mems.set(b.id, mine);
    let mem = mine[mode] ?? null;
    const hidden = [...b.rec.hidden[mode]];
    const key = this.key(b, mode);
    const made = (L: Layout) => {
      b.layouts[mode] = L;
      b.keys[mode] = key;
      return L;
    };
    for (let tries = 0; ; tries++) {
      const server = this.serverMem.get(b.id)?.[mode] ?? null;
      if ((mem?.set ?? null) !== server) {
        mem = server ? await this.api.memory(b.id, mode) : null;
        if (mem) mine[mode] = mem;
        else delete mine[mode];
      }
      const { layout, next } = await this.layOutFrom(b, mode, key, mem, hidden);
      b.from[mode] = mem?.set ?? null;
      // a preview hands nothing over: the memory is the view's own board's
      if (next && !b.preview) b.made[mode] = next;
      else delete b.made[mode];
      if (!next || tries >= 2 || b.preview || this.hooks.handsOver?.() === false) return made(layout);
      const r = await this.api.post("memory", { id: b.id, mode, base: mem?.set ?? null, memory: next });
      if (r.accepted || r.error) {
        // taken (or the view is gone, and the picture is this page's alone)
        if (r.accepted) {
          mine[mode] = next;
          this.setServerMem(b.id, mode, next.set);
        }
        return made(layout);
      }
      // another page handed one over first: its picture, from its memory
      const cur = r.current && "mem" in r.current ? r.current : null;
      this.setServerMem(b.id, mode, cur?.set ?? null);
      mem = cur;
      if (cur) mine[mode] = cur;
    }
  }

  /** A board's layout for layout key `key` from memory `mem`: recalled or regrouped from it where it
   *  can be (shared/board.ts), else laid out keeping in place what it holds — here, or for a board of
   *  a past graph off the page's thread by web/src/timemachine.ts. `next` is the memory to hand
   *  over, null where `mem` fits already. */
  private async layOutFrom(b: Board, mode: ClusterMode, key: string, mem: BoardMemory | null, hidden: string[]): Promise<{ layout: Layout; next: BoardMemory | null }> {
    const quick = recalled(b.graph, mode, key, mem, hidden);
    if (quick) return quick;
    if (!b.past) return boardLayout(b.graph, mode, b.bs.key, mem, hidden);
    const layout = await b.past.layout(b, mode, mem);
    return { layout, next: { set: key, mem: memoryOf(layout, b.graph.nodes) } };
  }

  /** The board's layout by `mode` were it to hide the levels `hidden`, as it will be laid out once
   *  they are (what moving its pins into their new parents needs, shared/board.ts reframePins): from
   *  what this page holds, at once, nothing handed over. A board laid out on its own is regrouped
   *  from its layout as it is, which hiding or showing a level never moves. */
  layoutWith(b: Board, mode: ClusterMode, hidden: string[]): Layout {
    if (!ownLayout(b)) return wholeLayout(this.hooks.meta().layouts[mode], b.graph.nodes, mode, hidden);
    const L = b.layouts[mode];
    const mem = L && b.keys[mode] ? { set: b.keys[mode]!, mem: memoryOf(L, b.graph.nodes) } : this.mems.get(b.id)?.[mode] ?? null;
    const key = b.past ? pastSetKey(b.past.past.snapshot.id, layoutKey(b.bs.key, hidden)) : layoutKey(b.bs.key, hidden);
    return recalled(b.graph, mode, key, mem, hidden)?.layout ?? boardLayout(b.graph, mode, b.bs.key, mem, hidden).layout;
  }

  private setServerMem(id: string, mode: ClusterMode, set: string | null): void {
    const sm = this.serverMem.get(id) ?? {};
    sm[mode] = set;
    this.serverMem.set(id, sm);
  }

  /** A new graph: every board is computed again (by name: the numbering is new). */
  graphChanged(): void {
    this.boards.clear();
  }

  /** The review changed: boards whose scope reads it are computed again; the ids of those whose
   *  set changed. A board whose set stays is the same board, layouts and all, so that one drawn
   *  or being laid out is not replaced by an equal one (a redraw waiting for it would be lost). */
  reviewChanged(): string[] {
    const out: string[] = [];
    for (const [id, b] of [...this.boards]) {
      if (!readsReview(b.rec.scope)) continue;
      const bs = boardSet(b.full, this.reviewOf(b.past ?? null), b.rec.scope);
      if (bs.key === b.bs.key) continue;
      this.make(id, b.rec, printQuery(b.rec.scope), bs, b.past ?? null, b.preview);
      out.push(id);
    }
    return out;
  }

  // ---------------------------------------------------------------- what the server says

  /** The list, as the server sends it; the records this page holds take the changes. Returns the
   *  ids whose board must be shown again (scope or clustering changed), and those gone. */
  listed(views: ViewSummary[], changes: Change[]): { redo: Set<string>; gone: Set<string> } {
    this.summaries = views;
    const redo = new Set<string>(), gone = new Set<string>();
    const byId = new Map(views.map((v) => [v.id, v]));
    for (const [id, r] of this.recs) {
      const s = byId.get(id);
      if (!s) {
        gone.add(id);
        this.recs.delete(id);
        this.boards.delete(id);
        continue;
      }
      r.name = s.name;
      r.kept = s.kept;
      // the view's own focus, and the targets linked to it: what the review is on there
      if (s.focus === undefined) delete r.focus;
      else r.focus = s.focus;
      if (s.targets === undefined) delete r.targets;
      else r.targets = [...s.targets];
      // the build it is kept at (HistorySpec decision 19): another graph on it
      if ((s.version ?? null) !== (r.version ?? null)) {
        if (s.version === undefined) delete r.version;
        else r.version = s.version;
        redo.add(id);
      }
      if (s.clustering !== r.clustering) {
        r.clustering = s.clustering;
        redo.add(id);
      }
      if (s.scope !== printQuery(r.scope)) {
        try {
          r.scope = parseQuery(s.scope);
          this.boards.delete(id);
          redo.add(id);
        } catch {
          // a scope this page cannot read: it keeps the one it has
        }
      }
    }
    for (const c of changes) if (c.what === "relayout") redo.add(c.id);
    return { redo, gone };
  }

  /** Pins, folds and hidden levels another page or an agent changed; true when the view's record
   *  changed. The notes added to a view or taken out of it change its line in the list too, which
   *  Add to view reads for every view (shared/items.ts); the record takes them from here alone, as
   *  its pins, never from a list that may have been made before this page's own change arrived. */
  ops(id: string, ops: ViewOp[]): boolean {
    const items = ops.filter((o): o is ItemOp => o.op === "item");
    const s = items.length ? this.summary(id) : undefined;
    if (s) for (const o of items) applyItemOp(s, o);
    const r = this.recs.get(id);
    return !!r && applyViewOps(r, ops);
  }

  /** A board was laid out for a new set (or afresh: `set` null). True when this page's layout of it
   *  is not that one and is to be made again. */
  memory(id: string, mode: ClusterMode, base: string | null, set: string | null): boolean {
    this.setServerMem(id, mode, set);
    const b = this.boards.get(id);
    if (set === null) {
      delete this.mems.get(id)?.[mode];
      if (b) delete b.layouts[mode];
      return !!b && ownLayout(b);
    }
    if (!b || !ownLayout(b) || !b.layouts[mode]) return false;
    // the same memory made from the same one: the picture here is that one
    if (b.from[mode] === base && b.made[mode]?.set === set) {
      (this.mems.get(id) ?? this.mems.set(id, {}).get(id)!)[mode] = b.made[mode]!;
      return false;
    }
    if (this.key(b, mode) !== set || b.from[mode] === set) return false;
    delete b.layouts[mode];
    return true;
  }
}
