// The conversations (CollabSpec decision 13, AgentSpec decision 8; the owner's decisions of
// 2026-10-19), in the reader's own conversation window (web/src/chatwin.ts). Its channels, at its
// head: *Everyone*, the public channel, where everyone with a name and every agent with a token
// talk; then each of the reader's own agents — those whose token they made (shared/collab.ts,
// madeBy) — with its state, its private channel being between the two of them alone. Following has
// nothing to do with any of it: following an agent shows what it looks at, never its conversations,
// and nothing here ends following but a link followed from a message (a declaration, a link of this
// site: the reader's own tool changing what is followed, CollabSpec decision 4) and Esc.
//
// Every message, a person's as an agent's, is escaped first, then given a little Markdown — **bold**,
// *italics*, `code`, fenced code — declarations' names as links, and its links (web/src/markdown.ts):
// a link of this site as a chip naming what it leads to, which goes there in the page without a
// reload; any other http(s) link opening in a new tab, its host beside it (web/src/chatlinks.ts).
// Where a message was written from is handed to agents, never drawn: a link says where, when its
// writer wants to. `@` and a name mentions someone: the box completes it (web/src/chatinput.ts), a
// mention of the reader marks the message, and the conversation button too while they have not seen
// it, with a notice that opens the window on it.
//
// The button counts the public messages the reader has not seen, and is marked where they are
// mentioned or one of their agents answered. What they have seen of each channel (its last id) is
// kept in this browser (web/src/store.ts): seen is what the window shows, open and expanded, the
// page in front.
//
// In an agent's private channel, above the box, the agent's state as the server infers it from what
// the agent does: listening (a message reaches it at once), thinking (since when, and what its
// requests show it doing, or the line it set itself), working, or offline. What is written to an
// agent that is thinking or working waits for its next wait, and is marked so until then; an offline
// agent's private channel cannot be written to, and its box says when it was last seen. Its maker
// can start a new conversation there (the owner's decision of 2026-10-11): a divider, with what came
// before folded into one line ("Earlier conversation · N messages"). The agent is handed a notice to
// disregard what came before, and a later session of it is told only what comes after; but a session
// running now keeps what it was told, which the page cannot take from it (only /clear in its own
// terminal does): the button's tooltip says so.

import { colorOf, madeBy, sameName } from "../../shared/collab.ts";
import type { AgentTalk, ChatMessage, Peer, PresenceView } from "../../shared/collab.ts";
import type { Mentionable } from "../../shared/mentions.ts";
import { BOT } from "./agentmark.ts";
import { ChatInput } from "./chatinput.ts";
import { hostOf } from "./chatlinks.ts";
import type { Chip } from "./chatlinks.ts";
import type { ChatWindow } from "./chatwin.ts";
import type { DataSource } from "./data.ts";
import { escapeHtml } from "./highlight.ts";
import { renderMarkdown } from "./markdown.ts";
import { ago } from "./reviewbox.ts";
import type { Store } from "./store.ts";

export const PUBLIC = "public";

/** an arrow out of a box: a link to elsewhere */
const OUT = `<svg class="tk-out" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** a chain link: a link of this site */
const LINK = `<svg class="tk-ln" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export interface TalkHooks {
  data: Pick<DataSource, "chat" | "sendChat" | "newChat">;
  store: Store;
  /** the window the conversations are in */
  win: ChatWindow;
  /** who this reader is: the name they go by (null: none given yet) and their personal link */
  me(): { name: string | null; person: string | null };
  /** the reader's name, asked for when there is none; null when they decline */
  ensureName(): Promise<string | null>;
  /** where this page is now: sent with a message, for the agents to know where it was written */
  place(): PresenceView;
  /** the others on the page: the people online and the agents listed (presence) */
  peers(): readonly Peer[];
  /** the declaration a name in a message stands for — a full name, or a last component only one
   *  declaration has — or null */
  resolve(name: string): string | null;
  /** a declaration's name followed from a message */
  go(name: string): void;
  /** a link of this site followed from a message: its fragment, applied as a share link is */
  open(hash: string): void;
  /** a link of this site's chip; null for any other link, and one of this site the page cannot read */
  chip(url: string): Chip | null;
  /** a link to what the reader sees, without the key; null where none can be made */
  seenLink(): Promise<string | null>;
  /** `text` with every link of this site that lets in made keyless (web/src/chatlinks.ts,
   *  `withoutKeys`, with the site's addresses) */
  unkeyed(text: string): string;
  /** the button's count, and its mark */
  counted(n: number, marked: boolean): void;
  /** someone mentioned the reader where they do not read now */
  mentioned(channel: string, m: ChatMessage): void;
}

export class Talk {
  private el: HTMLElement;
  private hooks: TalkHooks;
  private input: ChatInput;
  /** the channel on show: `public`, or an agent's id in presence */
  private channel: string;
  /** each channel's messages, oldest first, as read and as they came */
  private threads = new Map<string, ChatMessage[]>();
  /** the channels read since the stream (re)connected; the one being read; those with nothing
   *  before what they show */
  private read = new Set<string>();
  private exhausted = new Set<string>();
  private loading = new Set<string>();
  /** what the reader was writing, per channel */
  private drafts = new Map<string, string>();
  private error: string | null = null;
  private sending = false;
  private restarting = false;
  /** the conversations before the last divider are shown, not folded into one line */
  private unfolded = false;
  /** the page may read the conversations: a name given, and not a read-only reader's */
  private named = false;
  /** counts the seconds of a thinking agent */
  private clock: ReturnType<typeof setInterval> | null = null;
  /** what the agents listed were handed, as the thread was last drawn with it */
  private readSig = "";
  /** the reader is at the thread's end: it stays there when it grows */
  private atEnd = true;
  private endTop = -1;
  private sized: ResizeObserver | null;

  constructor(el: HTMLElement, hooks: TalkHooks) {
    this.el = el;
    this.hooks = hooks;
    const kept = hooks.store.data.chatChannel;
    this.channel = typeof kept === "string" && kept ? kept : PUBLIC;
    this.input = new ChatInput(el.querySelector<HTMLElement>(".cv-input")!, el.querySelector<HTMLElement>(".cv-mentions")!, {
      chip: (url) => {
        const c = this.hooks.chip(url);
        return c ? chipInner(c) : null;
      },
      unkeyed: (text) => this.hooks.unkeyed(text),
      send: () => void this.send(),
      changed: () => this.drafts.set(this.channel, this.input.text),
      names: () => this.mentionable(),
    });
    this.sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.atEnd && this.scrollEnd());
    const thread = this.thread();
    this.sized?.observe(thread);
    thread.addEventListener("scroll", () => {
      if (!thread.clientHeight || (this.atEnd && thread.scrollTop === this.endTop)) return;
      this.atEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
      if (this.atEnd) this.seen();
    });
    el.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.send();
    });
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>("[data-ch]");
      if (tab) return this.show(tab.dataset.ch!);
      if (t.closest("[data-fold]")) return this.toggleFold();
      if (t.closest("[data-cv-older]")) return void this.older();
      if (t.closest("[data-cv-new]")) return void this.restart();
      if (t.closest("[data-cv-link]")) return void this.insertSeen();
      if (t.closest("[data-cv-name]")) return void this.hooks.ensureName();
      const site = t.closest<HTMLElement>("[data-site]");
      if (site && !site.closest(".cv-input")) {
        e.preventDefault();
        return this.hooks.open(site.dataset.site!);
      }
      const decl = t.closest<HTMLElement>("[data-decl]");
      if (decl) {
        e.preventDefault();
        this.hooks.go(decl.dataset.decl!);
      }
    });
    // what was seen in another tab of this browser is seen here too
    addEventListener("storage", (e) => {
      if (e.key === hooks.store.key) this.count();
    });
    document.addEventListener("visibilitychange", () => this.seen());
  }

  private thread(): HTMLElement {
    return this.el.querySelector<HTMLElement>(".cv-thread")!;
  }

  /** The drafts not empty, kept across a reload into a new version (web/src/reload.ts). */
  get keptDrafts(): [string, string][] {
    return [...this.drafts].filter(([, v]) => v.trim() !== "");
  }

  /** The drafts kept by the reload that made this page (UpdateSpec decision 8). */
  restoreDrafts(kept: [string, string][]): void {
    for (const [k, v] of kept) if (!this.drafts.has(k)) this.drafts.set(k, v);
  }

  // ---------------------------------------------------------------- the channels

  /** The reader's own agents, as presence lists them: those whose token they made. */
  private own(): Peer[] {
    return ownAgents(this.hooks.peers(), this.hooks.me());
  }

  /** The channels the reader has: Everyone, then each of their own agents. */
  private channels(): string[] {
    return [PUBLIC, ...this.own().map((p) => p.id)];
  }

  /** The agent whose private channel `channel` is, as presence lists it; null for Everyone. */
  private agentOf(channel: string): Peer | null {
    return channel === PUBLIC ? null : (this.own().find((p) => p.id === channel) ?? null);
  }

  /** Show channel `channel` (one the reader has; else Everyone), as their choice kept. */
  show(channel: string): void {
    const to = this.channels().includes(channel) ? channel : PUBLIC;
    if (to !== this.channel) {
      this.drafts.set(this.channel, this.input.text);
      this.channel = to;
      this.error = null;
      this.unfolded = false;
      this.atEnd = true;
      this.hooks.store.data.chatChannel = to === PUBLIC ? undefined : to;
      this.hooks.store.save();
    }
    this.render();
    void this.load(to);
  }

  /** Open the window on `channel`, expanded, the box focused; with `mention`, `@` and that name in
   *  the box (Talk on someone else's agent: it is talked to in Everyone). */
  open(channel: string, mention?: string): void {
    this.hooks.win.show(true);
    this.show(channel);
    if (mention && this.named) {
      const now = this.input.text;
      if (!now.includes(`@${mention}`)) this.input.text = `${now ? now.replace(/\s*$/, " ") : ""}@${mention} `;
      this.drafts.set(this.channel, this.input.text);
    }
    this.input.focus();
    placeCaretAtEnd(this.input.el);
  }

  /** The event stream said hello again, and its heartbeat named it: the channels are read afresh
   *  (what came while it was away), and what the reader may read is known again. */
  connected(): void {
    this.read.clear();
    this.identity();
  }

  /** Who the reader is changed (a name given or changed, a personal link): what they may read. */
  identity(): void {
    const me = this.hooks.me();
    const named = me.name !== null;
    if (!named) this.threads.clear();
    this.named = named;
    this.read.clear();
    this.render();
    this.count();
    if (!named) return;
    for (const c of this.channels()) void this.load(c);
  }

  /** The others changed: the agents' states, who is listed; an agent of the reader's newly listed is
   *  read, and one no longer listed is no channel. The thread is drawn again where an agent was
   *  handed a message since (its "not read yet" goes). */
  peersChanged(): void {
    if (!this.channels().includes(this.channel)) this.channel = PUBLIC;
    this.renderTabs();
    this.renderState();
    this.renderForm(false);
    const read = this.hooks.peers().flatMap((p) => (p.agent && p.talk ? [`${p.id}:${p.talk.read}:${p.talk.readPublic}`] : [])).join(" ");
    if (read !== this.readSig) {
      this.readSig = read;
      const el = this.thread();
      const top = el.scrollTop;
      this.renderThread();
      if (this.atEnd) this.scrollEnd();
      else el.scrollTop = top;
    }
    this.renderPill();
    if (this.named) for (const c of this.channels()) if (!this.read.has(c)) void this.load(c);
    this.count();
  }

  /** Read a channel, once per connection: what it holds now, with what came meanwhile. */
  private async load(channel: string): Promise<void> {
    if (!this.named || this.read.has(channel) || this.loading.has(channel)) return;
    this.loading.add(channel);
    const r = await this.hooks.data.chat(channel);
    this.loading.delete(channel);
    if (!r) {
      if (channel === this.channel) this.error = "The conversation could not be read.";
    } else {
      this.read.add(channel);
      this.threads.set(channel, merge(r.messages, this.threads.get(channel) ?? []));
    }
    if (channel === this.channel) {
      this.renderThread();
      this.scrollEnd();
      this.renderForm(false);
      this.renderPill();
      this.seen();
    }
    this.renderTabs();
    this.count();
  }

  /** A message of some channel, as the event stream sends it: the public channel's, or a private
   *  one's of the reader's (the server sends no other). */
  add(channel: string, m: ChatMessage): void {
    if (!this.named) return;
    const t = this.threads.get(channel) ?? [];
    if (t.some((x) => x.id === m.id)) return;
    this.threads.set(channel, merge([m], t));
    const mine = this.isMine(m);
    if (channel === this.channel) {
      // a new conversation folds what came before it, the reader's opening of it included
      if (m.kind === "divider") this.unfolded = false;
      this.renderThread();
      if (this.atEnd || m.kind === "divider" || mine) this.scrollEnd();
      this.renderPill();
      this.renderRestart();
    }
    this.renderTabs();
    const reading = this.hooks.win.reading && channel === this.channel && this.atEnd;
    if (reading) this.seen();
    else if (!mine) {
      this.hooks.win.replied();
      const me = this.hooks.me().name;
      if (m.kind !== "divider" && me && m.mentions?.some((n) => sameName(n, me))) this.hooks.mentioned(channel, m);
    }
    this.count();
  }

  /** Whether the reader wrote `m`. */
  private isMine(m: ChatMessage): boolean {
    const me = this.hooks.me().name;
    return m.kind !== "agent" && me !== null && sameName(m.from, me);
  }

  // ---------------------------------------------------------------- what is seen

  /** What the reader sees now is seen: the channel on show, where the window shows its end. */
  private seen(): void {
    if (!this.hooks.win.reading || !this.named || !this.atEnd) return;
    const last = this.threads.get(this.channel)?.at(-1)?.id ?? 0;
    const kept = this.hooks.store.data.chatSeen ?? {};
    if ((kept[this.channel] ?? 0) >= last) return;
    this.hooks.store.data.chatSeen = { ...kept, [this.channel]: last };
    this.hooks.store.save();
    this.hooks.win.markSeen();
    this.renderTabs();
    this.count();
  }

  /** The button's count and mark, from what is unseen. */
  private count(): void {
    if (!this.named) return this.hooks.counted(0, false);
    const u = unseen(this.threads, this.hooks.store.data.chatSeen ?? {}, this.hooks.me().name, this.own().map((p) => p.id));
    this.hooks.counted(u.count, u.marked);
  }

  /** The window opened, or opened again from its pill: the thread shows where it ends. */
  expanded(): void {
    this.render();
    this.scrollEnd();
    this.seen();
  }

  // ---------------------------------------------------------------- writing

  private async send(): Promise<void> {
    const channel = this.channel;
    const a = this.agentOf(channel);
    // a link that lets in, typed whole, is sent without its secret, as a pasted one is
    const text = this.hooks.unkeyed(this.input.text).trim();
    if (!text || this.sending || (a && (!a.talk || a.talk.state === "offline"))) return;
    if (!(await this.hooks.ensureName())) {
      this.error = "A message is sent under your name: give one first.";
      return this.renderForm(true);
    }
    this.sending = true;
    const r = await this.hooks.data.sendChat(channel, text, this.hooks.place());
    this.sending = false;
    if ("error" in r) {
      this.error = r.error === "offline" ? `${a?.name ?? "The agent"} is offline: it can be written to once it listens again.` : r.error;
      return this.renderForm(true);
    }
    this.error = null;
    this.drafts.delete(channel);
    if (this.channel === channel) this.input.text = "";
    this.add(channel, r.message);
    this.renderForm(true);
    this.scrollEnd();
  }

  /** The box's button: a link to what the reader sees, as its chip, where the caret is. */
  private async insertSeen(): Promise<void> {
    const url = await this.hooks.seenLink();
    if (!url) return;
    this.input.focus();
    this.input.insertLink(url);
  }

  /** Start a new conversation with the agent on show, under the reader's name: the divider comes
   *  back, and to their pages. */
  private async restart(): Promise<void> {
    const a = this.agentOf(this.channel);
    const t = this.threads.get(this.channel) ?? [];
    if (!a || this.restarting || fresh(t)) return;
    if (!(await this.hooks.ensureName())) return;
    this.restarting = true;
    this.renderRestart();
    const r = await this.hooks.data.newChat(a.id);
    this.restarting = false;
    if ("error" in r) this.error = r.error;
    else {
      this.error = null;
      if (r.divider) this.add(a.id, r.divider);
    }
    this.renderForm(false);
    this.renderRestart();
  }

  /** The messages before those the channel shows (the server gives the newest 200 at a time), the
   *  thread staying where it is on the screen; where there are none, the line that asks says so. */
  private async older(): Promise<void> {
    const channel = this.channel;
    const first = this.threads.get(channel)?.[0]?.id;
    if (!first || first <= 1 || this.loading.has(channel)) return;
    this.loading.add(channel);
    const r = await this.hooks.data.chat(channel, first);
    this.loading.delete(channel);
    if (!r || channel !== this.channel) return;
    const el = this.thread();
    const fromEnd = el.scrollHeight - el.scrollTop;
    this.threads.set(channel, merge(r.messages, this.threads.get(channel) ?? []));
    if (!r.messages.length) this.exhausted.add(channel);
    this.renderThread();
    el.scrollTop = el.scrollHeight - fromEnd;
  }

  /** Open the earlier conversations, or fold them again, the line that does it staying where it is
   *  on the screen. */
  private toggleFold(): void {
    const el = this.thread();
    const was = el.querySelector<HTMLElement>(".tk-fold")?.getBoundingClientRect().top;
    this.unfolded = !this.unfolded;
    this.renderThread();
    const line = el.querySelector<HTMLElement>(".tk-fold");
    if (!line) return;
    if (was !== undefined) el.scrollTop += line.getBoundingClientRect().top - was;
    this.atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    line.focus();
  }

  /** Who a mention may be completed with: the people online, then the agents listed with a token —
   *  an agent known by its headers alone takes no part (AgentSpec, "Who takes part"). */
  private mentionable(): Mentionable[] {
    const me = this.hooks.me().name;
    const out: Mentionable[] = [];
    for (const p of this.hooks.peers()) {
      if (!p.name || (p.agent && !p.talk) || (me && !p.agent && sameName(p.name, me))) continue;
      out.push({ name: p.name, ...(p.agent ? { agent: true } : {}) });
    }
    return out;
  }

  // ---------------------------------------------------------------- drawing

  render(): void {
    this.renderTabs();
    this.renderThread();
    this.renderState();
    this.renderForm(false);
    this.renderRestart();
    this.renderPill();
  }

  /** The head: Everyone, with how many it holds the reader has not seen; each of their agents, its
   *  state's dot, a mark where it said something they have not seen. */
  private renderTabs(): void {
    const box = this.el.querySelector<HTMLElement>(".cv-tabs");
    if (!box) return;
    const seen = this.hooks.store.data.chatSeen ?? {};
    const me = this.hooks.me().name;
    const tab = (id: string, inner: string, title: string) =>
      `<button type="button" role="tab" class="cv-tab${id === this.channel ? " on" : ""}" aria-selected="${id === this.channel}" data-ch="${escapeHtml(id)}" title="${escapeHtml(title)}">${inner}</button>`;
    const pub = (this.threads.get(PUBLIC) ?? []).filter((m) => m.id > (seen[PUBLIC] ?? 0) && !(me && m.kind !== "agent" && sameName(m.from, me))).length;
    let html = tab(PUBLIC, `Everyone${pub && this.channel !== PUBLIC ? `<span class="cv-n">${pub > 99 ? "99+" : pub}</span>` : ""}`, "Everyone with a name on this page, and every agent with a token");
    for (const a of this.own()) {
      const t = a.talk;
      const news = (this.threads.get(a.id) ?? []).some((m) => m.kind === "agent" && m.id > (seen[a.id] ?? 0));
      html += tab(a.id, `<span class="st-dot${t ? ` st-${t.state}` : ""}"></span>${BOT}<span class="cv-tn">${escapeHtml(a.name ?? "")}</span>${news && a.id !== this.channel ? '<span class="cv-dot" aria-label="new"></span>' : ""}`, `Your agent ${a.name ?? ""}: ${t ? stateWords(t) : ""} — between the two of you alone`);
    }
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  /** The thread: what came before the last divider folded into one line, unless the reader opened
   *  it; the divider; what came after. */
  private renderThread(): void {
    const el = this.thread();
    if (!this.named) {
      el.innerHTML = `<div class="tk-empty"><p>The conversations are for people with a name: everyone on this page, and the agents.</p><button type="button" class="rv-btn primary" data-cv-name>Give your name</button></div>`;
      return;
    }
    const messages = this.threads.get(this.channel) ?? [];
    const a = this.agentOf(this.channel);
    if (!messages.length) {
      el.innerHTML = `<div class="tk-empty muted">${
        this.loading.has(this.channel)
          ? "Reading the conversation…"
          : a
            ? `No messages yet. What you write here goes to ${escapeHtml(a.name ?? "your agent")}, and nobody else sees it.`
            : "No messages yet. What you write here everyone with a name on this page sees, and every agent can read; @ and a name hands it to an agent."
      }</div>`;
      return;
    }
    const f = fold(messages);
    // more before what the server gave: the line that reads it
    const older = messages[0].id > 1 && !this.exhausted.has(this.channel) ? `<button class="tk-fold" type="button" data-cv-older>Earlier messages</button>` : "";
    const line = f.count
      ? `<button class="tk-fold" type="button" data-fold aria-expanded="${this.unfolded}"><span class="tk-chev" aria-hidden="true"></span>Earlier conversation · ${f.count} message${f.count === 1 ? "" : "s"}</button>`
      : "";
    el.innerHTML = older + line + (this.unfolded ? f.earlier : []).map((m) => this.message(m)).join("") + (f.divider ? this.message(f.divider) : "") + f.current.map((m) => this.message(m)).join("");
  }

  private message(m: ChatMessage): string {
    if (m.kind === "divider") {
      const when = new Date(m.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      return `<div class="tk-divider" role="separator" title="${escapeHtml(new Date(m.at).toLocaleString())}"><span>New conversation — started by <b>${escapeHtml(m.from)}</b>, ${escapeHtml(when)}</span></div>`;
    }
    const me = this.hooks.me().name;
    const time = new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const body = markMentions(renderMarkdown(m.text, (n) => this.hooks.resolve(n), (url, label) => this.link(url, label)), m.mentions ?? [], me);
    const forMe = !!me && !!m.mentions?.some((n) => sameName(n, me));
    const mine = this.isMine(m);
    return (
      `<div class="tk-msg ${m.kind}${mine ? " mine" : ""}${forMe ? " for-me" : ""}" style="--c:${colorOf(m.from)}">` +
      `<div class="tk-head">${m.kind === "agent" ? BOT : ""}<b>${escapeHtml(m.from)}</b> <span class="muted" title="${escapeHtml(new Date(m.at).toLocaleString())}">${time}</span>${this.waiting(m)}</div>` +
      `<div class="tk-text">${body}</div>` +
      `</div>`
    );
  }

  /** A person's message an agent has not been handed yet: it comes out at its next wait. In a
   *  private channel, its agent's; in the public channel, each agent it mentions that is listed. */
  private waiting(m: ChatMessage): string {
    if (m.kind !== "person") return "";
    const a = this.agentOf(this.channel);
    if (a) return a.talk && m.id > a.talk.read ? ` <span class="tk-wait" title="${escapeHtml(a.name ?? "The agent")} reads it when it next listens">· not read yet</span>` : "";
    const agents = this.hooks.peers().filter((p) => p.agent && p.talk && p.name && m.mentions?.some((n) => sameName(n, p.name!)) && m.id > p.talk.readPublic);
    if (!agents.length) return "";
    const who = agents.map((p) => p.name).join(", ");
    return ` <span class="tk-wait" title="${escapeHtml(who)} ${agents.length === 1 ? "reads" : "read"} it when ${agents.length === 1 ? "it next listens" : "they next listen"}">· not read yet by ${escapeHtml(who)}</span>`;
  }

  /** A link in a message: of this site, its chip; else an http(s) link opening in a new tab, its
   *  host beside it. Everything in it escaped. */
  private link(url: string, label: string | null): string {
    const c = this.hooks.chip(url);
    if (c) return `<a class="cv-chip k-${c.kind}" href="#" data-site="${escapeHtml(new URL(url).hash.replace(/^#/, ""))}" title="${escapeHtml(c.title)}">${chipInner(c)}</a>`;
    const host = hostOf(url);
    const words = label ?? (url.length > 60 ? `${url.slice(0, 57)}…` : url);
    return `<a class="tk-ext" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}">${escapeHtml(words)}</a><span class="tk-host">${OUT}${escapeHtml(host)}</span>`;
  }

  /** The agent's state line in its private channel: "listening", "thinking · 12 s · reading `A.b`",
   *  the agent's own line, "offline · last seen 5 min ago". */
  private renderState(): void {
    const el = this.el.querySelector<HTMLElement>(".cv-state");
    const a = this.named ? this.agentOf(this.channel) : null;
    const t = a?.talk;
    if (!el) return;
    el.hidden = !t;
    if (t) {
      el.className = `cv-state tk-state st-${t.state}`;
      el.innerHTML = `<span class="st-dot"></span><span>${stateLine(t, (n) => this.hooks.resolve(n))}</span>`;
      el.title = stateWords(t);
    }
    this.tick();
  }

  /** While the agent on show thinks, its line counts the seconds. */
  private tick(): void {
    const on = this.hooks.win.open && this.agentOf(this.channel)?.talk?.state === "thinking";
    if (on && !this.clock) this.clock = setInterval(() => this.renderState(), 1000);
    else if (!on && this.clock) {
      clearInterval(this.clock);
      this.clock = null;
    }
  }

  /** The box: enabled where the reader can write in the channel on show; its draft; its error. */
  private renderForm(keepText: boolean): void {
    const a = this.agentOf(this.channel);
    const t = a?.talk;
    const off = !this.named || (!!a && (!t || t.state === "offline"));
    const who = a?.name ?? "the agent";
    const placeholder = !this.named
      ? "Give your name to write here"
      : !a
        ? "Write to everyone"
        : off
          ? `${who} is offline${t?.lastSeen ? ` — last seen ${ago(t.lastSeen)}` : ""}`
          : t!.state === "listening"
            ? `Write to ${who}`
            : `Write to ${who} · it reads this when it next listens`;
    const box = this.input.el;
    const was = box.dataset.channel;
    this.input.enable(!off, placeholder);
    if (!keepText && was !== this.channel) {
      this.input.text = this.drafts.get(this.channel) ?? "";
      box.dataset.channel = this.channel;
    }
    this.el.querySelector<HTMLButtonElement>("[type=submit]")!.disabled = off || this.sending;
    this.el.querySelector<HTMLButtonElement>("[data-cv-link]")!.disabled = off;
    const err = this.el.querySelector<HTMLElement>(".cv-err")!;
    err.hidden = !this.error;
    err.textContent = this.error ?? "";
  }

  /** The head's button: a new conversation, in a private channel only, unless nothing was said since
   *  the last one began. Never disabled outright, so that its tooltip still shows. */
  private renderRestart(): void {
    const b = this.el.querySelector<HTMLButtonElement>("[data-cv-new]");
    const a = this.named ? this.agentOf(this.channel) : null;
    if (!b) return;
    b.hidden = !a;
    if (!a) return;
    const t = this.threads.get(this.channel) ?? [];
    const off = this.loading.has(this.channel) || this.restarting || fresh(t);
    b.setAttribute("aria-disabled", String(off));
    b.title = fresh(t)
      ? "A new conversation already: nothing was said since it began"
      : `New conversation: what was said so far folds away, and the next session of ${a.name ?? "the agent"} starts without it. A session running now is told to disregard it, but keeps what it was told: only /clear in its own terminal erases that.`;
  }

  /** The pill the window collapses to: the channel on show and the start of its last message. */
  private renderPill(): void {
    const el = this.el.querySelector<HTMLElement>(".fl-pill-text");
    if (!el) return;
    const a = this.agentOf(this.channel);
    const t = a?.talk;
    const last = (this.threads.get(this.channel) ?? []).findLast((m) => m.kind !== "divider");
    const state = !t ? "" : t.state === "thinking" ? `thinking · ${elapsed(t.since)}` : t.state;
    el.innerHTML =
      (a ? `<span class="st-dot${t ? ` st-${t.state}` : ""}"></span>${BOT}<b>${escapeHtml(a.name ?? "")}</b><span class="fl-pill-state">${escapeHtml(state)}</span>` : `<b>Everyone</b>`) +
      (last ? `<span class="fl-pill-msg">${escapeHtml(`${last.from}: ${excerpt(last.text)}`)}</span>` : "");
    el.parentElement?.setAttribute("title", `${t ? `${stateWords(t)}. ` : ""}Open the conversations`);
  }

  private scrollEnd(): void {
    const el = this.thread();
    el.scrollTop = el.scrollHeight;
    this.endTop = el.scrollTop;
    this.atEnd = true;
  }
}

/** A chip's inside, as a message and the box draw it: its words, the name in code, how many more. */
export function chipInner(c: Chip): string {
  const words = c.words.map(escapeHtml).join(" · ");
  const name = c.name ? `${words ? " · " : ""}<code>${escapeHtml(c.name)}</code>` : "";
  return `${LINK}<span class="cv-cl">${words}${name}${c.more ? ` +${c.more}` : ""}</span>`;
}

/** The reader's own agents among `peers`: the agents with a token whose token they made. */
export function ownAgents(peers: readonly Peer[], me: { name: string | null; person: string | null }): Peer[] {
  return peers.filter((p) => p.agent && p.talk && p.by !== undefined && madeBy({ by: p.by, makerPerson: p.byPerson }, me));
}

/** What the reader has not seen (`seen`: each channel's last id seen): how many public messages, not
 *  their own; and whether one mentions them, or one of their agents (`agents`) said something — in
 *  its private channel, or in public. */
export function unseen(threads: ReadonlyMap<string, readonly ChatMessage[]>, seen: Readonly<Record<string, number>>, me: string | null, agents: readonly string[]): { count: number; marked: boolean } {
  let count = 0;
  let marked = false;
  const mine = (m: ChatMessage) => m.kind !== "agent" && me !== null && sameName(m.from, me);
  const ownNames = new Set<string>();
  for (const id of agents) for (const m of threads.get(id) ?? []) if (m.kind === "agent") ownNames.add(m.from);
  for (const m of threads.get(PUBLIC) ?? []) {
    if (m.id <= (seen[PUBLIC] ?? 0) || m.kind === "divider" || mine(m)) continue;
    count++;
    if (me && m.mentions?.some((n) => sameName(n, me))) marked = true;
    if (m.kind === "agent" && ownNames.has(m.from)) marked = true;
  }
  for (const id of agents) for (const m of threads.get(id) ?? []) if (m.kind === "agent" && m.id > (seen[id] ?? 0)) marked = true;
  return { count, marked };
}

/** A message's HTML with its mentions marked (`@` and a name it mentions; the reader's own apart),
 *  in its text only, never inside a tag. */
export function markMentions(html: string, names: readonly string[], me: string | null): string {
  if (!names.length) return html;
  const sorted = [...names].sort((a, b) => b.length - a.length).map(escapeHtml);
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])@(${sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  return html
    .split(/(<[^>]*>)/)
    .map((part, k) => (k % 2 ? part : part.replace(re, (all, name: string) => `<span class="tk-at${me && sameName(unescape(name), me) ? " me" : ""}">${all}</span>`)))
    .join("");
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Two lists of a channel's messages as one: each once, by id, oldest first. */
export function merge(a: readonly ChatMessage[], b: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>();
  for (const m of [...b, ...a]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

function placeCaretAtEnd(el: HTMLElement): void {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/** A thread as the window shows it (the owner's decision of 2026-10-11): what came before its last
 *  divider (dividers among it), folded into one line that counts its messages; that divider; what
 *  came after. Without a divider, all of it is current. */
export function fold(messages: ChatMessage[]): { earlier: ChatMessage[]; count: number; divider: ChatMessage | null; current: ChatMessage[] } {
  const k = messages.findLastIndex((m) => m.kind === "divider");
  if (k < 0) return { earlier: [], count: 0, divider: null, current: messages };
  const earlier = messages.slice(0, k);
  return { earlier, count: earlier.filter((m) => m.kind !== "divider").length, divider: messages[k], current: messages.slice(k + 1) };
}

/** Nothing was said since the conversation last began, or ever: a new one would divide nothing. */
export function fresh(messages: readonly ChatMessage[]): boolean {
  return !messages.length || messages.at(-1)!.kind === "divider";
}

/** The start of a message as one line of plain text, for the collapsed window's pill: fenced code
 *  an ellipsis, the Markdown's marks dropped, at most `max` characters. */
export function excerpt(text: string, max = 120): string {
  const flat = text
    .replace(/```[\s\S]*?(```|$)/g, " … ")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** "12 s", "4 min", "1 h 5 min": how long since `iso`. */
export function elapsed(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 90) return `${Math.floor(s)} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** An agent's state line as HTML: its state, how long it has been thinking, and what it does — its
 *  own line where it set one, else what its requests show — with names as links. */
export function stateLine(t: AgentTalk, resolve: (name: string) => string | null, now = Date.now()): string {
  const parts: string[] = [t.state];
  if (t.state === "thinking") parts.push(elapsed(t.since, now));
  const what = t.status ?? t.doing;
  const busy = t.state === "thinking" || t.state === "working";
  const out = parts.map(escapeHtml);
  if (busy && what) out.push(renderMarkdown(what, resolve));
  if (t.state === "offline") out.push(t.lastSeen ? `last seen ${escapeHtml(ago(t.lastSeen))}` : "not seen yet");
  return out.join(" · ");
}

/** The same in plain words, for a tooltip. */
export function stateWords(t: AgentTalk, now = Date.now()): string {
  const what = (t.status ?? t.doing)?.replace(/`/g, "");
  switch (t.state) {
    case "listening":
      return "listening: what you write reaches it at once";
    case "thinking":
      return `thinking for ${elapsed(t.since, now)}${what ? `: ${what}` : ""}`;
    case "working":
      return `working${what ? `: ${what}` : ""}; what you write waits for its next wait`;
    default:
      return `offline${t.lastSeen ? `, last seen ${ago(t.lastSeen)}` : ", not seen yet"}`;
  }
}
