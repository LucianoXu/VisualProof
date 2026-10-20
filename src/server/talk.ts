// Talking in the page (CollabSpec decision 13, AgentSpec decision 8; the owner's decisions of
// 2026-10-19): the public channel, where everyone with a name and every agent with a token talk; each
// agent's private channel, between it and the person who made its token (its maker, AgentSpec
// decision 7); the agent's inbox, which it waits on; and its state, inferred from what it does.
//
// Nothing is pushed to an agent: it listens by waiting on its inbox (GET /api/agent/inbox?wait=<s>,
// which the wait_for_message tool of VisualProof's MCP server, mcp/visualproof-mcp.mjs, holds open
// for it), so that any agent able to make an HTTP request can be talked to. A wait answers as soon as
// something is handed to the agent, with everything handed since the last answer, in order, each
// saying its channel; or with none once its time is up. Handed to it: its maker's messages in its
// private channel, and a person's message in the public channel that mentions it (shared/mentions.ts).
// Nothing else of the public channel: it reads the channel when it wants (GET /api/agent/channel). An
// agent's mention of an agent is shown and never handed, so that no two agents talk on without a
// person. What comes while no wait is open waits for the next one.
//
// The state each agent is shown in comes from what it does, not from what it says: *listening*
// while a wait is open; *thinking* from the moment messages were handed to it until it replies, with
// what its requests show it doing (server/agenttalk.ts, doingOf) and the line it may set itself;
// *working* when it makes requests with nothing to answer; *offline* once it has had no wait open
// and made no request for its longest wait plus a minute — the time an agent that listens takes at
// most to come back. An offline agent's private channel cannot be written to (409); a mention of it
// in the public channel is written, and handed to it when it comes back.
//
// The channels live apart from the review's logs, in `<site>/chat/`: the public one in `public.jsonl`
// for 90 days, as the timeline is kept; each private one in `<token id>.jsonl` for 30 days; one
// message per line. A message is at most a few thousand characters, and each sender may send only so
// many a minute. A person's message in the public channel keeps the tokens of the agents it is handed
// to (`to`, the agents it mentions that were listed as it was written), which is told to nobody.
// Revoking a token, or its expiry, ends its wait at once. Who may read and write which channel is
// server/main.ts's to check (shared/collab.ts, madeBy), and which page is sent which message
// server/live.ts's.
//
// A session that replaces another knows nothing of what the page still shows (the owner's decisions
// of 2026-10-11). So the first wait after the agent was offline — it left, or went offline by the
// rule, or another session of its MCP server waits now — answers at once with one entry marked as
// earlier, before anything new: its private channel so far, and the mentions of it that came while it
// was away. Its maker can start a new conversation in its private channel: a divider in the same
// file, which the agent is handed as a notice to disregard what came before, and before which a later
// session is told nothing. The public channel has no dividers.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { AgentState, AgentTalk, ChannelKind, ChatMessage } from "../shared/collab.ts";
import { utc } from "./mcptools.ts";

/** how long a private channel's message is kept, and the public channel's (as the timeline) */
export const KEEP_MS = 30 * 24 * 3600 * 1000;
export const KEEP_PUBLIC_MS = 90 * 24 * 3600 * 1000;
/** the longest message a person may send, and an agent's (it may explain at length) */
export const MAX_PERSON = 4000;
export const MAX_AGENT = 10_000;
/** what a page or an agent is given of a channel at once */
export const THREAD = 200;
/** what the server holds of a channel in memory: what pages may page back through */
const HELD = 2000;
/** the longest one wait may last, in seconds: Claude Code gives up on a stdio tool call idle for 30
 *  minutes (progress resets it), and an agent that splits a longer wait asks again */
export const MAX_WAIT_S = 1800;
/** the longest status line an agent may set */
export const MAX_STATUS = 200;
/** what the first wait after an agent was offline hands it of the conversation so far: the newest
 *  messages, at most so many and so many characters of their text, whichever is less */
export const EARLIER_MESSAGES = 50;
export const EARLIER_CHARS = 20_000;
/** a sender's messages: a burst of BURST, then one every REFILL_MS (people), or faster (agents) */
const RATE = { person: { burst: 5, refillMs: 6000 }, agent: { burst: 10, refillMs: 2000 } };
/** the public channel's key, where a private channel's is its token's id (ten hex digits) */
export const PUBLIC = "public";

/** What Talk is told about timing; the defaults are the server's, a test makes them short. */
export interface TalkTiming {
  /** how long an agent with no wait open and no request is still not offline, beyond its longest
   *  wait */
  slackMs: number;
  /** a wait that ended at its time with nothing counts as open this much longer: the agent asks
   *  again at once, and is not shown leaving and coming back in between */
  graceMs: number;
  /** how often the states are looked at again (an agent goes offline by doing nothing) */
  tickMs: number;
}
const TIMING: TalkTiming = { slackMs: 60_000, graceMs: 15_000, tickMs: 1000 };

/** Where someone was when they wrote, in words and as the page tells it (server/agentfollow.ts, placeOf). */
export type Where = NonNullable<ChatMessage["where"]>;

/** One message of a channel (shared/collab.ts). */
export type Message = ChatMessage;

/** A message as it is kept: a person's in the public channel with the tokens of the agents it is
 *  handed to (`to`), which pages and agents are never told. */
interface Kept extends Message {
  to?: string[];
}

/** What a message is written as: who, what, where, and in the public channel to whom it is handed. */
export type Writing = Omit<Kept, "id" | "at" | "channel">;

/** What the first wait after the agent was offline hands it, before anything new: one entry, whose
 *  text holds the messages, each with who wrote it, where they were and when, so that an MCP server
 *  from before it (which reads a message's `from` and `text`) hands the model it as it is. */
export interface Earlier {
  id: 0;
  at: string;
  from: "VisualProof";
  kind: "earlier";
  text: string;
  /** how many messages it holds, and how many before them of its private channel since its last
   *  divider it leaves out (GET /api/agent/conversation has them) */
  count: number;
  omitted: number;
  /** how many of them are mentions of it in the public channel that came while it was away, which
   *  it was never handed */
  missed?: number;
}

/** What a wait hands over: its maker's messages and the dividers' notices, the mentions of it, in
 *  order, after what came before where the agent was offline. */
export type Handed = Message | Earlier;

/** What a wait answers: what it handed over (nothing: its time was up), or that it ended otherwise —
 *  another wait took its place, the agent's token ended, or whoever waited went away. */
export type Inbox =
  | { messages: Handed[]; waitedMs: number; replaced?: true }
  | { ended: "revoked" | "expired"; error: string }
  | { gone: true };

interface Wait {
  at: number;
  end(r: Inbox, timedOut?: boolean): void;
}

/** What the server knows of one agent's talking, by its token's id. */
interface Agent {
  /** its open wait (a newer one ends an older one) */
  wait: Wait | null;
  /** the wait it asked for last, or the longest it said it waits (`max`), in ms: how long it may
   *  be away between two waits */
  waitMs: number;
  /** when its last request came; 0 before the first */
  lastRequest: number;
  /** its last request, or the end of its last wait */
  lastSeen: number | null;
  /** a wait that ended at its time counts as open until then */
  graceUntil: number;
  /** the last message of its private channel handed to it, and of the public channel's mentions of
   *  it: what comes after either is handed at its next wait (reading the channel, GET
   *  /api/agent/channel, hands nothing) */
  read: number;
  readPublic: number;
  /** the channel of the last message handed to it that it was to answer: where its reply goes when
   *  it names none */
  lastChannel: ChannelKind;
  /** when messages were handed to it that it has not answered yet */
  thinkingSince: number | null;
  doing: string | null;
  status: string | null;
  /** as last told, and since when */
  told: AgentTalk | null;
  /** offline since its last wait — it left, went offline by the rule, or another session waits —
   *  so that its next wait hands it what came before first */
  away: boolean;
  /** when its token was last used before this server started (the token file keeps it), until its
   *  first request here; undefined after */
  before?: number | null;
  /** the session its MCP server said it is at its last wait (X-VisualProof-Session), where one says */
  session: string | null;
}

export class Talk {
  private dir: string;
  private timing: TalkTiming;
  private threads = new Map<string, Kept[]>();
  /** each channel's last id in this server's life: a channel whose messages all expired goes on
   *  counting from there, so that no agent's place in it (`read`) passes what comes next */
  private lastIds = new Map<string, number>();
  private agents = new Map<string, Agent>();
  private buckets = new Map<string, { tokens: number; at: number }>();
  private ticks = 0;
  /** told when an agent's state, what it does or its line changes (presence lists it so) */
  onState: (token: string, talk: AgentTalk) => void = () => {};
  /** told of every new message, by its channel (`public`, or the token whose private channel it
   *  is): server/live.ts sends it to the pages that may read it */
  onMessage: (channel: string, m: Message) => void = () => {};
  /** whether a token is still in force, looked at while its agent waits (an expiry between the
   *  minutes the tokens are looked at ends the wait) */
  inForce: (token: string) => boolean = () => true;
  /** when a token was last used, as the token file keeps it (server/tokens.ts), read when its agent
   *  is first known here: whether it was offline while the server was not running */
  lastUsed: (token: string) => string | null = () => null;

  constructor(siteDir: string, timing: Partial<TalkTiming> = {}) {
    this.dir = join(siteDir, "chat");
    this.timing = { ...TIMING, ...timing };
    this.sweep();
    const t = setInterval(() => this.tick(), this.timing.tickMs);
    t.unref?.();
    const daily = setInterval(() => this.sweep(), 24 * 3600 * 1000);
    daily.unref?.();
  }

  // ---------------------------------------------------------------- the agent

  private agent(token: string): Agent {
    let a = this.agents.get(token);
    if (!a) {
      // what was written before the agent was first known here counts as read: it is never handed
      // over as new, and an agent that was offline meanwhile is handed it as what came before. Each
      // token in force is known as the server starts, and a new one as it is made (server/live.ts,
      // presence), so that a mention of it written before its first request is handed to it
      const used = this.lastUsed(token);
      a = {
        wait: null, waitMs: 0, lastRequest: 0, lastSeen: null, graceUntil: 0,
        read: this.load(token).at(-1)?.id ?? 0, readPublic: this.load(PUBLIC).at(-1)?.id ?? 0, lastChannel: "private",
        thinkingSince: null, doing: null, status: null, told: null,
        away: false, before: used ? Date.parse(used) : null, session: null,
      };
      this.agents.set(token, a);
    }
    return a;
  }

  /** A request of the agent's, before it counts: one that finds it offline — it left, or had no
   *  wait open and made no request for its longest wait and a minute — may be a new session's. Its
   *  first request since the server started cannot tell, the server not having seen it go: the
   *  token's last use says — longer ago than the longest wait and a minute (or never), and it would
   *  have been shown offline; sooner, and it is the session that listened before the server stopped,
   *  coming back. */
  private contact(a: Agent, now: number): void {
    if (a.before === undefined) {
      if (stateOf(a, now, this.timing) === "offline") a.away = true;
      return;
    }
    if (a.before === null || now - a.before > MAX_WAIT_S * 1000 + this.timing.slackMs) a.away = true;
    a.before = undefined;
  }

  /** The agent's state now, as pages are told it. */
  talk(token: string, now = Date.now()): AgentTalk {
    const a = this.agent(token);
    const state = stateOf(a, now, this.timing);
    const was = a.told;
    const since =
      state === "thinking" ? a.thinkingSince! : was && was.state === state ? Date.parse(was.since) : state === "listening" ? (a.wait?.at ?? now) : state === "offline" ? (a.lastSeen ?? now) : now;
    const busy = state === "thinking" || state === "working";
    return {
      state,
      since: new Date(since).toISOString(),
      doing: busy ? a.doing : null,
      status: busy ? a.status : null,
      read: a.read,
      readPublic: a.readPublic,
      lastSeen: a.lastSeen === null ? null : new Date(a.lastSeen).toISOString(),
    };
  }

  /** Its state, by name: "offline" cannot be written to. */
  state(token: string, now = Date.now()): AgentState {
    return this.talk(token, now).state;
  }

  /** Where its reply goes when it names no channel: the channel of the last message handed to it
   *  that it was to answer, its private one before any. */
  lastChannel(token: string): ChannelKind {
    return this.agent(token).lastChannel;
  }

  /** Tell presence when what pages show of the agent changed (not when it was last seen alone). */
  private update(token: string, now = Date.now()): void {
    const a = this.agent(token);
    const t = this.talk(token, now);
    const was = a.told;
    a.told = t;
    if (!was || was.state !== t.state || was.since !== t.since || was.doing !== t.doing || was.status !== t.status || was.read !== t.read || was.readPublic !== t.readPublic)
      this.onState(token, t);
  }

  /** States change with time alone (the grace after a wait, going offline); and a token that ended
   *  while its agent waited ends the wait. */
  tick(now = Date.now()): void {
    const look = ++this.ticks % 15 === 0;
    for (const token of [...this.agents.keys()]) {
      if (look && !this.inForce(token)) this.close(token, "expired");
      else this.update(token, now);
    }
  }

  /** The agent said it leaves (POST /api/agent/view {leave: true}; its MCP server does as it
   *  stops): offline at once, its wait ended, until it waits or asks again; its next wait is a new
   *  session's. A leave from another session than the one that waited last (`session`, as
   *  X-VisualProof-Session says it) is one a newer session replaced, whose client goes now: it
   *  leaves nothing, the newer one listening on (false). */
  left(token: string, session: string | null = null, now = Date.now()): boolean {
    const a = this.agent(token);
    if (session !== null && a.session !== null && a.session !== session) return false;
    a.wait?.end({ gone: true });
    a.lastRequest = 0;
    a.graceUntil = 0;
    a.thinkingSince = null;
    a.lastSeen = now;
    a.away = true;
    a.before = undefined;
    this.update(token, now);
    return true;
  }

  /** A request of the agent's: it is not offline, and `doing` (when it says something) is what it
   *  does now. */
  seen(token: string, doing: string | null, now = Date.now()): void {
    const a = this.agent(token);
    this.contact(a, now);
    a.lastRequest = now;
    a.lastSeen = now;
    if (doing !== null) a.doing = doing;
    this.update(token, now);
  }

  /** The agent's own line ("reading the TCB…"), shown with its state until it replies or waits
   *  again; empty clears it. */
  setStatus(token: string, text: string | null, now = Date.now()): AgentTalk {
    const a = this.agent(token);
    this.contact(a, now);
    a.status = text || null;
    a.lastRequest = now;
    a.lastSeen = now;
    this.update(token, now);
    return this.talk(token, now);
  }

  /** The agent waits for messages, at most `ms`; `maxMs` is the longest it waits in all where it
   *  splits a long wait into shorter requests. The answer comes at once with what is waiting, as
   *  soon as something is handed to it, or with nothing at the end; `signal` says the one waiting
   *  went away. The first wait after the agent was offline starts with what came before, and so
   *  answers at once where there is any; `session` is the one its MCP server says it is, where it
   *  says. */
  wait(token: string, ms: number, opts: { maxMs?: number; signal?: AbortSignal; session?: string } = {}, now = Date.now()): Promise<Inbox> {
    const a = this.agent(token);
    this.contact(a, now);
    // another session than the one that waited last knows nothing yet, though it never went
    // offline: the one before ended without saying it left
    if (opts.session) {
      if (a.session !== null && a.session !== opts.session) a.away = true;
      a.session = opts.session;
    }
    a.lastRequest = now;
    a.lastSeen = now;
    a.waitMs = Math.max(ms, opts.maxMs ?? 0);
    // a wait starts afresh: what the agent was doing and the line it set are over
    a.doing = null;
    a.status = null;
    a.thinkingSince = null;
    // a newer wait takes the place of an older one still open (a client that gave up on it without
    // closing it, or a second client with the same token)
    a.wait?.end({ messages: [], waitedMs: now - a.wait.at, replaced: true });
    if (opts.signal?.aborted) return Promise.resolve({ gone: true });
    const queued = this.queued(token);
    let handed: Handed[] = queued.map(outward);
    if (a.away) {
      // once per return: the waits after it are as any. What was queued is accounted for, the
      // dividers it was not handed among it: they are behind what it is told
      a.away = false;
      handed = this.rejoin(token, queued, now);
      this.mark(a, queued);
    }
    if (handed.length || ms <= 0) {
      const r = this.hand(token, queued, handed, 0, now);
      this.update(token, now);
      return Promise.resolve(r);
    }
    return new Promise<Inbox>((done) => {
      const w: Wait = {
        at: now,
        end: (r, timedOut = false) => {
          if (a.wait !== w) return;
          clearTimeout(timer);
          opts.signal?.removeEventListener("abort", away);
          a.wait = null;
          const t = Date.now();
          a.lastSeen = t;
          if (timedOut) a.graceUntil = t + this.timing.graceMs;
          done(r);
          this.update(token, t);
        },
      };
      const timer = setTimeout(() => w.end({ messages: [], waitedMs: Date.now() - now }, true), ms);
      const away = () => w.end({ gone: true });
      opts.signal?.addEventListener("abort", away);
      a.wait = w;
      a.graceUntil = 0;
      this.update(token, now);
    });
  }

  /** What is to be handed to the agent and was not yet, in order: its private channel's messages
   *  but its own (its maker's and the dividers), and the people's messages of the public channel
   *  handed to it (`to`). */
  private queued(token: string): Kept[] {
    const a = this.agent(token);
    const mine = this.load(token).filter((m) => m.kind !== "agent" && m.id > a.read);
    const named = this.load(PUBLIC).filter((m) => m.id > a.readPublic && m.kind === "person" && !!m.to?.includes(token));
    return inOrder(mine, named);
  }

  /** What `queued` holds is the agent's from now on: what comes after it is handed next. */
  private mark(a: Agent, queued: Kept[]): void {
    for (const m of queued) {
      if (m.channel === "public") a.readPublic = Math.max(a.readPublic, m.id);
      else a.read = Math.max(a.read, m.id);
    }
  }

  /** What the first wait after the agent was offline hands over: its private channel since its last
   *  divider that it was handed before, and the mentions of it it was not handed (they came while it
   *  was away), as one entry; then its maker's messages since that divider not handed over yet. A
   *  new session needs no notice of a divider: nothing before it is told. */
  private rejoin(token: string, queued: Kept[], now: number): Handed[] {
    const thread = this.load(token);
    const since = thread.slice(thread.findLastIndex((m) => m.kind === "divider") + 1);
    const fresh = new Set(queued.filter((m) => m.channel === "private").map((m) => m.id));
    const news = since.filter((m) => fresh.has(m.id));
    const told = since.filter((m) => !fresh.has(m.id));
    const missed = queued.filter((m) => m.channel === "public");
    const earlier = earlierOf(inOrder(told, missed), news.length > 0, now);
    return earlier ? [earlier, ...news.map(outward)] : news.map(outward);
  }

  /** Hand over what a wait answers with: what is queued is the agent's from now on; people's
   *  messages among it it thinks about from now until it replies, in the channel of the last of
   *  them, and what it does is what it does from now (a request made while it waited, by another
   *  of its clients, is not). What came before and a divider's notice need no answer. */
  private hand(token: string, queued: Kept[], handed: Handed[], waitedMs: number, now: number): Inbox {
    const a = this.agent(token);
    this.mark(a, queued);
    const asked = handed.filter((m): m is Message => m.kind === "person");
    if (asked.length) {
      a.thinkingSince = now;
      a.lastChannel = asked.at(-1)!.channel;
      a.doing = null;
      a.status = null;
    }
    return { messages: handed, waitedMs };
  }

  /** Hand what is queued for the agent to its open wait, if it has one; else it waits for the next. */
  private wake(token: string, now: number): void {
    const a = this.agents.get(token);
    const w = a?.wait;
    if (!w) return;
    const q = this.queued(token);
    if (q.length) w.end(this.hand(token, q, q.map(outward), now - w.at, now));
  }

  /** End a token's wait: it was revoked, or expired; and forget its agent. */
  close(token: string, why: "revoked" | "expired"): void {
    const a = this.agents.get(token);
    if (!a) return;
    a.wait?.end({ ended: why, error: why === "revoked" ? "Your token was revoked: people can no longer talk to you here." : "Your token expired: people can no longer talk to you here." });
    this.agents.delete(token);
  }

  /** How many agents are listening now, for the server's status. */
  get count(): number {
    let n = 0;
    for (const a of this.agents.values()) if (a.wait) n++;
    return n;
  }

  // ---------------------------------------------------------------- the channels

  /** A channel's messages (`public`, or a token's private channel): the last `limit` of those before
   *  message `before` (all, where it is left out), dividers among them. */
  thread(channel: string, limit = THREAD, before: number | null = null): Message[] {
    const t = this.load(channel);
    const upTo = before === null ? t : t.filter((m) => m.id < before);
    return upTo.slice(-limit).map(outward);
  }

  /** The public channel after message `since`, as an agent reads it (GET /api/agent/channel): at most
   *  the newest `limit`. */
  since(since: number, limit = THREAD): Message[] {
    return this.load(PUBLIC).filter((m) => m.id > since).slice(-limit).map(outward);
  }

  /** The private channel as the agent reads it (GET /api/agent/conversation): the last `limit`
   *  messages since its last divider, with that divider and how many messages came before it; `all`,
   *  the last `limit` whatever conversation they were in, dividers among them. */
  conversation(token: string, limit = THREAD, all = false): { messages: Message[]; divider: Message | null; before: number } {
    const thread = this.load(token);
    const k = thread.findLastIndex((m) => m.kind === "divider");
    return {
      messages: (all ? thread : thread.slice(k + 1)).slice(-limit).map(outward),
      divider: k < 0 ? null : outward(thread[k]),
      before: thread.slice(0, Math.max(k, 0)).filter((m) => m.kind !== "divider").length,
    };
  }

  /** Whether nothing was said in a private channel since its conversation last began (or ever): a
   *  divider then would divide nothing. */
  fresh(token: string): boolean {
    const last = this.load(token).at(-1);
    return !last || last.kind === "divider";
  }

  /** Start a new conversation in a private channel (the owner's decision of 2026-10-11): a divider,
   *  written and sent to the maker's pages as a message is, which the agent is handed at its next
   *  wait, or at once where it listens, as a notice to disregard what came before; a later session
   *  is told only what comes after it. An offline agent's conversation is started anew too, so that
   *  its next session starts clean. Null, and nothing written, where it is new already. */
  restart(token: string, from: string, now = Date.now()): Message | null {
    if (this.fresh(token)) return null;
    return this.post(token, { from, kind: "divider", text: `${from} started a new conversation: disregard what came before.`, where: null }, null, now);
  }

  /** Whether `sender` (kind and name) may send now; if not, the seconds to wait. Taking one. */
  allow(kind: "person" | "agent", sender: string, now = Date.now()): number {
    const r = RATE[kind];
    // the senders whose bursts are full again are forgotten, so that the buckets stay few
    if (this.buckets.size > 2000)
      for (const [k, b] of this.buckets) if (b.at + RATE[k.startsWith("agent") ? "agent" : "person"].burst * RATE[k.startsWith("agent") ? "agent" : "person"].refillMs < now) this.buckets.delete(k);
    const key = `${kind}\u0000${sender}`;
    const b = this.buckets.get(key) ?? { tokens: r.burst, at: now };
    b.tokens = Math.min(r.burst, b.tokens + (now - b.at) / r.refillMs);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return Math.ceil(((1 - b.tokens) * r.refillMs) / 1000);
    b.tokens -= 1;
    return 0;
  }

  /** Write a message in a channel (`public`, or a token's private channel), and send it to the pages
   *  that read it. In a private channel, its maker's message or a divider goes to the agent's open
   *  wait, if it has one, else waits for the next; in the public channel, a person's message goes so
   *  to each agent it is handed to (`to`). An agent's message — the agent is `by`, its token, in the
   *  public channel — answers what it was thinking about. */
  post(channel: string, m: Writing, by: string | null = null, now = Date.now()): Message {
    const thread = this.load(channel);
    const { to, ...rest } = m;
    const id = Math.max(thread.at(-1)?.id ?? 0, this.lastIds.get(channel) ?? 0) + 1;
    this.lastIds.set(channel, id);
    const msg: Kept = { id, at: new Date(now).toISOString(), ...rest, channel: channel === PUBLIC ? "public" : "private", ...(to?.length ? { to } : {}) };
    thread.push(msg);
    if (thread.length > 2 * HELD) thread.splice(0, thread.length - HELD);
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.file(channel), JSON.stringify(msg) + "\n");
    const out = outward(msg);
    this.onMessage(channel, out);
    const writer = channel === PUBLIC ? by : channel;
    if (msg.kind === "agent") {
      if (writer) this.replied(writer, now);
    } else if (channel !== PUBLIC) this.wake(channel, now);
    // an agent's mention of an agent is shown, never handed (AgentSpec decision 8): only a
    // person's message is handed to anyone
    else if (msg.kind === "person") for (const t of msg.to ?? []) this.wake(t, now);
    return out;
  }

  /** The agent wrote: it is not offline, and what it was thinking about is answered. */
  private replied(token: string, now: number): void {
    const a = this.agent(token);
    this.contact(a, now);
    a.lastRequest = now;
    a.lastSeen = now;
    a.thinkingSince = null;
    a.status = null;
    a.doing = null;
    this.update(token, now);
  }

  private file(channel: string): string {
    return join(this.dir, channel === PUBLIC ? "public.jsonl" : `${channel.replace(/[^0-9a-f]/g, "")}.jsonl`);
  }

  /** A channel as it is kept, read once: what is older than it keeps is left out, and the file
   *  written again without it. A line from before channels (0.5.0) is its file's channel's. */
  private load(channel: string): Kept[] {
    const keep = channel === PUBLIC ? KEEP_PUBLIC_MS : KEEP_MS;
    const kind: ChannelKind = channel === PUBLIC ? "public" : "private";
    let t = this.threads.get(channel);
    if (t) {
      const old = t.findIndex((m) => Date.now() - Date.parse(m.at) < keep);
      if (old > 0) t.splice(0, old);
      else if (old < 0) t.length = 0;
      return t;
    }
    t = [];
    const f = this.file(channel);
    if (existsSync(f)) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          t.push({ ...JSON.parse(line), channel: kind });
        } catch {
          // a line cut short (the server stopped while writing): left out
        }
      }
      const kept = t.filter((m) => Date.now() - Date.parse(m.at) < keep);
      if (kept.length !== t.length) {
        t = kept;
        rewrite(f, kept);
      }
      if (t.length > HELD) t = t.slice(-HELD);
    }
    const last = t.at(-1)?.id ?? 0;
    if (last > (this.lastIds.get(channel) ?? 0)) this.lastIds.set(channel, last);
    this.threads.set(channel, t);
    return t;
  }

  /** Channels nobody wrote in for as long as they are kept go; the others lose what is older (when
   *  read). */
  sweep(now = Date.now()): void {
    if (!existsSync(this.dir)) return;
    for (const name of readdirSync(this.dir)) {
      const f = join(this.dir, name);
      const channel = name.replace(/\.jsonl$/, "");
      try {
        if (now - statSync(f).mtimeMs > (channel === PUBLIC ? KEEP_PUBLIC_MS : KEEP_MS)) {
          rmSync(f, { force: true });
          this.threads.delete(channel);
        }
      } catch {
        // gone meanwhile
      }
    }
  }
}

/** A message as pages and agents are told it: without whom it is handed to. */
function outward(m: Kept): Message {
  const { to: _to, ...rest } = m;
  return rest;
}

/** A message as a page is told it (CollabSpec decision 13): where its writer was is handed to agents
 *  and never drawn, so a page is not sent it. */
export function forPages(m: Message): Message {
  const { where: _where, ...rest } = m;
  return rest;
}

/** Two channels' messages as one list, in the order they were written. */
function inOrder<T extends Message>(a: T[], b: T[]): T[] {
  if (!b.length) return a;
  if (!a.length) return b;
  return [...a, ...b].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
}

/** What came before as the entry a returning agent is handed first, or null where there is none: the
 *  newest of `told`, at most EARLIER_MESSAGES and EARLIER_CHARS characters of text, each with who
 *  wrote it (the agent's own as its own), where they were and when — the mentions of it in the public
 *  channel said so; then what to do, as `news` says whether anything new comes after it. */
export function earlierOf(told: Message[], news: boolean, now = Date.now()): Earlier | null {
  let k = told.length;
  let chars = 0;
  while (k > 0 && told.length - k < EARLIER_MESSAGES && chars + told[k - 1].text.length <= EARLIER_CHARS) chars += told[--k].text.length;
  const kept = told.slice(k);
  if (!kept.length) return null;
  const each = kept.map((m) => {
    const who = m.kind === "agent" ? `You (${m.from})` : m.from;
    const where = m.where?.inWords ? `, on ${m.where.inWords.replace(/\.$/, "")}` : "";
    const pub = m.channel === "public";
    return `— ${who}${pub ? " in the public channel, mentioning you while you were away" : ""}${where}, ${utc(m.at)} (${pub ? "public " : ""}message ${m.id}):\n${m.text}`;
  });
  const omitted = k;
  const cut = omitted ? ` (its last ${kept.length} messages; the conversation tool, GET /api/agent/conversation, gives the ${omitted} before them)` : "";
  const away = kept.filter((m) => m.channel === "public").length;
  const missed = away
    ? "Those in the public channel came while you were away and were never handed to you: answer one there (reply with channel public) only where it still asks something of you. "
    : "";
  const then = news ? "What came since follows: answer that." : missed ? "Nothing else came since: listen again after that." : "Nothing came since: there is nothing to answer. Listen again.";
  return {
    id: 0,
    at: new Date(now).toISOString(),
    from: "VisualProof",
    kind: "earlier",
    text: `Earlier in this conversation, before you joined${cut} — read it as context, and do not answer it again:\n\n${each.join("\n\n")}\n\nEnd of the earlier messages. ${missed}${then}`,
    count: kept.length,
    omitted,
    ...(away ? { missed: away } : {}),
  };
}

/** An agent's state at `now`, from what it did: a wait open (or one that ended at its time just
 *  now, which it is about to ask again); else offline after its longest wait and a minute without a
 *  request; else thinking about what was handed to it, or working. */
function stateOf(a: Agent, now: number, timing: TalkTiming): AgentState {
  if (a.wait || now < a.graceUntil) return "listening";
  if (!a.lastRequest || now - a.lastRequest > a.waitMs + timing.slackMs) return "offline";
  return a.thinkingSince !== null ? "thinking" : "working";
}

function rewrite(f: string, ms: Kept[]): void {
  if (!ms.length) return void rmSync(f, { force: true });
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, ms.map((m) => JSON.stringify(m)).join("\n") + "\n");
  renameSync(tmp, f);
}
