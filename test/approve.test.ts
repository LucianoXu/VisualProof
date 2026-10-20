// Nobody approves twice (ReviewSpec decision 1, the owner's decision of 2026-10-20): an approval of
// the present version by someone whose current opinion there is already an approval of it is not
// recorded — the server answers `{ok, unchanged: true}` and writes nothing, for people, for someone
// spoken for and for agents' advice alike — and once a change has made it stale, approving again is
// new. The review box's Approve says where the approval of whoever it records for stands: Approve,
// Approved ✓ (Withdraw approval under the pointer, and a click withdraws), Approve again; the key `a`
// only ever approves.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ReviewStore } from "../src/server/review.ts";
import type { ViewMeta } from "../src/shared/graph.ts";
import { approval, current, emptyReview, logFileName, noChange, record } from "../src/shared/review.ts";
import type { ReviewRequest } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { ReviewBox } from "../src/web/src/reviewbox.ts";
import type { ReviewHooks } from "../src/web/src/reviewbox.ts";
import { setPeople } from "../src/web/src/verified.ts";
import { site } from "./site.ts";

const at = (k: number) => new Date(Date.UTC(2026, 9, 20, 10, 0, k)).toISOString();

test("where an approval stands: of this version, of an earlier one, or none; approving it again changes nothing, for anyone", () => {
  const d = emptyReview();
  const ann = { by: "Ann" };
  assert.equal(approval(d, "N.a", ann, "h1"), "none");
  record(d, { op: "opinion", name: "N.a", by: "Ann", verdict: "approve", hash: "h1" }, "tc", at(1));
  assert.equal(approval(d, "N.a", ann, "h1"), "approved");
  const again = { op: "opinion" as const, name: "N.a", by: "Ann", verdict: "approve" as const, hash: "h1" };
  assert.equal(noChange(d, again), true);
  // with words, it is the same approval: nothing is recorded
  assert.equal(noChange(d, { ...again, comment: "still fine" }), true);
  // a comment is a change of mind; so is an approval of the version after a change
  assert.equal(noChange(d, { ...again, verdict: "comment", comment: "hm" }), false);
  assert.equal(approval(d, "N.a", ann, "h2"), "stale");
  assert.equal(noChange(d, { ...again, hash: "h2" }), false);
  // a comment standing is no approval; nor is one withdrawn
  record(d, { op: "opinion", name: "N.a", by: "Ann", verdict: "comment", comment: "hm", hash: "h1" }, "tc", at(2));
  assert.equal(approval(d, "N.a", ann, "h1"), "none");
  assert.equal(noChange(d, again), false);
  record(d, { op: "opinion", name: "N.a", by: "Ann", verdict: "approve", hash: "h1" }, "tc", at(3));
  record(d, { op: "withdraw", name: "N.a", by: "Ann" }, "tc", at(4));
  assert.equal(approval(d, "N.a", ann, "h1"), "none");
  assert.equal(noChange(d, again), false);
  // someone spoken for: their approval stands, so the typist records nothing more for them
  record(d, { op: "opinion", name: "N.b", by: "Ann", verdict: "approve", hash: "b1", for: "Bob" }, "tc", at(5));
  assert.equal(noChange(d, { op: "opinion", name: "N.b", by: "Ann", verdict: "approve", hash: "b1", for: "Bob" }), true);
  assert.equal(noChange(d, { op: "opinion", name: "N.b", by: "Bob", verdict: "approve", hash: "b1" }), true, "nor Bob himself");
  assert.equal(noChange(d, { op: "opinion", name: "N.b", by: "Ann", verdict: "approve", hash: "b1" }), false, "Ann's own is another's");
  // an agent's advice alike, and an agent is not the person of its name
  record(d, { op: "opinion", name: "N.b", by: "Bob", verdict: "approve", hash: "b1", agent: true }, "tc", at(6));
  assert.equal(noChange(d, { op: "opinion", name: "N.b", by: "Bob", verdict: "approve", hash: "b1", agent: true }), true);
  assert.equal(approval(d, "N.b", { by: "Bob", agent: true }, "b1"), "approved");
  // what has no version (outside the project, an axiom by its name) is never stale
  record(d, { op: "opinion", name: "sorryAx", by: "Ann", verdict: "approve" }, "tc", at(7));
  assert.equal(noChange(d, { op: "opinion", name: "sorryAx", by: "Ann", verdict: "approve" }), true);
});

test("the log: a second approval of the same version appends nothing; a stale one approved again is a line", () => {
  const root = mkdtempSync(join(tmpdir(), "vp-approve-"));
  try {
    const store = new ReviewStore(root, "site");
    const ann = { name: "Ann", agent: false };
    const op = (hash: string) => ({ op: "opinion" as const, name: "N.a", by: "Ann", verdict: "approve" as const, hash });
    const lines = () => readFileSync(join(root, "site", "log", logFileName("Ann", false)), "utf8").trim().split("\n").length;
    assert.ok("event" in store.append(ann, op("h1"), "tc"));
    assert.deepEqual(store.append(ann, op("h1"), "tc"), { change: null, unchanged: true });
    assert.equal(lines(), 1);
    assert.equal(store.data.opinions["N.a"].length, 1, "the history holds one");
    // the declaration changed: approving it now is new
    assert.ok("event" in store.append(ann, op("h2"), "tc"));
    assert.equal(lines(), 2);
    assert.deepEqual(current(store.data, "N.a").map((o) => o.hash), ["h2"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("at the server: approved twice, the second is answered unchanged and writes nothing — a person, someone spoken for, an agent's advice, one or many at once", async () => {
  const S = await site();
  const as = (name: string) => ({ "x-visualproof-name": name });
  const agent = (name: string) => ({ ...as(name), "x-visualproof-kind": "agent" });
  try {
    const approve = (who: string, body: Record<string, unknown> = {}) => S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve", ...body }, as(who));
    const first = await approve("Olivia");
    assert.equal(first.status, 200);
    assert.ok(first.json!.change && !first.json!.unchanged);
    const second = await approve("Olivia", { comment: "again" });
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.deepEqual([second.json!.ok, second.json!.unchanged, second.json!.change], [true, true, null]);
    assert.equal(S.live.review.data.opinions["N.a"].length, 1, "no second event: the history shows one");
    // Bob, spoken for by Olivia: once, then not again — by her, nor by him
    assert.ok((await approve("Olivia", { for: "Bob" })).json!.change);
    assert.equal((await approve("Olivia", { for: "bob" })).json!.unchanged, true);
    assert.equal((await approve("Bob")).json!.unchanged, true);
    assert.equal(S.live.review.data.opinions["N.a"].length, 2);
    // a comment, then an approval: both recorded
    assert.ok((await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "comment", comment: "wait" }, as("Olivia"))).json!.change);
    assert.ok((await approve("Olivia")).json!.change);
    // the agent's advice: one, then answered unchanged, the batch counting it apart
    const advise = await S.ask("POST", "/api/agent/opinion", { name: "N.a", verdict: "approve" }, agent("Claude"));
    assert.equal(advise.status, 200);
    assert.ok(advise.json!.recorded);
    const twice = await S.ask("POST", "/api/agent/opinion", { name: "N.a", verdict: "approve", comment: "sure" }, agent("Claude"));
    assert.equal(twice.status, 200, JSON.stringify(twice.json));
    assert.equal(twice.json!.unchanged, true);
    assert.equal(twice.json!.recorded, undefined);
    assert.match(twice.json!.note, /already: nothing was recorded/);
    const batch = await S.ask("POST", "/api/agent/opinions", { opinions: [{ name: "N.a", verdict: "approve" }, { name: "N.b", verdict: "approve" }] }, agent("Claude"));
    assert.equal(batch.status, 200, JSON.stringify(batch.json));
    assert.deepEqual([batch.json!.recorded, batch.json!.unchanged, batch.json!.refused], [1, 1, 0]);
    assert.deepEqual(batch.json!.results.map((r: { unchanged?: boolean }) => !!r.unchanged), [true, false]);
    assert.equal(S.live.review.data.opinions["N.a"].filter((o) => o.agent).length, 1);
  } finally {
    await S.close();
  }
});

test("the review box's Approve: Approve, Approved ✓ (a click withdraws), Approve again; the key a only approves; for the person spoken for", async () => {
  setPeople([]);
  const meta = {
    nodes: [
      { name: "N.a", kind: "def", module: "N", ax: 0, hash: "h2" },
      { name: "N.t", kind: "theorem", module: "N", ax: 0, hash: "t1" },
    ],
    projectCount: 2,
    axioms: [],
    axiomSets: [[]],
    layouts: {},
    edgeCount: 0,
  } as unknown as ViewMeta;
  const g = new Graph(meta, new Int32Array(0));
  const d = emptyReview();
  const sent: ReviewRequest[] = [];
  const said: string[] = [];
  const hooks = {
    review: () => ({ data: d, error: null, blocked: null, readOnly: false, reviewer: "Olivia" }),
    ensureReviewer: async () => "Olivia",
    submit: async (op: ReviewRequest) => (sent.push(op), null),
    said: (t: string) => said.push(t),
    editedNow: () => false,
    edited: async () => false,
    reviewRoot: () => null,
    keyable: () => false,
  } as unknown as ReviewHooks;
  const box = new ReviewBox(g, hooks);
  const settle = () => new Promise((ok) => setImmediate(ok));
  /** the box's Approve: its state and the words it shows (and those it shows under the pointer) */
  const button = (html: string) => {
    const m = /<button class="rv-btn approve( on)?" data-rv="approve" data-rv-state="([a-z]+)"[^>]*>(.*?)<\/button>/.exec(html);
    assert.ok(m, html);
    return { state: m[2], on: !!m[1], words: m[3].replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/^\||\|$/g, "") };
  };
  const at0 = (html: string) => button(html);
  // nothing yet: Approve
  assert.deepEqual(at0(box.html(0)), { state: "none", on: false, words: "Approve" });
  // approved, this version: Approved ✓, Withdraw approval under the pointer
  record(d, { op: "opinion", name: "N.a", by: "Olivia", verdict: "approve", hash: "h2" }, "tc", at(1));
  assert.deepEqual(at0(box.html(0)), { state: "approved", on: true, words: "Approved ✓|Withdraw approval" });
  // the key a (give) does nothing but say so; it never withdraws
  const root = { querySelector: () => null } as unknown as HTMLElement;
  box.give("approve", 0, root);
  await settle();
  assert.equal(sent.length, 0);
  assert.match(said.at(-1)!, /^Your approval of this version of N\.a stands already/);
  // a click on Approved ✓ withdraws it, at once
  const pressed = { closest: (q: string) => (q === "[data-rv], [data-rv-ax]" ? { dataset: { rv: "approve", rvState: "approved" } } : null) } as unknown as HTMLElement;
  assert.equal(box.click(pressed, 0, root), true);
  await settle();
  assert.deepEqual(sent.at(-1), { op: "withdraw", name: "N.a" });
  assert.equal(said.at(-1), "Withdrew your approval of N.a.");
  // as the server takes it: Approve again
  record(d, { op: "withdraw", name: "N.a", by: "Olivia" }, "tc", at(2));
  assert.equal(at0(box.html(0)).words, "Approve");
  // an approval of an earlier version: Approve again, which approves (give sends it)
  record(d, { op: "opinion", name: "N.a", by: "Olivia", verdict: "approve", hash: "h1" }, "tc", at(3));
  assert.deepEqual(at0(box.html(0)), { state: "stale", on: false, words: "Approve again" });
  box.give("approve", 0, root);
  await settle();
  assert.deepEqual(sent.at(-1), { op: "opinion", name: "N.a", verdict: "approve", comment: undefined });
  // drawn for the person spoken for: Bob has no approval; then one, recorded for him
  box.input({ value: "Bob", matches: (q: string) => q === "[data-rv-for]" } as unknown as HTMLElement, 0);
  assert.deepEqual(at0(box.html(0)), { state: "none", on: false, words: "Approve| for Bob" });
  record(d, { op: "opinion", name: "N.a", by: "Olivia", verdict: "approve", hash: "h2", for: "Bob" }, "tc", at(4));
  assert.deepEqual(at0(box.html(0)), { state: "approved", on: true, words: "Approved ✓| for Bob|Withdraw approval| for Bob" });
  // a click there withdraws his, recorded by the typist; an approval stale meanwhile is not taken back
  box.click(pressed, 0, root);
  await settle();
  assert.deepEqual(sent.at(-1), { op: "withdraw", name: "N.a", for: "Bob" });
  const n = sent.length;
  record(d, { op: "opinion", name: "N.a", by: "Olivia", verdict: "comment", comment: "hm", hash: "h2", for: "Bob" }, "tc", at(5));
  const err = { textContent: "", hidden: true };
  box.click(pressed, 0, { querySelector: (s: string) => (s === ".rv-err" ? err : null) } as unknown as HTMLElement);
  await settle();
  assert.equal(sent.length, n, "a comment is never taken back for an approval");
  assert.equal(err.textContent, "That approval is no longer the one that stands.");
  box.input({ value: "", matches: (q: string) => q === "[data-rv-for]" } as unknown as HTMLElement, 0);
});
