// The artwork command (ExportSpec decision 21): the board's drawing run without a browser — colours
// read without one, the theme from the style sheet, the renderer kept to its data — and the command
// itself, from a recipe to an SVG and a PNG, the same bytes every time, problems said with status 1.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync, inflateSync } from "node:zlib";
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

/** An 8-bit RGBA PNG's pixels, row after row, its filters undone. */
function pixelsOf(png: Uint8Array): Buffer {
  const b = Buffer.from(png);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  assert.deepEqual([...b.subarray(24, 29)], [8, 6, 0, 0, 0], "8-bit RGBA, not interlaced");
  const idat: Buffer[] = [];
  for (let at = 8; at < b.length; at += 12 + b.readUInt32BE(at)) if (b.toString("latin1", at + 4, at + 8) === "IDAT") idat.push(b.subarray(at + 8, at + 8 + b.readUInt32BE(at)));
  const raw = inflateSync(Buffer.concat(idat));
  const line = 4 * w, out = Buffer.alloc(line * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (line + 1)], from = y * (line + 1) + 1, to = y * line;
    for (let x = 0; x < line; x++) {
      const l = x >= 4 ? out[to + x - 4] : 0, u = y ? out[to - line + x] : 0, ul = x >= 4 && y ? out[to - line + x - 4] : 0;
      const p = l + u - ul, pl = Math.abs(p - l), pu = Math.abs(p - u), pul = Math.abs(p - ul);
      const pred = [0, l, u, (l + u) >> 1, pl <= pu && pl <= pul ? l : pu <= pul ? u : ul][f];
      out[to + x] = (raw[from + x] + pred) & 255;
    }
  }
  return out;
}

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
    // a picture of more pixels than drawn at once, drawn in bands of rows (here 43 of 7, which resvg
    // alone fails on): the same picture, its pixels a few levels apart where its layers round; on a
    // ground or on none
    const clear = makeArtwork(prepared(dir), null, projectView(null), { ...ask, recipe: { ...RECIPE, transparent: true } });
    assert.ok("svg" in clear);
    for (const svg of [a.svg, clear.svg]) {
      const [one, banded] = [await pngOf(svg), await pngOf(svg, 400 * 7, 400 * 7)];
      assert.ok(!Buffer.from(banded).equals(Buffer.from(one)), "written by the command, not by resvg");
      // compared as they are drawn, their colours by their alpha (a colour all but transparent is any)
      const [whole, bands] = [pixelsOf(one), pixelsOf(banded)];
      let apart = 0, most = 0;
      for (let i = 0; i < whole.length; i++) {
        const k = i - (i % 4) + 3;
        const d = i === k ? Math.abs(whole[i] - bands[i]) : Math.round(Math.abs(whole[i] * whole[k] - bands[i] * bands[k]) / 255);
        if (d) apart++;
        most = Math.max(most, d);
      }
      assert.ok(apart < whole.length / 50 && most <= 16, `${apart} of ${whole.length} bytes apart, by ${most} at most`);
    }
    // what the recipe names that the board has not
    const bad = makeArtwork(prepared(dir), null, projectView(null), { ...ask, recipe: { selection: { name: "N.gone" } } });
    assert.deepEqual(bad.problems, ["no declaration N.gone in the graph"]);
    assert.match(makeArtwork(prepared(dir), null, projectView(null), { ...ask, recipe: { sise: 1 } }).problems[0], /no field sise/);
    assert.match(makeArtwork(prepared(dir), null, projectView(null), { ...ask, recipe: { view: "vabc" } }).problems[0], /Project view/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The small project as the command is given it — its folder, its graph saved by an extraction —
 *  in `dir`, and a run of the command on it with a recipe: `recipe.json`, a file the run writes. */
function cliProject(dir: string) {
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
  const home = join(dir, "home");
  const run = (recipe: unknown, out: string, more: string[] = []) => {
    writeFileSync(join(dir, "recipe.json"), JSON.stringify(recipe));
    return spawnSync(process.execPath, [join(ROOT, "src", "server", "main.ts"), "artwork", project, "--root", "M", "--graph", join(dir, "graph.json"), "--recipe", join(dir, "recipe.json"), "-o", join(dir, out), "--cache", join(dir, "cache"), "--screen", "1280x800", ...more], {
      encoding: "utf8",
      env: { ...process.env, XDG_DATA_HOME: home, XDG_CACHE_HOME: join(dir, "cachehome") },
    });
  };
  return { home, run };
}

/** Every file under `dir` and its bytes, by path. */
function filesOf(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(dir, { recursive: true, withFileTypes: true }))
    if (f.isFile()) out.set(join(f.parentPath, f.name), readFileSync(join(f.parentPath, f.name)).toString("base64"));
  return out;
}

test("visualproof artwork: a saved graph and a recipe to an SVG and a PNG, the same bytes twice; no site read or made; problems said, status 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-artcmd-cli-"));
  try {
    const { home, run } = cliProject(dir);
    const one = run(RECIPE, "One");
    assert.equal(one.status, 0, one.stderr);
    assert.match(one.stdout, /names written: .*N\.t/);
    assert.match(one.stdout, /selection: tcb of N\.t/);
    assert.match(one.stdout, /wrote .*One\.svg/);
    assert.match(one.stdout, /wrote .*One\.png \([\d.]+ MB, 400 × 300\)/);
    const two = run(RECIPE, "Two.png");
    assert.equal(two.status, 0, two.stderr);
    for (const ext of ["svg", "png"]) assert.ok(readFileSync(join(dir, `One.${ext}`)).equals(readFileSync(join(dir, `Two.${ext}`))), `the same ${ext}`);
    assert.ok(!existsSync(home) || readdirSync(home).length === 0, "no site made where none was given");
    // nothing kept in the cache that a server would take for its site's view
    assert.ok(!existsSync(join(dir, "cache", "view")), "no view written to the cache");
    const bad = run({ ...RECIPE, selection: { name: "N.gone" } }, "Bad");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /visualproof artwork: no declaration N\.gone in the graph/);
    assert.ok(!existsSync(join(dir, "Bad.svg")));
    // a name its graph folds is the declaration it is folded into; a name in another case, guessed
    const folded = run({ ...RECIPE, selection: { name: "N.t.eq_1" } }, "Folded");
    assert.equal(folded.status, 0, folded.stderr);
    assert.match(folded.stdout, /selection: tcb of N\.t\n/);
    const cased = run({ ...RECIPE, selection: { name: "N.T" } }, "Cased");
    assert.equal(cased.status, 1);
    assert.match(cased.stderr, /no declaration N\.T in the graph \(did you mean N\.t\?\)/);
    // a folder that is not there, said before anything is drawn; whatever fails, status 1
    const nowhere = run(RECIPE, join("nowhere", "Pic"));
    assert.equal(nowhere.status, 1);
    assert.match(nowhere.stderr, /there is no folder .*nowhere to write the files in/);
    const broken = spawnSync(process.execPath, [join(ROOT, "src", "server", "main.ts"), "artwork", join(dir, "proj"), "--root", "M", "--graph", join(dir, "nograph.json"), "--recipe", join(dir, "recipe.json"), "-o", join(dir, "X"), "--cache", join(dir, "cache")], { encoding: "utf8", env: { ...process.env, XDG_DATA_HOME: home } });
    assert.equal(broken.status, 1, broken.stdout + broken.stderr);
    assert.match(broken.stderr, /^visualproof artwork: /m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("visualproof artwork with a site: its folds read and drawn under a selection; nothing in the site written, nor a view in the cache; views it cannot read said, and left as they are", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-artcmd-site-"));
  try {
    const { run } = cliProject(dir);
    const site = join(dir, "site");
    mkdirSync(site);
    // the Project view folding N, the cluster of every declaration; a selection lights one of them
    const view = { id: "project", name: null, scope: { op: "all" }, clustering: "namespace", pins: { namespace: { clusters: {}, nodes: {} }, module: { clusters: {}, nodes: {} } }, folds: { namespace: ["N"], module: [] }, hidden: { namespace: [], module: [] }, by: null, at: new Date(0).toISOString(), kept: true };
    writeFileSync(join(site, "views.json"), JSON.stringify({ layoutVersion: LAYOUT_VERSION, views: [view] }));
    const before = filesOf(site);
    const lit = run({ ...RECIPE, targets: "all" }, "Folded", ["--site", site]);
    assert.equal(lit.status, 0, lit.stderr);
    assert.match(lit.stdout, /selection: tcb of N\.t/);
    assert.ok(readFileSync(join(dir, "Folded.png")).length > 0);
    const unfolded = run({ ...RECIPE, targets: "all" }, "Unfolded");
    assert.equal(unfolded.status, 0, unfolded.stderr);
    assert.notEqual(readFileSync(join(dir, "Folded.svg"), "utf8"), readFileSync(join(dir, "Unfolded.svg"), "utf8"), "the fold drawn");
    assert.deepEqual(filesOf(site), before, "the site as it was");
    assert.ok(!existsSync(join(dir, "cache", "view")), "no view written to the cache");
    // views that cannot be read: said, the Project view as a new site has it, the file left in place
    writeFileSync(join(site, "views.json"), "{ not json");
    const broken = filesOf(site);
    const anyway = run({ ...RECIPE, targets: "all" }, "Anyway", ["--site", site]);
    assert.equal(anyway.status, 0, anyway.stderr);
    assert.match(anyway.stderr, /the site's views cannot be read .*: the Project view as a new site has it/);
    assert.deepEqual(filesOf(site), broken, "the unreadable views left as they are");
    assert.equal(readFileSync(join(dir, "Anyway.svg"), "utf8"), readFileSync(join(dir, "Unfolded.svg"), "utf8"), "drawn as with no site");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
