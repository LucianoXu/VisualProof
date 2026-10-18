// An upright monitor with a mouse (PhoneSpec decisions 29–35, the owner's choice of 2026-10-18;
// web/src/monitor.ts): the board above a work area, where the panel is a pane at the left and the
// windows one column at its right, stacked from the top — source, reference, conversation. Its
// queries, and the work area's geometry: the order of the column, what fills the work area, the
// splitters, the reader's sizes within bounds.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { restack, sized, workArea } from "../src/web/src/monitor.ts";
import type { Docked } from "../src/web/src/monitor.ts";
import { MONITOR, SHEETED, TALL } from "../src/web/src/phone.ts";

const css = () => readFileSync(new URL("../src/web/style.css", import.meta.url), "utf8").replace(/\/\*[^]*?\*\//g, "");
const vp = { w: 1080, h: 1920 };
const win = (kind: Docked["kind"], collapsed = false, pillW = 220): Docked => ({ kind, collapsed, pillW });

test("an upright monitor is at least 1000 px wide, upright, under a mouse; a touch tablet keeps the tall page, and neither page is the other's", () => {
  assert.equal(MONITOR, "(min-width: 1000px) and (max-aspect-ratio: 5/6) and (pointer: fine)");
  const text = css();
  assert.ok(text.includes(`@media ${MONITOR} {`));
  // the tall page and the monitor's do not overlap: the tall screen is under a finger or below 1000 px
  assert.match(TALL, /\(pointer: coarse\)/);
  assert.match(TALL, /\(max-width: 999px\)/);
  assert.ok(SHEETED.includes(TALL));
  // and nothing of the prototypes is left: no option, no switch
  assert.ok(!text.includes("data-monitor") && !text.includes("#monitor-switch"));
  const code = readFileSync(new URL("../src/web/src/monitor.ts", import.meta.url), "utf8");
  assert.ok(!/[?&]monitor=|monitor-switch|monitorOption/.test(code));
});

test("the column stacks the windows from the top — the source, the reference, a conversation — whatever order they came in", () => {
  const a = workArea(vp, {}, true, [win("talk"), win("paper"), win("source")]);
  const [talk, paper, source] = a.wins;
  assert.ok(source.y < paper.y && paper.y < talk.y, "source, then reference, then conversation");
  // one column, at the panel's right, its whole width each; nothing overlaps
  assert.ok(a.panel && a.column);
  for (const r of a.wins) assert.deepEqual([r.x, r.w], [a.column!.x, a.column!.w]);
  assert.ok(a.panel!.x + a.panel!.w < a.column!.x);
  assert.equal(source.y + source.h + 8, paper.y);
  assert.equal(paper.y + paper.h + 8, talk.y);
  // the column's foot is the work area's
  assert.equal(talk.y + talk.h, a.column!.y + a.column!.h);
  // two source windows keep the order they came in
  const two = workArea(vp, {}, false, [win("source"), win("paper"), win("source")]);
  assert.ok(two.wins[0].y < two.wins[2].y && two.wins[2].y < two.wins[1].y);
});

test("what fills the work area: the panel alone its whole width, the column with no declaration selected, one window the column's height; nothing in it, no work area", () => {
  // the panel alone
  const pane = workArea(vp, {}, true, []);
  assert.deepEqual(pane.panel, { x: 12, y: 1920 - 12 - 960, w: 1056, h: 960 });
  assert.equal(pane.column, null);
  // windows and no declaration: the column, the work area's width
  const col = workArea(vp, {}, false, [win("source"), win("paper")]);
  assert.equal(col.panel, null);
  assert.deepEqual(col.column, { x: 12, y: 948, w: 1056, h: 960 });
  // one window alone: the column's whole height
  const one = workArea(vp, {}, true, [win("paper")]);
  assert.deepEqual(one.wins[0], one.column);
  // the panel and the column: the panel 30 % of the width, 380 px at least
  const both = workArea(vp, {}, true, [win("source")]);
  assert.equal(both.panel!.w, 380);
  assert.equal(both.column!.x, 12 + 380 + 8);
  // nothing in it: the board has the whole height, a collapsed window's pill at the screen's foot
  const none = workArea(vp, {}, false, [win("source", true)]);
  assert.equal(none.top, null);
  assert.deepEqual(none.wins[0], { x: 1068 - 220, y: 1920 - 12 - 34, w: 220, h: 34 });
  assert.deepEqual(none.splits, []);
  // a collapsed window beside open ones: its pill at the column's foot, under them
  const pills = workArea(vp, {}, true, [win("source"), win("paper", true)]);
  assert.ok(pills.wins[1].y > pills.wins[0].y + pills.wins[0].h);
});

test("the reference is the tallest, as a page of a PDF is read best; the reader's shares, height and width are kept within bounds", () => {
  const a = workArea(vp, {}, true, [win("source"), win("paper")]);
  assert.ok(a.wins[1].h > a.wins[0].h, "the reference taller than the source");
  // at 1080 × 1920 the reference window is 576 px tall and 668 wide: a page's width read at 0.95
  assert.ok(a.wins[1].h >= 560 && a.column!.w >= 660);
  const big = workArea({ w: 1440, h: 2560 }, {}, true, [win("source"), win("paper")]);
  assert.ok(big.wins[1].h >= 760 && big.column!.w >= 960);
  // the reader's sizes, within bounds: the work area a quarter of the screen at least, leaving the
  // board 420 px; the panel 320 px at least, leaving the column 360
  assert.equal(sized({ low: 0.05 }, vp).low, 480);
  assert.equal(sized({ low: 0.99 }, vp).low, 1500);
  assert.equal(sized({ panel: 100 }, vp).panel, 320);
  assert.equal(sized({ panel: 5000 }, vp).panel, 1080 - 24 - 8 - 360);
  // a splitter between two windows moves its share from one to the other, neither under 140 px
  const st = sized({}, vp).stack;
  const moved = restack(st, { kind: "source", h: 380 }, { kind: "paper", h: 572 }, 100);
  assert.ok(Math.abs(moved.source / (moved.source + moved.paper) - 480 / 952) < 1e-9);
  const least = restack(st, { kind: "source", h: 380 }, { kind: "paper", h: 572 }, -1000);
  assert.ok(Math.abs(least.source / (least.source + least.paper) - 140 / 952) < 1e-9);
  assert.equal(restack(st, { kind: "source", h: 300 }, { kind: "source", h: 300 }, 50), st, "two of a kind share alike");
});

test("the splitters: above the work area, between the panel and the column, between each two windows", () => {
  const a = workArea(vp, {}, true, [win("source"), win("paper"), win("talk")]);
  assert.deepEqual(a.splits.map((s) => s.kind), ["low", "panel", "stack", "stack"]);
  const [low, panel, s1, s2] = a.splits;
  assert.equal(low.rect.y + low.rect.h, a.top);
  assert.equal(panel.rect.x, a.panel!.x + a.panel!.w);
  assert.deepEqual(s1.between, [0, 1]);
  assert.deepEqual(s2.between, [1, 2]);
  assert.equal(s1.rect.y, a.wins[0].y + a.wins[0].h);
  // the panel alone has no splitter at its side
  assert.deepEqual(workArea(vp, {}, true, []).splits.map((s) => s.kind), ["low"]);
});
