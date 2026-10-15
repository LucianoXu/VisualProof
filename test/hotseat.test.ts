// An opinion recorded for someone else (ReviewSpec decision 8, the owner's decisions of 2026-10-15):
// at one screen, whoever types may record an opinion as another person's. It is theirs — it replaces
// their earlier one and is replaced by their next — and says who recorded it; it is a line of the
// typist's own log; only opinions, only by people, never for an agent; an invited person is found by
// their name, and followed through their renames.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ReviewStore } from "../src/server/review.ts";
import type { AppendResult } from "../src/server/review.ts";
import { current, emptyReview, applyEvent, logFileName, readEvent, statusOf } from "../src/shared/review.ts";
import type { ReviewEvent } from "../src/shared/review.ts";
import { site } from "./site.ts";

const alice = { name: "Alice", agent: false };
const bob = { name: "Bob", agent: false };
const status = (r: AppendResult) => ("status" in r ? r.status : 200);

test("an opinion recorded for someone else is theirs: in the typist's log, replacing theirs and replaced by theirs, saying who recorded it", () => {
  const root = mkdtempSync(join(tmpdir(), "vp-hotseat-"));
  try {
    const store = new ReviewStore(root, "site");
    assert.equal(status(store.append(bob, { op: "opinion", name: "N.a", by: "Bob", verdict: "comment", comment: "why 0?" }, "tc")), 200);
    // Alice types Bob's approval: a line of Alice's log, for Bob
    assert.equal(status(store.append(alice, { op: "opinion", name: "N.a", by: "Alice", verdict: "approve", for: "Bob" }, "tc")), 200);
    const line = JSON.parse(readFileSync(join(root, "site", "log", logFileName("Alice", false)), "utf8"));
    assert.deepEqual([line.by, line.for, line.verdict], ["Alice", "Bob", "approve"]);
    // Bob's latest is that approval: his comment is replaced, the declaration approved
    const now = current(store.data, "N.a");
    assert.equal(now.length, 1, JSON.stringify(now));
    assert.deepEqual([now[0].by, now[0].verdict, now[0].recordedBy], ["Bob", "approve", { by: "Alice" }]);
    assert.equal(statusOf(store.data, "N.a", undefined), "approved");
    // Alice's own opinion is hers, beside it
    assert.equal(status(store.append(alice, { op: "opinion", name: "N.a", by: "Alice", verdict: "comment", comment: "and mine" }, "tc")), 200);
    assert.deepEqual(current(store.data, "N.a").map((o) => [o.by, o.verdict, !!o.recordedBy]).sort(), [["Alice", "comment", false], ["Bob", "approve", true]]);
    // Bob's next opinion of his own replaces the one recorded for him
    assert.equal(status(store.append(bob, { op: "opinion", name: "N.a", by: "Bob", verdict: "comment", comment: "on second thought" }, "tc")), 200);
    const bobs = current(store.data, "N.a").find((o) => o.by === "Bob")!;
    assert.deepEqual([bobs.verdict, bobs.recordedBy], ["comment", undefined]);
    // only opinions, by people, for someone else
    assert.equal(status(store.append(alice, { op: "target", name: "N.a", by: "Alice", on: true, for: "Bob" } as never, "tc")), 400, "a target is one's own");
    assert.equal(status(store.append(alice, { op: "opinion", name: "N.a", by: "Alice", verdict: "approve", for: "Alice" }, "tc")), 400, "not for oneself");
    assert.equal(status(store.append({ name: "Claude", agent: true }, { op: "opinion", name: "N.a", by: "Claude", verdict: "approve", for: "Bob", agent: true }, "tc")), 400, "an agent records for no one");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // read back: an agent's line for someone, or a line for its own writer, cannot be read
  assert.equal(typeof readEvent({ op: "opinion", at: "2026-10-15T00:00:00Z", by: "Claude", agent: true, name: "N.a", verdict: "approve", for: "Bob" }, true), "string");
  assert.equal(typeof readEvent({ op: "opinion", at: "2026-10-15T00:00:00Z", by: "Alice", name: "N.a", verdict: "approve", for: "Alice" }, false), "string");
  // for an invited person: by their link's id, under the name they go by now, renamed with them;
  // the typist's own rename follows into "recorded by"
  const d = emptyReview();
  const at = (s: number) => `2026-10-15T00:00:0${s}Z`;
  const lines: ReviewEvent[] = [
    { op: "opinion", at: at(1), by: "Carol", person: "c0c0c0c0c0", name: "N.b", verdict: "comment", comment: "hm" },
    { op: "opinion", at: at(2), by: "Dave", person: "d0d0d0d0d0", name: "N.b", verdict: "approve", for: "Carol", forPerson: "c0c0c0c0c0" },
    { op: "name", at: at(3), by: "Caroline", person: "c0c0c0c0c0" },
    { op: "name", at: at(4), by: "David", person: "d0d0d0d0d0" },
  ];
  for (const e of lines) applyEvent(d, e);
  const theirs = current(d, "N.b");
  assert.equal(theirs.length, 1);
  assert.deepEqual([theirs[0].by, theirs[0].person, theirs[0].verdict, theirs[0].recordedBy], ["Caroline", "c0c0c0c0c0", "approve", { by: "David", person: "d0d0d0d0d0" }]);
});

test("the server finds whom an opinion is for: one's own name is one's own, an invited person by their name, never an agent, never by an agent", async () => {
  const S = await site();
  const as = (name: string) => ({ "x-visualproof-name": name });
  try {
    // Claude's advice makes Claude an agent's name
    assert.equal((await S.ask("POST", "/api/agent/opinion", { name: "N.a", verdict: "approve" }, { ...as("Claude"), "x-visualproof-kind": "agent" })).status, 200);
    const give = (who: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve", ...body }, { ...as(who), ...headers });
    // a guest's name: as it is typed
    assert.equal((await give("Olivia", { for: " Bob " })).status, 200);
    let ops = S.live.review.data.opinions["N.a"].filter((o) => !o.agent);
    assert.deepEqual(ops.map((o) => [o.by, o.recordedBy?.by]), [["Bob", "Olivia"]]);
    // one's own name: one's own opinion
    assert.equal((await give("Olivia", { for: "Olivia" })).status, 200);
    ops = S.live.review.data.opinions["N.a"].filter((o) => !o.agent);
    assert.deepEqual(ops.at(-1)!.recordedBy, undefined);
    assert.equal(ops.at(-1)!.by, "Olivia");
    // an invited person, by their name in any case: their link's id, their name as they go by it
    const made = await S.ask("POST", "/api/share/people", { name: "Carol" }, as("Olivia"));
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.equal((await give("Olivia", { for: "carol" })).status, 200);
    const carols = S.live.review.data.opinions["N.a"].at(-1)!;
    assert.deepEqual([carols.by, carols.person, carols.recordedBy], ["Carol", made.json!.invite.id, { by: "Olivia" }]);
    // the agents' API: recorded by, and not the mark the person did not give it under
    const seen = await S.ask("GET", "/api/agent/declaration?name=N.a", undefined, { ...as("Claude"), "x-visualproof-kind": "agent" });
    const carolSeen = (seen.json!.review.opinions as Record<string, unknown>[]).find((o) => o.by === "Carol")!;
    assert.deepEqual([carolSeen.recordedBy, carolSeen.verified], ["Olivia", undefined]);
    // never for an agent, never by one
    assert.equal((await give("Olivia", { for: "Claude" })).status, 400);
    const byAgent = await S.ask("POST", "/api/agent/opinion", { name: "N.a", verdict: "approve", for: "Bob" }, { ...as("Claude"), "x-visualproof-kind": "agent" });
    assert.equal(byAgent.status, 403, JSON.stringify(byAgent.json));
    assert.equal((await give("Olivia", { for: 7 })).status, 400);
  } finally {
    await S.close();
  }
});
