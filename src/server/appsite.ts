// What pages record in the site (the routes of server/app.ts): the review (ReviewSpec.md), the views
// and their layouts (ViewSpec.md) and a layout batch undone, the history's moves and the
// lost-and-found (HistorySpec.md), the library (AttachmentSpec.md). Each is recorded under who asks,
// as the agents' API records it; an agent here is held to its level as there.

import { historyAnswer } from "./historyapi.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { layoutAuthor } from "./identity.ts";
import { MAX_MEMORY_BYTES } from "./views.ts";
import { needOf, refusal } from "./agent.ts";
import type { Caller } from "./agent.ts";
import type { Answer } from "./agent.ts";
import { libraryApiOf } from "./library.ts";
import { libraryRoute } from "./libraryroute.ts";
import { sendGz, sendJson } from "./send.ts";
import { undo } from "./agentplaces.ts";
import type { App } from "./app.ts";

/** POST /api/review: what a page records in the review, `{op, …}` (server/reviewapi.ts). */
export function reviewPost(app: App, req: IncomingMessage, res: ServerResponse, agent: boolean): Promise<void> | void {
  // an opinion, a target, a trusted prefix or a key declaration is recorded under the
  // reader's name (CollabSpec decision 3), not one in the body; what it is about is
  // bound by the server (server/reviewapi.ts)
  const me = app.ids.who(req);
  if (!me) return sendJson(res, app.nameless(req, "what you record in the review is recorded under your name"), 401);
  const person = app.ids.person(req)?.id ?? null;
  return app.json(req, 1 << 20).then(({ body, error }) => {
    if (error) return sendJson(res, { error: `The body is ${error}.` }, 400);
    // an agent records here what its level allows, as through its own API (AgentSpec decision
    // 9): an opinion as advice, the rest at full; in its own log, marked as an agent's
    const no = agent ? refusal(app.agents.level, needOf(body)) : null;
    if (no) return sendJson(res, no.body, no.status);
    // someone invited by a personal link writes to the log of their link (shared/review.ts)
    const a = app.agents.reviews.post(body, { name: me, agent, person });
    sendJson(res, a.body, a.status);
  });
}

/** A request about views (server/views.ts): read here, answered there. A private page's is
 *  answered as its, recorded without its name (CollabSpec decision 8). */
export async function views(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const priv = app.ids.privateOf(req);
  const person = app.ids.person(req);
  const caller: Caller = { name: app.ids.who(req), kind: app.ids.kind(req), ...(person ? { person: person.id } : {}), ...(priv !== null ? { private: { session: priv || null } } : {}) };
  let body: unknown = null;
  if (req.method === "POST") {
    // a board's layout memory is as large as the board; nothing else about views is
    const r = await app.json(req, url.pathname.replace(/\/+$/, "") === "/api/views/memory" ? MAX_MEMORY_BYTES : 1 << 20);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    body = r.body;
  }
  const a: Answer = app.live.views.handle({ method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body, caller }, app.agents.level);
  sendJson(res, a.body, a.status, a.headers);
}

/** a layout batch an agent made, undone (AgentSpec decision 4): from a page's Activity, by anyone;
 *  by a private reader, without their name (CollabSpec decision 8) */
export async function layoutUndo(app: App, req: IncomingMessage, res: ServerResponse, agent: boolean): Promise<void> {
  const priv = app.ids.privateOf(req) !== null;
  const me = layoutAuthor({ name: app.ids.who(req), private: priv });
  if (!me && !priv) return sendJson(res, { error: "Say who you are first.", who: true }, 401);
  const no = agent ? refusal(app.agents.level, "full") : null;
  if (no) return sendJson(res, no.body, no.status);
  const r = await app.json(req, 4096);
  if (r.error !== undefined) return sendJson(res, { error: r.error }, 400);
  const a = undo(app.agents, me, agent, (r.body as { id?: unknown } | null)?.id);
  return sendJson(res, a.body, a.status);
}

/** the snapshots of the graph, one per build (HistorySpec.md): the Time Machine reads them; the
 *  moves, the lost-and-found and its archive */
export async function history(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const live = app.live;
  const path = url.pathname;
  let body: unknown = null;
  if (req.method === "POST") {
    // a name's every entry archived at once is a few hundred keys at most
    const r = await app.json(req, 1 << 20);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    body = r.body;
  }
  // a move, an archiving or a putting back is recorded as the review is: under the reader's
  // name — a private reader's too (CollabSpec decision 8) — with the personal link of someone
  // invited by one, whose moves go to their link's log (decision 9); by an agent at level full
  const person = app.ids.person(req)?.id;
  const a = await historyAnswer(live, { method: req.method ?? "GET", path, query: url.searchParams, body, caller: { name: app.ids.who(req), kind: app.ids.kind(req), ...(person ? { person } : {}) } }, (q) =>
    q.caller.kind === "agent" ? refusal(app.agents.level, "full") : null,
  );
  // a snapshot's graph in parts, as the Time Machine takes it: compressed once, and tagged
  if (a.gz) return sendGz(req, res, a.gz.body, a.gz.type);
  return sendJson(res, a.body, a.status, a.headers);
}

/** The library's operations (server/library.ts), shared with the agents' API. */
export function library(app: App) {
  return libraryApiOf(app.live, () => ({
    review: app.live.review,
    project: app.live.project,
    library: app.live.library,
    graph: () => {
      const v = app.agents.reviews.graph();
      return "status" in v ? null : v;
    },
    // every file the library takes shows on the Project: a note carries it, on the ring
    fileAdded: (f, who, note) => void app.live.views.fileAdded(f, { by: who.name, agent: who.agent, person: who.person ?? null }, note),
  }));
}

/** the library of papers and images, and the links into them (AttachmentSpec.md,
 *  server/libraryroute.ts) */
export function libraryRequest(app: App, req: IncomingMessage, res: ServerResponse, url: URL, reader: string | undefined): Promise<void> | void {
  const live = app.live;
  const path = url.pathname;
  // a read-only reader (CollabSpec decision 11) is drawn what the notes show of a PDF, kept in
  // the cache as it is drawn, and no other page or region of one: each would be drawn by
  // Poppler and kept anew, whoever comes asking
  if (reader !== undefined && (path === "/api/library/page" || path === "/api/library/clip")) {
    const q = url.searchParams;
    const region = path === "/api/library/clip" ? (q.get("region") ?? "").split(",").map(Number) : null;
    if (!live.views.shows(q.get("sha") ?? "", Number(q.get("page")), region)) return sendJson(res, { error: "A read-only page is drawn what the notes show of the library: open the file itself.", readOnly: true }, 403);
  }
  return libraryRoute({ ids: app.ids, level: app.agents.level, api: library(app) }, req, res, url);
}
