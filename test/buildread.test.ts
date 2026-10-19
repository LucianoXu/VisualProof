// How the build status travels (the owner's decision of 2026-10-19): a change is the files whose
// status changed (shared/build.ts, buildChanges), which a page applies to the revision it holds
// (applyBuildDelta); and when the page reads the whole status again (web/src/buildread.ts): where the
// stream says a revision it does not hold, or a change it cannot apply, one reading out at a time,
// the changes that come meanwhile applied to what it brings.

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBuildDelta, buildChanges } from "../src/shared/build.ts";
import type { BuildDelta, BuildStatus, BuildWhole, FileState, FileStatus } from "../src/shared/build.ts";
import { behindBuild, LiveBuild, MAX_WAITING } from "../src/web/src/buildread.ts";

const file = (module: string, state: FileState = "ok", more: Partial<FileStatus> = {}): FileStatus => ({ module, file: `${module.replace(/\./g, "/")}.lean`, state, warnings: 0, ...more });
const counts = (files: FileStatus[]) => {
  const c = { ok: 0, sorry: 0, failed: 0, unbuilt: 0, building: 0, queued: 0, stale: 0, blocked: 0 } as Record<FileState, number>;
  for (const f of files) c[f.state]++;
  return c;
};
const status = (files: FileStatus[], active = false): BuildStatus => ({ active, progress: active ? { done: 0, total: files.length, current: [] } : null, files, counts: counts(files) });
/** the delta the server sends from `sent` to `next` (server/live.ts, buildFound) */
const deltaOf = (sent: Map<string, string>, next: BuildStatus, epoch: string, base: number): { d: BuildDelta; texts: Map<string, string> } => {
  const { files, gone, texts } = buildChanges(sent, next);
  return { d: { epoch, base, rev: base + 1, active: next.active, progress: next.progress, counts: next.counts, files, gone }, texts };
};
/** a status as a set of files, whatever their order */
const bySet = (s: BuildStatus | null) => s && { ...s, files: [...s.files].sort((a, b) => (a.module < b.module ? -1 : 1)) };

test("a change is the files whose status changed or that are new, and the modules gone; applied, it gives the status as the server holds it", () => {
  const a = status([file("A"), file("B", "stale", { because: ["A"] }), file("C")]);
  const first = deltaOf(new Map(), a, "e", 0);
  assert.equal(first.d.files.length, 3, "the first look: every file is new");
  let held: BuildWhole = applyBuildDelta({ epoch: "e", rev: 0, status: null }, first.d)!;
  assert.deepEqual(held, { epoch: "e", rev: 1, status: a });
  // A builds, B is queued behind it, C is gone, D is new
  const b = status([file("A", "building"), file("B", "queued", { because: ["A"] }), file("D")], true);
  const second = deltaOf(first.texts, b, "e", 1);
  assert.deepEqual(second.d.files.map((f) => f.module), ["A", "B", "D"]);
  assert.deepEqual(second.d.gone, ["C"]);
  held = applyBuildDelta(held, second.d)!;
  assert.deepEqual(held.status, b, "replaced where they were, the new one at the end");
  assert.equal(held.rev, 2);
  // a change of one file carries that file alone, and the rest whole
  const c = status([file("A", "ok", { builtAt: 5 }), file("B", "queued", { because: ["A"] }), file("D")], true);
  const third = deltaOf(second.texts, c, "e", 2);
  assert.deepEqual(third.d.files, [c.files[0]]);
  assert.deepEqual(third.d.counts, c.counts);
  assert.deepEqual(applyBuildDelta(held, third.d)!.status, c);
  // nothing changed: no file
  assert.deepEqual(deltaOf(third.texts, c, "e", 3).d.files, []);
  // a change of another revision, or of another run of the server's, is not applied
  assert.equal(applyBuildDelta(held, { ...third.d, base: 1 }), null);
  assert.equal(applyBuildDelta(held, { ...third.d, epoch: "other" }), null);
});

test("applied one after the other, the changes keep the page's status the server's, whatever the files do", () => {
  // a pseudo-random walk of a project's files: states, warnings, files appearing and going
  let seed = 7;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const states: FileState[] = ["ok", "sorry", "failed", "unbuilt", "building", "queued", "stale", "blocked"];
  let files = Array.from({ length: 40 }, (_, k) => file(`M.F${k}`));
  let sent = new Map<string, string>();
  let held: BuildWhole = { epoch: "e", rev: 0, status: null };
  for (let rev = 0; rev < 200; rev++) {
    files = files.flatMap((f) => (rnd(50) === 0 ? [] : [rnd(4) === 0 ? { ...f, state: states[rnd(states.length)], warnings: rnd(3), ...(rnd(2) ? { because: [`M.F${rnd(40)}`] } : {}) } : f]));
    if (rnd(5) === 0) files.push(file(`M.N${rev}`, "unbuilt"));
    const next = status(files, rnd(2) === 0);
    const d = deltaOf(sent, next, "e", rev);
    sent = d.texts;
    held = applyBuildDelta(held, d.d)!;
    assert.deepEqual(bySet(held.status), bySet(next), `revision ${rev + 1}`);
  }
});

test("behindBuild: another run of the server, or an older revision", () => {
  assert.equal(behindBuild({ epoch: "a", rev: 3 }, { epoch: "a", rev: 3 }), false);
  assert.equal(behindBuild({ epoch: "a", rev: 4 }, { epoch: "a", rev: 3 }), false, "the reading brought a newer one than the stream said");
  assert.equal(behindBuild({ epoch: "a", rev: 2 }, { epoch: "a", rev: 3 }), true);
  assert.equal(behindBuild({ epoch: "a", rev: 9 }, { epoch: "b", rev: 1 }), true, "a restarted server counts again");
});

/** A page, and a server whose readings the test answers one by one. */
function page() {
  const asked: ((w: BuildWhole | null) => void)[] = [];
  const shown: (BuildStatus | null)[] = [];
  const read = () => new Promise<BuildWhole>((ok, fail) => asked.push((w) => (w ? ok(w) : fail(new Error("the server could not be reached")))));
  const b = new LiveBuild(read, (s) => shown.push(s));
  /** the oldest reading out answered with `w` (null: it fails), and what follows it settled */
  const answer = async (w: BuildWhole | null) => {
    asked.shift()!(w);
    for (let k = 0; k < 10; k++) await Promise.resolve();
  };
  return { b, asked, shown, answer };
}

/** A server's statuses, revision by revision, and the changes between them. */
function server(epoch: string) {
  const whole: BuildWhole[] = [{ epoch, rev: 0, status: null }];
  const deltas: BuildDelta[] = [];
  let sent = new Map<string, string>();
  const next = (s: BuildStatus) => {
    const d = deltaOf(sent, s, epoch, whole.length - 1);
    sent = d.texts;
    deltas.push(d.d);
    whole.push({ epoch, rev: whole.length, status: s });
    return d.d;
  };
  return { whole, deltas, next };
}

const S1 = status([file("A"), file("B")]);
const S2 = status([file("A", "building"), file("B", "queued", { because: ["A"] })], true);
const S3 = status([file("A", "ok", { builtAt: 9 }), file("B", "building")], true);
const S4 = status([file("A", "ok", { builtAt: 9 }), file("B", "ok", { builtAt: 10 })]);

test("the page reads the whole status where the stream says a revision it does not hold, applies the changes after, and reads again where it missed one", async () => {
  const P = page();
  const srv = server("e");
  srv.next(S1);
  // the stream opens on revision 1: the page holds none, and reads it
  P.b.told({ epoch: "e", rev: 1 });
  assert.equal(P.asked.length, 1);
  await P.answer(srv.whole[1]);
  assert.deepEqual(P.shown, [S1]);
  // told the revision it holds (a reconnection): nothing read
  P.b.told({ epoch: "e", rev: 1 });
  assert.equal(P.asked.length, 0);
  // changes, applied as they come
  P.b.delta(srv.next(S2));
  P.b.delta(srv.next(S3));
  assert.deepEqual(P.shown.at(-1), S3);
  assert.deepEqual(P.b.rev, { epoch: "e", rev: 3 });
  assert.equal(P.asked.length, 0, "no reading");
  // one missed: the next cannot be applied, and the whole is read
  srv.next(S4);
  const after = srv.next(S1);
  P.b.delta(after);
  assert.equal(P.asked.length, 1);
  await P.answer(srv.whole[5]);
  assert.deepEqual(P.shown.at(-1), S1);
  assert.deepEqual(P.b.rev, { epoch: "e", rev: 5 });
  // a change the page holds already (the reading brought it): let go
  const shown = P.shown.length;
  P.b.delta(after);
  assert.equal(P.shown.length, shown);
  // another run of the server's: read again
  const other = server("f");
  other.next(S2);
  P.b.told({ epoch: "f", rev: 1 });
  assert.equal(P.asked.length, 1);
  await P.answer(other.whole[1]);
  assert.deepEqual(P.shown.at(-1), S2);
});

test("the changes that come while a reading is out are applied to what it brings, those it brought let go; a gap among them reads again", async () => {
  const P = page();
  const srv = server("e");
  srv.next(S1);
  P.b.told({ epoch: "e", rev: 1 });
  // while the reading is out, two changes come, and the server is told at 3
  const d2 = srv.next(S2), d3 = srv.next(S3);
  P.b.delta(d2);
  P.b.delta(d3);
  P.b.told({ epoch: "e", rev: 3 });
  assert.equal(P.asked.length, 1, "one reading out");
  // it brings revision 2 (the server answered between the two changes): 3 is applied on it
  await P.answer(srv.whole[2]);
  assert.deepEqual(P.b.rev, { epoch: "e", rev: 3 });
  assert.deepEqual(P.shown, [S3], "shown once, as it is after the changes");
  assert.equal(P.asked.length, 0, "no reading more: it holds what it was told");
  // it brings a newer revision than the changes kept: they are let go
  const d4 = srv.next(S4);
  P.b.delta({ ...d4, base: 99, rev: 100 });
  assert.equal(P.asked.length, 1, "a change it cannot apply");
  P.b.delta(d4);
  await P.answer(srv.whole[4]);
  assert.deepEqual(P.shown.at(-1), S4);
  assert.equal(P.asked.length, 0);
  // a gap among the changes kept: read again once it is back
  srv.next(S1);
  const d6 = srv.next(S2), d7 = srv.next(S3);
  P.b.told({ epoch: "x", rev: 1 });
  assert.equal(P.asked.length, 1);
  P.b.delta(d7);
  await P.answer(srv.whole[5]);
  assert.equal(P.asked.length, 1, "revision 6 was not kept: read again");
  P.b.delta(d6);
  P.b.delta(d7);
  await P.answer(srv.whole[7]);
  assert.deepEqual(P.shown.at(-1), S3);
  assert.equal(P.asked.length, 0);
});

test("told, while a reading is out, a revision that neither it nor the changes kept reach (a change sent as no delta): one reading more", async () => {
  const P = page();
  const srv = server("e");
  srv.next(S1);
  srv.next(S2);
  P.b.told({ epoch: "e", rev: 1 });
  P.b.told({ epoch: "e", rev: 2 });
  await P.answer(srv.whole[1]);
  assert.equal(P.asked.length, 1);
  await P.answer(srv.whole[2]);
  assert.equal(P.asked.length, 0);
  assert.deepEqual(P.shown, [S1, S2]);
});

test("a reading that fails is left: the changes kept are applied where they follow, and the next one it cannot apply reads again", async () => {
  const P = page();
  const srv = server("e");
  srv.next(S1);
  P.b.told({ epoch: "e", rev: 1 });
  await P.answer(srv.whole[1]);
  // a reading asked (a revision of another run said), which fails, while a change of this run comes
  P.b.told({ epoch: "x", rev: 1 });
  P.b.delta(srv.next(S2));
  await P.answer(null);
  assert.deepEqual(P.shown.at(-1), S2, "the change kept follows what the page holds");
  assert.equal(P.asked.length, 0, "no reading by itself");
  srv.next(S3);
  P.b.delta(srv.next(S4));
  assert.equal(P.asked.length, 1, "the next change it cannot apply reads");
  await P.answer(srv.whole[4]);
  assert.deepEqual(P.shown.at(-1), S4);
});

test("more changes than are kept while a reading is out: it reads once more", async () => {
  const P = page();
  const srv = server("e");
  srv.next(S1);
  P.b.told({ epoch: "e", rev: 1 });
  for (let k = 0; k <= MAX_WAITING; k++) P.b.delta(srv.next(k % 2 ? S2 : S3));
  await P.answer(srv.whole[1]);
  assert.equal(P.asked.length, 1);
  await P.answer(srv.whole.at(-1)!);
  assert.deepEqual(P.b.rev, { epoch: "e", rev: srv.whole.length - 1 });
});

test("a server from before 0.6.0 sends the status whole at every change: taken as it comes, and a reading out then does not undo it", async () => {
  const P = page();
  const srv = server("e");
  srv.next(S1);
  P.b.told({ epoch: "e", rev: 1 });
  // the server is stepped back meanwhile: the old one sends the whole
  P.b.whole(S2);
  assert.deepEqual(P.shown, [S2]);
  await P.answer(srv.whole[1]);
  assert.deepEqual(P.shown, [S2], "what the reading brought is another server's");
  P.b.whole(S3);
  assert.deepEqual(P.b.status, S3);
});
