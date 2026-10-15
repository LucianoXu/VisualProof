// Names over everything else, each on a halo (the owner's decision of 2026-10-15): strokes of the
// background round its letters, each narrower and stronger than the last, so that the halo fades
// outward and what lies under a name — an edge, a point, a ring — never crosses it. The board writes
// its names so (web/src/canvas.ts), and an artwork's foot and title (web/src/artwork.ts). An
// artwork's cluster names may run along the top of their circle (`arc`), letter by letter.

/** The fonts an artwork writes in (assets/webfonts/, web/style.css): its names' and its foot's,
 *  and the starfield's. */
export const ART_SANS = `"Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
export const ART_SERIF = `"Source Serif 4", Georgia, "Times New Roman", serif`;
/** an artwork's title and its top-level clusters' names, in spaced capitals, in every style (the
 *  owner's decisions of 2026-10-15) */
export const ART_DISPLAY = `"Jost", "Source Sans 3", -apple-system, "Segoe UI", sans-serif`;

/** A name to write: its text, where, in what font, aligned how, in what paint; `spacing`, pixels
 *  between its letters; `arc`, a circle whose top it follows, centred there, its letters' feet on it
 *  (x and y then unused). */
export interface Written {
  text: string;
  x: number;
  y: number;
  font: string;
  align: CanvasTextAlign;
  fill: string | CanvasGradient;
  spacing?: number;
  arc?: { cx: number; cy: number; r: number };
}

/** The halo's strokes, outermost first: width in pixels, opacity. */
export const HALO: readonly [number, number][] = [
  [7, 0.22],
  [4.5, 0.4],
  [2.6, 0.85],
];

/** How wide `text` is in the context's font, with `spacing` pixels between its letters. */
export function spacedWidth(ctx: CanvasRenderingContext2D, text: string, spacing = 0): number {
  if (!spacing) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return w - spacing;
}

/** How far round its circle a name along an arc reaches each way from the top, in radians. */
export function arcHalf(ctx: CanvasRenderingContext2D, n: Written): number {
  ctx.font = n.font;
  return spacedWidth(ctx, n.text, n.spacing ?? 0) / n.arc!.r / 2;
}

/** Write `names` with `ctx`, each on its halo of `colour`: the halos of all of them first, then the
 *  names, so that no halo covers another name. */
export function writeNames(ctx: CanvasRenderingContext2D, names: readonly Written[], colour: string): void {
  if (!names.length) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.textBaseline = "alphabetic";
  ctx.strokeStyle = colour;
  let font = "", align = "";
  const set = (n: Written) => {
    if (n.font !== font) ctx.font = font = n.font;
    if (n.align !== align) ctx.textAlign = (align = n.align) as CanvasTextAlign;
  };
  const one = (n: Written, op: (s: string, x: number, y: number) => void) => {
    set(n);
    if (n.arc) return along(ctx, n, op);
    if (!n.spacing) return op(n.text, n.x, n.y);
    // letter by letter, from where the alignment starts it
    const w = spacedWidth(ctx, n.text, n.spacing);
    let x = n.align === "center" ? n.x - w / 2 : n.align === "right" || n.align === "end" ? n.x - w : n.x;
    ctx.textAlign = "left";
    for (const ch of n.text) {
      op(ch, x, n.y);
      x += ctx.measureText(ch).width + n.spacing;
    }
    ctx.textAlign = n.align;
  };
  for (const [width, alpha] of HALO) {
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    for (const n of names) one(n, (s, x, y) => ctx.strokeText(s, x, y));
  }
  ctx.globalAlpha = 1;
  for (const n of names) {
    ctx.fillStyle = n.fill;
    one(n, (s, x, y) => ctx.fillText(s, x, y));
  }
  ctx.restore();
}

/** A name along the top of its circle, centred at the top, letter by letter, each upright to it. */
function along(ctx: CanvasRenderingContext2D, n: Written, op: (s: string, x: number, y: number) => void): void {
  const { cx, cy, r } = n.arc!;
  const sp = n.spacing ?? 0;
  let a = -Math.PI / 2 - arcHalf(ctx, n);
  ctx.textAlign = "center";
  for (const ch of n.text) {
    const w = ctx.measureText(ch).width;
    const mid = a + w / 2 / r;
    ctx.save();
    ctx.translate(cx + r * Math.cos(mid), cy + r * Math.sin(mid));
    ctx.rotate(mid + Math.PI / 2);
    op(ch, 0, 0);
    ctx.restore();
    a += (w + sp) / r;
  }
  ctx.textAlign = n.align;
}
