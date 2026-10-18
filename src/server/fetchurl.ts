// A file of the library fetched by URL (AttachmentSpec decision 1, "Implementation notes"): the
// server fetches it once and keeps it. Whoever can write a note can make the server fetch an
// address, so it must not become a way into the server's own network: only http and https, never
// an address that is loopback, private, link-local, reserved or the server's own — checked on the
// addresses the name resolves to, every one of them, and the connection made to the address
// checked, so that a name answering differently the second time (DNS rebinding) reaches nothing
// else; the same again at every redirect. At most MAX_FILE bytes, within a time limit. An arXiv
// abstract's address gives its PDF; a paper on arXiv, by its abstract's address or its PDF's, is
// titled as its abstract page says, a page fetched with the same guard (`fetchPage`, `arxivTitle`).

import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { MAX_FILE, sizeWords } from "../shared/library.ts";

export interface FetchOptions {
  maxBytes?: number;
  /** the longest the whole fetch may take, redirects included, in ms */
  timeoutMs?: number;
  maxRedirects?: number;
  /** whether an address may be connected to; by default, none that `blockedAddress` refuses.
   *  Tests that fetch from a server of their own on the loopback say so here. */
  allowed?: (address: string) => boolean;
  /** where arXiv is: an arXiv address's PDF and its abstract page are fetched from here, by default
   *  ARXIV. Tests serve both from a server of their own. */
  arxivOrigin?: string;
}

export type Fetched = { ok: true; bytes: Buffer; url: string; name: string | null } | { ok: false; status: number; error: string };
export type FetchedPage = { ok: true; text: string; url: string } | { ok: false; status: number; error: string };

const DEFAULTS = { maxBytes: MAX_FILE, timeoutMs: 60_000, maxRedirects: 5 };
/** the most of a page that is read, and the longest it may take: an HTML page is far smaller than a
 *  file, and what it says of one is not worth a long wait */
export const MAX_PAGE = 2 * 1024 * 1024;
const PAGE_MS = 15_000;
export const ARXIV = "https://arxiv.org";

/** The identifier of the paper an arXiv address is of: its abstract's (`/abs/2401.01234v2`) or its
 *  PDF's (`/pdf/2401.01234v2`, `.pdf` or not), at arxiv.org, www. or export. too; null for any other
 *  address. */
export function arxivId(url: string): string | null {
  return /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?\/?(?:[?#].*)?$/i.exec(url.trim())?.[1] ?? null;
}

/** An arXiv address as its PDF's at `origin` (`/abs/2401.01234v2` → `/pdf/2401.01234v2`); any other
 *  address as it is. */
export function arxivPdf(url: string, origin = ARXIV): string {
  const id = arxivId(url);
  return id ? `${origin.replace(/\/+$/, "")}/pdf/${id}` : url.trim();
}

/** The parts of an IPv6 address, eight 16-bit numbers; null when it is not one. */
function ipv6Parts(a: string): number[] | null {
  let s = a.toLowerCase().replace(/%.*$/, "");
  // an IPv4 address at its end stands for its last two parts
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const b = v4[1].split(".").map(Number);
    if (b.some((x) => x > 255)) return null;
    s = s.slice(0, -v4[1].length) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const parts = [...head, ...Array(fill).fill("0"), ...tail].map((x) => parseInt(x, 16));
  return parts.length === 8 && parts.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? parts : null;
}

/** Whether an IPv4 address (four bytes) is one the server never fetches from. */
function blockedV4(b: number[]): boolean {
  const [a, c] = b;
  return (
    a === 0 || // this network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && c >= 64 && c <= 127) || // carrier-grade NAT
    (a === 169 && c === 254) || // link-local
    (a === 172 && c >= 16 && c <= 31) || // private
    (a === 192 && c === 168) || // private
    (a === 192 && c === 0 && b[2] === 0) || // IETF protocol assignments
    (a === 192 && c === 0 && b[2] === 2) || // documentation (TEST-NET-1)
    (a === 192 && c === 88 && b[2] === 99) || // 6to4 relays, deprecated
    (a === 198 && (c === 18 || c === 19)) || // benchmarking
    (a === 198 && c === 51 && b[2] === 100) || // documentation (TEST-NET-2)
    (a === 203 && c === 0 && b[2] === 113) || // documentation (TEST-NET-3)
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Whether the server refuses to fetch from an address: loopback, private, link-local, unique-local,
 *  multicast, reserved, documentation or unspecified, an IPv4 one written as IPv6 (mapped, NAT64,
 *  6to4) included. Anything that is not an address at all is refused too. */
export function blockedAddress(address: string): boolean {
  const kind = isIP(address.replace(/%.*$/, ""));
  if (kind === 4) return blockedV4(address.split(".").map(Number));
  if (kind !== 6) return true;
  const p = ipv6Parts(address);
  if (!p) return true;
  const v4 = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  if (p.every((x) => x === 0)) return true; // unspecified
  if (p.slice(0, 7).every((x) => x === 0) && p[7] === 1) return true; // loopback
  if (p.slice(0, 5).every((x) => x === 0) && p[5] === 0xffff) return blockedV4(v4(p[6], p[7])); // IPv4-mapped
  if (p.slice(0, 6).every((x) => x === 0)) return true; // IPv4-compatible, deprecated
  if (p[0] === 0x64 && p[1] === 0xff9b && p.slice(2, 6).every((x) => x === 0)) return blockedV4(v4(p[6], p[7])); // NAT64
  if (p[0] === 0x2002) return blockedV4(v4(p[1], p[2])); // 6to4: the IPv4 address it carries
  if ((p[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((p[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((p[0] & 0xffc0) === 0xfec0) return true; // site-local, deprecated
  if ((p[0] & 0xff00) === 0xff00) return true; // multicast
  if (p[0] === 0x2001 && p[1] === 0x0db8) return true; // documentation
  return false;
}

/** The addresses of the server's own interfaces, whatever range they are in. */
function ownAddresses(): Set<string> {
  const out = new Set<string>();
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) out.add(i.address.replace(/%.*$/, "").toLowerCase());
  return out;
}

/** Whether the server may connect to an address by default: not refused, and none of its own. */
export function defaultAllowed(address: string): boolean {
  return !blockedAddress(address) && !ownAddresses().has(address.toLowerCase());
}

/** What is fetched — a file of the library, or a page read for what it says of one: what the request
 *  asks for, and what the errors call it. */
const KINDS = {
  file: { accept: "application/pdf, image/png, image/jpeg, image/webp, image/gif;q=0.9, */*;q=0.1", noun: "file", most: "a file of the library" },
  page: { accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.1", noun: "page", most: "a page the server reads" },
} as const;

type Got = { ok: true; bytes: Buffer; url: URL; disposition: string | undefined } | { ok: false; status: number; error: string };

/** Fetch an address for the library: its bytes, the address they came from in the end, and the name
 *  its answer gives the file (Content-Disposition), else its path's last part. Refused, with why,
 *  where the address is not http or https, resolves to an address the server does not fetch from
 *  (at any redirect), answers other than 200, sends more than the most a file may be, or takes too
 *  long. An arXiv address is fetched as its PDF at `opts.arxivOrigin`. */
export async function fetchUrl(raw: string, opts: FetchOptions = {}): Promise<Fetched> {
  const got = await guardedFetch(arxivPdf(raw, opts.arxivOrigin), "file", { ...DEFAULTS, ...opts }, opts.allowed ?? defaultAllowed);
  if (!got.ok) return got;
  return { ok: true, bytes: got.bytes, url: got.url.toString(), name: nameOf(got.disposition, got.url) };
}

/** Fetch a page's text, read as UTF-8 (as arXiv's are), with the same guard as a file: at most
 *  MAX_PAGE bytes within PAGE_MS, or less where the options say less. */
export async function fetchPage(raw: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const limits = { maxBytes: Math.min(opts.maxBytes ?? MAX_PAGE, MAX_PAGE), timeoutMs: Math.min(opts.timeoutMs ?? PAGE_MS, PAGE_MS), maxRedirects: opts.maxRedirects ?? DEFAULTS.maxRedirects };
  const got = await guardedFetch(raw.trim(), "page", limits, opts.allowed ?? defaultAllowed);
  if (!got.ok) return got;
  return { ok: true, text: got.bytes.toString("utf8"), url: got.url.toString() };
}

/** The title arXiv gives a paper (by its identifier, `arxivId`): its abstract page's `citation_title`,
 *  the page fetched from `opts.arxivOrigin`. Null where the page cannot be fetched or has none; it
 *  never throws, since a paper without it is still added. */
export async function arxivTitle(id: string, opts: FetchOptions = {}): Promise<string | null> {
  try {
    const page = await fetchPage(`${(opts.arxivOrigin ?? ARXIV).replace(/\/+$/, "")}/abs/${id}`, opts);
    return page.ok ? citationTitle(page.text) : null;
  } catch {
    return null;
  }
}

/** A page's `<meta name="citation_title" content="…">`, as arXiv's abstract pages carry it (and most
 *  publishers', for the indexers): its content with HTML's character references decoded and its
 *  whitespace made single. Null where there is none, or it is empty. */
export function citationTitle(html: string): string | null {
  // a tag's quoted values may hold a ">" of their own
  for (const [tag] of html.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of tag.matchAll(/([^\s=<>"'\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) attrs.set(a[1].toLowerCase(), a[2] ?? a[3] ?? a[4]);
    if (attrs.get("name")?.trim().toLowerCase() !== "citation_title") continue;
    const t = decodeHtml(attrs.get("content") ?? "").replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
    if (t) return t;
  }
  return null;
}

const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTML's character references decoded: by number, and the few names a template escapes with; any
 *  other name left as it is, and a number that is no character read as U+FFFD. */
function decodeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] !== "#") return HTML_ENTITIES[e.toLowerCase()] ?? all;
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd";
  });
}

/** The fetch both kinds share: every address checked, the connection pinned to the address checked,
 *  redirects followed by hand, within the bytes and the time given. The bytes and where they came
 *  from in the end, or why not. */
async function guardedFetch(raw: string, kind: keyof typeof KINDS, o: { maxBytes: number; timeoutMs: number; maxRedirects: number }, allowed: (address: string) => boolean): Promise<Got> {
  const { accept, noun, most } = KINDS[kind];
  const deadline = Date.now() + o.timeoutMs;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, status: 400, error: "That is not an address: give one that starts with http:// or https://." };
  }
  for (let hops = 0; ; hops++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, status: 400, error: `Only http and https addresses are fetched, not ${url.protocol.replace(/:$/, "")}.` };
    if (url.username || url.password) return { ok: false, status: 400, error: "An address with a name and password in it is not fetched." };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: { address: string; family: number }[];
    try {
      addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
    } catch {
      return { ok: false, status: 400, error: `${host} cannot be found.` };
    }
    if (!addresses.length) return { ok: false, status: 400, error: `${host} cannot be found.` };
    const refused = addresses.find((a) => !allowed(a.address));
    if (refused) return { ok: false, status: 403, error: `${host === refused.address ? host : `${host} is ${refused.address}, which`} is an address of a private or local network or of this server: the server does not fetch from there.` };
    const left = deadline - Date.now();
    if (left <= 0) return { ok: false, status: 504, error: "The address took too long to answer." };
    const pinned = addresses[0];
    let res: IncomingMessage;
    try {
      res = await connect(url, pinned, left, accept);
    } catch (e) {
      return { ok: false, status: 502, error: `The address could not be fetched: ${e instanceof Error ? e.message : String(e)}.` };
    }
    const status = res.statusCode ?? 0;
    // what is not the file is never read: a redirect's or an error's body, drained, could run on
    // past the bytes and the time a fetch may take, the fetch answered long since
    if (status !== 200) res.destroy();
    if ([301, 302, 303, 307, 308].includes(status)) {
      const to = res.headers.location;
      if (!to) return { ok: false, status: 502, error: `The address answered ${status} without saying where to.` };
      if (hops >= o.maxRedirects) return { ok: false, status: 502, error: `The address redirected more than ${o.maxRedirects} times.` };
      try {
        url = new URL(to, url);
      } catch {
        return { ok: false, status: 502, error: "The address redirected to something that is not an address." };
      }
      continue;
    }
    if (status !== 200) return { ok: false, status: 502, error: `The address answered ${status}, not the ${noun}.` };
    const length = Number(res.headers["content-length"] ?? NaN);
    if (Number.isFinite(length) && length > o.maxBytes) {
      res.destroy();
      return { ok: false, status: 413, error: `The ${noun} is ${sizeWords(length)}: ${most} is at most ${sizeWords(o.maxBytes)}.` };
    }
    const body = await readCapped(res, o.maxBytes, deadline);
    if (typeof body === "string") return { ok: false, status: body === "large" ? 413 : 504, error: body === "large" ? `The ${noun} is larger than ${sizeWords(o.maxBytes)}, the most ${most} may be.` : `The address took too long to send the ${noun}.` };
    const disposition = res.headers["content-disposition"];
    return { ok: true, bytes: body, url, disposition };
  }
}

/** A request to `url`, connected to the address checked for it and to no other; its answer's head,
 *  within `ms` in all. */
function connect(url: URL, at: { address: string; family: number }, ms: number, accept: string): Promise<IncomingMessage> {
  return new Promise((ok, no) => {
    const make = url.protocol === "https:" ? httpsRequest : httpRequest;
    // the socket's `timeout` is idleness alone: a head sent a byte at a time is never idle, and
    // would hold the fetch past its time for as long as its sender likes
    const late = setTimeout(() => req.destroy(new Error("no answer in time")), ms);
    const req = make(
      url,
      {
        method: "GET",
        headers: { "user-agent": "VisualProof (adds a file to a project's library)", accept },
        // the connection goes to the address checked, whatever the name resolves to now; the
        // name stays the request's for TLS and the Host header
        lookup: ((_host: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) => {
          if (options?.all) cb(null, [{ address: at.address, family: at.family }]);
          else cb(null, at.address, at.family);
        }) as never,
        timeout: ms,
      },
      (res) => {
        clearTimeout(late);
        ok(res);
      },
    );
    req.on("timeout", () => req.destroy(new Error("no answer in time")));
    req.on("error", (e) => {
      clearTimeout(late);
      no(e);
    });
    req.end();
  });
}

/** An answer's body, at most `max` bytes, before `deadline`: the bytes, or why not. */
function readCapped(res: IncomingMessage, max: number, deadline: number): Promise<Buffer | "large" | "slow"> {
  return new Promise((ok) => {
    const parts: Buffer[] = [];
    let n = 0;
    const timer = setTimeout(() => {
      res.destroy();
      ok("slow");
    }, Math.max(0, deadline - Date.now()));
    res.on("data", (b: Buffer) => {
      n += b.length;
      if (n > max) {
        clearTimeout(timer);
        res.destroy();
        return ok("large");
      }
      parts.push(b);
    });
    res.on("end", () => {
      clearTimeout(timer);
      ok(Buffer.concat(parts));
    });
    res.on("error", () => {
      clearTimeout(timer);
      ok("slow");
    });
  });
}

/** The name an answer gives its file, else the address's last part, else its host. */
function nameOf(disposition: string | undefined, url: URL): string | null {
  const star = disposition ? /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition)?.[1] : undefined;
  const plain = disposition ? /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)?.[1] : undefined;
  let name = star ?? plain ?? url.pathname.split("/").filter(Boolean).pop() ?? url.hostname;
  try {
    name = decodeURIComponent(name);
  } catch {
    // as it is
  }
  name = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name ? name.slice(0, 300) : null;
}
