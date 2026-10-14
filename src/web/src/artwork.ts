// Artwork (ExportSpec decision 19, the owner's decisions of 2026-10-13 and 2026-10-14): the board as
// a picture, PNG or SVG, at a size of the reader's choosing. From the Export window's Artwork tab the
// page goes into framing: a frame fixed in the middle of the screen, of the size's shape, the rest of
// the screen shaded; the reader pans and zooms the board under it, and what lies in the frame is what
// is drawn. A panel beside it sets the size and the look — the colouring and the theme, the
// background, the labels, the edges, the notes, the targets, the selection — and the frame shows the
// picture as it will be, once the board is still.
//
// The picture is drawn here, as vectors, from where the board draws things now (web/src/canvas.ts,
// its scene): the circles, the points in the scheme's colours, the edges bundled through the
// clusters as the overview bundles them (web/src/bundles.ts, the shader's spline in
// web/src/gl/renderer.ts), the names as the board writes them — a cluster's inside the top of its
// circle, a declaration's beside its point, none over another — the notes' icons and first words,
// the targets' stars. It is the frame's picture at the frame's size, scaled to the size chosen: the
// same picture, more pixels. SVG is that drawing; PNG is it drawn by the browser at the full size.
// Nothing is asked of the server, so a read-only page and a snapshot can make one too.

import { SITE_BODY, SITE_GRAMMAR, SITE_PROOF, SITE_STMT } from "../../shared/graph.ts";
import { aggregate, pathOf, units } from "./bundles.ts";
import type { GraphCanvas } from "./canvas.ts";
import { KINDS } from "./canvas.ts";
import { rgba } from "./gl/gl.ts";
import { STATUSES } from "./status.ts";

export interface ArtSettings {
  /** the picture's size, pixels */
  w: number;
  h: number;
  scheme: "kind" | "status";
  theme: "light" | "dark";
  background: "theme" | "white" | "transparent";
  labels: "all" | "clusters" | "none";
  edges: "all" | "selection" | "none";
  proofs: boolean;
  notes: boolean;
  /** a target's star and name marked; drawn as any declaration; or it alone, the rest faded */
  targets: "marked" | "plain" | "highlight";
  /** the selection and what is lit drawn as the reader sees them */
  selection: boolean;
}

export const PRESETS: readonly { name: string; w: number; h: number }[] = [
  { name: "1920 × 1080", w: 1920, h: 1080 },
  { name: "3840 × 2160 (4K)", w: 3840, h: 2160 },
  { name: "4096 × 4096", w: 4096, h: 4096 },
  { name: "A3 landscape, 300 dpi", w: 4961, h: 3508 },
  { name: "A3 portrait, 300 dpi", w: 3508, h: 4961 },
  { name: "A2 landscape, 300 dpi", w: 7016, h: 4961 },
  { name: "A2 portrait, 300 dpi", w: 4961, h: 7016 },
];
export const MAX_SIDE = 16384;

const DEFAULTS: ArtSettings = {
  w: 3840,
  h: 2160,
  scheme: "kind",
  theme: "light",
  background: "theme",
  labels: "all",
  edges: "all",
  proofs: false,
  notes: true,
  targets: "marked",
  selection: true,
};

const one = <T extends string>(v: unknown, of: readonly T[], d: T): T => (of.includes(v as T) ? (v as T) : d);
const side = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(16, Math.min(MAX_SIDE, Math.round(v))) : d);

/** Settings as a browser kept them, each checked, over the defaults. */
export function cleanSettings(s: Partial<ArtSettings> | undefined, now: { scheme: ArtSettings["scheme"]; theme: ArtSettings["theme"] }): ArtSettings {
  const o = (s ?? {}) as Record<string, unknown>;
  return {
    w: side(o.w, DEFAULTS.w),
    h: side(o.h, DEFAULTS.h),
    scheme: one(o.scheme, ["kind", "status"], now.scheme),
    theme: one(o.theme, ["light", "dark"], now.theme),
    background: one(o.background, ["theme", "white", "transparent"], DEFAULTS.background),
    labels: one(o.labels, ["all", "clusters", "none"], DEFAULTS.labels),
    edges: one(o.edges, ["all", "selection", "none"], DEFAULTS.edges),
    proofs: typeof o.proofs === "boolean" ? o.proofs : DEFAULTS.proofs,
    notes: typeof o.notes === "boolean" ? o.notes : DEFAULTS.notes,
    targets: one(o.targets, ["marked", "plain", "highlight"], DEFAULTS.targets),
    selection: typeof o.selection === "boolean" ? o.selection : DEFAULTS.selection,
  };
}

/** A theme's colours, as the page's style defines them, each a plain `rgba()`. */
export interface Palette {
  bg: string;
  disc: string;
  discLine: string;
  label: string;
  text: string;
  kind: Record<string, string>;
  ext: string;
  status: string[];
  edgeFrom: string;
  edgeTo: string;
  accent: string;
  star: string;
  starEdge: string;
  noteIcon: string;
  noteBg: string;
  noteText: string;
}

const css = (c: string, alpha = 1): string => {
  const [r, g, b, a] = rgba(c, alpha);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${+a.toFixed(3)})`;
};

/** The colours of `theme`, read from the page's style with the theme set for the moment of reading
 *  (synchronously: nothing is painted in between). */
export function readPalette(theme: "light" | "dark"): Palette {
  const root = document.documentElement;
  const was = root.dataset.theme;
  root.dataset.theme = theme;
  try {
    const cs = getComputedStyle(document.body);
    const v = (name: string) => cs.getPropertyValue(name).trim();
    const kind: Record<string, string> = {};
    for (const k of KINDS) kind[k] = css(v(`--k-${k}`));
    return {
      bg: css(v("--canvas")),
      disc: css(v("--disc")),
      discLine: css(v("--disc-line")),
      label: css(v("--label")),
      text: css(v("--text-2")),
      kind,
      ext: css(v("--k-external")),
      status: STATUSES.map((st) => css(v(`--status-${st}`))),
      edgeFrom: css(v("--edge-from")),
      edgeTo: css(v("--edge-to")),
      accent: css(v("--accent")),
      star: css(v("--target-star")),
      starEdge: css(v("--target-star-edge")),
      noteIcon: css(v("--note-icon")),
      noteBg: css(v("--note-bg")),
      noteText: css(v("--note-text")),
    };
  } finally {
    if (was === undefined) delete root.dataset.theme;
    else root.dataset.theme = was;
  }
}

/** What a picture draws, in the frame's pixels (its top left at 0, 0). */
export interface ArtScene {
  w: number;
  h: number;
  /** a declaration's point, its radius in pixels */
  dot: number;
  clusters: { x: number; y: number; r: number; label: string; depth: number; folded: boolean }[];
  nodes: { x: number; y: number; kind: string; ext: boolean; status: number; label: string; target: boolean; lit: boolean }[];
  edges: { pts: number[]; width: number; alpha: number; lit: boolean }[];
  notes: { x: number; y: number; words: string }[];
  /** something is selected: what is not lit is drawn faint, as the board draws it */
  lit: boolean;
}

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Helvetica, Arial, sans-serif`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n1 = (v: number) => +v.toFixed(1);

/** A five-pointed star of outer radius `r` at (x, y), as an SVG path. */
function star(x: number, y: number, r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    pts.push(`${n1(x + rr * Math.cos(a))},${n1(y + rr * Math.sin(a))}`);
  }
  return `M${pts.join("L")}Z`;
}

/** The picture of `sc` as SVG, `out` pixels in size, its look `s` in the colours `pal`. `measure`
 *  gives a text's width in a CSS font, for keeping names off each other. */
export function artSvg(sc: ArtScene, pal: Palette, s: ArtSettings, measure: (text: string, font: string) => number): string {
  const out: string[] = [];
  const inFrame = (x: number, y: number, pad: number) => x > -pad && y > -pad && x < sc.w + pad && y < sc.h + pad;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n1(sc.w)} ${n1(sc.h)}" width="${s.w}" height="${s.h}" font-family='${FONT}'>`);
  if (s.background !== "transparent") out.push(`<rect width="100%" height="100%" fill="${s.background === "white" ? "#ffffff" : pal.bg}"/>`);
  const fadeAll = s.targets === "highlight" ? sc.nodes.some((v) => v.target) : s.selection && sc.lit;
  const strong = (v: ArtScene["nodes"][number]) => (s.targets === "highlight" ? v.target : !s.selection || !sc.lit || v.lit);

  // the circles, outermost first; a folded one a shaded disc
  out.push(`<g stroke-width="1">`);
  for (const c of sc.clusters) {
    if (!inFrame(c.x, c.y, c.r)) continue;
    out.push(c.folded ? `<circle cx="${n1(c.x)}" cy="${n1(c.y)}" r="${n1(c.r)}" fill="${pal.discLine}" fill-opacity="0.35" stroke="${pal.discLine}"/>` : `<circle cx="${n1(c.x)}" cy="${n1(c.y)}" r="${n1(c.r)}" fill="${pal.disc}" stroke="${pal.discLine}"/>`);
  }
  out.push(`</g>`);

  // the edges, under the points
  if (s.edges !== "none") {
    out.push(`<g fill="none" stroke-linecap="round">`);
    for (const e of sc.edges) {
      if (s.edges === "selection" && !e.lit) continue;
      const d = `M${n1(e.pts[0])},${n1(e.pts[1])}${Array.from({ length: e.pts.length / 2 - 1 }, (_, k) => `L${n1(e.pts[2 * k + 2])},${n1(e.pts[2 * k + 3])}`).join("")}`;
      const colour = e.lit ? pal.accent : pal.edgeFrom;
      const alpha = e.lit ? 0.8 : fadeAll ? e.alpha * 0.4 : e.alpha;
      out.push(`<path d="${d}" stroke="${colour}" stroke-opacity="${+alpha.toFixed(3)}" stroke-width="${n1(e.width)}"/>`);
    }
    out.push(`</g>`);
  }

  // the points: the outside world as rings, in either scheme
  out.push(`<g>`);
  for (const v of sc.nodes) {
    if (!inFrame(v.x, v.y, sc.dot)) continue;
    const colour = s.scheme === "status" ? pal.status[v.status] ?? pal.ext : v.ext ? pal.ext : pal.kind[v.kind] ?? pal.ext;
    const op = fadeAll && !strong(v) ? ` opacity="0.25"` : "";
    const r = n1(v.lit && s.selection ? sc.dot * 1.35 : sc.dot);
    out.push(v.ext ? `<circle cx="${n1(v.x)}" cy="${n1(v.y)}" r="${r}" fill="none" stroke="${colour}" stroke-width="${n1(Math.max(0.8, sc.dot * 0.45))}"${op}/>` : `<circle cx="${n1(v.x)}" cy="${n1(v.y)}" r="${r}" fill="${colour}"${op}/>`);
  }
  out.push(`</g>`);

  // the targets' stars
  if (s.targets !== "plain") {
    for (const v of sc.nodes) if (v.target && inFrame(v.x, v.y, 12)) out.push(`<path d="${star(v.x, v.y - sc.dot - 7, 6)}" fill="${pal.star}" stroke="${pal.starEdge}" stroke-width="0.8"/>`);
  }

  // the names, as the board writes them: none over another, the clusters' first
  if (s.labels !== "none") {
    const boxes: number[][] = [];
    const free = (x0: number, y0: number, x1: number, y1: number) => !boxes.some((b) => x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]);
    const texts: string[] = [];
    for (const c of sc.clusters) {
      if (!inFrame(c.x, c.y, c.r)) continue;
      let size: number, y: number;
      if (c.folded) {
        if (c.r < 10) continue;
        size = 11;
        y = c.y + c.r + 13;
      } else {
        if (c.r <= 38) continue;
        size = Math.max(10, Math.min(20, 9 + c.r / 40));
        y = c.y - c.r + size + 6;
      }
      const font = `${c.depth === 0 && !c.folded ? 600 : 500} ${size}px ${FONT}`;
      const w = measure(c.label, font) / 2 + 3;
      if (!free(c.x - w, y - size, c.x + w, y + size * 0.3)) continue;
      boxes.push([c.x - w, y - size, c.x + w, y + size * 0.3]);
      texts.push(`<text x="${n1(c.x)}" y="${n1(y)}" text-anchor="middle" font-size="${size}" font-weight="${c.depth === 0 && !c.folded ? 600 : 500}" fill="${pal.label}">${esc(c.label)}</text>`);
    }
    // the targets' names, marked, before every other declaration's
    const named = (v: ArtScene["nodes"][number]) => v.target && s.targets !== "plain";
    const order = sc.nodes.map((_, k) => k).sort((a, b) => Number(named(sc.nodes[b])) - Number(named(sc.nodes[a])));
    for (const k of order) {
      const v = sc.nodes[k];
      if ((s.labels === "clusters" && !named(v)) || !inFrame(v.x, v.y, 8)) continue;
      const bold = named(v);
      const font = `${bold ? 600 : 400} 11px ${FONT}`;
      const w = measure(v.label, font);
      const x0 = v.x + sc.dot + 2, y0 = v.y - 7, x1 = x0 + w + 2, y1 = v.y + 5;
      if (!free(x0, y0, x1, y1)) continue;
      boxes.push([x0, y0, x1, y1]);
      const op = fadeAll && !strong(v) ? ` opacity="0.35"` : "";
      texts.push(`<text x="${n1(v.x + sc.dot + 3)}" y="${n1(v.y + 3.5)}" font-size="11"${bold ? ` font-weight="600"` : ""} fill="${bold ? pal.label : pal.text}"${op}>${esc(v.label)}</text>`);
    }
    out.push(`<g>${texts.join("")}</g>`);
  }

  // the notes: their icon, and their first words
  if (s.notes) {
    for (const nt of sc.notes) {
      if (!inFrame(nt.x, nt.y, 10)) continue;
      out.push(`<rect x="${n1(nt.x - 6)}" y="${n1(nt.y - 6)}" width="12" height="12" rx="2.5" fill="${pal.noteBg}" stroke="${pal.noteIcon}" stroke-width="1.5"/>`);
      if (nt.words) out.push(`<text x="${n1(nt.x + 10)}" y="${n1(nt.y + 4)}" font-size="11" font-style="italic" fill="${pal.noteText}">${esc(nt.words)}</text>`);
    }
  }
  out.push(`</svg>`);
  return out.join("");
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

/** The board as a picture draws it now, in the frame's pixels: the frame is the rectangle `frame`
 *  of the screen (CSS pixels). */
export function sceneOf(C: GraphCanvas, frame: { x: number; y: number; w: number; h: number }, opts: { proofs: boolean; targets: (i: number) => boolean; notes: () => { world: [number, number]; words: string }[] }): ArtScene {
  const S = C.scene;
  const g = C.graph;
  const k = C.cam.k;
  const at = (wx: number, wy: number): [number, number] => {
    const [sx, sy] = C.toScreen(wx, wy);
    return [sx - frame.x, sy - frame.y];
  };
  const clusters: ArtScene["clusters"] = [];
  for (let c = 0; c < S.nc; c++) {
    if (!C.isClusterShown(c)) continue;
    const rep = S.rep[c];
    // inside a folded circle: drawn as that one
    if (rep >= 0 && rep !== c) continue;
    const [x, y] = at(S.cwx[c], S.cwy[c]);
    const cl = C.layout.clusters[c];
    clusters.push({ x, y, r: S.drawnR[c] * k, label: cl.label, depth: cl.depth, folded: rep === c });
  }
  const lit = C.active;
  const nodes: ArtScene["nodes"] = [];
  for (let i = 0; i < g.n; i++) {
    if (!C.isNodeShown(i)) continue;
    const [x, y] = at(...C.posOf(i));
    nodes.push({ x, y, kind: g.isExt(i) ? "external" : g.nodes[i].kind, ext: g.isExt(i), status: C.statusOf(i), label: g.short(i), target: opts.targets(i), lit: !!lit?.[i] });
  }
  // the edges: between what is drawn as itself at this zoom, counted, as the overview bundles them
  const unit = units(S, k, 45);
  const sites = SITE_STMT | SITE_BODY | (opts.proofs ? SITE_PROOF | SITE_GRAMMAR : 0);
  const pairs = aggregate(g, unit, sites, (i) => C.isNodeShown(i) || S.nodeRep[i] >= 0);
  const X = (id: number) => (id < S.nc ? S.cwx[id] : S.nwx[id - S.nc]);
  const Y = (id: number) => (id < S.nc ? S.cwy[id] : S.nwy[id - S.nc]);
  let max = 1;
  for (let p = 0; p < pairs.n; p++) max = Math.max(max, pairs.w[p]);
  const order = Array.from({ length: pairs.n }, (_, p) => p).sort((a, b) => pairs.w[b] - pairs.w[a]);
  const edges: ArtScene["edges"] = [];
  const litEnd = (id: number) => (id >= S.nc ? !!lit?.[id - S.nc] : false);
  for (const p of order) {
    if (edges.length >= 8000) break;
    const a = pairs.a[p], b = pairs.b[p], w = pairs.w[p];
    const [ax, ay] = at(X(a), Y(a)), [bx, by] = at(X(b), Y(b));
    const out = (x: number, y: number) => x < 0 || y < 0 || x > frame.w || y > frame.h;
    if (out(ax, ay) && out(bx, by)) continue;
    const path = pathOf(S, a, b);
    let R = 0;
    for (let q = 1; q < path.length - 1; q++) if (path[q] < S.nc) R = Math.max(R, S.drawnR[path[q]]);
    const d = Math.hypot(X(b) - X(a), Y(b) - Y(a));
    const beta = R > 0 ? 0.85 * Math.min(1, (2 * d) / R) : 0.85;
    const ctrl: number[] = [];
    for (const id of path) ctrl.push(...at(X(id), Y(id)));
    const t = Math.log1p(w) / Math.log1p(max);
    edges.push({ pts: bundlePoints(ctrl, beta), width: 0.7 + 2 * t * Math.min(1, Math.log1p(max) / Math.log1p(50)), alpha: 0.12 + 0.33 * t * t, lit: litEnd(a) && litEnd(b) });
  }
  const notes = opts.notes().map((nt) => {
    const [x, y] = at(nt.world[0], nt.world[1]);
    return { x, y, words: nt.words };
  });
  return { w: frame.w, h: frame.h, dot: C.dotSize, clusters, nodes, edges, notes, lit: !!lit };
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
