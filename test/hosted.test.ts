// Agents the server runs (AgentSpec decision 10; the owner's decisions of 2026-11-08, experimental,
// --claude-oauth), on a stand-in for Claude Code (test/fakeclaude.mjs) that speaks to the real MCP
// server: a person's Claude Code token, given once from a page over HTTPS or on this machine, under a
// name that is theirs alone, never answered back; agents that answer in their private channel and the
// public one, one turn per batch, with VisualProof's tools alone and nothing secret on a command line;
// a new session per new conversation; a refused token, the usage limit, Stop, Revoke, a stop of the
// server, a session gone; files held to the agent's folder; credentials kept from every other program.

import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mcpServerText } from "../src/server/agententry.ts";
import { childEnv } from "../src/server/children.ts";
import { Hosted, PER_PERSON } from "../src/server/hosted.ts";
import { mcpInstructions } from "../src/server/mcptools.ts";
import { UNTIL_STOPPED } from "../src/shared/collab.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

const TOKEN = "sk-ant-oat01-" + "Ab3_x-".repeat(15) + "Zz9qQ";
const TOKEN2 = "sk-ant-oat01-" + "Qr7-y_".repeat(15) + "Kk2wW";
const ALICE = { "x-visualproof-name": "Alice" };
const BOB = { "x-visualproof-name": "Bob" };

type Site = Awaited<ReturnType<typeof site>>;

/** A site whose server runs agents (--claude-oauth) on the stand-in for Claude Code. */
async function hostedSite(opts: Parameters<typeof site>[0] & { turnMs?: number } = {}) {
  const S = await site(opts);
  const bin = mkdtempSync(join(tmpdir(), "vp-claude-"));
  copyFileSync(new URL("./fakeclaude.mjs", import.meta.url), join(bin, "claude"));
  chmodSync(join(bin, "claude"), 0o755);
  const make = () =>
    new Hosted({
      root: join(S.dir, "agents"),
      claude: join(bin, "claude"),
      talk: S.live.talk,
      tokens: S.live.tokens,
      claudeTokens: S.live.claudeTokens,
      address: () => S.base,
      mcpServer: mcpServerText,
      mentionable: () => S.live.mentionable().names,
      project: () => "M",
      log: () => {},
      turnMs: opts.turnMs,
    });
  S.live.hosted = make();
  const behave = (b: Json) => writeFileSync(join(bin, "behave.json"), JSON.stringify(b));
  behave({ mode: "reply" });
  const calls = (): Json[] => (existsSync(join(bin, "calls.jsonl")) ? readFileSync(join(bin, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  const close = async () => {
    S.live.hosted?.close();
    await S.close();
    rmSync(bin, { recursive: true, force: true });
  };
  return { ...S, bin, make, behave, calls, close };
}

const give = (S: Site, who: Record<string, string> = ALICE, token = TOKEN, origin: string | null = S.base) => S.ask("POST", "/api/share/claude", { token }, { ...who, ...(origin ? { origin } : {}) });

/** An agent the server runs, made as Share makes one: its token's id, its presence id, its name. */
async function runHere(S: Site, who: Record<string, string> = ALICE, body: Json = {}) {
  const r = await S.ask("POST", "/api/share/agents", { runs: "server", ...body }, who);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json!.token.id as string;
  const agent = S.live.presence.list().find((p) => p.agent && p.name === r.json!.token.name)!.id;
  return { id, agent, name: r.json!.token.name as string, json: r.json! };
}

const until = async (f: () => boolean | Promise<boolean>, what: string, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((ok) => setTimeout(ok, 25))) if (await f()) return;
  assert.fail(`waited in vain: ${what}`);
};
const thread = async (S: Site, channel: string, who: Record<string, string> = ALICE) => ((await S.ask("GET", `/api/chat?channel=${encodeURIComponent(channel)}`, undefined, who)).json!.messages ?? []) as Json[];
const said = async (S: Site, channel: string, re: RegExp, who: Record<string, string> = ALICE) => (await thread(S, channel, who)).some((m) => m.kind === "agent" && re.test(m.text));

test("a Claude Code token: given once, from a page over HTTPS or on this machine, never answered back, kept for the server's user alone; no API key", async () => {
  const plain = await site();
  try {
    assert.equal((await plain.ask("GET", "/api/share/agents", undefined, ALICE)).json!.server, null, "no --claude-oauth: nothing of it");
    assert.equal((await give(plain)).status, 404);
  } finally {
    await plain.close();
  }
  const S = await hostedSite();
  try {
    assert.deepEqual((await S.ask("GET", "/api/share/agents", undefined, ALICE)).json!.server, { available: true, refused: null, token: null, perPerson: PER_PERSON });
    assert.equal((await give(S, ALICE, TOKEN, null)).status, 403, "no Origin: not a page over HTTPS or on this machine");
    assert.equal((await give(S, {})).status, 401, "a name first");
    assert.equal((await S.ask("POST", "/api/share/claude", { token: TOKEN }, { ...ALICE, origin: S.base, "x-visualproof-kind": "agent" })).status, 403, "never an agent");
    const key = await give(S, ALICE, "sk-ant-api03-" + "k".repeat(90));
    assert.equal(key.status, 400);
    assert.match(key.json!.error, /API key/);
    assert.equal((await give(S, ALICE, "hunter2")).status, 400);
    const r = await give(S);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json!.token.refused, null);
    const listed = await S.ask("GET", "/api/share/agents", undefined, ALICE);
    assert.ok(listed.json!.server.token.given);
    for (const answer of [r.json, listed.json]) assert.ok(!JSON.stringify(answer).includes(TOKEN.slice(13)), "never answered back");
    assert.equal((await S.ask("GET", "/api/share/agents", undefined, BOB)).json!.server.token, null, "Alice's, not Bob's");
    const file = join(S.dir, "state", "claude-tokens.json");
    assert.ok(readFileSync(file, "utf8").includes(TOKEN));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal((await S.ask("POST", "/api/share/claude/remove", {}, ALICE)).status, 200);
    assert.equal((await S.ask("POST", "/api/share/claude/remove", {}, ALICE)).status, 404);
    assert.ok(!readFileSync(file, "utf8").includes(TOKEN));
  } finally {
    await S.close();
  }
});

test("only someone whose name is theirs alone runs agents on the server, and gives a token over HTTPS only, but on this machine", async () => {
  // with the key, a name is anyone's who gives it: no token, no agent on the server
  const K = await hostedSite({ key: "k".repeat(40) });
  try {
    const A = { ...ALICE, authorization: `Bearer ${"k".repeat(40)}` };
    assert.match((await K.ask("GET", "/api/share/agents", undefined, A)).json!.server.refused, /personal link/);
    assert.equal((await give(K, A)).status, 403);
    assert.equal((await K.ask("POST", "/api/share/agents", { runs: "server" }, A)).status, 403);
  } finally {
    await K.close();
  }
  // behind a sign-in, the name is the sign-in's: over HTTPS, a token; over plain HTTP, none
  for (const [publicUrl, ok] of [["https://vp.example.org", 200], ["http://vp.example.org", 403]] as const) {
    const P = await hostedSite({ identityHeader: "x-user", publicUrl });
    try {
      const r = await give(P, { "x-user": "Alice" }, TOKEN, publicUrl);
      assert.equal(r.status, ok, `${publicUrl}: ${JSON.stringify(r.json)}`);
      if (ok !== 200) assert.equal(r.json!.insecure, true);
    } finally {
      await P.close();
    }
  }
});

test("an agent the server runs answers in its private channel and the public one, with VisualProof's tools alone and nothing secret on Claude Code's command line", async () => {
  const S = await hostedSite();
  const saved = { a: process.env.ANTHROPIC_API_KEY, c: process.env.CLAUDE_CODE_OAUTH_TOKEN };
  process.env.ANTHROPIC_API_KEY = "sk-ant-api03-the-servers-own";
  process.env.CLAUDE_CODE_OAUTH_TOKEN = TOKEN2;
  try {
    const no = await S.ask("POST", "/api/share/agents", { runs: "server" }, ALICE);
    assert.equal(no.status, 409, "a Claude token first");
    assert.equal(no.json!.claudeToken, true);
    await give(S);
    const a = await runHere(S);
    assert.equal(a.json.token.runs, "server");
    assert.equal(a.json.token.expires, UNTIL_STOPPED, "until revoked");
    assert.ok(!("prompt" in a.json), "no prompt");
    assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id: a.id }, ALICE)).status, 400);
    await until(() => S.live.talk.state(a.id) === "listening", "listening");
    const dir = join(S.dir, "agents", a.id);
    assert.equal(statSync(dir).mode & 0o777, 0o700);

    // its maker writes; it answers there, by the reply tool
    S.behave({ mode: "reply", text: "Hello Alice." });
    assert.equal((await S.ask("POST", "/api/chat", { channel: a.agent, text: "Hi, what is N.b?" }, ALICE)).status, 200);
    await until(() => said(S, a.agent, /^Hello Alice\.$/), "the answer");
    const [first] = S.calls();
    const args = first.args as string[];
    const at = (k: string) => args[args.indexOf(k) + 1];
    assert.equal(at("--tools"), "", "no tool of Claude Code's own");
    assert.ok(args.includes("--strict-mcp-config") && args.includes("-p"));
    assert.equal(at("--allowedTools"), "mcp__visualproof");
    assert.equal(at("--permission-mode"), "dontAsk");
    assert.equal(at("--disallowedTools"), "Agent");
    const session = at("--session-id");
    assert.match(session, /^[0-9a-f-]{36}$/);
    const vpa = S.live.tokens.token(a.id)!.token;
    for (const x of args) assert.ok(!x.includes(TOKEN) && !x.includes(vpa), `nothing secret on the command line: ${x}`);
    const env = first.env as Record<string, string>;
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, TOKEN, "its maker's token, not the server's");
    assert.equal(env.ANTHROPIC_API_KEY, undefined, "never an API key, which would win over the token");
    assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
    assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
    assert.equal(env.CLAUDE_CONFIG_DIR, join(dir, "claude"));
    assert.deepEqual(Object.keys(env).filter((k) => k.startsWith("VISUALPROOF_")), []);
    assert.equal(first.cwd, join(dir, "work"));
    assert.match(first.stdin, /^VisualProof — A message from the page:/, "never a slash command");
    assert.match(first.stdin, /Alice wrote to you, in your private channel/);
    assert.match(first.stdin, /Hi, what is N\.b\?/);
    await until(() => existsSync(join(S.bin, "tools.json")), "the tools listed");
    const tools = JSON.parse(readFileSync(join(S.bin, "tools.json"), "utf8")).tools as string[];
    assert.ok(tools.includes("reply") && !tools.includes("wait_for_message"), "the server listens for it");
    assert.equal(statSync(join(dir, "mcp.json")).mode & 0o777, 0o600);
    assert.match(readFileSync(join(dir, "prompt.md"), "utf8"), /run on the VisualProof server itself, on Alice's Claude Code/);
    await until(() => S.live.talk.state(a.id) === "listening", "listening again");

    // its next turn resumes the session
    S.behave({ mode: "reply", text: "Again." });
    await S.ask("POST", "/api/chat", { channel: a.agent, text: "And N.a?" }, ALICE);
    await until(() => said(S, a.agent, /^Again\.$/), "the second answer");
    assert.equal((S.calls()[1].args as string[])[(S.calls()[1].args as string[]).indexOf("--resume") + 1], session);

    // anyone mentions it in the public channel: it answers there
    S.behave({ mode: "reply", text: "N.b is defined from N.a." });
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: `@${a.name} what is N.b?` }, BOB)).status, 200);
    await until(() => said(S, "public", /^N\.b is defined/, BOB), "the public answer");
    assert.match(S.calls()[2].stdin, /Bob wrote in the public channel, mentioning you/);

    // a second agent of Alice's; a third is one too many
    await runHere(S);
    assert.equal((await S.ask("POST", "/api/share/agents", { runs: "server" }, ALICE)).status, 409);
  } finally {
    if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.c === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved.c;
    await S.close();
  }
});

test("a turn that replied nothing says its last words; a new conversation starts a new session; a session Claude Code no longer has, a new one", async () => {
  const S = await hostedSite();
  try {
    await give(S);
    const a = await runHere(S);
    await until(() => S.live.talk.state(a.id) === "listening", "listening");
    S.behave({ mode: "text", text: "Only words." });
    await S.ask("POST", "/api/chat", { channel: a.agent, text: "Hi" }, ALICE);
    await until(() => said(S, a.agent, /^Only words\.$/), "its last words");
    const first = (S.calls()[0].args as string[]).at((S.calls()[0].args as string[]).indexOf("--session-id") + 1);
    await until(() => S.live.talk.state(a.id) === "listening", "listening");
    assert.equal((await S.ask("POST", "/api/chat/new", { agent: a.agent }, ALICE)).status, 200);
    S.behave({ mode: "text", text: "Fresh." });
    await until(() => S.live.talk.state(a.id) === "listening", "listening after the divider");
    await S.ask("POST", "/api/chat", { channel: a.agent, text: "Start over" }, ALICE);
    await until(() => said(S, a.agent, /^Fresh\.$/), "the new session's answer");
    const args = S.calls().at(-1)!.args as string[];
    assert.ok(args.includes("--session-id") && !args.includes("--resume"), "a new session");
    assert.notEqual(args[args.indexOf("--session-id") + 1], first);
    // its folder cleared: a resume fails, and a new session answers
    S.behave({ mode: "nosession" });
    await until(() => S.live.talk.state(a.id) === "listening", "listening");
    await S.ask("POST", "/api/chat", { channel: a.agent, text: "Still there?" }, ALICE);
    await until(() => said(S, a.agent, /^A new session\.$/), "a new session");
    const [resumed, anew] = S.calls().slice(-2).map((c) => c.args as string[]);
    assert.ok(resumed.includes("--resume") && anew.includes("--session-id"));
  } finally {
    await S.close();
  }
});

test("Claude Code refusing the token: said where it was asked, the agent offline until its maker gives another, which answers what waited", async () => {
  const S = await hostedSite();
  try {
    await give(S);
    const a = await runHere(S);
    await until(() => S.live.talk.state(a.id) === "listening", "listening");
    S.behave({ mode: "refuse" });
    await S.ask("POST", "/api/chat", { channel: a.agent, text: "Are you there?" }, ALICE);
    await until(() => said(S, a.agent, /Claude Code refused Alice's token/), "the refusal");
    await until(() => !S.live.hosted!.running(a.id), "stopped");
    assert.ok((await S.ask("GET", "/api/share/agents", undefined, ALICE)).json!.server.token.refused, "Share says so");
    assert.equal(S.live.talk.state(a.id), "offline");
    S.behave({ mode: "reply", text: "Back, and answering: yes." });
    await give(S, ALICE, TOKEN2);
    await until(() => said(S, a.agent, /^Back, and answering: yes\.$/), "the answer to what waited");
    assert.equal(S.calls().at(-1)!.env.CLAUDE_CODE_OAUTH_TOKEN, TOKEN2);
    assert.match(S.calls().at(-1)!.stdin, /Are you there\?/);
  } finally {
    await S.close();
  }
});

test("the usage limit: said, and what waited is answered once it resets", async () => {
  const S = await hostedSite();
  try {
    await give(S);
    const a = await runHere(S);
    await until(() => S.live.talk.state(a.id) === "listening", "listening");
    S.behave({ mode: "limit", resetsAt: Math.ceil(Date.now() / 1000) + 2 });
    await S.ask("POST", "/api/chat", { channel: a.agent, text: "Explain N.b" }, ALICE);
    await until(() => said(S, a.agent, /usage limit is reached: I answer once it resets/), "the limit said");
    S.behave({ mode: "reply", text: "Now: N.b is N.a." });
    await until(() => said(S, a.agent, /^Now: N\.b is N\.a\.$/), "answered after the reset", 20_000);
    assert.match(S.calls().at(-1)!.stdin, /Explain N\.b/);
  } finally {
    await S.close();
  }
});

test("its maker's Stop ends a turn, and Revoke ends it and its folder", async () => {
  const S = await hostedSite();
  try {
    await give(S);
    const a = await runHere(S);
    await until(() => S.live.talk.state(a.id) === "listening", "listening");
    S.behave({ mode: "slow" });
    await S.ask("POST", "/api/chat", { channel: a.agent, text: "Take your time" }, ALICE);
    await until(() => S.live.hosted!.busy, "a turn");
    assert.equal(S.live.talk.state(a.id), "thinking");
    assert.equal((await S.ask("POST", "/api/chat/stop", { agent: a.agent }, BOB)).status, 403, "its maker's alone");
    const stop = await S.ask("POST", "/api/chat/stop", { agent: a.agent }, ALICE);
    assert.deepEqual(stop.json, { ok: true, stopped: true });
    await until(() => !S.live.hosted!.busy, "stopped");
    await until(() => S.live.talk.state(a.id) === "listening", "listening again");
    assert.ok(!(await thread(S, a.agent)).some((m) => m.kind === "agent"), "nothing said");
    await S.ask("POST", "/api/chat", { channel: a.agent, text: "Again, slowly" }, ALICE);
    await until(() => S.live.hosted!.busy, "a turn");
    assert.equal((await S.ask("POST", "/api/share/agents/revoke", { id: a.id }, BOB)).status, 200, "anyone with a name");
    await until(() => !S.live.hosted!.busy && !existsSync(join(S.dir, "agents", a.id)), "ended, its folder gone");
  } finally {
    await S.close();
  }
});

test("a stop of the server: the turn it cut short is answered at the next start, saying so", async () => {
  const S = await hostedSite();
  try {
    await give(S);
    const a = await runHere(S);
    await until(() => S.live.talk.state(a.id) === "listening", "listening");
    S.behave({ mode: "slow" });
    await S.ask("POST", "/api/chat", { channel: a.agent, text: "Before the restart" }, ALICE);
    await until(() => S.live.hosted!.busy, "a turn");
    S.live.hosted!.close();
    await until(() => !S.live.hosted!.busy, "stopped");
    S.behave({ mode: "reply", text: "After the restart." });
    S.live.hosted = S.make();
    S.live.hosted.restore();
    await until(() => said(S, a.agent, /^After the restart\.$/), "answered");
    assert.match(S.calls().at(-1)!.stdin, /VisualProof stopped while you were answering[\s\S]*Before the restart/);
  } finally {
    await S.close();
  }
});

test("the files its tools send stay in its folder: no other file of the machine, by a path, `..` or a symbolic link", async () => {
  const S = await hostedSite();
  try {
    await give(S);
    const a = await runHere(S);
    await until(() => S.live.talk.state(a.id) === "listening", "listening");
    const files = join(S.dir, "agents", a.id, "files");
    symlinkSync(join(S.dir, "state", "claude-tokens.json"), join(files, "tokens.pdf"));
    for (const path of ["../mcp.json", join(S.dir, "state", "claude-tokens.json"), "tokens.pdf"]) {
      rmSync(join(S.bin, "sent.json"), { force: true });
      S.behave({ mode: "send", path });
      await S.ask("POST", "/api/chat", { channel: a.agent, text: `send ${path}` }, ALICE);
      await until(() => existsSync(join(S.bin, "sent.json")), `sent ${path}`);
      const [answer] = JSON.parse(readFileSync(join(S.bin, "sent.json"), "utf8"));
      assert.equal(answer.isError, true, path);
      assert.match(answer.content[0].text, /name of a file in your folder/, path);
      await until(() => S.live.talk.state(a.id) === "listening", "listening");
    }
  } finally {
    await S.close();
  }
});

test("no program the server runs is given Claude's or Anthropic's credentials", () => {
  const saved = { ...process.env };
  try {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = TOKEN;
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-x";
    process.env.ANTHROPIC_BASE_URL = "https://example.org";
    process.env.VISUALPROOF_SUPERVISED = "1";
    const env = childEnv({ LEAN_PATH: "/x" });
    assert.deepEqual(Object.keys(env).filter((k) => k === "CLAUDE_CODE_OAUTH_TOKEN" || k.startsWith("ANTHROPIC_") || k.startsWith("VISUALPROOF_")), []);
    assert.equal(env.LEAN_PATH, "/x");
    assert.equal(env.PATH, process.env.PATH);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("the instructions of an agent the server runs say turns, not waits, within the 2,048 characters Claude Code keeps", () => {
  for (const level of ["read", "advise", "full"]) {
    const text = mcpInstructions({ name: "N".repeat(60), by: "B".repeat(60), level, expires: UNTIL_STOPPED, address: "http://127.0.0.1:4173", project: "flt_regular", hosted: true });
    assert.ok(text.length <= 2048, `${level}: ${text.length}`);
    assert.match(text, /end your turn/);
    assert.doesNotMatch(text, /wait_for_message|expires/);
  }
});
