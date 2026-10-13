// What an agent may do at level full (AgentSpec decision 9, the owner's, 2026-10-08): whatever a
// person can do through the page — targets, key declarations, trust, views, pins and undo — over
// the agents' API, and through the page's own API where it refused
// agents before; none of it at read or advise. Its opinions stay advice at every level, and agent
// tokens stay with people. Who did it is always recorded: the agent's own log, every line marked,
// replayed as written; the timeline, with the agent's mark.

import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ReviewStore } from "../src/server/review.ts";
import { mcpInstructions, routes, utc } from "../src/server/mcptools.ts";
import { logFileName, statusOf } from "../src/shared/review.ts";
import type { ReviewData } from "../src/shared/review.ts";
import type { StoredEvent } from "../src/shared/timeline.ts";
import { Activity } from "../src/web/src/activity.ts";
import type { ActivityHooks } from "../src/web/src/activity.ts";
import type { Store } from "../src/web/src/store.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

const ALICE = { "x-visualproof-name": "Alice" };
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
/** an agent without a token, as the page's API meets one: its headers say who and what it is */
const HEADER_AGENT = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };

/** Every operation newly open at full, as a request over the agents' API, in an order in which each
 *  can succeed: N.b (whose statement uses N.a) becomes a target, N.a key for it, and so on. */
function operations(view: () => string): [string, string, () => Json][] {
  return [
    ["mark a target", "/api/agent/target", () => ({ name: "N.b" })],
    ["mark a key declaration", "/api/agent/key", () => ({ target: "N.b", name: "N.a" })],
    ["trust a prefix", "/api/agent/trust", () => ({ prefix: "@external" })],
    ["create a view", "/api/agent/views/create", () => ({ name: "Agent's board", scope: "ns(N)" })],
    ["rename a view", "/api/agent/views/rename", () => ({ id: view(), name: "Renamed by the agent" })],
    ["rescope a view", "/api/agent/views/scope", () => ({ id: view(), scope: "decl(N.a, N.b)" })],
    ["arrange a view (fold, clustering)", "/api/agent/views/arrange", () => ({ id: view(), clustering: "module" })],
    ["duplicate a view", "/api/agent/views/duplicate", () => ({ id: view() })],
    ["lay a view out afresh", "/api/agent/views/relayout", () => ({ id: view() })],
    ["drop a pin", "/api/agent/pins", () => ({ pins: [{ name: "N.a", at: [3, 4] }] })],
    ["untrust a prefix", "/api/agent/trust", () => ({ prefix: "@external", on: false })],
    ["unmark a key declaration", "/api/agent/key", () => ({ target: "N.b", name: "N.a", on: false })],
    ["delete a view", "/api/agent/views/delete", () => ({ id: view() })],
    ["take a target off", "/api/agent/target", () => ({ name: "N.b", on: false })],
  ];
}

test("at level full an agent does over its API what a person does in the page; at read and advise, none of it", async () => {
  const S = await site();
  try {
    const tokens = Object.fromEntries(
      (["read", "advise", "full"] as const).map((level) => [level, S.live.tokens.create({ name: `Alice's AI ${level}`, by: "Alice", level, days: 1 }).token]),
    );
    let view = "";
    for (const [what, path, params] of operations(() => view)) {
      for (const level of ["read", "advise"] as const) {
        const no = await S.ask("POST", path, params(), bearer(tokens[level]));
        assert.equal(no.status, 403, `${what} at ${level}`);
        assert.match(no.json!.error, new RegExp(`Your token lets you ${level === "read" ? "only read" : "give advice"}`), what);
        assert.match(no.json!.hint, /level full/, what);
      }
      const r = await S.ask("POST", path, params(), bearer(tokens.full));
      assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.json)}`);
      if (path === "/api/agent/views/create") view = r.json!.view.id;
    }
    // what each did, as the review and the views hold it now: the target taken off at the end
    const d = S.live.review.data;
    assert.equal(Object.hasOwn(d.targets, "N.b"), false);
    assert.ok(!d.trusted.includes("@external"));
    assert.equal(S.live.views.book.get(view), undefined, "deleted");
    assert.ok(S.live.views.book.list().some((v) => v.name === "Renamed by the agent (copy)"), "the duplicate keeps its name");
    // the undo of a layout batch
    const pins = await S.ask("POST", "/api/agent/pins", { pins: [{ name: "N.b", at: [5, 6] }] }, bearer(tokens.full));
    for (const level of ["read", "advise"] as const) assert.equal((await S.ask("POST", "/api/agent/undo", { id: pins.json!.id }, bearer(tokens[level]))).status, 403);
    assert.equal((await S.ask("POST", "/api/agent/undo", { id: pins.json!.id }, bearer(tokens.full))).status, 200);

    // what each level is told it may do, and the MCP server's tools for each
    const may = async (level: string) => (await S.ask("GET", "/api/agent", undefined, bearer(tokens[level]))).json!.you.may;
    assert.deepEqual(await may("read"), { read: true, advise: false, full: false });
    assert.deepEqual(await may("advise"), { read: true, advise: true, full: false });
    assert.deepEqual(await may("full"), { read: true, advise: true, full: true });
    // each tool and action as `tool` or `tool.action`
    const tools = async (level: string) =>
      ((await S.ask("GET", "/api/agent/mcp/tools", undefined, bearer(tokens[level]))).json!.tools as Json[]).flatMap((t) => (t.inputSchema.properties.action ? (t.inputSchema.properties.action.enum as string[]).map((a) => `${t.name}.${a}`) : [t.name]));
    const fullTools = ["mark.target", "mark.key", "trust", "views.create", "views.duplicate", "views.rename", "views.delete", "views.scope", "views.items", "views.focus", "views.link", "views.arrange", "views.relayout", "pins.pin", "pins.undo", "history.attach", "history.unmove", "history.archive"];
    for (const t of fullTools) assert.ok((await tools("full")).includes(t), t);
    for (const level of ["read", "advise"]) assert.deepEqual((await tools(level)).filter((t) => fullTools.includes(t)), [], level);
    // explanations (removed 2026-10-08) and checkpoints (removed 2026-10-09): no tool and no
    // endpoint at any level
    for (const level of ["read", "advise", "full"]) for (const gone of ["explain", "checkpoint"]) assert.ok(!(await tools(level)).includes(gone), `${gone} at ${level}`);
    assert.equal((await S.ask("POST", "/api/agent/explain", { name: "N.a", text: "x" }, bearer(tokens.full))).status, 404);
    assert.equal((await S.ask("POST", "/api/agent/checkpoint", { name: "N.b" }, bearer(tokens.full))).status, 404);
    // the instructions say where the agent is, who it is there and until when, within the 2,048
    // characters Claude Code keeps
    const offer = (await S.ask("GET", "/api/agent/mcp/tools", undefined, bearer(tokens.full))).json!;
    assert.ok(offer.instructions.includes(`here fixture, at ${S.base}.`), offer.instructions);
    assert.ok(offer.instructions.includes(`You are "Alice's AI full", an AI agent invited by Alice (level full); your token expires ${utc(offer.you.expires)}`), offer.instructions);
    assert.ok(offer.instructions.length <= 2048, String(offer.instructions.length));
    // and that the first wait after it joins may bring earlier messages (the owner's decision of
    // 2026-10-11), at every level, still within 2,048 for the longest names and a long address
    assert.ok(offer.instructions.includes("The first wait after you join may bring earlier messages; read them as context and do not answer them again."), offer.instructions);
    for (const level of ["read", "advise", "full"]) {
      const longest = mcpInstructions({ name: "N".repeat(60), by: "B".repeat(60), level, expires: offer.you.expires, address: "https://visualproof.example.org:4173", project: "flt_regular" });
      assert.ok(longest.includes("The first wait after you join may bring earlier messages"), level);
      assert.ok(longest.length <= 2048, `${level}: ${longest.length}`);
    }
    // every tool's request is an endpoint of the reference, which says what it needs
    const listed = (await S.ask("GET", "/api/agent/endpoints", undefined, bearer(tokens.full))).json!.endpoints as Json[];
    for (const r of routes()) assert.ok(listed.some((e) => e.method === r.route.method && e.path === r.route.path), `${r.tool} ${r.action ?? ""}`);
    for (const path of ["/api/agent/target", "/api/agent/key", "/api/agent/trust", "/api/agent/views/delete", "/api/agent/views/relayout", "/api/agent/views/rename", "/api/agent/views/duplicate"])
      assert.equal(listed.find((e) => e.path === path && e.method === "POST")?.needs, "--agents full", path);
  } finally {
    await S.close();
  }
});

test("level full: names are resolved as everywhere in the API, and refusals say what to do", async () => {
  const S = await site();
  try {
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "full", days: 1 });
    const ask = (path: string, body: Json) => S.ask("POST", path, body, bearer(token));
    const miss = await ask("/api/agent/target", { name: "N.bb" });
    assert.equal(miss.status, 404);
    assert.ok(miss.json!.didYouMean.includes("N.b"));
    assert.equal((await ask("/api/agent/target", { name: "Nat" })).status, 404, "a target is of the project");
    const notYet = await ask("/api/agent/key", { target: "N.b", name: "N.a" });
    assert.equal(notYet.status, 409);
    assert.match(notYet.json!.hint, /POST \/api\/agent\/target/);
    const marked = await ask("/api/agent/target", { name: "N.b" });
    // marked: no view comes with it (the owner's decision of 2026-10-12)
    assert.deepEqual([marked.json!.changed, marked.json!.view, marked.json!.recorded.agent], [true, null, true]);
    assert.equal((await ask("/api/agent/target", { name: "N.b" })).json!.changed, false, "marked already: nothing appended");
    // several key declarations at once, each answered on its own; a target is always key for itself
    const keys = await ask("/api/agent/key", { target: "N.b", names: ["N.a", "N.b", "N.zz"] });
    assert.equal(keys.status, 200);
    assert.deepEqual(keys.json!.results.map((r: Json) => r.status), [200, 400, 404]);
    assert.deepEqual([keys.json!.changed, keys.json!.refused], [1, 2]);
    assert.equal((await ask("/api/agent/trust", { prefix: "not a prefix!" })).status, 400);
    const trusted = await ask("/api/agent/trust", { prefix: "N" });
    assert.deepEqual(trusted.json!.covers, { project: 2, outside: 0 });
    assert.ok(trusted.json!.trusted.includes("N"));
    // the event written is the answer's, whole
    assert.deepEqual(Object.keys(trusted.json!.recorded).sort(), ["agent", "at", "by", "on", "op", "prefix"]);
    // what the agent is shown doing, in words, for the people talking to it
    const doing = () => S.live.talk.talk(S.live.tokens.inForce().find((t) => t.name === "Bot")!.id).doing ?? "";
    assert.match(doing(), /trusting N/);
    assert.equal((await ask("/api/agent/views/delete", { id: "project" })).status, 400, "the Project stays");
    // a target's view is deleted as any view is, and its target has no view after (the owner's
    // decision of 2026-10-11)
    const its = (await ask("/api/agent/views/create", { name: "N.b closely", scope: "tcb(N.b)" })).json!.view.id as string;
    assert.equal((await ask("/api/agent/views/link", { id: its, target: "N.b" })).status, 200);
    const gone = await ask("/api/agent/views/delete", { id: its });
    assert.deepEqual([gone.status, gone.json!.unlinked], [200, ["N.b"]]);
    assert.equal((await ask("/api/agent/views/rename", { id: "project", name: "x" })).status, 400);
    assert.equal(doing(), "renaming a view");
  } finally {
    await S.close();
  }
});

test("the page's API takes a full agent where it refused agents, records it as the agent's, and refuses it below full", async () => {
  const S = await site();
  const A = await site({ agents: "advise" });
  try {
    const post = (s: typeof S, body: Json, headers: Record<string, string> = HEADER_AGENT) => s.ask("POST", "/api/review", body, headers);
    for (const body of [{ op: "target", name: "N.b", on: true }, { op: "key", target: "N.b", name: "N.a", on: true }, { op: "trust", prefix: "Std", on: false }]) {
      const r = await post(S, body);
      assert.equal(r.status, 200, `${body.op}: ${JSON.stringify(r.json)}`);
      assert.equal(r.json!.event.agent, true, body.op);
      assert.equal(r.json!.event.by, "Claude");
      const no = await post(A, body);
      assert.equal(no.status, 403, `${body.op} at advise`);
      assert.match(no.json!.hint, /--agents full/);
    }
    // an opinion is advice through this door too, at advise and at full
    for (const s of [S, A]) {
      const r = await post(s, { op: "opinion", name: "N.a", verdict: "approve", comment: "fine" });
      assert.equal(r.status, 200);
      assert.equal(r.json!.event.agent, true);
      assert.equal(statusOf(s.live.review.data, "N.a", "ha"), "none", "advice is never counted");
    }
    assert.equal((await post(S, { op: "target", name: "N.b", on: true }, { "x-visualproof-kind": "agent" })).status, 401, "a name first");
    // an explanation (removed 2026-10-08) and a checkpoint (removed 2026-10-09) are no longer
    // something the review records
    assert.equal((await post(S, { op: "explain", name: "N.a", text: "x" })).status, 400);
    assert.equal((await post(S, { op: "checkpoint", name: "N.b" })).status, 400);
    // all of it in the agent's own log, under its name, none in a person's of the same name
    const log = join(S.dir, "review", "log");
    const lines = readFileSync(join(log, logFileName("Claude", true)), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((e) => e.op), ["target", "key", "trust", "opinion"]);
    assert.ok(lines.every((e) => e.agent === true && e.by === "Claude"));
    assert.throws(() => readFileSync(join(log, logFileName("Claude", false))));
    // views: deleting and laying out afresh, refused to agents before
    const made = await S.ask("POST", "/api/views/create", { name: "Board" }, HEADER_AGENT);
    const id = made.json!.view.id;
    assert.equal((await S.ask("POST", "/api/views/relayout", { id }, HEADER_AGENT)).status, 200);
    assert.equal((await S.ask("POST", "/api/views/delete", { id }, HEADER_AGENT)).status, 200);
    const madeA = await A.ask("POST", "/api/views/create", { name: "Board" }, ALICE);
    for (const path of ["/api/views/relayout", "/api/views/delete"]) assert.equal((await A.ask("POST", path, { id: madeA.json!.view.id }, HEADER_AGENT)).status, 403, path);
    // a person through the same door is a person, as before
    const p = await post(S, { op: "target", name: "N.a", on: true }, ALICE);
    assert.equal(p.json!.event.agent, undefined);
  } finally {
    await S.close();
    await A.close();
  }
});

test("an agent's events are its own log's, every line marked, and replayed as written whatever the level now", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-aifull-"));
  try {
    const store = new ReviewStore(dir, "review");
    const claude = { name: "Claude", agent: true };
    const ok = (r: ReturnType<ReviewStore["append"]>) => assert.ok(!("status" in r), JSON.stringify(r));
    ok(store.append(claude, { op: "target", name: "T", by: "Claude", on: true, agent: true }, "tc"));
    ok(store.append(claude, { op: "key", target: "T", name: "G", by: "Claude", on: true, agent: true }, "tc"));
    ok(store.append(claude, { op: "trust", prefix: "Std", by: "Claude", on: false, agent: true }, "tc"));
    // the writer's kind and the event's must agree, for every event
    assert.equal((store.append(claude, { op: "target", name: "U", by: "Claude", on: true }, "tc") as { status: number }).status, 400);
    assert.equal((store.append({ name: "Claude", agent: false }, { op: "target", name: "U", by: "Claude", on: true, agent: true }, "tc") as { status: number }).status, 400);
    const file = join(dir, "review", "log", logFileName("Claude", true));
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    assert.ok(lines.every((e) => e.agent === true));
    // read back afresh (a pull, another server): the same review, each thing marked as the agent's
    const check = (d: ReviewData) => {
      assert.deepEqual([d.targets.T.by, d.targets.T.agent], ["Claude", true]);
      assert.deepEqual(d.keys.T.G, { by: "Claude", at: d.keys.T.G.at, agent: true });
      assert.ok(!d.trusted.includes("Std"));
    };
    check(store.data);
    check(new ReviewStore(dir, "review").data);
    // what git brings, written elsewhere: replayed as written (the level was checked when it was)
    mkdirSync(join(dir, "review", "log"), { recursive: true });
    appendFileSync(join(dir, "review", "log", logFileName("Other AI", true)), JSON.stringify({ op: "target", at: "2026-10-08T12:00:00.000Z", by: "Other AI", name: "V", on: true, agent: true }) + "\n");
    // a line of an agent's log not marked as an agent's is not read: it would pass for a person's
    appendFileSync(join(dir, "review", "log", logFileName("Odd AI", true)), JSON.stringify({ op: "target", at: "2026-10-08T12:00:01.000Z", by: "Odd AI", name: "W", on: true }) + "\n");
    const again = new ReviewStore(dir, "review");
    assert.deepEqual([again.data.targets.V?.by, again.data.targets.V?.agent], ["Other AI", true]);
    assert.equal(again.data.targets.W, undefined);
    assert.match(again.problems[0].why, /not marked as an agent's/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an agent's opinions stay advice at level full, through either door", async () => {
  const S = await site();
  try {
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "full", days: 1 });
    await S.ask("POST", "/api/agent/target", { name: "N.b" }, bearer(token));
    const r = await S.ask("POST", "/api/agent/opinion", { name: "N.a", verdict: "approve", comment: "says what it should" }, bearer(token));
    assert.equal(r.status, 200);
    assert.equal(r.json!.counted, false);
    const d = S.live.review.data;
    assert.equal(statusOf(d, "N.a", "ha"), "none");
    const t = (await S.ask("GET", "/api/agent/targets", undefined, bearer(token))).json!.targets[0];
    assert.deepEqual([t.name, t.markedBy, t.markedByAgent, t.counts.approved, t.counts.advised], ["N.b", "Bot", true, 0, 1]);
    // the index says so to an agent at full
    const rules = (await S.ask("GET", "/api/agent", undefined, bearer(token))).json!.rules.join("\n");
    assert.match(rules, /Your opinions stay advice at every level/);
  } finally {
    await S.close();
  }
});

test("agent tokens stay with people: refused to agents at every level, by either door", async () => {
  for (const level of ["read", "advise", "full"] as const) {
    const S = await site({ agents: level });
    try {
      const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level, days: 1 });
      const made = await S.ask("POST", "/api/share/agents", {}, ALICE);
      const id = made.json!.token.id;
      for (const [method, path, body] of [["GET", "/api/share/agents", undefined], ["POST", "/api/share/agents", {}], ["POST", "/api/share/agents/prompt", { id }], ["POST", "/api/share/agents/revoke", { id }]] as const) {
        // an agent that says it is one
        const h = await S.ask(method, path, body, { ...HEADER_AGENT });
        assert.equal(h.status, 403, `${method} ${path} at ${level}, by headers`);
        assert.match(h.json!.error, /for people/);
        // a token reaches the agents' API alone
        assert.equal((await S.ask(method, path, body, bearer(token))).status, 404, `${method} ${path} at ${level}, by token`);
      }
      assert.ok(S.live.tokens.inForce().some((t) => t.id === id), "nothing revoked");
      // and the agents' API has no endpoint for tokens
      const listed = (await S.ask("GET", "/api/agent/endpoints", undefined, bearer(token))).json!.endpoints as Json[];
      assert.ok(!listed.some((e) => /token|share/.test(e.path)), level);
      assert.equal((await S.ask("GET", "/api/agent/tokens", undefined, bearer(token))).status, 404);
    } finally {
      await S.close();
    }
  }
});

test("the timeline marks what an agent did as an agent's: the agents' activity and the page's drawer", async () => {
  const S = await site();
  try {
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "full", days: 1 });
    const ask = (path: string, body: Json) => S.ask("POST", path, body, bearer(token));
    await ask("/api/agent/target", { name: "N.b" });
    await ask("/api/agent/key", { target: "N.b", name: "N.a" });
    await ask("/api/agent/trust", { prefix: "@external" });
    await ask("/api/agent/trust", { prefix: "@external", on: false });
    const view = (await ask("/api/agent/views/create", { name: "Mine" })).json!.view.id;
    await ask("/api/agent/views/relayout", { id: view });
    await ask("/api/agent/views/delete", { id: view });
    await ask("/api/agent/target", { name: "N.a" });
    await ask("/api/agent/target", { name: "N.a", on: false });
    // an explanation and a checkpoint from before the owner removed them (2026-10-08, 2026-10-09),
    // left in the agent's log: in neither timeline, and not a problem
    const old = (e: object) => JSON.stringify({ at: new Date().toISOString(), by: "Bot", agent: true, ...e }) + "\n";
    appendFileSync(join(S.dir, "review", "log", logFileName("Bot", true)), old({ op: "explain", name: "N.a", text: "The base." }) + old({ op: "checkpoint", name: "N.b", tcb: { "N.a": "ha" } }));
    S.live.review.refresh();
    assert.deepEqual(S.live.review.problems, []);
    // the agents' activity
    const events = (await S.ask("GET", "/api/agent/activity", undefined, bearer(token))).json!.events as Json[];
    assert.ok(!events.some((e) => e.kind === "explain" || e.kind === "checkpoint" || e.text === "The base."));
    const by = (kind: string) => events.filter((e) => e.kind === kind);
    for (const kind of ["target", "key", "trust", "untrust", "untarget", "view"]) {
      assert.ok(by(kind).length, kind);
      assert.ok(by(kind).every((e) => e.by === "Bot" && e.agent === true), kind);
    }
    // the page's drawer, as it reads the review and what the server stored: every item the agent's,
    // with its mark
    const el = () => ({ addEventListener() {}, classList: { toggle() {} }, hidden: false, textContent: "", innerHTML: "" });
    const store = { data: {} as Record<string, unknown>, save() {} } as unknown as Store;
    const hooks = {
      me: () => "Alice",
      review: () => S.live.review.data,
      mine: () => ({ targets: new Set<string>(), names: new Set<string>(), modules: new Set<string>() }),
      touching: () => [],
      covering: () => [],
      has: () => true,
      hasView: () => false,
    } as unknown as ActivityHooks;
    const act = new Activity(el() as unknown as HTMLElement, el() as unknown as HTMLElement, el() as unknown as HTMLElement, store, hooks);
    act.load(S.live.timeline.events as StoredEvent[]);
    const items = act.items();
    for (const words of ["made", "marked", "trusted", "stopped trusting", "took", "saved the view", "laid", "deleted the view"]) {
      const it = items.find((x) => x.html.includes(words));
      assert.ok(it, words);
      assert.equal(it.agent, true, words);
      assert.match(it.html, /class="act-agent"/, words);
      assert.match(it.html, /\(agent\)/, words);
    }
    assert.ok(!items.some((x) => /explain|The base\.|checkpoint/.test(x.html)));
  } finally {
    await S.close();
  }
});

test("approve or comment over both APIs (2026-10-09): dispute refused with the new name; the index, the MCP tools, the docs and both timelines say comment", async () => {
  const S = await site();
  try {
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "advise", days: 1 });
    // the old word, refused with the new one by the page's API and the agents', one by one or in a
    // batch, and nothing recorded
    const page = await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "dispute", comment: "a should be 1" }, ALICE);
    assert.equal(page.status, 400);
    assert.match(page.json!.hint, /use comment/i);
    const one = await S.ask("POST", "/api/agent/opinion", { name: "N.a", verdict: "dispute", comment: "a should be 1" }, bearer(token));
    assert.equal(one.status, 400);
    assert.match(one.json!.hint, /use comment/i);
    const batch = (await S.ask("POST", "/api/agent/opinions", { opinions: [{ name: "N.a", verdict: "dispute", comment: "a should be 1" }, { name: "N.b", verdict: "comment", comment: "Is b twice a?" }] }, bearer(token))).json!;
    assert.deepEqual(batch.results.map((r: Json) => r.status), [400, 200]);
    assert.match(batch.results[0].hint, /use comment/i);
    assert.ok(!Object.hasOwn(S.live.review.data.opinions, "N.a"));
    // a person's comment, and what the agents' API says of it
    assert.equal((await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "comment", comment: "Should a be 1?" }, ALICE)).status, 200);
    const a = (await S.ask("GET", "/api/agent/declaration?name=N.a", undefined, bearer(token))).json!;
    assert.equal(a.review.status, "commented");
    assert.equal((await S.ask("GET", "/api/agent/declaration?name=N.b", undefined, bearer(token))).json!.review.advice[0].verdict, "comment");
    // the agents' activity: both opinions, as comments
    const events = (await S.ask("GET", "/api/agent/activity", undefined, bearer(token))).json!.events as Json[];
    assert.deepEqual(events.filter((e) => e.kind === "opinion").map((e) => [e.by, e.agent, e.name, e.verdict]).sort(), [["Alice", false, "N.a", "comment"], ["Bot", true, "N.b", "comment"]]);
    // the index, the MCP server's tools (made from it) and the documentation: comment, never dispute
    const index = (await S.ask("GET", "/api/agent", undefined, bearer(token))).json!;
    const tools = (await S.ask("GET", "/api/agent/mcp/tools", undefined, bearer(token))).json!.tools as Json[];
    const opinion = tools.find((t) => t.name === "opinion")!;
    assert.deepEqual(opinion.inputSchema.properties.verdict.enum, ["approve", "comment"]);
    assert.match(opinion.description, /approve, or comment/);
    const dir = join(import.meta.dirname, "..", "docs", "agent-api");
    const docs = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    for (const [what, text] of Object.entries({ index: JSON.stringify(index), tools: JSON.stringify(tools), docs })) assert.doesNotMatch(text, /disput/i, what);
    // the page's drawer: a person commented on it, an agent comments on it
    const el = () => ({ addEventListener() {}, classList: { toggle() {} }, hidden: false, textContent: "", innerHTML: "" });
    const store = { data: {} as Record<string, unknown>, save() {} } as unknown as Store;
    const hooks = {
      me: () => "Alice",
      review: () => S.live.review.data,
      mine: () => ({ targets: new Set<string>(), names: new Set<string>(), modules: new Set<string>() }),
      touching: () => [],
      covering: () => [],
      has: () => true,
      hasView: () => false,
    } as unknown as ActivityHooks;
    const act = new Activity(el() as unknown as HTMLElement, el() as unknown as HTMLElement, el() as unknown as HTMLElement, store, hooks);
    act.load(S.live.timeline.events as StoredEvent[]);
    // an opinion's comment is rendered as the drawer is drawn: what it says is beside the event
    const said = act.items().filter((x) => x.cat === "review").map((x) => x.html + (x.comment ? ` ${x.comment.text}` : ""));
    assert.ok(said.some((h) => /Alice.*<span class="commented">commented<\/span> on .*Should a be 1\?/s.test(h)), "a person's comment");
    assert.ok(said.some((h) => /Bot.*<span class="commented">comments<\/span> on .*Is b twice a\?/s.test(h)), "an agent's");
    assert.ok(!said.some((h) => /disput|class="bad"/i.test(h)));
  } finally {
    await S.close();
  }
});
