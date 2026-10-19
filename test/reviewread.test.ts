// When the page reads the whole review again (web/src/reviewread.ts): where the event stream says
// the server holds another revision than the page's, one reading out at a time, and once more after
// it for what it did not bring.

import assert from "node:assert/strict";
import { test } from "node:test";
import { behind, WholeReview } from "../src/web/src/reviewread.ts";
import type { ReviewRev } from "../src/shared/review.ts";

/** A page holding `held`, a server whose readings the test answers one by one. */
function page(held: ReviewRev) {
  let now = held;
  const asked: ((r: ReviewRev | null) => void)[] = [];
  const read = () => new Promise<ReviewRev>((ok, fail) => asked.push((r) => (r ? ok(r) : fail(new Error("the server could not be reached")))));
  const w = new WholeReview(read, (r) => (now.epoch === r.epoch && r.rev <= now.rev ? undefined : (now = r)), () => now);
  /** the oldest reading out answered with `r` (null: it fails), and what follows it settled */
  const answer = async (r: ReviewRev | null) => {
    asked.shift()!(r);
    for (let k = 0; k < 5; k++) await Promise.resolve();
  };
  return { w, asked, answer, held: () => now };
}

test("behind: another run of the server, or an older revision", () => {
  assert.equal(behind({ epoch: "a", rev: 3 }, { epoch: "a", rev: 3 }), false);
  assert.equal(behind({ epoch: "a", rev: 4 }, { epoch: "a", rev: 3 }), false, "a delta came before the revision was said");
  assert.equal(behind({ epoch: "a", rev: 2 }, { epoch: "a", rev: 3 }), true);
  assert.equal(behind({ epoch: "a", rev: 9 }, { epoch: "b", rev: 1 }), true, "a restarted server counts again");
});

test("the page reads the whole review only where it holds another revision, one reading at a time, and once more for what the reading did not bring", async () => {
  const P = page({ epoch: "a", rev: 3 });
  // the stream opens on the revision the page loaded: nothing read
  P.w.told({ epoch: "a", rev: 3 });
  assert.equal(P.asked.length, 0);
  // the server holds a newer one: one reading; told again meanwhile, still one out
  P.w.told({ epoch: "a", rev: 5 });
  P.w.told({ epoch: "a", rev: 6 });
  P.w.told({ epoch: "a", rev: 7 });
  assert.equal(P.asked.length, 1);
  assert.equal(P.w.reading, true);
  // it brings 7, the newest said: no reading more
  await P.answer({ epoch: "a", rev: 7 });
  assert.deepEqual(P.held(), { epoch: "a", rev: 7 });
  assert.equal(P.asked.length, 0);
  assert.equal(P.w.reading, false);
  // told 9 while a reading out brings 8: one reading more, for 9
  P.w.told({ epoch: "a", rev: 8 });
  P.w.told({ epoch: "a", rev: 9 });
  await P.answer({ epoch: "a", rev: 8 });
  assert.equal(P.asked.length, 1);
  await P.answer({ epoch: "a", rev: 9 });
  assert.deepEqual(P.held(), { epoch: "a", rev: 9 });
  assert.equal(P.asked.length, 0);
  // a change the page cannot apply, while a reading is out: read again once it is back, whatever it brought
  P.w.told({ epoch: "b", rev: 1 });
  void P.w.fetch();
  assert.equal(P.asked.length, 1);
  await P.answer({ epoch: "b", rev: 1 });
  assert.equal(P.asked.length, 1);
  await P.answer({ epoch: "b", rev: 2 });
  assert.deepEqual(P.held(), { epoch: "b", rev: 2 });
  // a reading that fails is left there: no reading after it by itself, the next revision said reads
  P.w.told({ epoch: "b", rev: 3 });
  await P.answer(null);
  assert.equal(P.asked.length, 0);
  assert.equal(P.w.reading, false);
  P.w.told({ epoch: "b", rev: 3 });
  assert.equal(P.asked.length, 1);
  await P.answer({ epoch: "b", rev: 3 });
  assert.deepEqual(P.held(), { epoch: "b", rev: 3 });
});
