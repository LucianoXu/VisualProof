// The tabs at the top (ViewSpec decision 8): the views this reader has open, kept in this browser,
// and the views menu — a new view, a copy of this one, its name, deleting it (after asking), linking
// a target to it, and the views on the server in one list (the owner's decision of 2026-10-11): the
// Project, the views targets are linked to, the other kept views, then those open now that nobody
// keeps, in italics as their tabs are. The tabs are the reader's; the views are everyone's. A view
// targets are linked to (ViewSpec decision 29) has a small yellow star by its name, on its tab and in
// the menu, which names them under the pointer; a view kept at a past build (HistorySpec decision 19)
// has a clock. The targets themselves, with how far each review has come, are the side panel's
// (web/src/targetlist.ts).

import { PROJECT } from "../../shared/views.ts";
import type { ViewSummary } from "../../shared/views.ts";
import { escapeHtml } from "./highlight.ts";
import type { Tab } from "./store.ts";

export interface TabsHooks {
  tabs(): Tab[];
  /** the view on show */
  active(): string | null;
  title(id: string): string;
  /** what the page says of a view under the pointer: its name, its scope in full and its query
   *  (web/src/views.ts, `tip`) */
  tip?(id: string): string;
  /** a view as the list tells it; undefined for one not (yet) known */
  summary(id: string): ViewSummary | undefined;
  /** every view on the server, the Project first, then the targets' views, then the rest by age */
  list(): ViewSummary[];
  /** go to a tab, or open a view in one */
  select(id: string): void;
  close(id: string): void;
  /** the menu's actions on the view on show (or a new one); each resolves to why it was refused */
  create(name: string): Promise<string | null>;
  duplicate(name: string): Promise<string | null>;
  rename(name: string): Promise<string | null>;
  remove(): Promise<string | null>;
  /** a snapshot: views are the page's own, nothing is asked of a server */
  readOnly(): boolean;
  /** why this page makes, renames and deletes no view (a read-only page, CollabSpec decision 11):
   *  the menu offers none of it; null where it does */
  frozen?(): string | null;
  /** a build of the history in words ("Oct 8, 14:15 · f9a0ca2"), for a view kept at it */
  build?(snapshot: number): string | null;
  /** a target as the page names it: its name's last part, with as many parents as tell it apart */
  short?(target: string): string;
  /** the target the menu offers to link to the view on show (the reader's focus, where its view is
   *  another), and why that is refused where it is; null where it offers none */
  linkable?(): { target: string; why: string | null } | null;
  /** link a target to the view on show, for everyone; resolves to why it was refused, or null */
  link?(target: string): Promise<string | null>;
}

/** Targets as a sentence names them: "★A", "★A and ★B", "★A, ★B and ★C". */
export function starred(targets: readonly string[], short: (t: string) => string): string {
  const s = targets.map((t) => `★${short(t)}`);
  return s.length < 2 ? s.join("") : `${s.slice(0, -1).join(", ")} and ${s.at(-1)}`;
}

/** What a view's star says under the pointer (ViewSpec decision 29): whose view it is, and that a
 *  click on any of its targets opens it. */
export function linkTip(targets: readonly string[], short: (t: string) => string): string {
  const who = starred(targets, short);
  return targets.length === 1 ? `${who}'s view: clicking ${who} opens it` : `The view of ${who}: clicking any of them opens it`;
}

/** A view's label: a view targets are linked to has a small star by its title (ViewSpec decision 29),
 *  naming them under the pointer — "★ TCB of T" for a target's temporary view (the owner's decision
 *  of 2026-10-12). */
export function tabLabel(title: string, targets: readonly string[] | undefined, short: (t: string) => string = (t) => t.split(".").pop() ?? t): string {
  if (!targets?.length) return escapeHtml(title);
  return `<span class="star link-star" title="${escapeHtml(linkTip(targets, short))}">★</span>` + escapeHtml(title);
}

const CLOCK = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/></svg>`;

/** A line of a tooltip, as a sentence begins. */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The menu asking for the view's new name, and why the last one was refused. */
type Asking = { error?: string } | null;

export class Tabs {
  private el: HTMLElement;
  private btn: HTMLElement;
  private menu: HTMLElement;
  private hooks: TabsHooks;
  private asking: Asking = null;

  constructor(el: HTMLElement, btn: HTMLElement, menu: HTMLElement, hooks: TabsHooks) {
    this.el = el;
    this.btn = btn;
    this.menu = menu;
    this.hooks = hooks;
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>("[data-tab]");
      if (!tab) return;
      if (t.closest("[data-close]")) this.hooks.close(tab.dataset.tab!);
      else this.hooks.select(tab.dataset.tab!);
    });
    // a middle click closes a tab, as in a browser
    el.addEventListener("auxclick", (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
      if (tab && e.button === 1 && tab.dataset.tab !== PROJECT) this.hooks.close(tab.dataset.tab!);
    });
    btn.addEventListener("click", () => this.toggle());
    menu.addEventListener("click", (e) => void this.clicked(e));
    menu.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.named();
    });
    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (this.asking) {
          this.asking = null;
          this.renderMenu();
        } else this.toggle(false);
      }
    });
    // a click elsewhere closes the menu
    window.addEventListener("pointerdown", (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node) && !this.btn.contains(e.target as Node)) this.toggle(false);
    }, { capture: true });
  }

  get open(): boolean {
    return !this.menu.hidden;
  }

  render(): void {
    const active = this.hooks.active();
    this.el.innerHTML = this.hooks
      .tabs()
      .map((t) => {
        const s = this.hooks.summary(t.id);
        // a view nobody keeps reads as passing: it goes when the last page closes it
        const loose = !!t.q && !s?.kept;
        const kept = s?.version !== undefined ? this.kept(s.version) : "";
        const linked = s?.targets ? `\n${linkTip(s.targets, (x) => this.short(x))}` : "";
        const tip = `${this.hooks.tip?.(t.id) ?? `${this.hooks.title(t.id)}${s ? ` — ${s.scope}` : t.q ? ` — ${t.q}` : ""}`}${linked}${loose ? "\nNot kept: it goes when everyone has closed it; pin, fold or name it to keep it" : ""}${kept ? `\n${cap(kept)}` : ""}`;
        return (
          `<button class="tab${t.id === active ? " on" : ""}${loose ? " loose" : ""}" role="tab" aria-selected="${t.id === active}" data-tab="${escapeHtml(t.id)}" title="${escapeHtml(tip)}">` +
          (kept ? `<span class="tab-clock" aria-label="${escapeHtml(kept)}">${CLOCK}</span>` : "") +
          `<span class="tab-t">${tabLabel(this.hooks.title(t.id), s?.targets, (x) => this.short(x))}</span>` +
          (t.id === PROJECT ? "" : `<span class="tab-x" data-close title="Close this tab">×</span>`) +
          `</button>`
        );
      })
      .join("");
    // the tab on show stays in sight
    this.el.querySelector<HTMLElement>(".tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (this.open) this.renderMenu();
  }

  private short(target: string): string {
    return this.hooks.short?.(target) ?? target.split(".").pop() ?? target;
  }

  /** What a view kept at a past build says of it. */
  private kept(snapshot: number): string {
    return `kept at the build of ${this.hooks.build?.(snapshot) ?? `snapshot ${snapshot}`}`;
  }

  toggle(open = this.menu.hidden): void {
    this.menu.hidden = !open;
    this.btn.classList.toggle("on", open);
    this.asking = null;
    if (open) this.renderMenu();
  }

  /** Ask for this view's new name in the menu. */
  askName(): void {
    this.toggle(true);
    this.asking = {};
    this.renderMenu();
  }

  private renderMenu(): void {
    const active = this.hooks.active();
    const cur = active ? this.hooks.summary(active) : undefined;
    // the Project keeps its name and is always there (ViewSpec decision 5); a target's view is deleted
    // as any kept view (the owner's decision of 2026-10-11)
    const named = !cur || cur.id === PROJECT;
    const fixed = named;
    const ro = this.hooks.readOnly();
    let html = "";
    if (this.asking) {
      const a = this.asking;
      html +=
        `<form class="vm-ask"><label class="vm-l" for="vm-name">Name of this view</label>` +
        `<input id="vm-name" class="vm-input" maxlength="80" value="${escapeHtml(cur?.name ?? "")}" spellcheck="false" autocomplete="off">` +
        (a.error ? `<div class="modal-err">${escapeHtml(a.error)}</div>` : "") +
        `<div class="vm-actions"><button type="button" class="rv-btn" data-cancel>Cancel</button><button type="submit" class="rv-btn primary">Rename</button></div></form>`;
    } else if (this.hooks.frozen?.()) {
      const why = escapeHtml(this.hooks.frozen!()!);
      html += `<div class="vm-acts">${["New view", "Duplicate", "Rename…", "Delete…"].map((a) => `<button class="vm-act" disabled title="${why}">${a}</button>`).join("")}</div>`;
    } else {
      html +=
        `<div class="vm-acts">` +
        `<button class="vm-act" data-act="create" title="A new board, of everything, to arrange; rename it when you like">New view</button>` +
        `<button class="vm-act" data-act="duplicate" title="A board of your own, with this one's scope, pins and folds; rename it when you like">Duplicate</button>` +
        `<button class="vm-act" data-act="rename"${named ? ` disabled title="The Project keeps its name"` : ` title="Name this view: it is kept for everyone"`}>Rename…</button>` +
        `<button class="vm-act bad" data-act="remove"${fixed || !cur?.kept ? ` disabled title="${fixed ? "The Project cannot be deleted" : "This view is not kept: it goes when everyone has closed it"}"` : ` title="${cur?.targets ? `Delete this view for everyone: ${escapeHtml(starred(cur.targets, (x) => this.short(x)))} then ${cur.targets.length === 1 ? "has" : "have"} no view` : "Delete this view for everyone"}"`}>Delete…</button>` +
        `</div>`;
      // the reader's focus linked to this view, for everyone (ViewSpec decision 29)
      const l = ro ? null : this.hooks.linkable?.();
      if (l) {
        const t = escapeHtml(this.short(l.target));
        html += l.why
          ? `<button class="vm-act vm-link" disabled title="${escapeHtml(l.why)}">Link <span class="star">★</span>${t} to this view</button>`
          : `<button class="vm-act vm-link" data-act="link" data-target="${escapeHtml(l.target)}" title="${escapeHtml(`Make this view ★${this.short(l.target)}'s too, for everyone: clicking ★${this.short(l.target)} opens it. The view it is linked to now keeps its scope and arrangement.`)}">Link <span class="star">★</span>${t} to this view</button>`;
      }
    }
    // one list (the owner's decision of 2026-10-11): the Project, the kept views — the targets'
    // first, as the server lists them — then the views open now that nobody keeps, set apart
    const all = this.hooks.list();
    const kept = all.filter((v) => v.kept);
    const loose = all.filter((v) => !v.kept);
    const row = (v: ViewSummary) => {
      const on = v.id === active ? " on" : "";
      const at = v.version !== undefined ? this.kept(v.version) : "";
      const tip = [this.hooks.tip?.(v.id) ?? v.scope, v.targets ? linkTip(v.targets, (x) => this.short(x)) : "", v.kept ? "" : "Not kept: it goes when everyone has closed it; pin, fold or name it to keep it", at ? cap(at) : ""].filter((x) => x).join("\n");
      return (
        `<button class="vm-row${on}${v.kept ? "" : " loose"}" data-open="${escapeHtml(v.id)}" title="${escapeHtml(tip)}">` +
        `<span class="vm-name">${at ? `<span class="tab-clock">${CLOCK}</span>` : ""}${tabLabel(this.hooks.title(v.id), v.targets, (x) => this.short(x))}</span>` +
        `<span class="vm-scope">${escapeHtml(v.scope)}${v.by && v.id !== PROJECT ? ` · ${escapeHtml(v.by)}` : ""}</span></button>`
      );
    };
    html +=
      `<div class="vm-h">Views</div>` +
      kept.map(row).join("") +
      (loose.length ? `<div class="vm-sep"></div>` + loose.map(row).join("") : "") +
      (this.hooks.frozen?.() ? `<div class="vm-note muted">This page is read-only: it makes no views.</div>` : ro ? `<div class="vm-note muted">A snapshot: views made here stay in this page.</div>` : "");
    this.menu.innerHTML = html;
    if (this.asking) {
      const f = this.menu.querySelector<HTMLInputElement>("#vm-name")!;
      f.focus();
      f.select();
    }
  }

  private async clicked(e: MouseEvent): Promise<void> {
    const t = e.target as HTMLElement;
    if (t.closest("[data-cancel]")) {
      this.asking = null;
      return this.renderMenu();
    }
    const open = t.closest<HTMLElement>("[data-open]");
    if (open) {
      this.toggle(false);
      return this.hooks.select(open.dataset.open!);
    }
    const act = t.closest<HTMLButtonElement>("[data-act]");
    if (!act || act.disabled) return;
    const what = act.dataset.act!;
    if (what === "link") {
      const why = (await this.hooks.link?.(act.dataset.target!)) ?? null;
      if (why) alert(why);
      else this.toggle(false);
      return;
    }
    if (what === "remove") {
      const id = this.hooks.active();
      const targets = id ? this.hooks.summary(id)?.targets : undefined;
      // a view deleted leaves the targets linked to it with no view (the owner's decisions of
      // 2026-10-11): a click on one then gives it a temporary view of its TCB
      const unlinks = targets
        ? ` ${starred(targets, (x) => this.short(x))} ${targets.length === 1 ? "is" : "are"} linked to it and will have no view: a click on ${targets.length === 1 ? "it" : "one"} then opens a temporary view of its TCB.`
        : "";
      if (!id || !confirm(`Delete the view "${this.hooks.title(id)}" for everyone? Its pins and folds go with it; its scope can be opened again.${unlinks}`)) return;
      const why = await this.hooks.remove();
      if (why) alert(why);
      else this.toggle(false);
      return;
    }
    if (what === "create" || what === "duplicate") {
      // made at once, under a name of its own; Rename gives it another
      const taken = new Set(this.hooks.list().map((v) => this.hooks.title(v.id)));
      const active = this.hooks.active();
      const name = unused(what === "create" ? "New view" : `${(active ? this.hooks.title(active) : "View").slice(0, 60)} (copy)`, taken);
      const why = await (what === "create" ? this.hooks.create(name) : this.hooks.duplicate(name));
      if (why) alert(why);
      else this.toggle(false);
      return;
    }
    this.asking = {};
    this.renderMenu();
  }

  private async named(): Promise<void> {
    if (!this.asking) return;
    const name = this.menu.querySelector<HTMLInputElement>("#vm-name")!.value.trim();
    const why = await this.hooks.rename(name);
    if (why) {
      this.asking = { error: why };
      this.renderMenu();
    } else this.toggle(false);
  }
}

/** `base`, or else `base 2`, `base 3`, …: the first name no view has. */
function unused(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let k = 2; ; k++) if (!taken.has(`${base} ${k}`)) return `${base} ${k}`;
}
