// The artwork command (ExportSpec decision 21): the board's drawing run without a browser — colours
// read without one, the theme from the style sheet, the renderer kept to its data — and the command
// itself, from a recipe to an SVG and a PNG, the same bytes every time, problems said with status 1.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { makeArtwork, pngOf, projectView } from "../src/server/artcmd.ts";
import type { Prepared } from "../src/server/pipeline.ts";
import type { ClusterMode, Layout, RawGraph, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { cssTheme } from "../src/web/src/artwork.ts";
import { themeOf } from "../src/web/src/canvas.ts";
import { parseColour, rgba } from "../src/web/src/gl/gl.ts";
import { Renderer } from "../src/web/src/gl/renderer.ts";

const ROOT = join(import.meta.dirname, "..");
const near = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) < 1e-6);

test("a colour is read without a browser as a canvas reads it: hex, rgb, hsl, a few names; anything else transparent", () => {
  assert.ok(near(parseColour("#fff"), [1, 1, 1, 1]));
  assert.ok(near(parseColour("#00000080"), [0, 0, 0, 128 / 255]));
  assert.ok(near(parseColour("#1a2b3c"), [0x1a / 255, 0x2b / 255, 0x3c / 255, 1]));
  assert.ok(near(parseColour("rgba(255, 128, 0, 0.5)"), [1, 128 / 255, 0, 128 / 255]));
  assert.ok(near(parseColour("rgb(100% 0% 0% / 25%)"), [1, 0, 0, 64 / 255]));
  assert.ok(near(parseColour("hsl(120, 100%, 50%)"), [0, 1, 0, 1]));
  assert.ok(near(parseColour("white"), [1, 1, 1, 1]));
  assert.ok(near(parseColour("transparent"), [0, 0, 0, 0]));
  for (const bad of ["", "nonsense", "#12", "rgb(a, b, c)", "color-mix(in srgb, red 50%, blue)"]) assert.deepEqual(parseColour(bad), [0, 0, 0, 0], bad);
  // the page's own entry, where there is no document
  assert.deepEqual(rgba("#ff0000", 0.5), [1, 0, 0, 0.5]);
});

test("the theme from the style sheet: :root, the dark theme over it, var() followed, comments left out", () => {
  const css = `/* a comment { --x: 1 } */ :root { --a: #111; --b: var(--a); --c: var(--nope, #222); }
    .other { --a: red; } :root[data-theme="dark"] { --a: #eee; }`;
  const light = cssTheme(css, false), dark = cssTheme(css, true);
  assert.deepEqual([light("--a"), light("--b"), light("--c"), light("--x")], ["#111", "#111", "#222", ""]);
  assert.deepEqual([dark("--a"), dark("--b")], ["#eee", "#eee"]);
  // the page's own: every colour the board draws in is one a canvas reads
  const style = readFileSync(join(ROOT, "src", "web", "style.css"), "utf8");
  for (const dark of [false, true]) {
    const th = themeOf(cssTheme(style, dark));
    for (const c of [th.bg, th.disc, th.discLine, th.edgeFrom, th.edgeTo, th.lit, th.ext, ...Object.values(th.kind), ...th.status]) assert.ok(c[3] > 0, `${dark ? "dark" : "light"}: ${JSON.stringify(c)}`);
    assert.ok(th.label.length > 0 && th.star.length > 0);
  }
  assert.notDeepEqual(themeOf(cssTheme(style, false)).bg, themeOf(cssTheme(style, true)).bg, "light and dark differ");
});

test("a renderer given no canvas keeps its layers' instances, which an artwork reads, and draws nothing", () => {
  const R = new Renderer(null);
  const L = R.layer("dots", "points");
  const o = L.push();
  L.data.set([1, 2, 3, 0], o);
  R.setPositions(new Float32Array([0, 0]));
  R.render({ x: 0, y: 0, k: 1 }, 100, 100, 1, 3);
  assert.equal(R.maxSide(), 16384);
  const drawn = R.drawn();
  assert.deepEqual(drawn.map((d) => [d.name, d.kind, d.count]), [["dots", "points", 1]]);
  assert.deepEqual([...drawn[0].data.subarray(0, 4)], [1, 2, 3, 0]);
});

/** A small project's build as the pipeline prepares it: N.a, N.b using it, N.t (a theorem) using
 *  N.b, all in namespace N, and Nat outside. */
function prepared(dir: string): Prepared {
  const nodes: ViewNode[] = [
    { name: "N.a", kind: "def", module: "M", ax: 0, hash: "ha" },
    { name: "N.b", kind: "def", module: "M", ax: 0, hash: "hb" },
    { name: "N.t", kind: "theorem", module: "M", ax: 0, hash: "ht" },
    { name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0, ext: true },
  ];
  const edges = new Int32Array([1, 0, SITE_STMT, 2, 1, SITE_STMT, 0, 3, SITE_STMT]);
  const meta: ViewMeta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: dir, roots: ["M"], toolchain: "tc", extractedAt: "", extractMs: 1 },
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

const RECIPE = { size: { w: 400, h: 300 }, border: true, names: { clusters: 1 }, targets: ["N.t"], selection: { name: "N.t", mode: "tcb" }, title: "Fixture", subtitle: "A small board", keys: false, notes: false };

test("the board drawn without a browser: its circles, points and edges as vectors, the names a recipe chose, the title and the foot — the same SVG every time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-artcmd-"));
  try {
    const ask = { recipe: RECIPE, screen: { w: 1280, h: 800 }, name: null, root: dir };
    const a = makeArtwork(prepared(dir), null, projectView(null), ask);
    assert.ok("svg" in a, JSON.stringify(a.problems));
    assert.match(a.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+" width="400" height="300"/);
    assert.ok((a.svg.match(/<circle /g) ?? []).length >= 4, "the cluster's circle and the declarations' points");
    assert.match(a.svg, /<path /, "edges");
    assert.match(a.svg, />F</, "the title, letter by letter");
    assert.match(a.svg, /@font-face\{font-family:"Jost"/, "the faces written in, as the page writes them");
    assert.ok(a.names.written.includes("N") && a.names.written.includes("N.t"), JSON.stringify(a.names));
    assert.deepEqual([a.targets, a.selection, a.file("png")], [["N.t"], { name: "N.t", mode: "tcb" }, "Fixture.png"]);
    const b = makeArtwork(prepared(dir), null, projectView(null), ask);
    assert.ok("svg" in b && b.svg === a.svg, "the same bytes");
    // its PNG: resvg with the package's faces, at the picture's size
    const png = await pngOf(a.svg);
    assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
    assert.deepEqual([Buffer.from(png).readUInt32BE(16), Buffer.from(png).readUInt32BE(20)], [400, 300]);
    // what the recipe names that the board has not
    const bad = makeArtwork(prepared(dir), null, projectView(null), { ...ask, recipe: { selection: { name: "N.gone" } } });
    assert.deepEqual(bad.problems, ["no declaration N.gone in the graph"]);
    assert.match(makeArtwork(prepared(dir), null, projectView(null), { ...ask, recipe: { sise: 1 } }).problems[0], /no field sise/);
    assert.match(makeArtwork(prepared(dir), null, projectView(null), { ...ask, recipe: { view: "vabc" } }).problems[0], /Project view/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("visualproof artwork: a saved graph and a recipe to an SVG and a PNG, the same bytes twice; no site read or made; problems said, status 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-artcmd-cli-"));
  try {
    const project = join(dir, "proj");
    mkdirSync(project);
    writeFileSync(join(project, "lean-toolchain"), "leanprover/lean4:v4.33.1\n");
    writeFileSync(join(project, "M.lean"), "namespace N\ndef a : Nat := 0\ndef b : Nat := a\ntheorem t : b = b := rfl\nend N\n");
    const raw: RawGraph = {
      schema: 1,
      roots: ["M"],
      modules: [{ name: "M", imports: [] }],
      nodes: [
        { name: "N.a", kind: "def", module: "M", type: "Nat", ax: 0, hash: "ha" },
        { name: "N.b", kind: "def", module: "M", type: "Nat", ax: 0, hash: "hb" },
        { name: "N.t", kind: "theorem", module: "M", type: "N.b = N.b", ax: 0, hash: "ht" },
      ],
      externals: [{ name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0 }],
      edges: [[1, 0, SITE_STMT], [2, 1, SITE_STMT], [0, 3, SITE_STMT]],
      axioms: [],
      axiomSets: [[]],
      stats: { folded: 0, metaDropped: 0, ms: 1 },
    };
    writeFileSync(join(dir, "graph.json"), JSON.stringify(raw));
    writeFileSync(join(dir, "recipe.json"), JSON.stringify(RECIPE));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...RECIPE, selection: { name: "N.gone" } }));
    const home = join(dir, "home");
    const run = (recipe: string, out: string) =>
      spawnSync(process.execPath, [join(ROOT, "src", "server", "main.ts"), "artwork", project, "--root", "M", "--graph", join(dir, "graph.json"), "--recipe", join(dir, recipe), "-o", join(dir, out), "--cache", join(dir, "cache"), "--screen", "1280x800"], {
        encoding: "utf8",
        env: { ...process.env, XDG_DATA_HOME: home, XDG_CACHE_HOME: join(dir, "cachehome") },
      });
    const one = run("recipe.json", "One");
    assert.equal(one.status, 0, one.stderr);
    assert.match(one.stdout, /names written: .*N\.t/);
    assert.match(one.stdout, /selection: tcb of N\.t/);
    assert.match(one.stdout, /wrote .*One\.svg/);
    assert.match(one.stdout, /wrote .*One\.png \([\d.]+ MB, 400 × 300\)/);
    const two = run("recipe.json", "Two.png");
    assert.equal(two.status, 0, two.stderr);
    for (const ext of ["svg", "png"]) assert.ok(readFileSync(join(dir, `One.${ext}`)).equals(readFileSync(join(dir, `Two.${ext}`))), `the same ${ext}`);
    assert.ok(!existsSync(home) || readdirSync(home).length === 0, "no site made where none was given");
    const bad = run("bad.json", "Bad");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /visualproof artwork: no declaration N\.gone in the graph/);
    assert.ok(!existsSync(join(dir, "Bad.svg")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
