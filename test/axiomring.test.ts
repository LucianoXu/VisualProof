// An axiom is a ring (CanvasSpec, "Colour schemes and the legend", the owner's decision of
// 2026-10-18): which declarations are ringed, the ring's place among the marks the board draws round
// a point at every zoom, the page's dots and the legend that say it, and the artwork, which draws the
// board's own instances.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { makeArtwork, projectView } from "../src/server/artcmd.ts";
import type { Prepared } from "../src/server/pipeline.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { AXIOM_AT, AXIOM_GAP, AXIOM_OUT, AXIOM_W, kindDot, LIT, outside, pickRadius, ringed } from "../src/web/src/axiomring.ts";
import { KINDS } from "../src/web/src/canvas.ts";
import { Legend } from "../src/web/src/legend.ts";
import type { Scheme } from "../src/web/src/status.ts";
import { STATUSES } from "../src/web/src/status.ts";

test("an axiom is ringed, of the project or outside it; no other kind is", () => {
  for (const k of [...KINDS, "quot", "constructor", "recursor", "unknown"]) assert.equal(ringed(k), k === "axiom", k);
  // its dot on the page: its colour's class, the outside world's outside the project, and its ring
  assert.equal(kindDot("axiom", false), "k-axiom axiom");
  assert.equal(kindDot("axiom", true), "k-external axiom");
  assert.equal(kindDot("structure", false), "k-structure");
  assert.equal(kindDot("theorem", true), "k-external");
});

test("the ring stands apart from the point and from every mark round it, at every zoom", () => {
  // the renderer's ring offset is its middle past the point's edge: a gap, then its width
  assert.equal(AXIOM_AT, AXIOM_GAP + AXIOM_W / 2);
  assert.equal(AXIOM_OUT, AXIOM_GAP + AXIOM_W);
  assert.ok(AXIOM_GAP >= 1.5 && AXIOM_W >= 1.5, "seen at the smallest point");
  assert.equal(outside("structure"), 0, "nothing moves round another point");
  assert.equal(outside("axiom"), AXIOM_OUT);
  // the board's points, from the farthest zoom to the nearest (web/src/canvas.ts, dotPx)
  for (let dotR = 1.3; dotR <= 5; dotR += 0.1) {
    const ring = { in: dotR + AXIOM_GAP, out: dotR + AXIOM_OUT };
    const lit = { in: LIT * dotR + AXIOM_GAP, out: LIT * dotR + AXIOM_OUT };
    // the marks round a point, as the canvas draws them: the pointer's (2 px at +3.5), a pin's
    // (1 px at +2.5), a past build's (1.6 px at +2.2, a rename's 1.1 px at +4.4), each pushed out
    const marks = [
      { name: "the pointer's", mid: dotR + 3.5 + outside("axiom"), w: 2 },
      { name: "a pin's", mid: dotR + 2.5 + outside("axiom"), w: 1 },
      { name: "a change's", mid: dotR + 2.2 + outside("axiom"), w: 1.6 },
      { name: "a rename's", mid: dotR + 4.4 + outside("axiom"), w: 1.1 },
    ];
    for (const m of marks) assert.ok(m.mid - m.w / 2 >= ring.out + 0.5, `${m.name} clear of the ring at ${dotR.toFixed(1)} px`);
    // the selection's and the others' rings (2 and 2.5 px), round a lit point: clear of its ring
    const pick = pickRadius(dotR, "axiom");
    assert.ok(pick - 1.25 >= lit.out + 1, `the selection's ring clear of a lit axiom's at ${dotR.toFixed(1)} px`);
    assert.equal(pickRadius(dotR, "def"), Math.max(7, dotR + 4), "another point's as it was");
    // the gap is wider than nothing, and the ring is no wider than the point
    assert.ok(ring.in > dotR && lit.in > LIT * dotR);
    assert.ok(AXIOM_W <= 2 * dotR + 0.01);
  }
});

/** The legend drawn into a stand-in for its element, in `scheme`, open. */
function legend(scheme: Scheme, kinds: number[]): string {
  const el = { innerHTML: "", addEventListener() {} } as unknown as HTMLElement;
  const status = STATUSES.map(() => 1);
  new Legend(el, { scheme: () => scheme, setScheme() {}, counts: () => ({ status, kinds }), isOpen: () => true, setOpen() {}, keyEdges: () => false }).render();
  return el.innerHTML;
}

test("the legend says it: by kind, the axiom's own dot ringed; by status, a line of its own", () => {
  const kinds = [...KINDS, "external"].map((_, j) => j + 1);
  const byKind = legend("kind", kinds);
  assert.match(byKind, /<div class="lg-row" title="axiom: its point ringed, by kind and by status"><span class="dot k-axiom"><\/span><span class="lg-name">axiom<\/span>/);
  assert.doesNotMatch(byKind, /lg-ring/, "said by its row");
  const byStatus = legend("status", kinds);
  assert.match(byStatus, /<div class="lg-edge lg-ring" title="An axiom's point is ringed, by kind and by status"><span class="dot axiom"><\/span>ringed: an axiom<\/div>/);
  assert.doesNotMatch(byStatus, /k-axiom/, "no kind's colour by status");
});

/** A small project with an axiom of its own, a structure beside it, and Lean's `propext` outside. */
function prepared(dir: string): Prepared {
  const nodes: ViewNode[] = [
    { name: "N.ax", kind: "axiom", module: "M", ax: 0, hash: "hx" },
    { name: "N.s", kind: "structure", module: "M", ax: 0, hash: "hs" },
    { name: "N.t", kind: "theorem", module: "M", ax: 0, hash: "ht" },
    { name: "propext", kind: "axiom", module: "Init.Core", ax: 0, ext: true },
  ];
  const edges = new Int32Array([2, 0, SITE_STMT, 2, 1, SITE_STMT, 2, 3, SITE_STMT]);
  const meta: ViewMeta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "rings", root: dir, roots: ["M"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [{ name: "M", file: "M.lean", imports: [], compiled: null }],
    nodes,
    projectCount: 3,
    axioms: [],
    axiomSets: [[]],
    layouts: { namespace: computeLayout("namespace", nodes, edges), module: computeLayout("module", nodes, edges) } as Record<ClusterMode, Layout>,
    edgeCount: 3,
  };
  return { fingerprint: "f", cached: true, metaGz: gzipSync(JSON.stringify(meta)), edgesGz: gzipSync(Buffer.from(edges.buffer)), usage: null };
}

test("an artwork draws the board's rings: round the project's axiom in its colour, round one outside it in the outside world's; none round the structure", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-axiomring-"));
  try {
    for (const style of ["board", "cells", "stars"]) {
      const a = makeArtwork(prepared(dir), null, projectView(null), { recipe: { size: { w: 400, h: 300 }, names: { clusters: 0 }, style }, screen: { w: 1280, h: 800 }, name: null, root: dir });
      assert.ok("svg" in a, JSON.stringify(a.problems));
      const circles = [...a.svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"([^>]*)\/>/g)].map((m) => ({ x: +m[1], y: +m[2], r: +m[3], rest: m[4] }));
      // a ring alone, of the ring's width, round a point at its middle: one per axiom
      const rings = circles.filter((c) => /fill="none"/.test(c.rest) && new RegExp(`stroke-width="${AXIOM_W}"`).test(c.rest) && circles.some((d) => d !== c && d.x === c.x && d.y === c.y && d.r < c.r));
      assert.equal(rings.length, 2, `${style}: ${JSON.stringify(rings)}`);
      if (style === "board") {
        const own = rings.find((c) => /stroke="rgb\(255,55,95\)"/.test(c.rest));
        assert.ok(own, "the project's axiom: the Kind palette's axiom red");
        const dot = circles.find((d) => d.x === own.x && d.y === own.y && /fill="rgb\(255,55,95\)"/.test(d.rest))!;
        assert.ok(Math.abs(own.r - dot.r - AXIOM_AT) < 0.01, "a gap past its point, then the ring");
        assert.ok(rings.some((c) => /stroke="rgb\(174,174,178\)"/.test(c.rest)), "outside the project: the outside world's grey");
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
