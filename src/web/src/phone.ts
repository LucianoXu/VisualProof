// A phone (SPEC.md, "Deployment": small touch devices, a page focused on reading and reviewing). At
// most 640 px wide (style.css draws it), the page keeps what reading and reviewing need in reach of
// a thumb, and the rest one tap away:
//
// - the bar's buttons — Share, the library, Export, Activity, the reader's name, help — are in one
//   menu, ⋯, each item pressing the button it stands for, so that everything they do is as ever;
//   the modes head it, each with a few words on what a tap selects, as its button would;
// - the side panel (the targets, the board's clusters) is a drawer from ☰, which closes when the
//   reader goes somewhere from it;
// - the panel is a sheet from the bottom, the board above it, with a handle at its top:
//   a tap on it makes it the whole screen or half of it; the board is framed in the room above it;
// - Activity and the lost-and-found take the whole screen, and close when the reader goes somewhere
//   from them.
//
// On a touch screen nothing on the board is moved by a finger (web/src/canvas.ts): it is read.

export const PHONE = "(max-width: 640px)";

export function isPhone(): boolean {
  return typeof matchMedia === "function" && matchMedia(PHONE).matches;
}

export interface PhoneHooks {
  /** close the panel (its ✕) */
  closePanel(): void;
  /** the panel's sheet changed height: the board's room changed */
  resized(): void;
  /** what a tap selects in a mode, in a few words */
  modeHint(mode: string): string;
}

/** The ⋯ menu's items: the button each stands for, and its label. */
const ITEMS: readonly { id: string; label: string }[] = [
  { id: "share-btn", label: "Share" },
  { id: "library-btn", label: "Library" },
  { id: "export-btn", label: "Export" },
  { id: "activity-btn", label: "Activity" },
  { id: "who", label: "" },
  { id: "help-btn", label: "Help" },
];

/** The icons of the items whose buttons have none drawn the same way: the name, help. */
const OWN_ICON: Record<string, string> = {
  who: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.6c.8-2.7 2.7-3.9 5-3.9s4.2 1.2 5 3.9"/></svg>`,
  "help-btn": `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.5"/><path d="M8 11.6v.1"/></svg>`,
};

/** The side panel's popovers, which take the drawer's place on a phone, and what opens each. */
const SIDE_POPS: readonly { pop: string; opener: string; title: string }[] = [
  { pop: "board-pop", opener: "board-btn", title: "The board" },
  { pop: "trust-list", opener: "trusted-btn", title: "Trusted" },
];

/** The sheet's heights, as shares of the screen's: the middle it opens at, and the top. */
const SHEET_MID = 0.55;
const SHEET_TOP = 0.92;
/** the handle: the top of the sheet a tap switches it on */
const GRIP_PX = 34;

export class Phone {
  private hooks: PhoneHooks;
  private pop: HTMLElement;
  private btn: HTMLElement;

  constructor(hooks: PhoneHooks) {
    this.hooks = hooks;
    this.btn = document.getElementById("more-btn")!;
    this.pop = document.getElementById("more-pop")!;
    this.btn.addEventListener("click", () => (this.pop.hidden ? this.open() : this.close()));
    this.pop.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-for], [data-mode-for]");
      if (!item) return;
      this.close();
      // the button it stands for, pressed after this click is done (its popover's outside-click
      // would close it otherwise)
      const button = item.dataset.for ? document.getElementById(item.dataset.for) : document.querySelector<HTMLElement>(`#lightup [data-mode="${item.dataset.modeFor}"]`);
      setTimeout(() => button?.click(), 0);
    });
    document.addEventListener("pointerdown", (e) => {
      const t = e.target as Node;
      if (!this.pop.hidden && !this.pop.contains(t) && !this.btn.contains(t)) this.close();
      // a press outside the drawer, and outside what takes its place (⚙ Board, Trusted), closes it
      const side = document.getElementById("side");
      const inPop = t instanceof Element && !!t.closest(".side-pop, #trust-pop");
      if (document.body.classList.contains("side-open") && side && !side.contains(t) && !inPop && !document.getElementById("side-btn")!.contains(t)) this.drawer(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!this.pop.hidden) this.close();
      if (document.body.classList.contains("side-open")) this.drawer(false);
    });
    // Activity's count of what is new shows on ⋯ too
    const badge = document.getElementById("activity-badge");
    const more = document.getElementById("more-badge");
    if (badge && more)
      new MutationObserver(() => {
        more.textContent = badge.textContent;
        more.hidden = badge.hidden;
      }).observe(badge, { attributes: true, childList: true, characterData: true, subtree: true });

    // the drawer
    document.getElementById("side-btn")!.addEventListener("click", () => this.drawer(!document.body.classList.contains("side-open")));
    // going somewhere from it closes it: a target, a cluster's name; an arrow opens or folds a level
    // of the tree and the drawer stays, as it does for what is pressed on a row's buttons
    document.getElementById("side")!.addEventListener("click", (e) => {
      if (!isPhone()) return;
      const t = e.target as HTMLElement;
      if (t.closest(".tw, button, [data-sec]")) return;
      if (t.closest(".tg-row, .o-row, [data-go], [data-open]")) setTimeout(() => this.drawer(false), 120);
    });

    this.bindSheet(document.getElementById("panel")!);

    // Activity and the lost-and-found cover the board: what is gone to from them (a declaration, a
    // view, a note, a reference) shows with them closed
    for (const [id, close] of [["activity", "[data-act-close]"], ["lostfound", "[data-lf-close]"]]) {
      const el = document.getElementById(id);
      el?.addEventListener("click", (e) => {
        if (isPhone() && (e.target as HTMLElement).closest(".act-ref, .act-note-go")) setTimeout(() => el.querySelector<HTMLElement>(close)?.click(), 0);
      });
    }

    // ⚙ Board and Trusted take the drawer's place, with a way back to it: a row at their top,
    // put back whenever what they show is drawn again
    for (const { pop, opener, title } of SIDE_POPS) {
      const el = document.getElementById(pop);
      if (!el) continue;
      const back = () => {
        if (el.querySelector(":scope > .side-back")) return;
        const b = document.createElement("button");
        b.className = "side-back";
        b.type = "button";
        b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>${title}`;
        b.addEventListener("click", () => document.getElementById(opener)?.click());
        el.prepend(b);
      };
      new MutationObserver(() => !el.hidden && back()).observe(el, { attributes: true, attributeFilter: ["hidden"], childList: true });
      back();
    }
  }

  private open(): void {
    const label = (id: string, fallback: string) => {
      if (id !== "who") return fallback;
      const who = document.getElementById("who")!;
      return who.hidden ? "" : `Your name: ${who.textContent?.trim() || "set it"}`;
    };
    const icon = (id: string) => OWN_ICON[id] ?? document.getElementById(id)?.querySelector("svg")?.outerHTML ?? `<svg viewBox="0 0 16 16"></svg>`;
    this.pop.innerHTML = this.modes() + ITEMS.map(({ id, label: l }) => {
      const text = label(id, l);
      if (!text) return "";
      const badge = id === "activity-btn" ? document.getElementById("activity-badge") : null;
      return `<button class="more-item" role="menuitem" data-for="${id}">${icon(id)}<span>${text}</span>${badge && !badge.hidden ? `<span class="act-badge">${badge.textContent}</span>` : ""}</button>`;
    }).join("");
    this.pop.hidden = false;
    this.btn.setAttribute("aria-expanded", "true");
  }

  /** The modes, as their buttons have them (web/src/main.ts): Selection, Rests on's three steps
   *  under its name, Used by; the one in use ticked. */
  private modes(): string {
    let rows = `<div class="more-h">Mode · what a tap selects</div>`;
    for (const b of document.querySelectorAll<HTMLElement>("#lightup [data-mode]")) {
      const mode = b.dataset.mode!;
      const step = !!b.closest("#rests-steps");
      if (step && !b.previousElementSibling) rows += `<div class="more-sub">${document.getElementById("rests-btn")?.textContent ?? ""}</div>`;
      const on = b.classList.contains("on");
      rows +=
        `<button class="more-item more-mode${step ? " step" : ""}${on ? " on" : ""}" role="menuitemradio" aria-checked="${on}" data-mode-for="${mode}">` +
        `<span class="more-tick" aria-hidden="true">${on ? "✓" : ""}</span><span class="more-l">${b.textContent}<small>${this.hooks.modeHint(mode)}</small></span></button>`;
    }
    return rows + `<div class="more-sep" role="separator"></div>`;
  }

  private close(): void {
    this.pop.hidden = true;
    this.btn.setAttribute("aria-expanded", "false");
  }

  /** Open or close the side panel's drawer. */
  drawer(on: boolean): void {
    document.body.classList.toggle("side-open", on);
    document.getElementById("side-btn")!.setAttribute("aria-expanded", String(on));
  }

  /** The panel's sheet: a tap on its handle, at its top, makes it the whole screen or half of it
   *  (the owner's choice of 2026-10-14: a tap, not a drag); ✕ closes it. */
  private bindSheet(panel: HTMLElement): void {
    let press: { id: number; y: number } | null = null;
    panel.addEventListener("pointerdown", (e) => {
      if (!isPhone() || e.button !== 0) return;
      const r = panel.getBoundingClientRect();
      press = e.clientY - r.top <= GRIP_PX ? { id: e.pointerId, y: e.clientY } : null;
    });
    panel.addEventListener("pointerup", (e) => {
      const p = press;
      press = null;
      if (!p || p.id !== e.pointerId || Math.abs(e.clientY - p.y) > 10) return;
      const full = panel.getBoundingClientRect().height > innerHeight * ((SHEET_MID + SHEET_TOP) / 2);
      panel.style.setProperty("--sheet-h", `${Math.round(innerHeight * (full ? SHEET_MID : SHEET_TOP))}px`);
      // the board's room follows once the sheet has settled
      setTimeout(() => this.hooks.resized(), 240);
    });
    panel.addEventListener("pointercancel", () => (press = null));
  }
}
