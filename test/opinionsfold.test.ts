// The opinions in a review box fold all or nothing (ReviewSpec, "One review box", the owner's
// decision of 2026-10-20): folded, a line for each person's current opinion — who, what, when,
// stale — and no text; shown, every opinion in full, the earlier and withdrawn ones after them; one
// toggle at their head, the reader's own, the same in the panel and every source window. The agents'
// advice folds with them; "What changed" under a stale opinion keeps its own toggle either way.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewMeta } from "../src/shared/graph.ts";
import { emptyReview, record } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { ReviewBox } from "../src/web/src/reviewbox.ts";
import type { ReviewHooks } from "../src/web/src/reviewbox.ts";
import { setPeople } from "../src/web/src/verified.ts";

const at = (k: number) => new Date(Date.UTC(2026, 9, 20, 9, 0, k)).toISOString();

function world() {
  setPeople([]);
  const meta = {
    nodes: [
      { name: "N.a", kind: "def", module: "N", ax: 0, hash: "h2" },
      { name: "N.b", kind: "def", module: "N", ax: 0, hash: "b1" },
    ],
    projectCount: 2,
    axioms: [],
    axiomSets: [[]],
    layouts: {},
    edgeCount: 0,
  } as unknown as ViewMeta;
  const g = new Graph(meta, new Int32Array(0));
  const d = emptyReview();
  // Olivia approved, then commented; Bob approved an earlier version, his text recorded; Carol
  // approved and withdrew it; an agent comments
  record(d, { op: "opinion", name: "N.a", by: "Olivia", verdict: "approve", hash: "h2", comment: "fine" }, "tc", at(1));
  record(d, { op: "opinion", name: "N.a", by: "Olivia", verdict: "comment", hash: "h2", comment: "why **0**?" }, "tc", at(2));
  record(d, { op: "opinion", name: "N.a", by: "Bob", verdict: "approve", hash: "h1", text: "def a := 0" }, "tc", at(3));
  record(d, { op: "opinion", name: "N.a", by: "Carol", verdict: "approve", hash: "h2" }, "tc", at(4));
  record(d, { op: "withdraw", name: "N.a", by: "Carol" }, "tc", at(5));
  record(d, { op: "opinion", name: "N.a", by: "Claude", verdict: "comment", hash: "h2", comment: "look at the base case", agent: true }, "tc", at(6));
  let shown = true;
  const asked: boolean[] = [];
  const hooks = {
    review: () => ({ data: d, error: null, blocked: null, readOnly: false, reviewer: "Olivia" }),
    ensureReviewer: async () => "Olivia",
    submit: async () => null,
    editedNow: () => false,
    edited: async () => false,
    textNow: () => ({ text: "def a := 1", edited: false }),
    reviewRoot: () => null,
    go: () => {},
    opinionsShown: () => shown,
    showOpinions: (on: boolean) => {
      asked.push(on);
      shown = on;
    },
  } as unknown as ReviewHooks;
  return { g, d, box: new ReviewBox(g, hooks), asked, setShown: (on: boolean) => (shown = on) };
}

/** Each opinion row of a box: who, what, its classes, whether its text is there. */
const rows = (html: string) =>
  [...html.matchAll(/<div class="(rv-op|rv-adv) ([^"]*)" data-rv-(?:op|wd)="[^"]*">(?:<span class="rv-dot"><\/span>)?<b>([^<]*)<\/b>/g)].map((m) => `${m[3]} ${m[2].split(" ").filter((c) => c !== "rv-approve" && c !== "rv-comment" && !c.startsWith("rv-adv-")).join(" ")}`.trim());

test("shown: every opinion in full, the earlier and withdrawn ones after them, the advice in full; Fold all at their head", () => {
  const { box } = world();
  const html = box.html(0);
  assert.match(html, /<div class="rv-ops-h"><span class="rv-ops-n">Opinions <b>2<\/b> <span class="muted">· 2 earlier, 1 withdrawn<\/span><\/span><button type="button" class="rv-fold" data-rv-fold aria-expanded="true"[^>]*>Fold all<\/button><\/div>/);
  // the current ones, then Earlier: Olivia's approval, Carol's withdrawn and her withdrawal; the advice
  assert.deepEqual(rows(html), ["Olivia", "Bob old", "Olivia", "Carol withdrawn", "Carol rv-wd", "Claude (agent)"]);
  assert.match(html, /<div class="rv-hist"><div class="rv-hist-h">Earlier<\/div>/);
  assert.match(html, /why <b>0<\/b>\?/, "a comment's text");
  assert.match(html, /look at the base case/, "the advice's");
  assert.match(html, /data-rv-quote=/);
  assert.match(html, /· on an earlier version/);
  // What changed under the stale one, with its own toggle
  assert.match(html, /<details class="rv-changes" data-rv-changes=/);
});

test("folded: a line for each person's current opinion — who, what, when, stale —, no text, no history; the advice in a line too; What changed keeps its toggle", () => {
  const { box, setShown } = world();
  setShown(false);
  const html = box.html(0);
  assert.match(html, /<button type="button" class="rv-fold" data-rv-fold aria-expanded="false"[^>]*>Show all<\/button>/);
  assert.match(html, /· 2 earlier, 1 withdrawn/, "the head still counts what came before");
  assert.deepEqual(rows(html), ["Olivia rv-line", "Bob old rv-line", "Claude (agent) rv-line"]);
  assert.doesNotMatch(html, /why <b>0<\/b>/);
  assert.doesNotMatch(html, /look at the base case/);
  assert.doesNotMatch(html, /data-rv-quote=/, "nothing to quote is shown");
  assert.doesNotMatch(html, /rv-hist/);
  assert.match(html, /<b>Bob<\/b> approved <span class="muted">· [^<]*· stale<\/span>/);
  assert.match(html, /<details class="rv-changes" data-rv-changes=/);
  // the reader's own still has Withdraw beside it
  assert.match(html, /data-rv-withdraw data-rv-by="Olivia"(?! hidden)/);
});

test("the toggle: one click folds or shows them all, as the reader keeps it; a quoted opinion gone to shows them", () => {
  const { box, asked, setShown } = world();
  const root = { querySelector: () => null, querySelectorAll: () => [] } as unknown as HTMLElement;
  const press = (sel: string) => ({ closest: (q: string) => (q === sel ? {} : null) }) as unknown as HTMLElement;
  assert.equal(box.click(press("[data-rv-fold]"), 0, root), true);
  assert.deepEqual(asked, [false]);
  assert.equal(box.click(press("[data-rv-fold]"), 0, root), true);
  assert.deepEqual(asked, [false, true]);
  // folded, a quote of an earlier opinion followed: everything is shown, the earlier ones among it
  setShown(false);
  box.jump({ kind: "opinion", name: "N.a", by: "Olivia", at: at(1) }, 0, root);
  assert.deepEqual(asked, [false, true, true]);
});

test("nothing said yet: no toggle", () => {
  const { box } = world();
  const html = box.html(1);
  assert.match(html, /<span class="rv-ops-n">No opinions yet<\/span><\/div>/);
  assert.doesNotMatch(html, /data-rv-fold/);
});
