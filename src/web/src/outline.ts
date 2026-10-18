// The cluster tree beside the canvas: where things are, the switch that folds them, what is
// trusted without review, and hiding a level (ViewSpec decision 24; a hidden level is not listed,
// as the board does not have it). A click on a row is a click on its cluster (web/src/selection.ts).

import type { Layout } from "../../shared/graph.ts";
import { escapeHtml } from "./highlight.ts";
import { keepFocus } from "./keepfocus.ts";

export interface OutlineHooks {
  /** a click on a row: its cluster clicked with the tool (shift held or not) */
  select(c: number, shift: boolean): void;
  /** whether a cluster is one of the selection's picks */
  picked(c: number): boolean;
  toggleFold(c: number): void;
  isFolded(c: number): boolean;
  isCollapsed(c: number): boolean;
  /** a build state class for a cluster row, or "" */
  stateOf(c: number): string;
  /** a cluster row's trust mark and action, as HTML, or "" (web/src/trust.ts) */
  trustCell(c: number): string;
  /** a click on a row's trust action */
  trustClicked(c: number, row: HTMLElement): void;
  /** hide a cluster's level, for everyone on the board: what it holds moves up into its parent */
  hide(c: number): void;
}

/** An eye struck through, as the side panel's buttons draw their marks. */
export const HIDE_MARK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/><path d="M2.5 13.5l11-11"/></svg>`;

export class Outline {
  private el: HTMLElement;
  private layout!: Layout;
  private kids: number[][] = [];
  private top: number[] = [];
  private open = new Set<number>();
  /** the rows open, by cluster key, on each board and clustering shown (`setLayout`'s `board`) */
  private openOn = new Map<string, Set<string>>();
  private board: string | null = null;
  private hooks: OutlineHooks;

  constructor(el: HTMLElement, hooks: OutlineHooks) {
    this.el = el;
    this.hooks = hooks;
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>("[data-c]");
      if (!row) return;
      const c = Number(row.dataset.c);
      if (t.closest(".tw")) {
        if (this.open.has(c)) this.open.delete(c);
        else this.open.add(c);
        this.render();
      } else if (t.closest(".fold")) {
        this.hooks.toggleFold(c);
      } else if (t.closest("[data-trust]")) {
        this.hooks.trustClicked(c, row);
      } else if (t.closest("[data-hide]")) {
        this.hooks.hide(c);
      } else this.hooks.select(c, e.shiftKey);
    });
  }

  /** The tree of `layout`, the board `board` (its view and clustering) laid out. The rows the reader
   *  opened on a board stay open there, by key (a new graph renumbers clusters), and come back with
   *  it when another board was shown meanwhile; a board shown for the first time opens its largest
   *  part. */
  setLayout(layout: Layout, board: string): void {
    if (this.layout && this.board !== null) this.openOn.set(this.board, new Set([...this.open].map((c) => this.layout.clusters[c]?.key)));
    const wasOpen = this.openOn.get(board) ?? null;
    this.board = board;
    this.layout = layout;
    this.kids = layout.clusters.map(() => []);
    this.top = [];
    layout.clusters.forEach((c, i) => (c.parent >= 0 ? this.kids[c.parent].push(i) : this.top.push(i)));
    const byCount = (a: number, b: number) => layout.clusters[b].count - layout.clusters[a].count;
    this.top.sort(byCount);
    // the project first, the external world last
    this.top.sort((a, b) => Number(layout.clusters[a].ext) - Number(layout.clusters[b].ext));
    for (const k of this.kids) k.sort((a, b) => (layout.clusters[a].label < layout.clusters[b].label ? -1 : 1));
    // a small board opens its largest part: what it holds is mostly there
    const total = this.top.reduce((n, c) => n + (layout.clusters[c].ext ? 0 : layout.clusters[c].count), 0);
    this.open = wasOpen
      ? new Set(layout.clusters.map((_, i) => i).filter((i) => wasOpen.has(layout.clusters[i].key)))
      : new Set(this.top.filter((c) => !layout.clusters[c].ext && (layout.clusters[c].count > 500 || layout.clusters[c].count >= 0.4 * total)));
    this.render();
  }

  render(): void {
    const rows: string[] = [];
    const walk = (c: number, depth: number) => {
      const cl = this.layout.clusters[c];
      const has = this.kids[c].length > 0;
      const folded = this.hooks.isFolded(c);
      // a row reads as inactive when its cluster is folded or sits inside a folded one
      const inactive = this.hooks.isCollapsed(c);
      rows.push(
        `<div class="o-row${inactive ? " folded" : ""}${this.hooks.picked(c) ? " on" : ""}" data-c="${c}" style="padding-left:${8 + depth * 12}px" title="${escapeHtml(cl.key)}">` +
          // the arrow opens or folds a level of the list, the name selects: each a button, for the
          // keyboard as for the pointer
          (has
            ? `<button class="tw" type="button" aria-expanded="${this.open.has(c)}" aria-label="What ${escapeHtml(cl.label)} holds">${this.open.has(c) ? "▾" : "▸"}</button>`
            : `<span class="tw"></span>`) +
          `<button class="o-label" type="button">${escapeHtml(cl.label)}</button>` +
          (this.hooks.stateOf(c) ? `<span class="o-st ${this.hooks.stateOf(c)}"></span>` : "") +
          `<span class="o-count">${cl.count}</span>` +
          this.hooks.trustCell(c) +
          `<button class="o-hide" data-hide title="Hide this level, for everyone on this board: what it holds moves up into its parent (⚙ Board shows it again)" aria-label="Hide this level">${HIDE_MARK}</button>` +
          `<button class="fold" title="${folded ? "Unfold" : "Fold"} on the canvas" aria-label="${folded ? "Unfold" : "Fold"} ${escapeHtml(cl.label)} on the canvas">${folded ? "○" : "●"}</button>` +
          `</div>`,
      );
      if (has && this.open.has(c)) for (const k of this.kids[c]) walk(k, depth + 1);
    };
    for (const c of this.top) walk(c, 0);
    // drawn again as the reader goes (a level opened, a cluster selected): the focus stays on its row
    keepFocus(this.el, () => (this.el.innerHTML = rows.join("")));
  }
}
