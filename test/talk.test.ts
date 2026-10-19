// Talking with an agent (AgentSpec decision 8): VisualProof's MCP server, driven over stdio as an MCP
// client drives it — initialize, the tools, a call, wait_for_message returning the moment a message
// is written, "nothing" at its longest, progress while it waits, a cancelled wait, a revoked token,
// the export tools and a file saved —
// and the agent's inbox over HTTP; the states the server infers from what the agent does (listening,
// thinking, working, offline after its longest wait and a minute), its own status line, messages
// queued while it thinks, an offline agent refused; senders held to a rate; conversations kept 30
// days. The owner's decisions of 2026-10-11: the first wait after the agent was offline hands it the
// conversation so far, within bounds, once; a new conversation (its divider, who may start one, its
// rate, one right after another, an offline agent's), the notice a running agent is handed, what a
// later session is told, and `conversation` since the divider or all of it.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { doingOf } from "../src/server/agent.ts";
import type { Ask } from "../src/server/agent.ts";
import { EARLIER_CHARS, EARLIER_MESSAGES, earlierOf, Talk } from "../src/server/talk.ts";
import { renderMarkdown } from "../src/web/src/markdown.ts";
import { stateLine, stateWords } from "../src/web/src/talk.ts";
import type { AgentTalk, Peer } from "../src/shared/collab.ts";
import { tinyPdf } from "./pdf.ts";
import { site, stream } from "./site.ts";
import type { Json } from "./site.ts";

const MCP = new URL("../src/mcp/visualproof-mcp.mjs", import.meta.url).pathname;
const ALICE = { "x-visualproof-name": "Alice" };
const BOB = { "x-visualproof-name": "Bob" };
const here = { mode: "tcb", sel: "N.b", selection: null, source: true, clusterMode: "namespace", cam: null, view: "project", scope: null, tabs: ["project"] };
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** The MCP server, run as a client runs it, and spoken to over its stdin and stdout; every line it
 *  writes is kept with when it came. */
function mcp(env: Record<string, string>) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [MCP], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const waiting = new Map<number, (m: Json) => void>();
  const notes: (Json & { t: number })[] = [];
  const answers: (Json & { t: number })[] = [];
  const stderr: string[] = [];
  const out: string[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    out.push(line);
    const m = { ...JSON.parse(line), t: Date.now() };
    if (m.id !== undefined) answers.push(m);
    if (m.id !== undefined && waiting.has(m.id)) {
      waiting.get(m.id)!(m);
      waiting.delete(m.id);
    } else if (m.method) notes.push(m);
  });
  child.stderr.on("data", (d) => stderr.push(String(d)));
  let next = 1;
  const send = (method: string, params?: unknown) => {
    const id = next++;
    const answered = new Promise<Json & { t: number }>((ok) => waiting.set(id, ok as (m: Json) => void));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }) + "\n");
    return { id, answered };
  };
  const ask = (method: string, params?: unknown) => send(method, params).answered;
  const tell = (method: string, params?: unknown) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }) + "\n");
  const until = async (f: () => boolean, ms = 5000) => {
    for (const end = Date.now() + ms; !f() && Date.now() < end; ) await sleep(10);
    assert.ok(f(), `waited in vain; stderr: ${stderr.join("")}`);
  };
  const exited = new Promise<void>((ok) => child.on("exit", () => ok()));
  const start = async () => {
    await ask("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    tell("notifications/initialized");
  };
  return { child, send, ask, tell, notes, answers, stderr, out, until, start, exited, stop: () => child.kill() };
}

async function share(S: Awaited<ReturnType<typeof site>>, headers: Record<string, string> = ALICE) {
  const r = await S.ask("POST", "/api/share/agents", {}, headers);
  return { id: r.json!.token.id as string, token: (r.json!.prompt as string).match(/vpa_[0-9a-f]{10}_[A-Za-z0-9_-]{43}/)![0] };
}

/** The agent as the page lists it. */
const peer = (S: Awaited<ReturnType<typeof site>>, name = "Alice's AI") => S.live.presence.list().find((p) => p.agent && p.name === name);
const stateOf = (S: Awaited<ReturnType<typeof site>>) => peer(S)?.talk?.state;

/** A wait on the inbox over HTTP, with when it was answered. */
function inbox(S: Awaited<ReturnType<typeof site>>, token: string, q: string) {
  return S.ask("GET", `/api/agent/inbox?${q}`, undefined, { authorization: `Bearer ${token}` }).then((r) => ({ ...r, t: Date.now() }));
}

test("the MCP server: initialize without channels, the tools, a call; wait_for_message returns the moment a message is written, with who wrote it and where", async (t) => {
  const S = await site();
  const { token } = await share(S);
  const M = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: token });
  try {
    // a client of a revision this server does not speak is answered with the newest it speaks
    const init = await M.ask("initialize", { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(init.result.protocolVersion, "2025-11-25");
    assert.deepEqual(init.result.capabilities, { tools: { listChanged: true }, resources: {} }, "no channel: tools, and the documentation as resources");
    assert.equal(init.result.serverInfo.name, "visualproof");
    assert.match(init.result.instructions, /You are "Alice's AI"/);
    assert.match(init.result.instructions, /call wait_for_message/);
    // the conversations' channels (CollabSpec decision 13), not MCP's: the capabilities above have none
    assert.match(init.result.instructions, /your private channel, or a person mentioning you in the public channel/);
    assert.ok(init.result.instructions.length <= 2048, `instructions: ${init.result.instructions.length} characters, Claude Code keeps 2,048`);
    assert.equal((await M.ask("initialize", { protocolVersion: "2025-03-26" })).result.protocolVersion, "2025-03-26");
    M.tell("notifications/initialized");
    assert.deepEqual((await M.ask("ping")).result, {});
    assert.equal((await M.ask("prompts/list")).error.code, -32601);
    const tools = (await M.ask("tools/list")).result.tools as Json[];
    const names = tools.map((x) => x.name);
    for (const n of ["wait_for_message", "status", "reply", "conversation", "channel", "docs", "search", "declaration", "source", "lean", "refs", "review", "companion", "opinion", "notes", "view"]) assert.ok(names.includes(n), n);
    for (const x of tools) {
      assert.ok(x.description && x.description.length <= 2048, x.name);
      assert.equal(x.inputSchema.type, "object");
      assert.ok(!("call" in x), "what a tool asks of the server is the MCP server's business");
    }
    const w = tools.find((x) => x.name === "wait_for_message")!;
    assert.deepEqual(w.inputSchema.properties, {}, "no arguments: the longest wait is the server's setting");
    assert.match(w.description, /returns the moment someone writes/);
    // a call: the API's answer, as text
    const found = await M.ask("tools/call", { name: "search", arguments: { q: "N.b" } });
    assert.ok(!found.result.isError);
    assert.equal(JSON.parse(found.result.content[0].text).hits[0].name, "N.b");
    const wrong = await M.ask("tools/call", { name: "declaration", arguments: { name: "N.zz" } });
    assert.equal(wrong.result.isError, true);
    assert.match(wrong.result.content[0].text, /didYouMean/);
    // a tool of several operations: its action chosen, its default where none is given, a wrong one said
    const mod = await M.ask("tools/call", { name: "source", arguments: { action: "module", of: "N.b" } });
    assert.ok(!mod.result.isError, mod.result.content[0].text);
    assert.deepEqual(JSON.parse(mod.result.content[0].text).declarations.map((d: Json) => d.name), ["N.a", "N.b"], "the module, its declarations");
    await M.ask("tools/call", { name: "source", arguments: { name: "N.b" } });
    assert.equal(peer(S)!.talk!.doing, "reading the source of `N.b`", "source by default");
    const two = await M.ask("tools/call", { name: "declaration", arguments: { names: ["N.a", "N.b"] } });
    assert.deepEqual(JSON.parse(two.result.content[0].text).declarations.map((d: Json) => d.name), ["N.a", "N.b"], "names: several at once");
    const bad = await M.ask("tools/call", { name: "lean", arguments: { action: "explain", name: "N.b" } });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /no action explain; its actions are describe, print/);
    const none = await M.ask("tools/call", { name: "refs", arguments: { name: "N.b" } });
    assert.match(none.result.content[0].text, /action is missing/);
    // the documentation: the docs tool, and the same as resources
    const index = await M.ask("tools/call", { name: "docs", arguments: {} });
    assert.match(index.result.content[0].text, /^# VisualProof for agents/);
    const topic = await M.ask("tools/call", { name: "docs", arguments: { topic: "talking" } });
    assert.match(topic.result.content[0].text, /^# Talking with people/);
    const listed = (await M.ask("resources/list")).result.resources as Json[];
    assert.equal(listed[0].uri, "visualproof://docs");
    assert.ok(listed.some((r) => r.uri === "visualproof://docs/talking" && r.mimeType === "text/markdown"));
    const read = await M.ask("resources/read", { uri: "visualproof://docs/talking" });
    assert.equal(read.result.contents[0].text, topic.result.content[0].text);
    assert.equal((await M.ask("resources/read", { uri: "visualproof://docs/nope" })).error.code, -32002);
    assert.deepEqual((await M.ask("resources/templates/list")).result, { resourceTemplates: [] });
    // working: requests, nothing to answer
    assert.equal(stateOf(S), "working");
    // listening, from the moment the wait is open
    const page = stream(S.port, "/api/events?session=aaaaaaaa1111", ALICE);
    const waited = M.send("tools/call", { name: "wait_for_message", arguments: {}, _meta: { progressToken: "w1" } });
    await M.until(() => stateOf(S) === "listening");
    await page.until(() => (page.last("presence") as Peer[] | undefined)?.find((p) => p.name === "Alice's AI")?.talk?.state === "listening");
    // Alice writes from her page: the wait returns at once, with who wrote and where she was
    const sentAt = Date.now();
    const sent = await S.ask("POST", "/api/chat", { agent: peer(S)!.id, text: "What does N.b stand for?", place: here }, ALICE);
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    const got = await waited.answered;
    const latency = got.t - sentAt;
    t.diagnostic(`a message reached wait_for_message ${latency} ms after it was sent`);
    assert.ok(latency < 1000, `at once: ${latency} ms`);
    assert.ok(!got.result.isError);
    const said = got.result.content[0].text as string;
    assert.match(said, /^A message from the page, after \d+\.\d s of listening:\n\nAlice wrote to you, in your private channel, on the Project view, reading the source of N\.b \(message 1, [^)]+\):\nWhat does N\.b stand for\?\n\nAnswer with reply/);
    // thinking from now on, with what its requests show it doing
    assert.equal(stateOf(S), "thinking");
    await M.ask("tools/call", { name: "declaration", arguments: { name: "N.b" } });
    assert.equal(peer(S)!.talk!.doing, "reading `N.b`");
    const moved = await M.ask("tools/call", { name: "view", arguments: { sel: "N.b", source: true } });
    assert.match(JSON.parse(moved.result.content[0].text).followersSee, /looking at N\.b with its source open/);
    assert.equal(peer(S)!.talk!.doing, "going to `N.b`");
    assert.ok(Date.now() - Date.parse(peer(S)!.talk!.since) < 5000);
    // the page sees the message go, and the answer; replying ends thinking
    await page.until(() => page.events.some((e) => e.event === "chat" && e.data.message.text === "What does N.b stand for?"));
    const replied = await M.ask("tools/call", { name: "reply", arguments: { text: "It is **a**, by `N.a`." } });
    assert.ok(!replied.result.isError, replied.result.content[0].text);
    await page.until(() => page.events.some((e) => e.event === "chat" && e.data.message.kind === "agent"));
    assert.equal(stateOf(S), "working");
    const thread = await S.ask("GET", `/api/chat?channel=${encodeURIComponent(peer(S)!.id)}`, undefined, ALICE);
    assert.deepEqual(thread.json!.messages.map((m: Json) => [m.from, m.kind, m.channel, m.text]), [["Alice", "person", "private", "What does N.b stand for?"], ["Alice's AI", "agent", "private", "It is **a**, by `N.a`."]]);
    assert.equal(thread.json!.agent.talk.state, "working");
    assert.ok(M.out.every((l) => JSON.parse(l).jsonrpc === "2.0"), "nothing but protocol on stdout");
    page.close();
  } finally {
    M.stop();
    await S.close();
  }
});

test("wait_for_message says nothing came once its longest wait is over, and is then listening no more; progress comes while it waits", async () => {
  const S = await site();
  const { token } = await share(S);
  const M = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: token, VISUALPROOF_WAIT_SECONDS: "2", VISUALPROOF_PROGRESS_SECONDS: "0.25" });
  try {
    await M.start();
    const t0 = Date.now();
    const r = await M.ask("tools/call", { name: "wait_for_message", arguments: {}, _meta: { progressToken: "p-7" } });
    const took = Date.now() - t0;
    assert.ok(took >= 1900 && took < 4500, `the longest wait: ${took} ms`);
    assert.ok(!r.result.isError);
    assert.match(r.result.content[0].text, /^Nothing: no one wrote in 2 s\. Call wait_for_message again/);
    // a progress notification about every 0.25 s, with the request's token, growing
    const progress = M.notes.filter((n) => n.method === "notifications/progress");
    assert.ok(progress.length >= 5, `${progress.length} progress notifications`);
    assert.ok(progress.every((n) => n.params.progressToken === "p-7" && n.params.total === 2 && /^Listening for messages from the page/.test(n.params.message)));
    for (let k = 1; k < progress.length; k++) assert.ok(progress[k].params.progress > progress[k - 1].params.progress, "progress grows");
    assert.ok(progress.every((n) => n.t <= r.t), "none after the answer");
    // the wait ended at its time: still listening a moment (it is asked again at once), then working
    assert.equal(stateOf(S), "listening");
    // without a progress token, no progress: there is nothing to tie it to
    const before = M.notes.length;
    await M.ask("tools/call", { name: "wait_for_message", arguments: {} });
    assert.equal(M.notes.length, before);
    assert.match(M.stderr.join(""), /asked for no progress/);
  } finally {
    M.stop();
    await S.close();
  }
});

test("a wait split into several requests of the inbox, as the MCP server makes it, is listening throughout", async () => {
  // the MCP server asks the inbox for at most 50 s at a time: between two requests the agent must
  // not be shown leaving and coming back
  const dir = mkdtempSync(join(tmpdir(), "vp-talk-"));
  try {
    const T = new Talk(dir, { graceMs: 300, slackMs: 300, tickMs: 50 });
    const states: string[] = [];
    T.onState = (_, s) => states.push(s.state);
    T.seen("aaaaaaaaaa", null);
    const first = await T.wait("aaaaaaaaaa", 100, { maxMs: 2000 });
    assert.ok("messages" in first && first.messages.length === 0);
    const again = T.wait("aaaaaaaaaa", 100, { maxMs: 2000 });
    assert.equal(T.state("aaaaaaaaaa"), "listening");
    await again;
    assert.deepEqual(states, ["working", "listening"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a wait the client cancels (Esc) ends at once: the agent stops listening, and the cancelled call is not answered", async () => {
  const S = await site();
  const { token } = await share(S);
  const M = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: token });
  try {
    await M.start();
    const w = M.send("tools/call", { name: "wait_for_message", arguments: {}, _meta: { progressToken: 1 } });
    await M.until(() => stateOf(S) === "listening");
    M.tell("notifications/cancelled", { requestId: w.id, reason: "the user interrupted" });
    await M.until(() => stateOf(S) === "working", 2000);
    // a message now waits for the next wait, which hands it over at once
    assert.equal((await S.ask("POST", "/api/chat", { agent: peer(S)!.id, text: "still there?" }, ALICE)).status, 200);
    const t0 = Date.now();
    const next = await M.ask("tools/call", { name: "wait_for_message", arguments: {} });
    assert.ok(Date.now() - t0 < 1000);
    assert.match(next.result.content[0].text, /Alice wrote to you, in your private channel \(message 1, [^\n]*:\nstill there\?/);
    assert.ok(!M.answers.some((a) => a.id === w.id), "the cancelled call is not answered");
    // the client goes (its session ended): the agent left, offline at once
    M.child.stdin.end();
    await M.exited;
    await M.until(() => stateOf(S) === "offline", 2000);
  } finally {
    M.stop();
    await S.close();
  }
});

test("the inbox over HTTP: at once with what waits, all of it in order; else the moment a message comes; else nothing at the end; one wait at a time", async (t) => {
  const S = await site();
  try {
    const { token } = await share(S);
    const auth = { authorization: `Bearer ${token}` };
    // only an agent with a token of its own has an inbox
    const keyless = await S.ask("GET", "/api/agent/inbox?wait=1", undefined, { "x-visualproof-name": "Bot", "x-visualproof-kind": "agent" });
    assert.equal(keyless.status, 403);
    assert.equal((await S.ask("GET", "/api/agent/inbox?wait=x", undefined, auth)).status, 400);
    assert.equal((await S.ask("GET", "/api/agent/inbox?wait=-1", undefined, auth)).status, 400);
    // a look (wait 0): nothing, and the agent is working
    const look = await S.ask("GET", "/api/agent/inbox", undefined, auth);
    assert.deepEqual([look.status, look.json!.messages, look.json!.waited], [200, [], 0]);
    assert.equal(stateOf(S), "working");
    // the moment a message comes
    const pending = inbox(S, token, "wait=20");
    await sleep(100);
    assert.equal(stateOf(S), "listening");
    const sentAt = Date.now();
    assert.equal((await S.ask("POST", "/api/chat", { agent: peer(S)!.id, text: "one", place: here }, ALICE)).status, 200);
    const r = await pending;
    t.diagnostic(`the inbox answered ${r.t - sentAt} ms after the message was sent`);
    assert.ok(r.t - sentAt < 500, `${r.t - sentAt} ms`);
    assert.deepEqual(r.json!.messages.map((m: Json) => [m.id, m.from, m.text, m.where.declaration]), [[1, "Alice", "one", "N.b"]]);
    assert.ok(r.json!.waited > 0 && r.json!.waited < 1);
    assert.match(r.json!.next, /POST \/api\/agent\/reply/);
    // nothing at the end of a short wait
    await S.ask("POST", "/api/agent/reply", { text: "ok" }, auth);
    const t0 = Date.now();
    const none = await inbox(S, token, "wait=0.3");
    assert.ok(none.t - t0 >= 280, `${none.t - t0} ms`);
    assert.deepEqual(none.json!.messages, []);
    assert.match(none.json!.next, /wait again/);
    // one wait at a time: a newer one ends the older at once
    const older = inbox(S, token, "wait=20");
    await sleep(50);
    const newer = inbox(S, token, "wait=20");
    const o = await older;
    assert.equal(o.status, 200);
    assert.match(o.json!.replaced, /took this one's place/);
    assert.equal((await S.ask("POST", "/api/chat", { agent: peer(S)!.id, text: "two" }, ALICE)).status, 200);
    assert.deepEqual((await newer).json!.messages.map((m: Json) => m.text), ["two"]);
    // a wait whose asker went away is over: the agent is no longer listening
    const ctl = new AbortController();
    const gone = fetch(`${S.base}/api/agent/inbox?wait=20`, { headers: auth, signal: ctl.signal }).catch(() => null);
    await sleep(100);
    assert.equal(stateOf(S), "listening");
    ctl.abort();
    await gone;
    for (let k = 0; k < 50 && stateOf(S) === "listening"; k++) await sleep(20);
    assert.equal(stateOf(S), "working", "a wait ends thinking: what was handed over before needed no answer");
  } finally {
    await S.close();
  }
});

test("messages written while the agent thinks or works wait for its next wait, all of them in order; an offline agent cannot be written to", async () => {
  const S = await site();
  try {
    const { token } = await share(S);
    const auth = { authorization: `Bearer ${token}` };
    // listed as soon as the token is made: offline, and refused
    assert.equal(stateOf(S), "offline");
    assert.equal(peer(S)!.idle, true);
    const page = stream(S.port, "/api/events?session=aaaaaaaa1111");
    await page.until(() => (page.last("presence") as Peer[] | undefined)?.some((p) => p.name === "Alice's AI") ?? false);
    const id = peer(S)!.id;
    const off = await S.ask("POST", "/api/chat", { agent: id, text: "hello?" }, ALICE);
    assert.equal(off.status, 409);
    assert.equal(off.json!.error, "offline");
    assert.match(off.json!.message, /offline/);
    // writing is for people, with a name
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "hi" })).status, 401);
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "hi" }, { ...ALICE, "x-visualproof-kind": "agent" })).status, 403);
    assert.equal((await S.ask("POST", "/api/chat", { agent: "nobody", text: "hi" }, ALICE)).status, 404);
    // its private channel is its maker's: Bob neither writes nor reads it (the owner's decision of
    // 2026-10-19), offline or not
    assert.equal((await S.ask("POST", "/api/chat", { channel: id, text: "hi" }, BOB)).status, 403);
    assert.equal((await S.ask("GET", `/api/chat?channel=${id}`, undefined, BOB)).status, 403);
    // the agent waits, and is handed the first message: thinking
    const first = inbox(S, token, "wait=20");
    await sleep(50);
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "first" }, ALICE)).status, 200);
    assert.deepEqual((await first).json!.messages.map((m: Json) => m.text), ["first"]);
    assert.equal(stateOf(S), "thinking");
    assert.equal(peer(S)!.talk!.read, 1);
    // three more while it thinks — Bob's in the public channel, mentioning it: taken, and kept for
    // its next wait
    for (const [who, channel, text] of [[ALICE, id, "second"], [BOB, "public", "@Alice's AI third"], [ALICE, id, "fourth"]] as const)
      assert.equal((await S.ask("POST", "/api/chat", { channel, text }, who)).status, 200);
    assert.equal(peer(S)!.talk!.read, 1, "not handed over yet");
    assert.equal((await S.ask("POST", "/api/agent/reply", { text: "first answered" }, auth)).status, 200);
    assert.equal(stateOf(S), "working");
    const next = await inbox(S, token, "wait=20");
    assert.ok(next.json!.waited === 0, "at once");
    assert.deepEqual(next.json!.messages.map((m: Json) => [m.from, m.channel, m.text]), [["Alice", "private", "second"], ["Bob", "public", "@Alice's AI third"], ["Alice", "private", "fourth"]]);
    assert.deepEqual([peer(S)!.talk!.read, peer(S)!.talk!.readPublic], [3, 1]);
    assert.equal(stateOf(S), "thinking");
    // the private channel says the same
    const conv = await S.ask("GET", "/api/agent/conversation", undefined, auth);
    assert.deepEqual([conv.json!.state, conv.json!.read], ["thinking", 3]);
    assert.deepEqual(conv.json!.messages.map((m: Json) => m.text), ["first", "second", "fourth", "first answered"]);
    page.close();
  } finally {
    await S.close();
  }
});

test("the states, from what the agent does: listening, thinking with what it does, working, offline after its longest wait and a minute; leaving is offline at once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-talk-"));
  try {
    const T = new Talk(dir);
    const tok = "abcdef0123";
    const told: AgentTalk[] = [];
    T.onState = (_, s) => told.push(s);
    assert.equal(T.state(tok), "offline", "never seen");
    // a request: working, offline a minute after it when it never waited
    const t0 = Date.now();
    T.seen(tok, "searching \"swap\"", t0);
    assert.deepEqual([T.talk(tok, t0).state, T.talk(tok, t0).doing], ["working", 'searching "swap"']);
    assert.equal(T.state(tok, t0 + 59_000), "working");
    assert.equal(T.state(tok, t0 + 60_001), "offline");
    // a wait of 30 s, said to be part of one of 1800: listening while open, whatever else the
    // agent asks meanwhile
    const w = T.wait(tok, 30_000, { maxMs: 1_800_000 });
    assert.equal(T.state(tok), "listening");
    assert.equal(T.talk(tok).doing, null, "a wait starts afresh");
    T.seen(tok, "reading the conversation");
    assert.equal(T.state(tok), "listening");
    // a message: handed over, thinking since then
    const m = T.post(tok, { from: "Alice", kind: "person", text: "why?" });
    const r = await w;
    assert.ok("messages" in r && r.messages[0].id === m.id);
    const now = Date.now();
    assert.equal(T.state(tok, now), "thinking");
    assert.ok(Math.abs(Date.parse(T.talk(tok, now).since) - now) < 1000);
    assert.equal(T.talk(tok, now).doing, null, "what it does is what it does from the moment it was handed the message");
    T.seen(tok, "reading `N.b`");
    T.setStatus(tok, "reading the TCB…");
    assert.deepEqual([T.talk(tok).doing, T.talk(tok).status], ["reading `N.b`", "reading the TCB…"]);
    // a request without words keeps the words of the last
    T.seen(tok, null);
    assert.equal(T.talk(tok).doing, "reading `N.b`");
    // its reply ends thinking and clears its line: working
    T.post(tok, { from: "Alice's AI", kind: "agent", text: "because" });
    assert.deepEqual([T.talk(tok).state, T.talk(tok).status, T.talk(tok).doing], ["working", null, null]);
    // no wait and no request: offline after its longest wait (1800 s) and a minute, not before
    const last = Date.now();
    assert.equal(T.state(tok, last + 1_800_000 + 59_000), "working");
    assert.equal(T.state(tok, last + 1_800_000 + 61_000), "offline");
    // a wait that ends at its time is still listening a moment (asked again at once), then working
    const short = await T.wait(tok, 20);
    assert.ok("messages" in short && short.messages.length === 0);
    assert.equal(T.state(tok), "listening");
    assert.equal(T.state(tok, Date.now() + 16_000), "working");
    // the states pages were told, in order, each change once
    const states = told.map((s) => s.state).filter((s, k, all) => s !== all[k - 1]);
    assert.deepEqual(states, ["working", "listening", "thinking", "working", "listening"]);
    // leaving: offline at once, until it asks again
    T.left(tok);
    assert.equal(T.state(tok), "offline");
    T.seen(tok, null);
    assert.equal(T.state(tok), "working");
    // its first wait after it is the conversation so far, at once, which needs no answer
    const back = await T.wait(tok, 30_000);
    assert.ok("messages" in back && back.messages.length === 1 && back.messages[0].kind === "earlier");
    assert.equal(T.state(tok), "working");
    // a token that ended ends its wait at once
    const ending = T.wait(tok, 30_000);
    T.close(tok, "revoked");
    assert.deepEqual(await ending, { ended: "revoked", error: "Your token was revoked: people can no longer talk to you here." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("offline after its longest wait and a minute, with short settings and real time; pages are told", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-talk-"));
  try {
    const T = new Talk(dir, { slackMs: 150, graceMs: 50, tickMs: 25 });
    const told: string[] = [];
    T.onState = (_, s) => told.push(s.state);
    await T.wait("bbbbbbbbbb", 100);
    for (let k = 0; k < 40 && told.at(-1) !== "offline"; k++) await sleep(25);
    assert.deepEqual(told, ["listening", "working", "offline"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the status line: set by the agent, shown with its state, cleared when it replies or waits; over HTTP and as the status tool", async () => {
  const S = await site();
  const { token } = await share(S);
  const auth = { authorization: `Bearer ${token}` };
  const M = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: token });
  try {
    const set = await S.ask("POST", "/api/agent/status", { text: "  reading\nthe TCB…  " }, auth);
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual([set.json!.state, set.json!.status], ["working", "reading the TCB…"]);
    assert.equal(peer(S)!.talk!.status, "reading the TCB…");
    assert.equal((await S.ask("POST", "/api/agent/status", { text: "x".repeat(201) }, auth)).status, 400);
    assert.equal((await S.ask("POST", "/api/agent/status", { text: 3 }, auth)).status, 400);
    assert.equal((await S.ask("POST", "/api/agent/status", { text: "x" }, { "x-visualproof-name": "Bot", "x-visualproof-kind": "agent" })).status, 403);
    // the companion tells other agents
    const c = await S.ask("GET", "/api/agent/companion", undefined, auth);
    const me = c.json!.agents.find((x: Json) => x.you);
    assert.deepEqual([me.state, me.status], ["working", "reading the TCB…"]);
    // as a tool, the same
    await M.start();
    const tool = await M.ask("tools/call", { name: "status", arguments: { text: "comparing the two games" } });
    assert.ok(!tool.result.isError, tool.result.content[0].text);
    assert.equal(peer(S)!.talk!.status, "comparing the two games");
    // a reply clears it
    await S.ask("POST", "/api/agent/reply", { text: "done" }, auth);
    assert.equal(peer(S)!.talk!.status, null);
    // and so does a wait
    await S.ask("POST", "/api/agent/status", { text: "busy" }, auth);
    await S.ask("GET", "/api/agent/inbox?wait=0", undefined, auth);
    assert.equal(peer(S)!.talk!.status, null);
  } finally {
    M.stop();
    await S.close();
  }
});

test("revoking a token ends its wait at once, over HTTP and in the MCP server, which tells the model", async () => {
  const S = await site();
  const { id, token } = await share(S);
  const M = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: token });
  try {
    await M.start();
    const mcpWait = M.send("tools/call", { name: "wait_for_message", arguments: {} });
    await M.until(() => stateOf(S) === "listening");
    // over HTTP too (the newest wait of the two is the one open: take the MCP server's place)
    const httpWait = inbox(S, token, "wait=30");
    const replaced = await mcpWait.answered;
    assert.match(replaced.result.content[0].text, /took this one's place/);
    await sleep(50);
    const t0 = Date.now();
    assert.equal((await S.ask("POST", "/api/share/agents/revoke", { id }, ALICE)).status, 200);
    const r = await httpWait;
    assert.ok(r.t - t0 < 1000, `${r.t - t0} ms`);
    assert.equal(r.status, 401);
    assert.match(r.json!.error, /revoked/);
    assert.equal(peer(S), undefined, "off the list");
    // the MCP server, waiting again, is told at once, and says so from then on
    const t1 = Date.now();
    const after = await M.ask("tools/call", { name: "wait_for_message", arguments: {} });
    assert.ok(Date.now() - t1 < 1000);
    assert.equal(after.result.isError, true);
    assert.match(after.result.content[0].text, /revoked/);
    const again = await M.ask("tools/call", { name: "wait_for_message", arguments: {} });
    assert.match(again.result.content[0].text, /revoked/);
    // a wait open in the MCP server when the token is revoked ends at once too
    const S2 = await site();
    try {
      const two = await share(S2);
      const M2 = mcp({ VISUALPROOF_URL: S2.base, VISUALPROOF_TOKEN: two.token });
      try {
        await M2.start();
        const w = M2.send("tools/call", { name: "wait_for_message", arguments: {} });
        await M2.until(() => stateOf(S2) === "listening");
        const t2 = Date.now();
        await S2.ask("POST", "/api/share/agents/revoke", { id: two.id }, ALICE);
        const ended = await w.answered;
        assert.ok(ended.t - t2 < 1000, `${ended.t - t2} ms`);
        assert.equal(ended.result.isError, true);
        assert.match(ended.result.content[0].text, /revoked/);
      } finally {
        M2.stop();
      }
    } finally {
      await S2.close();
    }
  } finally {
    M.stop();
    await S.close();
  }
});

test("what an agent's requests show it doing, in words, names as code", () => {
  const ask = (path: string, query: Record<string, string> = {}, body: unknown = null): Ask => ({ method: body ? "POST" : "GET", path, query: new URLSearchParams(query), body, caller: { name: "A", kind: "agent" } });
  assert.equal(doingOf(ask("/api/agent/search", { q: "swap" })), 'searching "swap"');
  assert.equal(doingOf(ask("/api/agent/declaration", { name: "IsRegularPrime" })), "reading `IsRegularPrime`");
  assert.equal(doingOf(ask("/api/agent/declarations", { names: "A.b,A.c" })), "reading 2 declarations, `A.b` first");
  assert.equal(doingOf(ask("/api/agent/tcb", { target: "A.t" })), "walking the TCB of `A.t`");
  assert.equal(doingOf(ask("/api/agent/opinion", {}, { name: "A.b", verdict: "approve" })), "giving advice on `A.b`");
  assert.equal(doingOf(ask("/api/agent/views/open", {}, { scope: "tcb(A.b)" })), "opening a view on tcb(A.b)");
  assert.equal(doingOf(ask("/api/agent/view", {}, { sel: "A.b" })), "going to `A.b`");
  assert.equal(doingOf(ask("/api/agent/declaration")), null, "nothing worth saying");
  assert.equal(doingOf(ask("/api/agent/nowhere")), null);
  assert.ok(doingOf(ask("/api/agent/search", { q: "x".repeat(500) }))!.length < 140, "kept short");
});

test("the state line in the conversation and the tooltip: listening; thinking, its seconds and what it does, names as links; its own line; offline", () => {
  const resolve = (n: string) => (n === "IsRegularPrime" ? n : null);
  const at = Date.parse("2026-10-08T12:00:00Z");
  const t = (o: Partial<AgentTalk>): AgentTalk => ({ state: "listening", since: "2026-10-08T12:00:00.000Z", doing: null, status: null, read: 0, readPublic: 0, lastSeen: null, ...o });
  assert.equal(stateLine(t({}), resolve, at), "listening");
  const thinking = stateLine(t({ state: "thinking", doing: "reading `IsRegularPrime`" }), resolve, at + 12_400);
  assert.match(thinking, /^thinking · 12 s · reading <a href="#" class="tk-decl" data-decl="IsRegularPrime"[^>]*><code>IsRegularPrime<\/code><\/a>$/);
  // its own line, where it set one, over what its requests show; its own words are escaped
  assert.equal(stateLine(t({ state: "thinking", doing: "reading `IsRegularPrime`", status: "comparing <b>games</b>" }), resolve, at + 125_000), "thinking · 2 min · comparing &lt;b&gt;games&lt;/b&gt;");
  assert.equal(stateLine(t({ state: "working", doing: 'searching "swap"' }), resolve, at), "working · searching &quot;swap&quot;");
  assert.match(stateLine(t({ state: "offline", lastSeen: new Date(Date.now() - 5 * 60_000).toISOString() }), resolve), /^offline · last seen 5 min ago$/);
  assert.equal(stateLine(t({ state: "offline" }), resolve), "offline · not seen yet");
  assert.equal(stateWords(t({ state: "thinking", doing: "reading `IsRegularPrime`" }), at + 3000), "thinking for 3 s: reading IsRegularPrime");
  assert.match(stateWords(t({})), /reaches it at once/);
  assert.match(stateWords(t({ state: "working" })), /waits for its next wait/);
});

test("senders are held to a rate; a message and a reply have bounded size", async () => {
  const S = await site();
  try {
    const { token } = await share(S);
    const auth = { authorization: `Bearer ${token}` };
    await S.ask("GET", "/api/agent/inbox", undefined, auth);
    const id = peer(S)!.id;
    const codes: number[] = [];
    for (let k = 0; k < 7; k++) codes.push((await S.ask("POST", "/api/chat", { agent: id, text: `m${k}` }, ALICE)).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
    const slow = await S.ask("POST", "/api/chat", { agent: id, text: "again" }, ALICE);
    assert.ok(Number(slow.headers.get("retry-after")) > 0);
    // in every channel together: Alice's public messages too
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "and here?" }, ALICE)).status, 429);
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "x".repeat(4001) }, BOB)).status, 400);
    // another sender has a rate of their own
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "me too" }, BOB)).status, 200);
    assert.equal((await S.ask("POST", "/api/agent/reply", { text: "x".repeat(10_001) }, auth)).status, 400);
    const replies: number[] = [];
    for (let k = 0; k < 12; k++) replies.push((await S.ask("POST", "/api/agent/reply", { text: `r${k}` }, auth)).status);
    assert.deepEqual(replies.slice(0, 10), Array(10).fill(200));
    assert.equal(replies[11], 429);
    const conv = await S.ask("GET", "/api/agent/conversation?limit=3", undefined, auth);
    assert.deepEqual(conv.json!.messages.map((m: Json) => m.text), ["r7", "r8", "r9"]);
    assert.equal(conv.json!.state, "working");
  } finally {
    await S.close();
  }
});

test("a private channel keeps 30 days, the public one 90: older messages are left out and dropped from its file; one nobody wrote in goes", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-talk-"));
  try {
    const day = 86_400_000;
    const t = new Talk(dir);
    t.post("aaaaaaaaaa", { from: "Alice", kind: "person", text: "old" }, null, Date.now() - 31 * day);
    t.post("aaaaaaaaaa", { from: "Alice", kind: "person", text: "new" }, null, Date.now() - day);
    assert.deepEqual(t.thread("aaaaaaaaaa").map((m) => m.text), ["new"]);
    t.post("public", { from: "Alice", kind: "person", text: "older" }, null, Date.now() - 91 * day);
    t.post("public", { from: "Alice", kind: "person", text: "a month" }, null, Date.now() - 31 * day);
    assert.deepEqual(t.thread("public").map((m) => [m.text, m.channel]), [["a month", "public"]]);
    // read afresh (a restart): the file loses the old one; what was written before counts as read
    const again = new Talk(dir);
    assert.deepEqual(again.thread("aaaaaaaaaa").map((m) => m.text), ["new"]);
    assert.equal(again.talk("aaaaaaaaaa").read, 2, "the new one is message 2: the old one took 1, expired or not");
    assert.equal(readFileSync(join(dir, "chat", "aaaaaaaaaa.jsonl"), "utf8").trim().split("\n").length, 1);
    assert.deepEqual(again.thread("public").map((m) => m.text), ["a month"]);
    assert.equal(readFileSync(join(dir, "chat", "public.jsonl"), "utf8").trim().split("\n").length, 1);
    // a conversation nobody wrote in for 30 days goes whole
    mkdirSync(join(dir, "chat"), { recursive: true });
    writeFileSync(join(dir, "chat", "bbbbbbbbbb.jsonl"), JSON.stringify({ id: 1, at: new Date(Date.now() - 40 * day).toISOString(), from: "Bob", kind: "person", text: "x" }) + "\n");
    const old = new Date(Date.now() - 40 * day);
    utimesSync(join(dir, "chat", "bbbbbbbbbb.jsonl"), old, old);
    // the public channel, after 90 days
    utimesSync(join(dir, "chat", "public.jsonl"), old, old);
    again.sweep();
    assert.ok(!existsSync(join(dir, "chat", "bbbbbbbbbb.jsonl")));
    assert.ok(existsSync(join(dir, "chat", "aaaaaaaaaa.jsonl")));
    assert.ok(existsSync(join(dir, "chat", "public.jsonl")), "40 days: kept");
    const older = new Date(Date.now() - 91 * day);
    utimesSync(join(dir, "chat", "public.jsonl"), older, older);
    again.sweep();
    assert.ok(!existsSync(join(dir, "chat", "public.jsonl")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the MCP server offers export: a view's model, its document typeset, its file saved where the agent says; a link to a picture of the board", async () => {
  const S = await site({ exporter: true });
  const { token } = await share(S);
  const M = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: token });
  const dir = mkdtempSync(join(tmpdir(), "vp-mcp-export-"));
  try {
    await M.start();
    const tools = (await M.ask("tools/list")).result.tools as Json[];
    assert.deepEqual(tools.find((x) => x.name === "export")!.inputSchema.properties.action.enum, ["model", "typeset", "job", "file", "artwork"]);
    assert.ok(!tools.some((x) => x.name === "export_outline"), "no outline: the view is what is printed");
    const call = async (action: string, args: Json) => (await M.ask("tools/call", { name: "export", arguments: { action, ...args } })).result as { content: { text: string }[]; isError?: boolean };
    const model = await call("model", { view: "project", settings: { paper: "letter" } });
    assert.ok(!model.isError, model.content[0].text);
    assert.equal(JSON.parse(model.content[0].text).settings.paper, "letter", "an object argument goes as JSON");
    // an artwork's recipe goes as JSON too (ExportSpec decision 20)
    const art = await call("artwork", { recipe: { size: "hd", names: { clusters: 0 }, selection: { name: "N.b" } }, save: "svg" });
    assert.ok(!art.isError, art.content[0].text);
    assert.match(JSON.parse(art.content[0].text).link, /#mode=tcb&s=N\.b&art=[A-Za-z0-9_-]+&save=svg$/);
    const relative = await call("file", { id: "0".repeat(32), saveTo: "doc.pdf" });
    assert.equal(relative.isError, true);
    assert.match(relative.content[0].text, /absolute path/);
    if (!S.app.exporter!.available()) return;
    const started = JSON.parse((await call("typeset", { view: "project", settings: { codeSize: 9 } })).content[0].text);
    let job = started.job;
    for (let k = 0; k < 120 && job.state === "running"; k++) {
      await sleep(250);
      job = JSON.parse((await call("job", { id: job.id })).content[0].text).job;
    }
    assert.equal(job.state, "done", job.log);
    const at = join(dir, "doc.pdf");
    const saved = await call("file", { id: job.id, what: "pdf", saveTo: at });
    assert.ok(!saved.isError, saved.content[0].text);
    assert.match(saved.content[0].text, /Saved [\d,]+ bytes \(application\/pdf\)/);
    assert.equal(readFileSync(at).subarray(0, 5).toString(), "%PDF-");
    // a file that exists is not overwritten
    const again = await call("file", { id: job.id, saveTo: at });
    assert.equal(again.isError, true);
    // an MCP server from before it saved files relays saveTo as a parameter: it is told to update
    const old = await S.ask("GET", `/api/agent/export/file?id=${job.id}&what=pdf&saveTo=${encodeURIComponent(at)}`, undefined, { authorization: `Bearer ${token}` });
    assert.equal(old.status, 400);
    assert.match(old.json?.hint, /api\/agent\/mcp/);
  } finally {
    M.stop();
    rmSync(dir, { recursive: true, force: true });
    await S.close();
  }
});

test("the MCP server's library tool: a file of the agent's machine sent, a page read, the file saved where the agent says", async () => {
  const S = await site();
  const { token } = await share(S);
  const M = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: token });
  const dir = mkdtempSync(join(tmpdir(), "vp-mcp-library-"));
  try {
    await M.start();
    const pdf = tinyPdf([["Theorem 3. Halving undoes doubling."]], "Games");
    writeFileSync(join(dir, "games.pdf"), pdf);
    const call = async (args: Json) => (await M.ask("tools/call", { name: "library", arguments: args })).result as { content: { text: string }[]; isError?: boolean };
    const added = await call({ action: "add_file", path: join(dir, "games.pdf") });
    assert.ok(!added.isError, added.content[0].text);
    const sha = JSON.parse(added.content[0].text).file.sha as string;
    assert.match(JSON.parse((await call({ action: "text", sha, page: 1 })).content[0].text).text, /Halving undoes doubling/);
    const saved = await call({ action: "save", sha, saveTo: join(dir, "again.pdf") });
    assert.ok(!saved.isError, saved.content[0].text);
    assert.deepEqual(readFileSync(join(dir, "again.pdf")), pdf);
  } finally {
    M.stop();
    rmSync(dir, { recursive: true, force: true });
    await S.close();
  }
});

test("the MCP server without its environment says so, and keeps to the protocol", async () => {
  const M = mcp({ VISUALPROOF_URL: "", VISUALPROOF_TOKEN: "" });
  try {
    const init = await M.ask("initialize", { protocolVersion: "2025-06-18" });
    assert.ok(init.result.instructions);
    M.tell("notifications/initialized");
    const tools = (await M.ask("tools/list")).result.tools as Json[];
    assert.deepEqual(tools.map((x) => x.name), ["connection"]);
    const why = await M.ask("tools/call", { name: "connection", arguments: {} });
    assert.equal(why.result.isError, true);
    assert.match(why.result.content[0].text, /VISUALPROOF_URL and VISUALPROOF_TOKEN/);
  } finally {
    M.stop();
  }
});

test("the MCP server with a token the server does not know says what to check", async () => {
  const S = await site({ key: "k".repeat(40) });
  const M = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: `vpa_0123456789_${"A".repeat(43)}` });
  try {
    await M.start();
    const why = await M.ask("tools/call", { name: "connection", arguments: {} });
    assert.equal(why.result.isError, true);
    assert.match(why.result.content[0].text, /answered 404: not found — .*VISUALPROOF_TOKEN is the whole token from Share/);
  } finally {
    M.stop();
    await S.close();
  }
});

test("an agent's text is rendered from escaped text: a little Markdown, declarations as links, never HTML of its own", () => {
  const names = new Map([["N.a", "N.a"], ["a", "N.a"], ["N.b", "N.b"]]);
  const resolve = (n: string) => names.get(n) ?? null;
  const html = renderMarkdown("**Note** that *b* is `N.a`, see N.b and `x + 1`.\n<script>alert(1)</script> <img src=x onerror=alert(1)>\n```lean\ndef c := <b>\n```", resolve);
  assert.ok(!/<script|<img/.test(html), html);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt;"));
  assert.match(html, /<b>Note<\/b>/);
  assert.match(html, /<i>b<\/i>/);
  assert.match(html, /<a href="#" class="tk-decl" data-decl="N\.a" title="N\.a"><code>N\.a<\/code><\/a>/);
  assert.match(html, /<a href="#" class="tk-decl" data-decl="N\.b" title="N\.b">N\.b<\/a>/);
  assert.match(html, /<code>x \+ 1<\/code>/);
  assert.match(html, /<pre class="tk-pre"><code>def c := &lt;b&gt;<\/code><\/pre>/);
  // a short name only one declaration has is a link too; a quote cannot leave an attribute
  assert.match(renderMarkdown("`a`", resolve), /data-decl="N\.a"/);
  const quoted = renderMarkdown('`N.a" onclick="x`', (n) => n);
  assert.ok(!/ onclick="x"/.test(quoted), quoted);
});

// ---------------------------------------------------------------- a new session, a new conversation
// (the owner's decisions of 2026-10-11)

test("the first wait after the agent left hands it the conversation so far, at once, then waits as before; new messages come after it", async () => {
  const S = await site();
  try {
    const { token } = await share(S);
    const auth = { authorization: `Bearer ${token}` };
    // a conversation: two questions, two answers
    const first = inbox(S, token, "wait=20");
    await sleep(50);
    const id = peer(S)!.id;
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "What does N.b stand for?", place: here }, ALICE)).status, 200);
    assert.deepEqual((await first).json!.messages.map((m: Json) => m.text), ["What does N.b stand for?"]);
    await S.ask("POST", "/api/agent/reply", { text: "It is `N.a`." }, auth);
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "And N.a?" }, ALICE)).status, 200);
    assert.deepEqual((await inbox(S, token, "wait=20")).json!.messages.map((m: Json) => m.text), ["And N.a?"]);
    await S.ask("POST", "/api/agent/reply", { text: "Zero." }, auth);
    // the session leaves, as its MCP server does when it stops: offline
    await S.ask("POST", "/api/agent/view", { leave: true }, auth);
    assert.equal(stateOf(S), "offline");
    // a new session: its requests first, then its first wait, which answers at once
    await S.ask("GET", "/api/agent", undefined, auth);
    const t0 = Date.now();
    const back = await inbox(S, token, "wait=20");
    assert.ok(back.t - t0 < 1000, `${back.t - t0} ms`);
    assert.equal(back.json!.waited, 0);
    const [e, ...rest] = back.json!.messages;
    assert.equal(rest.length, 0);
    assert.deepEqual([e.id, e.kind, e.from, e.count, e.omitted], [0, "earlier", "VisualProof", 4, 0]);
    const text = e.text as string;
    assert.match(text, /^Earlier in this conversation, before you joined — read it as context, and do not answer it again:\n\n/);
    // each with who wrote it, where they were and when; the agent's own as its own
    assert.match(text, /— Alice, on the Project view, reading the source of N\.b, \d{4}-\d\d-\d\d \d\d:\d\d UTC \(message 1\):\nWhat does N\.b stand for\?/);
    assert.match(text, /— You \(Alice's AI\), [^\n]+ UTC \(message 2\):\nIt is `N\.a`\./);
    assert.match(text, /— Alice, [^\n]+ \(message 3\):\nAnd N\.a\?/);
    assert.match(text, /\(message 4\):\nZero\.\n\nEnd of the earlier messages\. Nothing came since: there is nothing to answer\. Listen again\.$/);
    assert.match(back.json!.next, /^Nothing to answer/);
    assert.equal(stateOf(S), "working", "nothing to think about");
    // only the first time: the next wait is as any
    const again = await inbox(S, token, "wait=0.3");
    assert.deepEqual(again.json!.messages, []);
    const next = inbox(S, token, "wait=20");
    await sleep(50);
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "Still there?" }, ALICE)).status, 200);
    assert.deepEqual((await next).json!.messages.map((m: Json) => [m.kind, m.text]), [["person", "Still there?"]]);
    await S.ask("POST", "/api/agent/reply", { text: "Yes." }, auth);
    // left again; a message written while the new session works, before it waits, comes after the
    // conversation so far, and is to be answered
    await S.ask("POST", "/api/agent/view", { leave: true }, auth);
    await S.ask("GET", "/api/agent/targets", undefined, auth);
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "One more" }, ALICE)).status, 200);
    const third = await inbox(S, token, "wait=20");
    assert.deepEqual(third.json!.messages.map((m: Json) => m.kind), ["earlier", "person"]);
    assert.equal(third.json!.messages[0].count, 6);
    assert.match(third.json!.messages[0].text, /What came since follows: answer that\.$/);
    assert.ok(!third.json!.messages[0].text.includes("One more"), "what is new is not in what came before");
    assert.equal(third.json!.messages[1].text, "One more");
    assert.match(third.json!.next, /POST \/api\/agent\/reply/);
    assert.equal(stateOf(S), "thinking");
  } finally {
    await S.close();
  }
});

test("the conversation so far is the newest messages, at most 50 and 20,000 characters of text, whichever is less", () => {
  const at = (k: number) => new Date(Date.parse("2026-10-11T10:00:00Z") + k * 60_000).toISOString();
  const msg = (k: number, text: string) => ({ id: k, at: at(k), from: k % 2 ? "Alice" : "Alice's AI", kind: (k % 2 ? "person" : "agent") as "person" | "agent", channel: "private" as const, text, where: null });
  // many short ones: the last 50, the oldest left out, and said so
  const many = Array.from({ length: 60 }, (_, k) => msg(k + 1, `m${k + 1}`));
  const e = earlierOf(many, false)!;
  assert.deepEqual([e.count, e.omitted], [EARLIER_MESSAGES, 10]);
  assert.match(e.text, /\(message 11\):\nm11\n/);
  assert.ok(!/\(message 10\)/.test(e.text), "the oldest go");
  assert.match(e.text, /^Earlier in this conversation, before you joined \(its last 50 messages; the conversation tool, GET \/api\/agent\/conversation, gives the 10 before them\)/);
  // long ones: within 20,000 characters of text
  const long = Array.from({ length: 10 }, (_, k) => msg(k + 1, String(k + 1).repeat(3000).slice(0, 3000)));
  const l = earlierOf(long, true)!;
  assert.deepEqual([l.count, l.omitted], [6, 4]);
  assert.ok(6 * 3000 <= EARLIER_CHARS && 7 * 3000 > EARLIER_CHARS);
  assert.match(l.text, /\(message 5\):/);
  assert.ok(!/\(message 4\):/.test(l.text));
  assert.match(l.text, /What came since follows: answer that\.$/);
  // nothing: no entry
  assert.equal(earlierOf([], true), null);
});

test("offline by the rule, or another session of the MCP server, or the server restarted meanwhile: the first wait hands the conversation so far", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-talk-"));
  try {
    const tok = "cccccccccc";
    const T = new Talk(dir, { slackMs: 100, graceMs: 20, tickMs: 20 });
    T.post(tok, { from: "Alice", kind: "person", text: "q" });
    T.post(tok, { from: "Alice's AI", kind: "agent", text: "a" });
    // the first request since the server started, never seen before: the conversation so far
    const meet = await T.wait(tok, 10_000, { session: "aaaaaaaa-1" });
    assert.ok("messages" in meet && meet.messages[0].kind === "earlier");
    // a wait of 50 ms, then nothing: offline by the rule after it and the slack
    const short = await T.wait(tok, 50, { session: "aaaaaaaa-1" });
    assert.ok("messages" in short && short.messages.length === 0);
    for (let k = 0; k < 50 && T.state(tok) !== "offline"; k++) await sleep(20);
    assert.equal(T.state(tok), "offline");
    const t0 = Date.now();
    const back = await T.wait(tok, 10_000, { session: "aaaaaaaa-1" });
    assert.ok(Date.now() - t0 < 500);
    assert.ok("messages" in back && back.messages.length === 1 && back.messages[0].kind === "earlier");
    // another session than the one that waited last, though nobody left nor went offline
    const same = T.wait(tok, 60, { session: "aaaaaaaa-1" });
    assert.deepEqual(await same, { messages: [], waitedMs: (await same as { waitedMs: number }).waitedMs });
    const other = await T.wait(tok, 10_000, { session: "bbbbbbbb-2" });
    assert.ok("messages" in other && other.messages[0].kind === "earlier");
    const quiet = await T.wait(tok, 30, { session: "bbbbbbbb-2" });
    assert.ok("messages" in quiet && quiet.messages.length === 0, "once");
    // the server restarted: the token file says when the token was last used before
    const restarted = (lastUsed: string | null) => {
      const R = new Talk(dir);
      R.lastUsed = () => lastUsed;
      return R;
    };
    // used a minute ago (the session that listened, back with the server): as any wait
    const soon = await restarted(new Date(Date.now() - 60_000).toISOString()).wait(tok, 30);
    assert.ok("messages" in soon && soon.messages.length === 0);
    // used longer ago than the longest wait and a minute: it was offline meanwhile
    const late = await restarted(new Date(Date.now() - (1800 + 120) * 1000).toISOString()).wait(tok, 30);
    assert.ok("messages" in late && late.messages[0]?.kind === "earlier");
    // what was written before the server started stays read: never handed over as new
    const R = restarted(new Date(Date.now() - 60_000).toISOString());
    assert.equal(R.talk(tok).read, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a session a newer one replaced leaves nothing as its client goes: the newer one listens on; its own leave, or one that says no session, is offline at once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-talk-"));
  try {
    const tok = "dddddddddd";
    const T = new Talk(dir, { slackMs: 100, graceMs: 20, tickMs: 20 });
    // session A waits; session B, of the same token, waits: A's wait is replaced
    const a = T.wait(tok, 10_000, { session: "aaaaaaaa-1" });
    const b = T.wait(tok, 10_000, { session: "bbbbbbbb-2" });
    assert.ok("replaced" in (await a));
    // A's client goes, and its MCP server says it leaves: B goes on listening, its wait open
    assert.equal(T.left(tok, "aaaaaaaa-1"), false);
    assert.equal(T.state(tok), "listening");
    T.post(tok, { from: "Alice", kind: "person", text: "still there?" });
    const heard = await b;
    assert.ok("messages" in heard && heard.messages.map((m) => m.text).includes("still there?"), "the message reached B");
    // B's own leave: offline at once; and a leave that names no session (an MCP server from before)
    assert.equal(T.left(tok, "bbbbbbbb-2"), true);
    assert.equal(T.state(tok), "offline");
    T.seen(tok, null);
    assert.equal(T.left(tok), true);
    assert.equal(T.state(tok), "offline");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a new conversation: a divider, kept in the same file, sent to its maker's pages; who may start one, its rate, one right after another, an offline agent's", async () => {
  const S = await site();
  try {
    const { id: tokId, token } = await share(S);
    const auth = { authorization: `Bearer ${token}` };
    const page = stream(S.port, "/api/events?session=aaaaaaaa2222", ALICE);
    await page.until(() => (page.last("presence") as Peer[] | undefined)?.some((p) => p.name === "Alice's AI") ?? false);
    const id = peer(S)!.id;
    // nothing said yet: a divider would divide nothing
    const none = await S.ask("POST", "/api/chat/new", { agent: id }, ALICE);
    assert.deepEqual([none.status, none.json!.unchanged, none.json!.divider], [200, true, null]);
    // a conversation
    await S.ask("GET", "/api/agent/inbox", undefined, auth);
    for (const text of ["one", "two"]) assert.equal((await S.ask("POST", "/api/chat", { agent: id, text }, ALICE)).status, 200);
    await S.ask("POST", "/api/agent/reply", { text: "both" }, auth);
    // who: its maker, with a name; not an agent, nor anyone else (the owner's decision of 2026-10-19)
    assert.equal((await S.ask("POST", "/api/chat/new", { agent: id })).status, 401);
    assert.equal((await S.ask("POST", "/api/chat/new", { agent: id }, { ...ALICE, "x-visualproof-kind": "agent" })).status, 403);
    assert.equal((await S.ask("POST", "/api/chat/new", { agent: "nobody" }, ALICE)).status, 404);
    assert.equal((await S.ask("GET", "/api/chat/new", undefined, ALICE)).status, 405);
    assert.equal((await S.ask("POST", "/api/chat/new", { agent: id }, BOB)).status, 403);
    // Alice starts one: kept, and her pages are sent it as a message is
    const made = await S.ask("POST", "/api/chat/new", { agent: id }, ALICE);
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const d = made.json!.divider;
    assert.deepEqual([d.id, d.kind, d.from, d.channel, d.text], [4, "divider", "Alice", "private", "Alice started a new conversation: disregard what came before."]);
    await page.until(() => page.events.some((e) => e.event === "chat" && e.data.message.kind === "divider" && e.data.channel === id));
    const lines = readFileSync(join(S.dir, "state", "chat", `${tokId}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((m) => m.kind), ["person", "person", "agent", "divider"]);
    assert.deepEqual((await S.ask("GET", `/api/chat?channel=${encodeURIComponent(id)}`, undefined, ALICE)).json!.messages.map((m: Json) => m.kind), ["person", "person", "agent", "divider"]);
    // right after a divider: nothing, neither written nor sent nor counted
    const chats = page.events.filter((e) => e.event === "chat").length;
    const twice = await S.ask("POST", "/api/chat/new", { agent: id }, ALICE);
    assert.deepEqual([twice.status, twice.json!.unchanged], [200, true]);
    assert.equal(readFileSync(join(S.dir, "state", "chat", `${tokId}.jsonl`), "utf8").trim().split("\n").length, 4);
    await sleep(50);
    assert.equal(page.events.filter((e) => e.event === "chat").length, chats);
    // held to the rate of her messages, with them: two and a divider; two more, then no
    for (const text of ["three", "four"]) assert.equal((await S.ask("POST", "/api/chat", { agent: id, text }, ALICE)).status, 200);
    const slow = await S.ask("POST", "/api/chat/new", { agent: id }, ALICE);
    assert.equal(slow.status, 429);
    assert.ok(Number(slow.headers.get("retry-after")) > 0);
    // a minute later: an offline agent's conversation can be started anew, so that its next session
    // starts clean
    (S.live.talk as unknown as { buckets: Map<string, unknown> }).buckets.clear();
    await S.ask("POST", "/api/agent/view", { leave: true }, auth);
    assert.equal(stateOf(S), "offline");
    const off = await S.ask("POST", "/api/chat/new", { agent: id }, ALICE);
    assert.equal(off.status, 200);
    assert.equal(off.json!.divider.kind, "divider");
    // its next session is handed nothing of before: its first wait waits as any, with no notice
    const t0 = Date.now();
    const clean = await inbox(S, token, "wait=0.3");
    assert.ok(clean.t - t0 >= 280, "it waited");
    assert.deepEqual(clean.json!.messages, []);
    const after = inbox(S, token, "wait=20");
    await sleep(50);
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "fresh start" }, ALICE)).status, 200);
    assert.deepEqual((await after).json!.messages.map((m: Json) => [m.kind, m.text]), [["person", "fresh start"]]);
    page.close();
  } finally {
    await S.close();
  }
});

test("a running agent is told of a new conversation: at once while it listens, else at its next wait, in order with what was written; a later session only what came after", async () => {
  const S = await site();
  try {
    const { token } = await share(S);
    const auth = { authorization: `Bearer ${token}` };
    const first = inbox(S, token, "wait=20");
    await sleep(50);
    const id = peer(S)!.id;
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "old question" }, ALICE)).status, 200);
    await first;
    await S.ask("POST", "/api/agent/reply", { text: "old answer" }, auth);
    // listening: the notice comes at once, and needs no answer
    const listening = inbox(S, token, "wait=20");
    await sleep(50);
    const sentAt = Date.now();
    assert.equal((await S.ask("POST", "/api/chat/new", { agent: id }, ALICE)).status, 200);
    const told = await listening;
    assert.ok(told.t - sentAt < 500, `${told.t - sentAt} ms`);
    assert.deepEqual(told.json!.messages.map((m: Json) => [m.kind, m.from, m.channel, m.text]), [["divider", "Alice", "private", "Alice started a new conversation: disregard what came before."]]);
    assert.match(told.json!.next, /^Nothing to answer/);
    assert.equal(stateOf(S), "working", "a notice is not a question");
    // thinking: at its next wait, in order with what was written around it
    const w = inbox(S, token, "wait=20");
    await sleep(50);
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "new question" }, ALICE)).status, 200);
    await w;
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "forget this" }, ALICE)).status, 200);
    await S.ask("POST", "/api/agent/reply", { text: "new answer" }, auth);
    // (a minute later: Alice's rate)
    (S.live.talk as unknown as { buckets: Map<string, unknown> }).buckets.clear();
    assert.equal((await S.ask("POST", "/api/chat/new", { agent: id }, ALICE)).status, 200);
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "newest question" }, ALICE)).status, 200);
    const queued = await inbox(S, token, "wait=20");
    assert.equal(queued.json!.waited, 0);
    assert.deepEqual(queued.json!.messages.map((m: Json) => [m.kind, m.text]), [["person", "forget this"], ["divider", "Alice started a new conversation: disregard what came before."], ["person", "newest question"]]);
    assert.equal(stateOf(S), "thinking");
    await S.ask("POST", "/api/agent/reply", { text: "newest answer" }, auth);
    // a later session: only what came after the last divider
    await S.ask("POST", "/api/agent/view", { leave: true }, auth);
    const back = await inbox(S, token, "wait=20");
    const e = back.json!.messages;
    assert.deepEqual(e.map((m: Json) => m.kind), ["earlier"]);
    assert.equal(e[0].count, 2);
    assert.match(e[0].text, /newest question[\s\S]*newest answer/);
    for (const gone of ["old question", "new question", "forget this", "new answer", "started a new conversation"]) assert.ok(!e[0].text.includes(gone), gone);
  } finally {
    await S.close();
  }
});

test("the MCP server: a new session's first wait_for_message is the conversation so far, apart from what is new; a new conversation's notice; its waits say which session they are", async () => {
  const S = await site();
  const { token } = await share(S);
  const auth = { authorization: `Bearer ${token}` };
  const M = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: token });
  let M2: ReturnType<typeof mcp> | null = null;
  try {
    await M.start();
    const w = M.send("tools/call", { name: "wait_for_message", arguments: {} });
    await M.until(() => stateOf(S) === "listening");
    const id = peer(S)!.id;
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "Why N.b?", place: here }, ALICE)).status, 200);
    assert.match((await w.answered).result.content[0].text, /^A message from the page/);
    await M.ask("tools/call", { name: "reply", arguments: { text: "Because `N.a`." } });
    // a notice, while it listens: no question, nothing to answer
    const n = M.send("tools/call", { name: "wait_for_message", arguments: {} });
    await M.until(() => stateOf(S) === "listening");
    assert.equal((await S.ask("POST", "/api/chat/new", { agent: id }, ALICE)).status, 200);
    const notice = (await n.answered).result.content[0].text as string;
    assert.match(notice, /^From the page, after \d+\.\d s of listening:\n\nAlice started a new conversation: disregard what came before\. \(message 3, [^)]+\)\n\nNothing to answer: call wait_for_message again\.$/);
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "Is N.a zero?", place: here }, ALICE)).status, 200);
    const q = (await M.ask("tools/call", { name: "wait_for_message", arguments: {} })).result.content[0].text as string;
    assert.match(q, /Is N\.a zero\?/);
    await M.ask("tools/call", { name: "reply", arguments: { text: "Yes." } });
    // the session dies without saying it left (no leave: killed); another starts at once, so the
    // agent was never offline: its MCP server's session says it is a new one
    const quiet = M.send("tools/call", { name: "wait_for_message", arguments: {} });
    await M.until(() => stateOf(S) === "listening");
    void quiet;
    M.child.kill("SIGKILL");
    await M.exited;
    M2 = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: token });
    await M2.start();
    const t0 = Date.now();
    const first = await M2.ask("tools/call", { name: "wait_for_message", arguments: {} });
    assert.ok(Date.now() - t0 < 1500, "at once");
    const said = first.result.content[0].text as string;
    assert.match(said, /^From the page, after \d+\.\d s of listening:\n\nEarlier in this conversation, before you joined — read it as context, and do not answer it again:\n\n— Alice, on the Project view, reading the source of N\.b, [^\n]+ \(message 4\):\nIs N\.a zero\?\n\n— You \(Alice's AI\), [^\n]+ \(message 5\):\nYes\.\n\nEnd of the earlier messages\. Nothing came since: there is nothing to answer\. Listen again\.\n\nNothing to answer: call wait_for_message again\.$/);
    assert.ok(!said.includes("Why N.b?"), "before the divider");
    // once: the next waits for a message
    const next = M2.send("tools/call", { name: "wait_for_message", arguments: {} });
    await M2.until(() => stateOf(S) === "listening");
    assert.equal((await S.ask("POST", "/api/chat", { agent: id, text: "Thanks" }, ALICE)).status, 200);
    assert.match((await next.answered).result.content[0].text, /^A message from the page, after [\d.]+ s of listening:\n\nAlice wrote to you, in your private channel \(message 6/);
    // conversation: since the divider by default, all of it on asking
    const conv = await M2.ask("tools/call", { name: "conversation", arguments: {} });
    const c = JSON.parse(conv.result.content[0].text);
    assert.deepEqual(c.messages.map((m: Json) => m.text), ["Is N.a zero?", "Yes.", "Thanks"]);
    assert.deepEqual([c.divider.id, c.divider.from, c.before], [3, "Alice", 2]);
    assert.match(c.note, /Alice started a new conversation at [^:]+:\d\d:[^ ]+: the 2 messages before it are left out \(all=1 gives them\)/);
    const all = JSON.parse((await M2.ask("tools/call", { name: "conversation", arguments: { all: true } })).result.content[0].text);
    assert.deepEqual(all.messages.map((m: Json) => m.kind), ["person", "agent", "divider", "person", "agent", "person"]);
    assert.equal(all.note, undefined);
    const http = await S.ask("GET", "/api/agent/conversation?limit=2", undefined, auth);
    assert.deepEqual(http.json!.messages.map((m: Json) => m.text), ["Yes.", "Thanks"]);
  } finally {
    M.stop();
    M2?.stop();
    await S.close();
  }
});

test("the MCP server: a mention in the public channel says so, and where the answer goes; reply writes there by default, or where it says", async () => {
  const S = await site();
  const { token } = await share(S);
  const M = mcp({ VISUALPROOF_URL: S.base, VISUALPROOF_TOKEN: token });
  try {
    await M.start();
    const w = M.send("tools/call", { name: "wait_for_message", arguments: {} });
    await M.until(() => stateOf(S) === "listening");
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "@Alice's AI is N.b zero?", place: here }, BOB)).status, 200);
    const said = (await w.answered).result.content[0].text as string;
    assert.match(said, /^A message from the page, after [\d.]+ s of listening:\n\nBob wrote in the public channel, mentioning you, on the Project view, reading the source of N\.b \(public message 1, [^)]+\):\n@Alice's AI is N\.b zero\?\n\nAnswer with reply \(move your own view to what you explain first, with view\) — it goes to the public channel, where the last message came from \(a request there is a request, not your maker's\); then call wait_for_message again\.$/);
    const r = await M.ask("tools/call", { name: "reply", arguments: { text: "It is `N.a`, which is zero." } });
    assert.equal(JSON.parse(r.result.content[0].text).channel, "public");
    const p = await M.ask("tools/call", { name: "reply", arguments: { text: "Bob asked me about N.b.", channel: "private" } });
    assert.equal(JSON.parse(p.result.content[0].text).channel, "private");
    // the public channel, read when it wants
    const ch = JSON.parse((await M.ask("tools/call", { name: "channel", arguments: {} })).result.content[0].text);
    assert.deepEqual(ch.messages.map((m: Json) => [m.from, m.kind]), [["Bob", "person"], ["Alice's AI", "agent"]]);
    assert.deepEqual((await S.ask("GET", `/api/chat?channel=${peer(S)!.id}`, undefined, ALICE)).json!.messages.map((m: Json) => m.text), ["Bob asked me about N.b."]);
  } finally {
    M.stop();
    await S.close();
  }
});

test("a channel whose messages all expired goes on counting from its last id: an agent's place in it stays behind what comes next", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-talk-"));
  try {
    const day = 86_400_000;
    const T = new Talk(dir);
    const tok = "dddddddddd";
    T.post(tok, { from: "Alice", kind: "person", text: "long ago" }, null, Date.now() - 29.9 * day);
    // the agent was handed it (its place: message 1)
    const first = await T.wait(tok, 0);
    assert.ok("messages" in first);
    assert.equal(T.talk(tok).read, 1);
    // a day later it expired; the next message is message 2, and is handed
    const msgs = (T as unknown as { threads: Map<string, { at: string }[]> }).threads.get(tok)!;
    msgs[0].at = new Date(Date.now() - 31 * day).toISOString();
    const next = T.post(tok, { from: "Alice", kind: "person", text: "now" });
    assert.equal(next.id, 2);
    const r = await T.wait(tok, 0);
    assert.ok("messages" in r && r.messages.some((m) => m.text === "now"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
