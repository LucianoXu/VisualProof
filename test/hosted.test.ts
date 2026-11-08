// The server's own agent (AgentSpec decision 10; the owner's decisions of 2026-11-08 for 0.11,
// experimental, --claude-oauth), on a stand-in for Claude Code (test/fakeclaude.mjs) that speaks to
// the real MCP server: the operator's token read from a file only they can read, or the environment,
// never shown, logged or kept; the agent's own token made by the server and kept across restarts;
// every person's private channel with it, each conversation its own Claude Code session, and the
// public channel's mentions one more; at most three turns at once, the others waiting their turn,
// each answer back in its own conversation; Stop, a new conversation, a refused token, the usage
// limit, a stop of the server, a session gone; files held to the conversation's folder; credentials
// kept from every other program.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mcpServerText } from "../src/server/agententry.ts";
import { childEnv } from "../src/server/children.ts";
import { denied, Hosted, MAX_RUNNING } from "../src/server/hosted.ts";
import { mcpInstructions } from "../src/server/mcptools.ts";
import { loadClaudeToken, retire010, serverAgentToken } from "../src/server/serveragent.ts";
import { personalChannel, PUBLIC } from "../src/server/talk.ts";
import { AgentTokens } from "../src/server/tokens.ts";
import type { AgentLevel } from "../src/server/agent.ts";
import { UNTIL_STOPPED } from "../src/shared/collab.ts";
import { site, stream } from "./site.ts";
import type { Json } from "./site.ts";

const TOKEN = "sk-ant-oat01-" + "Ab3_x-".repeat(15) + "Zz9qQ";
const OTHER = "sk-ant-oat01-" + "Qr7-y_".repeat(15) + "Kk2wW";
const KEY = "k".repeat(40);
const named = (name: string) => ({ "x-visualproof-name": name });
const ALICE = named("Alice");
const BOB = named("Bob");
const here = { mode: "tcb", sel: "N.b", selection: null, source: true, clusterMode: "namespace", cam: null, view: "project", scope: null, tabs: ["project"] };

type Site = Awaited<ReturnType<typeof site>>;

/** A site whose server runs its own agent (--claude-oauth) on the stand-in for Claude Code. */
async function hostedSite(opts: Parameters<typeof site>[0] & { turnMs?: number; maxRunning?: number; level?: AgentLevel } = {}) {
  const S = await site(opts);
  const bin = mkdtempSync(join(tmpdir(), "vp-claude-"));
  copyFileSync(new URL("./fakeclaude.mjs", import.meta.url), join(bin, "claude"));
  chmodSync(join(bin, "claude"), 0o755);
  const agents = join(S.dir, "agents");
  const logs: string[] = [];
  const log = (l: string) => logs.push(l);
  const make = () =>
    new Hosted({
      root: agents,
      claude: join(bin, "claude"),
      claudeToken: TOKEN,
      record: serverAgentToken({ tokens: S.live.tokens, name: "Claude", level: opts.level ?? "full", agents, log }),
      talk: S.live.talk,
      tokens: S.live.tokens,
      address: () => S.base,
      mcpServer: mcpServerText,
      projectRoot: () => S.dir,
      site: join(S.dir, "state"),
      mentionable: () => S.live.mentionable().names,
      project: () => "M",
      log,
      turnMs: opts.turnMs,
      maxRunning: opts.maxRunning,
    });
  S.live.runAgent(make());
  const id = S.live.hosted!.id;
  const agent = S.live.presence.list().find((p) => p.agent && p.runs === "server")!.id;
  const behave = (b: Json) => writeFileSync(join(bin, "behave.json"), JSON.stringify(b));
  behave({ mode: "reply" });
  const calls = (): Json[] => (existsSync(join(bin, "calls.jsonl")) ? readFileSync(join(bin, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  const release = (gate: string) => writeFileSync(join(bin, `release-${gate}`), "");
  const held = (gate: string) => existsSync(join(bin, `held-${gate}`));
  const restart = () => {
    S.live.hosted!.close();
    S.live.runAgent(make());
  };
  const close = async () => {
    S.live.hosted?.close();
    await S.close();
    rmSync(bin, { recursive: true, force: true });
  };
  return { ...S, bin, agents, logs, id, agent, make, restart, behave, calls, release, held, close };
}

const until = async (f: () => boolean | Promise<boolean>, what: string, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((ok) => setTimeout(ok, 25))) if (await f()) return;
  assert.fail(`waited in vain: ${what}`);
};
const thread = async (S: Site, channel: string, who: Record<string, string>) => ((await S.ask("GET", `/api/chat?channel=${encodeURIComponent(channel)}`, undefined, who)).json!.messages ?? []) as Json[];
const answers = async (S: Site, channel: string, who: Record<string, string>) => (await thread(S, channel, who)).filter((m) => m.kind === "agent").map((m) => m.text as string);
const said = async (S: Site, channel: string, re: RegExp, who: Record<string, string>) => (await answers(S, channel, who)).some((t) => re.test(t));
const arg = (c: Json, k: string) => (c.args as string[])[(c.args as string[]).indexOf(k) + 1];
const sessionOf = (c: Json) => arg(c, (c.args as string[]).includes("--resume") ? "--resume" : "--session-id");
/** the stand-in's calls whose stdin says `re`, in order */
const callsSaying = (S: { calls(): Json[] }, re: RegExp) => S.calls().filter((c) => re.test(c.stdin));

/** A page of `who`'s, its stream open and named by its heartbeat. */
async function page(S: Site, session: string, who: Record<string, string>) {
  const s = stream(S.port, `/api/events?session=${session}`, who);
  await s.until(() => !!s.last("hello"));
  assert.equal((await S.ask("POST", "/api/presence", { token: s.last("hello")!.token, view: here }, who)).status, 200);
  return s;
}

/** An invited person, by their personal link's cookie (CollabSpec decision 9). */
async function invited(S: Site, name: string) {
  const link = (await S.ask("POST", "/api/share/people", { name }, { ...named("Olivia"), authorization: `Bearer ${KEY}` })).json!.link as string;
  const opened = await fetch(link, { redirect: "manual" });
  return { cookie: opened.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}

/** Every file under `dir`, read as text. */
function everything(dir: string): string {
  let out = "";
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out += everything(p);
    else if (e.isFile()) out += readFileSync(p, "latin1");
  }
  return out;
}

test("--claude-oauth: the token from a file only its owner reads, or the environment; an API key, anything else, a file others read, refused without saying what it holds", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-oauth-"));
  try {
    const file = (name: string, text: string, mode = 0o600) => {
      const f = join(dir, name);
      writeFileSync(f, text, { mode });
      chmodSync(f, mode);
      return f;
    };
    assert.deepEqual(loadClaudeToken(file("ok", `${TOKEN}\n`)), { token: TOKEN });
    const open = loadClaudeToken(file("open", TOKEN, 0o644));
    assert.ok("error" in open && /chmod 600/.test(open.error), JSON.stringify(open));
    const api = "sk-ant-api03-" + "k".repeat(90);
    const refused = [loadClaudeToken(file("api", api)), loadClaudeToken(file("junk", "hunter2")), loadClaudeToken(join(dir, "none")), loadClaudeToken(dir)];
    for (const r of refused) assert.ok("error" in r, JSON.stringify(r));
    assert.match((refused[0] as { error: string }).error, /API key/);
    assert.match((refused[2] as { error: string }).error, /no such file/);
    for (const r of [open, ...refused]) assert.ok(!JSON.stringify(r).includes(TOKEN.slice(13)) && !JSON.stringify(r).includes("kkkkk") && !JSON.stringify(r).includes("hunter2"), "never what it holds");
    assert.deepEqual(loadClaudeToken("env", { CLAUDE_CODE_OAUTH_TOKEN: ` ${TOKEN} ` }), { token: TOKEN });
    assert.match((loadClaudeToken("env", {}) as { error: string }).error, /not set/);
    assert.match((loadClaudeToken("env", { CLAUDE_CODE_OAUTH_TOKEN: api }) as { error: string }).error, /API key/);
    // the server does not start: said in a line, status 2, the token never in it
    const main = new URL("../src/server/main.ts", import.meta.url).pathname;
    const env = { ...process.env, VISUALPROOF_UPDATES: "off" };
    const bad = spawnSync(process.execPath, [main, "serve", dir, "--claude-oauth", join(dir, "open")], { encoding: "utf8", env });
    assert.equal(bad.status, 2, bad.stderr);
    assert.match(bad.stderr, /--claude-oauth file .*chmod 600/);
    assert.ok(!bad.stdout.includes(TOKEN) && !bad.stderr.includes(TOKEN));
    const bare = spawnSync(process.execPath, [main, "serve", dir, "--claude-oauth", "--port", "1"], { encoding: "utf8", env });
    assert.equal(bare.status, 2);
    assert.match(bare.stderr, /--claude-oauth takes the file that holds the Claude Code OAuth token/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the server's agent: its token made by the server and kept from one start to the next, at --agents, its name unique; the page cannot revoke it; 0.10's per-person agents retired", async () => {
  const S = await site();
  try {
    const agents = join(S.dir, "agents");
    const logs: string[] = [];
    const log = (l: string) => logs.push(l);
    const site_ = join(S.dir, "state");
    // what 0.10 left: the Claude tokens people gave, an agent it ran for Alice and its folder
    writeFileSync(join(site_, "claude-tokens.json"), JSON.stringify({ tokens: [{ name: "Alice", token: OTHER, given: "", refused: null }] }), { mode: 0o600 });
    const old = S.live.tokens.create({ name: "Alice's AI", by: "Alice", level: "advise", days: 7, runs: "server" }).record;
    mkdirSync(join(agents, old.id), { recursive: true });
    const shared = S.live.tokens.create({ name: "Claude", by: "Bob", level: "advise", days: 7 }).record;
    retire010({ site: site_, agents, tokens: S.live.tokens, log });
    assert.ok(!existsSync(join(site_, "claude-tokens.json")), "0.10's Claude tokens deleted");
    assert.ok(S.live.tokens.get(old.id)!.revoked && !existsSync(join(agents, old.id)), "its agent revoked, its folder removed");
    assert.equal(S.live.tokens.get(shared.id)!.revoked, null, "an agent shared by prompt stays");
    assert.equal(logs.length, 2, logs.join("\n"));
    retire010({ site: site_, agents, tokens: S.live.tokens, log });
    assert.equal(logs.length, 2, "said once");

    const r = serverAgentToken({ tokens: S.live.tokens, name: "Claude", level: "full", agents, log });
    assert.equal(r.by, "VisualProof");
    assert.equal(r.runs, "server");
    assert.equal(r.expires, UNTIL_STOPPED);
    assert.equal(r.name, "Claude 2", "unique among the tokens in force");
    assert.equal(serverAgentToken({ tokens: S.live.tokens, name: "Claude", level: "advise", agents, log }).id, r.id, "the same token, again");
    assert.equal(S.live.tokens.get(r.id)!.level, "advise", "at the server's --agents");
    assert.equal(serverAgentToken({ tokens: new AgentTokens(site_), name: "Claude", level: "advise", agents, log }).id, r.id, "kept across a restart");

    // not listed, nor let in, while the server does not run it
    assert.ok(!S.live.presence.list().some((p) => p.runs === "server"));
    const secret = S.live.tokens.token(r.id)!.token;
    assert.equal((await S.ask("GET", "/api/agent", undefined, { authorization: `Bearer ${secret}` })).status, 401);
    assert.equal((await S.ask("GET", "/api/share/agents", undefined, ALICE)).json!.server, null);
    assert.ok(!(await S.ask("GET", "/api/share/agents", undefined, ALICE)).json!.tokens.some((t: Json) => t.id === r.id));

    // a name changed (--claude-oauth-name): a new agent, the old one gone
    const renamed = serverAgentToken({ tokens: S.live.tokens, name: "Assistant", level: "advise", agents, log });
    assert.notEqual(renamed.id, r.id);
    assert.ok(S.live.tokens.get(r.id)!.revoked);
  } finally {
    await S.close();
  }
  const H = await hostedSite({ level: "advise" });
  try {
    const listed = H.live.presence.list().find((p) => p.id === H.agent)!;
    assert.deepEqual([listed.name, listed.by, listed.runs, listed.talk!.state], ["Claude", "VisualProof", "server", "listening"]);
    const share = (await H.ask("GET", "/api/share/agents", undefined, ALICE)).json!;
    assert.deepEqual(share.server, { id: H.agent, token: H.id, name: "Claude", level: "advise", offline: null });
    assert.equal(share.tokens.find((t: Json) => t.id === H.id).runs, "server");
    const revoke = await H.ask("POST", "/api/share/agents/revoke", { id: H.id }, ALICE);
    assert.equal(revoke.status, 403, "it stops with the server");
    assert.equal(H.live.tokens.get(H.id)!.revoked, null);
    assert.equal((await H.ask("POST", "/api/share/agents/prompt", { id: H.id }, ALICE)).status, 400, "no prompt");
    assert.equal((await H.ask("POST", "/api/share/agents", { runs: "server" }, ALICE)).status, 400, "Share runs none on the server");
    assert.equal((await H.ask("POST", "/api/share/claude", { token: TOKEN }, { ...ALICE, origin: H.base })).status, 404, "nor takes a Claude token");
  } finally {
    await H.close();
  }
});

test("everyone with a name talks with it privately: an invited person and a guest each answered in their own channel, by a session of their own, never each other's; the token nowhere", async () => {
  const S = await hostedSite({ key: KEY });
  const saved = { a: process.env.ANTHROPIC_API_KEY, c: process.env.CLAUDE_CODE_OAUTH_TOKEN };
  process.env.ANTHROPIC_API_KEY = "sk-ant-api03-the-servers-own";
  process.env.CLAUDE_CODE_OAUTH_TOKEN = OTHER;
  const seen: unknown[] = [];
  const ask = async (method: string, path: string, body: unknown, who: Record<string, string>) => {
    const r = await S.ask(method, path, body, who);
    seen.push(r.json);
    return r;
  };
  try {
    const A = await invited(S, "Alice");
    const B = { ...BOB, authorization: `Bearer ${KEY}` };
    const fakeAlice = { ...ALICE, authorization: `Bearer ${KEY}` };
    const alice = await page(S, "aaaaaaaa0001", A);
    const bob = await page(S, "bbbbbbbb0001", B);
    S.behave({ mode: "reply", when: [{ match: "Alice wrote", text: "Hello Alice." }, { match: "Bob wrote", text: "Hello Bob." }] });
    assert.equal((await ask("POST", "/api/chat", { channel: S.agent, text: "Alice's secret: N.b is wrong", place: here }, A)).status, 200);
    await until(() => said(S, S.agent, /^Hello Alice\.$/, A), "Alice answered");
    assert.equal((await ask("POST", "/api/chat", { channel: S.agent, text: "Bob asks: what is N.a?" }, B)).status, 200);
    await until(() => said(S, S.agent, /^Hello Bob\.$/, B), "Bob answered");
    // each reads their own, and nobody else's: a guest giving the invited person's name has a channel of their own
    const mine = async (who: Record<string, string>) => (await ask("GET", `/api/chat?channel=${S.agent}`, undefined, who)).json!.messages.map((m: Json) => m.text);
    assert.deepEqual(await mine(A), ["Alice's secret: N.b is wrong", "Hello Alice."]);
    assert.deepEqual(await mine(B), ["Bob asks: what is N.a?", "Hello Bob."]);
    assert.equal((await ask("GET", `/api/chat?channel=${S.agent}`, undefined, fakeAlice)).status, 401, "a guest cannot go by the invited Alice's name");
    assert.deepEqual(await mine({ ...named("Bobby"), authorization: `Bearer ${KEY}` }), [], "another guest's channel is their own");
    assert.equal((await ask("GET", `/api/chat?channel=${S.agent}`, undefined, { authorization: `Bearer ${KEY}` })).status, 401, "a name first");
    assert.equal((await ask("GET", `/api/chat?channel=${S.agent}`, undefined, { ...B, "x-visualproof-kind": "agent" })).status, 403, "never an agent");
    // separate sessions, folders and configurations; each one's words in its own turn alone
    const [a1, b1] = S.calls();
    assert.notEqual(sessionOf(a1), sessionOf(b1));
    assert.notEqual(realpathSync(a1.cwd), realpathSync(b1.cwd));
    assert.notEqual(a1.env.CLAUDE_CONFIG_DIR, b1.env.CLAUDE_CONFIG_DIR);
    assert.match(a1.stdin, /^VisualProof — A message from Alice, in your private conversation with them:/, "never a slash command");
    assert.match(a1.stdin, /Alice wrote to you, in your private conversation with them, on /);
    assert.ok(a1.stdin.includes("Alice's secret") && !a1.stdin.includes("Bob asks"));
    assert.ok(b1.stdin.includes("Bob asks") && !b1.stdin.includes("Alice's secret"), "Alice's words never in Bob's turn");
    // the turn's command line and environment: Claude Code's own tools, nothing secret on it
    const args = a1.args as string[];
    assert.ok(!args.includes("--tools") && args.includes("--strict-mcp-config") && args.includes("-p"));
    assert.equal(arg(a1, "--permission-mode"), "bypassPermissions");
    assert.equal(arg(a1, "--add-dir"), S.dir, "the project, to read, change and build");
    assert.deepEqual(args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--max-turns")), denied(join(S.dir, "state")));
    const vpa = S.live.tokens.token(S.id)!.token;
    for (const x of args) assert.ok(!x.includes(TOKEN) && !x.includes(vpa), `nothing secret on the command line: ${x}`);
    const env = a1.env as Record<string, string>;
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, TOKEN, "the --claude-oauth token, not the environment's");
    assert.equal(env.ANTHROPIC_API_KEY, undefined, "never an API key, which would win over the token");
    assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
    assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
    assert.deepEqual(Object.keys(env).filter((k) => k.startsWith("VISUALPROOF_")), []);
    const dirA = join(S.agents, S.id, `p-${personalChannel(S.id, { name: "Alice", person: S.live.invites.inForce()[0].id })!.slice(11)}`);
    assert.equal(realpathSync(a1.cwd), realpathSync(join(dirA, "work")));
    assert.equal(env.CLAUDE_CONFIG_DIR, join(dirA, "claude"));
    assert.equal(statSync(join(dirA, "mcp.json")).mode & 0o777, 0o600);
    assert.equal(statSync(join(S.agents, S.id)).mode & 0o777, 0o700);
    const tools = JSON.parse(readFileSync(join(S.bin, "tools.json"), "utf8")).tools as string[];
    assert.ok(tools.includes("reply") && !tools.includes("wait_for_message"), "the server hands it its turns");
    const rules = readFileSync(join(dirA, "prompt.md"), "utf8");
    assert.match(rules, /This conversation is with Alice alone/);
    assert.match(rules, /Never repeat in one conversation what another person said privately/);
    assert.match(rules, /spends the Claude usage of the server's operator/);
    assert.match(rules, /change it and build it \(lake build\) when you are asked to/);
    // Alice's next turn resumes her session; Bob's his
    S.behave({ mode: "reply", text: "Again." });
    await ask("POST", "/api/chat", { channel: S.agent, text: "And N.a?" }, A);
    await until(() => callsSaying(S, /And N\.a\?/).length === 1 && S.live.hosted!.running === 0, "Alice's second turn");
    const a2 = callsSaying(S, /And N\.a\?/)[0];
    assert.equal(arg(a2, "--resume"), sessionOf(a1));
    assert.ok(!a2.stdin.includes("Bob"));
    // each page is sent its own channel, and its own conversation's state
    await alice.until(() => alice.events.filter((e) => e.event === "chat").length >= 4);
    const chats = (s: ReturnType<typeof stream>) => s.events.filter((e) => e.event === "chat").map((e) => e.data.message.text as string);
    assert.ok(chats(alice).every((t) => !t.startsWith("Bob")) && chats(alice).includes("Hello Alice."));
    assert.ok(chats(bob).every((t) => !t.includes("Alice")) && chats(bob).includes("Hello Bob."));
    assert.ok(alice.events.some((e) => e.event === "chat-state" && e.data.channel === S.agent && e.data.talk.state === "thinking"));
    const states = (s: ReturnType<typeof stream>) => s.events.filter((e) => e.event === "chat-state").length;
    const bobStates = states(bob);
    await ask("POST", "/api/chat", { channel: S.agent, text: "Once more" }, A);
    await until(() => callsSaying(S, /Once more/).length === 1 && S.live.hosted!.running === 0, "Alice's third turn");
    await alice.until(() => states(alice) > 0);
    assert.equal(states(bob), bobStates, "Bob's pages are told nothing of Alice's conversation");
    // the token: in no answer, stream, log, nor file of the site or the cache
    const all = JSON.stringify([seen, alice.events, bob.events, S.logs]) + everything(S.dir);
    assert.ok(!all.includes(TOKEN) && !all.includes(TOKEN.slice(13, 40)), "the Claude token is nowhere");
    alice.close();
    bob.close();
  } finally {
    if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.c === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved.c;
    await S.close();
  }
});

test("a mention in the public channel is answered there, by a session of its own, which nobody's private words enter", async () => {
  const S = await hostedSite();
  try {
    S.behave({ mode: "reply", when: [{ match: "public channel, mentioning you", text: "N.b is defined from N.a." }] });
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "my private worry" }, ALICE);
    await until(() => said(S, S.agent, /^Answered\.$/, ALICE), "Alice answered");
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "@Claude what is N.b?" }, BOB)).status, 200);
    await until(() => said(S, "public", /^N\.b is defined/, BOB), "the public answer");
    const [priv, pub] = S.calls();
    assert.match(pub.stdin, /^VisualProof — A message from the public channel, mentioning you:/);
    assert.match(pub.stdin, /Bob wrote in the public channel, mentioning you/);
    assert.ok(!pub.stdin.includes("private worry"), "Alice's words never in the public session");
    assert.notEqual(sessionOf(pub), sessionOf(priv));
    assert.equal(realpathSync(pub.cwd), realpathSync(join(S.agents, S.id, "public", "work")));
    assert.match(readFileSync(join(S.agents, S.id, "public", "prompt.md"), "utf8"), /This conversation is the public channel/);
    assert.deepEqual(await answers(S, S.agent, BOB), [], "nothing in Bob's private channel");
    await S.ask("POST", "/api/chat", { channel: "public", text: "@Claude and N.a?" }, ALICE);
    await until(() => callsSaying(S, /and N\.a\?/).length === 1, "the second mention");
    assert.equal(arg(callsSaying(S, /and N\.a\?/)[0], "--resume"), sessionOf(pub), "the public session resumed, whoever asks");
    // a private turn may write in the public channel too
    S.behave({ mode: "reply", channel: "public", text: "Said in public, asked privately." });
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "say it to everyone" }, ALICE);
    await until(() => said(S, "public", /^Said in public, asked privately\.$/, BOB), "written in public");
  } finally {
    await S.close();
  }
});

test("at most three turns at once, the others waiting their turn, oldest first; each answer goes back to its own conversation; Stop ends one's own turn alone", async () => {
  assert.equal(MAX_RUNNING, 3);
  const S = await hostedSite();
  try {
    const people = ["Alice", "Bob", "Carol", "Dave"];
    S.behave({ mode: "reply", when: [...people.map((p) => ({ match: `^VisualProof — A message from ${p},`, mode: "hold", gate: p, text: `To ${p}.` })), { match: "public channel", mode: "hold", gate: "public", text: "To everyone." }] });
    for (const p of ["Alice", "Bob", "Carol"]) {
      assert.equal((await S.ask("POST", "/api/chat", { channel: S.agent, text: `${p} asks` }, named(p))).status, 200);
      await until(() => S.held(p), `${p}'s turn`);
    }
    assert.equal(S.live.presence.list().find((p) => p.id === S.agent)!.talk!.state, "thinking");
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "Dave asks" }, named("Dave"));
    await S.ask("POST", "/api/chat", { channel: "public", text: "@Claude Erin asks" }, named("Erin"));
    const dave = personalChannel(S.id, { name: "Dave", person: null })!;
    await until(() => S.live.hosted!.queue.length === 2, "two waiting");
    assert.equal(S.live.hosted!.running, 3, "three at once");
    assert.deepEqual(S.live.hosted!.queue, [dave, PUBLIC], "oldest first");
    const talkOf = async (p: string) => (await S.ask("GET", `/api/chat?channel=${S.agent}`, undefined, named(p))).json!.agent.talk;
    assert.equal((await talkOf("Dave")).queued, true, "Dave's tab: waiting its turn");
    assert.equal((await talkOf("Alice")).state, "thinking");
    assert.equal((await talkOf("Alice")).queued, undefined);
    assert.equal((await talkOf("Zoe")).state, "listening", "someone who wrote nothing");
    // Stop: Erin's is not running, and the public turn is nobody's to stop; Bob stops his own
    assert.deepEqual((await S.ask("POST", "/api/chat/stop", { agent: S.agent }, named("Erin"))).json, { ok: true, stopped: false });
    assert.deepEqual((await S.ask("POST", "/api/chat/stop", { agent: S.agent }, named("Bob"))).json, { ok: true, stopped: true });
    await until(() => S.held("Dave"), "Dave's turn, next");
    assert.equal(S.live.hosted!.running, 3);
    assert.deepEqual(S.live.hosted!.queue, [PUBLIC]);
    assert.ok(!S.held("public"));
    // let them go in another order than they began: each answer in its own conversation
    for (const p of ["Dave", "Carol", "Alice"]) S.release(p);
    await until(() => S.held("public"), "the public turn, once a place is free");
    S.release("public");
    await until(() => said(S, "public", /^To everyone\.$/, named("Erin")), "the public answer");
    for (const p of ["Alice", "Carol", "Dave"]) await until(async () => (await answers(S, S.agent, named(p))).length === 1, `${p}'s answer`);
    for (const p of ["Alice", "Carol", "Dave"]) assert.deepEqual(await answers(S, S.agent, named(p)), [`To ${p}.`], p);
    assert.deepEqual(await answers(S, S.agent, named("Bob")), [], "Bob's stopped: nothing said");
    assert.deepEqual((await thread(S, "public", named("Erin"))).filter((m) => m.kind === "agent").map((m) => m.text), ["To everyone."]);
    // every turn its own: the turn each MCP server named differs
    const turns = S.calls().map((c) => c.turn as string);
    assert.equal(new Set(turns).size, turns.length);
    await until(() => S.live.hosted!.running === 0, "all done");
    assert.equal(S.live.presence.list().find((p) => p.id === S.agent)!.talk!.state, "listening");
  } finally {
    await S.close();
  }
});

test("a new conversation is a new session of that person's channel alone; a turn running then ends unanswered", async () => {
  const S = await hostedSite();
  try {
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "first of Alice" }, ALICE);
    await until(() => said(S, S.agent, /Answered/, ALICE), "Alice");
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "first of Bob" }, BOB);
    await until(() => said(S, S.agent, /Answered/, BOB), "Bob");
    const [a1, b1] = S.calls();
    assert.equal((await S.ask("POST", "/api/chat/new", { agent: S.agent }, ALICE)).status, 200);
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "Alice anew" }, ALICE);
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "Bob again" }, BOB);
    await until(() => callsSaying(S, /Alice anew|Bob again/).length === 2 && S.live.hosted!.running === 0, "both");
    const a2 = callsSaying(S, /Alice anew/)[0];
    const b2 = callsSaying(S, /Bob again/)[0];
    assert.ok((a2.args as string[]).includes("--session-id") && !(a2.args as string[]).includes("--resume"), "a new session for Alice");
    assert.notEqual(sessionOf(a2), sessionOf(a1));
    assert.ok(!a2.stdin.includes("first of Alice"), "nothing of before it");
    assert.equal(arg(b2, "--resume"), sessionOf(b1), "Bob's goes on");
    // a divider while a turn runs: the turn ends, and says nothing
    S.behave({ mode: "hold", gate: "x", text: "too late" });
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "think long" }, ALICE);
    await until(() => S.held("x"), "held");
    assert.equal((await S.ask("POST", "/api/chat/new", { agent: S.agent }, ALICE)).status, 200);
    await until(() => S.live.hosted!.running === 0, "ended");
    S.release("x");
    assert.ok(!(await said(S, S.agent, /too late/, ALICE)));
  } finally {
    await S.close();
  }
});

test("a turn that replied nothing says its last words; a session Claude Code no longer has, a new one, told what came before", async () => {
  const S = await hostedSite();
  try {
    S.behave({ mode: "text", text: "Only words." });
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "remember N.b" }, ALICE);
    await until(() => said(S, S.agent, /^Only words\.$/, ALICE), "its last words");
    S.behave({ mode: "nosession" });
    await until(() => S.live.hosted!.running === 0, "done");
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "Still there?" }, ALICE);
    await until(() => said(S, S.agent, /^A new session\.$/, ALICE), "a new session");
    const [resumed, anew] = S.calls().slice(-2);
    assert.ok((resumed.args as string[]).includes("--resume") && (anew.args as string[]).includes("--session-id"));
    assert.notEqual(sessionOf(anew), sessionOf(resumed));
    assert.match(anew.stdin, /Earlier in this conversation[\s\S]*remember N\.b[\s\S]*Only words\.[\s\S]*Still there\?/);
  } finally {
    await S.close();
  }
});

test("Claude Code refusing the token: the agent offline for everyone, said where asked; what waited answered after a restart", async () => {
  const S = await hostedSite();
  try {
    S.behave({ mode: "refuse" });
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "Are you there?" }, ALICE);
    await until(() => said(S, S.agent, /Claude Code refused this server's Claude token/, ALICE), "the refusal");
    assert.equal(S.live.presence.list().find((p) => p.id === S.agent)!.talk!.state, "offline");
    assert.match((await S.ask("GET", "/api/share/agents", undefined, ALICE)).json!.server.offline, /refused/);
    assert.equal((await S.ask("POST", "/api/chat", { channel: S.agent, text: "me too" }, BOB)).status, 409, "a private channel cannot be written to");
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "@Claude hello?" }, BOB)).status, 200, "a mention is posted");
    assert.equal(S.calls().length, 1);
    // the operator fixes the token and restarts: what waited is answered, saying so
    S.behave({ mode: "reply", text: "Back." });
    S.restart();
    await until(async () => (await said(S, S.agent, /^Back\.$/, ALICE)) && (await said(S, "public", /^Back\.$/, BOB)), "answered after the restart");
    assert.match(callsSaying(S, /Are you there\?/).at(-1)!.stdin, /VisualProof stopped while you were answering/);
    assert.equal(callsSaying(S, /@Claude hello\?/).length, 1);
  } finally {
    await S.close();
  }
});

test("the usage limit: said once in each conversation that waits, and answered once it resets", async () => {
  const S = await hostedSite();
  try {
    S.behave({ mode: "limit", resetsAt: Math.ceil(Date.now() / 1000) + 2 });
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "Explain N.b" }, ALICE);
    await until(() => said(S, S.agent, /usage limit of this server's account is reached: I answer once it resets/, ALICE), "the limit said");
    S.behave({ mode: "reply", text: "Now." });
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "And me?" }, BOB);
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "And me, again?" }, BOB);
    await until(() => said(S, S.agent, /usage limit/, BOB), "said to Bob too");
    await until(async () => (await said(S, S.agent, /^Now\.$/, ALICE)) && (await said(S, S.agent, /^Now\.$/, BOB)), "answered after the reset", 20_000);
    assert.equal((await answers(S, S.agent, BOB)).filter((t) => /usage limit/.test(t)).length, 1, "said once");
    assert.match(callsSaying(S, /Explain N\.b/).at(-1)!.stdin, /Explain N\.b/);
    assert.match(callsSaying(S, /And me\?/).at(-1)!.stdin, /2 messages, in order/);
  } finally {
    await S.close();
  }
});

test("a stop of the server: each turn it cut short is answered at the next start, saying so, once", async () => {
  const S = await hostedSite();
  try {
    S.behave({ mode: "slow" });
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "Before the restart" }, ALICE);
    await until(() => callsSaying(S, /Before the restart/).length === 1, "a turn");
    S.live.hosted!.close();
    await until(() => !S.live.hosted!.busy, "stopped");
    S.behave({ mode: "reply", text: "After the restart." });
    S.live.runAgent(S.make());
    await until(() => said(S, S.agent, /^After the restart\.$/, ALICE), "answered");
    assert.match(S.calls().at(-1)!.stdin, /VisualProof stopped while you were answering[\s\S]*Before the restart/);
    await until(() => S.live.hosted!.running === 0, "done");
    // cut short twice: not handed a third time, and the log says so
    S.behave({ mode: "slow" });
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "Cut twice" }, ALICE);
    await until(() => callsSaying(S, /Cut twice/).length === 1, "a turn");
    S.restart();
    await until(() => callsSaying(S, /Cut twice/).length === 2, "handed again");
    S.behave({ mode: "reply", text: "Third." });
    S.restart();
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(callsSaying(S, /Cut twice/).length, 2, "not handed a third time");
    assert.ok(S.logs.some((l) => /cut short by a stop twice/.test(l)), S.logs.join("\n"));
  } finally {
    await S.close();
  }
});

test("what a turn's shell leaves running goes with the turn", async () => {
  const S = await hostedSite();
  try {
    S.behave({ mode: "linger" });
    await S.ask("POST", "/api/chat", { channel: S.agent, text: "start something" }, ALICE);
    await until(() => said(S, S.agent, /^Left something running\.$/, ALICE), "the answer");
    const pid = Number(readFileSync(join(S.bin, "linger.pid"), "utf8"));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    await until(() => !alive(), "what it left, ended");
  } finally {
    await S.close();
  }
});

test("the files its tools send stay in the conversation's folder: no other file of the machine, by a path, `..` or a symbolic link", async () => {
  const S = await hostedSite();
  try {
    const files = join(S.agents, S.id, `p-${personalChannel(S.id, { name: "Alice", person: null })!.slice(11)}`, "files");
    const secret = join(S.dir, "state", "agent-tokens.json");
    let first = true;
    for (const path of ["../mcp.json", secret, "tokens.pdf"]) {
      rmSync(join(S.bin, "sent.json"), { force: true });
      S.behave({ mode: "send", path });
      await S.ask("POST", "/api/chat", { channel: S.agent, text: `send ${path}` }, ALICE);
      await until(() => existsSync(join(S.bin, "sent.json")), `sent ${path}`);
      if (first) symlinkSync(secret, join(files, "tokens.pdf"));
      first = false;
      const [answer] = JSON.parse(readFileSync(join(S.bin, "sent.json"), "utf8"));
      assert.equal(answer.isError, true, path);
      assert.match(answer.content[0].text, /name of a file in your folder/, path);
      await until(() => S.live.hosted!.running === 0, "done");
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

test("the instructions of the server's agent say turns, one conversation each, within the 2,048 characters Claude Code keeps", () => {
  for (const level of ["read", "advise", "full"]) {
    const text = mcpInstructions({ name: "N".repeat(60), by: "VisualProof", level, expires: UNTIL_STOPPED, address: "http://127.0.0.1:4173", project: "flt_regular", hosted: true });
    assert.ok(text.length <= 2048, `${level}: ${text.length}`);
    assert.match(text, /end your turn/);
    assert.match(text, /Never repeat in one what another person said privately/);
    assert.doesNotMatch(text, /wait_for_message|expires/);
  }
});
