// Talking with an agent (AgentSpec decision 8): following an agent that has a token of its own opens
// its conversation in a window whose title bar is the following strip (web/src/chatwin.ts, which
// moves, resizes and collapses it) — one conversation per agent, shared by everyone on the server,
// so every page following it shows the same thread — with a box to write in. A conversation the
// reader pinned stays open when following ends (web/src/talkpins.ts). It all sits inside
// `#following`, which the reader's own input never ends following from (web/src/people.ts), so
// typing and sending there leave the reader following. The thread fills the window and scrolls; the
// state line and the box stay at its foot. Collapsed, the window is a pill with the agent's state and
// the start of its last message, rendered here.
//
// Above the box, the agent's state as the server infers it from what the agent does: listening (a
// message reaches it at once), thinking (since when, and what its requests show it doing, or the
// line it set itself), working, or offline. What is written to an agent that is thinking or working
// waits for its next wait, and is marked so until then. An offline agent cannot be written to: the
// box is disabled, and says when it was last seen.
//
// People's messages are shown as they wrote them. An agent's are plain text with a little Markdown —
// **bold**, *italics*, `code`, fenced code — rendered from escaped text (web/src/markdown.ts), so
// that nothing it writes is ever HTML; a declaration's full name, in backticks or bare, is a link
// that goes there (the reader looks aside while still following: they go back when the agent next
// moves).
//
// A button in the title bar starts a new conversation (the owner's decision of 2026-10-11): a
// divider, which every page shows as "New conversation — started by X, <date>", with what came
// before it folded into one line ("Earlier conversation · N messages") that a click opens and folds
// again. The agent is handed a notice to disregard what came before, and a later session of it is
// told only what comes after; but a session running now keeps what it was told, which the page
// cannot take from it (only /clear in its own terminal does): the button's tooltip says so.

import type { AgentTalk, Peer, PresenceView } from "../../shared/collab.ts";
import { BOT } from "./agentmark.ts";
import type { ChatMessage, DataSource } from "./data.ts";
import { escapeHtml } from "./highlight.ts";
import { renderMarkdown } from "./markdown.ts";
import { ago } from "./reviewbox.ts";
import { composing } from "./ime.ts";

export interface TalkHooks {
  data: Pick<DataSource, "chat" | "sendChat" | "newChat">;
  /** the reader's name, asked for when there is none; null when they decline */
  ensureName(): Promise<string | null>;
  /** where this page is now: sent with a message, for the agent to know where it was written */
  place(): PresenceView;
  /** the declaration a name in an agent's message stands for — a full name, or a last component
   *  only one declaration has — or null */
  resolve(name: string): string | null;
  /** go to a declaration */
  go(name: string): void;
  /** the agent replied (the window, collapsed, marks its pill) */
  replied?(): void;
}

export class Talk {
  private box: HTMLElement;
  private hooks: TalkHooks;
  private agent: Peer | null = null;
  private messages: ChatMessage[] = [];
  /** what the reader was writing, per agent, while they followed someone else */
  private drafts = new Map<string, string>();
  private error: string | null = null;
  private sending = false;
  /** a new conversation being started */
  private restarting = false;
  /** the conversations before the last divider are shown, not folded into one line */
  private unfolded = false;
  /** the conversation being fetched, per agent: messages that come meanwhile are kept */
  private loading: string | null = null;
  /** counts the seconds of a thinking agent */
  private clock: ReturnType<typeof setInterval> | null = null;
  /** the reader is at the thread's end: it stays there when the thread grows or shrinks (the
   *  reader resizes the window); where they scrolled to otherwise, for when the window opens again
   *  from its pill */
  private atEnd = true;
  private top = 0;
  /** where the thread was last put at its end: the scroll that did it says nothing of the reader,
   *  even when it is told only once the thread has grown again (a window being resized) */
  private endTop = -1;
  /** `#following`: the title bar's state dot and the pill are there */
  private frame: HTMLElement | null;
  private sized: ResizeObserver | null = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.atEnd && this.scrollEnd());

  /** The drafts not empty, kept across a reload into a new version (web/src/reload.ts). */
  get keptDrafts(): [string, string][] {
    return [...this.drafts].filter(([, v]) => v.trim() !== "");
  }

  /** The drafts kept by the reload that made this page (UpdateSpec decision 8). */
  restoreDrafts(kept: [string, string][]): void {
    for (const [k, v] of kept) if (!this.drafts.has(k)) this.drafts.set(k, v);
  }

  constructor(box: HTMLElement, hooks: TalkHooks) {
    this.box = box;
    this.hooks = hooks;
    this.frame = box.closest<HTMLElement>("#following");
    // scroll events do not bubble: caught on the way down
    box.addEventListener(
      "scroll",
      (e) => {
        const t = e.target as HTMLElement;
        if (!t.classList?.contains("tk-thread") || !t.clientHeight || (this.atEnd && t.scrollTop === this.endTop)) return;
        this.atEnd = t.scrollHeight - t.scrollTop - t.clientHeight < 40;
        this.top = t.scrollTop;
      },
      true,
    );
    box.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.send();
    });
    box.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement;
      // Enter sends, Shift+Enter makes a new line
      if (t.matches("textarea") && e.key === "Enter" && !e.shiftKey && !composing(e)) {
        e.preventDefault();
        void this.send();
      }
    });
    box.addEventListener("input", (e) => {
      const t = e.target as HTMLTextAreaElement;
      if (t.matches("textarea") && this.agent) this.drafts.set(this.agent.id, t.value);
    });
    box.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-fold]")) return this.toggleFold();
      const a = t.closest<HTMLElement>("[data-decl]");
      if (a) {
        e.preventDefault();
        this.hooks.go(a.dataset.decl!);
      }
    });
    // the title bar's button (web/src/people.ts renders it, as the state's dot)
    this.frame?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-restart]")) void this.restart();
    });
  }

  /** The agent this reader follows now (null: none, or no agent that can be talked to). */
  async show(agent: Peer | null): Promise<void> {
    const was = this.agent;
    this.agent = agent;
    if (!agent) {
      this.box.hidden = true;
      this.messages = [];
      this.tick();
      return;
    }
    if (was?.id === agent.id) {
      // the same agent: its state line follows what it does; the box changes only with its state
      // (and, offline, when it was last seen), never with every request it makes, which would take
      // the caret from the reader; the thread, when a message was handed to it
      const a = was.talk, b = agent.talk;
      this.renderState();
      if (a?.state !== b?.state || (b?.state === "offline" && a?.lastSeen !== b?.lastSeen)) this.renderForm();
      if (a?.read !== b?.read) {
        this.renderThread();
        if (this.atEnd) this.scrollEnd();
      }
      return;
    }
    this.messages = [];
    this.error = null;
    this.unfolded = false;
    this.box.hidden = false;
    this.render();
    this.loading = agent.id;
    const r = await this.hooks.data.chat(agent.id);
    if (this.agent?.id !== agent.id) return;
    this.loading = null;
    const fetched = r?.messages ?? [];
    // what came while it was fetched, after what it holds
    const ids = new Set(fetched.map((m) => m.id));
    this.messages = [...fetched, ...this.messages.filter((m) => !ids.has(m.id))];
    if (!r) this.error = "The conversation could not be read.";
    this.render();
  }

  /** The title bar was drawn again (web/src/people.ts): its state's dot and its new conversation's
   *  button are dressed as the agent is. */
  dress(): void {
    this.renderState();
    this.renderRestart();
  }

  /** A message of some conversation, or a divider, as every page is told it. */
  add(agentId: string, m: ChatMessage): void {
    if (this.agent?.id !== agentId || this.messages.some((x) => x.id === m.id)) return;
    this.messages.push(m);
    // a new conversation folds what came before it, the reader's opening of it included
    if (m.kind === "divider") this.unfolded = false;
    // the thread follows a new message when the reader was at its end; a divider, always: what the
    // reader looked at folded away
    this.renderThread();
    if (this.atEnd || m.kind === "divider") this.scrollEnd();
    this.renderPill();
    this.renderRestart();
    if (m.kind === "agent") this.hooks.replied?.();
  }

  /** Start a new conversation, under the reader's name: the divider comes back, and to every page. */
  private async restart(): Promise<void> {
    const a = this.agent;
    if (!a || this.restarting || this.loading || fresh(this.messages)) return;
    if (!(await this.hooks.ensureName())) {
      this.error = "A new conversation is started under your name: give one first.";
      return this.renderForm();
    }
    this.restarting = true;
    this.renderRestart();
    const r = await this.hooks.data.newChat(a.id);
    this.restarting = false;
    if (this.agent?.id !== a.id) return;
    if ("error" in r) this.error = r.error;
    else {
      this.error = null;
      if (r.divider) this.add(a.id, r.divider);
    }
    this.renderForm();
    this.renderRestart();
  }

  /** Open the earlier conversations, or fold them again, the line that does it staying where it is
   *  on the screen. */
  private toggleFold(): void {
    const el = this.box.querySelector<HTMLElement>(".tk-thread");
    const was = el?.querySelector<HTMLElement>(".tk-fold")?.getBoundingClientRect().top;
    this.unfolded = !this.unfolded;
    this.renderThread();
    const line = el?.querySelector<HTMLElement>(".tk-fold");
    if (!el || !line) return;
    if (was !== undefined) el.scrollTop += line.getBoundingClientRect().top - was;
    this.atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    this.top = el.scrollTop;
    line.focus();
  }

  /** The window opened again from its pill: the thread where the reader left it, at its end if
   *  they were there. */
  revealed(): void {
    const el = this.box.querySelector<HTMLElement>(".tk-thread");
    if (!el) return;
    if (this.atEnd) this.scrollEnd();
    else el.scrollTop = this.top;
  }

  private async send(): Promise<void> {
    const a = this.agent;
    const area = this.box.querySelector<HTMLTextAreaElement>("textarea");
    if (!a || !area || this.sending || !a.talk || a.talk.state === "offline") return;
    const text = area.value.trim();
    if (!text) return;
    if (!(await this.hooks.ensureName())) {
      this.error = "A message is sent under your name: give one first.";
      return this.renderForm();
    }
    this.sending = true;
    const r = await this.hooks.data.sendChat(a.id, text, this.hooks.place());
    this.sending = false;
    if ("error" in r) {
      this.error = r.error === "offline" ? `${a.name} is offline: it can be written to once it listens again.` : r.error;
      return this.renderForm();
    }
    this.error = null;
    this.drafts.delete(a.id);
    this.add(a.id, r.message);
    this.renderForm();
    this.scrollEnd();
    this.box.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }

  private render(): void {
    this.box.innerHTML = `<div class="tk-thread" aria-live="polite"></div><div class="tk-state"></div><form class="tk-form"></form>`;
    this.sized?.disconnect();
    this.sized?.observe(this.box.querySelector(".tk-thread")!);
    this.atEnd = true;
    this.renderThread();
    this.renderState();
    this.renderForm();
    this.renderRestart();
    this.scrollEnd();
  }

  /** The title bar's button: a new conversation, unless nothing was said since the last one began.
   *  Never disabled outright, so that its tooltip still shows. */
  private renderRestart(): void {
    const b = this.frame?.querySelector<HTMLButtonElement>("[data-restart]");
    const a = this.agent;
    if (!b || !a) return;
    const who = a.name ?? "the agent";
    const off = !!this.loading || this.restarting || fresh(this.messages);
    b.setAttribute("aria-disabled", String(off));
    b.title = fresh(this.messages)
      ? "A new conversation already: nothing was said since it began"
      : `New conversation: what was said so far folds away, for everyone, and the next session of ${who} starts without it. A session running now is told to disregard it, but keeps what it was told: only /clear in its own terminal erases that.`;
  }

  /** The pill the window collapses to: the agent's state (a dot; thinking, for how long), its name
   *  and the start of its last message. */
  private renderPill(): void {
    const el = this.frame?.querySelector<HTMLElement>(".fl-pill-text");
    const a = this.agent;
    if (!el || !a) return;
    const t = a.talk;
    // its last message in this conversation: none since a divider is none
    let last: ChatMessage | undefined;
    for (let k = this.messages.length - 1; k >= 0 && !last && this.messages[k].kind !== "divider"; k--) if (this.messages[k].kind === "agent") last = this.messages[k];
    const state = !t ? "" : t.state === "thinking" ? `thinking · ${elapsed(t.since)}` : t.state;
    el.innerHTML =
      `<span class="st-dot${t ? ` st-${t.state}` : ""}"></span>${BOT}<b>${escapeHtml(a.name ?? "")}</b>` +
      `<span class="fl-pill-state">${escapeHtml(state)}</span>` +
      (last ? `<span class="fl-pill-msg">${escapeHtml(excerpt(last.text))}</span>` : "");
    el.parentElement?.setAttribute("title", `${t ? `${stateWords(t)}. ` : ""}Open the conversation`);
  }

  /** The agent's state line: "listening", "thinking · 12 s · reading `A.b`", the agent's own line,
   *  "offline · last seen 5 min ago". */
  private renderState(): void {
    const el = this.box.querySelector<HTMLElement>(".tk-state");
    const t = this.agent?.talk;
    if (!el) return;
    el.hidden = !t;
    if (t) {
      el.className = `tk-state st-${t.state}`;
      el.innerHTML = `<span class="st-dot"></span><span>${stateLine(t, (n) => this.hooks.resolve(n))}</span>`;
      el.title = stateWords(t);
    }
    // the same as a dot in the window's title bar, and in its pill
    const dot = this.frame?.querySelector<HTMLElement>(".fl-st");
    if (dot) {
      dot.className = `fl-st st-dot${t ? ` st-${t.state}` : ""}`;
      dot.title = t ? stateWords(t) : "";
    }
    this.renderPill();
    this.tick();
  }

  /** While the agent thinks, its line counts the seconds. */
  private tick(): void {
    const on = !this.box.hidden && this.agent?.talk?.state === "thinking";
    if (on && !this.clock) this.clock = setInterval(() => this.renderState(), 1000);
    else if (!on && this.clock) {
      clearInterval(this.clock);
      this.clock = null;
    }
  }

  /** The thread: what came before the last divider folded into one line, unless the reader opened
   *  it; the divider; what came after. */
  private renderThread(): void {
    const el = this.box.querySelector<HTMLElement>(".tk-thread");
    const a = this.agent;
    if (!el || !a) return;
    if (!this.messages.length) {
      el.innerHTML = `<div class="tk-empty muted">${this.loading ? "Reading the conversation…" : `No messages yet. What you write here goes to ${escapeHtml(a.name ?? "the agent")}, and everyone following it sees it.`}</div>`;
      return;
    }
    const f = fold(this.messages);
    const line = f.count
      ? `<button class="tk-fold" type="button" data-fold aria-expanded="${this.unfolded}"><span class="tk-chev" aria-hidden="true"></span>Earlier conversation · ${f.count} message${f.count === 1 ? "" : "s"}</button>`
      : "";
    el.innerHTML = line + (this.unfolded ? f.earlier : []).map((m) => this.message(m)).join("") + (f.divider ? this.message(f.divider) : "") + f.current.map((m) => this.message(m)).join("");
  }

  private message(m: ChatMessage): string {
    if (m.kind === "divider") {
      const when = new Date(m.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      return `<div class="tk-divider" role="separator" title="${escapeHtml(new Date(m.at).toLocaleString())}"><span>New conversation — started by <b>${escapeHtml(m.from)}</b>, ${escapeHtml(when)}</span></div>`;
    }
    const time = new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const where = m.where?.declaration ? ` · on ${escapeHtml(short(m.where.declaration))}` : "";
    const body = m.kind === "agent" ? renderMarkdown(m.text, (n) => this.hooks.resolve(n)) : escapeHtml(m.text);
    // a person's message the agent has not been handed yet: it comes out at its next wait
    const t = this.agent?.talk;
    const waiting = m.kind === "person" && t && m.id > t.read ? ` <span class="tk-wait" title="${escapeHtml(this.agent?.name ?? "The agent")} reads it when it next listens">· not read yet</span>` : "";
    return (
      `<div class="tk-msg ${m.kind}">` +
      `<div class="tk-head">${m.kind === "agent" ? BOT : ""}<b>${escapeHtml(m.from)}</b> <span class="muted" title="${escapeHtml(new Date(m.at).toLocaleString())}${m.where ? ` — ${escapeHtml(m.where.inWords)}` : ""}">${time}${where}</span>${waiting}</div>` +
      `<div class="tk-text">${body}</div>` +
      `</div>`
    );
  }

  private renderForm(): void {
    const form = this.box.querySelector<HTMLElement>(".tk-form");
    const a = this.agent;
    if (!form || !a) return;
    const focused = document.activeElement === form.querySelector("textarea");
    const t = a.talk;
    const off = !t || t.state === "offline";
    const who = a.name ?? "the agent";
    const placeholder = off
      ? `offline${t?.lastSeen ? ` — last seen ${ago(t.lastSeen)}` : ""}`
      : t.state === "listening"
        ? `Write to ${who} · Enter sends, Shift+Enter a new line`
        : `Write to ${who} · it reads this when it next listens`;
    form.innerHTML =
      `<textarea rows="2" maxlength="4000" spellcheck="true" aria-label="Your message" placeholder="${escapeHtml(placeholder)}"${off ? " disabled" : ""}>${escapeHtml(this.drafts.get(a.id) ?? "")}</textarea>` +
      `<button class="rv-btn primary" type="submit"${off || this.sending ? " disabled" : ""}>Send</button>` +
      (this.error ? `<div class="tk-err">${escapeHtml(this.error)}</div>` : "");
    if (focused && !off) form.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }

  private scrollEnd(): void {
    const el = this.box.querySelector<HTMLElement>(".tk-thread");
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    this.endTop = el.scrollTop;
  }
}

const short = (name: string) => name.split(".").pop() ?? name;

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
export function fresh(messages: ChatMessage[]): boolean {
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
