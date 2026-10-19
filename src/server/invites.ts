// Personal links (CollabSpec decision 9, the owner's decision of 2026-10-09): someone on the server
// invites a person by name from Share, and the server makes a link for that person alone. The link
// lets its holder in, as the key's link does (server/access.ts), and says who they are: the
// holder's identity is the link's id, and the name is only what they are called — they rename
// themselves from the menu under it, and what they did stays theirs, shown under the new name.
// Their review goes to one log named by the id (shared/review.ts, logFileName), so a rename never
// starts a new file. Nobody else can take the name they go by while their link is in force.
//
// A link is `/i/vpp_<id>_<secret>`, the token made as an agent's is (server/tokens.ts): the prefix
// makes one recognisable wherever it is pasted, the id names it in lists and in the review's logs
// (it is no secret), the secret is 32 random bytes. Opened, it leaves a cookie in the browser and
// goes on to the page, so that the token leaves the address; the cookie's value is made from the
// token, never the token itself (cookies are not kept per port, and other services answer on this
// host's name), and its name is this server's own, so two servers on one host keep theirs apart.
//
// A link lasts until it is revoked. An agent's token lasts days, since it hands a program a
// credential for a piece of work; a person's link is who they are in the review, and its id names
// their log: if it ran out, the same person would come back with a new link as someone else, with a
// log of their own. The key's link never runs out either, and a personal link reaches no further.
// Share lists every link in force with when it was last used, so that one nobody uses any more is
// seen and revoked, which cuts it off at once — its pages' event streams too.
//
// The token is shown once to whoever made it, for them to send, and again to its holder alone (the
// owner's decision of 2026-10-19): someone who wants to open the site as themselves in another
// browser, on another device, finds it in the menu under their name. So the server keeps it in
// full, in `<site>/person-invites.json` (readable by its owner alone, as the access key, the agents'
// tokens and the read-only links are), beside its digest — what a link opened is compared with, what
// its cookie is made from, and all that a server before 0.6.0 kept: such a link cannot be shown, and
// its holder is offered to make it anew. Shown to anyone else, it would let them be that person.
//
// Made anew, a link keeps its id — the same person, log and names — under a new secret: the old
// link, and every cookie made from it, let nobody in from now on, and its pages' event streams end
// but the one of the page that made it anew, whose browser is given the new cookie. The old digests
// are kept (the last few), so that a browser the old link let in is told that it no longer does, as
// a revoked link's is, rather than its page trying again as if the server were down. Revoked links
// are kept, with every name their holders went by, so that what they did keeps its name; they never
// let anyone in again. When a link was last used is written at most once a minute, as an agent
// token's.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_NAME, sameName, validName } from "../shared/collab.ts";
import type { Invited, PersonInvite } from "../shared/collab.ts";
import { validPersonId } from "../shared/review.ts";

export const INVITE_PREFIX = "vpp_";
/** where a personal link points: `/i/<token>` */
export const INVITE_PATH = "/i/";
const FILE = "person-invites.json";
/** what the cookie's name starts with; the rest is this server's own (`cookie` in its file) */
const COOKIE = "visualproof_person";
/** how long a browser stays let in: the longest browsers keep a cookie (400 days), renewed at each
 *  visit to the page */
const MAX_AGE = 400 * 24 * 3600;
const FLUSH_MS = 60_000;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** how many of a link's old digests are kept once it was made anew: the browsers they let in are
 *  told the link no longer does */
const REPLACED_KEPT = 16;

/** A link as the server keeps it: its token (none for a link made before 0.6.0, when only the
 *  digest was kept) and the digest of it, beside what Share is shown of it; and the digests of the
 *  tokens it had before it was made anew, with when, the latest last. */
export interface InviteRecord extends PersonInvite {
  digest: string;
  token?: string;
  replaced?: { digest: string; at: string }[];
}

/** What a request's link or cookie is: a link in force (its use noted), one that was revoked, an
 *  old one of a link made anew since (`at`), or none of ours. */
export type InviteCheck = { ok: InviteRecord } | { ended: "revoked"; record: InviteRecord } | { ended: "replaced"; record: InviteRecord; at: string } | null;

const sha = (s: string) => createHash("sha256").update(s).digest();
const digestOf = (token: string) => sha(`visualproof person link\0${token}`).toString("base64url");
/** the cookie's value for a link: its id, and a digest of the digest of its token (`digest`: an
 *  old one of a link made anew) */
const cookieValue = (r: InviteRecord, digest = r.digest) => `${r.id}.${sha(`visualproof person cookie\0${digest}`).toString("base64url")}`;

/** Whether `a` and `b` are the same, in constant time whatever they are. */
function same(a: string, b: string): boolean {
  return timingSafeEqual(sha(a), sha(b));
}

export class Invites {
  private file: string | null;
  private records: InviteRecord[] = [];
  /** the cookie's name: `visualproof_person_` and this server's own 12 hex digits */
  readonly cookieName: string;
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** told when a link no longer lets in the browsers it let in — revoked, or made anew: its pages'
   *  event streams end (server/live.ts), but `keep`, the one of the page that made it anew */
  onEnded: (r: InviteRecord, keep?: string) => void = () => {};
  /** told when a link was made, renamed or revoked: every page is told the names (`people`) */
  onChanged: () => void = () => {};

  /** `siteDir` null keeps the links in memory only (tests). */
  constructor(siteDir: string | null) {
    this.file = siteDir ? join(siteDir, FILE) : null;
    let own: string | null = null;
    if (this.file && existsSync(this.file)) {
      try {
        const data = JSON.parse(readFileSync(this.file, "utf8")) as { cookie?: unknown; invites?: unknown };
        if (typeof data.cookie === "string" && /^[0-9a-f]{12}$/.test(data.cookie)) own = data.cookie;
        if (Array.isArray(data.invites)) this.records = data.invites.filter(isRecord).map(kept);
      } catch {
        // a file that cannot be read lets nobody in by a link; it is kept aside, not overwritten
        renameSync(this.file, `${this.file}.broken-${Date.now()}`);
      }
    }
    // the cookie's name is kept with the first link: before there is one, no browser has the cookie
    this.cookieName = `${COOKIE}_${own ?? randomBytes(6).toString("hex")}`;
    if (!own && this.records.length) this.save();
    if (this.file) {
      this.timer = setInterval(() => this.flush(), FLUSH_MS);
      this.timer.unref?.();
    }
  }

  /** Make a link for a person, under the name `name` (checked by the caller), made by `by`: the
   *  token, for the link, and its record; or why not — a name someone with a link in force goes by
   *  is theirs. */
  create(o: { name: string; by: string; now?: number }): { token: string; record: InviteRecord } | string {
    const now = new Date(o.now ?? Date.now()).toISOString();
    const name = o.name.trim();
    const holder = this.holder(name);
    if (holder) return taken(holder);
    let id: string;
    do id = randomBytes(5).toString("hex");
    while (this.records.some((r) => r.id === id));
    const token = newToken(id);
    const record: InviteRecord = { id, digest: digestOf(token), token, name, names: [{ name, at: now }], by: o.by, created: now, revoked: null, revokedBy: null, lastUsed: null };
    this.records.push(record);
    this.save();
    this.onChanged();
    return { token, record };
  }

  /** What a link's token is. Compared in constant time, by digests of one length whatever was sent,
   *  whether or not its id is known; then with the link's old ones, if it was made anew. */
  check(token: string, now = Date.now()): InviteCheck {
    if (!token.startsWith(INVITE_PREFIX)) return null;
    const id = token.slice(INVITE_PREFIX.length, INVITE_PREFIX.length + 10);
    const r = validPersonId(id) && token[INVITE_PREFIX.length + 10] === "_" && SECRET.test(token.slice(INVITE_PREFIX.length + 11)) ? this.get(id) : undefined;
    const given = digestOf(token);
    const ok = same(given, r?.digest ?? "no such link");
    if (r && ok) return this.seen(r, now);
    return r ? this.old(r, (d) => same(given, d)) : null;
  }

  /** What the cookie a request carries says (its `Cookie` header): a link in force, one revoked or
   *  made anew since the cookie was given (which the browser should forget), or none. */
  ofCookie(header: string | undefined, now = Date.now()): InviteCheck {
    const given = cookieOf(header, this.cookieName);
    if (given === null) return null;
    const r = given.indexOf(".") === 10 ? this.get(given.slice(0, 10)) : undefined;
    const ok = same(given, r ? cookieValue(r) : "no such link");
    if (r && ok) return this.seen(r, now);
    return r ? this.old(r, (d) => same(given, cookieValue(r, d))) : null;
  }

  /** A link's old token or cookie, by `is`, which says whether it is the one of an old digest: the
   *  link revoked since, or made anew (when, the latest such); null when it is none of them. */
  private old(r: InviteRecord, is: (digest: string) => boolean): InviteCheck {
    // every old digest compared, whichever matches
    const at = (r.replaced ?? []).reduce<string | null>((found, d) => (is(d.digest) ? d.at : found), null);
    if (at === null) return null;
    return r.revoked ? { ended: "revoked", record: r } : { ended: "replaced", record: r, at };
  }

  private seen(r: InviteRecord, now: number): InviteCheck {
    if (r.revoked) return { ended: "revoked", record: r };
    r.lastUsed = new Date(now).toISOString();
    this.dirty = true;
    return { ok: r };
  }

  /** The cookie that lets a browser in as the holder of `r` (a `Set-Cookie` value). */
  cookie(r: InviteRecord): string {
    return `${this.cookieName}=${cookieValue(r)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax`;
  }

  /** What makes a browser forget a revoked link's cookie. */
  forget(): string {
    return `${this.cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  }

  /** The links in force, oldest first. */
  inForce(): InviteRecord[] {
    return this.records.filter((r) => !r.revoked);
  }

  get(id: string): InviteRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  /** The holder of a link in force who goes by `name` (sameName), but `except`; undefined when
   *  nobody does. */
  holder(name: string, except: string | null = null): InviteRecord | undefined {
    return this.inForce().find((r) => r.id !== except && sameName(r.name, name));
  }

  /** The holder of a link in force goes by `name` from now on (checked by the caller); every name
   *  they had is kept. The record, or why not: the name is another holder's. */
  rename(id: string, name: string, now = Date.now()): InviteRecord | string {
    const r = this.get(id);
    if (!r || r.revoked) return "This personal link was revoked.";
    const n = name.trim();
    const other = this.holder(n, id);
    if (other) return taken(other);
    if (r.name === n) return r;
    r.name = n;
    r.names.push({ name: n, at: new Date(now).toISOString() });
    this.save();
    this.onChanged();
    return r;
  }

  /** Revoke a link in force: it lets nobody in from now on, and its pages' event streams end.
   *  False when there is no such link in force. */
  revoke(id: string, by: string, now = Date.now()): boolean {
    const r = this.get(id);
    if (!r || r.revoked) return false;
    r.revoked = new Date(now).toISOString();
    r.revokedBy = by;
    this.save();
    this.onEnded(r);
    this.onChanged();
    return true;
  }

  /** The link of the holder of `id` in force, to show them again (the owner's decision of
   *  2026-10-19): its token; null for a link made before 0.6.0, of which only the digest was kept;
   *  undefined for no such link in force. */
  tokenOf(id: string): string | null | undefined {
    const r = this.get(id);
    if (!r || r.revoked) return undefined;
    return r.token ?? null;
  }

  /** Make the link in force `id` anew, for its holder (the owner's decision of 2026-10-19): a new
   *  secret under the same id, so the same person, log and names. The old link and every cookie it
   *  gave let nobody in from now on, and are told so; its pages' event streams end, but `keep` (the
   *  page that made it anew, whose browser is given the new cookie). The new token and the record,
   *  or null for no such link in force. */
  renew(id: string, o: { keep?: string; now?: number } = {}): { token: string; record: InviteRecord } | null {
    const r = this.get(id);
    if (!r || r.revoked) return null;
    const token = newToken(r.id);
    const was = { digest: r.digest, token: r.token, replaced: r.replaced };
    r.replaced = [...(r.replaced ?? []), { digest: r.digest, at: new Date(o.now ?? Date.now()).toISOString() }].slice(-REPLACED_KEPT);
    r.digest = digestOf(token);
    r.token = token;
    try {
      this.save();
    } catch (e) {
      // not written: the link stays as it was, its browsers in, rather than made anew until the
      // server restarts and reads the old one again
      Object.assign(r, was);
      if (was.token === undefined) delete r.token;
      if (was.replaced === undefined) delete r.replaced;
      throw e;
    }
    this.onEnded(r, o.keep);
    return { token, record: r };
  }

  /** Every holder of a link, revoked ones too, as every page is told them (`Invited`). */
  people(): Invited[] {
    return this.records.map((r) => ({ id: r.id, name: r.name, was: [...new Set(r.names.map((n) => n.name).filter((n) => n !== r.name))], ...(r.revoked ? { revoked: true as const } : {}) }));
  }

  /** Write when links were last used, if that changed since the last write. */
  flush(): void {
    if (this.dirty) this.save();
  }

  /** Stop writing on a timer (tests, the server's end), writing what is left. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  /** A link as Share shows it: nothing of its token. */
  static info(r: InviteRecord): PersonInvite {
    const { digest: _d, token: _t, replaced: _r, ...rest } = r;
    return { ...rest, names: rest.names.map((n) => ({ ...n })) };
  }

  private save(): void {
    this.dirty = false;
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ cookie: this.cookieName.slice(COOKIE.length + 1), invites: this.records }, null, 1) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

/** A new token for the link of id `id`: its prefix, its id, and 32 random bytes. */
function newToken(id: string): string {
  return `${INVITE_PREFIX}${id}_${randomBytes(32).toString("base64url")}`;
}

/** Why a name is not to be had: someone with a personal link goes by it. */
export function taken(r: InviteRecord): string {
  return `“${r.name}” is the name of someone invited with a personal link: choose another.`;
}

/** Why a name a person is to be invited under, or to take, will not do; null when it will. */
export function invalidPersonName(s: unknown): string | null {
  if (typeof s !== "string" || !validName(s.trim())) return `A name is 1 to ${MAX_NAME} characters, without line breaks.`;
  return null;
}

/** A cookie's value as the `Cookie` header carries it, or null. */
export function cookieOf(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** A record as this server keeps it; anything else is dropped when the file is read. A record of
 *  a server before 0.6.0 has no token. */
function isRecord(x: unknown): x is InviteRecord {
  const r = x as InviteRecord;
  return (
    !!r && typeof r === "object" && validPersonId(r.id) && typeof r.digest === "string" && typeof r.name === "string" && validName(r.name) &&
    Array.isArray(r.names) && r.names.every((n) => n && typeof n.name === "string" && typeof n.at === "string") && typeof r.by === "string" && typeof r.created === "string"
  );
}

/** A record as it is kept from now on: its token only where it is this link's own — of its id, and
 *  of the digest the link is compared with; one that is not (written in by hand, a copy mended
 *  wrongly) is never shown, and the link is as one made before 0.6.0, which its holder may make
 *  anew. Its old digests only where they are digests. */
function kept(r: InviteRecord): InviteRecord {
  const out = { ...r };
  const t = r.token;
  const own = typeof t === "string" && t.startsWith(`${INVITE_PREFIX}${r.id}_`) && SECRET.test(t.slice(INVITE_PREFIX.length + 11)) && digestOf(t) === r.digest;
  if (!own) delete out.token;
  if (r.replaced !== undefined) {
    const ds = Array.isArray(r.replaced) ? r.replaced.filter((d) => d && typeof d.digest === "string" && typeof d.at === "string") : [];
    if (ds.length) out.replaced = ds.slice(-REPLACED_KEPT);
    else delete out.replaced;
  }
  return out;
}
