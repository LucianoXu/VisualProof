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
import { gunzipSync } from "node:zlib";
import { readRecipe, resolveRecipe } from "../shared/artrecipe.ts";
import type { ArtRecipe, RecipeMode } from "../shared/artrecipe.ts";
import { textMeasurer } from "../shared/artfonts.ts";
import type { ArtFontMetrics } from "../shared/artfonts.ts";
import { boardSet, lightUp, wholeLayout } from "../shared/board.ts";
import type { ViewMeta } from "../shared/graph.ts";
import { litKeyEdges } from "../shared/keys.ts";
import { emptyReview } from "../shared/review.ts";
import type { ReviewData } from "../shared/review.ts";
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

/** The Project view as a site keeps it (its pins, folds, hidden levels and clustering), or as a new
 *  site has it. */
export function projectView(views: { get(id: string): ViewData | undefined } | null): ViewData {
  const empty = () => ({ namespace: [] as string[], module: [] as string[] });
  return (
    views?.get(PROJECT) ?? {
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
    if (!onGraph(r.selection.name)) problems.push(`no declaration ${r.selection.name} in the graph`);
    else sel = { name: r.selection.name, mode: r.selection.mode ?? "tcb" };
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
  // the theme as the mode sets it (web/src/main.ts, drawLook): the board's style in the artwork's,
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
  const own = titleOf(meta.project.name, meta.projectCount, Object.keys(data.targets).length);
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
    notesLeftOut: s.notes ? (project.notes ?? []).length : 0,
    svg,
    file: (kind) => artName(title, kind),
  };
}

let wasmReady: Promise<void> | null = null;
let ttfs: Uint8Array[] | null = null;

/** An SVG drawn as a PNG at the size its root says, by resvg with the package's TrueType faces and
 *  none of the system's (decision 21: the PNG agrees with the SVG, and is the same on every machine). */
export async function pngOf(svg: string): Promise<Uint8Array> {
  const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
  wasmReady ??= initWasm(readFileSync(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm")));
  await wasmReady;
  ttfs ??= readdirSync(TTF)
    .filter((f) => f.endsWith(".ttf"))
    .sort()
    .map((f) => new Uint8Array(readFileSync(join(TTF, f))));
  const r = new Resvg(svg, { font: { fontBuffers: ttfs, loadSystemFonts: false, defaultFontFamily: "Source Sans 3" } });
  const image = r.render();
  const png = image.asPng();
  image.free();
  r.free();
  return png;
}
