// The menu a click on someone's initials opens (CollabSpec decisions 4 and 10, the owner's decision
// of 2026-10-12): following them, or no longer, and asking them to follow you. An agent's menu
// (decision 13, the owner's decisions of 2026-10-19) follows it, or talks with it: one of the
// reader's own agents in its private channel, anyone else's in Everyone, by mentioning it; an agent
// cannot be asked to follow. It works with the keyboard as the menu under the name does
// (web/src/whomenu.ts, menuKey) and closes on a press elsewhere, Esc or Tab. It is the reader's own,
// as the initials are (web/src/surfaces.ts): nothing done in it ends following but Stop following.

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
  /** an agent: whether it can be talked to, and how — `own`, in its private channel with the
   *  reader, its maker; `public`, mentioned in Everyone; null, an agent without a token of its own,
   *  which takes no part — and its state in words */
  agent?: { talk: "own" | "public" | null; state: string | null };
}

export interface PeerMenuHooks {
  /** the person of `key`, or null where they left */
  person(key: string): PeerShown | null;
  /** follow them, or stop following them */
  follow(key: string): void;
  /** ask them to follow this reader */
  ask(key: string): void;
  /** talk with an agent: the conversation window on its channel */
  talk(key: string): void;
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
        : `<button type="button" role="menuitem" class="wm-item" data-act="follow"><span class="wm-t">Follow ${name}</span><span class="wm-d">See what ${name} ${p.agent ? "looks at" : "sees"}, as it changes; Esc stops.</span></button>`) +
      (p.agent
        ? p.agent.talk === "own"
          ? `<button type="button" role="menuitem" class="wm-item" data-act="talk"><span class="wm-t">Talk with ${name}</span><span class="wm-d">In your private channel with it: nobody else sees it.${p.agent.state ? ` ${escapeHtml(p.agent.state)}.` : ""}</span></button>`
          : p.agent.talk === "public"
            ? `<button type="button" role="menuitem" class="wm-item" data-act="talk"><span class="wm-t">Talk with ${name} in Everyone</span><span class="wm-d">Mention it: everyone sees it, and ${name} is handed it.</span></button>`
            : ""
        : `<button type="button" role="menuitem" class="wm-item" data-act="ask"${why ? ' aria-disabled="true"' : ""}><span class="wm-t">Ask ${name} to follow me</span>` +
          `<span class="wm-d">${escapeHtml(why ?? `${p.name} gets a request for 30 s.`)}</span></button>`);
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
    else if (b.dataset.act === "talk") this.hooks.talk(key);
  }
}
