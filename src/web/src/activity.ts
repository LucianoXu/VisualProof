// The timeline (CollabSpec decision 5), in a drawer on the right: what the server noticed (builds,
// TCB changes, re-layouts, targets taken off, prefixes trusted or no longer trusted) and what the
// review's logs record (opinions, targets, key declarations marked), newest first, grouped by day,
// with the number of unseen events on the button that opens it. Every event leads to what it is
// about.
//
// What someone invited by a personal link did (CollabSpec decision 9) shows under the name they go
// by now, with its ✓ (web/src/verified.ts).
//
// What agents did (AgentSpec.md) carries their mark: their advice, the layouts they made — each
// with an Undo, which puts back what that one request moved — and, at level full (decision 9), the
// targets, key declarations, trusted prefixes and views they marked or changed; the drawer shows
// everyone's, only the agents', or only the people's.
//
// Views (ViewSpec.md) saved for everyone, renamed, deleted or laid out afresh are changes too; a
// view that is still there opens from its event. So are the notes written, edited and deleted, by
// people and agents — the project's (AttachmentSpec decision 13) and a view's own (ViewSpec decision
// 23) — and a note of the project a build carried to where its cluster's declarations went (decision
// 18): a note still there is shown from its event.
//
// An opinion's comment reads as it does in the review (ReviewSpec, "Comments"): Markdown, its
// declarations' names, quoted opinions and quoted source lines going where they lead. It is
// rendered only for the events drawn.
//
// Each migration (HistorySpec decision 12) is an event of the review: what was said of a
// declaration carried to another name, by a rename the server found or by someone's Attach to…,
// undone or not; it leads to its entry in the lost-and-found (web/src/lostfound.ts).
//
// So is each event of the library (AttachmentSpec.md), read from the review's history of it
// (`libraryHistory`, shared/library.ts) as opinions are read from the review: a file added,
// renamed, archived or restored is a change; a link made, edited or removed is part of the review,
// and VisualProof carrying one with a cluster a build renamed says so. A file's title opens it in
// the reference window, a link still there opens it at its place, a declaration it is on goes to it;
// a link removed, or a file this server has no record of, shows as text.

import { parseRef } from "../../shared/comment.ts";
import type { LostMigration } from "../../shared/lostfound.ts";
import type { OpinionRef } from "../../shared/comment.ts";
import type { ActivityView } from "../../shared/collab.ts";
import { fileOf, parseSubject, subjectWords } from "../../shared/library.ts";
import type { Link } from "../../shared/library.ts";
import { prefixLabel } from "../../shared/review.ts";
import type { ReviewData } from "../../shared/review.ts";
import { noteExcerpt, noteNames } from "../../shared/sticky.ts";
import type { StoredEvent } from "../../shared/timeline.ts";
import { BOT } from "./agentmark.ts";
import { escapeHtml } from "./highlight.ts";
import type { Store } from "./store.ts";
import { nameHtml, nameNow } from "./verified.ts";

export interface ActivityHooks {
  me(): string | null;
  review(): ReviewData;
  /** the targets a reader marked — this one, or the one whose Activity this reader took by
   *  following them — and the declarations and modules their TCBs hold */
  mine(name: string | null): { targets: Set<string>; names: Set<string>; modules: Set<string> };
  /** the targets whose TCB holds a declaration of one of these modules */
  touching(modules: string[]): string[];
  /** the targets whose TCB holds a declaration a trusted prefix covers (shared/review.ts) */
  covering(prefix: string): string[];
  /** show what a trusted prefix covers */
  showPrefix(prefix: string): void;
  /** whether a declaration of that name is in the graph */
  has(name: string): boolean;
  go(name: string): void;
  reviewTarget(name: string): void;
  goToModule(module: string): void;
  /** the drawer opened or closed: the canvas makes room */
  toggled(open: boolean): void;
  /** what the drawer shows changed — opened, closed, filtered — which presence carries (CollabSpec
   *  decision 4) */
  stateChanged?(): void;
  /** undo an agent's layout batch; resolves to why it was refused, or null */
  undo(id: number): Promise<string | null>;
  /** whether a view of that id is there now, and opening it (in a tab) */
  hasView(id: string): boolean;
  openView(id: string): void;
  /** what a view there now is called; what a view on a query is called, from the query's text, and
   *  what the page says of it under the pointer — its scope in full, and the query (web/src/views.ts) */
  viewTitle?(id: string): string;
  scopeTitle?(scope: string): string;
  scopeTip?(scope: string): string;
  /** a comment on declaration `name`, as the review shows it (web/src/reviewbox.ts) */
  comment(text: string, name: string): string;
  /** go to a quoted opinion; open the source at quoted lines, which read as `quoted` where the
   *  comment holds them */
  openOpinion(r: OpinionRef): void;
  openSource(r: { name: string; from: number; to: number }, quoted: string[] | null): void;
  /** whether view `view` holds note `id` now, and showing it there */
  hasNote(view: string, id: string): boolean;
  showNote(view: string, id: string): void;
  /** the migrations the lost-and-found lists, archived ones too, and opening it on one; none where
   *  the page has no history (a snapshot) */
  migrations?(): (LostMigration & { key: string })[];
  openLost?(key: string): void;
  /** open a file of the library in the reference window; open the reference window at a link
   *  (AttachmentSpec decision 5). Where the page has no reference window, files and links are text */
  openFile?(sha: string): void;
  openLink?(id: string): void;
}

type Category = "review" | "build" | "change";

interface Item {
  key: string;
  at: string;
  by: string | null;
  /** done by an agent */
  agent: boolean;
  cat: Category;
  html: string;
  /** an opinion's comment, and the declaration it is on: rendered under `html` when drawn */
  comment?: { text: string; on: string };
  /** what "My targets" looks at */
  names: string[];
  targets: string[];
  modules: string[];
}

const short = (name: string) => name.split(".").pop() ?? name;
/** Parts of a sentence joined as a list is written: "a", "a and b", "a, b and c". */
const andList = (parts: string[]): string => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);
const FILTERS: [string, string][] = [
  ["all", "All"],
  ["review", "Review"],
  ["build", "Builds"],
  ["change", "Changes"],
];
const WHO: [string, string][] = [
  ["all", "Everyone"],
  ["agents", "Agents"],
  ["people", "People"],
];

export class Activity {
  private el: HTMLElement;
  private badge: HTMLElement;
  private store: Store;
  private hooks: ActivityHooks;
  private stored: StoredEvent[] = [];
  open = false;
  private filter: ActivityView["kind"] = "all";
  private mineOnly = false;
  /** whose targets "My targets" keeps to where it is not this reader's: the reader's whose Activity
   *  this one took by following them (CollabSpec decision 4), kept when following ends */
  private mineOf: string | null = null;
  /** everyone's events, only the agents', or only the people's */
  private who: ActivityView["who"] = "all";
  /** why an undo was refused, by batch */
  private undoErr = new Map<number, string>();

  constructor(el: HTMLElement, button: HTMLElement, badge: HTMLElement, store: Store, hooks: ActivityHooks) {
    this.el = el;
    this.badge = badge;
    this.store = store;
    this.hooks = hooks;
    button.addEventListener("click", () => this.toggle());
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-act-close]")) return this.toggle(false);
      const f = t.closest<HTMLElement>("[data-filter]");
      if (f) {
        this.filter = f.dataset.filter as ActivityView["kind"];
        return this.filtered();
      }
      if (t.closest("[data-mine]")) {
        // off, then this reader's own targets: someone else's, taken by following, are let go
        this.mineOnly = !this.mineOnly;
        this.mineOf = null;
        return this.filtered();
      }
      const w = t.closest<HTMLElement>("[data-who]");
      if (w) {
        this.who = w.dataset.who as ActivityView["who"];
        return this.filtered();
      }
      const undo = t.closest<HTMLButtonElement>("[data-undo]");
      if (undo) {
        const id = Number(undo.dataset.undo);
        undo.disabled = true;
        void this.hooks.undo(id).then((why) => {
          if (why) this.undoErr.set(id, why);
          else this.undoErr.delete(id);
          this.render();
        });
        return;
      }
      // what a comment links to: a declaration, a quoted opinion, quoted source lines
      const op = t.closest<HTMLElement>("[data-md-op]");
      const src = t.closest<HTMLElement>("[data-md-src]");
      const r = op ? parseRef(op.dataset.mdOp!) : src ? parseRef(src.dataset.mdSrc!) : null;
      if (r?.kind === "opinion") return this.hooks.openOpinion(r);
      if (r?.kind === "source") {
        const pre = src!.matches(".md-cq-h") ? src!.closest(".md-cq")?.querySelector("pre") : null;
        return this.hooks.openSource(r, pre?.textContent ? pre.textContent.split("\n") : null);
      }
      const ref = t.closest<HTMLElement>("[data-ref]");
      if (ref) return this.hooks.go(ref.dataset.ref!);
      const go = t.closest<HTMLElement>("[data-go]");
      if (go) return this.hooks.go(go.dataset.go!);
      const target = t.closest<HTMLElement>("[data-target]");
      if (target) return this.hooks.reviewTarget(target.dataset.target!);
      const mod = t.closest<HTMLElement>("[data-module]");
      if (mod) return this.hooks.goToModule(mod.dataset.module!);
      const prefix = t.closest<HTMLElement>("[data-prefix]");
      if (prefix) return this.hooks.showPrefix(prefix.dataset.prefix!);
      const lost = t.closest<HTMLElement>("[data-lost]");
      if (lost) return this.hooks.openLost?.(lost.dataset.lost!);
      const file = t.closest<HTMLElement>("[data-act-file]");
      if (file) return this.hooks.openFile?.(file.dataset.actFile!);
      const link = t.closest<HTMLElement>("[data-act-link]");
      if (link) return this.hooks.openLink?.(link.dataset.actLink!);
      const note = t.closest<HTMLElement>("[data-note]");
      if (note) return this.hooks.showNote(note.dataset.noteView!, note.dataset.note!);
      const view = t.closest<HTMLElement>("[data-view]");
      if (view) return this.hooks.openView(view.dataset.view!);
    });
  }

  /** What the server stored, as it sent it on load. */
  load(events: StoredEvent[]): void {
    this.stored = events;
    this.changed();
  }

  /** A new event from the server. */
  add(e: StoredEvent): void {
    if (this.stored.some((x) => x.id === e.id)) return;
    this.stored.push(e);
    this.changed();
  }

  /** Something the timeline reads changed (an event, the review, the reader's name). */
  changed(): void {
    if (this.open) {
      this.markSeen();
      this.render();
    }
    this.renderBadge();
  }

  toggle(open = !this.open): void {
    this.open = open;
    this.el.classList.toggle("open", open);
    if (open) {
      this.markSeen();
      this.render();
    }
    this.renderBadge();
    this.hooks.toggled(open);
    this.hooks.stateChanged?.();
  }

  private filtered(): void {
    this.render();
    this.hooks.stateChanged?.();
  }

  /** What the drawer shows, as presence carries it (CollabSpec decision 4): open or closed, and the
   *  filters — "My targets" as the reader whose targets they are. */
  state(): ActivityView {
    const mine = this.mineOnly ? this.mineOf ?? this.hooks.me() : null;
    return { open: this.open, kind: this.filter, who: this.who, ...(mine ? { mine } : {}) };
  }

  /** A followed reader's Activity (CollabSpec decision 4): this reader's shows what theirs does —
   *  open or closed, with their filters, their targets for "My targets". It stays so, this reader's
   *  own, when following ends. */
  mirror(s: ActivityView): void {
    const before = JSON.stringify(this.state());
    this.filter = s.kind;
    this.who = s.who;
    this.mineOnly = s.mine !== undefined;
    this.mineOf = s.mine !== undefined && s.mine !== this.hooks.me() ? s.mine : null;
    if (s.open !== this.open) this.toggle(s.open);
    else if (this.open && JSON.stringify(this.state()) !== before) this.render();
  }

  private markSeen(): void {
    const items = this.items();
    if (!items.length) return;
    const newest = items[0].at;
    if (!this.store.data.activitySeen || newest > this.store.data.activitySeen) {
      this.store.data.activitySeen = newest;
      this.store.save();
    }
  }

  private renderBadge(): void {
    const seen = this.store.data.activitySeen;
    const me = this.hooks.me();
    // the first visit counts nothing: everything before it is history, not news
    const n = seen ? this.items().filter((it) => it.at > seen && it.by !== me).length : 0;
    this.badge.hidden = n === 0;
    this.badge.textContent = n > 99 ? "99+" : String(n);
    if (!seen && this.items().length) {
      this.store.data.activitySeen = this.items()[0].at;
      this.store.save();
    }
  }

  /** Every event, newest first. */
  items(): Item[] {
    const out: Item[] = [];
    const who = (by: string | null, agent = false, person?: string) =>
      !by ? "Someone" : agent ? `<span class="act-agent">${BOT}<b>${escapeHtml(by)}</b> <span class="muted">(agent)</span></span>` : `<b>${nameHtml(by, person)}</b>`;
    /** who an event is by, as named now: what "news" counts (another's) and "My targets" look at */
    const now = (by: string | null, person?: string) => nameNow(by, person);
    const decl = (name: string) =>
      this.hooks.has(name)
        ? `<button class="act-ref" data-go="${escapeHtml(name)}" title="${escapeHtml(name)}">${escapeHtml(short(name))}</button>`
        : `<span class="act-gone" title="${escapeHtml(name)}: not in the graph now">${escapeHtml(short(name))}</span>`;
    const target = (name: string) =>
      this.hooks.has(name)
        ? `<button class="act-ref" data-target="${escapeHtml(name)}" title="Open ${escapeHtml(name)}'s view, on it"><span class="star">★</span>${escapeHtml(short(name))}</button>`
        : `<span class="act-gone" title="${escapeHtml(name)}">★${escapeHtml(short(name))}</span>`;
    const modules = (ms: string[]) =>
      ms
        .slice(0, 4)
        .map((m) => `<button class="act-ref mono" data-module="${escapeHtml(m)}" title="${escapeHtml(m)}">${escapeHtml(short(m))}</button>`)
        .join(", ") + (ms.length > 4 ? ` and ${ms.length - 4} more` : "");

    // what the review's logs record
    const r = this.hooks.review();
    for (const [name, ops] of Object.entries(r.opinions)) {
      for (const o of ops) {
        // an agent's opinion is advice: it suggests approving, it does not approve
        const verb =
          o.verdict === "approve"
            ? o.agent ? `suggests <span class="ok">approving</span>` : `<span class="ok">approved</span>`
            : `<span class="commented">${o.agent ? "comments" : "commented"}</span> on`;
        // one recorded for someone else is the doing of who typed it (ReviewSpec decision 8): their
        // name, then theirs it is, without its ✓
        const rec = o.recordedBy;
        out.push({
          key: `o:${o.agent ? "a" : "p"}:${name}:${o.by}:${o.at}`,
          at: o.at,
          by: rec ? now(rec.by, rec.person) : now(o.by, o.person),
          agent: !!o.agent,
          cat: "review",
          html: rec
            ? `${who(rec.by, false, rec.person)} recorded <b>${escapeHtml(o.by)}</b>'s ${o.verdict === "approve" ? `<span class="ok">approval</span> of` : `<span class="commented">comment</span> on`} ${decl(name)}`
            : `${who(o.by, o.agent, o.person)} ${verb} ${decl(name)}`,
          ...(o.comment ? { comment: { text: o.comment, on: name } } : {}),
          names: [name],
          targets: [],
          modules: [],
        });
      }
    }
    for (const [name, t] of Object.entries(r.targets))
      out.push({ key: `t:${name}:${t.at}`, at: t.at, by: now(t.by, t.person), agent: !!t.agent, cat: "review", html: `${who(t.by, t.agent, t.person)} made ${target(name)} a target`, names: [], targets: [name], modules: [] });
    // key declarations as they stand (a mark taken off leaves its log line, not the review's
    // state; ExportSpec decision 1)
    for (const [t, marks] of Object.entries(r.keys))
      for (const [name, m] of Object.entries(marks))
        out.push({ key: `k:${t}:${name}`, at: m.at, by: now(m.by, m.person), agent: !!m.agent, cat: "review", html: `${who(m.by, m.agent, m.person)} marked ${decl(name)} <span class="key-mark">◆</span>key for ${target(t)}`, names: [name], targets: [t], modules: [] });

    // the migrations: what was said of a declaration carried to another name, by a rename the
    // server found or by hand, each leading to its entry in the lost-and-found
    for (const m of this.hooks.migrations?.() ?? []) {
      const what = `what was said of <span class="act-gone mono" title="${escapeHtml(m.from)}">${escapeHtml(short(m.from))}</span> to ${decl(m.to)}`;
      out.push({
        key: `mv:${m.id}`,
        at: m.at,
        by: m.auto ? m.by : now(m.by, m.person),
        agent: !!m.agent,
        cat: "review",
        html:
          (m.auto ? `<b>${escapeHtml(m.by)}</b> carried ${what}, renamed <span class="muted">(${escapeHtml(m.auto)})</span>` : `${who(m.by, m.agent, m.person)} ${m.rename ? "moved" : "attached"} ${what}${m.rename ? ", renamed" : ""}`) +
          (m.undone ? ` <span class="muted">· undone by ${escapeHtml(nameNow(m.undone.by, m.undone.person) ?? m.undone.by)}${m.undone.agent ? " (agent)" : ""}</span>` : "") +
          ` <button class="act-undo" data-lost="${escapeHtml(m.key)}" title="See it in the lost-and-found, where it can be undone">Lost-and-found</button>`,
        names: [m.from, m.to],
        targets: [],
        modules: [],
      });
    }

    // the library's files and links, as the review's history of them tells (shared/library.ts)
    const links = new Map<string, Link>((r.links ?? []).map((l) => [l.id, l]));
    /** a file's title as it was then, opening the file as it is now; a file the review has no
     *  record of is text */
    const fileRef = (sha: string, title: string) => {
      const f = fileOf(r, sha);
      if (!f) return `<span class="act-gone" title="This server has no record of this file">${escapeHtml(title)}</span>`;
      if (!this.hooks.openFile) return `<b>${escapeHtml(title)}</b>`;
      return `<button class="act-ref" data-act-file="${escapeHtml(sha)}" title="Open ${escapeHtml(f.title)} in the reference window">${escapeHtml(title)}</button>`;
    };
    const fileKind = (sha: string) => {
      const f = fileOf(r, sha);
      return !f ? "the file" : f.type === "pdf" ? "the paper" : "the image";
    };
    /** a link by its label then, opening the paper at it while it is there */
    const linkRef = (id: string, label: string) => {
      if (!links.has(id)) return `<span class="act-gone" title="This link was removed">${escapeHtml(label)}</span>`;
      if (!this.hooks.openLink) return `<b>${escapeHtml(label)}</b>`;
      return `<button class="act-ref" data-act-link="${escapeHtml(id)}" title="Open the reference at this link">${escapeHtml(label)}</button>`;
    };
    /** what a link is on: a declaration goes to it, a cluster is said in words (no place to go) */
    const subject = (s: string) => {
      const p = parseSubject(s);
      return p?.kind === "decl" ? decl(p.name) : escapeHtml(subjectWords(s));
    };
    const declIn = (s: string | undefined) => {
      const p = s ? parseSubject(s) : null;
      return p?.kind === "decl" ? [p.name] : [];
    };
    (r.libraryHistory ?? []).forEach((h, k) => {
      const base = { key: `lb:${k}:${h.op}:${"sha" in h ? h.sha : h.id}`, at: h.at, agent: !!h.agent, targets: [] as string[], modules: [] as string[] };
      const by = who(h.by, h.agent, h.person);
      if ("sha" in h) {
        const title = fileRef(h.sha, h.title);
        const what = fileKind(h.sha);
        const html =
          h.op === "file"
            ? `${by} added ${what} ${title} to the library`
            : h.op === "file-edit"
              ? `${by} renamed ${what} <span class="act-gone">${escapeHtml(h.wasTitle)}</span> to ${title}`
              : `${by} ${h.op === "file-archive" ? "archived" : "restored"} ${what} ${title}`;
        out.push({ ...base, by: now(h.by, h.person), cat: "change", html, names: [] });
        return;
      }
      const label = linkRef(h.id, h.label);
      const file = fileOf(r, h.file);
      const inFile = file ? fileRef(h.file, file.title) : `<span class="act-gone" title="This server has no record of this file">a file</span>`;
      // what "My targets" looks at: the declarations it was on, and is on now
      const names = (...ss: (string | undefined)[]) => [...new Set([...ss, links.get(h.id)?.subject].flatMap(declIn))];
      if (h.op !== "link-edit") {
        const html = h.op === "link" ? `${by} linked ${subject(h.subject)} to ${label} in ${inFile}` : `${by} removed the link ${label} from ${subject(h.subject)}`;
        out.push({ ...base, by: now(h.by, h.person), cat: "review", html, names: names(h.subject) });
        return;
      }
      // VisualProof's own, for a cluster a build renamed as a whole (server/library.ts), under its
      // name as it signs it
      const server = !!h.auto;
      let html: string;
      if (server && h.wasSubject !== undefined)
        html = `<b>${escapeHtml(h.by)}</b> carried the link ${label} from ${subject(h.wasSubject)} to ${subject(h.subject)} <span class="muted">(${escapeHtml(h.auto!)})</span>`;
      else {
        const what = h.changed.map((p) =>
          p === "label" ? `label was “${escapeHtml(h.wasLabel ?? "")}”` : p === "place" ? "place in the reference changed" : `was on ${subject(h.wasSubject ?? "")}`,
        );
        html = `${server ? `<b>${escapeHtml(h.by)}</b>` : by} edited the link ${label} on ${subject(h.subject)} <span class="muted">(${what.join(", ")}${server ? `; ${escapeHtml(h.auto!)}` : ""})</span>`;
      }
      out.push({ ...base, by: server ? h.by : now(h.by, h.person), cat: "review", html, names: names(h.subject, h.wasSubject) });
    });

    // a layout batch is undone once, by the event that says so
    const undone = new Map<number, Extract<StoredEvent, { kind: "undo" }>>();
    for (const e of this.stored) if (e.kind === "undo") undone.set(e.of, e);
    const layouts = new Map<number, Extract<StoredEvent, { kind: "layout" }>>();
    for (const e of this.stored) if (e.kind === "layout") layouts.set(e.id, e);
    /** "12 declarations and 2 clusters" */
    const moved = (n: number, c: number) =>
      [n && `${n} declaration${n === 1 ? "" : "s"}`, c && `${c} cluster${c === 1 ? "" : "s"}`].filter(Boolean).join(" and ") || "nothing";

    // what the server noticed, or was told
    for (const e of this.stored) {
      const base = { key: `s:${e.id}`, at: e.at, agent: false, names: [] as string[], targets: [] as string[], modules: [] as string[] };
      if (e.kind === "build") {
        const parts: string[] = [];
        if (e.failed.length) parts.push(`<span class="bad">${e.failed.length} failed</span>: ${modules(e.failed)}`);
        if (e.fixed.length) parts.push(`<span class="ok">${e.fixed.length} fixed</span>: ${modules(e.fixed)}`);
        if (e.sorry.length) parts.push(`<span class="warn">sorry</span> in ${modules(e.sorry)}`);
        if (e.sorryGone.length) parts.push(`sorry gone from ${modules(e.sorryGone)}`);
        // a failure or a sorry where a target's TCB lives is what a reviewer needs to know first
        const hit = this.hooks.touching([...e.failed, ...e.sorry]);
        const head = `Build: ${e.rebuilt} file${e.rebuilt === 1 ? "" : "s"} built`;
        out.push({
          ...base,
          by: null,
          cat: "build",
          html:
            `${head}${parts.length ? " · " + parts.join(" · ") : ""}` +
            (hit.length ? `<div class="act-warn">In the TCB of ${hit.map(target).join(", ")}</div>` : ""),
          modules: [...e.failed, ...e.fixed, ...e.sorry, ...e.sorryGone],
        });
      } else if (e.kind === "tcb") {
        const c = e.counts;
        const what = [c.changed && `${c.changed} changed`, c.added && `${c.added} added`, c.removed && `${c.removed} removed`].filter(Boolean).join(", ");
        const list = (label: string, names: string[], n: number) =>
          names.length ? `<div class="act-list"><span class="muted">${label}</span> ${names.map(decl).join(", ")}${n > names.length ? ` and ${n - names.length} more` : ""}</div>` : "";
        out.push({
          ...base,
          by: null,
          cat: "change",
          html:
            `The TCB of ${target(e.target)} changed: ${what}` +
            (e.stale ? ` · <span class="warn">${e.stale} opinion${e.stale === 1 ? "" : "s"} now stale</span>` : "") +
            `<details class="act-details"><summary>What</summary>${list("Changed", e.changed, c.changed)}${list("Added", e.added, c.added)}${list("Removed", e.removed, c.removed)}</details>`,
          names: [...e.changed, ...e.added],
          targets: [e.target],
        });
      } else if (e.kind === "relayout") {
        out.push({ ...base, by: e.by, cat: "change", html: `${who(e.by)} laid the canvas out afresh; every pin was dropped` });
      } else if (e.kind === "view") {
        // a view by its name, or its scope in a few words (the owner's decision of 2026-10-10), the
        // scope in full under the pointer; one still there opens from here
        // the targets a deletion left with no view (the owner's decisions of 2026-10-11): a deletion
        // recorded before a view could be several targets' says its one as `target`
        const unlinked = e.what === "deleted" ? e.targets ?? (e.target ? [e.target] : []) : [];
        const title = (name: string | null) => escapeHtml(name ?? (e.view === "project" ? "Project" : this.hooks.scopeTitle?.(e.scope) ?? e.scope));
        const tip = escapeHtml(this.hooks.scopeTip?.(e.scope) ?? e.scope);
        const view = (name: string | null) =>
          this.hooks.hasView(e.view)
            ? `<button class="act-ref" data-view="${escapeHtml(e.view)}" title="Open this view:
${tip}">${title(name)}</button>`
            : `<span class="act-gone" title="${tip}">${title(name)}</span>`;
        const html =
          e.what === "created"
            ? `${who(e.by, e.agent, e.person)} saved the view ${view(e.name)} for everyone` + (e.name ? ` <span class="muted mono">${escapeHtml(e.scope)}</span>` : "")
            : e.what === "renamed"
              ? `${who(e.by, e.agent, e.person)} renamed ${e.was ? `the view <b>${escapeHtml(e.was)}</b>` : "a view"} to ${view(e.name)}`
              : e.what === "scope"
                ? `${who(e.by, e.agent, e.person)} changed the scope of ${view(e.name)} to <span class="muted mono">${escapeHtml(e.scope)}</span>`
                : e.what === "deleted"
                  ? // a view deleted unlinks its targets, said in the same event (the owner's decisions
                    // of 2026-10-11)
                    unlinked.length
                    ? `${who(e.by, e.agent, e.person)} deleted ${andList(unlinked.map(target))}'s view <b>${title(e.was ?? null)}</b>; ${unlinked.length === 1 ? "the target has" : "those targets have"} no view now`
                    : `${who(e.by, e.agent, e.person)} deleted the view <b>${title(e.was ?? null)}</b>`
                  : e.what === "version"
                    ? // kept at a past build (HistorySpec decision 19), or the latest again
                      e.snapshot === null || e.snapshot === undefined
                      ? `${who(e.by, e.agent, e.person)} set ${view(e.name)} back to the latest build`
                      : `${who(e.by, e.agent, e.person)} kept ${view(e.name)} at the build of ${e.built ? escapeHtml(new Date(e.built).toLocaleString()) : `snapshot ${e.snapshot}`}`
                    : e.what === "linked" && e.target
                      ? // a target's view is another now (ViewSpec decision 29)
                        `${who(e.by, e.agent, e.person)} linked ${target(e.target)} to ${view(e.name)}`
                      : e.what === "items"
                        ? // a note of the project added to the view or taken out of it (the owner's
                          // decision of 2026-10-11), the view by what it is called now where it is still there
                          `${who(e.by, e.agent, e.person)} ${e.shown ? "added" : "took"} the note “${escapeHtml(noteExcerpt(e.text ?? "", 80))}” ${e.shown ? "to" : "out of"} ${view((this.hooks.hasView(e.view) ? this.hooks.viewTitle?.(e.view) : null) ?? e.name)}`
                        : `${who(e.by, e.agent, e.person)} laid ${view(e.name)} out afresh; its pins were dropped`;
        const about = e.what === "deleted" ? unlinked : e.target ? [e.target] : [];
        out.push({ ...base, by: now(e.by, e.person), agent: !!e.agent, cat: "change", html, ...(about.length ? { targets: about } : {}) });
      } else if (e.kind === "untarget") {
        out.push({ ...base, by: now(e.by, e.person), agent: !!e.agent, cat: "review", html: `${who(e.by, e.agent, e.person)} took ${decl(e.name)} off the targets`, targets: [e.name] });
      } else if (e.kind === "trust" || e.kind === "untrust") {
        // what it is about: the targets whose TCB holds something it covers
        const hit = this.hooks.covering(e.prefix);
        const p = `<button class="act-ref mono" data-prefix="${escapeHtml(e.prefix)}" title="Show ${escapeHtml(prefixLabel(e.prefix))}">${escapeHtml(prefixLabel(e.prefix))}</button>`;
        out.push({
          ...base,
          by: now(e.by, e.person),
          agent: !!e.agent,
          cat: "review",
          html:
            (e.kind === "trust" ? `${who(e.by, e.agent, e.person)} trusted ${p} without review` : `${who(e.by, e.agent, e.person)} stopped trusting ${p}`) +
            (hit.length ? `<div class="act-list"><span class="muted">In the TCB of</span> ${hit.map(target).join(", ")}</div>` : ""),
          targets: hit,
        });
      } else if (e.kind === "note") {
        // a note of the kind agents left about a declaration before: not read
        if (!("what" in e) || !e.what) continue;
        // a note of the project (AttachmentSpec decision 13), its view ""; a view's, the view as it is
        // called now, where it is still there, else as it was called then
        const project = e.view === "";
        const where = project
          ? "the project"
          : this.hooks.hasView(e.view)
            ? `<button class="act-ref" data-view="${escapeHtml(e.view)}" title="Open this view">${escapeHtml(this.hooks.viewTitle?.(e.view) ?? e.title)}</button>`
            : `<span class="act-gone">${escapeHtml(e.title)}</span>`;
        const text = e.text.length > 280 ? e.text.slice(0, 279) + "…" : e.text;
        // the note itself, where it is still there, leads to it
        const quote =
          e.what !== "deleted" && this.hooks.hasNote(e.view, e.note)
            ? `<button class="act-quote act-note act-note-go" data-note="${escapeHtml(e.note)}" data-note-view="${escapeHtml(e.view)}" title="Show the note">${escapeHtml(text)}</button>`
            : `<div class="act-quote act-note${e.what === "deleted" ? " gone" : ""}">${escapeHtml(text)}</div>`;
        const verb = e.what === "created" ? "added a note to" : e.what === "edited" ? (project ? "edited a note of" : "edited a note on") : project ? "deleted a note of" : "deleted a note from";
        // a build carried it with its cluster's declarations (decision 18): from where to where
        const c = e.carried;
        const kind = c?.mode === "module" ? "folder" : "namespace";
        const did = c
          ? `carried a note of the project from the ${kind} <span class="act-gone">${escapeHtml(c.from)}</span> to ${escapeHtml(c.to)}, where its declarations went`
          : `${verb} ${where}`;
        // what "My targets" looks at: the declarations it names in backticks
        const names = noteNames(e.text);
        out.push({ ...base, by: now(e.by, e.person), agent: !!e.agent, cat: "change", html: `${who(e.by, e.agent, e.person)} ${did}${quote}`, names });
      } else if (e.kind === "layout") {
        const nodes = e.ops.filter((o) => o.op !== "clear" && o.kind === "node").map((o) => (o as { key: string }).key);
        const clusters = e.ops.length - nodes.length;
        const u = undone.get(e.id);
        const err = this.undoErr.get(e.id);
        out.push({
          ...base,
          by: e.by,
          agent: !!e.agent,
          cat: "change",
          html:
            `${who(e.by, e.agent)} moved ${moved(nodes.length, clusters)}` +
            (u ? ` <span class="muted">· undone by ${escapeHtml(u.agent ? `${u.by} (agent)` : u.by ?? "someone")}</span>` : ` <button class="act-undo" data-undo="${e.id}" title="Put back what this moved, except what someone moved since">Undo</button>`) +
            (nodes.length ? `<details class="act-details"><summary>What</summary><div class="act-list">${nodes.slice(0, 40).map(decl).join(", ")}${nodes.length > 40 ? ` and ${nodes.length - 40} more` : ""}</div></details>` : "") +
            (err && !u ? `<div class="act-warn">${escapeHtml(err)}</div>` : ""),
          names: nodes,
        });
      } else if (e.kind === "undo") {
        const of = layouts.get(e.of);
        const own = of && of.by === e.by && !!of.agent === !!e.agent;
        const whose = !of ? "a" : own ? (e.agent ? "its own" : "their own") : `${of.by}${of.agent ? " (agent)" : ""}'s`;
        out.push({
          ...base,
          by: now(e.by, e.person),
          agent: !!e.agent,
          cat: "change",
          html:
            `${who(e.by, e.agent, e.person)} undid ${escapeHtml(whose)} layout: ${e.restored} put back` +
            (e.kept.length ? `<div class="act-warn">${e.kept.length} left where ${e.kept.length === 1 ? "it is" : "they are"}, moved by someone since: ${e.kept.slice(0, 8).map((k) => (this.hooks.has(k) ? decl(k) : `<span class="act-key">${escapeHtml(k)}</span>`)).join(", ")}${e.kept.length > 8 ? " …" : ""}</div>` : ""),
          names: e.kept,
        });
      }
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  render(): void {
    const me = this.hooks.me();
    let items = this.items();
    if (this.filter !== "all") items = items.filter((it) => it.cat === this.filter);
    if (this.who !== "all") items = items.filter((it) => it.agent === (this.who === "agents"));
    if (this.mineOnly) {
      const m = this.hooks.mine(this.mineOf ?? me);
      items = items.filter((it) => it.targets.some((t) => m.targets.has(t)) || it.names.some((n) => m.names.has(n)) || it.modules.some((x) => m.modules.has(x)));
    }
    const day = (iso: string) => {
      const d = new Date(iso);
      const today = new Date();
      const yesterday = new Date(today.getTime() - 86400000);
      if (d.toDateString() === today.toDateString()) return "Today";
      if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
      return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
    };
    let html =
      `<div class="act-head"><div class="act-title">Activity</div><button class="icon" data-act-close title="Close">✕</button></div>` +
      `<div class="act-filters">${FILTERS.map(([k, label]) => `<button class="sbtn toggle${this.filter === k ? " on" : ""}" data-filter="${k}">${label}</button>`).join("")}` +
      // someone else's targets, taken by following them, are named as theirs
      (this.mineOnly && this.mineOf
        ? `<button class="sbtn toggle on" data-mine title="Only what concerns the targets ${escapeHtml(this.mineOf)} marked">${escapeHtml(this.mineOf)}'s targets</button>`
        : me
          ? `<button class="sbtn toggle${this.mineOnly ? " on" : ""}" data-mine title="Only what concerns the targets you marked">My targets</button>`
          : "") +
      `</div><div class="act-filters act-who" role="group" aria-label="Whose">` +
      WHO.map(([k, label]) => `<button class="sbtn toggle${this.who === k ? " on" : ""}" data-who="${k}"${k === "agents" ? ` title="Only what agents did: their advice, notes, layouts, and what else they did as people do"` : k === "people" ? ` title="Hide what agents did"` : ""}>${k === "agents" ? BOT : ""}${label}</button>`).join("") +
      `</div>`;
    if (!items.length) html += `<div class="muted act-empty">${this.filter === "all" && !this.mineOnly && this.who === "all" ? "Nothing has happened here yet." : "Nothing of this kind."}</div>`;
    let last = "";
    for (const it of items.slice(0, 400)) {
      const d = day(it.at);
      if (d !== last) {
        html += `<div class="act-day">${escapeHtml(d)}</div>`;
        last = d;
      }
      const time = new Date(it.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const quote = it.comment ? `<div class="act-quote md">${this.hooks.comment(it.comment.text, it.comment.on)}</div>` : "";
      html += `<div class="act-item act-${it.cat}${it.agent ? " by-agent" : ""}"><span class="act-time">${time}</span><div class="act-text">${it.html}${quote}</div></div>`;
    }
    this.el.innerHTML = html;
  }
}
