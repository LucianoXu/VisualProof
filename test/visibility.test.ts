// Visibility (CollabSpec decision 8): a private reader's page says only that it is here — counted,
// never listed, never followed — and what they arrange is recorded without their name, while their
// review keeps it; the switch takes effect at once, both ways, under a new id each time; agents are
// always visible, and their companion counts the private readers. The menu under the name, and the
// choice kept for every tab of a browser.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Peer, StreamHello } from "../src/shared/collab.ts";
import { heartbeatRequest } from "../src/web/src/data.ts";
import { Store } from "../src/web/src/store.ts";
import { menuKey, openKey } from "../src/web/src/whomenu.ts";
import { site, stream } from "./site.ts";
import type { Json } from "./site.ts";

const ALICE = { "x-visualproof-name": "Alice" };
const SESSION = "aaaaaaaa1111";
/** what a private page sends with every request: its name, and that it is private */
const PRIVATE = { ...ALICE, "x-visualproof-private": SESSION };
const AGENT = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };
const VIEW = { mode: "tcb", sel: "N.a", source: true, clusterMode: "namespace", cam: { x: 1, y: 2, k: 3 }, view: null, scope: null, tabs: [] };

/** Alice's page and Bob's, both with their streams open; Alice's hello. */
async function two(S: Awaited<ReturnType<typeof site>>) {
  const alice = stream(S.port, `/api/events?session=${SESSION}`);
  const bob = stream(S.port, "/api/events?session=bbbbbbbb2222");
  await alice.until(() => !!alice.last("hello"));
  await bob.until(() => !!bob.last("hello"));
  return { alice, bob, hello: alice.last("hello") as StreamHello };
}

const listed = (s: ReturnType<typeof stream>) => (s.last("presence") as Peer[] | undefined) ?? [];
const count = (s: ReturnType<typeof stream>) => (s.last("private") as { count: number } | undefined)?.count;

test("a private page's heartbeat carries its stream's secret and the flag, nothing else; the server keeps nothing else of it", async () => {
  // the page: no name, no place, not even whether it is idle
  const visible = heartbeatRequest("tok", { view: VIEW as never, idle: false }, { "content-type": "application/json", ...ALICE, "x-visualproof-private": SESSION });
  assert.equal(visible.headers["x-visualproof-name"], "Alice");
  const hidden = heartbeatRequest("tok", { private: true }, { "content-type": "application/json", ...ALICE, "x-visualproof-private": SESSION });
  assert.deepEqual(JSON.parse(hidden.body), { token: "tok", private: true });
  assert.deepEqual(hidden.headers, { "content-type": "application/json" });
  // the server: a page that sends more anyway is counted, and what it sent is dropped
  const S = await site();
  try {
    const { alice, bob, hello } = await two(S);
    assert.equal((await S.ask("POST", "/api/presence", { token: hello.token, private: true, view: VIEW, idle: true }, ALICE)).status, 200);
    await bob.until(() => count(bob) === 1);
    assert.deepEqual(listed(bob), []);
    const told = JSON.stringify(bob.events);
    assert.ok(!told.includes("Alice") && !told.includes("N.a"), "neither her name nor where she is");
    assert.deepEqual(S.live.presence.list(), []);
    assert.equal(S.live.presence.privateCount(), 1);
    alice.close();
    await bob.until(() => count(bob) === 0);
    bob.close();
  } finally {
    await S.close();
  }
});

test("presence lists a private page only as a count: no name, no id, nothing to follow, for pages and agents alike", async () => {
  const S = await site();
  try {
    const { alice, bob, hello } = await two(S);
    await S.ask("POST", "/api/presence", { token: hello.token, view: VIEW, idle: false }, ALICE);
    await bob.until(() => listed(bob).some((p) => p.name === "Alice"));
    await S.ask("POST", "/api/presence", { token: hello.token, private: true }, ALICE);
    await bob.until(() => !listed(bob).some((p) => p.name === "Alice"));
    assert.equal(count(bob), 1);
    // her page is told its new id; the others are told neither it nor anything under it
    await alice.until(() => (alice.last("hello") as StreamHello).private === true);
    const now = alice.last("hello") as StreamHello;
    assert.ok(!listed(bob).some((p) => p.id === now.id || p.id === hello.id));
    // a second private page is the count's, too
    const carol = stream(S.port, "/api/events?session=cccccccc3333");
    await carol.until(() => !!carol.last("hello"));
    await S.ask("POST", "/api/presence", { token: (carol.last("hello") as StreamHello).token, private: true }, { "x-visualproof-name": "Carol" });
    await bob.until(() => count(bob) === 2);
    // the agents' companion: the people it can follow are the listed ones, and the count beside them
    const c = (await S.ask("GET", "/api/agent/companion", undefined, AGENT)).json!;
    assert.deepEqual(c.people, []);
    assert.equal(c.privateCount, 2);
    assert.ok(!JSON.stringify(c).includes("Alice") && !JSON.stringify(c).includes("Carol"));
    for (const s of [alice, bob, carol]) s.close();
  } finally {
    await S.close();
  }
});

test("going private and visible again takes effect at once, both ways, under a new id each time", async () => {
  const S = await site();
  try {
    const { alice, bob, hello } = await two(S);
    await S.ask("POST", "/api/presence", { token: hello.token, view: VIEW, idle: false }, ALICE);
    await bob.until(() => listed(bob).some((p) => p.name === "Alice" && p.id === hello.id));
    // private: gone from the list at once, counted, and named afresh — her page alone told so,
    // with the list as it is now right after its hello, so that it counts itself out
    const t0 = Date.now();
    await S.ask("POST", "/api/presence", { token: hello.token, private: true }, ALICE);
    await bob.until(() => !listed(bob).some((p) => p.name === "Alice") && count(bob) === 1, 1500);
    const h2 = alice.last("hello") as StreamHello;
    assert.ok(h2.private && h2.id !== hello.id && h2.token === hello.token);
    // what her page is told after its new hello is the state after the switch: the count with her
    // in it, and a list without her
    const after = alice.events.slice(alice.events.findIndex((e) => e.event === "hello" && e.data.id === h2.id) + 1);
    assert.equal(after.find((e) => e.event === "private")!.data.count, 1);
    assert.ok(!(after.find((e) => e.event === "presence")!.data as Peer[]).some((p) => p.name === "Alice"));
    assert.ok(!JSON.stringify(bob.events).includes(h2.id));
    // the same secret, visible again: listed at once under a third id, and no longer counted
    await S.ask("POST", "/api/presence", { token: hello.token, view: VIEW, idle: false }, ALICE);
    await bob.until(() => listed(bob).some((p) => p.name === "Alice") && count(bob) === 0, 1500);
    const h3 = alice.last("hello") as StreamHello;
    assert.ok(!h3.private && h3.id !== hello.id && h3.id !== h2.id);
    assert.deepEqual(listed(bob).filter((p) => p.name === "Alice").map((p) => p.id), [h3.id]);
    assert.ok(Date.now() - t0 < 2500);
    // a stream that is already private is not named again by each heartbeat
    await S.ask("POST", "/api/presence", { token: hello.token, private: true }, ALICE);
    await alice.until(() => (alice.last("hello") as StreamHello).private === true);
    const h4 = alice.last("hello") as StreamHello;
    await S.ask("POST", "/api/presence", { token: hello.token, private: true }, ALICE);
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal((alice.last("hello") as StreamHello).id, h4.id);
    alice.close();
    bob.close();
  } finally {
    await S.close();
  }
});

test("what a private reader arranges is shared and recorded without a name — pins, folds, views, re-layouts, an undo — and shows as someone", async () => {
  const S = await site();
  try {
    const { alice, bob, hello } = await two(S);
    await S.ask("POST", "/api/presence", { token: hello.token, view: VIEW, idle: false }, ALICE);
    await S.ask("POST", "/api/presence", { token: hello.token, private: true }, ALICE);
    await alice.until(() => (alice.last("hello") as StreamHello).private === true);
    await bob.until(() => count(bob) === 1);
    const h2 = alice.last("hello") as StreamHello;
    // what Bob is told from now on
    const since = bob.events.length;
    // a pin and a fold on the Project: everyone gets them, from someone, under her private id
    const ops = [{ op: "pin", mode: "namespace", kind: "node", key: "N.a", at: [10, 20] }, { op: "fold", mode: "namespace", key: "N", on: true }];
    assert.equal((await S.ask("POST", "/api/views/arrange", { id: "project", token: hello.token, ops }, PRIVATE)).status, 200);
    await bob.until(() => !!bob.last("view-ops"));
    assert.deepEqual([bob.last("view-ops")!.by, bob.last("view-ops")!.from], [null, h2.id]);
    assert.equal(S.live.places.authorOf("namespace", "node", "N.a")!.by, null);
    // what an agent is told of the pin: someone's
    const place = (await S.ask("GET", "/api/agent/place?name=N.a", undefined, AGENT)).json!;
    assert.deepEqual([place.pinnedBy.name, place.pinnedBy.agent], [null, false]);
    // a view opened, kept by a pin, renamed, rescoped, laid out afresh, deleted; and the Project's
    // re-layout: none needs her name, and none records it
    const open = (await S.ask("POST", "/api/views/open", { scope: "decl(N.a)" }, PRIVATE)).json!;
    assert.equal(open.view.by, null);
    const id = open.view.id as string;
    assert.equal((await S.ask("POST", "/api/views/arrange", { id, token: hello.token, ops: [ops[0]] }, PRIVATE)).status, 200);
    assert.equal((await S.ask("POST", "/api/views/rename", { id, name: "Mine" }, PRIVATE)).status, 200);
    assert.equal((await S.ask("POST", "/api/views/scope", { id, scope: "decl(N.b)" }, PRIVATE)).status, 200);
    const nameless = { "x-visualproof-private": SESSION };
    assert.equal((await S.ask("POST", "/api/views/relayout", { id }, nameless)).status, 200, "a private reader needs no name to arrange");
    const made = (await S.ask("POST", "/api/views/create", { name: "Another" }, nameless)).json!;
    assert.equal(made.view.by, null);
    assert.equal((await S.ask("POST", "/api/views/delete", { id: made.view.id }, nameless)).status, 200);
    // an agent's layout undone by her
    const batch = (await S.ask("POST", "/api/agent/pins", { pins: [{ name: "N.b", at: [5, 5] }] }, AGENT)).json!;
    assert.equal((await S.ask("POST", "/api/layout/undo", { id: batch.id }, nameless)).status, 200);
    // the timeline: every one of them by someone (null), shown so on every page, and none by her
    const events = S.live.timeline.events.filter((e) => e.kind === "view" || e.kind === "undo") as Json[];
    assert.deepEqual(
      events.map((e) => [e.kind === "undo" ? "undo" : e.what, e.by]),
      [["created", null], ["renamed", null], ["scope", null], ["relayout", null], ["created", null], ["deleted", null], ["undo", null]],
    );
    await bob.until(() => (bob.events.filter((e) => e.event === "activity").length >= 7));
    const told = JSON.stringify(bob.events.slice(since));
    assert.ok(!told.includes("Alice") && !told.includes(hello.id), "no page is told her name, nor the id she had when she was listed");
    const agentsTold = JSON.stringify((await S.ask("GET", "/api/agent/activity", undefined, AGENT)).json);
    assert.ok(!agentsTold.includes("Alice"), "no agent is told her name");
    assert.ok(!readFileSync(join(S.live.dirs.site, "views.json"), "utf8").includes("Alice"), "nor is it kept with the views");
    // a nameless reader who is not private still needs a name where one is recorded
    assert.equal((await S.ask("POST", "/api/views/relayout", { id }, {})).status, 401);
    // and an agent cannot be private: what it arranges is its own
    assert.equal((await S.ask("POST", "/api/views/arrange", { id, ops: [ops[0]] }, { ...AGENT, "x-visualproof-private": SESSION })).status, 200);
    assert.equal(S.live.views.book.authorOf(id, "namespace", "node", "N.a")!.by, "Claude");
    alice.close();
    bob.close();
  } finally {
    await S.close();
  }
});

test("a private reader's review keeps their name, and needs one; a message to an agent says who, not where", async () => {
  const S = await site();
  try {
    const r = await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "comment", comment: "Should a be 1?" }, PRIVATE);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(S.live.review.data.opinions["N.a"][0].by, "Alice");
    assert.equal((await S.ask("POST", "/api/review", { op: "target", name: "N.b", on: true }, PRIVATE)).status, 200);
    assert.equal(S.live.review.data.targets["N.b"].by, "Alice");
    assert.equal((await S.ask("POST", "/api/review", { op: "key", target: "N.b", name: "N.a", on: true }, PRIVATE)).status, 200);
    assert.equal((await S.ask("POST", "/api/review", { op: "opinion", name: "N.b", verdict: "approve" }, { "x-visualproof-private": SESSION })).status, 401);
    // a message: under her name, without her place
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "advise", days: 1 });
    await S.ask("GET", "/api/agent/inbox?wait=0", undefined, { authorization: `Bearer ${token}` });
    const id = S.live.presence.list().find((p) => p.agent)!.id;
    const sent = await S.ask("POST", "/api/chat", { agent: id, text: "Look at N.a", place: VIEW }, PRIVATE);
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    // where a writer was is handed to agents alone (CollabSpec decision 13): a private reader's, nowhere
    const handed = (await S.ask("GET", "/api/agent/inbox?wait=0", undefined, { authorization: `Bearer ${token}` })).json!.messages[0];
    assert.deepEqual([sent.json!.message.from, handed.from, handed.where], ["Alice", "Alice", null]);
  } finally {
    await S.close();
  }
});

test("agents are always visible: a private flag from one is ignored, and it is listed under its name", async () => {
  const S = await site();
  try {
    await S.ask("POST", "/api/presence", { private: true, view: VIEW }, { ...AGENT, "x-visualproof-private": SESSION });
    const peers = S.live.presence.list();
    assert.deepEqual(peers.map((p) => [p.name, p.agent, p.view?.sel]), [["Claude", true, "N.a"]]);
    assert.equal(S.live.presence.privateCount(), 0);
    const c = (await S.ask("GET", "/api/agent/companion", undefined, AGENT)).json!;
    assert.equal(c.privateCount, 0);
    assert.equal(c.agents[0].name, "Claude");
  } finally {
    await S.close();
  }
});

test("a view nobody keeps lives while a private page holds it: one it opened or read, and those it had open when it went private", async () => {
  const S = await site();
  try {
    const V = S.live.views;
    const later = (s: number) => Date.now() + s * 1000;
    const { alice, hello } = await two(S);
    // read or opened while private: held while her page is open, and a while after
    await S.ask("POST", "/api/presence", { token: hello.token, private: true }, ALICE);
    const opened = (await S.ask("POST", "/api/views/open", { scope: "decl(N.a)" }, PRIVATE)).json!.view.id as string;
    V.sweep(later(30));
    assert.ok(V.book.get(opened), "kept while she has it open");
    // visible again: her tabs say what she has open, and the view she no longer has goes
    await S.ask("POST", "/api/presence", { token: hello.token, view: { ...VIEW, tabs: [] }, idle: false }, ALICE);
    V.sweep(later(60));
    assert.ok(!V.book.get(opened));
    // the views in her tabs when she goes private stay held
    const other = (await S.ask("POST", "/api/views/open", { scope: "decl(N.b)" }, ALICE)).json!.view.id as string;
    await S.ask("POST", "/api/presence", { token: hello.token, view: { ...VIEW, view: other, tabs: [other] }, idle: false }, ALICE);
    await S.ask("POST", "/api/presence", { token: hello.token, private: true }, ALICE);
    V.sweep(later(90));
    assert.ok(V.book.get(other));
    // her page closes: what it held goes once the holds' time is past
    alice.close();
    await new Promise((ok) => setTimeout(ok, 100));
    V.sweep(later(200));
    assert.ok(!V.book.get(other));
  } finally {
    await S.close();
  }
});

test("the menu under the name: the arrows, Home and End move, Enter and Space choose, Esc and Tab close", () => {
  assert.deepEqual(menuKey("ArrowDown", -1, 3), { focus: 0 });
  assert.deepEqual(menuKey("ArrowDown", 0, 3), { focus: 1 });
  assert.deepEqual(menuKey("ArrowDown", 2, 3), { focus: 0 }, "round to the first");
  assert.deepEqual(menuKey("ArrowUp", 0, 3), { focus: 2 }, "round to the last");
  assert.deepEqual(menuKey("ArrowUp", -1, 3), { focus: 2 });
  assert.deepEqual(menuKey("Home", 2, 3), { focus: 0 });
  assert.deepEqual(menuKey("End", 0, 3), { focus: 2 });
  assert.deepEqual(menuKey("Enter", 1, 3), { choose: true });
  assert.deepEqual(menuKey(" ", 1, 3), { choose: true });
  assert.equal(menuKey("Enter", -1, 3), null, "nothing to choose");
  assert.deepEqual(menuKey("Escape", 1, 3), { close: true, back: true });
  assert.deepEqual(menuKey("Tab", 1, 3), { close: true, back: false });
  assert.equal(menuKey("a", 1, 3), null, "the page's keys are its own");
  assert.equal(menuKey("ArrowDown", -1, 0), null);
  // from the name: the down arrow opens at the first item, the up arrow at the last
  assert.deepEqual([openKey("ArrowDown"), openKey("ArrowUp"), openKey("Enter"), openKey("x")], [0, -1, null, null]);
});

test("being private is the browser's: kept, and taken from another tab, so that no tab writes the old choice back", () => {
  const saved = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  const before = g.localStorage;
  g.localStorage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
  try {
    const one = new Store("/p");
    const two = new Store("/p");
    one.data.private = true;
    one.save();
    assert.equal(new Store("/p").data.private, true, "kept");
    // the other tab is told, takes it, and its next save keeps it
    assert.equal(two.adopt(saved.get(two.key)!), true);
    assert.equal(two.data.private, true);
    two.save();
    assert.equal(JSON.parse(saved.get("visualproof:/p")!).private, true);
    assert.equal(two.adopt(saved.get(two.key)!), false, "nothing changed");
    // visible again in the first tab
    one.data.private = undefined;
    one.save();
    assert.equal(two.adopt(saved.get(two.key)!), true);
    assert.equal(two.data.private, undefined);
    // storage cleared, or not JSON: no choice is made by it
    two.data.private = true;
    assert.equal(two.adopt(null), false);
    assert.equal(two.adopt("{"), false);
    assert.equal(two.data.private, true);
  } finally {
    g.localStorage = before;
  }
});
