// The server's answers to requests (server/main.ts serves them, the tests too): each request let in
// or not, in the order SECURITY.md relies on — the name it was sent to, a write only from a page of
// this server's own, an agent's token before the key, a personal or a read-only link, the key, then
// what a read-only reader may ask — and answered by its route.

import { historyAnswer } from "./historyapi.ts";
import { gitSource } from "./history.ts";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { WEB, WEBFONTS, bundleDir } from "./pipeline.ts";
import { Live } from "./live.ts";
import { isDeclName, LeanHover } from "./hover.ts";
import { Identities, layoutAuthor } from "./identity.ts";
import type { GitSource } from "../shared/graph.ts";
import { MAX_MEMORY_BYTES } from "./views.ts";
import { cleanView, defaultAgentName, madeBy, nameKey, validSession, withoutArtwork } from "../shared/collab.ts";
import { lakeTextHash } from "./status.ts";
import { Access, fromOwnPage, hostAllowed, KEY_PATH, urlHost } from "./access.ts";
import { asksForPage, sendAccessPage } from "./accesspage.ts";
import { INVITE_PATH, invalidPersonName, Invites, taken } from "./invites.ts";
import { AGENT_LEVELS, AgentApi, lower, needOf, refusal } from "./agent.ts";
import type { Caller } from "./agent.ts";
import { AgentTokens, bearerOf, DEFAULT_DAYS, invalidAgentName, looksLikeToken, TOKEN_DAYS } from "./tokens.ts";
import type { TokenRecord } from "./tokens.ts";
import { agentPrompt } from "./prompt.ts";
import { forPages, MAX_PERSON, PUBLIC, THREAD } from "./talk.ts";
import { mentioned } from "../shared/mentions.ts";
import type { AgentLevel, Answer } from "./agent.ts";
import { Exporter } from "./export.ts";
import { libraryApiOf } from "./library.ts";
import { libraryRoute, pdfjsAsset, readUpload } from "./libraryroute.ts";
import { UPLOAD_PATH } from "./agentlibrary.ts";
import { packageVersion } from "./doctor.ts";
import { READONLY_PATH } from "./readonly.ts";
import { sendMedia, TIP_PATH, TIPS_DIR, tipClips, tourData, tourVtt } from "./media.ts";
import { withoutReasons } from "../shared/timeline.ts";
import { Updates } from "./updates.ts";
import { serveFilm } from "./film.ts";
import { finalAnswer, readOnlyAllows, ReadOnlyBounds } from "./readonlygate.ts";
import { slimDeploy } from "../shared/deploy.ts";
import type { DeployStatus } from "../shared/deploy.ts";
import { hostOf, packedGz, readBody, reachedAt, refused, sendDownload, sendFile, sendGz, sendJson, sendRevision, sendText, TooLarge, tooLarge } from "./send.ts";
import { endedWords, enter, enterReadOnly, identity, identityGet, refuseHost, revokedWords } from "./appaccess.ts";

/** The server's answers to requests: exported so that the tests serve them as the server does. */
export class App {
  live: Live;
  hover: LeanHover;
  ids: Identities;
  /** how long a read of the project's git (GET /api/git) is kept, whoever asks: git is run at most
   *  once in that time, so what readers cost the server is bounded (CollabSpec decision 11); 0 in
   *  the tests */
  gitFreshMs = 3000;
  private gitRead: { at: number; git: GitSource | null } | null = null;
  /** the agents' API (server/agent.ts), and what agents may change */
  agents: AgentApi;
  /** who may come in at all (server/access.ts); null: anyone who reaches the port */
  access: Access | null;
  /** the exported document's typesetting (server/export.ts, ExportSpec.md); null: no export here */
  exporter: Exporter | null;
  /** the address people reach the server at, for the prompt Share makes (--public-url); null: the
   *  one the person's browser used */
  publicUrl: string | null;

  /** --public: whoever comes without the key or a link of their own reads only (CollabSpec
   *  decision 11) */
  publicRead: boolean;
  /** without a key, the names this server answers besides its addresses and localhost
   *  (server/access.ts, hostAllowed): --public-url's host and every --allowed-host; null: every
   *  name, the key keeping everyone else out */
  hostNames: string[] | null;
  /** the names refused as Host, said once each in the server's console (a few: whoever asks
   *  chooses them) */
  readonly refusedHosts = new Set<string>();
  /** the read-only readers' requests, by the read-only link they came by, or "public" */
  private readOnlyOf = new WeakMap<IncomingMessage, string>();
  /** what read-only readers may cost the server: Lean's answers, their documents */
  readonly bounds: ReadOnlyBounds;
  /** VisualProof's own releases as this server follows them (server/updates.ts); null: the
   *  version alone is told (a test's server) */
  updates: Updates | null = null;

  constructor(live: Live, hover: LeanHover, ids: Identities, agents: AgentApi, access: Access | null, exporter: Exporter | null = null, publicUrl: string | null = null, publicRead = false, allowedHosts: string[] = []) {
    this.live = live;
    this.hover = hover;
    this.ids = ids;
    this.agents = agents;
    this.access = access;
    // a personal link says who its holder is (CollabSpec decision 9); behind a proxy that signs
    // people in, the proxy does, and there are no personal links
    ids.invites = ids.header ? null : live.invites;
    this.exporter = exporter;
    // agents typeset as people do (ExportSpec decision 11), through their API
    agents.exporter = exporter;
    this.publicUrl = publicUrl;
    this.publicRead = publicRead && access !== null;
    this.hostNames = access ? null : [...(publicUrl ? [urlHost(publicUrl)] : []), ...allowedHosts];
    this.bounds = new ReadOnlyBounds((id) => this.exporter?.job(id)?.state === "running");
  }

  /** Whether a request is told all of the server's own releases (UpdateSpec decision 11): someone
   *  let in fully; not a read-only reader, nor an agent. */
  private toldAll(req: IncomingMessage): boolean {
    return this.readOnlyOf.get(req) === undefined && this.ids.kind(req) !== "agent";
  }

  /** The exported document (ExportSpec decisions 5–16): POST /api/export starts typesetting the
   *  document of a view, `{view, settings, version?}` (a build the Time Machine shows the view at;
   *  left out, the view's own), and answers with its job at once; the page asks how the
   *  job is doing (GET /api/export/job) and fetches the PDF and the LaTeX sources once it is done
   *  (GET /api/export/file). The answers are the agents' API's (server/agent.ts), which has the same
   *  routes under /api/agent/; an agent that comes here is held to its one job at a time there too.
   *  The window shows the title and the author line the document will have (GET /api/export/head
   *  ?view=&version=: ExportSpec decisions 14 and 15), which only the server can tell: who dropped
   *  each pin is never sent to pages. */
  private async export(req: IncomingMessage, res: ServerResponse, url: URL, agent: boolean, readOnly = false): Promise<void> {
    const path = url.pathname;
    const api = this.agents;
    // the document's outline, which the linear form draws: nothing is typeset for it
    if (path === "/api/export/outline") {
      const o = api.exportOutline(url.searchParams.get("view") ?? "", url.searchParams.get("version") ?? undefined);
      return sendJson(res, o.body, o.status, o.headers);
    }
    if (!this.exporter) return sendJson(res, { error: "This server does not export documents." }, 404);
    let a: Answer;
    if (path === "/api/export" && req.method === "POST") {
      const caller: Caller | null = agent ? { name: this.ids.who(req), kind: "agent" } : null;
      if (caller && !caller.name) return sendJson(res, { error: "Say who you are first.", who: true }, 401);
      const r = await this.json(req, 1 << 20);
      if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
      // read-only readers typeset one document at a time among them (CollabSpec decision 11): while
      // one is being typeset, the others wait, even one the export's cache holds. The place is
      // taken before the job starts, so that two requests at once cannot both start one.
      if (readOnly) {
        if (!this.bounds.mayExport()) return sendJson(res, { error: "Another document is being typeset for readers of this page: try again in a little while." }, 429, { "retry-after": "5" });
        this.bounds.reserveExport();
      }
      let started: Answer | undefined;
      try {
        started = await api.exportStart(r.body, caller);
      } finally {
        if (readOnly) this.bounds.exportStarted(started?.body);
      }
      a = started;
    } else if (path === "/api/export/head") a = api.exportHead(url.searchParams.get("view") ?? "", url.searchParams.get("version") ?? undefined);
    else if (path === "/api/export/job") a = api.exportJob(url.searchParams.get("id") ?? "", false);
    else if (path === "/api/export/file") a = api.exportFile(url.searchParams.get("id") ?? "", url.searchParams.get("what"));
    else return sendJson(res, { error: "not found" }, 404);
    if (a.file) return sendDownload(res, a.file);
    // the agents' answer as it is: the page shows its error, and an agent that asked here its hint
    sendJson(res, a.body, a.status, a.headers);
  }

  /** A request to the agents' API: read here, answered there. An agent with a token of its own is
   *  who its token says, whatever its headers say (server/tokens.ts). */
  private async agent(req: IncomingMessage, res: ServerResponse, url: URL, token: TokenRecord | null = null): Promise<void> {
    const said = this.ids.who(req);
    const caller: Caller = token
      ? { name: token.name, kind: "agent", token: { id: token.id, by: token.by, level: token.level, expires: token.expires }, ...(said && said !== token.name ? { ignoredName: said } : {}) }
      : { name: said, kind: this.ids.kind(req) };
    let body: unknown = null;
    if (req.method === "POST" && url.pathname.replace(/\/+$/, "") === UPLOAD_PATH) {
      // a file for the library: its bytes as they come (server/agentlibrary.ts)
      const bytes = await readUpload(req, res);
      if (!bytes) return;
      body = { bytes };
    } else if (req.method === "POST") {
      const r = await this.json(req, AGENT_BODY);
      if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.`, hint: "Send a JSON object, with content-type: application/json." }, 400);
      body = r.body;
    }
    // a request that waits (the inbox, the companion) learns that its asker went away: an agent's
    // wait for messages ends with its connection, so that none is handed to nobody
    const away = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) away.abort();
    });
    // the session an MCP server says it is (since 0.4.0): a wait from another is a new session's
    const session = req.headers["x-visualproof-session"];
    const a = await this.agents.handle({ method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body, caller, base: this.publicUrl ?? `http://${hostOf(req)}`, signal: away.signal, ...(validSession(session) ? { session } : {}) });
    if (away.signal.aborted) return;
    if (a.text) return sendText(req, res, a.text.body, a.text.type, a.status);
    if (a.file) return sendDownload(res, a.file);
    if (a.gz) return sendGz(req, res, a.gz.body, a.gz.type);
    sendJson(res, a.body, a.status, a.headers);
  }

  /** The conversations (CollabSpec decision 13, AgentSpec decision 8), for pages: a channel read
   *  (GET ?channel=public|<agent id>&before=<id>, the newest 200 first) and a message written in it
   *  (POST {channel, text, place}). Everyone with a name reads and writes the public channel; an
   *  agent's private channel is its maker's alone (shared/collab.ts, madeBy: 403 to anyone else).
   *  A read-only reader neither sees nor writes any (403), whatever the page sends; agents talk
   *  through their API. A private channel cannot be written to while its agent is offline (409); a
   *  mention of it in the public channel can, and is handed to it when it comes back. At most so
   *  many messages a minute, a person's in every channel together. */
  private async chat(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const live = this.live;
    if (req.method !== "GET" && req.method !== "POST") return sendJson(res, { error: "/api/chat answers GET and POST." }, 405);
    if (this.readOnlyOf.has(req)) return sendJson(res, { error: "This page is read-only.", readOnly: true }, 403);
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "Agents talk through their API.", hint: "GET /api/agent/channel, POST /api/agent/reply." }, 403);
    const me = this.ids.who(req);
    if (!me) return sendJson(res, { error: "Say who you are first: the conversations are for people with a name, and a message is sent under yours.", who: true }, 401);
    const who = { name: me, person: this.ids.person(req)?.id ?? null };
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
    const r = await this.json(req, 1 << 16);
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
    const view = this.ids.privateOf(req) === null ? cleanView(b.place) : null;
    const at = view ? this.agents.placeOf(view) : null;
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
  private async chatNew(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const live = this.live;
    if (req.method !== "POST") return sendJson(res, { error: "/api/chat/new answers POST." }, 405);
    if (this.readOnlyOf.has(req)) return sendJson(res, { error: "This page is read-only.", readOnly: true }, 403);
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "A new conversation is for people to start." }, 403);
    const me = this.ids.who(req);
    if (!me) return sendJson(res, { error: "Say who you are first: a new conversation is started under your name.", who: true }, 401);
    const r = await this.json(req, 1 << 12);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const b = (r.body ?? {}) as { agent?: unknown };
    const tok = typeof b.agent === "string" ? live.presence.tokenOf(b.agent) : null;
    const record = tok ? live.tokens.get(tok) : undefined;
    if (!tok || !record) return sendJson(res, { error: "There is no such agent: only an agent with a token of its own has a private channel." }, 404);
    const person = this.ids.person(req)?.id ?? null;
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
  private async ask(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const live = this.live;
    if (req.method !== "POST") return sendJson(res, { error: `${url.pathname} answers POST.` }, 405);
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "Agents ask through their API.", hint: "POST /api/agent/ask-follow." }, 403);
    const r = await this.json(req, 4096);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const b = (r.body ?? {}) as { token?: unknown; to?: unknown; id?: unknown; answer?: unknown };
    const page = live.pageStream(b.token);
    if (!page) return sendJson(res, { error: "This request is not from an open event stream of this page's: it is sent with the token the stream says hello with.", stream: false }, 403);
    if (url.pathname === "/api/ask/answer") {
      const a = live.asks.answer(b.token as string, b.id, b.answer);
      return sendJson(res, a.body, a.status);
    }
    if (url.pathname !== "/api/ask") return sendJson(res, { error: "not found" }, 404);
    const me = this.ids.who(req);
    if (!me) return sendJson(res, this.nameless(req, "a request to follow you says who asks"), 401);
    if (page.private || this.ids.privateOf(req) !== null) return sendJson(res, { error: "You are private: nobody can follow you. Go visible (the menu under your name) to ask." }, 409);
    if (b.to !== undefined && b.to !== null && typeof b.to !== "string") return sendJson(res, { error: "to is a reader's id, as presence lists them; left out, everyone." }, 400);
    const person = this.ids.person(req);
    // one request every 30 s per person — their personal link, else their name — and per page
    const key = person ? `p:${person.id}` : `n:${nameKey(me)}`;
    const a = live.asks.ask({ name: me, verified: !!person, agent: false, from: page.id, stream: b.token as string, rate: [key, `s:${b.token as string}`] }, typeof b.to === "string" ? { page: b.to } : { everyone: true });
    if ("ok" in a) {
      const { report: _, ...sent } = a.ok;
      return sendJson(res, { ok: true, ...sent });
    }
    return sendJson(res, { error: a.error, ...(a.retryAfter ? { retryAfter: a.retryAfter } : {}) }, a.status, a.retryAfter ? { "retry-after": String(a.retryAfter) } : undefined);
  }

  /** Sharing with an AI agent (AgentSpec decision 7), for people: the tokens in force (GET), a new
   *  one with its prompt (POST), a token's prompt shown again (POST …/prompt), and revoking one
   *  (POST …/revoke). All but the list need a name: a token is made under it, and its prompt holds
   *  the token. The prompt is asked for by POST, as making one is, so that the browser sends its
   *  Origin and the prompt names the server as the page reached it, the same both times. */
  private async shareAgents(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    // agent tokens stay with people, at every level (the owner's decision, AgentSpec decision 9):
    // an agent that could make, show or revoke tokens could outlive its own revocation. A token
    // never gets here (it reaches the agents' API alone), and a request that says it is an agent's
    // is refused
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "Agent tokens are for people: an agent cannot make, show or revoke them, at any level." }, 403);
    const tokens = this.live.tokens;
    const top = this.agents.level;
    const me = this.ids.who(req);
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/api/share/agents" && req.method === "GET")
      return sendJson(res, { level: top, levels: AGENT_LEVELS.slice(0, AGENT_LEVELS.indexOf(top) + 1), defaultLevel: lower("advise", top), days: TOKEN_DAYS, defaultDays: DEFAULT_DAYS, tokens: tokens.inForce().map(AgentTokens.info) });
    if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
    if (!me) return sendJson(res, { error: "Say who you are first: a token is made, shown or revoked under your name.", who: true }, 401);
    const r = await this.json(req, 1 << 16);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const b = (r.body ?? {}) as Record<string, unknown>;
    if (path === "/api/share/agents/revoke") {
      if (typeof b.id !== "string" || !tokens.revoke(b.id, me)) return sendJson(res, { error: "There is no such token in force." }, 404);
      return sendJson(res, { ok: true, tokens: tokens.inForce().map(AgentTokens.info) });
    }
    // the server as the prompt names it
    const address = this.publicUrl ?? reachedAt(req);
    if (path === "/api/share/agents/prompt") {
      // a token that ended has no prompt: it lets nothing in. Its maker alone is shown it again (the
      // owner's decision of 2026-10-19): whoever holds the token reads its private channel
      const t = typeof b.id === "string" ? tokens.token(b.id) : null;
      if (!t) return sendJson(res, { error: "There is no such token in force." }, 404);
      if (!madeBy(t.record, { name: me, person: this.ids.person(req)?.id ?? null })) return sendJson(res, { error: `Only ${t.record.by}, who made it, is shown this token's prompt again: whoever holds a token reads its agent's private channel.`, maker: false }, 403);
      return sendJson(res, { token: AgentTokens.info(t.record), prompt: agentPrompt({ url: address, token: t.token, record: t.record }) });
    }
    if (path !== "/api/share/agents") return sendJson(res, { error: "not found" }, 404);
    // the name given is the agent's as it is; none, the person's AI ("Alice's AI")
    const name = b.name === undefined || b.name === null || (typeof b.name === "string" && !b.name.trim()) ? defaultAgentName(me) : b.name;
    const bad = invalidAgentName(name);
    if (bad) return sendJson(res, { error: bad }, 400);
    const level = (b.level ?? lower("advise", top)) as AgentLevel;
    if (!AGENT_LEVELS.includes(level)) return sendJson(res, { error: "level is read, advise or full." }, 400);
    if (AGENT_LEVELS.indexOf(level) > AGENT_LEVELS.indexOf(top)) return sendJson(res, { error: `This server lets agents do at most ${top} (--agents ${top}): a token cannot give more.` }, 400);
    const days = b.days ?? DEFAULT_DAYS;
    if (!TOKEN_DAYS.includes(days as (typeof TOKEN_DAYS)[number])) return sendJson(res, { error: `days is one of ${TOKEN_DAYS.join(", ")}.` }, 400);
    const made = tokens.create({ name: (name as string).trim(), by: me, person: this.ids.person(req)?.id ?? null, level, days: days as number });
    const prompt = agentPrompt({ url: address, token: made.token, record: made.record });
    return sendJson(res, { token: AgentTokens.info(made.record), prompt, tokens: tokens.inForce().map(AgentTokens.info) });
  }

  /** Inviting a person (CollabSpec decision 9), for people: the personal links in force (GET), a new
   *  one for a person named in the body (POST), and revoking one (POST …/revoke). Making and
   *  revoking need a name: who made a link, and who revoked it, is said in Share. The link itself
   *  is answered once to whoever made it, and again to its holder alone (`mine`). */
  private async sharePeople(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "Personal links are for people: an agent cannot make, list, show or revoke them." }, 403);
    if (this.ids.header) return sendJson(res, { error: "Names come from the sign-in in front of this server: it has no personal links." }, 404);
    const invites = this.live.invites;
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/api/share/people/mine" || path === "/api/share/people/mine/renew") return this.myLink(req, res, path);
    const list = () => invites.inForce().map(Invites.info);
    if (path === "/api/share/people" && req.method === "GET") return sendJson(res, { invites: list() });
    if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
    const me = this.ids.who(req);
    if (!me) return sendJson(res, this.nameless(req, "a personal link is made or revoked under your name"), 401);
    const r = await this.json(req, 4096);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const b = (r.body ?? {}) as Record<string, unknown>;
    if (path === "/api/share/people/revoke") {
      if (typeof b.id !== "string" || !invites.revoke(b.id, me)) return sendJson(res, { error: "There is no such personal link in force." }, 404);
      return sendJson(res, { ok: true, invites: list() });
    }
    if (path !== "/api/share/people") return sendJson(res, { error: "not found" }, 404);
    const bad = invalidPersonName(b.name);
    if (bad) return sendJson(res, { error: bad }, 400);
    const made = invites.create({ name: b.name as string, by: me });
    if (typeof made === "string") return sendJson(res, { error: made, taken: true }, 409);
    // the link as the person will open it: the server's address as this page reached it
    const link = `${this.publicUrl ?? reachedAt(req)}${INVITE_PATH}${made.token}`;
    return sendJson(res, { invite: Invites.info(made.record), link, invites: list() });
  }

  /** The personal link a page came by, for its holder alone (CollabSpec decision 9, the owner's
   *  decision of 2026-10-19): shown again (POST /api/share/people/mine; `link` null for a link made
   *  before 0.6.0, of which the server kept only the digest), or made anew (POST …/mine/renew,
   *  `{stream}` the event stream of the page asking, which stays open) — the same id under a new
   *  secret, the old link and the browsers it let in cut off, this browser given the new cookie.
   *  Whoever else asks is refused: its maker, a guest, an agent; a read-only reader's page posts
   *  nothing here (server/readonlygate.ts). Asked for by POST, as an agent's prompt is, so that the
   *  browser sends its Origin and the link names the server as the page reached it. */
  private async myLink(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const p = this.ids.person(req);
    if (!p) return sendJson(res, { error: "A personal link is shown to its holder alone, in a browser it let in: this page came by none.", holder: false }, 403);
    if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
    const invites = this.live.invites;
    const address = this.publicUrl ?? reachedAt(req);
    if (path === "/api/share/people/mine") {
      const token = invites.tokenOf(p.id);
      return sendJson(res, { invite: Invites.info(p), link: token ? `${address}${INVITE_PATH}${token}` : null });
    }
    const r = await this.json(req, 4096);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const keep = (r.body as { stream?: unknown } | null)?.stream;
    const made = invites.renew(p.id, { keep: typeof keep === "string" ? keep : undefined });
    if (!made) return sendJson(res, { error: "There is no such personal link in force." }, 404);
    // this browser stays in: the cookie of the new link, beside what the request was given already
    const set = res.getHeader("set-cookie");
    res.setHeader("set-cookie", [...(Array.isArray(set) ? set : set === undefined ? [] : [String(set)]), invites.cookie(made.record)]);
    return sendJson(res, { invite: Invites.info(made.record), link: `${address}${INVITE_PATH}${made.token}` });
  }

  /** Read-only links (CollabSpec decision 11), for people: every link (GET), a new one (POST), and
   *  revoking one (POST …/revoke). Anyone let in may make one; revoking needs a name, which Share
   *  says beside the link. A server open to all, or behind a sign-in, has none. */
  private async shareReadOnly(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "Read-only links are for people: an agent cannot make, list or revoke them." }, 403);
    if (!this.access || this.ids.header) return sendJson(res, { error: this.ids.header ? "Who comes in is the sign-in's, in front of this server: it has no read-only links." : "This server lets in whoever reaches it: a read-only link would let in no one more." }, 404);
    const links = this.live.readOnly;
    const path = url.pathname.replace(/\/+$/, "");
    const address = this.publicUrl ?? reachedAt(req);
    const list = () => links.list().map((l) => ({ ...l, link: `${address}${l.path}` }));
    if (path === "/api/share/readonly" && req.method === "GET") return sendJson(res, { links: list() });
    if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
    const me = this.ids.who(req);
    if (path === "/api/share/readonly/revoke") {
      if (!me) return sendJson(res, this.nameless(req, "a read-only link is revoked under your name"), 401);
      const r = await this.json(req, 4096);
      if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
      const id = (r.body as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !links.revoke(id, me)) return sendJson(res, { error: "There is no such read-only link in force." }, 404);
      return sendJson(res, { ok: true, links: list() });
    }
    if (path !== "/api/share/readonly") return sendJson(res, { error: "not found" }, 404);
    const made = links.create(me);
    return sendJson(res, { made: { ...made, link: `${address}${made.path}` }, links: list() });
  }

  /** The answer to a request that needs a name and has none: the page asks for one (`who`). Where
   *  the name the page gives is a personal link holder's, it says so, and the page asks for
   *  another. */
  private nameless(req: IncomingMessage, what: string): { error: string; who: true } {
    const holder = this.ids.taken(req);
    return { error: holder ? `${taken(holder)} (Click your name.)` : `Say who you are first: ${what}.`, who: true };
  }

  /** The library's operations (server/library.ts), shared with the agents' API. */
  private library() {
    return libraryApiOf(this.live, () => ({
      review: this.live.review,
      project: this.live.project,
      library: this.live.library,
      graph: () => {
        const v = this.agents.reviews.graph();
        return "status" in v ? null : v;
      },
      // every file the library takes shows on the Project: a note carries it, on the ring
      fileAdded: (f, who, note) => void this.live.views.fileAdded(f, { by: who.name, agent: who.agent, person: who.person ?? null }, note),
    }));
  }

  /** A request about views (server/views.ts): read here, answered there. A private page's is
   *  answered as its, recorded without its name (CollabSpec decision 8). */
  private async views(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const priv = this.ids.privateOf(req);
    const person = this.ids.person(req);
    const caller: Caller = { name: this.ids.who(req), kind: this.ids.kind(req), ...(person ? { person: person.id } : {}), ...(priv !== null ? { private: { session: priv || null } } : {}) };
    let body: unknown = null;
    if (req.method === "POST") {
      // a board's layout memory is as large as the board; nothing else about views is
      const r = await this.json(req, url.pathname.replace(/\/+$/, "") === "/api/views/memory" ? MAX_MEMORY_BYTES : 1 << 20);
      if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
      body = r.body;
    }
    const a: Answer = this.live.views.handle({ method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body, caller }, this.agents.level);
    sendJson(res, a.body, a.status, a.headers);
  }

  /** A request's JSON body, or why it has none. A body larger than `limit` is answered here and
   *  now, 413 (as the agents' API words its errors under /api/agent), and the connection closed
   *  after it, without reading the rest; whoever asked for the body is told `too large`, and what
   *  it answers after is not sent (sendJson). */
  async json(req: IncomingMessage, limit: number): Promise<{ body?: unknown; error?: string }> {
    let text: string;
    try {
      text = await readBody(req, limit);
    } catch (e) {
      const res = this.responses.get(req);
      if (!(e instanceof TooLarge) || !res) return { error: e instanceof Error ? e.message : String(e) };
      const size = limit >= 1 << 20 ? `${Math.round(limit / (1 << 20))} MB` : `${Math.round(limit / 1024)} KB`;
      const agent = (req.url ?? "").startsWith("/api/agent");
      tooLarge(req, res, { error: `The body is larger than ${size}, as much as this request takes.`, ...(agent ? { hint: "Send less at once: fewer items per request (POST /api/agent/opinions takes 100 at most), or split the request." } : {}) });
      return { error: "too large" };
    }
    try {
      return { body: JSON.parse(text) };
    } catch {
      return { error: "not JSON" };
    }
  }

  /** each request's response, for what answers a request while reading it (a body too large) */
  private responses = new WeakMap<IncomingMessage, ServerResponse>();

  /** Answer a request; whatever goes wrong in answering it is answered too, 500 with what it was,
   *  rather than left hanging or taking the server down. */
  handle(req: IncomingMessage, res: ServerResponse): void {
    this.responses.set(req, res);
    this.route(req, res).catch((e: unknown) => {
      console.error(`${req.method} ${req.url?.slice(0, 200)}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      const agent = (req.url ?? "").startsWith("/api/agent");
      if (!res.headersSent) sendJson(res, { error: e instanceof Error ? e.message : String(e), ...(agent ? { hint: "This is the server's fault; the request may work again." } : {}) }, 500);
      else res.destroy();
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const live = this.live;
    // without a key, only the names this server is reached at (CollabSpec decision 12, the owner's
    // decision of 2026-10-18): a page whose own name was made to resolve to this machine (DNS
    // rebinding) is refused whatever it asks — the page, its data, the event stream, the agents'
    // API, the MCP server's file
    if (this.hostNames && !hostAllowed(req.headers.host, this.hostNames)) return refuseHost(this, req, res, path);
    // what may write, only from a page of this server's own (server/access.ts, fromOwnPage): a page
    // of another site, or of another port of this host, would send this server's cookies with it
    if (!fromOwnPage(req.method, req.headers, this.publicUrl)) return sendJson(res, { error: "A page of another site cannot change anything here." }, 403);
    // every route; whatever one throws, handle() answers
    {
      // an agent's own token (server/tokens.ts) lets it into its API alone: the page and the page's
      // API answer it as they answer an outsider. A token that ended says so, to whoever held it.
      const bearer = bearerOf(req.headers.authorization);
      if (bearer && looksLikeToken(bearer)) {
        const t = live.tokens.check(bearer);
        if (!t) return sendJson(res, this.access ? { error: "not found" } : { error: "This token is not one of this server's.", hint: "Check that it was copied whole (vpa_…), or ask the person who shared with you for a new one." }, this.access ? 404 : 401);
        if ("ended" in t)
          return sendJson(res, {
            error: t.ended === "revoked" ? `This token was revoked by ${t.record.revokedBy} at ${t.record.revoked}.` : `This token expired at ${t.record.expires}.`,
            hint: "Ask the person who shared with you for a new one (Share, then AI agent, in the page).",
          }, 401);
        if (path !== "/api/agent" && !path.startsWith("/api/agent/")) return sendJson(res, { error: "not found" }, 404);
        return this.agent(req, res, url, t.ok);
      }
      // a personal link (CollabSpec decision 9, server/invites.ts): it lets its holder in, as who
      // it says, and its cookie does from then on; a revoked one's cookie is forgotten, and lets
      // nobody in
      if (path.startsWith(INVITE_PATH)) return enter(this, req, res, path.slice(INVITE_PATH.length), path);
      // a read-only link (CollabSpec decision 11, server/readonly.ts): its cookie lets its holder
      // read, where nothing else lets them in
      if (path.startsWith(READONLY_PATH)) return enterReadOnly(this, req, res, path.slice(READONLY_PATH.length), path);
      const link = this.ids.link(req);
      // a link that ended: its cookie is forgotten as a page loads, once the page has said so. Not
      // before: the page's requests meanwhile are told (a browser the key lets in too, as a guest,
      // by /api/identity: web/src/people.ts); and the browser that made a link anew has the new
      // cookie under the same name, which a request of its pages still on its way with the old one
      // would answer with the forgetting after it
      const forget = link && "ended" in link && (path === "/" || path === "/index.html" || asksForPage(req, path));
      const cookies: string[] = forget ? [live.invites.forget()] : [];
      const ro = this.access && !this.ids.header ? live.readOnly.ofCookie(req.headers.cookie) : null;
      if (ro && "ended" in ro) cookies.push(live.readOnly.forget());
      if (this.access) {
        const a = link && "ok" in link && !path.startsWith(KEY_PATH) ? "in" : this.access.admit(req, path);
        if (a === "out") {
          // nothing lets them in to write: their read-only link does, or --public, to read
          const reader = ro && "ok" in ro ? ro.ok.id : this.publicRead && !this.ids.header ? "public" : null;
          // a page whose link was revoked, which nothing else lets in, is told so (CollabSpec
          // decisions 9 and 11): its requests are answered 410 with who revoked it and when, and the
          // page, reloaded, says the link no longer opens the site (decision 7: to a browser, the
          // page of a link that does not, which names nobody); the cookie is forgotten there, once
          // it has been said
          const revoked = reader === null && this.ids.kind(req) !== "agent" ? (link && "ended" in link ? endedWords(link) : ro && "ended" in ro ? revokedWords(ro.link, "read-only") : null) : null;
          if (revoked) {
            if (asksForPage(req, path)) {
              res.setHeader("set-cookie", cookies);
              return sendAccessPage(res, "link");
            }
            if (path === "/" || path === "/index.html") {
              res.setHeader("set-cookie", cookies);
              return sendText(req, res, revoked + "\n", "text/plain; charset=utf-8", 410);
            }
            return sendJson(res, { error: revoked, revoked: true }, 410);
          }
          // nothing lets them in: a browser asking for a page is told the site is private, or that
          // its link (`/k/…`, a key replaced) does not open it (CollabSpec decision 7, the owner's
          // decision of 2026-10-18); anything else is answered as if there were nothing here
          if (reader === null || this.ids.kind(req) === "agent") {
            if (cookies.length) res.setHeader("set-cookie", cookies);
            if (asksForPage(req, path)) return sendAccessPage(res, path.startsWith(KEY_PATH) ? "link" : "private");
            return sendJson(res, { error: "not found" }, 404);
          }
          // a link of the key's that is not the key, opened where the address, or a read-only link,
          // lets them read: the page of a link that does not open the site, which says whether the
          // address alone does (--public)
          if (path.startsWith(KEY_PATH) && asksForPage(req, path)) {
            if (cookies.length) res.setHeader("set-cookie", cookies);
            return sendAccessPage(res, "link", this.publicRead);
          }
          this.readOnlyOf.set(req, reader);
          // the page renews a read-only link's cookie, as a personal link's
          if (reader !== "public" && (path === "/" || path === "/index.html")) cookies.push(live.readOnly.cookie(reader));
          // what a read-only reader may ask; the rest is refused, whatever the page sends
          if (!readOnlyAllows(req.method ?? "GET", path)) {
            if (cookies.length) res.setHeader("set-cookie", cookies);
            return sendJson(res, { error: "This page is read-only: it changes nothing that is shared.", readOnly: true }, 403);
          }
        } else if (a !== "in") {
          // the link: the browser keeps the cookie, and the key leaves the address (a fragment
          // after the key, a place in the page, comes along to "/")
          res.writeHead(303, { location: "/", "set-cookie": [a.enter, ...cookies], "cache-control": "no-store", "referrer-policy": "no-referrer" });
          return void res.end();
        } else {
          // let in by the cookie every server used to share: the browser is given this one's own
          const renew = this.access.renewal(req);
          if (renew) cookies.push(renew);
        }
      }
      // the page renews a personal link's cookie: its holder stays in as long as they come back
      if (link && "ok" in link && (path === "/" || path === "/index.html")) cookies.push(live.invites.cookie(link.ok));
      if (cookies.length) res.setHeader("set-cookie", cookies);
      if (path === "/" || path === "/index.html") return sendFile(req, res, join(WEB, "index.html"));
      if (path === "/style.css") return sendFile(req, res, join(WEB, "style.css"));
      // the fonts an artwork is drawn in (ExportSpec decision 19)
      if (FONT_PATH.test(path)) return sendFile(req, res, join(WEBFONTS, path.slice("/fonts/".length)));
      // the tips' clips and their key frames (GuideSpec decision 6), and which there are
      if (path === "/tips/index.json") return sendJson(res, { clips: tipClips() });
      // the tour film, fetched by this server on its first play and kept checked in the cache
      // (server/film.ts, UpdateSpec decision 14): else 503 while it comes, or 404, and the page shows
      // its stills and captions; and its captions as WebVTT, for assistive technology
      if (path === "/tips/tour.mp4" && !refused.has(res)) return void serveFilm(req, res, sendMedia);
      if (path === "/tips/tour.en.vtt") {
        const vtt = tourVtt(tourData());
        if (vtt === null) return sendJson(res, { error: "no captions" }, 404);
        res.writeHead(200, { "content-type": "text/vtt; charset=utf-8", "cache-control": "no-cache" });
        return void res.end(vtt);
      }
      if (TIP_PATH.test(path) && !refused.has(res)) return sendMedia(req, res, join(TIPS_DIR, path.slice("/tips/".length)));
      // the page, and its workers: the one that lays out the Time Machine's past graphs
      // (web/src/layoutworker.ts), the one that chooses the overview's edges (web/src/edgeworker.ts),
      // and pdf.js's, which reads the library's PDFs for the reference window (AttachmentSpec decision 11)
      if (/^\/(app|layout|edges|pdfworker)\.js(\.map)?$/.test(path)) return sendFile(req, res, join(bundleDir(), path.slice(1)));
      if (path.startsWith("/pdfjs/")) return pdfjsAsset(res, path);
      // with Lean's language server as it is (server/hover.ts): what is open, what crashed
      // a read-only reader is told how the server is, not its log nor where its review is kept
      // `?brief`: the build status without its files, which the page reads by GET /api/build
      if (path === "/api/status") {
        const st: Record<string, unknown> = { ...(live.status(url.searchParams.has("brief")) as Record<string, unknown>), lean: this.hover.state() };
        // the address people reach the server at (--public-url): links of it are this site's, and the
        // page makes its own with it (CollabSpec, "Copied links")
        if (this.publicUrl) st.publicUrl = this.publicUrl;
        if (this.readOnlyOf.get(req) !== undefined) {
          delete st.log;
          st.review = { ...(st.review as object), folder: undefined };
          // a branch's build log is not a read-only reader's (DeploySpec decision 11)
          if (st.deploy) st.deploy = slimDeploy(st.deploy as DeployStatus);
        }
        return sendJson(res, st);
      }
      // VisualProof's own version, and what of its releases those let in fully are told (UpdateSpec
      // decision 11): a read-only reader and an agent are told the version alone
      if (path === "/api/updates") return sendJson(res, this.updates?.status(this.toldAll(req)) ?? { running: packageVersion() });
      // the link that lets someone in, for a page that shares where it is (web/src/share.ts); a
      // request gets here only once it is in
      // a read-only reader shares the link they came by, or the address alone (--public)
      const reader = this.readOnlyOf.get(req);
      if (path === "/api/share") {
        if (reader !== undefined) return sendJson(res, { path: reader === "public" ? "/" : (live.readOnly.get(reader)?.path ?? null), readOnly: true });
        return sendJson(res, { path: this.access?.link ?? null, readOnlyLinks: !!this.access && !this.ids.header, public: this.publicRead });
      }
      if (path === "/api/share/readonly" || path.startsWith("/api/share/readonly/")) return this.shareReadOnly(req, res, url);
      if (path.startsWith("/api/share/agents")) return this.shareAgents(req, res, url);
      if (path === "/api/share/people" || path.startsWith("/api/share/people/")) return this.sharePeople(req, res, url);
      if (path === "/api/chat") return this.chat(req, res, url);
      if (path === "/api/chat/new") return this.chatNew(req, res);
      if (path === "/api/ask" || path === "/api/ask/answer") return this.ask(req, res, url);
      if (path === "/api/agent" || path.startsWith("/api/agent/")) return this.agent(req, res, url);
      // the views, each a shared board (ViewSpec.md)
      if (path === "/api/views" || path.startsWith("/api/views/")) return this.views(req, res, url);
      // the snapshots of the graph, one per build (HistorySpec.md): the Time Machine reads them; the
      // moves, the lost-and-found and its archive
      if (path === "/api/history" || path.startsWith("/api/history/")) {
        let body: unknown = null;
        if (req.method === "POST") {
          // a name's every entry archived at once is a few hundred keys at most
          const r = await this.json(req, 1 << 20);
          if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
          body = r.body;
        }
        // a move, an archiving or a putting back is recorded as the review is: under the reader's
        // name — a private reader's too (CollabSpec decision 8) — with the personal link of someone
        // invited by one, whose moves go to their link's log (decision 9); by an agent at level full
        const person = this.ids.person(req)?.id;
        const a = await historyAnswer(live, { method: req.method ?? "GET", path, query: url.searchParams, body, caller: { name: this.ids.who(req), kind: this.ids.kind(req), ...(person ? { person } : {}) } }, (q) =>
          q.caller.kind === "agent" ? refusal(this.agents.level, "full") : null,
        );
        // a snapshot's graph in parts, as the Time Machine takes it: compressed once, and tagged
        if (a.gz) return sendGz(req, res, a.gz.body, a.gz.type);
        return sendJson(res, a.body, a.status, a.headers);
      }
      // the library of papers and images, and the links into them (AttachmentSpec.md,
      // server/libraryroute.ts)
      if (path === "/api/library" || path.startsWith("/api/library/")) {
        // a read-only reader (CollabSpec decision 11) is drawn what the notes show of a PDF, kept in
        // the cache as it is drawn, and no other page or region of one: each would be drawn by
        // Poppler and kept anew, whoever comes asking
        if (reader !== undefined && (path === "/api/library/page" || path === "/api/library/clip")) {
          const q = url.searchParams;
          const region = path === "/api/library/clip" ? (q.get("region") ?? "").split(",").map(Number) : null;
          if (!live.views.shows(q.get("sha") ?? "", Number(q.get("page")), region)) return sendJson(res, { error: "A read-only page is drawn what the notes show of the library: open the file itself.", readOnly: true }, 403);
        }
        return libraryRoute({ ids: this.ids, level: this.agents.level, api: this.library() }, req, res, url);
      }
      // an agent may use the page's own endpoints too: the same rules hold there (AgentSpec)
      const agent = this.ids.kind(req) === "agent";
      // the review (ReviewSpec.md): the whole of it, as a page takes it on, with the lines of its
      // logs that cannot be read; tagged with its revision, compressed once a revision
      if (path === "/api/review" && req.method === "GET") return sendRevision(req, res, live.review, live.review.tag(), () => live.review.wholeText());
      // the whole build status, tagged with its revision (the owner's decision of 2026-10-19): what
      // changes after comes by the event stream
      if (path === "/api/build" && req.method === "GET") {
        const b = live.buildWhole();
        return sendRevision(req, res, live, b.tag, () => b.text);
      }
      if (path === "/api/review" && req.method === "POST") {
        // an opinion, a target, a trusted prefix or a key declaration is recorded under the
        // reader's name (CollabSpec decision 3), not one in the body; what it is about is
        // bound by the server (server/reviewapi.ts)
        const me = this.ids.who(req);
        if (!me) return sendJson(res, this.nameless(req, "what you record in the review is recorded under your name"), 401);
        const person = this.ids.person(req)?.id ?? null;
        return this.json(req, 1 << 20).then(({ body, error }) => {
          if (error) return sendJson(res, { error: `The body is ${error}.` }, 400);
          // an agent records here what its level allows, as through its own API (AgentSpec decision
          // 9): an opinion as advice, the rest at full; in its own log, marked as an agent's
          const no = agent ? refusal(this.agents.level, needOf(body)) : null;
          if (no) return sendJson(res, no.body, no.status);
          // someone invited by a personal link writes to the log of their link (shared/review.ts)
          const a = this.agents.reviews.post(body, { name: me, agent, person });
          sendJson(res, a.body, a.status);
        });
      }
      if (path === "/api/export" || path.startsWith("/api/export/")) return this.export(req, res, url, agent, reader !== undefined);
      if (path === "/api/identity" && req.method === "GET") return identityGet(this, req, res, link, reader);
      if (path === "/api/identity" && req.method === "POST") return identity(this, req, res);
      // where a reader is: the others see it (CollabSpec decision 4); of a private reader, only that
      // they are here (decision 8)
      if (path === "/api/presence" && req.method === "POST") {
        const r = await this.json(req, 16384);
        if (r.error !== undefined) return sendJson(res, { error: r.error }, 400);
        const b = (r.body ?? {}) as { token?: unknown; view?: unknown; idle?: unknown; private?: unknown };
        // an agent is one entry by its name (server/presence.ts), never private; a page speaks for
        // its own event stream only, by the secret the stream was given (`hello`)
        const name = this.ids.who(req);
        const priv = !agent && b.private === true;
        // agents have no artwork (ExportSpec decision 19): the page draws it
        if (agent && name) live.presence.agentBeat(name, withoutArtwork(cleanView(b.view)));
        else if (!live.beat(b.token, priv ? null : name, priv ? null : cleanView(b.view), !priv && b.idle === true, priv, !!this.ids.person(req), name))
          return sendJson(res, { error: "This heartbeat is not from an open event stream of this page's: it is sent with the token the stream says hello with.", stream: false }, 403);
        return sendJson(res, { ok: true });
      }
      if (path === "/api/events") {
        const session = url.searchParams.get("session");
        // `build=delta`: the page takes the build status as changes (a page of 0.6.0 or later)
        return live.subscribe(res, validSession(session) ? session : null, this.ids.person(req)?.id ?? null, reader ?? null, this.toldAll(req), url.searchParams.get("build") === "delta", this.ids.who(req));
      }
      // what happened (CollabSpec decision 5): what the server stored; the review's own history the
      // page reads from the review
      if (path === "/api/activity") {
        const events = live.timeline.events.slice(-2000);
        return sendJson(res, { events: this.toldAll(req) ? events : events.map(withoutReasons) });
      }
      // a layout batch an agent made, undone (AgentSpec decision 4): from a page's Activity, by anyone;
      // by a private reader, without their name (CollabSpec decision 8)
      if (path === "/api/layout/undo" && req.method === "POST") {
        const priv = this.ids.privateOf(req) !== null;
        const me = layoutAuthor({ name: this.ids.who(req), private: priv });
        if (!me && !priv) return sendJson(res, { error: "Say who you are first.", who: true }, 401);
        const no = agent ? refusal(this.agents.level, "full") : null;
        if (no) return sendJson(res, no.body, no.status);
        const r = await this.json(req, 4096);
        if (r.error !== undefined) return sendJson(res, { error: r.error }, 400);
        const a = this.agents.undo(me, agent, (r.body as { id?: unknown } | null)?.id);
        return sendJson(res, a.body, a.status);
      }
      // the project's git source and commit as git says them now, not as the build was read (an
      // artwork's foot, ExportSpec decision 19; the owner's decision of 2026-10-15)
      if (path === "/api/git") {
        // following a branch, the commit of the build on show, on that branch: what is checked out
        // meanwhile is the build going on (DeploySpec decision 12)
        const shown = live.shownCommit();
        if (shown !== undefined) return sendJson(res, { git: shown && { source: live.deploy!.status(false).source, commit: shown.hash, branch: shown.branch } });
        if (!this.gitRead || Date.now() - this.gitRead.at >= this.gitFreshMs) this.gitRead = { git: gitSource(live.project.root), at: Date.now() };
        return sendJson(res, { git: this.gitRead.git });
      }
      if (path === "/api/meta" || path === "/api/edges") {
        const g = live.graph;
        if (!g) return sendJson(res, { error: "not ready" }, 503);
        // a page asks for the version it was told about; an older one is gone
        const want = url.searchParams.get("v");
        // of this server's: one restarted since counts its versions again (UpdateSpec decision 8)
        const of = url.searchParams.get("i");
        if ((want && Number(want) !== g.version) || (of && of !== live.instance)) return sendJson(res, { error: "superseded", version: g.version, instance: live.instance }, 409);
        // a page asks for the edges packed (shared/edgecodec.ts; `pack=2` with the grammar site, a
        // page from before it `pack=1`, which takes grammar for a proof); an agent gets them as they
        // are
        const pack = url.searchParams.get("pack");
        return path === "/api/meta"
          ? sendGz(req, res, g.prep.metaGz, "application/json")
          : sendGz(req, res, pack === "1" || pack === "2" ? packedGz(g.prep.edgesGz, pack === "1" ? 1 : 2) : g.prep.edgesGz, "application/octet-stream");
      }
      if (path === "/api/hover" || path === "/api/hover/open" || path === "/api/hover/names" || path === "/api/hover/describe" || path === "/api/hover/print") {
        // what Lean says is at a position of a project file (server/hover.ts). Only the graph's
        // modules (meta.modules) reach Lean: the module names the file the graph was read from, so
        // no path from the client reaches the disk, and no other file in the project's folder — an
        // old copy, a CI script — is ever elaborated or imported
        if (!live.graph) return sendJson(res, { error: "not ready" }, 503);
        const mod = url.searchParams.get("module") ?? "";
        const rel = live.moduleFile(mod);
        if (rel === undefined) return sendJson(res, { error: `${mod.slice(0, 300)} is not a module of the graph` }, 404);
        // a read-only reader (CollabSpec decision 11) is answered what Lean already said of this
        // build, else asks it within bounds, per address and in all
        const keyOf = reader !== undefined && req.method === "GET" ? `${live.graph.fingerprint}\0${path}\0${url.search}` : null;
        const kept = keyOf ? this.bounds.answer(keyOf) : undefined;
        if (kept !== undefined) return sendJson(res, kept);
        if (reader !== undefined) {
          const wait = this.bounds.leanWait(req.socket.remoteAddress ?? "");
          if (wait) return sendJson(res, { error: "Lean is asked too often from here: try again in a moment.", retryAfter: wait }, 429, { "retry-after": String(wait) });
        }
        const reply = (body: unknown) => {
          if (keyOf && finalAnswer(body)) this.bounds.keep(keyOf, body);
          return sendJson(res, body);
        };
        if (path === "/api/hover/describe") {
          // a declaration by name, where the module on show is imported: what a name in a hover card
          // shows. The name is checked to be a name before it is written into Lean source.
          const name = url.searchParams.get("name") ?? "";
          if (!isDeclName(name)) return sendJson(res, { error: "not a name" }, 400);
          return reply(await this.hover.describe(mod, name, 6000));
        }
        if (path === "/api/hover/print") {
          // what Lean's #print says of a declaration it generated from a command, which has no text
          // of its own (the source window, under the command that made it, when asked)
          const name = url.searchParams.get("name") ?? "";
          if (!isDeclName(name)) return sendJson(res, { error: "not a name" }, 400);
          return reply(await this.hover.print(mod, name, false, 6000));
        }
        if (rel === null) return sendJson(res, { error: `no source for ${mod}` }, 404);
        const text = readFileSync(join(live.project.root, rel), "utf8");
        const hash = lakeTextHash(text);
        if (path === "/api/hover/open") {
          try {
            await this.hover.open(rel, text, hash);
            return sendJson(res, { ok: true });
          } catch (e) {
            return sendJson(res, { error: this.hover.failure ?? (e instanceof Error ? e.message : String(e)) });
          }
        }
        // the page shows another text than there is now: it reads the source again first
        const want = url.searchParams.get("hash");
        if (want && want !== hash) return sendJson(res, { stale: true });
        if (path === "/api/hover/names") {
          // the positions of the names in a declaration's source, as JSON [[line, character], …]
          const r = await this.json(req, 1 << 20);
          if (r.error !== undefined) return sendJson(res, { error: r.error }, 400);
          const ps = r.body;
          const ok = Array.isArray(ps) && ps.length <= 5000 && ps.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => Number.isInteger(x) && x >= 0));
          if (!ok) return sendJson(res, { error: "positions" }, 400);
          return sendJson(res, await this.hover.names(rel, text, hash, ps as [number, number][], 8000));
        }
        const line = Number(url.searchParams.get("line")), character = Number(url.searchParams.get("character"));
        if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) return sendJson(res, { error: "position" }, 400);
        return reply(await this.hover.hover(rel, text, hash, line, character, 6000));
      }
      if (path === "/api/source") {
        // only the graph's modules, from the file the graph was read from: no path from the client
        // ever reaches the disk, and no file outside the graph is served
        if (!live.graph) return sendJson(res, { error: "not ready" }, 503);
        const mod = url.searchParams.get("module") ?? "";
        const rel = live.moduleFile(mod);
        if (!rel) return sendJson(res, { error: `no source for ${mod.slice(0, 300)}: it is not a module of the graph` }, 404);
        const text = readFileSync(join(live.project.root, rel), "utf8");
        const hash = lakeTextHash(text);
        // the usage pass's contexts of the module (shared/context.ts), when this is the text it
        // elaborated
        const contexts = live.contextsOf(mod);
        // the hash says whether this is the text the graph was read from (meta.modules[].compiled)
        return sendJson(res, { module: mod, file: rel, text, hash, ...(contexts && contexts.hash === hash ? { contexts } : {}) });
      }
      sendJson(res, { error: "not found" }, 404);
    }
  }
}

/** an artwork's font file (assets/webfonts/) */
const FONT_PATH = /^\/fonts\/(source-sans-3|source-serif-4|jost)-[a-z-]+\.woff2$/;

/** the most an agent's request body may be (docs/agent-api/requests.md: 1 MB) */
const AGENT_BODY = 1 << 20;
