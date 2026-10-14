// Artwork (ExportSpec decision 19, web/src/artwork.ts): the board as a picture, drawn as vectors
// from where the board draws things — the size chosen, the look set — and the edges bundled as the
// board bundles them.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArtScene, ArtSettings, Palette } from "../src/web/src/artwork.ts";
import { artName, artSvg, bundlePoints, cleanSettings, MAX_SIDE } from "../src/web/src/artwork.ts";

const PAL: Palette = {
  bg: "rgba(250,250,250,1)", disc: "rgba(0,0,0,0.04)", discLine: "rgba(0,0,0,0.2)", label: "rgba(20,20,20,1)", text: "rgba(80,80,80,1)",
  kind: { def: "rgba(0,0,255,1)", theorem: "rgba(128,0,128,1)" }, ext: "rgba(120,120,120,1)",
  status: ["rgba(1,1,1,1)", "rgba(2,2,2,1)", "rgba(3,3,3,1)", "rgba(4,4,4,1)", "rgba(5,5,5,1)", "rgba(6,6,6,1)", "rgba(7,7,7,1)", "rgba(8,8,8,1)"],
  edgeFrom: "rgba(255,128,0,1)", edgeTo: "rgba(0,128,255,1)", accent: "rgba(100,80,255,1)", star: "rgba(255,200,0,1)", starEdge: "rgba(160,120,0,1)",
  noteIcon: "rgba(100,80,255,1)", noteBg: "rgba(255,255,255,0.9)", noteText: "rgba(20,20,20,1)",
};

const SCENE: ArtScene = {
  w: 400,
  h: 300,
  dot: 3,
  clusters: [
    { x: 200, y: 150, r: 120, label: "Fixture", depth: 0, folded: false },
    { x: 330, y: 60, r: 20, label: "Point", depth: 1, folded: true },
  ],
  nodes: [
    { x: 150, y: 150, kind: "def", ext: false, status: 2, label: "helper", target: false, lit: true },
    { x: 250, y: 150, kind: "theorem", ext: false, status: 5, label: "main_thm", target: true, lit: false },
    { x: 200, y: 250, kind: "external", ext: true, status: 0, label: "Nat", target: false, lit: false },
    { x: 900, y: 900, kind: "def", ext: false, status: 2, label: "far", target: false, lit: false },
  ],
  edges: [
    { pts: [150, 150, 200, 140, 250, 150], width: 1.2, alpha: 0.3, lit: false },
    { pts: [150, 150, 175, 200, 200, 250], width: 0.8, alpha: 0.2, lit: true },
  ],
  notes: [{ x: 300, y: 250, words: "Why <this>" }],
  lit: true,
};

const base: ArtSettings = { w: 1600, h: 1200, scheme: "kind", theme: "light", background: "theme", labels: "all", edges: "all", proofs: false, notes: true, targets: "marked", selection: true };
const measure = (t: string) => t.length * 6;
const svg = (over: Partial<ArtSettings> = {}) => artSvg(SCENE, PAL, { ...base, ...over }, measure);

test("the picture is the frame's at the size chosen: its viewBox the frame's pixels, its size the size asked for; the background the theme's, white or none", () => {
  const s = svg();
  assert.match(s, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 400 300" width="1600" height="1200"/);
  assert.match(s, /<rect width="100%" height="100%" fill="rgba\(250,250,250,1\)"\/>/);
  assert.match(svg({ background: "white" }), /fill="#ffffff"/);
  assert.doesNotMatch(svg({ background: "transparent" }), /<rect width="100%"/);
  assert.ok(s.endsWith("</svg>"));
});

test("what lies outside the frame is left out; the circles, a folded one shaded; the points in the scheme's colours, the outside world as rings", () => {
  const s = svg();
  assert.doesNotMatch(s, /far/, "a declaration outside the frame");
  assert.match(s, /<circle cx="200" cy="150" r="120" fill="rgba\(0,0,0,0.04\)"/);
  assert.match(s, /<circle cx="330" cy="60" r="20" fill="rgba\(0,0,0,0.2\)" fill-opacity="0.35"/);
  assert.match(s, /cx="250" cy="150" r="3" fill="rgba\(128,0,128,1\)"/, "a theorem by kind");
  assert.match(s, /cx="200" cy="250" r="3" fill="none" stroke="rgba\(120,120,120,1\)"/, "the outside world, a ring");
  const st = svg({ scheme: "status" });
  assert.match(st, /cx="250" cy="150" r="3" fill="rgba\(6,6,6,1\)"/, "by status: its state's colour");
});

test("the selection as seen: what is lit larger, the rest faint, its edges in the accent; not at all, all alike", () => {
  const s = svg();
  assert.match(s, /cx="150" cy="150" r="4.1" fill/, "lit, larger");
  assert.match(s, /cx="250" cy="150" r="3" fill="rgba\(128,0,128,1\)" opacity="0.25"/, "not lit, faint");
  assert.match(s, /stroke="rgba\(100,80,255,1\)" stroke-opacity="0.8"/, "a lit edge");
  const off = svg({ selection: false });
  assert.doesNotMatch(off, /opacity="0.25"/);
  assert.match(off, /cx="150" cy="150" r="3" fill/);
});

test("names: the clusters' and the declarations', none over another; the clusters' only; none. Edges: all, the selection's, none. Notes, and targets marked, alone or as any", () => {
  const s = svg({ selection: false });
  assert.match(s, />Fixture</);
  assert.match(s, />helper</);
  assert.match(s, /font-weight="600"[^>]*>main_thm</, "a target's name, marked");
  assert.match(s, /<path d="M[^"]*Z" fill="rgba\(255,200,0,1\)"/, "its star");
  const clusters = svg({ labels: "clusters", selection: false });
  assert.match(clusters, />Fixture</);
  assert.doesNotMatch(clusters, />helper</);
  assert.match(clusters, />main_thm</, "a target keeps its name");
  assert.doesNotMatch(svg({ labels: "none", notes: false }), /<text/, "no name at all");
  const edges = (o: Partial<ArtSettings>) => (svg(o).match(/<path d="M[\d.,L]+"/g) ?? []).length;
  assert.deepEqual([edges({}), edges({ edges: "selection" }), edges({ edges: "none" })], [2, 1, 0]);
  assert.match(s, /Why &lt;this&gt;/, "a note's words, escaped");
  assert.doesNotMatch(svg({ notes: false }), /Why/);
  const alone = svg({ targets: "highlight", selection: false });
  assert.match(alone, /cx="150" cy="150" r="3" fill="rgba\(0,0,255,1\)" opacity="0.25"/, "the rest faded");
  assert.doesNotMatch(svg({ targets: "plain", selection: false }), /fill="rgba\(255,200,0,1\)"/, "no star");
});

test("an edge is the board's spline: from one end to the other, through its clusters, straight where beta is 0", () => {
  const ctrl = [0, 0, 50, 80, 100, 0];
  const p = bundlePoints(ctrl, 0.85, 20);
  assert.deepEqual([p[0], p[1]], [0, 0]);
  assert.deepEqual([+p[p.length - 2].toFixed(6), +p[p.length - 1].toFixed(6)], [100, 0]);
  assert.ok(Math.max(...p.filter((_, k) => k % 2)) > 20, "bent towards the middle control point");
  const flat = bundlePoints(ctrl, 0, 20);
  assert.ok(flat.filter((_, k) => k % 2).every((y) => Math.abs(y) < 1e-9), "straight");
});

test("settings kept in a browser are read with care; a file's name is what no file system refuses", () => {
  const now = { scheme: "status" as const, theme: "dark" as const };
  const fresh = cleanSettings(undefined, now);
  assert.deepEqual([fresh.scheme, fresh.theme, fresh.w, fresh.h], ["status", "dark", 3840, 2160]);
  const odd = cleanSettings({ w: 99999, h: -5, scheme: "rainbow" as never, labels: "some" as never, notes: "yes" as never }, now);
  assert.deepEqual([odd.w, odd.h, odd.scheme, odd.labels, odd.notes], [MAX_SIDE, 16, "status", "all", true]);
  assert.equal(artName("TCB of ns CaseI @ Oct 9 22:27", "png"), "TCB of ns CaseI @ Oct 9 22 27.png");
  assert.equal(artName("a/b\\\\c|d?.", "svg"), "a b c d.svg");
  assert.equal(artName("  ", "png"), "VisualProof.png");
});

test("a PNG made band by band is a PNG: its chunks and their CRCs, its pixels as given, row by row", async () => {
  const { encodePng } = await import("../src/web/src/artwork.ts");
  const { inflateSync } = await import("node:zlib");
  const { crc32 } = await import("../src/server/export.ts");
  const w = 3, h = 5;
  const px = (x: number, y: number) => [x * 40, y * 50, (x + y) * 10, 255 - y];
  async function* bands() {
    // bands of 2 rows, the last of 1
    for (let y = 0; y < h; y += 2) {
      const n = Math.min(2, h - y);
      const b = new Uint8Array(n * w * 4);
      for (let r = 0; r < n; r++) for (let x = 0; x < w; x++) b.set(px(x, y + r), (r * w + x) * 4);
      yield b;
    }
  }
  const png = Buffer.from(await (await encodePng(w, h, bands())).arrayBuffer());
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < png.length; ) {
    const len = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString("latin1");
    const data = png.subarray(at + 8, at + 8 + len);
    assert.equal(png.readUInt32BE(at + 8 + len), crc32(png.subarray(at + 4, at + 8 + len)), `${type}'s CRC`);
    chunks.push({ type, data });
    at += 12 + len;
  }
  assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
  const ihdr = chunks[0].data;
  assert.deepEqual([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ...ihdr.subarray(8)], [w, h, 8, 6, 0, 0, 0]);
  const raw = inflateSync(chunks[1].data);
  assert.equal(raw.length, h * (1 + 4 * w));
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (1 + 4 * w)], 0, "no filter");
    for (let x = 0; x < w; x++) assert.deepEqual([...raw.subarray(y * (1 + 4 * w) + 1 + 4 * x, y * (1 + 4 * w) + 5 + 4 * x)], px(x, y));
  }
  await assert.rejects(encodePng(w, h + 1, bands()), /rows/);
});
