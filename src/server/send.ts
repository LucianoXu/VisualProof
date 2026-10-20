// How the server sends what it answers (server/app.ts): JSON, the page's files, the graph's parts,
// the whole of a revision, texts and downloads; and a body refused as too large while it comes.
//
// Pages are often far from the server (CollabSpec, "Far pages"): every byte counts, and what a
// browser has it should not fetch again. The page's files and the graph are sent compressed, with
// a tag naming their content; a browser that has that content already is told so (304) and sends
// nothing more. Everything else in JSON is compressed when it is large.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";
import { gunzip, gunzipSync, gzip, gzipSync } from "node:zlib";
import type { ExportFile } from "./export.ts";
import { packEdges } from "../shared/edgecodec.ts";

const TYPES: Record<string, string> = {
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
};

/** The tag naming a content. */
function tagOf(body: Buffer | Uint8Array): string {
  return `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
}

/** Whether the request already has the content `etag` names. */
function fresh(req: IncomingMessage, etag: string): boolean {
  const have = req.headers["if-none-match"];
  return !!have && have.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

function acceptsGzip(req: IncomingMessage | undefined): boolean {
  return /\bgzip\b/.test(String(req?.headers["accept-encoding"] ?? ""));
}

/** the page's files as last read: compressed and tagged once per change on disk */
const files = new Map<string, { mtime: number; size: number; body: Buffer; gz: Buffer | null; etag: string }>();

export function sendFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  if (refused.has(res)) return;
  if (!existsSync(file)) return sendJson(res, { error: "not found" }, 404);
  const st = statSync(file);
  let f = files.get(file);
  if (!f || f.mtime !== st.mtimeMs || f.size !== st.size) {
    const body = readFileSync(file);
    f = { mtime: st.mtimeMs, size: st.size, body, gz: null, etag: tagOf(body) };
    files.set(file, f);
  }
  const head = { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache", etag: f.etag, vary: "accept-encoding" };
  if (fresh(req, f.etag)) {
    res.writeHead(304, head);
    return void res.end();
  }
  if (!acceptsGzip(req)) {
    res.writeHead(200, head);
    return void res.end(f.body);
  }
  f.gz ??= gzipSync(f.body, { level: 9 });
  res.writeHead(200, { ...head, "content-encoding": "gzip" });
  res.end(f.gz);
}

/** how long the rest of a body refused as too large is read before it is answered all the same,
 *  and the connection cut: long enough for a client to finish sending what it began, not for an
 *  endless body */
const TOO_LARGE_GRACE_MS = 2000;

export class TooLarge extends Error {}

/** A request's body, refused (TooLarge) once it passes `limit` bytes: what comes after is not kept. */
export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    let size = 0;
    if (Number(req.headers["content-length"]) > limit) return fail(new TooLarge());
    req.on("data", (b: Buffer) => {
      if (size > limit) return;
      size += b.length;
      if (size > limit) {
        parts.length = 0;
        fail(new TooLarge());
      } else parts.push(b);
    });
    req.on("end", () => ok(Buffer.concat(parts).toString("utf8")));
    req.on("error", fail);
  });
}

/** Responses refused as too large and not answered yet (tooLarge): what the handler that asked for
 *  the body answers meanwhile is not sent. */
export const refused = new WeakSet<ServerResponse>();

/** Answer 413 to a body too large and close the connection. The rest of the body is read and thrown
 *  away first, and the answer goes once it has all come: a connection closed while the client is
 *  still sending is reset on some systems (macOS), and the client never reads the answer. A client
 *  still sending after a short grace is answered all the same, and cut off. */
export function tooLarge(req: IncomingMessage, res: ServerResponse, body: object): void {
  refused.add(res);
  let done = false;
  const answer = () => {
    if (done) return;
    done = true;
    refused.delete(res);
    sendJson(res, body, 413, { connection: "close" });
  };
  req.on("data", () => {});
  req.on("end", answer);
  req.resume();
  if (req.readableEnded) answer();
  setTimeout(() => {
    answer();
    setTimeout(() => req.socket.destroy(), 500).unref();
  }, TOO_LARGE_GRACE_MS).unref();
}

/** Send a JSON answer, once: a handler that answers after something else already did (a body too
 *  large, answered as it was read) is not heard. */
export function sendJson(res: ServerResponse, body: unknown, code = 200, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.writableEnded || refused.has(res)) return;
  sendJsonText(res, JSON.stringify(body), code, headers);
}

/** The same, of an answer written as JSON already. */
function sendJsonText(res: ServerResponse, text: string, code = 200, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.writableEnded || refused.has(res)) return;
  // a small answer is not worth compressing; a status with its build log, a source file, are; a
  // large one is compressed off the server's thread, which meanwhile answers others
  if (text.length > JSON_GZIP_FROM && acceptsGzip(res.req)) {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", "content-encoding": "gzip", vary: "accept-encoding", ...headers });
    if (text.length < JSON_GZIP_AWAY_FROM) return void res.end(gzipSync(text));
    return void gzip(text, (e, gz) => (e ? res.destroy(e) : res.end(gz)));
  }
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(text);
}

/** what is sent whole under the tag of its revision, compressed, per what it is of (the review, the
 *  build status) */
const revisionGz = new WeakMap<object, { tag: string; gz: Promise<Buffer> }>();

/** A whole sent under the tag of its revision: the review (GET /api/review), tagged with its run and
 *  its revision (server/review.ts), and the build status (GET /api/build, server/live.ts). A page that
 *  has it is answered 304, which a reload is, and one that fell behind is sent it compressed — once a
 *  revision, off the server's thread when it is large, the same bytes for every page (a review of
 *  5,000 opinions on Sphere-Packing-Lean: 8.5 MB of JSON, 1.1 MB sent; the build status of
 *  NavierStokesAndEuler's 2,657 files: 362 KB, 42 KB sent). `of` is what it is of; `whole` writes it,
 *  asked only where it is sent. */
export function sendRevision(req: IncomingMessage, res: ServerResponse, of: object, tag: string, whole: () => string): void {
  if (res.headersSent || res.writableEnded || refused.has(res)) return;
  const head = { "content-type": "application/json", "cache-control": "private, no-cache", etag: tag, vary: "accept-encoding" };
  if (fresh(req, tag)) {
    res.writeHead(304, head);
    return void res.end();
  }
  const text = whole();
  if (text.length <= JSON_GZIP_FROM || !acceptsGzip(req)) {
    res.writeHead(200, head);
    return void res.end(text);
  }
  let c = revisionGz.get(of);
  if (c?.tag !== tag) {
    const gz = text.length < JSON_GZIP_AWAY_FROM ? Promise.resolve(gzipSync(text)) : new Promise<Buffer>((ok, fail) => gzip(text, (e, b) => (e ? fail(e) : ok(b))));
    revisionGz.set(of, (c = { tag, gz }));
    // a compression that failed is tried again by the next page that asks
    gz.catch(() => revisionGz.get(of)?.gz === gz && revisionGz.delete(of));
  }
  c.gz.then(
    (gz) => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(200, { ...head, "content-encoding": "gzip" });
      res.end(gz);
    },
    (e: Error) => res.destroy(e),
  );
}

/** Send a text that is not JSON (the agents' documentation, the MCP server's file), compressed
 *  where the client takes it. */
export function sendText(req: IncomingMessage, res: ServerResponse, text: string, type: string, code = 200): void {
  if (res.headersSent || res.writableEnded || refused.has(res)) return;
  const head = { "content-type": type, "cache-control": "no-store", vary: "accept-encoding" };
  if (text.length > JSON_GZIP_FROM && acceptsGzip(req)) {
    res.writeHead(code, { ...head, "content-encoding": "gzip" });
    return void res.end(gzipSync(text));
  }
  res.writeHead(code, head);
  res.end(text);
}

/** Send a file to download (a typeset document): as it is, never cached, named for the disk. */
export function sendDownload(res: ServerResponse, f: ExportFile): void {
  if (res.headersSent || res.writableEnded || refused.has(res)) return;
  res.writeHead(200, { "content-type": f.type, "content-length": String(f.body.length), "content-disposition": `attachment; filename="${f.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "cache-control": "no-store" });
  res.end(f.body);
}

/** The Host a request was sent to, when it looks like one. */
export function hostOf(req: IncomingMessage): string {
  return /^[A-Za-z0-9.:[\]-]{1,300}$/.test(req.headers.host ?? "") ? req.headers.host! : "127.0.0.1";
}

/** The server's address as the request's browser reached it: its Origin where it names the host
 *  the request was sent to (a page's POST carries it, with the scheme), else http:// and the Host. */
export function reachedAt(req: IncomingMessage): string {
  const host = hostOf(req);
  try {
    const o = new URL(String(req.headers.origin ?? ""));
    if (o.host === host && (o.protocol === "http:" || o.protocol === "https:")) return o.origin;
  } catch {
    // no Origin, or not an address: the Host
  }
  return `http://${host}`;
}

/** characters from which a JSON answer is sent compressed */
const JSON_GZIP_FROM = 2048;
/** characters from which a JSON answer is compressed off the server's thread: a snapshot's whole
 *  graph on NavierStokesAndEuler (GET /api/agent/history/graph, 105 MB of JSON) was 2 to 3 s of
 *  compressing, every page and agent waiting meanwhile */
export const JSON_GZIP_AWAY_FROM = 1 << 20;

/** the graph's parts as sent, each tagged once (a graph's buffers live as long as it does) */
const gzTags = new WeakMap<Buffer, string>();

/** A part of the graph, gzipped already: tagged, so that a page that has it gets 304; a client that
 *  does not take gzip (an agent's) is sent it as it is, made so off the server's thread. */
export function sendGz(req: IncomingMessage, res: ServerResponse, gz: Buffer, type: string): void {
  if (refused.has(res)) return;
  let etag = gzTags.get(gz);
  if (!etag) gzTags.set(gz, (etag = tagOf(gz)));
  const head = { "content-type": type, "cache-control": "private, no-cache", etag, vary: "accept-encoding" };
  if (fresh(req, etag)) {
    res.writeHead(304, head);
    return void res.end();
  }
  if (!acceptsGzip(req))
    return void gunzip(gz, (e, plain) => {
      if (e) return res.destroy(e);
      res.writeHead(200, head);
      res.end(plain);
    });
  res.writeHead(200, { ...head, "content-encoding": "gzip" });
  res.end(gz);
}

/** the edges packed for pages (shared/edgecodec.ts), once per graph and format */
const packedEdges = new WeakMap<Buffer, Map<number, Buffer>>();

export function packedGz(edgesGz: Buffer, format: 1 | 2): Buffer {
  let byFormat = packedEdges.get(edgesGz);
  if (!byFormat) packedEdges.set(edgesGz, (byFormat = new Map()));
  let p = byFormat.get(format);
  if (!p) {
    const raw = gunzipSync(edgesGz);
    const edges = new Int32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    let n = 0;
    for (let k = 0; k < edges.length; k += 3) n = Math.max(n, edges[k] + 1, edges[k + 1] + 1);
    p = gzipSync(packEdges(edges, n, format), { level: 9 });
    byFormat.set(format, p);
  }
  return p;
}
