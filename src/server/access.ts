// Who may reach the server at all (the owner's decision, 2026-10-07): with `--access-key-file`,
// only those who were given its link. The link, `/k/<key>`, leaves a cookie in the browser and
// sends it on to the page, so that the key does not stay in the address (the history, a
// screenshot, a link copied from the bar). Every other request — the page, its data, the event
// stream, the agents' API — needs that cookie, or the key itself as `Authorization: Bearer <key>`
// (an agent), and is answered 404 without it, as if there were nothing here.
//
// One key for everyone: who has the link is in, and taking someone out means a new key for all.
// Over plain HTTP the key and the cookie cross the network in the clear: this keeps out who has
// not been given the link, not who can watch the traffic.
//
// Cookies are not kept per port: every server on one host shares a browser's cookie jar. So the
// cookie is named per instance, by a digest of its key, and two servers on one host do not put
// each other's readers out; its value is made from the key too, never the key itself.
//
// Without a key, whoever reaches the port is in — and a web page any browser on this machine opens
// can reach it too, by DNS rebinding: its name made to resolve to this machine, the page's scripts
// then ask this server as their own origin, and read the answers. So a server without a key answers
// only the names it is reached at (CollabSpec decision 12, the owner's decision of 2026-10-18):
// hostAllowed, below.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { isIPv4, isIPv6 } from "node:net";

/** where the link points: `/k/<key>` */
export const KEY_PATH = "/k/";
/** what every cookie's name starts with; before 2026-10-08 it was the whole name, for every server,
 *  and such a cookie is still taken (`renewal` gives the browser the one of its own name) */
const COOKIE = "visualproof_access";
/** how long a browser stays let in: the longest browsers keep a cookie (400 days) */
const MAX_AGE = 400 * 24 * 3600;
const KEY = /^[A-Za-z0-9_-]{32,256}$/;

/** A new key: 32 random bytes, 43 characters of base64url. */
export function newKey(): string {
  return randomBytes(32).toString("base64url");
}

/** The key `file` holds; one is made there, readable by its owner alone, when there is none. */
export function loadKey(file: string): { key: string; made: boolean } {
  if (!existsSync(file)) {
    const key = newKey();
    writeFileSync(file, key + "\n", { mode: 0o600, flag: "wx" });
    return { key, made: true };
  }
  const key = readFileSync(file, "utf8").trim();
  if (!KEY.test(key)) throw new Error(`${file} does not hold a key: 32 to 256 characters of A–Z, a–z, 0–9, - and _`);
  return { key, made: false };
}

/** What a request may do: come in, be shown nothing, or — the link — enter, with the cookie
 *  (a `Set-Cookie` value) that lets this browser in from now on. */
export type Admission = "in" | "out" | { enter: string };

const digest = (s: string) => createHash("sha256").update(s).digest();

export class Access {
  /** the link's path, for a page to share (web/src/share.ts): only a page let in is told it */
  readonly link: string;
  /** the cookie's name, this instance's own: `visualproof_access_` and a digest of the key */
  readonly name: string;
  private key: Buffer;
  /** the cookie's value: made from the key, so that the key itself is in no cookie jar (cookies
   *  are not kept per port, and other services answer on this host's name) */
  private cookie: string;

  constructor(key: string) {
    this.link = KEY_PATH + key;
    this.key = digest(key);
    this.name = `${COOKIE}_${createHash("sha256").update(`visualproof cookie name\0${key}`).digest("hex").slice(0, 12)}`;
    this.cookie = createHash("sha256").update(`visualproof access\0${key}`).digest("base64url");
  }

  private setCookie(): string {
    return `${this.name}=${this.cookie}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax`;
  }

  admit(req: IncomingMessage, path: string): Admission {
    if (path.startsWith(KEY_PATH)) return same(path.slice(KEY_PATH.length), this.key) ? { enter: this.setCookie() } : "out";
    const auth = req.headers.authorization;
    if (auth && /^Bearer\s/i.test(auth) && same(auth.replace(/^Bearer\s+/i, "").trim(), this.key)) return "in";
    for (const name of [this.name, COOKIE]) {
      const given = cookieOf(req, name);
      if (given !== null && same(given, digest(this.cookie))) return "in";
    }
    return "out";
  }

  /** The cookie of this instance's own name, for a browser let in by the one name every server
   *  used to share; null when it has its own already (or came in otherwise). */
  renewal(req: IncomingMessage): string | null {
    const own = cookieOf(req, this.name);
    if (own !== null && same(own, digest(this.cookie))) return null;
    const old = cookieOf(req, COOKIE);
    return old !== null && same(old, digest(this.cookie)) ? this.setCookie() : null;
  }
}

/** Whether `given` is what `want` is the digest of, compared in constant time. */
function same(given: string, want: Buffer): boolean {
  return timingSafeEqual(digest(given), want);
}

/** A cookie's value as the request carries it, or null. */
function cookieOf(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** A name as Host headers and the options give it, compared: lowercase, without the dot of a name
 *  written fully qualified (`example.org.`). */
const hostKey = (name: string) => name.toLowerCase().replace(/\.$/, "");

/** Whether a server without an access key answers a request for `host`, its Host header
 *  (CollabSpec decision 12, the owner's decision of 2026-10-18): an IP address (IPv6 in brackets),
 *  which a page's scripts reach only as that address, never as a name they made resolve to it;
 *  `localhost` and the names under it, which browsers resolve to this machine themselves; and the
 *  names in `names` — `--public-url`'s host and every `--allowed-host`. Any port; any case. A
 *  request without a Host is not answered, nor is a Host that is no name. */
export function hostAllowed(host: string | undefined, names: readonly string[]): boolean {
  const m = /^(?:\[([0-9A-Fa-f:.]+)\]|([A-Za-z0-9._-]+))(?::\d{1,5})?$/.exec(host ?? "");
  if (!m) return false;
  if (m[1] !== undefined) return isIPv6(m[1]);
  const name = hostKey(m[2]);
  if (!name) return false;
  if (isIPv4(name) || name === "localhost" || name.endsWith(".localhost")) return true;
  return names.some((n) => hostKey(n) === name);
}

/** The name `--public-url` gives, as hostAllowed compares it (its port is not part of it). */
export function urlHost(url: string): string {
  const h = new URL(url).hostname;
  return h.startsWith("[") ? h.slice(1, -1) : h;
}
