// The call (the routes of server/app.ts; CallSpec, server/call.ts): a page's token for the call, and
// what someone in it does — leave, end it for everyone, remove a participant, invite someone here.
// Each request names the page's event stream by its secret (`hello`), as a heartbeat does: the call
// is the page's, not the browser's. Everyone let in fully joins and acts as an equal (CallSpec
// decision 3); a read-only reader joins only by a read-only link that joins the call, and does
// nothing to anyone else (decision 4); agents have no place in a call.

import type { IncomingMessage, ServerResponse } from "node:http";
import { CALL_TAB } from "../shared/call.ts";
import { invalidPersonName, taken } from "./invites.ts";
import { sendJson } from "./send.ts";
import type { App } from "./app.ts";

/** What a page is told where the call's server does not answer: nothing of where it is. */
const UNAVAILABLE = "The call's server does not answer now: try again in a moment. Whoever runs this server finds why in its log.";

export async function callRoute(app: App, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const call = app.live.call;
  // without --livekit-url there is no call (CallSpec decision 1)
  if (!call) return sendJson(res, { error: "not found" }, 404);
  if (req.method !== "POST") return sendJson(res, { error: `${url.pathname} answers POST.` }, 405);
  if (app.ids.kind(req) === "agent") return sendJson(res, { error: "Agents have no place in a call." }, 403);
  const r = await app.json(req, 4096);
  if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
  const b = (r.body && typeof r.body === "object" ? r.body : {}) as { token?: unknown; tab?: unknown; name?: unknown; identity?: unknown; to?: unknown };
  const page = typeof b.token === "string" ? app.live.callPage(b.token) : null;
  if (!page) return sendJson(res, { error: "This request is not from an open event stream of this page's: it is sent with the token the stream says hello with.", stream: false }, 403);
  const reader = app.readOnlyOf.get(req);
  // the request and the stream it names are one reader's, read-only or not: a browser that holds
  // both kinds of cookie speaks for each of its pages as that page was let in
  if ((reader !== undefined) !== (page.readOnly !== null)) return sendJson(res, { error: "This request is not from that page's way in: reload the page.", stream: false }, 403);
  // what a page that leaves sends as it goes: nothing kept out
  if (url.pathname === "/api/call/leave") {
    await call.leave(page.token);
    return sendJson(res, { ok: true });
  }
  if (url.pathname === "/api/call/token") {
    // in a call one is seen (CallSpec decision 3)
    if (page.private || app.ids.privateOf(req) !== null) return sendJson(res, { error: "You are private: in a call everyone sees you. Go visible (the menu under your name) to join.", private: true }, 409);
    let name: string;
    let link: string | null = null;
    if (reader !== undefined) {
      // a read-only reader joins by a read-only link that joins the call, under a name they give
      // (CallSpec decision 4); --public's readers have none
      const by = page.readOnly!;
      const l = by === "public" ? null : app.live.readOnly.get(by);
      if (!l?.call || l.revoked) return sendJson(res, { error: by === "public" ? "Whoever reads by the address alone has no call: a read-only link made to join the call has." : "This read-only link does not join the call: whoever made it can switch that, in Share.", readOnly: true }, 403);
      const bad = invalidPersonName(b.name);
      if (bad) return sendJson(res, { error: bad, who: true }, 400);
      name = (b.name as string).trim();
      const holder = app.live.invites.holder(name);
      if (holder) return sendJson(res, { error: taken(holder), who: true, taken: true }, 409);
      link = by;
    } else {
      const me = app.ids.who(req);
      if (!me) return sendJson(res, app.nameless(req, "a call shows everyone in it by name"), 401);
      name = me;
    }
    if (typeof b.tab !== "string" || !CALL_TAB.test(b.tab)) return sendJson(res, { error: "tab is what this page's tab calls itself in the call: 16 to 64 letters, digits, _ and -." }, 400);
    const wait = call.allow(`t:${page.token}`);
    if (wait) return sendJson(res, { error: `Too many at once: wait ${wait} s.`, retryAfter: wait }, 429, { "retry-after": String(wait) });
    // LiveKit did not answer the last time it was asked: asked again, and a token only where it does
    if (call.unavailable !== null) await call.look();
    if (call.unavailable !== null) return sendJson(res, { error: UNAVAILABLE, unavailable: true }, 503);
    return sendJson(res, call.give(page, b.tab, name, link));
  }
  // the rest is for someone in the call, let in fully: a read-only reader does nothing to anyone
  // else (CallSpec decision 4)
  if (reader !== undefined) return sendJson(res, { error: "This page is read-only: in the call it joins and leaves, and nothing else.", readOnly: true }, 403);
  const mine = call.inCall(page.token);
  if (!mine) return sendJson(res, { error: "Only someone in the call does that.", inCall: false }, 403);
  const me = app.ids.who(req) ?? page.name;
  try {
    if (url.pathname === "/api/call/end") {
      await call.end(me);
      return sendJson(res, { ok: true });
    }
    if (url.pathname === "/api/call/remove") {
      if (typeof b.identity !== "string") return sendJson(res, { error: "identity is a participant's, as the call lists them." }, 400);
      if (!(await call.remove(b.identity, me))) return sendJson(res, { error: "There is no such participant in the call." }, 404);
      return sendJson(res, { ok: true });
    }
  } catch (e) {
    // what LiveKit answered, and where it is, are the server's log's, not the page's
    console.error(`call: ${url.pathname}: ${e instanceof Error ? e.message : String(e)}`);
    return sendJson(res, { error: UNAVAILABLE, unavailable: true }, 503);
  }
  if (url.pathname === "/api/call/invite") {
    if (typeof b.to !== "string") return sendJson(res, { error: "to is a reader's id, as presence lists them." }, 400);
    const wait = call.allow(`i:${page.token}`);
    if (wait) return sendJson(res, { error: `Too many at once: wait ${wait} s.`, retryAfter: wait }, 429, { "retry-after": String(wait) });
    const done = call.invite(b.to, me ?? "Someone");
    if (done === "none") return sendJson(res, { error: "There is nobody here by that id: they left, or went private." }, 404);
    if (done === "in") return sendJson(res, { error: "They are in the call already." }, 409);
    return sendJson(res, { ok: true });
  }
  return sendJson(res, { error: "not found" }, 404);
}
