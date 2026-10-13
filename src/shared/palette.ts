// VisualProof's colours, as the page's light theme has them (web/style.css, `:root`): the kinds
// (`--k-*`), the Status scheme (`--status-*`), the code's tokens (`--tk-*`), the target's star and
// a key declaration's diamond.
// The exported document (shared/doc/) takes its code's colours from here, so that a highlighted
// line reads as it does on the page; test/doc.test.ts checks that the two agree.
// Paper is light: the dark theme's values are the page's alone.

import type { Kind } from "./graph.ts";

/** A kind's colour, by kind; `external` for a declaration outside the project. */
export const KIND_COLORS: Record<Exclude<Kind, "quot" | "constructor" | "recursor" | "unknown"> | "external", string> = {
  def: "#0a84ff",
  abbrev: "#40c8e0",
  structure: "#30b158",
  class: "#2fa37a",
  inductive: "#63c75d",
  instance: "#ff9f0a",
  theorem: "#a395e0",
  opaque: "#ff6b3d",
  axiom: "#ff375f",
  notation: "#a2845e",
  external: "#aeaeb2",
};

/** The Status scheme's colours (web/src/status.ts, STATUSES): Okabe and Ito's palette. */
export const STATUS_COLORS = {
  failed: "#4d4d52",
  building: "#56b4e9",
  sorry: "#cc79a7",
  commented: "#2a62c0",
  stale: "#e69f00",
  approved: "#009e73",
  unreviewed: "#c7c7cc",
  trusted: "#b3e2c2",
} as const;

/** The code's token colours (web/src/highlight.ts). `sorry` is drawn white on its colour. */
export const TOKEN_COLORS = {
  keyword: "#ad3da4",
  type: "#3e7fd6",
  comment: "#8a8a8e",
  string: "#c4392b",
  number: "#6c5ce7",
  attr: "#b5762c",
  op: "#ad3da4",
  sorry: "#ff375f",
} as const;

/** The target's star. */
export const STAR_COLOR = "#f5b301";

/** A key declaration's diamond (`--key-mark`): the star's family, a shade deeper. */
export const KEY_COLOR = "#d99a00";
