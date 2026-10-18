// The targets at the top of the side panel: every theorem whose TCB is being reviewed, with how far
// its review has come — its key declarations (◆, ExportSpec decision 4), then all of it — each
// opening its view on the target (ViewSpec decision 29); one with no view (marking makes none, the
// owner's decision of 2026-10-12, and a view deleted leaves its targets with none) says so, and a click opens a view nobody keeps of its TCB, linked to it while it lasts (the owner's
// decision of 2026-10-11). The review is the same on every board, so the list is too. It folds away,
// as the filter does; which of them are folded is the reader's own (web/src/store.ts).

import type { StatusCounts } from "../../shared/keys.ts";
import type { Progress } from "../../shared/review.ts";
import type { ViewSummary } from "../../shared/views.ts";
import { escapeHtml } from "./highlight.ts";
import { keepFocus } from "./keepfocus.ts";

export interface TargetListHooks {
  /** every view on the server: those linked to a target are the targets' */
  list(): ViewSummary[];
  /** every target of the review, whether it has a view or not */
  targets(): string[];
  /** the view on show */
  active(): string | null;
  /** how far a target's review has come, and that of its key declarations; null when it is not in
   *  the graph */
  progress(target: string): Progress | null;
  keyProgress(target: string): StatusCounts | null;
  /** open a target's view (`id`), the target selected there; null for a target with no view, which
   *  is given a view nobody keeps of its TCB */
  open(id: string | null, target: string): void;
  /** a view's title */
  title?(id: string): string;
  /** whether targets cannot be marked from this page (a snapshot, a read-only page): the empty list
   *  then says no more than that it is empty */
  readOnly?(): boolean;
  /** whether a section of the side panel is folded, and folding or opening it */
  shut(section: string): boolean;
  toggle(section: string): void;
}

/** The targets as the side panel lists them: every target by name, with the view it is linked to,
 *  or null where it has none (ViewSpec decision 29): none was linked to it — marking makes none, the
 *  owner's decision of 2026-10-12 — or its view was deleted. A view may be several targets', and is
 *  each one's row. A target linked to a view but that the review no longer
 *  marks (the list a moment behind) is listed too. */
export function targetRows(targets: readonly string[], views: readonly ViewSummary[]): { target: string; view: ViewSummary | null }[] {
  const linked = new Map(views.flatMap((v) => (v.targets ?? []).map((t): [string, ViewSummary] => [t, v])));
  return [...new Set([...targets, ...linked.keys()])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((target) => ({ target, view: linked.get(target) ?? null }));
}

/** Where a click on a target with a view takes the reader (ViewSpec decision 29): that view, by its
 *  id; null where it is on show — the board stays, and the target is gone to there as any declaration
 *  is (decision 27). A target with none (`view` undefined) is given one (main.ts, `reviewTarget`). */
export function targetStep(view: string | undefined, board: string | null): string | null {
  return view === undefined || view === board ? null : view;
}

/** A section's heading that folds it: a chevron, the title, and what is worth seeing folded. */
export function sectionHead(id: string, shut: boolean, title: string, aside = ""): string {
  return (
    `<button class="sec-h" data-sec="${id}" aria-expanded="${!shut}" title="${shut ? "Show" : "Fold"} ${escapeHtml(title.toLowerCase())}">` +
    `<span class="sec-chev" aria-hidden="true">${shut ? "▸" : "▾"}</span><span class="sec-t">${escapeHtml(title)}</span>` +
    (aside ? `<span class="sec-aside muted">${aside}</span>` : "") +
    `</button>`
  );
}

export class TargetList {
  private el: HTMLElement;
  private hooks: TargetListHooks;

  constructor(el: HTMLElement, hooks: TargetListHooks) {
    this.el = el;
    this.hooks = hooks;
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-sec]")) return this.hooks.toggle("targets");
      const row = t.closest<HTMLElement>("[data-target]");
      if (row) this.hooks.open(row.dataset.open ?? null, row.dataset.target!);
    });
  }

  render(): void {
    const rows = targetRows(this.hooks.targets(), this.hooks.list());
    const shut = this.hooks.shut("targets");
    const active = this.hooks.active();
    let html = sectionHead("targets", shut, "Targets", String(rows.length));
    if (!shut) {
      html += rows.length
        ? `<div class="tg-rows">` +
          rows
            .map(({ target, view: v }) => {
              const p = this.hooks.progress(target);
              const k = this.hooks.keyProgress(target);
              const pct = (x: number) => (p && p.total ? ((100 * x) / p.total).toFixed(1) : "0");
              // a target with no view says so, and a click gives it a view nobody keeps of its TCB
              const tip = v ? `${target} — open its view, on it: ${this.hooks.title?.(v.id) ?? v.id}` : `${target} — it has no view: open a temporary view of its TCB, linked to it until it goes (pin, fold or name it to keep it)`;
              return (
                `<button class="tg-row${v && v.id === active ? " on" : ""}${v ? "" : " tg-viewless"}"${v ? ` data-open="${escapeHtml(v.id)}"` : ""} data-target="${escapeHtml(target)}" title="${escapeHtml(tip)}">` +
                `<span class="tg-name"><span class="star">★</span>${escapeHtml(target.split(".").pop()!)}</span>` +
                (p
                  ? // with no view, that is said where the bar is, so that the name keeps its room
                    (v ? `<span class="rv-bar"><i class="ok" style="width:${pct(p.approved)}%"></i><i class="commented" style="width:${pct(p.commented)}%"></i><i class="stale" style="width:${pct(p.stale)}%"></i></span>` : `<span class="tg-noview">no view</span>`) +
                    (k ? `<span class="tg-key" title="${escapeHtml(`Key declarations: ${k.approved} of ${k.total} approved, the target among them`)}"><span class="key-mark">◆</span>${k.approved}/${k.total}</span>` : "") +
                    `<span class="tg-n" title="${escapeHtml(`All it rests on: ${p.approved} of ${p.total} approved`)}">${p.approved}/${p.total}</span>`
                  : `<span class="muted tg-gone">not in the graph now${v ? "" : ", no view"}</span>`) +
                `</button>`
              );
            })
            .join("") +
          `</div>`
        : `<div class="tg-none muted">${this.hooks.readOnly?.() ? "No targets yet." : "No targets yet: ☆ Mark as target in a theorem's panel."}</div>`;
    }
    // drawn again as the reader goes to a target: the focus stays on its row
    keepFocus(this.el, () => (this.el.innerHTML = html));
  }
}
