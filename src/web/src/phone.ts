// A phone (PhoneSpec): a page for reading, reviewing and following (decision 1). At most 640 px
// wide (style.css draws it), the page keeps what reading and reviewing need in reach of a thumb,
// and the rest one tap away:
//
// - the bar's buttons — Share, the library, Export, Activity, the conversations, the reader's name,
//   help — are in one menu, ⋯, each item pressing the button it stands for, so that everything they
//   do is as ever; the modes head it, each with a few words on what a tap selects, as its button
//   would; what is new under it (Activity's count, the conversations' and their mark) shows on ⋯;
// - the side panel (the targets, the board's clusters) is a drawer from ☰, which closes when the
//   reader goes somewhere from it;
// - the panel is a sheet from the bottom, the board above it, with a handle at its top:
//   a tap on it makes it the whole screen or half of it; the board is framed in the room above it;
// - Activity and the lost-and-found take the whole screen, and close when the reader goes somewhere
//   from them.
//
// On a touch screen nothing on the board is moved by a finger (web/src/canvas.ts): it is read.
//
// A tall screen (PhoneSpec, "Tall screens"): wider than a phone and upright, under a finger — a
// tablet held upright — or too narrow for a desktop's panels — a narrow window. It is a larger
// screen's page, its parts placed for the shape with the phone's own mechanisms: the side panel is
// the drawer from ☰, the panel the sheet from the bottom (a drag on its handle sets its height
// there, besides the tap), and Activity, the lost-and-found, Export's window and the floating
// windows take the sheet's place; the board's room is above them (`tallInsets`). A monitor on its
// side, with a mouse, is not one: it has a desktop's page, the board above a work area
// (web/src/monitor.ts).

import type { PageEl } from "./surfaces.ts";

export const PHONE = "(max-width: 640px)";
/** a tall screen: wider than a phone, at least 1.2 times as high as it is wide, and under a finger
 *  or narrower than a desktop's panels need (999 px) */
export const TALL = "(min-width: 641px) and (max-aspect-ratio: 5/6) and (pointer: coarse), (min-width: 641px) and (max-width: 999px) and (max-aspect-ratio: 5/6)";
/** the shapes whose panel is a sheet and whose side panel a drawer: a phone, a tall screen (the
 *  blocks of these queries in `web/style.css`) */
export const SHEETED = `${PHONE}, ${TALL}`;
/** an upright monitor, with a mouse: at least 1000 px wide and 1.2 times as high (PhoneSpec decision
 *  29; web/src/monitor.ts) */
export const MONITOR = "(min-width: 1000px) and (max-aspect-ratio: 5/6) and (pointer: fine)";

const matches = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;

export function isPhone(): boolean {
  return matches(PHONE);
}

export function isTall(): boolean {
  return matches(TALL);
}

/** An upright monitor's page: the board above a work area (web/src/monitor.ts). */
export function isMonitor(): boolean {
  return matches(MONITOR);
}

/** The panel is a sheet and the side panel a drawer: a phone, or a tall screen. */
export function sheeted(): boolean {
  return matches(SHEETED);
}

/** The shape a screen of `w` × `h` px is under a `pointer` (the primary one's, as `pointer:` asks):
 *  what PHONE, TALL and MONITOR decide, for a size (the queries' own arithmetic, tested without a
 *  browser). A screen with no pointer at all, upright and wide enough, has a larger screen's page. */
export function shapeOf(w: number, h: number, pointer: "fine" | "coarse" | "none" = "fine"): "phone" | "tall" | "monitor" | "wide" {
  if (w <= 640) return "phone";
  if (w * 6 > h * 5) return "wide";
  if (pointer === "coarse" || w <= 999) return "tall";
  return pointer === "fine" ? "monitor" : "wide";
}

/** Whether a press at `t` in the drawer goes somewhere from it, which closes it (decisions 9 and 19):
 *  a target's row, a cluster's name or the rest of its row, a name that goes to a declaration. An
 *  arrow opening or folding a level, a section's heading, a row's own buttons (fold, trust) and ⚙
 *  Board or Trusted, which take its place, leave it open. */
export function goesFromDrawer(t: PageEl | null): boolean {
  const up = (sel: string) => {
    for (let e = t; e; e = e.parentElement) if (e.matches(sel)) return true;
    return false;
  };
  if (up(".tw, [data-sec]")) return false;
  // a target's row and a cluster's name are buttons that go somewhere
  if (up(".tg-row, .o-label, [data-go], [data-open]")) return true;
  return !up("button") && up(".o-row");
}

export interface PhoneHooks {
  /** close the panel (its ✕) */
  closePanel(): void;
  /** the panel's sheet changed height: the board's room changed */
  resized(): void;
  /** what a tap selects in a mode, in a few words */
  modeHint(mode: string): string;
}

/** The ⋯ menu's items, in the bar's order (decision 7): the button each stands for, and its label.
 *  The conversation button is among them (the owner's decision of 2026-10-19): beside the people's
 *  initials it left the build status and the project's name a few pixels of the bar. */
export const ITEMS: readonly { id: string; label: string }[] = [
  { id: "share-btn", label: "Share" },
  { id: "library-btn", label: "Library" },
  { id: "export-btn", label: "Export" },
  { id: "activity-btn", label: "Activity" },
  { id: "talk-btn", label: "Conversations" },
  { id: "who", label: "" },
  { id: "help-btn", label: "Help" },
];

/** What a badge says (`"7"`, `"99+"`, `null` while it is hidden), as a number. */
const counted = (text: string | null): number => (text ? (text.endsWith("+") ? 100 : Number(text) || 0) : 0);

/** What ⋯ carries of what is new under it (decision 7): Activity's count and the conversations'
 *  together, as one count (`null`: nothing new), and the conversations' mark, where the reader was
 *  mentioned or an agent of theirs answered. */
export function moreMark(activity: string | null, talk: string | null, mentioned: boolean): { count: string | null; at: boolean } {
  const n = counted(activity) + counted(talk);
  return { count: n === 0 ? null : n > 99 ? "99+" : String(n), at: mentioned };
}

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
/** On a tall screen: the sheet opens at half the screen and goes no lower than a third of it; at its
 *  tallest it stops under the view bar (TALL_TOP_PX from the top), and under the review strip and the
 *  selection bar where they are (style.css, --sheet-most). */
const TALL_MID = 0.5;
const TALL_LEAST = 0.33;
const TALL_TOP_PX = 120;
/** the page's margin, at the sheet's sides and foot on a tall screen */
const EDGE_PX = 12;

/** Where the sheets are on a tall screen: the panel, or Activity or the lost-and-found in its place;
 *  then the floating windows docked there (style.css), and Export's window. */
const SHEETS = ["panel", "activity", "lostfound"];
const DOCKED = "#windows > :is(.sw-win, .pw-win, #convo):not(.collapsed, [hidden])";

/** A tall screen's board room, in px from the screen's edges (web/src/main.ts, the canvas's insets):
 *  the whole width; under the view bar, the review strip and the selection bar; above the sheet or the
 *  windows docked in its place, or above the legend's line where nothing is there. `--room-bottom`
 *  tells the legend, the zoom's box and what sits low on the board where that is. */
export function tallInsets(): { left: number; right: number; top: number; bottom: number } {
  const $ = (id: string) => document.getElementById(id);
  const bar = $("selbar")!;
  // the note of a kept view sits under the review strip where both show
  const strip = [$("tm-kept"), $("lensbar")].find((e) => e && !e.hidden);
  const under = !bar.hidden ? bar.getBoundingClientRect().bottom : strip ? strip.getBoundingClientRect().bottom : $("viewbar")!.getBoundingClientRect().bottom;
  // the sheet or the dock: offsetHeight, not the bounding box, as either may still be sliding in
  let low = 0;
  for (const id of SHEETS) {
    const el = $(id);
    if (el?.classList.contains("open")) low = Math.max(low, el.offsetHeight);
  }
  if (document.querySelector(DOCKED)) low = Math.max(low, $("windows")!.offsetHeight);
  const room = low ? low + EDGE_PX + 8 : EDGE_PX;
  document.body.style.setProperty("--room-bottom", `${room}px`);
  // the sheet at its tallest leaves the board no room: the legend and the zoom's box wait under it
  document.body.style.setProperty("--room-shown", innerHeight - room - under < 200 ? "hidden" : "visible");
  return { left: 0, right: 0, top: under + 12, bottom: room + 36 };
}

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
    // Activity's count of what is new shows on ⋯ too, and the conversations' with it, their mark
    // where the reader was mentioned as the conversation button has it (bottom right)
    const shown = (id: string) => {
      const el = document.getElementById(id);
      return el && !el.hidden ? (el.textContent ?? "") : null;
    };
    const more = document.getElementById("more-badge");
    const moreAt = document.getElementById("more-at");
    const mark = () => {
      const m = moreMark(shown("activity-badge"), shown("talk-badge"), shown("talk-at") !== null);
      if (more) {
        more.textContent = m.count ?? "";
        more.hidden = m.count === null;
      }
      if (moreAt) moreAt.hidden = !m.at;
    };
    const marks = new MutationObserver(mark);
    for (const id of ["activity-badge", "talk-badge", "talk-at"]) {
      const el = document.getElementById(id);
      if (el) marks.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    }
    mark();

    // the drawer
    document.getElementById("side-btn")!.addEventListener("click", () => this.drawer(!document.body.classList.contains("side-open")));
    // going somewhere from it closes it: a target, a cluster's name; an arrow opens or folds a level
    // of the tree and the drawer stays, as it does for what is pressed on a row's buttons
    document.getElementById("side")!.addEventListener("click", (e) => {
      if (!sheeted()) return;
      if (goesFromDrawer(e.target as HTMLElement)) setTimeout(() => this.drawer(false), 120);
    });

    // the sheets: the panel's on a phone; on a tall screen Activity and the lost-and-found too, which
    // take its place, at its height
    for (const id of SHEETS) {
      const el = document.getElementById(id);
      if (el) this.bindSheet(el);
    }
    // the floating windows docked in the sheet's place: the dock's handle, its own band over them
    const dock = document.getElementById("windows");
    if (dock) this.bindSheet(dock, 14, true);
    // turning the screen, or a window resized across a line (PhoneSpec decisions 2 and 17): the
    // drawer closes where there is none, the sheet keeps its share of the screen, and the board's
    // room follows
    const changed = () => {
      if (!sheeted()) this.drawer(false);
      this.sizeSheet();
      this.hooks.resized();
    };
    if (typeof matchMedia === "function") for (const q of [PHONE, TALL]) matchMedia(q).addEventListener("change", changed);
    addEventListener("resize", () => this.sizeSheet());
    this.sizeSheet();
    // a floating window docked in the sheet's place, or no longer: the board's room follows
    const windows = document.getElementById("windows");
    if (windows)
      new MutationObserver((ms) => {
        // a window come or gone, collapsed or opened, hidden or shown: the dock's own children only
        if (isTall() && ms.some((m) => (m.type === "childList" ? m.target === windows : m.target.parentNode === windows))) this.hooks.resized();
      }).observe(windows, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });

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
    const label = (id: string, fallback: string) => (id === "who" ? `Your name: ${document.getElementById("who")!.textContent?.trim() || "set it"}` : fallback);
    const icon = (id: string) => OWN_ICON[id] ?? document.getElementById(id)?.querySelector("svg")?.outerHTML ?? `<svg viewBox="0 0 16 16"></svg>`;
    /** a badge of the button's, shown on its item too: its count, the conversations' mark */
    const shown = (badge: string, cls: string) => {
      const b = document.getElementById(badge);
      return b && !b.hidden ? `<span class="${cls}">${b.textContent}</span>` : "";
    };
    const badges: Record<string, () => string> = {
      "activity-btn": () => shown("activity-badge", "act-badge"),
      "talk-btn": () => shown("talk-badge", "act-badge") + shown("talk-at", "talk-at"),
    };
    this.pop.innerHTML = this.modes() + ITEMS.map(({ id, label: l }) => {
      // a button the page does not offer is no item: the reader's name before the page knows it,
      // the conversations for a read-only reader and in a snapshot
      if (document.getElementById(id)?.hidden) return "";
      return `<button class="more-item" role="menuitem" data-for="${id}">${icon(id)}<span>${label(id, l)}</span>${badges[id]?.() ?? ""}</button>`;
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

  /** The sheet's height as a share of the screen's, while the page is open: on a phone the middle
   *  or the top (decision 10), on a tall screen what the reader set (decision 20). */
  private share: { phone: number; tall: number } = { phone: SHEET_MID, tall: TALL_MID };

  /** The sheet's height, in px, for the screen as it is now (`--sheet-h`: the panel, Activity, the
   *  lost-and-found and the windows docked in their place read it). */
  private sizeSheet(): void {
    const tall = isTall();
    const h = tall ? Math.min(innerHeight * this.share.tall, innerHeight - TALL_TOP_PX - EDGE_PX) : innerHeight * this.share.phone;
    document.documentElement.style.setProperty("--sheet-h", `${Math.round(h)}px`);
  }

  /** A sheet: a tap on its handle, at its top, makes it the tallest or half of the screen (PhoneSpec
   *  decision 10: on a phone a tap, not a drag); on a tall screen a drag on the handle sets its
   *  height too (decision 20). ✕ closes it. */
  private bindSheet(sheet: HTMLElement, grip = GRIP_PX, own = false): void {
    let press: { id: number; y: number; h: number; dragged: boolean } | null = null;
    // a drag goes on over the board, out of the sheet: followed on the window while it lasts
    const move = (e: PointerEvent) => {
      const p = press;
      if (!p || p.id !== e.pointerId) return;
      if (!p.dragged && Math.abs(e.clientY - p.y) <= 10) return;
      p.dragged = true;
      sheet.classList.add("sizing");
      const h = Math.max(innerHeight * TALL_LEAST, Math.min(p.h + p.y - e.clientY, innerHeight - TALL_TOP_PX - EDGE_PX));
      this.share.tall = h / innerHeight;
      this.sizeSheet();
    };
    const end = (e: PointerEvent) => {
      const p = press;
      if (!p || p.id !== e.pointerId) return;
      press = null;
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      sheet.classList.remove("sizing");
      if (e.type === "pointercancel") return;
      if (p.dragged) return void this.hooks.resized();
      if (Math.abs(e.clientY - p.y) > 10) return;
      if (isTall()) {
        const top = (innerHeight - TALL_TOP_PX - EDGE_PX) / innerHeight;
        this.share.tall = this.share.tall > (TALL_MID + top) / 2 ? TALL_MID : top;
      } else {
        const full = sheet.getBoundingClientRect().height > innerHeight * ((SHEET_MID + SHEET_TOP) / 2);
        this.share.phone = full ? SHEET_MID : SHEET_TOP;
      }
      this.sizeSheet();
      // the board's room follows once the sheet has settled
      setTimeout(() => this.hooks.resized(), 240);
    };
    sheet.addEventListener("pointerdown", (e) => {
      if (!sheeted() || e.button !== 0 || press) return;
      // what is pressed in the handle's band, a button there, is that button's; the dock's handle is
      // its band alone, not the windows in it
      if ((e.target as Element).closest("button, a, input, textarea, select") || (own && e.target !== sheet)) return;
      if (own && !isTall()) return;
      const r = sheet.getBoundingClientRect();
      if (e.clientY - r.top > grip) return;
      press = { id: e.pointerId, y: e.clientY, h: r.height, dragged: false };
      if (isTall()) addEventListener("pointermove", move);
      addEventListener("pointerup", end);
      addEventListener("pointercancel", end);
    });
  }
}
