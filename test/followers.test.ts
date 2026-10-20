// Who follows me (the owner's decision of 2026-10-20): each page says whom it follows — a listed page
// in its place, as bookkeeping no follower takes; a private page in its heartbeat, which says nothing
// else — and the followed reader is told who follows them: the people by name (from the list every
// page has), the private readers counted (told to that reader's pages alone). A read-only reader sends
// no heartbeat and is never counted; an agent follows nobody. Nothing is said when someone starts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanFollowing, cleanView, personKey } from "../src/shared/collab.ts";
import type { Peer, PresenceView, PrivateCount, StreamHello } from "../src/shared/collab.ts";
import { heartbeatRequest } from "../src/web/src/data.ts";
import { followerKeys } from "../src/web/src/people.ts";
import { readOnlyAllows } from "../src/server/readonlygate.ts";
import { followersCount, followersLine, menuHtml } from "../src/web/src/whomenu.ts";
import { site, stream } from "./site.ts";

const VIEW: PresenceView = { mode: "tcb", sel: "N.a", source: false, clusterMode: "namespace", cam: { x: 1, y: 2, k: 3 }, view: null, scope: null, tabs: [] };
const AGENT = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };

const peer = (id: string, name: string | null, following?: string, more: Partial<Peer> = {}): Peer => ({ id, name, idle: false, view: { ...VIEW, ...(following ? { following } : {}) }, ...more });

test("whom a page follows is checked as every field is: a person as the page tells them apart, or nothing", () => {
  for (const ok of ["n:Alice", "v:Alice", "a:Xb3k9", "s:Qm1ZpL0k"]) assert.equal(cleanFollowing(ok), ok);
  for (const bad of ["x:Alice", "Alice", "n:", "n:A\nB", "n:" + "x".repeat(300), 5, null, { key: "n:Alice" }]) assert.equal(cleanFollowing(bad), null, JSON.stringify(bad));
  assert.equal(cleanView({ ...VIEW, following: "n:Alice" })!.following, "n:Alice");
  assert.ok(!("following" in cleanView({ ...VIEW, following: "Alice" })!), "a malformed one is dropped, the rest kept");
  assert.ok(!("following" in cleanView(VIEW)!), "absent where the page follows nobody");
  // a private page's heartbeat says whom it follows, and nothing else of where it is
  const hb = heartbeatRequest("tok", { private: true, following: "n:Alice" }, { "content-type": "application/json", "x-visualproof-name": "Carol" });
  assert.deepEqual(JSON.parse(hb.body), { token: "tok", private: true, following: "n:Alice" });
  assert.deepEqual(hb.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(heartbeatRequest("tok", { private: true, following: null }, {}).body), { token: "tok", private: true });
  // a read-only reader sends none (CollabSpec decision 11): seen by nobody, followed or following
  assert.equal(readOnlyAllows("POST", "/api/presence"), false);
});

test("the people following a reader, each once: by the person they follow, never an agent, nobody for a reader not listed", () => {
  const alice = peer("pA", "Alice");
  const peers = [
    alice,
    peer("pB1", "Bob", "n:Alice"),
    // Bob's second page follows her too: one person
    peer("pB2", "Bob", "n:Alice"),
    peer("pC", "Carol", "n:Dave"),
    peer("pX", null, "n:Alice"),
    // an agent says it follows: agents follow nobody
    peer("aZ", "Claude", "n:Alice", { agent: true }),
  ];
  assert.deepEqual([...followerKeys(peers, alice)].sort(), ["n:Bob", "s:pX"]);
  // a reader the server does not list (private, read-only, before the first heartbeat): nobody
  assert.equal(followerKeys(peers, null).size, 0);
  // someone invited by a personal link is another person than a guest of the same name
  const verified = peer("pV", "Alice", undefined, { verified: true });
  assert.equal(personKey(verified), "v:Alice");
  assert.equal(followerKeys([...peers, peer("pD", "Dan", "v:Alice")], verified).size, 1);
  assert.deepEqual([...followerKeys([...peers, peer("pD", "Dan", "v:Alice")], verified)], ["n:Dan"]);
  // an agent can be followed: its page-less presence shows nothing of it, and nothing here asks it
  assert.deepEqual([...followerKeys([peer("pB", "Bob", "a:aZ")], peer("aZ", "Claude", undefined, { agent: true }))], ["n:Bob"]);
});

test("what the name says: how many follow, the people named, the private readers counted only", () => {
  assert.equal(followersCount({ names: [], private: 0 }), null);
  assert.equal(followersCount({ names: ["Bob"], private: 0 }), "1 follows you");
  assert.equal(followersCount({ names: ["Bob"], private: 1 }), "2 follow you");
  assert.equal(followersLine({ names: ["Bob", "Carol ✓"], private: 2 }), "Bob, Carol ✓, +2 private");
  assert.equal(followersLine({ names: [], private: 1 }), "+1 private");
  // the menu under the name: a heading and a line, nothing to choose, escaped
  const html = menuHtml({ mode: () => "declared", name: () => "Alice", visibility: () => "visible", rename: () => {}, setVisibility: () => {}, followers: () => ({ names: ["<b>Bob</b>"], private: 1 }) });
  assert.match(html, /<div class="wm-h" id="wm-fol">2 follow you<\/div><div class="wm-note wm-fol"[^>]*>&lt;b&gt;Bob&lt;\/b&gt;, \+1 private<\/div>/);
  assert.ok(!/role="menuitem"[^>]*>[^<]*follow you/.test(html), "not an item");
  assert.ok(!menuHtml({ mode: () => "declared", name: () => "Alice", visibility: () => "visible", rename: () => {}, setVisibility: () => {}, followers: () => ({ names: [], private: 0 }) }).includes("wm-fol"));
});

const listed = (s: ReturnType<typeof stream>) => (s.last("presence") as Peer[] | undefined) ?? [];
const priv = (s: ReturnType<typeof stream>) => s.last("private") as PrivateCount | undefined;

test("the server: a listed page's following is in its place for everyone; a private page's is counted for the person it follows, told to that person's pages alone", async () => {
  const S = await site();
  try {
    const open = async (session: string) => {
      const s = stream(S.port, `/api/events?session=${session}`);
      await s.until(() => !!s.last("hello"));
      return { s, hello: s.last("hello") as StreamHello };
    };
    const alice = await open("aaaaaaaa1111");
    const alice2 = await open("aaaaaaaa2222");
    const bob = await open("bbbbbbbb1111");
    const carol = await open("cccccccc1111");
    const dave = await open("dddddddd1111");
    const beat = (who: { hello: StreamHello }, name: string, body: Record<string, unknown>) => S.ask("POST", "/api/presence", { token: who.hello.token, ...body }, { "x-visualproof-name": name });
    await beat(alice, "Alice", { view: VIEW, idle: false });
    await beat(alice2, "Alice", { view: VIEW, idle: false });
    // Bob follows her, visibly; Carol privately; Dave privately, nobody
    await beat(bob, "Bob", { view: { ...VIEW, following: "n:Alice" }, idle: false });
    await beat(carol, "Carol", { private: true, following: "n:Alice" });
    await beat(dave, "Dave", { private: true });
    await alice.s.until(() => priv(alice.s)?.count === 2 && priv(alice.s)?.followers === 1 && listed(alice.s).some((p) => p.name === "Bob" && p.view?.following === "n:Alice"));
    // both of her pages are told, as she is one person
    await alice2.s.until(() => priv(alice2.s)?.followers === 1);
    // nobody else is told it: the count alone
    await bob.s.until(() => priv(bob.s)?.count === 2);
    assert.deepEqual(priv(bob.s), { count: 2 });
    assert.ok(!JSON.stringify(bob.s.events).includes("Carol") && !JSON.stringify(bob.s.events).includes("followers"), "nothing of who follows whom privately");
    // whom the private pages follow is kept, nothing else of them
    assert.deepEqual([...S.live.presence.privateFollowers()], [["n:Alice", 1]]);
    // Carol stops: Alice's pages are told at once
    await beat(carol, "Carol", { private: true });
    await alice.s.until(() => priv(alice.s)?.count === 2 && priv(alice.s)?.followers === undefined);
    // a private page that goes visible again follows as a listed one; Bob going private is counted
    await beat(bob, "Bob", { private: true, following: "n:Alice" });
    await alice.s.until(() => priv(alice.s)?.followers === 1 && !listed(alice.s).some((p) => p.name === "Bob"));
    // a stream's first word is the count as it is for it: a page opened now is told too
    const alice3 = await open("aaaaaaaa3333");
    await beat(alice3, "Alice", { view: VIEW, idle: false });
    await alice3.s.until(() => priv(alice3.s)?.followers === 1);
    // an agent says whom it follows: agents follow nobody, and it is not kept
    await S.ask("POST", "/api/presence", { view: { ...VIEW, following: "n:Alice" } }, AGENT);
    const agent = S.live.presence.list().find((p) => p.agent);
    assert.ok(agent && agent.view && !("following" in agent.view));
    // the companion tells agents nothing of it, nor wakes them for it
    const c = (await S.ask("GET", "/api/agent/companion", undefined, AGENT)).json!;
    assert.ok(!JSON.stringify(c).includes('"following"'));
    const rev = S.live.presence.rev;
    await beat(alice2, "Alice", { view: { ...VIEW, following: "n:Bob" }, idle: false });
    assert.equal(S.live.presence.rev, rev, "whom a page follows is no move for an agent waiting");
    for (const w of [alice, alice2, alice3, bob, carol, dave]) w.s.close();
  } finally {
    await S.close();
  }
});
