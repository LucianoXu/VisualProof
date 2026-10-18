// The review's storage (decided 2026-10-08, server/review.ts): one append-only log per writer in the
// project's review folder, replayed into the review; names every clone and synced copy of the
// project accepts, Windows included; lines that cannot be read reported and never rewritten, and lines of an event no longer
// recorded (an explanation, a checkpoint) skipped; what changed told as events a page applies to the
// review it holds.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { adviceOf, applyEvent, current, emptyReview, logFileName, merged, readEvent, replay, reviewFromJson, shortHash, statusOf } from "../src/shared/review.ts";
import type { ReviewChange, ReviewData, ReviewEvent } from "../src/shared/review.ts";
import { ReviewStore } from "../src/server/review.ts";
import type { AppendResult } from "../src/server/review.ts";

const alice = { name: "Alice", agent: false };
const bob = { name: "Bob", agent: false };
const claude = { name: "Claude", agent: true };

function folder() {
  const root = mkdtempSync(join(tmpdir(), "vp-reviewlog-"));
  return { root, log: (name: string, agent = false) => join(root, ".visualproof", "log", logFileName(name, agent)), done: () => rmSync(root, { recursive: true, force: true }) };
}

/** An append that went through, and its change. */
function ok(r: AppendResult): ReviewChange {
  assert.ok("change" in r && r.change, JSON.stringify(r));
  return (r as { change: ReviewChange }).change;
}

const status = (r: AppendResult) => ("status" in r ? r.status : 200);
const line = (e: object) => JSON.stringify(e) + "\n";

test("one log per writer, only appended to, replayed into the review", () => {
  const F = folder();
  try {
    const store = new ReviewStore(F.root, ".visualproof");
    assert.equal(existsSync(join(F.root, ".visualproof")), false, "nothing is written until there is something to write");
    ok(store.append(alice, { op: "opinion", name: "Z.b", by: "Alice", verdict: "approve", hash: "h", text: "def b := 1" }, "tc"));
    ok(store.append(bob, { op: "opinion", name: "A.a", by: "Bob", verdict: "approve" }, "tc"));
    ok(store.append(claude, { op: "opinion", name: "A.a", by: "Claude", verdict: "comment", comment: "off by one", agent: true }, "tc"));
    assert.equal(status(store.append(bob, { op: "opinion", name: "A.a", by: "Bob", verdict: "comment" }, "tc")), 400, "a comment needs text");
    assert.equal(status(store.append(alice, { op: "opinion", name: "A.a", by: "Bob", verdict: "approve" }, "tc")), 400, "recorded under the name of who asks");
    assert.equal(status(store.append(alice, { op: "opinion", name: "A.a", by: "Alice", verdict: "approve", agent: true }, "tc")), 400, "and its kind");
    // the folder says what it is; each writer has a file, an agent's marked as one
    const dir = join(F.root, ".visualproof");
    assert.match(readFileSync(join(dir, "README.md"), "utf8"), /one file per writer/);
    assert.deepEqual(readdirSync(join(dir, "log")).sort(), [logFileName("Alice", false), logFileName("Bob", false), logFileName("Claude", true)].sort());
    const lines = readFileSync(F.log("Alice"), "utf8").split("\n");
    assert.equal(lines.length, 2, "one line, ended");
    const e = JSON.parse(lines[0]);
    assert.deepEqual([e.op, e.name, e.by, e.verdict, e.hash, e.text, e.toolchain], ["opinion", "Z.b", "Alice", "approve", "h", "def b := 1", "tc"]);
    assert.equal(JSON.parse(readFileSync(F.log("Claude", true), "utf8")).agent, true);
    // the review is what replaying them gives: the agent's word is advice
    assert.equal(statusOf(store.data, "A.a", undefined), "approved");
    assert.equal(store.data.opinions["A.a"].length, 2);
    // a change of mind is one more line; the earlier one stays
    const before = readFileSync(F.log("Alice"));
    ok(store.append(alice, { op: "opinion", name: "Z.b", by: "Alice", verdict: "comment", comment: "should be 2", hash: "h", text: "def b := 1" }, "tc"));
    const after = readFileSync(F.log("Alice"));
    assert.deepEqual(after.subarray(0, before.length), before, "only appended");
    assert.equal(JSON.parse(after.toString("utf8").split("\n")[1]).text, undefined, "the same version and text are not repeated");
    assert.equal(statusOf(store.data, "Z.b", "h"), "commented");
    // another server (or a restart) replays the same review
    assert.equal(JSON.stringify(new ReviewStore(F.root, ".visualproof").data), JSON.stringify(store.data));
    // asking for what is so already appends nothing
    ok(store.append(alice, { op: "target", name: "T", by: "Alice", on: true }, "tc"));
    const size = readFileSync(F.log("Alice")).length;
    assert.deepEqual(store.append(alice, { op: "target", name: "T", by: "Alice", on: true }, "tc"), { change: null, unchanged: true });
    assert.equal(readFileSync(F.log("Alice")).length, size);
    // a target taken off, trust: events like the rest
    ok(store.append(bob, { op: "trust", prefix: "Vendored", by: "Bob", on: true }, "tc"));
    assert.ok(store.data.trusted.includes("Vendored"));
    assert.equal(status(store.append(bob, { op: "trust", prefix: "Tau Ceti", by: "Bob", on: true }, "tc")), 400);
    ok(store.append(alice, { op: "target", name: "T", by: "Alice", on: false }, "tc"));
    assert.equal(Object.hasOwn(store.data.targets, "T"), false);
    // a site of its own (--site, relative to the project)
    const elsewhere = new ReviewStore(F.root, "notes/review");
    ok(elsewhere.append(alice, { op: "trust", prefix: "Vendored", by: "Alice", on: true }, "tc"));
    assert.ok(existsSync(join(F.root, "notes", "review", "log", logFileName("Alice", false))));
  } finally {
    F.done();
  }
});

test("replay: one writer's events in file order, different writers' by time, ties by file name", () => {
  const ev = (by: string, at: string, verdict: "approve" | "comment"): ReviewEvent => ({ op: "opinion", name: "X", by, verdict, at, ...(verdict === "comment" ? { comment: "no" } : {}) });
  // Alice's clock went backwards: her file's order holds — her latest opinion is the comment
  const a = { file: "Alice-1.jsonl", events: [ev("Alice", "2026-10-08T10:00:05Z", "approve"), ev("Alice", "2026-10-08T10:00:01Z", "comment")] };
  const b = { file: "Bob-2.jsonl", events: [ev("Bob", "2026-10-08T10:00:03Z", "approve"), ev("Bob", "2026-10-08T10:00:06Z", "comment")] };
  const c = { file: "Carol-3.jsonl", events: [ev("Carol", "2026-10-08T10:00:03Z", "approve")] };
  const order = (logs: { file: string; events: ReviewEvent[] }[]) => merged(logs).map((x) => `${x.e.by}@${x.e.at.slice(17, 19)}`);
  const want = ["Bob@03", "Carol@03", "Alice@05", "Alice@01", "Bob@06"];
  assert.deepEqual(order([a, b, c]), want, "by time; Bob before Carol at the same time, by file name; Alice's two in her order");
  assert.deepEqual(order([c, b, a]), want, "whatever order the files are read in");
  const d = replay([c, a, b]);
  assert.deepEqual(current(d, "X").map((o) => [o.by, o.verdict]).sort(), [["Alice", "comment"], ["Bob", "comment"], ["Carol", "approve"]]);
  // the same events applied one by one, in that order, give the same review
  const e = emptyReview();
  for (const x of merged([a, b, c])) applyEvent(e, x.e);
  assert.equal(JSON.stringify(e), JSON.stringify(d));
});

test("a log's name: readable, from the exact name, legal on every clone, Windows included", () => {
  /** Why Windows (NTFS), macOS or Linux would refuse a name or confuse it with another, or null. */
  const illegal = (n: string): string | null => {
    if (/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(n)) return "a reserved character";
    if (/[ .]$/.test(n)) return "a trailing space or dot";
    if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i.test(n.split(".")[0])) return "a device name";
    if (/~\d/.test(n)) return "the shape of an NTFS short name";
    if (n.length >= 60 || [...n].length >= 60) return "60 characters or more";
    if (n !== n.normalize("NFC") || n !== n.normalize("NFD").normalize("NFC")) return "not in one normal form";
    return null;
  };
  const names = [
    "Olivia", "olivia", "OLIVIA", "Claude", "CON", "con", "nul", "Com1", "LPT9", "COM¹", "aux.md", "a:b|c", "Draft ", "Draft.", " . ", "",
    "José", "jose", "Ünïcödé", "徐英特", "名前", "한국어", "ﬁle", "１２３", "PAGE_2~4.JPG", "REPORT~1.DOC", "x".repeat(300), "😀".repeat(40),
    "\u0000ctrl\u0007", "../../etc/passwd", "a/b\\c", "Å", "Å", "<script>", "Alice (reviewer) @ home",
  ];
  const seen = new Map<string, string>();
  for (const name of names)
    for (const agent of [false, true]) {
      const f = logFileName(name, agent);
      assert.equal(illegal(f), null, `${JSON.stringify(name)} → ${JSON.stringify(f)}: ${illegal(f)}`);
      assert.ok(f.endsWith(agent ? ".agent.jsonl" : ".jsonl") && (agent || !f.endsWith(".agent.jsonl")));
      assert.ok(f.includes(`-${shortHash(name)}`), "the hash of the exact name");
      assert.equal(f, logFileName(name, agent), "the same on every call (and in the page, which computes it too)");
      // two names never share a file, not even on a case-insensitive file system
      const k = f.toLowerCase();
      assert.ok(!seen.has(k) || seen.get(k) === `${name}/${agent}`, `${JSON.stringify(name)} and ${seen.get(k)} → ${f}`);
      seen.set(k, `${name}/${agent}`);
    }
  // readable where the name allows it
  assert.equal(logFileName("Olivia", false), `Olivia-${shortHash("Olivia")}.jsonl`);
  assert.equal(logFileName("Claude", true), `Claude-${shortHash("Claude")}.agent.jsonl`);
  assert.match(logFileName("José", false), /^Jose-/);
  assert.match(logFileName("徐英特", false), /^徐英特-/);
  assert.match(logFileName("Alice (reviewer) @ home", false), /^Alice-reviewer-home-/);
  assert.match(logFileName("CON", false), /^CON-[0-9a-f]{8}\.jsonl$/, "never the device name itself");
  assert.match(logFileName("", false), /^writer-/);
});

test("a log line that cannot be read is reported and left as it is; its writer's appends wait until it is fixed", () => {
  const F = folder();
  try {
    const store = new ReviewStore(F.root, ".visualproof");
    ok(store.append(alice, { op: "opinion", name: "A.a", by: "Alice", verdict: "approve" }, "tc"));
    ok(store.append(bob, { op: "opinion", name: "B.b", by: "Bob", verdict: "approve" }, "tc"));
    // a merge of Bob's log, his two machines apart, left its conflict markers in
    const theirs = line({ op: "opinion", name: "B.c", by: "Bob", verdict: "approve", at: "2026-10-08T09:00:00Z" });
    const conflicted = readFileSync(F.log("Bob"), "utf8") + "<<<<<<< HEAD\n" + theirs + "=======\n>>>>>>> laptop\n";
    writeFileSync(F.log("Bob"), conflicted);
    store.refresh();
    const bobs = store.problems.filter((p) => p.file === logFileName("Bob", false));
    assert.deepEqual(bobs.map((p) => p.line), [2, 4, 5], "each line that is not an event, where it is");
    assert.ok(bobs.every((p) => p.writer === "Bob"), "whose log it is, from its good lines");
    assert.match(store.error!, /line 2: not an event \(<<<<<<< HEAD\)/);
    assert.match(store.error!, /fixed by hand/);
    // the good lines are read, his and everyone's
    assert.equal(statusOf(store.data, "B.c", undefined), "approved");
    assert.equal(statusOf(store.data, "A.a", undefined), "approved");
    // Bob's next opinion is refused, and his file is left byte for byte as it was
    const r = store.append(bob, { op: "opinion", name: "A.a", by: "Bob", verdict: "approve" }, "tc");
    assert.equal(status(r), 409);
    assert.match((r as { error: string }).error, /cannot be read — line 2/);
    assert.equal(readFileSync(F.log("Bob"), "utf8"), conflicted);
    // a new server reads it the same, and changes nothing either
    const again = new ReviewStore(F.root, ".visualproof");
    assert.equal(again.problems.length, 3);
    assert.equal(readFileSync(F.log("Bob"), "utf8"), conflicted);
    // Alice writes on
    ok(store.append(alice, { op: "opinion", name: "B.b", by: "Alice", verdict: "approve" }, "tc"));
    // a line cut short (a crash while writing): reported, nothing appended after it
    const cut = '{"op":"opinion","name":"C.c","by":"Carol","verd';
    writeFileSync(F.log("Carol"), line({ op: "opinion", name: "C.b", by: "Carol", verdict: "approve", at: "2026-10-08T09:00:00Z" }) + cut);
    store.refresh();
    assert.match(store.problems.find((p) => p.file === logFileName("Carol", false))!.why, /the last line is cut short/);
    assert.equal(status(store.append({ name: "Carol", agent: false }, { op: "opinion", name: "C.c", by: "Carol", verdict: "approve" }, "tc")), 409);
    assert.ok(readFileSync(F.log("Carol"), "utf8").endsWith(cut));
    // an event that is not one of the review's, or an agent's line in a person's log
    appendFileSync(F.log("Alice"), line({ op: "delete-everything", by: "Alice", at: "2026-10-08T09:00:00Z" }) + line({ op: "opinion", name: "Q", by: "Alice", verdict: "approve", agent: true, at: "2026-10-08T09:00:01Z" }));
    store.refresh();
    assert.deepEqual(store.problems.filter((p) => p.file === logFileName("Alice", false)).map((p) => p.why.split(" (")[0]), ["op", "an agent's line in a person's log"]);
    // fixed by hand: Bob writes on, his events as he meant them
    writeFileSync(F.log("Bob"), conflicted.replace(/^(<<<<<<<|=======|>>>>>>>).*\n/gm, ""));
    store.refresh();
    assert.equal(store.problems.filter((p) => p.file === logFileName("Bob", false)).length, 0);
    ok(store.append(bob, { op: "opinion", name: "A.a", by: "Bob", verdict: "approve" }, "tc"));
    assert.equal(statusOf(store.data, "B.c", undefined), "approved");
  } finally {
    F.done();
  }
});

test("an explanation in an older log is skipped: not a damaged line, and its writer writes on", () => {
  const F = folder();
  try {
    // logs from before the owner removed explanations (2026-10-08): Alice's and an agent's hold one
    // among their other lines, and Bob's ends with one written without its newline
    const explain = (by: string, k: number, agent?: true) => ({ op: "explain", at: `2026-10-08T09:0${k}:00.000Z`, by, name: "A.a", text: "What it is, for a reader.", hash: "h", ...(agent ? { agent } : {}) });
    const store0 = new ReviewStore(F.root, ".visualproof");
    ok(store0.append(alice, { op: "target", name: "T", by: "Alice", on: true }, "tc"));
    appendFileSync(F.log("Alice"), line(explain("Alice", 1)) + line({ op: "opinion", name: "A.a", by: "Alice", verdict: "approve", at: "2026-10-08T09:02:00.000Z" }));
    writeFileSync(F.log("Claude", true), line(explain("Claude", 3, true)));
    writeFileSync(F.log("Bob"), line({ op: "opinion", name: "B.b", by: "Bob", verdict: "approve", at: "2026-10-08T09:04:00.000Z" }) + JSON.stringify(explain("Bob", 5)));
    // even one that would not pass as an explanation then: what it holds is not looked at
    appendFileSync(F.log("Alice"), line({ op: "explain", at: "not a time", by: "Alice", agent: true }));
    for (const store of [store0, new ReviewStore(F.root, ".visualproof")]) {
      store.refresh();
      assert.deepEqual(store.problems, [], "no line is reported");
      assert.equal(store.error, null);
      // the other lines are read, and nothing of the explanations is in the review
      assert.equal(statusOf(store.data, "A.a", undefined), "approved");
      assert.equal(statusOf(store.data, "B.b", undefined), "approved");
      assert.ok(Object.hasOwn(store.data.targets, "T"));
      assert.deepEqual(Object.keys(store.data).sort(), ["keys", "opinions", "people", "targets", "trusted", "version"]);
      assert.ok(!JSON.stringify(store.data).includes("What it is"));
    }
    // their writers are not held up: each appends after it, the files only grown
    const before = { alice: readFileSync(F.log("Alice"), "utf8"), bob: readFileSync(F.log("Bob"), "utf8"), claude: readFileSync(F.log("Claude", true), "utf8") };
    const store = new ReviewStore(F.root, ".visualproof");
    ok(store.append(alice, { op: "opinion", name: "B.b", by: "Alice", verdict: "approve" }, "tc"));
    ok(store.append(bob, { op: "opinion", name: "A.a", by: "Bob", verdict: "comment", comment: "off by one" }, "tc"));
    ok(store.append(claude, { op: "opinion", name: "A.a", by: "Claude", verdict: "approve", agent: true }, "tc"));
    assert.ok(readFileSync(F.log("Alice"), "utf8").startsWith(before.alice));
    assert.ok(readFileSync(F.log("Claude", true), "utf8").startsWith(before.claude));
    // Bob's last line had no newline: his new one starts on a line of its own
    const bobs = readFileSync(F.log("Bob"), "utf8");
    assert.ok(bobs.startsWith(before.bob + "\n"));
    assert.equal(JSON.parse(bobs.trim().split("\n").at(-1)!).comment, "off by one");
    assert.equal(statusOf(store.data, "A.a", undefined), "commented");
    assert.deepEqual(store.problems, []);
    // the line read on its own: skipped, neither an event nor a reason
    assert.equal(readEvent(explain("Alice", 1), false), null);
    assert.equal(readEvent(explain("Claude", 3, true), true), null);
    assert.equal(readEvent(explain("Claude", 3, true), false), null, "whatever it holds");
  } finally {
    F.done();
  }
});

test("a checkpoint in an older log is skipped: not a damaged line, its writer writes on, and it makes no target", () => {
  const F = folder();
  try {
    // logs from before the owner removed checkpoints (2026-10-09): one of a target, one of a theorem
    // that is not one (which used to make it one), an agent's, and one with a map no checkpoint
    // ever passed with
    const checkpoint = (by: string, k: number, name: string, agent?: true) => ({ op: "checkpoint", at: `2026-10-09T09:0${k}:00.000Z`, by, name, tcb: { "A.a": "h", "Ext.E": "" }, ...(agent ? { agent } : {}) });
    const store0 = new ReviewStore(F.root, ".visualproof");
    ok(store0.append(alice, { op: "target", name: "T", by: "Alice", on: true }, "tc"));
    appendFileSync(F.log("Alice"), line(checkpoint("Alice", 1, "T")) + line(checkpoint("Alice", 2, "U")) + line({ op: "opinion", name: "A.a", by: "Alice", verdict: "approve", at: "2026-10-09T09:03:00.000Z" }));
    writeFileSync(F.log("Claude", true), line(checkpoint("Claude", 4, "T", true)));
    appendFileSync(F.log("Alice"), line({ op: "checkpoint", at: "2026-10-09T09:05:00.000Z", by: "Alice", name: "T", tcb: [1, 2] }));
    for (const store of [store0, new ReviewStore(F.root, ".visualproof")]) {
      store.refresh();
      assert.deepEqual(store.problems, [], "no line is reported");
      assert.equal(store.error, null);
      // the other lines are read; the target is as marked, with nothing of a checkpoint
      assert.equal(statusOf(store.data, "A.a", undefined), "approved");
      assert.deepEqual(Object.keys(store.data.targets), ["T"], "a checkpoint makes no target");
      assert.deepEqual(Object.keys(store.data.targets.T).sort(), ["at", "by"]);
      assert.ok(!JSON.stringify(store.data).includes("Ext.E"));
    }
    // its writers are not held up
    const before = readFileSync(F.log("Alice"), "utf8");
    const store = new ReviewStore(F.root, ".visualproof");
    ok(store.append(alice, { op: "opinion", name: "B.b", by: "Alice", verdict: "approve" }, "tc"));
    ok(store.append(claude, { op: "opinion", name: "A.a", by: "Claude", verdict: "approve", agent: true }, "tc"));
    assert.ok(readFileSync(F.log("Alice"), "utf8").startsWith(before));
    assert.deepEqual(store.problems, []);
    // nothing records one now, and the line read on its own is skipped
    assert.equal(status(store.append(alice, { op: "checkpoint", name: "T", by: "Alice" } as never, "tc")), 400);
    assert.equal(readEvent(checkpoint("Alice", 1, "T"), false), null);
    assert.equal(readEvent(checkpoint("Claude", 4, "T", true), true), null);
    // a snapshot's review from before carries a target's checkpoints: read without them
    const snap = reviewFromJson({ version: 1, targets: { T: { by: "Alice", at: "2026-10-09T09:00:00.000Z", checkpoints: [{ by: "Alice", at: "2026-10-09T09:01:00.000Z", tcb: { "A.a": "h" } }] } } });
    assert.deepEqual(Object.keys(snap.targets.T).sort(), ["at", "by"]);
  } finally {
    F.done();
  }
});

test("what someone else wrote meanwhile is read first, never written over", () => {
  const F = folder();
  try {
    const store = new ReviewStore(F.root, ".visualproof");
    ok(store.append(alice, { op: "opinion", name: "A.a", by: "Alice", verdict: "approve" }, "tc"));
    // Alice's log grows elsewhere (her other machine, a pull) before this server writes to it
    appendFileSync(F.log("Alice"), line({ op: "opinion", name: "A.b", by: "Alice", verdict: "approve", at: new Date().toISOString() }));
    ok(store.append(alice, { op: "opinion", name: "A.c", by: "Alice", verdict: "approve" }, "tc"));
    assert.deepEqual(readFileSync(F.log("Alice"), "utf8").trim().split("\n").map((l) => JSON.parse(l).name), ["A.a", "A.b", "A.c"]);
    assert.deepEqual(Object.keys(store.data.opinions).sort(), ["A.a", "A.b", "A.c"]);
    // a last line written by hand without its newline: the next line starts on a line of its own
    appendFileSync(F.log("Alice"), JSON.stringify({ op: "opinion", name: "A.d", by: "Alice", verdict: "approve", at: new Date().toISOString() }));
    ok(store.append(alice, { op: "opinion", name: "A.e", by: "Alice", verdict: "approve" }, "tc"));
    assert.deepEqual(readFileSync(F.log("Alice"), "utf8").trim().split("\n").map((l) => JSON.parse(l).name), ["A.a", "A.b", "A.c", "A.d", "A.e"]);
    // a log rewritten (a checkout of another branch) is read whole again
    writeFileSync(F.log("Alice"), line({ op: "opinion", name: "A.z", by: "Alice", verdict: "approve", at: "2026-10-01T00:00:00Z" }));
    const c = store.refresh()!;
    assert.equal(c.events, null, "the whole review, not a delta");
    assert.deepEqual(Object.keys(store.data.opinions), ["A.z"]);
    // a log gone (a checkout without it): its events go with it
    rmSync(F.log("Alice"));
    assert.equal(store.refresh()!.events, null);
    assert.deepEqual(Object.keys(store.data.opinions), []);
  } finally {
    F.done();
  }
});

test("names like __proto__, toString and constructor are declarations like any", () => {
  const F = folder();
  try {
    const store = new ReviewStore(F.root, ".visualproof");
    const names = ["__proto__", "toString", "constructor", "hasOwnProperty", "valueOf"];
    for (const name of names) ok(store.append(alice, { op: "opinion", name, by: "Alice", verdict: "approve", hash: `h-${name}` }, "tc"));
    ok(store.append(alice, { op: "target", name: "__proto__", by: "Alice", on: true }, "tc"));
    ok(store.append(alice, { op: "target", name: "constructor", by: "Alice", on: true }, "tc"));
    const check = (d: ReviewData, how: string) => {
      for (const name of names) assert.equal(statusOf(d, name, `h-${name}`), "approved", `${name}, ${how}`);
      assert.equal(Object.getPrototypeOf(d.opinions), null);
      assert.deepEqual(Object.keys(d.targets).sort(), ["__proto__", "constructor"]);
      assert.equal(Object.getPrototypeOf(d.targets), null);
      assert.equal(statusOf(d, "isPrototypeOf", "h"), "none", `a name nobody reviewed, ${how}`);
    };
    check(store.data, "as recorded");
    check(new ReviewStore(F.root, ".visualproof").data, "as replayed from the logs");
    check(reviewFromJson(JSON.parse(JSON.stringify(store.whole().data))), "as JSON carries it to a page");
    assert.equal(statusOf(emptyReview(), "toString", "h"), "none");
    assert.equal(Object.hasOwn(emptyReview().targets, "constructor"), false);
  } finally {
    F.done();
  }
});

test("what changed goes to pages as events: a page applying them holds the server's review", () => {
  const F = folder();
  try {
    const store = new ReviewStore(F.root, ".visualproof");
    const changes: ReviewChange[] = [];
    store.onChange = (c) => changes.push(JSON.parse(JSON.stringify(c)));
    // a page connects: the whole review once, as JSON
    let page = reviewState(store.whole());
    const take = (c: ReviewChange) => {
      if (c.epoch === page.epoch && c.rev <= page.rev) return "skipped";
      if (c.epoch !== page.epoch || c.base !== page.rev || !c.events) {
        page = reviewState(store.whole());
        return "whole";
      }
      for (const raw of c.events) {
        const e = readEvent(raw, (raw as { agent?: unknown }).agent === true);
        assert.ok(e !== null && typeof e !== "string");
        applyEvent(page.data, e);
      }
      page.rev = c.rev;
      return "delta";
    };
    const c1 = ok(store.append(alice, { op: "opinion", name: "toString", by: "Alice", verdict: "approve", hash: "h" }, "tc"));
    assert.deepEqual(c1.events?.map((e) => e.op), ["opinion"], "the new event alone");
    // the answer to the page's request and the event every page gets are the same change: once
    assert.equal(take(c1), "delta");
    assert.equal(take(changes.at(-1)!), "skipped");
    ok(store.append(claude, { op: "opinion", name: "X", by: "Claude", verdict: "comment", comment: "no", agent: true }, "tc"));
    ok(store.append(bob, { op: "target", name: "__proto__", by: "Bob", on: true }, "tc"));
    ok(store.append(bob, { op: "trust", prefix: "Q", by: "Bob", on: true }, "tc"));
    for (const c of changes.slice(1)) assert.equal(take(c), "delta");
    assert.equal(JSON.stringify(page.data), JSON.stringify(store.data));
    assert.ok(Object.hasOwn(page.data.targets, "__proto__"));
    // events from before (a pull of an older branch) come in between: the whole review
    writeFileSync(F.log("Dave"), line({ op: "opinion", name: "X", by: "Dave", verdict: "approve", at: "2020-01-01T00:00:00Z" }));
    const c = store.refresh()!;
    assert.equal(c.events, null);
    assert.equal(take(c), "whole");
    assert.equal(JSON.stringify(page.data), JSON.stringify(store.data));
    // a change missed (the page was away): the whole review, never a wrong one
    ok(store.append(alice, { op: "opinion", name: "Y", by: "Alice", verdict: "approve" }, "tc"));
    const last = ok(store.append(alice, { op: "opinion", name: "Z", by: "Alice", verdict: "approve" }, "tc"));
    assert.equal(take(last), "whole");
    assert.equal(JSON.stringify(page.data), JSON.stringify(store.data));
  } finally {
    F.done();
  }
});

test("a replay whole that comes to the review it replaced is a change of no events: no page reads the whole review for it", () => {
  const F = folder();
  try {
    const store = new ReviewStore(F.root, ".visualproof");
    ok(store.append(alice, { op: "opinion", name: "A.a", by: "Alice", verdict: "approve", hash: "k" }, "tc"));
    ok(store.append(bob, { op: "target", name: "A.t", by: "Bob", on: true }, "tc"));
    const before = { rev: store.rev, text: store.wholeText() };
    // a new graph's reading that binds nothing otherwise (server/live.ts, a build read): replayed
    // whole, the same review
    const c = store.setReading((e) => e);
    assert.deepEqual([c.base, c.rev, c.events], [before.rev, before.rev + 1, []]);
    assert.deepEqual({ ...JSON.parse(store.wholeText()), rev: before.rev }, JSON.parse(before.text));
    assert.equal(store.tag(), `"r${store.epoch}.${store.rev}"`, "the tag moves on with the revision");
    // a reading that changes what an opinion is bound to: the whole review
    const bound = store.setReading((e) => (e.op === "opinion" ? { ...e, hash: "v" } : e));
    assert.equal(bound.events, null);
    assert.equal(store.data.opinions["A.a"][0].hash, "v");
  } finally {
    F.done();
  }
});

/** The whole review as a page holds it after JSON (web/src/data.ts, reviewState). */
function reviewState(w: ReturnType<ReviewStore["whole"]>) {
  const j = JSON.parse(JSON.stringify(w));
  return { epoch: j.epoch as string, rev: j.rev as number, data: reviewFromJson(j.data) };
}
