// The people on this server (CollabSpec.md): who this reader is — the name they give, or the one an
// authenticating proxy gives — and who else has a page open, where they are, and following them.
// Agents working through the API are among them (AgentSpec decision 1), each with its own mark: a
// rounded square with a robot on it, and "(agent)" wherever it is named; they are followed alike.
// An agent with a token of its own is listed while its token is in force (decision 8), with a dot for
// its state — listening, thinking, working, offline — and the state in words in its tooltip; its
// menu follows it or talks with it (web/src/peermenu.ts), in the reader's own conversation window
// (web/src/talk.ts), which following never opens, closes or changes (CollabSpec decision 13, the
// owner's decisions of 2026-10-19). Offline, it is greyed, with when it was last seen. Following
// someone shows the following strip, which says whom and stops it; ended by the reader's own action,
// it offers to follow them again (the owner's decision of 2026-10-30).
//
// A reader may be private (CollabSpec decision 8), from the menu under their name (web/src/whomenu.ts):
// the page then says nothing of where they are — its heartbeat says only that it is here, and whom it
// follows — and they are neither listed nor followed; the bar shows how many private readers there
// are ("+2 private").
//
// Who follows this reader (the owner's decision of 2026-10-20): every page says whom it follows, and
// the reader's name carries a mark with how many do — the people, and the private readers the server
// counts for them ("+1 private"); read-only readers are seen by nobody, and never counted — its
// tooltip and its menu naming them; their initials among the others carry a mark too. Nothing is said
// when someone starts following.
//
// A reader who came by a personal link (CollabSpec decision 9) is who the link says: their name is
// the link's, changed through the server, and carries a ✓ here and wherever the others see it. A
// guest — who came by the key's link — gives any name but one a link's holder goes by: the server
// says so when the name is given, and the window asks for another.

import { colorOf, initials, personKey, validName } from "../../shared/collab.ts";
import type { Peer, PersonInvite, PresenceView, PrivateCount, StreamHello } from "../../shared/collab.ts";
import { agentName, BOT } from "./agentmark.ts";
import { stateWords } from "./talk.ts";
import type { DataSource } from "./data.ts";
import { escapeHtml } from "./highlight.ts";
import { MyLink } from "./mylink.ts";
import { isPhone, PHONE } from "./phone.ts";
import type { Store } from "./store.ts";
import { doubleClickActs, inYours, keyActs, pressActs, WHEEL } from "./surfaces.ts";
import { typing } from "./typing.ts";
import { VERIFIED } from "./verified.ts";
import { followersCount, followersLine, WhoMenu } from "./whomenu.ts";
import type { Followers, NameMode } from "./whomenu.ts";

const BEAT_MS = 10_000;
const IDLE_MS = 5 * 60_000;
/** initials shown before the rest are counted as "+N" */
const SHOWN = 5;
/** On a phone (PhoneSpec decision 6) the people take at most this many places of the bar, "+N" and
 *  the private readers' count among them, so that the build status and the project's name keep
 *  theirs: four initials, or three and "+N". */
const PHONE_PLACES = 4;

/** How many of `people` show by their initials, the rest counted as "+N": on a larger screen five; on
 *  a phone as many as PHONE_PLACES holds beside the private readers' count (`counted`), one of them
 *  "+N" where they do not all fit. */
export function initialsShown(people: number, counted: boolean, phone: boolean): number {
  if (!phone) return Math.min(people, SHOWN);
  const places = PHONE_PLACES - (counted ? 1 : 0);
  return people <= places ? people : places - 1;
}

/** Where this reader's own name and visibility are changed, and a person's menu opened from their
 *  initials (web/src/peermenu.ts): nothing done there moves them, and Esc closes the menu first */
const MINE = "#who, #who-menu, #peer-menu";
/** the mark of a private reader beside their name */
const HIDDEN = `<svg class="who-hidden" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2.5 8s2-3.8 5.5-3.8S13.5 8 13.5 8 11.5 11.8 8 11.8 2.5 8 2.5 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.7" fill="currentColor"/><path d="M3 13 13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

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
  /** following ended */
  unfollowed(): void;
  // Asking others to follow (CollabSpec decision 10, web/src/askfollow.ts):
  /** Esc, while a request to follow this reader shows: whether it took it, as Not now */
  escape?(e: KeyboardEvent): boolean;
  /** a click on someone's initials: their menu opened (web/src/peermenu.ts) — a person's, or an
   *  agent's; false where there is none, and a click follows */
  menu?(key: string, at: HTMLElement): boolean;
  /** what a person's initials show of this reader's request to follow: a mark, and what it says */
  asked?(p: { name: string | null; sessions: Peer[] }): { cls: string; glyph: string; tip: string } | null;
  /** ask everyone to follow this reader, and why they cannot now (the name's menu) */
  askAll?(): void;
  askWhy?(): string | null;
  /** say something in passing (the page's line) */
  say?(text: string): void;
  /** whom this reader follows, or who is here and whom they follow, changed: the rooms pointers are
   *  shown in (web/src/pointers.ts) */
  roomChanged?(): void;
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

/** Who a page or an agent is among the people (shared/collab.ts). */
export { personKey };

/** The people among `peers` who follow the reader whose page is listed as `me` (the owner's decision
 *  of 2026-10-20), by personKey: those a page of whom says it follows them. Nobody follows a reader
 *  who is not listed — private, read-only, or not yet named by the server — and agents follow
 *  nobody. */
export function followerKeys(peers: readonly Peer[], me: Peer | null): Set<string> {
  const out = new Set<string>();
  if (!me) return out;
  const mine = personKey(me);
  for (const p of peers) if (!p.agent && p.id !== me.id && p.view?.following === mine) out.add(personKey(p));
  return out;
}

/** the mark of people following the reader, beside their name and on their followers' initials */
const FOLLOWED_MARK = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="5.2" r="2.6" fill="currentColor"/><path d="M3.2 13.6c.5-2.9 2.4-4.5 4.8-4.5s4.3 1.6 4.8 4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

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
  /** whom following last ended with by the reader's own action (the owner's decision of
   *  2026-10-30): the strip offers to follow them again until the reader answers it, follows anyone,
   *  or they leave */
  private again: { key: string; name: string } | null = null;
  /** the followed reader's place as last gone to: their place again (a presence list that changed
   *  elsewhere) is not gone to again */
  private applied = "";
  private lastInput = Date.now();
  /** finding out who this page is: what needs the name waits for it */
  private ready: Promise<void> = Promise.resolve();
  private wait: ReturnType<typeof setTimeout> | null = null;
  /** the reader is private (CollabSpec decision 8), as this browser keeps it */
  private hidden: boolean;
  /** how many private readers the server counts: this page among them once its hello says so */
  private privateAll = 0;
  /** how many of them follow this reader, as the server counts them for this page */
  private privateFollowers = 0;
  /** someone unseen (a read-only reader) follows this reader: shown nowhere, but the pointer is sent
   *  for them (the owner's decision of 2026-10-21) */
  private unseen = false;
  /** this page as the server lists it, with the others: null while it is not listed (private,
   *  read-only, before its first heartbeat) */
  private me: Peer | null = null;
  /** who follows this reader, as last drawn: the name is drawn again when it changes */
  private followersDrawn = "";
  private menu: WhoMenu;
  /** the personal link this reader came by, shown to them in the name's window */
  private myLink: MyLink;

  constructor(data: DataSource, store: Store, hooks: PeopleHooks) {
    this.data = data;
    this.store = store;
    this.hooks = hooks;
    this.hidden = store.data.private === true;
    // a phone's bar holds fewer of the others' initials: drawn again across its line
    if (typeof matchMedia === "function") matchMedia(PHONE).addEventListener("change", () => this.renderPeers());
    // said from the first request on: nothing this page opens or arranges goes under its name
    data.privateSession = this.hidden ? this.session : null;
    this.myLink = new MyLink({
      data,
      stream: () => this.stream?.token ?? null,
      renewed: (invite) => (this.person = invite),
    });
    this.menu = new WhoMenu($("#who"), $("#who-menu"), {
      mode: () => this.mode,
      name: () => this.name,
      visibility: () => (this.hidden ? "private" : "visible"),
      rename: () => void this.whoClicked(),
      // offered where the reader came by a personal link alone (the menu asks the mode)
      myLink: () => void this.myLink.open(),
      setVisibility: (v) => this.setPrivate(v === "private"),
      ...(hooks.askAll ? { askAll: () => hooks.askAll!(), askWhy: () => hooks.askWhy?.() ?? null } : {}),
      followers: () => this.followers(),
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
      // a link revoked under this page, or made anew in another browser, which the key still lets
      // in: a guest from now on
      if (id.revoked) this.why = `Your personal link was revoked${id.revoked.by ? ` by ${id.revoked.by}` : ""}: you are here as a guest, under a name you give.`;
      else if (id.replaced) this.why = "Your personal link was made anew in another browser: open the new one here to be you again. Meanwhile you are here as a guest, under a name you give.";
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
    // told once the heartbeat named this page's stream with it: what of the conversations it is
    // sent follows the name (CollabSpec decision 13)
    void this.beat().then(() => this.hooks.renamed());
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
    this.hooks.roomChanged?.();
  }

  renderMe(): void {
    const who = $("#who");
    who.hidden = this.mode === "none";
    // who follows this reader: a mark with how many, which the tooltip and the menu name
    const f = this.followers();
    const said = followersCount(f);
    const line = followersLine(f);
    const mark = said ? `<span class="who-fol" id="who-fol" aria-label="${escapeHtml(said)}">${FOLLOWED_MARK}<b>${f.names.length + f.private}</b></span>` : "";
    this.followersDrawn = this.followersSig(f);
    who.innerHTML = `<span class="who-n">${escapeHtml(this.name ?? (this.mode === "header" ? "Not signed in" : "Set your name"))}</span>` + (this.mode === "person" ? VERIFIED : "") + (this.hidden ? HIDDEN : "") + mark;
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
            : "Give the name your opinions are recorded under — click to give it, or for your visibility") +
      (said ? ` · ${said}: ${line}` : "");
    this.menu.render();
  }

  /** Who follows this reader (the owner's decision of 2026-10-20): the people, named as the page
   *  names them, and the private readers the server counts; nobody, while this reader is private. */
  followers(): Followers {
    if (this.hidden) return { names: [], private: 0 };
    const keys = followerKeys(this.peers, this.me);
    return {
      names: this.people()
        .filter((p) => keys.has(p.key))
        .map((p) => (p.name ? this.nameOf(p) : "a reader without a name")),
      private: this.privateFollowers,
    };
  }

  private followersSig(f: Followers): string {
    return JSON.stringify(f);
  }

  /** Whom this page follows changed: the server is told at once — by a private page too, whose
   *  heartbeat says only that — so that the reader it follows sees it. */
  private toldFollowing(): void {
    if (this.hidden) void this.beat();
    else this.report();
    this.hooks.roomChanged?.();
  }

  /** This page as the server lists it: null while it is not listed (private, read-only, before its
   *  first heartbeat). */
  get listed(): Peer | null {
    return this.me;
  }

  /** How many private readers follow this reader, as the server counts them. */
  get privateFollowing(): number {
    return this.privateFollowers;
  }

  /** Whether someone unseen — a read-only reader — follows this reader: never who nor how many. */
  get unseenFollowing(): boolean {
    return this.unseen;
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
      // the name's form, in the window's place of the personal link (web/src/mylink.ts)
      if (this.myLink.isOpen) this.myLink.close();
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

  /** Start telling the others where this page is, and following them. A snapshot has nobody; a
   *  read-only reader tells nothing (no heartbeat: beat) but may follow the others (CollabSpec
   *  decision 11). */
  start(): void {
    if (this.mode === "none" && !this.readOnly) return;
    const input = () => {
      const was = this.idle;
      this.lastInput = Date.now();
      if (was) this.beat();
    };
    for (const ev of ["pointerdown", "keydown", "wheel"]) window.addEventListener(ev, input, { capture: true, passive: true });
    // another tab of this browser went private or visible: so does this one (store.ts, adopt)
    window.addEventListener("storage", (e) => {
      if (e.key !== this.store.key) return;
      if (this.store.adopt(e.newValue)) this.setPrivate(this.store.data.private === true, false);
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
    // nothing done in the strip or the conversation window does — moving it, resizing it,
    // collapsing it, typing, sending — but a link followed from it (web/src/talk.ts says so); nor
    // does anything done with the reader's own name and visibility — a private reader may go on
    // following (CollabSpec decision 8)
    const stop = (e: Event) => {
      if (!this.followed || !e.isTrusted) return;
      const t = e.target as Element | null;
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        // Esc stops following and does nothing else (not the page's Esc: the source window, the
        // selection), wherever the focus is — on a button or a link of the window too; but in the
        // name's window or its menu it closes that, and in a field of a surface of the reader's own
        // — the conversation's box, the search box — it does what it does there, leaving the box or
        // closing the search (web/src/pagekeys.ts): the next one stops following
        if (t?.closest?.(`#modal, ${MINE}`) || (typing(t) && inYours(t))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        return this.unfollow();
      }
      if (!acts(e)) return;
      this.leave();
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
    window.addEventListener("popstate", () => this.leave());
    $("#peers").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-person]");
      if (!b) return;
      // someone's initials open their menu: following them, asking them to follow (CollabSpec
      // decision 10), talking with an agent (decision 13)
      if (!this.hooks.menu?.(b.dataset.person!, b)) this.follow(b.dataset.person!);
    });
    // the strip's ✕ stops following; once it has ended, Follow again follows the same reader, and ✕
    // puts the offer away
    $("#following").addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-unfollow]")) this.unfollow();
      else if (t.closest("[data-again]")) {
        const key = this.again?.key;
        this.dropAgain();
        if (key) this.follow(key);
      } else if (t.closest("[data-dismiss]")) this.dropAgain();
    });
    void this.beat();
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

  /** Tell the others where this page is; done once the server took it. */
  private beat(): Promise<void> {
    if (this.mode === "none" || this.readOnly) return Promise.resolve();
    if (this.wait) clearTimeout(this.wait);
    this.wait = null;
    // a heartbeat speaks for this page's stream, by its secret: none before the stream said hello;
    // a private page's says that it is here, and nothing else (CollabSpec decision 8)
    if (!this.stream) return Promise.resolve();
    return this.data.presence(this.stream.token, this.hidden ? { private: true, following: this.followed?.key ?? null } : { view: this.hooks.view(), idle: this.idle });
  }

  /** The event stream (re)connected and was named, or was named afresh as this page went private or
   *  visible: the others are told where this page is at once, under its new id, without waiting for
   *  the next heartbeat. Done once the server took that heartbeat: the stream knows the page's name
   *  from then on. */
  connected(hello: StreamHello): Promise<void> {
    const again = this.stream !== null;
    this.stream = hello;
    this.renderPeers();
    const told = this.beat();
    // a page that came by a personal link asks who it is when its stream comes back: a link
    // revoked ends its streams, and the key may still let it in, as a guest; or, on a server open to
    // all (--public), let it read only — the page is reloaded then, a read-only reader's (CollabSpec
    // decision 11)
    if (again && this.mode === "person")
      void this.init().then(() => {
        if (this.readOnly) location.reload();
      });
    return told;
  }

  /** How many private readers the server counts (CollabSpec decision 8), and how many of them follow
   *  this reader. */
  setPrivateCount(p: PrivateCount): void {
    this.privateAll = p.count;
    this.privateFollowers = p.followers ?? 0;
    this.unseen = p.unseen === true;
    this.renderPeers();
    this.followersChanged();
    this.hooks.roomChanged?.();
  }

  /** The name drawn again where who follows this reader changed. */
  private followersChanged(): void {
    if (this.followersSig(this.followers()) !== this.followersDrawn) this.renderMe();
  }

  /** The private readers but this one: the server counts this page too once its hello says so. */
  get privateOthers(): number {
    return Math.max(0, this.privateAll - (this.stream?.private ? 1 : 0));
  }

  /** The list of pages, as the server sends it. */
  setPeers(all: Peer[]): void {
    this.peers = all.filter((p) => p.id !== this.stream?.id);
    this.me = all.find((p) => p.id === this.stream?.id) ?? null;
    this.renderPeers();
    this.followersChanged();
    this.hooks.changed();
    this.hooks.roomChanged?.();
    // the offer to follow again goes with the reader it names
    if (this.again && !this.people().some((x) => x.key === this.again!.key)) this.dropAgain();
    if (!this.followed) return;
    const p = this.people().find((x) => x.key === this.followed!.key);
    if (!p) {
      this.unfollow(`${this.followed.name} left`);
      return;
    }
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
    // those following this reader (the owner's decision of 2026-10-20), marked in this reader's colour
    const following = this.hidden ? new Set<string>() : followerKeys(this.peers, this.me);
    const me = this.name ? colorOf(this.name) : "var(--accent)";
    box.hidden = all.length === 0 && hidden === 0;
    const shown = all.slice(0, initialsShown(all.length, hidden > 0, isPhone()));
    box.innerHTML =
      shown
        .map((p) => {
          const s = p.sessions[0];
          const where = s.view ? this.hooks.describe(s.view) : "";
          const who = p.name ? this.nameOf(p) : "A reader without a name";
          // an agent with a token: its state, as the server infers it, in words and as a dot
          const talk = s.talk ? ` · ${stateWords(s.talk)}` : "";
          // what they made of this reader's request to follow, for a little while after
          const ask = p.agent ? null : (this.hooks.asked?.(p) ?? null);
          const does = !this.hooks.menu ? "click to follow" : p.agent ? `click to follow${s.talk ? " or talk with it" : " it"}` : "click to follow, or to ask them to follow you";
          const fol = following.has(p.key);
          const tip = `${who}${where ? ` — ${where}` : ""}${s.idle && !s.talk ? " · away" : ""}${talk}${fol ? " · follows you" : ""}${ask ? ` · ${ask.tip}` : ""} · ${does}`;
          const on = this.followed?.key === p.key ? " on" : "";
          const bot = p.agent ? `<span class="peer-bot">${BOT}</span>` : p.verified ? `<span class="peer-vf" aria-hidden="true">✓</span>` : "";
          const dot = s.talk ? `<span class="peer-dot st-${s.talk.state}"></span>` : "";
          const mark = (ask ? `<span class="peer-ask ${ask.cls}" aria-hidden="true">${ask.glyph}</span>` : "") + (fol ? `<span class="peer-fol" style="--me:${me}" aria-hidden="true">${FOLLOWED_MARK}</span>` : "");
          const state = s.talk?.state === "offline" ? " offline" : s.idle ? " idle" : "";
          const menu = !this.hooks.menu ? "" : ` aria-haspopup="menu"`;
          return `<button class="peer${p.agent ? " agent" : p.verified ? " verified" : ""}${state}${on}${ask ? " asked" : ""}${fol ? " follows" : ""}" data-person="${escapeHtml(p.key)}" style="--c:${this.colorOf(p)}" title="${escapeHtml(tip)}"${menu}>${escapeHtml(this.label(p))}${bot}${dot}${mark}</button>`;
        })
        .join("") +
      (all.length > shown.length
        ? `<span class="peer more" title="${escapeHtml(all.slice(shown.length).map((p) => this.nameOf(p)).join(", "))}">+${all.length - shown.length}</span>`
        : "") +
      // the private readers, counted: nothing else is known of them (CollabSpec decision 8); on a
      // phone the count alone, dashed
      (hidden
        ? `<span class="peer-private" title="${hidden === 1 ? "1 reader is" : `${hidden} readers are`} here privately: not listed, and cannot be followed">+${hidden}<span class="pv-word"> private</span></span>`
        : "");
  }

  // ---------------------------------------------------------------- following

  follow(key: string): void {
    const p = this.people().find((x) => x.key === key);
    if (!p) return;
    if (this.followed?.key === key) return this.unfollow();
    // from one reader straight to another: following the first ended
    if (this.followed) this.hooks.unfollowed();
    this.again = null;
    this.followed = { key, name: this.nameOf(p) };
    this.applied = "";
    this.toldFollowing();
    const box = $("#following");
    box.style.setProperty("--c", this.colorOf(p));
    box.classList.remove("again");
    this.renderStrip(p.agent);
    box.hidden = false;
    document.body.classList.add("following");
    document.body.style.setProperty("--follow", this.colorOf(p));
    this.renderPeers();
    this.go(p);
  }

  unfollow(why?: string): void {
    if (!this.followed) return;
    this.followed = null;
    document.body.classList.remove("following");
    this.hooks.unfollowed();
    this.toldFollowing();
    this.renderPeers();
    const box = $("#following");
    // the keys go back to the page: none stays with a button that is no longer shown
    if (box.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (why) {
      const strip = $(".fl-strip");
      strip.textContent = why;
      setTimeout(() => {
        if (!this.followed && !this.again) box.hidden = true;
      }, 2500);
    } else box.hidden = true;
  }

  /** Following ended by the reader's own action — a move, a control of what they were shown, Back or
   *  Forward, a link followed from the conversation (CollabSpec decision 4): the strip stays, offering
   *  to follow the same reader again (the owner's decision of 2026-10-30). Esc and the strip's ✕,
   *  which mean to stop, end it without the offer, as the followed reader leaving does. */
  leave(): void {
    const was = this.followed;
    if (!was) return;
    this.unfollow();
    const p = this.people().find((x) => x.key === was.key);
    if (!p) return;
    this.again = was;
    const box = $("#following");
    box.style.setProperty("--c", this.colorOf(p));
    box.classList.add("again");
    $(".fl-strip").innerHTML =
      `<span class="dot"></span>${p.agent ? BOT : ""}<span class="fl-who">Stopped following <b>${escapeHtml(was.name)}</b></span>` +
      `<button data-again type="button" class="fl-again">Follow again</button>` +
      `<button data-dismiss type="button" title="Close" aria-label="Close">✕</button>`;
    box.hidden = false;
  }

  /** Put the offer to follow again away. */
  private dropAgain(): void {
    if (!this.again) return;
    this.again = null;
    const box = $("#following");
    box.classList.remove("again");
    if (box.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (!this.followed) box.hidden = true;
  }

  /** The strip: "Following X · Esc to stop", and its ✕. */
  private renderStrip(agent: boolean): void {
    $(".fl-strip").innerHTML =
      `<span class="dot"></span>${agent ? BOT : ""}<span class="fl-who">Following <b>${escapeHtml(this.followed?.name ?? "")}</b> · Esc to stop</span>` +
      `<button data-unfollow type="button" title="Stop following" aria-label="Stop following">✕</button>`;
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
