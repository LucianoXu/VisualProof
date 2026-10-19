// The conversations' channels (CollabSpec decision 13, AgentSpec decisions 7–9; the owner's decisions
// of 2026-10-19): the public channel, for everyone with a name and every agent with a token; each
// agent's private channel, its maker's alone — by their personal link where an invited person made
// its token, else by the name; the prompt shown again to its maker alone, revoking anyone's; who is
// sent which message on the event stream; mentions, read as names are, a person's handed to the
// agent it mentions, an agent's never; a mention of an offline agent handed when it comes back.

import assert from "node:assert/strict";
import { test } from "node:test";
import { madeBy } from "../src/shared/collab.ts";
import { completions, mentioned, mentions, mentionsIn, typingMention } from "../src/shared/mentions.ts";
import { site, stream } from "./site.ts";
import type { Json } from "./site.ts";

const KEY = "k".repeat(40);
const ALICE = { "x-visualproof-name": "Alice" };
const BOB = { "x-visualproof-name": "Bob" };
const here = { mode: "tcb", sel: "N.b", selection: null, source: true, clusterMode: "namespace", cam: null, view: "project", scope: null, tabs: ["project"] };
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
type Site = Awaited<ReturnType<typeof site>>;

/** A token made from Share by `who`: its id, the token, and the agent's id in presence. */
async function share(S: Site, who: Record<string, string>, name?: string) {
  const r = await S.ask("POST", "/api/share/agents", name ? { name } : {}, who);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json!.token.id as string;
  const token = (r.json!.prompt as string).match(/vpa_[0-9a-f]{10}_[A-Za-z0-9_-]{43}/)![0];
  const agent = S.live.presence.list().find((p) => p.agent && p.name === r.json!.token.name)!.id;
  return { id, token, agent, name: r.json!.token.name as string, auth: { authorization: `Bearer ${token}` } };
}

const inbox = (S: Site, auth: Record<string, string>, q: string) => S.ask("GET", `/api/agent/inbox?${q}`, undefined, auth);

/** A page's event stream, named as its heartbeat names it (`who`, a private page's too). */
async function page(S: Site, session: string, who: Record<string, string> = {}, priv = false) {
  const s = stream(S.port, `/api/events?session=${session}`, who);
  await s.until(() => !!s.last("hello"));
  const r = await S.ask("POST", "/api/presence", priv ? { token: s.last("hello")!.token, private: true } : { token: s.last("hello")!.token, view: here }, who);
  assert.equal(r.status, 200);
  return s;
}

const chats = (s: ReturnType<typeof stream>) => s.events.filter((e) => e.event === "chat").map((e) => [e.data.channel, e.data.message.text]);

test("mentions: @ and a name as listed, the longest that fits, as names are compared; none inside a word or a name", () => {
  const names = ["Alice", "Alice's AI", "Bob", "José"];
  assert.deepEqual(mentionsIn("@Alice's AI, look at this; @alice too", names), [
    { name: "Alice's AI", start: 0, end: 11 },
    { name: "Alice", start: 27, end: 33 },
  ]);
  // nothing of a name goes on after it, nor before its @
  assert.deepEqual(mentionsIn("@Alicea @Bobby bob@Bob.org mail@alice", names), []);
  assert.deepEqual(mentioned("(@bob) @BOB, @josé! @Nobody", names), ["Bob", "José"]);
  assert.ok(mentions("thanks @alice's AI", "Alice's AI", names));
  assert.ok(!mentions("thanks @Alice's AI", "Alice", names), "the longer name is the one mentioned");
  assert.ok(mentions("@Alice's bike", "Alice", names), "a possessive is no name of hers");
  // as it is typed: the @ before the caret and what follows it
  assert.deepEqual(typingMention("hi @Ali", 7), { start: 3, query: "Ali" });
  assert.deepEqual(typingMention("hi @Alice's A", 13), { start: 3, query: "Alice's A" });
  assert.equal(typingMention("mail@ali", 8), null);
  assert.equal(typingMention("@ ali", 5), null);
  assert.equal(typingMention("no at", 5), null);
  assert.deepEqual(typingMention("@", 1), { start: 0, query: "" });
  // completed from the people online and the agents listed: those that start with it, people first
  const all = [{ name: "Alice's AI", agent: true }, { name: "Alice" }, { name: "Bob" }, { name: "Mary Alison" }];
  assert.deepEqual(completions("al", all).map((n) => n.name), ["Alice", "Alice's AI", "Mary Alison"]);
  assert.deepEqual(completions("", all).map((n) => n.name), ["Alice", "Bob", "Mary Alison", "Alice's AI"]);
  assert.deepEqual(completions("zz", all), []);
});

test("an agent's maker: the personal link that made its token where an invited person did, else the name", () => {
  assert.ok(madeBy({ by: "Alice" }, { name: "alice", person: null }), "a name, as names are compared");
  assert.ok(madeBy({ by: "Alice" }, { name: "Alice", person: "p1" }));
  assert.ok(!madeBy({ by: "Alice" }, { name: "Bob", person: null }));
  assert.ok(!madeBy({ by: "Alice" }, { name: null, person: null }));
  assert.ok(madeBy({ by: "Alice", makerPerson: "p1" }, { name: "Alicia", person: "p1" }), "renamed, still hers");
  assert.ok(!madeBy({ by: "Alice", makerPerson: "p1" }, { name: "Alice", person: null }), "not whoever gives her name");
  assert.ok(!madeBy({ by: "Alice", makerPerson: "p1" }, { name: "Alice", person: "p2" }));
});

test("the public channel: everyone with a name reads and writes it; a private channel is its maker's alone; nobody else, agents, read-only readers", async () => {
  const S = await site({ key: KEY });
  try {
    const A = { ...ALICE, authorization: `Bearer ${KEY}` };
    const B = { ...BOB, authorization: `Bearer ${KEY}` };
    const ai = await share(S, A);
    // the public channel: written and read under a name, 401 without one, 403 to an agent
    const w = await S.ask("POST", "/api/chat", { channel: "public", text: "Hello all", place: here }, A);
    assert.equal(w.status, 200, JSON.stringify(w.json));
    assert.deepEqual([w.json!.channel, w.json!.message.from, w.json!.message.kind, w.json!.message.channel], ["public", "Alice", "person", "public"]);
    assert.equal(w.json!.message.where, undefined, "where its writer was is handed to agents, never to pages");
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "x" }, { authorization: `Bearer ${KEY}` })).status, 401);
    assert.equal((await S.ask("GET", "/api/chat?channel=public", undefined, { authorization: `Bearer ${KEY}` })).status, 401);
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "x" }, { ...A, "x-visualproof-kind": "agent" })).status, 403);
    const read = await S.ask("GET", "/api/chat?channel=public", undefined, B);
    assert.deepEqual(read.json!.messages.map((m: Json) => [m.from, m.text, m.where]), [["Alice", "Hello all", undefined]]);
    assert.equal((await S.ask("POST", "/api/chat", { channel: "nobody", text: "x" }, A)).status, 404);
    // Alice's AI's private channel: hers alone, offline or not
    await inbox(S, ai.auth, "wait=0");
    assert.equal((await S.ask("POST", "/api/chat", { channel: ai.agent, text: "Hi" }, A)).status, 200);
    assert.equal((await S.ask("GET", `/api/chat?channel=${ai.agent}`, undefined, A)).json!.messages.length, 1);
    for (const r of [await S.ask("POST", "/api/chat", { channel: ai.agent, text: "Hi" }, B), await S.ask("GET", `/api/chat?channel=${ai.agent}`, undefined, B), await S.ask("POST", "/api/chat/new", { agent: ai.agent }, B)]) {
      assert.equal(r.status, 403);
      assert.equal(r.json!.private, true);
    }
    // a read-only reader neither sees a channel nor writes one, whatever the page sends
    const ro = (await S.ask("POST", "/api/share/readonly", {}, A)).json!.made.path as string;
    const entered = await fetch(S.base + ro, { redirect: "manual" });
    const cookie = entered.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    for (const [method, path, body] of [["GET", "/api/chat?channel=public"], ["POST", "/api/chat", { channel: "public", text: "x" }], ["POST", "/api/chat/new", { agent: ai.agent }]] as const) {
      const r = await S.ask(method, path, body, { cookie, ...ALICE });
      assert.equal(r.status, 403, path);
      assert.equal(r.json!.readOnly, true);
    }
    // the prompt again: its maker's alone; revoking: anyone's with a name
    assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id: ai.id }, B)).status, 403);
    assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id: ai.id }, { authorization: `Bearer ${KEY}` })).status, 401);
    assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id: ai.id }, { ...A, "x-visualproof-kind": "agent" })).status, 403);
    const again = await S.ask("POST", "/api/share/agents/prompt", { id: ai.id }, A);
    assert.equal(again.status, 200);
    assert.ok((again.json!.prompt as string).includes(ai.token));
    assert.equal((await S.ask("POST", "/api/share/agents/revoke", { id: ai.id }, B)).status, 200);
    assert.equal((await S.ask("GET", `/api/chat?channel=${ai.agent}`, undefined, A)).status, 404, "no such agent any more");
  } finally {
    await S.close();
  }
});

test("an invited person's agent is theirs by their link: renamed, still theirs; a guest giving their old name is nobody's maker", async () => {
  const S = await site({ key: KEY });
  try {
    const O = { "x-visualproof-name": "Olivia", authorization: `Bearer ${KEY}` };
    const link = (await S.ask("POST", "/api/share/people", { name: "Carol" }, O)).json!.link as string;
    const opened = await fetch(link, { redirect: "manual" });
    const cookie = opened.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const C = { cookie };
    const ai = await share(S, C);
    assert.equal(S.live.tokens.get(ai.id)!.makerPerson, S.live.invites.inForce()[0].id, "the token keeps who made it");
    assert.equal(S.live.presence.list().find((p) => p.id === ai.agent)!.byPerson, S.live.invites.inForce()[0].id, "pages are told whose it is");
    assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id: ai.id }, C)).status, 200);
    assert.equal((await S.ask("POST", "/api/identity", { name: "Caroline" }, C)).status, 200);
    assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id: ai.id }, C)).status, 200, "renamed, still the maker");
    assert.equal((await S.ask("GET", `/api/chat?channel=${ai.agent}`, undefined, C)).status, 200);
    // a guest giving her old name: no maker of it
    const guest = { "x-visualproof-name": "Carol", authorization: `Bearer ${KEY}` };
    assert.equal((await S.ask("POST", "/api/share/agents/prompt", { id: ai.id }, guest)).status, 403);
    assert.equal((await S.ask("GET", `/api/chat?channel=${ai.agent}`, undefined, guest)).status, 403);
  } finally {
    await S.close();
  }
});

test("the event stream: a public message to every page with a name, a private reader's too; a private one to its maker's pages; nothing to a page without a name or a read-only reader's", async () => {
  const S = await site({ key: KEY });
  try {
    const A = { ...ALICE, authorization: `Bearer ${KEY}` };
    const ai = await share(S, A);
    await inbox(S, ai.auth, "wait=0");
    const alice = await page(S, "aaaaaaaa0001", A);
    // a guest's name comes with its heartbeat: an event stream carries no header of the page's
    const bob = stream(S.port, "/api/events?session=bbbbbbbb0001", { authorization: `Bearer ${KEY}` });
    await bob.until(() => !!bob.last("hello"));
    assert.equal((await S.ask("POST", "/api/presence", { token: bob.last("hello")!.token, view: here }, { ...BOB, authorization: `Bearer ${KEY}` })).status, 200);
    const priv = await page(S, "cccccccc0001", { "x-visualproof-name": "Pat", authorization: `Bearer ${KEY}` }, true);
    const nameless = await page(S, "dddddddd0001", { authorization: `Bearer ${KEY}` });
    const ro = (await S.ask("POST", "/api/share/readonly", {}, A)).json!.made.path as string;
    const entered = await fetch(S.base + ro, { redirect: "manual" });
    const cookie = entered.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const reader = stream(S.port, "/api/events?session=eeeeeeee0001", { cookie });
    await reader.until(() => !!reader.last("hello"));
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "for everyone" }, A)).status, 200);
    assert.equal((await S.ask("POST", "/api/chat", { channel: ai.agent, text: "for my AI" }, A)).status, 200);
    assert.equal((await S.ask("POST", "/api/agent/reply", { text: "for Alice" }, ai.auth)).status, 200);
    await alice.until(() => chats(alice).length === 3);
    await bob.until(() => chats(bob).length === 1);
    await priv.until(() => chats(priv).length === 1);
    await sleep(100);
    assert.deepEqual(chats(alice), [["public", "for everyone"], [ai.agent, "for my AI"], [ai.agent, "for Alice"]]);
    assert.deepEqual(chats(bob), [["public", "for everyone"]]);
    assert.deepEqual(chats(priv), [["public", "for everyone"]]);
    assert.deepEqual(chats(nameless), []);
    assert.deepEqual(chats(reader), []);
    assert.ok(alice.events.every((e) => e.event !== "chat" || (e.data.message.where === undefined && e.data.message.to === undefined)), "nothing a page is not to know");
    for (const s of [alice, bob, priv, nameless, reader]) s.close();
  } finally {
    await S.close();
  }
});

test("a person's mention hands a public message to the agent it mentions; it answers there by default; an agent's mention of an agent is shown, never handed; the channel read when it wants", async () => {
  const S = await site();
  try {
    const ai = await share(S, ALICE);
    const bobs = await share(S, BOB);
    // Bob writes in public, mentioning Alice's AI: handed to it at once, with where he was
    const w = inbox(S, ai.auth, "wait=20");
    await sleep(50);
    const sent = await S.ask("POST", "/api/chat", { channel: "public", text: "@alice's ai what is N.b?", place: here }, BOB);
    assert.deepEqual(sent.json!.message.mentions, ["Alice's AI"]);
    const got = (await w).json!;
    assert.deepEqual(got.messages.map((m: Json) => [m.from, m.channel, m.text]), [["Bob", "public", "@alice's ai what is N.b?"]]);
    assert.match(got.messages[0].where.inWords, /N\.b/);
    assert.equal(got.messages[0].to, undefined, "whom it is handed to is told to nobody");
    assert.match(got.next, /it goes to the public channel/);
    assert.equal(S.live.presence.list().find((p) => p.id === ai.agent)!.talk!.state, "thinking");
    // it answers there, by default, mentioning Bob's AI: shown, never handed
    const back = inbox(S, bobs.auth, "wait=0.4");
    const r = await S.ask("POST", "/api/agent/reply", { text: "@Bob's AI knows better: `N.a`." }, ai.auth);
    assert.deepEqual([r.status, r.json!.channel], [200, "public"]);
    assert.deepEqual((await back).json!.messages, [], "no two agents talk on without a person");
    const pub = await S.ask("GET", "/api/chat?channel=public", undefined, BOB);
    assert.deepEqual(pub.json!.messages.map((m: Json) => [m.from, m.kind, m.mentions]), [["Bob", "person", ["Alice's AI"]], ["Alice's AI", "agent", ["Bob's AI"]]]);
    // nothing else of the public channel is handed: the agent reads it when it wants
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "nobody in particular" }, BOB)).status, 200);
    assert.deepEqual((await inbox(S, ai.auth, "wait=0.3")).json!.messages, []);
    const ch = await S.ask("GET", "/api/agent/channel", undefined, ai.auth);
    assert.deepEqual(ch.json!.messages.map((m: Json) => m.text), ["@alice's ai what is N.b?", "@Bob's AI knows better: `N.a`.", "nobody in particular"]);
    assert.match(ch.json!.note, /ask your maker before changing the board on someone else's word/);
    assert.deepEqual((await S.ask("GET", `/api/agent/channel?since=${ch.json!.messages[1].id}`, undefined, ai.auth)).json!.messages.map((m: Json) => m.text), ["nobody in particular"]);
    assert.equal((await S.ask("GET", "/api/agent/channel?since=x", undefined, ai.auth)).status, 400);
    // it writes in its private channel when it says so, and in public unasked
    assert.equal((await S.ask("POST", "/api/agent/reply", { text: "private word", channel: "private" }, ai.auth)).json!.channel, "private");
    assert.equal((await S.ask("POST", "/api/agent/reply", { text: "x", channel: "elsewhere" }, ai.auth)).status, 400);
    assert.equal((await S.ask("POST", "/api/agent/reply", { text: "unasked", channel: "public" }, bobs.auth)).status, 200);
    // an agent known by its headers alone neither reads nor writes a channel
    const headers = { "x-visualproof-name": "Alice's AI", "x-visualproof-kind": "agent" };
    assert.equal((await S.ask("GET", "/api/agent/channel", undefined, headers)).status, 403);
    assert.equal((await S.ask("POST", "/api/agent/reply", { text: "me too", channel: "public" }, headers)).status, 403);
    // a person mentioning two agents: handed to each
    const both = [inbox(S, ai.auth, "wait=20"), inbox(S, bobs.auth, "wait=20")];
    await sleep(50);
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "@Alice's AI and @Bob's AI: agree?" }, ALICE)).status, 200);
    for (const x of await Promise.all(both)) assert.deepEqual(x.json!.messages.map((m: Json) => m.text), ["@Alice's AI and @Bob's AI: agree?"]);
  } finally {
    await S.close();
  }
});

test("a mention of an offline agent is written, and handed with what came before when it comes back; its private channel cannot be written to meanwhile", async () => {
  const S = await site();
  try {
    const ai = await share(S, ALICE);
    await inbox(S, ai.auth, "wait=0");
    assert.equal((await S.ask("POST", "/api/chat", { channel: ai.agent, text: "Look at N.b" }, ALICE)).status, 200);
    assert.deepEqual((await inbox(S, ai.auth, "wait=0")).json!.messages.map((m: Json) => m.text), ["Look at N.b"]);
    assert.equal((await S.ask("POST", "/api/agent/reply", { text: "Done." }, ai.auth)).status, 200);
    await S.ask("POST", "/api/agent/view", { leave: true }, ai.auth);
    // offline: its private channel refuses, a mention of it is written
    assert.equal((await S.ask("POST", "/api/chat", { channel: ai.agent, text: "still there?" }, ALICE)).status, 409);
    assert.equal((await S.ask("POST", "/api/chat", { channel: "public", text: "@Alice's AI, when you are back: N.a?" }, BOB)).status, 200);
    // back: one entry, what came before and the mention it missed, in order
    const back = (await inbox(S, ai.auth, "wait=20")).json!;
    assert.deepEqual(back.messages.map((m: Json) => m.kind), ["earlier"]);
    const e = back.messages[0];
    assert.deepEqual([e.count, e.missed], [3, 1]);
    assert.match(e.text, /— Alice, [^\n]+\(message 1\):\nLook at N\.b[\s\S]*— You \(Alice's AI\), [^\n]+\(message 2\):\nDone\.[\s\S]*— Bob in the public channel, mentioning you while you were away, [^\n]+\(public message 1\):\n@Alice's AI, when you are back: N\.a\?/);
    assert.match(e.text, /were never handed to you: answer one there \(reply with channel public\) only where it still asks something of you\. Nothing else came since: listen again after that\.$/);
    assert.match(back.next, /answer in the public channel/);
    // once: not handed again
    assert.deepEqual((await inbox(S, ai.auth, "wait=0.2")).json!.messages, []);
  } finally {
    await S.close();
  }
});

test("a channel is read the newest 200 at a time, oldest first; before= reads what came before them", async () => {
  const S = await site();
  try {
    for (let k = 1; k <= 250; k++) S.live.talk.post("public", { from: "Alice", kind: "person", text: `m${k}`, where: null });
    const newest = (await S.ask("GET", "/api/chat?channel=public", undefined, BOB)).json!.messages as Json[];
    assert.deepEqual([newest.length, newest[0].id, newest.at(-1)!.id], [200, 51, 250]);
    const older = (await S.ask("GET", "/api/chat?channel=public&before=51", undefined, BOB)).json!.messages as Json[];
    assert.deepEqual([older.length, older[0].id, older.at(-1)!.id], [50, 1, 50]);
    assert.deepEqual((await S.ask("GET", "/api/chat?channel=public&before=1", undefined, BOB)).json!.messages, []);
  } finally {
    await S.close();
  }
});
