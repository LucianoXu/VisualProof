// The menu under the reader's name at the top right (CollabSpec decision 8): the name, changed in its
// window as before (behind a sign-in, the sign-in's, which cannot be; for someone who came by a
// personal link, the link's, changed through the server: decision 9), asking everyone to follow this
// reader (decision 10, the owner's decision of 2026-10-12; web/src/askfollow.ts), and whether the
// others see this reader — Visible, the default, or Private. It opens on a click on the name and
// closes on a click elsewhere or Esc, and works with the keyboard as a menu does (menuKey): the
// arrows, Home and End move between its items, Enter or Space chooses one, Tab leaves it.

import { escapeHtml } from "./highlight.ts";
import { VERIFIED } from "./verified.ts";

export type Visibility = "visible" | "private";

/** How the reader's name is given: their page's own, the sign-in's in front of the server, their
 *  personal link's (CollabSpec decision 9), or none at all (a snapshot). */
export type NameMode = "declared" | "header" | "person" | "none";

/** Each choice of visibility, with what it means in a line. */
const CHOICES: { key: Visibility; title: string; line: string }[] = [
  { key: "visible", title: "Visible", line: "Others see you and where you look, and can follow you." },
  { key: "private", title: "Private", line: "Hidden; what you arrange shows as someone's. Opinions keep your name." },
];

/** What a key does in the menu, the focus on item `at` of `count` (-1: on none of them): the item to
 *  focus, the one focused chosen, or the menu closed — `back` puts the focus back on the name, as Esc
 *  does; Tab lets it go where Tab goes. Null: the key is not the menu's. */
export type MenuMove = { focus: number } | { choose: true } | { close: true; back: boolean } | null;

export function menuKey(key: string, at: number, count: number): MenuMove {
  if (key === "Escape") return { close: true, back: true };
  if (key === "Tab") return { close: true, back: false };
  if (count <= 0) return null;
  if (key === "ArrowDown") return { focus: at < 0 ? 0 : (at + 1) % count };
  if (key === "ArrowUp") return { focus: at < 0 ? count - 1 : (at - 1 + count) % count };
  if (key === "Home") return { focus: 0 };
  if (key === "End") return { focus: count - 1 };
  if ((key === "Enter" || key === " ") && at >= 0) return { choose: true };
  return null;
}

/** Which item a key on the name opens the menu at: the first (the down arrow), the last (the up
 *  arrow, -1), or null for a key that does not open it (Enter and Space click the name, which does). */
export function openKey(key: string): number | null {
  if (key === "ArrowDown") return 0;
  if (key === "ArrowUp") return -1;
  return null;
}

export interface WhoMenuHooks {
  /** how names are given here: the page's own, the sign-in's in front of the server, the personal
   *  link's, none */
  mode(): NameMode;
  name(): string | null;
  visibility(): Visibility;
  /** give or change the name, in its window */
  rename(): void;
  setVisibility(v: Visibility): void;
  /** ask everyone here to follow this reader (CollabSpec decision 10); absent where nobody can be */
  askAll?(): void;
  /** why this reader cannot ask now — private, asked a moment ago, nobody here — or null */
  askWhy?(): string | null;
}

/** What asking everyone does, in a line. */
const ASK_ALL = "Everyone here gets a request for 30 s.";

export class WhoMenu {
  private btn: HTMLElement;
  private el: HTMLElement;
  private hooks: WhoMenuHooks;

  constructor(btn: HTMLElement, el: HTMLElement, hooks: WhoMenuHooks) {
    this.btn = btn;
    this.el = el;
    this.hooks = hooks;
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", el.id);
    btn.addEventListener("click", () => this.toggle());
    btn.addEventListener("keydown", (e) => {
      const at = openKey(e.key);
      if (at === null) return;
      e.preventDefault();
      this.toggle(true, at);
    });
    el.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-act]");
      if (b) this.choose(b);
    });
    el.addEventListener("keydown", (e) => {
      const items = this.items();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const move = menuKey(e.key, at, items.length);
      if (!move) return;
      // the page's own keys (Esc clears the selection) are not pressed through the menu
      e.stopPropagation();
      if ("focus" in move) {
        e.preventDefault();
        items[move.focus].focus();
      } else if ("choose" in move) {
        e.preventDefault();
        this.choose(items[at]);
      } else {
        if (move.back) e.preventDefault();
        this.toggle(false);
        if (move.back) btn.focus();
      }
    });
    // a press anywhere else closes it
    window.addEventListener(
      "pointerdown",
      (e) => {
        const t = e.target as Node;
        if (this.open && !el.contains(t) && !btn.contains(t)) this.toggle(false);
      },
      { capture: true },
    );
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Open the menu, its item `focus` focused (-1: the last), or close it. */
  toggle(open = this.el.hidden, focus = 0): void {
    this.el.hidden = !open;
    this.btn.classList.toggle("on", open);
    this.btn.setAttribute("aria-expanded", String(open));
    if (!open) return;
    this.render();
    const items = this.items();
    items[focus < 0 ? items.length - 1 : Math.min(focus, items.length - 1)]?.focus();
  }

  /** Draw it again, while it is open: the name or the visibility changed. The item focused stays. */
  render(): void {
    if (!this.open) return;
    const h = this.hooks;
    const was = this.items().indexOf(document.activeElement as HTMLElement);
    const name = h.name();
    const vis = h.visibility();
    this.el.innerHTML =
      (h.mode() === "header"
        ? `<div class="wm-note">${name ? `Signed in as <b>${escapeHtml(name)}</b>` : "Not signed in"}: your name is the sign-in's, in front of this server.</div>`
        : `<button type="button" role="menuitem" class="wm-item" data-act="rename"><span class="wm-t">${name ? "Change name…" : "Set your name…"}</span>` +
          (h.mode() === "person" ? `<span class="wm-d">${VERIFIED} You came by a personal link: the name is yours, and what you did stays yours when you change it.</span>` : "") +
          `</button>`) +
      (h.askAll ? this.askItem(h.askWhy?.() ?? null) : "") +
      `<div class="wm-sep" role="separator"></div>` +
      `<div class="wm-h" id="wm-vis">Visibility</div>` +
      `<div role="group" aria-labelledby="wm-vis">` +
      CHOICES.map(
        (c) =>
          `<button type="button" role="menuitemradio" aria-checked="${c.key === vis}" class="wm-item wm-radio" data-act="vis" data-vis="${c.key}">` +
          `<span class="wm-t">${c.title}</span><span class="wm-d">${c.line}</span></button>`,
      ).join("") +
      `</div>`;
    if (was >= 0) this.items()[was]?.focus();
  }

  /** Ask everyone to follow me: greyed, with why, where this reader cannot now. */
  private askItem(why: string | null): string {
    return (
      `<button type="button" role="menuitem" class="wm-item" data-act="ask"${why ? ' aria-disabled="true"' : ""}>` +
      `<span class="wm-t">Ask everyone to follow me</span><span class="wm-d">${escapeHtml(why ?? ASK_ALL)}</span></button>`
    );
  }

  private items(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')];
  }

  /** An item chosen: the name's window, which takes the menu's place; or a visibility, which the
   *  menu stays open to show. */
  private choose(b: HTMLElement | undefined): void {
    if (!b) return;
    if (b.dataset.act === "rename") {
      this.toggle(false);
      this.hooks.rename();
      return;
    }
    if (b.dataset.act === "ask") {
      if (b.getAttribute("aria-disabled") === "true") return;
      this.toggle(false);
      this.hooks.askAll?.();
      return;
    }
    const v = b.dataset.vis as Visibility | undefined;
    if (v && v !== this.hooks.visibility()) this.hooks.setVisibility(v);
    this.render();
  }
}
