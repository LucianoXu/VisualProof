// The library's routes for pages (AttachmentSpec decisions 1–11): `/api/library/…`, behind the same
// access check as the page (app.ts lets a request get here only once it is in). What they do is
// server/library.ts's, which the agents' endpoints call too (server/agentlibrary.ts); here are only
// what HTTP needs: who asks, the body — a file's bytes as they are, sent with the file's name in the
// query, or JSON — and answers that are bytes (a file, a page, a clip), sent so that a browser never
// takes them for anything but what they are.
//
//   GET  /api/library                         the library: its files, the archived, how full it is
//   GET  /api/library/info?sha=               a file's record and its links
//   GET  /api/library/file?sha=               its bytes (what pdf.js draws, what an image shows)
//   POST /api/library/upload?name=&sha=&note= add a file: its bytes as the body (sha: the file a
//                                             link names that this server lacks, and no other;
//                                             note=0: the page writes the note that carries it)
//   POST /api/library/url {url}               add the file at an address, fetched once
//   POST /api/library/edit {sha, title}       its title
//   POST /api/library/archive {sha, on}       archived (on, the default) or restored
//   GET  /api/library/links?subject=&file=    links of a subject, or into a file
//   POST /api/library/link {subject, file, page?, region?, quote?, label?}
//   POST /api/library/link/edit {id, …}       its label, place or subject
//   POST /api/library/unlink {id}
//   GET  /api/library/text?sha=&page=         a page's text with the place of every word
//   GET  /api/library/search?sha=&q=          where a text is in a PDF
//   GET  /api/library/page?sha=&page=&width=  a page drawn as a PNG
//   GET  /api/library/clip?sha=&page=&region=&width=  a region of a page drawn as a PNG (a clip)
//
// Writing needs a name, as an opinion does (ReviewSpec decision 6); an agent that comes here with
// its headers is held to its level, as on the page's review (AgentSpec decision 9): files and links
// at advise, what others made at full.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_FILE } from "../shared/library.ts";
import type { AgentLevel } from "./agent.ts";
import type { Identities } from "./identity.ts";
import type { Asker, LibAnswer, LibraryApi } from "./library.ts";

/** What a route reads besides the request. */
export interface RouteWorld {
  ids: Identities;
  /** what agents may do on this server (`--agents`) */
  level: AgentLevel;
  api: LibraryApi;
}

class TooLarge extends Error {}

/** A request's body as bytes, at most `limit`: a larger one is refused before it is all read. */
function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, no) => {
    const length = Number(req.headers["content-length"] ?? NaN);
    if (Number.isFinite(length) && length > limit) return no(new TooLarge());
    const parts: Buffer[] = [];
    let n = 0;
    req.on("data", (b: Buffer) => {
      n += b.length;
      if (n > limit) {
        req.pause();
        no(new TooLarge());
        return;
      }
      parts.push(b);
    });
    req.on("end", () => ok(Buffer.concat(parts)));
    req.on("error", no);
  });
}

/** An uploaded file's bytes, the body as it is; or null, the request answered already (413) where it
 *  is larger than a file of the library may be. The agents' upload reads its body so too (appagent.ts). */
export async function readUpload(req: IncomingMessage, res: ServerResponse): Promise<Buffer | null> {
  try {
    return await readBytes(req, MAX_FILE);
  } catch (e) {
    if (!(e instanceof TooLarge)) throw e;
    // the rest is read and thrown away, and the answer goes once it has all come, as send.ts's
    // tooLarge does: a connection closed while the client still sends is reset on some systems
    let done = false;
    const answer = () => {
      if (done) return;
      done = true;
      res.setHeader("connection", "close");
      sendJson(res, { error: `The file is larger than ${Math.round(MAX_FILE / (1024 * 1024))} MB, the most a file of the library may be.`, hint: "Add a smaller file." }, 413);
    };
    req.on("data", () => {});
    req.on("end", answer);
    req.resume();
    if (req.readableEnded) answer();
    setTimeout(() => {
      answer();
      setTimeout(() => req.destroy(), 500).unref();
    }, 2000).unref();
    return null;
  }
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/** An answer: JSON, or bytes of a type. A file of the library is the same bytes for good (it is
 *  named by its hash), so the browser keeps it; it is sent as what it is, never sniffed, and kept
 *  from running anything should it be opened on its own. */
function send(req: IncomingMessage, res: ServerResponse, a: LibAnswer): void {
  if (!a.bytes) return sendJson(res, a.body, a.status);
  // the same request is the same bytes: a file by its hash, a page or a clip by what it asks for
  const tag = `"${createHash("sha1").update(req.url ?? "").digest("hex").slice(0, 20)}"`;
  const headers: Record<string, string> = {
    "content-type": a.bytes.type,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    "cache-control": a.bytes.immutable ? "private, max-age=31536000, immutable" : "private, no-cache",
    "content-disposition": "inline",
    etag: tag,
  };
  if (req.headers["if-none-match"] === tag) {
    res.writeHead(304, headers);
    return void res.end();
  }
  res.writeHead(a.status, { ...headers, "content-length": String(a.bytes.data.length) });
  res.end(a.bytes.data);
}

/** Answer a request under /api/library. */
export async function libraryRoute(w: RouteWorld, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname.replace(/\/+$/, "");
  const q = (k: string) => url.searchParams.get(k);
  const api = w.api;
  if (req.method === "GET") {
    switch (path) {
      case "/api/library":
        return send(req, res, api.list());
      case "/api/library/info":
        return send(req, res, api.file(q("sha")));
      case "/api/library/file":
        return send(req, res, api.bytes(q("sha")));
      case "/api/library/links":
        return send(req, res, api.links({ subject: q("subject"), file: q("file") }));
      case "/api/library/text":
        return send(req, res, await api.text(q("sha"), q("page")));
      case "/api/library/search":
        return send(req, res, await api.search(q("sha"), q("q"), q("limit")));
      case "/api/library/page":
        return send(req, res, await api.page(q("sha"), q("page"), q("width")));
      case "/api/library/clip":
        return send(req, res, await api.clip(q("sha"), q("page"), q("region"), q("width")));
      default:
        return sendJson(res, { error: "not found" }, 404);
    }
  }
  if (req.method !== "POST") return sendJson(res, { error: `${path} answers GET and POST.` }, 405);
  // who writes: a name, as for an opinion; an agent by its headers, held to its level
  const name = w.ids.who(req);
  if (!name) return sendJson(res, { error: "Say who you are first: what you add to the library is recorded under your name.", who: true }, 401);
  const agent = w.ids.kind(req) === "agent";
  if (agent && w.level === "read") return sendJson(res, { error: `Agents may only read on this server (--agents ${w.level}).`, hint: "--agents advise or full allows adding files and links." }, 403);
  const who: Asker = { name, agent, person: w.ids.person(req)?.id ?? null, full: !agent || w.level === "full" };
  if (path === "/api/library/upload") {
    const bytes = await readUpload(req, res);
    if (!bytes) return;
    return send(req, res, await api.add(bytes, { name: q("name"), expect: q("sha"), note: q("note") !== "0" }, who));
  }
  let body: Record<string, unknown>;
  try {
    const text = (await readBytes(req, 1 << 16)).toString("utf8");
    const raw = text ? JSON.parse(text) : {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
    body = raw as Record<string, unknown>;
  } catch (e) {
    return sendJson(res, { error: e instanceof TooLarge ? "The body is larger than 64 KB." : "The body is not a JSON object." }, e instanceof TooLarge ? 413 : 400);
  }
  switch (path) {
    case "/api/library/url":
      return send(req, res, await api.addUrl(body.url, who));
    case "/api/library/edit":
      return send(req, res, api.editFile(body.sha, body.title, who));
    case "/api/library/archive":
      return send(req, res, api.archive(body.sha, body.on, who));
    case "/api/library/link":
      return send(req, res, api.link(body, who));
    case "/api/library/link/edit":
      return send(req, res, api.editLink(body, who));
    case "/api/library/unlink":
      return send(req, res, api.unlink(body.id, who));
    default:
      return sendJson(res, { error: "not found" }, 404);
  }
}

/** pdf.js's own package, beside the server: what some PDFs need besides themselves. */
let pdfjsDir: string | null = null;
const ASSET_TYPES: Record<string, string> = { bcmap: "application/octet-stream", pfb: "application/octet-stream", ttf: "font/ttf", otf: "font/otf", wasm: "application/wasm", js: "text/javascript; charset=utf-8", icc: "application/vnd.iccprofile" };

/** What pdf.js asks the server for while it reads a PDF in the reference window
 *  (web/src/paperview.ts): the standard fonts a PDF names without embedding, the character maps of
 *  CJK fonts, the decoders of JBIG2 and JPEG 2000 images, a colour profile — from pdf.js's own
 *  package, by file name alone, never anything else of it (its script engine for PDFs' JavaScript
 *  is not served). Its legacy build, which the page bundles, reads them from the package's top, as
 *  the modern one does. */
export async function pdfjsAsset(res: ServerResponse, path: string): Promise<void> {
  const m = /^\/pdfjs\/(standard_fonts|cmaps|wasm|iccs)\/([A-Za-z0-9._-]+)$/.exec(path);
  const ext = m?.[2].split(".").pop() ?? "";
  if (!m || m[2].startsWith("quickjs") || !Object.hasOwn(ASSET_TYPES, ext)) return sendJson(res, { error: "not found" }, 404);
  pdfjsDir ??= dirname(dirname(dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs")))));
  let body: Buffer;
  try {
    body = await readFile(join(pdfjsDir, m[1], m[2]));
  } catch {
    return sendJson(res, { error: "not found" }, 404);
  }
  res.writeHead(200, { "content-type": ASSET_TYPES[ext], "content-length": String(body.length), "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" });
  res.end(body);
}
