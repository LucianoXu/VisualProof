// Text measured as an artwork's fonts draw it, without a browser (ExportSpec decision 21): the
// advance widths of the faces the package ships (assets/webfonts/metrics.json, made by
// scripts/artfonts.py), for a CSS font as a canvas takes it. A face stands for its family at the
// nearest weight it is made at; a character it has not is measured in the faces that stand in for
// it (Noto Sans, Noto Sans Math), as the renderer draws it from them. No kerning: the renderer the
// command draws with is given none either.

/** One face: its family, weight and slant, its units per em, and its characters' advances. */
export interface FaceMetrics {
  family: string;
  weight: number;
  style: "normal" | "italic";
  unitsPerEm: number;
  /** a character's code point, as a string, to its advance in units */
  widths: Record<string, number>;
}

/** The faces an artwork draws in, and those standing in where they have no glyph. */
export interface ArtFontMetrics {
  faces: FaceMetrics[];
  fallback: FaceMetrics[];
}

/** the families an artwork's fonts name that the package has not, and the face drawn for them: the
 *  system's own for the board's names (web/src/canvas.ts FONT), and the generic ones */
const STANDS_FOR: Record<string, string> = {
  "-apple-system": "Source Sans 3",
  "blinkmacsystemfont": "Source Sans 3",
  "sf pro text": "Source Sans 3",
  "inter": "Source Sans 3",
  "segoe ui": "Source Sans 3",
  "sans-serif": "Source Sans 3",
  "system-ui": "Source Sans 3",
  "georgia": "Source Serif 4",
  "times new roman": "Source Serif 4",
  "serif": "Source Serif 4",
};

/** A CSS font as a 2D context takes it ("italic 600 12px \"Jost\", sans-serif"): its slant, weight,
 *  size in pixels, and families in order. */
export function parseFont(font: string): { style: "normal" | "italic"; weight: number; px: number; families: string[] } {
  const m = /^\s*((?:(?:italic|oblique|normal|bold|bolder|lighter|\d{3})\s+)*)([\d.]+)px(?:\/[^\s]+)?\s+(.+)$/i.exec(font);
  if (!m) return { style: "normal", weight: 400, px: 10, families: ["sans-serif"] };
  const words = m[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
  const style = words.includes("italic") || words.includes("oblique") ? "italic" : "normal";
  const num = words.find((w) => /^\d{3}$/.test(w));
  const weight = num ? Number(num) : words.includes("bold") ? 700 : 400;
  const families = m[3].split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return { style, weight, px: Number(m[2]), families };
}

/** How wide `text` is in `font`, in pixels, as the package's faces draw it. */
export function textMeasurer(metrics: ArtFontMetrics): (text: string, font: string) => number {
  const families = new Map<string, FaceMetrics[]>();
  for (const f of metrics.faces) families.set(f.family.toLowerCase(), [...(families.get(f.family.toLowerCase()) ?? []), f]);
  const chosen = new Map<string, { face: FaceMetrics; px: number }>();
  /** the face a font is drawn in: its first family the package has (or stands one in for), at the
   *  slant asked where it is made in it, at the nearest weight */
  const faceOf = (font: string) => {
    const hit = chosen.get(font);
    if (hit) return hit;
    const f = parseFont(font);
    let set: FaceMetrics[] | undefined;
    for (const fam of f.families) {
      const k = fam.toLowerCase();
      set = families.get(k) ?? families.get(STANDS_FOR[k]?.toLowerCase() ?? "");
      if (set) break;
    }
    set ??= families.get("source sans 3") ?? metrics.faces;
    const slanted = set.filter((x) => x.style === f.style);
    const pool = slanted.length ? slanted : set;
    const face = pool.reduce((a, b) => (Math.abs(b.weight - f.weight) < Math.abs(a.weight - f.weight) ? b : a));
    const out = { face, px: f.px };
    chosen.set(font, out);
    return out;
  };
  return (text, font) => {
    const { face, px } = faceOf(font);
    let w = 0;
    for (const ch of text) {
      const cp = String(ch.codePointAt(0));
      let units: number | undefined = face.widths[cp];
      let upm = face.unitsPerEm;
      if (units === undefined)
        for (const fb of metrics.fallback)
          if (fb.widths[cp] !== undefined) {
            units = fb.widths[cp];
            upm = fb.unitsPerEm;
            break;
          }
      // a character no face has: about an en, as a renderer's missing glyph is drawn
      w += ((units ?? face.unitsPerEm * 0.55) / upm) * px;
    }
    return w;
  };
}
