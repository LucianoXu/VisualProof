// The server's own agent (AgentSpec decision 10; the owner's decisions of 2026-11-08 for 0.11,
// experimental, behind --claude-oauth): one AI agent per VisualProof server, run on the Claude Code
// OAuth token its operator gives at the start, which everyone with a name talks with — each person
// in a private conversation of their own, anyone by a mention in the public channel. What it is
// before it runs: the token read (here), its own agent token made or kept (here), and what 0.10 left
// behind retired (here); what it does once it runs is server/hosted.ts's.
//
// The Claude token is the operator's: a year of their Claude subscription. So it is read once, at the
// start, from a file readable by the server's user alone (as --access-key-file's key is), or from the
// server's own environment (`env`), and held in memory: never shown, logged, answered, nor written in
// the site. A file another user could read, or that holds something else — an API key above all,
// which would bill by the token (the owner's decision) — stops the server from starting, with what to
// do; a token Claude Code refuses later takes the agent offline until the operator fixes it and
// restarts (server/hosted.ts).
//
// Its agent token is a token like those Share makes (server/tokens.ts, AgentSpec decision 7), made by
// "VisualProof" (`by`), with `runs: "server"` and no expiry: the same one at every start, so that its
// name, its review log and the conversations kept by its id go on (a name changed by
// --claude-oauth-name makes a new one, a token's name being fixed for its life). Its level is the
// server's --agents. It never leaves the server, and the page cannot revoke it: it stops with the
// server.
//
// 0.10 ran agents per person instead, on the Claude tokens people gave in Share
// (`<site>/claude-tokens.json`): that file is deleted at the start, said once in the log, and those
// agents' tokens are revoked and their folders removed.

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentLevel } from "./agent.ts";
import type { AgentTokens, TokenRecord } from "./tokens.ts";

/** who makes the server's agent's token: the server itself, as its writer is named (server/review.ts) */
export const SERVER_AGENT_BY = "VisualProof";
/** the name it goes by unless --claude-oauth-name says another */
export const DEFAULT_SERVER_AGENT_NAME = "Claude";
/** what `claude setup-token` prints: `sk-ant-oat01-…` (108 characters on 2026-11-08) */
const OAUTH = /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,400}$/;

/** Why `s` is not a Claude Code OAuth token; null when it looks like one. Never says what it holds. */
export function invalidClaudeToken(s: string): string | null {
  const t = s.trim();
  if (!t) return "it is empty: put there the token `claude setup-token` prints (sk-ant-oat…)";
  if (/^sk-ant-api/.test(t)) return "this is an API key: VisualProof takes a Claude Code OAuth token, which `claude setup-token` prints (sk-ant-oat…), never an API key";
  if (!OAUTH.test(t)) return "this is not a Claude Code OAuth token: `claude setup-token` prints one, which starts with sk-ant-oat and is all the file holds";
  return null;
}

/** The Claude Code OAuth token --claude-oauth names: the file's (readable by its owner alone), or the
 *  server's CLAUDE_CODE_OAUTH_TOKEN for `env`; or why the server does not start. */
export function loadClaudeToken(spec: string, env: NodeJS.ProcessEnv = process.env): { token: string } | { error: string } {
  if (spec === "env") {
    const t = (env.CLAUDE_CODE_OAUTH_TOKEN ?? "").trim();
    if (!t) return { error: "env: CLAUDE_CODE_OAUTH_TOKEN is not set in the server's environment (claude setup-token prints the token to set it to)" };
    const bad = invalidClaudeToken(t);
    return bad ? { error: `env: CLAUDE_CODE_OAUTH_TOKEN: ${bad}` } : { token: t };
  }
  let mode: number;
  try {
    const st = statSync(spec);
    if (!st.isFile()) return { error: `${spec} is not a file: give the file that holds the token claude setup-token prints` };
    mode = st.mode;
  } catch {
    return { error: `${spec}: there is no such file. Write there the token claude setup-token prints, and make it readable by the server's user alone: chmod 600 ${spec}` };
  }
  // as an ssh key: a file others may read is refused, not used (POSIX modes; Windows has none)
  if (process.platform !== "win32" && (mode & 0o077) !== 0) return { error: `${spec} may be read or written by others than its owner (mode ${(mode & 0o777).toString(8)}): chmod 600 ${spec}` };
  let text: string;
  try {
    text = readFileSync(spec, "utf8");
  } catch (e) {
    return { error: `${spec} cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
  const bad = invalidClaudeToken(text);
  return bad ? { error: `${spec}: ${bad}` } : { token: text.trim() };
}

/** Whether `r` is the server's agent's token: made by the server, to run here. */
export function isServerAgent(r: Pick<TokenRecord, "runs" | "by" | "makerPerson">): boolean {
  return r.runs === "server" && r.by === SERVER_AGENT_BY && !r.makerPerson;
}

/** What 0.10 left: the Claude tokens people gave (`claude-tokens.json`), deleted; the agents it ran
 *  per person on them, their tokens revoked and their folders under `agents` removed. Each said once
 *  in the log; nothing said where there is nothing. */
export function retire010(o: { site: string; agents: string; tokens: AgentTokens; log: (line: string) => void }): void {
  const file = join(o.site, "claude-tokens.json");
  if (existsSync(file)) {
    rmSync(file, { force: true });
    o.log("  removed claude-tokens.json: the Claude tokens people gave 0.10 in Share are no longer used — a server runs one agent of its own (--claude-oauth)");
  }
  for (const r of o.tokens.inForce())
    if (r.runs === "server" && !isServerAgent(r)) {
      o.tokens.revoke(r.id, SERVER_AGENT_BY);
      rmSync(join(o.agents, r.id), { recursive: true, force: true });
      o.log(`  revoked ${r.name}, which 0.10 ran on ${r.by}'s Claude Code: a server runs one agent of its own (--claude-oauth)`);
    }
}

/** The server's agent's token: the one kept, under `name` (or that name numbered, where another
 *  agent in force had it when it was made), at `level`; else a new one. A server's agent of another
 *  name gives its place (--claude-oauth-name changed), its token revoked and its folder removed. */
export function serverAgentToken(o: { tokens: AgentTokens; name: string; level: AgentLevel; agents: string; log: (line: string) => void }): TokenRecord {
  const kept = o.tokens.inForce().filter(isServerAgent);
  const named = (r: TokenRecord) => r.name === o.name || (r.name.startsWith(`${o.name} `) && /^\d+$/.test(r.name.slice(o.name.length + 1)));
  const mine = kept.find(named) ?? null;
  for (const r of kept)
    if (r !== mine) {
      o.tokens.revoke(r.id, SERVER_AGENT_BY);
      rmSync(join(o.agents, r.id), { recursive: true, force: true });
      o.log(`  the server's agent ${r.name} is now ${o.name} (--claude-oauth-name): a new agent, whose conversations start afresh`);
    }
  if (mine) {
    if (mine.level !== o.level) o.tokens.setLevel(mine.id, o.level);
    return o.tokens.get(mine.id)!;
  }
  return o.tokens.create({ name: o.name, by: SERVER_AGENT_BY, level: o.level, days: 0, runs: "server" }).record;
}
