// The menu a click on someone's initials opens (CollabSpec decisions 4 and 10, the owner's decision
// of 2026-10-12): following them, or no longer, and asking them to follow you. It works with the
// keyboard as the menu under the name does (web/src/whomenu.ts, menuKey) and closes on a press
// elsewhere, Esc or Tab. It is the reader's own, as the initials are (web/src/surfaces.ts): nothing
// done in it ends following but Stop following. An agent's initials open none: a click follows it, as
// before, since an agent cannot be asked to follow.

import { escapeHtml } from "./highlight.ts";
import { menuKey } from "./whomenu.ts";

/** A person, as the menu tells of them. */
export interface PeerShown {
  name: string;
  /** their name as HTML, with its mark where it is theirs (CollabSpec decision 9) */
  html: string;
  color: string;
  /** where they are, in words */
  where: string;
  following: boolean;
}

export interface PeerMenuHooks {
  /** the person of `key`, or null where they left */
  person(key: string): PeerShown | null;
  /** follow them, or stop following them */
  follow(key: string): void;
  /** ask them to follow this reader */
  ask(key: string): void;
  /** why this reader cannot ask now, or null */
  cannotAsk(): string | null;
}

export class PeerMenu {
  private el: HTMLElement;
  private wrap: HTMLElement;
  private hooks: PeerMenuHooks;
  private key: string | null = null;

  constructor(el: HTMLElement, wrap: HTMLElement, hooks: PeerMenuHooks) {
    this.el = el;
    this.wrap = wrap;
    this.hooks = hooks;
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
        this.close(move.back);
      }
    });
    // a press anywhere else closes it; on initials, their click opens theirs
    window.addEventListener(
      "pointerdown",
      (e) => {
        const t = e.target as Element;
        if (this.open && !el.contains(t) && !t.closest?.("#peers [data-person]")) this.close();
      },
      { capture: true },
    );
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Open the menu of the person of `key` under their initials `at`, or close it where it is theirs. */
  toggle(key: string, at: HTMLElement): void {
    if (this.open && this.key === key) return this.close();
    this.key = key;
    this.el.hidden = false;
    at.setAttribute("aria-expanded", "true");
    const w = this.wrap.getBoundingClientRect(), b = at.getBoundingClientRect();
    this.el.style.right = `${Math.max(0, w.right - b.right)}px`;
    this.render();
    this.items()[0]?.focus();
  }

  /** Close it; `back`: the focus goes back to the initials it was opened from (Esc). */
  close(back = false): void {
    if (!this.open) return;
    const key = this.key;
    this.el.hidden = true;
    this.key = null;
    const at = this.initials(key);
    at?.setAttribute("aria-expanded", "false");
    if (back) at?.focus();
  }

  /** Draw it again — the others moved, came or went — or close it where its person left. The item
   *  focused stays. */
  render(): void {
    if (!this.open || this.key === null) return;
    const p = this.hooks.person(this.key);
    if (!p) return this.close();
    const was = this.items().indexOf(document.activeElement as HTMLElement);
    const why = this.hooks.cannotAsk();
    const name = escapeHtml(p.name);
    this.el.innerHTML =
      `<div class="pm-who"><span class="pm-dot" style="background:${p.color}"></span><span class="pm-name">${p.html}</span>` +
      (p.where ? `<span class="pm-where">${escapeHtml(p.where)}</span>` : "") +
      `</div><div class="wm-sep" role="separator"></div>` +
      (p.following
        ? `<button type="button" role="menuitem" class="wm-item" data-act="follow"><span class="wm-t">Stop following ${name}</span><span class="wm-d">What you see stays, as your own.</span></button>`
        : `<button type="button" role="menuitem" class="wm-item" data-act="follow"><span class="wm-t">Follow ${name}</span><span class="wm-d">See what ${name} sees, as it changes; Esc stops.</span></button>`) +
      `<button type="button" role="menuitem" class="wm-item" data-act="ask"${why ? ' aria-disabled="true"' : ""}><span class="wm-t">Ask ${name} to follow me</span>` +
      `<span class="wm-d">${escapeHtml(why ?? `${p.name} is shown a request for 30 s: Follow or Not now.`)}</span></button>`;
    if (was >= 0) this.items()[was]?.focus();
  }

  private items(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  }

  private initials(key: string | null): HTMLElement | null {
    if (key === null) return null;
    return [...document.querySelectorAll<HTMLElement>("#peers [data-person]")].find((b) => b.dataset.person === key) ?? null;
  }

  private choose(b: HTMLElement | undefined): void {
    const key = this.key;
    if (!b || key === null) return;
    if (b.getAttribute("aria-disabled") === "true") return;
    this.close();
    if (b.dataset.act === "follow") this.hooks.follow(key);
    else if (b.dataset.act === "ask") this.hooks.ask(key);
  }
}
