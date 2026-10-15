// The canvas's menu (ViewSpec, "The canvas's menu", decided 2026-10-09): the page takes over the
// right click on the canvas, and the ContextMenu key or Shift+F10 opens the same menu on what is
// selected. What it offers depends on what it was opened on — a declaration, a cluster, the empty
// canvas, a note — and on what the reader may do there: what they cannot do is left out, not
// greyed.
//
// `menuItems` says what the menu holds, as a pure function, so that it is tested without a page;
// `ContextMenu` draws it, keeps it inside the window, and is driven by the pointer or the keys.
// What each item does is web/src/main.ts's.

import { escapeHtml } from "./highlight.ts";

/** A prefix to trust from the menu, and whether it is trusted now (then the item stops trusting
 *  it). */
export interface TrustTo {
  prefix: string;
  on: boolean;
}

/** What the menu was opened on. */
export type MenuTarget =
  | {
      kind: "decl";
      name: string;
      /** outside the project */
      ext: boolean;
      /** where the review has a focus: whether it is marked key for that target; null where that
       *  review does not hold it, or it is the target */
      key: boolean | null;
      /** it is a target */
      target: boolean;
      /** its namespace, where trusting it can be done from here: null outside the project, without
       *  a namespace, or under a broader prefix trusted already */
      ns: TrustTo | null;
      /** a visitor (ViewSpec decision 27): the board does not hold it; Add to this view makes it a
       *  member, and there is nothing to remove */
      visitor?: boolean;
      /** in the artwork mode with its names by selection (ExportSpec decision 19): whether its name
       *  is shown in the picture; absent elsewhere */
      art?: boolean;
    }
  | {
      kind: "cluster";
      key: string;
      folded: boolean;
      /** clustered by file: a folder, not a namespace */
      folder: boolean;
      /** what trusting it is, as for a declaration's namespace */
      trust: TrustTo | null;
      /** as a declaration's: its name shown in the artwork, or not; absent outside it */
      art?: boolean;
    }
  | { kind: "canvas" }
  /** a note on the board: `open`, its own state; `view`, a view's own note (shared/sticky.ts), else
   *  the project's (shared/projectnotes.ts); `carries`, what it carries, each in a few words; `attach`,
   *  whether a file can be attached to it here (not in a snapshot, which has no library); `items`,
   *  for a note of the project, the views it can be added to (as a declaration's Add to view lists
   *  them, `holds` where one shows it already) and whether it can be taken out of this one — not on
   *  the Project, which holds every note (the owner's decision of 2026-10-11) */
  | { kind: "note"; open: boolean; view: boolean; carries?: string[]; attach?: boolean; items?: { views: MenuContext["views"]; remove: boolean } };

/** Where the menu is opened, and what the reader may do there. */
export interface MenuContext {
  /** the board's scope stays as it is: the Project's, which a copy leaves things out of instead
   *  (ViewSpec decision 22) */
  fixed: boolean;
  /** the review's focus, where it has one (ViewSpec decision 28): its target, as the item names it */
  review: string | null;
  /** the views whose scope can be added to (this one left out), kept ones first, then those open
   *  now and not kept yet (`temporary`), which adding to keeps; each with whether it holds
   *  what the menu is on already */
  views: { id: string; title: string; holds: boolean; temporary?: boolean }[];
  /** the board on show, where its scope can be added to: a visitor is added there (ViewSpec
   *  decision 27); null on the Project, whose scope stays */
  here?: string | null;
  /** the views can be changed from here: a name can be had for it, or a snapshot keeps them */
  arrange: boolean;
  /** the review can be changed from here: a name can be had, not a snapshot, the log not blocked */
  write: boolean;
  /** pinned source windows are not offered (a phone: a source takes the whole screen) */
  noPin?: boolean;
  /** the board is of a past graph (HistorySpec decision 17): the review is given on the latest
   *  build, which the menu says where its items would be (the owner's decision of 2026-10-10); its
   *  source is that build's (decision 23) */
  past?: boolean;
  /** the board is a preview of its view at another build than its own (web/src/views.ts): no level
   *  is hidden on it, as nothing arranges it */
  preview?: boolean;
}

/** What stands where the review's items would be on a board of a past build. */
const PAST_REVIEW: MenuItem = { act: "past-review", label: "The review is given on the latest build", disabled: true };

/** One line of the menu. `act` says what main.ts does with it. */
export interface MenuItem {
  act: string;
  label: string;
  /** the key that does the same, shown beside it */
  key?: string;
  /** a word about it, shown beside it where a key would be: a view not kept yet */
  note?: string;
  /** a line above it */
  sep?: boolean;
  /** what it opens beside it */
  sub?: MenuItem[];
  /** shown, not chosen: a view that holds it already */
  disabled?: boolean;
  /** it asks for a name first, offering this one */
  ask?: string;
}

const short = (name: string) => name.split(".").pop() ?? name;

/** The views of an "Add to view ▸", each an item that does `act` with its id: the kept views, then
 *  those open now and not kept yet, which adding to keeps (ViewSpec decision 21); one that holds it
 *  already marked ✓, not to be chosen. */
function viewsTo(views: MenuContext["views"], act: string): MenuItem[] {
  return views.map((v, k) => ({
    act: `${act}:${v.id}`,
    label: v.holds ? `${v.title} ✓` : v.title,
    ...(v.holds ? { disabled: true } : {}),
    ...(v.temporary ? { note: "temporary", ...(k > 0 && !views[k - 1].temporary ? { sep: true } : {}) } : {}),
  }));
}

/** "Add to view ▸": every view it can be added to, then a new one. */
function addTo(ctx: MenuContext, start: string): MenuItem {
  const sub = viewsTo(ctx.views, "add");
  sub.push({ act: "add-new", label: "New view…", sep: sub.length > 0, ask: start });
  return { act: "add", label: "Add to view", sub };
}

/** "Remove from this view", or on a board whose scope is fixed, a copy of it without the thing. */
function removeFrom(ctx: MenuContext, title: string, what: string): MenuItem {
  return ctx.fixed ? { act: "remove-new", label: "New view without it…", sep: true, ask: `${title.slice(0, 50)} without ${what.slice(0, 24)}` } : { act: "remove", label: "Remove from this view", sep: true };
}

/** What the menu holds when opened on `t`; `title` is the board's, for the name of a copy. */
export function menuItems(t: MenuTarget, ctx: MenuContext, title = "View"): MenuItem[] {
  const out: MenuItem[] = [];
  /** a note at the spot the menu was opened on, last, as what is added there: the project's, shown on
   *  the Project and the views it belongs to, or this view's own (AttachmentSpec decisions 13–17) */
  const note: MenuItem[] = ctx.arrange ? [{ act: "note", label: "Add a note here", sep: true }, { act: "note-view", label: "Add a note for this view" }] : [];
  if (t.kind === "note") {
    if (!ctx.arrange) return [];
    // what it carries (AttachmentSpec decision 12): a file of the library or a clip of one attached,
    // and each it carries taken off by itself
    const carries = t.carries ?? [];
    const attach: MenuItem[] = t.attach ? [{ act: "note-attach", label: "Attach…", sep: true }] : [];
    if (carries.length) attach.push({ act: "note-detach", label: "Detach", ...(attach.length ? {} : { sep: true }), sub: carries.map((label, k) => ({ act: `detach:${k}`, label })) });
    // a note of the project is an item, which belongs to views as a declaration does: added to
    // another view, or taken out of this one (on the Project, which holds every one, it is deleted)
    const items: MenuItem[] = [];
    if (t.items?.views.length) items.push({ act: "item-add", label: "Add to view", sep: true, sub: viewsTo(t.items.views, "item") });
    if (t.items?.remove) items.push({ act: "item-remove", label: "Remove from this view", ...(items.length ? {} : { sep: true }) });
    return [
      { act: "note-edit", label: "Edit", key: "double-click" },
      { act: "note-toggle", label: t.open ? "Collapse" : "Expand", key: "click" },
      ...attach,
      // the other kind, keeping its text, its author, what it carries and where it is on this board
      { act: "note-kind", label: t.view ? "In every view" : "Only in this view", sep: true },
      ...items,
      { act: "note-delete", label: "Delete…", sep: true },
    ];
  }
  const trustItem = (to: TrustTo | null, label: string): MenuItem[] => (ctx.write && to ? [{ act: "trust", label: to.on ? `Stop trusting ${label}` : `Trust ${label}` }] : []);
  // in the artwork mode with its names by selection, first: its name shown in the picture, or hidden
  // (ExportSpec decision 19, the owner's decision of 2026-10-15)
  if ((t.kind === "decl" || t.kind === "cluster") && t.art !== undefined) out.push({ act: "art-name", label: t.art ? "Hide its name in the artwork" : "Show its name in the artwork" });
  const first = out.length;
  if (t.kind === "decl") {
    out.push({ act: "source", label: "Open source" }, ...(ctx.noPin ? [] : [{ act: "pin", label: "Open in a pinned window" }]));
    out.push({ act: "tcb", label: "Select its TCB", sep: true }, { act: "deps", label: "Select what it uses" }, { act: "apps", label: "Select what uses it" }, { act: "copy", label: "Copy full name" });
    // a visitor is no member: it is added to this view, or another, and not removed (decision 27)
    if (ctx.arrange && t.visitor) out.push(...(ctx.here ? [{ act: `add:${ctx.here}`, label: "Add to this view", sep: true }] : []), addTo(ctx, short(t.name)));
    else if (ctx.arrange) out.push(removeFrom(ctx, title, short(t.name)), addTo(ctx, short(t.name)));
    const review: MenuItem[] = [];
    if (ctx.write && ctx.review && t.key !== null) review.push({ act: "key", label: `${t.key ? "Unmark" : "Mark"} as key for ★${short(ctx.review)}`, key: "k" });
    if (ctx.write && !t.ext) review.push({ act: "target", label: t.target ? "Unmark as target" : "Mark as target" }, { act: "approve", label: "Approve…", key: "a" }, { act: "comment", label: "Comment…", key: "m" });
    review.push(...trustItem(t.ns, "its namespace"));
    if (ctx.past && !t.ext) review.push({ ...PAST_REVIEW });
    if (review.length) review[0].sep = true;
    out.push(...review, ...note);
  } else if (t.kind === "cluster") {
    out.push({ act: "fold", label: t.folded ? "Unfold" : "Fold", key: "double-click" });
    // hiding a level changes the view, which needs *arrange*: a reader who cannot sees no item (decision 21)
    if (ctx.arrange && !ctx.preview) out.push({ act: "hide", label: "Hide this level" });
    if (ctx.arrange) out.push(removeFrom(ctx, title, short(t.key)), addTo(ctx, short(t.key)));
    const trust = trustItem(t.trust, t.folder ? "this folder" : "this namespace");
    if (ctx.past && t.trust) trust.push({ ...PAST_REVIEW });
    if (trust.length) trust[0].sep = true;
    out.push(...trust, ...note);
  } else {
    if (ctx.arrange) out.push({ act: "note", label: "Add a note here" }, { act: "note-view", label: "Add a note for this view" });
    out.push({ act: "fit", label: "Fit to screen", key: "f", sep: ctx.arrange });
    if (ctx.arrange) out.push({ act: "relayout", label: "Re-layout…" });
  }
  if (first && out[first]) out[first].sep = true;
  return out;
}

export interface MenuHooks {
  /** an item was chosen (`act`), with the name given where it asked for one */
  chose(act: string, name?: string): void;
  /** the menu closed, chosen or not */
  closed(): void;
}

/** The menu on the page: one at a time, a submenu beside it, kept inside the window. The pointer
 *  or the keys drive it (arrows, Enter, Esc; → opens a submenu, ← goes back); a press elsewhere
 *  closes it, as Esc does, without doing anything. */
export class ContextMenu {
  private el: HTMLElement;
  private hooks: MenuHooks;
  private items: MenuItem[] = [];
  private subEl: HTMLElement | null = null;
  /** where it was opened, for the item that asks a name in its place */
  private at = { x: 0, y: 0 };

  constructor(el: HTMLElement, hooks: MenuHooks) {
    this.el = el;
    this.hooks = hooks;
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-k]");
      if (b && !b.disabled) this.choose(b);
      if ((e.target as HTMLElement).closest("[data-cm-cancel]")) this.close();
    });
    el.addEventListener("pointerover", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-k]");
      if (!b) return;
      // resting on a line that opens beside it opens it; on another line of the same menu, the one
      // open goes
      const sub = this.itemOf(b)?.sub;
      if (sub) this.openSub(b);
      else if (!this.subEl?.contains(b)) this.closeSub();
      b.focus({ preventScroll: true });
    });
    el.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const name = f.querySelector<HTMLInputElement>("input")!.value.trim();
      if (name) this.done(f.dataset.act!, name);
    });
    // a press anywhere else closes it; on the canvas that is all it does (a click there would
    // select, or select nothing), elsewhere the press does what it does there too
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.open || el.contains(e.target as Node)) return;
        this.close();
        const t = e.target as Element | null;
        if (e.button === 0 && t?.closest?.("#canvas, #cards")) e.stopPropagation();
      },
      true,
    );
    // the keys are the menu's while it is open: none reaches the page's shortcuts
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.open) return;
        e.stopImmediatePropagation();
        this.key(e);
      },
      true,
    );
    window.addEventListener("blur", () => this.close());
    window.addEventListener("resize", () => this.close());
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Open at a point of the window with `items`, under a heading; `keys`: opened from the
   *  keyboard, the first item takes the focus. */
  show(items: MenuItem[], x: number, y: number, heading: string, keys = false): void {
    this.items = items;
    this.at = { x, y };
    this.closeSub();
    this.el.innerHTML = `<div class="cm-h">${escapeHtml(heading)}</div>` + this.list(items, "");
    this.el.hidden = false;
    this.place(this.el, x, y);
    const first = this.el.querySelector<HTMLElement>("button[data-k]");
    if (keys && first) first.focus();
    else this.el.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.open) return;
    this.closeSub();
    this.el.hidden = true;
    this.el.innerHTML = "";
    this.hooks.closed();
  }

  private list(items: MenuItem[], path: string): string {
    return items
      .map(
        (it, k) =>
          (it.sep ? `<div class="cm-sep" role="separator"></div>` : "") +
          `<button type="button" class="cm-item" role="menuitem" data-k="${path}${k}"${it.disabled ? " disabled" : ""}${it.sub ? ` aria-haspopup="menu"` : ""}>` +
          `<span class="cm-l">${escapeHtml(it.label)}</span>` +
          (it.sub
            ? `<span class="cm-more" aria-hidden="true">▸</span>`
            : it.key
              ? `<span class="cm-key">${escapeHtml(it.key)}</span>`
              : it.note
                ? `<span class="cm-note">${escapeHtml(it.note)}</span>`
                : "") +
          `</button>`,
      )
      .join("");
  }

  private itemOf(b: HTMLElement): MenuItem | undefined {
    const path = b.dataset.k!.split(".").map(Number);
    let it: MenuItem | undefined = this.items[path[0]];
    for (const k of path.slice(1)) it = it?.sub?.[k];
    return it;
  }

  private choose(b: HTMLButtonElement): void {
    const it = this.itemOf(b);
    if (!it) return;
    if (it.sub) return this.openSub(b, true);
    if (it.ask !== undefined) return this.ask(it);
    this.done(it.act);
  }

  private done(act: string, name?: string): void {
    // the menu's place is read by what the item does (a question beside it): it closes after
    this.hooks.chose(act, name);
    this.close();
  }

  /** In the menu's place, the name for what the item makes, offered, with Create and Cancel. */
  private ask(it: MenuItem): void {
    this.closeSub();
    this.el.innerHTML =
      `<form class="cm-ask" data-act="${escapeHtml(it.act)}"><div class="cm-h">${escapeHtml(it.label.replace(/…$/, ""))}</div>` +
      `<input class="vm-input" maxlength="80" value="${escapeHtml(it.ask ?? "")}" aria-label="The new view's name" spellcheck="false">` +
      `<div class="vm-actions"><button type="button" class="rv-btn" data-cm-cancel>Cancel</button><button type="submit" class="rv-btn primary">Create</button></div></form>`;
    this.place(this.el, this.at.x, this.at.y);
    const input = this.el.querySelector<HTMLInputElement>("input")!;
    input.focus();
    input.select();
  }

  private openSub(b: HTMLButtonElement, focus = false): void {
    const it = this.itemOf(b);
    if (!it?.sub) return;
    if (this.subEl && this.subEl.dataset.of === b.dataset.k) {
      if (focus) this.subEl.querySelector<HTMLElement>("button[data-k]:not(:disabled)")?.focus();
      return;
    }
    this.closeSub();
    const sub = document.createElement("div");
    sub.className = "cm-sub glass";
    sub.setAttribute("role", "menu");
    sub.dataset.of = b.dataset.k;
    sub.innerHTML = this.list(it.sub, `${b.dataset.k}.`);
    this.el.append(sub);
    this.subEl = sub;
    b.setAttribute("aria-expanded", "true");
    // beside its line, on the right where there is room, else on the left; inside the window
    const r = b.getBoundingClientRect();
    const w = sub.offsetWidth, h = sub.offsetHeight;
    const x = r.right + 2 + w <= innerWidth - 8 ? r.right + 2 : Math.max(8, r.left - 2 - w);
    const y = Math.max(8, Math.min(r.top - 5, innerHeight - h - 8));
    const box = this.el.getBoundingClientRect();
    sub.style.left = `${Math.round(x - box.left)}px`;
    sub.style.top = `${Math.round(y - box.top)}px`;
    if (focus) sub.querySelector<HTMLElement>("button[data-k]:not(:disabled)")?.focus();
  }

  private closeSub(): void {
    if (!this.subEl) return;
    this.el.querySelector(`button[data-k="${this.subEl.dataset.of}"]`)?.setAttribute("aria-expanded", "false");
    this.subEl.remove();
    this.subEl = null;
  }

  /** Put the menu at (x, y), inside the window: moved left or up by what would stick out. */
  private place(el: HTMLElement, x: number, y: number): void {
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.round(Math.max(8, Math.min(x, innerWidth - w - 8)))}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(y, innerHeight - h - 8)))}px`;
  }

  private key(e: KeyboardEvent): void {
    const inField = (e.target as HTMLElement).tagName === "INPUT";
    if (e.key === "Escape") {
      e.preventDefault();
      // out of a submenu first, then the menu
      if (this.subEl && this.subEl.contains(document.activeElement)) {
        const of = this.subEl.dataset.of!;
        this.closeSub();
        this.el.querySelector<HTMLElement>(`button[data-k="${of}"]`)?.focus();
      } else this.close();
      return;
    }
    if (inField) return;
    const here = document.activeElement as HTMLElement | null;
    const inSub = !!this.subEl && !!here && this.subEl.contains(here);
    const scope = inSub ? this.subEl! : this.el;
    const buttons = [...scope.querySelectorAll<HTMLButtonElement>(":scope > button[data-k]:not(:disabled)")];
    const at = here ? buttons.indexOf(here as HTMLButtonElement) : -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (!buttons.length) return;
      const next =
        e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : at < 0 ? (e.key === "ArrowDown" ? 0 : buttons.length - 1) : (at + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
      buttons[next].focus();
      if (!inSub) this.closeSub();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (!inSub && at >= 0 && this.itemOf(buttons[at])?.sub) this.openSub(buttons[at], true);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (inSub) {
        const of = this.subEl!.dataset.of!;
        this.closeSub();
        this.el.querySelector<HTMLElement>(`button[data-k="${of}"]`)?.focus();
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (at >= 0) this.choose(buttons[at]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      this.close();
    }
  }
}
