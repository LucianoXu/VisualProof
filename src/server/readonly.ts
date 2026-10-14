// Read-only links (CollabSpec decision 11, the owner's decision of 2026-10-13): whoever is let in
// may make one from Share, for anyone they want to show the project to. It lets its holder see
// what a guest sees and change nothing that is shared; nobody sees them (not listed, not counted).
// A read-only reader's own Share gives the link they came by, so that revoking one link cuts off
// everyone it reached.
//
// A link is `/r/vpr_<id>_<secret>`, made as a personal link is (server/invites.ts): the id names it
// in Share's list, the secret is 32 random bytes. Opened, it leaves a cookie and goes on to the
// page; the cookie's value is the id and a digest of the token, never the token (cookies are not
// kept per port, and other services answer on this host's name). Unlike a personal link's, the
// token is kept: a read-only link is made to be passed on, so whoever holds it, and whoever is let
// in, may see it again, which gives none of them more than they have. It is kept in
// `<site>/readonly-links.json`, readable by the server's user alone. A link lasts until it is
// revoked, which cuts its pages off at once; revoked links stay, saying who revoked them.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadOnlyLink } from "../shared/collab.ts";
import { cookieOf } from "./invites.ts";

export const READONLY_PREFIX = "vpr_";
/** where a read-only link points: `/r/<token>` */
export const READONLY_PATH = "/r/";
const FILE = "readonly-links.json";
const COOKIE = "visualproof_readonly";
const MAX_AGE = 400 * 24 * 3600;
const FLUSH_MS = 60_000;
const ID = /^[0-9a-f]{10}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

interface Record_ extends Omit<ReadOnlyLink, "path"> {
  token: string;
}

/** What a request's read-only link or cookie is: one in force, one revoked, or none of ours. */
export type ReadOnlyCheck = { ok: ReadOnlyLink } | { ended: "revoked"; link: ReadOnlyLink } | null;

const sha = (s: string) => createHash("sha256").update(s).digest();
const cookieValue = (r: Record_) => `${r.id}.${sha(`visualproof read-only cookie\0${r.token}`).toString("base64url")}`;
const same = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));
const info = (r: Record_): ReadOnlyLink => ({ id: r.id, path: `${READONLY_PATH}${r.token}`, by: r.by, created: r.created, revoked: r.revoked, revokedBy: r.revokedBy, lastUsed: r.lastUsed });

export class ReadOnlyLinks {
  private file: string | null;
  private records: Record_[] = [];
  readonly cookieName: string;
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** told when a link is revoked: its pages' event streams end (server/live.ts) */
  onEnded: (l: ReadOnlyLink) => void = () => {};

  /** `siteDir` null keeps the links in memory only (tests). */
  constructor(siteDir: string | null) {
    this.file = siteDir ? join(siteDir, FILE) : null;
    let own: string | null = null;
    if (this.file && existsSync(this.file)) {
      try {
        const data = JSON.parse(readFileSync(this.file, "utf8")) as { cookie?: unknown; links?: unknown };
        if (typeof data.cookie === "string" && /^[0-9a-f]{12}$/.test(data.cookie)) own = data.cookie;
        if (Array.isArray(data.links)) this.records = data.links.filter(isRecord);
      } catch {
        // a file that cannot be read lets nobody in by a read-only link; it is kept aside
        renameSync(this.file, `${this.file}.broken-${Date.now()}`);
      }
    }
    this.cookieName = `${COOKIE}_${own ?? randomBytes(6).toString("hex")}`;
    if (this.file) {
      this.timer = setInterval(() => this.flush(), FLUSH_MS);
      this.timer.unref?.();
    }
  }

  /** Make a link, by `by` (null: someone who gave no name). */
  create(by: string | null, now = Date.now()): ReadOnlyLink {
    let id: string;
    do id = randomBytes(5).toString("hex");
    while (this.records.some((r) => r.id === id));
    const r: Record_ = { id, token: `${READONLY_PREFIX}${id}_${randomBytes(32).toString("base64url")}`, by, created: new Date(now).toISOString(), revoked: null, revokedBy: null, lastUsed: null };
    this.records.push(r);
    this.save();
    return info(r);
  }

  /** What a link's token is, compared in constant time whether or not its id is known. */
  check(token: string, now = Date.now()): ReadOnlyCheck {
    if (!token.startsWith(READONLY_PREFIX)) return null;
    const id = token.slice(READONLY_PREFIX.length, READONLY_PREFIX.length + 10);
    const r = ID.test(id) && token[READONLY_PREFIX.length + 10] === "_" && SECRET.test(token.slice(READONLY_PREFIX.length + 11)) ? this.records.find((x) => x.id === id) : undefined;
    const ok = same(token, r?.token ?? "no such link");
    return r && ok ? this.seen(r, now) : null;
  }

  /** What a request's cookie says: a link in force, one revoked (to be forgotten), or none. */
  ofCookie(header: string | undefined, now = Date.now()): ReadOnlyCheck {
    const given = cookieOf(header, this.cookieName);
    if (given === null) return null;
    const r = given.indexOf(".") === 10 ? this.records.find((x) => x.id === given.slice(0, 10)) : undefined;
    const ok = same(given, r ? cookieValue(r) : "no such link");
    return r && ok ? this.seen(r, now) : null;
  }

  private seen(r: Record_, now: number): ReadOnlyCheck {
    if (r.revoked) return { ended: "revoked", link: info(r) };
    r.lastUsed = new Date(now).toISOString();
    this.dirty = true;
    return { ok: info(r) };
  }

  /** The cookie that lets a browser in by link `id`, read-only (a `Set-Cookie` value). */
  cookie(id: string): string {
    const r = this.records.find((x) => x.id === id);
    if (!r) throw new Error(`no read-only link ${id}`);
    return `${this.cookieName}=${cookieValue(r)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax`;
  }

  /** What makes a browser forget a revoked link's cookie. */
  forget(): string {
    return `${this.cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  }

  /** Every link, those in force first, newest first within each. */
  list(): ReadOnlyLink[] {
    const order = (r: Record_) => (r.revoked ? 1 : 0);
    return [...this.records].sort((a, b) => order(a) - order(b) || b.created.localeCompare(a.created)).map(info);
  }

  get(id: string): ReadOnlyLink | undefined {
    const r = this.records.find((x) => x.id === id);
    return r ? info(r) : undefined;
  }

  /** Revoke a link in force: it lets nobody in from now on, and its pages' streams end. */
  revoke(id: string, by: string, now = Date.now()): boolean {
    const r = this.records.find((x) => x.id === id);
    if (!r || r.revoked) return false;
    r.revoked = new Date(now).toISOString();
    r.revokedBy = by;
    this.save();
    this.onEnded(info(r));
    return true;
  }

  flush(): void {
    if (this.dirty) this.save();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  private save(): void {
    this.dirty = false;
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ cookie: this.cookieName.slice(COOKIE.length + 1), links: this.records }, null, 1) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

function isRecord(x: unknown): x is Record_ {
  const r = x as Record_;
  return !!r && typeof r === "object" && ID.test(r.id) && typeof r.token === "string" && r.token.startsWith(`${READONLY_PREFIX}${r.id}_`) && typeof r.created === "string";
}
