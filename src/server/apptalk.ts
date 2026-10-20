// People on the page with one another (the routes of server/app.ts): where each one is, which the
// others see (presence: CollabSpec decisions 4 and 8), asking others to follow (decision 10), and
// the conversations (decision 13, AgentSpec decision 8) — the public channel, each agent's private
// one with its maker, a new conversation there. Agents do all of it through their API.

import type { IncomingMessage, ServerResponse } from "node:http";
import { agentPlace, cleanFollowing, cleanView, madeBy, nameKey } from "../shared/collab.ts";
import type { TokenRecord } from "./tokens.ts";
import { forPages, MAX_PERSON, PUBLIC, THREAD } from "./talk.ts";
import { mentioned } from "../shared/mentions.ts";
import type { Answer } from "./agent.ts";
import { sendJson } from "./send.ts";
import { placeOf } from "./agentfollow.ts";
import type { App } from "./app.ts";

/** where a reader is: the others see it (CollabSpec decision 4); of a private reader, only that
 *  they are here (decision 8) */
export async function presence(app: App, req: IncomingMessage, res: ServerResponse, agent: boolean): Promise<void> {
  const live = app.live;
  const r = await app.json(req, 16384);
  if (r.error !== undefined) return sendJson(res, { error: r.error }, 400);
  const b = (r.body ?? {}) as { token?: unknown; view?: unknown; idle?: unknown; private?: unknown; following?: unknown };
  // an agent is one entry by its name (server/presence.ts), never private; a page speaks for
  // its own event stream only, by the secret the stream was given (`hello`)
  const name = app.ids.who(req);
  const priv = !agent && b.private === true;
  // agents have no artwork (ExportSpec decision 19) nor Export window — the page draws them — and
  // follow nobody; a private page says whom it follows and nothing else, so that the reader it
  // follows is told it is followed, by someone (the owner's decision of 2026-10-20)
  if (agent && name) live.presence.agentBeat(name, agentPlace(cleanView(b.view)));
  else if (!live.beat(b.token, priv ? null : name, priv ? null : cleanView(b.view), !priv && b.idle === true, priv, !!app.ids.person(req), name, priv ? cleanFollowing(b.following) : null))
    return sendJson(res, { error: "This heartbeat is not from an open event stream of this page's: it is sent with the token the stream says hello with.", stream: false }, 403);
  return sendJson(res, { ok: true });
}

/** The conversations (CollabSpec decision 13, AgentSpec decision 8), for pages: a channel read
 *  (GET ?channel=public|<agent id>&before=<id>, the newest 200 first) and a message written in it
 *  (POST {channel, text, place}). Everyone with a name reads and writes the public channel; an
 *  agent's private channel is its maker's alone (shared/collab.ts, madeBy: 403 to anyone else).
 *  A read-only reader neither sees nor writes any (403), whatever the page sends; agents talk
 *  through their API. A private channel cannot be written to while its agent is offline (409); a
 *  mention of it in the public channel can, and is handed to it when it comes back. At most so
 *  many messages a minute, a person's in every channel together. */
export async function chat(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const live = app.live;
  if (req.method !== "GET" && req.method !== "POST") return sendJson(res, { error: "/api/chat answers GET and POST." }, 405);
  if (app.readOnlyOf.has(req)) return sendJson(res, { error: "This page is read-only.", readOnly: true }, 403);
  if (app.ids.kind(req) === "agent") return sendJson(res, { error: "Agents talk through their API.", hint: "GET /api/agent/channel, POST /api/agent/reply." }, 403);
  const me = app.ids.who(req);
  if (!me) return sendJson(res, { error: "Say who you are first: the conversations are for people with a name, and a message is sent under yours.", who: true }, 401);
  const who = { name: me, person: app.ids.person(req)?.id ?? null };
  /** the channel a request names: the public one, or an agent's private one that is this
   *  reader's — 404 where there is no such agent, 403 where it is someone else's */
  const channelOf = (raw: unknown): { key: string; agent: { id: string; record: TokenRecord } | null } | Answer => {
    if (raw === "public" || raw === undefined || raw === null || raw === "") return { key: PUBLIC, agent: null };
    const tok = typeof raw === "string" ? live.presence.tokenOf(raw) : null;
    const record = tok ? live.tokens.get(tok) : undefined;
    if (!tok || !record) return { status: 404, body: { error: "There is no such channel: public, or the id of an agent with a token of its own." } };
    if (!madeBy(record, who)) return { status: 403, body: { error: `${record.name}'s private channel is ${record.by}'s, who made its token: nobody else reads or writes it.`, private: true } };
    return { key: tok, agent: { id: raw as string, record } };
  };
  if (req.method === "GET") {
    const c = channelOf(url.searchParams.get("channel") ?? url.searchParams.get("agent"));
    if ("status" in c) return sendJson(res, c.body, c.status);
    const raw = url.searchParams.get("before");
    const before = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
    const messages = live.talk.thread(c.key, THREAD, before).map(forPages);
    if (!c.agent) return sendJson(res, { channel: PUBLIC, messages });
    return sendJson(res, { channel: c.agent.id, agent: { id: c.agent.id, name: c.agent.record.name, talk: live.talk.talk(c.key) }, messages });
  }
  const r = await app.json(req, 1 << 16);
  if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
  const b = (r.body ?? {}) as { channel?: unknown; agent?: unknown; text?: unknown; place?: unknown };
  const c = channelOf(b.channel ?? b.agent);
  if ("status" in c) return sendJson(res, c.body, c.status);
  if (c.agent && live.talk.state(c.key) === "offline") return sendJson(res, { error: "offline", message: `${c.agent.record.name} is offline: it can be written to once it listens again.` }, 409);
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return sendJson(res, { error: "The message is empty." }, 400);
  if (text.length > MAX_PERSON) return sendJson(res, { error: `A message is at most ${MAX_PERSON.toLocaleString("en")} characters.` }, 400);
  const wait = live.talk.allow("person", who.person ? `p:${who.person}` : `n:${nameKey(me)}`);
  if (wait) return sendJson(res, { error: `Too many messages at once: wait ${wait} s.`, retryAfter: wait }, 429, { "retry-after": String(wait) });
  // where the writer was, as the page says it, bounded: a selection can be a long query; a private
  // reader's message says nothing of where they are (CollabSpec decision 8), only who wrote it
  const view = app.ids.privateOf(req) === null ? cleanView(b.place) : null;
  const at = view ? placeOf(app.agents, view) : null;
  const clip = (x: string | null, n: number) => (x !== null && x.length > n ? x.slice(0, n - 1) + "…" : x);
  const where = at ? { inWords: clip(at.inWords, 600)!, view: at.view, declaration: clip(at.declaration, 300), selection: clip(at.selection, 300) } : null;
  // the names it mentions; in the public channel, the agents among them are handed it
  const can = live.mentionable();
  const mentions = mentioned(text, can.names);
  const to = c.agent ? [] : [...new Set(mentions.flatMap((n) => can.agents.get(nameKey(n)) ?? []))];
  const message = live.talk.post(c.key, { from: me, kind: "person", text, ...(mentions.length ? { mentions } : {}), where, to });
  return sendJson(res, { ok: true, channel: c.agent?.id ?? PUBLIC, message: forPages(message) });
}

/** A new conversation in an agent's private channel (AgentSpec decision 8, the owner's decisions
 *  of 2026-10-11 and 2026-10-19): a divider, from its maker alone, held to the rate of their
 *  messages; an offline agent's too, so that its next session starts clean. One right after
 *  another divides nothing: it is answered `unchanged`, and neither written nor counted. */
export async function chatNew(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const live = app.live;
  if (req.method !== "POST") return sendJson(res, { error: "/api/chat/new answers POST." }, 405);
  if (app.readOnlyOf.has(req)) return sendJson(res, { error: "This page is read-only.", readOnly: true }, 403);
  if (app.ids.kind(req) === "agent") return sendJson(res, { error: "A new conversation is for people to start." }, 403);
  const me = app.ids.who(req);
  if (!me) return sendJson(res, { error: "Say who you are first: a new conversation is started under your name.", who: true }, 401);
  const r = await app.json(req, 1 << 12);
  if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
  const b = (r.body ?? {}) as { agent?: unknown };
  const tok = typeof b.agent === "string" ? live.presence.tokenOf(b.agent) : null;
  const record = tok ? live.tokens.get(tok) : undefined;
  if (!tok || !record) return sendJson(res, { error: "There is no such agent: only an agent with a token of its own has a private channel." }, 404);
  const person = app.ids.person(req)?.id ?? null;
  if (!madeBy(record, { name: me, person })) return sendJson(res, { error: `Only ${record.by}, who made ${record.name}'s token, starts a new conversation with it.`, private: true }, 403);
  if (live.talk.fresh(tok)) return sendJson(res, { ok: true, unchanged: true, divider: null, message: "Nothing was said since the conversation began: it is new already." });
  const wait = live.talk.allow("person", person ? `p:${person}` : `n:${nameKey(me)}`);
  if (wait) return sendJson(res, { error: `Too many at once: wait ${wait} s.`, retryAfter: wait }, 429, { "retry-after": String(wait) });
  const divider = live.talk.restart(tok, me);
  return sendJson(res, { ok: true, divider: divider && forPages(divider) });
}

/** Asking others to follow (CollabSpec decision 10, the owner's decision of 2026-10-12), for pages:
 *  POST /api/ask {token, to?} — the page whose event stream holds `token` asks everyone on the
 *  server, or the person whose page is listed as `to`, to follow its reader, who has a name and is
 *  visible: a private reader cannot be followed; POST /api/ask/answer {token, id, answer} — a page
 *  asked answers, whoever its reader is. The server relays both (server/askfollow.ts); agents ask
 *  through their API (POST /api/agent/ask-follow). */
export async function ask(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const live = app.live;
  if (req.method !== "POST") return sendJson(res, { error: `${url.pathname} answers POST.` }, 405);
  if (app.ids.kind(req) === "agent") return sendJson(res, { error: "Agents ask through their API.", hint: "POST /api/agent/ask-follow." }, 403);
  const r = await app.json(req, 4096);
  if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
  const b = (r.body ?? {}) as { token?: unknown; to?: unknown; id?: unknown; answer?: unknown };
  const page = live.pageStream(b.token);
  if (!page) return sendJson(res, { error: "This request is not from an open event stream of this page's: it is sent with the token the stream says hello with.", stream: false }, 403);
  if (url.pathname === "/api/ask/answer") {
    const a = live.asks.answer(b.token as string, b.id, b.answer);
    return sendJson(res, a.body, a.status);
  }
  if (url.pathname !== "/api/ask") return sendJson(res, { error: "not found" }, 404);
  const me = app.ids.who(req);
  if (!me) return sendJson(res, app.nameless(req, "a request to follow you says who asks"), 401);
  if (page.private || app.ids.privateOf(req) !== null) return sendJson(res, { error: "You are private: nobody can follow you. Go visible (the menu under your name) to ask." }, 409);
  if (b.to !== undefined && b.to !== null && typeof b.to !== "string") return sendJson(res, { error: "to is a reader's id, as presence lists them; left out, everyone." }, 400);
  const person = app.ids.person(req);
  // one request every 30 s per person — their personal link, else their name — and per page
  const key = person ? `p:${person.id}` : `n:${nameKey(me)}`;
  const a = live.asks.ask({ name: me, verified: !!person, agent: false, from: page.id, stream: b.token as string, rate: [key, `s:${b.token as string}`] }, typeof b.to === "string" ? { page: b.to } : { everyone: true });
  if ("ok" in a) {
    const { report: _, ...sent } = a.ok;
    return sendJson(res, { ok: true, ...sent });
  }
  return sendJson(res, { error: a.error, ...(a.retryAfter ? { retryAfter: a.retryAfter } : {}) }, a.status, a.retryAfter ? { "retry-after": String(a.retryAfter) } : undefined);
}
