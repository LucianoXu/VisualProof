// The board on show, shared (ViewSpec decisions 2, 7, 9 and 24): what this page does to it — pins
// dropped and let go, clusters folded and opened, levels hidden and shown again, its scope and
// clustering — goes to everyone on the view, and what others do comes back the same way, as the
// server tells it (server/views.ts): the list of views with what changed and who changed it, pins,
// folds and hidden levels as operations, a board laid out for a new set. What someone else did on
// the board on show is noted where it happened (web/src/notes.ts, and beside the scope chips).
//
// A view kept at a past build is arranged as any view (the owner's decision of 2026-10-10): its pins,
// folds, levels, scope, clustering and notes are its own, at its build. What a board shows the view
// at another build than its own — the Time Machine browsing it (HistorySpec decision 18) — is a
// preview, which nothing this page does arranges (`frozen`): a fold there stays this page's own until
// it shows the view's board again. The build a view is kept at is still set from it (`keepVersion`),
// which is how a view comes to be kept.

import { reframePins } from "../../shared/board.ts";
import type { ClusterMode } from "../../shared/graph.ts";
import { diffPins } from "../../shared/places.ts";
import type { PlaceOp } from "../../shared/places.ts";
import { printQuery } from "../../shared/query.ts";
import type { Query } from "../../shared/query.ts";
import { diffFolds, PROJECT } from "../../shared/views.ts";
import type { Change, ViewOp, ViewSummary } from "../../shared/views.ts";
import type { BoardPanel } from "./boardpanel.ts";
import type { GraphCanvas } from "./canvas.ts";
import type { ViewAnswer } from "./data.ts";
import { escapeHtml } from "./highlight.ts";
import type { Notes } from "./notes.ts";
import type { Outline } from "./outline.ts";
import type { ViewNav } from "./viewnav.ts";
import type { Views } from "./views.ts";
import type { StreamHello } from "../../shared/collab.ts";

export interface BoardSyncHooks {
  canvas: GraphCanvas;
  outline: Outline;
  boardPanel: BoardPanel;
  notes: Notes;
  /** a snapshot: no server says what changed */
  snapshot: boolean;
  /** this page's event stream as the server named it (server/live.ts): the id its own operations
   *  come back under, and the secret that says they are its own; null before it said hello */
  stream(): StreamHello | null;
  /** the name of this page's reader */
  me(): string | null;
  colorOf(name: string): string;
  /** the server took no name from this page */
  lost(): void;
  /** the tabs and the menu, the depth stepper, the timeline: drawn again */
  tabsChanged(): void;
  /** the notes of the board on show changed (web/src/sticky.ts) */
  notesChanged(): void;
  levelChanged(): void;
  activityChanged(): void;
  /** say why something was refused, where the hint is */
  hint(text: string): void;
  /** why the board on show cannot be arranged now (a preview of its view at another build), or null */
  frozen?(): string | null;
  /** the address, as it is now (`push`: a step) */
  writeAddress(push: boolean): void;
  /** the views changed: the review's focus on the board on show may have (ViewSpec decision 28) */
  focusChanged?(): void;
  /** a target was linked to a view or unlinked, or its view deleted or gone (ViewSpec decision 29):
   *  what a target's panel says of its view is drawn again */
  linksChanged?(): void;
}

export class BoardSync {
  private views: Views;
  private nav: ViewNav;
  private h: BoardSyncHooks;

  constructor(views: Views, nav: ViewNav, hooks: BoardSyncHooks) {
    this.views = views;
    this.nav = nav;
    this.h = hooks;
  }

  private get cm(): ClusterMode {
    return this.nav.board.rec.clustering;
  }

  // ---------------------------------------------------------------- from this page

  /** Send operations on the view on show; they are applied here at once. Resolves once the server
   *  has them. */
  arrange(ops: ViewOp[]): Promise<void> {
    const frozen = (this.h.frozen?.() ?? null);
    if (frozen) {
      this.h.hint(frozen);
      return Promise.resolve();
    }
    return this.send(ops);
  }

  /** Keep the view on show at a build (a snapshot's id; null for the latest again), for everyone on
   *  it (HistorySpec decision 19): what the Time Machine's Keep this version in this view sends, from
   *  a preview though the board is. Resolves to why it was refused, or null. */
  async keepVersion(snapshot: number | null): Promise<string | null> {
    const id = this.nav.board.id;
    const r = await this.views.post("arrange", { id, token: this.h.stream()?.token ?? null, ops: [{ op: "version", snapshot }] });
    if (r.who) this.h.lost();
    if (r.error) return r.error;
    this.views.ops(id, [{ op: "version", snapshot }]);
    this.afterPost();
    return null;
  }

  private send(ops: ViewOp[]): Promise<void> {
    const id = this.nav.board.id;
    this.views.ops(id, ops);
    return this.views.post("arrange", { id, token: this.h.stream()?.token ?? null, ops }).then((r) => {
      if (r.error) this.h.hint(r.error);
      this.afterPost();
    });
  }

  /** Hide levels of the board on show, by their clusters' keys, or show hidden ones again (`on`
   *  false), for everyone on it (ViewSpec decision 24): what a hidden level holds sits in its parent.
   *  The pins of what moves to another parent go with it into that parent's coordinates, so nothing
   *  pinned moves; then the board is shown again, laid out so. */
  async setHidden(keys: string[], on: boolean): Promise<void> {
    const frozen = (this.h.frozen?.() ?? null);
    if (frozen) return this.h.hint(frozen);
    const b = this.nav.board;
    const m = this.cm;
    const now = b.rec.hidden[m];
    const todo = [...new Set(keys)].filter((k) => now.includes(k) !== on);
    if (!todo.length) return;
    const after = this.views.layoutWith(b, m, on ? [...now, ...todo] : now.filter((k) => !todo.includes(k)));
    // from where everything is drawn: what pins pushed aside is not at its layout place; each
    // declaration by the name its pin is kept under (a past graph's: its name now)
    const names = { n: b.graph.n, nodes: b.graph.nodes.map((_, j) => ({ name: this.h.canvas.pinName(j) })) };
    const moved = reframePins(names, this.h.canvas.drawnLayout(), after, b.rec.pins[m], m);
    await this.arrange([...todo.map((key) => ({ op: "hide" as const, mode: m, key, on })), ...moved]);
    await this.nav.redraw();
  }

  /** Hide one level of the board on show, by its cluster's key: what the outline, a cluster's panel
   *  and the canvas's menu call. */
  hideLevel(key: string): Promise<void> {
    return this.setHidden([key], true);
  }

  /** This page dropped or let go of something. Pins of what this board does not hold now (a file
   *  that failed, say) are left as they are. */
  sharePins(): void {
    if ((this.h.frozen?.() ?? null)) return;
    const { canvas } = this.h;
    const m = this.cm;
    const before = this.nav.board.rec.pins[m];
    const now = canvas.pinsRecord();
    const keys = new Set(canvas.layout.clusters.map((c) => c.key));
    const after = { nodes: { ...now.nodes }, clusters: { ...now.clusters } };
    for (const [k, v] of Object.entries(before.nodes)) if (!this.nav.board.graph.byName.has(k)) after.nodes[k] = v;
    for (const [k, v] of Object.entries(before.clusters)) if (!keys.has(k)) after.clusters[k] = v;
    const ops = diffPins(m, before, after);
    if (ops.length) this.arrange(ops);
  }

  /** This page folded or opened clusters; folds of clusters the board does not hold now stay. */
  shareFolds(): void {
    // on a preview a fold is this page's own, until it shows the view's board again
    if ((this.h.frozen?.() ?? null)) return;
    const { canvas } = this.h;
    const m = this.cm;
    const before = this.nav.board.rec.folds[m];
    const keys = new Set(canvas.layout.clusters.map((c) => c.key));
    const ops = diffFolds(m, before, [...canvas.foldedKeys(), ...before.filter((k) => !keys.has(k))]);
    if (ops.length) this.arrange(ops);
  }

  /** A snapshot has no server to say what changed: its views are read again after a change. */
  afterPost(): void {
    if (!this.h.snapshot) return;
    void this.views.load().then(() => {
      this.h.tabsChanged();
      this.h.boardPanel.render();
    });
  }

  /** Change the board on show for everyone: what the server answers, and why it refused. */
  async change(action: string, body: Record<string, unknown>): Promise<ViewAnswer> {
    const r = await this.views.post(action, { id: this.nav.board.id, ...body });
    if (r.who) this.h.lost();
    this.afterPost();
    return r;
  }

  /** The board's scope, for everyone: shown here at once. */
  async setScope(q: Query): Promise<string | null> {
    const frozen = (this.h.frozen?.() ?? null);
    if (frozen) return frozen;
    const r = await this.change("scope", { scope: printQuery(q) });
    if (r.error) return r.error;
    this.nav.board.rec.scope = q;
    await this.nav.redraw();
    this.h.boardPanel.render();
    this.h.tabsChanged();
    this.h.writeAddress(false);
    return null;
  }

  /** The board's clustering, for everyone (ViewSpec decision 7). */
  async setClustering(m: ClusterMode): Promise<void> {
    if (m === this.cm) return;
    const frozen = (this.h.frozen?.() ?? null);
    if (frozen) return this.h.hint(frozen);
    const r = await this.change("clustering", { clustering: m });
    if (r.error) return this.h.hint(r.error);
    this.nav.board.rec.clustering = m;
    await this.nav.redraw();
    this.h.canvas.fit(false);
  }

  // ---------------------------------------------------------------- from the others

  /** Someone other than this reader, by name, in their colour; null for a change nobody named,
   *  undefined for this reader's own. */
  private other(by: string | null): { who: string; color: string } | null | undefined {
    if (by === null) return null;
    return by !== this.h.me() ? { who: by, color: this.h.colorOf(by) } : undefined;
  }

  /** The list of views, as the server sends it, with what changed (`all`: the page was away). */
  listed(d: { views: ViewSummary[]; changes: Change[]; all?: boolean }): void {
    const { nav, views, h } = this;
    const id = nav.board.id;
    const { redo, gone } = views.listed(d.views, d.changes);
    nav.sync(gone);
    if (gone.has(id)) {
      const c = d.changes.find((x) => x.id === id && x.what === "deleted");
      const by = c && this.other(c.by);
      // a view deleted under the reader: back to the Project, saying who; one the server forgot
      // (nobody kept it) opens again from its query, where the reader is
      if (c || !nav.tabs.find((t) => t.id === id)?.q)
        void nav.select(PROJECT).then(() => {
          if (by) h.boardPanel.note(`<b>${escapeHtml(by.who)}</b> deleted the view you were on`);
          h.writeAddress(false);
        });
      else void nav.select(id).then(() => h.writeAddress(false));
    } else if (redo.has(id)) {
      // another clustering, or laid out afresh: everything moved, so the board is fitted; a scope
      // that changed keeps in place what stays, and the reader where they were
      const moved = d.changes.some((c) => c.id === id && (c.what === "clustering" || c.what === "relayout"));
      void nav.redraw().then(() => moved && h.canvas.fit(false));
    }
    if (d.all) {
      // the page was away: the boards it has open are read again, the one on show at once
      for (const t of nav.tabs) if (t.id !== id) views.drop(t.id);
      void views.record(id, true).then(() => nav.redraw());
    }
    for (const c of d.changes) {
      if (c.id !== id) continue;
      const by = this.other(c.by);
      if (!by) continue;
      const what: Partial<Record<Change["what"], string>> = {
        scope: "changed the scope",
        clustering: `clustered it by ${this.cm === "module" ? "file" : "namespace"}`,
        renamed: `renamed it “${views.title(id)}”`,
        relayout: "laid it out afresh; its pins were dropped",
        kept: "saved it for everyone",
        version: c.snapshot === null || c.snapshot === undefined ? "brought it back to the latest build" : "kept it at a past build",
        // the view's own focus, and a target linked to it or gone to another (ViewSpec decisions
        // 28 and 29)
        focus: views.rec(id)?.focus ? `focused it on ★${escapeHtml(views.rec(id)!.focus!.split(".").pop()!)}` : "took its focus away",
        // a link a click on a target with no view made is no one's act, as opening a view is not
        ...(c.temporary ? {} : { linked: `linked ★${escapeHtml((c.target ?? "").split(".").pop()!)} to it` }),
        unlinked: `linked ★${escapeHtml((c.target ?? "").split(".").pop()!)} to another view`,
      };
      if (what[c.what]) h.boardPanel.note(`<b style="color:${by.color}">${escapeHtml(by.who)}</b> ${what[c.what]}`);
    }
    h.tabsChanged();
    h.boardPanel.render();
    h.activityChanged();
    h.focusChanged?.();
    if (d.changes.some((c) => c.what === "linked" || c.what === "unlinked" || c.targets?.length)) h.linksChanged?.();
    h.writeAddress(false);
  }

  /** Pins, folds and hidden levels from another page or an agent: on the board on show, they move
   *  at once, and a note says who did what, where. */
  ops(d: { id: string; ops: ViewOp[]; from: string | null; by: string | null }): void {
    const { canvas, notes } = this.h;
    if ((d.from !== null && d.from === this.h.stream()?.id) || !this.views.ops(d.id, d.ops) || d.id !== this.nav.board.id) return;
    const rec = this.nav.board.rec;
    const m = this.cm;
    // the build it is kept at changed (HistorySpec decision 19): another graph on it, shown at once,
    // with whatever came with it — the list that says so too comes after, and finds it applied
    if (d.ops.some((o) => o.op === "version")) {
      void this.nav.redraw();
      this.h.tabsChanged();
      return;
    }
    // the view's own notes, or the notes of the project added to it or taken out of it
    // (shared/items.ts): which notes the board shows
    if (d.ops.some((o) => o.op.startsWith("note") || o.op === "item")) this.h.notesChanged();
    const items = d.ops.filter((o): o is Extract<ViewOp, { op: "item" }> => o.op === "item");
    const byItems = items.length ? this.other(d.by) : undefined;
    if (byItems) {
      const shown = items.filter((o) => o.in === "add").length;
      this.h.boardPanel.note(`<b style="color:${byItems.color}">${escapeHtml(byItems.who)}</b> ${shown ? `added ${shown === 1 ? "a note" : `${shown} notes`} to this view` : `changed which notes this view shows`}`);
    }
    // a level hidden or shown: the board is laid out again, its pins with it
    const levels = d.ops.filter((o): o is Extract<ViewOp, { op: "hide" }> => o.op === "hide" && o.mode === m);
    if (levels.length) {
      const by = this.other(d.by);
      // where the first was, while it is still on the canvas
      const was = canvas.screenOf("cluster", levels[0].key);
      void this.nav.redraw().then(() => {
        if (by === undefined) return;
        const at = was ?? canvas.screenOf("cluster", levels[0].key) ?? [innerWidth / 2, innerHeight / 2];
        const name = levels[0].key.replace("⟨external⟩", "External").split(".").pop();
        const what = levels.length === 1 ? `${levels[0].on ? "hid" : "showed"} the level ${name}` : `${levels.every((o) => o.on) ? "hid" : levels.every((o) => !o.on) ? "showed" : "hid and showed"} ${levels.length} levels`;
        notes.at(at[0], at[1], by?.who ?? "Someone", what, by?.color ?? "var(--text-3)");
      });
      return;
    }
    canvas.applyPins(rec.pins[m]);
    if (canvas.setFoldedKeys(rec.folds[m])) {
      this.h.outline.render();
      this.h.levelChanged();
    }
    const by = this.other(d.by);
    if (by === undefined) return;
    const who = by?.who ?? "Someone";
    const color = by?.color ?? "var(--text-3)";
    // what changed in the clustering on show
    const folds = d.ops.filter((o): o is Extract<ViewOp, { op: "fold" }> => o.op === "fold" && o.mode === m);
    const pins = d.ops.filter((o): o is Extract<PlaceOp, { op: "pin" | "unpin" }> => (o.op === "pin" || o.op === "unpin") && o.mode === m);
    if (folds.length === 1) {
      const p = canvas.screenOf("cluster", folds[0].key);
      if (p) notes.at(p[0], p[1], who, `${folds[0].on ? "folded" : "opened"} ${folds[0].key.split(".").pop()}`, color);
    } else if (folds.length) {
      const p = canvas.screenOf("cluster", folds[0].key) ?? [innerWidth / 2, innerHeight / 2];
      notes.at(p[0], p[1], who, `${folds.every((o) => o.on) ? "folded" : folds.every((o) => !o.on) ? "opened" : "folded and opened"} ${folds.length} clusters`, color);
    }
    if (pins.length) {
      const n = pins.filter((o) => o.kind === "node").length, c = pins.length - n;
      const p = canvas.screenOf(pins[0].kind, pins[0].key);
      const what = [n && `${n} declaration${n === 1 ? "" : "s"}`, c && `${c} cluster${c === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
      if (p) notes.at(p[0], p[1], who, `${pins.every((o) => o.op === "unpin") ? "let go of" : "moved"} ${what}`, color);
    }
  }

  /** A board was laid out for a new set somewhere (or afresh): the board on show again, when the
   *  picture here is not that one. */
  memory(d: { id: string; mode: ClusterMode; base: string | null; set: string | null }): void {
    if (this.views.memory(d.id, d.mode, d.base, d.set) && d.id === this.nav.board.id && d.mode === this.cm) void this.nav.redraw();
  }
}
