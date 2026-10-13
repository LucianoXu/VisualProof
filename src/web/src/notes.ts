// Shared changes made visible (ViewSpec decision 9): when someone else folds, moves or rescopes the
// board the reader is on, a short note shows where it happened — on the canvas at what was folded
// or moved ("Alice folded NumberTheory", "Bob moved 3 declarations"), in the reader's colour for that
// person — and fades after a few seconds. A change of scope is noted beside the scope chips
// (web/src/boardpanel.ts).

import { escapeHtml } from "./highlight.ts";

const SHOWN_MS = 4000;

export class Notes {
  private layer: HTMLElement;

  constructor(layer: HTMLElement) {
    this.layer = layer;
  }

  /** A note at a point of the screen, in `color`, kept inside the window. */
  at(sx: number, sy: number, who: string, text: string, color: string): void {
    const el = document.createElement("div");
    el.className = "note";
    el.style.setProperty("--c", color);
    el.innerHTML = `<b>${escapeHtml(who)}</b> ${escapeHtml(text)}`;
    this.layer.append(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, sx - w / 2));
    const y = Math.max(8, Math.min(innerHeight - h - 8, sy - h - 14));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    // at most a few at once: the oldest go first
    while (this.layer.children.length > 6) this.layer.firstElementChild!.remove();
    setTimeout(() => {
      el.classList.add("fade");
      setTimeout(() => el.remove(), 600);
    }, SHOWN_MS);
  }

  clear(): void {
    this.layer.innerHTML = "";
  }
}
