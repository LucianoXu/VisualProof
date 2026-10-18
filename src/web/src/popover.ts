// A popover: a small panel that opens from a button and goes away on a press anywhere else, on Esc,
// or on the button again. The page keeps its less used controls in them (decided 2026-10-08, the
// page made simpler): the board's settings and what is trusted beside the side panel, the lock, the
// edges and the theme behind the eyes' ⋯.
//
// From the keyboard it is a place of its own: opened by a key (Enter or Space on its button, or the
// page's key for it), the focus goes into it, as it may be far from its button in the page's order
// (⚙ Board's and Trusted's come after the whole tree); closed with the focus in it (Esc), the focus
// goes back to its button.

import { focusBack } from "./keepfocus.ts";

export class Popover {
  readonly btn: HTMLElement;
  readonly el: HTMLElement;
  /** puts the panel where it goes, once it is shown (it has a size then) */
  private place: (() => void) | null;
  /** what a press may land on without closing it: another window it opened (a question, the
   *  name), as selectors */
  private keep: string;
  /** told when it opens (to draw what it holds) or closes */
  private changed: (open: boolean) => void;

  constructor(btn: HTMLElement, el: HTMLElement, opts: { place?: () => void; keep?: string; changed?: (open: boolean) => void } = {}) {
    this.btn = btn;
    this.el = el;
    this.place = opts.place ?? null;
    this.keep = opts.keep ?? "";
    this.changed = opts.changed ?? (() => {});
    btn.addEventListener("click", (e) => {
      this.toggle();
      // a click from the keyboard (no pointer pressed it): its first control takes the focus
      if (this.open && e.detail === 0) firstControl(this.el)?.focus();
    });
    document.addEventListener("pointerdown", (e) => {
      const t = e.target as Element | null;
      if (this.el.hidden || !t || this.el.contains(t) || this.btn.contains(t) || (this.keep && t.closest?.(this.keep))) return;
      this.toggle(false);
    });
    window.addEventListener("resize", () => {
      if (!this.el.hidden) this.place?.();
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(open = this.el.hidden): void {
    if (open === !this.el.hidden) return;
    // closed with the focus in it: back to its button, not to the page's start
    if (!open) focusBack(this.el, this.btn);
    this.el.hidden = !open;
    this.btn.classList.toggle("on", open);
    this.btn.setAttribute("aria-expanded", String(open));
    this.changed(open);
    if (open) this.place?.();
  }
}

/** The first control in `el` the keyboard can reach. */
export function firstControl(el: HTMLElement): HTMLElement | null {
  for (const c of el.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, summary, [tabindex]")) {
    if (c.tabIndex >= 0 && !c.matches(":disabled") && (typeof c.checkVisibility !== "function" || c.checkVisibility())) return c;
  }
  return null;
}

/** Beside the side panel, level with the button that opened it, inside the window; what does not
 *  fit below scrolls (the filter opened in it can make it grow). */
export function besideSide(btn: HTMLElement, el: HTMLElement): void {
  const side = document.querySelector("#side")?.getBoundingClientRect();
  const at = btn.getBoundingClientRect();
  const left = side && side.width ? side.right + 8 : at.left;
  const top = Math.max(66, Math.min(at.top - 6, innerHeight - el.offsetHeight - 12, innerHeight - 240));
  el.style.left = `${Math.round(Math.max(12, Math.min(left, innerWidth - el.offsetWidth - 12)))}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.maxHeight = `${Math.round(innerHeight - top - 12)}px`;
}
