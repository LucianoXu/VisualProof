// Sharing (2026-10-07; with agents since 2026-10-08, AgentSpec decision 7; inviting a person since
// 2026-10-09, CollabSpec decision 9; read-only links since 2026-10-14, decision 11): a small window
// with four tabs.
//
// *Guest link* (decision 7's *Public link*, renamed: it makes guests): a link to this page as it is
// now — the view, what is lit and selected, as the address holds them — that lets whoever receives
// it in. On a server that lets in only those given its link (server/access.ts), the server hands a
// page it let in that link's path, `/k/<key>`, and the page's place goes after it as a fragment,
// which the browser keeps across the link's redirect. The link is copied at once; where the browser
// will not (over plain HTTP the clipboard API is not offered, and the old way may be refused too) it
// is shown selected, to be copied by hand.
//
// *Read-only link* (server/readonly.ts): a link that shows the project and lets its holder change
// nothing that is shared, nor be seen. Anyone let in makes one; it lasts until revoked, and is
// listed below to be shown again or revoked. With `--public` the address alone is read-only, and is
// the link. A read-only reader's Share holds this tab alone and gives the link they came by. A server
// open to all, or behind a sign-in, has no such tab.
//
// *Exactly what I see* (the owner's decision of 2026-10-12), a switch on by default and kept in the
// browser: the links Share makes — the guest link, a read-only link, a personal link — carry after
// the address a snapshot of everything followed (shared/sharesnap.ts), the camera as the region of
// the board it shows, which the page that opens the link applies once. Off, they carry the address
// alone: only the view.
//
// *AI agent*: a prompt any agent able to make HTTP requests can act on alone, carrying a token of the
// agent's own (server/tokens.ts) — never the key. The person names the agent ("<their name>'s AI"
// unless they write another) and chooses what it may do and for how long; the server makes the
// token under the person's name and writes the prompt (server/prompt.ts). What they want done they
// tell the agent themselves.
//
// *Invite a person*: a personal link for one person, named by whoever invites them
// (server/invites.ts). It lets them in and says who they are: their name carries a ✓, nobody else
// can take it, and they can change it without what they did leaving them. The link is shown once,
// here, to be sent to that person; they find it again in the menu under their name, and nobody else
// does (the owner's decision of 2026-10-19, web/src/mylink.ts).
//
// Below the tabs, the read-only links in force, each with who made it, when and when it was last
// used, the link to be shown again, and a Revoke; the personal links in force, the same but for the
// link; then the agents' tokens in force, each with when it was last used, its prompt to be shown
// again to whoever made it (the token is in it, and whoever holds it reads the agent's private
// channel: the owner's decision of 2026-10-19), and a Revoke, anyone's.

import { defaultAgentName, madeBy, uniqueName } from "../../shared/collab.ts";
import type { AgentTokenInfo, PersonInvite } from "../../shared/collab.ts";
import { withSnapshot } from "../../shared/sharesnap.ts";
import { BOT } from "./agentmark.ts";
import type { AgentShares, DataSource, ReadOnlyLinkShown, ShareInfo } from "./data.ts";
import { escapeHtml } from "./highlight.ts";
import { focusBack, keepFocus } from "./keepfocus.ts";
import { ago } from "./reviewbox.ts";
import { VERIFIED } from "./verified.ts";
import { composing } from "./ime.ts";

export interface ShareHooks {
  /** what this page may share: the link's path on this server (`/k/<key>`, or null where anyone who
   *  reaches it is let in; a read-only reader's own), and whether there are read-only links */
  info(): Promise<ShareInfo>;
  data: Pick<DataSource, "agentShares" | "shareAgent" | "agentPrompt" | "revokeAgent" | "invites" | "invite" | "revokeInvite" | "readOnlyLinks" | "makeReadOnly" | "revokeReadOnly">;
  /** the reader's name as the page knows it, for the agent's default name; null when there is none */
  me(): string | null;
  /** the personal link the reader came by (CollabSpec decision 9), or null: with the name, which
   *  tokens are theirs, whose prompts they are shown again (AgentSpec decision 7) */
  person?(): string | null;
  /** the reader's name, asked for when there is none; null when they decline */
  ensureName(): Promise<string | null>;
  /** what the reader sees, as a link's snapshot carries it after `snap=`; null where none is made */
  snapshot(): Promise<string | null>;
  /** whether the links carry it: "Exactly what I see", on unless this browser turned it off */
  exact: { get(): boolean; set(on: boolean): void };
}

/** what a link carries, as the switch below the link says it */
const EXACT_ON = "Opens once on exactly what you see now; then it is theirs.";
const EXACT_OFF = "Opens on the view and its selection.";

const LEVEL_HINT: Record<string, string> = {
  read: "read — it only reads",
  advise: "advise — advice and notes",
  // what a person can do in the page, but its opinions stay advice (AgentSpec decision 9)
  full: "full — whatever you can do here",
};

/** What the agent tab shows: the form, or a token's prompt — just made (`made`), or shown again from
 *  the list. */
type AgentState = { kind: "form"; error: string | null } | { kind: "prompt"; id: string; prompt: string; name: string; made: boolean; copied: boolean };

/** What the invite tab shows: the form, or the personal link just made, shown this once: as the server
 *  made it (`base`), and with the address after it (`link`), which the switch decides. */
type InviteState = { kind: "form"; error: string | null } | { kind: "link"; id: string; name: string; base: string; link: string; copied: boolean };

/** What the read-only tab shows: the form, or a link — just made (`made`), or shown again from the
 *  list — as the server made it (`base`) and with the address after it (`link`). */
type ReadOnlyState = { kind: "form"; error: string | null } | { kind: "link"; id: string; base: string; link: string; made: boolean; copied: boolean };

type Tab = "person" | "readonly" | "invite" | "agent";

export class Share {
  private btn: HTMLElement;
  private pop: HTMLElement;
  private hooks: ShareHooks;
  private known: Promise<ShareInfo> | null = null;
  /** what the server said this page may share, once the window has opened */
  private info: ShareInfo = { path: null };
  private tab: Tab = "person";
  /** the person's link as last shown, and whether it was copied */
  private person = { url: "", copied: false };
  /** the read-only tab; for a read-only reader, their own link */
  private readOnly: ReadOnlyState = { kind: "form", error: null };
  /** the read-only links in force, when the window last opened; null where there are none to have */
  private readOnlyLinks: ReadOnlyLinkShown[] | null = null;
  private agent: AgentState = { kind: "form", error: null };
  /** the invite tab, and the name typed there, kept while the page is open: a link just made stays
   *  on show until the reader asks for another, so that closing the window does not lose it */
  private invite: InviteState = { kind: "form", error: null };
  private inviteName = "";
  /** what the server said about sharing with agents, when the window last opened */
  private shares: AgentShares | null = null;
  /** the personal links in force, when the window last opened; null where there are none to have */
  private people: PersonInvite[] | null = null;
  /** the form as the reader left it: kept while the page is open; the name is null while the reader
   *  has not written one, and the agent is then theirs ("Alice's AI") */
  private form: { name: string | null; level: string; days: number } = { name: null, level: "", days: 0 };
  /** a Revoke pressed once, waiting for the second press */
  private arming: string | null = null;
  private busy = false;

  constructor(btn: HTMLElement, pop: HTMLElement, hooks: ShareHooks) {
    this.btn = btn;
    this.pop = pop;
    this.hooks = hooks;
    btn.addEventListener("click", () => (pop.hidden ? void this.open() : this.close()));
    pop.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>("[data-tab]");
      if (tab) return void this.show(tab.dataset.tab as Tab);
      if (t.closest("[data-exact]")) void this.setExact(!this.hooks.exact.get());
      else if (t.closest("[data-copy]")) void this.copyAgain(".sh-url", "[data-copy]");
      else if (t.closest("[data-copy-invite]")) void this.copyAgain(".sh-invite-url", "[data-copy-invite]");
      else if (t.closest("[data-copy-ro]")) void this.copyAgain(".sh-ro-url", "[data-copy-ro]");
      else if (t.closest("[data-ro-create]")) void this.makeReadOnly();
      else if (t.closest("[data-ro-again]")) {
        this.readOnly = { kind: "form", error: null };
        void this.show("readonly");
      } else if (t.closest("[data-ro-show]")) void this.showReadOnly(t.closest<HTMLElement>("[data-ro-show]")!.dataset.roShow!);
      else if (t.closest("[data-revoke-ro]")) void this.revokeReadOnly(t.closest<HTMLElement>("[data-revoke-ro]")!.dataset.revokeRo!);
      else if (t.closest("[data-invite-create]")) void this.makeInvite();
      else if (t.closest("[data-invite-again]")) {
        this.invite = { kind: "form", error: null };
        this.inviteName = "";
        void this.show("invite");
      } else if (t.closest("[data-revoke-invite]")) void this.revokeInvite(t.closest<HTMLElement>("[data-revoke-invite]")!.dataset.revokeInvite!);
      else if (t.closest("[data-copy-prompt]")) void this.copyAgain(".sh-prompt", "[data-copy-prompt]");
      else if (t.closest("[data-create]")) void this.create();
      else if (t.closest("[data-again]")) {
        this.agent = { kind: "form", error: null };
        this.render();
      } else if (t.closest("[data-show]")) void this.showPrompt(t.closest<HTMLElement>("[data-show]")!.dataset.show!);
      else if (t.closest("[data-revoke]")) void this.revoke(t.closest<HTMLElement>("[data-revoke]")!.dataset.revoke!);
      else if (t.closest("[data-close]")) this.close();
    });
    // the form is kept as it is typed, so that a re-render (the list refreshed) loses nothing
    pop.addEventListener("input", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.f === "invite") return void (this.inviteName = t.value);
      const f = t.dataset.f as keyof Share["form"] | undefined;
      if (!f) return;
      if (f === "days") this.form.days = Number(t.value);
      else this.form[f] = t.value;
      // the name the agent will act under, said below the form, follows what is typed
      const as = this.pop.querySelector<HTMLElement>("[data-as]");
      if (f === "name" && as) as.textContent = this.actsAs(t.value);
    });
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      } else if (e.key === "Enter" && !composing(e) && (e.target as HTMLElement).dataset.f === "invite") {
        e.preventDefault();
        void this.makeInvite();
      }
    });
    document.addEventListener("pointerdown", (e) => {
      const t = e.target as Element;
      // the window asking for a name, opened from here, does not close it
      if (!pop.hidden && !pop.contains(t) && !btn.contains(t) && !t.closest?.("#modal")) this.close();
    });
  }

  /** What the server says this page may share, asked once. */
  private shareInfo(): Promise<ShareInfo> {
    return (this.known ??= this.hooks.info().catch(() => ({ path: null })));
  }

  /** The link to this page as it is now: for a read-only reader, the link they came by. */
  async link(): Promise<string> {
    const { path } = await this.shareInfo();
    return `${location.origin}${path ?? "/"}${await this.fragment()}`;
  }

  /** What a link carries after `#`: the address, and with Exactly what I see the snapshot of what the
   *  reader sees after it. */
  private async fragment(): Promise<string> {
    if (!this.hooks.exact.get()) return location.hash;
    const snap = await this.hooks.snapshot().catch(() => null);
    return snap ? withSnapshot(location.hash, snap) : location.hash;
  }

  /** Exactly what I see switched: kept in this browser, and the link on show made again and copied,
   *  as showing it copies it; the keys stay on the switch. */
  private async setExact(on: boolean): Promise<void> {
    this.hooks.exact.set(on);
    const i = this.invite;
    const ro = this.readOnly;
    if (this.tab === "person") {
      const url = await this.link();
      this.person = { url, copied: await copy(url) };
    } else if (this.tab === "readonly" && ro.kind === "link") {
      const link = ro.base + (await this.fragment());
      this.readOnly = { ...ro, link, copied: await copy(link) };
    } else if (this.tab === "invite" && i.kind === "link") {
      const link = i.base + (await this.fragment());
      this.invite = { ...i, link, copied: await copy(link) };
    }
    this.render();
    this.pop.querySelector<HTMLElement>("[data-exact]")?.focus();
  }

  /** The switch, and what the links carry by it. */
  private exactRow(): string {
    const on = this.hooks.exact.get();
    return (
      `<button type="button" class="sh-exact" role="switch" aria-checked="${on}" data-exact title="What the links carry: everything you see, or only the view"><span class="sh-switch" aria-hidden="true"></span>Exactly what I see</button>` +
      `<div class="sh-note muted">${on ? EXACT_ON : EXACT_OFF}</div>`
    );
  }

  async open(): Promise<void> {
    this.pop.hidden = false;
    this.btn.classList.add("on");
    this.arming = null;
    if (this.agent.kind === "prompt") this.agent = { kind: "form", error: null };
    this.info = await this.shareInfo();
    // a read-only reader shares the link they came by, and nothing else (CollabSpec decision 11)
    if (this.info.readOnly) return this.show("readonly");
    if (this.tab === "readonly" && !this.readOnlyTab()) this.tab = "person";
    // a read-only link shown again is not left on show, as a prompt is not
    if (this.readOnly.kind === "link" && !this.readOnly.made) this.readOnly = { kind: "form", error: null };
    await this.show(this.tab);
    void this.refresh();
  }

  /** Whether this server has a read-only tab: it makes read-only links, or anyone may read it. */
  private readOnlyTab(): boolean {
    return !!(this.info.readOnly || this.info.readOnlyLinks || this.info.public);
  }

  /** Show a tab. The person's link is copied as the tab shows, as Share always did. */
  private async show(tab: Tab): Promise<void> {
    this.tab = tab;
    if (tab === "person") {
      const url = await this.link();
      this.person = { url, copied: await copy(url) };
      this.render();
      const input = this.pop.querySelector<HTMLInputElement>(".sh-url");
      input?.focus();
      input?.select();
    } else if (tab === "readonly") {
      // the reader's own link, or the address where anyone may read (unless a link of the list is
      // shown again): shown and copied as the guest link is
      const listed = this.readOnly.kind === "link" && this.readOnly.id !== "";
      if (this.info.readOnly || (this.info.public && !listed)) {
        const base = `${location.origin}${this.info.readOnly ? (this.info.path ?? "/") : "/"}`;
        const link = base + (await this.fragment());
        this.readOnly = { kind: "link", id: "", base, link, made: false, copied: await copy(link) };
      }
      this.render();
      const input = this.pop.querySelector<HTMLInputElement>(".sh-ro-url");
      input?.focus();
      input?.select();
    } else if (tab === "invite") {
      this.render();
      const field = this.pop.querySelector<HTMLInputElement>(this.invite.kind === "link" ? ".sh-invite-url" : "[data-f=invite]");
      field?.focus();
      if (this.invite.kind === "link") field?.select();
    } else {
      this.render();
      this.pop.querySelector<HTMLInputElement>("[data-f=name]")?.focus();
    }
  }

  /** The tokens and the personal links in force, and what a new token may be, from the server. */
  private async refresh(): Promise<void> {
    if (this.info.readOnly) return;
    let links: ReadOnlyLinkShown[] | null;
    [this.shares, this.people, links] = await Promise.all([this.hooks.data.agentShares(), this.hooks.data.invites(), this.info.readOnlyLinks ? this.hooks.data.readOnlyLinks() : null]);
    this.readOnlyLinks = links && links.filter((l) => !l.revoked);
    // a read-only link on show that was revoked meanwhile goes with it
    const ro = this.readOnly;
    if (ro.kind === "link" && ro.id && this.readOnlyLinks && !this.readOnlyLinks.some((l) => l.id === ro.id)) this.readOnly = { kind: "form", error: null };
    // a personal link on show that was revoked meanwhile goes with it
    const i = this.invite;
    if (i.kind === "link" && this.people && !this.people.some((p) => p.id === i.id)) this.invite = { kind: "form", error: null };
    if (this.shares) {
      if (!this.shares.levels.includes(this.form.level)) this.form.level = this.shares.defaultLevel;
      if (!this.shares.days.includes(this.form.days)) this.form.days = this.shares.defaultDays;
      // a prompt on show whose token ended meanwhile (revoked elsewhere) goes with it
      const a = this.agent;
      if (a.kind === "prompt" && !this.shares.tokens.some((t) => t.id === a.id)) this.agent = { kind: "form", error: null };
    }
    if (!this.pop.hidden) this.render();
  }

  /** Draw the window: the tabs, the tab shown, the tokens in force. */
  private render(): void {
    const focus = document.activeElement instanceof HTMLElement && this.pop.contains(document.activeElement) ? document.activeElement.dataset.f : undefined;
    const tab = (t: Tab, title: string, label: string) => `<button role="tab" data-tab="${t}" aria-selected="${this.tab === t}" title="${title}">${label}</button>`;
    const roTab = tab("readonly", "A link that shows the project: whoever has it changes nothing and is not seen", "Read-only link");
    const tabs = this.info.readOnly
      ? `<div class="sh-tabs" role="tablist">${roTab}</div>`
      : `<div class="sh-tabs" role="tablist">` +
        tab("person", "One link for everyone: whoever has it comes in as a guest", "Guest link") +
        (this.readOnlyTab() ? roTab : "") +
        tab("invite", "A link for one person, with a verified name", "Invite a person") +
        tab("agent", "A token of its own for an AI agent", `${BOT}AI agent`) +
        `</div>`;
    let body: string;
    if (this.tab === "person") {
      const { url, copied } = this.person;
      const keyed = new URL(url, location.href).pathname.startsWith("/k/");
      body =
        `<input class="sh-url" readonly value="${escapeHtml(url)}" aria-label="The link" spellcheck="false">` +
        this.exactRow() +
        `<div class="sh-note muted">${copied ? "Copied. " : ""}` +
        (keyed ? "Anyone with it comes in as a guest." : "This server lets in anyone who can reach it.") +
        `</div>` +
        `<div class="modal-actions"><button class="rv-btn" data-close>Close</button><button class="rv-btn primary" data-copy>${copied ? "Copy again" : "Copy"}</button></div>`;
    } else body = this.tab === "readonly" ? this.readOnlyBody() : this.tab === "invite" ? this.inviteBody() : this.agentBody();
    // drawn again (the lists come from the server after the window opened): the focus stays where
    // it was in it, so that the keyboard keeps its place and Esc still closes it
    keepFocus(this.pop, () => (this.pop.innerHTML = tabs + `<div class="sh-body">${body}</div>` + this.readOnlyList() + this.peopleList() + this.tokenList()));
    if (focus) this.pop.querySelector<HTMLElement>(`[data-f=${focus}]`)?.focus();
  }

  /** The read-only tab: for a read-only reader the link they came by; where anyone may read, the
   *  address; else a link made, or shown again, or the button that makes one. */
  private readOnlyBody(): string {
    const r = this.readOnly;
    if (r.kind === "link") {
      // a read-only reader let in by --public came by the address alone
      const byAddress = this.info.readOnly && this.info.path === "/";
      const note = byAddress
        ? "Anyone who reaches this server may read the project: the address is the read-only link."
        : this.info.readOnly
          ? "The link you came by: it shows the project to whoever has it, read-only. Whoever made it can revoke it, which ends every page it opened."
          : this.info.public
          ? "This server lets anyone who reaches it read the project (it runs with --public): the address is the read-only link."
          : `Whoever has it sees what a guest sees, changes nothing and is not seen. It lasts until revoked below.${r.made ? "" : " Shown again."}`;
      return (
        `<input class="sh-url sh-ro-url" readonly value="${escapeHtml(r.link)}" aria-label="The read-only link" spellcheck="false">` +
        this.exactRow() +
        `<div class="sh-note muted">${r.copied ? "Copied. " : ""}${note}</div>` +
        `<div class="modal-actions">${r.id ? `<button class="rv-btn" data-ro-again>${this.info.public ? "The address" : "Another link"}</button>` : `<button class="rv-btn" data-close>Close</button>`}<button class="rv-btn primary" data-copy-ro>${r.copied ? "Copy again" : "Copy"}</button></div>`
      );
    }
    return (
      `<div class="sh-note muted">Anyone with it can look, unseen, and change nothing, until you revoke it.</div>` +
      this.exactRow() +
      (r.error ? `<div class="modal-err">${escapeHtml(r.error)}</div>` : "") +
      `<div class="modal-actions"><button class="rv-btn" data-close>Close</button><button class="rv-btn primary" data-ro-create${this.busy ? " disabled" : ""}>Create link</button></div>`
    );
  }

  /** The read-only links in force: who made each and when, when it was last used, the link shown
   *  again on a click on it, and Revoke. */
  private readOnlyList(): string {
    const ls = this.readOnlyLinks ?? [];
    if (!ls.length || this.info.readOnly) return "";
    return `<div class="sh-tokens"><div class="sh-sub">Read-only links</div>${ls.map((l) => this.readOnlyRow(l)).join("")}</div>`;
  }

  private readOnlyRow(l: ReadOnlyLinkShown): string {
    const armed = this.arming === `r:${l.id}`;
    const shown = this.tab === "readonly" && this.readOnly.kind === "link" && this.readOnly.id === l.id;
    const id = escapeHtml(l.id);
    return (
      `<div class="sh-tok${shown ? " on" : ""}">` +
      `<div class="sh-tok-text" data-ro-show="${id}" title="Show the link again"><div><b>Read-only link</b> <span class="sh-lvl">${id}</span></div>` +
      `<div class="muted">${l.by ? `by ${escapeHtml(l.by)}, ` : ""}${escapeHtml(ago(l.created))} · ${l.lastUsed ? `last used ${escapeHtml(ago(l.lastUsed))}` : "not used yet"}</div></div>` +
      `<button class="rv-btn sh-act" data-ro-show="${id}" aria-pressed="${shown}" title="The link, to give again">Show link</button>` +
      `<button class="rv-btn sh-act${armed ? " bad" : ""}" data-revoke-ro="${id}" title="It lets nobody in any more, and the pages it opened close, at once">${armed ? "Revoke it" : "Revoke"}</button>` +
      `</div>`
    );
  }

  /** Make a read-only link: under the reader's name if they have one (none is asked for). */
  private async makeReadOnly(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const r = await this.hooks.data.makeReadOnly();
    this.busy = false;
    if ("error" in r) {
      this.readOnly = { kind: "form", error: r.error };
      return this.render();
    }
    this.readOnlyLinks = r.links.filter((l) => !l.revoked);
    const link = r.made.link + (await this.fragment());
    this.readOnly = { kind: "link", id: r.made.id, base: r.made.link, link, made: true, copied: await copy(link) };
    await this.show("readonly");
  }

  /** Show a read-only link again, in its tab, copied as showing a link copies it. */
  private async showReadOnly(id: string): Promise<void> {
    this.arming = null;
    const l = this.readOnlyLinks?.find((x) => x.id === id);
    if (!l) return;
    const link = l.link + (await this.fragment());
    this.readOnly = { kind: "link", id, base: l.link, link, made: false, copied: await copy(link) };
    await this.show("readonly");
  }

  /** Revoke a read-only link, under the reader's name: the first press arms the button, the
   *  second revokes. */
  private async revokeReadOnly(id: string): Promise<void> {
    if (this.arming !== `r:${id}`) {
      this.arming = `r:${id}`;
      return this.render();
    }
    this.arming = null;
    if (!(await this.hooks.ensureName())) return;
    const r = await this.hooks.data.revokeReadOnly(id);
    if (this.readOnly.kind === "link" && this.readOnly.id === id) this.readOnly = { kind: "form", error: null };
    if (r.links) this.readOnlyLinks = r.links.filter((l) => !l.revoked);
    else await this.refresh();
    this.render();
  }

  /** The invite tab: a name, and the personal link made for it, shown this once. */
  private inviteBody(): string {
    const i = this.invite;
    if (i.kind === "link") {
      const who = escapeHtml(i.name);
      return (
        `<div class="sh-title">The personal link for ${who}${VERIFIED}</div>` +
        `<input class="sh-url sh-invite-url" readonly value="${escapeHtml(i.link)}" aria-label="The personal link" spellcheck="false">` +
        this.exactRow() +
        `<div class="sh-note muted">${i.copied ? "Copied. " : ""}For ${who} alone: it signs them in as ${who}${VERIFIED}. Shown to you only now; ${who} finds it again under their name.</div>` +
        `<div class="modal-actions"><button class="rv-btn" data-invite-again>Another person</button><button class="rv-btn primary" data-copy-invite>${i.copied ? "Copy again" : "Copy"}</button></div>`
      );
    }
    if (this.people === null) return `<div class="sh-note muted">This server makes no personal links now (behind a sign-in, names are the sign-in's).</div>`;
    return (
      `<div class="sh-form"><label class="sh-field"><span>Name</span><input data-f="invite" maxlength="60" spellcheck="false" value="${escapeHtml(this.inviteName)}" placeholder="The person's name"></label></div>` +
      `<div class="sh-note muted">For one person: their name gets a ✓ nobody else can take.</div>` +
      this.exactRow() +
      (i.error ? `<div class="modal-err">${escapeHtml(i.error)}</div>` : "") +
      `<div class="modal-actions"><button class="rv-btn" data-close>Close</button><button class="rv-btn primary" data-invite-create${this.busy ? " disabled" : ""}>Create link</button></div>`
    );
  }

  /** The personal links in force: who each is for (and was called), who made it and when, when it
   *  was last used, and Revoke. */
  private peopleList(): string {
    const ps = this.people ?? [];
    if (!ps.length) return "";
    return `<div class="sh-tokens"><div class="sh-sub">People with a personal link</div>${ps.map((p) => personRow(p, this.arming === `p:${p.id}`)).join("")}</div>`;
  }

  /** Make a personal link for the name typed, under the reader's name (asked for if there is none). */
  private async makeInvite(): Promise<void> {
    if (this.busy) return;
    const name = this.inviteName.trim();
    if (!name) {
      this.invite = { kind: "form", error: "Write the name of the person you invite." };
      return this.show("invite");
    }
    if (!(await this.hooks.ensureName())) {
      this.invite = { kind: "form", error: "A personal link is made under your name: give one first." };
      return this.render();
    }
    this.busy = true;
    this.render();
    const r = await this.hooks.data.invite(name);
    this.busy = false;
    if ("error" in r) {
      this.invite = { kind: "form", error: r.error };
      return this.show("invite");
    }
    this.people = r.invites;
    // the link takes the inviter's place after it, as the guest link does: what they see, or the view
    const link = r.link + (await this.fragment());
    this.invite = { kind: "link", id: r.invite.id, name: r.invite.name, base: r.link, link, copied: await copy(link) };
    this.inviteName = "";
    await this.show("invite");
  }

  /** Revoke a personal link: the first press arms the button, the second revokes. */
  private async revokeInvite(id: string): Promise<void> {
    if (this.arming !== `p:${id}`) {
      this.arming = `p:${id}`;
      return this.render();
    }
    this.arming = null;
    if (!(await this.hooks.ensureName())) return;
    const r = await this.hooks.data.revokeInvite(id);
    if (this.invite.kind === "link" && this.invite.id === id) this.invite = { kind: "form", error: null };
    if (r.invites) this.people = r.invites;
    else await this.refresh();
    this.render();
  }

  private agentBody(): string {
    const s = this.shares;
    if (this.agent.kind === "prompt") {
      const a = this.agent;
      const how = a.made
        ? `Paste it into the agent. <b>It holds the agent's token</b>: give it to that agent only, and revoke it below when done.`
        : `<b>It holds the agent's token</b>: give it to that agent only.`;
      return (
        `<div class="sh-title">The prompt for ${escapeHtml(a.name)}</div>` +
        `<textarea class="sh-prompt" readonly spellcheck="false" aria-label="The prompt">${escapeHtml(a.prompt)}</textarea>` +
        `<div class="sh-note muted">${a.copied ? "Copied. " : "Copy it from here. "}${how}</div>` +
        `<div class="modal-actions"><button class="rv-btn" data-again>Another agent</button><button class="rv-btn primary" data-copy-prompt>${a.copied ? "Copy again" : "Copy"}</button></div>`
      );
    }
    if (!s) return `<div class="sh-note muted">This server cannot be asked about agents now.</div>`;
    const f = this.form;
    const me = this.hooks.me();
    // the name as it will be: the reader's own, or their AI's, which follows their name until written over
    const name = f.name ?? (me ? defaultAgentName(me) : "");
    const option = (v: string | number, label: string, on: boolean) => `<option value="${v}"${on ? " selected" : ""}>${escapeHtml(label)}</option>`;
    return (
      `<div class="sh-form">` +
      `<label class="sh-field"><span>Name</span><input data-f="name" maxlength="60" spellcheck="false" value="${escapeHtml(name)}" placeholder="Your name's AI"></label>` +
      `<label class="sh-field"><span>May</span><select data-f="level">${s.levels.map((l) => option(l, LEVEL_HINT[l] ?? l, l === f.level)).join("")}</select></label>` +
      `<label class="sh-field"><span>For</span><select data-f="days">${s.days.map((d) => option(d, d === 1 ? "1 day" : `${d} days`, d === f.days)).join("")}</select></label>` +
      `</div>` +
      `<div class="sh-note muted">Its own token, under your name: it acts as <i data-as>${escapeHtml(this.actsAs(name))}</i>.${s.levels.length < 3 ? ` This server lets agents do at most ${escapeHtml(s.level)}.` : ""}</div>` +
      (this.agent.error ? `<div class="modal-err">${escapeHtml(this.agent.error)}</div>` : "") +
      `<div class="modal-actions"><button class="rv-btn" data-close>Close</button><button class="rv-btn primary" data-create${this.busy ? " disabled" : ""}>Create</button></div>`
    );
  }

  /** The name an agent named `name` would act under: the reader's AI when the field is empty,
   *  numbered when one in force has it. */
  private actsAs(name: string): string {
    const me = this.hooks.me();
    const n = name.trim() || (me ? defaultAgentName(me) : "");
    return n ? uniqueName(n, this.shares?.tokens.map((t) => t.name) ?? []) : "your AI";
  }

  private tokenList(): string {
    const ts = this.shares?.tokens ?? [];
    if (!ts.length) return "";
    return (
      `<div class="sh-tokens"><div class="sh-sub">Agents with a token</div>` +
      ts.map((t) => this.tokenRow(t)).join("") +
      `</div>`
    );
  }

  /** A token in force: who it is for and from whom, its prompt shown again on a click on it (or on
   *  Show prompt) where the reader made it — whoever holds the token reads its agent's private
   *  channel (AgentSpec decision 7, the owner's decision of 2026-10-19) —, and Revoke, anyone's. */
  private tokenRow(t: AgentTokenInfo): string {
    const armed = this.arming === t.id;
    const shown = this.agent.kind === "prompt" && this.agent.id === t.id && this.tab === "agent";
    const id = escapeHtml(t.id);
    const mine = madeBy(t, { name: this.hooks.me(), person: this.hooks.person?.() ?? null });
    return (
      `<div class="sh-tok${shown ? " on" : ""}">` +
      `<div class="sh-tok-text"${mine ? ` data-show="${id}" title="Show its prompt again"` : ` title="Its prompt is shown again to ${escapeHtml(t.by)} alone, who made it"`}><div>${BOT}<b>${escapeHtml(t.name)}</b> <span class="sh-lvl">${escapeHtml(t.level)}</span></div>` +
      `<div class="muted">by ${escapeHtml(t.by)}, ${escapeHtml(ago(t.created))} · expires ${escapeHtml(until(t.expires))} · ${t.lastUsed ? `last used ${escapeHtml(ago(t.lastUsed))}` : "not used yet"}</div></div>` +
      (mine ? `<button class="rv-btn sh-act" data-show="${id}" aria-pressed="${shown}" title="Its prompt, with the token, to give the agent again">Show prompt</button>` : "") +
      `<button class="rv-btn sh-act${armed ? " bad" : ""}" data-revoke="${id}" title="It lets the agent in no more, at once">${armed ? "Revoke it" : "Revoke"}</button>` +
      `</div>`
    );
  }

  /** Make the token and its prompt, under the reader's name (asked for if there is none). */
  private async create(): Promise<void> {
    if (this.busy) return;
    const me = await this.hooks.ensureName();
    if (!me) {
      this.agent = { kind: "form", error: "A token is made under your name: give one first." };
      return this.render();
    }
    this.busy = true;
    this.render();
    const f = this.form;
    // no name written: the server names it the reader's AI, under the name just given if need be
    const r = await this.hooks.data.shareAgent({ name: f.name?.trim() || undefined, level: f.level, days: f.days });
    this.busy = false;
    if ("error" in r) {
      this.agent = { kind: "form", error: r.error };
      return this.render();
    }
    if (this.shares) this.shares.tokens = r.tokens;
    const copied = await copy(r.prompt);
    this.agent = { kind: "prompt", id: r.token.id, prompt: r.prompt, name: r.token.name, made: true, copied };
    this.showArea();
  }

  /** Show a token's prompt again, in the agent tab: the server keeps the token while it is in force
   *  (server/tokens.ts). Under the reader's name, as making one is. */
  private async showPrompt(id: string): Promise<void> {
    if (this.busy) return;
    this.arming = null;
    if (!(await this.hooks.ensureName())) {
      this.tab = "agent";
      this.agent = { kind: "form", error: "A token's prompt is shown under your name: give one first." };
      return this.render();
    }
    const r = await this.hooks.data.agentPrompt(id);
    this.tab = "agent";
    if ("error" in r) {
      this.agent = { kind: "form", error: r.error };
      this.render();
      return void this.refresh();
    }
    this.agent = { kind: "prompt", id, prompt: r.prompt, name: r.token.name, made: false, copied: false };
    this.showArea();
  }

  /** Draw the prompt on show, its text selected to be copied. */
  private showArea(): void {
    this.render();
    const area = this.pop.querySelector<HTMLTextAreaElement>(".sh-prompt");
    area?.focus();
    area?.select();
  }

  /** Revoke a token: the first press arms the button, the second revokes. */
  private async revoke(id: string): Promise<void> {
    if (this.arming !== id) {
      this.arming = id;
      return this.render();
    }
    this.arming = null;
    if (!(await this.hooks.ensureName())) return;
    const r = await this.hooks.data.revokeAgent(id);
    // its prompt, if on show, goes with it
    if (this.agent.kind === "prompt" && this.agent.id === id) this.agent = { kind: "form", error: null };
    if (r.tokens && this.shares) this.shares.tokens = r.tokens;
    else await this.refresh();
    this.render();
  }

  private async copyAgain(field: string, button: string): Promise<void> {
    const input = this.pop.querySelector<HTMLInputElement | HTMLTextAreaElement>(field);
    if (!input) return;
    const ok = await copy(input.value);
    const b = this.pop.querySelector<HTMLElement>(button)!;
    b.textContent = ok ? "Copied" : "Select it and copy";
    input.focus();
    input.select();
  }

  close(): void {
    // closed from inside it (Esc, Close): the focus goes back to Share
    focusBack(this.pop, this.btn);
    this.pop.hidden = true;
    this.btn.classList.remove("on");
    this.arming = null;
  }
}

/** A personal link in force, as Share lists it: who it is for, with the ✓ their name carries (and
 *  what they were called before, on hovering), who made it and when, when it was last used, and
 *  Revoke — `armed` once pressed, waiting for the second press. */
export function personRow(p: PersonInvite, armed: boolean): string {
  const was = [...new Set(p.names.map((n) => n.name).filter((n) => n !== p.name))];
  return (
    `<div class="sh-tok sh-person">` +
    `<div class="sh-tok-text"${was.length ? ` title="${escapeHtml(`Was called ${was.join(", ")}`)}"` : ""}><div><b>${escapeHtml(p.name)}</b>${VERIFIED}</div>` +
    `<div class="muted">invited by ${escapeHtml(p.by)}, ${escapeHtml(ago(p.created))} · ${p.lastUsed ? `last used ${escapeHtml(ago(p.lastUsed))}` : "not used yet"}</div></div>` +
    `<button class="rv-btn sh-act${armed ? " bad" : ""}" data-revoke-invite="${escapeHtml(p.id)}" title="Its link lets nobody in any more, at once">${armed ? "Revoke it" : "Revoke"}</button>` +
    `</div>`
  );
}

/** "in 7 d", for an expiry. */
function until(iso: string): string {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (!(s > 0)) return "now";
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86400)} d`;
}

/** Put `text` on the clipboard; false when the browser will not. */
export async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refused: the old way below
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
