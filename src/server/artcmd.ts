// The artwork command (ExportSpec decision 21): `visualproof artwork <lean-project> --recipe <file>`
// makes the picture a recipe says (decision 20) without a browser — the same picture as the page's,
// by the page's own code. The build is read as `visualproof export` reads it; the board is the
// Project's, laid out as the site keeps it (or as a new site would); the recipe is resolved as the
// page resolves it; the board is drawn by the page's canvas without a graphics card (its renderer
// kept to its data, the names measured from the fonts the package ships) on a screen of the given
// size, the frame placed and fitted as the artwork mode places and fits it; the SVG is written as
// the page's Save SVG writes it, and the PNG is that SVG drawn by resvg with the same fonts.
// Nothing is written but the files: the site is read, never written (pipeline `readOnlySite`), and
// without --site none is read.

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createDeflate, crc32, gunzipSync } from "node:zlib";
import { readRecipe, resolveRecipe } from "../shared/artrecipe.ts";
import type { ArtRecipe, RecipeMode } from "../shared/artrecipe.ts";
import { textMeasurer } from "../shared/artfonts.ts";
import type { ArtFontMetrics } from "../shared/artfonts.ts";
import { boardSet, lightUp, wholeLayout } from "../shared/board.ts";
import { declAt, guessNames } from "../shared/declfind.ts";
import type { ViewMeta } from "../shared/graph.ts";
import { litKeyEdges } from "../shared/keys.ts";
import { emptyReview } from "../shared/review.ts";
import type { ReviewData } from "../shared/review.ts";
import { SearchIndex } from "../shared/search.ts";
import { Graph } from "../shared/viewgraph.ts";
import { PROJECT } from "../shared/views.ts";
import type { ViewData } from "../shared/views.ts";
import { artName, artSvg, borderInset, cleanSettings, cssTheme, drawBackdrop, frameRect, sourceLine, SvgContext, themeBackground, titleOf, titleRoom, writeOver } from "../web/src/artwork.ts";
import type { ArtSettings } from "../web/src/artwork.ts";
import { GraphCanvas, themeOf } from "../web/src/canvas.ts";
import { ART_SANS } from "../web/src/halo.ts";
import { ReviewFlow } from "../web/src/reviewqueue.ts";
import { declPick, edgeMode, selectionQuery } from "../web/src/selection.ts";
import type { Tool } from "../web/src/selection.ts";
import { statusCodes } from "../web/src/status.ts";
import { gitSource } from "./history.ts";
import type { Prepared } from "./pipeline.ts";
import { WEB, WEBFONTS } from "./pipeline.ts";

/** What the command was asked: the recipe (as its file holds it), the screen the board is drawn on,
 *  the name the files take (null: the recipe's title, else the project's), and the project's root. */
export interface ArtworkAsk {
  recipe: unknown;
  screen: { w: number; h: number };
  name: string | null;
  root: string;
  /** how many notes of the project the site keeps: the Project's board shows every one, besides its
   *  own (none without a site) */
  projectNotes?: number;
}

/** What the command made, or why it made nothing: as the agents' API answers (decision 20) — the
 *  names written, those a rule chose and left out (they would have covered another), the targets,
 *  the selection — and the SVG, and the means to draw the PNG. */
export type Artwork =
  | { problems: string[] }
  | {
      problems: [];
      look: ArtSettings;
      names: { written: string[]; ruledSkipped: string[]; left: number };
      targets: string[];
      selection: { name: string; mode: string } | null;
      notesLeftOut: number;
      svg: string;
      file: (kind: "png" | "svg") => string;
    };

/** the faces of a picture's names, from the package's own TrueType files (scripts/artfonts.py) */
const TTF = join(WEBFONTS, "ttf");

let metrics: ArtFontMetrics | null = null;
/** How wide text is in a font, as the package's faces draw it. */
function measurer(): (text: string, font: string) => number {
  metrics ??= JSON.parse(readFileSync(join(WEBFONTS, "metrics.json"), "utf8")) as ArtFontMetrics;
  return textMeasurer(metrics);
}

/** The page's font faces, each its WOFF2 written in, as the page's Save SVG writes them (web/src/
 *  artframe.ts, faces): from the style sheet's rules, the files beside it. */
export function facesOf(css: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const get = (k: string) => new RegExp(`${k}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim();
    const family = get("font-family")?.replace(/["']/g, "").trim() ?? "";
    if (family !== "Source Sans 3" && family !== "Source Serif 4" && family !== "Jost") continue;
    const file = /url\(["']?\/fonts\/([a-z0-9-]+\.woff2)["']?\)/.exec(body)?.[1];
    if (!file) continue;
    const b64 = readFileSync(join(WEBFONTS, file)).toString("base64");
    out.push(`@font-face{font-family:"${family}";font-style:${get("font-style") || "normal"};font-weight:${get("font-weight") || "400"};src:url(data:font/woff2;base64,${b64}) format("woff2");unicode-range:${get("unicode-range") || "U+0-10FFFF"}}`);
  }
  return out.join("");
}

/** The Project view as a site keeps it (its pins, folds, hidden levels and clustering: server/views.ts,
 *  readProjectView), or as a new site has it. */
export function projectView(kept: ViewData | null): ViewData {
  const empty = () => ({ namespace: [] as string[], module: [] as string[] });
  return (
    kept ?? {
      id: PROJECT,
      name: null,
      scope: { op: "all" },
      clustering: "namespace",
      pins: { namespace: { clusters: {}, nodes: {} }, module: { clusters: {}, nodes: {} } },
      folds: empty(),
      hidden: empty(),
      by: null,
      at: new Date(0).toISOString(),
      kept: true,
    }
  ) as ViewData;
}

/** The picture a recipe says, of the build `prep` — its graph and layouts — with the review and the
 *  Project view a site keeps (or none). */
export function makeArtwork(prep: Prepared, review: ReviewData | null, project: ViewData, ask: ArtworkAsk): Artwork {
  const read = readRecipe(ask.recipe);
  if ("error" in read) return { problems: [`${read.error} ${read.hint}`] };
  const r: ArtRecipe = read.recipe;
  if (r.view && r.view !== PROJECT) return { problems: [`the command draws the Project view: the recipe names the view ${r.view}`] };
  const meta: ViewMeta = JSON.parse(gunzipSync(prep.metaGz).toString("utf8"));
  const raw = gunzipSync(prep.edgesGz);
  const g = new Graph(meta, new Int32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
  const data = review ?? emptyReview();
  // the board: the Project's, on the server's layout under the levels it hides
  const mode = project.clustering;
  const bs = boardSet(g, data, project.scope);
  const L = wholeLayout(meta.layouts[mode], g.nodes, mode, project.hidden[mode]);
  // the targets: the review's with a site, those the recipe names without one
  const onGraph = (n: string) => g.byName.has(n);
  const targets = review ? Object.keys(data.targets) : Array.isArray(r.targets) ? r.targets.filter(onGraph) : [];
  const problems: string[] = [];
  let sel: { name: string; mode: RecipeMode } | null = null;
  if (r.selection) {
    // as the agents' API finds a declaration (shared/declfind.ts): a name it folds is the declaration
    // it is folded into; none, what was likely meant
    const i = declAt(g, r.selection.name);
    if (i !== undefined) sel = { name: g.nodes[i].name, mode: r.selection.mode ?? "tcb" };
    else {
      const meant = guessNames(g, new SearchIndex(meta.nodes, meta.projectCount), r.selection.name.trim());
      problems.push(`no declaration ${r.selection.name} in the graph${meant.length ? ` (did you mean ${meant[0]}?)` : ""}`);
    }
  }
  const res = resolveRecipe(r, {
    clusters: L.clusters,
    clusterOf: (name) => {
      const i = g.byName.get(name);
      return i === undefined ? undefined : L.cluster[i];
    },
    targets,
    projectCount: g.projectCount,
  });
  problems.push(...res.problems);
  if (problems.length) return { problems };
  const s = cleanSettings(res.look, { scheme: "kind", theme: "light" });
  // the theme as the mode sets it (web/src/pageart.ts, drawLook): the board's style in the artwork's,
  // the cells and the starfield in the dark one
  const css = readFileSync(join(WEB, "style.css"), "utf8");
  const v = cssTheme(css, s.style === "board" ? s.theme === "dark" : true);
  const measure = measurer();
  // the board, drawn without a browser on a screen of the size asked
  const scratch = new SvgContext(measure, ART_SANS);
  const none = () => {};
  const C = new GraphCanvas(null, null, null, g, { nodeClick: none, clusterClick: none, backgroundClick: none, hover: none, pinsChanged: none, foldChanged: none }, { w: ask.screen.w, h: ask.screen.h, theme: themeOf(v), ctx: scratch as unknown as CanvasRenderingContext2D });
  C.setGraph(g);
  C.setLayout(L, project.pins[mode], project.folds[mode], mode);
  C.setShowExternals(bs.whole ? bs.outside : true);
  // the review on it, as the page's syncStatus puts it (no build's file states: none is known here)
  const idx = targets.map((n) => g.byName.get(n)).filter((j): j is number => j !== undefined);
  C.setStatus(statusCodes(data, g, new Map()));
  C.setTargets(idx);
  const flow = new ReviewFlow({ graph: () => g, review: () => data, reader: () => null });
  const keys = new Map<number, number[]>();
  for (const t of idx) for (const k of flow.keys(t).keys) if (k !== t) keys.set(k, [...(keys.get(k) ?? []), t]);
  C.setKeys([...keys.keys()], [...keys.values()]);
  // the artwork's look, as drawLook gives it
  C.setScheme(s.scheme);
  C.setEdges(s.edges !== "none");
  C.setArt({ labels: s.labels, namesFrom: s.namesFrom, hidden: new Set(s.hiddenNames), shown: new Set(s.shownNames), ruled: new Set(s.ruledNames), edges: s.edges, targets: s.targets, shownTargets: new Set(s.shownTargets), keys: s.keys, style: s.style });
  // the selection, as the page's apply makes it
  const picks = sel ? [declPick(sel.mode as Tool, sel.name)] : [];
  const q = selectionQuery(picks);
  const lit = q && lightUp(g, data, bs, q);
  const keyEdges = sel?.mode === "keys" && lit && lit.count ? litKeyEdges(idx.map((t) => flow.keys(t)), (i) => lit.set[i] === 1).flat() : null;
  if (s.targets === "highlight") {
    const alone = new Uint8Array(g.n);
    for (const i of idx) alone[i] = 1;
    C.setActivation(edgeMode(picks), [], alone, [], null);
  } else if (!s.selection) C.setActivation(edgeMode(picks), [], null, [], null);
  else C.setActivation(edgeMode(picks), sel ? [g.byName.get(sel.name)!] : [], lit?.set ?? null, [], keyEdges);
  // the frame, placed and fitted as the mode places and fits it (web/src/artframe.ts, place, open)
  const rect = frameRect(ask.screen, s);
  // the title's line counts the targets marked: the review's, or the recipe's where there is no site
  const own = titleOf(meta.project.name, meta.projectCount, review ? Object.keys(data.targets).length : targets.length);
  const below = titleRoom(rect.h, s, own);
  const cam = C.fitCam({ x: rect.x, y: rect.y + below, w: rect.w, h: rect.h - below });
  if (cam) C.jumpTo(cam);
  C.settle();
  // what the names are: those written, and those a rule chose that would have covered another
  const written = C.writtenNames();
  const name = (id: string) => id.slice(2).replace("⟨external⟩", "External");
  const git = s.source ? gitSource(ask.root) : null;
  const source = git ? sourceLine(git) : null;
  // the SVG, as the page's Save SVG writes it (artframe saveFile); notes are not drawn here
  const ground = s.background !== "transparent";
  const bg = ground && s.style === "board" ? themeBackground(v) : null;
  const svg = artSvg(rect, s, bg, ART_SANS, measure, (pen) => {
    const ctx = pen as unknown as CanvasRenderingContext2D;
    if (ground) drawBackdrop(ctx, s.style, rect);
    if (s.border) {
      const i = borderInset(rect);
      pen.clipRect("inside", rect.x + i, rect.y + i, rect.w - 2 * i, rect.h - 2 * i);
      pen.raw(`<g clip-path="url(#inside)">`);
    }
    for (const sh of C.artShapes(rect)) pen.shape(sh);
    C.drawMarks(ctx);
    if (s.border) pen.raw(`</g>`);
    writeOver(ctx, s, rect, own, source, v);
  }, facesOf(css));
  const title = ask.name ?? (s.title || meta.project.name);
  return {
    problems: [],
    look: s,
    names: {
      written: [...written].map(name),
      ruledSkipped: s.ruledNames.filter((id) => !written.has(id)).map(name),
      left: res.left,
    },
    targets: s.targets === "chosen" ? s.shownTargets : s.targets === "plain" ? [] : idx.map((j) => g.nodes[j].name),
    selection: sel,
    notesLeftOut: s.notes ? (project.notes ?? []).length + (ask.projectNotes ?? 0) : 0,
    svg,
    file: (kind) => artName(title, kind),
  };
}

let wasmReady: Promise<void> | null = null;
let ttfs: Uint8Array[] | null = null;

/** resvg's WebAssembly build, ready, with the package's TrueType faces and none of the system's
 *  (decision 21: the PNG agrees with the SVG, and is the same on every machine) */
async function renderer() {
  const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
  wasmReady ??= initWasm(readFileSync(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm")));
  await wasmReady;
  ttfs ??= readdirSync(TTF)
    .filter((f) => f.endsWith(".ttf"))
    .sort()
    .map((f) => new Uint8Array(readFileSync(join(TTF, f))));
  const opts = { font: { fontBuffers: ttfs, loadSystemFonts: false, defaultFontFamily: "Source Sans 3" } };
  return (svg: string) => new Resvg(svg, opts);
}

/** The most pixels a PNG is drawn in at once. resvg holds a picture four times over and more (its
 *  clipped groups' layers and their masks: 17 bytes a pixel) in WebAssembly's memory, which is at
 *  most 4 GiB: a picture of 80 million pixels takes 1.9 GB, the largest (16384 × 16384) more than
 *  there is. A larger one is drawn in bands of BAND_PIXELS (the largest: 2.0 GB). */
export const PNG_PIXELS = 80_000_000;
/** A band's pixels: resvg's layers reach up to twice the band's height beyond it, so that a band
 *  costs 35 bytes a pixel, 0.7 GB, and the picture is drawn about three times as long. */
const BAND_PIXELS = 20_000_000;

/** An artwork's SVG (artSvg's: its root's viewBox the frame, its width and height the picture's) as
 *  it draws rows `y0` to `y0 + rows` of the picture: its viewBox moved down, the background's
 *  rectangle (its `100%`, which a moved viewBox would not move) in the frame's units, and the frame's
 *  clip left out, as the band is within the frame. The border's clip is kept, and given a rectangle
 *  as large as the frame that draws nothing: resvg 2.6 fails (WebAssembly's `unreachable`) on a
 *  clipped group whose contents lie more than twice the band's height away from it. */
export function bandSvg(svg: string, y0: number, rows: number): string {
  const root = /^<svg ([^>]*?)viewBox="0 0 ([\d.]+) ([\d.]+)" width="(\d+)" height="(\d+)"/.exec(svg);
  const board = /<g clip-path="url\(#frame\)"><g transform="translate\(([-\d.]+) ([-\d.]+)\)">/.exec(svg);
  if (!root || !board) throw new Error("not an artwork's SVG");
  const [W, H, PH] = [Number(root[2]), Number(root[3]), Number(root[5])];
  const f = H / PH;
  return svg
    .replace(root[0], `<svg ${root[1]}viewBox="0 ${y0 * f} ${W} ${rows * f}" width="${root[4]}" height="${rows}"`)
    .replace(`<rect width="100%" height="100%"`, `<rect width="${W}" height="${H}"`)
    .replace(board[0], `<g><g transform="translate(${board[1]} ${board[2]})">`)
    .replace(`<g clip-path="url(#inside)">`, `<g clip-path="url(#inside)"><rect x="${-Number(board[1])}" y="${-Number(board[2])}" width="${W}" height="${H}" fill="#000" fill-opacity="0"/>`);
}

/** An SVG drawn as a PNG at the size its root says, by resvg. A picture of more than `most` pixels
 *  is drawn in bands of about `band` pixels (bandSvg) and written as one PNG, row by row: the same
 *  picture, its pixels a few levels apart where translucent shapes overlap (resvg's layers round
 *  otherwise than one drawing). */
export async function pngOf(svg: string, most = PNG_PIXELS, band = BAND_PIXELS): Promise<Uint8Array> {
  const render = await renderer();
  const m = /^<svg [^>]*?width="(\d+)" height="(\d+)"/.exec(svg);
  const [w, h] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  const failed = (e: unknown) => new Error(`the PNG${m ? `, ${w} × ${h},` : ""} could not be drawn (${e instanceof Error ? e.message : String(e)})`);
  if (!m || w * h <= most) {
    const r = render(svg);
    let png: Uint8Array;
    try {
      const image = r.render();
      png = image.asPng();
      image.free();
    } catch (e) {
      // resvg is not called again once it has failed: the command ends
      throw failed(e);
    }
    r.free();
    return png;
  }
  // the rows, each its filter byte (none) and its pixels, demultiplied as resvg's own PNG has them
  // (tiny-skia's `demultiply`)
  const deflate = createDeflate({ level: 6 });
  const out: Buffer[] = [];
  deflate.on("data", (b: Buffer) => out.push(b));
  const done = new Promise<void>((ok, fail) => {
    deflate.on("end", ok);
    deflate.on("error", fail);
  });
  // bands of even heights, so that none is a sliver
  const count = Math.ceil(h / Math.max(1, Math.floor(band / w)));
  const rows = Math.ceil(h / count);
  for (let y = 0; y < h; y += rows) {
    const n = Math.min(rows, h - y);
    const r = render(bandSvg(svg, y, n));
    let px: Uint8Array;
    try {
      const image = r.render();
      px = image.pixels;
      image.free();
    } catch (e) {
      throw failed(e);
    }
    r.free();
    const lines = Buffer.alloc(n * (w * 4 + 1));
    for (let row = 0; row < n; row++) {
      const o = row * (w * 4 + 1) + 1, from = row * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        const a = px[from + x + 3];
        lines[o + x + 3] = a;
        if (a === 255) for (let c = 0; c < 3; c++) lines[o + x + c] = px[from + x + c];
        else if (a > 0) for (let c = 0; c < 3; c++) lines[o + x + c] = Math.min(255, Math.floor(px[from + x + c] / (a / 255) + 0.5));
      }
    }
    if (!deflate.write(lines)) await new Promise((ok) => deflate.once("drain", ok));
  }
  deflate.end();
  await done;
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", Buffer.concat(out)), chunk("IEND", Buffer.alloc(0))]));
}
