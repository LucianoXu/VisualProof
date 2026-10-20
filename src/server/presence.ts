// Who is here (CollabSpec decision 4): one entry per open page, kept by a heartbeat every ten
// seconds and dropped when the page's event stream closes or its heartbeats stop. Every change goes
// out to every page as the whole list — a few readers, so a few hundred bytes.
//
// A page's entry is its event stream's (server/live.ts): the server names each stream with a public
// id, the one every page is told, and hands the page alone a secret its heartbeats carry. So no page
// can speak for another, rename it or make it leave, and there are no more entries than streams.
//
// An agent (AgentSpec decision 1) has no page and no event stream: one entry per agent name, kept
// by its requests. An agent thinks between them for longer than a page waits between heartbeats, so
// it is shown away after a minute without one and gone after three, or when it says it leaves. At
// most MAX_AGENTS are listed: a name beyond them is served, and listed once one goes.
//
// An agent with a token of its own (server/tokens.ts) is one entry by its token, not by the name it
// acts under, so that nobody else can speak for it by giving that name; and it is listed as long as
// its token is in force (AgentSpec decision 8), with its state as server/talk.ts infers it from what
// it does — listening, thinking, working or offline — and when it was last seen. It is shown away
// only while offline.
//
// A private page (CollabSpec decision 8) is an entry with nothing in it — no name, no place — and is
// never listed: every page is told how many there are, and nothing else of them. Its stream is named
// afresh when it goes private and when it shows itself again (server/live.ts), so its entries under
// either id say nothing of the other.
//
// Who follows whom (the owner's decision of 2026-10-20): a listed page says it in its place
// (`following`, as shared/collab.ts personKey names the person followed), which every page reads; a
// private page says it alone, and is counted for the person it follows (`privateFollowers`), which
// only that person's pages are told (server/live.ts). A read-only page says nothing, and is seen by
// nobody (CollabSpec decision 11); an agent follows nobody.
//
// What an agent asks to follow the people it helps (GET /api/agent/companion) waits for the list to
// change: `rev` counts the changes that matter to it — someone came, went, moved, went idle, an
// agent went offline or came back — and leaves out a camera that moved, which a page reports
// every second or two while one pans, and what an agent that is not offline does from one request
// to the next.

import { createHash } from "node:crypto";
import type { AgentTalk, Peer, PresenceView } from "../shared/collab.ts";

/** a page not heard from for this long has gone */
const GONE_MS = 35_000;
/** an agent without a token not heard from for this long is away, and then gone */
const AGENT_IDLE_MS = 60_000;
const AGENT_GONE_MS = 180_000;
/** the most agents listed at once: every name an agent gives is an entry everyone is sent */
export const MAX_AGENTS = 32;

interface Entry {
  name: string | null;
  view: PresenceView | null;
  idle: boolean;
  seen: number;
  agent: boolean;
  /** a page of someone invited by a personal link (CollabSpec decision 9): its name is theirs */
  verified?: true;
  /** a private page's: counted, never listed */
  private?: true;
  /** whom a private page follows (personKey): counted for them, never told who */
  following?: string;
}

/** An agent with a token in force: listed until the token ends. */
interface TokenAgent {
  name: string;
  /** who made its token, and the personal link they made it by where they came by one */
  by: string;
  byPerson?: string;
  view: PresenceView | null;
  /** its state, what it does, when it was last seen (server/talk.ts) */
  talk: AgentTalk;
}

/** The entry an agent's requests stand for: one per name; its id, as pages are told it. */
export function agentSession(name: string): string {
  return createHash("sha1").update(`agent\u0000${name}`).digest("hex");
}

/** An agent as presence knows it: by its name, or by its token where it has one of its own. */
export interface AgentWho {
  name: string;
  /** the id of its token (server/tokens.ts) */
  token?: string;
}

/** The entry an agent stands for: its token's, or its name's. */
export function agentKey(who: string | AgentWho): string {
  const w = typeof who === "string" ? { name: who } : who;
  return w.token ? createHash("sha1").update(`agent token\u0000${w.token}`).digest("hex") : agentSession(w.name);
}

export class Presence {
  private sessions = new Map<string, Entry>();
  /** agents with a token in force, by the token's id */
  private tokens = new Map<string, TokenAgent>();
  /** pages whose event stream closed, and when: a heartbeat sent as one closes (a reload) comes
   *  after its stream ended, and would keep it on the list — and the views it had open alive
   *  (server/views.ts) — until it times out */
  private closed = new Map<string, number>();
  private send: (peers: Peer[]) => void;
  /** the changes an agent following people waits for (GET /api/agent/companion), counted */
  rev = 0;
  private lastSig = "";
  private waiters = new Set<() => void>();

  constructor(send: (peers: Peer[]) => void) {
    this.send = send;
    setInterval(() => this.expire(), 5000).unref();
  }

  /** The list changed: every page is sent it, and an agent waiting for a change that matters to
   *  it is told. */
  private notify(): void {
    const list = this.list();
    this.send(list);
    // neither a camera that pans nor what an agent does while online is a move, nor whom a page
    // follows, which agents are not told; an agent going offline or coming back is, and so is a
    // private reader coming or going
    const sig = JSON.stringify([this.privateCount(), list.map((p) => ({ ...p, view: p.view ? { ...p.view, cam: null, following: undefined } : null, talk: p.talk ? p.talk.state === "offline" : undefined }))]);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.rev++;
    for (const w of [...this.waiters]) w();
  }

  /** Resolves once `rev` is not `since` any more, or after `ms`. */
  waitChange(since: number, ms: number): Promise<void> {
    if (since !== this.rev || ms <= 0) return Promise.resolve();
    return new Promise((done) => {
      const end = () => {
        clearTimeout(timer);
        this.waiters.delete(end);
        done();
      };
      const timer = setTimeout(end, ms);
      this.waiters.add(end);
    });
  }

  /** A page says where it is (by its stream's id); or an agent, with each request (`agent`), where
   *  `view` null keeps the view it gave last. `verified`: the page of someone invited by a personal
   *  link, whose name is theirs. */
  beat(id: string, name: string | null, view: PresenceView | null, idle: boolean, agent = false, verified = false): void {
    if (this.closed.has(id)) return;
    const was = this.sessions.get(id);
    if (!was && agent && [...this.sessions.values()].filter((e) => e.agent).length >= MAX_AGENTS) return;
    const next: Entry = { name, view: view ?? was?.view ?? null, idle, seen: Date.now(), agent, ...(verified && name ? { verified: true as const } : {}) };
    this.sessions.set(id, next);
    const same =
      was && !was.private && was.name === next.name && was.idle === next.idle && was.agent === next.agent && was.verified === next.verified && JSON.stringify(was.view) === JSON.stringify(next.view);
    if (!same) this.notify();
  }

  /** A private page's heartbeat (CollabSpec decision 8): it is here, and whom it follows, and that
   *  is all that is kept of it — no name, no place, never idle. */
  beatPrivate(id: string, following: string | null = null): void {
    if (this.closed.has(id)) return;
    const was = this.sessions.get(id);
    this.sessions.set(id, { name: null, view: null, idle: false, seen: Date.now(), agent: false, private: true, ...(following ? { following } : {}) });
    if (!was?.private || was.following !== (following ?? undefined)) this.notify();
  }

  /** How many private pages follow each person, by personKey: what that person's pages alone are
   *  told (server/live.ts), never who. */
  privateFollowers(): Map<string, number> {
    const out = new Map<string, number>();
    for (const e of this.sessions.values()) if (e.private && e.following) out.set(e.following, (out.get(e.following) ?? 0) + 1);
    return out;
  }

  /** A page named afresh as it went private or showed itself again (server/live.ts): its entry under
   *  `old` goes, and comes back under `id` — counted, or listed with its name and place — as one
   *  change, so that no list goes out with the page under both ids, or under neither. */
  renamed(old: string, id: string, priv: boolean, name: string | null, view: PresenceView | null, idle: boolean, verified = false): void {
    this.sessions.delete(old);
    this.closed.delete(id);
    this.sessions.set(id, priv ? { name: null, view: null, idle: false, seen: Date.now(), agent: false, private: true } : { name, view, idle, seen: Date.now(), agent: false, ...(verified && name ? { verified: true as const } : {}) });
    this.notify();
  }

  /** How many private pages are here: what every page and the agents' companion are told of them. */
  privateCount(): number {
    let n = 0;
    for (const e of this.sessions.values()) if (e.private) n++;
    return n;
  }

  /** Where a page that is listed last said it was; null for any other. */
  pageView(id: string): PresenceView | null {
    const e = this.sessions.get(id);
    return e && !e.agent && !e.private ? e.view : null;
  }

  /** An agent's request: it is here, with the view it gave (or the one it gave last). */
  agentBeat(who: string | AgentWho, view: PresenceView | null = null): void {
    if (typeof who !== "string" && who.token) {
      // its state is server/talk.ts's to say (setTalk); a token that is not listed (ended) is not
      // listed again
      const t = this.tokens.get(who.token);
      if (!t) return;
      const before = JSON.stringify(t.view);
      t.view = view ?? t.view;
      if (JSON.stringify(t.view) !== before) this.notify();
      return;
    }
    const key = agentKey(who);
    // an agent that said it leaves is back with its next request: it has no stream to reopen
    this.closed.delete(key);
    this.beat(key, typeof who === "string" ? who : who.name, view, false, true);
  }

  /** What an agent last said it looks at; null when it is not here. */
  agentView(who: string | AgentWho): PresenceView | null {
    if (typeof who !== "string" && who.token) return this.tokens.get(who.token)?.view ?? null;
    return this.sessions.get(agentKey(who))?.view ?? null;
  }

  /** A page closed (its event stream ended), or an agent left (its key, agentKey). An agent with a
   *  token stays listed: it is no longer anywhere. */
  drop(session: string): void {
    for (const [id, t] of this.tokens)
      if (agentKey({ name: t.name, token: id }) === session) {
        if (t.view) {
          t.view = null;
          this.notify();
        }
        return;
      }
    this.closed.set(session, Date.now());
    if (this.sessions.delete(session)) this.notify();
  }

  /** The tokens in force (server/tokens.ts): each one's agent is listed, in the state `talkOf`
   *  says (offline until it is seen), with when its token was last used until it is; an agent whose
   *  token ended goes. */
  setTokens(list: { id: string; name: string; by: string; makerPerson?: string; lastUsed?: string | null }[], talkOf?: (id: string) => AgentTalk): void {
    let changed = false;
    const ids = new Set(list.map((r) => r.id));
    for (const id of [...this.tokens.keys()])
      if (!ids.has(id)) {
        this.tokens.delete(id);
        changed = true;
      }
    for (const r of list) {
      const t = this.tokens.get(r.id);
      if (t) {
        t.by = r.by;
        continue;
      }
      const talk = talkOf?.(r.id) ?? { state: "offline", since: new Date().toISOString(), doing: null, status: null, read: 0, readPublic: 0, lastSeen: null };
      this.tokens.set(r.id, { name: r.name, by: r.by, ...(r.makerPerson ? { byPerson: r.makerPerson } : {}), view: null, talk: { ...talk, lastSeen: talk.lastSeen ?? r.lastUsed ?? null } });
      changed = true;
    }
    if (changed) this.notify();
  }

  /** What an agent with a token does now changed (server/talk.ts). */
  setTalk(id: string, talk: AgentTalk): void {
    const t = this.tokens.get(id);
    if (!t) return;
    t.talk = { ...talk, lastSeen: talk.lastSeen ?? t.talk.lastSeen };
    this.notify();
  }

  /** The token of the agent pages know by `id` (a token agent's entry), or null. */
  tokenOf(id: string): string | null {
    for (const [tok, t] of this.tokens) if (agentKey({ name: t.name, token: tok }) === id) return tok;
    return null;
  }

  /** A page's event stream opened (again, after a lost connection): its heartbeats count. */
  open(session: string): void {
    this.closed.delete(session);
  }

  /** Who is here, as every page is told: a private page is not (privateCount). */
  list(): Peer[] {
    const out: Peer[] = [...this.sessions]
      .filter(([, e]) => !e.private)
      .map(([id, e]) => ({ id, name: e.name, view: e.view, idle: e.idle, ...(e.agent ? { agent: true as const } : {}), ...(e.verified ? { verified: true as const } : {}) }));
    for (const [tok, t] of this.tokens)
      out.push({ id: agentKey({ name: t.name, token: tok }), name: t.name, view: t.view, idle: t.talk.state === "offline", agent: true, talk: t.talk, by: t.by, ...(t.byPerson ? { byPerson: t.byPerson } : {}) });
    return out;
  }

  /** Pages whose heartbeats stopped go; agents silent for a while are away, then go. */
  expire(now = Date.now()): void {
    let changed = false;
    for (const [s, at] of this.closed) if (now - at > GONE_MS) this.closed.delete(s);
    for (const [s, e] of this.sessions) {
      if (now - e.seen > (e.agent ? AGENT_GONE_MS : GONE_MS)) {
        this.sessions.delete(s);
        changed = true;
      } else if (e.agent && !e.idle && now - e.seen > AGENT_IDLE_MS) {
        e.idle = true;
        changed = true;
      }
    }
    // an agent with a token is away while offline, which server/talk.ts says
    if (changed) this.notify();
  }
}
