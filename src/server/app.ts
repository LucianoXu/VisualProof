// The server's answers to requests (server/main.ts serves them, the tests too): each request let in
// or not, in the order SECURITY.md relies on — the name it was sent to, a write only from a page of
// this server's own, an agent's token before the key, a personal or a read-only link, the key, then
// what a read-only reader may ask — and answered by its route.

import { gitSource } from "./history.ts";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { WEB, WEBFONTS, bundleDir } from "./pipeline.ts";
import { Live } from "./live.ts";
import { isDeclName, LeanHover } from "./hover.ts";
import { Identities } from "./identity.ts";
import type { GitSource } from "../shared/graph.ts";
import { validSession } from "../shared/collab.ts";
import { lakeTextHash } from "./status.ts";
import { Access, fromOwnPage, hostAllowed, KEY_PATH, urlHost } from "./access.ts";
import { asksForPage, sendAccessPage } from "./accesspage.ts";
import { INVITE_PATH, taken } from "./invites.ts";
import { AgentApi } from "./agent.ts";
import { bearerOf, looksLikeToken } from "./tokens.ts";
import { Exporter } from "./export.ts";
import { pdfjsAsset } from "./libraryroute.ts";
import { packageVersion } from "./doctor.ts";
import { READONLY_PATH } from "./readonly.ts";
import { sendMedia, TIP_PATH, TIPS_DIR, tipClips, tourData, tourVtt } from "./media.ts";
import { withoutReasons } from "../shared/timeline.ts";
import { Updates } from "./updates.ts";
import { serveFilm } from "./film.ts";
import { finalAnswer, readOnlyAllows, ReadOnlyBounds } from "./readonlygate.ts";
import { slimDeploy } from "../shared/deploy.ts";
import type { DeployStatus } from "../shared/deploy.ts";
import { packedGz, readBody, refused, sendFile, sendGz, sendJson, sendRevision, sendText, TooLarge, tooLarge } from "./send.ts";
import { endedWords, enter, enterReadOnly, identity, identityGet, refuseHost, revokedWords } from "./appaccess.ts";
import { shareAgents, sharePeople, shareReadOnly } from "./appshare.ts";
import { ask, chat, chatNew, presence } from "./apptalk.ts";
import { history, layoutUndo, libraryRequest, reviewPost, views } from "./appsite.ts";
import { agentRoute, exportRoute } from "./appagent.ts";

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
  readonly readOnlyOf = new WeakMap<IncomingMessage, string>();
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

  /** The answer to a request that needs a name and has none: the page asks for one (`who`). Where
   *  the name the page gives is a personal link holder's, it says so, and the page asks for
   *  another. */
  nameless(req: IncomingMessage, what: string): { error: string; who: true } {
    const holder = this.ids.taken(req);
    return { error: holder ? `${taken(holder)} (Click your name.)` : `Say who you are first: ${what}.`, who: true };
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
        return agentRoute(this, req, res, url, t.ok);
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
      if (path === "/api/share/readonly" || path.startsWith("/api/share/readonly/")) return shareReadOnly(this, req, res, url);
      if (path.startsWith("/api/share/agents")) return shareAgents(this, req, res, url);
      if (path === "/api/share/people" || path.startsWith("/api/share/people/")) return sharePeople(this, req, res, url);
      if (path === "/api/chat") return chat(this, req, res, url);
      if (path === "/api/chat/new") return chatNew(this, req, res);
      if (path === "/api/ask" || path === "/api/ask/answer") return ask(this, req, res, url);
      if (path === "/api/agent" || path.startsWith("/api/agent/")) return agentRoute(this, req, res, url);
      // the views, each a shared board (ViewSpec.md)
      if (path === "/api/views" || path.startsWith("/api/views/")) return views(this, req, res, url);
      if (path === "/api/history" || path.startsWith("/api/history/")) return history(this, req, res, url);
      if (path === "/api/library" || path.startsWith("/api/library/")) return libraryRequest(this, req, res, url, reader);
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
      if (path === "/api/review" && req.method === "POST") return reviewPost(this, req, res, agent);
      if (path === "/api/export" || path.startsWith("/api/export/")) return exportRoute(this, req, res, url, agent, reader !== undefined);
      if (path === "/api/identity" && req.method === "GET") return identityGet(this, req, res, link, reader);
      if (path === "/api/identity" && req.method === "POST") return identity(this, req, res);
      if (path === "/api/presence" && req.method === "POST") return presence(this, req, res, agent);
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
      if (path === "/api/layout/undo" && req.method === "POST") return layoutUndo(this, req, res, agent);
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
