// The people on this server (CollabSpec.md): who this reader is — the name they give, or the one an
// authenticating proxy gives — and who else has a page open, where they are, and following them.
// Agents working through the API are among them (AgentSpec decision 1), each with its own mark: a
// rounded square with a robot on it, and "(agent)" wherever it is named; they are followed alike.
// An agent with a token of its own is listed while its token is in force (decision 8), with a dot for
// its state — listening, thinking, working, offline — and the state in words in its tooltip;
// following it opens a conversation with it (web/src/talk.ts) in a window the strip is the title bar
// of (web/src/chatwin.ts). Offline, it is greyed, with when it was last seen. The reader may pin that
// conversation from its title bar (web/src/talkpins.ts, the owner's decision of 2026-10-12): pinned,
// it stays open when following ends, its title bar then saying whom the reader talks with, and a
// Shift-click on the agent's badge opens it again without following.
//
// A reader may be private (CollabSpec decision 8), from the menu under their name (web/src/whomenu.ts):
// the page then says nothing of where they are — its heartbeat says only that it is here — and they
// are neither listed nor followed; the bar shows how many private readers there are ("+2 private").
//
// A reader who came by a personal link (CollabSpec decision 9) is who the link says: their name is
// the link's, changed through the server, and carries a ✓ here and wherever the others see it. A
// guest — who came by the key's link — gives any name but one a link's holder goes by: the server
// says so when the name is given, and the window asks for another.

import { colorOf, initials, validName } from "../../shared/collab.ts";
import type { Peer, PersonInvite, PresenceView, StreamHello } from "../../shared/collab.ts";
import { agentName, BOT } from "./agentmark.ts";
import { stateWords } from "./talk.ts";
import { closed, isPinned, opened, pin, readPins, shownTalk, unpin, writePins } from "./talkpins.ts";
import type { TalkPins } from "./talkpins.ts";
import type { DataSource } from "./data.ts";
import { escapeHtml } from "./highlight.ts";
import type { Store } from "./store.ts";
import { doubleClickActs, inYours, keyActs, pressActs, WHEEL } from "./surfaces.ts";
import { typing } from "./typing.ts";
import { VERIFIED } from "./verified.ts";
import { WhoMenu } from "./whomenu.ts";
import type { NameMode } from "./whomenu.ts";

const BEAT_MS = 10_000;
const IDLE_MS = 5 * 60_000;
/** initials shown before the rest are counted as "+N" */
const SHOWN = 5;

/** Where this reader's own name and visibility are changed, and a person's menu opened from their
 *  initials (web/src/peermenu.ts): nothing done there moves them, and Esc closes the menu first */
const MINE = "#who, #who-menu, #peer-menu";
/** the mark of a private reader beside their name */
const HIDDEN = `<svg class="who-hidden" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2.5 8s2-3.8 5.5-3.8S13.5 8 13.5 8 11.5 11.8 8 11.8 2.5 8 2.5 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.7" fill="currentColor"/><path d="M3 13 13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const COLLAPSE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 8.5h8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
/** a pushpin, as a source window's: the conversation pinned */
const PIN = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 2.5h4l-.6 4 2.1 2.2v.8H4.5v-.8L6.6 6.5 6 2.5zM8 9.5v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** a speech bubble with a plus: a new conversation */
const NEW_TALK = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.2 2.8h9.6c.7 0 1.2.5 1.2 1.2v6.2c0 .7-.5 1.2-1.2 1.2H7.4L4.5 13.8v-2.4H3.2c-.7 0-1.2-.5-1.2-1.2V4c0-.7.5-1.2 1.2-1.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 4.9v4.2M5.9 7h4.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

/** Whether the reader's own input ends following (CollabSpec decision 4, the owner's decision of
 *  2026-10-11): a change to what is followed, or acting on what a followed surface shows — read from
 *  the one list of the page's surfaces (web/src/surfaces.ts). What is the reader's own never ends
 *  it; nor does reading (decided 2026-10-08, at the owner's request): scrolling a list or the
 *  source, selecting text there, copying it, hovering. */
function acts(e: Event): boolean {
  const t = e.target instanceof Element ? e.target : null;
  if (e.type === "dblclick") return doubleClickActs(t);
  if (e instanceof KeyboardEvent) return keyActs(e, t, typing(t));
  // the wheel moves only the canvas; anywhere else it scrolls what is under it
  if (e.type === "wheel") return !!t?.closest(WHEEL);
  return pressActs(t);
}

export interface PeopleHooks {
  /** where this page is now */
  view(): PresenceView;
  /** a reader's view in words: "Review ★fermatLastTheoremFour, looking at not_fermat_42" */
  describe(view: PresenceView): string;
  /** go where a followed reader is */
  follow(view: PresenceView): void;
  /** the others moved, came or went */
  changed(): void;
  /** this reader's own name changed */
  renamed(): void;
  /** the agent whose conversation the window shows changed, or how it is (online, offline): the
   *  agent followed, where it has a token of its own, or, following nobody, the pinned one left
   *  open (web/src/talkpins.ts); null for none */
  talkTo(agent: Peer | null): void;
  /** following ended */
  unfollowed(): void;
  /** the conversation was asked for from its agent's badge: its window in front, expanded */
  reveal(): void;
  /** the title bar was drawn again: its state's dot and its new conversation's button are to be
   *  dressed (web/src/talk.ts) */
  stripDrawn(): void;
  // Asking others to follow (CollabSpec decision 10, web/src/askfollow.ts):
  /** Esc, while a request to follow this reader shows: whether it took it, as Not now */
  escape?(e: KeyboardEvent): boolean;
  /** a click on a person's initials: their menu opened (web/src/peermenu.ts); false for one that
   *  has none — an agent's, which a click follows */
  menu?(key: string, at: HTMLElement): boolean;
  /** what a person's initials show of this reader's request to follow: a mark, and what it says */
  asked?(p: { name: string | null; sessions: Peer[] }): { cls: string; glyph: string; tip: string } | null;
  /** ask everyone to follow this reader, and why they cannot now (the name's menu) */
  askAll?(): void;
  askWhy?(): string | null;
  /** say something in passing (the page's line) */
  say?(text: string): void;
}

/** What a read-only reader is told of whatever would change what is shared (CollabSpec decision 11). */
export const READ_ONLY = "This page is read-only: it changes nothing that is shared.";

/** One person on the page: their sessions folded into one, the liveliest first; or an agent. */
interface Person {
  key: string;
  name: string | null;
  sessions: Peer[];
  agent: boolean;
  /** invited by a personal link: the name is theirs (CollabSpec decision 9) */
  verified: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** Who a page or an agent is among the people: one person per name — an agent and a person of the
 *  same name are two, and so are a guest and someone invited by a personal link — and a page without
 *  a name on its own. An agent is its presence entry, which the server keeps one per token, or one
 *  per name for an agent without a token (server/presence.ts): an agent that gives the name of one
 *  with a token is another, so that nobody can speak for an agent with a token by giving its name
 *  (AgentSpec, "Presence") — lead the people following it, or take its conversation's place. What
 *  following follows, and a request to follow asks to follow (web/src/askfollow.ts). */
export function personKey(p: { id: string; name: string | null; agent?: boolean; verified?: boolean }): string {
  return p.agent ? `a:${p.id}` : p.name ? `${p.verified ? "v" : "n"}:${p.name}` : `s:${p.id}`;
}

/** The entry of a person who is an agent with a token of its own (it can be talked to unless it is
 *  offline), or null. */
function talkable(p: Person): Peer | null {
  const s = p.sessions[0];
  return p.agent && s.talk ? s : null;
}

/** A session id that needs no secure context (crypto.randomUUID does): what this page calls itself
 *  in its event stream's address, so that the server keeps its streams few; nobody else is told it. */
function newSession(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export class People {
  readonly session = newSession();
  /** this page's event stream as the server named it: the id the others know this page by, and
   *  the secret its heartbeats and arrangements carry (`hello`, server/live.ts); a new one with
   *  every (re)connection, null before the first */
  stream: StreamHello | null = null;
  /** how this reader's name is given: their page's own, the proxy's, their personal link's (whose
   *  name they change through the server), or none at all (a snapshot) */
  mode: NameMode = "declared";
  /** a read-only reader's page (CollabSpec decision 11): it gives no name, sends no heartbeat (so
   *  that nobody sees it), and writes nothing; it sees the others and may follow them. How it was
   *  let in: by a read-only link, or by --public; null for any other page. */
  readOnly: "link" | "public" | null = null;
  name: string | null = null;
  /** the personal link this reader came by (CollabSpec decision 9), or null */
  person: PersonInvite | null = null;
  /** why this reader has to give another name: the one this page kept is a link holder's, or their
   *  own link was revoked; said in the name's window when it next opens */
  private why: string | null = null;
  /** the others' pages */
  peers: Peer[] = [];
  private data: DataSource;
  private store: Store;
  private hooks: PeopleHooks;
  private followed: { key: string; name: string } | null = null;
  /** the agent whose conversation the window shows: the one followed, or the pinned one left open */
  private talking: Peer | null = null;
  /** the followed reader's place as last gone to: their place again (a presence list that changed
   *  elsewhere) is not gone to again, so that this reader may look aside — a link in a conversation
   *  — until they move */
  private applied = "";
  private lastInput = Date.now();
  /** finding out who this page is: what needs the name waits for it */
  private ready: Promise<void> = Promise.resolve();
  private wait: ReturnType<typeof setTimeout> | null = null;
  /** the reader is private (CollabSpec decision 8), as this browser keeps it */
  private hidden: boolean;
  /** how many private readers the server counts: this page among them once its hello says so */
  private privateAll = 0;
  private menu: WhoMenu;

  constructor(data: DataSource, store: Store, hooks: PeopleHooks) {
    this.data = data;
    this.store = store;
    this.hooks = hooks;
    this.hidden = store.data.private === true;
    // said from the first request on: nothing this page opens or arranges goes under its name
    data.privateSession = this.hidden ? this.session : null;
    this.menu = new WhoMenu($("#who"), $("#who-menu"), {
      mode: () => this.mode,
      name: () => this.name,
      visibility: () => (this.hidden ? "private" : "visible"),
      rename: () => void this.whoClicked(),
      setVisibility: (v) => this.setPrivate(v === "private"),
      ...(hooks.askAll ? { askAll: () => hooks.askAll!(), askWhy: () => hooks.askWhy?.() ?? null } : {}),
    });
  }

  // ---------------------------------------------------------------- who this reader is

  /** Find out how names are given here: the page's own (any name, changed at will, but one a
   *  personal link's holder goes by), the proxy's in front of the server, or the personal link this
   *  page came by. */
  init(): Promise<void> {
    this.ready = (async () => {
      const S = this.store.data;
      this.data.name = S.reviewer ?? null;
      const id = await this.data.identity();
      if (id.readOnly) {
        this.readOnly = id.readOnly.by;
        this.mode = "none";
        return this.setName(null);
      }
      this.person = id.person ?? null;
      if (this.person) {
        // the link says who this is: the page sends no name, its cookie says it
        this.mode = "person";
        this.why = null;
        return this.setName(this.person.name);
      }
      this.mode = id.mode;
      // a link revoked under this page, which the key still lets in: a guest from now on
      if (id.revoked) this.why = `Your personal link was revoked${id.revoked.by ? ` by ${id.revoked.by}` : ""}: you are here as a guest, under a name you give.`;
      else if (id.taken) this.why = id.taken;
      const kept = S.reviewer && validName(S.reviewer) && !id.taken ? S.reviewer : null;
      this.setName(id.mode === "declared" ? kept : id.name);
    })();
    return this.ready;
  }

  private setName(name: string | null): void {
    this.name = name;
    this.data.name = this.mode === "declared" ? name : null;
    if (this.mode === "declared") {
      this.store.data.reviewer = name ?? undefined;
      this.store.save();
    }
    this.renderMe();
    this.hooks.renamed();
    this.beat();
  }

  /** The server took no name from this page: it is asked for again on the next try. A page that
   *  came by a personal link asks who it is again: the link may have been revoked. */
  lost(): void {
    if (this.mode === "declared") this.setName(null);
    else if (this.mode === "person") void this.init();
  }

  /** The reader's name, asking for one (a modal window) when there is none; null if declined. */
  async ensure(): Promise<string | null> {
    await this.ready;
    if (this.readOnly) {
      this.hooks.say?.(READ_ONLY);
      return null;
    }
    if (this.name || this.mode !== "declared") return this.name;
    return this.ask("");
  }

  /** What arranging needs (a pin aside: a re-layout, a view made, an undo): a name, unless this
   *  reader is private — then nothing is recorded under one, and none is asked for (CollabSpec
   *  decision 8). False when the reader declined to give one. */
  async ensureLayout(): Promise<boolean> {
    await this.ready;
    if (this.readOnly) return (await this.ensure()) !== null;
    return this.hidden || (await this.ensure()) !== null;
  }

  /** Go private, or visible again, at once: the others are told by a heartbeat sent now, and this
   *  browser keeps the choice for every tab of it (`save` false: another tab made it). */
  setPrivate(on: boolean, save = true): void {
    if (on === this.hidden) return;
    this.hidden = on;
    this.data.privateSession = on ? this.session : null;
    if (save) {
      this.store.data.private = on || undefined;
      this.store.save();
    }
    this.renderMe();
    this.renderPeers();
    this.beat();
  }

  renderMe(): void {
    const who = $("#who");
    who.hidden = this.mode === "none";
    who.innerHTML = escapeHtml(this.name ?? (this.mode === "header" ? "Not signed in" : "Set your name")) + (this.mode === "person" ? VERIFIED : "") + (this.hidden ? HIDDEN : "");
    who.classList.toggle("unset", !this.name);
    who.classList.toggle("private", this.hidden);
    who.style.setProperty("--me", this.name ? colorOf(this.name) : "var(--text-3)");
    const records = this.hidden ? "Your opinions are recorded under this name; what you arrange, as someone's" : "Your opinions, pins and re-layouts are recorded under this name";
    who.title =
      (this.hidden ? "Private: the others see only that someone is here. " : "") +
      (this.mode === "header"
        ? "Your name, as the sign-in in front of this server gives it — click for your visibility"
        : this.mode === "person"
          ? `${records}; you came by a personal link, so it is yours (✓) — click to change it, or your visibility`
          : this.name
            ? `${records} — click to change it, or your visibility`
            : "Give the name your opinions are recorded under — click to give it, or for your visibility");
    this.menu.render();
  }

  /** The name's window, from the menu under it: give the name, or change it. */
  async whoClicked(): Promise<void> {
    await this.ready;
    if (this.mode === "declared" || this.mode === "person") await this.ask(this.name ?? "");
  }

  /** Ask for a name (a modal window); null when the reader declines. The server says whether it is
   *  theirs to take — a guest cannot take a link holder's — and, for someone who came by a personal
   *  link, keeps it with their link. */
  private ask(prefill: string): Promise<string | null> {
    return new Promise((done) => {
      const modal = $("#modal");
      const form = $<HTMLFormElement>("#who-form");
      const field = $<HTMLInputElement>("#who-input");
      const err = $("#who-err");
      const linked = this.mode === "person";
      $("#who-title").textContent = linked ? "Your name" : "Who is reviewing?";
      $("#who-text").textContent = linked
        ? "You came by a personal link: your name is yours (✓), and nobody else can take it while your link is in force. What you did stays yours, under the name you give."
        : "Your name is recorded with every opinion you give, so that others can see who said what. You can change it at any time.";
      field.value = prefill;
      err.textContent = this.why ?? "";
      err.hidden = !this.why;
      modal.hidden = false;
      field.focus();
      field.select();
      const close = (name: string | null) => {
        modal.hidden = true;
        form.onsubmit = null;
        $("#who-cancel").onclick = null;
        modal.onkeydown = null;
        modal.onpointerdown = null;
        done(name);
      };
      let asking = false;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const name = field.value.trim();
        const refuse = (why: string) => {
          err.textContent = why;
          err.hidden = false;
          field.focus();
        };
        if (!validName(name)) return refuse("A name is 1 to 60 characters, without line breaks.");
        if (asking) return;
        asking = true;
        const r = await this.data.setIdentity(name);
        asking = false;
        if (modal.hidden) return;
        // a guest's name is the page's own: only a link holder's refuses it, and a server that
        // cannot be asked does not hold it up
        if (r.taken || (linked && !r.ok)) return refuse(r.error ?? "The name could not be changed.");
        if (r.person) this.person = r.person;
        this.why = null;
        this.setName(r.name ?? name);
        close(r.name ?? name);
      };
      $("#who-cancel").onclick = () => close(null);
      modal.onkeydown = (e) => {
        if (e.key === "Escape") close(null);
      };
      // a click outside the box declines
      modal.onpointerdown = (e) => {
        if (e.target === modal) close(null);
      };
    });
  }

  // ---------------------------------------------------------------- who else is here

  /** Start telling the others where this page is. */
  start(): void {
    if (this.mode === "none") return;
    const input = () => {
      const was = this.idle;
      this.lastInput = Date.now();
      if (was) this.beat();
    };
    for (const ev of ["pointerdown", "keydown", "wheel"]) window.addEventListener(ev, input, { capture: true, passive: true });
    // another tab of this browser went private or visible: so does this one (store.ts, adopt); it
    // pinned or unpinned a conversation: the title bar here says so, and a conversation open here
    // without following closes once it is no longer pinned
    window.addEventListener("storage", (e) => {
      if (e.key !== this.store.key) return;
      const pins = JSON.stringify(this.store.data.talkPins);
      if (this.store.adopt(e.newValue)) this.setPrivate(this.store.data.private === true, false);
      if (JSON.stringify(this.store.data.talkPins) !== pins) this.showTalk();
    });
    let moved = 0;
    window.addEventListener("pointermove", () => {
      // a moving pointer counts, at most once every few seconds
      if (Date.now() - moved > 3000) {
        moved = Date.now();
        input();
      }
    }, { passive: true });
    document.addEventListener("visibilitychange", () => this.beat());
    setInterval(() => this.beat(), BEAT_MS);
    // the reader's own moves end following, and Esc does; reading does not (acts, above), and
    // nothing done in the strip or the conversation's window does: moving it, resizing it,
    // collapsing it, typing, sending, a link to a declaration; nor does anything done with the
    // reader's own name and visibility — a private reader may go on following (CollabSpec
    // decision 8)
    const stop = (e: Event) => {
      if (!this.followed || !e.isTrusted) return;
      const t = e.target as Element | null;
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        // Esc stops following and does nothing else (not the page's Esc: the source window, the
        // selection), wherever the focus is — on a button or a link of the window too; but in the
        // name's window or its menu it closes that, and in a field of a surface of the reader's own
        // — the conversation's box, the search box — it does what it does there, leaving the box or
        // closing the search (web/src/main.ts): the next one stops following
        if (t?.closest?.(`#modal, ${MINE}`) || (typing(t) && inYours(t))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        return this.unfollow();
      }
      if (!acts(e)) return;
      this.unfollow();
    };
    // a request to follow that shows takes Esc first, as its Not now (web/src/askfollow.ts): listened
    // for before following's own Esc, so that it does not stop following too
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.isTrusted && e.key === "Escape" && this.hooks.escape?.(e)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
    for (const ev of ["pointerdown", "wheel", "keydown", "dblclick"]) window.addEventListener(ev, stop, { capture: true });
    // Back and Forward move the reader however they come, a mouse's side button over the panel too
    window.addEventListener("popstate", () => this.unfollow());
    $("#peers").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-person]");
      if (!b) return;
      // a Shift-click on a pinned agent's badge talks with it without following (talkpins.ts)
      if (e.shiftKey && this.talkWith(b.dataset.person!)) return;
      // a person's initials open their menu: following them, asking them to follow (CollabSpec
      // decision 10); an agent's follow it
      if (!this.hooks.menu?.(b.dataset.person!, b)) this.follow(b.dataset.person!);
    });
    // the window's ✕ stops following, or, following nobody, closes the pinned conversation; its pin
    // pins or unpins it
    $("#following").addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-unfollow]")) {
        if (this.followed) this.unfollow();
        else this.closeTalk();
      } else if (t.closest("[data-pin]")) this.togglePin();
    });
    this.beat();
  }

  private get idle(): boolean {
    return document.hidden || Date.now() - this.lastInput > IDLE_MS;
  }

  /** Where this page is changed: the others are told, a moment later; nothing, while private. */
  report(): void {
    if (this.mode === "none" || this.readOnly || this.hidden) return;
    if (this.wait) clearTimeout(this.wait);
    this.wait = setTimeout(() => this.beat(), 300);
  }

  private beat(): void {
    if (this.mode === "none" || this.readOnly) return;
    if (this.wait) clearTimeout(this.wait);
    this.wait = null;
    // a heartbeat speaks for this page's stream, by its secret: none before the stream said hello;
    // a private page's says that it is here, and nothing else (CollabSpec decision 8)
    if (this.stream) this.data.presence(this.stream.token, this.hidden ? { private: true } : { view: this.hooks.view(), idle: this.idle });
  }

  /** The event stream (re)connected and was named, or was named afresh as this page went private or
   *  visible: the others are told where this page is at once, under its new id, without waiting for
   *  the next heartbeat. */
  connected(hello: StreamHello): void {
    const again = this.stream !== null;
    this.stream = hello;
    this.renderPeers();
    this.beat();
    // a page that came by a personal link asks who it is when its stream comes back: a link
    // revoked ends its streams, and the key may still let it in, as a guest; or, on a server open to
    // all (--public), let it read only — the page is reloaded then, a read-only reader's (CollabSpec
    // decision 11)
    if (again && this.mode === "person")
      void this.init().then(() => {
        if (this.readOnly) location.reload();
      });
  }

  /** How many private readers the server counts (CollabSpec decision 8). */
  setPrivateCount(n: number): void {
    this.privateAll = n;
    this.renderPeers();
  }

  /** The private readers but this one: the server counts this page too once its hello says so. */
  get privateOthers(): number {
    return Math.max(0, this.privateAll - (this.stream?.private ? 1 : 0));
  }

  /** The list of pages, as the server sends it. */
  setPeers(all: Peer[]): void {
    this.peers = all.filter((p) => p.id !== this.stream?.id);
    this.renderPeers();
    this.hooks.changed();
    // following nobody, a pinned conversation left open shows while its agent is listed: after a
    // reload, once the server says it is
    if (!this.followed) return this.showTalk();
    const p = this.people().find((x) => x.key === this.followed!.key);
    if (!p) {
      this.unfollow(`${this.followed.name} left`);
      return;
    }
    this.talking = talkable(p);
    this.hooks.talkTo(this.talking);
    this.go(p);
  }

  /** Go where a followed reader is, unless this is where they were last time. */
  private go(p: Person): void {
    const view = p.sessions[0].view;
    if (!view) return;
    const at = JSON.stringify(view);
    if (at === this.applied) return;
    this.applied = at;
    this.hooks.follow(view);
  }

  /** The others, one entry per person (a person with two pages is one), liveliest first. */
  people(): Person[] {
    const byKey = new Map<string, Person>();
    for (const p of this.peers) {
      const key = personKey(p);
      const e = byKey.get(key) ?? { key, name: p.name, sessions: [], agent: !!p.agent, verified: !!p.verified };
      e.sessions.push(p);
      byKey.set(key, e);
    }
    const out = [...byKey.values()];
    for (const e of out) e.sessions.sort((a, b) => Number(a.idle) - Number(b.idle));
    const awake = (e: Person) => (e.sessions[0].idle ? 1 : 0);
    return out.sort((a, b) => awake(a) - awake(b) || Number(!a.name) - Number(!b.name) || (a.name ?? "").localeCompare(b.name ?? ""));
  }

  /** The people looking at declaration `name` (their selection). */
  on(name: string): Person[] {
    return this.people().filter((p) => p.sessions.some((s) => s.view?.sel === name));
  }

  colorOf(p: { name: string | null }): string {
    return p.name ? colorOf(p.name) : "var(--text-3)";
  }

  label(p: { name: string | null }): string {
    return p.name ? initials(p.name) : "?";
  }

  /** How someone is named in words: an agent as one, someone invited by a personal link with its
   *  mark. */
  nameOf(p: { name: string | null; agent?: boolean; verified?: boolean }): string {
    return p.name ? (p.agent ? agentName(p.name) : p.verified ? `${p.name} ✓` : p.name) : "a reader without a name";
  }

  /** The others' initials, drawn again: they moved, came or went, or what they made of this
   *  reader's request to follow changed. */
  renderPeers(): void {
    const box = $("#peers");
    const all = this.people();
    const hidden = this.privateOthers;
    box.hidden = all.length === 0 && hidden === 0;
    const shown = all.slice(0, SHOWN);
    box.innerHTML =
      shown
        .map((p) => {
          const s = p.sessions[0];
          const where = s.view ? this.hooks.describe(s.view) : "";
          const who = p.name ? this.nameOf(p) : "A reader without a name";
          // an agent with a token: its state, as the server infers it, in words and as a dot; its
          // conversation pinned, how to open it without following
          const talk = s.talk ? ` · ${stateWords(s.talk)}${s.talk.state === "offline" ? "" : " · follow it to talk with it"}` : "";
          const pinned = s.talk && isPinned(this.pins, s.id) ? " · Shift-click to talk with it without following (its conversation is pinned)" : "";
          // what they made of this reader's request to follow, for a little while after
          const ask = p.agent ? null : (this.hooks.asked?.(p) ?? null);
          const tip = `${who}${where ? ` — ${where}` : ""}${s.idle && !s.talk ? " · away" : ""}${talk}${ask ? ` · ${ask.tip}` : ""} · click to follow${p.agent || !this.hooks.menu ? "" : ", or to ask them to follow you"}${pinned}`;
          const on = this.followed?.key === p.key ? " on" : "";
          const bot = p.agent ? `<span class="peer-bot">${BOT}</span>` : p.verified ? `<span class="peer-vf" aria-hidden="true">✓</span>` : "";
          const dot = s.talk ? `<span class="peer-dot st-${s.talk.state}"></span>` : "";
          const mark = ask ? `<span class="peer-ask ${ask.cls}" aria-hidden="true">${ask.glyph}</span>` : "";
          const state = s.talk?.state === "offline" ? " offline" : s.idle ? " idle" : "";
          const menu = p.agent || !this.hooks.menu ? "" : ` aria-haspopup="menu"`;
          return `<button class="peer${p.agent ? " agent" : p.verified ? " verified" : ""}${state}${on}${ask ? " asked" : ""}" data-person="${escapeHtml(p.key)}" style="--c:${this.colorOf(p)}" title="${escapeHtml(tip)}"${menu}>${escapeHtml(this.label(p))}${bot}${dot}${mark}</button>`;
        })
        .join("") +
      (all.length > SHOWN
        ? `<span class="peer more" title="${escapeHtml(all.slice(SHOWN).map((p) => this.nameOf(p)).join(", "))}">+${all.length - SHOWN}</span>`
        : "") +
      // the private readers, counted: nothing else is known of them (CollabSpec decision 8)
      (hidden
        ? `<span class="peer-private" title="${hidden === 1 ? "1 reader is" : `${hidden} readers are`} here privately: not listed, and cannot be followed">+${hidden} private</span>`
        : "");
  }

  // ---------------------------------------------------------------- following

  follow(key: string): void {
    const p = this.people().find((x) => x.key === key);
    if (!p) return;
    if (this.followed?.key === key) return this.unfollow();
    // from one reader straight to another: following the first ended
    if (this.followed) this.hooks.unfollowed();
    this.followed = { key, name: this.nameOf(p) };
    this.applied = "";
    this.talking = talkable(p);
    // a pinned agent followed: its conversation is the one open when following ends
    if (this.talking && isPinned(this.pins, this.talking.id)) this.setPins(opened(this.pins, this.talking.id));
    const box = $("#following");
    box.style.setProperty("--c", this.colorOf(p));
    this.renderStrip(p.agent);
    box.hidden = false;
    document.body.classList.add("following");
    document.body.style.setProperty("--follow", this.colorOf(p));
    this.renderPeers();
    this.hooks.talkTo(this.talking);
    this.go(p);
  }

  unfollow(why?: string): void {
    if (!this.followed) return;
    this.followed = null;
    document.body.classList.remove("following");
    this.hooks.unfollowed();
    this.renderPeers();
    // a pinned conversation stays, or comes back: the window is its, following nobody
    this.talking = shownTalk(this.pins, false, null, this.peers);
    if (this.talking) return this.openTalk();
    this.hooks.talkTo(null);
    const box = $("#following");
    // the keys go back to the page: none stays with a button that is no longer shown
    if (box.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (why) {
      const strip = $(".fl-strip");
      strip.textContent = why;
      delete strip.dataset.html;
      setTimeout(() => {
        if (!this.followed && !this.talking) box.hidden = true;
      }, 2500);
    } else box.hidden = true;
  }

  // ---------------------------------------------------------------- a conversation pinned

  /** The pins as this browser keeps them (web/src/talkpins.ts). */
  private get pins(): TalkPins {
    return readPins(this.store.data);
  }

  private setPins(p: TalkPins): void {
    writePins(this.store.data, p);
    this.store.save();
  }

  /** Following nobody, the window as the pins say: the pinned conversation left open, while its
   *  agent is listed; else none, and one that showed closes, the keys going back to the page.
   *  Following someone, the title bar alone, for the pin's state. */
  private showTalk(): void {
    if (this.followed) return this.renderStrip(this.talking !== null);
    const was = this.talking;
    this.talking = shownTalk(this.pins, false, null, this.peers);
    if (this.talking) return this.openTalk();
    // nothing showed: nothing closes (the strip may be saying why following ended, for a moment)
    if (!was) return;
    const box = $("#following");
    if (box.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    box.hidden = true;
    this.hooks.talkTo(null);
  }

  /** The pinned conversation shown following nobody: in the agent's colour, its title bar saying
   *  whom the reader talks with. */
  private openTalk(): void {
    const box = $("#following");
    box.style.setProperty("--c", this.colorOf(this.talking!));
    this.renderStrip(true);
    box.hidden = false;
    this.hooks.talkTo(this.talking);
  }

  /** The title bar: following someone, the strip — "Following X · Esc to stop" and its ✕; talking
   *  with an agent (`agent`), the title bar of its window (web/src/chatwin.ts), where the agent's state
   *  takes the colour dot's place, a button starts a new conversation (web/src/talk.ts, which says when
   *  it may), the pin pins it, another collapses it, and the ✕ stops following or, following nobody,
   *  closes it. */
  private renderStrip(agent: boolean): void {
    const t = this.talking;
    const on = t !== null && isPinned(this.pins, t.id);
    const name = this.followed?.name ?? (t ? this.nameOf(t) : "");
    const who = this.followed ? `Following <b>${escapeHtml(name)}</b> · Esc to stop` : `Talking with <b>${escapeHtml(name)}</b>`;
    const pinTip = !on
      ? "Pin: keep this conversation open when you stop following, and after a reload; a Shift-click on the agent's badge opens it again"
      : this.followed
        ? "Pinned: it stays open when you stop following — click to unpin"
        : "Unpin: the conversation closes, as you do not follow the agent";
    const x = this.followed ? "Stop following" : "Close the conversation: it stays pinned, and a Shift-click on the agent's badge opens it again";
    const html =
      `<span class="dot"></span><span class="fl-st st-dot"></span>${agent ? BOT : ""}<span class="fl-who">${who}</span>` +
      `<button data-restart type="button" aria-label="New conversation">${NEW_TALK}</button>` +
      `<button data-pin type="button" aria-pressed="${on}" title="${escapeHtml(pinTip)}" aria-label="Pin the conversation">${PIN}</button>` +
      `<button data-collapse type="button" title="Collapse to one line (or double-click the title bar)" aria-label="Collapse">${COLLAPSE}</button>` +
      `<button data-unfollow type="button" title="${escapeHtml(x)}" aria-label="${this.followed ? "Stop following" : "Close"}">✕</button>`;
    // drawn again only where it changed, so that a button keeps the focus and the pointer while the
    // others move (a presence change shows the same conversation again); talk.ts dresses the state's
    // dot and the new conversation's button after each drawing
    const strip = $(".fl-strip");
    if (strip.dataset.html !== html) {
      strip.innerHTML = html;
      strip.dataset.html = html;
      this.hooks.stripDrawn();
    }
    // the pill's ✕ does the same
    const px = document.querySelector<HTMLElement>(".fl-pill > [data-unfollow]");
    if (px) {
      px.title = x;
      px.setAttribute("aria-label", this.followed ? "Stop following" : "Close");
    }
  }

  /** The pin pressed: the conversation shown pinned, or unpinned — following nobody, it then closes,
   *  as an unpinned one does when following ends. */
  private togglePin(): void {
    const t = this.talking;
    if (!t) return;
    this.setPins(isPinned(this.pins, t.id) ? unpin(this.pins, t.id) : pin(this.pins, t.id));
    this.showTalk();
    this.renderPeers();
  }

  /** The ✕ of a pinned conversation, following nobody: it closes, and stays pinned. */
  private closeTalk(): void {
    this.setPins(closed(this.pins));
    this.showTalk();
  }

  /** A Shift-click on badge `key`: where it is an agent whose conversation is pinned, that
   *  conversation opens without following — following ends first — and in front, expanded. False
   *  where it is not, for a click to follow. */
  private talkWith(key: string): boolean {
    const p = this.people().find((x) => x.key === key);
    const a = p ? talkable(p) : null;
    if (!a || !isPinned(this.pins, a.id)) return false;
    this.setPins(opened(this.pins, a.id));
    if (this.followed) this.unfollow();
    else this.showTalk();
    this.hooks.reveal();
    return true;
  }

  get following(): boolean {
    return this.followed !== null;
  }

  /** Whom this reader follows, by personKey, or null. */
  get followedKey(): string | null {
    return this.followed?.key ?? null;
  }

  /** Whether this reader is private (CollabSpec decision 8): nobody can follow them. */
  get isPrivate(): boolean {
    return this.hidden;
  }

  /** Whom this reader follows, by name, or null. */
  get followedName(): string | null {
    return this.followed?.name ?? null;
  }
}
