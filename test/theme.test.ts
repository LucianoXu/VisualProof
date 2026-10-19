// The theme (web/src/theme.ts; CanvasSpec, "Zoom, theme and the ⋯ menu"): light, dark or as the
// system is, in force at once whoever changes it — the reader, the system while it is followed, an
// artwork's look, which holds it while its mode is on — and what draws in the theme's colours itself
// drawn again in the new ones, in either direction: the board's overview edges among them, whose
// drawing is kept while what they show is the same.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { cssTheme, SvgContext } from "../src/web/src/artwork.ts";
import { crowdFade, GraphCanvas, themeOf } from "../src/web/src/canvas.ts";

const css = readFileSync(join(import.meta.dirname, "../src/web/style.css"), "utf8");

/** Three namespaces, each using the one before: edges between clusters, which the overview draws. */
function board(): GraphCanvas {
  const nodes: ViewNode[] = [
    { name: "A.a", kind: "def", module: "M", ax: 0, hash: "1" },
    { name: "A.b", kind: "def", module: "M", ax: 0, hash: "2" },
    { name: "B.c", kind: "theorem", module: "M", ax: 0, hash: "3" },
    { name: "B.d", kind: "theorem", module: "M", ax: 0, hash: "4" },
    { name: "C.e", kind: "theorem", module: "M", ax: 0, hash: "5" },
  ];
  const edges = new Int32Array([2, 0, SITE_STMT, 3, 1, SITE_STMT, 4, 2, SITE_STMT, 4, 3, SITE_STMT]);
  const meta = { nodes, projectCount: 5, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: 4 } as unknown as ViewMeta;
  const g = new Graph(meta, edges);
  const none = () => {};
  const pen = new SvgContext((t) => t.length * 6, "sans-serif");
  const C = new GraphCanvas(null, null, null, g, { nodeClick: none, clusterClick: none, backgroundClick: none, hover: none, pinsChanged: none, foldChanged: none }, { w: 800, h: 600, theme: themeOf(cssTheme(css, false)), ctx: pen as unknown as CanvasRenderingContext2D });
  C.setGraph(g);
  C.setLayout(computeLayout("namespace", nodes, edges), { nodes: {}, clusters: {} }, [], "namespace");
  C.setShowExternals(true);
  const cam = C.fitCam({ x: 0, y: 0, w: 800, h: 600 });
  if (cam) C.jumpTo(cam);
  C.settle();
  return C;
}

/** The overview's edges as drawn: each end's colour, without its alpha. */
function overviewEnds(C: GraphCanvas): string[] {
  const L = C.gl.drawn().find((l) => l.name === "overview");
  assert.ok(L && L.count > 0, "the overview draws edges");
  const out = new Set<string>();
  const hex = (v: number) => Math.round(v * 255);
  for (let n = 0; n < L.count; n++) {
    const o = n * L.stride;
    out.add(`${hex(L.data[o + 12])},${hex(L.data[o + 13])},${hex(L.data[o + 14])}`);
    out.add(`${hex(L.data[o + 16])},${hex(L.data[o + 17])},${hex(L.data[o + 18])}`);
  }
  return [...out].sort();
}

const ends = (dark: boolean) => {
  const th = themeOf(cssTheme(css, dark));
  const rgb = (c: number[]) => c.slice(0, 3).map((v) => Math.round(v * 255)).join(",");
  return [rgb(th.edgeFrom), rgb(th.edgeTo)].sort();
};

test("the board's overview edges are drawn again in the new theme's colours, light to dark and back, though what they show is the same", () => {
  const C = board();
  assert.deepEqual(overviewEnds(C), ends(false));
  assert.notDeepEqual(ends(false), ends(true), "the themes' edges differ");
  C.setTheme(themeOf(cssTheme(css, true)));
  C.settle();
  assert.deepEqual(overviewEnds(C), ends(true), "light to dark");
  C.setTheme(themeOf(cssTheme(css, false)));
  C.settle();
  assert.deepEqual(overviewEnds(C), ends(false), "dark to light");
});

test("on the dark ground edges step back as they grow many, on the light one as they did; their ends saturated there", () => {
  const light = themeOf(cssTheme(css, false)), dark = themeOf(cssTheme(css, true));
  assert.equal(light.edgeCrowd, 0, "the light theme: nothing more");
  assert.ok(dark.edgeCrowd > 0);
  for (const n of [10, 100, 400, 2000, 50000]) assert.equal(crowdFade(n, 100, light.edgeCrowd), 1);
  // nothing below the number it starts from, then fainter the more there are, never nothing
  assert.equal(crowdFade(100, 100, dark.edgeCrowd), 1);
  assert.equal(crowdFade(40, 100, dark.edgeCrowd), 1);
  let was = 1;
  for (const n of [150, 313, 1000, 5000]) {
    const k = crowdFade(n, 100, dark.edgeCrowd);
    assert.ok(k < was && k > 0, `${n}: ${k}`);
    was = k;
  }
  assert.ok(Math.abs(crowdFade(400, 100, 0.5) - 0.5) < 1e-12);
  // the dark ends saturated, so that many mix into a colour: the paler blue before (#748ffc, 0.53)
  // mixed with its orange into a pink-white
  const sat = (c: number[]) => Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3));
  for (const k of ["edgeFrom", "edgeTo"] as const) assert.ok(sat(dark[k]) >= 0.6, `${k}: ${dark[k]}`);
});

test("the dark theme's overview of many edges is drawn fainter by its crowd, the light theme's as before", () => {
  // a board of many clusters and an edge between each two: past the overview's 400 bundles
  const nodes: ViewNode[] = [];
  const pairs: number[] = [];
  for (let c = 0; c < 40; c++) for (let j = 0; j < 2; j++) nodes.push({ name: `N${c}.d${j}`, kind: "def", module: "M", ax: 0, hash: `${c}.${j}` });
  for (let a = 0; a < 40; a++) for (let b = 0; b < a; b++) pairs.push(2 * a, 2 * b + 1, SITE_STMT);
  const edges = new Int32Array(pairs);
  const g = new Graph({ nodes, projectCount: nodes.length, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: pairs.length / 3 } as unknown as ViewMeta, edges);
  const drawn = (dark: boolean, crowd?: number) => {
    const none = () => {};
    const th = themeOf(cssTheme(css, dark));
    if (crowd !== undefined) th.edgeCrowd = crowd;
    const C = new GraphCanvas(null, null, null, g, { nodeClick: none, clusterClick: none, backgroundClick: none, hover: none, pinsChanged: none, foldChanged: none }, { w: 1600, h: 1000, theme: th, ctx: new SvgContext((t) => t.length * 6, "sans-serif") as unknown as CanvasRenderingContext2D });
    C.setGraph(g);
    C.setLayout(computeLayout("namespace", nodes, edges), { nodes: {}, clusters: {} }, [], "namespace");
    C.setShowExternals(true);
    const cam = C.fitCam({ x: 0, y: 0, w: 1600, h: 1000 });
    if (cam) C.jumpTo(cam);
    C.settle();
    const L = C.gl.drawn().find((l) => l.name === "overview")!;
    const alphas: number[] = [];
    for (let n = 0; n < L.count; n++) alphas.push(L.data[n * L.stride + 15]);
    return alphas;
  };
  const plain = drawn(true, 0), stepped = drawn(true);
  assert.ok(plain.length > 400, `${plain.length} bundles`);
  assert.equal(stepped.length, plain.length, "the same edges");
  const k = crowdFade(plain.length, 400, themeOf(cssTheme(css, true)).edgeCrowd);
  assert.ok(k < 1);
  stepped.forEach((a, j) => assert.ok(Math.abs(a - plain[j] * k) < 1e-6, `bundle ${j}`));
  assert.deepEqual(drawn(false), drawn(false, 0), "the light theme's as before");
});

test("reduced motion: one rule ends every transition and animation on the page at once, the flashes that say something held; the camera jumps where it would glide", () => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...text.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?\})\s*\}/g)].map((m) => m[1]);
  const all = blocks.filter((b) => /^\s*\*, \*::before, \*::after \{/.test(b));
  assert.equal(all.length, 1, "one page-wide rule");
  for (const d of ["transition-duration: 0s !important", "transition-delay: 0s !important", "animation-duration: 1ms !important", "animation-iteration-count: 1 !important", "scroll-behavior: auto !important"]) assert.ok(all[0].includes(d), d);
  // what an animation says is said still: a flash held a moment, the export's bar standing
  assert.ok(blocks.some((b) => /\.rv-flash[^{]*\{[^}]*animation-duration: 4s !important/.test(b)));
  assert.ok(blocks.some((b) => /\.ex-bar i \{[^}]*animation: none !important/.test(b)));
  // the camera: there at once with reduced motion, gliding without it
  const g = globalThis as Record<string, unknown>;
  const was = { matchMedia: g.matchMedia, requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame };
  const frames: (() => void)[] = [];
  let reduce = true;
  g.matchMedia = (q: string) => ({ matches: q.includes("reduced-motion") && reduce });
  g.requestAnimationFrame = (f: () => void) => frames.push(f);
  g.cancelAnimationFrame = () => {};
  try {
    const C = board();
    const goal = { x: C.cam.x + 300, y: C.cam.y - 200, k: C.cam.k * 2 };
    C.glideTo(goal, 520);
    assert.deepEqual(C.cam, goal, "there at once");
    assert.equal(frames.length, 0, "no frame asked for");
    reduce = false;
    const back = { x: goal.x - 300, y: goal.y + 200, k: goal.k / 2 };
    C.glideTo(back, 520);
    assert.deepEqual(C.cam, goal, "gliding: not there yet");
    assert.equal(frames.length, 1);
  } finally {
    Object.assign(g, was);
  }
});

/** A stand-in for the browser theme.ts runs in: <html>'s data-theme, the system's preference (which
 *  the test changes), the stored choice, and a MutationObserver that sees data-theme being set. */
function browser() {
  const watchers: (() => void)[] = [];
  const dataset = new Proxy({} as Record<string, string>, {
    set(t, k: string, v: string) {
      t[k] = v;
      if (k === "theme") queueMicrotask(() => watchers.forEach((f) => f()));
      return true;
    },
  });
  const os = { matches: false, listeners: [] as (() => void)[] };
  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g.document = { documentElement: { dataset } };
  g.matchMedia = () => ({ get matches() { return os.matches; }, addEventListener: (_: string, f: () => void) => os.listeners.push(f) });
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  g.MutationObserver = class {
    f: () => void;
    constructor(f: () => void) {
      this.f = f;
    }
    observe() {
      watchers.push(() => this.f());
    }
  };
  return {
    dataset,
    /** the system turns dark or light */
    system: (dark: boolean) => {
      os.matches = dark;
      os.listeners.forEach((f) => f());
    },
  };
}

test("the theme follows whoever changes it: the reader's choice, the system's under As the system, an artwork's look held over both; what draws in its colours is told of each change, once", async () => {
  const b = browser();
  // a module of its own, in the stand-in browser: the board's import of it above ran without one
  const fresh = new URL("../src/web/src/theme.ts?browser", import.meta.url).href;
  const T = (await import(fresh)) as typeof import("../src/web/src/theme.ts");
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const told: string[] = [];
  T.applyTheme();
  T.onThemeChange(() => told.push(b.dataset.theme));
  assert.equal(T.themeChoice(), "light", "light by default");
  assert.equal(b.dataset.theme, "light");
  // the reader's choice, in either direction
  T.setTheme("dark");
  await tick();
  T.setTheme("light");
  await tick();
  assert.deepEqual(told, ["dark", "light"]);
  // the system's is followed only under As the system, both ways
  b.system(true);
  await tick();
  assert.equal(b.dataset.theme, "light", "the reader chose light");
  T.setTheme("system");
  await tick();
  assert.equal(b.dataset.theme, "dark");
  b.system(false);
  await tick();
  assert.equal(b.dataset.theme, "light");
  b.system(true);
  await tick();
  assert.deepEqual(told, ["dark", "light", "dark", "light", "dark"]);
  // an artwork's look holds its theme: the system changing does not undo it, nor does the reader's
  // choice; let go, the choice is in force again (here the system's, which changed meanwhile)
  T.holdTheme("light");
  await tick();
  b.system(true);
  T.setTheme("dark");
  await tick();
  assert.equal(b.dataset.theme, "light", "held");
  T.setTheme("system");
  b.system(false);
  b.system(true);
  await tick();
  T.holdTheme(null);
  await tick();
  assert.equal(b.dataset.theme, "dark");
  // the same theme set again is no change
  b.dataset.theme = "dark";
  await tick();
  assert.deepEqual(told, ["dark", "light", "dark", "light", "dark", "light", "dark"]);
});
