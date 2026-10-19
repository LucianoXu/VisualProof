// Withdrawing an opinion (ReviewSpec decision 9, the owner's decision of 2026-10-19): a reviewer takes
// back their current opinion on a declaration, approve or comment, stale or not, and has none there
// after — their earlier ones not restored. A withdrawal is a line of their log, never an erasure: the
// opinion and its withdrawal stay in the history, and the timeline says it. Whoever speaks for
// someone (decision 8) may withdraw theirs, recorded as by the typist; an agent withdraws its own
// advice alone; a read-only reader withdraws nothing. Here: the replay (statuses, counts, stale,
// advice), the lines read back, moves, who may withdraw what at the server and through the agents'
// API, the review box's Withdraw, Activity, the lost-and-found and the exported document's authors.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ReviewStore } from "../src/server/review.ts";
import type { AppendResult } from "../src/server/review.ts";
import { reviewTraces } from "../src/shared/doc/authors.ts";
import type { ViewMeta } from "../src/shared/graph.ts";
import { lostEntries } from "../src/shared/lostfound.ts";
import { applyMove } from "../src/shared/moves.ts";
import { advice, adviceOf, applyEvent, current, emptyReview, invalid, judgedOn, logFileName, noChange, progressOf, readEvent, record, replay, reviewFromJson, standing, statusOf } from "../src/shared/review.ts";
import type { Opinion, ReviewData, ReviewEvent, ReviewRequest } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { Activity } from "../src/web/src/activity.ts";
import type { ActivityHooks } from "../src/web/src/activity.ts";
import { ReviewBox } from "../src/web/src/reviewbox.ts";
import type { ReviewHooks } from "../src/web/src/reviewbox.ts";
import type { Store } from "../src/web/src/store.ts";
import { setPeople } from "../src/web/src/verified.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

const at = (k: number) => new Date(Date.UTC(2026, 9, 19, 10, 0, k)).toISOString();
const status = (r: AppendResult) => ("status" in r ? r.status : 200);
const ofDecl = (d: ReviewData, name: string) => (Object.hasOwn(d.opinions, name) ? d.opinions[name] : []);

test("the replay: a withdrawal leaves its author no opinion, their earlier ones not restored; statuses, counts, stale and advice as if none were given; the opinion stays in the history", () => {
  const d = emptyReview();
  const op = (k: number, by: string, name: string, verdict: "approve" | "comment", hash = "h1", more: Partial<Opinion> = {}): ReviewEvent => ({ op: "opinion", at: at(k), by, name, verdict, hash, ...(verdict === "comment" ? { comment: "why?" } : {}), ...more });
  const wd = (k: number, by: string, name: string, more: object = {}): ReviewEvent => ({ op: "withdraw", at: at(k), by, name, ...more });
  // two approvals; Alice withdraws hers: Bob's stands, the declaration approved
  for (const e of [op(1, "Alice", "N.a", "approve"), op(2, "Bob", "N.a", "approve"), wd(3, "Alice", "N.a")]) applyEvent(d, e);
  assert.deepEqual(current(d, "N.a").map((o) => o.by), ["Bob"]);
  assert.equal(statusOf(d, "N.a", "h1"), "approved");
  // the opinion stays, marked, where it was
  assert.deepEqual(ofDecl(d, "N.a").map((o) => [o.by, o.withdrawn ?? null]), [["Alice", { at: at(3) }], ["Bob", null]]);
  // Bob's too: nobody's opinion, not yet reviewed — not stale
  applyEvent(d, wd(4, "Bob", "N.a"));
  assert.equal(statusOf(d, "N.a", "h1"), "none");
  assert.deepEqual(progressOf(d, [{ name: "N.a", module: "M", ext: false, hash: "h1" }]), { total: 1, approved: 0, commented: 0, stale: 0 });
  // a comment, then an approval, withdrawn: no opinion — the comment is not restored
  for (const e of [op(5, "Alice", "N.b", "comment"), op(6, "Alice", "N.b", "approve"), wd(7, "Alice", "N.b")]) applyEvent(d, e);
  assert.equal(statusOf(d, "N.b", "h1"), "none");
  assert.equal(standing(d, "N.b", { by: "Alice" }), null);
  // a comment withdrawn: the approval beside it shows again
  for (const e of [op(8, "Carol", "N.c", "approve"), op(9, "Dan", "N.c", "comment"), wd(10, "Dan", "N.c")]) applyEvent(d, e);
  assert.equal(statusOf(d, "N.c", "h1"), "approved");
  // a stale opinion withdrawn: nothing stale is left
  applyEvent(d, op(11, "Carol", "N.d", "approve", "old"));
  assert.equal(statusOf(d, "N.d", "new"), "stale");
  applyEvent(d, wd(12, "Carol", "N.d"));
  assert.equal(statusOf(d, "N.d", "new"), "none");
  assert.equal(progressOf(d, [{ name: "N.d", module: "M", ext: false, hash: "new" }]).stale, 0);
  // a second withdrawal, or one by someone with no opinion there, does nothing
  const before = JSON.stringify(d);
  applyEvent(d, wd(13, "Carol", "N.d"));
  applyEvent(d, wd(14, "Erin", "N.c"));
  assert.equal(JSON.stringify(d), before);
  // a new opinion after it stands
  applyEvent(d, op(15, "Alice", "N.a", "comment"));
  assert.equal(statusOf(d, "N.a", "h1"), "commented");
  // advice: an agent withdraws its own, a person of its name keeps theirs
  for (const e of [op(16, "Claude", "N.e", "comment", "h1", { agent: true }), op(17, "Claude", "N.e", "approve"), wd(18, "Claude", "N.e", { agent: true })]) applyEvent(d, e);
  assert.equal(adviceOf(d, "N.e", "h1"), null);
  assert.deepEqual(advice(d, "N.e"), []);
  assert.deepEqual(current(d, "N.e").map((o) => [o.by, o.verdict, !!o.agent]), [["Claude", "approve", false]]);
  // the person's withdrawal leaves the advice
  for (const e of [op(19, "Claude", "N.f", "approve", "h1", { agent: true }), op(20, "Claude", "N.f", "approve"), wd(21, "Claude", "N.f")]) applyEvent(d, e);
  assert.equal(adviceOf(d, "N.f", "h1"), "approve");
  assert.equal(statusOf(d, "N.f", "h1"), "none");
  // the same replay from the logs, in any order of files
  const logs = [
    { file: "Alice-1.jsonl", events: [op(1, "Alice", "N.a", "approve"), wd(3, "Alice", "N.a")] },
    { file: "Bob-1.jsonl", events: [op(2, "Bob", "N.a", "approve")] },
  ];
  assert.deepEqual(current(replay(logs), "N.a").map((o) => o.by), ["Bob"]);
  assert.deepEqual(current(replay([...logs].reverse()), "N.a").map((o) => o.by), ["Bob"]);
  // the whole review as JSON carries the mark (a snapshot, GET /api/review)
  const back = reviewFromJson(JSON.parse(JSON.stringify(d)));
  assert.equal(statusOf(back, "N.a", "h1"), "commented");
  assert.deepEqual(ofDecl(back, "N.a")[0].withdrawn, { at: at(3) });
});

test("what an opinion was given on is kept through a withdrawal: the next opinion on the same text records none of its own, and What changed still has it", () => {
  const d = emptyReview();
  record(d, { op: "opinion", name: "N.a", by: "Alice", verdict: "approve", hash: "h1", text: "def a := 0" }, "tc", at(1));
  record(d, { op: "withdraw", name: "N.a", by: "Alice" }, "tc", at(2));
  const e = record(d, { op: "opinion", name: "N.a", by: "Alice", verdict: "approve", hash: "h1", text: "def a := 0" }, "tc", at(3));
  assert.equal((e as { text?: string }).text, undefined, "not repeated");
  const now = current(d, "N.a")[0];
  assert.deepEqual(judgedOn(d, "N.a", now), { of: "source", text: "def a := 0" });
});

test("the requests and the lines: checked as an opinion's, an agent's for no one, a withdrawal for its own writer refused", () => {
  // requests
  assert.equal(invalid({ op: "withdraw", name: "N.a", by: "Alice" }), null);
  assert.equal(invalid({ op: "withdraw", name: "N.a", by: "Alice", for: "Bob" }), null);
  assert.equal(invalid({ op: "withdraw", name: "N.a", by: "Alice", for: "Alice" }), "an opinion of one's own is recorded as one's own");
  assert.equal(invalid({ op: "withdraw", name: "N.a", by: "Claude", agent: true, for: "Bob" }), "an agent records for no one");
  assert.equal(invalid({ op: "withdraw", by: "Alice" }), "name");
  assert.equal(invalid({ op: "target", name: "N.a", by: "Alice", on: true, for: "Bob" }), "only an opinion, or its withdrawal, is recorded for someone else");
  // lines
  const line = { op: "withdraw", at: at(1), by: "Alice", name: "N.a" };
  assert.deepEqual(readEvent(line, false), line);
  assert.deepEqual(readEvent({ ...line, for: "Bob", forPerson: "b0b0b0b0b0" }, false), { ...line, for: "Bob", forPerson: "b0b0b0b0b0" });
  assert.deepEqual(readEvent({ ...line, agent: true }, true), { ...line, agent: true });
  assert.equal(readEvent(line, true), "a line of an agent's log not marked as an agent's");
  assert.equal(readEvent({ ...line, agent: true, for: "Bob" }, true), "an agent's withdrawal for someone else");
  assert.equal(readEvent({ ...line, for: "Alice" }, false), "a withdrawal for its own writer");
  assert.equal(readEvent({ ...line, person: "a0a0a0a0a0", for: "Alice", forPerson: "a0a0a0a0a0" }, false, "a0a0a0a0a0"), "a withdrawal for its own writer");
  assert.equal(readEvent({ ...line, name: "" }, false), "name");
  assert.deepEqual(readEvent({ ...line, person: "a0a0a0a0a0" }, false, "a0a0a0a0a0"), { ...line, person: "a0a0a0a0a0" });
  // nothing standing: nothing to write
  const d = emptyReview();
  assert.equal(noChange(d, { op: "withdraw", name: "N.a", by: "Alice" }), true);
  record(d, { op: "opinion", name: "N.a", by: "Alice", verdict: "approve" }, "tc", at(1));
  assert.equal(noChange(d, { op: "withdraw", name: "N.a", by: "Alice" }), false);
  assert.equal(noChange(d, { op: "withdraw", name: "N.a", by: "Alice", agent: true }), true, "an agent of her name has none");
});

test("a move carries an opinion withdrawn as it is; the un-move takes it back as it was", () => {
  const d = emptyReview();
  record(d, { op: "opinion", name: "N.old", by: "Alice", verdict: "approve" }, "tc", at(1));
  record(d, { op: "withdraw", name: "N.old", by: "Alice" }, "tc", at(2));
  record(d, { op: "opinion", name: "N.old", by: "Bob", verdict: "approve" }, "tc", at(3));
  applyMove(d, { op: "move", at: at(4), by: "Alice", from: "N.old", to: "N.new", on: true });
  assert.deepEqual(current(d, "N.new").map((o) => o.by), ["Bob"]);
  assert.deepEqual(ofDecl(d, "N.new").map((o) => [o.by, !!o.withdrawn, o.was]), [["Alice", true, ["N.old"]], ["Bob", false, ["N.old"]]]);
  applyMove(d, { op: "move", at: at(5), by: "Alice", from: "N.old", to: "N.new", on: false });
  assert.deepEqual(ofDecl(d, "N.old").map((o) => [o.by, !!o.withdrawn]), [["Alice", true], ["Bob", false]]);
  // the lost-and-found lists it, saying it was withdrawn
  const lost = lostEntries(d, [], () => false).filter((e) => e.kind === "opinion");
  assert.deepEqual(lost.map((e) => [e.by, e.withdrawn ?? null]), [["Alice", { at: at(2) }], ["Bob", null]]);
});

test("speaking for someone: the typist withdraws the person's current opinion, a line of the typist's log, recorded as by them, following their renames", () => {
  const root = mkdtempSync(join(tmpdir(), "vp-withdraw-"));
  try {
    const store = new ReviewStore(root, "site");
    const alice = { name: "Alice", agent: false };
    const bob = { name: "Bob", agent: false };
    assert.equal(status(store.append(bob, { op: "opinion", name: "N.a", by: "Bob", verdict: "approve" }, "tc")), 200);
    assert.equal(status(store.append(alice, { op: "withdraw", name: "N.a", by: "Alice", for: "Bob" }, "tc")), 200);
    const line = JSON.parse(readFileSync(join(root, "site", "log", logFileName("Alice", false)), "utf8"));
    assert.deepEqual([line.op, line.by, line.for], ["withdraw", "Alice", "Bob"]);
    assert.deepEqual(current(store.data, "N.a"), []);
    assert.deepEqual(ofDecl(store.data, "N.a")[0].withdrawn!.recordedBy, { by: "Alice" });
    // nothing standing for Bob any more: nothing written
    assert.deepEqual(store.append(alice, { op: "withdraw", name: "N.a", by: "Alice", for: "Bob" }, "tc"), { change: null, unchanged: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // an invited typist, renamed after: "recorded by" follows; an invited person spoken for, by their id
  const d = emptyReview();
  const lines: ReviewEvent[] = [
    { op: "opinion", at: at(1), by: "Carol", person: "c0c0c0c0c0", name: "N.b", verdict: "approve" },
    { op: "withdraw", at: at(2), by: "Dave", person: "d0d0d0d0d0", name: "N.b", for: "Carol", forPerson: "c0c0c0c0c0" },
    { op: "name", at: at(3), by: "David", person: "d0d0d0d0d0" },
  ];
  for (const e of lines) applyEvent(d, e);
  assert.deepEqual(current(d, "N.b"), []);
  assert.deepEqual(ofDecl(d, "N.b")[0].withdrawn, { at: at(2), recordedBy: { by: "David", person: "d0d0d0d0d0" } });
});

test("at the server: one's own current opinion, or that of the person one speaks for; never an agent's advice, nor another's without speaking for them; nothing standing is refused", async () => {
  const S = await site();
  const as = (name: string) => ({ "x-visualproof-name": name });
  const agent = (name: string) => ({ ...as(name), "x-visualproof-kind": "agent" });
  try {
    const give = (who: string, body: Record<string, unknown> = {}) => S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve", ...body }, as(who));
    const take = (who: string, body: Record<string, unknown> = {}, headers: Record<string, string> = as(who)) => S.ask("POST", "/api/review", { op: "withdraw", name: "N.a", ...body }, headers);
    assert.equal((await give("Olivia")).status, 200);
    assert.equal((await give("Bob")).status, 200);
    // one's own: taken back, the answer saying what
    const mine = await take("Olivia");
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    assert.deepEqual([mine.json!.withdrawn.by, mine.json!.withdrawn.verdict], ["Olivia", "approve"]);
    assert.deepEqual(current(S.live.review.data, "N.a").map((o) => o.by), ["Bob"]);
    // again: nothing standing
    const again = await take("Olivia");
    assert.equal(again.status, 409);
    assert.match(again.json!.error, /^You have no opinion on N\.a to withdraw\./);
    // Bob's is not Olivia's to take back, unless she speaks for him
    assert.equal((await take("Carol")).status, 409);
    const forBob = await take("Olivia", { for: "bob" });
    assert.equal(forBob.status, 200, JSON.stringify(forBob.json));
    assert.deepEqual(ofDecl(S.live.review.data, "N.a").find((o) => o.by === "Bob")!.withdrawn!.recordedBy, { by: "Olivia" });
    assert.equal((await take("Olivia", { for: "Bob" })).json!.error, "Bob has no opinion on N.a to withdraw.");
    // an agent's advice: its own alone
    assert.equal((await S.ask("POST", "/api/agent/opinion", { name: "N.a", verdict: "comment", comment: "look" }, agent("Claude"))).status, 200);
    assert.equal((await take("Olivia", { for: "Claude" })).status, 400, "nobody withdraws an agent's advice for it");
    assert.equal((await take("Claude", { for: "Bob" }, agent("Claude"))).status, 403, "an agent withdraws for no one");
    assert.equal((await S.ask("POST", "/api/agent/opinion/withdraw", { name: "N.a", for: "Bob" }, agent("Claude"))).status, 403);
    // an agent named as a person withdraws nothing of theirs
    assert.equal((await give("Zed")).status, 200);
    const zed = await S.ask("POST", "/api/agent/opinion/withdraw", { name: "N.a" }, agent("Zed"));
    assert.equal(zed.status, 409);
    assert.match(zed.json!.error, /You have no advice on N\.a to withdraw/);
    assert.ok(current(S.live.review.data, "N.a").some((o) => o.by === "Zed"));
    // its own: through its API, the answer saying what; then nothing is left
    const own = await S.ask("POST", "/api/agent/opinion/withdraw", { name: "N.a" }, agent("Claude"));
    assert.equal(own.status, 200, JSON.stringify(own.json));
    assert.deepEqual([own.json!.withdrawn.by, own.json!.withdrawn.verdict], ["Claude", "comment"]);
    assert.equal(adviceOf(S.live.review.data, "N.a", "ha"), null);
    assert.equal((await S.ask("POST", "/api/agent/opinion/withdraw", { name: "N.a" }, agent("Claude"))).status, 409);
    // or through the page's door, at advise
    assert.equal((await S.ask("POST", "/api/agent/opinion", { name: "N.a", verdict: "approve" }, agent("Claude"))).status, 200);
    assert.equal((await take("Claude", {}, agent("Claude"))).status, 200);
    // the timeline: each withdrawal, whose it was, and who typed it
    const tl = (await S.ask("GET", "/api/agent/activity?name=N.a", undefined, agent("Claude"))).json!.events as Json[];
    const w = tl.filter((e) => e.kind === "withdrawal").map((e) => [e.by, e.verdict, e.agent, e.recordedBy ?? null]);
    assert.deepEqual(w, [["Olivia", "approve", false, null], ["Bob", "approve", false, "Olivia"], ["Claude", "comment", true, null], ["Claude", "approve", true, null]]);
    assert.ok(tl.filter((e) => e.kind === "opinion" && e.by === "Olivia").every((e) => e.withdrawn === true));
    // the declaration as agents read it: what stands
    const decl = (await S.ask("GET", "/api/agent/declaration?name=N.a", undefined, agent("Claude"))).json!;
    assert.deepEqual((decl.review.opinions as Json[]).map((o) => o.by), ["Zed"]);
    assert.deepEqual(decl.review.advice, []);
  } finally {
    await S.close();
  }
});

test("an agent at level read withdraws nothing; a read-only reader neither", async () => {
  const KEY = "k".repeat(40);
  const S = await site({ key: KEY });
  const owner = { "x-visualproof-name": "Olivia", authorization: `Bearer ${KEY}` };
  try {
    const { token } = S.live.tokens.create({ name: "Reader", by: "Olivia", level: "read", days: 1 });
    const r = await S.ask("POST", "/api/agent/opinion/withdraw", { name: "N.a" }, { authorization: `Bearer ${token}` });
    assert.equal(r.status, 403);
    const link = (await S.ask("POST", "/api/share/readonly", {}, owner)).json!.made.path as string;
    const entered = await fetch(S.base + link, { redirect: "manual" });
    const cookie = entered.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    assert.equal((await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve" }, owner)).status, 200);
    const ro = await S.ask("POST", "/api/review", { op: "withdraw", name: "N.a", for: "Olivia" }, { cookie, "x-visualproof-name": "Mallory" });
    assert.equal(ro.status, 403);
    assert.equal(ro.json!.readOnly, true);
    assert.equal(current(S.live.review.data, "N.a").length, 1);
  } finally {
    await S.close();
  }
});

test("the review box: Withdraw beside the current opinion of whoever it records for; an approval at once, a comment asked about first; the withdrawal in the history", async () => {
  setPeople([]);
  const meta = { nodes: [{ name: "N.a", kind: "def", module: "N", ax: 0, hash: "h" }], projectCount: 1, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: 0 } as unknown as ViewMeta;
  const g = new Graph(meta, new Int32Array(0));
  const d = emptyReview();
  record(d, { op: "opinion", name: "N.a", by: "Olivia", verdict: "approve", hash: "h" }, "tc", at(1));
  record(d, { op: "opinion", name: "N.a", by: "Bob", verdict: "comment", comment: "why 0?", hash: "h" }, "tc", at(2));
  record(d, { op: "opinion", name: "N.a", by: "Claude", verdict: "approve", hash: "h", agent: true }, "tc", at(3));
  const sent: ReviewRequest[] = [];
  const said: string[] = [];
  let readOnly = false;
  const hooks = {
    review: () => ({ data: d, error: null, blocked: null, readOnly, reviewer: "Olivia" }),
    ensureReviewer: async () => "Olivia",
    submit: async (op: ReviewRequest) => (sent.push(op), null),
    said: (t: string) => said.push(t),
    editedNow: () => false,
    edited: async () => false,
    reviewRoot: () => null,
  } as unknown as ReviewHooks;
  const box = new ReviewBox(g, hooks);
  const root = { querySelector: () => null } as unknown as HTMLElement;
  const settle = () => new Promise((ok) => setImmediate(ok));
  /** whose current opinion each shown Withdraw is beside */
  const shown = (html: string) => [...html.matchAll(/<button type="button" class="rv-quote rv-withdraw" data-rv-withdraw data-rv-by="([^"]*)"( hidden)?/g)].filter((m) => !m[2]).map((m) => m[1]);
  const speak = (name: string) => box.input({ value: name, matches: (q: string) => q === "[data-rv-for]" } as unknown as HTMLElement, 0);
  // the reader's own, alone; never beside advice; the panel and a source window alike
  for (const full of [false, true]) assert.deepEqual(shown(box.html(0, full)), ["Olivia"], `full: ${full}`);
  // speaking for Bob: beside his
  speak("bob");
  assert.deepEqual(shown(box.html(0, false)), ["Bob"]);
  // a comment asks first; declined, nothing is sent
  const ask: string[] = [];
  (globalThis as { confirm?: (s: string) => boolean }).confirm = (s: string) => (ask.push(s), false);
  try {
    box.withdraw(0, { by: "Bob" }, root);
    await settle();
    assert.equal(sent.length, 0);
    assert.match(ask[0], /^Withdraw Bob's comment on N\.a\? It stays in the history; Bob will have no opinion on N\.a\.$/);
    (globalThis as { confirm?: (s: string) => boolean }).confirm = (s: string) => (ask.push(s), true);
    box.withdraw(0, { by: "Bob" }, root);
    await settle();
    assert.deepEqual(sent.at(-1), { op: "withdraw", name: "N.a", for: "bob" });
    assert.deepEqual(said.at(-1), "Withdrew Bob's comment on N.a, recorded by you.");
    // an approval: at once, nothing asked
    speak("");
    const asked = ask.length;
    box.withdraw(0, { by: "Olivia" }, root);
    await settle();
    assert.deepEqual(sent.at(-1), { op: "withdraw", name: "N.a" });
    assert.equal(ask.length, asked);
    assert.equal(said.at(-1), "Withdrew your approval of N.a.");
  } finally {
    delete (globalThis as { confirm?: unknown }).confirm;
  }
  // as the server takes it: her opinion withdrawn, the history says so, in time order
  record(d, { op: "withdraw", name: "N.a", by: "Olivia" }, "tc", at(4));
  const html = box.html(0, false);
  assert.deepEqual(shown(html), []);
  const hist = /<details class="rv-hist"><summary>All 2 opinions · 1 withdrawn<\/summary>(.*)<\/details>/.exec(html);
  assert.ok(hist, html);
  const rows = [...hist[1].matchAll(/<div class="rv-op ([^"]*)"[^>]*><span class="rv-dot"><\/span><b>([^<]*)<\/b> ([a-z ]+)/g)].map((m) => `${m[2]} ${m[3].trim()}${m[1].includes("withdrawn") ? " (withdrawn)" : ""}`);
  assert.deepEqual(rows, ["Olivia approved (withdrawn)", "Bob commented", "Olivia withdrew their approval"]);
  // a read-only reader is offered no Withdraw
  readOnly = true;
  record(d, { op: "opinion", name: "N.a", by: "Olivia", verdict: "approve", hash: "h" }, "tc", at(5));
  assert.doesNotMatch(box.html(0, false), /data-rv-withdraw/);
  // nothing standing any more: nothing is sent, the box says so
  readOnly = false;
  const n = sent.length;
  const err = { textContent: "", hidden: true };
  box.withdraw(0, { by: "Erin" }, { querySelector: (s: string) => (s === ".rv-err" ? err : null) } as unknown as HTMLElement);
  assert.equal(sent.length, n);
  assert.equal(err.textContent, "That opinion is no longer the one that stands.");
});

test("Activity: each withdrawal at its time, whose and by whom, leading to the declaration; the opinion before it stays", () => {
  setPeople([]);
  const d = emptyReview();
  record(d, { op: "opinion", name: "N.a", by: "Alice", verdict: "approve" }, "tc", at(1));
  record(d, { op: "withdraw", name: "N.a", by: "Alice" }, "tc", at(2));
  record(d, { op: "opinion", name: "N.a", by: "Bob", verdict: "comment", comment: "hm" }, "tc", at(3));
  record(d, { op: "withdraw", name: "N.a", by: "Carol", for: "Bob" }, "tc", at(4));
  record(d, { op: "opinion", name: "N.a", by: "Claude", verdict: "approve", agent: true }, "tc", at(5));
  record(d, { op: "withdraw", name: "N.a", by: "Claude", agent: true }, "tc", at(6));
  const el = { innerHTML: "", hidden: false, textContent: "", classList: { toggle: () => {} }, addEventListener: () => {} };
  const store = { data: {}, save: () => {} } as unknown as Store;
  const hooks = { me: () => "Zed", review: () => d, has: () => true, hasView: () => false } as unknown as ActivityHooks;
  const act = new Activity(el as unknown as HTMLElement, el as unknown as HTMLElement, el as unknown as HTMLElement, store, hooks);
  const items = act.items().filter((x) => x.key.startsWith("w:"));
  const go = `<button class="act-ref" data-go="N.a" title="N.a">a</button>`;
  assert.deepEqual(
    items.map((x) => [x.at, x.by, x.agent, x.html.replace(/<span class="act-agent">.*?<\/span><\/span>/, "Claude (agent)")]),
    [
      [at(6), "Claude", true, `Claude (agent) withdrew its advice on ${go}`],
      [at(4), "Carol", false, `<b>Carol</b> withdrew <b>Bob</b>'s <span class="commented">comment</span> on ${go}`],
      [at(2), "Alice", false, `<b>Alice</b> withdrew their <span class="ok">approval</span> of ${go}`],
    ],
  );
  assert.equal(act.items().filter((x) => x.key.startsWith("o:")).length, 3, "the opinions stay");
  assert.equal(new Set(act.items().map((x) => x.key)).size, act.items().length, "keys are unique");
});

test("the exported document's author line: an opinion withdrawn is a trace still, as a note deleted is", () => {
  const d = emptyReview();
  record(d, { op: "opinion", name: "N.a", by: "Alice", verdict: "approve" }, "tc", at(1));
  record(d, { op: "withdraw", name: "N.a", by: "Alice" }, "tc", at(2));
  assert.deepEqual(reviewTraces(d, ["N.a"]).map((t) => t.by), ["Alice"]);
});
