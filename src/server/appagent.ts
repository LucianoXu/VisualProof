// The routes server/agent.ts answers (the App's, server/app.ts): the agents' door — a request under
// /api/agent read here, the agent it is from being who its token says, and answered there — and the
// exported document, which the page asks for under /api/export and agents under /api/agent/export,
// for the same answers.

import type { IncomingMessage, ServerResponse } from "node:http";
import { validSession } from "../shared/collab.ts";
import type { Caller } from "./agent.ts";
import type { TokenRecord } from "./tokens.ts";
import type { Answer } from "./agent.ts";
import { readUpload } from "./libraryroute.ts";
import { UPLOAD_PATH } from "./agentlibrary.ts";
import { hostOf, sendDownload, sendGz, sendJson, sendText } from "./send.ts";
import type { App } from "./app.ts";

/** The exported document (ExportSpec decisions 5–16): POST /api/export starts typesetting the
 *  document of a view, `{view, settings, version?}` (a build the Time Machine shows the view at;
 *  left out, the view's own), and answers with its job at once; the page asks how the
 *  job is doing (GET /api/export/job) and fetches the PDF and the LaTeX sources once it is done
 *  (GET /api/export/file). The answers are the agents' API's (server/agent.ts), which has the same
 *  routes under /api/agent/; an agent that comes here is held to its one job at a time there too.
 *  The window shows the title and the author line the document will have (GET /api/export/head
 *  ?view=&version=: ExportSpec decisions 14 and 15), which only the server can tell: who dropped
 *  each pin is never sent to pages. */
export async function exportRoute(app: App, req: IncomingMessage, res: ServerResponse, url: URL, agent: boolean, readOnly = false): Promise<void> {
  const path = url.pathname;
  const api = app.agents;
  // the document's outline, which the linear form draws: nothing is typeset for it
  if (path === "/api/export/outline") {
    const o = api.exportOutline(url.searchParams.get("view") ?? "", url.searchParams.get("version") ?? undefined);
    return sendJson(res, o.body, o.status, o.headers);
  }
  if (!app.exporter) return sendJson(res, { error: "This server does not export documents." }, 404);
  let a: Answer;
  if (path === "/api/export" && req.method === "POST") {
    const caller: Caller | null = agent ? { name: app.ids.who(req), kind: "agent" } : null;
    if (caller && !caller.name) return sendJson(res, { error: "Say who you are first.", who: true }, 401);
    const r = await app.json(req, 1 << 20);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    // read-only readers typeset one document at a time among them (CollabSpec decision 11): while
    // one is being typeset, the others wait, even one the export's cache holds. The place is
    // taken before the job starts, so that two requests at once cannot both start one.
    if (readOnly) {
      if (!app.bounds.mayExport()) return sendJson(res, { error: "Another document is being typeset for readers of this page: try again in a little while." }, 429, { "retry-after": "5" });
      app.bounds.reserveExport();
    }
    let started: Answer | undefined;
    try {
      started = await api.exportStart(r.body, caller);
    } finally {
      if (readOnly) app.bounds.exportStarted(started?.body);
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
export async function agentRoute(app: App, req: IncomingMessage, res: ServerResponse, url: URL, token: TokenRecord | null = null): Promise<void> {
  const said = app.ids.who(req);
  const caller: Caller = token
    ? { name: token.name, kind: "agent", token: { id: token.id, by: token.by, level: token.level, expires: token.expires }, ...(said && said !== token.name ? { ignoredName: said } : {}) }
    : { name: said, kind: app.ids.kind(req) };
  let body: unknown = null;
  if (req.method === "POST" && url.pathname.replace(/\/+$/, "") === UPLOAD_PATH) {
    // a file for the library: its bytes as they come (server/agentlibrary.ts)
    const bytes = await readUpload(req, res);
    if (!bytes) return;
    body = { bytes };
  } else if (req.method === "POST") {
    const r = await app.json(req, AGENT_BODY);
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
  const a = await app.agents.handle({ method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body, caller, base: app.publicUrl ?? `http://${hostOf(req)}`, signal: away.signal, ...(validSession(session) ? { session } : {}) });
  if (away.signal.aborted) return;
  if (a.text) return sendText(req, res, a.text.body, a.text.type, a.status);
  if (a.file) return sendDownload(res, a.file);
  if (a.gz) return sendGz(req, res, a.gz.body, a.gz.type);
  sendJson(res, a.body, a.status, a.headers);
}

/** the most an agent's request body may be (docs/agent-api/requests.md: 1 MB) */
const AGENT_BODY = 1 << 20;
