// An axiom is a ring (CanvasSpec, "Colour schemes and the legend", the owner's decision of
// 2026-10-18): every axiom on the board — the project's, or outside it — is drawn with a ring of its
// own colour around its point, a gap apart, in both schemes and every artwork style, so that it is
// told by its shape where its colour is not told apart (the Kind palette's axiom red and structure
// green are one colour to a deuteranope). The legend's swatch, the panel's, a card's, the search's
// and the hover's dots are ringed the same way (style.css, `.dot.axiom`).
//
// Its colour is the point's: it says nothing the point does not, and stays apart from the marks the
// board draws round points, which are the accent's (the selection, the pointer), the readers' own
// colours (others' selections), gold (a target's star, a key's diamond), the labels' grey (a pin)
// and a past build's amber and teal. Those stand outside it, a gap further out, and an axiom's name
// is written beyond it.

/** The gap between a point's edge and its ring, and the ring's width, in px: wide enough to see at
 *  the smallest point (1.3 px), narrow enough not to read as a mark of its own. */
export const AXIOM_GAP = 1.5;
export const AXIOM_W = 1.5;
/** the ring's middle past the point's edge: the renderer's ring offset (gl/renderer.ts, `circle`) */
export const AXIOM_AT = AXIOM_GAP + AXIOM_W / 2;
/** how far the ring reaches past the point's edge */
export const AXIOM_OUT = AXIOM_GAP + AXIOM_W;
/** a lit point's radius, in points (web/src/canvas.ts, `point`) */
export const LIT = 1.4;

/** Whether a declaration of `kind` is drawn ringed: an axiom, of the project or outside it. */
export function ringed(kind: string): boolean {
  return kind === "axiom";
}

/** How much further out the marks round a point of `kind` go (the pointer's ring, a pin's, a past
 *  build's), in px: outside its axiom's ring. */
export function outside(kind: string): number {
  return ringed(kind) ? AXIOM_OUT : 0;
}

/** The radius of the selection's ring and of the others' round a point of `kind` whose radius is
 *  `dotR` px, lit as a pick is: clear of its axiom's ring by 2.5 px at every zoom. */
export function pickRadius(dotR: number, kind: string): number {
  const base = Math.max(7, dotR + 4);
  return ringed(kind) ? Math.max(base, LIT * dotR + AXIOM_OUT + 2.5) : base;
}

/** A declaration's dot on the page (style.css, `.dot`): its colour's class — the outside world's
 *  for one outside the project — and, an axiom, its ring. */
export function kindDot(kind: string, ext: boolean): string {
  return `k-${ext ? "external" : kind}${ringed(kind) ? " axiom" : ""}`;
}
