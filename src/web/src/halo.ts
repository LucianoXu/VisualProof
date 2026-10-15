// Names over everything else, each on a halo (the owner's decision of 2026-10-15): strokes of the
// background round its letters, each narrower and stronger than the last, so that the halo fades
// outward and what lies under a name — an edge, a point, a ring — never crosses it. The board writes
// its names so (web/src/canvas.ts), and an artwork's foot (web/src/artwork.ts).

/** A name to write: its text, where, in what font, aligned how, in what paint. */
export interface Written {
  text: string;
  x: number;
  y: number;
  font: string;
  align: CanvasTextAlign;
  fill: string | CanvasGradient;
}

/** The halo's strokes, outermost first: width in pixels, opacity. */
export const HALO: readonly [number, number][] = [
  [7, 0.22],
  [4.5, 0.4],
  [2.6, 0.85],
];

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
  for (const [width, alpha] of HALO) {
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    for (const n of names) {
      set(n);
      ctx.strokeText(n.text, n.x, n.y);
    }
  }
  ctx.globalAlpha = 1;
  for (const n of names) {
    set(n);
    ctx.fillStyle = n.fill;
    ctx.fillText(n.text, n.x, n.y);
  }
  ctx.restore();
}
