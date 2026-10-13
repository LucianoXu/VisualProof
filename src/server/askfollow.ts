// Asking others to follow (CollabSpec decision 10, AgentSpec decision 8; the owner's decisions of
// 2026-10-12). A reader with a name who is visible, or an agent at level advise or full, asks
// everyone on the server — private readers too, who are counted, never named — or one person to
// follow them. The server relays the request to each page asked as one of its live events (`ask`),
// and each page's answer to the asking page (`ask-answer`) or to the agent, which waits for them; it
// holds each asker to one request per 30 s, and checks who may ask. A page shows one request at a
// time: a newer one, from another asker, replaces it there, and the one replaced counts as not
// answered. A request ends when every page asked has answered or its 30 s are over (and a little
// more, for an answer on its way); its asker leaving, or going private, withdraws it. Nothing is
// kept past a request's life but when each asker last asked, for the 30 s that it counts.
//
// The server does not know who follows whom — following is the page's own (web/src/people.ts) — so
// a page asked whose reader follows the asker already answers so at once (`following`), shows
// nothing, and is not counted as asked.
//
// The agents' endpoint (POST /api/agent/ask-follow) is server/agent.ts's, in its shape
// (server/agentviews.ts, AgentEndpoint), as the notes' are (server/agentnotes.ts).

import { randomBytes } from "node:crypto";
import { sameName } from "../shared/collab.ts";
import type { Peer } from "../shared/collab.ts";
import { ASK_GRACE_MS, ASK_MS, ASK_WORDS, askLine, cleanAnswer, foldAnswers } from "../shared/askfollow.ts";
import type { AskAnswer, AskFollow, AskSent, AskState } from "../shared/askfollow.ts";
import type { Answer, Caller, Need } from "./agent.ts";
import { fail, whoOf } from "./agent.ts";
import type { AgentEndpoint } from "./agentviews.ts";
import { agentKey } from "./presence.ts";

/** An open event stream as a request reads it: the secret its page holds, the id the others know it
 *  by, whether it is private, and the name its page goes by where it is listed. */
export interface AskStream {
  token: string;
  id: string;
  private: boolean;
  name: string | null;
  verified: boolean;
}

/** What a request needs of the live server (server/live.ts): the open streams, who is listed, and
 *  a way to tell one page something. */
export interface AskPort {
  streams(): AskStream[];
  peers(): Peer[];
  send(token: string, event: string, data: unknown): void;
}

/** Who asks. */
export interface Asker {
  name: string;
  verified: boolean;
  agent: boolean;
  /** their entry in presence: whom the pages asked follow */
  from: string;
  /** the asking page's stream, by its secret: it is told every answer; none for an agent, which
   *  waits for them */
  stream: string | null;
  /** whose requests count together for the rate: the person (their personal link, else their name)
   *  and their page, or the agent (its token, else its name) */
  rate: string[];
}

/** Whom a request goes to: everyone; the person whose page is listed under `page` (all their pages);
 *  the person going by `name` (an agent names them, as its companion lists people). */
export type Whom = { everyone: true } | { page: string } | { name: string };

/** A refusal, as both doors word it: what went wrong, and what to do instead. */
export interface AskRefusal {
  status: number;
  error: string;
  hint: string;
  retryAfter?: number;
  didYouMean?: string[];
}

/** What a request came to: each person asked (by the name they went by, a page without a name each on
 *  its own), the private pages counted, and the outcome in a line. */
export interface AskReport {
  id: string | null;
  pages: number;
  people: { name: string | null; verified?: true; answer: string }[];
  private: { asked: number } & Partial<Record<string, number>>;
  summary: string;
}

interface Target {
  /** the stream as it was when asked: its name, and whether it was private */
  was: AskStream;
  answer: AskAnswer | null;
}

interface Request {
  id: string;
  asker: Asker;
  targets: Map<string, Target>;
  timer: ReturnType<typeof setTimeout>;
  waiters: Set<(r: AskReport) => void>;
}

/** The key a name counts under: whatever the case, however Unicode writes it (shared/collab.ts,
 *  sameName). */
const nameKey = (s: string) => s.trim().normalize("NFKC").toLowerCase();

export class Asks {
  private port: AskPort;
  private ms: number;
  private grace: number;
  private requests = new Map<string, Request>();
  /** the request each page shows, by its stream's secret, while it has not answered it */
  private showing = new Map<string, string>();
  /** when each asker last asked, kept only while it counts */
  private last = new Map<string, number>();
  now = () => Date.now();

  constructor(port: AskPort, opts: { ms?: number; grace?: number } = {}) {
    this.port = port;
    this.ms = opts.ms ?? ASK_MS;
    this.grace = opts.grace ?? ASK_GRACE_MS;
  }

  /** How many requests are going on: none is kept past its life. */
  get pending(): number {
    return this.requests.size;
  }

  /** Seconds before `asker` may ask again; 0 when they may. What no longer counts is forgotten. */
  retryAfter(asker: Pick<Asker, "rate">): number {
    const now = this.now();
    for (const [k, at] of this.last) if (now - at >= this.ms) this.last.delete(k);
    const since = Math.max(-Infinity, ...asker.rate.map((k) => this.last.get(k) ?? -Infinity));
    return Number.isFinite(since) ? Math.max(1, Math.ceil((since + this.ms - now) / 1000)) : 0;
  }

  /** Ask `whom` to follow `asker`: the request is told to every page of theirs at once, the one each
   *  showed replaced. Nobody there to ask is no request, and does not count for the rate. */
  ask(asker: Asker, whom: Whom): { ok: AskSent & { report: AskReport } } | AskRefusal {
    const wait = this.retryAfter(asker);
    if (wait) return { status: 429, error: `You asked a moment ago: one request every ${Math.round(this.ms / 1000)} s. Ask again in ${wait} s.`, hint: `Wait ${wait} s.`, retryAfter: wait };
    const found = this.whom(asker, whom);
    if (!Array.isArray(found)) return found;
    if (!found.length) return { ok: { id: null, asked: [], private: 0, ms: this.ms, report: { id: null, pages: 0, people: [], private: { asked: 0 }, summary: "Nobody is on the page to ask." } } };
    for (const k of asker.rate) this.last.set(k, this.now());
    const id = randomBytes(9).toString("base64url");
    const r: Request = { id, asker, targets: new Map(found.map((s) => [s.token, { was: s, answer: null }])), timer: setTimeout(() => this.expire(id), this.ms + this.grace), waiters: new Set() };
    r.timer.unref?.();
    this.requests.set(id, r);
    const told: AskFollow = { id, from: asker.from, name: asker.name, ...(asker.agent ? { agent: true as const } : {}), ...(asker.verified ? { verified: true as const } : {}), ms: this.ms };
    for (const s of found) {
      // the request this page showed is replaced by this one, from the newest asker: not answered
      const was = this.showing.get(s.token);
      if (was && was !== id) this.answered(was, s.token, "timeout");
      this.showing.set(s.token, id);
      this.port.send(s.token, "ask", told);
    }
    return { ok: { id, asked: found.filter((s) => !s.private).map((s) => s.id), private: found.filter((s) => s.private).length, ms: this.ms, report: this.report(r) } };
  }

  /** The pages `whom` names, but the asker's own; or why there are none to name. */
  private whom(asker: Asker, whom: Whom): AskStream[] | AskRefusal {
    const streams = this.port.streams();
    // the asker's own pages: the one that asks, and the others of a person of their name
    const own = (s: AskStream) => s.token === asker.stream || (!asker.agent && !s.private && s.name !== null && sameName(s.name, asker.name) && s.verified === asker.verified);
    const pagesOf = (s: AskStream) => (s.name === null ? [s] : streams.filter((x) => !x.private && x.name !== null && sameName(x.name, s.name!) && x.verified === s.verified));
    const peers = this.port.peers();
    if ("everyone" in whom) return streams.filter((s) => !own(s));
    if ("page" in whom) {
      const p = peers.find((x) => x.id === whom.page);
      if (p?.agent) return { status: 409, error: `${p.name} is an agent: agents cannot be asked to follow.`, hint: "Ask a person." };
      const s = streams.find((x) => x.id === whom.page && !x.private);
      if (!p || !s) return { status: 404, error: "That reader is not here any more.", hint: "Ask someone among the initials at the top right." };
      if (own(s)) return { status: 400, error: "That is you.", hint: "Ask someone else." };
      return pagesOf(s).filter((x) => !own(x));
    }
    const named = streams.filter((s) => !s.private && s.name !== null && sameName(s.name, whom.name));
    if (!named.length) {
      if (peers.some((p) => p.agent && p.name !== null && sameName(p.name, whom.name))) return { status: 409, error: `${whom.name} is an agent: agents cannot be asked to follow.`, hint: "Ask a person." };
      const names = [...new Set(streams.flatMap((s) => (!s.private && s.name !== null && !own(s) ? [s.name] : [])))].sort();
      return { status: 404, error: `Nobody called ${whom.name} is on the page.`, hint: names.length ? `GET /api/agent/companion lists the people here: ${names.join(", ")}.` : "Nobody else is on the page now; GET /api/agent/companion?wait=60 tells you when someone comes.", didYouMean: names.slice(0, 5) };
    }
    const mine = named.filter((s) => !own(s));
    return mine.length ? mine : { status: 400, error: "That is you.", hint: "Ask someone else." };
  }

  /** A page answers, by its stream's secret: once, a request it was asked and that goes on. */
  answer(token: string, id: unknown, answer: unknown): { status: number; body: unknown } {
    const a = cleanAnswer(answer);
    if (!a) return { status: 400, body: { error: "answer is follow, decline, timeout or following." } };
    const r = typeof id === "string" ? this.requests.get(id) : undefined;
    if (!r) return { status: 404, body: { error: "This request is over." } };
    const t = r.targets.get(token);
    if (!t) return { status: 403, body: { error: "This page was not asked." } };
    if (t.answer) return { status: 409, body: { error: "This page answered already." } };
    this.answered(r.id, token, a);
    return { status: 200, body: { ok: true } };
  }

  /** Waits for request `id` to end, and resolves to what it came to; at once where it is over or
   *  unknown (null), or when `signal` aborts (what it came to so far). */
  settled(id: string, signal?: AbortSignal): Promise<AskReport | null> {
    const r = this.requests.get(id);
    if (!r) return Promise.resolve(null);
    return new Promise((done) => {
      const end = (rep: AskReport) => {
        r.waiters.delete(end);
        signal?.removeEventListener("abort", stop);
        done(rep);
      };
      const stop = () => end(this.report(r));
      r.waiters.add(end);
      signal?.addEventListener("abort", stop, { once: true });
    });
  }

  /** A page's event stream closed: what it was asked is not answered, and what it asked is withdrawn. */
  closed(token: string): void {
    this.withdraw(token, false);
    for (const r of [...this.requests.values()]) if (r.targets.get(token)?.answer === null) this.answered(r.id, token, "timeout");
    this.showing.delete(token);
  }

  /** The page that asked can no longer be followed — it went private, or closed (`told` false: it is
   *  not there to tell): its requests end, each page that has not answered is told so (`ask-end`),
   *  and the asker that it did not. */
  withdraw(token: string, told = true): void {
    for (const r of [...this.requests.values()]) {
      if (r.asker.stream !== token) continue;
      for (const [tok, t] of r.targets) {
        if (t.answer) continue;
        if (this.showing.get(tok) === r.id) this.showing.delete(tok);
        this.port.send(tok, "ask-end", { id: r.id });
        if (told) this.answered(r.id, tok, "timeout");
      }
      this.finish(r);
    }
  }

  /** Page `token`'s answer to request `id`: kept, and told to whoever asked. */
  private answered(id: string, token: string, answer: AskAnswer): void {
    const r = this.requests.get(id);
    const t = r?.targets.get(token);
    if (!r || !t || t.answer) return;
    t.answer = answer;
    if (this.showing.get(token) === id) this.showing.delete(token);
    if (r.asker.stream) {
      // a page is named as the others know it now: a private one by nobody
      const now = this.port.streams().find((s) => s.token === token) ?? t.was;
      this.port.send(r.asker.stream, "ask-answer", { id, from: now.private ? null : now.id, answer });
    }
    if ([...r.targets.values()].every((x) => x.answer)) this.finish(r);
  }

  /** The request's time is over: the pages that have not answered did not, and are told it ended. */
  private expire(id: string): void {
    const r = this.requests.get(id);
    if (!r) return;
    for (const [tok, t] of r.targets) {
      if (t.answer) continue;
      this.port.send(tok, "ask-end", { id });
      this.answered(id, tok, "timeout");
    }
    this.finish(r);
  }

  /** The request is over: whoever waits for it is told what it came to, and nothing of it is kept. */
  private finish(r: Request): void {
    if (!this.requests.has(r.id)) return;
    clearTimeout(r.timer);
    this.requests.delete(r.id);
    for (const [tok] of r.targets) if (this.showing.get(tok) === r.id) this.showing.delete(tok);
    const rep = this.report(r);
    for (const w of [...r.waiters]) w(rep);
  }

  /** What request `r` came to so far, person by person. */
  private report(r: Request): AskReport {
    const people = new Map<string, { name: string | null; verified: boolean; answers: (AskAnswer | null)[] }>();
    const priv: (AskAnswer | null)[] = [];
    for (const [tok, t] of r.targets) {
      if (t.was.private) {
        priv.push(t.answer);
        continue;
      }
      const key = t.was.name === null ? `s:${tok}` : `${t.was.verified ? "v" : "n"}:${nameKey(t.was.name)}`;
      const p = people.get(key) ?? { name: t.was.name, verified: t.was.verified, answers: [] };
      p.answers.push(t.answer);
      people.set(key, p);
    }
    const states: AskState[] = [];
    const out = [...people.values()].map((p) => {
      const s = foldAnswers(p.answers);
      states.push(s);
      return { name: p.name, ...(p.verified ? { verified: true as const } : {}), answer: ASK_WORDS[s] };
    });
    const counts: Partial<Record<string, number>> = {};
    for (const a of priv) {
      const s = foldAnswers([a]);
      states.push(s);
      counts[ASK_WORDS[s]] = (counts[ASK_WORDS[s]] ?? 0) + 1;
    }
    return { id: r.id, pages: r.targets.size, people: out, private: { asked: priv.length, ...counts }, summary: askLine(states) ?? (states.length ? "Everyone asked follows you already." : "Nobody was asked.") };
  }
}

/** The agents' endpoint (AgentSpec decision 8): an agent at level advise or full asks everyone on
 *  the page, or one person, to follow it, and waits for their answers. */
export function askEndpoints(world: { asks?: Asks; presence: { list(): Peer[] } }, refuse: (c: Caller, need: Need) => Answer | null): AgentEndpoint[] {
  return [
    {
      method: "POST",
      path: "/api/agent/ask-follow",
      needs: "advise",
      about:
        "Ask the people on the page to follow you (the owner's decision of 2026-10-12): everyone — private readers too, counted, never named — or one person (who). Each sees a banner for 30 s, \"<you> (agent) asks you to follow · Follow · Not now\", with your mark; following you opens your conversation. Those following you already are not asked. One request every 30 s. The answer waits for theirs, at most the 30 s the request lasts (wait: false answers at once): who follows you now, who declined, who did not answer. Agents cannot be asked to follow.",
      params: { who: "optional: a person's name, as GET /api/agent/companion lists people; left out, everyone on the page", wait: "false: answer at once, with whom it asked, without their answers (default: wait for them, at most 30 s)" },
      returns: "{ok, id, pages, people: [{name, verified?, answer: following|declined|no answer|already following|waiting}], private: {asked, following?, declined?, no answer?, already following?, waiting?}, summary, waited} — 429 with retryAfter within 30 s of your last request",
      run: async (a) => {
        const c = a.caller;
        if (c.kind !== "agent") return fail(400, "This API records what agents do: say you are one.", "Send X-VisualProof-Kind: agent with every request, beside X-VisualProof-Name.");
        if (!c.name) return fail(401, "Say who you are first: a request to follow says who asks.", "Send X-VisualProof-Name: <your name>, e.g. Claude.", { who: true });
        const no = refuse(c, "advise");
        if (no) return no;
        if (!world.asks) return fail(404, "This server relays no requests to follow.", "Point people at what you look at with a note, or a link (POST /api/agent/view/link).");
        // people follow the agent's entry in presence: one not listed could not be followed
        const from = agentKey(whoOf(c));
        if (!world.presence.list().some((p) => p.id === from)) return fail(409, "You are not among the people on the page, so nobody could follow you.", "Agents without a token of their own are listed 32 at most; ask again once one has gone, or ask for a token (Share, then AI agent, in the page).");
        const b = a.body && typeof a.body === "object" && !Array.isArray(a.body) ? (a.body as Record<string, unknown>) : {};
        if (b.who !== undefined && b.who !== null && (typeof b.who !== "string" || !b.who.trim())) return fail(400, "who is a person's name.", "GET /api/agent/companion lists the people on the page by name; leave who out to ask everyone.");
        if (b.wait !== undefined && typeof b.wait !== "boolean") return fail(400, "wait is true or false.", "Leave it out to wait for the answers.");
        const whom: Whom = typeof b.who === "string" ? { name: b.who.trim() } : { everyone: true };
        const r = world.asks.ask({ name: c.name, verified: false, agent: true, from, stream: null, rate: [c.token ? `t:${c.token.id}` : `a:${nameKey(c.name)}`] }, whom);
        if (!("ok" in r)) return fail(r.status, r.error, r.hint, { ...(r.retryAfter ? { retryAfter: r.retryAfter } : {}), ...(r.didYouMean ? { didYouMean: r.didYouMean } : {}) }, r.retryAfter ? { "retry-after": String(r.retryAfter) } : undefined);
        const t0 = Date.now();
        const sent = r.ok;
        const rep = sent.id && b.wait !== false ? ((await world.asks.settled(sent.id, a.signal)) ?? sent.report) : sent.report;
        return { status: 200, body: { ok: true, ...rep, waited: Math.round((Date.now() - t0) / 100) / 10 } };
      },
    },
  ];
}
