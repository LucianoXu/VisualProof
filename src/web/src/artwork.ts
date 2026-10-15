// Artwork (ExportSpec decision 19, the owner's decisions of 2026-10-13 and 2026-10-14): the board as
// a picture, PNG or SVG, at a size of the reader's choosing. There is no picture drawn apart from the
// board: while the artwork mode is on, the board itself is drawn with the artwork's settings — the
// colouring, the theme, the background, the names, the edges, the notes, the targets, the selection —
// and a frame fixed in the middle of the screen (web/src/artframe.ts) says what of it the picture
// holds. Everything done on the board works under the frame.
//
// The files are made from the board's own drawing. PNG: the board's renderer (web/src/gl/renderer.ts)
// draws the frame again at the size chosen, a tile at a time, and the board's names and marks are
// written over it as the screen has them (GraphCanvas.paintArtBand): the frame's view, more pixels.
// SVG: what the renderer draws, read from its layers as shapes (GraphCanvas.artShapes), and what the
// board writes over it — its names, stars, rings — recorded as it is written (SvgContext), within the
// frame. Nothing is asked of the server, so a read-only page and a snapshot can make one too.

import type { ArtStyle, ArtworkLook } from "../../shared/collab.ts";
import { ART_MAX_SIDE, ART_NAMES_BYTES, ART_STYLES, ART_TARGETS_BYTES, cleanFootSize, cleanNames, cleanTitle, cleanTitleSize, FOOT_SIZE, isArtNameId, TITLE_SIZE } from "../../shared/collab.ts";
import type { GitSource } from "../../shared/graph.ts";
import type { ArtShape } from "./canvas.ts";
import { ART_DISPLAY, ART_SANS, ART_SERIF, spacedWidth, writeNames } from "./halo.ts";
import type { Written } from "./halo.ts";

export type ArtSettings = ArtworkLook;

/** The sizes offered, each in either orientation (`oriented`): given landscape. */
export const PRESETS: readonly { name: string; w: number; h: number }[] = [
  { name: "HD", w: 1920, h: 1080 },
  { name: "4K", w: 3840, h: 2160 },
  { name: "Square", w: 4096, h: 4096 },
  { name: "A3, 300 dpi", w: 4961, h: 3508 },
  { name: "A2, 300 dpi", w: 7016, h: 4961 },
];

/** The preset a size is, in either orientation; -1 for none. */
export function presetOf(w: number, h: number): number {
  return PRESETS.findIndex((p) => (p.w === w && p.h === h) || (p.w === h && p.h === w));
}

/** A size turned to an orientation: its longer side across (landscape) or down (portrait). */
export function oriented(w: number, h: number, portrait: boolean): { w: number; h: number } {
  const [long, short] = w >= h ? [w, h] : [h, w];
  return portrait ? { w: short, h: long } : { w: long, h: short };
}
export const MAX_SIDE = ART_MAX_SIDE;

const DEFAULTS: ArtSettings = {
  w: 3840,
  h: 2160,
  scheme: "kind",
  theme: "light",
  background: "theme",
  labels: "board",
  namesFrom: "board",
  hiddenNames: [],
  shownNames: [],
  edges: "all",
  notes: true,
  targets: "marked",
  shownTargets: [],
  keys: true,
  selection: true,
  source: false,
  style: "board",
  title: null,
  subtitle: null,
  titleSize: TITLE_SIZE.first,
  footSize: FOOT_SIZE.first,
  border: false,
};

const one = <T extends string>(v: unknown, of: readonly T[], d: T): T => (of.includes(v as T) ? (v as T) : d);
const side = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(16, Math.min(MAX_SIDE, Math.round(v))) : d);

/** Settings as a browser kept them, each checked, over the defaults. */
export function cleanSettings(s: Partial<ArtSettings> | undefined, now: { scheme: ArtSettings["scheme"]; theme: ArtSettings["theme"] }): ArtSettings {
  const o = (s ?? {}) as Record<string, unknown>;
  const targets = one(o.targets, ["marked", "plain", "highlight", "chosen"], DEFAULTS.targets);
  return {
    w: side(o.w, DEFAULTS.w),
    h: side(o.h, DEFAULTS.h),
    scheme: one(o.scheme, ["kind", "status"], now.scheme),
    theme: one(o.theme, ["light", "dark"], now.theme),
    background: one(o.background, ["theme", "transparent"], DEFAULTS.background),
    labels: one(o.labels, ["board", "clusters", "none", "chosen"], DEFAULTS.labels),
    namesFrom: o.namesFrom === "none" ? "none" : "board",
    hiddenNames: cleanNames(o.hiddenNames, ART_NAMES_BYTES, isArtNameId),
    shownNames: cleanNames(o.shownNames, ART_NAMES_BYTES, isArtNameId),
    edges: one(o.edges, ["all", "selection", "none"], DEFAULTS.edges),
    notes: typeof o.notes === "boolean" ? o.notes : DEFAULTS.notes,
    targets,
    shownTargets: cleanNames(o.shownTargets, ART_TARGETS_BYTES),
    // kept before the key marks had a switch of their own: as the targets drew them
    keys: typeof o.keys === "boolean" ? o.keys : targets !== "plain",
    selection: typeof o.selection === "boolean" ? o.selection : DEFAULTS.selection,
    source: typeof o.source === "boolean" ? o.source : DEFAULTS.source,
    style: one(o.style, ART_STYLES, DEFAULTS.style),
    title: cleanTitle(o.title),
    subtitle: cleanTitle(o.subtitle),
    titleSize: cleanTitleSize(o.titleSize),
    footSize: cleanFootSize(o.footSize),
    border: typeof o.border === "boolean" ? o.border : DEFAULTS.border,
  };
}

// ---------------------------------------------------------------- names and targets chosen

/** A name the artwork's list of names offers (web/src/artframe.ts; the owner's decision of
 *  2026-10-15): what it names (shared/collab.ts, artNameId), the name the board writes, and the full
 *  name or key it stands for; a cluster's, or a declaration's. */
export interface NameRow {
  id: string;
  label: string;
  full: string;
  cluster: boolean;
}

/** the most rows the list of names shows at once: the rest are narrowed to by its filter */
export const NAME_ROWS = 2000;

/** The rows of the list of names whose name or full name holds `filter`, whatever the case, in the
 *  order given (the clusters' first), at most `cap` of them; and how many more hold it. */
export function nameRows(all: readonly NameRow[], filter: string, cap = NAME_ROWS): { rows: NameRow[]; more: number } {
  const f = filter.trim().toLowerCase();
  const rows: NameRow[] = [];
  let more = 0;
  for (const r of all) {
    if (f && !r.label.toLowerCase().includes(f) && !r.full.toLowerCase().includes(f)) continue;
    if (rows.length < cap) rows.push(r);
    else more++;
  }
  return { rows, more };
}

/** `list` with `add` after it, as many of them as fit in `budget` bytes of what presence carries
 *  (shared/collab.ts, cleanNames), in their order; and how many of them did not fit. */
export function withChosen(list: readonly string[], add: readonly string[], budget: number): { list: string[]; left: number } {
  const out = cleanNames([...list, ...add], budget);
  const had = new Set(list), kept = new Set(out);
  return { list: out, left: new Set(add.filter((x) => !had.has(x) && !kept.has(x))).size };
}

/** The picture's background, the theme's: read while the artwork mode is on, it is its theme's. */
export function themeBackground(): string {
  return getComputedStyle(document.body).getPropertyValue("--canvas").trim();
}

/** A note as the board shows it now (web/src/sticky.ts, Stickies.asDrawn), in the screen's pixels and
 *  the colours its elements have: what a picture draws of it. */
export interface NotePicture {
  /** its mark's middle and radius; how much of it is its icon (1) rather than its dot (0) */
  x: number;
  y: number;
  r: number;
  t: number;
  /** the icon: its fill, its ring (colour, width, dashed for a view's own note), and its glyph — an
   *  SVG's contents, 16 units across, drawn in `colour` — `glyphPx` across */
  fill: string;
  ring: string;
  ringW: number;
  dashed: boolean;
  glyph: string;
  glyphPx: number;
  colour: string;
  /** the dot it turns into, zoomed out, and the page's surface round it */
  dot: string;
  surface: string;
  /** attached to a declaration: the dashed leader to its point, and the diamond on the point's rim */
  decl: { line: [number, number, number, number]; width: number; colour: string; mark: [number, number]; markPx: number } | null;
  /** open: its card — its box, colours, text and who wrote it — and the leader from the icon to it */
  card: { x: number; y: number; w: number; h: number; bg: string; edge: string; accent: string; text: string; by: string; textColour: string; byColour: string } | null;
  lead: { line: [number, number, number, number]; colour: string; dashed: boolean } | null;
}

/** A rounded rectangle's path. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** `text` broken into lines `width` wide in the context's font, as the card breaks it: at its line
 *  breaks, between words, and inside a word too long for a line. */
export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/(?<=\s)/)) {
      if (measure(line + word) <= width || !line) line += word;
      else {
        out.push(line.trimEnd());
        line = word;
      }
      // a word longer than the line: broken where it reaches the edge
      while (measure(line.trimEnd()) > width && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && measure(line.slice(0, k)) > width) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** The notes as the board shows them, written with `ctx` in the screen's pixels — over the board in a
 *  PNG, recorded into an SVG: the leader to a declaration and its diamond, the leader to an open card,
 *  the mark (its icon, its dot over it as far as it has turned into one) and the card with its text.
 *  `glyph` draws an icon's glyph, which is SVG: a PNG has it as a picture, an SVG as it is. */
export function drawNotes(ctx: CanvasRenderingContext2D, notes: readonly NotePicture[], font: string, glyph: (n: NotePicture) => void): void {
  for (const n of notes) {
    ctx.save();
    if (n.decl) {
      const d = n.decl, [x0, y0, x1, y1] = d.line;
      ctx.globalAlpha = n.t;
      ctx.strokeStyle = d.colour;
      ctx.lineWidth = d.width;
      ctx.setLineDash([3 * d.width, 3 * d.width]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);
      const q = d.markPx / Math.SQRT2, [mx, my] = d.mark;
      ctx.beginPath();
      ctx.moveTo(mx, my - q);
      ctx.lineTo(mx + q, my);
      ctx.lineTo(mx, my + q);
      ctx.lineTo(mx - q, my);
      ctx.closePath();
      ctx.fillStyle = d.colour;
      ctx.fill();
      ctx.strokeStyle = n.surface;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (n.lead && n.card) {
      const [x0, y0, x1, y1] = n.lead.line;
      ctx.strokeStyle = n.lead.colour;
      ctx.lineWidth = 1.2;
      if (n.lead.dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // the mark: the icon, and the dot covering it as the zoom turns it into one
    if (n.t > 0) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(0.1, n.r - n.ringW / 2), 0, 2 * Math.PI);
      ctx.fillStyle = n.fill;
      ctx.fill();
      ctx.strokeStyle = n.ring;
      ctx.lineWidth = n.ringW;
      if (n.dashed) ctx.setLineDash([3 * n.ringW, 2 * n.ringW]);
      ctx.stroke();
      ctx.setLineDash([]);
      glyph(n);
    }
    if (n.t < 1) {
      const s = n.r / 12;
      ctx.globalAlpha = 1 - n.t;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 1.5 * s, 0, 2 * Math.PI);
      ctx.fillStyle = n.dot;
      ctx.fill();
      ctx.strokeStyle = n.surface;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // the card: its accent down its left, its edge, its text and who wrote it
    const c = n.card;
    if (c) {
      ctx.fillStyle = c.accent;
      roundRect(ctx, c.x, c.y, c.w, c.h, 8);
      ctx.fill();
      ctx.strokeStyle = c.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = c.bg;
      roundRect(ctx, c.x + 2, c.y, c.w - 2, c.h, 8);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = `12.5px ${font}`;
      ctx.fillStyle = c.textColour;
      const lh = 12.5 * 1.45, bottom = c.y + c.h - 6 - (c.by ? 20 : 0);
      let y = c.y + 7 + 12.8;
      for (const line of wrapText(c.text, c.w - 22, (t) => ctx.measureText(t).width)) {
        if (y > bottom + 1) break;
        ctx.fillText(line, c.x + 12, y);
        y += lh;
      }
      if (c.by) {
        ctx.font = `11px ${font}`;
        ctx.fillStyle = c.byColour;
        ctx.fillText(c.by, c.x + 12, c.y + c.h - 9);
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- the foot

/** VisualProof's wordmark: its gradient's colours, left to right (the page's `--grad`) */
export const BRAND = ["#5e5ce6", "#bf5af2", "#ff375f"] as const;
/** The foot's line for a project's git source and commit: "github.com/A/B · main @ 1a2b3c4", and
 *  "(modified)" where a file of it differed from the commit. */
export function sourceLine(git: GitSource): string {
  const at = `${git.branch ? `${git.branch} @ ` : ""}${git.commit.slice(0, 7)}${git.dirty ? " (modified)" : ""}`;
  return git.source ? `${git.source} · ${at}` : `commit ${at}`;
}

/** An artwork's foot (the owner's decision of 2026-10-15), written with `ctx` in the screen's pixels
 *  inside the frame `rect`, on halos of `halo`: "Generated by VisualProof" at the bottom left,
 *  VisualProof in its wordmark; at the bottom right, where it is given, the source's line — a line
 *  higher where the frame is too narrow for both side by side. Its size is `size` hundredths of the
 *  frame's height (the owner's decision of 2026-10-15), its room from the edges as much; smaller
 *  where a line of it would not fit across. */
export function drawFoot(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, source: string | null, colours: { text: string; halo: string }, font: string, size: number): void {
  let px = (size / 100) * rect.h;
  const pre = "Generated by ";
  const fonts = (px: number) => [`500 ${px}px ${font}`, `700 ${px * 1.1}px ${font}`];
  const widths = () => {
    const [plain, mark] = fonts(px);
    ctx.font = plain;
    const pw = ctx.measureText(pre).width, sw = source ? ctx.measureText(source).width : 0;
    ctx.font = mark;
    return { pw, bw: ctx.measureText("VisualProof").width, sw };
  };
  ctx.save();
  let { pw, bw, sw } = widths();
  const wide = Math.max(pw + bw, sw);
  if (wide > rect.w - 2 * px) {
    px *= rect.w / (wide + 2 * px);
    ({ pw, bw, sw } = widths());
  }
  const [plain, mark] = fonts(px);
  const y = rect.y + rect.h - px, x = rect.x + px, right = rect.x + rect.w - px;
  const sy = source && x + pw + bw + 1.6 * px > right - sw ? y - px * 1.4 : y;
  const grad = ctx.createLinearGradient(x + pw, 0, x + pw + bw, 0);
  BRAND.forEach((c, k) => grad.addColorStop(k / (BRAND.length - 1), c));
  writeNames(
    ctx,
    [
      { text: pre, x, y, font: plain, align: "left", fill: colours.text },
      { text: "VisualProof", x: x + pw, y, font: mark, align: "left", fill: grad },
      ...(source ? [{ text: source, x: right, y: sy, font: plain, align: "right" as const, fill: colours.text }] : []),
    ],
    colours.halo,
  );
  ctx.restore();
}

// ---------------------------------------------------------------- the ground and the title

/** The ground of an artwork's style behind the board, within the frame `rect` (the screen's pixels),
 *  written with `ctx` (the owner's decisions of 2026-10-15): the cells' a dark field lit towards its
 *  middle; the starfield's a night sky, darker at its edges, with a dust of faint stars that keeps
 *  its place in the frame. None for the board's style, whose ground is the theme's. */
export function drawBackdrop(ctx: CanvasRenderingContext2D, style: ArtStyle, rect: { x: number; y: number; w: number; h: number }): void {
  if (style === "board") return;
  const { x, y, w, h } = rect;
  ctx.save();
  const stars = style === "stars";
  const g = stars ? ctx.createRadialGradient(x + w * 0.5, y + h * 0.4, 0, x + w * 0.5, y + h * 0.4, w * 0.8) : ctx.createRadialGradient(x + w * 0.55, y + h * 0.45, 0, x + w * 0.55, y + h * 0.45, w * 0.7);
  g.addColorStop(0, stars ? "#101833" : "#121a28");
  g.addColorStop(1, stars ? "#04060c" : "#090c12");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  if (stars) {
    // the dust: the same faint stars in the same places of every frame of this shape
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const n = Math.round(Math.min(1500, (w * h) / 700));
    for (let k = 0; k < n; k++) {
      const [px, py, r, a] = [x + rnd() * w, y + rnd() * h, 0.25 + rnd() * rnd() * 0.9, 0.12 + rnd() * 0.45];
      ctx.beginPath();
      ctx.arc(px, py, r, 0, 2 * Math.PI);
      ctx.fillStyle = rnd() < 0.2 ? `rgba(255, 226, 190, ${a.toFixed(3)})` : `rgba(214, 226, 255, ${a.toFixed(3)})`;
      ctx.fill();
    }
  }
  ctx.restore();
}

/** An artwork's title and the line under it at the top left of the frame `rect` (the screen's
 *  pixels), written with `ctx` on halos of `halo` (the owner's decisions of 2026-10-15): the title in
 *  spaced capitals of Jost in every style, `size` hundredths of the frame's height its letters' em,
 *  as its top-level clusters' names are; the line under it in the style's own face, about a third of
 *  it. The styles differ in colour and weight: the board's in the theme's ink, the cells' in a pale
 *  light, the starfield's in a pale gold, its line in serif italics. `ink` and `quiet`: the theme's
 *  strong and quiet text, for the board's style. */
export function drawTitle(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, title: string, subtitle: string, size: number, style: ArtStyle, colours: { ink: string; quiet: string; halo: string }): void {
  if (!title && !subtitle) return;
  let t = (size / 100) * rect.h * 0.8, sub = Math.max(7, (size / 100) * rect.h * 0.36);
  const margin = Math.max(14, rect.w * 0.035), x = rect.x + margin, top = rect.y + Math.max(14, rect.h * 0.035);
  const caps = title.toUpperCase();
  const titleFont = (px: number) => `${style === "stars" ? 400 : 500} ${px}px ${ART_DISPLAY}`;
  const lineFont = (px: number) => (style === "stars" ? `italic 400 ${px * 1.05}px ${ART_SERIF}` : `400 ${px}px ${ART_SANS}`);
  ctx.save();
  // what does not fit across the frame within its margins is drawn smaller until it does (the owner's
  // decision of 2026-10-15): the title with its line under it, the line alone where it is the longer
  const room = rect.w - 2 * margin;
  const across = (font: string, text: string, spacing: number) => {
    ctx.font = font;
    return spacedWidth(ctx, text, spacing);
  };
  if (title) {
    const w = across(titleFont(t), caps, 0.18 * t);
    if (w > room) [t, sub] = [(t * room) / w, (sub * room) / w];
  }
  if (subtitle) {
    const w = across(lineFont(sub), subtitle, 0);
    if (w > room) sub = (sub * room) / w;
  }
  // the capitals' top at the margin, the line under them
  const ty = top + t * 0.72, sy = title ? ty + sub * 1.9 : top + sub;
  const items: Written[] = [];
  const capitals = (fill: string | CanvasGradient): Written => ({ text: caps, x, y: ty, font: titleFont(t), align: "left", fill, spacing: 0.18 * t });
  const line = (fill: string): Written => ({ text: subtitle, x, y: sy, font: lineFont(sub), align: "left", fill });
  if (style === "cells") {
    const fill = ctx.createLinearGradient(x, 0, x + t * 9, 0);
    fill.addColorStop(0, "#dfe7ff");
    fill.addColorStop(1, "#9fb6ff");
    if (title) items.push(capitals(fill));
    if (subtitle) items.push(line("rgba(200, 208, 224, 0.78)"));
  } else if (style === "stars") {
    if (title) items.push(capitals("#f1e6c8"));
    if (subtitle) items.push(line("rgba(200, 212, 236, 0.8)"));
  } else {
    if (title) items.push(capitals(colours.ink));
    if (subtitle) items.push(line(colours.quiet));
  }
  writeNames(ctx, items, colours.halo);
  ctx.restore();
}

/** A thin line round the whole of the frame `rect` (the screen's pixels), a little within its edge,
 *  in `colour` (the owner's decision of 2026-10-15): its inset and its width a part of the frame's
 *  shorter side, so that the picture's are the frame's, more pixels. */
export function drawBorder(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, colour: string): void {
  const inset = borderInset(rect), width = Math.max(0.6, Math.min(rect.w, rect.h) * 0.0012);
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.rect(rect.x + inset, rect.y + inset, rect.w - 2 * inset, rect.h - 2 * inset);
  ctx.stroke();
  ctx.restore();
}

/** How far within the frame `rect` its border runs: what lies outside it is the ground alone. */
export function borderInset(rect: { w: number; h: number }): number {
  return Math.max(3, Math.min(rect.w, rect.h) * 0.006);
}

/** The band between the frame `rect` and its border, as a path to fill or clip by the even-odd rule:
 *  what an artwork with a border keeps to its ground (the owner's decision of 2026-10-15). */
export function borderBand(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }): void {
  const i = borderInset(rect);
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.rect(rect.x + i, rect.y + i, rect.w - 2 * i, rect.h - 2 * i);
}

/** The title an artwork has where the reader gave none: the project's name; and its line: how many
 *  declarations the project holds and how many targets its review has. */
export function titleOf(project: string, declarations: number, targets: number): { title: string; subtitle: string } {
  const n = (k: number, one: string) => `${k.toLocaleString("en-US")} ${one}${k === 1 ? "" : "s"}`;
  return { title: project, subtitle: `${n(declarations, "declaration")} · ${n(targets, "target")}` };
}

/** An icon's glyph as a picture of its own (`<svg>`, `px` across) in `colour`. */
export function glyphSvg(glyph: string, colour: string, px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${px}" height="${px}" color="${esc(colour)}">${glyph}</svg>`;
}

/** A bundled edge's points: the shader's clamped uniform cubic B-spline through its control points,
 *  straightened by `beta` towards the chord, sampled (web/src/gl/renderer.ts, BUNDLE_VS). */
export function bundlePoints(ctrl: readonly number[], beta: number, segs = 32): number[] {
  const n = ctrl.length / 2;
  const ax = ctrl[0], ay = ctrl[1], bx = ctrl[2 * n - 2], by = ctrl[2 * n - 1];
  const den = Math.max(n - 1, 1);
  const Q = (j: number): [number, number] => {
    const t = j / den;
    return [ax + (bx - ax) * t + (ctrl[2 * j] - (ax + (bx - ax) * t)) * beta, ay + (by - ay) * t + (ctrl[2 * j + 1] - (ay + (by - ay) * t)) * beta];
  };
  const out: number[] = [];
  for (let k = 0; k <= segs; k++) {
    const x = (k / segs) * (n + 1);
    const s = Math.min(Math.floor(x), n);
    const f = x - s;
    const j = (d: number) => Math.min(Math.max(s + d, 0), n - 1);
    const [q0, q1, q2, q3] = [Q(j(-2)), Q(j(-1)), Q(j(0)), Q(j(1))];
    const f2 = f * f, f3 = f2 * f, g = 1 - f;
    const w0 = (g * g * g) / 6, w1 = (4 - 6 * f2 + 3 * f3) / 6, w2 = (1 + 3 * f + 3 * f2 - 3 * f3) / 6, w3 = f3 / 6;
    out.push(q0[0] * w0 + q1[0] * w1 + q2[0] * w2 + q3[0] * w3, q0[1] * w0 + q1[1] * w1 + q2[1] * w2 + q3[1] * w3);
  }
  return out;
}

// ---------------------------------------------------------------- SVG

const n2 = (v: number) => +v.toFixed(2);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A CSS colour as SVG writes it everywhere: `rgb(…)` and an opacity apart. The forms the page's
 *  style gives (hex, rgb(), rgba()) are read; any other is written as it is, opaque. */
export function svgColour(css: string, alpha = 1): { rgb: string; a: number } {
  const s = css.trim();
  let r: number, g: number, b: number, a = 1;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
  if (hex && [3, 4, 6, 8].includes(hex[1].length)) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    [r, g, b] = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else if (fn) {
    [r, g, b] = [fn[1], fn[2], fn[3]].map(Number);
    if (fn[4] !== undefined) a = fn[4].endsWith("%") ? parseFloat(fn[4]) / 100 : Number(fn[4]);
  } else return { rgb: s, a: alpha };
  return { rgb: `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`, a: +(a * alpha).toFixed(3) };
}

/** A colour of the renderer's (0 to 1) as SVG writes it. */
function glColour(c: readonly number[]): { rgb: string; a: number } {
  return { rgb: `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`, a: +c[3].toFixed(3) };
}

const paint = (attr: "fill" | "stroke", c: { rgb: string; a: number }) => ` ${attr}="${c.rgb}"${c.a < 1 ? ` ${attr}-opacity="${c.a}"` : ""}`;

/** A gradient handed out by SvgContext.createLinearGradient or createRadialGradient: its stops,
 *  written into the picture's definitions where it is used; `r`, a radial one's circles' radii. */
class SvgGradient {
  stops: [number, string][] = [];
  id = "";
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly r: [number, number] | null;
  constructor(x0: number, y0: number, x1: number, y1: number, r: [number, number] | null = null) {
    [this.x0, this.y0, this.x1, this.y1, this.r] = [x0, y0, x1, y1, r];
  }
  addColorStop(offset: number, colour: string): void {
    this.stops.push([offset, colour]);
  }
}

interface PenState {
  fillStyle: string | SvgGradient;
  strokeStyle: string | SvgGradient;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  dash: number[];
  /** the transform: setTransform's, translate's and rotate's */
  m: [number, number, number, number, number, number];
  letterSpacing: string;
}

/** What a canvas's 2D context draws, recorded as SVG: as much of the context as the board uses to
 *  write its names and marks over its renderer's drawing (GraphCanvas.drawMarks), and the notes. A
 *  path is written when it is filled or stroked, a text when it is written; what is cleared is
 *  nothing. `measure` gives a text's width in a CSS font. */
export class SvgContext {
  readonly body: string[] = [];
  readonly defs: string[] = [];
  private st: PenState = { fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic", globalAlpha: 1, lineCap: "butt", lineJoin: "miter", dash: [], m: [1, 0, 0, 1, 0, 0], letterSpacing: "0px" };
  private stack: PenState[] = [];
  private d: string[] = [];
  private open = false;
  private ids = 0;
  /** gradients written once for every circle of their look and colour */
  private shared = new Map<string, string>();
  private measure: (text: string, font: string) => number;
  private family: string;

  constructor(measure: (text: string, font: string) => number, family: string) {
    this.measure = measure;
    this.family = family;
  }

  get fillStyle(): string | SvgGradient { return this.st.fillStyle; }
  set fillStyle(v: string | SvgGradient) { this.st.fillStyle = v; }
  get strokeStyle(): string | SvgGradient { return this.st.strokeStyle; }
  set strokeStyle(v: string | SvgGradient) { this.st.strokeStyle = v; }
  get lineWidth(): number { return this.st.lineWidth; }
  set lineWidth(v: number) { this.st.lineWidth = v; }
  get font(): string { return this.st.font; }
  set font(v: string) { this.st.font = v; }
  get textAlign(): CanvasTextAlign { return this.st.textAlign; }
  set textAlign(v: CanvasTextAlign) { this.st.textAlign = v; }
  get textBaseline(): CanvasTextBaseline { return this.st.textBaseline; }
  set textBaseline(v: CanvasTextBaseline) { this.st.textBaseline = v; }
  get globalAlpha(): number { return this.st.globalAlpha; }
  set globalAlpha(v: number) { this.st.globalAlpha = v; }
  get lineCap(): CanvasLineCap { return this.st.lineCap; }
  set lineCap(v: CanvasLineCap) { this.st.lineCap = v; }
  get lineJoin(): CanvasLineJoin { return this.st.lineJoin; }
  set lineJoin(v: CanvasLineJoin) { this.st.lineJoin = v; }
  get letterSpacing(): string { return this.st.letterSpacing; }
  set letterSpacing(v: string) { this.st.letterSpacing = v; }

  save(): void {
    this.stack.push({ ...this.st, dash: [...this.st.dash], m: [...this.st.m] });
  }
  restore(): void {
    this.st = this.stack.pop() ?? this.st;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.st.m = [a, b, c, d, e, f];
  }
  translate(x: number, y: number): void {
    const [a, b, c, d, e, f] = this.st.m;
    this.st.m = [a, b, c, d, a * x + c * y + e, b * x + d * y + f];
  }
  rotate(t: number): void {
    const [a, b, c, d, e, f] = this.st.m;
    const [cs, sn] = [Math.cos(t), Math.sin(t)];
    this.st.m = [a * cs + c * sn, b * cs + d * sn, c * cs - a * sn, d * cs - b * sn, e, f];
  }
  clearRect(): void {}
  setLineDash(segments: number[]): void {
    this.st.dash = [...segments];
  }
  getLineDash(): number[] {
    return [...this.st.dash];
  }
  measureText(text: string): { width: number } {
    const spacing = parseFloat(this.st.letterSpacing) || 0;
    return { width: this.measure(text, this.st.font) + spacing * [...text].length };
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SvgGradient {
    const [a, b] = this.at(x0, y0), [c, d] = this.at(x1, y1);
    return new SvgGradient(a, b, c, d);
  }
  /** A radial gradient: from a circle at (x0, y0) of radius r0 to one at (x1, y1) of radius r1. */
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): SvgGradient {
    const [a, b] = this.at(x0, y0), [c, d] = this.at(x1, y1), k = this.scale();
    return new SvgGradient(a, b, c, d, [r0 * k, r1 * k]);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
  }

  // the path
  beginPath(): void {
    this.d = [];
    this.open = false;
  }
  moveTo(x: number, y: number): void {
    this.d.push(`M${this.pt(x, y)}`);
    this.open = true;
  }
  lineTo(x: number, y: number): void {
    this.d.push(`${this.open ? "L" : "M"}${this.pt(x, y)}`);
    this.open = true;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.d.push(`Q${this.pt(cx, cy)} ${this.pt(x, y)}`);
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.d.push(`C${this.pt(c1x, c1y)} ${this.pt(c2x, c2y)} ${this.pt(x, y)}`);
  }
  closePath(): void {
    this.d.push("Z");
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  /** An arc as the canvas draws it: a line from where the path is to its start, then the arc; a
   *  whole turn or more is a circle, in two halves. */
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    const T = 2 * Math.PI;
    const p = (a: number) => this.pt(x + r * Math.cos(a), y + r * Math.sin(a));
    const R = n2(r * this.scale());
    this.d.push(`${this.open ? "L" : "M"}${p(a0)}`);
    this.open = true;
    const span = ccw ? a0 - a1 : a1 - a0;
    const sweep = ccw ? 0 : 1;
    if (span >= T) {
      const mid = ccw ? a0 - Math.PI : a0 + Math.PI;
      this.d.push(`A${R} ${R} 0 1 ${sweep} ${p(mid)}A${R} ${R} 0 1 ${sweep} ${p(a0)}`);
      return;
    }
    const delta = ((span % T) + T) % T;
    this.d.push(`A${R} ${R} 0 ${delta > Math.PI ? 1 : 0} ${sweep} ${p(ccw ? a0 - delta : a0 + delta)}`);
  }

  fill(): void {
    if (this.d.length) this.body.push(`<path d="${this.d.join("")}"${this.style("fill")}/>`);
  }
  stroke(): void {
    if (this.d.length) this.body.push(`<path d="${this.d.join("")}" fill="none"${this.style("stroke")}${this.lines()}/>`);
  }
  fillText(text: string, x: number, y: number): void {
    this.body.push(`<text ${this.textAt(x, y)}${this.style("fill")}>${esc(text)}</text>`);
  }
  strokeText(text: string, x: number, y: number): void {
    this.body.push(`<text ${this.textAt(x, y)} fill="none"${this.style("stroke")}${this.lines()}>${esc(text)}</text>`);
  }

  /** A rectangle (the context's pixels) to clip to, by its id: an artwork's inside its border. */
  clipRect(id: string, x: number, y: number, w: number, h: number): void {
    const [x0, y0] = this.at(x, y), k = this.scale();
    this.defs.push(`<clipPath id="${id}"><rect x="${n2(x0)}" y="${n2(y0)}" width="${n2(w * k)}" height="${n2(h * k)}"/></clipPath>`);
  }

  /** SVG's own markup, written as it is: a note's glyph. */
  raw(markup: string): void {
    this.body.push(markup);
  }

  /** A shape the board's renderer draws (GraphCanvas.artShapes), as SVG draws it. */
  shape(s: ArtShape): void {
    if (s.kind === "circle" && (s.look || s.halo)) return this.lit(s);
    if (s.kind === "circle") {
      const fill = s.fill[3] > 0.002 ? glColour(s.fill) : null;
      const ring = s.stroke ? `${paint("stroke", glColour(s.stroke))} stroke-width="${n2(s.ring)}"${s.dashed ? ` stroke-dasharray="5 4"` : ""}` : "";
      const c = `cx="${n2(s.x)}" cy="${n2(s.y)}"`;
      if (fill && ring && Math.abs(s.ringR - s.r) < 0.01) this.body.push(`<circle ${c} r="${n2(s.r)}"${paint("fill", fill)}${ring}/>`);
      else {
        if (fill) this.body.push(`<circle ${c} r="${n2(s.r)}"${paint("fill", fill)}/>`);
        if (ring) this.body.push(`<circle ${c} r="${n2(s.ringR)}" fill="none"${ring}/>`);
      }
    } else if (s.kind === "line") {
      this.body.push(`<line x1="${n2(s.x0)}" y1="${n2(s.y0)}" x2="${n2(s.x1)}" y2="${n2(s.y1)}"${paint("stroke", glColour(s.colour))} stroke-width="${n2(s.width)}"/>`);
    } else {
      // the shader's spline, as finely as it draws it
      const pts = bundlePoints(s.ctrl, s.beta, 48);
      const d = `M${n2(pts[0])},${n2(pts[1])}${Array.from({ length: pts.length / 2 - 1 }, (_, k) => `L${n2(pts[2 * k + 2])},${n2(pts[2 * k + 3])}`).join("")}`;
      const a = glColour(s.c0), b = glColour(s.c1);
      let stroke: string;
      if (a.rgb === b.rgb && a.a === b.a) stroke = paint("stroke", a);
      else {
        // from the end that uses to the end used, as the renderer colours it
        const id = `e${this.ids++}`;
        const n = pts.length;
        this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n2(pts[0])}" y1="${n2(pts[1])}" x2="${n2(pts[n - 2])}" y2="${n2(pts[n - 1])}"><stop offset="0" stop-color="${a.rgb}" stop-opacity="${a.a}"/><stop offset="1" stop-color="${b.rgb}" stop-opacity="${b.a}"/></linearGradient>`);
        stroke = ` stroke="url(#${id})"`;
      }
      this.body.push(`<path d="${d}" fill="none"${stroke} stroke-width="${n2(s.width)}"/>`);
    }
  }

  /** A circle of an artwork's style, as the renderer draws it: a glow fading from its centre; a
   *  fill fading from a light at its top left; its ring a halo fading to both sides. Gradients a glow
   *  or a fill of one colour share are written once. */
  private lit(s: Extract<ArtShape, { kind: "circle" }>): void {
    const c = `cx="${n2(s.x)}" cy="${n2(s.y)}"`;
    if (s.halo && s.stroke) {
      const k = glColour(s.stroke), R = s.ringR + s.ring / 2;
      const at = (d: number) => +Math.max(0, Math.min(1, d / R)).toFixed(4);
      const id = `h${this.ids++}`;
      const stops = [[0, 0], [at(s.ringR - s.ring / 2), 0], [at(s.ringR - s.ring / 4), 0.25], [at(s.ringR), 1], [at(s.ringR + s.ring / 4), 0.25], [1, 0]];
      this.defs.push(`<radialGradient id="${id}">${stops.map(([o, a]) => `<stop offset="${o}" stop-color="${k.rgb}" stop-opacity="${+(a * k.a).toFixed(3)}"/>`).join("")}</radialGradient>`);
      this.body.push(`<circle ${c} r="${n2(R)}" fill="url(#${id})"/>`);
    }
    if (s.fill[3] > 0.002) {
      const k = glColour(s.fill);
      const key = `${s.look}|${k.rgb}|${k.a}`;
      let id = this.shared.get(key);
      if (!id) {
        id = `l${this.ids++}`;
        this.shared.set(key, id);
        this.defs.push(
          s.look === "glow"
            ? `<radialGradient id="${id}">${[0, 0.25, 0.5, 0.75, 1].map((o) => `<stop offset="${o}" stop-color="${k.rgb}" stop-opacity="${+((1 - o) ** 2 * k.a).toFixed(3)}"/>`).join("")}</radialGradient>`
            : `<radialGradient id="${id}" cx="0.375" cy="0.35" r="0.65"><stop offset="0" stop-color="${k.rgb}" stop-opacity="${k.a}"/><stop offset="1" stop-color="${k.rgb}" stop-opacity="${+(k.a * 0.25).toFixed(3)}"/></radialGradient>`,
        );
      }
      this.body.push(`<circle ${c} r="${n2(s.r)}" fill="url(#${id})"/>`);
    }
    if (s.stroke && !s.halo) this.body.push(`<circle ${c} r="${n2(s.ringR)}" fill="none"${paint("stroke", glColour(s.stroke))} stroke-width="${n2(s.ring)}"${s.dashed ? ` stroke-dasharray="5 4"` : ""}/>`);
  }

  private scale(): number {
    const [a, b, c, d] = this.st.m;
    return Math.sqrt(Math.abs(a * d - b * c));
  }
  private at(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.st.m;
    return [a * x + c * y + e, b * x + d * y + f];
  }
  private pt(x: number, y: number): string {
    const [px, py] = this.at(x, y);
    return `${n2(px)},${n2(py)}`;
  }
  /** A fill's or a stroke's paint: a colour (and the context's alpha), or a gradient written once. */
  private style(attr: "fill" | "stroke"): string {
    const v = attr === "fill" ? this.st.fillStyle : this.st.strokeStyle;
    const alpha = this.st.globalAlpha;
    if (typeof v === "string") return paint(attr, svgColour(v, alpha));
    if (!v.id) {
      v.id = `g${this.ids++}`;
      const stops = v.stops.map(([o, c]) => {
        const k = svgColour(c);
        return `<stop offset="${o}" stop-color="${k.rgb}" stop-opacity="${k.a}"/>`;
      });
      this.defs.push(
        v.r
          ? `<radialGradient id="${v.id}" gradientUnits="userSpaceOnUse" fx="${n2(v.x0)}" fy="${n2(v.y0)}" fr="${n2(v.r[0])}" cx="${n2(v.x1)}" cy="${n2(v.y1)}" r="${n2(v.r[1])}">${stops.join("")}</radialGradient>`
          : `<linearGradient id="${v.id}" gradientUnits="userSpaceOnUse" x1="${n2(v.x0)}" y1="${n2(v.y0)}" x2="${n2(v.x1)}" y2="${n2(v.y1)}">${stops.join("")}</linearGradient>`,
      );
    }
    return ` ${attr}="url(#${v.id})"${alpha < 1 ? ` ${attr}-opacity="${+alpha.toFixed(3)}"` : ""}`;
  }
  private lines(): string {
    const s = this.st, k = this.scale();
    return ` stroke-width="${n2(s.lineWidth * k)}"${s.lineCap !== "butt" ? ` stroke-linecap="${s.lineCap}"` : ""}${s.lineJoin !== "miter" ? ` stroke-linejoin="${s.lineJoin}"` : ""}${s.dash.length ? ` stroke-dasharray="${s.dash.map((x) => n2(x * k)).join(" ")}"` : ""}`;
  }
  /** Where a text is written and in what font, as SVG's attributes. */
  private textAt(x: number, y: number): string {
    const [px, py] = this.at(x, y);
    const f = /^\s*((?:(?:italic|oblique|normal|bold|bolder|lighter|\d{3})\s+)*)([\d.]+)px\s+(.+?)\s*$/i.exec(this.st.font);
    const words = (f?.[1] ?? "").trim().toLowerCase().split(/\s+/);
    const size = f ? Number(f[2]) * this.scale() : 10;
    const family = f?.[3] ?? "sans-serif";
    const weight = words.find((w) => /^\d{3}$|^bold/.test(w));
    const italic = words.some((w) => w === "italic" || w === "oblique");
    const align = this.st.textAlign;
    const anchor = align === "center" ? "middle" : align === "right" || align === "end" ? "end" : null;
    const base = this.st.textBaseline;
    const baseline = base === "middle" ? "central" : base === "top" || base === "hanging" ? "hanging" : base === "bottom" || base === "ideographic" ? "text-after-edge" : null;
    // turned where the transform turns (a name along an arc), spaced where the letters are
    const [ma, mb] = this.st.m;
    const turn = Math.atan2(mb, ma) * (180 / Math.PI);
    const spacing = parseFloat(this.st.letterSpacing) || 0;
    return (
      `x="${n2(px)}" y="${n2(py)}" font-size="${n2(size)}"` +
      (Math.abs(turn) > 0.01 ? ` transform="rotate(${n2(turn)} ${n2(px)} ${n2(py)})"` : "") +
      (spacing ? ` letter-spacing="${n2(spacing * this.scale())}"` : "") +
      (weight && weight !== "400" && weight !== "normal" ? ` font-weight="${weight}"` : "") +
      (italic ? ` font-style="italic"` : "") +
      (family !== this.family ? ` font-family="${esc(family)}"` : "") +
      (anchor ? ` text-anchor="${anchor}"` : "") +
      (baseline ? ` dominant-baseline="${baseline}"` : "")
    );
  }
}

/** The picture as SVG: what `draw` draws with an SvgContext in the screen's pixels, within the
 *  rectangle `frame` of the screen, `size` pixels in size; on `background` where there is one.
 *  `family`: the board's font, the picture's own. */
export function artSvg(frame: { x: number; y: number; w: number; h: number }, size: { w: number; h: number }, background: string | null, family: string, measure: (text: string, font: string) => number, draw: (pen: SvgContext) => void, faces = ""): string {
  const pen = new SvgContext(measure, family);
  draw(pen);
  const bg = background ? svgColour(background) : null;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n2(frame.w)} ${n2(frame.h)}" width="${size.w}" height="${size.h}" font-family="${esc(family)}">` +
    `<defs>${faces ? `<style>${faces}</style>` : ""}<clipPath id="frame"><rect width="${n2(frame.w)}" height="${n2(frame.h)}"/></clipPath>${pen.defs.join("")}</defs>` +
    (bg ? `<rect width="100%" height="100%"${paint("fill", bg)}/>` : "") +
    `<g clip-path="url(#frame)"><g transform="translate(${n2(-frame.x)} ${n2(-frame.y)})">${pen.body.join("")}</g></g></svg>`
  );
}

/** A name for the picture's file, from the view's title: what no file system refuses. */
export function artName(title: string, ext: "png" | "svg"): string {
  const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/[. ]+$/, "") || "VisualProof";
  return `${base}.${ext}`;
}

// ---------------------------------------------------------------- PNG, in bands

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG chunk: its length, type, data and CRC. */
function chunk(type: string, data: Uint8Array): Uint8Array[] {
  const head = new Uint8Array(8);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, data.length);
  const t = new TextEncoder().encode(type);
  head.set(t, 4);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, crc32([t, data]));
  return [head, data, tail];
}

/** A PNG of `w` × `h` RGBA pixels, its rows given band by band (`bands` yields each band's pixels,
 *  rows top to bottom, 4 bytes a pixel), compressed as they come: no picture of the full size is ever
 *  held, so the size is not the browser's canvas's to limit. */
export async function encodePng(w: number, h: number, bands: AsyncIterable<Uint8ClampedArray | Uint8Array>): Promise<Blob> {
  const z = new CompressionStream("deflate");
  const writer = z.writable.getWriter();
  const out: Uint8Array[] = [];
  const reading = (async () => {
    const r = z.readable.getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      out.push(value);
    }
  })();
  const stride = 4 * w;
  let rows = 0;
  for await (const band of bands) {
    const n = band.length / stride;
    // each row: filter type 0, then its pixels
    const buf = new Uint8Array(n * (stride + 1));
    for (let y = 0; y < n; y++) buf.set(band.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    await writer.write(buf);
    rows += n;
  }
  if (rows !== h) throw new Error(`a PNG of ${h} rows was given ${rows}`);
  await writer.close();
  await reading;
  let size = 0;
  for (const p of out) size += p.length;
  const idat = new Uint8Array(size);
  let at = 0;
  for (const p of out) {
    idat.set(p, at);
    at += p.length;
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([sig, ...chunk("IHDR", ihdr), ...chunk("IDAT", idat), ...chunk("IEND", new Uint8Array(0))] as BlobPart[], { type: "image/png" });
}
