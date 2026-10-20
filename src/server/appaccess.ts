// Who comes in, and who they are (the routes of server/app.ts): a request for a name this server is
// not reached by refused (CollabSpec decision 12), a personal link and a read-only link opened
// (decisions 9 and 11), what a link that ended is told, and who the reader is (/api/identity:
// decisions 3 and 9). Whether a request is let in at all, and in what order it is asked, is the
// route's (server/app.ts), as SECURITY.md describes it.

import type { IncomingMessage, ServerResponse } from "node:http";
import { asksForPage, sendAccessPage } from "./accesspage.ts";
import { invalidPersonName, Invites, taken } from "./invites.ts";
import type { InviteCheck } from "./invites.ts";
import { sendJson, sendText } from "./send.ts";
import type { App } from "./app.ts";

/** A personal link opened (CollabSpec decision 9): the browser is given the cookie that lets its
 *  holder in, as who the link says, and goes on to the page — the token leaves the address, and a
 *  place after it (a fragment) comes along. A revoked link says so; anything else is answered as
 *  any address nobody was given. On a server with a key, a browser is shown the page of a link
 *  that does not open the site instead (CollabSpec decision 7), which says neither which it was
 *  nor who revoked it — unless the key or a link of its own lets it in, and it may be told. */
export function enter(app: App, req: IncomingMessage, res: ServerResponse, token: string, path: string): void {
  const c = app.ids.header ? null : app.live.invites.check(token);
  if (c && "ok" in c) {
    res.writeHead(303, { location: "/", "set-cookie": app.live.invites.cookie(c.ok), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    return void res.end();
  }
  if (app.access && asksForPage(req, path) && (!c || !letIn(app, req))) return sendAccessPage(res, "link", app.publicRead);
  if (c) return sendText(req, res, endedWords(c) + "\n", "text/plain; charset=utf-8", 410);
  sendJson(res, { error: "not found" }, 404);
}

/** A read-only link opened (CollabSpec decision 11): the browser is given the cookie that lets
 *  its holder read, and goes on to the page — the token leaves the address, and a place after it
 *  (a fragment) comes along. A revoked link says so; anything else, and any link on a server
 *  open to all or behind a sign-in, which have none, is answered as an address nobody was given;
 *  to a browser, on a server with a key, as a personal link's (enter). */
export function enterReadOnly(app: App, req: IncomingMessage, res: ServerResponse, token: string, path: string): void {
  const c = app.access && !app.ids.header ? app.live.readOnly.check(token) : null;
  if (c && "ok" in c) {
    res.writeHead(303, { location: "/", "set-cookie": app.live.readOnly.cookie(c.ok.id), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    return void res.end();
  }
  if (app.access && asksForPage(req, path) && (!c || !letIn(app, req))) return sendAccessPage(res, "link", app.publicRead);
  if (c) return sendText(req, res, revokedWords(c.link, "read-only") + "\n", "text/plain; charset=utf-8", 410);
  sendJson(res, { error: "not found" }, 404);
}

/** Whether the key's cookie or a personal link in force lets a request in: someone who sees the
 *  site's people, and may be told who revoked a link. */
export function letIn(app: App, req: IncomingMessage): boolean {
  return !!app.ids.person(req) || app.access?.admit(req, "/") === "in";
}

/** who the reader is (CollabSpec decisions 3 and 9): the name their page gives, the proxy's, or
 *  their personal link's — with the link, and whether the page's own name is a link holder's
 *  and not theirs; a link revoked says by whom, one made anew since this browser had it, when */
export function identityGet(app: App, req: IncomingMessage, res: ServerResponse, link: InviteCheck, reader: string | undefined): void {
  const person = app.ids.person(req);
  const holder = app.ids.taken(req);
  const ended = link && "ended" in link ? link : null;
  if (reader !== undefined) return sendJson(res, { mode: app.ids.mode, name: null, readOnly: { by: reader === "public" ? "public" : "link" } });
  return sendJson(res, {
    mode: app.ids.mode,
    name: app.ids.who(req),
    ...(person ? { person: Invites.info(person) } : {}),
    ...(holder ? { taken: taken(holder) } : {}),
    ...(ended?.ended === "revoked" ? { revoked: { by: ended.record.revokedBy, at: ended.record.revoked, name: ended.record.name } } : {}),
    ...(ended?.ended === "replaced" ? { replaced: { at: ended.at, name: ended.record.name } } : {}),
  });
}

/** Who the reader is (POST /api/identity {name}): the name someone invited by a personal link goes
 *  by from now on — kept with their link, and said in their review log, so that what they wrote
 *  shows under it — or, for a guest, whether a name is theirs to take: one a link's holder goes
 *  by is not (409). A guest's name is their page's own; nothing of it is kept here. */
export async function identity(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (app.ids.kind(req) === "agent") return sendJson(res, { error: "An agent's name is its own: its token's, or the one it sends." }, 403);
  if (app.ids.header) return sendJson(res, { error: "Your name is the sign-in's, in front of this server: it cannot be changed here." }, 403);
  const r = await app.json(req, 4096);
  if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
  const name = (r.body as { name?: unknown } | null)?.name;
  const bad = invalidPersonName(name);
  if (bad) return sendJson(res, { error: bad }, 400);
  const n = (name as string).trim();
  const p = app.ids.person(req);
  if (!p) {
    const holder = app.live.invites.holder(n);
    return holder ? sendJson(res, { error: taken(holder), taken: true }, 409) : sendJson(res, { ok: true, name: n });
  }
  const was = p.name;
  const done = app.live.invites.rename(p.id, n);
  if (typeof done === "string") return sendJson(res, { error: done, taken: true }, 409);
  // their log says so, where they have one: what they wrote shows under the new name everywhere.
  // A log that cannot be written to now (a line to mend by hand) says it with their next line,
  // which carries the name it is written under
  if (done.name !== was) app.live.review.named(p.id, done.name);
  return sendJson(res, { ok: true, name: done.name, person: Invites.info(done) });
}

/** A request for a name this server without a key does not answer (CollabSpec decision 12): 403,
 *  saying which option lets the name in; and, once per name, the server's console says it too,
 *  for whoever runs it behind a proxy that forwards the name people reach it by. A browser asking
 *  for a page is shown a page that says so (the owner's decision of 2026-10-18), which does not
 *  repeat the name: it is the requester's, any text at all. */
export function refuseHost(app: App, req: IncomingMessage, res: ServerResponse, path: string): void {
  const raw = req.headers.host ?? "";
  const name = /^\[/.test(raw) ? raw : raw.replace(/:\d{1,5}$/, "");
  const shown = /^[A-Za-z0-9._\-[\]:]{1,253}$/.test(name) ? name : null;
  if (shown && app.refusedHosts.size < 20 && !app.refusedHosts.has(shown.toLowerCase())) {
    app.refusedHosts.add(shown.toLowerCase());
    console.error(`refused a request for ${shown}: without an access key this server answers only its addresses, localhost, --public-url's host and the --allowed-host names; --allowed-host ${shown} lets this one in`);
  }
  if (asksForPage(req, path)) return sendAccessPage(res, "host");
  sendText(req, res, `This server answers only the names it is meant to be reached by${shown ? `, and ${shown} is not one of them` : ""}. Whoever runs it can let a name in with --allowed-host${shown ? ` ${shown}` : " <name>"}.\n`, "text/plain; charset=utf-8", 403);
}

/** What a revoked link's holder is told, opening it or on a page it had opened. */
export function revokedWords(r: { revokedBy?: string | null; revoked?: string | null }, kind: "personal" | "read-only"): string {
  return `This ${kind} link was revoked by ${r.revokedBy} on ${(r.revoked ?? "").slice(0, 10)}. Ask whoever ${kind === "personal" ? "invited you" : "gave it to you"} for a new one.`;
}

/** What a personal link that lets nobody in any more is told (410): revoked, by whom and when, or
 *  made anew by its holder, and when (CollabSpec decision 9). */
export function endedWords(c: Extract<InviteCheck, { ended: unknown }>): string {
  if (c.ended === "revoked") return revokedWords(c.record, "personal");
  return `This personal link was made anew on ${c.at.slice(0, 10)}: it lets nobody in any more. Open the new one instead (My personal link, in the menu under your name where it was made anew).`;
}
