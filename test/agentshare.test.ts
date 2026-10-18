// Sharing with an AI agent (AgentSpec decision 7): tokens made by people only, named as given or
// "<maker>'s AI", one name per agent in force, at most the server's level and held to it, that
// expire and can be revoked at once, that reach the agents' API alone and fix who the agent is
// whatever its headers say; when one was last used, kept without a write per request; the
// companion that tells where everyone is and waits until someone moves; and the prompt that
// carries a token, without place or task, shown again to people while the token is in force.

import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { agentPrompt } from "../src/server/prompt.ts";
import { AgentTokens } from "../src/server/tokens.ts";
import { defaultAgentName, initials, uniqueName, validName } from "../src/shared/collab.ts";
import type { StreamHello } from "../src/shared/collab.ts";
import { site, SOURCE, stream } from "./site.ts";
import type { Json } from "./site.ts";

const ALICE = { "x-visualproof-name": "Alice" };
const bearer = (t: string, more: Record<string, string> = {}) => ({ authorization: `Bearer ${t}`, ...more });
const here = { mode: "tcb", sel: "N.b", selection: "tcb(N.b)", source: true, clusterMode: "namespace", cam: null, view: "project", scope: null, tabs: ["project"] };

/** A token made through the page's API, as Share makes it: no name, the maker's AI. */
async function share(S: Awaited<ReturnType<typeof site>>, body: Json = {}, headers: Record<string, string> = ALICE) {
  const r = await S.ask("POST", "/api/share/agents", body, headers);
  return { status: r.status, json: r.json!, token: tokenIn(r.json?.prompt) };
}

/** The token a prompt carries. */
const tokenIn = (prompt: unknown) => (prompt as string | undefined)?.match(/vpa_[0-9a-f]{10}_[A-Za-z0-9_-]{43}/)?.[0] ?? "";

test("a token is made by a named person only, its agent named as given or the maker's AI, one name per agent in force", async () => {
  const S = await site();
  try {
    assert.equal((await S.ask("POST", "/api/share/agents", {})).status, 401, "a name first");
    assert.equal((await S.ask("POST", "/api/share/agents", {}, { ...ALICE, "x-visualproof-kind": "agent" })).status, 403, "not by an agent");
    const r = await share(S, { level: "advise", days: 7 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(r.token, /^vpa_[0-9a-f]{10}_/);
    assert.equal(r.json.token.name, "Alice's AI", "no name: the maker's AI");
    assert.equal(r.json.token.by, "Alice");
    assert.equal(r.json.token.level, "advise");
    assert.equal(Math.round((Date.parse(r.json.token.expires) - Date.parse(r.json.token.created)) / 86_400_000), 7);
    assert.ok(!("secret" in r.json.token) && !("hash" in r.json.token), "the token is in the prompt only");
    // a second of Alice's is numbered; Bob's is his; a name given is the agent's as it is, numbered
    // whatever its case when one in force has it; a blank one is the default
    assert.equal((await share(S)).json.token.name, "Alice's AI 2");
    assert.equal((await share(S, {}, { "x-visualproof-name": "Bob" })).json.token.name, "Bob's AI");
    assert.equal((await share(S, { name: "Claude" })).json.token.name, "Claude");
    assert.equal((await share(S, { name: "  claude " })).json.token.name, "claude 2");
    assert.equal((await share(S, { name: " " })).json.token.name, "Alice's AI 3");
    const list = await S.ask("GET", "/api/share/agents");
    assert.deepEqual(list.json!.tokens.map((t: Json) => [t.name, t.by]), [["Alice's AI", "Alice"], ["Alice's AI 2", "Alice"], ["Bob's AI", "Bob"], ["Claude", "Alice"], ["claude 2", "Alice"], ["Alice's AI 3", "Alice"]]);
    assert.deepEqual([list.json!.defaultLevel, list.json!.defaultDays, list.json!.levels], ["advise", 7, ["read", "advise", "full"]]);
    // a name is unique among the tokens in force only: once the first ended, its name is free again
    assert.equal((await S.ask("POST", "/api/share/agents/revoke", { id: r.json.token.id }, ALICE)).status, 200);
    assert.equal((await share(S)).json.token.name, "Alice's AI");
    // the site directory keeps the token, so that its prompt can be shown again: readable by its
    // owner alone, as the access key is
    const file = join(S.dir, "state", "agent-tokens.json");
    assert.ok(readFileSync(file, "utf8").includes(r.token.split("_")[2]));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    // what a token cannot be: a name too long or not text, a level that is none, a lifetime not offered
    for (const body of [{ name: "x".repeat(61) }, { name: 3 }, { name: "a\nb" }, { level: "root" }, { days: 365 }])
      assert.equal((await share(S, body)).status, 400, JSON.stringify(body));
  } finally {
    await S.close();
  }
});

test("a token's prompt is shown again, the same, to people while the token is in force; never to agents, never once it ended", async () => {
  for (const key of [undefined, "k".repeat(40)]) {
    const S = await site({ key, publicUrl: "https://vp.example.org" });
    const as = (h: Record<string, string> = {}) => (key ? { authorization: `Bearer ${key}`, ...h } : h);
    try {
      const made = await share(S, {}, as(ALICE));
      const id = made.json.token.id as string;
      const again = await S.ask("POST", "/api/share/agents/prompt", { id }, as(ALICE));
      assert.equal(again.status, 200, JSON.stringify(again.json));
      assert.equal(again.json!.prompt, made.json.prompt, "the same prompt, token and all");
      assert.equal(again.json!.token.name, "Alice's AI");
      assert.ok(!("secret" in again.json!.token));
      // anyone with a name, not only its maker; a name first
      assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id }, as({ "x-visualproof-name": "Bob" }))).json!.prompt, made.json.prompt);
      const nameless = await S.ask("POST", "/api/share/agents/prompt", { id }, as());
      assert.equal(nameless.status, 401);
      assert.equal(nameless.json!.who, true);
      // agents: refused where they say so, and a token is let into the agents' API alone
      assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id }, as({ ...ALICE, "x-visualproof-kind": "agent" }))).status, 403);
      assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id }, bearer(made.token, ALICE))).status, 404);
      assert.equal((await S.ask("GET", "/api/share/agents/prompt", undefined, as(ALICE))).status, 405);
      for (const body of [{}, { id: "0123456789" }, { id: 3 }]) assert.equal((await S.ask("POST", "/api/share/agents/prompt", body, as(ALICE))).status, 404, JSON.stringify(body));
      // across a restart: the same prompt
      S.live.tokens.close();
      const reread = new AgentTokens(join(S.dir, "state"));
      assert.equal(reread.token(id)?.token, made.token);
      reread.close();
      // revoked: no prompt, at once
      assert.equal((await S.ask("POST", "/api/share/agents/revoke", { id }, as(ALICE))).status, 200);
      const gone = await S.ask("POST", "/api/share/agents/prompt", { id }, as(ALICE));
      assert.equal(gone.status, 404);
      assert.match(gone.json!.error, /no such token in force/);
      assert.equal((await S.ask("GET", "/api/agent", undefined, bearer(made.token))).status, 401);
      // expired: none either
      const old = S.live.tokens.create({ name: "Old", by: "Alice", level: "read", days: 1, now: Date.now() - 2 * 86_400_000 });
      assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id: old.record.id }, as(ALICE))).status, 404);
    } finally {
      await S.close();
    }
  }
});

test("a token kept before its secret was (only a digest) is dropped when the file is read, and leaves the file", async () => {
  const S = await site();
  try {
    const kept = await share(S);
    S.live.tokens.close();
    const file = join(S.dir, "state", "agent-tokens.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.tokens.push({ id: "0123456789", hash: "a".repeat(64), agent: "Claude", name: "Alice's Claude", level: "advise", by: "Alice", created: new Date().toISOString(), expires: new Date(Date.now() + 86_400_000).toISOString(), revoked: null, revokedBy: null, lastUsed: null });
    writeFileSync(file, JSON.stringify(data));
    const reread = new AgentTokens(join(S.dir, "state"));
    assert.deepEqual(reread.inForce().map((r) => r.name), ["Alice's AI"]);
    assert.ok(reread.check(kept.token) && "ok" in reread.check(kept.token)!);
    reread.close();
    const now = readFileSync(file, "utf8");
    assert.ok(!now.includes("0123456789") && !now.includes("a".repeat(64)), "written without it");
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    await S.close();
  }
});

test("a token's level is at most the server's, and is held to the server's as it is now", async () => {
  const S = await site({ agents: "advise" });
  try {
    const shares = await S.ask("GET", "/api/share/agents");
    assert.deepEqual(shares.json!.levels, ["read", "advise"]);
    const full = await share(S, { level: "full" });
    assert.equal(full.status, 400);
    assert.match(full.json.error, /at most advise/);
    // a token made at full (an older server's) acts at advise here: advice, not what people do
    const { token } = S.live.tokens.create({ name: "Alice's AI", by: "Alice", level: "full", days: 1 });
    const me = await S.ask("GET", "/api/agent", undefined, bearer(token));
    assert.deepEqual(me.json!.you.may, { read: true, advise: true, full: false });
    const pins = await S.ask("POST", "/api/agent/pins", { pins: [{ name: "N.a", at: [0, 0] }] }, bearer(token));
    assert.equal(pins.status, 403);
    assert.match(pins.json!.error, /--agents advise/);
    assert.equal((await S.ask("POST", "/api/agent/note", { name: "N.a", text: "look here" }, bearer(token))).status, 200);
    // a token at read reads, whatever the server allows
    const reader = (await share(S, { level: "read" })).token;
    const no = await S.ask("POST", "/api/agent/opinion", { name: "N.a", verdict: "approve", comment: "fine" }, bearer(reader));
    assert.equal(no.status, 403);
    assert.match(no.json!.error, /Your token lets you only read/);
    assert.ok(no.json!.hint);
  } finally {
    await S.close();
  }
});

test("a token reaches the agents' API alone, and is who it says whatever the headers say", async () => {
  for (const key of [undefined, "k".repeat(40)]) {
    const S = await site({ key });
    try {
      const { token } = await share(S, {}, key ? { ...ALICE, authorization: `Bearer ${key}` } : ALICE);
      assert.ok(token, "made");
      // the page and the page's own API: as for an outsider
      for (const path of ["/", "/api/status", "/api/review", "/api/meta", "/api/share", "/api/share/agents", "/api/views", "/api/activity", `/k/${key ?? "x"}`])
        assert.equal((await S.ask("GET", path, undefined, bearer(token))).status, 404, path);
      assert.equal((await S.ask("POST", "/api/review", { op: "target", name: "N.b", on: true }, bearer(token, ALICE))).status, 404);
      // a token that is not one: an outsider where the server is closed, refused where it is open
      const forged = token.slice(0, -4) + "AAAA";
      assert.equal((await S.ask("GET", "/api/agent", undefined, bearer(forged))).status, key ? 404 : 401);
      // the agents' API: who the token says, a header naming someone else ignored
      const me = await S.ask("GET", "/api/agent", undefined, bearer(token, { "x-visualproof-name": "Mallory", "x-visualproof-kind": "person" }));
      assert.equal(me.status, 200);
      assert.equal(me.json!.you.name, "Alice's AI");
      assert.equal(me.json!.you.kind, "agent");
      assert.match(me.json!.you.note, /Mallory.*ignored/);
      assert.equal(me.json!.you.token.madeBy, "Alice");
      const advice = await S.ask("POST", "/api/agent/opinion", { name: "N.b", verdict: "comment", comment: "b is a, not its double" }, bearer(token, { "x-visualproof-name": "Mallory" }));
      assert.equal(advice.status, 200, JSON.stringify(advice.json));
      const o = S.live.review.data.opinions["N.b"].at(-1)!;
      assert.deepEqual([o.by, o.agent], ["Alice's AI", true]);
      await S.ask("POST", "/api/agent/note", { name: "N.a", text: "start here" }, bearer(token));
      assert.equal(S.live.timeline.events.at(-1)!.kind, "note");
      assert.equal((S.live.timeline.events.at(-1) as { by: string }).by, "Alice's AI");
      // presence: one entry by the token, under its name, marked as an agent's
      const peers = S.live.presence.list().filter((p) => p.agent);
      assert.deepEqual(peers.map((p) => p.name), ["Alice's AI"]);
      // the docs are served as Markdown
      const docs = await fetch(`${S.base}/api/agent/docs`, { headers: bearer(token) });
      assert.match(docs.headers.get("content-type") ?? "", /markdown/);
      assert.match(await docs.text(), /^# VisualProof for agents/);
    } finally {
      await S.close();
    }
  }
});

test("an expired or revoked token is refused at once, 401 with what happened and what to do; when it was last used is kept without a write per request", async () => {
  const S = await site({ key: "k".repeat(40) });
  try {
    const old = S.live.tokens.create({ name: "Alice's AI", by: "Alice", level: "advise", days: 1, now: Date.now() - 2 * 86_400_000 });
    const gone = await S.ask("GET", "/api/agent", undefined, bearer(old.token));
    assert.equal(gone.status, 401);
    assert.match(gone.json!.error, /expired/);
    assert.ok(gone.json!.hint);
    const { token, json } = await share(S, {}, { ...ALICE, authorization: "Bearer " + "k".repeat(40) });
    const file = join(S.dir, "state", "agent-tokens.json");
    const before = readFileSync(file, "utf8");
    for (let k = 0; k < 5; k++) assert.equal((await S.ask("GET", "/api/agent/targets", undefined, bearer(token))).status, 200);
    assert.equal(readFileSync(file, "utf8"), before, "no write per request");
    const listed = await S.ask("GET", "/api/share/agents", undefined, { authorization: "Bearer " + "k".repeat(40) });
    const used = listed.json!.tokens.find((t: Json) => t.id === json.token.id).lastUsed;
    assert.ok(used && Date.now() - Date.parse(used) < 5000, "the page is told it at once");
    S.live.tokens.flush();
    assert.equal(JSON.parse(readFileSync(file, "utf8")).tokens.find((t: Json) => t.id === json.token.id).lastUsed, used, "and it is written with the rest");
    assert.ok(S.live.presence.list().some((p) => p.agent && p.name === "Alice's AI"));
    // revoked: by a person with a name, cut off at the next request
    assert.equal((await S.ask("POST", "/api/share/agents/revoke", { id: json.token.id }, { authorization: "Bearer " + "k".repeat(40) })).status, 401);
    const r = await S.ask("POST", "/api/share/agents/revoke", { id: json.token.id }, { ...ALICE, authorization: "Bearer " + "k".repeat(40) });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json!.tokens, []);
    assert.ok(!S.live.presence.list().some((p) => p.agent), "off the people's list at once");
    const cut = await S.ask("GET", "/api/agent/targets", undefined, bearer(token));
    assert.equal(cut.status, 401);
    assert.match(cut.json!.error, /revoked by Alice/);
    assert.equal((await S.ask("POST", "/api/share/agents/revoke", { id: json.token.id }, { ...ALICE, authorization: "Bearer " + "k".repeat(40) })).status, 404, "once");
    // across a restart: still revoked, and still made
    const again = new AgentTokens(join(S.dir, "state"));
    assert.equal(again.check(token) && "ended" in again.check(token)! ? "revoked" : "?", "revoked");
    again.close();
  } finally {
    await S.close();
  }
});

test("the companion: where every person is, and the agents; it waits until someone comes, goes or moves", async () => {
  const S = await site();
  try {
    const { token } = await share(S);
    const first = await S.ask("GET", "/api/agent/companion", undefined, bearer(token));
    assert.equal(first.status, 200);
    assert.deepEqual(first.json!.people, []);
    assert.deepEqual(first.json!.agents.map((a: Json) => [a.name, a.you]), [["Alice's AI", true]]);
    const rev = first.json!.rev as number;
    // nothing moves: the wait runs out, and says nothing changed
    const t0 = Date.now();
    const quiet = await S.ask("GET", `/api/agent/companion?wait=1&since=${rev}`, undefined, bearer(token));
    assert.ok(Date.now() - t0 >= 900, "it waited");
    assert.equal(quiet.json!.changed, false);
    // Alice opens a page and says where she is: the wait ends with her place
    const waiting = S.ask("GET", `/api/agent/companion?wait=20&since=${rev}`, undefined, bearer(token));
    const alice = stream(S.port, "/api/events?session=aaaaaaaa1111");
    await alice.until(() => !!alice.last("hello"));
    const hello = alice.last("hello") as StreamHello;
    await S.ask("POST", "/api/presence", { token: hello.token, view: here, idle: false }, ALICE);
    const t1 = Date.now();
    const moved = await waiting;
    assert.ok(Date.now() - t1 < 5000, "at once, not at the end of the wait");
    assert.equal(moved.json!.changed, true);
    const her = moved.json!.people.find((p: Json) => p.name === "Alice");
    assert.ok(her, JSON.stringify(moved.json));
    assert.deepEqual([her.place.declaration, her.place.selection, her.place.source, her.place.tool, her.place.view], ["N.b", "tcb(N.b)", true, "TCB", "project"]);
    assert.match(her.place.inWords, /the Project view, reading the source of N.b/);
    // a camera that moves is not a move
    const r2 = (await S.ask("GET", "/api/agent/companion", undefined, bearer(token))).json!.rev;
    await S.ask("POST", "/api/presence", { token: hello.token, view: { ...here, cam: { x: 1, y: 2, k: 3 } }, idle: false }, ALICE);
    assert.equal((await S.ask("GET", "/api/agent/companion", undefined, bearer(token))).json!.rev, r2);
    // her source windows: the one following her selection collapsed, and those she pinned, which
    // those following her see too (decided 2026-10-09); a move
    assert.deepEqual([her.place.sourceCollapsed, her.place.pinned], [false, []]);
    const pinned = [{ decl: "N.a", collapsed: false }, { decl: "N.b", collapsed: true }];
    await S.ask("POST", "/api/presence", { token: hello.token, view: { ...here, sourceCollapsed: true, pinned }, idle: false }, ALICE);
    const after = (await S.ask("GET", "/api/agent/companion", undefined, bearer(token))).json!;
    assert.notEqual(after.rev, r2);
    const hers = after.people.find((p: Json) => p.name === "Alice").place;
    assert.deepEqual([hers.sourceCollapsed, hers.pinned], [true, [{ declaration: "N.a", collapsed: false }, { declaration: "N.b", collapsed: true }]]);
    assert.match(hers.inWords, /with the source of N\.a, N\.b pinned/);
    // what else those following her see (CollabSpec decision 4, the owner's decision of
    // 2026-10-11): Activity and its filters, the lost-and-found, the colouring, the edges — said
    // where her page says them, which an older page does not; a move
    for (const k of ["activity", "lostAndFound", "colouring", "edges", "proofEdges"]) assert.ok(!(k in hers), k);
    // (proof edges, said until 2026-10-15, are no more: one still sent is not carried)
    const shows = { activity: { open: true, kind: "review", who: "people", mine: "Alice" }, lostFound: { open: false }, scheme: "status", edges: false, proofEdges: true };
    await S.ask("POST", "/api/presence", { token: hello.token, view: { ...here, ...shows }, idle: false }, ALICE);
    const third = (await S.ask("GET", "/api/agent/companion", undefined, bearer(token))).json!;
    assert.notEqual(third.rev, after.rev);
    const sees = third.people.find((p: Json) => p.name === "Alice").place;
    assert.deepEqual([sees.activity, sees.lostAndFound, sees.colouring, sees.edges, sees.proofEdges], [shows.activity, { open: false }, "status", false, undefined]);
    assert.match(sees.inWords, /with Activity open on Review, people only, on Alice's targets, coloured by status, edges hidden\.$/);
    assert.equal((await S.ask("GET", "/api/agent/companion?since=x", undefined, bearer(token))).status, 400);
    alice.close();
  } finally {
    await S.close();
  }
});

test("the prompt: where the server is, the token as a secret, who the agent is, its level and expiry, where to start, the MCP setup, the ground rules; no place, no task", async () => {
  const S = await site({ publicUrl: "https://vp.example.org" });
  try {
    // a place and a task sent as an older page did are not taken
    const r = await share(S, { place: here, task: "Look at N.b first.", days: 1 });
    assert.equal(r.status, 200);
    const p = r.json.prompt as string;
    assert.match(p, /^Alice invites you/);
    assert.ok(p.includes("Server: https://vp.example.org\n"), "the configured address");
    assert.ok(p.includes(`Your token: ${r.token}\n`));
    assert.match(p, /Authorization: Bearer <token>/);
    assert.match(p, /Never print it/);
    assert.match(p, /You are "Alice's AI", an AI agent\. Your level is advise/);
    assert.match(p, /The token expires \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
    assert.ok(p.includes("Start with GET https://vp.example.org/api/agent"));
    assert.ok(p.includes("claude mcp add --env VISUALPROOF_URL=https://vp.example.org") && p.includes("--env VISUALPROOF_WAIT_SECONDS=1800 --transport stdio visualproof --"), "the MCP setup");
    assert.ok(p.includes("claude --continue") && !/channel/i.test(p), "a restart, no channel");
    assert.match(p, /start listening at once: call wait_for_message/);
    assert.match(p, /unless they press Esc/);
    assert.ok(p.includes("GET https://vp.example.org/api/agent/inbox?wait=<seconds>"), "listening without MCP");
    assert.ok(!/Where Alice is|Your task|N\.b|Look at/.test(p), "no place, no task");
    assert.match(p, /a comment needs text/);
    assert.match(p, /"leave": true/);
    assert.ok(p.length < 3500, `short: ${p.length} characters`);
  } finally {
    await S.close();
  }
  // without a configured address: the one the browser used, its Origin where it names the host
  const T = await site();
  try {
    const r = await share(T);
    assert.ok((r.json.prompt as string).includes(`Server: http://127.0.0.1:${T.port}\n`));
    const viaOrigin = await T.ask("POST", "/api/share/agents", { name: "Claude" }, { ...ALICE, origin: `https://127.0.0.1:${T.port}` });
    assert.ok((viaOrigin.json!.prompt as string).includes(`Server: https://127.0.0.1:${T.port}\n`));
  } finally {
    await T.close();
  }
  // a read token is not told to give advice
  const read = agentPrompt({ url: "http://h", token: "vpa_x", record: { name: "Bob's AI", by: "Bob", level: "read", expires: "2026-10-09T10:00:00.000Z" } });
  assert.match(read, /You only read here: tell Bob what you find/);
  assert.ok(!read.includes("note"));
});

test("what the trial of the prompt missed: a module's doc comments and declarations, the activity about one declaration, whether the person who shared is here", async () => {
  const S = await site();
  try {
    const { token } = await share(S);
    // the module's file as it is now: a doc comment above the declarations
    writeFileSync(join(S.dir, "M.lean"), "/-! # M\nWhy `b` doubles nothing. -/\n" + SOURCE);
    const m = await S.ask("GET", "/api/agent/module?of=N.b", undefined, bearer(token));
    assert.equal(m.status, 200, JSON.stringify(m.json));
    assert.deepEqual([m.json!.name, m.json!.file, m.json!.compiled, m.json!.count], ["M", "M.lean", false, 2]);
    assert.deepEqual(m.json!.docs, [{ line: 1, endLine: 2, text: "# M\nWhy `b` doubles nothing." }]);
    assert.deepEqual(m.json!.declarations.map((d: Json) => d.name), ["N.a", "N.b"]);
    assert.equal((await S.ask("GET", "/api/agent/module?name=m", undefined, bearer(token))).json!.didYouMean[0], "M");
    // what is already said about a declaration, apart from the rest
    await S.ask("POST", "/api/agent/note", { name: "N.a", text: "start at `N.a`" }, bearer(token));
    await S.ask("POST", "/api/agent/note", { name: "N.b", text: "then N.b, which doubles nothing" }, bearer(token));
    const about = await S.ask("GET", "/api/agent/activity?name=N.b", undefined, bearer(token));
    assert.deepEqual(about.json!.events.map((e: Json) => [e.kind, e.what, e.text]), [["note", "created", "then N.b, which doubles nothing"]]);
    // Alice is not on the page: the companion says so, and to go on
    const c = await S.ask("GET", "/api/agent/companion", undefined, bearer(token));
    assert.deepEqual(c.json!.sharedBy, { name: "Alice", here: false });
    assert.match(c.json!.sharedByNote, /go on/);
  } finally {
    await S.close();
  }
});

test("an agent's name: the maker's AI by default, numbered when taken, within 60 characters; its initials", () => {
  assert.equal(defaultAgentName("Alice"), "Alice's AI");
  assert.equal(defaultAgentName(" 许 "), "许's AI");
  const long = defaultAgentName("y".repeat(60));
  assert.ok(validName(long) && long.endsWith("…'s AI"), long);
  assert.equal(uniqueName("Alice's AI", ["Bob's AI"]), "Alice's AI");
  assert.equal(uniqueName("Alice's AI", ["alice's ai", "Alice's AI 2"]), "Alice's AI 3");
  // a name that looks the same is the same: another Unicode form, characters nobody sees
  assert.equal(uniqueName("Alice's AI", ["Ａｌｉｃｅ's AI"]), "Alice's AI 2");
  assert.equal(uniqueName("Alice's AI\u200b", ["Alice's AI"]), "Alice's AI\u200b 2");
  // the twelfth agent of a name as long as a name may be
  const taken: string[] = [];
  for (let k = 0; k < 12; k++) taken.push(uniqueName("x".repeat(60), taken));
  assert.equal(new Set(taken).size, 12);
  assert.ok(taken.every(validName), taken.join(", "));
  assert.ok(taken[11].endsWith("… 12"), taken[11]);
  // a name of characters beyond the first plane is cut between characters, never inside one
  const wide = uniqueName("😀".repeat(30), ["😀".repeat(30)]);
  assert.ok(validName(wide) && wide.endsWith("😀… 2"), wide);
  // the badge in the presence bar: the first letters of its first two words
  assert.equal(initials("Alice's AI"), "AA");
  assert.equal(initials("Alice's AI 2"), "AA");
});
