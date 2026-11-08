// Agents the server runs (AgentSpec decision 10; the owner's decisions of 2026-11-08, experimental,
// behind --claude-oauth): an agent made in Share to run "on this server", on its maker's Claude Code
// OAuth token (server/claudetokens.ts), so that it stays without being shared again.
//
// It is an agent like any other (decisions 7–9): a token of its own, its name, level and maker, its
// private channel and the public one. What differs is who listens for it: the server, here, holding
// its inbox open in-process (server/talk.ts, as GET /api/agent/inbox does), so that it is *listening*
// while nobody writes, at no cost. What is handed to it starts one turn of its own Claude Code
// session: `claude -p`, the session resumed (`--session-id` at its first turn, `--resume` after), the
// batch on stdin, as wait_for_message words it. What comes during a turn waits for the next. Between
// turns nothing runs. A new conversation (a divider) starts a new session: what came before is gone
// from it, as it cannot be from a session someone runs in a terminal.
//
// It is trusted with Claude Code's own tools (the owner's decisions of 2026-11-08, after the first
// version, which had VisualProof's alone): a shell, files, the web, subagents, without asking
// (`--permission-mode bypassPermissions`), on this machine as the server's user, the project's
// folder added (`--add-dir`): it reads the code directly, changes it and builds it with Lake when
// asked (SPEC.md, as the owner changed it that day). In a branch the server follows, the project is
// the deployment's clone, which the next commit built resets: its ground rules say so. What it is
// denied by Claude Code's rules (`denied`): the site folder through the file tools (the tokens, the
// links); and the tools that reach beyond this agent, to its maker's Claude account and their other
// sessions (remote triggers, messages to other sessions, crons, workflows, worktrees). The shell is
// not confined by these rules: it is trusted. A turn may build at length: while it runs the agent
// counts as seen every minute (not offline), and what its shell leaves running goes with the turn
// (its process group). VisualProof's
// MCP server alone is its MCP server (`--strict-mcp-config`); a configuration folder of its own
// (CLAUDE_CONFIG_DIR: nothing of the server user's settings, hooks, plugins or memory), no CLAUDE.md
// read (CLAUDE_CODE_DISABLE_CLAUDE_MDS: one in a folder above would be), no auto-memory, no bundled
// skills, no auto-update. The MCP server is the very file agents download (mcp/visualproof-mcp.mjs),
// with the agent's token, at this server's address on this machine, its files in the agent's folder
// (VISUALPROOF_FILES). Nothing secret is on a command line: the agent's token is in its mcp.json
// (0600), the Claude token in the environment, the messages on stdin.
//
// Each agent's folder, `<cache>/agents/<token id>/` (0700): `work/` (the empty folder it runs in),
// `claude/` (its Claude Code configuration and sessions), `files/`, `mcp.json`, `prompt.md` (its
// ground rules, appended to Claude Code's system prompt), `session.json`, and `batch.json` while a
// turn runs or waits for the usage limit: a batch a stop of the server cut short is handed again once
// at the next start, saying so. The folder goes when the token ends.
//
// What can go wrong is said where it was asked, as the agent's message: its Claude token refused
// (then the agent goes offline until its maker gives another in Share), the usage limit reached (it
// answers once the limit resets: the batch waits, and so does what comes meanwhile), a turn past its
// time, Claude Code missing or failing.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { DETACH, end, grouped } from "./children.ts";
import { PUBLIC } from "./talk.ts";
import type { Handed, Talk } from "./talk.ts";
import type { AgentTokens, TokenRecord } from "./tokens.ts";
import type { ClaudeHolder, ClaudeTokens } from "./claudetokens.ts";
import { hostedPrompt } from "./prompt.ts";
import { mentioned } from "../shared/mentions.ts";
import { madeBy } from "../shared/collab.ts";
import type { ChannelKind } from "../shared/collab.ts";

/** how long a turn may take before it is stopped */
export const TURN_MS = 60 * 60_000;
/** how many model turns (tool calls and answers) one batch may take */
export const MAX_TURNS = 100;
/** how many agents in force each person may run on the server */
export const PER_PERSON = 2;
/** how long one in-process wait lasts: the longest an agent may wait (server/talk.ts, MAX_WAIT_S) */
const LISTEN_MS = 1800_000;
/** a usage limit whose reset Claude Code did not say is tried again after this */
const LIMIT_RETRY_MS = 15 * 60_000;
/** What an agent the server runs is denied, by Claude Code's permission rules: the site folder
 *  through the file tools, and the tools that reach its maker's Claude account or their other
 *  sessions. A rule's absolute path starts with `//`. */
export function denied(site: string): string[] {
  const under = (dir: string) => `/${dir.replace(/\/+$/, "")}/**`;
  return [
    ...["Read", "Edit", "Write"].map((t) => `${t}(${under(site)})`),
    "RemoteTrigger", "SendMessage", "ListAgents", "CronCreate", "CronDelete", "CronList", "ScheduleWakeup", "Workflow", "EnterWorktree", "ExitWorktree",
  ];
}

/** the environment Claude Code is run with, beside PATH, HOME, LANG, its folder and the token */
const QUIET = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_AUTOUPDATER: "1",
};

/** Claude Code's `claude`, where it is: on PATH, else where its installer puts it (~/.local/bin); null
 *  where there is none. */
export function findClaude(env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = [...(env.PATH ?? "").split(delimiter).filter(Boolean), join(env.HOME ?? homedir(), ".local", "bin")];
  for (const d of dirs) {
    const f = join(d, "claude");
    try {
      if (statSync(f).isFile()) {
        accessSync(f, fsConstants.X_OK);
        return f;
      }
    } catch {
      // not here
    }
  }
  return null;
}

export interface HostedOptions {
  /** where the agents' folders are: `<cache>/agents` */
  root: string;
  /** Claude Code's `claude`; null: there is none, and no agent runs */
  claude: string | null;
  talk: Talk;
  tokens: AgentTokens;
  claudeTokens: ClaudeTokens;
  /** this server's address on this machine, for the MCP server (http://127.0.0.1:<port>); null
   *  before it listens */
  address: () => string | null;
  /** the MCP server's file, as GET /api/agent/mcp serves it */
  mcpServer: () => string;
  /** the project's folder: the code the agent reads, and changes and builds when asked */
  projectRoot: () => string;
  /** the branch the server follows, where it follows one: the project is then its clone */
  followed?: () => string | null;
  /** the site's folder: its secrets, which the agent's file tools are denied */
  site: string;
  /** the names a message may mention (server/live.ts) */
  mentionable: () => string[];
  /** the project shown, for the agent's ground rules */
  project: () => string | null;
  log: (line: string) => void;
  /** a turn's longest time and model turns (tests make them short) */
  turnMs?: number;
  maxTurns?: number;
  /** Node, to run the MCP server with */
  node?: string;
}

/** One agent the server runs, while it listens. */
interface Runner {
  id: string;
  dir: string;
  /** the whole loop: aborted when the token ends, its Claude token goes, or the server stops */
  stop: AbortController;
  /** the turn running, if one is */
  turn: { child: ChildProcess; why: "stop" | "time" | null } | null;
  /** its Claude Code session, and whether a turn of it ran (so that the next resumes it) */
  session: string;
  started: boolean;
  /** what came before (the earlier entry of a first wait), handed with the next batch */
  context: string[];
  /** what is to be answered at its next turn */
  pending: string[];
  /** the usage limit: no turn before then */
  pausedUntil: number;
}

/** What a turn came to, from Claude Code's stream. */
interface Outcome {
  exit: number | null;
  result: { is_error?: boolean; result?: string; api_error_status?: number | null; subtype?: string } | null;
  replied: boolean;
  refused: boolean;
  limit: { resetsAt: number | null } | null;
  noSession: boolean;
  spawnError: string | null;
}

export class Hosted {
  private o: HostedOptions;
  private runners = new Map<string, Runner>();
  private closed = false;

  constructor(o: HostedOptions) {
    this.o = o;
    mkdirSync(o.root, { recursive: true, mode: 0o700 });
  }

  /** Whether agents can run here: Claude Code is on this machine. */
  get available(): boolean {
    return this.o.claude !== null;
  }

  /** Whether a turn runs now (the server waits for none to restart into a patch). */
  get busy(): boolean {
    return [...this.runners.values()].some((r) => r.turn !== null);
  }

  /** Every agent the server runs that is in force: listened for again (the server's start). */
  restore(): void {
    for (const r of this.o.tokens.inForce()) if (r.runs === "server") this.start(r);
  }

  /** Listen for an agent the server runs: just made in Share, or at the server's start. Nothing
   *  happens where it is listened for already, or its maker has no Claude token in use. */
  start(record: TokenRecord): void {
    if (this.closed || record.runs !== "server" || this.runners.has(record.id)) return;
    if (!this.o.claude || !this.o.claudeTokens.forMaker(record)) return;
    const dir = join(this.o.root, record.id);
    for (const d of [dir, join(dir, "work"), join(dir, "claude"), join(dir, "files")]) mkdirSync(d, { recursive: true, mode: 0o700 });
    const kept = readJson<{ session?: string; started?: boolean }>(join(dir, "session.json"));
    const r: Runner = {
      id: record.id,
      dir,
      stop: new AbortController(),
      turn: null,
      session: typeof kept?.session === "string" && /^[0-9a-f-]{36}$/.test(kept.session) ? kept.session : randomUUID(),
      started: kept?.started === true,
      context: [],
      pending: [],
      pausedUntil: 0,
    };
    // a batch a stop of the server cut short, or that waited for the usage limit: handed again once
    const cut = readJson<{ text?: string }>(join(dir, "batch.json"));
    if (typeof cut?.text === "string" && cut.text.trim()) r.pending.push(`(VisualProof stopped while you were answering what follows, or it waited for the usage limit: answer it now.)\n\n${cut.text}`);
    this.saveSession(r);
    this.runners.set(r.id, r);
    void this.loop(r).catch((e) => this.o.log(`agent ${r.id}: ${e instanceof Error ? e.message : String(e)}`)).finally(() => {
      if (this.runners.get(r.id) === r) this.runners.delete(r.id);
    });
  }

  /** Its token ended (revoked, expired): its turn stops, its loop ends, its folder goes. */
  ended(id: string): void {
    const r = this.runners.get(id);
    if (r) this.halt(r);
    rmSync(join(this.o.root, id), { recursive: true, force: true });
  }

  /** A holder's Claude token was given, replaced, refused or removed: their agents start, or stop. */
  changed(who: ClaudeHolder): void {
    for (const rec of this.o.tokens.inForce()) {
      if (rec.runs !== "server" || !madeBy(rec, who)) continue;
      const r = this.runners.get(rec.id);
      if (this.o.claudeTokens.forMaker(rec)) {
        if (!r) this.start(rec);
      } else if (r) {
        // what it was to answer stays, for a token given anew to answer
        this.halt(r, true);
        this.o.talk.left(rec.id);
      }
    }
  }

  /** Its maker's Stop: the turn running ends, and what it was answering with it. False where none
   *  runs. */
  stopTurn(id: string): boolean {
    const t = this.runners.get(id)?.turn;
    if (!t) return false;
    t.why = "stop";
    end(t.child);
    return true;
  }

  /** Whether `id` is listened for here now. */
  running(id: string): boolean {
    return this.runners.has(id);
  }

  /** The server stops: every turn with it (each batch kept, to be handed again at the next start). */
  close(): void {
    this.closed = true;
    for (const r of this.runners.values()) this.halt(r, true);
  }

  private halt(r: Runner, keepBatch = false): void {
    r.stop.abort();
    if (r.turn) end(r.turn.child);
    if (!keepBatch) rmSync(join(r.dir, "batch.json"), { force: true });
    this.runners.delete(r.id);
  }

  private async loop(r: Runner): Promise<void> {
    const talk = this.o.talk;
    while (!r.stop.signal.aborted) {
      const rec = this.o.tokens.get(r.id);
      if (!rec || rec.runs !== "server") return;
      const claudeToken = this.o.claudeTokens.forMaker(rec);
      if (!claudeToken) return;
      const now = Date.now();
      const paused = r.pausedUntil > now;
      // with something to answer and no limit in the way, nothing to wait for but what is there
      const wait = r.pending.length && !paused ? 0 : paused ? Math.min(r.pausedUntil - now, LISTEN_MS) : LISTEN_MS;
      const got = await talk.wait(r.id, wait, { signal: r.stop.signal, session: r.session });
      if ("ended" in got || "gone" in got) return;
      this.take(r, got.messages);
      if (!r.pending.length || r.pausedUntil > Date.now()) continue;
      await this.turn(r, rec, claudeToken);
    }
  }

  /** What a wait handed over, into what the next turn says: a new conversation starts a new session
   *  and drops what came before it; what came before (a first wait's) is context, needed only by a
   *  session that has not had it — unless it holds mentions never handed, which may still ask
   *  something; people's messages are to be answered. */
  private take(r: Runner, messages: Handed[]): void {
    for (const m of messages) {
      if (m.kind === "divider") {
        r.session = randomUUID();
        r.started = false;
        r.context = [];
        r.pending = [];
        rmSync(join(r.dir, "batch.json"), { force: true });
        this.saveSession(r);
      } else if (m.kind === "earlier") {
        if (m.missed) r.pending.push(m.text);
        else if (!r.started) r.context.push(m.text);
      } else if (m.kind === "person") r.pending.push(said(m));
    }
  }

  private async turn(r: Runner, rec: TokenRecord, claudeToken: string): Promise<void> {
    const vpa = this.o.tokens.token(r.id);
    const address = this.o.address();
    if (!vpa || !address) return;
    const text = batchText(r, rec);
    writeFileSync(join(r.dir, "batch.json"), JSON.stringify({ text: [...r.pending].join("\n\n") }), { mode: 0o600 });
    this.prepare(r, rec, vpa.token, address);
    let out = await this.run(r, text, claudeToken);
    // a session Claude Code no longer has (its folder was cleared): a new one, once
    if (out.noSession && !r.stop.signal.aborted) {
      r.session = randomUUID();
      r.started = false;
      this.saveSession(r);
      out = await this.run(r, batchText(r, rec), claudeToken);
    }
    const why = r.turn?.why ?? null;
    r.turn = null;
    if (r.stop.signal.aborted) return;
    const channel = this.o.talk.lastChannel(r.id);
    const say = (s: string) => this.post(r, rec, channel, s);
    if (out.spawnError) {
      say(`I cannot run: Claude Code could not be started on the server (${out.spawnError}).`);
      return this.giveUp(r);
    }
    if (out.refused) {
      say(`I cannot answer: Claude Code refused ${rec.by}'s token (expired, or revoked). ${rec.by} can give a new one in Share (AI agent), and I answer then.`);
      // the batch stays, for the new token to answer
      this.o.claudeTokens.refuse(claudeToken);
      return;
    }
    if (out.limit) {
      const at = out.limit.resetsAt ?? Date.now() + LIMIT_RETRY_MS;
      r.pausedUntil = at;
      say(`${rec.by}'s Claude usage limit is reached: I answer once it resets, ${new Date(at).toISOString().replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC")}. What you write meanwhile waits.`);
      return;
    }
    r.started = true;
    this.saveSession(r);
    r.pending = [];
    r.context = [];
    rmSync(join(r.dir, "batch.json"), { force: true });
    if (why === "stop") return;
    if (why === "time") return void say(`I was stopped: my answer took longer than ${Math.round((this.o.turnMs ?? TURN_MS) / 60_000)} minutes.`);
    const res = out.result;
    if (!res || res.is_error || out.exit !== 0) {
      const line = (res?.result ?? "").split("\n")[0].slice(0, 300) || `it exited with ${out.exit}`;
      return void say(`Claude Code failed on the server: ${line}`);
    }
    // the answer is the reply tool's; a turn that replied nothing says its last words instead
    const last = (res.result ?? "").trim();
    if (!out.replied && last) say(last);
  }

  /** The agent's folder, ready for a turn: the MCP server, its configuration and the ground rules,
   *  written afresh (the server's address and version may have changed since). */
  private prepare(r: Runner, rec: TokenRecord, vpa: string, address: string): void {
    const mcp = join(r.dir, "visualproof-mcp.mjs");
    writeFileSync(mcp, this.o.mcpServer(), { mode: 0o600 });
    const config = {
      mcpServers: {
        visualproof: {
          type: "stdio",
          command: this.o.node ?? process.execPath,
          args: [mcp],
          env: { VISUALPROOF_URL: address, VISUALPROOF_TOKEN: vpa, VISUALPROOF_FILES: join(r.dir, "files"), VISUALPROOF_WAIT_SECONDS: "50" },
        },
      },
    };
    writeFileSync(join(r.dir, "mcp.json"), JSON.stringify(config), { mode: 0o600 });
    writeFileSync(join(r.dir, "prompt.md"), hostedPrompt({ record: rec, project: this.o.project(), root: this.o.projectRoot(), files: join(r.dir, "files"), site: this.o.site, followed: this.o.followed?.() ?? null }), { mode: 0o600 });
  }

  /** One `claude -p` of the agent's session, `text` on stdin, read as stream-json. */
  private run(r: Runner, text: string, claudeToken: string): Promise<Outcome> {
    const out: Outcome = { exit: null, result: null, replied: false, refused: false, limit: null, noSession: false, spawnError: null };
    const args = [
      "-p", "--output-format", "stream-json", "--verbose",
      ...(r.started ? ["--resume", r.session] : ["--session-id", r.session]),
      "--strict-mcp-config", "--mcp-config", join(r.dir, "mcp.json"),
      "--add-dir", this.o.projectRoot(),
      "--permission-mode", "bypassPermissions", "--permission-prompts", "none",
      "--disallowedTools", ...denied(this.o.site),
      "--max-turns", String(this.o.maxTurns ?? MAX_TURNS),
      "--append-system-prompt-file", join(r.dir, "prompt.md"),
    ];
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? homedir(),
      LANG: process.env.LANG ?? "C.UTF-8",
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      CLAUDE_CONFIG_DIR: join(r.dir, "claude"),
      CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
      ...QUIET,
    };
    return new Promise<Outcome>((done) => {
      let child: ChildProcess;
      try {
        child = grouped(spawn(this.o.claude!, args, { cwd: join(r.dir, "work"), env, stdio: ["pipe", "pipe", "pipe"], detached: DETACH }));
      } catch (e) {
        out.spawnError = e instanceof Error ? e.message : String(e);
        return done(out);
      }
      r.turn = { child, why: null };
      // a build may run long without a request of VisualProof's: the agent is seen, not offline
      const beat = setInterval(() => this.o.talk.seen(r.id, null), 60_000);
      beat.unref?.();
      const timer = setTimeout(() => {
        if (r.turn) r.turn.why = "time";
        end(child);
      }, this.o.turnMs ?? TURN_MS);
      let buf = "";
      let err = "";
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (d: string) => {
        buf += d;
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          read(line, out);
        }
      });
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", (d: string) => {
        if (err.length < 4000) err += d;
      });
      child.on("error", (e) => {
        out.spawnError = e.message;
      });
      child.stdin!.on("error", () => {});
      child.stdin!.end(text);
      child.on("close", (code) => {
        clearTimeout(timer);
        clearInterval(beat);
        // what its shell left running goes with the turn
        if (DETACH && child.pid)
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            // nothing left
          }
        if (buf.trim()) read(buf, out);
        out.exit = code;
        // a resume of a session it does not have says so, before any turn
        if (r.started && !out.result?.result && /no conversation found/i.test(err)) out.noSession = true;
        else if (r.started && out.result?.is_error && /no conversation found/i.test(out.result.result ?? "")) out.noSession = true;
        if (code !== 0 && !out.result && err.trim() && !out.noSession) this.o.log(`agent ${r.id}: claude: ${err.trim().split("\n").slice(-3).join(" / ").split(claudeToken).join("<token>")}`);
        done(out);
      });
    });
  }

  /** The agent's message where it was asked: in its private channel, or the public one. */
  private post(r: Runner, rec: TokenRecord, channel: ChannelKind, text: string): void {
    const mentions = mentioned(text, this.o.mentionable());
    this.o.talk.post(channel === "public" ? PUBLIC : r.id, { from: rec.name, kind: "agent", text, ...(mentions.length ? { mentions } : {}) }, r.id);
  }

  /** The agent cannot run: offline, until it is started again. */
  private giveUp(r: Runner): void {
    this.halt(r, true);
    this.o.talk.left(r.id);
  }

  private saveSession(r: Runner): void {
    writeFileSync(join(r.dir, "session.json"), JSON.stringify({ session: r.session, started: r.started }), { mode: 0o600 });
  }
}

/** One line of Claude Code's stream-json, into what the turn came to. */
function read(line: string, out: Outcome): void {
  if (!line.trim()) return;
  let e: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (e.type === "assistant")
    for (const c of e.message?.content ?? []) if (c?.type === "tool_use" && c.name === "mcp__visualproof__reply") out.replied = true;
  if (e.type === "system" && e.subtype === "api_retry" && (e.error === "authentication_failed" || e.error_status === 401)) out.refused = true;
  if (e.type === "rate_limit_event" && e.rate_limit_info?.status === "rejected")
    out.limit = { resetsAt: typeof e.rate_limit_info.resetsAt === "number" ? e.rate_limit_info.resetsAt * 1000 : null };
  if (e.type === "result") {
    out.result = e;
    if (e.is_error && e.api_error_status === 401) out.refused = true;
    if (e.is_error && (e.api_error_status === 429 || /hit your .*limit|usage limit/i.test(String(e.result ?? "")))) out.limit ??= { resetsAt: null };
  }
}

/** A person's message as the agent is handed it: as wait_for_message words it (mcp/visualproof-mcp.mjs). */
function said(m: Extract<Handed, { kind: "person" | "agent" | "divider" }>): string {
  const where = m.where?.inWords ? `, on ${m.where.inWords.replace(/\.$/, "")}` : "";
  const how = m.channel === "public" ? " in the public channel, mentioning you" : " to you, in your private channel";
  return `${m.from} wrote${how}${where} (${m.channel === "public" ? "public " : ""}message ${m.id}, ${m.at}):\n${m.text}`;
}

/** What a turn hands Claude Code: a first line that is never a slash command, what came before,
 *  what is to be answered, and how to answer. */
function batchText(r: Runner, rec: TokenRecord): string {
  const n = r.pending.length;
  const head = n === 1 ? "A message from the page:" : `${n} messages from the page, in order:`;
  return [
    `VisualProof — ${head}`,
    ...r.context,
    ...r.pending,
    `Answer with the reply tool (it goes back where the last message came from; channel "public" writes in the public channel), after moving your own view to what you explain (the view tool). You are ${rec.name}; then end your turn: the next messages come by themselves.`,
  ].join("\n\n");
}

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  } catch {
    return null;
  }
}
