// The Claude Code OAuth tokens people give in Share (AgentSpec decision 10; the owner's decisions of
// 2026-11-08, experimental, behind --claude-oauth): a person's own token, made with `claude
// setup-token`, on which the agents they run on this server run (server/hosted.ts). One per person:
// their personal link's id where they came by one, else their name (as madeBy compares makers,
// shared/collab.ts), so that it is theirs whatever name they go by.
//
// It is worth more than anything else the site keeps: a year of the person's Claude subscription. So
// it is given once and never shown again — not to its holder, not to any page, agent, log or error —
// and kept in `<site>/claude-tokens.json`, readable by the server's user alone, as the agents' tokens
// and the personal links are. What the server does with it is hand it to the `claude` processes of
// its holder's agents, in their environment (never on a command line). Its holder replaces or removes
// it; a personal link revoked takes its token with it. Removing it here deletes the server's copy
// only: the token itself lasts until it expires or is revoked at Anthropic.
//
// No API key: the owner's decision (an `sk-ant-api…` key is refused, so that nobody gives one by
// mistake and is billed by the token).

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sameName } from "../shared/collab.ts";

const FILE = "claude-tokens.json";
/** what `claude setup-token` prints: `sk-ant-oat01-…` (108 characters on 2026-11-08) */
const OAUTH = /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,400}$/;

/** Whose token: a person by their personal link's id (`person`), else by the name they give. */
export interface ClaudeHolder {
  person: string | null;
  name: string;
}

/** A token as the server keeps it. */
interface Kept {
  /** the personal link's id of its holder, where they came by one */
  person?: string;
  /** the name it was given under (the holder's, then) */
  name: string;
  token: string;
  given: string;
  /** when Claude Code last refused it (expired, revoked at Anthropic): it is not used again until
   *  given anew */
  refused: string | null;
}

/** What its holder is told of their token: never the token. */
export interface ClaudeTokenInfo {
  given: string;
  refused: string | null;
}

/** Why `s` is not a Claude Code OAuth token; null when it looks like one. */
export function invalidClaudeToken(s: unknown): string | null {
  if (typeof s !== "string" || !s.trim()) return "Paste the token `claude setup-token` printed.";
  const t = s.trim();
  if (/^sk-ant-api/.test(t)) return "This is an API key: this server takes a Claude Code OAuth token, which `claude setup-token` prints (sk-ant-oat…).";
  if (!OAUTH.test(t)) return "This is not a Claude Code OAuth token: `claude setup-token` prints one that starts with sk-ant-oat.";
  return null;
}

/** Whether `k` is `who`'s: by the personal link where it was given under one, else by the name. */
const holds = (k: Kept, who: ClaudeHolder) => (k.person ? who.person === k.person : !who.person && sameName(k.name, who.name));

export class ClaudeTokens {
  private file: string | null;
  private kept: Kept[] = [];
  /** told when a holder's token was given, replaced, refused or removed: their agents on the server
   *  start again, or stop (server/hosted.ts) */
  onChanged: (who: ClaudeHolder) => void = () => {};

  /** `siteDir` null keeps them in memory only (tests). */
  constructor(siteDir: string | null) {
    this.file = siteDir ? join(siteDir, FILE) : null;
    if (this.file && existsSync(this.file)) {
      try {
        const data = JSON.parse(readFileSync(this.file, "utf8")) as { tokens?: unknown };
        if (Array.isArray(data.tokens)) this.kept = data.tokens.filter(isKept);
      } catch {
        // a file that cannot be read gives no token; it is kept aside, not overwritten blindly
        renameSync(this.file, `${this.file}.broken-${Date.now()}`);
      }
    }
  }

  /** What `who` is told of their token, or null where they gave none. */
  info(who: ClaudeHolder): ClaudeTokenInfo | null {
    const k = this.kept.find((x) => holds(x, who));
    return k ? { given: k.given, refused: k.refused } : null;
  }

  /** The token an agent made by `maker` runs on (its record's `by` and `makerPerson`), or null: none
   *  given, or refused since. */
  forMaker(maker: { by: string; makerPerson?: string }): string | null {
    const k = this.kept.find((x) => holds(x, { person: maker.makerPerson ?? null, name: maker.by }));
    return k && !k.refused ? k.token : null;
  }

  /** Give `who`'s token, in place of the one they gave before. Checked by the caller. */
  give(who: ClaudeHolder, token: string, now = Date.now()): void {
    this.kept = this.kept.filter((x) => !holds(x, who));
    this.kept.push({ ...(who.person ? { person: who.person } : {}), name: who.name, token: token.trim(), given: new Date(now).toISOString(), refused: null });
    this.save();
    this.onChanged(who);
  }

  /** Remove `who`'s token; false when they gave none. */
  remove(who: ClaudeHolder): boolean {
    const before = this.kept.length;
    this.kept = this.kept.filter((x) => !holds(x, who));
    if (this.kept.length === before) return false;
    this.save();
    this.onChanged(who);
    return true;
  }

  /** Claude Code refused `token` (expired, revoked at Anthropic): it is not used again until its
   *  holder gives one anew. */
  refuse(token: string, now = Date.now()): void {
    const k = this.kept.find((x) => x.token === token);
    if (!k || k.refused) return;
    k.refused = new Date(now).toISOString();
    this.save();
    this.onChanged({ person: k.person ?? null, name: k.name });
  }

  /** A personal link was revoked: its holder's token goes with it. */
  dropPerson(person: string): void {
    const k = this.kept.find((x) => x.person === person);
    if (k) this.remove({ person, name: k.name });
  }

  private save(): void {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ tokens: this.kept }, null, 1) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

function isKept(x: unknown): x is Kept {
  const k = x as Kept;
  return !!k && typeof k === "object" && typeof k.name === "string" && typeof k.token === "string" && OAUTH.test(k.token) && typeof k.given === "string" &&
    (k.person === undefined || typeof k.person === "string") && (k.refused === null || typeof k.refused === "string");
}
