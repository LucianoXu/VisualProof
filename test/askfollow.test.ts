// Asking others to follow (CollabSpec decision 10, AgentSpec decision 8; the owner's decisions of
// 2026-10-12). Who may ask: a reader with a name who is visible, one request per 30 s; an agent at
// advise or full. Who is asked: everyone — private readers too, counted, never named — or one
// person, all their pages, never the asker's own; those following already answer so and are not
// counted. The banner: a countdown of 30 s, declined when it runs out, Esc declines outside a field,
// a newer request replaces it, it never takes the focus; Follow starts following the asker, their
// state applied. The asker is told each answer, and sees them on the initials and in a line. Nothing
// is kept beyond a request's life.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { Peer, PresenceView, StreamHello } from "../src/shared/collab.ts";
import { ASK_MS, askLine, foldAnswers } from "../src/shared/askfollow.ts";
import type { AskAnswer, AskFollow } from "../src/shared/askfollow.ts";
import { Asks } from "../src/server/askfollow.ts";
import type { AskStream } from "../src/server/askfollow.ts";
import { routes } from "../src/server/mcptools.ts";
import { AskBanner, AskTally, askMark, LINGER_MS } from "../src/web/src/askfollow.ts";
import type { BannerHooks } from "../src/web/src/askfollow.ts";
import { People, personKey } from "../src/web/src/people.ts";
import { ownAgents } from "../src/web/src/talk.ts";
import type { DataSource } from "../src/web/src/data.ts";
import type { Store } from "../src/web/src/store.ts";
import { keyActs, pressActs, YOURS } from "../src/web/src/surfaces.ts";
import type { PageEl } from "../src/web/src/surfaces.ts";
import { site, stream } from "./site.ts";
import type { Json } from "./site.ts";

const name = (n: string) => ({ "x-visualproof-name": n });
const AGENT = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const VIEW = { mode: "tcb", sel: "N.a", source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };

type Site = Awaited<ReturnType<typeof site>>;
let sessions = 0;

/** A page open on the server: its stream, said hello to, and listed under `who` (a name, none, or
 *  private). */
async function page(S: Site, who: string | null | { private: string }) {
  const s = stream(S.port, `/api/events?session=${(++sessions).toString(16).padStart(12, "0")}`);
  await s.until(() => !!s.last("hello"));
  const hello = s.last("hello") as StreamHello;
  const headers = typeof who === "string" ? name(who) : {};
  if (who !== null && typeof who === "object") {
    await S.ask("POST", "/api/presence", { token: hello.token, private: true }, name(who.private));
    await s.until(() => (s.last("hello") as StreamHello).private === true);
  } else await S.ask("POST", "/api/presence", { token: hello.token, view: VIEW, idle: false }, headers);
  const now = () => s.last("hello") as StreamHello;
  return { s, token: hello.token, id: () => now().id, headers, asks: () => s.events.filter((e) => e.event === "ask").map((e) => e.data as AskFollow) };
}

const askOf = (S: Site, p: Awaited<ReturnType<typeof page>>, body: Json = {}) => S.ask("POST", "/api/ask", { token: p.token, ...body }, p.headers);
const answer = (S: Site, p: Awaited<ReturnType<typeof page>>, id: string, a: AskAnswer) => S.ask("POST", "/api/ask/answer", { token: p.token, id, answer: a });

test("who may ask: a reader with a name, visible, once every 30 s; an agent through its own API", async () => {
  const S = await site();
  try {
    const ada = await page(S, "Ada");
    // alone, nobody to ask: no request, and it does not count
    const alone = await askOf(S, ada);
    assert.equal(alone.status, 200);
    assert.deepEqual([alone.json!.id, alone.json!.asked], [null, []]);
    const bob = await page(S, "Bob");
    // no name: refused, and the page asks for one
    const nameless = await page(S, null);
    const r0 = await askOf(S, nameless);
    assert.equal(r0.status, 401);
    assert.equal(r0.json!.who, true);
    // a page speaks for its own stream alone; an agent asks through its API
    assert.equal((await S.ask("POST", "/api/ask", { token: "not a stream's" }, name("Ada"))).status, 403);
    assert.equal((await S.ask("POST", "/api/ask", { token: ada.token }, AGENT)).status, 403);
    // a private reader cannot be followed, so cannot ask
    const cy = await page(S, { private: "Cy" });
    const r1 = await S.ask("POST", "/api/ask", { token: cy.token }, { ...name("Cy"), "x-visualproof-private": "cccccccc0001" });
    assert.equal(r1.status, 409);
    assert.match(r1.json!.error, /private/);
    // Ada asks: Bob is asked
    const r2 = await askOf(S, ada);
    assert.equal(r2.status, 200, JSON.stringify(r2.json));
    assert.ok(r2.json!.id);
    assert.equal(r2.json!.ms, ASK_MS);
    await bob.s.until(() => bob.asks().length === 1);
    // at most one request per asker every 30 s: said with how long to wait, from any page of hers
    const r3 = await askOf(S, ada);
    assert.equal(r3.status, 429);
    assert.ok(r3.json!.retryAfter > 0 && r3.json!.retryAfter <= 30);
    assert.equal(r3.headers.get("retry-after"), String(r3.json!.retryAfter));
    assert.match(r3.json!.error, /Ask again in \d+ s/);
    const ada2 = await page(S, "Ada");
    assert.equal((await askOf(S, ada2)).status, 429, "her other page counts as her");
    // Bob may: the rate is each asker's own
    assert.equal((await askOf(S, bob)).status, 200);
    for (const p of [ada, bob, nameless, cy, ada2]) p.s.close();
  } finally {
    await S.close();
  }
});

test("who is asked: everyone, private readers counted, or one person's every page; never the asker's own; never an agent", async () => {
  const S = await site();
  try {
    const ada = await page(S, "Ada");
    const ada2 = await page(S, "Ada");
    const bob = await page(S, "Bob");
    const bob2 = await page(S, "Bob");
    const cy = await page(S, { private: "Cy" });
    const dan = await page(S, "Dan");
    S.live.tokens.create({ name: "Alice's AI", by: "Alice", level: "full", days: 1 });
    const agent = S.live.presence.list().find((p) => p.agent)!;
    // everyone: Bob's two pages, Dan's, and the private reader, who is counted and never named
    const r = await askOf(S, ada);
    assert.equal(r.status, 200);
    assert.deepEqual(new Set(r.json!.asked), new Set([bob.id(), bob2.id(), dan.id()]));
    assert.equal(r.json!.private, 1);
    for (const p of [bob, bob2, cy, dan]) await p.s.until(() => p.asks().length === 1);
    const told = bob.asks()[0];
    assert.deepEqual({ ...told, id: "" }, { id: "", from: ada.id(), name: "Ada", ms: ASK_MS });
    assert.deepEqual([ada.asks().length, ada2.asks().length], [0, 0], "not the asker's own pages");
    // one person: every page of Bob's, and nobody else
    const one = await askOf(S, dan, { to: bob2.id() });
    assert.equal(one.status, 200);
    assert.deepEqual(new Set(one.json!.asked), new Set([bob.id(), bob2.id()]));
    assert.equal(one.json!.private, 0);
    await bob.s.until(() => bob.asks().length === 2 && bob2.asks().length === 2);
    await new Promise((ok) => setTimeout(ok, 50));
    assert.deepEqual([ada.asks().length, cy.asks().length], [0, 1]);
    // an agent cannot be asked; someone gone is not here; nor is one's own page someone else
    const eve = await page(S, "Eve");
    assert.equal((await askOf(S, eve, { to: agent.id })).status, 409);
    assert.equal((await askOf(S, eve, { to: "gone" })).status, 404);
    assert.equal((await askOf(S, eve, { to: eve.id() })).status, 400);
    assert.equal((await askOf(S, eve, { to: 5 })).status, 400);
    // none of these counted: Eve may still ask
    assert.equal((await askOf(S, eve, { to: dan.id() })).status, 200);
    for (const p of [ada, ada2, bob, bob2, cy, dan, eve]) p.s.close();
  } finally {
    await S.close();
  }
});

test("the answers go to the asker as they come — a private reader's by nobody — once each; a newer request replaces one shown; a request leaves nothing behind", async () => {
  const S = await site();
  try {
    const ada = await page(S, "Ada");
    const bob = await page(S, "Bob");
    const cy = await page(S, { private: "Cy" });
    const dan = await page(S, "Dan");
    const r = await askOf(S, ada);
    const id = r.json!.id as string;
    for (const p of [bob, cy, dan]) await p.s.until(() => p.asks().length === 1);
    const answers = () => ada.s.events.filter((e) => e.event === "ask-answer").map((e) => e.data);
    assert.equal((await answer(S, bob, id, "follow")).status, 200);
    await ada.s.until(() => answers().length === 1);
    assert.deepEqual(answers()[0], { id, from: bob.id(), answer: "follow" });
    assert.equal((await answer(S, cy, id, "decline")).status, 200);
    await ada.s.until(() => answers().length === 2);
    assert.deepEqual(answers()[1], { id, from: null, answer: "decline" }, "a private reader is nobody in particular");
    // once each, by a page asked, with an answer that is one
    assert.equal((await answer(S, bob, id, "decline")).status, 409);
    assert.equal((await answer(S, ada, id, "follow")).status, 403);
    assert.equal((await S.ask("POST", "/api/ask/answer", { token: dan.token, id, answer: "maybe" })).status, 400);
    assert.equal((await S.ask("POST", "/api/ask/answer", { token: "nobody's", id, answer: "follow" })).status, 403);
    // Eve asks everyone while Ada's request still shows on Dan's page: hers replaces it there, and
    // Ada is told Dan did not answer
    const eve = await page(S, "Eve");
    const e = await askOf(S, eve);
    await ada.s.until(() => answers().length === 3);
    assert.deepEqual(answers()[2], { id, from: dan.id(), answer: "timeout" });
    assert.equal((await answer(S, dan, id, "follow")).status, 404, "Ada's request is over: every page asked answered");
    assert.equal(S.live.asks.pending, 1, "only Eve's goes on");
    // Eve leaves: her request is withdrawn from every page that still shows it
    for (const p of [ada, bob, cy, dan]) await p.s.until(() => p.asks().some((a) => a.id === e.json!.id));
    eve.s.close();
    for (const p of [ada, bob, cy, dan]) await p.s.until(() => p.s.events.some((x) => x.event === "ask-end" && x.data.id === e.json!.id));
    await ada.s.until(() => S.live.asks.pending === 0);
    // an asker who goes private can no longer be followed: what they asked is withdrawn, and they
    // are told nobody answered
    const again = await askOf(S, dan);
    assert.equal(again.status, 200);
    for (const p of [ada, bob, cy]) await p.s.until(() => p.asks().some((a) => a.id === again.json!.id));
    await S.ask("POST", "/api/presence", { token: dan.token, private: true }, name("Dan"));
    for (const p of [ada, bob, cy]) await p.s.until(() => p.s.events.some((x) => x.event === "ask-end" && x.data.id === again.json!.id));
    await dan.s.until(() => dan.s.events.filter((x) => x.event === "ask-answer" && x.data.id === again.json!.id).length === 3);
    assert.ok(dan.s.events.filter((x) => x.event === "ask-answer" && x.data.id === again.json!.id).every((x) => x.data.answer === "timeout"));
    assert.equal(S.live.asks.pending, 0);
    for (const p of [ada, bob, cy, dan]) p.s.close();
  } finally {
    await S.close();
  }
});

/** Pages as the request reads them, and what each was told. */
function port(streams: AskStream[], peers: Peer[] = []) {
  const told: { token: string; event: string; data: Json }[] = [];
  return { told, port: { streams: () => streams, peers: () => peers, send: (token: string, event: string, data: unknown) => told.push({ token, event, data: data as Json }) } };
}
const listed = (token: string, id: string, n: string | null, more: Partial<AskStream> = {}): AskStream => ({ token, id, private: false, name: n, verified: false, ...more });
const asker = (n: string, stream: string | null, from = `id-${n}`) => ({ name: n, verified: false, agent: false, from, stream, rate: [`n:${n}`] });

test("a request lasts its time: what was not answered by then was not, the pages are told it ended, and nothing of it is kept; the rate is forgotten after its time", async (t) => {
  // a request's timer is unref'd, as a server's should be: here nothing else keeps the event loop
  // alive while the test waits for it (Node 22's test runner then cancels the test)
  const alive = setInterval(() => {}, 60_000);
  t.after(() => clearInterval(alive));
  const P = port([listed("ta", "a", "Ada"), listed("tb", "b", "Bob"), listed("tc", "c", null, { private: true })]);
  const asks = new Asks(P.port, { ms: 60, grace: 20 });
  const r = asks.ask(asker("Ada", "ta"), { everyone: true });
  assert.ok("ok" in r);
  const id = r.ok.id!;
  assert.deepEqual(r.ok.report.people, [{ name: "Bob", answer: "waiting" }]);
  assert.deepEqual(r.ok.report.private, { asked: 1, waiting: 1 });
  // one request per asker for its time
  const again = asks.ask(asker("Ada", "ta"), { everyone: true });
  assert.ok(!("ok" in again) && again.status === 429 && again.retryAfter === 1);
  assert.equal(asks.answer("tb", id, "follow").status, 200);
  const settled = asks.settled(id);
  const rep = await settled;
  assert.ok(rep);
  assert.equal(rep.summary, "1 following, 1 no answer");
  assert.deepEqual(rep.people, [{ name: "Bob", answer: "following" }]);
  assert.deepEqual(rep.private, { asked: 1, "no answer": 1 });
  assert.ok(P.told.some((t) => t.token === "tc" && t.event === "ask-end" && t.data.id === id), "the page still showing it is told it ended");
  assert.ok(!P.told.some((t) => t.token === "tb" && t.event === "ask-end"), "not the one that answered");
  assert.ok(P.told.some((t) => t.token === "ta" && t.event === "ask-answer" && t.data.from === null && t.data.answer === "timeout"));
  assert.equal(asks.pending, 0);
  assert.equal(asks.answer("tc", id, "follow").status, 404, "over");
  // then it is forgotten
  assert.equal(asks.retryAfter(asker("Ada", "ta")), 0);
  // a page that already follows the asker answers so: not counted as asked
  const r2 = asks.ask(asker("Ada", "ta"), { everyone: true });
  assert.ok("ok" in r2);
  asks.answer("tb", r2.ok.id!, "following");
  asks.answer("tc", r2.ok.id!, "decline");
  const rep2 = await asks.settled(r2.ok.id!);
  assert.equal(rep2, null, "over already: every page answered");
  // a page that closes did not answer
  asks.now = () => Date.now() + 200;
  const r3 = asks.ask(asker("Ada", "ta"), { name: "bob" });
  assert.ok("ok" in r3);
  const done = asks.settled(r3.ok.id!);
  asks.closed("tb");
  assert.equal((await done)!.summary, "1 no answer");
  assert.equal(asks.pending, 0);
});

test("agents ask at advise and full, one request every 30 s, and wait for the answers; agents cannot be asked", async () => {
  const S = await site();
  try {
    const tokens = Object.fromEntries((["read", "advise", "full"] as const).map((level) => [level, S.live.tokens.create({ name: `Alice's AI ${level}`, by: "Alice", level, days: 1 }).token]));
    const bob = await page(S, "Bob");
    const no = await S.ask("POST", "/api/agent/ask-follow", {}, bearer(tokens.read));
    assert.equal(no.status, 403);
    assert.match(no.json!.error, /only read/);
    // at advise: everyone, answered at once without waiting
    const a = await S.ask("POST", "/api/agent/ask-follow", { wait: false }, bearer(tokens.advise));
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.deepEqual(a.json!.people, [{ name: "Bob", answer: "waiting" }]);
    await bob.s.until(() => bob.asks().length === 1);
    const told = bob.asks()[0];
    assert.equal(told.agent, true);
    assert.equal(told.name, "Alice's AI advise");
    assert.ok(S.live.presence.list().some((p) => p.id === told.from && p.agent), "the banner's Follow follows the agent's entry");
    assert.equal(personKey({ id: told.from, name: told.name, agent: told.agent }), `a:${told.from}`, "an agent is its presence entry");
    assert.equal((await S.ask("POST", "/api/agent/ask-follow", {}, bearer(tokens.advise))).status, 429);
    // at full: one person by name, waiting for their answer
    const asked = S.ask("POST", "/api/agent/ask-follow", { who: "bob" }, bearer(tokens.full));
    await bob.s.until(() => bob.asks().length === 2);
    assert.equal((await answer(S, bob, bob.asks()[1].id, "follow")).status, 200);
    const f = await asked;
    assert.equal(f.status, 200, JSON.stringify(f.json));
    assert.deepEqual(f.json!.people, [{ name: "Bob", answer: "following" }]);
    assert.equal(f.json!.summary, "1 following");
    assert.ok(f.json!.waited < 5);
    // an agent cannot be asked; a name nobody goes by is said, with who is here
    S.live.asks.now = () => Date.now() + ASK_MS;
    const ag = await S.ask("POST", "/api/agent/ask-follow", { who: "Alice's AI advise", wait: false }, bearer(tokens.full));
    assert.equal(ag.status, 409);
    const zed = await S.ask("POST", "/api/agent/ask-follow", { who: "Zed", wait: false }, bearer(tokens.full));
    assert.equal(zed.status, 404);
    assert.deepEqual(zed.json!.didYouMean, ["Bob"]);
    assert.ok(zed.json!.hint);
    // the MCP server's view tool, its action ask_follow, from advise
    const asking = routes().find((r) => r.action === "ask_follow")!;
    assert.deepEqual([asking.tool, asking.route.method, asking.route.path], ["view", "POST", "/api/agent/ask-follow"]);
    const actions = async (level: string) => ((await S.ask("GET", "/api/agent/mcp/tools", undefined, bearer(tokens[level]))).json!.tools as Json[]).find((t) => t.name === "view")!.inputSchema.properties.action.enum as string[];
    assert.deepEqual([(await actions("read")).includes("ask_follow"), (await actions("advise")).includes("ask_follow")], [false, true]);
    bob.s.close();
  } finally {
    await S.close();
  }
});

/** The banner's element, as the banner uses it: what it is drawn as, its countdown, and a press on
 *  one of its buttons — which says whether the press was kept from moving the focus. It has no
 *  focus(): the banner never takes the focus. */
function bannerEl() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const props = new Map<string, string>();
  const secs = { textContent: "" as string | null };
  return {
    innerHTML: "",
    hidden: true,
    props,
    secs,
    style: { setProperty: (k: string, v: string) => props.set(k, v) },
    classList: { toggle() {} },
    querySelector: (sel: string) => (sel === ".ab-secs" ? secs : null),
    addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, [...(listeners.get(t) ?? []), f]),
    press(which: "follow" | "decline"): boolean {
      let kept = false;
      const target = { closest: (sel: string) => (sel === "[data-ask]" ? { dataset: { ask: which } } : null) };
      for (const f of listeners.get("mousedown") ?? []) f({ target, preventDefault: () => (kept = true) });
      for (const f of listeners.get("click") ?? []) f({ target });
      return kept;
    },
  };
}

const ASK = (id: string, n: string, more: Partial<AskFollow> = {}): AskFollow => ({ id, from: `id-${n}`, name: n, ms: ASK_MS, ...more });

/** A banner on a page where Ada, Bob and the agent Claude are, this reader following `following`;
 *  `over` the page's own hooks, where a test has a page. */
function banner(t: TestContext, following: string | null = null, over: Partial<BannerHooks> = {}) {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  const el = bannerEl();
  const answered: [string, AskAnswer][] = [];
  const followed: string[] = [];
  const said: string[] = [];
  const here = new Set(["n:Ada", "n:Bob", "a:Claude"]);
  const b = new AskBanner(el as unknown as HTMLElement, {
    following: (k) => k === following,
    present: (k) => here.has(k),
    follow: (k) => followed.push(k),
    answer: (id, a) => answered.push([id, a]),
    say: (x) => said.push(x),
    ...over,
  });
  return { el, b, answered, followed, said, here };
}

test("the banner: a countdown of 30 s, declined by itself when it runs out; Esc declines, outside a field or a menu", (t) => {
  const { el, b, answered } = banner(t);
  b.show(ASK("r1", "Ada"), "n:Ada");
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /<b>Ada<\/b> asks you to follow/);
  assert.match(el.innerHTML, /data-ask="follow"[^>]*>Follow</);
  assert.match(el.innerHTML, /data-ask="decline"[^>]*>Not now</);
  assert.equal(el.secs.textContent, "30");
  assert.equal(el.props.get("--left"), "1.000");
  t.mock.timers.tick(10_000);
  assert.equal(el.secs.textContent, "20");
  assert.equal(el.props.get("--left"), "0.667");
  t.mock.timers.tick(19_000);
  assert.equal(el.secs.textContent, "1");
  assert.deepEqual(answered, []);
  t.mock.timers.tick(1_000);
  assert.deepEqual(answered, [["r1", "timeout"]], "declined by itself");
  assert.equal(el.hidden, true);
  // Esc: in a field it is the field's (a comment being written), in a menu the menu's; else Not now
  b.show(ASK("r2", "Bob"), "n:Bob");
  assert.equal(b.escape({ field: true, menu: false }), false);
  assert.equal(b.escape({ field: false, menu: true }), false);
  assert.equal(el.hidden, false);
  assert.equal(b.escape({ field: false, menu: false }), true);
  assert.deepEqual(answered.at(-1), ["r2", "decline"]);
  assert.equal(el.hidden, true);
  assert.equal(b.escape({ field: false, menu: false }), false, "with nothing shown, Esc is the page's");
  // Not now
  b.show(ASK("r3", "Bob"), "n:Bob");
  el.press("decline");
  assert.deepEqual(answered.at(-1), ["r3", "decline"]);
  // ended on the server (the asker left): gone, unanswered
  b.show(ASK("r4", "Bob"), "n:Bob");
  b.end("other");
  assert.equal(el.hidden, false);
  b.end("r4");
  assert.equal(el.hidden, true);
  assert.equal(answered.length, 3);
});

test("the banner never takes the focus, and a newer request replaces the one shown, from the newest asker", (t) => {
  const { el, b, answered, followed } = banner(t);
  b.show(ASK("r1", "Ada"), "n:Ada");
  // out of the tab order, and a press keeps the focus where it is: the keys stay with the comment
  // being written (the element has no focus() for the banner to call)
  assert.equal((el.innerHTML.match(/tabindex="-1"/g) ?? []).length, 2);
  assert.doesNotMatch(el.innerHTML, /autofocus/);
  // a key typed into a field is the field's, Enter on the banner's buttons too: nothing answers it
  assert.equal(b.escape({ field: true, menu: false }), false);
  t.mock.timers.tick(12_000);
  b.show(ASK("r2", "Bob"), "n:Bob");
  assert.match(el.innerHTML, /<b>Bob<\/b> asks you to follow/);
  assert.equal(el.secs.textContent, "30", "its own 30 s");
  assert.deepEqual(answered, [], "the server counts the one replaced as not answered");
  assert.equal(el.press("follow"), true, "the press left the focus where it was");
  assert.deepEqual(followed, ["n:Bob"]);
  assert.deepEqual(answered, [["r2", "follow"]]);
  // the old one's countdown does not run on
  t.mock.timers.tick(40_000);
  assert.deepEqual(answered, [["r2", "follow"]]);
});

test("an agent's request says it is one, with its mark; someone who left cannot be followed; a reader following the asker already is not asked", (t) => {
  const { el, b, answered, followed, said } = banner(t, "n:Ada");
  b.show(ASK("r1", "Claude", { agent: true }), "a:Claude");
  assert.match(el.innerHTML, /<b>Claude<\/b> \(agent\) asks you to follow/);
  assert.match(el.innerHTML, /class="bot"/);
  assert.match(el.innerHTML, /following it opens its conversation/);
  el.press("follow");
  assert.deepEqual(followed, ["a:Claude"]);
  // the asker left before Follow was pressed
  b.show(ASK("r2", "Zed"), "n:Zed");
  el.press("follow");
  assert.deepEqual(followed, ["a:Claude"]);
  assert.deepEqual(said, ["Zed is not here any more."]);
  assert.equal(el.hidden, true);
  // followed already: answered so, and nothing shown
  b.show(ASK("r3", "Ada"), "n:Ada");
  assert.equal(el.hidden, true);
  assert.deepEqual(answered, [["r1", "follow"], ["r3", "following"]]);
});

/** A page for People to run in: elements by selector, each with what it is drawn as. */
function fakePage() {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { document: g.document, window: g.window };
  const mk = () => ({ innerHTML: "", hidden: true, textContent: "", title: "", dataset: {} as Record<string, string>, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, addEventListener() {}, contains: () => false });
  const els = new Map<string, ReturnType<typeof mk>>();
  g.document = { querySelector: (s: string) => els.get(s) ?? (els.set(s, mk()), els.get(s)), body: mk(), activeElement: null };
  g.window = { addEventListener() {} };
  return { els, restore: () => Object.assign(g, saved) };
}

test("Follow starts following the asker as starting to follow does: their state applied, and following someone else ended", (t) => {
  const dom = fakePage();
  try {
    const applied: (string | null)[] = [];
    let ended = 0;
    const view = (sel: string): PresenceView => ({ ...VIEW, sel });
    const people = new People({ privateSession: null, name: null } as unknown as DataSource, { data: {}, save() {} } as unknown as Store, {
      view: () => view("me"),
      describe: () => "",
      follow: (v) => applied.push(v.sel),
      changed: () => {},
      renamed: () => {},
      unfollowed: () => ended++,
    });
    people.setPeers([
      { id: "a1", name: "Ada", view: view("Ada.place"), idle: false },
      { id: "b1", name: "Bob", view: view("Bob.place"), idle: false },
    ] as Peer[]);
    people.follow("n:Bob");
    assert.deepEqual([people.followedKey, applied], ["n:Bob", ["Bob.place"]]);
    // the banner on this page, wired to it as web/src/pagepeople.ts wires it
    const { el, b, answered } = banner(t, null, {
      following: (k) => people.followedKey === k,
      present: (k) => people.people().some((p) => p.key === k),
      follow: (k) => people.follow(k),
    });
    // Bob, whom this reader follows, asks: not asked
    b.show(ASK("r0", "Bob", { from: "b1" }), personKey({ id: "b1", name: "Bob" }));
    assert.equal(b.showing, null);
    assert.deepEqual(answered, [["r0", "following"]]);
    // Ada asks; Follow
    const ask = ASK("r1", "Ada", { from: "a1" });
    b.show(ask, personKey({ id: ask.from, name: ask.name, agent: ask.agent, verified: ask.verified }));
    assert.equal((b.showing as AskFollow | null)?.id, "r1");
    el.press("follow");
    assert.equal(people.followedKey, "n:Ada");
    assert.deepEqual(applied, ["Bob.place", "Ada.place"], "her place applied at once");
    assert.equal(ended, 1, "following Bob ended");
    assert.deepEqual(answered.at(-1), ["r1", "follow"]);
    // she moves: followed live
    people.setPeers([
      { id: "a1", name: "Ada", view: view("Ada.next"), idle: false },
      { id: "b1", name: "Bob", view: view("Bob.place"), idle: false },
    ] as Peer[]);
    assert.deepEqual(applied.at(-1), "Ada.next");
  } finally {
    dom.restore();
  }
});

test("a read-only reader sends no heartbeat, and follows the others: a click on their initials", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const dom = fakePage();
  const g = globalThis as unknown as { document: Record<string, unknown> };
  g.document.addEventListener = () => {};
  // the presence bar's clicks, as the page wires them
  const clicks: ((e: unknown) => void)[] = [];
  const peers = (g.document.querySelector as (s: string) => Record<string, unknown>)("#peers");
  peers.addEventListener = (type: string, f: (e: unknown) => void) => type === "click" && clicks.push(f);
  try {
    const applied: (string | null)[] = [];
    const beats: unknown[] = [];
    const view = (sel: string): PresenceView => ({ ...VIEW, sel });
    const data = { privateSession: null, name: null, identity: async () => ({ mode: "declared", name: null, readOnly: { by: "public" } }), presence: async (...a: unknown[]) => void beats.push(a) };
    const people = new People(data as unknown as DataSource, { data: {}, save() {} } as unknown as Store, {
      view: () => view("me"),
      describe: () => "",
      follow: (v) => applied.push(v.sel),
      changed: () => {},
      renamed: () => {},
      unfollowed: () => {},
    });
    await people.init();
    people.start();
    people.connected({ id: "me1", token: "secret", private: false } as unknown as StreamHello);
    people.setPeers([{ id: "b1", name: "Bob", view: view("Bob.place"), idle: false }] as Peer[]);
    const badge = { dataset: { person: "n:Bob" } };
    for (const f of clicks) f({ target: { closest: () => badge }, shiftKey: false });
    assert.deepEqual([people.followedKey, applied], ["n:Bob", ["Bob.place"]]);
    t.mock.timers.tick(60_000);
    assert.deepEqual(beats, [], "nobody is told of a read-only reader");
  } finally {
    dom.restore();
  }
});

test("an agent with a token is one person by its token: another agent giving its name neither leads its followers nor is one of the reader's agents", () => {
  const dom = fakePage();
  try {
    const applied: (string | null)[] = [];
    const view = (sel: string): PresenceView => ({ ...VIEW, sel });
    const people = new People({ privateSession: null, name: null } as unknown as DataSource, { data: {}, save() {} } as unknown as Store, {
      view: () => view("me"),
      describe: () => "",
      follow: (v) => applied.push(v.sel),
      changed: () => {},
      renamed: () => {},
      unfollowed: () => {},
    });
    const talk = { state: "listening" as const, since: "2026-10-18T00:00:00.000Z", doing: null, status: null, read: 0, readPublic: 0, lastSeen: null };
    const token = { id: "tok1", name: "Alice's AI", view: view("Agent.place"), idle: false, agent: true, talk, by: "Alice" } as Peer;
    people.setPeers([token]);
    people.follow(personKey(token));
    assert.deepEqual(applied, ["Agent.place"]);
    // an agent without a token gives the same name (anyone let in can send the headers): the server
    // lists it apart (server/presence.ts), and so does the page
    const other = { id: "hdr1", name: "Alice's AI", view: view("Elsewhere"), idle: false, agent: true } as Peer;
    people.setPeers([other, token]);
    assert.equal(people.people().length, 2);
    assert.deepEqual([people.followedKey, applied], ["a:tok1", ["Agent.place"]], "still following the agent with the token");
    // and it is no channel of Alice's: only an agent with a token has one (web/src/talk.ts)
    assert.deepEqual(ownAgents([other, token], { name: "Alice", person: null }).map((p) => p.id), ["tok1"]);
  } finally {
    dom.restore();
  }
});

test("the asker sees each person's part on their initials and the outcome in a line, for a little while after", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const line = { hidden: true, textContent: "" };
  const of: Record<string, string> = { b1: "n:Bob", b2: "n:Bob", c1: "n:Cy", d1: "n:Dan" };
  let drawn = 0;
  const tally = new AskTally(line as unknown as HTMLElement, { personOf: (id) => of[id] ?? null, changed: () => drawn++ });
  tally.start({ id: "r1", asked: ["b1", "b2", "c1", "d1"], private: 2, ms: ASK_MS });
  assert.equal(line.textContent, "Asked to follow you: 5 waiting");
  assert.equal(tally.stateOf(["b1", "b2"]), "waiting");
  tally.answered({ id: "r1", from: "b1", answer: "follow" });
  assert.equal(tally.stateOf(["b1", "b2"]), "follow", "one of Bob's pages follows: Bob does");
  tally.answered({ id: "r1", from: "c1", answer: "decline" });
  tally.answered({ id: "r1", from: "d1", answer: "following" });
  tally.answered({ id: "r1", from: null, answer: "follow" });
  tally.answered({ id: "other", from: "b2", answer: "decline" });
  assert.equal(line.textContent, "Asked to follow you: 2 following, 1 declined, 1 waiting", "Dan followed already: not asked");
  assert.equal(tally.stateOf(["d1"]), null);
  assert.deepEqual(askMark(tally.stateOf(["c1"]), "Cy"), { cls: "ask-decline", glyph: "✕", tip: "Cy declined to follow you" });
  assert.equal(askMark(tally.stateOf(["zz"]), "Zed"), null, "not asked");
  // the last private reader lets it run out; Bob's other page too: over
  tally.answered({ id: "r1", from: null, answer: "timeout" });
  tally.answered({ id: "r1", from: "b2", answer: "timeout" });
  assert.equal(line.textContent, "Asked to follow you: 2 following, 1 declined, 1 no answer");
  assert.ok(drawn >= 6);
  t.mock.timers.tick(LINGER_MS - 1);
  assert.equal(line.hidden, false);
  t.mock.timers.tick(1);
  assert.equal(line.hidden, true);
  assert.equal(tally.stateOf(["b1"]), null);
  // a request nobody answers is over at its time, and the server's silence counts as none
  tally.start({ id: "r2", asked: ["c1"], private: 0, ms: ASK_MS });
  t.mock.timers.tick(ASK_MS + 4000);
  assert.equal(line.textContent, "Asked to follow you: 1 no answer");
  // a page following already answers the moment it is asked: before this page is told its request
  // went out, and counted all the same
  tally.answered({ id: "r3", from: null, answer: "following" });
  tally.answered({ id: "r3", from: "b1", answer: "decline" });
  tally.start({ id: "r3", asked: ["b1"], private: 1, ms: ASK_MS });
  assert.equal(line.textContent, "Asked to follow you: 1 declined");
  assert.equal(tally.stateOf(["b1"]), "decline");
  // what was said a moment ago, in the line
  tally.say("You asked a moment ago: ask again in 12 s.");
  assert.equal(line.textContent, "You asked a moment ago: ask again in 12 s.");
  t.mock.timers.tick(5000);
  assert.equal(line.textContent, "Asked to follow you: 1 declined");
});

test("a person's part, from their pages' answers, and the outcome in words", () => {
  assert.equal(foldAnswers(["timeout", "follow"]), "follow");
  assert.equal(foldAnswers(["decline", null]), "waiting");
  assert.equal(foldAnswers(["decline", "following"]), "following");
  assert.equal(foldAnswers(["timeout", "decline"]), "decline");
  assert.equal(foldAnswers(["timeout"]), "timeout");
  assert.equal(askLine(["follow", "follow", "decline"]), "2 following, 1 declined");
  assert.equal(askLine(["following"]), null, "followed already: nobody else was asked");
  assert.equal(askLine([]), null);
});

/** An element of the page as the registry reads it (as test/surfaces.test.ts builds one). */
const at = (...chain: string[]): PageEl | null =>
  chain.reduce<PageEl | null>((parentElement, own) => {
    const mine = own.split("|");
    return { matches: (sel: string) => sel.split(",").some((s) => mine.includes(s.trim())), parentElement };
  }, null);

test("the registry: the banner is a surface of the reader's own, whole; so are a person's menu and the outcome's line", () => {
  const y = YOURS.find((x) => x.id === "askBanner");
  assert.ok(y && "where" in y && y.where === "#ask-banner" && "whole" in y && y.whole);
  const people = YOURS.find((x) => x.id === "people")!;
  assert.ok("where" in people && people.where.includes("#peer-menu") && people.where.includes("#ask-line"));
  // nothing done in them ends following: answering, Follow (which follows the asker, apart), the menu
  for (const sel of ["#ask-banner", "#peer-menu", "#ask-line"]) {
    assert.equal(pressActs(at(sel)), false, sel);
    assert.equal(pressActs(at(sel, "button")), false, `a button of ${sel}`);
    assert.equal(keyActs({ key: "Enter" }, at(sel, "button"), false), false, `Enter on a button of ${sel}`);
  }
  // a key typed into a comment while the banner shows is the comment's, as ever
  assert.equal(keyActs({ key: "x" }, at("#panel", "textarea"), true), true);
});
