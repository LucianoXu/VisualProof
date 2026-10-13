// The selection, at the top right under the mode buttons (decided 2026-10-07): a slim bar with
// a chip for each pick (web/src/selection.ts) — its words, and × to take it out — how many
// declarations are lit, Zoom in, and Clear; where the review has a focus, "Mark selected as key"
// marks the declarations clicked as key declarations of that target (ExportSpec decision 1).
// Hidden while nothing is selected. It sits above the
// panel, in the panel's column, which moves down to make room for it (style.css, --selbar-h).

import { printQuery } from "../../shared/query.ts";
import { escapeHtml } from "./highlight.ts";
import { pickWords } from "./selection.ts";
import type { Pick } from "./selection.ts";

export interface SelectionBarHooks {
  /** a chip clicked: the panel tells of its pick, and the view goes there */
  show(k: number): void;
  /** a chip's ×: its pick taken out */
  remove(k: number): void;
  zoom(): void;
  clear(): void;
  /** mark the declarations selected key for the target on show */
  markKeys(): void;
}

/** What "Mark selected as key" would do where the review has a focus: how many of the declarations
 *  clicked its review holds that are not key yet, and the target's short name. */
export interface KeyMarking {
  target: string;
  /** not key yet, and in the target's review */
  fresh: number;
  /** clicked declarations already key */
  already: number;
}

export class SelectionBar {
  private el: HTMLElement;
  private hooks: SelectionBarHooks;

  constructor(el: HTMLElement, hooks: SelectionBarHooks) {
    this.el = el;
    this.hooks = hooks;
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const rm = t.closest<HTMLElement>("[data-rm]");
      if (rm) return this.hooks.remove(Number(rm.dataset.rm));
      const go = t.closest<HTMLButtonElement>("[data-show]");
      if (go && !go.disabled) return this.hooks.show(Number(go.dataset.show));
      if (t.closest("[data-zoom]")) return this.hooks.zoom();
      const mk = t.closest<HTMLButtonElement>("[data-mark-keys]");
      if (mk && !mk.disabled) return this.hooks.markKeys();
      if (t.closest("[data-clear]")) this.hooks.clear();
    });
  }

  get shown(): boolean {
    return !this.el.hidden;
  }

  /** The picks, the one the panel tells of (its index, or -1), how many declarations are lit on the
   *  board, and whether Zoom in has a view to open that is not this one: one holding something,
   *  and not just what this board holds (shared/board.ts, zoomScope). */
  render(picks: Pick[], panel: number, lit: number, zoom: boolean, key: KeyMarking | null = null): void {
    this.el.hidden = !picks.length;
    if (!picks.length) {
      this.el.innerHTML = "";
      return;
    }
    const esc = escapeHtml;
    const why = lit ? "This board holds just what is lit already" : "Nothing selected is on this board";
    const chips = picks
      .map((p, k) => {
        const words = pickWords(p);
        // a part written by hand has nothing to go to: it is lit, and can be taken out
        return (
          `<span class="sb-chip t-${p.tool}${k === panel ? " on" : ""}" title="${esc(printQuery(p.q))}">` +
          `<button class="sb-go" data-show="${k}"${p.root ? ` title="Show ${esc(words)}"` : " disabled"}>${esc(words)}</button>` +
          `<button class="sb-x" data-rm="${k}" title="Take it out" aria-label="Take ${esc(words)} out">×</button></span>`
        );
      })
      .join("");
    this.el.innerHTML =
      `<span class="sb-chips">${chips}</span>` +
      `<span class="sb-meta"><span class="sb-n" title="Declarations lit on this board">${lit.toLocaleString()} lit</span>` +
      `<button class="sb-btn" data-zoom${zoom ? ` title="Open a view of what is selected, laid out on its own, in a tab"` : ` disabled title="${why}"`}>Zoom in</button>` +
      (key
        ? `<button class="sb-btn sb-key" data-mark-keys${
            key.fresh
              ? ` title="${esc(`Mark the ${key.fresh} declaration${key.fresh === 1 ? "" : "s"} you clicked as key for ${key.target}`)}"`
              : ` disabled title="${esc(key.already ? `What you clicked is key for ${key.target} already` : `Nothing you clicked is in ${key.target}'s review besides the target`)}"`
          }>◆ Mark selected as key${key.fresh > 1 ? ` (${key.fresh})` : ""}</button>`
        : "") +
      `<button class="sb-btn" data-clear title="Select nothing (Esc)">Clear</button></span>`;
  }
}
