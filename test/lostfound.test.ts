// The lost-and-found (HistorySpec decisions 12–14): its entries, computed from the review and the
// views against the graph on show and keyed by what and where (shared/lostfound.ts), grouped by
// name with the last build that had it and the suggestions for it, what could not be read set
// aside (server/lostfound.ts); the archive, whose last line of a key is its state; the newest build
// that had a name (server/history.ts, `lastHad`); and all of it through the page's and the agents'
// API — Attach to… and its Undo, archiving and putting back, under who asks.

import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { History } from "../src/server/history.ts";
import { Archive, archiveKeys, lostAndFound } from "../src/server/lostfound.ts";
import type { LostWorld } from "../src/server/lostfound.ts";
import { opinionRef } from "../src/shared/comment.ts";
import type { RawGraph, RawNode } from "../src/shared/graph.ts";
import { lostEntries, lostKey } from "../src/shared/lostfound.ts";
import type { LastHad, LostMigration } from "../src/shared/lostfound.ts";
import { emptyLayouts } from "../src/shared/places.ts";
import { logFileName, replay } from "../src/shared/review.ts";
import type { ReviewEvent } from "../src/shared/review.ts";
import type { ViewData } from "../src/shared/views.ts";
import { site, stream } from "./site.ts";
import type { Json } from "./site.ts";

const at = (m: number) => new Date(Date.UTC(2026, 9, 9, 10, m)).toISOString();
const CAROL = "0123456789";

/** A review that says things of names the graph has (A.here, A.top, A.now) and of names it no longer
 *  has: A.gone (opinions by a person, an agent and someone invited by a personal link who renamed
 *  themselves since; a target mark; a key mark as a member), T.old (a target gone, with its own key
 *  mark), and A.was, renamed A.now by a move. */
function review() {
  const events: ReviewEvent[] = [
    { op: "opinion", at: at(1), by: "Alice", name: "A.gone", verdict: "comment", comment: "why `A.gone`?" },
    { op: "opinion", at: at(2), by: "Bot", name: "A.gone", verdict: "approve", agent: true },
    { op: "opinion", at: at(3), by: "Carol", person: CAROL, name: "A.gone", verdict: "approve" },
    { op: "name", at: at(4), by: "Caroline", person: CAROL },
    { op: "opinion", at: at(5), by: "Alice", name: "A.here", verdict: "approve" },
    { op: "target", at: at(6), by: "Alice", name: "A.gone", on: true },
    { op: "target", at: at(7), by: "Alice", name: "A.top", on: true },
    { op: "key", at: at(8), by: "Alice", target: "A.top", name: "A.gone", on: true },
    { op: "key", at: at(9), by: "Bob", target: "T.old", name: "A.here", on: true },
    { op: "opinion", at: at(10), by: "Alice", name: "A.was", verdict: "approve" },
    { op: "move", at: at(11), by: "VisualProof", from: "A.was", to: "A.now", on: true, rename: true, auto: "same version" },
  ];
  return replay([{ file: "x.jsonl", events }]);
}

/** The Project view: pins of a name gone and of one there, under both clusterings, and a note naming
 *  a gone declaration, one renamed since, one there, some code and a name that never was one. */
function project(): ViewData {
  const pins = emptyLayouts();
  pins.namespace.nodes = { "A.gone": [1, 2], "A.here": [3, 4] };
  pins.module.nodes = { "A.gone": [0, 0] };
  const place = { mode: "namespace" as const, in: [] as [string, number, number][], world: [0, 0] as [number, number] };
  return {
    id: "project", name: null, scope: { op: "all" }, clustering: "namespace", pins, folds: { namespace: [], module: [] }, hidden: { namespace: [], module: [] },
    notes: [{ id: "n1", text: "see `A.gone`, `A.was`, `A.here`, `x + y`, `Nat.succ`", place, open: true, by: "Dan", at: at(12) }],
    by: null, at: at(0), kept: true,
  };
}

const HAS = new Set(["A.here", "A.top", "A.now"]);
const LAST: Record<string, LastHad> = {
  "A.gone": { name: "A.gone", snapshot: 2, at: at(20), commit: { hash: "abc1234def", branch: "main" }, module: "A" },
  "T.old": { name: "T.old", snapshot: 1, at: at(10), commit: null, module: "T" },
  "A.was": { name: "A.was", snapshot: 1, at: at(10), commit: null, module: "A" },
};

test("the entries: what is said of a name the graph no longer has, keyed by what it is and where", () => {
  const d = review();
  const es = lostEntries(d, [project()], (n) => HAS.has(n), (n) => n in LAST, (view, mode, name) => (name === "A.gone" && mode === "namespace" ? { by: "Erin", at: at(13) } : null));
  assert.deepEqual(es.map((e) => [e.key, e.kind, e.name, e.by]), [
    ["target:A.gone", "target", "A.gone", "Alice"],
    ["key:A.top#A.gone", "key", "A.gone", "Alice"],
    [opinionRef("A.gone", "Alice", at(1)), "opinion", "A.gone", "Alice"],
    [opinionRef("A.gone", "Bot", at(2)), "opinion", "A.gone", "Bot"],
    [opinionRef("A.gone", "Caroline", at(3)), "opinion", "A.gone", "Caroline"],
    ["note:project:n1:A.gone", "note", "A.gone", "Dan"],
    ["pin:project:module:A.gone", "pin", "A.gone", null],
    ["pin:project:namespace:A.gone", "pin", "A.gone", "Erin"],
    ["key:T.old#A.here", "key", "T.old", "Bob"],
  ]);
  const byKey = new Map(es.map((e) => [e.key, e]));
  // an opinion's key is the reference a comment quotes it by; its comment comes with it
  assert.equal(byKey.get(opinionRef("A.gone", "Alice", at(1)))!.key, "opinion:A.gone#Alice@2026-10-09T10:01:00.000Z");
  assert.equal(byKey.get(opinionRef("A.gone", "Alice", at(1)))!.comment, "why `A.gone`?");
  assert.equal(byKey.get(opinionRef("A.gone", "Bot", at(2)))!.agent, true);
  // someone invited by a personal link: under the name they go by now, their link with it, and the
  // key under the name they went by before
  const carol = byKey.get(opinionRef("A.gone", "Caroline", at(3)))!;
  assert.deepEqual([carol.person, carol.aliases], [CAROL, [opinionRef("A.gone", "Carol", at(3))]]);
  assert.deepEqual([byKey.get("key:T.old#A.here")!.target, byKey.get("key:T.old#A.here")!.member], ["T.old", "A.here"]);
  assert.equal(byKey.get("note:project:n1:A.gone")!.text, project().notes![0].text);
  // the keys as the shared builders write them
  assert.equal(lostKey.pin("review:A.top", "module", "A.x"), "pin:review:A.top:module:A.x");
  assert.equal(lostKey.note("v1", "n2", "A.x"), "note:v1:n2:A.x");
  assert.equal(lostKey.move("m3"), "move:m3");
  // nothing is lost where the graph has everything
  assert.deepEqual(lostEntries(d, [project()], () => true), []);
  // a view kept at a past build that had A.gone: its pins and its note's mention of it are that
  // board's, not lost (the owner's decision of 2026-10-10: a past view is arranged as any)
  const past = { ...project(), id: "v-then", version: 2 };
  const kept = lostEntries(d, [past], (n) => HAS.has(n), (n) => n in LAST, () => null, undefined, (v, name) => v.version === 2 && name === "A.gone");
  assert.deepEqual(kept.filter((e) => e.view === "v-then"), []);
  assert.equal(lostEntries(d, [past], (n) => HAS.has(n), (n) => n in LAST).filter((e) => e.view === "v-then").length, 3, "not so without the build");
});

test("grouped by name, with the last build that had it and the suggestions for it; what could not be read is set aside; the archived apart", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-lost-"));
  try {
    const archive = new Archive(dir);
    const migration: LostMigration = { id: "m1", at: at(11), from: "A.was", to: "A.now", by: "VisualProof", auto: "same version", rename: true, review: true, carried: { opinions: 1, targets: 0, keys: 0, notes: 0, pins: 0, scopes: 0, reviewViews: 0 } };
    const w: LostWorld = {
      review: review(),
      views: [project()],
      has: (n) => HAS.has(n),
      last: (n) => LAST[n] ?? null,
      missing: ["T"],
      migrations: [migration],
      suggestions: [
        { from: "A.gone", to: "A.here", score: 0.65, why: "the same module", snap: 2 },
        { from: "A.gone", to: "A.top", score: 0.8, why: "the same last name", snap: 2 },
        { from: "Z.none", to: "A.here", score: 0.9, why: "x", snap: 2 },
      ],
      archive,
    };
    const a = lostAndFound(w);
    assert.deepEqual(a.lost.map((g) => [g.name, g.last?.snapshot, g.entries.length]), [["A.gone", 2, 8]]);
    assert.deepEqual(a.lost[0].suggestions.map((s) => [s.to, s.score]), [["A.top", 0.8], ["A.here", 0.65]], "the likeliest first, and only its own");
    // T.old was in module T, which the graph on show could not read: it did not vanish
    assert.deepEqual(a.aside, { entries: 1, modules: ["T"] });
    assert.deepEqual(a.migrations.map((m) => m.key), ["move:m1"]);
    assert.equal(a.count, 9);
    // archived: the entry under its key, Caroline's under the name she had then; a migration too
    const who = { name: "Alice", agent: false };
    archive.set([opinionRef("A.gone", "Alice", at(1)), opinionRef("A.gone", "Carol", at(3)), "move:m1"], true, who, at(30));
    const b = lostAndFound(w);
    assert.equal(b.lost[0].entries.length, 6);
    assert.deepEqual(b.archived.map((x) => [x.key, x.line.by, !!x.entry, !!x.migration]).sort(), [
      ["move:m1", "Alice", false, true],
      [opinionRef("A.gone", "Alice", at(1)), "Alice", true, false],
      [opinionRef("A.gone", "Caroline", at(3)), "Alice", true, false],
    ]);
    assert.equal(b.count, 6);
    // putting Caroline's back writes the line under the key it was archived by
    const keys = archiveKeys(b, [opinionRef("A.gone", "Caroline", at(3))], false, archive);
    assert.deepEqual(keys, [opinionRef("A.gone", "Carol", at(3))]);
    // only what is listed can be archived, only what is archived put back; again changes nothing
    assert.match(archiveKeys(b, ["target:Nope"], true, archive) as string, /no entry/);
    assert.deepEqual(archiveKeys(b, ["target:A.gone"], false, archive), [], "listed, not archived: nothing to put back");
    assert.deepEqual(archiveKeys(b, ["move:m1"], true, archive), [], "archived already");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the archive: a line per archiving or putting back, the last line of a key its state, kept for good", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-lost-"));
  try {
    const a = new Archive(dir);
    const alice = { name: "Alice", agent: false };
    assert.equal(a.set(["target:X", "pin:project:namespace:X"], true, alice, at(1)).length, 2);
    assert.equal(a.set(["target:X"], true, alice, at(2)).length, 0, "archived already: nothing written");
    const back = a.set(["target:X"], false, { name: "Bot", agent: true }, at(3));
    assert.deepEqual(back, [{ key: "target:X", on: false, by: "Bot", agent: true, at: at(3) }]);
    a.set(["move:m1"], true, { name: "Carol", agent: false, person: CAROL }, at(4));
    const lines = readFileSync(a.file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 4);
    assert.deepEqual(lines[3], { key: "move:m1", on: true, by: "Carol", person: CAROL, at: at(4) });
    // read back, a line cut short left out: the last line of each key
    appendFileSync(a.file, '{"key":"target:Y","on":tr');
    const again = new Archive(dir);
    assert.deepEqual([...again.archived().keys()].sort(), ["move:m1", "pin:project:namespace:X"]);
    assert.equal(again.get("target:X"), null);
    // archived again after it was put back: the last line wins
    again.set(["target:X"], true, alice, at(5));
    assert.equal(new Archive(dir).get("target:X")?.at, at(5));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A build of modules A and B: `names` in A, and B.t in B; `move` puts the first of them in B. */
function build(names: string[], o: { move?: boolean } = {}): RawGraph {
  const node = (name: string, module: string): RawNode => ({ name, kind: "def", module, type: `${name} : Nat`, ax: 0, hash: `k-${name}`, shape: `s-${name}`, refs: [] });
  const nodes = [...names.map((n, i) => node(n, o.move && i === 0 ? "B" : "A")), node("B.t", "B")];
  return { schema: 1, roots: ["B"], modules: [{ name: "A", imports: [] }, { name: "B", imports: ["A"] }], nodes, externals: [], edges: [], axioms: [], axiomSets: [[]], stats: { folded: 0, metaDropped: 0, ms: 0 }, refNames: [] };
}
const T0 = Date.parse("2026-10-09T10:00:00Z");
const opts = (k: number) => ({ at: T0 + k * 60_000, fingerprint: `f${k}`, commit: { hash: `c${k}`.padEnd(7, "0"), branch: "main" }, toolchain: "tc", missing: [] as string[] });

test("the newest build that had a name, and its module there: from the files that hold it, without reading a graph", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-lost-"));
  try {
    const h = new History(dir);
    h.record(build(["A.f", "A.g"]), opts(1));
    h.record(build(["A.f", "A.h"], { move: true }), opts(2));
    h.record(build(["A.h"]), opts(3));
    assert.deepEqual(h.lastHad("A.f"), { id: 2, module: "B" }, "moved to B in the last build that had it");
    assert.deepEqual(h.lastHad("A.g"), { id: 1, module: "A" });
    assert.deepEqual(h.lastHad("A.h"), { id: 3, module: "A" });
    assert.equal(h.lastHad("Nope"), null);
    // whether a given build had it
    assert.deepEqual([h.hadAt("A.f", 1), h.hadAt("A.f", 2), h.hadAt("A.f", 3), h.hadAt("A.g", 2), h.hadAt("Nope", 1)], [true, true, false, false, false]);
    // a later build that has it again
    h.record(build(["A.g"]), opts(4));
    assert.deepEqual(h.lastHad("A.g"), { id: 4, module: "A" });
    // read back by a server started again
    assert.deepEqual(new History(dir).lastHad("A.f"), { id: 2, module: "B" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ALICE = { "x-visualproof-name": "Alice" };
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** A live server whose history has a build with N.gone in module M beside N.a and N.b, and a graph on
 *  show without it; something said of N.gone in the review and on the Project view. */
async function lostSite() {
  const S = await site();
  const g = build([]);
  g.modules = [{ name: "M", imports: [] }];
  g.nodes = ["N.a", "N.b", "N.gone"].map((name) => ({ name, kind: "def", module: "M", type: `${name} : Nat`, ax: 0, hash: `k-${name}`, shape: `s-${name}`, refs: [] }));
  S.live.history!.record(g, opts(1));
  // what moves are checked against: the names of the graph on show (server/live.ts, install)
  (S.live as unknown as { nodeIndex: Map<string, number> }).nodeIndex = new Map([["N.a", 0], ["N.b", 1]]);
  const store = S.live.review;
  store.append({ name: "Alice", agent: false }, { op: "opinion", name: "N.gone", by: "Alice", verdict: "comment", comment: "Is this right?" }, "tc");
  store.append({ name: "Alice", agent: false }, { op: "target", name: "N.gone", on: true, by: "Alice" }, "tc");
  S.live.views.arrange("project", [{ op: "pin", mode: "namespace", kind: "node", key: "N.gone", at: [5, 6] }], null, "Alice");
  return S;
}

test("through the API: the list, the last build, archive and put back, Attach to… and its Undo, under who asks", async () => {
  const S = await lostSite();
  try {
    const ev = stream(S.port, "/api/events?session=lostfound-test-1");
    assert.equal(await ev.opened, 200);
    await ev.until(() => !!ev.last("lost"));
    assert.equal(ev.last("lost")!.count, 3, "the pages are told how many entries it lists");
    const list = (await S.ask("GET", "/api/history/lost")).json!;
    assert.deepEqual(list.lost.map((x: Json) => [x.name, x.last.snapshot, x.last.module, x.entries.map((e: Json) => e.kind)]), [["N.gone", 1, "M", ["target", "opinion", "pin"]]]);
    const keys = list.lost[0].entries.map((e: Json) => e.key);
    assert.deepEqual(keys.filter((k: string) => !k.startsWith("opinion:")), ["target:N.gone", "pin:project:namespace:N.gone"]);
    // the newest build that had it
    const last = await S.ask("GET", "/api/history/last?name=N.gone");
    assert.deepEqual([last.status, last.json!.snapshot, last.json!.module, last.json!.commit.hash], [200, 1, "M", "c100000"]);
    assert.equal((await S.ask("GET", "/api/history/last?name=Never.was")).status, 404);
    assert.equal((await S.ask("GET", "/api/history/last")).status, 400);
    // archiving needs a name, a key listed; it shows under archived, and every page is told
    assert.equal((await S.ask("POST", "/api/history/archive", { key: "target:N.gone" })).status, 401);
    assert.equal((await S.ask("POST", "/api/history/archive", { key: "target:Nope" }, ALICE)).status, 404);
    assert.equal((await S.ask("POST", "/api/history/archive", { key: "nonsense" }, ALICE)).status, 400);
    const rev = ev.last("lost")!.rev;
    const arch = await S.ask("POST", "/api/history/archive", { key: "target:N.gone" }, ALICE);
    assert.deepEqual([arch.status, arch.json!.changed, arch.json!.lines[0].by], [200, true, "Alice"]);
    await ev.until(() => ev.last("lost")!.rev > rev);
    assert.equal(ev.last("lost")!.count, 2);
    const after = (await S.ask("GET", "/api/history/lost")).json!;
    assert.deepEqual(after.archived.map((x: Json) => [x.key, x.line.by, x.entry.kind]), [["target:N.gone", "Alice", "target"]]);
    assert.deepEqual((await S.ask("GET", "/api/history/archive")).json!.archived.map((l: Json) => l.key), ["target:N.gone"]);
    // the thing itself is untouched: still a target in the review
    assert.ok(Object.hasOwn(S.live.review.data.targets, "N.gone"));
    // an agent: at full over its API, recorded as an agent's; not below
    const full = S.live.tokens.create({ name: "Claude", by: "Alice", level: "full", days: 1 }).token;
    const read = S.live.tokens.create({ name: "Reader", by: "Alice", level: "read", days: 1 }).token;
    assert.equal((await S.ask("GET", "/api/agent/history/lost", undefined, bearer(read))).status, 200, "read at every level");
    assert.equal((await S.ask("POST", "/api/agent/history/archive", { key: "target:N.gone", on: false }, bearer(read))).status, 403);
    const put = await S.ask("POST", "/api/agent/history/archive", { key: "target:N.gone", on: false }, bearer(full));
    assert.deepEqual([put.status, put.json!.lines[0].agent, put.json!.lines[0].on], [200, true, false]);
    // archived and put back: two lines, the last its state
    const lines = readFileSync(join(S.dir, "state", "history", "archive.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.key, l.on, l.by]), [["target:N.gone", true, "Alice"], ["target:N.gone", false, "Claude"]]);
    // Attach to…: refused where it is not a move from a name gone to one there
    assert.equal((await S.ask("POST", "/api/history/move", { from: "N.gone", to: "N.a" })).status, 401);
    assert.equal((await S.ask("POST", "/api/history/move", { from: "N.a", to: "N.b" }, ALICE)).status, 409);
    assert.equal((await S.ask("POST", "/api/history/move", { from: "N.gone", to: "N.nope" }, ALICE)).status, 404);
    const mv = await S.ask("POST", "/api/history/move", { from: "N.gone", to: "N.a" }, ALICE);
    assert.equal(mv.status, 200, JSON.stringify(mv.json));
    const m = mv.json!.migration;
    assert.deepEqual([m.id, m.by, m.rename, m.carried.opinions, m.carried.targets, m.carried.pins], ["m1", "Alice", false, 1, 1, 1]);
    // the entries leave the list: the review and the views carry them; the migration is listed
    const moved = (await S.ask("GET", "/api/history/lost")).json!;
    assert.deepEqual([moved.lost.length, moved.migrations.map((x: Json) => x.key), moved.count], [0, ["move:m1"], 1]);
    assert.deepEqual(S.live.review.data.opinions["N.a"].map((o) => o.was), [["N.gone"]]);
    assert.deepEqual(S.live.views.book.get("project")!.pins.namespace.nodes["N.a"], [5, 6]);
    // undone: back in the list, the migration with who undid it
    assert.equal((await S.ask("POST", "/api/history/unmove", { id: "m1" }, { "x-visualproof-name": "Bob" })).status, 200);
    const undone = (await S.ask("GET", "/api/history/lost")).json!;
    assert.deepEqual(undone.lost.map((x: Json) => [x.name, x.entries.length]), [["N.gone", 3]]);
    assert.equal(undone.migrations[0].undone.by, "Bob");
    assert.equal((await S.ask("POST", "/api/history/unmove", { id: "m1" }, ALICE)).status, 409, "once");
    // the migration archived: under archived, still undone
    assert.equal((await S.ask("POST", "/api/history/archive", { keys: ["move:m1"] }, ALICE)).status, 200);
    const last2 = (await S.ask("GET", "/api/history/lost")).json!;
    assert.deepEqual([last2.migrations.length, last2.archived[0].key, last2.archived[0].migration.undone.by], [0, "move:m1", "Bob"]);
    ev.close();
  } finally {
    await S.close();
  }
});

test("someone invited by a personal link attaches in their own log, with their link's id; a private reader's name stays with what they record", async () => {
  const S = await lostSite();
  try {
    const r = await S.ask("POST", "/api/share/people", { name: "Carol" }, { "x-visualproof-name": "Olivia" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const id = r.json!.invite.id as string;
    const entered = await fetch(S.base + new URL(r.json!.link).pathname, { redirect: "manual" });
    const cookie = entered.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const mv = await S.ask("POST", "/api/history/move", { from: "N.gone", to: "N.b" }, { cookie });
    assert.equal(mv.status, 200, JSON.stringify(mv.json));
    assert.deepEqual([mv.json!.migration.by, mv.json!.migration.person], ["Carol", id]);
    const log = readFileSync(join(S.dir, "review", "log", logFileName("Carol", false, id)), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(log.map((l) => [l.op, l.from, l.to, l.person]), [["move", "N.gone", "N.b", id]]);
    // archiving a migration: their name and link with it
    const a = await S.ask("POST", "/api/history/archive", { key: "move:m1" }, { cookie });
    assert.deepEqual([a.json!.lines[0].by, a.json!.lines[0].person], ["Carol", id]);
    // a private reader archives under their name: the archive says who hid what someone said
    const p = await S.ask("POST", "/api/history/archive", { key: "move:m1", on: false }, { "x-visualproof-name": "Dana", "x-visualproof-private": "5e5510a5-0000-4000-8000-000000000000" });
    assert.deepEqual([p.status, p.json!.lines[0].by], [200, "Dana"]);
  } finally {
    await S.close();
  }
});
