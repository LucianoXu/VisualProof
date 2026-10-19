// The lost-and-found (HistorySpec decisions 12–14), in a drawer on the right as Activity is, opened
// from the build-status popover (web/src/buildpop.ts). It lists, for everyone on the server, what
// was said and marked of declarations the graph no longer has — under the name each was said of,
// with who said it and when — and every migration, the server's renames and those made by hand.
// Nothing in it is deleted:
//
// - **Lost**: by name, the newest build that had it (Show in history opens the Time Machine there,
//   on it), the renames of medium confidence suggested for it first, each with Attach, then Attach
//   to… (a declaration picked with the page's search, confirmed here) and the entries, each of which
//   can be archived. Attaching is a move (HistorySpec decision 9): the entries leave the list once
//   the review and the views carry them, and the migration it makes is listed with its Undo.
// - **Migrations**: from → to, why (the server's rename) or who (by hand), when, what it carried,
//   Undo; an undone one says by whom, and stays.
// - **Archived**: what was archived, with who did it, each put back with Put back.
//
// The server computes the list (server/lostfound.ts) and tells every page when it changed (`lost`),
// with how many entries it holds, which the popover's button shows; the drawer reads it again then.

import { carriedText } from "../../shared/lostfound.ts";
import type { LostAnswer, LostEntry, LostGroup, LostMigration } from "../../shared/lostfound.ts";
import { BOT } from "./agentmark.ts";
import { stamp } from "./buildpop.ts";
import type { LostApi, LostReply } from "./data.ts";
import { escapeHtml } from "./highlight.ts";
import { nameHtml } from "./verified.ts";

export interface LostHooks {
  /** whether a declaration of that name is in the graph, and going there */
  has(name: string): boolean;
  go(name: string): void;
  /** whether a view of that id is there now, and opening it */
  hasView(id: string): boolean;
  openView(id: string): void;
  /** whether view `view` holds note `id` now, and showing it there */
  hasNote(view: string, id: string): boolean;
  showNote(view: string, id: string): void;
  /** a comment on declaration `name`, as the review shows it (web/src/reviewbox.ts) */
  comment(text: string, name: string): string;
  /** a declaration picked with the page's search, for Attach to…; null when the reader gave up */
  pick(prompt: string): Promise<string | null>;
  /** the Time Machine, at a build, on a declaration (web/src/main.ts, `timeMachine`) */
  timeMachine(at?: { snapshot?: number; name?: string }): void;
  /** the reader's name, asked for where there is none: null where they declined */
  ensureName(): Promise<string | null>;
  /** the server took no name from this page: it is asked for again next time */
  nameLost(): void;
  /** the drawer opened or closed: the canvas makes room */
  toggled(open: boolean): void;
  /** what the list holds changed: the popover's count, Activity's migrations */
  changed(): void;
}

/** How many entries the server says the list holds: all, and the lost things among them. */
export interface LostCount {
  rev: number;
  count: number;
  lost: number;
}

const short = (name: string) => name.split(".").pop() ?? name;
/** at most this many suggestions under a name */
const SUGGESTIONS = 3;

export class LostAndFound {
  private el: HTMLElement;
  private api: LostApi | null;
  private hooks: LostHooks;
  open = false;
  /** the list as last read */
  data: LostAnswer | null = null;
  /** what the server last said of it */
  counts: LostCount | null = null;
  /** the revision the list was last asked for at */
  private asked = -1;
  /** a declaration picked for a name, waiting for Attach to be confirmed */
  private confirm: { from: string; to: string } | null = null;
  /** why the last action on a name or an entry was refused, by that name or key */
  private errors = new Map<string, string>();
  /** a request running, by the name or key it is about: its buttons wait */
  private busy = new Set<string>();
  /** an entry to bring into view and flash once drawn: its key, or `name:` and a name */
  private flash: string | null = null;
  /** the Archived section opened by the reader */
  private archivedOpen = false;

  constructor(el: HTMLElement, api: LostApi | null, hooks: LostHooks) {
    this.el = el;
    this.api = api;
    this.hooks = hooks;
    el.addEventListener("click", (e) => this.clicked(e));
    el.addEventListener("toggle", (e) => {
      const d = e.target as HTMLElement;
      if (d.matches?.("details.lf-archived")) this.archivedOpen = (d as HTMLDetailsElement).open;
    }, true);
  }

  /** What the server said (`lost`): how many entries the list holds, and its revision. A new one is
   *  read at once, open or not: Activity lists the migrations. */
  news(c: LostCount): void {
    this.counts = c;
    this.hooks.changed();
    if (c.rev !== this.asked) void this.load(c.rev);
  }

  /** Read the list again: whether it was read (and drawn, where the drawer is open). */
  async load(rev = this.asked): Promise<boolean> {
    if (!this.api) return false;
    this.asked = rev;
    const d = await this.api.list();
    if (!d || rev !== this.asked) return false;
    this.data = d;
    this.counts = { rev: this.counts?.rev ?? rev, count: d.count, lost: d.count - d.migrations.length };
    if (this.open) this.render();
    this.hooks.changed();
    return true;
  }

  toggle(open = !this.open): void {
    if (open === this.open) return;
    this.open = open;
    this.el.classList.toggle("open", open);
    if (open) {
      this.render();
      void this.load();
    } else {
      this.confirm = null;
      this.flash = null;
    }
    this.hooks.toggled(open);
  }

  /** Open on an entry or a migration, by its key (Activity leads here): brought into view and lit a
   *  moment, in Archived where it is archived. */
  show(key: string): void {
    this.flash = key;
    if (this.data?.archived.some((x) => x.key === key)) this.archivedOpen = true;
    if (this.open) this.render();
    else this.toggle(true);
  }

  /** The migrations, the archived ones too, oldest first: what Activity lists. */
  migrations(): (LostMigration & { key: string })[] {
    if (!this.data) return [];
    const all = [...this.data.migrations, ...this.data.archived.flatMap((x) => (x.migration ? [{ ...x.migration, key: x.key }] : []))];
    return all.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  // ---------------------------------------------------------------- actions

  private async act(on: string, run: () => Promise<LostReply>, done?: (r: LostReply) => void): Promise<void> {
    if (this.busy.has(on)) return;
    if (!(await this.hooks.ensureName())) {
      this.errors.set(on, "This is recorded under your name: give one first.");
      return this.render();
    }
    this.busy.add(on);
    this.errors.delete(on);
    this.render();
    const r = await run();
    this.busy.delete(on);
    if (r.error) {
      if (r.who) this.hooks.nameLost();
      this.errors.set(on, r.error);
    } else done?.(r);
    if (!(await this.load())) this.render();
  }

  private attach(from: string, to: string): void {
    void this.act(from, () => this.api!.move(from, to), (r) => {
      this.confirm = null;
      if (r.migration) this.flash = `move:${r.migration.id}`;
      else if (r.changed === false) this.errors.set(from, `Nothing was said of ${from} to attach.`);
    });
  }

  private async pickFor(name: string): Promise<void> {
    const to = await this.hooks.pick(`Attach what was said of ${short(name)} to…`);
    if (!to) return;
    if (!this.open) this.toggle(true);
    this.confirm = { from: name, to };
    this.flash = `name:${name}`;
    this.render();
  }

  private clicked(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const d = this.data;
    if (t.closest("[data-lf-close]")) return this.toggle(false);
    const at = (attr: string) => t.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr) ?? null;
    const group = (): LostGroup | null => {
      const i = at("data-lf-g");
      return i === null || !d ? null : d.lost[Number(i)] ?? null;
    };
    if (t.closest("[data-lf-history]")) {
      const g = group();
      if (g?.last) this.hooks.timeMachine({ snapshot: g.last.snapshot, name: g.name });
      return;
    }
    if (t.closest("[data-lf-pick]")) {
      const g = group();
      if (g) void this.pickFor(g.name);
      return;
    }
    const s = at("data-lf-sugg");
    if (s !== null) {
      const g = group();
      const to = g?.suggestions[Number(s)]?.to;
      if (g && to) this.attach(g.name, to);
      return;
    }
    if (t.closest("[data-lf-confirm]")) {
      if (this.confirm) this.attach(this.confirm.from, this.confirm.to);
      return;
    }
    if (t.closest("[data-lf-cancel]")) {
      this.confirm = null;
      return this.render();
    }
    if (t.closest("[data-lf-archive-all]")) {
      const g = group();
      if (g) void this.act(g.name, () => this.api!.archive(g.entries.map((x) => x.key), true));
      return;
    }
    const ek = at("data-lf-e");
    if (ek !== null && t.closest("[data-lf-archive]")) {
      const g = group();
      const entry = g?.entries[Number(ek)];
      if (entry) void this.act(entry.key, () => this.api!.archive([entry.key], true));
      return;
    }
    const mi = at("data-lf-m");
    if (mi !== null && d) {
      const m = d.migrations[Number(mi)];
      if (m && t.closest("[data-lf-undo]")) return void this.act(m.key, () => this.api!.unmove(m.id));
      if (m && t.closest("[data-lf-archive]")) return void this.act(m.key, () => this.api!.archive([m.key], true));
    }
    const ai = at("data-lf-a");
    if (ai !== null && d && t.closest("[data-lf-putback]")) {
      const x = d.archived[Number(ai)];
      if (x) void this.act(x.key, () => this.api!.archive([x.key], false), () => (this.flash = x.key));
      return;
    }
    const go = at("data-go");
    if (go !== null) return this.hooks.go(go);
    const view = at("data-view");
    const note = at("data-note");
    if (view !== null && note !== null) return this.hooks.showNote(view, note);
    if (view !== null) return this.hooks.openView(view);
  }

  // ---------------------------------------------------------------- drawing

  private who(by: string | null, agent?: true, person?: string): string {
    if (!by) return "someone";
    return agent ? `<span class="act-agent">${BOT}<b>${escapeHtml(by)}</b> <span class="muted">(agent)</span></span>` : `<b>${nameHtml(by, person)}</b>`;
  }

  /** A declaration's name: a link where the graph has it, else its last part, the full name under
   *  the pointer. */
  private decl(name: string): string {
    return this.hooks.has(name)
      ? `<button class="act-ref mono" data-go="${escapeHtml(name)}" title="${escapeHtml(name)}">${escapeHtml(short(name))}</button>`
      : `<span class="act-gone mono" title="${escapeHtml(name)}: not in the graph now">${escapeHtml(short(name))}</span>`;
  }

  private viewRef(id: string, title: string): string {
    return this.hooks.hasView(id)
      ? `<button class="act-ref" data-view="${escapeHtml(id)}" title="Open this view">${escapeHtml(title)}</button>`
      : `<span class="act-gone">${escapeHtml(title)}</span>`;
  }

  /** One entry: what it is, who said it, when; an opinion's comment, a note's text. */
  entryHtml(e: LostEntry): string {
    const when = `<span class="lf-when">${escapeHtml(stamp(e.at))}</span>`;
    const by = this.who(e.by, e.agent, e.person);
    switch (e.kind) {
      case "opinion": {
        const verb =
          e.verdict === "approve"
            ? e.agent ? `suggested <span class="ok">approving</span>` : `<span class="ok">approved</span>`
            : `<span class="commented">${e.agent ? "commented (advice)" : "commented"}</span>`;
        // recorded for them by someone else: theirs, without their mark, saying who typed it
        // (ReviewSpec decision 8)
        const rec = e.recordedBy;
        const whose = rec ? `<b>${escapeHtml(e.by ?? "")}</b>` : by;
        // withdrawn since (ReviewSpec decision 9): kept with what was said, and said so
        const w = e.withdrawn;
        const gone = w ? ` <span class="muted">· withdrawn ${escapeHtml(stamp(w.at))}${w.recordedBy ? ` by ${this.who(w.recordedBy.by, undefined, w.recordedBy.person)}` : ""}</span>` : "";
        return `${whose} ${verb}${rec ? ` <span class="muted">· recorded by ${this.who(rec.by, undefined, rec.person)}</span>` : ""} ${when}${gone}` + (e.comment ? `<div class="act-quote md">${this.hooks.comment(e.comment, e.name)}</div>` : "");
      }
      case "target":
        return `<span class="star">★</span> a target, marked by ${by} ${when}`;
      case "key":
        return e.member === e.name
          ? `<span class="key-mark">◆</span> key for <span class="star">★</span>${this.decl(e.target!)}, marked by ${by} ${when}`
          : `<span class="key-mark">◆</span> ${this.decl(e.member!)} marked key for it, a target, by ${by} ${when}`;
      case "pin":
        return `pinned on ${this.viewRef(e.view!, e.title!)} <span class="muted">${e.mode === "module" ? "by file" : "by namespace"}</span>${e.by ? `, by ${by}` : ""} ${when}`;
      case "note": {
        const text = (e.text ?? "").length > 280 ? e.text!.slice(0, 279) + "…" : e.text ?? "";
        const quote = this.hooks.hasNote(e.view!, e.note!)
          ? `<button class="act-quote act-note act-note-go" data-view="${escapeHtml(e.view!)}" data-note="${escapeHtml(e.note!)}" title="Show the note">${escapeHtml(text)}</button>`
          : `<div class="act-quote act-note">${escapeHtml(text)}</div>`;
        return `named in a note ${e.view ? `on ${this.viewRef(e.view, e.title!)}` : "of the project"} by ${by} ${when}${quote}`;
      }
      case "link":
        // a link into the library (AttachmentSpec decision 6): its label and the file it points into
        return `📄 linked to <b>${escapeHtml(e.label ?? "")}</b>${e.fileTitle ? ` in <i>${escapeHtml(e.fileTitle)}</i>` : ""} by ${by} ${when}`;
    }
  }

  private migrationHtml(m: LostMigration): string {
    const how = m.auto
      ? `renamed, found by <b>VisualProof</b> <span class="muted">(${escapeHtml(m.auto)})</span>`
      : `${m.rename ? "renamed" : "attached"} by ${this.who(m.by, m.agent, m.person)}`;
    return (
      `<div class="lf-mv"><span class="act-gone mono" title="${escapeHtml(m.from)}">${escapeHtml(short(m.from))}</span> → ${this.decl(m.to)}</div>` +
      `<div class="lf-how">${how} <span class="lf-when">${escapeHtml(stamp(m.at))}</span></div>` +
      `<div class="lf-carried">${escapeHtml(carriedText(m.carried))}</div>`
    );
  }

  render(): void {
    if (!this.open) return;
    const d = this.data;
    let html =
      `<div class="act-head"><div class="act-title">Lost-and-found</div><button class="icon" data-lf-close title="Close" aria-label="Close">✕</button></div>` +
      `<div class="lf-intro muted">What was said and marked of declarations the graph no longer has, and what moved to a new name. Nothing here is deleted: attach it to a declaration, or archive it, which only hides it.</div>`;
    if (!this.api) html += `<div class="muted act-empty">A snapshot keeps no history.</div>`;
    else if (!d) html += `<div class="muted act-empty">Reading…</div>`;
    else {
      if (d.aside.entries)
        html += `<div class="banner warn">${d.aside.entries} thing${d.aside.entries === 1 ? "" : "s"} said of declarations in files this build could not read ${d.aside.entries === 1 ? "is" : "are"} set aside until they are read again: ${d.aside.modules.slice(0, 4).map((m) => escapeHtml(short(m))).join(", ")}${d.aside.modules.length > 4 ? ", …" : ""}.</div>`;
      const lostN = d.lost.reduce((n, g) => n + g.entries.length, 0);
      html += `<div class="lf-sec-h">Lost <span class="muted">${lostN}</span></div>`;
      if (!d.lost.length) html += `<div class="muted lf-none">Nothing is lost: whatever was said is on a declaration of the graph.</div>`;
      d.lost.forEach((g, gi) => (html += this.groupHtml(g, gi)));
      html += `<div class="lf-sec-h">Migrations <span class="muted">${d.migrations.length}</span></div>`;
      if (!d.migrations.length) html += `<div class="muted lf-none">No rename was found, and nothing was attached by hand.</div>`;
      d.migrations.forEach((m, mi) => {
        const err = this.errors.get(m.key);
        const wait = this.busy.has(m.key) ? " disabled" : "";
        html +=
          `<div class="lf-mig${m.undone ? " undone" : ""}" data-lf-m="${mi}" data-lf-key="${escapeHtml(m.key)}">${this.migrationHtml(m)}<div class="lf-acts">` +
          (m.undone
            ? `<span class="muted">undone by ${this.who(m.undone.by, m.undone.agent, m.undone.person)} ${escapeHtml(stamp(m.undone.at))}</span>`
            : `<button class="act-undo" data-lf-undo${wait} title="Take back what it carried: what was said of the new name since stays">Undo</button>`) +
          `<button class="lf-arch" data-lf-archive${wait} title="Archive: hide it from the list; it is kept, under Archived">Archive</button></div>` +
          (err ? `<div class="act-warn">${escapeHtml(err)}</div>` : "") +
          `</div>`;
      });
      html += `<details class="lf-archived"${this.archivedOpen ? " open" : ""}><summary class="lf-sec-h">Archived <span class="muted">${d.archived.length}</span></summary>`;
      if (!d.archived.length) html += `<div class="muted lf-none">Nothing is archived.</div>`;
      d.archived.forEach((x, ai) => {
        const err = this.errors.get(x.key);
        const what = x.entry ? `<div class="lf-name mono" title="${escapeHtml(x.entry.name)}">${escapeHtml(x.entry.name)}</div><div class="lf-entry-t">${this.entryHtml(x.entry)}</div>` : x.migration ? this.migrationHtml(x.migration) : "";
        html +=
          `<div class="lf-arch-item" data-lf-a="${ai}" data-lf-key="${escapeHtml(x.key)}">${what}<div class="lf-acts"><span class="muted">archived by ${this.who(x.line.by, x.line.agent, x.line.person)} ${escapeHtml(stamp(x.line.at))}</span>` +
          `<button class="lf-arch" data-lf-putback${this.busy.has(x.key) ? " disabled" : ""} title="Put it back in the list">Put back</button></div>` +
          (err ? `<div class="act-warn">${escapeHtml(err)}</div>` : "") +
          `</div>`;
      });
      html += `</details>`;
    }
    this.el.innerHTML = html;
    if (this.flash) {
      const key = this.flash;
      // compared as text: a name may hold anything a selector would have to escape
      const [attr, want] = key.startsWith("name:") ? ["data-lf-name", key.slice(5)] : ["data-lf-key", key];
      const hit = [...this.el.querySelectorAll<HTMLElement>(`[${attr}]`)].find((x) => x.getAttribute(attr) === want);
      // not drawn yet (a migration just made, before the list is read again): the next drawing
      if (hit) {
        this.flash = null;
        hit.scrollIntoView({ block: "nearest" });
        hit.classList.add("lf-flash");
        setTimeout(() => hit.classList.remove("lf-flash"), 1600);
      }
    }
  }

  private groupHtml(g: LostGroup, gi: number): string {
    const name = g.name;
    const wait = this.busy.has(name) ? " disabled" : "";
    const last = g.last
      ? `last in the build of ${escapeHtml(stamp(g.last.at))}${g.last.commit ? ` (<span class="mono">${escapeHtml(g.last.commit.hash.slice(0, 7))}</span>)` : ""} · <span class="mono">${escapeHtml(g.last.module)}</span>`
      : "in no build the history kept";
    let html =
      `<div class="lf-group" data-lf-g="${gi}" data-lf-name="${escapeHtml(name)}">` +
      `<div class="lf-name mono" title="${escapeHtml(name)}">${escapeHtml(name)}</div>` +
      `<div class="lf-last muted">${last}</div>`;
    g.suggestions.slice(0, SUGGESTIONS).forEach((s, si) => {
      html +=
        `<div class="lf-sugg"><span class="muted">Likely</span> ${this.decl(s.to)} <span class="lf-score" title="How alike they are">${Math.round(s.score * 100)}%</span> <span class="muted lf-why">${escapeHtml(s.why)}</span>` +
        `<button class="act-undo" data-lf-sugg="${si}"${wait} title="Attach what was said of ${escapeHtml(short(name))} to ${escapeHtml(s.to)}">Attach</button></div>`;
    });
    html +=
      `<div class="lf-acts">` +
      `<button class="sbtn" data-lf-history${g.last ? "" : " disabled"} title="${g.last ? "Open the Time Machine at the last build that had it, on it" : "No build the history kept had it: the history begins later"}">Show in history</button>` +
      // a cluster gone (a link's `ns(P)`, `file(P)`) is no declaration to attach from: its links are
      // edited from a cluster's panel, or archived here
      (/^(ns|file)\(/.test(name) ? "" : `<button class="sbtn" data-lf-pick${wait} title="Pick a declaration with the search: what was said of this one goes to it">Attach to…</button>`) +
      (g.entries.length > 1 ? `<button class="sbtn" data-lf-archive-all${wait} title="Archive every entry under this name: they are kept, under Archived">Archive all</button>` : "") +
      `</div>`;
    if (this.confirm?.from === name) {
      html +=
        `<div class="lf-confirm">Attach what was said of <b class="mono">${escapeHtml(short(name))}</b> to ${this.decl(this.confirm.to)}? It moves every entry under this name.` +
        `<div class="lf-acts"><button class="rv-btn primary" data-lf-confirm${wait}>Attach</button><button class="rv-btn" data-lf-cancel>Cancel</button></div></div>`;
    }
    const err = this.errors.get(name);
    if (err) html += `<div class="act-warn">${escapeHtml(err)}</div>`;
    g.entries.forEach((e, ei) => {
      const ewait = this.busy.has(e.key) || this.busy.has(name) ? " disabled" : "";
      const eerr = this.errors.get(e.key);
      html +=
        `<div class="lf-entry" data-lf-e="${ei}" data-lf-key="${escapeHtml(e.key)}"><span class="lf-kind lf-${e.kind}">${e.kind}</span>` +
        `<div class="lf-entry-t">${this.entryHtml(e)}</div>` +
        `<button class="lf-arch" data-lf-archive${ewait} title="Archive: hide it from the list; it is kept, under Archived">Archive</button>` +
        (eerr ? `<div class="act-warn">${escapeHtml(eerr)}</div>` : "") +
        `</div>`;
    });
    return html + `</div>`;
  }
}
