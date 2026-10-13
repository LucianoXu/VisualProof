// Agent tokens (AgentSpec decision 7): sharing with an AI agent hands it a credential of its own,
// never the server's key. A person makes one from Share for one agent; the token fixes the agent's
// name and what it may do, lasts a few days, reaches the agents' API only (server/main.ts), and can
// be revoked from Share by anyone with a name.
//
// A token is `vpa_<id>_<secret>`: the prefix makes one recognisable wherever it is pasted or leaks
// (a log, a config file), the id names it in lists (it is no secret), and the secret is 32 random
// bytes. The server keeps the secret, in `<site>/agent-tokens.json` (readable by its owner alone),
// so that Share can show a token's prompt again while the token is in force (decided 2026-10-08).
// That file is kept as the access key is, by the same owner on the same machine, and is worth less:
// whoever can read it can read the key, and whoever has the key can open the page and make a token
// of their own. Tokens made before the secret was kept (only test tokens) are dropped when the file
// is read.
//
// The identity is the token's, not the request's: the name is the one the person gave, "<their
// name>'s AI" unless they wrote another, and stays the same for the token's life, being the name
// its advice is logged under (shared/review.ts, logFileName). Among the tokens in force no two have
// the same name: a second "Alice's AI" is "Alice's AI 2".
//
// When a token was last used is kept in memory at each request and written with the rest at most
// once a minute (and when the server stops): no disk write per request.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_NAME, uniqueName, validName } from "../shared/collab.ts";
import type { AgentTokenInfo } from "../shared/collab.ts";
import type { AgentLevel } from "./agent.ts";

export const TOKEN_PREFIX = "vpa_";
/** how long a token may last, in days; DEFAULT_DAYS (7) is the one the page offers when none is said */
export const TOKEN_DAYS = [1, 7, 30] as const;
export const DEFAULT_DAYS = 7;
/** a record of a token that ended (expired or revoked) is kept this long, for the Share window's
 *  list to say so and a conversation to be named, then forgotten */
const KEEP_ENDED_MS = 30 * 24 * 3600 * 1000;
/** lastUsed is written at most this often */
const FLUSH_MS = 60_000;
const FILE = "agent-tokens.json";
const ID = /^[0-9a-f]{10}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** A token as the server keeps it: its secret (the token is `vpa_<id>_<secret>`), beside what the
 *  page is shown of it (shared/collab.ts). */
export interface TokenRecord extends AgentTokenInfo {
  secret: string;
  level: AgentLevel;
}

/** A token as the page and the API show it: no secret. */
export type TokenInfo = Omit<TokenRecord, "secret">;

/** What a request's token is: one in force, one that ended (and why), or not one of ours. */
export type TokenCheck = { ok: TokenRecord } | { ended: "expired" | "revoked"; record: TokenRecord } | null;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Whether `s` has the shape of an agent token (to tell it from the server's key in a Bearer). */
export function looksLikeToken(s: string): boolean {
  return s.startsWith(TOKEN_PREFIX);
}

/** The bearer credential a request carries, or null. */
export function bearerOf(auth: string | undefined): string | null {
  if (!auth || !/^Bearer\s/i.test(auth)) return null;
  return auth.replace(/^Bearer\s+/i, "").trim() || null;
}

/** The token itself, from what is kept of it. */
const tokenOf = (r: TokenRecord) => `${TOKEN_PREFIX}${r.id}_${r.secret}`;

export class AgentTokens {
  private file: string | null;
  private records: TokenRecord[] = [];
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** told when a token ended (revoked, or found expired): its agent's wait ends (server/live.ts,
   *  server/talk.ts) */
  onEnded: (r: TokenRecord) => void = () => {};
  /** told when the tokens in force changed (made, revoked, expired): presence lists them */
  onChanged: () => void = () => {};

  /** `siteDir` null keeps the tokens in memory only (tests). */
  constructor(siteDir: string | null) {
    this.file = siteDir ? join(siteDir, FILE) : null;
    if (this.file && existsSync(this.file)) {
      try {
        const data = JSON.parse(readFileSync(this.file, "utf8")) as { tokens?: unknown };
        if (Array.isArray(data.tokens)) this.records = data.tokens.filter(isRecord);
        // what was dropped (a token kept without its secret) leaves the file too
        if (Array.isArray(data.tokens) && this.records.length < data.tokens.length) this.dirty = true;
      } catch {
        // a file that cannot be read lets no token in; it is kept aside, not overwritten blindly
        renameSync(this.file, `${this.file}.broken-${Date.now()}`);
      }
    }
    this.prune();
    this.flush();
    if (this.file) {
      this.timer = setInterval(() => {
        this.expire();
        this.flush();
      }, FLUSH_MS);
      this.timer.unref?.();
    }
  }

  /** Make a token for an agent: the token (for its prompt) and its record. The name and level are
   *  checked by the caller (server/main.ts); the name is used as given, numbered when an agent in
   *  force has it already; `by` is a person's name. */
  create(o: { name: string; by: string; level: AgentLevel; days: number; now?: number }): { token: string; record: TokenRecord } {
    const now = o.now ?? Date.now();
    this.expire(now);
    let id: string;
    do id = randomBytes(5).toString("hex");
    while (this.records.some((r) => r.id === id));
    const record: TokenRecord = {
      id,
      secret: randomBytes(32).toString("base64url"),
      name: uniqueName(o.name, this.inForce(now).map((r) => r.name)),
      level: o.level,
      by: o.by,
      created: new Date(now).toISOString(),
      expires: new Date(now + o.days * 24 * 3600 * 1000).toISOString(),
      revoked: null,
      revokedBy: null,
      lastUsed: null,
    };
    this.records.push(record);
    this.save();
    this.onChanged();
    return { token: tokenOf(record), record };
  }

  /** A token in force, whole, for its prompt to be shown again (server/main.ts); null when there is
   *  no such token in force — an ended one is never shown. */
  token(id: string, now = Date.now()): { token: string; record: TokenRecord } | null {
    const r = this.inForce(now).find((x) => x.id === id);
    return r ? { token: tokenOf(r), record: r } : null;
  }

  /** What a bearer credential is: a token in force (its use noted), one that ended, or none of
   *  ours. The two are compared in constant time, by their digests (of one length whatever was
   *  sent), whether or not the id is known. */
  check(token: string, now = Date.now()): TokenCheck {
    if (!looksLikeToken(token)) return null;
    const id = token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 10);
    const r = ID.test(id) && token[TOKEN_PREFIX.length + 10] === "_" ? this.records.find((x) => x.id === id) : undefined;
    const same = timingSafeEqual(digest(token), digest(r ? tokenOf(r) : "no such token"));
    if (!r || !same) return null;
    if (r.revoked) return { ended: "revoked", record: r };
    if (Date.parse(r.expires) <= now) {
      this.expire(now);
      return { ended: "expired", record: r };
    }
    r.lastUsed = new Date(now).toISOString();
    this.dirty = true;
    return { ok: r };
  }

  /** The tokens in force, oldest first. */
  inForce(now = Date.now()): TokenRecord[] {
    return this.records.filter((r) => !r.revoked && Date.parse(r.expires) > now);
  }

  get(id: string): TokenRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  /** Revoke a token in force: it lets nothing in from now on, and its agent's wait ends. False when
   *  there is no such token in force. */
  revoke(id: string, by: string, now = Date.now()): boolean {
    const r = this.records.find((x) => x.id === id);
    if (!r || r.revoked || Date.parse(r.expires) <= now) return false;
    r.revoked = new Date(now).toISOString();
    r.revokedBy = by;
    this.save();
    this.onEnded(r);
    this.onChanged();
    return true;
  }

  /** Tokens that expired since last looked at: their agents' waits end, and presence lists them no
   *  more. */
  expire(now = Date.now()): void {
    let any = false;
    for (const r of this.records)
      if (!r.revoked && Date.parse(r.expires) <= now && !ended.has(r)) {
        ended.add(r);
        this.onEnded(r);
        any = true;
      }
    if (any) this.onChanged();
  }

  /** Write lastUsed, if it changed since the last write. */
  flush(): void {
    if (this.dirty) this.save();
  }

  /** Stop writing on a timer (tests, the server's end), writing what is left. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  /** A token as people and agents are shown it. */
  static info(r: TokenRecord): TokenInfo {
    const { secret: _, ...rest } = r;
    return rest;
  }

  private prune(now = Date.now()): void {
    const before = this.records.length;
    this.records = this.records.filter((r) => now - Date.parse(r.revoked ?? r.expires) < KEEP_ENDED_MS || (!r.revoked && Date.parse(r.expires) > now));
    if (this.records.length !== before) this.save();
  }

  private save(): void {
    this.dirty = false;
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ tokens: this.records }, null, 1) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

/** records whose expiry has been told (onEnded) once already */
const ended = new WeakSet<TokenRecord>();

/** Why a name an agent is to be given will not do; null when it will. */
export function invalidAgentName(s: unknown): string | null {
  if (typeof s !== "string" || !validName(s.trim())) return `The agent's name is 1 to ${MAX_NAME} characters, without line breaks.`;
  return null;
}

/** A record as this server keeps it. One kept before 2026-10-08 has a digest and no secret: it is
 *  not one, and is dropped. */
function isRecord(x: unknown): x is TokenRecord {
  const r = x as TokenRecord;
  return !!r && typeof r === "object" && typeof r.id === "string" && ID.test(r.id) && typeof r.secret === "string" && SECRET.test(r.secret) &&
    typeof r.name === "string" && typeof r.by === "string" && typeof r.expires === "string" && ["read", "advise", "full"].includes(r.level);
}
