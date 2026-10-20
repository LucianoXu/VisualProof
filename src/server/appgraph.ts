// The project as pages read it (the routes of server/app.ts): the server's status, the graph on show
// in its parts, a module's source, what Lean says at a place of it or of a name (server/hover.ts),
// and the project's git as git says it now. Only the graph's modules are read, or reach Lean: no
// path a client sends reaches the disk.

import { gitSource } from "./history.ts";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { isDeclName } from "./hover.ts";
import { lakeTextHash } from "./status.ts";
import { finalAnswer } from "./readonlygate.ts";
import { slimDeploy } from "../shared/deploy.ts";
import type { DeployStatus } from "../shared/deploy.ts";
import { packedGz, sendGz, sendJson } from "./send.ts";
import type { App } from "./app.ts";

/** with Lean's language server as it is (server/hover.ts): what is open, what crashed
 *  a read-only reader is told how the server is, not its log nor where its review is kept
 *  `?brief`: the build status without its files, which the page reads by GET /api/build */
export function status(app: App, req: IncomingMessage, res: ServerResponse, url: URL): void {
  const live = app.live;
  const st: Record<string, unknown> = { ...(live.status(url.searchParams.has("brief")) as Record<string, unknown>), lean: app.hover.state() };
  // the address people reach the server at (--public-url): links of it are this site's, and the
  // page makes its own with it (CollabSpec, "Copied links")
  if (app.publicUrl) st.publicUrl = app.publicUrl;
  if (app.readOnlyOf.get(req) !== undefined) {
    delete st.log;
    st.review = { ...(st.review as object), folder: undefined };
    // a branch's build log is not a read-only reader's (DeploySpec decision 11)
    if (st.deploy) st.deploy = slimDeploy(st.deploy as DeployStatus);
  }
  return sendJson(res, st);
}

/** GET /api/meta and GET /api/edges: the graph on show, its declarations and its edges, as prepared. */
export function graphParts(app: App, req: IncomingMessage, res: ServerResponse, url: URL): void {
  const live = app.live;
  const path = url.pathname;
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

/** GET /api/source?module=: a module's text, as the source windows read it. */
export function source(app: App, res: ServerResponse, url: URL): void {
  const live = app.live;
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

/** /api/hover and under it: Lean's language server asked about a module of the graph. */
export async function hover(app: App, req: IncomingMessage, res: ServerResponse, url: URL, reader: string | undefined): Promise<void> {
  const live = app.live;
  const path = url.pathname;
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
  const kept = keyOf ? app.bounds.answer(keyOf) : undefined;
  if (kept !== undefined) return sendJson(res, kept);
  if (reader !== undefined) {
    const wait = app.bounds.leanWait(req.socket.remoteAddress ?? "");
    if (wait) return sendJson(res, { error: "Lean is asked too often from here: try again in a moment.", retryAfter: wait }, 429, { "retry-after": String(wait) });
  }
  const reply = (body: unknown) => {
    if (keyOf && finalAnswer(body)) app.bounds.keep(keyOf, body);
    return sendJson(res, body);
  };
  if (path === "/api/hover/describe") {
    // a declaration by name, where the module on show is imported: what a name in a hover card
    // shows. The name is checked to be a name before it is written into Lean source.
    const name = url.searchParams.get("name") ?? "";
    if (!isDeclName(name)) return sendJson(res, { error: "not a name" }, 400);
    return reply(await app.hover.describe(mod, name, 6000));
  }
  if (path === "/api/hover/print") {
    // what Lean's #print says of a declaration it generated from a command, which has no text
    // of its own (the source window, under the command that made it, when asked)
    const name = url.searchParams.get("name") ?? "";
    if (!isDeclName(name)) return sendJson(res, { error: "not a name" }, 400);
    return reply(await app.hover.print(mod, name, false, 6000));
  }
  if (rel === null) return sendJson(res, { error: `no source for ${mod}` }, 404);
  const text = readFileSync(join(live.project.root, rel), "utf8");
  const hash = lakeTextHash(text);
  if (path === "/api/hover/open") {
    try {
      await app.hover.open(rel, text, hash);
      return sendJson(res, { ok: true });
    } catch (e) {
      return sendJson(res, { error: app.hover.failure ?? (e instanceof Error ? e.message : String(e)) });
    }
  }
  // the page shows another text than there is now: it reads the source again first
  const want = url.searchParams.get("hash");
  if (want && want !== hash) return sendJson(res, { stale: true });
  if (path === "/api/hover/names") {
    // the positions of the names in a declaration's source, as JSON [[line, character], …]
    const r = await app.json(req, 1 << 20);
    if (r.error !== undefined) return sendJson(res, { error: r.error }, 400);
    const ps = r.body;
    const ok = Array.isArray(ps) && ps.length <= 5000 && ps.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => Number.isInteger(x) && x >= 0));
    if (!ok) return sendJson(res, { error: "positions" }, 400);
    return sendJson(res, await app.hover.names(rel, text, hash, ps as [number, number][], 8000));
  }
  const line = Number(url.searchParams.get("line")), character = Number(url.searchParams.get("character"));
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) return sendJson(res, { error: "position" }, 400);
  return reply(await app.hover.hover(rel, text, hash, line, character, 6000));
}

/** the project's git source and commit as git says them now, not as the build was read (an
 *  artwork's foot, ExportSpec decision 19; the owner's decision of 2026-10-15) */
export function git(app: App, res: ServerResponse): void {
  const live = app.live;
  // following a branch, the commit of the build on show, on that branch: what is checked out
  // meanwhile is the build going on (DeploySpec decision 12)
  const shown = live.shownCommit();
  if (shown !== undefined) return sendJson(res, { git: shown && { source: live.deploy!.status(false).source, commit: shown.hash, branch: shown.branch } });
  if (!app.gitRead || Date.now() - app.gitRead.at >= app.gitFreshMs) app.gitRead = { git: gitSource(live.project.root), at: Date.now() };
  return sendJson(res, { git: app.gitRead.git });
}
