// Talking with an agent in the page (AgentSpec decision 8): one conversation per agent token, shared
// by everyone on the server; the agent's inbox, which it waits on; and its state, inferred from what
// it does.
//
// Nothing is pushed to an agent: it listens by waiting on its inbox (GET /api/agent/inbox?wait=<s>,
// which the wait_for_message tool of VisualProof's MCP server, mcp/visualproof-mcp.mjs, holds open
// for it), so that any agent able to make an HTTP request can be talked to. A wait answers as soon
// as a person writes, with every message that came since the last one handed over, in order; or
// with none once its time is up. A message that comes while no wait is open waits for the next one.
//
// The state each agent is shown in comes from what it does, not from what it says: *listening*
// while a wait is open; *thinking* from the moment messages were handed to it until it replies, with
// what its requests show it doing (server/agent.ts, doingOf) and the line it may set itself;
// *working* when it makes requests with nothing to answer; *offline* once it has had no wait open
// and made no request for its longest wait plus a minute — the time an agent that listens takes at
// most to come back. Only an offline agent cannot be written to (409).
//
// Conversations live apart from the review's logs, in `<site>/chat/<token id>.jsonl`, one message per
// line, for 30 days; a message is at most a few thousand characters, and each sender may send only
// so many a minute. Revoking a token, or its expiry, ends its wait at once.
//
// A session that replaces another knows nothing of the conversation the page still shows (the
// owner's decisions of 2026-10-11). So the first wait after the agent was offline — it left, or went
// offline by the rule, or another session of its MCP server waits now — answers at once with the
// conversation so far, as one entry marked as earlier, before anything new. And anyone who can
// write to the agent can start a new conversation: a divider in the same file, which the agent is
// handed as a notice to disregard what came before, and before which a later session is told
// nothing.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { AgentState, AgentTalk, ChatMessage } from "../shared/collab.ts";
import { utc } from "./mcptools.ts";

/** how long a message is kept */
export const KEEP_MS = 30 * 24 * 3600 * 1000;
/** the longest message a person may send, and an agent's reply (it may explain at length) */
export const MAX_PERSON = 4000;
export const MAX_AGENT = 10_000;
/** what a page or an agent is given of a conversation at once */
export const THREAD = 200;
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

/** Where someone was when they wrote, in words and as the page tells it (server/agent.ts, placeOf). */
export type Where = NonNullable<ChatMessage["where"]>;

/** One message of a conversation (shared/collab.ts). */
export type Message = ChatMessage;

/** The conversation so far, handed at the first wait after the agent was offline, before anything
 *  new: one entry, whose text holds the messages, each with who wrote it, where they were and when,
 *  so that an MCP server from before it (which reads a message's `from` and `text`) hands the model
 *  it as it is. */
export interface Earlier {
  id: 0;
  at: string;
  from: "VisualProof";
  kind: "earlier";
  text: string;
  /** how many messages it holds, and how many before them since the conversation began it leaves
   *  out (GET /api/agent/conversation has them) */
  count: number;
  omitted: number;
}

/** What a wait hands over: people's messages and the dividers' notices, in order, after the
 *  conversation so far where the agent was offline. */
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
  /** the last message handed to it */
  read: number;
  /** when messages were handed to it that it has not answered yet */
  thinkingSince: number | null;
  doing: string | null;
  status: string | null;
  /** as last told, and since when */
  told: AgentTalk | null;
  /** offline since its last wait — it left, went offline by the rule, or another session waits —
   *  so that its next wait hands it the conversation so far first */
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
  private threads = new Map<string, Message[]>();
  private agents = new Map<string, Agent>();
  private buckets = new Map<string, { tokens: number; at: number }>();
  private ticks = 0;
  /** told when an agent's state, what it does or its line changes (presence lists it so) */
  onState: (token: string, talk: AgentTalk) => void = () => {};
  /** told of every new message, to go to every page */
  onMessage: (token: string, m: Message) => void = () => {};
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
      // what was written before the server started counts as read: it is never handed over as
      // new, and an agent that was offline meanwhile is handed it as the conversation so far
      const used = this.lastUsed(token);
      a = {
        wait: null, waitMs: 0, lastRequest: 0, lastSeen: null, graceUntil: 0, read: this.load(token).at(-1)?.id ?? 0, thinkingSince: null, doing: null, status: null, told: null,
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
      lastSeen: a.lastSeen === null ? null : new Date(a.lastSeen).toISOString(),
    };
  }

  /** Its state, by name: "offline" cannot be written to. */
  state(token: string, now = Date.now()): AgentState {
    return this.talk(token, now).state;
  }

  /** Tell presence when what pages show of the agent changed (not when it was last seen alone). */
  private update(token: string, now = Date.now()): void {
    const a = this.agent(token);
    const t = this.talk(token, now);
    const was = a.told;
    a.told = t;
    if (!was || was.state !== t.state || was.since !== t.since || was.doing !== t.doing || was.status !== t.status || was.read !== t.read) this.onState(token, t);
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
   *  session's. */
  left(token: string, now = Date.now()): void {
    const a = this.agent(token);
    a.wait?.end({ gone: true });
    a.lastRequest = 0;
    a.graceUntil = 0;
    a.thinkingSince = null;
    a.lastSeen = now;
    a.away = true;
    a.before = undefined;
    this.update(token, now);
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
   *  soon as a person writes, or with nothing at the end; `signal` says the one waiting went away.
   *  The first wait after the agent was offline starts with the conversation so far, and so answers
   *  at once where there is any; `session` is the one its MCP server says it is, where it says. */
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
    let handed: Handed[] = queued;
    if (a.away) {
      // once per return: the waits after it are as any
      a.away = false;
      handed = this.rejoin(token, queued, now);
      // the dividers it was not handed are behind what it is told
      if (!handed.length && queued.length) a.read = queued.at(-1)!.id;
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

  /** People's messages and dividers not yet handed to the agent, in order. */
  private queued(token: string): Message[] {
    const a = this.agent(token);
    return this.load(token).filter((m) => m.kind !== "agent" && m.id > a.read);
  }

  /** What the first wait after the agent was offline hands over: the conversation since its last
   *  divider, as one entry, then people's messages since that divider not handed over yet. A new
   *  session needs no notice of a divider: nothing before it is told. */
  private rejoin(token: string, queued: Message[], now: number): Handed[] {
    const thread = this.load(token);
    const since = thread.slice(thread.findLastIndex((m) => m.kind === "divider") + 1);
    const fresh = new Set(queued.map((m) => m.id));
    const news = since.filter((m) => fresh.has(m.id));
    const told = since.filter((m) => !fresh.has(m.id));
    const earlier = earlierOf(told, news.length > 0, now);
    return earlier ? [earlier, ...news] : news;
  }

  /** Hand over what a wait answers with: what is queued is the agent's from now on (`read`); people's
   *  messages among it it thinks about from now until it replies, and what it does is what it does
   *  from now (a request made while it waited, by another of its clients, is not). The conversation
   *  so far and a divider's notice need no answer. */
  private hand(token: string, queued: Message[], handed: Handed[], waitedMs: number, now: number): Inbox {
    const a = this.agent(token);
    if (queued.length) a.read = queued.at(-1)!.id;
    if (handed.some((m) => m.kind === "person")) {
      a.thinkingSince = now;
      a.doing = null;
      a.status = null;
    }
    return { messages: handed, waitedMs };
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

  // ---------------------------------------------------------------- the conversation

  /** A conversation's messages, the last `limit`, of the last 30 days, dividers among them. */
  thread(token: string, limit = THREAD): Message[] {
    return this.load(token).slice(-limit);
  }

  /** The conversation as the agent reads it (GET /api/agent/conversation): the last `limit` messages
   *  since its last divider, with that divider and how many messages came before it; `all`, the last
   *  `limit` whatever conversation they were in, dividers among them. */
  conversation(token: string, limit = THREAD, all = false): { messages: Message[]; divider: Message | null; before: number } {
    const thread = this.load(token);
    const k = thread.findLastIndex((m) => m.kind === "divider");
    return {
      messages: (all ? thread : thread.slice(k + 1)).slice(-limit),
      divider: k < 0 ? null : thread[k],
      before: thread.slice(0, Math.max(k, 0)).filter((m) => m.kind !== "divider").length,
    };
  }

  /** Whether nothing was said since the conversation last began (or ever): a divider then would
   *  divide nothing. */
  fresh(token: string): boolean {
    const last = this.load(token).at(-1);
    return !last || last.kind === "divider";
  }

  /** Start a new conversation (the owner's decision of 2026-10-11): a divider, written and sent to
   *  every page as a message is, which the agent is handed at its next wait, or at once where it
   *  listens, as a notice to disregard what came before; a later session is told only what comes
   *  after it. An offline agent's conversation is started anew too, so that its next session starts
   *  clean. Null, and nothing written, where it is new already. */
  restart(token: string, from: string, now = Date.now()): Message | null {
    if (this.fresh(token)) return null;
    return this.post(token, { from, kind: "divider", text: `${from} started a new conversation: disregard what came before.`, where: null }, now);
  }

  /** Whether `sender` (kind and name) may send now; if not, the seconds to wait. Taking one. */
  allow(kind: "person" | "agent", sender: string, now = Date.now()): number {
    const r = RATE[kind];
    const key = `${kind}\u0000${sender}`;
    const b = this.buckets.get(key) ?? { tokens: r.burst, at: now };
    b.tokens = Math.min(r.burst, b.tokens + (now - b.at) / r.refillMs);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return Math.ceil(((1 - b.tokens) * r.refillMs) / 1000);
    b.tokens -= 1;
    return 0;
  }

  /** Add a message to a conversation: written, and sent to every page. A person's, or a divider,
   *  goes to the agent's open wait, if it has one, else waits for the next; the agent's answers
   *  what it was thinking about. */
  post(token: string, m: Omit<Message, "id" | "at">, now = Date.now()): Message {
    const thread = this.load(token);
    const msg: Message = { id: (thread.at(-1)?.id ?? 0) + 1, at: new Date(now).toISOString(), ...m };
    thread.push(msg);
    if (thread.length > 4 * THREAD) thread.splice(0, thread.length - 2 * THREAD);
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.file(token), JSON.stringify(msg) + "\n");
    this.onMessage(token, msg);
    const a = this.agent(token);
    if (msg.kind !== "agent") {
      const w = a.wait;
      if (w) {
        const q = this.queued(token);
        w.end(this.hand(token, q, q, now - w.at, now));
      }
    } else {
      this.contact(a, now);
      a.lastRequest = now;
      a.lastSeen = now;
      a.thinkingSince = null;
      a.status = null;
      a.doing = null;
      this.update(token, now);
    }
    return msg;
  }

  private file(token: string): string {
    return join(this.dir, `${token.replace(/[^0-9a-f]/g, "")}.jsonl`);
  }

  /** A conversation as it is kept, read once: what is older than 30 days is left out, and the file
   *  written again without it. */
  private load(token: string): Message[] {
    let t = this.threads.get(token);
    if (t) {
      const old = t.findIndex((m) => Date.now() - Date.parse(m.at) < KEEP_MS);
      if (old > 0) t.splice(0, old);
      else if (old < 0) t.length = 0;
      return t;
    }
    t = [];
    const f = this.file(token);
    if (existsSync(f)) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          t.push(JSON.parse(line));
        } catch {
          // a line cut short (the server stopped while writing): left out
        }
      }
      const kept = t.filter((m) => Date.now() - Date.parse(m.at) < KEEP_MS);
      if (kept.length !== t.length) {
        t = kept;
        rewrite(f, kept);
      }
    }
    this.threads.set(token, t);
    return t;
  }

  /** Conversations nobody wrote in for 30 days go; the others lose what is older (when read). */
  sweep(now = Date.now()): void {
    if (!existsSync(this.dir)) return;
    for (const name of readdirSync(this.dir)) {
      const f = join(this.dir, name);
      try {
        if (now - statSync(f).mtimeMs > KEEP_MS) {
          rmSync(f, { force: true });
          this.threads.delete(name.replace(/\.jsonl$/, ""));
        }
      } catch {
        // gone meanwhile
      }
    }
  }
}

/** The conversation so far as the entry a returning agent is handed first, or null where there is
 *  none: the newest of `told`, at most EARLIER_MESSAGES and EARLIER_CHARS characters of text, each
 *  with who wrote it (the agent's own as its own), where they were and when; then what to do, as
 *  `news` says whether anything new comes after it. */
export function earlierOf(told: Message[], news: boolean, now = Date.now()): Earlier | null {
  let k = told.length;
  let chars = 0;
  while (k > 0 && told.length - k < EARLIER_MESSAGES && chars + told[k - 1].text.length <= EARLIER_CHARS) chars += told[--k].text.length;
  const kept = told.slice(k);
  if (!kept.length) return null;
  const each = kept.map((m) => {
    const who = m.kind === "agent" ? `You (${m.from})` : m.from;
    const where = m.where?.inWords ? `, on ${m.where.inWords.replace(/\.$/, "")}` : "";
    return `— ${who}${where}, ${utc(m.at)} (message ${m.id}):\n${m.text}`;
  });
  const cut = k ? ` (its last ${kept.length} messages; the conversation tool, GET /api/agent/conversation, gives the ${k} before them)` : "";
  const then = news ? "What came since follows: answer that." : "Nothing came since: there is nothing to answer. Listen again.";
  return {
    id: 0,
    at: new Date(now).toISOString(),
    from: "VisualProof",
    kind: "earlier",
    text: `Earlier in this conversation, before you joined${cut} — read it as context, and do not answer it again:\n\n${each.join("\n\n")}\n\nEnd of the earlier messages. ${then}`,
    count: kept.length,
    omitted: k,
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

function rewrite(f: string, ms: Message[]): void {
  if (!ms.length) return void rmSync(f, { force: true });
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, ms.map((m) => JSON.stringify(m)).join("\n") + "\n");
  renameSync(tmp, f);
}
