// Share, for people (the routes of server/app.ts): a token for an AI agent and its prompt (AgentSpec
// decision 7), a personal link for a person (CollabSpec decision 9) and the one a page came by, and
// read-only links (decision 11) — each listed, made, shown again or revoked. Agents are refused all
// of it, at every level: what lets someone in stays with people.

import type { IncomingMessage, ServerResponse } from "node:http";
import { defaultAgentName, madeBy } from "../shared/collab.ts";
import { INVITE_PATH, invalidPersonName, Invites } from "./invites.ts";
import { AGENT_LEVELS, lower } from "./agent.ts";
import { AgentTokens, DEFAULT_DAYS, invalidAgentName, TOKEN_DAYS } from "./tokens.ts";
import { agentPrompt } from "./prompt.ts";
import type { AgentLevel } from "./agent.ts";
import { reachedAt, sendJson } from "./send.ts";
import type { App } from "./app.ts";

/** Sharing with an AI agent (AgentSpec decision 7), for people: the tokens in force (GET), a new
 *  one with its prompt (POST), a token's prompt shown again (POST …/prompt), and revoking one
 *  (POST …/revoke). All but the list need a name: a token is made under it, and its prompt holds
 *  the token. The prompt is asked for by POST, as making one is, so that the browser sends its
 *  Origin and the prompt names the server as the page reached it, the same both times. */
export async function shareAgents(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  // agent tokens stay with people, at every level (the owner's decision, AgentSpec decision 9):
  // an agent that could make, show or revoke tokens could outlive its own revocation. A token
  // never gets here (it reaches the agents' API alone), and a request that says it is an agent's
  // is refused
  if (app.ids.kind(req) === "agent") return sendJson(res, { error: "Agent tokens are for people: an agent cannot make, show or revoke them, at any level." }, 403);
  const tokens = app.live.tokens;
  const top = app.agents.level;
  const me = app.ids.who(req);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/api/share/agents" && req.method === "GET")
    return sendJson(res, { level: top, levels: AGENT_LEVELS.slice(0, AGENT_LEVELS.indexOf(top) + 1), defaultLevel: lower("advise", top), days: TOKEN_DAYS, defaultDays: DEFAULT_DAYS, tokens: tokens.inForce().map(AgentTokens.info) });
  if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
  if (!me) return sendJson(res, { error: "Say who you are first: a token is made, shown or revoked under your name.", who: true }, 401);
  const r = await app.json(req, 1 << 16);
  if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
  const b = (r.body ?? {}) as Record<string, unknown>;
  if (path === "/api/share/agents/revoke") {
    if (typeof b.id !== "string" || !tokens.revoke(b.id, me)) return sendJson(res, { error: "There is no such token in force." }, 404);
    return sendJson(res, { ok: true, tokens: tokens.inForce().map(AgentTokens.info) });
  }
  // the server as the prompt names it
  const address = app.publicUrl ?? reachedAt(req);
  if (path === "/api/share/agents/prompt") {
    // a token that ended has no prompt: it lets nothing in. Its maker alone is shown it again (the
    // owner's decision of 2026-10-19): whoever holds the token reads its private channel
    const t = typeof b.id === "string" ? tokens.token(b.id) : null;
    if (!t) return sendJson(res, { error: "There is no such token in force." }, 404);
    if (!madeBy(t.record, { name: me, person: app.ids.person(req)?.id ?? null })) return sendJson(res, { error: `Only ${t.record.by}, who made it, is shown this token's prompt again: whoever holds a token reads its agent's private channel.`, maker: false }, 403);
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
  const made = tokens.create({ name: (name as string).trim(), by: me, person: app.ids.person(req)?.id ?? null, level, days: days as number });
  const prompt = agentPrompt({ url: address, token: made.token, record: made.record });
  return sendJson(res, { token: AgentTokens.info(made.record), prompt, tokens: tokens.inForce().map(AgentTokens.info) });
}

/** Inviting a person (CollabSpec decision 9), for people: the personal links in force (GET), a new
 *  one for a person named in the body (POST), and revoking one (POST …/revoke). Making and
 *  revoking need a name: who made a link, and who revoked it, is said in Share. The link itself
 *  is answered once to whoever made it, and again to its holder alone (`mine`). */
export async function sharePeople(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (app.ids.kind(req) === "agent") return sendJson(res, { error: "Personal links are for people: an agent cannot make, list, show or revoke them." }, 403);
  if (app.ids.header) return sendJson(res, { error: "Names come from the sign-in in front of this server: it has no personal links." }, 404);
  const invites = app.live.invites;
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/api/share/people/mine" || path === "/api/share/people/mine/renew") return myLink(app, req, res, path);
  const list = () => invites.inForce().map(Invites.info);
  if (path === "/api/share/people" && req.method === "GET") return sendJson(res, { invites: list() });
  if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
  const me = app.ids.who(req);
  if (!me) return sendJson(res, app.nameless(req, "a personal link is made or revoked under your name"), 401);
  const r = await app.json(req, 4096);
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
  const link = `${app.publicUrl ?? reachedAt(req)}${INVITE_PATH}${made.token}`;
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
async function myLink(app: App, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const p = app.ids.person(req);
  if (!p) return sendJson(res, { error: "A personal link is shown to its holder alone, in a browser it let in: this page came by none.", holder: false }, 403);
  if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
  const invites = app.live.invites;
  const address = app.publicUrl ?? reachedAt(req);
  if (path === "/api/share/people/mine") {
    const token = invites.tokenOf(p.id);
    return sendJson(res, { invite: Invites.info(p), link: token ? `${address}${INVITE_PATH}${token}` : null });
  }
  const r = await app.json(req, 4096);
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
export async function shareReadOnly(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (app.ids.kind(req) === "agent") return sendJson(res, { error: "Read-only links are for people: an agent cannot make, list or revoke them." }, 403);
  if (!app.access || app.ids.header) return sendJson(res, { error: app.ids.header ? "Who comes in is the sign-in's, in front of this server: it has no read-only links." : "This server lets in whoever reaches it: a read-only link would let in no one more." }, 404);
  const links = app.live.readOnly;
  const path = url.pathname.replace(/\/+$/, "");
  const address = app.publicUrl ?? reachedAt(req);
  const list = () => links.list().map((l) => ({ ...l, link: `${address}${l.path}` }));
  if (path === "/api/share/readonly" && req.method === "GET") return sendJson(res, { links: list() });
  if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
  const me = app.ids.who(req);
  if (path === "/api/share/readonly/revoke") {
    if (!me) return sendJson(res, app.nameless(req, "a read-only link is revoked under your name"), 401);
    const r = await app.json(req, 4096);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const id = (r.body as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !links.revoke(id, me)) return sendJson(res, { error: "There is no such read-only link in force." }, 404);
    return sendJson(res, { ok: true, links: list() });
  }
  if (path !== "/api/share/readonly") return sendJson(res, { error: "not found" }, 404);
  const made = links.create(me);
  return sendJson(res, { made: { ...made, link: `${address}${made.path}` }, links: list() });
}
