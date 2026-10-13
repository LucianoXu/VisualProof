// Going from view to view (ViewSpec decisions 3 and 10): the tabs this reader has open, which one
// is on show, and where the reader was on each — the camera, the tool, what was selected — so that
// going back to a tab returns there. A view nobody keeps is remembered by its query too: the server
// forgets it once no page has it open, and the query opens it again, freshly laid out.
//
// Showing a view waits for its board (its record, and a layout laid out here may wait for the
// board's memory, web/src/views.ts); a later step supersedes one still waiting.

import type { ClusterMode, Layout } from "../../shared/graph.ts";
import { printQuery } from "../../shared/query.ts";
import { PROJECT } from "../../shared/views.ts";
import type { Seen, Store, Tab } from "./store.ts";
import type { Board, Views } from "./views.ts";
import type { Visitor } from "./visitors.ts";

/** Where the reader is on a board: the tool, the selection, what the panel tells of, the camera
 *  (null: fit, or go to what the panel tells of), their own focus; and, from a followed reader, their
 *  visitors (ViewSpec decision 27), which no place kept per view holds. */
export type Place = Seen & { visitors?: Visitor[] };

export interface ViewNavHooks {
  /** put a board on the canvas */
  show(b: Board, L: Layout): void;
  /** take a place on the board on show; `fresh`: the board was not on show before */
  place(p: Place, fresh: boolean): void;
  /** where the reader is on the board on show */
  here(): Place;
  /** the tabs, or the view on show, changed */
  changed(): void;
}

export class ViewNav {
  board!: Board;
  private views: Views;
  private store: Store;
  private hooks: ViewNavHooks;
  /** the step being waited for: a later one supersedes it */
  private step = 0;
  /** steps still waiting for their board */
  private waiting = 0;

  constructor(views: Views, store: Store, hooks: ViewNavHooks) {
    this.views = views;
    this.store = store;
    this.hooks = hooks;
  }

  get tabs(): Tab[] {
    return this.store.data.tabs;
  }

  /** The view's text for the address and the others: its query when nobody keeps it. */
  query(id = this.board.id): string | null {
    const r = this.views.rec(id);
    return r && !r.kept ? printQuery(r.scope) : null;
  }

  /** The build a view nobody keeps shows, with its query (null: the latest, or a kept view, whose
   *  record says). */
  queryVersion(id = this.board.id): number | null {
    const r = this.views.rec(id);
    return r && !r.kept ? r.version ?? null : null;
  }

  /** Show view `id`, opening a tab for it; at `to`, or where the reader was on it. Resolves to
   *  whether it is on show (false: gone, or superseded by a later step). */
  show(id: string, to: Place | null = null): Promise<boolean> {
    return this.hold(() => this.showing(id, to));
  }

  /** Count a step as waiting while `f` runs. */
  private async hold<T>(f: () => Promise<T>): Promise<T> {
    this.waiting++;
    try {
      return await f();
    } finally {
      this.waiting--;
    }
  }

  /** Whether a step is waiting for its board: the address names where it goes, not the view on
   *  show, until it is there. */
  get busy(): boolean {
    return this.waiting > 0;
  }

  private async showing(id: string, to: Place | null): Promise<boolean> {
    const step = ++this.step;
    const rec = await this.views.record(id);
    if (!rec || step !== this.step) return false;
    // a view kept at a past build waits for that build's graph (web/src/timemachine.ts)
    await this.views.prepare(id);
    if (step !== this.step) return false;
    const b = this.views.board(id);
    if (!b) return false;
    const L = await this.views.layout(b, rec.clustering);
    if (step !== this.step) return false;
    const fresh = !this.board || this.board.id !== id || this.board !== b;
    if (this.board && this.board.id !== id) this.remember();
    this.addTab(id);
    this.store.data.active = id;
    this.store.save();
    this.board = b;
    this.hooks.show(b, L);
    this.hooks.place(to ?? this.store.data.seen[id] ?? { cam: null, mode: this.store.data.mode, picks: null, shown: null }, fresh);
    this.hooks.changed();
    return true;
  }

  /** Show the view on a query (an open one with the same scope and build, or a new one nobody
   *  keeps); `at`: the build it shows, and a new one's clustering and focus (web/src/views.ts,
   *  `open`). */
  open(scope: string, to: Place | null = null, at: { version?: number | null; clustering?: ClusterMode; focus?: string } = {}): Promise<boolean | string> {
    return this.hold(async () => {
      const v = await this.views.open(scope, at);
      if (typeof v === "string") return v;
      return this.show(v.id, to);
    });
  }

  /** A tab: shown, or — a view the server forgot (nobody kept it, every page had closed it) —
   *  opened again from its query, freshly laid out. */
  select(id: string, to: Place | null = null): Promise<boolean> {
    return this.hold(() => this.selecting(id, to));
  }

  private async selecting(id: string, to: Place | null): Promise<boolean> {
    if (await this.show(id, to)) return true;
    const t = this.tabs.find((x) => x.id === id);
    if (!t?.q) {
      await this.close(id);
      return false;
    }
    const v = await this.views.open(t.q, { version: t.at ?? null });
    if (typeof v === "string") return false;
    // the same tab, under the view's new id, with the reader's place on it
    t.id = v.id;
    const seen = this.store.data.seen[id];
    if (seen) this.store.remember(v.id, seen);
    return this.show(v.id, to);
  }

  /** Close a tab; the Project stays. Closing the one on show goes to its neighbour. */
  async close(id: string): Promise<void> {
    if (id === PROJECT) return;
    const k = this.tabs.findIndex((t) => t.id === id);
    if (k < 0) return;
    this.tabs.splice(k, 1);
    this.store.save();
    if (this.board?.id === id) await this.select(this.tabs[Math.min(k, this.tabs.length - 1)]?.id ?? PROJECT);
    else this.hooks.changed();
  }

  /** The board on show again, where the reader is: its set, layout or clustering changed. While its
   *  layout is made, the board may change again (another review change, a rescope): then the latest
   *  is laid out and shown, never none of them. */
  async redraw(): Promise<void> {
    const id = this.board.id;
    await this.views.prepare(id);
    for (;;) {
      if (this.board.id !== id) return;
      const next = this.views.board(id);
      if (!next) return;
      const L = await this.views.layout(next, next.rec.clustering);
      // moved on to another view meanwhile: that one is laid out when it is shown
      if (this.board.id !== id) return;
      if (this.views.board(id) !== next) continue;
      const here = this.hooks.here();
      this.board = next;
      this.hooks.show(next, L);
      this.hooks.place(here, false);
      return;
    }
  }

  /** The board on show's layout by `mode` (the clustering changed). */
  layout(mode: ClusterMode): Promise<Layout> {
    return this.views.layout(this.board, mode);
  }

  /** Remember where the reader is on the board on show. */
  remember(): void {
    if (this.board) this.store.remember(this.board.id, this.hooks.here());
  }

  /** The tabs as the list of views says: a view kept now loses its query; one gone without a query
   *  to open it again is closed. */
  sync(gone: Set<string>): void {
    for (const t of [...this.tabs]) {
      const s = this.views.summary(t.id);
      if (s?.kept) {
        delete t.q;
        delete t.at;
      } else if (s) {
        t.q = s.scope;
        if (s.version !== undefined) t.at = s.version;
        else delete t.at;
      }
      else if (gone.has(t.id) && !t.q && t.id !== PROJECT) this.tabs.splice(this.tabs.indexOf(t), 1);
    }
    this.store.save();
  }

  private addTab(id: string): void {
    if (!this.tabs.some((t) => t.id === PROJECT)) this.tabs.unshift({ id: PROJECT });
    const q = this.query(id);
    const at = this.queryVersion(id);
    // a tab of the same query and build, whose view the server forgot, is this one again
    let t = this.tabs.find((x) => x.id === id) ?? (q ? this.tabs.find((x) => x.q === q && (x.at ?? null) === at && !this.views.summary(x.id)) : undefined);
    if (t && t.id !== id) {
      const seen = this.store.data.seen[t.id];
      if (seen && !this.store.data.seen[id]) this.store.data.seen[id] = seen;
      t.id = id;
    }
    if (!t) this.tabs.push((t = { id }));
    if (q) t.q = q;
    else delete t.q;
    if (q && at !== null) t.at = at;
    else delete t.at;
  }
}
