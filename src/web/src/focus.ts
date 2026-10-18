// The review's focus (ViewSpec decision 28): a view has a focus target, or none, and where it has
// one the review works — the strip, `k`, Keys, the Status scheme, the panel's chain from the target. The view's
// own focus is shared and kept with the view (shared/views.ts, viewFocus); each reader may focus
// otherwise for themselves, on another target linked to the view or held by the board, or on none,
// from the view's header
// ("Focus: ★T ▾"). That choice is theirs as the camera is: remembered per view (web/src/store.ts,
// Seen), followed by whoever follows them, and it never changes the view's own focus. The menu also
// offers to make the reader's focus the view's, for everyone on it.
//
// `readerFocus` says which target the review is on for a reader, as a pure function; `FocusMenu`
// draws the header's button and its menu.

import { escapeHtml } from "./highlight.ts";
import { firstControl } from "./popover.ts";

/** The focus the review is on for a reader: the view's own (`view`) where they chose nothing
 *  (`mine` undefined), none where they chose none, else the target they chose — while it is still a
 *  target that is the view's own, linked to the view or held by its board (`may`); otherwise the
 *  view's own again. */
export function readerFocus(mine: string | null | undefined, view: string | null, isTarget: (name: string) => boolean, may: readonly string[]): string | null {
  if (mine === undefined) return view;
  if (mine === null) return null;
  return isTarget(mine) && (mine === view || may.includes(mine)) ? mine : view;
}

/** The reader's own focus on a view, as their place there remembers it (web/src/store.ts, Seen),
 *  for a page opened at an address naming that view: the address carries none, and the reader's
 *  choice is remembered per view as the camera is (ViewSpec decision 28), across a reload as across
 *  a tab switched to. Nothing where they chose nothing: the view's own. */
export function keptFocus(seen: { focus?: unknown } | undefined): { focus?: string | null } {
  const f = seen?.focus;
  return f === null || typeof f === "string" ? { focus: f } : {};
}

/** What the menu offers: the targets linked to the view first, in the order they were linked (the
 *  owner's decision of 2026-10-11), then the view's own focus where it is none of them, then the
 *  other targets the board holds, and none. */
export function focusChoices(view: string | null, linked: readonly string[], held: readonly string[]): (string | null)[] {
  const out: (string | null)[] = [...new Set(linked)];
  if (view !== null && !out.includes(view)) out.push(view);
  for (const t of [...held].sort()) if (!out.includes(t)) out.push(t);
  out.push(null);
  return out;
}

export interface FocusMenuHooks {
  /** the view's own focus, the reader's choice (undefined: the view's), the focus in force, the
   *  targets linked to the view and those the board holds; null where there is no board yet */
  state(): { view: string | null; mine: string | null | undefined; focus: string | null; linked: string[]; held: string[] } | null;
  /** a target as the page names it: its name's last part, with as many parents as tell it apart */
  short(name: string): string;
  /** the reader chose a focus for themselves: a target, none (null), or the view's own (undefined) */
  choose(focus: string | null | undefined): void;
  /** make a focus the view's own, for everyone on it; resolves to why it was refused, or null */
  setView(focus: string | null): Promise<string | null>;
  /** the view's own focus can be changed from here: a name can be had, the board is no preview */
  canSet(): boolean;
}

/** The view's header's focus: "Focus: ★T ▾", and the menu under it. */
export class FocusMenu {
  private btn: HTMLElement;
  private menu: HTMLElement;
  private hooks: FocusMenuHooks;
  private error: string | null = null;

  constructor(btn: HTMLElement, menu: HTMLElement, hooks: FocusMenuHooks) {
    this.btn = btn;
    this.menu = menu;
    this.hooks = hooks;
    btn.addEventListener("click", (e) => {
      this.toggle();
      // opened from the keyboard: its first item takes the focus, as a menu's does
      if (this.open && e.detail === 0) firstControl(this.menu)?.focus();
    });
    menu.addEventListener("click", (e) => void this.clicked(e));
    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.toggle(false);
        this.btn.focus();
      }
    });
    // a press elsewhere closes it
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.menu.hidden && !this.menu.contains(e.target as Node) && !this.btn.contains(e.target as Node)) this.toggle(false);
      },
      { capture: true },
    );
  }

  get open(): boolean {
    return !this.menu.hidden;
  }

  toggle(open = this.menu.hidden): void {
    this.menu.hidden = !open;
    this.btn.classList.toggle("on", open);
    this.btn.setAttribute("aria-expanded", String(open));
    this.error = null;
    if (open) this.renderMenu();
  }

  /** The button: the focus in force, and whether it is the reader's own. */
  render(): void {
    const s = this.hooks.state();
    if (!s) return;
    const own = s.mine !== undefined && s.focus !== s.view;
    this.btn.innerHTML =
      `<span class="fc-k">Focus:</span> ` +
      (s.focus !== null ? `<span class="fc-name"><span class="star">★</span>${escapeHtml(this.hooks.short(s.focus))}</span>` : `<span class="muted">none</span>`) +
      (own ? `<span class="fc-own" title="Your own focus: the view's is ${escapeHtml(s.view !== null ? `★${this.hooks.short(s.view)}` : "none")}">·you</span>` : "") +
      `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;
    this.btn.classList.toggle("own", own);
    this.btn.title =
      s.focus !== null
        ? `The review is on ★${s.focus} here: the strip, k, and why a declaration is in its TCB. ${own ? "Your own focus; the view's stays as it is." : "The view's focus, everyone's."} Click to focus otherwise.`
        : "No focus: the review strip and k work where the view, or you, focus on a target. Click to choose one.";
    if (this.open) this.renderMenu();
  }

  private renderMenu(): void {
    const s = this.hooks.state();
    if (!s) return;
    const row = (t: string | null) => {
      const on = t === s.focus;
      const label = t === null ? "None" : `<span class="star">★</span>${escapeHtml(this.hooks.short(t))}`;
      // the view's own focus, and a target linked to it: its ★ says so as on its tab
      const note = t === s.view ? `<span class="muted fc-note">the view's</span>` : t !== null && s.linked.includes(t) ? `<span class="muted fc-note">linked</span>` : "";
      const tip = t === null ? "No focus for you here: the review strip and its keys stand aside" : `Focus on ★${t}, for you: the review walks its review set, what this board does not hold shown as visitors`;
      return `<button class="vm-row fc-row${on ? " on" : ""}" role="menuitemradio" aria-checked="${on}" data-focus="${t === null ? "" : escapeHtml(t)}" title="${escapeHtml(tip)}"><span class="fc-dot">${on ? "●" : "○"}</span><span class="vm-name">${label}</span>${note}</button>`;
    };
    let html = `<div class="vm-h">Focus <span class="muted">yours, as the camera is</span></div>` + focusChoices(s.view, s.linked, s.held).map(row).join("");
    if (s.mine !== undefined && s.focus !== s.view) html += `<button class="vm-act fc-back" data-back title="Take the view's focus again">Back to the view's focus</button>`;
    // making the reader's focus the view's own, for everyone on it
    if (s.focus !== s.view && this.hooks.canSet())
      html +=
        `<div class="vm-sep"></div><button class="vm-act fc-set" data-set title="The view's focus is everyone's: who opens this view starts with it">` +
        (s.focus !== null ? `Make ★${escapeHtml(this.hooks.short(s.focus))} the view's focus, for everyone` : "Make no focus the view's, for everyone") +
        `</button>`;
    if (this.error) html += `<div class="modal-err">${escapeHtml(this.error)}</div>`;
    this.menu.innerHTML = html;
  }

  private async clicked(e: MouseEvent): Promise<void> {
    const t = e.target as HTMLElement;
    const s = this.hooks.state();
    if (!s) return;
    const row = t.closest<HTMLElement>("[data-focus]");
    if (row) {
      const f = row.dataset.focus || null;
      // the view's own focus chosen is no choice of one's own: the reader follows the view's again
      this.hooks.choose(f === s.view ? undefined : f);
      this.toggle(false);
      return;
    }
    if (t.closest("[data-back]")) {
      this.hooks.choose(undefined);
      this.toggle(false);
      return;
    }
    if (t.closest("[data-set]")) {
      const why = await this.hooks.setView(s.focus);
      if (why) {
        this.error = why;
        this.renderMenu();
      } else this.toggle(false);
    }
  }
}
