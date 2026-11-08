// The server's own agent, running (AgentSpec decision 10; the owner's decisions of 2026-11-08 for
// 0.11, experimental, behind --claude-oauth): one AI agent per VisualProof server, on the Claude Code
// OAuth token its operator gave at the start (server/serveragent.ts), which everyone with a name talks
// with. It replaces 0.10's agents run per person, on the token each gave in Share.
//
// It is an agent like those people share with (decisions 7–9) — a token of its own, its name, the
// server's level, the public channel — but for whom it talks with: every person with a name has a
// private channel with it, which nobody else reads (server/talk.ts, personalChannel), and anyone
// mentions it in the public channel. **Every conversation is its own Claude Code session**: each
// person's private channel one, the public channel (the mentions handed to it) one. What one person
// says privately never enters another's session nor the public one. A person may start a new
// conversation in their own channel (a divider): a new session for that channel alone. The public
// session is never reset by people; Claude Code compacts it as it grows.
//
// Nothing listens by waiting: the server is told of every message as it is written (Talk.onPosted),
// and what is handed to the agent starts one turn of that conversation's session — `claude -p`, the
// session resumed (`--session-id` at its first turn, `--resume` after), the batch on stdin, as
// wait_for_message words it. Per session one turn at a time: what comes meanwhile goes in its next.
// At most MAX_RUNNING turns run at once, all conversations together; the others wait their turn,
// oldest first. A turn's answer goes back to its own conversation: its MCP server says which turn it
// is (VISUALPROOF_TURN, in that turn's mcp.json: X-VisualProof-Turn on each request), and the reply
// tool's default is that turn's channel, so that turns running at once never mix (it may also write
// in the public channel). Between turns nothing runs.
//
// It is trusted with Claude Code's own tools (the owner's decisions of 2026-11-08, after a first
// version with VisualProof's alone): a shell, files, the web, subagents, without asking
// (`--permission-mode bypassPermissions`), on this machine as the server's user, the project's
// folder added (`--add-dir`): it reads the code directly, changes it and builds it with Lake when
// asked (SPEC.md). In a branch the server follows, the project is the deployment's clone, which the
// next commit built resets: its ground rules say so. What it is denied by Claude Code's rules
// (`denied`): the site folder through the file tools (the tokens, the links, the conversations); and
// the tools that reach beyond this agent, to the operator's Claude account and their other sessions
// (remote triggers, messages to other sessions, crons, workflows, worktrees). The shell is not
// confined by these rules: it is trusted, and what keeps one person's words from another is the
// ground rules (prompt.ts, hostedPrompt), not a wall — SECURITY.md says so. What a turn's shell leaves
// running goes with the turn (its process group). VisualProof's MCP server alone is its MCP server
// (`--strict-mcp-config`); a configuration folder of each session's own (CLAUDE_CONFIG_DIR: nothing of
// the server user's settings, hooks, plugins or memory, nor of another conversation's), no CLAUDE.md
// read (CLAUDE_CODE_DISABLE_CLAUDE_MDS: one in a folder above would be), no auto-memory, no bundled
// skills, no auto-update. The MCP server is the very file agents download (mcp/visualproof-mcp.mjs),
// with the agent's token, at this server's address on this machine, its files in the conversation's
// folder (VISUALPROOF_FILES). Nothing secret is on a command line: the agent's token is in mcp.json
// (0600), the Claude token in the environment, the messages on stdin.
//
// Its folder, `<cache>/agents/<token id>/` (0700), holds one folder per conversation: `public/`, and
// `p-<16 hex>/` for a person's (their channel's digest). Each has `work/` (the empty folder it runs
// in), `claude/` (its Claude Code configuration and session), `files/`, `mcp.json`, `prompt.md` (its
// ground rules, appended to Claude Code's system prompt), `session.json`, and `batch.json` while
// something is not answered: what a stop of the server cut short, or what waited for the usage limit
// or a refused token, is handed again once at the next start, saying so.
//
// What can go wrong is said where it was asked, as the agent's message, per conversation: the token
// refused (the agent is then offline for everyone until the operator fixes the file and restarts),
// the usage limit reached (it answers once the limit resets: the batch waits, and so does what comes
// meanwhile, said once in each conversation that waits), a turn past its time, a session Claude Code
// no longer has (a new one, once), Claude Code missing or failing.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { DETACH, end, grouped } from "./children.ts";
import { earlierOf, isPersonal, PUBLIC } from "./talk.ts";
import type { Message, Talk } from "./talk.ts";
import type { AgentTokens, TokenRecord } from "./tokens.ts";
import { hostedPrompt } from "./prompt.ts";
import { mentioned } from "../shared/mentions.ts";
import type { AgentTalk, ChannelKind } from "../shared/collab.ts";

/** how long a turn may take before it is stopped */
export const TURN_MS = 60 * 60_000;
/** how many model turns (tool calls and answers) one batch may take */
export const MAX_TURNS = 100;
/** how many turns run at once, every conversation together (the owner's decision of 2026-11-08) */
export const MAX_RUNNING = 3;
/** a usage limit whose reset Claude Code did not say is tried again after this */
const LIMIT_RETRY_MS = 15 * 60_000;
/** What the server's agent is denied, by Claude Code's permission rules: the site folder through the
 *  file tools, and the tools that reach the operator's Claude account or their other sessions. A
 *  rule's absolute path starts with `//`. */
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

/** What the agents' API asks of the turns (server/agenttalk.ts): which conversation a request's turn
 *  answers (X-VisualProof-Turn), and what it does there. */
export interface Turns {
  /** the turn `turn` names, while it runs: its channel (PUBLIC, or a person's) and its kind */
  turnOf(turn: string | undefined): { channel: string; kind: ChannelKind } | null;
  /** a request of the turn's: what it shows it doing */
  seen(turn: string | undefined, doing: string | null): void;
  /** the line the turn set (POST /api/agent/status), its conversation's state after */
  setStatus(turn: string | undefined, text: string | null): AgentTalk | null;
  /** the turn replied (POST /api/agent/reply) */
  replied(turn: string | undefined): void;
}

export interface HostedOptions {
  /** where the agents' folders are: `<cache>/agents` */
  root: string;
  /** Claude Code's `claude`; null: there is none, and the agent is offline */
  claude: string | null;
  /** the operator's Claude Code OAuth token (--claude-oauth): given to its processes alone */
  claudeToken: string;
  /** the server's agent's own token (server/serveragent.ts) */
  record: TokenRecord;
  talk: Talk;
  tokens: AgentTokens;
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
  /** a turn's longest time, its model turns, how many run at once (tests change them) */
  turnMs?: number;
  maxTurns?: number;
  maxRunning?: number;
  /** Node, to run the MCP server with */
  node?: string;
}

/** Something a conversation's next turn answers: a message rendered as the agent is handed it, by
 *  its id in its channel; `again` where a stop of the server cut it short once already. */
interface Item {
  id: number;
  text: string;
  again?: true;
}

/** One conversation of the agent, each its own Claude Code session: a person's private channel, or
 *  the public channel's mentions of it. */
interface Session {
  /** its channel in server/talk.ts: PUBLIC, or the person's (personalChannel) */
  channel: string;
  dir: string;
  /** the person it is with, by the name they last wrote under; null: the public channel */
  with: string | null;
  /** its Claude Code session, and whether a turn of it ran (so that the next resumes it) */
  session: string;
  started: boolean;
  /** what the running turn answers, and what came since, for the next */
  batch: Item[];
  pending: Item[];
  /** what its last turn was handed of its channel: messages after it are not read yet */
  handed: number;
  /** said before the next batch: that the server stopped while it was answered */
  notes: string[];
  /** waiting its turn since then, oldest first; null where it has nothing to answer or runs */
  waiting: number | null;
  turn: Turn | null;
  /** the usage limit was said in this conversation since it was reached */
  toldLimit: boolean;
  /** its state as last told, and since when it holds */
  told: AgentTalk | null;
  since: number;
}

/** One turn running: what it is called (VISUALPROOF_TURN), its process, why it ends early, and what
 *  it does. */
interface Turn {
  id: string;
  child: ChildProcess | null;
  why: "stop" | "time" | "new" | null;
  started: number;
  replied: boolean;
  doing: string | null;
  status: string | null;
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

export class Hosted implements Turns {
  /** the agent's token's id */
  readonly id: string;
  /** told when the state of a person's conversation changed, for their pages (server/live.ts) */
  onSession: (channel: string, talk: AgentTalk) => void = () => {};
  private o: HostedOptions;
  private dir: string;
  private sessions = new Map<string, Session>();
  private turns = new Map<string, Session>();
  private closed = false;
  /** why it cannot run: Claude Code missing, or its token refused; null while it can */
  private down: string | null;
  /** the usage limit: no turn before then */
  private pausedUntil = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  /** its state as a whole, as presence was last told it, and since when */
  private told: { state: AgentTalk["state"]; since: number } = { state: "listening", since: Date.now() };
  private lastSeen: number | null = null;
  private readonly born = Date.now();

  constructor(o: HostedOptions) {
    this.o = o;
    this.id = o.record.id;
    this.dir = join(o.root, this.id);
    this.down = o.claude ? null : "Claude Code (claude) is not on the server's machine";
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  /** Whether it can run: Claude Code is here, and its token was not refused. */
  get available(): boolean {
    return this.down === null && !this.closed;
  }

  /** Why it cannot run, where it cannot. */
  get offline(): string | null {
    return this.down;
  }

  /** Whether a turn runs now (the server waits for none to restart into a patch). */
  get busy(): boolean {
    return this.turns.size > 0;
  }

  /** How many turns run now, and the conversations waiting their turn, oldest first (tests). */
  get running(): number {
    return this.turns.size;
  }
  get queue(): string[] {
    return this.waiting().map((s) => s.channel);
  }

  /** The conversations of the last run, at the server's start: each session resumed where it was,
   *  and what a stop cut short handed again once, saying so. */
  restore(): void {
    let names: string[] = [];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const kept = readJson<{ channel?: unknown; session?: unknown; started?: unknown; with?: unknown; handed?: unknown }>(join(this.dir, name, "session.json"));
      const channel = typeof kept?.channel === "string" ? kept.channel : null;
      if (!channel || subOf(channel, this.id) !== name) continue;
      const s = this.session(channel, typeof kept!.with === "string" ? kept!.with : null);
      if (typeof kept!.session === "string" && /^[0-9a-f-]{36}$/.test(kept!.session)) s.session = kept!.session;
      s.started = kept!.started === true;
      s.handed = typeof kept!.handed === "number" ? kept!.handed : 0;
      const cut = readJson<{ items?: unknown }>(join(s.dir, "batch.json"));
      const items = Array.isArray(cut?.items) ? (cut!.items as Item[]).filter((x) => x && typeof x.id === "number" && typeof x.text === "string") : [];
      const dropped = items.filter((x) => x.again).length;
      if (dropped) this.o.log(`  the server's agent: ${dropped} message${dropped === 1 ? "" : "s"} cut short by a stop twice, not handed again`);
      s.pending = items.filter((x) => !x.again).map((x) => ({ id: x.id, text: x.text, again: true }));
      if (s.pending.length) {
        s.notes = ["(VisualProof stopped while you were answering what follows, or it waited for the usage limit or its token: answer it now.)"];
        s.waiting = Date.now();
      }
      this.saveSession(s);
      this.saveBatch(s);
    }
    this.pump();
  }

  // ---------------------------------------------------------------- what is written to it

  /** A message was written (server/talk.ts, onPosted): a person's in their channel with it, or one
   *  in the public channel that mentions it, goes in that conversation's next turn; a divider in a
   *  person's channel starts a new conversation there. */
  posted(channel: string, m: Message & { to?: string[] }): void {
    if (this.closed) return;
    if (channel === PUBLIC) {
      if (m.kind !== "person" || !m.to?.includes(this.id)) return;
      this.add(this.session(PUBLIC, null), m);
      return;
    }
    if (!isPersonal(channel) || !channel.startsWith(`${this.id}-`)) return;
    if (m.kind === "person") this.add(this.session(channel, m.from), m);
    else if (m.kind === "divider") this.renew(this.session(channel, m.from));
  }

  private add(s: Session, m: Message): void {
    if (s.channel !== PUBLIC) s.with = m.from;
    s.pending.push({ id: m.id, text: said(m) });
    s.waiting ??= Date.now();
    this.saveBatch(s);
    this.changed(s);
    this.pump();
  }

  /** A new conversation in a person's channel: a new session for it alone, and what came before
   *  gone from it — a turn running stops, its answer with it. */
  private renew(s: Session): void {
    if (s.turn) {
      s.turn.why = "new";
      if (s.turn.child) end(s.turn.child);
    }
    s.session = randomUUID();
    s.started = false;
    s.batch = [];
    s.pending = [];
    s.notes = [];
    s.waiting = null;
    rmSync(join(s.dir, "batch.json"), { force: true });
    this.saveSession(s);
    this.changed(s);
  }

  /** The conversation of `channel`, made where there is none yet. */
  private session(channel: string, who: string | null): Session {
    let s = this.sessions.get(channel);
    if (!s) {
      const dir = join(this.dir, subOf(channel, this.id));
      for (const d of [dir, join(dir, "work"), join(dir, "claude"), join(dir, "files")]) mkdirSync(d, { recursive: true, mode: 0o700 });
      s = { channel, dir, with: who, session: randomUUID(), started: false, batch: [], pending: [], handed: 0, notes: [], waiting: null, turn: null, toldLimit: false, told: null, since: Date.now() };
      this.sessions.set(channel, s);
      this.saveSession(s);
    }
    return s;
  }

  // ---------------------------------------------------------------- turns

  /** The conversations waiting their turn, oldest first. */
  private waiting(): Session[] {
    return [...this.sessions.values()].filter((s) => s.waiting !== null && !s.turn && s.pending.length).sort((a, b) => a.waiting! - b.waiting!);
  }

  /** Start what may start: the oldest waiting, while fewer than MAX_RUNNING run, the usage limit not
   *  in the way. A conversation the limit holds is told so, once. */
  private pump(): void {
    if (this.closed || this.down) return;
    const now = Date.now();
    if (this.pausedUntil > now) {
      for (const s of this.waiting())
        if (!s.toldLimit) {
          s.toldLimit = true;
          this.say(s, limitWords(this.pausedUntil));
        }
      if (!this.limitTimer) {
        this.limitTimer = setTimeout(() => {
          this.limitTimer = null;
          for (const s of this.sessions.values()) s.toldLimit = false;
          this.pump();
        }, this.pausedUntil - now + 50);
        this.limitTimer.unref?.();
      }
      return;
    }
    const max = this.o.maxRunning ?? MAX_RUNNING;
    for (const s of this.waiting()) {
      if (this.turns.size >= max) break;
      void this.run(s).catch((e) => this.o.log(`the server's agent: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  /** One turn of a conversation: what it was handed, answered in its session; then the next. */
  private async run(s: Session): Promise<void> {
    const rec = this.o.tokens.get(this.id);
    const vpa = this.o.tokens.token(this.id);
    const address = this.o.address();
    if (!rec || !vpa || !address) return;
    const turn: Turn = { id: randomUUID(), child: null, why: null, started: Date.now(), replied: false, doing: null, status: null };
    s.batch = s.pending.splice(0);
    s.handed = Math.max(s.handed, ...s.batch.map((x) => x.id));
    s.waiting = null;
    s.turn = turn;
    this.turns.set(turn.id, s);
    this.lastSeen = Date.now();
    this.saveSession(s);
    this.saveBatch(s);
    this.changed(s);
    try {
      this.prepare(s, rec, vpa.token, address, turn.id);
      let out = await this.spawn(s, turn, this.text(s, rec));
      // a session Claude Code no longer has (its folder was cleared): a new one, once, told what
      // came before in its conversation
      if (out.noSession && !turn.why && !this.closed) {
        s.session = randomUUID();
        s.started = false;
        this.saveSession(s);
        out = await this.spawn(s, turn, this.text(s, rec));
      }
      this.after(s, rec, turn, out);
    } finally {
      this.turns.delete(turn.id);
      if (s.turn === turn) s.turn = null;
      this.lastSeen = Date.now();
      if (!this.closed) {
        if (s.pending.length && s.waiting === null) s.waiting = Date.now();
        s.since = Date.now();
        this.changed(s);
        this.pump();
      }
    }
  }

  /** What a turn came to, said where it was asked: its answer, or why there is none. */
  private after(s: Session, rec: TokenRecord, turn: Turn, out: Outcome): void {
    // the server stopped (the batch stays in batch.json, for the next start), or a new
    // conversation began meanwhile (nothing of this one stays)
    if (this.closed || turn.why === "new") return;
    const say = (text: string) => this.say(s, text);
    const keep = () => {
      s.pending = [...s.batch, ...s.pending];
      s.batch = [];
      s.waiting = Date.now();
      this.saveBatch(s);
    };
    if (out.spawnError) {
      keep();
      this.fail(`Claude Code could not be started on the server (${out.spawnError})`);
      return say(`I cannot run: Claude Code could not be started on the server (${out.spawnError}). The server's operator can fix it and restart the server; I answer then.`);
    }
    if (out.refused) {
      keep();
      this.fail("Claude Code refused the server's Claude token (expired, or revoked)");
      return say("I cannot answer: Claude Code refused this server's Claude token (expired, or revoked). The server's operator gives it a new one (--claude-oauth) and restarts the server; I answer what you wrote then.");
    }
    if (out.limit) {
      keep();
      this.pausedUntil = Math.max(this.pausedUntil, out.limit.resetsAt ?? Date.now() + LIMIT_RETRY_MS);
      s.toldLimit = true;
      return say(limitWords(this.pausedUntil));
    }
    s.started = true;
    s.batch = [];
    s.notes = [];
    this.saveSession(s);
    this.saveBatch(s);
    if (turn.why === "stop") return;
    if (turn.why === "time") return say(`I was stopped: my answer took longer than ${Math.round((this.o.turnMs ?? TURN_MS) / 60_000)} minutes.`);
    const res = out.result;
    if (!res || res.is_error || out.exit !== 0) {
      const line = (res?.result ?? "").split("\n")[0].slice(0, 300) || `it exited with ${out.exit}`;
      return say(`Claude Code failed on the server: ${line}`);
    }
    // the answer is the reply tool's; a turn that replied nothing says its last words instead
    const last = (res.result ?? "").trim();
    if (!out.replied && !turn.replied && last) say(last);
  }

  /** It cannot run: offline for everyone, until the operator fixes it and restarts the server. */
  private fail(why: string): void {
    if (this.down) return;
    this.down = why;
    this.o.log(`the server's agent is offline: ${why}`);
    this.o.talk.refresh(this.id);
    for (const s of this.sessions.values()) this.changed(s);
  }

  /** What a turn hands Claude Code: a first line that is never a slash command, what came before
   *  where its session does not hold it, what is to be answered, and how to answer. */
  private text(s: Session, rec: TokenRecord): string {
    const n = s.batch.length;
    const pub = s.channel === PUBLIC;
    const from = pub ? "from the public channel, mentioning you" : `from ${s.with ?? "a person"}, in your private conversation with them`;
    const head = `${n === 1 ? "A message" : `${n} messages, in order,`} ${from}:`;
    const how = pub
      ? "Answer with the reply tool: it goes to the public channel, which everyone with a name reads."
      : `Answer with the reply tool: it goes back to this conversation, which ${s.with ?? "they"} alone ${s.with ? "reads" : "read"} (channel "public" writes in the public channel instead, which everyone reads: never repeat there what was said here).`;
    return [
      `VisualProof — ${head}`,
      ...this.context(s),
      ...s.notes,
      ...s.batch.map((x) => x.text),
      `${how} Move your own view to what you explain first (the view tool). You are ${rec.name}; then end your turn: the next messages come by themselves.`,
    ].join("\n\n");
  }

  /** What came before in a person's conversation, for a session that does not hold it (a new one
   *  that replaced one lost): its channel since the last divider, before what is handed now. */
  private context(s: Session): string[] {
    if (s.started || s.channel === PUBLIC) return [];
    const first = Math.min(...s.batch.map((x) => x.id).filter((id) => id > 0), Infinity);
    const told = this.o.talk.conversation(s.channel).messages.filter((m) => m.id < first && m.kind !== "divider");
    const e = earlierOf(told, true);
    return e ? [e.text] : [];
  }

  /** The conversation's folder, ready for a turn: the MCP server, its configuration (with the turn
   *  it is) and the ground rules, written afresh (the server's address and version may have changed). */
  private prepare(s: Session, rec: TokenRecord, vpa: string, address: string, turn: string): void {
    const mcp = join(s.dir, "visualproof-mcp.mjs");
    writeFileSync(mcp, this.o.mcpServer(), { mode: 0o600 });
    const config = {
      mcpServers: {
        visualproof: {
          type: "stdio",
          command: this.o.node ?? process.execPath,
          args: [mcp],
          env: { VISUALPROOF_URL: address, VISUALPROOF_TOKEN: vpa, VISUALPROOF_FILES: join(s.dir, "files"), VISUALPROOF_WAIT_SECONDS: "50", VISUALPROOF_TURN: turn },
        },
      },
    };
    writeFileSync(join(s.dir, "mcp.json"), JSON.stringify(config), { mode: 0o600 });
    writeFileSync(
      join(s.dir, "prompt.md"),
      hostedPrompt({ record: rec, with: s.channel === PUBLIC ? null : (s.with ?? "a person"), project: this.o.project(), root: this.o.projectRoot(), files: join(s.dir, "files"), site: this.o.site, followed: this.o.followed?.() ?? null }),
      { mode: 0o600 },
    );
  }

  /** One `claude -p` of the conversation's session, `text` on stdin, read as stream-json. */
  private spawn(s: Session, turn: Turn, text: string): Promise<Outcome> {
    const out: Outcome = { exit: null, result: null, replied: false, refused: false, limit: null, noSession: false, spawnError: null };
    const args = [
      "-p", "--output-format", "stream-json", "--verbose",
      ...(s.started ? ["--resume", s.session] : ["--session-id", s.session]),
      "--strict-mcp-config", "--mcp-config", join(s.dir, "mcp.json"),
      "--add-dir", this.o.projectRoot(),
      "--permission-mode", "bypassPermissions", "--permission-prompts", "none",
      "--disallowedTools", ...denied(this.o.site),
      "--max-turns", String(this.o.maxTurns ?? MAX_TURNS),
      "--append-system-prompt-file", join(s.dir, "prompt.md"),
    ];
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? homedir(),
      LANG: process.env.LANG ?? "C.UTF-8",
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      CLAUDE_CONFIG_DIR: join(s.dir, "claude"),
      CLAUDE_CODE_OAUTH_TOKEN: this.o.claudeToken,
      ...QUIET,
    };
    const started = s.started;
    return new Promise<Outcome>((done) => {
      let child: ChildProcess;
      try {
        child = grouped(spawn(this.o.claude!, args, { cwd: join(s.dir, "work"), env, stdio: ["pipe", "pipe", "pipe"], detached: DETACH }));
      } catch (e) {
        out.spawnError = e instanceof Error ? e.message : String(e);
        return done(out);
      }
      turn.child = child;
      // stopped meanwhile (Stop, a new conversation, the server's stop) before it began
      if (turn.why || this.closed) end(child);
      const timer = setTimeout(() => {
        turn.why ??= "time";
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
        if (started && !out.result?.result && /no conversation found/i.test(err)) out.noSession = true;
        else if (started && out.result?.is_error && /no conversation found/i.test(out.result.result ?? "")) out.noSession = true;
        if (code !== 0 && !out.result && err.trim() && !out.noSession && !turn.why)
          this.o.log(`the server's agent: claude: ${err.trim().split("\n").slice(-3).join(" / ").split(this.o.claudeToken).join("<token>")}`);
        done(out);
      });
    });
  }

  /** The agent's message in a conversation: a person's channel, or the public one. */
  private say(s: Session, text: string): void {
    const rec = this.o.tokens.get(this.id);
    if (!rec) return;
    const mentions = mentioned(text, this.o.mentionable());
    this.o.talk.post(s.channel, { from: rec.name, kind: "agent", text, ...(mentions.length ? { mentions } : {}) }, this.id);
  }

  // ---------------------------------------------------------------- people's controls

  /** A person's Stop (POST /api/chat/stop), in their own conversation: its turn ends, and what it
   *  was answering with it. False where none runs. */
  stopTurn(channel: string): boolean {
    const t = this.sessions.get(channel)?.turn;
    if (!t || t.why) return false;
    t.why = "stop";
    if (t.child) end(t.child);
    return true;
  }

  /** Its token ended (it is never revoked from the page; a test may): every turn stops, its folder goes. */
  ended(id: string): void {
    if (id !== this.id) return;
    this.close();
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** The server stops: every turn with it (each batch kept, to be handed again at the next start). */
  close(): void {
    this.closed = true;
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    for (const s of this.turns.values()) if (s.turn?.child) end(s.turn.child);
  }

  // ---------------------------------------------------------------- the turns, for the agents' API

  turnOf(turn: string | undefined): { channel: string; kind: ChannelKind } | null {
    const s = turn ? this.turns.get(turn) : undefined;
    return s ? { channel: s.channel, kind: s.channel === PUBLIC ? "public" : "private" } : null;
  }

  seen(turn: string | undefined, doing: string | null): void {
    const s = turn ? this.turns.get(turn) : undefined;
    this.lastSeen = Date.now();
    if (!s?.turn || doing === null || s.turn.doing === doing) return;
    s.turn.doing = doing;
    this.changed(s);
  }

  setStatus(turn: string | undefined, text: string | null): AgentTalk | null {
    const s = turn ? this.turns.get(turn) : undefined;
    if (!s?.turn) return null;
    s.turn.status = text || null;
    this.changed(s);
    return this.sessionTalk(s.channel);
  }

  replied(turn: string | undefined): void {
    const s = turn ? this.turns.get(turn) : undefined;
    if (!s?.turn) return;
    s.turn.replied = true;
    s.turn.doing = null;
    s.turn.status = null;
    this.changed(s);
  }

  // ---------------------------------------------------------------- states

  /** Its state as a whole, as presence lists it: offline where it cannot run; thinking while a turn
   *  has not replied yet, working while turns run that did; listening otherwise. What it does is
   *  shown only of the public conversation's turn: a person's is theirs (`sessionTalk`). */
  talk(now = Date.now()): AgentTalk {
    const running = [...this.turns.values()].map((s) => s.turn!).filter(Boolean);
    const state: AgentTalk["state"] = this.down ? "offline" : running.some((t) => !t.replied) ? "thinking" : running.length ? "working" : "listening";
    if (state !== this.told.state) this.told = { state, since: now };
    const pub = this.sessions.get(PUBLIC);
    const t = pub?.turn ?? null;
    return {
      state,
      since: new Date(this.told.since).toISOString(),
      doing: t && state !== "offline" ? t.doing : null,
      status: t && state !== "offline" ? t.status : null,
      read: 0,
      readPublic: pub?.handed ?? 0,
      lastSeen: running.length ? new Date(now).toISOString() : this.lastSeen === null ? null : new Date(this.lastSeen).toISOString(),
    };
  }

  /** Its state in one conversation (a person's channel), as that person's tab shows it: offline where
   *  it cannot run; thinking while its turn runs (working once it replied), with what it does;
   *  waiting its turn (`queued`) while other conversations' turns take all there is; listening. */
  sessionTalk(channel: string, now = Date.now()): AgentTalk {
    const s = this.sessions.get(channel);
    const t = s?.turn ?? null;
    const base = { read: s?.handed ?? 0, readPublic: this.sessions.get(PUBLIC)?.handed ?? 0, lastSeen: this.lastSeen === null ? null : new Date(this.lastSeen).toISOString() };
    const at = (ms: number) => new Date(ms).toISOString();
    if (this.down) return { state: "offline", since: at(s?.since ?? this.born), doing: null, status: null, ...base };
    if (t) return { state: t.replied ? "working" : "thinking", since: at(t.started), doing: t.doing, status: t.status, ...base, lastSeen: at(now) };
    if (s && s.waiting !== null) return { state: "thinking", since: at(s.waiting), doing: null, status: null, ...base, queued: true };
    return { state: "listening", since: at(s?.since ?? this.born), doing: null, status: null, ...base };
  }

  /** A conversation's state may have changed: its person's pages are told where it did, and
   *  presence the agent's as a whole. */
  private changed(s: Session): void {
    this.o.talk.refresh(this.id);
    if (s.channel === PUBLIC) return;
    const t = this.sessionTalk(s.channel);
    const was = s.told;
    s.told = t;
    if (!was || was.state !== t.state || was.since !== t.since || was.doing !== t.doing || was.status !== t.status || was.read !== t.read || was.queued !== t.queued) this.onSession(s.channel, t);
  }

  private saveSession(s: Session): void {
    writeFileSync(join(s.dir, "session.json"), JSON.stringify({ channel: s.channel, session: s.session, started: s.started, with: s.with, handed: s.handed }), { mode: 0o600 });
  }

  /** What is not answered yet — the running turn's batch, what came since — kept for a start after a
   *  stop; nothing kept where everything is answered. */
  private saveBatch(s: Session): void {
    const items = [...s.batch, ...s.pending];
    if (!items.length) return void rmSync(join(s.dir, "batch.json"), { force: true });
    writeFileSync(join(s.dir, "batch.json"), JSON.stringify({ items }), { mode: 0o600 });
  }
}

/** A conversation's folder: `public`, or a person's by their channel's digest. */
function subOf(channel: string, token: string): string {
  return channel === PUBLIC ? "public" : `p-${channel.slice(token.length + 1).replace(/[^0-9a-f]/g, "")}`;
}

/** The usage limit, in the agent's words, with when it resets. */
function limitWords(at: number): string {
  return `The Claude usage limit of this server's account is reached: I answer once it resets, ${new Date(at).toISOString().replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC")}. What you write meanwhile waits.`;
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

/** A person's message as the agent is handed it, as wait_for_message words it
 *  (mcp/visualproof-mcp.mjs): in a person's own conversation, or the public channel's mention. */
function said(m: Message): string {
  const where = m.where?.inWords ? `, on ${m.where.inWords.replace(/\.$/, "")}` : "";
  const how = m.channel === "public" ? " in the public channel, mentioning you" : " to you, in your private conversation with them";
  return `${m.from} wrote${how}${where} (${m.channel === "public" ? "public " : ""}message ${m.id}, ${m.at}):\n${m.text}`;
}

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  } catch {
    return null;
  }
}
